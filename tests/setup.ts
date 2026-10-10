import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import type { WtApi } from '../src/renderer/src/types/global'

/**
 * 渲染层的**良性** `window.api` 替身：什么都不做，但每个方法都在，且都是 async。
 *
 * 为什么必须有：`preload` 在 jsdom 里根本不会跑，而 `App` 挂载时会走启动流程
 * （`initialNovelPath` / `loadSession` / `onMenuCommand`）。少了这个桩，任何
 * `render(<App/>)` 的用例都会以「TypeError」或「unhandled rejection」两种形态之一失败
 * （两种都是 Task 7 实测过的形态：前者让用例当场红，后者只让汇总行多一条
 * `Errors 1 error`，用例行照旧 passed，而 vitest 的 exit code 是 1）。
 *
 * `openNovelPath` 刻意抛异常而不是编一本小说出来：真的被调用到（有启动参数或有会话）
 * 说明用例自己该提供 api（见 `tests/unit/app.test.tsx` 的 `installApi`），此时一个
 * 假小说比一声响更危险——它会让用例在「用的是别人的数据」这种前提下静默通过。
 * 两个调用点都在 try/catch 里，异常不会冒出去。
 */
const benignApi: WtApi = {
  importNovel: async () => null,
  openNovelPath: async () => {
    throw new Error('测试桩：没有实现 openNovelPath，用例应自行提供 window.api')
  },
  initialNovelPath: async () => null,
  loadSession: async () => null,
  saveSession: async () => {},
  clearSession: async () => {},
  onMenuCommand: () => () => {}
}

function installBenignApi(): void {
  // `setupFiles` 对**每个**测试文件都跑，而 `tests/unit/guardA.test.ts` 顶上写着
  // `// @vitest-environment node`——那个文件里根本没有 `window`。少了这行判空，
  // 该文件会以「ReferenceError: window is not defined」整份失败：**0 个用例被执行**，
  // 而汇总行照旧是 `Tests N passed`，只有 exit code 是 1。
  if (typeof window === 'undefined') return
  ;(window as unknown as { api: WtApi }).api = benignApi
}

installBenignApi()

/**
 * jsdom 不实现 ResizeObserver，而 `ChapterList` 用它测视口高度。
 *
 * 为什么放在这里而不是像 `tests/unit/chapterList.test.tsx` 那样各写一份：Task 12 之后
 * **`App` 会渲染 `ChapterList`**，于是 `layout.test.tsx`（Task 7 的用例）也一并踩到这个坑
 * ——它是 `render(<App/>)` 的。放在 `setupFiles` 里，一处即可覆盖所有经过 `App` 的用例；
 * 那个文件里的同名 stub 留着无害（后赋值的赢，行为一样）。
 *
 * 这个替身【不测量任何东西】：`observe` 是空操作，所以组件里的 `measure()` 只会跑一次
 * （挂载时那次 `clientHeight || 400`）。虚拟滚动窗口在 jsdom 里因此永远按 400px 算——
 * 用例若要断言渲染了哪些行，得自己按这个值推算，别以为它在跟着真实布局走。
 */
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  // 用例可能把 window.api 换成自己的替身（app.test.tsx 就是这么做的）。
  // 换回来，免得上一个用例的替身漏给下一个——那种漏给会让「本期用例没装 api」
  // 表现为「上一个用例的 spy 被调用」，红得莫名其妙。
  installBenignApi()
})
