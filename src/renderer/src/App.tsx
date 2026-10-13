import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BOSS_FILL_MAX, clampBossFillPercent, fillCharsFor, stepBossFill } from '../../core/bossKey'
import { TypingEngine } from '../../core/engine'
import { formatShortcut, platformKind, resolveShortcuts } from '../../core/shortcuts'
import { DEFAULT_DOC_TITLE, DEFAULT_RATIO } from '../../core/types'
import type { AppSettings, InputMode, Novel } from '../../core/types'
import { ChapterList } from './components/ChapterList'
import { Page } from './components/Page'
import { Ribbon } from './components/Ribbon'
import { StatusBar } from './components/StatusBar'
import { Toast } from './components/Toast'
import { InputCapture } from './input/InputCapture'
import { useShortcutDispatcher } from './state/shortcuts'
import { useDarkPaper, useSystemTheme, useThemePreference } from './state/theme'
import { TOAST_MS, ToolbarProvider } from './state/ToolbarContext'
import { useTypingEngine } from './state/useTypingEngine'
import type { ThemeSource, WtApi } from './types/global'

const SAVE_DEBOUNCE_MS = 600
/** 光标与画布上下沿之间保留的空隙：.wt-canvas 上下各有 padding，贴着边等于贴到灰底上 */
const CARET_MARGIN = 24

/**
 * 取 preload 注入的接口；**它可能不存在**。
 *
 * sandboxed preload 加载失败时（Task 6 实测的形态：`Error: module not found: node:fs`），
 * 页面照常渲染而 `window.api === undefined`——用户看到的就是一个「伪装成 Word 的空窗口」。
 * `global.d.ts` 把它声明成必填（`api: WtApi`），所以 `tsc` 认为它恒存在、**不会提醒你判空**，
 * 这里必须自己转一道。
 *
 * 每次用的时候现取，【不要在模块顶层缓存成常量】：那等于把「preload 一定在模块加载前注入」
 * 写死进加载顺序，一旦不成立，拿到的就是永久为 null 的缓存。
 */
function getApi(): WtApi | null {
  return (window as unknown as { api?: WtApi }).api ?? null
}

export default function App() {
  const [novel, setNovel] = useState<Novel | null>(null)
  const [engine, setEngine] = useState<TypingEngine | null>(null)
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
  /**
   * 蓝条上的文档名。**刻意与 `novel.title` 无关**——那个是文件名（`诡秘之主（整理版）`），
   * 显示出来等于把「在看小说」写在了窗口最显眼的位置。这里永远是用户自己定的名字，
   * 默认取一个中性的 `文档1`。
   */
  const [docTitle, setDocTitle] = useState(DEFAULT_DOC_TITLE)
  /** 「深色模式下纸张也变暗」。默认关——真 Word 的深色模式里纸张仍是白的。 */
  const [darkPaper, setDarkPaper] = useState(false)
  /** 外观偏好，默认跟随系统。它决定原生部分（红绿灯）与网页部分一起怎么显示。 */
  const [themeSource, setThemeSource] = useState<ThemeSource>('system')
  /** 上次打开的书。启动时读回来、导入时更新，写进 settings.json 供下次启动恢复。 */
  const [lastSourcePath, setLastSourcePath] = useState<string | null>(null)
  /**
   * 设置对话框开不开。**从 Ribbon 里提上来的**：Ribbon 不再自己监听 ⌘/Ctrl + ,（那条归
   * 全局分发器，而分发器长在这一层），所以这个状态得由本组件持有再传下去。
   */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /**
   * **全局**阅读替换比例：新导入的书拿它当起点。
   *
   * 真正生效的是**当前书**的比例（引擎里那个，存在会话里）。这个不是「覆盖值」而是「初值」：
   * 一本书第一次打开时取它，之后各管各的——改这个**不影响已经打开过的书**，只影响之后导入的。
   * 所以两者之间没有「跟随」状态，设置里两个普通输入框就够了。
   */
  const [globalRatio, setGlobalRatio] = useState(DEFAULT_RATIO)
  /**
   * 设置对话框正在录制键位。录制期间分发器必须静音——不静音的话，用户在录制框里按下
   * `Ctrl+O` 的那一刻文件选择框就弹出来了（见下面 `useShortcutDispatcher` 那段）。
   *
   * 它由 `SettingsDialog` 经 `Ribbon` 上报。那两根线（`onRecordingChange` 与
   * `onShortcutsChange`）都是「可选带默认值」的，所以漏接一根**类型上不会报错、界面上也看不
   * 出来**——而两条线**各有一条用例专门钉着**（`tests/unit/app.test.tsx` 的「录制期间分发器
   * 静音」与「在设置里录一条新快捷键并保存」，两个方向都实测过：各删一次，各红对应的那一条）。
   */
  const [recording, setRecording] = useState(false)
  /** toast 的当前内容。**归 App 所有**——老板键的提示从这一层的分发器里弹，见设计文档 6.2 节。 */
  const [toast, setToast] = useState<string | null>(null)
  /**
   * 用户改过的快捷键（**稀疏表**：缺条目＝用该平台的默认值，`{}` 就是「全默认」）。
   *
   * 【为什么原样收着，不在这里 `resolveShortcuts` 补齐】它读回来的是磁盘上那个字段、写回去
   * 的也是它。补齐是按平台做的，而「当前是哪个平台」只有渲染这一层知道——补过的表落盘就
   * 等于把 macOS 的默认值写进了 Windows 的配置，换台机器打开就全是错的键。
   * 补齐只发生在**消费点**（下面前缀成 `shortcutTable`，以及设置里按平台格式化那几处）。
   */
  const [shortcuts, setShortcuts] = useState<AppSettings['shortcuts']>({})
  /**
   * 工作文档路径与老板键的铺满量。
   *
   * 【这里不是「让界面跟随」，只是**把磁盘上那份原样带回去**】下面那个 memo 就是防抖落盘的
   * 载荷，少一个字段就等于「启动一次之后把它冲成默认值」。`shortcuts` 曾经恒为写死的 `{}`
   * 时正是这个症状：手改过 settings.json 的人启动一次就被无声冲成空表（见下面那段说明）。
   * 所以这两个字段哪怕界面上还没有入口，也必须先读进来、再原样写回去。
   *
   * 【两个 setter 现在都有调用方了】`setBossFillPercent` 在 `adjustBossFill` 与启动读盘两处；
   * `setWorkDocPath` 在 `handleImportWorkDoc` / `handleRemoveWorkDoc` 与启动读盘三处
   * ——「设置里的工作文档」那一步已经接上了。
   */
  const [workDocPath, setWorkDocPath] = useState<string | null>(null)
  const [bossFillPercent, setBossFillPercent] = useState(BOSS_FILL_MAX)
  /**
   * 设置是否已经读回来了。
   *
   * 【少了这道闸，启动会把用户存的设置覆盖成默认值】设置是「改了就写回」的（下面那个
   * 防抖 effect），而首帧渲染时这几个状态还都是默认值——读盘是异步的。于是那个 effect
   * 会先拿着「文档1 / 跟随系统 / 不暗 / null」写一遍，把磁盘上真正的设置冲掉，然后才读到
   * 已经被自己冲掉的默认值。
   */
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  useSystemTheme()
  useDarkPaper(darkPaper)
  useThemePreference(themeSource)
  /**
   * **持久化专用**的引擎引用：永远指向小说那一本。
   *
   * 【为什么必须与「当前显示的那份」拆开】进老板模式之后屏幕上是工作文档，而工作文档
   * **不落盘**。若 `flushSession` 读的是「当前显示的那一份」，关窗那一下就会把工作文档的
   * 进度写进 `sessions/<工作文档的 hash>.json`——恰好是设计里说好不做的那件事，而且是在
   * 关窗那一下**静默**发生的。
   */
  const novelEngineRef = useRef<TypingEngine | null>(null)
  const canvasRef = useRef<HTMLElement | null>(null)
  novelEngineRef.current = engine
  /**
   * 最新的全局比例，挂在 ref 上给 `openNovel` 读。
   *
   * 【为什么不能用闭包里的那个值】`openNovel` 的依赖是 `[flushSession]`，而那是个稳定引用
   * ——于是它永远保留**首次渲染**那一刻闭包里的 `globalRatio`（默认 10），启动读回真正的
   * 全局值之后也不会更新。实测过：全局设成 3、导入一本新书，引擎拿到的仍是 10。
   *
   * 【为什么也不把它加进依赖数组】`openNovel` 的身份一变，**启动那个 effect 就会重跑**，
   * 于是每次改全局比例都会把书重新打开一遍（重新读会话、重置 expanded…）。
   * 渲染期写 ref 是本文件既有的写法（见上面的 `novelEngineRef.current = engine`）。
   */
  const globalRatioRef = useRef(DEFAULT_RATIO)
  globalRatioRef.current = globalRatio
  /**
   * 最新的铺满量，挂在 ref 上给下面两个动作读。
   *
   * 【为什么不用闭包里的 `bossFillPercent`】那两个动作每次渲染都是新函数（它们要进分发器的
   * actions 对象），直接把 `bossFillPercent` 放进依赖也行——但 `toggleBoss` 同时依赖
   * `workNovel` / `workEngine` / `bossMode`，每改一次铺满量就换一次身份。挂 ref 与
   * `globalRatioRef` 是同一套写法，也同一套理由。
   */
  const bossFillPercentRef = useRef(BOSS_FILL_MAX)
  bossFillPercentRef.current = bossFillPercent

  const settingsRef = useRef<AppSettings | null>(null)
  /**
   * 设置的当前值：**一处构造，两处消费**（防抖写盘的载荷、关窗前的快照）。
   *
   * 【为什么要合并】这些字段此前在三个地方各写了一遍：防抖 effect 的载荷、那个 effect 的
   * 依赖数组、以及 ref 的字面量。加设置项时漏改依赖数组＝「只在关窗时落盘」，漏改 ref
   * 字面量＝「防抖写了、关窗丢」——两种都只在特定退出路径下才显形。
   *
   * 【合并之后上面那句要重读】两条路现在读的是**同一个对象**：漏改下面那个依赖数组，
   * memo 不重算，于是防抖的载荷与关窗的快照一起停在旧值上——那个字段的改动在别的依赖也
   * 变化之前，哪条路都带不上去（既不报错、也不落盘，只是悄悄不变）。所以依赖数组必须与
   * 返回对象里的字段一一对应；字段也只在这一处增删。
   *
   * 【`shortcuts` 这一项是这条规矩的活例】它曾经恒为写死的 `{}`、因此**不在依赖数组里**
   * ——那时没有后果（那个值永远不会变）。接上状态之后两处必须同时改，两种漏法都只静默：
   * 留着写死的 `{}`，手改过 `settings.json` 的人启动一次就会被 600ms 那次防抖**无声冲成
   * 空表**；漏掉依赖里的 `shortcuts`，memo 不重算，那条改动哪条路都带不上去。
   *
   * 两件事各有一条用例钉着（都在 `tests/unit/app.test.tsx`）：启动那条载荷断言管前者，
   * 「在设置里录一条新快捷键并保存」管后者。
   *
   * 【后者的载荷断言为什么必须排在按新键导入之前】那一步会动 `lastSourcePath`（memo 的另一个
   * 依赖），memo 被带着重算——而**重算本身不给漏依赖这件事解围**：此刻落盘的仍是重算前那一次
   * 排的防抖写。真正让它隐形的是**紧接着又落一次盘**：重算改了 `settings` 的身份，防抖再排一发，
   * 600ms 后写下的那一份就是带上了新表的。所以断言一旦排到那两次写之后、读的又是最后一次调用，
   * 它就永远看到正确的那一份。实测（变异＝值留住、只把 `shortcuts` 从依赖数组里删掉）：
   * 断言排在导入之后且**不补推进**时这条仍红；**再补一次 `advanceTimersByTimeAsync(2000)`**
   * 就转绿。排序把断言钉在「重算前那一次写」上，这才让它对这处漏接敏感。
   */
  const settings: AppSettings = useMemo(
    () => ({
      docTitle,
      themeSource,
      darkPaper,
      lastSourcePath,
      ratio: globalRatio,
      workDocPath,
      bossFillPercent,
      shortcuts
    }),
    [
      docTitle,
      themeSource,
      darkPaper,
      lastSourcePath,
      globalRatio,
      workDocPath,
      bossFillPercent,
      shortcuts
    ]
  )
  settingsRef.current = settingsLoaded ? settings : null
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
   * 【为什么多一个 `bossActive` 而不是直接用 `bossMode`】它防的是「`bossMode` 为真、工作
   * 文档却是 null」——那时页面会变成一片空白。**当下这一条还不可达**：唯一的置位点在
   * `toggleBoss`，而它在设 `bossMode` 之前就为 null 早返回了。它真正的用处在**「移除工作
   * 文档」那一步**（Task 8）：那时 `workNovel` 会在 `bossMode` 仍为真时被置空，靠 `bossActive`
   * 把「想切过去」和「切得过去」分开，这一整类情形就自愈了。
   */
  const bossActive = bossMode && workNovel !== null && workEngine !== null
  const shownNovel = bossActive ? workNovel : novel
  const shownEngine = bossActive ? workEngine : engine

  const state = useTypingEngine(shownEngine)

  /** 把当前这本的进度立刻落盘（不等防抖）。换书前与关窗前各用一次。 */
  const flushSession = useCallback((): void => {
    const api = getApi()
    const current = novelEngineRef.current
    if (api && current) void api.saveSession(current.toSession())
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
      // 有记录就接着用它自己的比例；没有记录才拿**全局**值当起点（这就是全局比例的全部作用）。
      // 读 ref 而不是闭包里的 `globalRatio`，理由见 `globalRatioRef` 那段说明。
      setEngine(
        session
          ? TypingEngine.fromSession(next, session)
          : new TypingEngine(next, { ratio: globalRatioRef.current })
      )
      setExpanded(false)
      setLastSourcePath(next.sourcePath)
    },
    [flushSession]
  )

  const handleImport = useCallback(async () => {
    const api = getApi()
    if (!api) return
    const next = await api.importNovel()
    if (!next) return
    await openNovel(next)
  }, [openNovel])

  const handleClearSession = useCallback(async () => {
    const api = getApi()
    if (!api) return
    // 【作废在飞的 open】导入已发起、`loadSession` 还没回来时按下清除，那次 open 回来后照样
    // 能通过 `openNovel` 里的 seq 检查，把书放回界面、600ms 后还重写进度与 lastSourcePath
    // ——清除等于没清。递增一次就等于把它标记成过期的。
    openSeqRef.current++
    // 【状态清空排在 await 之前】待发的会话写是靠 `setEngine(null)` 那次提交的 effect cleanup
    // 取消的；排在 await 之后的话，一个已排上队的防抖写可能落在 IPC 删除之后，把记录又写回来。
    setNovel(null)
    setEngine(null)
    // 「上次打开的是哪本」也是阅读记录的一部分：不清掉的话，用户按下「清除阅读记录」再重启，
    // 那本书又自己开回来了——而设置（文档名 / 外观 / 纸张）照旧留着。
    setLastSourcePath(null)
    await api.clearSession()
  }, [])

  /**
   * 导入工作文档。**与「导入小说」同类：立即动作，不走「草稿 + 保存」。**
   *
   * 【为什么同时 setBossMode(false)】工作文档在启动时可能读不出来（那时 `bossMode` 仍是
   * 上一次留下的值），此时导入一份新的，`bossActive` 会立刻变真、界面自己跳进老板模式。
   * 导入这个动作本身不该改变你正在看什么。
   */
  const handleImportWorkDoc = useCallback(async (): Promise<void> => {
    const api = getApi()
    if (!api) return
    const doc = await api.importWorkDoc()
    if (!doc) return
    setWorkNovel(doc)
    setWorkEngine(new TypingEngine(doc, { ratio: globalRatioRef.current }))
    // 路径就在 Novel 里，不必让 IPC 多返回一个值
    setWorkDocPath(doc.sourcePath)
    setWorkDocBroken(false)
    setBossMode(false)
    notify('已导入工作文档')
  }, [notify])

  const handleRemoveWorkDoc = useCallback((): void => {
    setWorkNovel(null)
    setWorkEngine(null)
    setWorkDocPath(null)
    setWorkDocBroken(false)
    setBossMode(false)
    notify('已移除工作文档')
  }, [notify])

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
    if (next) workEngine.revealTo(fillCharsFor(bossFillPercentRef.current))
    // 「展开前文」是阅读区那一边的窗口状态，带过去会让工作文档一进来就是一张长纸
    setExpanded(false)
    setBossMode(next)
  }, [workNovel, workEngine, bossMode, workDocPath, notify])

  /** 老板键铺满 +/-：改设置；正在老板模式时**立刻重铺**，让用户当场看到效果。 */
  const adjustBossFill = useCallback(
    (dir: 1 | -1): void => {
      const next = stepBossFill(bossFillPercentRef.current, dir)
      if (next === bossFillPercentRef.current) {
        notify(`铺满已是 ${next}%`)
        return
      }
      setBossFillPercent(next)
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
      if (bossActive) workEngine?.revealTo(fillCharsFor(next))
      notify(`铺满 ${next}% ≈ ${fillCharsFor(next)} 字`)
    },
    [bossActive, workEngine, notify]
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
      const settings = await api.loadSettings()
      if (cancelled) return
      setDocTitle(settings.docTitle)
      setDarkPaper(settings.darkPaper)
      setThemeSource(settings.themeSource)
      setLastSourcePath(settings.lastSourcePath)
      setGlobalRatio(settings.ratio)
      setShortcuts(settings.shortcuts)
      // 【这一夹是必须的，不是防御】settingsProblem 只判「是不是有限数字」，值域夹紧归 core
      // ——少了它，手改出来的 `bossFillPercent: 500` 会原样进 React 状态、再照原样写回磁盘，
      // 而第一次按「铺满 −」会从 500 一步跳到 100。
      setBossFillPercent(clampBossFillPercent(settings.bossFillPercent))
      setWorkDocPath(settings.workDocPath)
      setSettingsLoaded(true)

      // 工作文档：**启动时就读进来常驻内存**。老板键要的是零延迟——等按下去了才读盘，
      // 老板已经站在旁边了。读不出来时不弹打扰提示（那会在你早忘了这回事的时候吓你一下），
      // 只在设置里标红，以及按老板键时给一句说明。
      if (settings.workDocPath) {
        const doc = await api.loadWorkDoc(settings.workDocPath)
        if (cancelled) return
        if (doc) {
          setWorkNovel(doc)
          // 与「新导入一本书」同一条路：拿全局比例当初值。
          //
          // 【这里读的是刚读回来的 `settings.ratio`，不是 `globalRatioRef.current`】两者本该
          // 同值，但**那个 ref 在这一次 await 之后还是旧的**：写 ref 发生在渲染期，而上面那几行
          // `setGlobalRatio(settings.ratio)` 排的那次渲染还没提交，`await api.loadWorkDoc(...)`
          // 就已经返回了。实测（探针＝把 loadWorkDoc 的桩拖成一个 50ms 的宏任务）：延迟之后比值
          // 就对上了——所以这不是「值算错了」而是**竞态**，真实 IPC 的耗时碰巧总让 React 先渲染完，
          // 于是它只在单测里显形。刚读回来的这个值没有这个问题，语义与「拿全局比例当初值」一致。
          //
          // 【别为了「两处看起来一致」把这里换回 ref】`openNovel` 必须读 ref，是因为它闭包里
          // 那个 `globalRatio` 是**首次渲染**时的旧值（它的依赖只有 `flushSession`，见
          // `globalRatioRef` 那段说明）；而 boot 里 `settings` 就在手边，压根不存在那个问题。
          // 同一个写法在两个不同前提下会变成教条——这里要的是「当前值」，那里要的是「绕开闭包」。
          setWorkEngine(new TypingEngine(doc, { ratio: settings.ratio }))
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
      const targets = [initialPath, settings.lastSourcePath].filter(
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
          // 「接着读还是从头」交给 openNovel 一个人判——它读的正是 loaded.sourcePath 名下那本书的进度
          await openNovel(loaded)
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
  }, [openNovel])

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
    enabled: !recording,
    actions: {
      import: () => void handleImport(),
      'toggle-sidebar': () => setSidebarCollapsed((v) => !v),
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
      void api.saveSession(engine.toSession())
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [engine, state])

  // 设置持久化（防抖）。与会话同一套节奏：600ms 内的连续改动只落盘一次。
  useEffect(() => {
    const api = getApi()
    // 读回来之前不写，见 settingsLoaded 的说明
    if (!api || !settingsLoaded) return
    const timer = window.setTimeout(() => {
      void api.saveSettings(settings)
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [settings, settingsLoaded])

  // 关闭前强制落盘
  useEffect(() => {
    const api = getApi()
    if (!api) return
    const flush = (): void => {
      flushSession()
      // 设置也有防抖窗口：改完文档名立刻关窗（或退出）会落在窗口里，关窗前的最后一次补上。
      const settings = settingsRef.current
      if (settings) void api.saveSettings(settings)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [flushSession])

  const visibleText = shownEngine?.visibleText ?? ''
  const revealedChars = state ? state.cursor - state.revealStart : 0

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
      globalRatio,
      onRatioChange: (n: number) => shownEngine?.setRatio(n),
      onGlobalRatioChange: setGlobalRatio,
      onModeChange: (m: InputMode) => shownEngine?.setMode(m),
      onImport: () => void handleImport(),
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
      globalRatio,
      shownEngine,
      handleImport,
      handleClearSession,
      toast,
      notify
    ]
  )

  return (
    <ToolbarProvider {...toolbarProps}>
      <div className="wt-app" data-testid="app-root">
        <Ribbon
          docTitle={docTitle}
          displayTitle={bossActive && workNovel ? workNovel.title : docTitle}
          onDocTitleChange={setDocTitle}
          darkPaper={darkPaper}
          onDarkPaperChange={setDarkPaper}
          themeSource={themeSource}
          onThemeSourceChange={setThemeSource}
          novelOpen={shownNovel !== null}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          shortcuts={shortcuts}
          platform={platform}
          onShortcutsChange={setShortcuts}
          onRecordingChange={setRecording}
          workDocTitle={workNovel?.title ?? null}
          workDocBroken={workDocBroken}
          onImportWorkDoc={() => void handleImportWorkDoc()}
          onRemoveWorkDoc={handleRemoveWorkDoc}
          settingsShortcut={formatShortcut(shortcutTable['open-settings'], kind)}
        />

        <div className="wt-body">
          <ChapterList
            novel={shownNovel}
            activeChapter={state?.activeChapter ?? 0}
            chapterPos={state?.chapterPos ?? []}
            onJump={(i) => shownEngine?.jumpToChapter(i)}
            collapsed={sidebarCollapsed || bossActive}
            onCollapsedChange={setSidebarCollapsed}
            sidebarShortcut={formatShortcut(shortcutTable['toggle-sidebar'], kind)}
          />

          <main className="wt-canvas" ref={canvasRef}>
            <Page
              visibleText={visibleText}
              expanded={expanded}
              onToggleExpand={() => setExpanded(true)}
              empty={!shownNovel}
              importShortcut={formatShortcut(shortcutTable.import, kind)}
            >
              {shownEngine && state && (
                <InputCapture engine={shownEngine} mode={state.mode} />
              )}
            </Page>
          </main>
        </div>

        <StatusBar
          novel={shownNovel}
          revealedChars={revealedChars}
          activeChapter={state?.activeChapter ?? 0}
          ratio={state?.ratio ?? 10}
          mode={state?.mode ?? 'ime'}
          bossMode={bossActive}
        />

        <Toast />
      </div>
    </ToolbarProvider>
  )
}
