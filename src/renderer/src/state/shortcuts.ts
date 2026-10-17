import { useEffect, useRef } from 'react'
import { getApi } from '../api'
import {
  SHORTCUTS,
  defaultShortcut,
  formatShortcut,
  fromChord,
  normalizeSpec,
  platformKind,
  type KeyChord,
  type ResolvedShortcuts,
  type ShortcutId
} from '../../../core/shortcuts'

/** 每一条快捷键对应的动作。表是穷尽的——加了新快捷键，这里不补就编译不过。 */
export type ShortcutActions = Record<ShortcutId, () => void>

/**
 * 从真实事件里挑出 core 要的那五个字段。
 *
 * 【为什么要有这一层】core 没有 DOM lib（`tsconfig.node.json` 的 lib 是 `["ES2023"]`），
 * 所以 `fromChord` 收的是裸字段结构而不是 `KeyboardEvent`。转换放在渲染层，逻辑留在 core
 * 并且能被单测覆盖——两边各得其所。
 *
 * 【为什么要读 e.code 而不是 e.key】`e.key` 会随修饰键与键盘布局变：按住 Shift 时
 * `','` 变成 `'<'`，非 QWERTY 布局下字母还可能是别的字符。`e.code` 按物理按键位置判定，
 * 不受这两件事影响。本仓库的 `ChapterList` 与 `Ribbon` 早就是这么做的。
 *
 * 【合成期间一律返回 null】那一下的按键属于输入法（选词、翻页都可能是组合键），把它当成
 * 快捷键会打断候选框。这条与 CLAUDE.md 里「合成期间不能碰 textarea」是同一个道理的另一面。
 *
 * 【但 `e.isComposing` 只在「监听原生事件」这个前提下成立】分发器挂在 `window` 上，收到的
 * 就是真 DOM 事件，所以这个字段读得到。而 **React 的合成事件不暴露它**（取到的是
 * `undefined`，`InputCapture.tsx` 里记过同一件事），于是这个判断恒假、合成过滤**静默失效**。
 * 真到那一天也不会有一条用例变红：jsdom 里没有真输入法，这条只有真机判得出来。谁要把分发器
 * 挪进 React 的 `onKeyDown`，得自己把这一层补回来（改读 `e.nativeEvent.isComposing`）。
 */
export function toChord(e: KeyboardEvent): KeyChord | null {
  if (e.isComposing) return null
  return { code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey }
}

/**
 * 宿主平台。**现取而不是在模块顶层缓存**：与 `Ribbon.tsx` 的 `hostPlatform` 同一个理由
 * ——缓存等于把「preload 一定在模块加载前注入」写死进加载顺序，一旦不成立就是永久错的。
 * 缺桥时按 `'other'` 走：宁可显示成 Windows 那一套，也不要因为一个读不到的值把界面炸掉。
 *
 * 【为什么这里也有一份】本模块（渲染层的快捷键模块）与 `Ribbon` 都要读它，而两者谁都不是
 * 对方的祖先。写得只有两行，比为此把它们拧成依赖关系划算。
 */
function hostPlatform(): string {
  return getApi()?.platform ?? 'other'
}

/**
 * 某条快捷键**在宿主平台上的默认值**，已经格式化成可以直接显示的文本。
 *
 * 【为什么需要它】`Page` / `ChapterList` 这类组件收到的是**成品文本**（真值住在 `App` 里，
 * 而 App 的接线要晚一步），在那之前它们得显示成该平台的默认值——而组件自己判一遍平台就等于
 * 把这个判断复制成若干份，还容易与 `formatShortcut` 的口径走岔（同一份规范串在两个平台上
 * 的含义不同：`Meta+KeyO` 在 macOS 是 ⌘O、在 Windows 是 Win+O）。
 *
 * 【为什么不能写死一个「Ctrl+O」兜底】那正是本功能要消灭的东西：做这个功能之前，非 darwin
 * 上 `menu.ts` 直接 `setApplicationMenu(null)`、渲染层也没有任何 O 的监听，「或按 Ctrl+O」
 * 在那里是一句**做不到的指引**；macOS 上键也写错了（应是 ⌘O）。
 */
export function defaultShortcutText(id: ShortcutId): string {
  const kind = platformKind(hostPlatform())
  return formatShortcut(defaultShortcut(id, kind), kind)
}

export interface UseShortcutDispatcherOptions {
  /** `window.api.platform` 的原值。决定 macOS 上要把哪一条让给原生菜单。 */
  platform: string
  /** 已经按平台补齐的完整表（`resolveShortcuts` 的结果） */
  table: ResolvedShortcuts
  actions: ShortcutActions
  /** false 时整个静音。设置对话框录制期间必须置 false，否则录 ⌘O 会当场触发一次真导入。 */
  enabled: boolean
}

/**
 * 全局快捷键分发器。
 *
 * 【为什么挂在 window 上还能收到】`InputCapture` 在「纯按键」模式下对**带修饰键的组合键**
 * 是直接放行的（它的 handleKeyDown 里 `if (e.ctrlKey || e.metaKey || e.altKey) return`），
 * 输入法模式下更是完全不拦截 keydown——所以这些组合不会被抽字逻辑吃掉。反过来，分发器也
 * **只认带修饰键的组合**：裸按键一律放行，它们要去做抽字。
 *
 * 【macOS 上必须把 import 让出去】菜单 accelerator 一旦设置，按键就被菜单消费并触发 click；
 * 分发器若也监听同一个键，用户选一次文件会**导入两次**。所以「一条快捷键只在一个地方执行」
 * 是硬规则，见设计文档第 6 节那张表。
 */
export function useShortcutDispatcher({
  platform,
  table,
  actions,
  enabled
}: UseShortcutDispatcherOptions): void {
  // 表与动作都挂在 ref 上，让监听器的身份保持稳定：依赖一变就要解绑重绑，而重绑之间那
  // 一瞬间的按键会漏掉。渲染期写 ref 是本仓库既有的写法（见 App.tsx 的 novelEngineRef）。
  const stateRef = useRef({ platform, table, actions, enabled })
  stateRef.current = { platform, table, actions, enabled }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const current = stateRef.current
      if (!current.enabled) return
      // 默认就带修饰键的直接放行，省掉一次 chord 构造（这是每次按键都要走的路）
      if (!e.ctrlKey && !e.metaKey && !e.altKey) return
      const chord = toChord(e)
      if (chord === null) return
      const spec = fromChord(chord)
      if (spec === null) return
      const kind = platformKind(current.platform)
      for (const def of SHORTCUTS) {
        // macOS 的 import 归原生菜单管，这里跳过——两边都管会双触发
        if (kind === 'darwin' && def.id === 'import') continue
        if (normalizeSpec(current.table[def.id]) !== spec) continue
        e.preventDefault()
        current.actions[def.id]()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
