// `KeyboardEvent` 要**改名**导入：这个名字一进来就盖住了 DOM 那个（下面 Esc 关闭用的
// `window.addEventListener('keydown', …)` 收的正是 DOM 事件），而两者不通用——React 的
// `KeyboardEvent<Element>` 上多一个 `nativeEvent`、DOM 的则多十几个字段，互相都赋不过去，
// 直接照抄会把那条既有代码判成类型错。
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import type { FluentIcon } from '@fluentui/react-icons'
import {
  SHORTCUTS,
  defaultShortcut,
  findConflict,
  formatShortcut,
  fromChord,
  platformKind,
  resolveShortcuts,
  shortcutProblem,
  type ShortcutId
} from '../../../core/shortcuts'
import {
  MAX_RATIO,
  MIN_RATIO,
  PAGE_FONT_SIZE_MAX,
  PAGE_FONT_SIZE_MIN,
  clampPageFontSize
} from '../../../core/types'
import { toChord } from '../state/shortcuts'
import { useDeferredSettings, type DeferredField } from '../state/deferredSettings'
import { clampRatioInput, useToolbar } from '../state/ToolbarContext'
import type { ThemeSource } from '../types/global'
import {
  IconBook,
  IconClear,
  IconClose,
  IconDarkTheme,
  IconDesktop,
  IconDocument,
  IconFontSize,
  IconImport,
  IconKeyboard,
  IconMoon,
  IconRename,
  IconSettings,
  IconSun
} from './icons'

export interface SettingsDialogProps {
  /** 对话框归 Ribbon 所有：打开它的那个按钮就在「文件」选项卡的工具组里 */
  open: boolean
  onClose: () => void
  docTitle: string
  onDocTitleChange: (next: string) => void
  /** 「深色模式下纸张也变暗」。默认关（真 Word 深色模式下纸张仍是白的）。 */
  darkPaper: boolean
  onDarkPaperChange: (next: boolean) => void
  /** 外观偏好：跟随系统 / 浅色 / 深色 */
  themeSource: ThemeSource
  onThemeSourceChange: (next: ThemeSource) => void
  /**
   * 阅读区正文字号（px，12–24）。**归「手动保存」那一组**：改完点保存才生效。
   *
   * 【它只作用于小说与 `.txt` 工作文档】md 工作文档的一整套字号是照着 Word 的标题层级
   * 写死的 px，跟着缩会把层级弄散。见 `page.css` 的 `.wt-page__novel`。
   */
  pageFontSize: number
  onPageFontSizeChange: (next: number) => void
  /**
   * 有没有打开文档：「当前书」的比例框据此禁用——没有文档就没有「当前书」。
   *
   * 【措辞刻意是「文档」不是「小说」】Task 7 起这一格描述的是**当前显示的那一份**，
   * 而老板模式下屏幕上摊着的是一份工作文档。判据也早已是 `shownNovel !== null`。
   */
  novelOpen: boolean
  /**
   * 用户改过的那些快捷键——**稀疏表**：缺条目就是「用该平台的默认值」。
   *
   * 【别把它当成补齐过的那张表】下面每一条都写着 `?? defaultShortcut(...)`，正是为这件事。
   * 以为它恒满的话，那个兜底看起来就像多余的，删掉之后没改过的快捷键会变成 `undefined`。
   * 补齐这一步按平台做，而平台是另一个 prop。
   *
   * 【值类型里那个 `| undefined` 是有意的】上游拿的是 `AppSettings.shortcuts`，它的类型是
   * `Partial<Record<ShortcutId, string>>`——索引访问本来就可能取不到。写成
   * `Record<string, string>` 的话调用方那一个 prop 直接编译不过（实测 TS2345：'string' index
   * signatures are incompatible）。
   */
  shortcuts: Record<string, string | undefined>
  /** 平台原值（`window.api.platform`），用来决定 ↺ 恢复成哪一套默认值。 */
  platform: string
  /** 快捷键改完的提交。与文档名一样，点了保存才生效。 */
  onShortcutsChange: (next: Record<string, string | undefined>) => void
  /**
   * 录制态变化时通知外面。
   * 【为什么必须通知】录制期间分发器必须静音——不然录 `⌘O` 会当场触发一次真导入，
   * 用户在设置里按下组合键的那一刻文件选择框就弹出来了。
   */
  onRecordingChange: (recording: boolean) => void
  /** 工作文档的文件名（去扩展名）。`null` = 没导入。 */
  workDocTitle: string | null
  /**
   * 工作文档的完整路径，只用于那行的 `title` 悬停提示（设计 §8）。
   *
   * 【为什么另给一个字段而不是从 `workDocTitle` 推】那是 `Novel.title`（去扩展名的文件名），
   * 路径推不出来。两个值来源不同、生命周期也不同：坏掉那一路 `workDocTitle` 恒为 null，
   * 而路径仍在（刻意保留，文件可能只是临时不在）。
   */
  workDocPath: string | null
  /** 配了路径但读不出来（文件被移走 / 删掉 / 权限）。设置里据此标红。 */
  workDocBroken: boolean
  /** 立即动作，与 onImport / onClearSession 同类——**不走「草稿 + 保存」那一套**。 */
  onImportWorkDoc: () => void
  onRemoveWorkDoc: () => void
}

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统', icon: IconDesktop },
  { value: 'light', label: '浅色', icon: IconSun },
  { value: 'dark', label: '深色', icon: IconMoon }
] as const satisfies ReadonlyArray<{ value: ThemeSource; label: string; icon: FluentIcon }>

/**
 * 左栏的页签。**加一页就是加一行**——数组顺序就是左栏从上到下的顺序。
 *
 * 【为什么是表而不是散在 JSX 里】页签按钮、`aria-labelledby` / `aria-controls`、
 * roving tabindex、方向键分发四处遍历的是同一份清单；散着写的话加一页要改四个地方。
 * 与同一个文件里的 `THEME_OPTIONS` 是同一套写法。
 */
const PAGES = [
  { id: 'reading', label: '阅读设置', icon: IconBook },
  { id: 'appearance', label: '外观设置', icon: IconDarkTheme },
  { id: 'shortcuts', label: '快捷键设置', icon: IconKeyboard }
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: FluentIcon }>

type SettingsPage = (typeof PAGES)[number]['id']

/**
 * 设置对话框：应用**真实功能**的唯一去处（文档名 / 比例 / 输入模式 / 导入 / 清除阅读记录）。
 *
 * 【为什么要有一个对话框，而不是像原来那样把控件摆在工具栏里】那些控件是伪装的一部分里
 * 最扎眼的一处：「1 键显示 N 字」「导入小说」摆在假 Word 的工具栏和「文件」页上，任何一个
 * 瞥见屏幕的人都看得出这不是 Word。收进一个模态之后，界面上只剩一个「设置」按钮和一个
 * 快捷键——它们本身就是 Word 也有的东西（Word 的「选项」同样是模态框）。
 *
 * 【testid 一个都没改】`ratio-input` / `mode-button` / `btn-import` / `btn-clear-session` /
 * `doc-title-input` 原样搬进来，只是不再同时存在于工具栏里。
 */
export function SettingsDialog({
  open,
  onClose,
  docTitle,
  onDocTitleChange,
  darkPaper,
  onDarkPaperChange,
  themeSource,
  onThemeSourceChange,
  pageFontSize,
  onPageFontSizeChange,
  novelOpen,
  shortcuts,
  platform,
  onShortcutsChange,
  onRecordingChange,
  workDocTitle,
  workDocPath,
  workDocBroken,
  onImportWorkDoc,
  onRemoveWorkDoc
}: SettingsDialogProps) {
  const { ratio, setRatio, globalRatio, setGlobalRatio, mode, setMode, onImport, onClearSession, notify } =
    useToolbar()

  const kind = platformKind(platform)

  /** 当前显示哪一页。默认「阅读设置」。 */
  const [page, setPage] = useState<SettingsPage>('reading')
  /** 上一次渲染时对话框开着没有。只服务于下面那一段「打开」时的就地重置。 */
  const [wasOpen, setWasOpen] = useState(open)

  /*
   * 「每次打开都拉回第一页」。**必须写在渲染期，不能放进 effect。**
   *
   * `open` 为假时本组件只是 `return null`——**它并不卸载**，`useState` 的初值只在第一次
   * 挂载时起作用。放进 `[open, reset]` 那条 effect 里的话，effect 跑在**提交之后**，所以
   * 「打开」的那一次提交里 page 还是上一次的值、阅读设置面板仍带着 `hidden`；而
   * **对 `hidden`（display:none）子树里的元素调 `focus()` 是 no-op**，`autoFocus` 就此
   * 静默失效——焦点**原地留在关闭时被交还的那个隐形输入框上**（下面那条 `if (open) return`
   * 的 effect 在关闭时把焦点交给了它），而那个输入框**本来就是抽字那条路的入口**：
   * `InputCapture` 里那道 `role="dialog"` 闸只长在抢焦点的 `focusIfNotTextInput` 上，
   * `handleKeyDown` / `handleInput` 一条都没有。焦点一落在那儿，按键**立刻**开始抽字。
   *
   * 渲染期就地重置（React 官方的「props 变了就地调整 state」写法）会让 React 当场重跑一次
   * 渲染再提交，于是「打开」那一次提交里第一页**本来就是可见的**，`autoFocus` 落得下去。
   * 光在事后把 page 拉回去补不回来：input 没有重新挂载，`autoFocus` 不会重跑。
   */
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setPage('reading')
  }

  /**
   * 左栏那几个按钮。方向键换页之后要**显式**把焦点搬过去：roving tabindex 换人时
   * 浏览器不会自己跟（它只管 Tab 键那一下）。
   */
  const tabRefs = useRef<Partial<Record<SettingsPage, HTMLButtonElement | null>>>({})

  /**
   * 左栏的方向键。↑↓ 移动并**当场切页**（ARIA tabs 的「自动激活」），Home / End 跳首尾。
   *
   * 【为什么选自动激活而不是「先移焦点、再按 Enter 确认」】内容区是静态表单，切过去的
   * 代价只是重画一次，没有需要确认的操作。
   *
   * 【不认的键直接 return，不做 preventDefault】左栏只该吃掉这五个键；Enter / Space
   * 交给浏览器去点按钮、字母键谁也别拦。
   */
  const handleNavKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const i = PAGES.findIndex((p) => p.id === page)
    let next = -1
    if (e.key === 'ArrowDown') next = (i + 1) % PAGES.length
    else if (e.key === 'ArrowUp') next = (i - 1 + PAGES.length) % PAGES.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = PAGES.length - 1
    if (next < 0) return
    e.preventDefault()
    const target = PAGES[next].id
    setPage(target)
    tabRefs.current[target]?.focus()
  }

  /**
   * 「导入小说」按钮 title 里那条快捷键的显示文本。
   *
   * 【为什么在这里算，而不是像 `Toolbar` 那样收一个成品 prop】本组件的定位就是「拿着稀疏表
   * 与平台**自己**格式化」——下面那几个录制框（`formatShortcut(draft, kind)`）已经是这么做的。
   * 写成收 prop 的话，调用方（`Ribbon`）就得为这**一处** tooltip 再算一遍。
   *
   * 【取的是已提交值，不是录制中的草稿】这个 title 说的是「现在按什么键能导入」；草稿还没保存。
   * 录制框显示草稿是因为它要展示你正在录的那个键，两者不是一回事。
   */
  const importButtonShortcut = formatShortcut(
    shortcuts.import ?? defaultShortcut('import', kind),
    kind
  )
  /** 正在录哪一条（null＝没在录）。录制期间那个按钮自己接管 keydown。 */
  const [recording, setRecording] = useState<ShortcutId | null>(null)

  // 录制态一变就告诉外面（分发器据此静音）
  useEffect(() => {
    onRecordingChange(recording !== null)
  }, [recording, onRecordingChange])

  /**
   * 关掉对话框＝放弃这次录制。
   *
   * 【「关掉对话框」与「卸载」是两件事，别混】`open` 为假时这个组件只是 `return null`——
   * **它并不卸载**。下面那条卸载时的上报管的是「整棵界面被销毁」（应用退出），管不到
   * 「用户把对话框关了」。少了这一句，录制中关掉对话框之后录制态会一直挂着：分发器一直哑着
   * （而用户完全看不出为什么快捷键失效了），下次打开时那个按钮还停在「请按下组合键…」上。
   *
   * 【也不能只靠录制框的 onBlur 兜底】那条要成立，得「点别处时浏览器把焦点从按钮上拿走」——
   * 而点一个 `<button>` 在有些平台**根本不给它焦点**（macOS 上的 Safari 就是这样），
   * blur 于是不会来。它是兜底，不是机制。
   */
  useEffect(() => {
    if (!open) setRecording(null)
  }, [open])

  /** 整棵界面被销毁时（应用退出）也要说一声 false，别把分发器留在哑着的状态 */
  useEffect(() => () => onRecordingChange(false), [onRecordingChange])

  /**
   * 「手动保存」的那一组设置项——**加一项就是往这张表里加一行**。
   *
   * 表里只有这两项：文档名与阅读替换。外观、纸张、输入模式刻意**不**进来，它们的效果是
   * 当场看得见的（换个颜色、按一下就知道），要保存才生效会很别扭。
   *
   * 【两项底层是两条路】文档名是全局设置（App 状态 → 防抖写 `settings.json`），而比例跟着
   * 书走（`engine.setRatio`，存在那本书的会话里）。对用户是同一个「保存」按钮，这正是把表
   * 放在这里的理由：对话框不必知道背后是什么，它只调 `commit`。
   */
  const fields: DeferredField[] = useMemo(
    () => [
      {
        id: 'doc-title',
        committed: docTitle,
        // 空名退回当前值：蓝条上留一片空白比留着上一个名字更扎眼
        normalize: (raw, committed) => {
          const trimmed = raw.trim()
          return trimmed === '' ? committed : trimmed
        },
        commit: (value) => {
          if (value !== docTitle) onDocTitleChange(value)
        }
      },
      {
        id: 'ratio',
        committed: String(ratio),
        // 解析不出数字就退回当前值，而不是留一个 NaN 草稿——那种草稿会让「保存」一直亮着
        // 而点下去什么都不提交（用户会以为按钮坏了）
        normalize: (raw, committed) => {
          const parsed = Number.parseInt(raw, 10)
          return Number.isFinite(parsed) ? String(clampRatioInput(parsed)) : committed
        },
        commit: (value) => setRatio(Number(value))
      },
      {
        // 全局比例与当前书比例**用的是同一套解析与夹紧**，区别只在提交到哪儿：
        // 一个进 settings.json（新导入的书取它当起点），一个进那本书的会话（真正生效的那个）。
        id: 'global-ratio',
        committed: String(globalRatio),
        normalize: (raw, committed) => {
          const parsed = Number.parseInt(raw, 10)
          return Number.isFinite(parsed) ? String(clampRatioInput(parsed)) : committed
        },
        commit: (value) => setGlobalRatio(Number(value))
      },
      {
        // 正文字号与上面两格共用同一套「解析不出就退回当前值 → 失焦归一化 → 保存才提交」。
        // 它落进 `settings.json`（全局一份），与文档名同一条路。
        id: 'page-font-size',
        committed: String(pageFontSize),
        normalize: (raw, committed) => {
          const parsed = Number.parseInt(raw, 10)
          return Number.isFinite(parsed) ? String(clampPageFontSize(parsed)) : committed
        },
        commit: (value) => onPageFontSizeChange(Number(value))
      },
      // 快捷键：**每一条一行**，从 core 的注册表推出来（加一条快捷键不必来这里改代码）
      ...SHORTCUTS.map((def): DeferredField => ({
        id: `shortcut-${def.id}`,
        committed: shortcuts[def.id] ?? defaultShortcut(def.id, kind),
        // 草稿可能是「录制中」这个状态，此时不留任何东西；真出草稿时它一定已经是合法规范串
        normalize: (raw, committed) => (raw === '' ? committed : raw),
        commit: (value) => {
          // 【与默认值相同时把这一条抹掉】稀疏表里「显式写回默认值」与「从未改过」对读取方
          // 完全没有区别（`resolveShortcuts` 两者都落到同一个默认值），那就没有理由把表撑大。
          // 点 ↺ 之后这一条消失，正是这个意思。
          const next = { ...shortcuts }
          if (value === defaultShortcut(def.id, kind)) delete next[def.id]
          else next[def.id] = value
          onShortcutsChange(next)
        }
      }))
    ],
    [
      docTitle,
      ratio,
      globalRatio,
      pageFontSize,
      onDocTitleChange,
      setRatio,
      setGlobalRatio,
      onPageFontSizeChange,
      shortcuts,
      onShortcutsChange,
      kind
    ]
  )
  const { drafts, setDraft, blur, dirty, save, reset } = useDeferredSettings(fields)

  /**
   * 冲突检测要比的是**草稿**，不是已提交值。
   *
   * 少了这一层，用户在同一个对话框里把两条改成同一个键时，第二次会看不出冲突（因为已提交
   * 值还没变），保存下去两条就都是它——而引擎里只会有一条生效。
   */
  const resolvedTable = useMemo(() => {
    const raw: Partial<Record<ShortcutId, string>> = { ...shortcuts }
    for (const def of SHORTCUTS) {
      const draft = drafts[`shortcut-${def.id}`]
      if (typeof draft === 'string' && draft !== '') raw[def.id] = draft
    }
    return resolveShortcuts(raw, kind)
  }, [shortcuts, drafts, kind])

  /** 录制键位。**不 preventDefault 掉所有键**——只有认出是组合键、或按 Esc 时才拦。 */
  const handleRecordKey =
    (id: ShortcutId) =>
    (e: ReactKeyboardEvent<HTMLElement>): void => {
      if (recording !== id) return
      if (e.key === 'Escape') {
        // Esc 只是取消录制，值不变。**它同时也是对话框自己的关闭键**——所以必须停在这一层，
        // 否则用户想取消录制会把整个对话框关掉（那一瞬间的草稿全丢）。
        e.preventDefault()
        e.stopPropagation()
        setRecording(null)
        return
      }
      const chord = toChord(e.nativeEvent)
      if (chord === null) return
      const spec = fromChord(chord)
      if (spec === null) {
        notify('必须带一个修饰键（⌘/Ctrl/Alt），而且键位要在支持范围内')
        return
      }
      const problem = shortcutProblem(spec, kind)
      if (problem === 'reserved') {
        notify('这个组合被 macOS 的系统菜单占用了（退出 / 关闭 / 复制粘贴等）')
        return
      }
      const clash = findConflict(resolvedTable, spec, id)
      if (clash !== null) {
        const label = SHORTCUTS.find((d) => d.id === clash)?.label ?? clash
        notify(`与「${label}」冲突`)
        return
      }
      e.preventDefault()
      setDraft(`shortcut-${id}`, spec)
      setRecording(null)
    }

  // 每次打开都从当前值起稿：上次关掉时没保存的草稿不该留到下一次（关闭＝丢弃，是刻意的）
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  /**
   * 切页＝放弃正在进行的录制。
   *
   * 录制框在「快捷键设置」那一页上，切走就再也看不见它了；留着录制态只会让分发器一直
   * 哑着，而用户完全看不出为什么快捷键忽然失效。这是既有语义（点别处＝放弃录制，见录制
   * 框的 `onBlur`）的直接延伸。
   */
  useEffect(() => {
    setRecording(null)
  }, [page])

  /**
   * 三个带夹紧的数字格（比例两格 + 正文字号）共用的失焦处理：只归一化、不提交；
   * **被夹紧了才提示**（普通改个数字不该弹东西）。
   *
   * 【为什么抽出来】三格逻辑一模一样，只有 id、夹紧函数与边界不同。复制三份的话，
   * 提示的文案或边界一改就容易漏一处。
   */
  const blurClamped =
    (
      id: 'ratio' | 'global-ratio' | 'page-font-size',
      clamp: (n: number) => number,
      lo: number,
      hi: number,
      label: string
    ) =>
    (e: FocusEvent<HTMLInputElement>): void => {
      const raw = e.currentTarget.value
      const after = blur(id)
      const parsed = Number.parseInt(raw, 10)
      if (Number.isFinite(parsed) && String(clamp(parsed)) !== String(parsed)) {
        notify(`${label}已夹紧到 ${lo}–${hi} 范围：${after}`)
      }
    }

  /** 保存：提交所有有改动的项，并给一条提示（不然点完没有任何反馈） */
  const handleSave = (): void => {
    if (!dirty) return
    save()
    notify('已保存')
  }

  /**
   * Esc 关闭。
   *
   * 【挂在 window 上收得到】InputCapture 在「纯按键」模式下对 `NON_CHAR_KEYS` 里的键
   * （Escape 在列）直接放行，输入法模式下更是完全不拦 keydown，所以这个键不会被抽字
   * 逻辑吃掉。反过来，对话框开着时焦点在对话框里（见下面的 `autoFocus`），隐藏 textarea
   * 根本收不到这些按键。
   */
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  /**
   * 关掉时把键盘焦点还给阅读区的隐形输入框。
   *
   * 【少了这一步，关掉对话框之后用户打不出字——而单测一字不差地全绿】：模态期间焦点在
   * 对话框里，关闭后浏览器把它交还给 `body`，而 InputCapture 只在「挂载时」和「点击
   * 页面其它地方时」抢焦点（它现在还会跳过整个对话框）——于是用户敲键盘什么都不会发生，
   * 得先拿鼠标在阅读区点一下。jsdom 没有真实的焦点移交，这条分支在 vitest 里是空转。
   *
   * 【用 preventScroll 与 InputCapture 自己一致】：不这样的话浏览器会把光标所在处滚进
   * 视野，等于关个设置就把用户的阅读位置跳一下。
   *
   * 查询用 `[data-testid]` 而不是给 InputCapture 加一个 ref 参数：与 App 里那段跟随
   * 滚动同样的取舍——不改别人的公开接口。空状态下（没有小说）根本没有这个元素，
   * 可选链吞掉。
   */
  useEffect(() => {
    if (open) return
    document.querySelector<HTMLElement>('[data-testid="input-capture"]')?.focus({ preventScroll: true })
  }, [open])

  if (!open) return null

  return (
    <div
      className="wt-modal"
      data-testid="settings"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wt-settings-title"
      // 只有点在遮罩自己身上才关：点在面板（及面板里的空白）上时 target 是面板，不是这里。
      // 用 click 而不是 mousedown：从面板里按下、拖出遮罩再松开不该算作「点了遮罩」。
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="wt-modal__panel">
        <div className="wt-modal__header">
          <span className="wt-modal__title" id="wt-settings-title">
            <IconSettings className="wt-modal__title-icon" />
            选项
          </span>
          <button
            type="button"
            className="wt-modal__close"
            data-testid="settings-close"
            aria-label="关闭"
            title="关闭 (Esc)"
            onClick={onClose}
          >
            <IconClose className="wt-modal__close-icon" />
          </button>
        </div>

        <div className="wt-modal__main">
          {/*
            左栏。`role="tablist"` + `aria-orientation="vertical"` 是 ARIA 垂直页签的标准写法。
            `tabIndex` 是 roving 的：只有选中的那一项在 Tab 顺序里，从它往右一按 Tab 就进内容区。
          */}
          <div
            className="wt-modal__nav"
            role="tablist"
            aria-orientation="vertical"
            aria-label="设置分类"
          >
            {PAGES.map((p) => {
              const active = page === p.id
              const PageIcon = p.icon
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  id={`wt-tab-${p.id}`}
                  aria-selected={active}
                  aria-controls={`wt-tabpanel-${p.id}`}
                  tabIndex={active ? 0 : -1}
                  className={`wt-nav__item${active ? ' wt-nav__item--active' : ''}`}
                  data-testid={`settings-tab-${p.id}`}
                  ref={(el) => {
                    tabRefs.current[p.id] = el
                  }}
                  onKeyDown={handleNavKeyDown}
                  onClick={() => setPage(p.id)}
                >
                  {/* 选中时图标换成实心——与功能区那些切换按钮、以及下面外观那组同一套语义 */}
                  <PageIcon filled={active} className="wt-nav__icon" />
                  {p.label}
                </button>
              )
            })}
          </div>

          <div className="wt-modal__body">
            {/*
              三个面板**都渲染**，非当前页加 `hidden`。
              条件渲染的话，本文件与 ribbon.test.tsx 里 40 多处跨页取元素的断言全都要先切页，
              而且「打开时焦点落在文档名上（autoFocus）」那条会当场坏。
              `hidden` 也是 ARIA tabs 对非当前 tabpanel 的标准做法。

              【`.wt-tabpanel[hidden] { display: none }` 那条 CSS 不能少】`hidden` 属性
              本身不带样式，它靠的是 UA 默认样式表里的 `[hidden] { display: none }`；
              而 `.wt-tabpanel` 自己设了 `display: flex`，会把那条盖掉。见 Task 2。
            */}
            <div
              className="wt-tabpanel"
              role="tabpanel"
              id="wt-tabpanel-reading"
              aria-labelledby="wt-tab-reading"
              data-testid="settings-tabpanel-reading"
              hidden={page !== 'reading'}
            >
              <div className="wt-modal__row">
                <span className="wt-modal__label">
                  <IconRename className="wt-modal__label-icon" />
                  文档名
                </span>
                <input
                  className="wt-modal__text"
                  data-testid="doc-title-input"
                  aria-label="文档名"
                  // 打开即聚焦：焦点留在对话框里，用户随手敲的键就不会漏进小说（见 InputCapture
                  // 里那条 role="dialog" 的闸）。它同时是「第一个输入框」，Tab 顺序从这里开始。
                  autoFocus
                  value={drafts['doc-title'] ?? docTitle}
                  onChange={(e) => setDraft('doc-title', e.target.value)}
                  // 失焦只归一化（去两侧空白），**不提交**——生效要等「保存」
                  onBlur={() => blur('doc-title')}
                  // 回车＝保存：原先它触发提交，现在留着这个例外会和「保存」按钮打架
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave()
                  }}
                />
              </div>

              <div className="wt-modal__row">
                <span className="wt-modal__label">
                  <IconFontSize className="wt-modal__label-icon" />
                  阅读替换
                </span>
                {/*
                  两格：**全局**（新导入的书取它当起点）与**当前书**（真正生效的那个）。
                  顺序刻意是全局在前——它是兜底，当前书才是引擎在用的。两格都归「手动保存」，
                  点保存才生效。
                */}
                <div className="wt-ratio-pair">
                  <div className="wt-ratio-line">
                    <span className="wt-ratio__caption">全局</span>
                    <span className="wt-ratio__label">1 键显示</span>
                    <input
                      className="wt-ratio__input"
                      data-testid="global-ratio-input"
                      aria-label="全局比例：新导入的书 / 工作文档，输入 1 个字显示多少字"
                      inputMode="numeric"
                      value={drafts['global-ratio'] ?? String(globalRatio)}
                      onChange={(e) => setDraft('global-ratio', e.target.value)}
                      onBlur={blurClamped('global-ratio', clampRatioInput, MIN_RATIO, MAX_RATIO, '比例')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSave()
                      }}
                    />
                    <span className="wt-ratio__label">字</span>
                    <span className="wt-ratio__note">新导入的书用它</span>
                  </div>
                  <div className="wt-ratio-line">
                    <span className="wt-ratio__caption">当前书</span>
                    <span className="wt-ratio__label">1 键显示</span>
                    <input
                      className="wt-ratio__input"
                      data-testid="ratio-input"
                      aria-label="当前书比例：输入 1 个字显示文档多少字"
                      inputMode="numeric"
                      // 没有文档就没有「当前书」——禁用而不是藏起来，免得两格一隐一现地跳
                      disabled={!novelOpen}
                      value={drafts['ratio'] ?? String(ratio)}
                      onChange={(e) => setDraft('ratio', e.target.value)}
                      onBlur={blurClamped('ratio', clampRatioInput, MIN_RATIO, MAX_RATIO, '比例')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSave()
                      }}
                    />
                    <span className="wt-ratio__label">字</span>
                    {!novelOpen && <span className="wt-ratio__note">未打开文档</span>}
                  </div>
                </div>
              </div>

              <div className="wt-modal__row">
                <span className="wt-modal__label">
                  <IconKeyboard className="wt-modal__label-icon" />
                  输入模式
                </span>
                <button
                  type="button"
                  className={`wt-btn ${mode === 'ime' ? 'wt-btn--active' : ''}`}
                  data-testid="mode-button"
                  title="切换输入模式：输入法友好 / 纯按键"
                  aria-pressed={mode === 'ime'}
                  onClick={() => {
                    const next = mode === 'ime' ? 'key' : 'ime'
                    setMode(next)
                    notify(next === 'ime' ? '已切换：输入法友好模式' : '已切换：纯按键模式')
                  }}
                >
                  {mode === 'ime' ? '输入法' : '纯按键'}
                </button>
              </div>

              <div className="wt-modal__row">
                {/*
                  正文字号：**归「手动保存」那一组**，与文档名、阅读替换同一条路——改完点保存
                  才生效。只作用于小说与 .txt 工作文档；md 那条路的字号是照着 Word 的标题层级
                  写死的，跟着缩会把层级弄散（见 page.css 里 .wt-page__novel 那段说明）。
                */}
                <span className="wt-modal__label">
                  <IconFontSize className="wt-modal__label-icon" />
                  正文字号
                </span>
                <input
                  className="wt-ratio__input"
                  data-testid="page-font-size-input"
                  aria-label={`正文字号：${PAGE_FONT_SIZE_MIN}–${PAGE_FONT_SIZE_MAX} 像素`}
                  inputMode="numeric"
                  value={drafts['page-font-size'] ?? String(pageFontSize)}
                  onChange={(e) => setDraft('page-font-size', e.target.value)}
                  onBlur={blurClamped(
                    'page-font-size',
                    clampPageFontSize,
                    PAGE_FONT_SIZE_MIN,
                    PAGE_FONT_SIZE_MAX,
                    '字号'
                  )}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave()
                  }}
                />
                <span className="wt-ratio__label">px</span>
                <span className="wt-ratio__note">只作用于小说与 .txt</span>
              </div>

              <div className="wt-modal__row">
                <span className="wt-modal__label">
                  <IconBook className="wt-modal__label-icon" />
                  小说
                </span>
                <button
                  type="button"
                  className="wt-btn"
                  data-testid="btn-import"
                  title={`导入小说 (${importButtonShortcut})`}
                  onClick={() => onImport()}
                >
                  <IconImport className="wt-btn__icon" />
                  导入小说
                </button>
                <button
                  type="button"
                  className="wt-btn"
                  data-testid="btn-clear-session"
                  title="清除阅读记录"
                  onClick={() => onClearSession()}
                >
                  <IconClear className="wt-btn__icon" />
                  清除阅读记录
                </button>
              </div>

              <div className="wt-modal__row">
                <span className="wt-modal__label">
                  <IconDocument className="wt-modal__label-icon" />
                  工作文档
                </span>
                {/*
                  按老板键时**不显示小说、显示这一份**。与上面那组一样是立即动作：文件选择框是
                  外部动作，做成「选了文件还得再点保存」很别扭。

                  【坏掉那一路没有名字可写】`workDocBroken` 只有一个置位点：boot 里 `loadWorkDoc`
                  读不出来。而**同一条路上 `workNovel` 必然是 null**，于是 `workDocTitle` 也恒为
                  null。所以这里不能写成 `⚠ ${workDocTitle ?? ''} 读不出来了`——那会渲染出
                  「⚠  读不出来了」这种一个永远填不上的名字位加双空格。
                */}
                <span
                  className={`wt-workdoc__status${workDocBroken ? ' wt-workdoc__status--broken' : ''}`}
                  data-testid="work-doc-status"
                  // 那行会按 CSS 截断（`max-width: 220px` + ellipsis），长路径看不全——悬停给全文。
                  // 没有路径时**不给空 title**（`title=""` 会渲染一个空的小气泡）。
                  title={workDocPath ?? undefined}
                >
                  {workDocBroken
                    ? workDocTitle === null
                      ? '⚠ 工作文档读不出来了'
                      : `⚠ ${workDocTitle} 读不出来了`
                    : (workDocTitle ?? '未导入')}
                </span>
                <button
                  type="button"
                  className="wt-btn"
                  data-testid="btn-import-work-doc"
                  title="导入工作文档（txt / md）"
                  onClick={() => onImportWorkDoc()}
                >
                  <IconImport className="wt-btn__icon" />
                  导入工作文档
                </button>
                {/*
                  【判据为什么是「配了路径」而不是「有名字」】坏掉那一路恒无名字（见上），
                  按名字 gate 的话那个按钮**根本不渲染**——而「文件被移走」正是唯一可达的坏
                  状态，用户于是没有任何入口清掉那个悬空路径，只能靠导入另一份顶掉它。
                */}
                {(workDocTitle !== null || workDocBroken) && (
                  <button
                    type="button"
                    className="wt-btn"
                    data-testid="btn-remove-work-doc"
                    title="移除工作文档"
                    onClick={() => onRemoveWorkDoc()}
                  >
                    <IconClear className="wt-btn__icon" />
                    移除
                  </button>
                )}
              </div>
            </div>

            <div
              className="wt-tabpanel"
              role="tabpanel"
              id="wt-tabpanel-appearance"
              aria-labelledby="wt-tab-appearance"
              data-testid="settings-tabpanel-appearance"
              hidden={page !== 'appearance'}
            >
              <div className="wt-modal__row">
                {/*
                  外观的三选一。**必须走主进程**（见 ipc.ts 里的说明）：只翻页面的 class 的话，
                  macOS 的红绿灯不会跟着变，又会回到「两块颜色对不上」。
                */}
                <span className="wt-modal__label">
                  <IconDarkTheme className="wt-modal__label-icon" />
                  外观
                </span>
                <div className="wt-seg" role="group" aria-label="外观">
                  {THEME_OPTIONS.map((opt) => {
                    const active = themeSource === opt.value
                    const OptIcon = opt.icon
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        className={`wt-btn${active ? ' wt-btn--active' : ''}`}
                        data-testid={`theme-${opt.value}`}
                        aria-pressed={active}
                        onClick={() => onThemeSourceChange(opt.value)}
                      >
                        {/* 选中时图标也换成实心——与功能区那些切换按钮同一套语义 */}
                        <OptIcon filled={active} className="wt-btn__icon" />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="wt-modal__row">
                {/*
                  默认【关】：真 Word 的深色模式里纸张仍是白的，保持这一点伪装才完整。
                  勾上之后阅读区整块也跟着暗下来——夜里看书不刺眼，代价是不再像 Word。
                  只在系统是深色外观下才有意义；浅色外观下勾了也不动（CSS 按组合选择器处理）。
                */}
                <span className="wt-modal__label">
                  <IconDocument className="wt-modal__label-icon" />
                  纸张
                </span>
                <label className="wt-modal__check">
                  <input
                    type="checkbox"
                    data-testid="dark-paper"
                    checked={darkPaper}
                    onChange={(e) => onDarkPaperChange(e.target.checked)}
                  />
                  深色模式下也变暗
                </label>
              </div>
            </div>

            <div
              className="wt-tabpanel"
              role="tabpanel"
              id="wt-tabpanel-shortcuts"
              aria-labelledby="wt-tab-shortcuts"
              data-testid="settings-tabpanel-shortcuts"
              hidden={page !== 'shortcuts'}
            >
              {/* 快捷键：一条一行。加一条只需在 core 的 SHORTCUTS 表里加一行，这里自动跟上。 */}
              {SHORTCUTS.map((def) => {
                const draft = drafts[`shortcut-${def.id}`] ?? shortcuts[def.id] ?? defaultShortcut(def.id, kind)
                const isRecording = recording === def.id
                return (
                  <div className="wt-modal__row" key={def.id}>
                    <span className="wt-modal__label">{def.label}</span>
                    <button
                      type="button"
                      className={`wt-shortcut${isRecording ? ' wt-shortcut--recording' : ''}`}
                      data-testid={`shortcut-${def.id}-input`}
                      aria-label={`${def.label}的快捷键`}
                      onKeyDown={handleRecordKey(def.id)}
                      onBlur={() => {
                        // 点到别处＝放弃这次录制。不这样的话录制态会一直挂着，而分发器也就一直哑着。
                        if (recording === def.id) setRecording(null)
                      }}
                      onClick={() => setRecording(def.id)}
                    >
                      {isRecording ? '请按下组合键…' : formatShortcut(draft, kind)}
                    </button>
                    <button
                      type="button"
                      className="wt-btn"
                      data-testid={`shortcut-${def.id}-reset`}
                      aria-label={`把${def.label}恢复为默认`}
                      onClick={() => {
                        setRecording(null)
                        setDraft(`shortcut-${def.id}`, defaultShortcut(def.id, kind))
                      }}
                    >
                      ↺
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="wt-modal__footer">
          {/*
            保存按钮**只在有未保存改动时出现**：它一出现就是「你有东西没生效」这个信号，
            比一个常驻的灰按钮更说明问题。没改动时点它也没有任何事可做。
          */}
          {dirty && (
            <button
              type="button"
              className="wt-btn wt-btn--primary"
              data-testid="settings-save"
              onClick={handleSave}
            >
              保存
            </button>
          )}
          {/* 第二个关闭入口：标题栏那个 ✕ 是给「找关闭」的眼睛用的，这个是给读完设置的人用的 */}
          <button
            type="button"
            className="wt-btn"
            data-testid="settings-close-footer"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
