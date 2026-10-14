import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import App from '../../src/renderer/src/App'
import { fillCharsFor } from '../../src/core/bossKey'
import { splitChapters } from '../../src/core/chapters'
import { defaultSettings } from '../../src/core/types'
import type { AppSettings, Novel, PersistedSession } from '../../src/core/types'
import type { WtApi } from '../../src/renderer/src/types/global'

/** 默认铺满 100% 时该铺多少字，来自 core 的 CHARS_PER_SHEET */
const FILL_CHARS = fillCharsFor(100)

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

/**
 * `loadWorkDoc` 的桩。`waitForWorkDocLoaded` 要靠它判断「启动把文档读进来了没有」。
 *
 * 【类型为什么写成 `Mock<签名>` 而不是 `ReturnType<typeof vi.fn>`】后者在本仓库这份 vitest
 * 里是 `Mock<Procedure | Constructable>`，**赋给 `WtApi['loadWorkDoc']` 会当场 TS2322**
 * ——而按计划原文写就是那样，实测 `pnpm typecheck` exit 2。带上真实签名之后，下面那个对象
 * 字面量的 `WtApi` 目标类型才继续对它有效（少写 / 写错签名都会报）。
 */
let loadWorkDocMock: Mock<(path: string) => Promise<Novel | null>>

function installApi(
  novel: Novel | null,
  session: PersistedSession | null = null,
  settings: AppSettings = defaultSettings(),
  workDoc: Novel | null = null
): void {
  saved = null
  sessionAskedFor = null
  loadWorkDocMock = vi.fn(async (_path: string) => workDoc)
  // 【目标类型写成 WtApi，不要写 unknown】写成 unknown 的话，这个字面量**两个方向都不查**：
  // 多写一个成员（TS2353）与少写一个（TS2739）都不报。而这个替身正是「替身漏一个方法」最
  // 容易发生的地方。实测：把这里改成 WtApi，`pnpm typecheck` 会当场报
  // `TS2739: … is missing the following properties from type 'WtApi': platform, importWorkDoc, loadWorkDoc`
  // ——下面那三个成员就是为此补的。
  //
  // 【别改成 `{ ...benignApi, … }`】那样虽然能少写几行，却把「忘了某个方法」从**响亮的
  // undefined TypeError** 变成**静默的错误值**（例如漏了 loadSettings 会悄悄拿到
  // benignApi 的 `defaultSettings()`，而不是本用例传进来的那份）——正是 tests/setup.ts
  // 里那段注释要防的「用的是别人的数据、于是静默通过」。
  ;(window as unknown as { api: WtApi }).api = {
    // platform 是 TS2739 点名的三个缺失成员之一（另两个是这个对象里本来就有的
    // importWorkDoc / loadWorkDoc）。**只补它**——那两个已经在下头，再写一遍就是对象字面量
    // 重复键（TS1117）。
    platform: 'darwin',
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
     * 【默认桩刻意不指任何书】`lastSourcePath` 是启动恢复的唯一线索，给成 null 就等于
     * 「用户上次什么都没打开」——启动什么都不开。于是凡是要有书的用例**都必须自己走导入路径**
     * （`importViaSettings()`），而那正是「导入小说」这条真实路径要被覆盖的地方：桩若指着本用例
     * 这本书，书在测试体跑之前就已经由启动恢复加载好了，`importViaSettings()` 沦为装饰，
     * 连 `handleImport` 里那句 `await openNovel(next)` 删掉都没人发现。
     *
     * 需要「设置指路 → 启动恢复」那一条路径的用例（目前只有一条）在自己的体内显式覆盖它。
     */
    loadSettings: vi.fn(async () => settings),
    saveSettings: vi.fn(async () => {}),
    onMenuCommand: vi.fn(() => () => {}),
    getTheme: vi.fn(async () => false),
    setThemeSource: vi.fn(async () => {}),
    onThemeChange: vi.fn(() => () => {}),
    // 【工作文档这两条是本次新加的】它刻意与小说那条路**不共用**：小说走 openNovelPath
    // （会读会话、会写缓存），工作文档只走 loadWorkDoc（两者都不做）。
    importWorkDoc: vi.fn(async () => workDoc),
    loadWorkDoc: loadWorkDocMock,
    // 【Task 9 补的第三个有闸的替身】本文件这个对象字面量的目标类型是 `WtApi`（见上面那段
    // 说明），所以少写一个成员同样报 TS2741——计划 Task 9 Step 6 只点了 `tests/setup.ts`
    // 与 `types/global.d.ts` 两处，实测漏了这一处（`pnpm typecheck` exit 2）。姿态与
    // setup.ts 那份一致：单测里一律「取不到图」，渲染层于是走占位框那条路。
    loadWorkDocImage: vi.fn(async () => null)
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
    // 【这条用例测的正是「启动恢复」那条路】设置指路 → 打开那本书 → 取它自己的进度，
    // 全程不点导入。所以这里要显式把 `lastSourcePath` 指着这本书——那才是真的
    // settings.json 在读这本书【之后】的样子（默认桩是 null，见 installApi 的说明）。
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      ...defaultSettings(),
      lastSourcePath: novel.sourcePath
    }))
    render(<App />)

    await waitFor(() => expect(revealedChars()).toBe(15))
    expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:5')
    expect(screen.getByTestId('status-mode').textContent).toBe('输入模式 纯按键')
    expect(screen.getByTestId('page-text').textContent).toContain(novel.flatText.slice(0, 15))
  })

  /**
   * 【这条钉的是「命令行给的路径打不开」时的回退】
   *
   * 旧的两段式启动天然有它：第一段的 catch 刻意不 return，于是落到第二段去开「上次那本」。
   * Task 7 把两段合并成一次之后，光靠 `argv ?? lastSourcePath` 挑一个是不够的——用户手滑
   * 指了个打不开的路径就会落到空状态，而磁盘上明明有上次读的那本书。
   *
   * 少了下面这段回退（把 catch 改成直接 return），本用例会红成 0 个字。
   */
  it('命令行给的路径打不开时，回退到上次打开的那本书', async () => {
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
    ;(window.api as unknown as { initialNovelPath: unknown }).initialNovelPath = vi.fn(
      async () => '/tmp/打不开.txt'
    )
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      ...defaultSettings(),
      lastSourcePath: novel.sourcePath
    }))
    ;(window.api as unknown as { openNovelPath: unknown }).openNovelPath = vi.fn(
      async (p: string) => {
        if (p === '/tmp/打不开.txt') throw new Error('模拟：命令行指的文件打不开')
        return novel
      }
    )

    render(<App />)

    // 第一个目标失败、第二个成功 —— 于是恢复到 15 字，而不是停在空状态
    await waitFor(() => expect(revealedChars()).toBe(15))
    expect(screen.queryByTestId('page-empty')).toBeNull()
  })

  it('清除阅读记录后回到空状态', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 先把导入那次设置写盘的防抖推过去：不推的话，`lastSourcePath` 从来没有真正落过盘，
    // 下面「清成 null」那条断言就与「压根没写过」区分不开。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    openSettings()
    fireEvent.click(screen.getByTestId('btn-clear-session'))
    await waitFor(() => expect(screen.getByTestId('page-empty')).toBeTruthy())
    expect(window.api.clearSession).toHaveBeenCalled()

    // 【清除要连「上次打开的是哪本」一起清掉】不清的话，用户按下清除再重启，那本书又自己
    // 开回来了——而设置（文档名 / 外观 / 纸张）照旧留着。清除之后设置那一侧也会防抖写一次，
    // 推过去再断言（不推的话最后一条载荷还是导入时那条）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    const saveSettings = window.api.saveSettings as unknown as {
      mock: { calls: AppSettings[][] }
    }
    await waitFor(() => expect(saveSettings.mock.calls.length).toBeGreaterThan(0))
    const payload = saveSettings.mock.calls[saveSettings.mock.calls.length - 1][0]
    expect(payload.lastSourcePath).toBeNull()
    // 前提：这本书此前确实被记成了「上次打开的那本」——否则上面那条断言可能只是因为
    // lastSourcePath 从来就没被写过，「清成 null」与「压根没写过」区分不开。
    const seen = saveSettings.mock.calls.map((c) => c[0].lastSourcePath)
    expect(seen).toContain(novel.sourcePath)
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
    // 【桩必须是一份**完整**的设置】这个替身是靠 `as unknown` 塞进去的，`tsc` 不会替它查
    // 字段齐不齐——原先这里少写了 `ratio` 与 `shortcuts`，而 `App` 那时不读这两个字段，
    // 所以一直没人发现。Task 7 接上 `shortcuts` 之后它当场炸在 `resolveShortcuts` 里
    // （`undefined` 当表用），且是在**启动路径**上、整棵树一起挂。真机上不会发生这件事：
    // 主进程的 `readSettingsFile` 逐字段与默认值合并，返回的恒是完整对象。
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      ...defaultSettings(),
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
      release({ docTitle: '季度汇报', themeSource: 'dark', darkPaper: true, lastSourcePath: null, ratio: 10, workDocPath: null, bossFillPercent: 100, shortcuts: { import: 'Ctrl+KeyI' } })
      await vi.advanceTimersByTimeAsync(2000)
    })
    await waitFor(() => expect(saveSettings).toHaveBeenCalled())
    // 【断言载荷，而不是只断言「被调用过」】只问「调用过没有」的话，一个写完空壳的实现
    // 也能过。这里要求落盘的正是刚从磁盘读回来的那份——release 进去的那三个非默认值
    // （文档名 / 外观 / 纸张）都必须原样带出来。
    const payload = saveSettings.mock.calls[0][0] as AppSettings
    expect(payload.docTitle).toBe('季度汇报')
    expect(payload.themeSource).toBe('dark')
    expect(payload.darkPaper).toBe(true)
    // 【这一条钉的是「快捷键也真的来自磁盘」】memo 里写死 `shortcuts: {}` 的话，
    // settingsLoaded 一翻 true，防抖那次重跑就会拿空表覆盖手改过的 settings.json
    // （实测过：`{"import":"Ctrl+KeyI"}` 启动一次、全程没人碰键盘，600ms 后变成 `{}`）。
    // 上面那三条断言对这件事完全沉默——它们的字段本来就不来自 shortcuts。
    expect(payload.shortcuts).toEqual({ import: 'Ctrl+KeyI' })
  })

  // 【这条守的是「不回退」，与上一条同形，但守的是另外两个字段】`settings` memo 就是防抖
  // 落盘的载荷，「读进来了却没写进 memo」的后果是把磁盘上那个值无声冲成默认值。这条性质
  // 此前**没有任何用例守着**：实测（变异＝把 memo 里的 `workDocPath` 换成写死的 `null`）
  // 在补上本条之前全套 372 条**照样全绿**，补上之后这一条单独变红。
  it('磁盘上的 workDocPath / bossFillPercent 原样写回，不被默认值冲掉', async () => {
    installApi(null)
    const saveSettings = vi.fn(async (_settings: AppSettings) => {})
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      ...defaultSettings(),
      workDocPath: '/tmp/周报.txt',
      bossFillPercent: 40
    }))
    ;(window.api as unknown as { saveSettings: unknown }).saveSettings = saveSettings
    render(<App />)

    await waitFor(() => expect(saveSettings).toHaveBeenCalled())
    // 【读第一条，不读最后一条】第一条正是「读盘之后第一次落盘」那一发；取最后一条的话，
    // 后面任何一次重算排的防抖写都会把它顶掉，断言就漂到别的那一发上了。
    const payload = saveSettings.mock.calls[0][0] as AppSettings
    expect(payload.workDocPath).toBe('/tmp/周报.txt')
    expect(payload.bossFillPercent).toBe(40)
  })

  // 【守的是读盘那一夹】`settingsProblem` 只判「是不是有限数字」，值域夹紧归 core——所以
  // 一个手改出来的 `bossFillPercent: 500` 能一路通过校验。少了 `clampBossFillPercent`，
  // 它原样进状态、再照原样写回磁盘，而第一次按「铺满 −」会从 500 一步跳到 100。
  // 实测（变异＝把那一夹去掉）：在补上本条之前全套 373 条**照样全绿**。
  it('磁盘上超出值域的 bossFillPercent 进状态时就夹紧，写回的也是夹紧后的值', async () => {
    installApi(null)
    const saveSettings = vi.fn(async (_settings: AppSettings) => {})
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      ...defaultSettings(),
      bossFillPercent: 500
    }))
    ;(window.api as unknown as { saveSettings: unknown }).saveSettings = saveSettings
    render(<App />)

    await waitFor(() => expect(saveSettings).toHaveBeenCalled())
    const payload = saveSettings.mock.calls[0][0] as AppSettings
    expect(payload.bossFillPercent).toBe(100)
  })

  it('改了文档名之后会把设置写回去', async () => {
    installApi(makeNovel())
    const saveSettings = vi.fn(async (_settings: AppSettings) => {})
    ;(window.api as unknown as { saveSettings: unknown }).saveSettings = saveSettings
    render(<App />)
    // 【先让启动那一次设置读盘落地】它是异步的，而下面几步是同步点击。少了这一句，
    // 启动读到默认值之后才 resolve，会把刚保存的文档名覆盖回「文档1」——
    // 那是测试里的时序假象（真机上启动那一次 IPC 早于人能点开对话框），但假象一样会让
    // 这条用例红在一个与它无关的地方。
    await act(async () => {})
    importViaSettings()
    openSettings()
    fireEvent.change(screen.getByTestId('doc-title-input'), { target: { value: '季度汇报' } })
    // 【必须点保存】失焦现在只归一化、不提交——文档名与阅读替换都归「手动保存」那一组
    fireEvent.click(screen.getByTestId('settings-save'))
    // 中间观测点：蓝条上那个名字变了就说明提交确实发生了（否则下面的失败会指向错误的层）
    expect(screen.getByTestId('doc-title').textContent).toBe('季度汇报')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    await waitFor(() => expect(saveSettings).toHaveBeenCalled())
    const last = saveSettings.mock.calls[saveSettings.mock.calls.length - 1][0]
    expect(last.docTitle).toBe('季度汇报')
  })
})

describe('全局比例与当前书比例', () => {
  // 全局比例的全部作用：**新导入**的书拿它当起点
  it('新导入的书用全局比例当起点', async () => {
    installApi(makeNovel())
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      ...defaultSettings(),
      ratio: 3
    }))
    render(<App />)
    await act(async () => {})
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 状态栏那条报的是**当前书**的比例——也就是引擎真正在用的那个
    expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:3')
  })

  // 这条是本设计的核心语义：全局不是「覆盖值」而是「初值」，已经打开过的书各管各的
  it('有记录的书用它自己的比例，不被全局顶掉', async () => {
    const novel = makeNovel()
    const session: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: '/tmp/测试书.txt',
      ratio: 5,
      mode: 'key',
      cursor: 0,
      revealStart: 0,
      chapterPos: [0, 0],
      activeChapter: 0,
      startedAt: null
    }
    installApi(novel, session)
    // 全局是 3、这本书的记录是 5 —— 必须显示 5。桩里把 lastSourcePath 也指着它，
    // 走的是「启动恢复」那条路（与手动导入同一条 openNovel）。
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      ...defaultSettings(),
      ratio: 3,
      lastSourcePath: novel.sourcePath
    }))
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:5'))
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

describe('快捷键接线', () => {
  /**
   * 【为什么平台显式设成 win32】默认桩（`installApi`）里没有 `platform` 这个字段，于是
   * `App` 按 `'other'` 走——那与 win32 同属一类（`platformKind` 只分 darwin / other）。
   * 显式写出来是为了让下面的期望键位有出处，而不是碰巧对上。
   */
  function setPlatformWin32(): void {
    ;(window as unknown as { api: { platform: string } }).api.platform = 'win32'
  }

  it('Windows 上 Ctrl+O 真的能导入——这条以前是死的', async () => {
    installApi(makeNovel())
    setPlatformWin32()
    render(<App />)
    // 让启动那次设置读盘先落地。它不是这条用例的观测点，但晚一步落地会让界面在按键之后
    // 才提交，把失败指向错误的层。
    await act(async () => {})
    fireEvent.keyDown(window, { code: 'KeyO', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('page-text')).toBeTruthy())
  })

  it('设置里改过的键生效（读的是补过的表，不是默认表）', async () => {
    installApi(makeNovel())
    setPlatformWin32()
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      ...defaultSettings(),
      shortcuts: { import: 'Ctrl+KeyI' }
    }))
    render(<App />)
    // 【这一句不能省】设置是异步读回来的，没落地时表里还是默认值（Ctrl+KeyO）——
    // 那时按下 Ctrl+O 会真的触发导入，用例会红在一个与本条主题无关的地方。
    await act(async () => {})

    const importNovel = window.api.importNovel as unknown as { mock: { calls: unknown[] } }
    const before = importNovel.mock.calls.length
    fireEvent.keyDown(window, { code: 'KeyO', ctrlKey: true })
    // 【负向断言必须数**调用次数**，不能看界面上有没有正文（这一条原先就是那么写的，
    // 而它是空转的）】导入要跨几个微任务才提交，而这里是一路同步走下来的——`page-text`
    // 在那一瞬间必然还没出现，于是「旧键根本没触发」与「触发了但还没渲染完」在这条断言上
    // 完全同形。实测：把表写成 `resolveShortcuts({}, kind)`（忽略用户表，**正是本条要防的
    // 那件事**），只断言 `page-text` 为 null 时这一条照样绿——它下面那句
    // `waitFor(page-text)` 是被刚才这次 Ctrl+O 的导入满足的。
    // 数调用次数可靠：`handleImport` 在第一个 await 之前就调了 `api.importNovel()`。
    expect(importNovel.mock.calls.length).toBe(before)
    expect(screen.queryByTestId('page-text')).toBeNull()

    fireEvent.keyDown(window, { code: 'KeyI', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('page-text')).toBeTruthy())
    // 正向那半也钉在计数上：新键触发的那一次必须是**唯一**的一次
    expect(importNovel.mock.calls.length).toBe(before + 1)
  })

  /**
   * 【这条补的是「链接上了没有」里最容易漏的一段】
   *
   * Task 6 把 `ChapterList` 自己的 keydown 监听删掉之后，「按键 → 分发器 → `toggle-sidebar`
   * 这个 action → `App` 里的 `collapsed` 状态 → 侧栏真的切换」这条链的**后半段零覆盖**：
   * 前半段（按键 → action）由 `shortcutDispatch.test.ts` 守着，而 action 之后呢——
   * 把 `App` 里那个 action 换成空函数，全套单测此前一条都不会红。
   */
  it('按章节栏快捷键真的收起、又展开', async () => {
    installApi(makeNovel())
    setPlatformWin32()
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-list')).toBeTruthy())

    fireEvent.keyDown(window, { code: 'KeyH', ctrlKey: true, shiftKey: true })
    // 收起：整条 aside 不渲染，只剩那条 12px 的细缝按钮
    expect(screen.queryByTestId('chapter-list')).toBeNull()
    expect(screen.getByTestId('sidebar-toggle').getAttribute('aria-expanded')).toBe('false')

    fireEvent.keyDown(window, { code: 'KeyH', ctrlKey: true, shiftKey: true })
    expect(screen.getByTestId('chapter-list')).toBeTruthy()
    expect(screen.getByTestId('sidebar-toggle').getAttribute('aria-expanded')).toBe('true')
  })

  /**
   * 【这条补的是**另一半**：鼠标那条路】
   *
   * 侧栏有两个入口——快捷键与那两个按钮。上面那条走的是快捷键（分发器 → action），
   * 而按钮走的是受控回调（`ChapterList` 内部 `setCollapsed` → `onCollapsedChange`）。
   * 少了这一条，「`App` 忘了传 `onCollapsedChange`」是**全绿**的（实测：删掉那一行，
   * 全套用例一条都不红），而真机上表现为那两个按钮**点不动**——键盘还能用，
   * 于是用户只会觉得「按钮坏了」。
   *
   * 这个形态正是 `ChapterList.tsx` 里那段注释点名的：**只给 `collapsed` 不给回调时，
   * 受控是坏的**（`controlled` 为真、切换却落到一个 `undefined` 上）。
   */
  it('点章节栏那个按钮也真的收起、又展开', async () => {
    installApi(null)
    setPlatformWin32()
    render(<App />)
    await act(async () => {})
    expect(screen.getByTestId('chapter-list')).toBeTruthy()

    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    expect(screen.queryByTestId('chapter-list')).toBeNull()
    expect(screen.getByTestId('sidebar-toggle').getAttribute('aria-expanded')).toBe('false')

    // 收起后那个按钮换成细缝里那一个——同样得能点回来（两条路都走 `onCollapsedChange`）
    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    expect(screen.getByTestId('chapter-list')).toBeTruthy()
    expect(screen.getByTestId('sidebar-toggle').getAttribute('aria-expanded')).toBe('true')
  })

  /**
   * 【这条钉的是 `Ribbon` 上那根「可选带默认值」的线——漏接是**静默**的】
   *
   * `onRecordingChange` 不传时落到模块顶层那个空函数，于是界面一切正常、全绿，而实际表现是
   * 「录制期间分发器不静音」：用户在录制框里按下 Ctrl+O 的那一刻文件选择框当场弹出来。
   * 本项目在「摘要看着是绿的」这件事上栽过两次，这条与它们同族。
   */
  it('录制期间分发器静音——录制框里按组合键不该触发别的动作', async () => {
    installApi(makeNovel())
    setPlatformWin32()
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-list')).toBeTruthy())
    openSettings()

    // 【前提自检：没在录制时这条键是好使的】少了它，一个「分发器压根没接上」的实现
    // （按什么都没反应）也能让下面那两段绿。
    fireEvent.keyDown(window, { code: 'KeyH', ctrlKey: true, shiftKey: true })
    expect(screen.queryByTestId('chapter-list')).toBeNull()
    fireEvent.keyDown(window, { code: 'KeyH', ctrlKey: true, shiftKey: true })
    expect(screen.getByTestId('chapter-list')).toBeTruthy()

    // 让「显示/隐藏章节栏」那一行进入录制态。中间观测点：文案变了才说明真的在录——
    // 这一条同时是下面那两段断言的前提。
    fireEvent.click(screen.getByTestId('shortcut-toggle-sidebar-input'))
    expect(screen.getByTestId('shortcut-toggle-sidebar-input').textContent).toBe('请按下组合键…')

    const importNovel = window.api.importNovel as unknown as { mock: { calls: unknown[] } }
    const before = importNovel.mock.calls.length
    fireEvent.keyDown(window, { code: 'KeyO', ctrlKey: true })
    expect(importNovel.mock.calls.length).toBe(before)
    // 另一条动作按键同样不该生效
    fireEvent.keyDown(window, { code: 'KeyH', ctrlKey: true, shiftKey: true })
    expect(screen.getByTestId('chapter-list')).toBeTruthy()
  })

  /**
   * 【这条同时钉三件事，每一件都是「漏了也不会报错」的那种】
   *
   * 1. `Ribbon` 的 `onShortcutsChange` 是**可选带默认值**的：不传＝改动被那个空函数吃掉，
   *    界面照旧、全绿，表现是「改完快捷键保存了，重启就没了」。
   * 2. `App` 那个 `settings` memo 的**依赖数组**：值带上 `shortcuts` 而依赖里漏掉它，
   *    memo 不重算，写盘的载荷就停在旧表上（既不报错、也不落盘，只是悄悄不变）。
   * 3. 新键要**当场**生效（分发器读的是重算后的表，不是启动时那一份）。
   *
   * 【载荷断言必须排在按新键导入之前】那一步会让 `lastSourcePath` 变，而它是 memo 的另一个
   * 依赖——排到后面的话，memo 会被它带着重算，第 2 件事就再也红不了了（实测：只留最后那句
   * 断言时，把 `shortcuts` 从依赖数组里删掉，全套用例仍然全绿）。
   */
  it('在设置里录一条新快捷键并保存：当场生效，也真的写回设置', async () => {
    installApi(makeNovel())
    setPlatformWin32()
    render(<App />)
    await act(async () => {})
    openSettings()

    const box = screen.getByTestId('shortcut-import-input')
    fireEvent.click(box)
    // 在**录制框自己**上派发：录制归它那个 `onKeyDown` 管（分发器这时是哑的，见上一条用例）
    fireEvent.keyDown(box, { code: 'KeyJ', ctrlKey: true })
    expect(box.textContent).toBe('Ctrl+J')
    fireEvent.click(screen.getByTestId('settings-save'))
    fireEvent.click(screen.getByTestId('settings-close'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    const saveSettings = window.api.saveSettings as unknown as { mock: { calls: AppSettings[][] } }
    await waitFor(() => expect(saveSettings.mock.calls.length).toBeGreaterThan(0))
    const last = saveSettings.mock.calls[saveSettings.mock.calls.length - 1][0]
    expect(last.shortcuts).toEqual({ import: 'Ctrl+KeyJ' })

    // 新键当场生效（旧的那条 Ctrl+O 此后不该再有反应——上面那条用例已经钉了反向的一半）
    fireEvent.keyDown(window, { code: 'KeyJ', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('page-text')).toBeTruthy())
  })
})

function makeWorkDoc(): Novel {
  // 【正文刻意长过 CHARS_PER_SHEET（1330）】短于它的话，「铺满 100%」会被 revealTo 夹到
  // 全文长度——「铺满了一页」这句话在夹具上退化成「恰好一篇」，下面那些
  // FILL_CHARS / FILL_CHARS + 10 的断言就全都测不出东西了。
  const body = Array.from(
    { length: 60 },
    (_, i) => `${i + 1}. 本季度把导入管线与老板键做完了，细节见周报附件。`
  ).join('\n')
  const { flatText, chapters } = splitChapters(`季度汇报\n${body}\n`, '季度汇报')
  return {
    title: '季度汇报',
    sourcePath: '/tmp/季度汇报.txt',
    encoding: 'UTF-8',
    hadBom: false,
    flatText,
    chapters
  }
}

/** 按一次老板键（macOS 默认是 ⌘⇧B） */
function pressBossKey(): void {
  fireEvent.keyDown(window, { code: 'KeyB', key: 'B', metaKey: true, shiftKey: true })
}

/**
 * 等启动流程把工作文档读进来。
 *
 * 【为什么不能只等 `page-empty`】那个元素在 boot 的**第二个** await（`loadWorkDoc`）之前
 * 就已经渲染出来了，等它等于没等——紧接着按老板键会撞上「工作文档还没进内存」，用例收到的
 * 是一条 toast 而不是切换。这个竞态在真机上不存在（人不会在启动那一瞬间按键）。
 */
async function waitForWorkDocLoaded(): Promise<void> {
  await waitFor(() => expect(loadWorkDocMock).toHaveBeenCalled())
  await act(async () => {})
}

describe('老板键', () => {
  it('没导入工作文档时只提示，不切换', async () => {
    installApi(makeNovel())
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain('还没导入工作文档'))
    // 阅读区照旧是小说
    expect(screen.getByTestId('doc-title').textContent).toBe('文档1')
  })

  it('没导入小说也能按老板键——它只要求工作文档在', async () => {
    const doc = makeWorkDoc()
    installApi(null, null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    await waitForWorkDocLoaded()

    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(screen.getByTestId('page-text')).toBeTruthy())

    const shown = screen.getByTestId('page-text').textContent ?? ''
    expect(shown.length).toBe(FILL_CHARS)
    expect(doc.flatText.startsWith(shown)).toBe(true)
  })

  it('再按一次切回小说，且小说的进度原封不动', async () => {
    const novel = makeNovel()
    const doc = makeWorkDoc()
    installApi(novel, null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 在小说里打 1 个字 → 默认比例 10 → 10 字
    const capture = screen.getByTestId('input-capture')
    await act(async () => {
      fireEvent.input(capture, { target: { value: 'x' } })
    })
    await waitFor(() => expect(revealedChars()).toBe(10))

    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(revealedChars()).toBe(FILL_CHARS))

    await act(async () => {
      pressBossKey()
    })
    // 【这一条是「两份进度互不干扰」的判据】切回来必须还是那 10 个字——
    // 不是 0，也不是被工作文档的铺满量污染过的值
    await waitFor(() => expect(revealedChars()).toBe(10))
  })

  it('老板模式下打字抽的是工作文档', async () => {
    const doc = makeWorkDoc()
    installApi(makeNovel(), null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    await waitForWorkDocLoaded()

    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(revealedChars()).toBe(FILL_CHARS))

    const capture = screen.getByTestId('input-capture')
    await act(async () => {
      fireEvent.input(capture, { target: { value: 'x' } })
    })
    await waitFor(() => expect(revealedChars()).toBe(FILL_CHARS + 10))

    // 抽出来的一定是工作文档的正文，不是小说的
    const shown = screen.getByTestId('page-text').textContent ?? ''
    expect(doc.flatText.startsWith(shown)).toBe(true)
  })

  it('老板模式下关窗，落盘的是【小说】的进度而不是工作文档的', async () => {
    const novel = makeNovel()
    const doc = makeWorkDoc()
    installApi(novel, null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    await act(async () => {
      pressBossKey()
    })
    // 【必须真等到切过去】没切过去时 shownEngine 仍是小说那本，这条用例就白测了
    await waitFor(() => expect(revealedChars()).toBe(FILL_CHARS))

    const saveSession = window.api.saveSession as unknown as {
      mock: { calls: [PersistedSession][] }
    }
    const before = saveSession.mock.calls.length
    act(() => {
      window.dispatchEvent(new Event('beforeunload'))
    })
    // 【为什么取 before 那一条、而不是读 `saved`】600ms 那个防抖 effect 也会写小说那本；
    // 读 `saved` 的话它随后一落盘就把值覆盖回小说，于是变异照样通过。
    expect(saveSession.mock.calls.length).toBe(before + 1)
    expect(saveSession.mock.calls[before][0].sourcePath).toBe(novel.sourcePath)
  })

  it('铺满 +/-：到端点只提示，在端点内则当场重铺', async () => {
    const novel = makeNovel()
    const doc = makeWorkDoc()
    installApi(novel, null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(revealedChars()).toBe(FILL_CHARS))

    // 已经在 100%：按 + 是空转，只留一句提示，正文一个字都不动
    await act(async () => {
      fireEvent.keyDown(window, { code: 'ArrowUp', key: 'ArrowUp', metaKey: true, shiftKey: true })
    })
    expect(screen.getByTestId('toast').textContent).toContain('铺满已是 100%')
    expect(revealedChars()).toBe(FILL_CHARS)

    // 100% → 90%：钉的是「改设置的同时立刻重铺」（adjustBossFill 里那个 bossActive 分支）
    await act(async () => {
      fireEvent.keyDown(window, { code: 'ArrowDown', key: 'ArrowDown', metaKey: true, shiftKey: true })
    })
    await waitFor(() => expect(revealedChars()).toBe(fillCharsFor(90)))
  })

  it('设置里的「当前书」比例改的是【当前显示的那一份】', async () => {
    const novel = makeNovel()
    const doc = makeWorkDoc()
    installApi(novel, null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    await act(async () => {
      fireEvent.input(capture, { target: { value: 'x' } })
    })
    await waitFor(() => expect(revealedChars()).toBe(10)) // 小说的比例是 10

    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(revealedChars()).toBe(FILL_CHARS))

    // 在老板模式里把比例改成 30（Enter 走的就是保存那条 `handleSave()`，与本文件里
    // 「改比例后同样的击键抽出更多字」用的是同一个交互）
    openSettings()
    const ratioInput = screen.getByTestId('ratio-input')
    fireEvent.change(ratioInput, { target: { value: '30' } })
    fireEvent.keyDown(ratioInput, { key: 'Enter' })
    fireEvent.click(screen.getByTestId('settings-close'))

    // 【判据落在打字上，不落在状态栏上】Task 7 之后老板模式下状态栏那格会被藏起来，
    // 而「一次击键抽多少」是同一件事的、且不随界面口径变化的观测点。
    await act(async () => {
      fireEvent.input(screen.getByTestId('input-capture'), { target: { value: 'x' } })
    })
    await waitFor(() => expect(revealedChars()).toBe(FILL_CHARS + 30))

    // 【这一半才是「回归」的判据】切回小说再打一次：小说的比例必须还是 10（10 → 20），
    // 若 setter 改错了对象，小说已经被设成 30，这里会是 40。
    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(revealedChars()).toBe(10))
    await act(async () => {
      fireEvent.input(screen.getByTestId('input-capture'), { target: { value: 'x' } })
    })
    await waitFor(() => expect(revealedChars()).toBe(20))
  })

  it('工作文档的起始比例取自【全局】比例，不是写死的 10', async () => {
    const doc = makeWorkDoc()
    // 没有小说：这一条只关心工作文档那台引擎的初值从哪来
    installApi(null, null, { ...defaultSettings(), ratio: 3, workDocPath: doc.sourcePath }, doc)
    render(<App />)
    await waitForWorkDocLoaded()

    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(revealedChars()).toBe(FILL_CHARS))

    await act(async () => {
      fireEvent.input(screen.getByTestId('input-capture'), { target: { value: 'x' } })
    })
    // 【为什么这一条分辨得出来】现有夹具的比例都是默认的 10，写死 `10` 与读全局值在它们
    // 身上同形。全局设成 3 之后，「打一个是 +3」才把两者分开。
    await waitFor(() => expect(revealedChars()).toBe(FILL_CHARS + 3))
  })

  it('老板模式下按 ⌘O 打开一本小说，会回到小说那一份', async () => {
    const novel = makeNovel()
    const doc = makeWorkDoc()
    installApi(novel, null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    await waitForWorkDocLoaded()

    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(revealedChars()).toBe(FILL_CHARS))

    importViaSettings()
    // 【判据】`openNovel` 里那句 `setBossMode(false)` 是「⌘O 回到小说」的唯一原因：
    // 少了它，这里仍是老板模式，值会是 FILL_CHARS 而不是 0。
    await waitFor(() => expect(revealedChars()).toBe(0))
    // 前提自检：屏幕上确实是**小说**那一份（它有两章，工作文档只有一章）——少了这一句，
    // 「小说压根没打开」也会让上面那条断言为 0 而假绿。
    expect(screen.getByTestId('chapter-item-1')).toBeTruthy()
  })

  it('配了路径但读不出来时，按老板键给的是【读不出来】那句提示', async () => {
    // 路径配上了、`loadWorkDoc` 却读不出来（文件被移走/删掉）——与「压根没配」那句提示不同
    installApi(makeNovel(), null, { ...defaultSettings(), workDocPath: '/tmp/绝对不存在.txt' }, null)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await waitForWorkDocLoaded()

    await act(async () => {
      pressBossKey()
    })
    await waitFor(() =>
      expect(screen.getByTestId('toast').textContent).toContain('工作文档读不出来了')
    )
  })

  it('老板模式下：标题条换成工作文档名、章节栏收起、状态栏少三格', async () => {
    const doc = makeWorkDoc()
    installApi(makeNovel(), null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    await waitForWorkDocLoaded()
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(screen.getByTestId('doc-title').textContent).toBe('季度汇报'))

    // 章节栏收起：`ChapterList` 收起时渲染的是那条 rail 按钮，不是 aside
    expect(screen.queryByTestId('chapter-item-0')).toBeNull()
    expect(screen.getByTestId('sidebar-toggle').getAttribute('aria-expanded')).toBe('false')

    // 状态栏三格消失
    expect(screen.queryByTestId('status-ratio')).toBeNull()
    expect(screen.queryByTestId('status-encoding')).toBeNull()
    expect(screen.queryByTestId('status-mode')).toBeNull()

    // 切回来全部复原
    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(screen.getByTestId('doc-title').textContent).toBe('文档1'))
    expect(screen.getByTestId('chapter-item-0')).toBeTruthy()
    expect(screen.getByTestId('status-ratio')).toBeTruthy()
  })

  it('设置里的文档名字段不被老板模式带偏', async () => {
    // Ribbon 现在把同一个 docTitle 既用于标题条又转手给 SettingsDialog，
    // 只覆盖前者的话，设置里那个输入框会跟着变成工作文档名
    const doc = makeWorkDoc()
    installApi(makeNovel(), null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    await waitForWorkDocLoaded()
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(screen.getByTestId('doc-title').textContent).toBe('季度汇报'))

    openSettings()
    const input = screen.getByTestId('doc-title-input') as HTMLInputElement
    expect(input.value).toBe('文档1')
  })

  it('老板模式下只配了工作文档、没开小说时，「当前书」比例框仍然可用', async () => {
    const doc = makeWorkDoc()
    installApi(null, null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    await waitForWorkDocLoaded()

    await act(async () => {
      pressBossKey()
    })
    await waitFor(() => expect(revealedChars()).toBe(FILL_CHARS))

    openSettings()
    // 【这条钉的是 novelOpen】Task 7 把它改成 shownNovel !== null。屏幕上摊着的是工作
    // 文档，所以那个框不该被禁用——改回 `novel !== null` 的话这里会红。
    expect((screen.getByTestId('ratio-input') as HTMLInputElement).disabled).toBe(false)
    expect(screen.queryByText('未打开文档')).toBeNull()
  })

  /**
   * 【老板模式下两条折叠入口都失效，却仍会**写**偏好】
   *
   * `collapsed={sidebarCollapsed || bossActive}` 只是把「收起」强制覆盖掉，它拦不住
   * `onCollapsedChange` 与 `toggle-sidebar` 那两条写入路径。症状是**退出老板模式那一刻**
   * 侧栏反着用户的意展开——而两条路径在老板模式下屏幕上都没有任何反馈，所以没有任何
   * 界面迹象能提示「刚才那一下记下来了」。
   *
   * 两条都要挡：只挡一条的话，两个入口会变成「一个写、一个不写」——那是比全写更难查的形态。
   */
  it('老板模式下两条折叠路径都不写偏好，退出后侧栏仍是收起的', async () => {
    const novel = makeNovel()
    const doc = makeWorkDoc()
    installApi(novel, null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-list')).toBeTruthy())

    const enterBoss = async (): Promise<void> => {
      await act(async () => {
        pressBossKey()
      })
      await waitFor(() => expect(screen.getByTestId('doc-title').textContent).toBe('季度汇报'))
    }
    const exitBoss = async (): Promise<void> => {
      await act(async () => {
        pressBossKey()
      })
      await waitFor(() => expect(screen.getByTestId('doc-title').textContent).toBe('文档1'))
    }

    // 前提自检：正常模式下这个按钮真的能把侧栏收起来。少了它，下面两段在「侧栏压根收
    // 不起来」的世界里照样绿（那时 chapter-list 本来就一直是 null）。
    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    expect(screen.queryByTestId('chapter-list')).toBeNull()

    // 路径一：⌘⇧H。老板模式下 `collapsed` 是强制覆盖的，这个动作屏幕上没有反馈。
    await enterBoss()
    fireEvent.keyDown(window, { code: 'KeyH', key: 'H', metaKey: true, shiftKey: true })
    await exitBoss()
    expect(screen.queryByTestId('chapter-list')).toBeNull()

    // 路径二：细缝里那个 rail 按钮——老板模式下 `sidebar-toggle` 正是它
    // （`ChapterList` 收起时渲染的是 rail，不是 aside 里那个）。
    await enterBoss()
    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    await exitBoss()
    expect(screen.queryByTestId('chapter-list')).toBeNull()
  })
})

describe('设置里的工作文档', () => {
  /**
   * 【这条走的是启动时那一行 `setWorkDocBroken(true)`，组件层那条够不到它】
   *
   * `settings.test.tsx` 里那条同义用例直接把 `workDocBroken={true}` 传进壳，守的是组件层；
   * 而「启动时读不出来 → 那个 prop 真的被置位」这一段在本次改动之前**一条断言都没有**——
   * 实测：把 App 里那句 `setWorkDocBroken(true)` 改成 `false`，全套用例照样全绿。
   */
  it('配了路径但读不出来：那行说的是「读不出来」，而不是「未导入」', async () => {
    installApi(null, null, { ...defaultSettings(), workDocPath: '/tmp/绝对不存在.txt' }, null)
    render(<App />)
    await waitForWorkDocLoaded()

    openSettings()
    const status = screen.getByTestId('work-doc-status')
    expect(status.textContent).toContain('读不出来')
    // 前提自检：那一行不是碰巧两种文案都带——没坏的话它就是「未导入」
    expect(status.textContent).not.toContain('未导入')
  })

  /**
   * 【这条补的是「用户能把一份工作文档导进来」这条核心路径——它此前**零覆盖**】
   *
   * 实测：删掉 `handleImportWorkDoc` 里那句 `setWorkDocPath(doc.sourcePath)`，或把
   * `handleRemoveWorkDoc` 掏到只剩 `setBossMode(false) + notify`，**400 条全绿**。
   * 而丢了路径写入的后果是静默的：工作文档每次启动都被忘掉。
   *
   * 【两个空转来源，都盯着】① 设置是 600ms 防抖落盘的，同步读 `saveSettings` 只会读到
   * 上一发；所以要 `waitFor` 等它真落盘。② 读**最后一次**调用——早先那几发是别的路径
   * （导入小说、启动读盘）触发的，拿它们断言等于什么都没测。
   */
  it('点「导入工作文档」会把路径写进落盘的设置，点「移除」会把它清掉', async () => {
    const doc = makeWorkDoc()
    installApi(makeNovel(), null, defaultSettings(), doc)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const saveSettings = window.api.saveSettings as unknown as {
      mock: { calls: [AppSettings][] }
    }

    // 前提自检：此刻设置里的路径确实是空的——否则下面那条「写进去了」可能只是启动读盘
    // 带出来的，与这次点击无关。
    expect(saveSettings.mock.calls.at(-1)?.[0].workDocPath ?? null).toBeNull()

    // 【openSettings 必须留在 act 外面】testing-library 把 React 的 flush 推到 act 结束，
    // 与它同一个 act 里的 `getByTestId('btn-import-work-doc')` 会撞上「对话框还没挂载」。
    openSettings()
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-import-work-doc'))
    })
    await waitFor(() =>
      expect(saveSettings.mock.calls.at(-1)?.[0].workDocPath).toBe(doc.sourcePath)
    )

    // 「移除」按钮 gate 在 `workDocTitle !== null` 上，导入成功之后它才出现——顺序不能反
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-remove-work-doc'))
    })
    await waitFor(() => expect(saveSettings.mock.calls.at(-1)?.[0].workDocPath).toBeNull())
  })

  /**
   * 【设计 §9 承诺过「导入空文件 → 当场拒绝 + toast，设置不变」】
   *
   * 修之前这条规则**零覆盖**，而且做不到「出声」：`main` 侧那句 `flatText.length === 0 ? null`
   * 让「空文件被拒」与「对话框取消」在渲染层是同一个 `null`，`if (!doc) return` 只能沉默——
   * 用户选了个空 txt，屏幕上什么都不发生。
   */
  it('导入一个空文件：给一条 toast 并且什么都不改（不建引擎、不写路径）', async () => {
    // 空文本的 Novel：`importWorkDoc` 桩返回它，其余一切照常
    const empty: Novel = {
      title: '空的',
      sourcePath: '/tmp/空的.txt',
      encoding: 'UTF-8',
      hadBom: false,
      flatText: '',
      chapters: []
    }
    installApi(makeNovel(), null, defaultSettings(), empty)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const saveSettings = window.api.saveSettings as unknown as {
      mock: { calls: [AppSettings][] }
    }

    openSettings()
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-import-work-doc'))
    })

    // 出声了
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain('空的'))
    // 【「设置不变」这一半】路径没被写进去。读最后一次载荷——早先那几发是启动读盘/导入
    // 小说触发的，拿它们断言等于什么都没测。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(saveSettings.mock.calls.at(-1)?.[0].workDocPath ?? null).toBeNull()
    // 而且没有建出那一份：状态行仍是「未导入」，也就没有「移除」按钮
    expect(screen.getByTestId('work-doc-status').textContent).toContain('未导入')
    expect(screen.queryByTestId('btn-remove-work-doc')).toBeNull()
  })
})
