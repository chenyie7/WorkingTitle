import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BOSS_FILL_MAX, clampBossFillPercent } from '../../core/bossKey'
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
import { ToolbarProvider } from './state/ToolbarContext'
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
   * 两个 setter 眼下没有调用方——入口在「设置里的工作文档」那一步接上。
   */
  const [workDocPath, setWorkDocPath] = useState<string | null>(null)
  const [bossFillPercent, setBossFillPercent] = useState(BOSS_FILL_MAX)
  /**
   * 设置是否已经读回来了。
   *
   * 【少了这道闸，启动会把用户存的设置覆盖成默认值】设置是「改了就写回」的（下面那个
   * 防抖 effect），而首帧渲染时这四个状态还都是默认值——读盘是异步的。于是那个 effect
   * 会先拿着「文档1 / 跟随系统 / 不暗 / null」写一遍，把磁盘上真正的设置冲掉，然后才读到
   * 已经被自己冲掉的默认值。
   */
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  useSystemTheme()
  useDarkPaper(darkPaper)
  useThemePreference(themeSource)
  const engineRef = useRef<TypingEngine | null>(null)
  const canvasRef = useRef<HTMLElement | null>(null)
  engineRef.current = engine
  /**
   * 最新的全局比例，挂在 ref 上给 `openNovel` 读。
   *
   * 【为什么不能用闭包里的那个值】`openNovel` 的依赖是 `[flushSession]`，而那是个稳定引用
   * ——于是它永远保留**首次渲染**那一刻闭包里的 `globalRatio`（默认 10），启动读回真正的
   * 全局值之后也不会更新。实测过：全局设成 3、导入一本新书，引擎拿到的仍是 10。
   *
   * 【为什么也不把它加进依赖数组】`openNovel` 的身份一变，**启动那个 effect 就会重跑**，
   * 于是每次改全局比例都会把书重新打开一遍（重新读会话、重置 expanded…）。
   * 渲染期写 ref 是本文件既有的写法（见上面的 `engineRef.current = engine`）。
   */
  const globalRatioRef = useRef(DEFAULT_RATIO)
  globalRatioRef.current = globalRatio

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

  const state = useTypingEngine(engine)

  /** 把当前这本的进度立刻落盘（不等防抖）。换书前与关窗前各用一次。 */
  const flushSession = useCallback((): void => {
    const api = getApi()
    const current = engineRef.current
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
      // `engineRef.current` 仍是上一本（还没人 setEngine），上面这句话才是字面为真的。
      flushSession()

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
      'open-settings': () => setSettingsOpen(true)
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

  const visibleText = engine?.visibleText ?? ''
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
      onRatioChange: (n: number) => engineRef.current?.setRatio(n),
      onGlobalRatioChange: setGlobalRatio,
      onModeChange: (m: InputMode) => engineRef.current?.setMode(m),
      onImport: () => void handleImport(),
      onClearSession: () => void handleClearSession()
    }),
    [state?.ratio, state?.mode, globalRatio, handleImport, handleClearSession]
  )

  return (
    <ToolbarProvider {...toolbarProps}>
      <div className="wt-app" data-testid="app-root">
        <Ribbon
          docTitle={docTitle}
          onDocTitleChange={setDocTitle}
          darkPaper={darkPaper}
          onDarkPaperChange={setDarkPaper}
          themeSource={themeSource}
          onThemeSourceChange={setThemeSource}
          novelOpen={novel !== null}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          shortcuts={shortcuts}
          platform={platform}
          onShortcutsChange={setShortcuts}
          onRecordingChange={setRecording}
          settingsShortcut={formatShortcut(shortcutTable['open-settings'], kind)}
        />

        <div className="wt-body">
          <ChapterList
            novel={novel}
            activeChapter={state?.activeChapter ?? 0}
            chapterPos={state?.chapterPos ?? []}
            onJump={(i) => engineRef.current?.jumpToChapter(i)}
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
            sidebarShortcut={formatShortcut(shortcutTable['toggle-sidebar'], kind)}
          />

          <main className="wt-canvas" ref={canvasRef}>
            <Page
              visibleText={visibleText}
              expanded={expanded}
              onToggleExpand={() => setExpanded(true)}
              empty={!novel}
              importShortcut={formatShortcut(shortcutTable.import, kind)}
            >
              {engine && state && (
                <InputCapture engine={engine} mode={state.mode} />
              )}
            </Page>
          </main>
        </div>

        <StatusBar
          novel={novel}
          revealedChars={revealedChars}
          activeChapter={state?.activeChapter ?? 0}
          ratio={state?.ratio ?? 10}
          mode={state?.mode ?? 'ime'}
        />

        <Toast />
      </div>
    </ToolbarProvider>
  )
}
