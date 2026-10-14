import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { defaultSettings } from '../src/core/types'
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
 * 它唯一的调用点在 `App.tsx` 启动流程的 try/catch 里（那个 try 现在只护 `openNovelPath`
 * 与 `openNovel`，`loadSettings` / `initialNovelPath` 在它之外）——而这个良性桩的
 * `initialNovelPath` 恒返回 null，所以 `target` 为空、那个 try 根本进不去，异常不会冒出去。
 *
 * 【这个 `WtApi` 是手写接口，不是 preload 的 `typeof api`】它来自
 * `src/renderer/src/types/global.d.ts`；而 `src/preload/index.ts` 末尾那句
 * `export type WtApi = typeof api` **零引用者**（全仓库搜 `WtApi` 只有它自己的定义处）。
 *
 * 【三份拷贝里有两份有闸，别记反】【这一句原来写的是「只有一份有闸」，那已经是假话】
 * 同一个 API 形状在仓库里躺着三处：本文件的 `benignApi`（`: WtApi`）、
 * `tests/unit/app.test.tsx` 的 `installApi`、以及 preload 里那个对象。
 * **前两处的对象字面量目标类型都是 `WtApi`，两个方向都会红**——多写一个成员报 TS2353
 * （对象字面量的多余属性检查），少写一个报 TS2741（缺属性）。本桩在 Task 4 两次实测过；
 * `tests/unit/app.test.tsx` 那份在 Task 9 实测过一次（TS2741），2026-10-14 又复验过一次：
 * 往 `WtApi` 里插一个方法，`tsc --noEmit -p tsconfig.json` 精确报出这两行——
 * `tests/setup.ts(37,7): error TS2741` 与 `tests/unit/app.test.tsx(67,4): error TS2741`。
 * **所以加一个 API 方法时，这两处都要跟着改。**
 *
 * **真正一条闸都没有的，是 preload 与那份手写接口之间**——同一次复验里 preload 一行都没报，
 * 往 preload 加方法，`pnpm typecheck` 照旧 exit 0。要手工同步的正是那一处，不是前两处。
 *
 * 所以补下面那两行不是「给多余属性找个地方放」——它们在这份桩里是**必填**属性；补上是为了
 * 让本桩继续满足接口，从而让「少写一个就 TS2741」这条闸对之后新增的方法照样有效。
 */
const benignApi: WtApi = {
  platform: 'darwin',
  importNovel: async () => null,
  // 工作文档这两条：单测里一律「没配工作文档」。要测老板键的用例自己覆盖它们
  // （见 tests/unit/app.test.tsx 的 installApi）。
  importWorkDoc: async () => null,
  loadWorkDoc: async () => null,
  // 单测里一律「取不到图」，于是渲染层走占位框那条路
  loadWorkDocImage: async () => null,
  openNovelPath: async () => {
    throw new Error('测试桩：没有实现 openNovelPath，用例应自行提供 window.api')
  },
  initialNovelPath: async () => null,
  loadSession: async () => null,
  saveSession: async () => {},
  clearSession: async () => {},
  loadSettings: async () => defaultSettings(),
  saveSettings: async () => {},
  onMenuCommand: () => () => {},
  // 单测里一律当作浅色系统外观——深色主题的判据是真机截图，不是 jsdom
  getTheme: async () => false,
  setThemeSource: async () => {},
  onThemeChange: () => () => {}
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
