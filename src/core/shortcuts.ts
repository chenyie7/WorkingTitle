/**
 * 快捷键的唯一事实来源。
 *
 * 【为什么要有一张表】做这个功能之前，快捷键的**实现**散在三个组件里（各自
 * `window.addEventListener('keydown')` + 硬编码键位），**文案**散在四处，且没有一处做
 * 平台判断——于是「或按 Ctrl+O」在 Windows 上是一句**做不到的指引**（`menu.ts` 对非
 * darwin 直接 `setApplicationMenu(null)`，渲染层也没有任何 O 的监听），在 macOS 上则把
 * 键写错了（应是 ⌘O）。一张表 + 一组纯函数之后，加一条快捷键是加一行、改文案是调一个
 * 函数。
 *
 * 【本文件不能碰 DOM，也不能读 process】`tsconfig.node.json` 的 lib 是 `["ES2023"]`、
 * 没有 DOM，而它 include 了 src/core。所以这里**不能**出现 `KeyboardEvent`——录制用的解析
 * 只吃 `KeyChord` 这个裸字段结构，适配由渲染层做。同理也不能读 `process`：那是 node 的
 * 东西，而 core 要能被渲染进程共用。
 */

/** 只区分「macOS」与「其它」：本应用只对 macOS 用原生菜单，键位习惯也只有这两套。 */
export type PlatformKind = 'darwin' | 'other'

export function platformKind(raw: string): PlatformKind {
  return raw === 'darwin' ? 'darwin' : 'other'
}

export type ShortcutId =
  | 'import'
  | 'toggle-sidebar'
  | 'open-settings'
  | 'boss-key'
  | 'boss-fill-up'
  | 'boss-fill-down'

export interface ShortcutDef {
  id: ShortcutId
  /** 设置界面里的行标题；冲突提示也用它 */
  label: string
  defaults: { darwin: string; other: string }
}

/**
 * 全部快捷键。**加一条就是加一行**——设置界面、分发器、文案都是从这张表推出来的。
 */
export const SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: 'import',
    label: '导入小说',
    // Windows 上这条此前是**死的**：没有菜单就没有 accelerator，渲染层也没人监听 O。
    // 改成渲染层分发之后它才第一次真的能用。
    defaults: { darwin: 'Meta+KeyO', other: 'Ctrl+KeyO' }
  },
  {
    id: 'toggle-sidebar',
    label: '显示/隐藏章节栏',
    defaults: { darwin: 'Meta+Shift+KeyH', other: 'Ctrl+Shift+KeyH' }
  },
  {
    id: 'open-settings',
    label: '打开设置',
    defaults: { darwin: 'Meta+Comma', other: 'Ctrl+Comma' }
  },
  {
    id: 'boss-key',
    label: '老板键',
    // 三条都刻意不进 RESERVED 清单：那张清单拦的是 macOS 原生菜单 role 与系统约定占掉的键
    // （⌘Q / ⌘W / ⌘C…），这三条不是。KeyB / ArrowUp / ArrowDown 都在 KEY_CODES 白名单里。
    defaults: { darwin: 'Meta+Shift+KeyB', other: 'Ctrl+Shift+KeyB' }
  },
  {
    id: 'boss-fill-up',
    label: '老板键铺满 +',
    defaults: { darwin: 'Meta+Shift+ArrowUp', other: 'Ctrl+Shift+ArrowUp' }
  },
  {
    id: 'boss-fill-down',
    label: '老板键铺满 −',
    defaults: { darwin: 'Meta+Shift+ArrowDown', other: 'Ctrl+Shift+ArrowDown' }
  }
]

/** 修饰键的**规范顺序**。规范串一律按这个顺序拼，比较时才不会「同一个键两种写法」。 */
const MODIFIERS = ['Meta', 'Ctrl', 'Alt', 'Shift'] as const
type Modifier = (typeof MODIFIERS)[number]

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const DIGITS = '0123456789'.split('')

/**
 * 可录制的键位白名单：`e.code` → Electron accelerator 里的键名。
 *
 * 【为什么限死一张表】accelerator 表达不了所有 `e.code`（`IntlBackslash` / `IntlRo` 之类
 * 根本没有对应写法——实测 `globalShortcut.register('Cmd+IntlRo')` 直接 conversion
 * failure）。限死之后 `toAccelerator` **永远不会失败**，于是「哪条快捷键由谁执行」可以是
 * 一张静态表，不需要「这条能不能进菜单」的运行时判断。
 */
const KEY_CODES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(LETTERS.map((c) => [`Key${c}`, c])),
  ...Object.fromEntries(DIGITS.map((d) => [`Digit${d}`, d])),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, `F${i + 1}`])),
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
  Enter: 'Return',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

/**
 * 键位在白名单里吗。**必须用 hasOwn**：`in` 会走原型链，于是 'toString' / '__proto__' 这类
 * 也会被判成「在白名单里」，手改过的 settings.json 就能把某条快捷键换成一条 Electron 解析
 * 不了的死键（而菜单对非法 accelerator 是静默接受的）。
 */
function isRecordable(code: string): boolean {
  return Object.hasOwn(KEY_CODES, code)
}

/**
 * 一个组合键。
 *
 * 【与 KeyboardEvent 是两回事】这里只有本模块用得上的字段——渲染层负责从真实事件里挑出
 * 它们（见 `renderer/src/state/shortcuts.ts` 的 `toChord`）。**必须是裸字段而不是 DOM 类型**：
 * core 没有 DOM lib，收 `KeyboardEvent` 会直接编译不过，而那正是纯净性门禁在防的事。
 */
export interface KeyChord {
  /** `e.code`，如 'KeyO' / 'Comma' / 'F5' */
  code: string
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
}

/** 一个组合键为什么不能用；能用返回 null。 */
export type ChordProblem = 'no-modifier' | 'unsupported-key' | 'reserved' | null

function hasModifier(chord: KeyChord): boolean {
  return chord.meta || chord.ctrl || chord.alt || chord.shift
}

/**
 * macOS 上不给用的键，两类：
 *
 *  - **本应用菜单里 role 正在用的、抢过来最难受的那八个**（`menu.ts` 一共有 17 个 role，
 *    只收这八个的取舍见设计文档 §9）：⌘Q 退出 / ⌘W 关闭 / ⌘H 隐藏 / ⌘X 剪切 / ⌘C 复制 /
 *    ⌘V 粘贴 / ⌘A 全选 / ⌘Z 撤销。抢过来会把对应的菜单功能废掉。
 *  - **macOS 系统的**：⇧⌘Q 退出登录、⌘M 最小化。它们不在我们的菜单里（`menu.ts` 没有
 *    `minimize` role），但应用级 accelerator 一样会把系统约定顶掉。
 *
 * 【录制时和读盘时都要过】只在录制端拦等于没拦——手工改过 settings.json 的人同样塞得进来。
 * 这也是 `resolveShortcuts` 要逐条走校验、而不是直接信磁盘上那个串的原因。
 */
const RESERVED: Readonly<Record<PlatformKind, readonly string[]>> = {
  darwin: [
    // ⇧⌘Q 是系统的「退出登录」：它和 ⌘Q 是同一类，抢过来会在本应用获得焦点时把它顶掉
    'Meta+KeyQ',
    'Meta+Shift+KeyQ',
    'Meta+KeyW',
    'Meta+KeyM',
    'Meta+KeyH',
    'Meta+KeyC',
    'Meta+KeyV',
    'Meta+KeyX',
    'Meta+KeyA',
    'Meta+KeyZ'
  ],
  // Windows / Linux 不设保留清单：`menu.ts` 对非 darwin 直接 `setApplicationMenu(null)`，那里
  // 一条菜单都没有，「抢了菜单 role」这件事不存在；⇧⌘Q 那类系统约定也没有对应物（Windows 没有
  // 「退出登录」键）。**⌘M 不能照此说**——`Win+M` 在 Windows 上就是「最小化所有窗口」，通常被
  // 外壳先吃掉、应用收不到；而这一条**未在 Windows 上实测**（本机只有 macOS）。
  //
  // Ctrl+C/V/X/A/Z 在这里**不是没有代价**：分发器命中即 `preventDefault`，没有可编辑元素豁免
  // （`InputCapture` 的 `TEXT_INPUT_SELECTOR` 是抢焦点那条路的，与分发器无关），所以用户录了
  // `Ctrl+V` 之后，往设置里的文档名粘贴会失效、在阅读区粘贴则会变成抽字。仍然不设清单的理由是
  // 代价可撤回：设置对话框还有第二条入口（工具栏那个「设置」按钮），把 `Ctrl+,` 录成别的也锁不
  // 死自己，再录一次就拿得回来；macOS 那条清单拦的是「抢走 ⌘Q 之后应用给不回来」的能力。
  other: []
}

/** 组合键 → 规范串；不合法返回 null。顺序固定，所以它同时是**归一化**。 */
export function fromChord(chord: KeyChord): string | null {
  if (!isRecordable(chord.code)) return null
  if (!hasModifier(chord)) return null
  const parts: Modifier[] = []
  // 按 MODIFIERS 的固定顺序 push，出来的串就与用户怎么按无关
  if (chord.meta) parts.push('Meta')
  if (chord.ctrl) parts.push('Ctrl')
  if (chord.alt) parts.push('Alt')
  if (chord.shift) parts.push('Shift')
  return [...parts, chord.code].join('+')
}

/** 规范串 → 组合键；解析不了返回 null。 */
export function parseShortcut(spec: string): KeyChord | null {
  const parts = spec.split('+')
  if (parts.length < 2) return null
  const code = parts[parts.length - 1]
  if (!isRecordable(code)) return null
  const mods = parts.slice(0, -1)
  // 重复的修饰键（'Meta+Meta+KeyO'）不是合法写法
  if (new Set(mods).size !== mods.length) return null
  const chord: KeyChord = { code, meta: false, ctrl: false, alt: false, shift: false }
  for (const m of mods) {
    if (!(MODIFIERS as readonly string[]).includes(m)) return null
    if (m === 'Meta') chord.meta = true
    else if (m === 'Ctrl') chord.ctrl = true
    else if (m === 'Alt') chord.alt = true
    else chord.shift = true
  }
  if (!hasModifier(chord)) return null
  return chord
}

/** 规范化：同一个组合键的两种写法收敛成一个；解析不了返回 null。 */
export function normalizeSpec(spec: string): string | null {
  const chord = parseShortcut(spec)
  return chord === null ? null : fromChord(chord)
}

/**
 * 校验一个**已经在磁盘上（或刚录下来）的**规范串；能用返回 null。
 *
 * 【为什么不把它并进 fromChord】`fromChord` 的输入是**真实按键事件**（一定带着至少一个
 * 修饰键，否则用户就是在打字），而这里的输入是一个**字符串**，要额外回答「为什么不行」。
 * 两件事的输入形状不同，合并只会给录制那条路塞一个用不上的 platform 参数。
 */
export function shortcutProblem(spec: string, kind: PlatformKind): ChordProblem {
  const normalized = normalizeSpec(spec)
  if (normalized === null) {
    // 解析不了还要再分一层：键位不支持 vs 没带修饰键。这个区分只给 settingsProblem 的日志
    // 用——用户可见的那条提示把两者合成了一句（录制那条路拿到的是 fromChord 的 null）。
    const parts = spec.split('+')
    return isRecordable(parts[parts.length - 1]) ? 'no-modifier' : 'unsupported-key'
  }
  return RESERVED[kind].includes(normalized) ? 'reserved' : null
}

/** 该平台的默认值。设置界面那个 ↺ 用它。 */
export function defaultShortcut(id: ShortcutId, kind: PlatformKind): string {
  // 查不到只可能是 id 的类型被绕过（`as ShortcutId`），那时退回第一条的默认值比抛错好
  // ——设置读不出来不该让应用起不来。
  const def = SHORTCUTS.find((s) => s.id === id) ?? SHORTCUTS[0]
  return def.defaults[kind]
}

/** 完整表：消费方（分发器、菜单、文案）要的那一份。 */
export type ResolvedShortcuts = Record<ShortcutId, string>

/**
 * 稀疏表（磁盘上那份）→ 完整表。**缺条目与坏条目都落到该平台的默认值。**
 *
 * 【为什么逐条走校验而不是直接信】磁盘上那个串可能是手工改过的、也可能带着 macOS 的保留
 * 键。只在录制端拦等于没拦（见 RESERVED 的说明）。
 */
export function resolveShortcuts(
  raw: Partial<Record<ShortcutId, string>>,
  kind: PlatformKind
): ResolvedShortcuts {
  const out = {} as ResolvedShortcuts
  for (const def of SHORTCUTS) {
    const stored = raw[def.id]
    // 归一化过的非 null 值不可能再是 unsupported-key / no-modifier（键位与修饰键都查过了），
    // 所以这里剩下的只可能是 reserved 一种问题——不必再拿字符串当哨兵。
    const normalized = typeof stored === 'string' ? normalizeSpec(stored) : null
    out[def.id] =
      normalized !== null && shortcutProblem(normalized, kind) === null
        ? normalized
        : def.defaults[kind]
  }
  return out
}

/**
 * 显示用的文本：macOS 用符号（⌃⌥⇧⌘）、其它平台用词（Ctrl+Alt+Shift+Win+）。
 *
 * 【为什么分平台】同一份规范串在两个平台上**含义不同**——`Meta+KeyO` 在 macOS 是 ⌘O，
 * 在 Windows 是 Win+O。显示必须跟着平台走，否则用户看到的和他按下去的不是一回事。
 */
export function formatShortcut(spec: string, kind: PlatformKind): string {
  const chord = parseShortcut(spec)
  if (chord === null) return spec
  const key = KEY_CODES[chord.code]
  if (kind === 'darwin') {
    // Apple 的惯例顺序是 ⌃⌥⇧⌘
    const parts = [
      chord.ctrl ? '⌃' : '',
      chord.alt ? '⌥' : '',
      chord.shift ? '⇧' : '',
      chord.meta ? '⌘' : ''
    ]
    return parts.join('') + key
  }
  const parts: string[] = []
  if (chord.ctrl) parts.push('Ctrl')
  if (chord.alt) parts.push('Alt')
  if (chord.shift) parts.push('Shift')
  if (chord.meta) parts.push('Win')
  return [...parts, key].join('+')
}

/**
 * 喂 Electron 菜单的 accelerator。**只在 macOS 上用得到**（非 darwin 根本没有菜单）。
 *
 * 【为什么它不会失败】键位过了白名单，所以每个合法的规范串都有对应的 accelerator 写法。
 * 这正是「哪条快捷键由谁执行」那张表能保持静态的前提。
 */
export function toAccelerator(spec: string): string | null {
  const chord = parseShortcut(spec)
  if (chord === null) return null
  const parts: string[] = []
  if (chord.meta) parts.push('Cmd')
  if (chord.ctrl) parts.push('Ctrl')
  if (chord.alt) parts.push('Alt')
  if (chord.shift) parts.push('Shift')
  return [...parts, KEY_CODES[chord.code]].join('+')
}

/** 这条快捷键有没有和应用里另一条撞车；撞了就返回那一条的 id。 */
export function findConflict(
  table: ResolvedShortcuts,
  spec: string,
  exceptId: ShortcutId
): ShortcutId | null {
  const want = normalizeSpec(spec)
  if (want === null) return null
  for (const def of SHORTCUTS) {
    if (def.id === exceptId) continue
    if (normalizeSpec(table[def.id]) === want) return def.id
  }
  return null
}
