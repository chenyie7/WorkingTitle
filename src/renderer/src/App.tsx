import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clampBossFillPercent, fillCharsFor, stepBossFill } from '../../core/bossKey'
import { TypingEngine } from '../../core/engine'
import { formatShortcut, platformKind, resolveShortcuts } from '../../core/shortcuts'
import { DEFAULT_CHAPTER_RULE, clampPageFontSize } from '../../core/types'
import type { ChapterRule, InputMode, LibraryEntry, Novel } from '../../core/types'
import type { IpcResult } from '../../core/api'
import { ChapterList } from './components/ChapterList'
import { Page } from './components/Page'
import type { MarkdownSource } from './components/Page'
import { Ribbon } from './components/Ribbon'
import { StatusBar } from './components/StatusBar'
import { Toast } from './components/Toast'
import { InputCapture } from './input/InputCapture'
import { useAppSettings } from './state/settingsStore'
import { useBossFill } from './state/useBossFill'
import { useShortcutDispatcher } from './state/shortcuts'
import { useDarkPaper, usePageFontSize, useSystemTheme, useThemePreference } from './state/theme'
import { TOAST_MS, ToolbarProvider } from './state/ToolbarContext'
import { clearMarkdownImageCache } from './markdown/MarkdownImage'
import { isMarkdownPath, parseMarkdown } from './markdown/parse'
import { useTypingEngine } from './state/useTypingEngine'
import { getApi } from './api'
import type { ThemeSource } from '../../core/types'

const SAVE_DEBOUNCE_MS = 600
/** 光标与画布上下沿之间保留的空隙：.wt-canvas 上下各有 padding，贴着边等于贴到灰底上 */
const CARET_MARGIN = 24

export default function App() {
  const [novel, setNovel] = useState<Novel | null>(null)
  const [engine, setEngine] = useState<TypingEngine | null>(null)
  const [chapterRule, setChapterRule] = useState<ChapterRule>(DEFAULT_CHAPTER_RULE)
  const chapterRuleRef = useRef<ChapterRule>(DEFAULT_CHAPTER_RULE)
  chapterRuleRef.current = chapterRule
  /**
   * **工作文档**：第二本 Novel，与小说并行存在。
   *
   * 【为什么是第二本 Novel 而不是另一个概念】引擎本来就是「一份内容 + 一个游标」，所以
   * 「老板模式下打字照样抽字」「两份进度互不干扰」全部是免费的——不需要为它们写任何逻辑。
   * 代价是它进不了 docx 的保真版式（表格图片塞不进 flatText），那个取舍见设计文档第 3 节。
   */
  const [workNovel, setWorkNovel] = useState<Novel | null>(null)
  const [workEngine, setWorkEngine] = useState<TypingEngine | null>(null)
  /** 显示哪一份。**纯内存、不落盘**——启动永远显示小说，崩了重启不该自动进老板模式。 */
  const [bossMode, setBossMode] = useState(false)
  /** 配了路径、但读不出来（文件被移走/删掉/读不出）。设置里据此标红。 */
  const [workDocBroken, setWorkDocBroken] = useState(false)
  const [expanded, setExpanded] = useState(false)
  /**
   * 整条左栏（书名信息 + 章节列表）是否收起。
   *
   * 【为什么从 `ChapterList` 提上来】收起/展开的快捷键归**全局分发器**，而分发器长在本层
   * （见下面 `useShortcutDispatcher` 那次调用）——它碰不到组件内部的 state。所以这个状态
   * 与 `settingsOpen` 是同一条路：状态归 `App`，组件收成受控的。
   */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  /** 设置对话框开不开。状态归本层，因为分发器也长在本层。 */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 设置对话框正在录制键位；期间分发器必须静音，否则录 ⌘O 会当场触发真导入。 */
  const [recording, setRecording] = useState(false)
  /** toast 的当前内容。老板键的提示从本层的分发器里弹。 */
  const [toast, setToast] = useState<string | null>(null)
  /** 设置是否已经从磁盘读回。少了这道闸，首帧会拿默认值把磁盘上的设置冲掉。 */
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  /**
   * 设置的唯一来源：全部字段在同一个对象里，改动一律走 `patchSettings`。
   * 拆成九个 useState 时，boot、写盘载荷、依赖数组各要同步一遍，漏一处只静默失效。
   */
  const { settings, patchSettings, replaceSettings } = useAppSettings()
  const {
    docTitle,
    darkPaper,
    themeSource,
    workDocPath,
    bossFillPercent,
    pageFontSize,
    shortcuts
  } = settings

  // 图片缓存按原始相对地址做键；换工作文档后解析基准变了，不清会串图。
  useEffect(() => {
    clearMarkdownImageCache()
  }, [workNovel])

  useSystemTheme()
  useDarkPaper(darkPaper)
  useThemePreference(themeSource)
  // 正文字号走 CSS 变量（`page.css` 的 `.wt-page__novel` 读它）。
  usePageFontSize(pageFontSize)
  /** **持久化专用**的引擎引用：永远指向小说那一本，与「当前显示的那份」拆开。 */
  const novelEngineRef = useRef<TypingEngine | null>(null)
  const canvasRef = useRef<HTMLElement | null>(null)
  novelEngineRef.current = engine

  /**
   * 最新设置的同步镜像，给 `useCallback` 与事件回调读。
   * 直接闭包 `settings` 会永久停在首次渲染那份；每个字段各挂一个 ref 则是同一事实的多份副本。
   */
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const settingsLoadedRef = useRef(false)
  settingsLoadedRef.current = settingsLoaded

  /** 见 openNovel 里那段说明：只用来丢弃过期的打开结果 */
  const openSeqRef = useRef(0)

  /** 弹一条自动消失的提示。时长共用 `TOAST_MS`（与 provider 内部那份同一个常量）。 */
  const notify = useCallback((message: string): void => {
    setToast(message)
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current))
    }, TOAST_MS)
  }, [])

  /**
   * 当前**显示**的那一份。渲染树里凡是跟着「显示了什么内容」走的地方都读这两个变量。
   *
   * 【为什么多一个 `bossActive` 而不是直接用 `bossMode`】它把「想切过去」与「切得过去」
   * 分开，防的是「`bossMode` 为真、工作文档却是 null」——那时页面会变成一片空白。
   *
   * 【当下它每一帧都与 `bossMode` 相等，这是**防御性**的】两条能置空 `workNovel` 的路
   * （`handleRemoveWorkDoc`、boot 里读不出来时的那次赋值）都与 `setBossMode(false)` 在
   * 同一次批处理里，中间没有「`bossMode` 真而 `workNovel` 空」的渲染帧。实测两个 setter
   * 一起提交的结果是 `[false, false, false]`。留着它是因为这类「两个状态各改各的」将来
   * 很容易真的分叉——分叉的表现是整页空白，不值得等它发生再修。
   */
  const bossActive = bossMode && workNovel !== null && workEngine !== null
  const shownNovel = bossActive ? workNovel : novel
  const shownEngine = bossActive ? workEngine : engine

  const state = useTypingEngine(shownEngine)

  /**
   * 【解析只做一次，缓存在这里】`useMemo` 的键是 `shownNovel` 这个对象：
   * 它只在「换书 / 切老板模式 / 重新导入」时换身份，按键时不换。
   * 200KB 的 md 解析是几十毫秒量级，每次按键重解析不可接受。
   *
   * 【判定按扩展名，只在工作文档这一路生效】小说的导入过滤器只收 txt，
   * 但「所有文件」那个入口能让人选到 .md——那种情况下这里的判定也会为真，
   * 而它与「工作文档」是同一套渲染，行为一致，不是漏洞。
   *
   * 【解析失败（null）就退回纯文本】`mdDoc` 为 null 时下面那个 `mdSource` 也是 null，
   * `Page` 走纯文本那条路（设计第 12 节：不许白屏）。
   */
  const mdDoc = useMemo(() => {
    if (!shownNovel || !isMarkdownPath(shownNovel.sourcePath)) return null
    return parseMarkdown(shownNovel.flatText)
  }, [shownNovel])

  /** 铺满铺的是工作文档，所以判的是它、不是当前显示的那份。 */
  const workIsMarkdown = workNovel !== null && isMarkdownPath(workNovel.sourcePath)

  const { measuring, onMeasureNode, applyFill, invalidateHeights } = useBossFill({
    workNovel,
    workEngine,
    workIsMarkdown,
    pageFontSize
  })

  const mdSource: MarkdownSource | null =
    mdDoc && state
      ? {
          doc: mdDoc,
          revealStart: state.revealStart,
          cursor: state.cursor,
          measuring,
          onMeasureNode
        }
      : null

  /** 把当前这本的进度立刻落盘（不等防抖）。换书前与关窗前各用一次。 */
  const flushSession = useCallback((): void => {
    const api = getApi()
    const current = novelEngineRef.current
    if (!api || !current) return
    // 这里没有界面可提示（关窗路径），至少让失败留下痕迹而不是被 void 吞掉。
    void api.saveSession({ ...current.toSession(), chapterRule: chapterRuleRef.current }).then((r) => {
      if (!r.ok) console.warn('[wt] 保存阅读进度失败：', r.reason)
    })
  }, [])

  /**
   * 打开一本书：**先问磁盘上有没有这本书的进度**，有就接着读，没有才从零开始。
   *
   * 【为什么必须在这里问】「导入小说」走的就是这个函数，启动恢复也走它。少了这次读盘，
   * 导入一本读过的书＝全新引擎＝600ms 后把 cursor 0 落盘覆盖掉那本书的进度——而「每本书
   * 各留一份进度」存在的全部意义就是这一条。判断只有这一处，调用方不必各自判一遍。
   */
  const openNovel = useCallback(
    async (next: Novel): Promise<void> => {
      // 递增序号，用来丢掉过期的那一次：读盘是异步的，用户连续导入两本时，先发起、后返回的
      // 那一次会把后打开的书顶掉。
      const seq = ++openSeqRef.current
      const api = getApi()
      const session = api ? await api.loadSession(next.sourcePath) : null
      if (seq !== openSeqRef.current) return

      // 换书之前先把上一本存一次：下面那个保存 effect 的 cleanup 会 clearTimeout 掉待发的
      // 定时器，而换书会让 engine 变——600ms 之内连开两本时，上一本那一次就永远不落盘了。
      //
      // 【放在提交点之前、而不是函数开头】开头到这里隔着一个 await：那期间落在旧引擎上的击键
      // 会重排防抖定时器、随后被 cleanup 清掉，开头那次 flush 并没有覆盖到它。放在这里，
      // `novelEngineRef.current` 仍是上一本（还没人 setEngine），上面这句话才是字面为真的。
      flushSession()

      // 「打开一本小说」就是「你要看小说」——老板模式下按 ⌘O 也照此办理
      setBossMode(false)
      setNovel(next)
      setChapterRule(session?.chapterRule ?? DEFAULT_CHAPTER_RULE)
      // 目录被重切过（切章算法升级）时旧 chapterPos 与新的章节数对不上，按光标重算一遍。
      const restored =
        session && session.chapterPos.length !== next.chapters.length
          ? {
              ...session,
              chapterPos: next.chapters.map((c) =>
                Math.max(0, Math.min(session.cursor - c.start, c.charCount))
              )
            }
          : session
      // 有记录就接着用它自己的比例；没有记录才拿**全局**值当起点（这就是全局比例的全部作用）。
      // 读 ref 而不是闭包里的 `globalRatio`，理由见 `globalRatioRef` 那段说明。
      setEngine(
        restored
          ? TypingEngine.fromSession(next, restored)
          : new TypingEngine(next, { ratio: settingsRef.current.ratio })
      )
      setExpanded(false)
      patchSettings({ lastSourcePath: next.sourcePath })
    },
    [flushSession, patchSettings]
  )

  const handleImport = useCallback(async () => {
    const api = getApi()
    if (!api) return
    const result = await api.importNovel()
    if (!result.ok) {
      if (result.reason !== 'canceled') notify(`导入失败：${result.reason}`)
      return
    }
    const { novel, status } = result.value
    if (status === 'already-imported') notify('这本书已经导入过了')
    else if (status === 'repaired') notify('这本书已经在书库里，拷贝文件已修复')
    await openNovel(novel)
  }, [openNovel, notify])

  const handleOpenNovel = useCallback(
    async (sourcePath: string): Promise<boolean> => {
      const api = getApi()
      if (!api) return false
      const result = await api.openNovelPath(sourcePath)
      if (!result.ok) {
        notify(`打开失败：${result.reason}`)
        return false
      }
      await openNovel(result.value)
      return true
    },
    [notify, openNovel]
  )

  const handleDeleteNovel = useCallback(
    async (entry: LibraryEntry): Promise<IpcResult<void>> => {
      const api = getApi()
      if (!api) return { ok: false, reason: '应用接口不可用' }
      // 删当前书时先把状态清空，否则待发的防抖写会在删除之后把会话写回来。
      if (novel?.sourcePath === entry.sourcePath) {
        openSeqRef.current++
        setNovel(null)
        setEngine(null)
        setChapterRule(DEFAULT_CHAPTER_RULE)
        patchSettings({ lastSourcePath: null })
      }
      return api.deleteNovel(entry.id)
    },
    [novel, patchSettings]
  )

  const handleClearSession = useCallback(async () => {
    const api = getApi()
    const currentNovel = novel
    const currentEngine = engine
    if (!api || !currentNovel || !currentEngine) {
      notify('还没有打开小说')
      return
    }

    const snap = currentEngine.toSession()
    const fresh = TypingEngine.fromSession(currentNovel, {
      ...snap,
      cursor: 0,
      revealStart: 0,
      chapterPos: currentNovel.chapters.map(() => 0),
      activeChapter: 0,
      startedAt: null
    })
    setEngine(fresh)
    setExpanded(false)

    // 不删会话文件：删了分章规则会跟着丢。立刻写回零进度才是「清了位置、留下偏好」。
    const result = await api.saveSession({
      ...fresh.toSession(),
      chapterRule: chapterRuleRef.current
    })
    if (!result.ok) notify(`清除阅读记录失败：${result.reason}`)
  }, [engine, novel, notify])

  const handleApplyChapterRule = useCallback(
    async (rule: ChapterRule): Promise<IpcResult<number>> => {
      const api = getApi()
      const currentNovel = novel
      const currentEngine = engine
      if (!api || !currentNovel || !currentEngine) {
        return { ok: false, reason: '还没有导入小说' }
      }

      const result = await api.resplitNovel(currentNovel.sourcePath, rule)
      if (!result.ok) return result
      // 等待期间换了书：这次结果不能套到新书上（章节目录与书对不上）。
      if (novelEngineRef.current !== currentEngine) {
        return { ok: false, reason: '书已更换，本次分章未应用' }
      }

      const chapters = result.value
      const snap = currentEngine.toSession()
      // 光标之前的章算读完、当前章按比例、之后为 0——只由光标一条线决定。
      const chapterPos = chapters.map((c) =>
        Math.max(0, Math.min(snap.cursor - c.start, c.charCount))
      )
      const nextNovel: Novel = { ...currentNovel, chapters }
      const nextEngine = TypingEngine.fromSession(nextNovel, {
        ...snap,
        chapterPos,
        activeChapter: 0,
        chapterRule: rule
      })

      setNovel(nextNovel)
      setEngine(nextEngine)
      setChapterRule(rule)
      chapterRuleRef.current = rule

      // 立即写一次：防抖 effect 也会写，但关窗/换书可能正好落在 600ms 窗口里。
      const savedSession = await api.saveSession({
        ...nextEngine.toSession(),
        chapterRule: rule
      })
      if (!savedSession.ok) notify(`保存分章规则失败：${savedSession.reason}`)
      return { ok: true, value: chapters.length }
    },
    [novel, engine, notify]
  )

  /**
   * 导入工作文档。**与「导入小说」同类：立即动作，不走「草稿 + 保存」。**
   *
   * 【为什么同时 setBossMode(false)】它挡的是「**在老板模式开着的时候**导入一份新文档」：
   * 没有这一行，`bossActive` 会立刻变真、界面自己跳到刚导入的那份上。导入这个动作本身
   * 不该改变你正在看什么。
   *
   * 【别写成「启动时读不出来，bossMode 还留着上次的值」】那句是假的——`bossMode` 是纯渲染层
   * 的 `useState(false)`，既不进 `AppSettings`、boot 也不恢复它，启动时恒为 false。
   */
  const handleImportWorkDoc = useCallback(async (): Promise<void> => {
    const api = getApi()
    if (!api) return
    const result = await api.importWorkDoc()
    // 'canceled' ＝ 用户在文件对话框里取消了，静默返回（这不是错误，不该弹东西）
    if (!result.ok) {
      if (result.reason !== 'canceled') notify(result.reason)
      return
    }
    const doc = result.value
    /**
     * **空文件在这里出声并拒绝**（设计 §9：「当场拒绝 + toast，设置不变」）。
     *
     * 【为什么判断在渲染层、而不是让 IPC 返回 null】`main` 侧那条 `loadWorkDoc` **刻意不判空**
     * ——它要是判了，这里拿到的 null 与「取消」就是同一个值，只能沉默，用户选了个空 txt
     * 屏幕上什么都不会发生（这正是修之前的行为）。
     *
     * 【与 main 侧那处判空不是重复】boot 那条路（`wt:load-work-doc`）**判**：启动时读到空文档
     * 当「读不出来」，标红、按老板键给说明。两条路的策略不同是有意的，别顺手合并掉一处。
     */
    if (doc.flatText.length === 0) {
      notify('这个文件是空的，换一个')
      return
    }
    // 块高表真正的失效判据是身份（换文档就命中不了），这里只是别捏着上一份数组不放。
    invalidateHeights()
    setWorkNovel(doc)
    setWorkEngine(new TypingEngine(doc, { ratio: settingsRef.current.ratio }))
    // 路径就在 Novel 里，不必让 IPC 多返回一个值
    patchSettings({ workDocPath: doc.sourcePath })
    setWorkDocBroken(false)
    setBossMode(false)
    notify('已导入工作文档')
  }, [notify, patchSettings, invalidateHeights])

  const handleRemoveWorkDoc = useCallback((): void => {
    invalidateHeights()
    setWorkNovel(null)
    setWorkEngine(null)
    patchSettings({ workDocPath: null })
    setWorkDocBroken(false)
    setBossMode(false)
    notify('已移除工作文档')
  }, [notify, patchSettings, invalidateHeights])

  /**
   * 老板键：切到工作文档 / 切回小说。
   *
   * 【进入时为什么必须重铺】工作文档不持久化进度（设计文档第 5 节）。持久化的话，老板在你
   * 旁边站久了会把它抽到末尾，**下次一进来打字就不出字**——比什么都不做更露馅；而且
   * 「铺满量」那个旋钮会被进度盖住，调了没反应。
   */
  const toggleBoss = useCallback((): void => {
    if (!workNovel || !workEngine) {
      notify(
        workDocPath
          ? '工作文档读不出来了，请在设置里重新导入'
          : '还没导入工作文档（文件 → 设置 → 导入工作文档）'
      )
      return
    }
    const next = !bossMode
    if (next) applyFill(settingsRef.current.bossFillPercent)
    /**
     * 「展开前文」是阅读区那一侧的窗口状态，**进出两个方向都清掉**。
     *
     * 【进入时】不清的话工作文档一进来就是一张长纸（小说那边点开的「展开前文」被带了过来）。
     * 【出去时】同理：`expanded` 是一个共享值，而老板模式下它基本不会被改动——那条折叠条要
     * `visibleText` 超过 `RENDER_WINDOW_LIMIT`（30000 字）才渲染，而铺满 100% 也才
     * `CHARS_PER_SHEET`（1330）字；要在老板模式里把它顶到 30000 得再敲约三千下。所以退出时
     * 它多半还停在**进老板模式之前**那个值上，带着它回去等于把用户刚离开的阅读位置又翻出来
     * 一次，方向反了。
     *
     * 两个方向共用这一句是刻意的：谁都不该继承对面那一侧的展开态。所以它写在 `if (next)`
     * 之外——**别把它挪进去**。
     */
    setExpanded(false)
    setBossMode(next)
  }, [workNovel, workEngine, bossMode, workDocPath, notify, applyFill])

  /** 老板键铺满 +/-：改设置；正在老板模式时**立刻重铺**，让用户当场看到效果。 */
  const adjustBossFill = useCallback(
    (dir: 1 | -1): void => {
      const next = stepBossFill(settingsRef.current.bossFillPercent, dir)
      if (next === settingsRef.current.bossFillPercent) {
        notify(`铺满已是 ${next}%`)
        return
      }
      patchSettings({ bossFillPercent: next })
      // 这一处会**刻意**往回退（按 − 就是要少显示一点）。
      //
      // 【但「会往回退」不是这一处独有的】`toggleBoss` 那条路也会：在**非**老板模式下把铺满量
      // 调小（那时 bossActive 为假、只改设置不重铺），再按老板键切进去，光标就是从上次那个
      // 位置退到新值。别在别处依赖「它只会往前」。
      //
      // 【但它退不过 revealStart】`revealTo` 的下界是 `revealStart` 而不是 0（见 Task 2 的
      // 注释与用例）。工作文档这一路 `revealStart` 恒为 0——它的引擎由 `new TypingEngine`
      // 建出来、从不走 `fromSession`；而**唯一能改写 `revealStart` 的 `jumpToChapter` 只挂在
      // 章节栏上**。
      //
      // 【上一版里这条是可达的，是界面跟随把它关上的】Task 6 只做到「老板模式换引擎」，章节栏
      // 在老板模式下照旧展开、照旧点得到（传给它的 `novel` 就是工作文档，列表里是它的章）。
      // 那时在老板模式里跳一次章，`revealStart` 就抬起来了，这条「按 −」会静默停在那儿不再
      // 往下走。本任务用 `ChapterList` 的 `collapsed={sidebarCollapsed || bossActive}` 把它
      // 按住——老板模式下强制收起，`jumpToChapter` 在界面上再没有入口。
      // 危害本来也很小（旋钮少了一段行程），不值得为它加一层状态；记在这里是别让人把它当 bug 查。
      if (bossActive) applyFill(next)
      /**
       * 【md 那一路不能报字数】它按**渲染后的高度**铺，`fillCharsFor` 只是量不出高度时的
       * 兜底估算——报出来是个假数字（屏幕上根本不是那么多个字）。那种「看起来精确、
       * 其实错」的提示比不提示更糟，所以那一路只报档位。
       */
      notify(
        workIsMarkdown
          ? `铺满 ${next}%`
          : `铺满 ${next}% ≈ ${fillCharsFor(next, settingsRef.current.pageFontSize)} 字`
      )
    },
    [bossActive, applyFill, notify, workIsMarkdown, patchSettings]
  )

  // 启动：先把设置读回来，再打开命令行指定的书、否则打开上次那本
  useEffect(() => {
    const api = getApi()
    // 没有 api，就没有「设置」「命令行参数」「上次打开的书」这三件事可做——直接停在空状态。
    // 这【不是】多余的防御：少了它，下面第一个 await 会变成 unhandled rejection，
    // 用例行照旧报 passed、汇总行却是 `Errors 1 error`，vitest 的 exit code 是 1。
    if (!api) return

    let cancelled = false

    const boot = async (): Promise<void> => {
      // 设置先读：它同时给出「上次打开的是哪本」。命令行参数优先于它。
      const loaded = await api.loadSettings()
      if (cancelled) return
      // 值域夹紧归 core：settingsProblem 只判「是不是有限数字」，500 这种值会原样进状态、
      // 再照原样写回磁盘，而第一次按「铺满 −」会从 500 一步跳到 100。
      replaceSettings({
        ...loaded,
        bossFillPercent: clampBossFillPercent(loaded.bossFillPercent),
        pageFontSize: clampPageFontSize(loaded.pageFontSize)
      })
      setSettingsLoaded(true)

      // 工作文档：**启动时就读进来常驻内存**。老板键要的是零延迟——等按下去了才读盘，
      // 老板已经站在旁边了。读不出来时不弹打扰提示（那会在你早忘了这回事的时候吓你一下），
      // 只在设置里标红，以及按老板键时给一句说明。
      if (loaded.workDocPath) {
        const doc = await api.loadWorkDoc(loaded.workDocPath)
        if (cancelled) return
        if (doc) {
          setWorkNovel(doc)
          // 与「新导入一本书」同一条路：拿全局比例当初值。读刚读回来的那份而不是
          // `settingsRef`：后者要等这次 setSettings 的渲染提交，而这里隔着一次 await。
          setWorkEngine(new TypingEngine(doc, { ratio: loaded.ratio }))
        } else {
          // **路径刻意保留**：文件可能只是临时不在，下次启动也许就回来了
          setWorkDocBroken(true)
        }
      }

      // 【依次尝试，而不是只挑一个】命令行给的路径优先，**它打不开时回退到「上次打开的那本」**。
      // 这个回退原先是由两段式启动天然给的（第一段的 catch 刻意不 return，落到第二段），
      // 合并成一次之后必须显式写出来——否则「命令行指了一个打不开的文件」会直接落到空状态，
      // 而磁盘上明明有一本上次读的书。去重是为了两处指向同一个路径时不要试两遍。
      const initialPath = await api.initialNovelPath()
      const targets = [initialPath, loaded.lastSourcePath].filter(
        (p, i, arr): p is string => typeof p === 'string' && p !== '' && arr.indexOf(p) === i
      )

      for (const target of targets) {
        // 目标文件可能打不开（已删除、权限、EISDIR、解不出编码……）。没有这个 try 的话错误会
        // 以【未处理的 rejection】形式冒到启动期：空状态不显示、也没有任何提示。
        // 真机实测过（Task 12，chmod 000 的 txt 当命令行参数 + 同一个 userData 里留着上次
        // 会话）：无 unhandled rejection，且会话照常恢复到「已显示 300 字」——那正是上面
        // 这条回退在起作用。
        //
        // 【覆盖情况，别再写「零覆盖」了】`命令行给的路径打不开时，回退到上次打开的那本书`
        // 那条用例会走进这个 catch，但只走了「第一个目标失败、第二个成功」这一半；
        // **两个目标都失败、最终停在空状态**那条路仍然没有用例。后半句的前提是真实的：
        // 把整个 try/catch 删掉，渲染层用例仍是全绿。
        try {
          const loaded = await api.openNovelPath(target)
          if (cancelled) return
          // 这个目标打不开：试下一个
          if (!loaded.ok) continue
          // 「接着读还是从头」交给 openNovel 一个人判——它读的正是 sourcePath 名下那本书的进度
          await openNovel(loaded.value)
          return
        } catch {
          // 这个目标不可用，试下一个；都不可用就停在空状态，等用户重新导入
        }
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [openNovel, replaceSettings])

  // 菜单命令 → 渲染进程动作
  useEffect(() => {
    const api = getApi()
    if (!api) return
    const off = api.onMenuCommand((cmd) => {
      if (cmd === 'import-novel') void handleImport()
      else if (cmd === 'clear-session') void handleClearSession()
    })
    return off
  }, [handleImport, handleClearSession])

  /**
   * 宿主平台的原值（`window.api.platform`）。**决定 mac 上哪一条快捷键要留给原生菜单**，
   * 以及显示/补齐时按哪一套默认值走。
   *
   * 【为什么缺桥时按 `'other'` 而不是抛】`getApi()` 可能返回 null（见上面那段说明）。
   * 那时宁可让 Windows 的那套键在 macOS 上显示错，也不要因为一个读不到的字段把整棵树炸掉
   * ——`global.d.ts` 把 `api` 声明成必填，`tsc` 不会提醒这件事。
   */
  const platform = getApi()?.platform ?? 'other'
  const kind = platformKind(platform)
  /** 补齐过的完整表：分发器、以及各处「显示的键」都读它（缺条目＝该平台的默认值）。 */
  const shortcutTable = useMemo(() => resolveShortcuts(shortcuts, kind), [shortcuts, kind])

  /**
   * 全局快捷键分发器。
   *
   * 【为什么 `enabled` 要连录制态一起算】录制期间按下的组合键必须先被设置对话框拿走：
   * 不静音的话，用户在录制框里按下 ⌘O 的那一刻就会弹出文件选择框。
   *
   * 【`actions` 每次渲染都是新对象，这是有意的】分发器把它挂在 ref 上（见那个模块里的
   * 说明），所以这里不需要 `useMemo` 去稳身份；真要稳的话，依赖里那几个回调每一个都得
   * 跟着稳，反而更容易漏。
   *
   * 【`platform` 这个实参，**写死成非 darwin 的值才是单测查不出来的**】把范围说准，别写成
   * 「单测查不出来，只有真机能判」——那是假的：
   *
   * - 写死成 `'darwin'`：**三条 Windows 路径的用例当场红**（实测：`Windows 上 Ctrl+O 真的能
   *   导入` / `设置里改过的键生效` / `在设置里录一条新快捷键并保存`）。因为 `kind` 是另一条路
   *   算的（`platformKind(window.api.platform)`，仍然是对的），表照真实平台补齐，而分发器按
   *   `'darwin'` 把 `import` 跳过了——Ctrl+O 成了死键。
   * - 写死成 `'other'` / `'win32'`：**整套 jsdom 用例全绿**（实测）。渲染 `App` 的用例只有两份：
   *   `app.test.tsx`（桩显式设 win32、或压根没有 `platform` 字段而走 `'other'`）与
   *   `layout.test.tsx`（用的正是 `tests/setup.ts` 那个 `platform: 'darwin'` 的良性桩，但**它
   *   不按任何组合键、也不看格式化后的键位文本**，所以分辨不出）。
   *
   * 真机上的代价分两层：
   *
   * 1. `resolveShortcuts` 按错的那一套补齐默认值（macOS 上会把 ⌘ 显示成 Ctrl），而
   *    `RESERVED` 的 darwin 清单也跟着失效；
   * 2. 「一条快捷键只在一个地方执行」那条硬规则失效：分发器里「darwin 上 import 让给原生菜单」
   *    的跳过是按这个值判的，一旦它不是 darwin 就不再跳过。此时只要表里 `import` 那一条是个
   *    ⌘ 组合（用户在设置里录过一条就是），按下去菜单的 accelerator 与分发器会**各触发一次**。
   *    计划末尾真机验收清单里那条「macOS 上 ⌘O 只导入一次（不是两次）」就是它的判据。
   */
  useShortcutDispatcher({
    platform,
    table: shortcutTable,
    // 对话框开着时也静音：否则 ⌘⇧B 会在对话框后面切书，对话框里的比例还是旧值。
    enabled: !recording && !settingsOpen,
    actions: {
      import: () => void handleImport(),
      // 【老板模式下不写】收起在那边是**强制覆盖**的（见下面 ChapterList 的 `collapsed`），
      // 于是这一下屏幕上没有任何反馈；可它会改掉本次会话里的侧栏状态，退出老板模式那一刻
      // 突然生效——侧栏反着用户的意展开。没有反馈的写是最难查的一类。
      // （`sidebarCollapsed` 本身**不落盘**，所以这里说的是「这次会话的界面状态」，不是偏好。）
      'toggle-sidebar': () => {
        if (!bossActive) setSidebarCollapsed((v) => !v)
      },
      'open-settings': () => setSettingsOpen(true),
      'boss-key': toggleBoss,
      // 这两行只是闭包，它们自己**不读 ref**——读 `bossFillPercentRef` 的是 `adjustBossFill`
      // 内部（理由见那个 ref 声明处）。这里之所以每次渲染换新函数也没关系，是因为 actions
      // 每次渲染都是新对象、分发器把它整个挂在 ref 上。
      'boss-fill-up': () => adjustBossFill(1),
      'boss-fill-down': () => adjustBossFill(-1)
    }
  })

  // 会话持久化（防抖）
  useEffect(() => {
    const api = getApi()
    if (!engine || !api) return
    const timer = window.setTimeout(() => {
      void api.saveSession({ ...engine.toSession(), chapterRule: chapterRuleRef.current }).then((r) => {
        if (!r.ok) notify(`保存阅读进度失败：${r.reason}`)
      })
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [engine, state, notify])

  // 设置持久化（防抖）。与会话同一套节奏：600ms 内的连续改动只落盘一次。
  useEffect(() => {
    const api = getApi()
    // 读回来之前不写，见 settingsLoaded 的说明
    if (!api || !settingsLoaded) return
    const timer = window.setTimeout(() => {
      void api.saveSettings(settings).then((r) => {
        if (!r.ok) notify(`保存设置失败：${r.reason}`)
      })
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [settings, settingsLoaded, notify])

  // 关闭前强制落盘
  useEffect(() => {
    const api = getApi()
    if (!api) return
    const flush = (): void => {
      flushSession()
      // 设置也有防抖窗口：改完文档名立刻关窗（或退出）会落在窗口里，关窗前的最后一次补上。
      if (!settingsLoadedRef.current) return
      void api.saveSettings(settingsRef.current).then((r) => {
        if (!r.ok) console.warn('[wt] 关窗前保存设置失败：', r.reason)
      })
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [flushSession])

  const visibleText = shownEngine?.visibleText ?? ''

  /**
   * 让阅读区跟着光标滚。
   *
   * 问题（真机实测，不是推测）：`.wt-canvas` 的可见高度是 667px，
   * **第 900 个字光标就掉出可见区**，而 `.wt-canvas.scrollTop` 全程是 0——
   * 全项目没有一处会滚动它。按默认比例算，约 90 次击键之后用户就看不见自己打的字了，
   * 而手在键盘上连续输入的人不会去拖滚动条。真 Word 是跟着滚的。
   *
   * 滚的是 `.wt-canvas`（`overflow: auto` 的是它，不是 `.wt-page`），所以这段在 `App`
   * 而不是 `Page`：画布归 App 所有。用 `querySelector` 找 `.wt-caret` 而不是给 `Page`
   * 加一个 ref 参数，是为了不动 `Page` 的公开接口（Task 10 交付的形状）。
   *
   * 【最后那一帧补滚不是多余的，删掉它真机上等于没修】：真实按键之后 Chromium 会把
   * 「焦点里那个 textarea 的光标」滚进视野——那是个盖满整张纸的隐形输入框，它自己的
   * 光标在纸的左上角，于是浏览器每次都把画布按回页首。实测（140 键）：effect 里同步
   * 设成 1414，同一个 effect 里再量已经是 30；去掉补滚那版连敲 120 键后末尾 scrollTop
   * 是 30、光标在 1976px 处（画布只有 667px 高）。这就是「合成事件测不出来」的原因：
   * 用 dispatchEvent 派发 input 时浏览器不做这次回滚，滚动完全正常。
   *
   * 补滚放在 rAF 里，且【刻意不 cancel】：回滚发生在 rAF 之前（实测 sync 时 1243，
   * 1~5ms 后的 rAF 已经是 30），所以 rAF 里这次修正在回滚之后、在这一帧画出来之前。
   * 不 cancel 是因为它幂等（每次都重新量当前布局），而 cancel 会让**快速连打**时上一键
   * 排的那一帧被下一键的 effect 清掉——实测那样会在 k70 之后全程停在页首。
   * 人速（10 键/秒）实测 120/120 次采样光标都在可见区内。
   * 不 cancel 也不会在卸载后乱动：那时 canvas 已脱离文档，量到的高度是 0，被下面那条闸挡住。
   *
   * 【画布高度为 0 就直接返回】：jsdom 没有布局，`getBoundingClientRect()` 全返回 0，
   * 据此算出来的「光标在可见区外」是假的。这条闸让单测里这段是空操作，而真机里画布
   * 高度恒不为 0。**滚动这条的判据只能在真机里量**，别在 vitest 里假装测了。
   *
   * `expanded` 也在依赖里：点折叠条展开前文时 `visibleText` 一字不变，但光标位置大变。
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !visibleText) return
    const caret = canvas.querySelector('.wt-caret')
    if (!caret) return

    // 幂等：已经滚到位时两次测量都落在空隙之内，位移是 0。
    const keepCaretVisible = (): void => {
      const canvasBox = canvas.getBoundingClientRect()
      if (canvasBox.height === 0) return
      const caretBox = caret.getBoundingClientRect()
      if (caretBox.bottom > canvasBox.bottom - CARET_MARGIN) {
        canvas.scrollTop += caretBox.bottom - (canvasBox.bottom - CARET_MARGIN)
      } else if (caretBox.top < canvasBox.top + CARET_MARGIN) {
        canvas.scrollTop -= canvasBox.top + CARET_MARGIN - caretBox.top
      }
    }

    keepCaretVisible()
    window.requestAnimationFrame(keepCaretVisible)
  }, [visibleText, expanded])

  const toolbarProps = useMemo(
    () => ({
      ratio: state?.ratio,
      mode: state?.mode,
      globalRatio: settings.ratio,
      onRatioChange: (n: number) => shownEngine?.setRatio(n),
      onGlobalRatioChange: (n: number) => patchSettings({ ratio: n }),
      onModeChange: (m: InputMode) => shownEngine?.setMode(m),
      onImport: () => handleImport(),
      onClearSession: () => void handleClearSession(),
      toast,
      notify
    }),
    // 【`shownEngine` 必须在这个数组里】上面两个 setter 闭包捕获的是它，而**依赖数组不能
    // 拿「值变没变」当判别依据**：小说与工作文档的 ratio / mode 默认值相同（都取全局比例、
    // 都是 'ime'），切模式时这几个依赖可以毫无变化——memo 不重算，setter 就仍指着小说。
    // 表现是老板模式下改「当前书」比例改的是小说那本（还会被防抖 effect 落进它的会话文件）。
    //
    // 【加进来没有额外代价】全仓没有 `React.memo`，切模式那一下本来就整棵树重渲染；而每次
    // 击键 `shownEngine` 的身份不变，memo 照旧命中。
    [
      state?.ratio,
      state?.mode,
      settings.ratio,
      shownEngine,
      patchSettings,
      handleImport,
      handleClearSession,
      toast,
      notify
    ]
  )

  /**
   * 快捷键的提交必须走函数式更新：一次「保存」会在同一个事件里连续提交多条，
   * 每条都基于同一份旧表就会后写覆盖先写，只有最后一条生效（D1）。
   */
  const handleShortcutsChange = useCallback(
    (update: (prev: (typeof shortcuts)) => typeof shortcuts): void => {
      patchSettings((prev) => ({ shortcuts: update(prev.shortcuts) }))
    },
    [patchSettings]
  )

  return (
    <ToolbarProvider {...toolbarProps}>
      <div className="wt-app" data-testid="app-root">
        <Ribbon
          docTitle={docTitle}
          displayTitle={bossActive && workNovel ? workNovel.title : docTitle}
          onDocTitleChange={(v) => patchSettings({ docTitle: v })}
          darkPaper={darkPaper}
          onDarkPaperChange={(v) => patchSettings({ darkPaper: v })}
          themeSource={themeSource}
          onThemeSourceChange={(v) => patchSettings({ themeSource: v })}
          pageFontSize={pageFontSize}
          onPageFontSizeChange={(v) => patchSettings({ pageFontSize: v })}
          novelOpen={shownNovel !== null}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          shortcuts={shortcuts}
          platform={platform}
          onShortcutsChange={handleShortcutsChange}
          onRecordingChange={setRecording}
          workDocTitle={workNovel?.title ?? null}
          workDocPath={workDocPath}
          workDocBroken={workDocBroken}
          onImportWorkDoc={() => void handleImportWorkDoc()}
          onRemoveWorkDoc={handleRemoveWorkDoc}
          novelTitle={novel?.title ?? null}
          chapterCount={novel?.chapters.length ?? 0}
          chapterRule={chapterRule}
          onApplyChapterRule={handleApplyChapterRule}
          currentSourcePath={novel?.sourcePath ?? null}
          onOpenNovel={handleOpenNovel}
          onDeleteNovel={handleDeleteNovel}
          settingsShortcut={formatShortcut(shortcutTable['open-settings'], kind)}
        />

        <div className="wt-body">
          <ChapterList
            novel={shownNovel}
            activeChapter={state?.activeChapter ?? 0}
            chapterPos={state?.chapterPos ?? []}
            onJump={(i) => shownEngine?.jumpToChapter(i)}
            collapsed={sidebarCollapsed || bossActive}
            // 【老板模式下不写】`collapsed` 那边是强制覆盖的，所以 rail 按钮在老板模式下
            // 按下去屏幕上不会有任何变化——而（没有这道闸时）它会改掉本次会话里的侧栏状态，
            // 退出老板模式那一刻突然生效。与上面 `toggle-sidebar` 那条**必须同时挡**：
            // 只挡一条会留下「同样的操作，一个写一个不写」的更糟形态。
            onCollapsedChange={(v) => {
              if (!bossActive) setSidebarCollapsed(v)
            }}
            sidebarShortcut={formatShortcut(shortcutTable['toggle-sidebar'], kind)}
          />

          <main className="wt-canvas" ref={canvasRef}>
            <Page
              visibleText={visibleText}
              expanded={expanded}
              onToggleExpand={() => setExpanded(true)}
              empty={!shownNovel}
              importShortcut={formatShortcut(shortcutTable.import, kind)}
              markdown={mdSource}
            >
              {shownEngine && state && (
                <InputCapture engine={shownEngine} mode={state.mode} />
              )}
            </Page>
          </main>
        </div>

        <StatusBar
          novel={shownNovel}
          cursor={state?.cursor ?? 0}
          activeChapter={state?.activeChapter ?? 0}
          ratio={state?.ratio ?? 10}
          mode={state?.mode ?? 'ime'}
          // 【传的是 `bossActive` 而不是 `bossMode`——两者今天其实同步，这是**防御性**的】
          // 它管的是「藏掉那三格」，语义上要的是 `bossActive`（屏幕上摊着的确实是工作文档）
          // 而不是 `bossMode`（想进老板模式）。今天两者在每个提交过的渲染里都相等
          // ——`handleRemoveWorkDoc` 里那两个 setter 是同一次批处理，中间没有 `bossMode` 为真
          // 而 `workNovel` 已空的那一帧。将来若「工作文档能在老板模式开着时被置空」成真，
          // 这一行才真的救场。
          hideReadingCells={bossActive}
        />

        <Toast />
      </div>
    </ToolbarProvider>
  )
}
