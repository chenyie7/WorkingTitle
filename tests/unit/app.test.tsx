import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import App from '../../src/renderer/src/App'
import { splitChapters } from '../../src/core/chapters'
import { defaultSettings } from '../../src/core/types'
import type { AppSettings, Novel, PersistedSession } from '../../src/core/types'

function makeNovel(): Novel {
  const text = '第一章 甲\nAAAAAAAAAA\n第二章 乙\nBBBBBBBBBB\n'
  const { flatText, chapters } = splitChapters(text, '测试书')
  return { title: '测试书', sourcePath: '/tmp/测试书.txt', encoding: 'UTF-8', hadBom: false, flatText, chapters }
}

/**
 * 阅读区当前显示了多少字。
 *
 * 【为什么不再读状态栏】状态栏里那条「已显示 N / 全书 M 字」已经删掉了——真 Word 只报
 * 全文字数、从不报「已显示多少」，那个词组本身就是伪装破绽（见 StatusBar.tsx 顶部说明）。
 * 于是这份文件改用**正文长度**当观测点：那才是用户真正看到的东西，也是「抽了多少字」
 * 唯一的真相来源（状态栏那条本来就只是它的一个投影）。
 *
 * 空状态下没有 `page-text`（渲染的是空状态引导），返回 0。
 */
function revealedChars(): number {
  return screen.queryByTestId('page-text')?.textContent?.length ?? 0
}

let saved: PersistedSession | null = null
/** 最近一次 `loadSession` 是【按哪本书的路径】去取的。null = 从没按路径取过。 */
let sessionAskedFor: string | null = null

function installApi(novel: Novel | null, session: PersistedSession | null = null): void {
  saved = null
  sessionAskedFor = null
  ;(window as unknown as { api: unknown }).api = {
    importNovel: vi.fn(async () => novel),
    openNovelPath: vi.fn(async () => novel as Novel),
    initialNovelPath: vi.fn(async () => null),
    loadSession: vi.fn(async (sourcePath: string) => {
      sessionAskedFor = sourcePath
      return session
    }),
    saveSession: vi.fn(async (s: PersistedSession) => {
      saved = s
    }),
    clearSession: vi.fn(async () => {}),
    /**
     * 【最后一项刻意不是 `defaultSettings()` 的那个 null】`lastSourcePath` 现在是启动恢复的唯一
     * 线索：按书取进度之后，「读完哪本接着读」必须先知道是哪本。桩里让设置指向本用例这本，
     * 就等于「用户上次打开的就是它」——那是真的 settings.json 在这本书读过之后的样子。
     * 若留 null，启动就什么都不开（正合 `installApi(null)` 那条用例），而
     * 「有会话时启动即恢复到上次位置」会红成 0 个字：它现在测的正是「设置指路 → 取那本的进度」。
     */
    loadSettings: vi.fn(async () => ({
      ...defaultSettings(),
      lastSourcePath: novel?.sourcePath ?? null
    })),
    saveSettings: vi.fn(async () => {}),
    onMenuCommand: vi.fn(() => () => {}),
    getTheme: vi.fn(async () => false),
    setThemeSource: vi.fn(async () => {}),
    onThemeChange: vi.fn(() => () => {})
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

/**
 * 走界面导入一本小说：真实功能现在都收在设置对话框里，所以是「文件 → 设置 → 导入小说」，
 * 导入完再把对话框关掉（对话框不会自己关：`onImport` 是异步的、且用户可能只是取消了选择框）。
 */
function importViaSettings(): void {
  fireEvent.click(screen.getByTestId('tab-文件'))
  fireEvent.click(screen.getByTestId('btn-settings'))
  fireEvent.click(screen.getByTestId('btn-import'))
  fireEvent.click(screen.getByTestId('settings-close'))
}

/** 打开设置对话框（比例等控件都在里面） */
function openSettings(): void {
  fireEvent.click(screen.getByTestId('tab-文件'))
  fireEvent.click(screen.getByTestId('btn-settings'))
}

describe('App 端到端（单测层）', () => {
  it('未导入时阅读区是空状态', async () => {
    installApi(null)
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('page-empty')).toBeTruthy())
    expect(screen.getByTestId('status-chapter').textContent).toBe('—')
  })

  it('导入后蓝条上不出现小说文件名（那是导入唯一的泄露点）', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)

    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 修复前这里是 `novel.title`（= 文件名「测试书」），等于把「在看小说」写在窗口最显眼处
    expect(screen.getByTestId('doc-title').textContent).toBe('文档1')
    expect(screen.getByTestId('ribbon').textContent).not.toContain('测试书')
  })

  it('导入小说后可打字，阅读区按比例增长', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)

    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    // 默认比例 10，敲 1 个键应显示 10 个字
    fireEvent.input(capture, { target: { value: 'x' } })
    await waitFor(() => expect(revealedChars()).toBe(10))
    expect(screen.getByTestId('page-text').textContent!.length).toBeGreaterThanOrEqual(10)
  })

  it('退格回吐显示，但小说内容不变', async () => {
    const novel = makeNovel()
    const originalFlat = novel.flatText
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    fireEvent.input(capture, { target: { value: 'x' } })
    await waitFor(() => expect(revealedChars()).toBe(10))

    fireEvent.keyDown(capture, { key: 'Backspace' })
    await waitFor(() => expect(revealedChars()).toBe(0))
    expect(novel.flatText).toBe(originalFlat)
  })

  it('点击章节跳转，当前章高亮跟随', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-1')).toBeTruthy())

    fireEvent.click(screen.getByTestId('chapter-item-1'))
    await waitFor(() => expect(screen.getByTestId('status-chapter').textContent).toBe('2 / 2'))
    expect(screen.getByTestId('chapter-item-1').className).toContain('chapter-item--active')

    // 跳章之后阅读区是**空的**：显示窗口从该章开头起算，而这一章还没读过。
    // 少了这一条，「已显示」把 revealStart 漏掉（写成 cursor）也没人发现——
    // 变异实测：把 `state.cursor - state.revealStart` 改成 `state.cursor`，全套用例全绿。
    expect(revealedChars()).toBe(0)
  })

  it('改比例后同样的击键抽出更多字', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 比例输入框在设置对话框里（原先挂在「开始」「视图」两个选项卡下，已于本次搬走）
    openSettings()

    const ratioInput = screen.getByTestId('ratio-input')
    fireEvent.change(ratioInput, { target: { value: '2' } })
    fireEvent.keyDown(ratioInput, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:2'))
    fireEvent.click(screen.getByTestId('settings-close'))

    const capture = screen.getByTestId('input-capture')
    fireEvent.input(capture, { target: { value: 'x' } })
    await waitFor(() => expect(revealedChars()).toBe(2))
  })

  it('有会话时启动即恢复到上次位置，无需重新输入', async () => {
    const novel = makeNovel()
    const session: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: '/tmp/测试书.txt',
      ratio: 5,
      mode: 'key',
      cursor: 15,
      revealStart: 0,
      chapterPos: [15, 0],
      activeChapter: 0,
      startedAt: null
    }
    installApi(novel, session)
    render(<App />)

    await waitFor(() => expect(revealedChars()).toBe(15))
    expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:5')
    expect(screen.getByTestId('status-mode').textContent).toBe('输入模式 纯按键')
    expect(screen.getByTestId('page-text').textContent).toContain(novel.flatText.slice(0, 15))
  })

  it('清除阅读记录后回到空状态', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    openSettings()
    fireEvent.click(screen.getByTestId('btn-clear-session'))
    await waitFor(() => expect(screen.getByTestId('page-empty')).toBeTruthy())
    expect(window.api.clearSession).toHaveBeenCalled()
  })

  it('在设置里改文档名，关掉之后蓝条上的字跟着变', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    openSettings()
    const input = screen.getByTestId('doc-title-input') as HTMLInputElement
    expect(input.value).toBe('文档1')
    fireEvent.change(input, { target: { value: '第 3 季度汇报' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByTestId('settings-close'))

    expect(screen.getByTestId('doc-title').textContent).toBe('第 3 季度汇报')
  })

  it('打字后会防抖保存会话', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    const saveSession = window.api.saveSession as unknown as { mock: { calls: unknown[] } }
    const before = saveSession.mock.calls.length

    // 连着敲 3 下（每次都是状态变化），但都发生在防抖窗口之内
    fireEvent.input(capture, { target: { value: 'x' } })
    fireEvent.input(capture, { target: { value: 'x' } })
    fireEvent.input(capture, { target: { value: 'x' } })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved!.cursor).toBe(30)
    expect(saved!.sourcePath).toBe('/tmp/测试书.txt')

    // 【防抖本身也要断言】：只断言「最终写了一次」的话，把防抖整个删掉
    //（每次状态变化都立刻写）用例照样全绿——变异实测确认过。3 次击键 + 推进一次
    // 防抖窗口，应当**恰好写一次**（写的是最后那个状态）。
    expect(saveSession.mock.calls.length - before).toBe(1)
  })

  it('没有 window.api 时也渲染出外壳，不抛（sandboxed preload 加载失败）', async () => {
    // 把 setup.ts 那份良性桩摘掉，模拟 Task 6 实测过的形态：preload 加载失败时
    // 页面照常渲染，而 window.api === undefined。global.d.ts 把它声明成必填，
    // 所以类型层面不会提醒任何人——这条用例是 App 里那几处 api 判空的唯一守卫。
    // 两种失败形态都会被抓到：effect 里同步抛（render 直接红），以及 void boot() 里
    // 的 unhandled rejection（用例行照旧 passed，但汇总行多一条 Errors、exit code 是 1）。
    delete (window as unknown as { api?: unknown }).api

    expect(() => render(<App />)).not.toThrow()
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId('app-root')).toBeTruthy()
    expect(screen.getByTestId('page-empty')).toBeTruthy()
    expect(screen.getByTestId('status-chapter').textContent).toBe('—')
    expect(revealedChars()).toBe(0)
  })
})

describe('设置的持久化', () => {
  it('启动时把磁盘上的设置读进界面', async () => {
    installApi(null)
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      docTitle: '季度汇报',
      themeSource: 'dark' as const,
      darkPaper: true,
      lastSourcePath: null
    }))
    render(<App />)
    // doc-title 是蓝条上那个文档名（Ribbon.tsx 里 data-testid="doc-title"）
    await waitFor(() => expect(screen.getByTestId('doc-title').textContent).toBe('季度汇报'))
  })

  // 【这条是本次改动里最容易写错的一条】设置是「改了就写回」的，而首帧渲染时三个状态
  // 还都是默认值——读盘是异步的。少了 settingsLoaded 那道闸，启动会先拿着默认值写一遍，
  // 把磁盘上真正的设置冲掉，然后才读到已经被自己冲掉的默认值。
  //
  // 【读盘必须真的挂住】桩若立即 resolve，settingsLoaded 马上就是 true，那个 effect 写盘
  // 是**正确行为**——这条用例就变成「测不出守卫在不在」的空跑。所以这里用一个手动放行的
  // Promise，并分两段断言：挂住时一次都不许写，放行之后必须写。第二段是前提自检，
  // 少了它，一个「防抖根本没接上」的实现也能让第一段绿。
  it('读回设置之前不写盘（否则会用自己的默认值覆盖磁盘）', async () => {
    installApi(null)
    const saveSettings = vi.fn(async (_settings: AppSettings) => {})
    let release: (s: AppSettings) => void = () => {}
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(
      () =>
        new Promise<AppSettings>((resolve) => {
          release = resolve
        })
    )
    ;(window.api as unknown as { saveSettings: unknown }).saveSettings = saveSettings
    render(<App />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(saveSettings).not.toHaveBeenCalled()

    // 【第二段为什么是 waitFor 而不是再推进一次定时器】`advanceTimersByTimeAsync(2000)` 跑在
    // React 把「settingsLoaded 变 true」那一帧提交【之前】：那个 effect 因此是在这一刻之后才
    // 排上 600ms 定时器的，推进窗口里根本没有它。`shouldAdvanceTime: true` 下 waitFor 的实时
    // 轮询会连带推进假时钟，600ms 一到就落盘——本文件里「打字后会防抖保存会话」也是这么等
    // 防抖的。实测：只写 advance 时这条红在 `toHaveBeenCalled`，换成 waitFor 才绿。
    await act(async () => {
      release({ docTitle: '季度汇报', themeSource: 'dark', darkPaper: true, lastSourcePath: null })
      await vi.advanceTimersByTimeAsync(2000)
    })
    await waitFor(() => expect(saveSettings).toHaveBeenCalled())
  })

  it('改了文档名之后会把设置写回去', async () => {
    installApi(makeNovel())
    const saveSettings = vi.fn(async (_settings: AppSettings) => {})
    ;(window.api as unknown as { saveSettings: unknown }).saveSettings = saveSettings
    render(<App />)
    importViaSettings()
    openSettings()
    fireEvent.change(screen.getByTestId('doc-title-input'), { target: { value: '季度汇报' } })
    fireEvent.blur(screen.getByTestId('doc-title-input'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    await waitFor(() => expect(saveSettings).toHaveBeenCalled())
    const last = saveSettings.mock.calls[saveSettings.mock.calls.length - 1][0]
    expect(last.docTitle).toBe('季度汇报')
  })
})

describe('导入一本读过的书', () => {
  // 【这是本特性存在的理由，也是初稿漏掉的那条】openNovel 原先是 `new TypingEngine(next)`
  // ——**从不读会话**，而「导入小说」走的正是它。少了读盘这一步，导入一本读过的书＝全新引擎
  // ＝600ms 后把 cursor 0 落盘覆盖掉那本书的进度。
  it('导入时接着上次读，而不是从头开始', async () => {
    const novel = makeNovel()
    const session: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: novel.sourcePath,
      ratio: 10,
      mode: 'ime',
      cursor: 20,
      revealStart: 0,
      chapterPos: [20, 0],
      activeChapter: 0,
      startedAt: null
    }
    installApi(novel, session)
    render(<App />)
    importViaSettings()

    // 接着上次读 ⇒ 阅读区显示 20 个字（而不是 0）
    await waitFor(() => expect(revealedChars()).toBe(20))
    // 【这一条才是钉住「按书取进度」的】只断言「显示了 20 个字」是不够的——实现之前它也是绿的：
    // 旧启动流程里那段「先 loadSession()（无参）再比 sourcePath」照样能恢复到 20 个字，于是这
    // 条用例在改之前就能通过（实测：只加用例、还没动 App.tsx 的那一轮，它已经在 12 passed 里）。
    // 有证明力的是「有人按这本书的路径去问过进度」：openNovel 若不读会话，这一项恒为 null。
    expect(sessionAskedFor).toBe(novel.sourcePath)
  })
})
