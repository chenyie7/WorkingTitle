import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import App from '../../src/renderer/src/App'
import { fillCharsFor } from '../../src/core/bossKey'
import { splitChapters } from '../../src/core/chapters'
import { defaultSettings } from '../../src/core/types'
import type { Novel } from '../../src/core/types'
import type { WtApi } from '../../src/renderer/src/types/global'

/**
 * 铺满那一路的**接线**判据：进老板模式那一下，到底有没有去量块高。
 *
 * 【为什么必须单开一个文件】`vi.mock` 是按文件提升的（工厂会被提到所有 import 之前），写在
 * `app.test.tsx` 里就等于把那个文件所有渲染 `App` 的用例的 `measureBlocks` 全换掉。
 *
 * 【为什么不能靠屏幕内容判】jsdom 里量不出高度（`offsetHeight` / `offsetTop` 恒为 0），
 * 于是**量到与量不到都会走 `revealTo(fillCharsFor(percent))`**——两条路在屏幕上完全同形。
 * 这正是 Task 11 最初那条用例空转的原因：它断言的是「屏幕不是空的」，而那件事在两种实现下
 * 都成立。唯一的判据是「`measureBlocks` 有没有被调用」。
 *
 * 【它守的东西有一个真机后果】按 `mdDoc`（= 当前显示的那一份）分岔时，按下 ⌘⇧B 那一刻
 * `bossActive` 还是 false、`mdDoc` 还是小说那一份的（txt → null），于是进老板模式永远走
 * 「按字符数铺」：屏幕底部切在半句话上，要再按一次 ⌘⇧↑/↓ 才对齐到块边界——计划末尾验收
 * 清单第 2 条看的就是这个。实测：把分岔改回 `mdDoc`，下面第一条当场红。
 */
const { measureBlocksSpy } = vi.hoisted(() => ({
  /**
   * 固定返回 `null`。**这不是「mock 掉布局」**：jsdom 里量不出高度就是真实行为
   * （`measureBlocks` 的判据是「所有块高都是 0 就返回 null」），这里借它当探针用。
   */
  measureBlocksSpy: vi.fn((): null => null)
}))

vi.mock('../../src/renderer/src/markdown/measure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/src/markdown/measure')>()
  // 【只换 measureBlocks】`BLOCK_END_ATTR` 必须留真的——渲染那一侧（`toReact.tsx`）在用它，
  // 换成假的会让块包装上读不到偏移，那就成了另一个 bug。
  return { ...actual, measureBlocks: measureBlocksSpy }
})

function makeNovel(): Novel {
  const text = '第一章 甲\nAAAAAAAAAA\n第二章 乙\nBBBBBBBBBB\n'
  const { flatText, chapters } = splitChapters(text, '测试书')
  return { title: '测试书', sourcePath: '/tmp/测试书.txt', encoding: 'UTF-8', hadBom: false, flatText, chapters }
}

/**
 * 工作文档。**正文长过 `CHARS_PER_SHEET`（1330）**：短于它的话「铺满 100%」会被
 * `revealTo` 夹到全文长度，`90%` 与 `100%` 铺出来一样多，下面那条 toast 判据就没意义了。
 */
function makeWorkDoc(sourcePath: string): Novel {
  const body = Array.from(
    { length: 60 },
    (_, i) => `${i + 1}. 本季度把导入管线与老板键做完了，细节见周报附件。`
  ).join('\n')
  const { flatText, chapters } = splitChapters(`# 季度汇报\n\n${body}\n`, '季度汇报')
  return { title: '季度汇报', sourcePath, encoding: 'UTF-8', hadBom: false, flatText, chapters }
}

let loadWorkDoc: Mock<(path: string) => Promise<Novel | null>>

/**
 * 装 `window.api`。**这里可以 spread 良性替身，与 `app.test.tsx` 的告诫相反**——那份文件
 * 是在**定义**一个替身（spread 会把「漏写一个方法」从响亮的 TypeError 变成静默的错误值），
 * 而这里只是在 `tests/setup.ts` 已经装好的良性替身上覆盖三个方法，其余照旧。
 *
 * 【为什么走「设置里配了路径 → 启动读进来」这条路】造的是真实场景：小说是 txt、工作文档
 * 是 md。工作文档经 `loadSettings().workDocPath` 交给启动流程读，与真机一致。
 */
function installApi(workDoc: Novel | null): void {
  loadWorkDoc = vi.fn(async (_path: string) => workDoc)
  ;(window as unknown as { api: WtApi }).api = {
    ...(window.api as WtApi),
    importNovel: async () => makeNovel(),
    loadSettings: async () => ({ ...defaultSettings(), workDocPath: workDoc?.sourcePath ?? null }),
    loadWorkDoc
  }
}

/** 走界面导入小说（真实功能都在设置对话框里），与 `app.test.tsx` 同一套交互 */
function importViaSettings(): void {
  fireEvent.click(screen.getByTestId('tab-文件'))
  fireEvent.click(screen.getByTestId('btn-settings'))
  fireEvent.click(screen.getByTestId('btn-import'))
  fireEvent.click(screen.getByTestId('settings-close'))
}

/** 按一次老板键（macOS 默认是 ⌘⇧B） */
function pressBossKey(): void {
  fireEvent.keyDown(window, { code: 'KeyB', key: 'B', metaKey: true, shiftKey: true })
}

/**
 * 等启动流程把工作文档读进来。
 *
 * 【为什么不能只等 `page-empty`】那个元素在 boot 的第二个 await（`loadWorkDoc`）之前就渲染
 * 出来了；紧接着按老板键会撞上「工作文档还没进内存」，用例收到的是一条 toast 而不是切换。
 */
async function waitForWorkDocLoaded(): Promise<void> {
  await waitFor(() => expect(loadWorkDoc).toHaveBeenCalled())
  await act(async () => {})
}

/** 等到真的进了老板模式（阅读区里是工作文档那一段渲染后的内容） */
async function enterBossMode(): Promise<void> {
  await act(async () => {
    pressBossKey()
  })
  await waitFor(() => expect(screen.getByTestId('page-text').textContent!.length).toBeGreaterThan(0))
}

beforeEach(() => {
  // 【每个用例都要清】不然「上一条调用过」会让下一条假绿——这个文件里第一条判据就是
  // 「有没有被调用」，而 spy 是模块级的、跨用例活着。
  measureBlocksSpy.mockClear()
})

describe('铺满的接线：进老板模式时去不去量块高', () => {
  it('进老板模式那一下真的去量了块高（按 ⌘⇧B 就会调 measureBlocks）', async () => {
    installApi(makeWorkDoc('/tmp/季度汇报.md'))
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await waitForWorkDocLoaded()

    // 前提自检：进老板模式之前一次都没量过——否则下面那句「被调用过」可能来自别处
    expect(measureBlocksSpy).not.toHaveBeenCalled()

    await enterBossMode()

    await waitFor(() => expect(measureBlocksSpy).toHaveBeenCalled())
  })

  it('.txt 工作文档不量：它没有结构可量，本来就是按字符数铺', async () => {
    installApi(makeWorkDoc('/tmp/季度汇报.txt'))
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await waitForWorkDocLoaded()

    await enterBossMode()
    // 【这一半是前一条的边界】少了它，「一律去量」也能让前一条通过——而 txt 那一路去量
    // 等于白渲染一份整篇的隐藏副本（还开着 `measuring`，每个按键重建一次）。
    expect(measureBlocksSpy).not.toHaveBeenCalled()
  })
})

describe('铺满的提示文案', () => {
  it('md 工作文档：toast 只报档位，不报那个兜底估算的字数', async () => {
    installApi(makeWorkDoc('/tmp/季度汇报.md'))
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await waitForWorkDocLoaded()
    await enterBossMode()

    await act(async () => {
      fireEvent.keyDown(window, { code: 'ArrowDown', key: 'ArrowDown', metaKey: true, shiftKey: true })
    })
    // 【判据是「不出现字数」，而不只是「出现了档位」】`toContain('铺满 90%')` 在带字数的
    // 那一版上也成立，等于没测。
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toBe('铺满 90%'))
  })

  it('.txt 工作文档：还是照旧带字数（那一路的字数是真的）', async () => {
    installApi(makeWorkDoc('/tmp/季度汇报.txt'))
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await waitForWorkDocLoaded()
    await enterBossMode()

    await act(async () => {
      fireEvent.keyDown(window, { code: 'ArrowDown', key: 'ArrowDown', metaKey: true, shiftKey: true })
    })
    await waitFor(() =>
      expect(screen.getByTestId('toast').textContent).toBe(`铺满 90% ≈ ${fillCharsFor(90)} 字`)
    )
  })
})
