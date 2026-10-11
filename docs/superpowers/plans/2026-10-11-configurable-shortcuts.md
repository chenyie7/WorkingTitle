# 可配置快捷键 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把散在三处实现、四处硬编码文案、没有平台区分的快捷键收敛成一份注册表——一处定义、按平台自动格式化、可在设置里录制修改、可持久化。

**Architecture:** `src/core/shortcuts.ts` 是唯一的事实来源（注册表 + 纯函数；因 `tsconfig.node.json` 禁 DOM，它只吃裸字段的 `KeyChord`，不收 `KeyboardEvent`，也不读 `process`）。存储用基于 `e.code` 的规范串，`Meta` 与 `Ctrl` 分开存，**稀疏**地放在 `AppSettings.shortcuts` 里（缺条目 = 该平台默认值，`{}` = 全默认）。分发按平台分流：macOS 的 `import` 交给原生菜单 accelerator（跟随设置重建），其余走渲染层分发器——保证**一条快捷键只在一个地方执行**。

**Tech Stack:** Electron 44 / React 19 / TypeScript strict / vitest + jsdom

**依据的设计文档：** `docs/superpowers/specs/2026-10-11-configurable-shortcuts-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/core/shortcuts.ts` | **新增。** 注册表 + 规范串/显示串/accelerator 三种表示的互转 + 校验与冲突查找。纯函数，两个进程共用 |
| `src/core/types.ts` | `AppSettings` 加稀疏的 `shortcuts` 字段 |
| `src/main/sessionStore.ts` | `withRatioFilled` → `withDefaultsFilled`；`settingsProblem` 加对 `shortcuts` 的校验 |
| `src/main/menu.ts` | `buildAppMenu` 加「取快捷键表」入参，`import` 那一项的 accelerator 从表里读 |
| `src/main/ipc.ts` | `saveSettings` handler 写盘后重建菜单 |
| `src/main/index.ts` | 给 `buildAppMenu` 传取值函数 |
| `src/renderer/src/state/shortcuts.ts` | **新增。** 分发器（`window` keydown → 动作表）+ 录制用的 `toChord` |
| `src/renderer/src/components/SettingsDialog.tsx` | 新增「快捷键」一节 + 录制框 |
| `src/renderer/src/components/Page.tsx` | 空状态文案改读注册表 |
| `src/renderer/src/components/ChapterList.tsx` | 去掉自己的 keydown 监听；title 文案改读注册表 |
| `src/renderer/src/components/Ribbon.tsx` | 去掉自己的 ⌘, 监听；把打开设置的动作交给分发器 |
| `src/renderer/src/components/Toolbar.tsx` | 「设置」按钮的 title 改读注册表 |
| `src/renderer/src/App.tsx` | 挂分发器，把三个动作接进去；`shortcuts` 进 settings 载荷 |

---

### Task 1: `src/core/shortcuts.ts` —— 注册表与纯函数

**Files:**
- Create: `src/core/shortcuts.ts`
- Test: `tests/unit/shortcuts.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/shortcuts.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  SHORTCUTS,
  defaultShortcut,
  findConflict,
  formatShortcut,
  fromChord,
  normalizeSpec,
  parseShortcut,
  platformKind,
  resolveShortcuts,
  shortcutProblem,
  toAccelerator,
  type KeyChord
} from '../../src/core/shortcuts'

/** 只写关心的那几个修饰键，其余默认 false。 */
function chord(partial: Partial<KeyChord> & { code: string }): KeyChord {
  return { meta: false, ctrl: false, alt: false, shift: false, ...partial }
}

describe('platformKind', () => {
  it('只把 darwin 认成 darwin，其余一律 other', () => {
    expect(platformKind('darwin')).toBe('darwin')
    expect(platformKind('win32')).toBe('other')
    expect(platformKind('linux')).toBe('other')
    expect(platformKind('')).toBe('other')
  })
})

describe('fromChord', () => {
  it('按固定的修饰键顺序拼出来——同一个键的两种按法得到同一个串', () => {
    // 规范化是这一层唯一的职责：`findConflict` 与 `resolveShortcuts` 都拿它当比较基准，
    // 顺序不固定的话「Meta+Shift+KeyH」与「Shift+Meta+KeyH」会被当成两条不同的快捷键。
    expect(fromChord(chord({ code: 'KeyH', meta: true, shift: true }))).toBe('Meta+Shift+KeyH')
    expect(fromChord(chord({ code: 'KeyH', shift: true, meta: true }))).toBe('Meta+Shift+KeyH')
    expect(fromChord(chord({ code: 'KeyO', ctrl: true, alt: true }))).toBe('Ctrl+Alt+KeyO')
  })

  it('没有修饰键就不合法——这个应用每一次裸按键都要去抽字，录成快捷键等于把打字吃掉', () => {
    expect(fromChord(chord({ code: 'KeyO' }))).toBeNull()
  })

  it('白名单之外的键位不合法——accelerator 表达不了它们', () => {
    expect(fromChord(chord({ code: 'IntlBackslash', meta: true }))).toBeNull()
    expect(fromChord(chord({ code: 'NumpadAdd', meta: true }))).toBeNull()
  })

  it('白名单里的标点与功能键是合法的', () => {
    expect(fromChord(chord({ code: 'Comma', meta: true }))).toBe('Meta+Comma')
    expect(fromChord(chord({ code: 'F5', ctrl: true }))).toBe('Ctrl+F5')
    expect(fromChord(chord({ code: 'ArrowUp', alt: true }))).toBe('Alt+ArrowUp')
  })
})

describe('parseShortcut / normalizeSpec', () => {
  it('往返一致', () => {
    // 【判据必须是双向的】原来写的是 `if (parsed === null) continue`——那让解析器退回 null
    // 反而让用例更绿。实测：把 `Comma` 从白名单里删掉，这条用例仍然 exit 0
    // （1 passed | 30 skipped）。所以这里断言「必须解析得出来」，失败就是失败。
    for (const spec of ['Meta+KeyO', 'Ctrl+Shift+KeyH', 'Meta+Comma', 'Ctrl+Alt+KeyF']) {
      const parsed = parseShortcut(spec)
      expect(parsed, `${spec} 应当解析得出来`).not.toBeNull()
      expect(fromChord(parsed as KeyChord)).toBe(spec)
    }
  })

  it('把乱序写法归一化', () => {
    expect(normalizeSpec('Shift+Meta+KeyH')).toBe('Meta+Shift+KeyH')
  })

  it('解析不了的返回 null', () => {
    expect(normalizeSpec('KeyO')).toBeNull() // 裸键
    expect(normalizeSpec('Meta+Bogus')).toBeNull()
    expect(normalizeSpec('Meta+Meta+KeyO')).toBeNull() // 重复修饰键
    expect(normalizeSpec('')).toBeNull()
  })

  it('原型链上的名字不算白名单内——手改过的 settings.json 塞得进它们', () => {
    for (const code of ['toString', '__proto__', 'constructor', 'valueOf']) {
      expect(normalizeSpec(`Meta+${code}`), `Meta+${code} 不该被当成合法`).toBeNull()
      expect(fromChord(chord({ code, meta: true }))).toBeNull()
    }
  })
})

describe('shortcutProblem', () => {
  it('合法组合返回 null', () => {
    expect(shortcutProblem('Meta+KeyO', 'darwin')).toBeNull()
    expect(shortcutProblem('Ctrl+KeyO', 'other')).toBeNull()
  })

  it('裸键与不支持的键位要分开报——设置界面按理由给不同提示', () => {
    expect(shortcutProblem('KeyO', 'other')).toBe('no-modifier')
    expect(shortcutProblem('Meta+Bogus', 'other')).toBe('unsupported-key')
  })

  it('只在 macOS 上拦保留键', () => {
    // 这些是 menu.ts 里 role 正在用的键，抢过来会废掉退出 / 关闭窗口 / 复制粘贴
    expect(shortcutProblem('Meta+KeyQ', 'darwin')).toBe('reserved')
    expect(shortcutProblem('Meta+KeyQ', 'other')).toBeNull()
  })

  it('保留键的乱序写法也拦得住——比对的是归一化之后的值', () => {
    expect(shortcutProblem('Shift+Meta+KeyQ', 'darwin')).toBe('reserved')
  })

  it('保留清单里的每一条都真的被拦——这是一条策略，不是实现细节', () => {
    // 【为什么值得钉】实测：把其中八条从 RESERVED 里删掉，整个文件仍然 31 passed——
    // 它挡的是「录了 ⌘C 之后用户再也复制不了」这类事故，不能只靠 ⌘Q 一条当代表。
    for (const key of [
      'Meta+KeyQ', 'Meta+Shift+KeyQ', 'Meta+KeyW', 'Meta+KeyM', 'Meta+KeyH',
      'Meta+KeyC', 'Meta+KeyV', 'Meta+KeyX', 'Meta+KeyA', 'Meta+KeyZ'
    ]) {
      expect(shortcutProblem(key, 'darwin'), `${key} 应当是保留键`).toBe('reserved')
      // 同一条在别的平台不该被拦——否则它就不是「macOS 的」清单了
      expect(shortcutProblem(key, 'other')).toBeNull()
    }
  })
})

describe('resolveShortcuts', () => {
  it('缺条目落到该平台的默认值', () => {
    expect(resolveShortcuts({}, 'darwin').import).toBe('Meta+KeyO')
    expect(resolveShortcuts({}, 'other').import).toBe('Ctrl+KeyO')
  })

  it('给了的条目用给的', () => {
    expect(resolveShortcuts({ import: 'Ctrl+KeyI' }, 'other').import).toBe('Ctrl+KeyI')
  })

  it('坏值退回默认值，而不是把坏串放行', () => {
    expect(resolveShortcuts({ import: 'KeyO' }, 'other').import).toBe('Ctrl+KeyO')
    expect(resolveShortcuts({ import: 'Meta+Bogus' }, 'other').import).toBe('Ctrl+KeyO')
  })

  it('macOS 上磁盘里的保留键也退回默认值，不是只在录制端拦', () => {
    expect(resolveShortcuts({ import: 'Meta+KeyQ' }, 'darwin').import).toBe('Meta+KeyO')
  })

  it('乱序写法会被归一化', () => {
    expect(resolveShortcuts({ import: 'Shift+Ctrl+KeyI' }, 'other').import).toBe('Ctrl+Shift+KeyI')
  })

  it('返回的表覆盖注册表里的每一条', () => {
    const out = resolveShortcuts({}, 'other')
    for (const def of SHORTCUTS) expect(typeof out[def.id]).toBe('string')
  })
})

describe('formatShortcut', () => {
  it('macOS 用符号，顺序按 Apple 惯例 ⌃⌥⇧⌘', () => {
    expect(formatShortcut('Meta+KeyO', 'darwin')).toBe('⌘O')
    expect(formatShortcut('Meta+Shift+KeyH', 'darwin')).toBe('⇧⌘H')
    expect(formatShortcut('Ctrl+KeyO', 'darwin')).toBe('⌃O')
  })

  it('其它平台用词', () => {
    expect(formatShortcut('Ctrl+KeyO', 'other')).toBe('Ctrl+O')
    expect(formatShortcut('Ctrl+Shift+KeyH', 'other')).toBe('Ctrl+Shift+H')
    expect(formatShortcut('Meta+KeyO', 'other')).toBe('Win+O')
    expect(formatShortcut('Ctrl+Comma', 'other')).toBe('Ctrl+,')
  })

  it('解析不了的串原样返回——宁可显示得怪，也不要显示成空', () => {
    expect(formatShortcut('Bogus', 'darwin')).toBe('Bogus')
  })
})

describe('toAccelerator', () => {
  it('Meta 在 accelerator 里叫 Cmd', () => {
    expect(toAccelerator('Meta+KeyO')).toBe('Cmd+O')
    expect(toAccelerator('Meta+Shift+KeyH')).toBe('Cmd+Shift+H')
    expect(toAccelerator('Ctrl+Comma')).toBe('Ctrl+,')
    expect(toAccelerator('Alt+F5')).toBe('Alt+F5')
  })

  it('白名单保证了它不会失败——这正是「谁执行」那张表能保持静态的前提', () => {
    for (const def of SHORTCUTS) {
      expect(toAccelerator(def.defaults.darwin)).not.toBeNull()
      expect(toAccelerator(def.defaults.other)).not.toBeNull()
    }
  })
})

describe('findConflict', () => {
  const table = resolveShortcuts({}, 'other')

  it('撞上另一条就返回它的 id', () => {
    expect(findConflict(table, 'Ctrl+Shift+KeyH', 'import')).toBe('toggle-sidebar')
  })

  it('和自己那条不算撞', () => {
    expect(findConflict(table, 'Ctrl+KeyO', 'import')).toBeNull()
  })

  it('不撞时返回 null', () => {
    expect(findConflict(table, 'Ctrl+KeyI', 'import')).toBeNull()
  })

  it('乱序写法也认得出来是同一个键', () => {
    expect(findConflict(table, 'Shift+Ctrl+KeyH', 'import')).toBe('toggle-sidebar')
  })
})

describe('注册表本身', () => {
  it('id 不重复', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('两条平台默认值各自合法', () => {
    for (const def of SHORTCUTS) {
      expect(shortcutProblem(def.defaults.darwin, 'darwin')).toBeNull()
      expect(shortcutProblem(def.defaults.other, 'other')).toBeNull()
    }
  })

  it('默认值之间互不冲突', () => {
    for (const kind of ['darwin', 'other'] as const) {
      const table = resolveShortcuts({}, kind)
      for (const def of SHORTCUTS) {
        expect(findConflict(table, table[def.id], def.id)).toBeNull()
      }
    }
  })

  it('defaultShortcut 取的是该平台的默认值', () => {
    expect(defaultShortcut('open-settings', 'darwin')).toBe('Meta+Comma')
    expect(defaultShortcut('open-settings', 'other')).toBe('Ctrl+Comma')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/shortcuts.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/core/shortcuts"`（文件还不存在）

- [ ] **Step 3: 实现 `src/core/shortcuts.ts`**

创建 `src/core/shortcuts.ts`：

```ts
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

export type ShortcutId = 'import' | 'toggle-sidebar' | 'open-settings'

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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/shortcuts.test.ts`
Expected: PASS，全部用例通过

- [ ] **Step 5: 跑纯净性门禁**

Run: `pnpm typecheck`
Expected: exit 0（`src/core/shortcuts.ts` 里出现 `KeyboardEvent` 或 `process` 会让第二个 tsconfig 报错）

- [ ] **Step 6: 提交**

```bash
git add src/core/shortcuts.ts tests/unit/shortcuts.test.ts
git commit -F /tmp/msg-task1.txt
```

---

### Task 2: 持久化 —— `AppSettings.shortcuts` 与它的校验

**Files:**
- Modify: `src/core/types.ts:93-129`
- Modify: `src/main/sessionStore.ts:148-203`
- Test: `tests/unit/sessionStore.test.ts`（追加）

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/sessionStore.test.ts` 末尾追加。先确认文件顶部已经 `import { DEFAULT_RATIO, defaultSettings } from '../../src/core/types'`（它已经在），并**加一行** `import { resolveShortcuts } from '../../src/core/shortcuts'`：

```ts
describe('shortcuts 字段的向后兼容', () => {
  it('旧版的 settings.json 没有 shortcuts 键，补成空表而不是整份退回默认值', () => {
    // 这是本次改动最容易毁数据的地方：settingsProblem 的取舍是「一个字段不合格就整份退回
    // 默认值」，而 shortcuts 是后加的必填字段——不特殊处理的话，老用户升级一次就把改过的
    // 文档名 / 外观 / 纸张一起丢掉。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        docTitle: '我的文档',
        themeSource: 'dark',
        darkPaper: true,
        lastSourcePath: '/tmp/某本书.txt'
      }),
      'utf8'
    )
    const store = createSessionStore(dir)
    const settings = store.readSettings()
    expect(settings.docTitle).toBe('我的文档')
    expect(settings.themeSource).toBe('dark')
    expect(settings.darkPaper).toBe(true)
    expect(settings.lastSourcePath).toBe('/tmp/某本书.txt')
    expect(settings.shortcuts).toEqual({})
  })

  it('shortcuts 不是对象时整份退回默认值（坏文件，与别处姿态一致）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: 'Meta+KeyO' }),
      'utf8'
    )
    expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
  })

  it('shortcuts 是数组时整份退回默认值', () => {
    // 【为什么要单列一条】`Array.isArray(sc)` 是**独立于** `typeof sc !== 'object'` 的一道
    // 守卫：数组的 typeof 恰好就是 'object'，少了它，`[]` 会被当成「一张合法的空表」放行。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: [] }),
      'utf8'
    )
    expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
  })

  it('shortcuts 是 null 时整份退回默认值，且警告点出是哪个字段', () => {
    // 【为什么要单列一条】`sc === null` 是**独立于** `typeof sc !== 'object'` 的一道守卫——
    // `typeof null` 恰好是 'object'。少了它，null 会走进 `Object.entries(null)` 抛错，
    // 被 readSettingsFile 的 catch 接住，返回值与干净拒绝**一模一样**（两边都是
    // defaultSettings()），差别只在那行警告：干净拒绝报 `shortcuts 不是对象`，
    // 抛异常报 `读取设置失败`。所以断言里必须带上 warn，否则这条用例没有区分能力。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: null }),
      'utf8'
    )
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('shortcuts 不是对象')
    } finally {
      spy.mockRestore()
    }
  })

  it('shortcuts 里某一条的值不是字符串时整份退回默认值，且警告点出是哪一条', () => {
    // 【断言里为什么必须带上那行 warn】只看返回值的话这条用例没有区分能力：把
    // `typeof spec !== 'string'` 这道守卫删掉，非字符串会一路走进 `shortcutProblem`、
    // 在 `spec.split` 上抛 TypeError——而 `readSettingsFile` 的 catch 也返回
    // `defaultSettings()`，于是返回值一模一样，变异体活下来。两边的差别只在那行警告里：
    // 干净拒绝报的是 `shortcuts.import 不是字符串`，抛异常报的是 `读取设置失败`。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { import: 123 } }),
      'utf8'
    )
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
        'shortcuts.import 不是字符串'
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('白名单外的键位整份退回默认值，且警告点出原因', () => {
    // 【这一条钉的是枚举里 `unsupported-key` 那半边】`problem === 'no-modifier'` 由
    // 「没带修饰键」那条用例覆盖，而 `'unsupported-key'` 此前零覆盖。
    //
    // 【拦住这只变异的是**返回值**断言，不是 warn】把枚举收成只剩 `'no-modifier'` 之后，
    // 白名单外的键位会被放行、**原样留在读回来的设置里**——实测红的就是
    // `toEqual(defaultSettings())` 那一行，warn 那行根本走不到。（这一点与上面那条 null
    // 用例相反：那条的变异是被 catch 接住的，返回值两边一样，只能靠 warn 分。）
    //
    // 下面那行 warn 断言钉的是**理由**：它要求这条是在 sessionStore 这一层被判成
    // 「不合法的快捷键（unsupported-key）」并报出来的。少了它，将来有人把这个校验块整个
    // 删掉、改由 core 的 `resolveShortcuts` 事后退默认值，最终生效的表看着一样，日志里却
    // 再也说不出是哪一条、按什么理由退的。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { import: 'Meta+IntlRo' } }),
      'utf8'
    )
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
        'shortcuts.import 不是合法的快捷键（unsupported-key）'
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('shortcuts 里有一条坏串时整份退回默认值', () => {
    // 【为什么是整份而不是只丢那一条】坏串意味着这个文件被人改过或写坏了；设置项全是
    // 可再生的，退回默认值是既有姿态。逐条退让会让「哪几条是我改的」变得无法解释。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { import: 'KeyO' } }),
      'utf8'
    )
    expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
  })

  it('macOS 的保留键**不**导致整份退回——它归 core 按平台逐条处理', () => {
    // 【这一条是钉住两层校验的分工，不是补一条覆盖率】`resolveShortcuts` 的逐条校验要是
    // 永远走不到，它就是纸面路径。保留键是平台相关的，必须**穿过** sessionStore 这一层
    // （它拿不到平台，判不了），到 core 那里才被退回默认值。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        ...defaultSettings(),
        docTitle: '还在',
        shortcuts: { import: 'Meta+KeyQ' }
      }),
      'utf8'
    )
    const settings = createSessionStore(dir).readSettings()
    // 文件本身没被当坏文件，其它字段照旧
    expect(settings.docTitle).toBe('还在')
    expect(settings.shortcuts).toEqual({ import: 'Meta+KeyQ' })
    // 到了 core 这一层才按平台分道扬镳
    expect(resolveShortcuts(settings.shortcuts, 'darwin').import).toBe('Meta+KeyO')
    expect(resolveShortcuts(settings.shortcuts, 'other').import).toBe('Meta+KeyQ')
  })

  it('shortcuts 里的未知 id 不拦——那是更新版本写的，本版本应当照常读', () => {
    // 【这一条的值必须是**结构上非法**的串】原先喂的是 `'Meta+KeyJ'`，它本身就合法，
    // 于是「只校验已知 id」与「一视同仁校验所有 id」两种实现结果一样——用例空转。
    // 换成没带修饰键的 `'KeyJ'` 才有区分能力：`isShortcutId` 那道守卫一旦被去掉，这个
    // 文件就会被当坏文件整份退回，下面第一行断言当场红。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { 'future-thing': 'KeyJ' } }),
      'utf8'
    )
    const settings = createSessionStore(dir).readSettings()
    expect(settings.shortcuts).toEqual({ 'future-thing': 'KeyJ' })
    // 未知 id 不参与解析，所以默认值一条都不受影响
    expect(resolveShortcuts(settings.shortcuts, 'other').import).toBe('Ctrl+KeyO')
  })

  it('合法的 shortcuts 原样读回来', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { import: 'Ctrl+KeyI' } }),
      'utf8'
    )
    expect(createSessionStore(dir).readSettings().shortcuts).toEqual({ import: 'Ctrl+KeyI' })
  })

  it('写进去的 shortcuts 能原样读回来（往返）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    const store = createSessionStore(dir)
    const settings = { ...defaultSettings(), shortcuts: { 'toggle-sidebar': 'Ctrl+Alt+KeyB' } }
    store.writeSettings(settings)
    expect(store.readSettings()).toEqual(settings)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts -t 'shortcuts 字段的向后兼容'`
Expected: FAIL —— `expected undefined to deeply equal {}`（`shortcuts` 字段还不存在）

- [ ] **Step 3: 给 `AppSettings` 加字段**

在 `src/core/types.ts` 里，`import` 区加上（放在文件顶部的类型导入处——本文件目前没有 import，所以加在 `export interface Chapter` 之前）：

```ts
import type { ShortcutId } from './shortcuts'
```

在 `AppSettings` 接口的 `ratio` 字段之后追加：

```ts
  /**
   * 用户改过的快捷键。**稀疏表：缺条目 = 用该平台的默认值**，`{}` 就是「全默认」。
   *
   * 【为什么是稀疏而不是完整表】完整表要求「谁读设置谁就得知道平台」，于是
   * `defaultSettings()` 与 `createSessionStore()` 都得加一个平台参数——而它们在测试里
   * 被调用很多次（**这里刻意不写数**：这个量随测试增长，而本句先后写过的「40 / 15」
   * 「55」「63」「六十多」四个版本，全在写下之后不久就过期了）。稀疏之后这两个函数的签名
   * 一个都不用动，`core` 也不必去读 `process`（那是 node 的东西，而 core 要能被渲染进程
   * 共用）。
   *
   * 【为什么值是规范串而不是 accelerator】得把话说准：**单看现在这三条默认值，
   * `CmdOrCtrl` 是够用的**——三条都只是 Meta↔Ctrl 互换（核 `SHORTCUTS` 即知），所以
   * 「合并成一个记号恰好表达不了各平台不一样」这句在该表上并不成立。扣住这个选择的是
   * 另外两件事：
   *
   * 1. core 这一整套（`KeyChord` / `fromChord` / `parseShortcut` / `RESERVED` /
   *    `formatShortcut`）吃的全是规范串，而 `KEY_CODES` 只提供 `e.code → 键名` 这一个
   *    方向（它的**键**被 `isRecordable` 当白名单用，**值**被 `formatShortcut` 与
   *    `toAccelerator` 当键名用），没有反向表——改存 accelerator 就得再造一张
   *    accelerator → `e.code` 的反查表，否则校验与显示都得重写；
   * 2. `ShortcutDef.defaults` 的形状是 `{ darwin, other }`，它容得下「两个平台根本不是
   *    同一个键」这种默认值，而 `CmdOrCtrl` 只表达得了「同一个键换修饰键」。
   *
   * 于是「只在喂菜单那一刻才转成 accelerator」是这条链上唯一的单向转换点。
   */
  shortcuts: Partial<Record<ShortcutId, string>>
```

在 `defaultSettings()` 的返回对象里补上 `shortcuts: {}`（**注意它仍然是零参的**）。

`shortcuts: {}` 那一行上方写清楚为什么默认是空表：

```ts
    /**
     * 默认的快捷键表：**空**。空的意思是「全用该平台的默认值」，逐条的默认值在
     * `shortcuts.ts` 的 `SHORTCUTS` 表里，由 `resolveShortcuts` 补齐。
     *
     * 【为什么不在这里写死一份】写死就要求这个函数知道平台，而它是零参的
     * （见 AppSettings.shortcuts 的说明）。
     *
     * 【为什么是就地写 `{}` 而不是提一个模块级常量】本函数上面那段说明的就是这件事：
     * 共享常量会被消费方就地改掉（`s.shortcuts.import = 'Meta+KeyI'`），于是「默认值」
     * 在下一次调用时已经变了。每次返回一个新的字面量才是这里要的形状。
     */
    shortcuts: {}
```

- [ ] **Step 4: 把 `withRatioFilled` 泛化成 `withDefaultsFilled`**

在 `src/main/sessionStore.ts` 里，删掉 `withRatioFilled` 整个函数，换成：

```ts
/**
 * 给**旧版**写下的设置补上后来才加的字段。
 *
 * 【为什么不能直接让它按必填校验失败】`ratio` 与 `shortcuts` 都是后加的。旧版写下的
 * settings.json 里没有它们，而校验是「一个字段不合格就整份退回默认值」——那等于：升级
 * 一次，用户改过的文档名 / 外观 / 纸张**一起没了**，只在日志里留一条 warn。
 *
 * 【判据是「键不存在」而不是「值是 undefined」】后者在 JSON 里从来写不出来，而前者正是
 * 旧版本留下的形状。值不合法仍然整份退回——那是坏文件，不是旧文件。
 *
 * 【为什么是「缺哪个键补哪个」而不是给每个字段配一个专用函数】`ratio` 那次就是专用函数。
 * 再来一个 `withShortcutsFilled` 之后，下一次加字段还是得记得写第三个；写成一张表就没有
 * 这个「记得」了。
 */
const FILLED_DEFAULTS = {
  ratio: () => defaultSettings().ratio,
  shortcuts: () => defaultSettings().shortcuts
} satisfies Readonly<Partial<Record<keyof AppSettings, () => unknown>>>

function withDefaultsFilled(v: unknown): unknown {
  if (typeof v !== 'object' || v === null) return v
  const record = v as Record<string, unknown>
  const filled: Record<string, unknown> = { ...record }
  for (const [key, make] of Object.entries(FILLED_DEFAULTS)) {
    if (!(key in record)) filled[key] = make()
  }
  return filled
}
```

再把 `readSettingsFile` 里的注释与调用改掉：

```ts
    // 先给旧版记录补上后来才加的字段，再按必填校验（见 withDefaultsFilled 的说明）
    const filled = withDefaultsFilled(parsed)
```

- [ ] **Step 5: 给 `settingsProblem` 加 `shortcuts` 校验**

在 `src/main/sessionStore.ts` 里，`settingsProblem` 的 `ratio` 那两行之后追加：

```ts
  const sc = s.shortcuts
  if (typeof sc !== 'object' || sc === null || Array.isArray(sc)) return 'shortcuts 不是对象'
  for (const [id, spec] of Object.entries(sc as Record<string, unknown>)) {
    if (typeof spec !== 'string') return `shortcuts.${id} 不是字符串`
    // 未知 id 刻意**不拦**：那是更新版本写的，本版本应当照常读、照常写回去。
    // 已知 id 则必须能解析——解析不了说明这个文件被改坏了。
    // 【只拦结构问题，不拦保留键】解析不了 / 没带修饰键 → 这个文件被改坏了，与其它字段
    // 一样整份退回；保留键是**平台相关**的，而这一层拿不到平台，只能交给 core 的
    // `resolveShortcuts` 按平台逐条退回默认值。
    //
    // 【那个 'darwin' 是惰性的，别试图「修正」它】`shortcutProblem` 的 `no-modifier` /
    // `unsupported-key` 两个出口在**查保留清单之前**就返回了，与 kind 无关；所以这里传
    // 什么都一样，真正吃重的是下面这个枚举。写成枚举而不是 `!== 'reserved'`，就是为了
    // 让这件事在调用点上自明。
    if (isShortcutId(id)) {
      const problem = shortcutProblem(spec, 'darwin')
      if (problem === 'no-modifier' || problem === 'unsupported-key') {
        return `shortcuts.${id} 不是合法的快捷键（${problem}）`
      }
    }
  }
```

并在文件顶部加：

```ts
import { SHORTCUTS, shortcutProblem, type ShortcutId } from '../core/shortcuts'

/** 磁盘上那个 id 是不是本版本认识的。不认识的照常放行（见 settingsProblem 里的说明）。 */
function isShortcutId(id: string): id is ShortcutId {
  return SHORTCUTS.some((def) => def.id === id)
}
```

> **注意 `'darwin'` 这个写死值，以及为什么把 `'reserved'` 排除在外。** 这里要的是「这个串
> 本身是不是坏的」——解析不了或没带修饰键，都是文件被改坏的证据，与其它字段一样整份退回。
> 而**保留键不是坏文件**：它是平台相关的，`settingsProblem` 拿不到平台（加了参数就得让
> `createSessionStore` 多一个入参，那正是稀疏表要避免的事），所以放它过去、由 core 的
> `resolveShortcuts` 按平台逐条退回默认值。
>
> 【这条划分必须守住，否则会有一层校验变成摆设】要是这里把保留键也拦了，`resolveShortcuts`
> 的逐条校验在真机路径上就永远走不到——`tests/unit/shortcuts.test.ts` 里「macOS 上磁盘里的
> 保留键也退回默认值」那条描述的路径只在单测里成立。
>
> 【那个 `'darwin'` 是**惰性**的实参，别试图「修正」它】`shortcutProblem` 的两个结构性出口
> （`no-modifier` / `unsupported-key`）在**查保留清单之前**就返回了，与 `kind` 无关——所以
> 这个调用点上传 `'darwin'` 还是 `'other'`，结论完全相同。真正吃重的是那个**枚举**：写成
> `problem === 'no-modifier' || problem === 'unsupported-key'` 而不是 `problem !== 'reserved'`，
> 为的就是让「只拦结构问题」这件事在调用点上自明，而不是靠读者知道 `kind` 影响哪些出口。
> （本段原稿写的是「传 darwin 是因为它是保留清单更严的一侧」，那个理由在该函数实现下不成立。）
>
> 下面那两条用例（坏串整份退回 / 保留键不整份退回）正是钉住这条划分的。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: PASS，含本节新加的全部用例（**别在这里写条数**——那个 describe 会随评审继续加）

- [ ] **Step 7: 跑全量门禁**

Run: `pnpm typecheck && pnpm test`
Expected: 两个都 exit 0

- [ ] **Step 8: 提交**

```bash
git add src/core/types.ts src/main/sessionStore.ts tests/unit/sessionStore.test.ts
git commit -F /tmp/msg-task2.txt
```

---

### Task 3: 菜单跟随设置（macOS）

**Files:**
- Modify: `src/main/menu.ts:7`、`src/main/menu.ts:46-53`
- Modify: `src/main/ipc.ts:62-64`
- Modify: `src/main/index.ts:154`

- [ ] **Step 1: 给 `buildAppMenu` 加「取快捷键表」入参**

在 `src/main/menu.ts` 顶部加 import：

```ts
import type { ResolvedShortcuts } from '../core/shortcuts'
import { toAccelerator } from '../core/shortcuts'
```

把签名与头部改成：

```ts
/**
 * 建原生应用菜单。**只有 macOS 会真的建出菜单**，见下面的注释。
 *
 * 【为什么快捷键表是**取**而不是**传**】菜单要在设置改动之后重建，而设置是渲染层改的。
 * 传一个取值函数而不是一张表，调用方（`index.ts` 与 `ipc.ts`）就不必各自维护「当前是哪
 * 一份」——它们只管在需要的时候重建一次。
 */
export function buildAppMenu(
  getWindow: () => BrowserWindow | null,
  getShortcuts: () => ResolvedShortcuts
): void {
```

把「导入小说…」那一项改成：

```ts
        {
          label: '导入小说…',
          // 【为什么这里可能为空】非 darwin 根本走不到这一段（下面直接 return 了），而
          // darwin 上 `shortcutProblem` 与白名单保证了 accelerator 一定转得出来。取空是
          // 防御性的：真为空时菜单项只是不显示快捷键，功能照旧。
          ...(toAccelerator(getShortcuts().import) === null
            ? {}
            : { accelerator: toAccelerator(getShortcuts().import) as string }),
          click: () => send('import-novel')
        },
```

> 非 darwin 的那句 `Menu.setApplicationMenu(null)` 与整段注释**一个字都不要改**——
> 那是伪装的一部分（见 CLAUDE.md 的「原生菜单」一节）。
>
> **【别在菜单这一侧"顺手也拦一下"保留键】** 本次分层的价值就在于保留键**穿过** `sessionStore`
> 一路到 core，由 `resolveShortcuts` 按平台逐条退回默认值。菜单侧若自作主张再校验一次，
> core 那条逐条校验就退回纸面路径了。规格评审的真机探针已经证明现在这条路径是通的（往
> `settings.json` 写一条 `Meta+KeyQ`，应用照常起、0 条 warn、文档名保留）。
>
> **【一处真实的退步方向，将来往迁移里加 IO 时要记得】** 规格评审独立核过：`getStore()` 提前到
> `whenReady` 里（`buildAppMenu` → `createWindow` 之前）之后，`migrateLegacySession()` 若抛错，
> 异常会从 `whenReady().then()` 里冒出去，而紧随其后的 `win = createWindow()` **永远不会执行**
> ——症状从改动前的「渲染层那次 invoke reject、停在空状态」**升级成「一个窗口都没有」**。
>
> 按现有代码它**不抛**（迁移的每一段 IO 都在 try/catch 里，这一条评审逐段走过），所以这是
> **理论化的残留风险、不是缺陷**。但要记一笔：**将来若往迁移里加一步会抛的 IO**（比如再无保护地
> `readdirSync`），症状就是这么变过去的。

- [ ] **Step 2: 改 `ipc.ts` 的 `saveSettings`**

把 `src/main/ipc.ts` 的 `registerIpc` 改成接收重建菜单所需的依赖。`IpcDeps` 加一个字段：

```ts
export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  getInitialNovelPath: () => string | null
  /** 设置写盘后重建原生菜单——菜单里的 accelerator 要跟着用户改的键走。 */
  rebuildMenu: () => void
}
```

`saveSettings` 那个 handler 改成：

```ts
  ipcMain.handle(CH.saveSettings, (_e, settings: AppSettings): void => {
    getStore().writeSettings(settings)
    // 【为什么在这里重建而不是新开一条 IPC 通道】设置本来就要从这条路进主进程，顺手重建
    // 比让渲染层再喊一声省一条通道、也少一个「谁先谁后」的问题。
    // 【为什么可以无条件重建】非 darwin 上 buildAppMenu 直接 return，成本是一次判断。
    deps.rebuildMenu()
  })
```

- [ ] **Step 3: 在 `index.ts` 里接起来**

在 `src/main/index.ts` 顶部加：

```ts
import { platformKind, resolveShortcuts } from '../core/shortcuts'
import { getStore } from './session'
```

把 `app.whenReady()` 里那一段改成：

```ts
  /**
   * 当前生效的快捷键表（已按平台补齐）。菜单与它同源——这是「菜单里显示的键」与
   * 「用户按下去真正生效的键」不会分岔的唯一保证。
   *
   * 【为什么现取而不是缓存】设置随时会变（设置对话框里改完点保存，`ipc.ts` 就会重建菜单），
   * 缓存一份就要维护失效，而读一次 `settings.json` 是这个量级的应用完全付得起的。
   */
  const getShortcuts = (): ReturnType<typeof resolveShortcuts> =>
    resolveShortcuts(getStore().readSettings().shortcuts, platformKind(process.platform))

  registerIpc({
    getWindow: () => win,
    getInitialNovelPath: () => initialNovelPath,
    rebuildMenu: () => buildAppMenu(() => win, getShortcuts)
  })
  buildAppMenu(() => win, getShortcuts)
```

> `getStore()` 里那句 `migrateLegacySession()` 只跑一次（懒初始化），所以这里多读几次设置
> 不会重复迁移。

- [ ] **Step 4: 跑门禁**

Run: `pnpm typecheck && pnpm test`
Expected: 两个都 exit 0

> **这一步没有自动化用例，这是刻意的。** `menu.ts` 要 `electron` 才能测，而本仓库没有
> 任何 Electron 主进程的 mock 基建（`tests/unit/` 里没有 menu 的用例）。**能被单测覆盖的
> 那部分是 `toAccelerator`**，它已经在 Task 1 里测过了；这里剩下的是接线。真机验的判据在
> Task 7 的验收清单里。

- [ ] **Step 5: 提交**

```bash
git add src/main/menu.ts src/main/ipc.ts src/main/index.ts
git commit -F /tmp/msg-task3.txt
```

---

### Task 4: 渲染层分发器 —— `src/renderer/src/state/shortcuts.ts`

**Files:**
- Create: `src/renderer/src/state/shortcuts.ts`
- Test: `tests/unit/shortcutDispatch.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/shortcutDispatch.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useShortcutDispatcher,
  toChord,
  type ShortcutActions
} from '../../src/renderer/src/state/shortcuts'
import { resolveShortcuts } from '../../src/core/shortcuts'

function actions(): ShortcutActions {
  return {
    import: vi.fn(),
    'toggle-sidebar': vi.fn(),
    'open-settings': vi.fn()
  }
}

/** 造一个 keydown。只填 toChord 真正读的那几个字段。 */
function press(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
}

function mount(opts: {
  platform?: string
  table?: Partial<Record<'import' | 'toggle-sidebar' | 'open-settings', string>>
  enabled?: boolean
}) {
  const a = actions()
  const table = resolveShortcuts(opts.table ?? {}, opts.platform === 'darwin' ? 'darwin' : 'other')
  renderHook(() =>
    useShortcutDispatcher({
      platform: opts.platform ?? 'win32',
      table,
      actions: a,
      enabled: opts.enabled ?? true
    })
  )
  return a
}

describe('toChord', () => {
  it('从 KeyboardEvent 里挑出 core 要的那五个字段', () => {
    const e = press({ code: 'KeyO', metaKey: true, shiftKey: true })
    expect(toChord(e)).toEqual({ code: 'KeyO', meta: true, ctrl: false, alt: false, shift: true })
  })

  it('组合期间返回 null——那一下属于输入法，不属于快捷键', () => {
    const e = press({ code: 'KeyO', metaKey: true })
    Object.defineProperty(e, 'isComposing', { value: true })
    expect(toChord(e)).toBeNull()
  })
})

describe('分发器', () => {
  it('Windows 上按 Ctrl+O 触发导入——这条以前是死的', () => {
    const a = mount({ platform: 'win32' })
    window.dispatchEvent(press({ code: 'KeyO', ctrlKey: true }))
    expect(a.import).toHaveBeenCalledTimes(1)
  })

  it('macOS 上不接管 import——它归原生菜单，两边都管就会导入两次', () => {
    const a = mount({ platform: 'darwin' })
    window.dispatchEvent(press({ code: 'KeyO', metaKey: true }))
    expect(a.import).not.toHaveBeenCalled()
  })

  it('macOS 上仍然接管章节栏与设置——它们没有菜单项', () => {
    const a = mount({ platform: 'darwin' })
    window.dispatchEvent(press({ code: 'KeyH', metaKey: true, shiftKey: true }))
    window.dispatchEvent(press({ code: 'Comma', metaKey: true }))
    expect(a['toggle-sidebar']).toHaveBeenCalledTimes(1)
    expect(a['open-settings']).toHaveBeenCalledTimes(1)
  })

  it('裸按键一律放行——它们要去抽字', () => {
    const a = mount({ platform: 'win32' })
    window.dispatchEvent(press({ code: 'KeyO' }))
    expect(a.import).not.toHaveBeenCalled()
  })

  it('没配上的组合不触发', () => {
    const a = mount({ platform: 'win32' })
    window.dispatchEvent(press({ code: 'KeyI', ctrlKey: true }))
    expect(a.import).not.toHaveBeenCalled()
  })

  it('命中时 preventDefault，免得裸字符漏进隐藏 textarea', () => {
    mount({ platform: 'win32' })
    const e = press({ code: 'KeyO', ctrlKey: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })

  it('enabled 为 false 时整个静音——录制期间用它', () => {
    const a = mount({ platform: 'win32', enabled: false })
    window.dispatchEvent(press({ code: 'KeyO', ctrlKey: true }))
    expect(a.import).not.toHaveBeenCalled()
  })

  it('用户改过的键生效，旧键失效', () => {
    const a = mount({ platform: 'win32', table: { import: 'Ctrl+KeyI' } })
    window.dispatchEvent(press({ code: 'KeyO', ctrlKey: true }))
    window.dispatchEvent(press({ code: 'KeyI', ctrlKey: true }))
    expect(a.import).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/shortcutDispatch.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/renderer/src/state/shortcuts"`

- [ ] **Step 3: 实现分发器**

创建 `src/renderer/src/state/shortcuts.ts`：

```ts
import { useEffect, useRef } from 'react'
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
  const host = (window as unknown as { api?: { platform?: string } }).api
  return host?.platform ?? 'other'
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
  // 一瞬间的按键会漏掉。渲染期写 ref 是本仓库既有的写法（见 App.tsx 的 engineRef）。
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
```

> 文件顶部的 import 要从 core 取这几样：
> `SHORTCUTS`、`fromChord`、`normalizeSpec`、`platformKind`，
> 以及类型 `KeyChord`、`ResolvedShortcuts`、`ShortcutId`。
> （`resolveShortcuts` 不在这里：表由调用方 resolve 好传进来，本文件用不到它。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/shortcutDispatch.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/state/shortcuts.ts tests/unit/shortcutDispatch.test.ts
git commit -F /tmp/msg-task4.txt
```

---

### Task 5: 设置界面的录制框

**Files:**
- Modify: `src/renderer/src/components/SettingsDialog.tsx`
- Modify: `src/renderer/src/components/Ribbon.tsx`
- Modify: `src/renderer/src/styles/ribbon.css`
- Test: `tests/unit/settings.test.tsx`（追加）

> **`Ribbon.tsx` 这一条是后补的**（本节原文漏了它）：Step 1 的用例要把 `shortcuts` /
> `platform` / `onShortcutsChange` 交给 `Ribbon`、再由它透传给 `SettingsDialog`，而对话框那四
> 个 prop 是**必填**——不碰 Ribbon，这条链在 `pnpm typecheck` 上就断了（`SettingsDialog` 收不到
> 必填 prop）。写用例的人会发现它，写计划的人在纸上发现不了。
>
> 本任务在 Ribbon 上只做**最小的一件事**：加四个 prop 并原样透传。**这四个写成「可选 + 默认
> 值」是有意的**：真值住在 `App` 里（稀疏表、平台原值、录制态），而 App 的接线是 Task 7。可选
> 之后 `App.tsx` 与 `ribbon.test.tsx` 在本任务里都不必改就能过门禁。**Task 7 才把真值接上
> ——在那之前 Ribbon 不是受控的，别照着 Task 7 的样子以为它已经是。**

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/settings.test.tsx` 里先改壳、再加用例。

`SetupOptions` 追加三个字段：

```ts
interface SetupOptions {
  ratio?: number
  globalRatio?: number
  mode?: InputMode
  onRatioChange?: (n: number) => void
  onGlobalRatioChange?: (n: number) => void
  /** 「当前书」那格据此禁用；不传＝当作已经打开了小说 */
  novelOpen?: boolean
  onModeChange?: (m: InputMode) => void
  onImport?: () => void
  onClearSession?: () => void
  /** 额外挂一个 InputCapture：焦点那几条用例需要它来当「被抢的对象」 */
  capture?: boolean
  docTitle?: string
  darkPaper?: boolean
  themeSource?: ThemeSource
  /**
   * 用户改过的那些快捷键——**稀疏表**（缺条目＝该平台的默认值，与 `AppSettings.shortcuts`
   * 同一个形状）。不传＝一条都没改过（那张表是按 `platform` 补齐过的默认表）。
   *
   * 【别把它当「已按平台补齐的那份」】↺ 那条用例传的就是稀疏表 `{ import: 'Ctrl+KeyI' }`。
   */
  shortcuts?: Record<string, string>
  platform?: string
  onShortcutsChange?: (next: Record<string, string | undefined>) => void
  /** 观察录制态的上报（壳里同时把它接进分发器的 enabled） */
  onRecordingChange?: (recording: boolean) => void
}
```

`setup()` 整个换成下面这样（**它现在返回 `unmount`**，最后一条用例要用）。下面是**当前**形状——
Task 6 又给壳加了 `settingsOpen` 那一路，一并切进来，免得片段与文件脱节：

```tsx
function setup(opts: SetupOptions = {}): {
  onDocTitleChange: ReturnType<typeof vi.fn>
  onDarkPaperChange: ReturnType<typeof vi.fn>
  onThemeSourceChange: ReturnType<typeof vi.fn>
  unmount: () => void
} {
  const onDocTitleChange = vi.fn()
  const onDarkPaperChange = vi.fn()
  const onThemeSourceChange = vi.fn()
  const {
    capture,
    docTitle = '文档1',
    darkPaper = false,
    themeSource = 'system',
    novelOpen = true,
    // 默认走 Windows 那一套：macOS 上 import 归原生菜单管，分发器会**跳过**它，
    // 于是「录制期间静音」那条用例在 darwin 下根本走不到分发器。
    shortcuts = resolveShortcuts({}, 'other'),
    platform = 'win32',
    onShortcutsChange = vi.fn(),
    ...provider
  } = opts

  /**
   * 站在 `App` 的位置上：把 Ribbon 报出来的录制态接到全局分发器上（App 里就是 `enabled: !recording`）。
   *
   * 【为什么非要有这一层】少了它，「录制期间分发器必须静音」是一条**空转**用例：树里根本没有
   * 分发器，无论录制态有没有报出去，`onImport` 都不会被调用——它在「通知在」与「通知不在」
   * 两个世界里一样绿。jsdom 里没有真机行为可依赖，只能把 App 那两行接线在这里摆出来。
   */
  function Harness() {
    const [recording, setRecording] = useState(false)
    /**
     * 对话框开不开。`Ribbon` 从 Task 6 起是**受控**的（原先这个状态住在它里面），
     * 所以壳得拿着它——「按 ⌘/Ctrl + , 打开设置」那几条用例现在只能走分发器那条路。
     */
    const [settingsOpen, setSettingsOpen] = useState(false)
    const reportRef = useRef(opts.onRecordingChange)
    reportRef.current = opts.onRecordingChange
    /**
     * 上报录制态：既通知用例里的 spy，也把它接进分发器的 `enabled`。
     *
     * 【身份必须稳定】它是对话框里那个 effect 的依赖——每次渲染换一个新函数的话，effect 会
     * 跟着每次渲染重跑，上报次数就变成「渲染了几次」而不是「录制态变了几次」。
     */
    const reportRecording = useCallback((value: boolean): void => {
      reportRef.current?.(value)
      setRecording(value)
    }, [])
    const dispatchImport = provider.onImport ?? ((): void => {})
    useShortcutDispatcher({
      platform,
      table: resolveShortcuts(shortcuts, platformKind(platform)),
      enabled: !recording,
      actions: {
        // 与 `ToolbarProvider` 收到的是**同一个** spy：App 里两边也都指向同一个 handleImport
        import: dispatchImport,
        // 章节栏那条在 App 里是「提升上去的状态」（Task 7 才提），单测里没有那一层，占位即可
        'toggle-sidebar': () => {},
        // 【这一条必须真的打开对话框】Ribbon 不再自己监听 ⌘,，「按 ⌘/Ctrl + , 对话框出现」
        // 那几条既有用例现在只剩分发器这一条路——占位空函数会让它们全红。
        'open-settings': () => setSettingsOpen(true)
      }
    })
    return (
      <>
        <Ribbon
          docTitle={docTitle}
          onDocTitleChange={onDocTitleChange}
          darkPaper={darkPaper}
          onDarkPaperChange={onDarkPaperChange}
          themeSource={themeSource}
          onThemeSourceChange={onThemeSourceChange}
          novelOpen={novelOpen}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          shortcuts={shortcuts}
          platform={platform}
          onShortcutsChange={onShortcutsChange}
          onRecordingChange={reportRecording}
        />
        {capture ? <InputCapture engine={{ pump: vi.fn(), backspace: vi.fn() }} mode="key" /> : null}
        <Toast />
      </>
    )
  }

  const { unmount } = render(
    <ToolbarProvider {...provider}>
      <Harness />
    </ToolbarProvider>
  )
  return { onDocTitleChange, onDarkPaperChange, onThemeSourceChange, unmount }
}
```

> **【为什么壳里要挂真正的分发器，而不是只摆几个 spy】**「录制期间分发器必须静音」这条如果
> 跑在没有分发器的空壳里，是**空转**的：无论录制态有没有报出去，`onImport` 都不会被调用——
> 它在「通知在」与「通知不在」两个世界里一样绿。App 里那就是一行 `enabled: !recording` 的
> 接线，壳里得照摆出来才验得到。

追加用例：

```ts
/**
 * 设置里的快捷键录制。
 *
 * 【录制框为什么是 button 而不是 input】这个应用的「抢焦点豁免名单」（InputCapture 的
 * `TEXT_INPUT_SELECTOR`）里有 `input`，而录制要自己接管 keydown——做成 input 的话那一下
 * 会同时被当作「在输入框里打字」。
 */
describe('设置里的快捷键录制', () => {
  it('三行都在，显示的是当前键', () => {
    setup({})
    openViaButton()
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+O')
    expect(screen.getByTestId('shortcut-toggle-sidebar-input').textContent).toContain(
      'Ctrl+Shift+H'
    )
    expect(screen.getByTestId('shortcut-open-settings-input').textContent).toContain('Ctrl+,')
  })

  it('「导入小说」按钮的 title 跟着当前快捷键走（不是写死的 Ctrl+O）', () => {
    // 用一个**默认值推不出来**的键：写死的 'Ctrl+O'、或「忽略 shortcuts 直接推默认值」的
    // 实现都会显示 Ctrl+O，本条即红。
    setup({ shortcuts: { import: 'Ctrl+KeyI' } })
    openViaButton()
    expect(screen.getByTestId('btn-import').getAttribute('title')).toContain('Ctrl+I')
  })

  it('点一下进录制态，显示提示', () => {
    setup({})
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('请按下组合键')
  })

  it('按下合法组合就记下来，并退出录制态', () => {
    setup({})
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      code: 'KeyI',
      ctrlKey: true
    })
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+I')
  })

  it('录不了裸键，停在录制态并提示', () => {
    setup({})
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), { code: 'KeyI' })
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('请按下组合键')
    expect(screen.getByTestId('toast').textContent).toContain('修饰键')
  })

  it('录不了和应用内另一条撞车的组合，提示里点名是哪一条', () => {
    setup({})
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      code: 'KeyH',
      ctrlKey: true,
      shiftKey: true
    })
    expect(screen.getByTestId('toast').textContent).toContain('显示/隐藏章节栏')
  })

  it('同一次对话框里把两条改成同一个键：第二次当场拦住（比的是草稿，不是已提交值）', () => {
    setup({})
    openViaButton()
    // 先把「显示/隐藏章节栏」改成 Ctrl+I（只是草稿，还没保存）
    fireEvent.click(screen.getByTestId('shortcut-toggle-sidebar-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-toggle-sidebar-input'), {
      code: 'KeyI',
      ctrlKey: true
    })
    expect(screen.getByTestId('shortcut-toggle-sidebar-input').textContent).toContain('Ctrl+I')

    // 再把「导入小说」也改成 Ctrl+I。此刻**已提交值**里 import 仍是 Ctrl+O，拿已提交值比
    // 是看不出撞车的——而这两条保存之后会同时生效，引擎里只会有一条真的能用。
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      code: 'KeyI',
      ctrlKey: true
    })

    expect(screen.getByTestId('toast').textContent).toContain('显示/隐藏章节栏')
    // 被拦住＝没记下来，还停在录制态
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('请按下组合键')
  })

  it('按 Esc 取消录制：值是**原来那个**，不会被顺手写回默认值', () => {
    // 【为什么先录成一个非默认值】草稿本来就等于默认值时，「什么都不做」与「写回平台默认值」
    // 返回的是同一个串——这样的断言分不开这两种实现，用例是**空转**的（实测：让 Esc 分支去
    // `setDraft(默认值)`，整组照样全绿）。先把它改成 Ctrl+I，两种实现才分得开。
    setup({ shortcuts: { import: 'Ctrl+KeyI' } })
    openViaButton()
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+I')

    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    // `key` 与 `code` 都给：真机上按 Esc 两个都有，而对话框自己的关闭键判的是 `key`
    // （少了它，用例连「Esc 会关对话框」这半边都验不到）
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      key: 'Escape',
      code: 'Escape'
    })

    const shown = screen.getByTestId('shortcut-import-input').textContent
    expect(shown).toContain('Ctrl+I')
    expect(shown).not.toContain('Ctrl+O')
  })

  it('macOS 上录不了被系统菜单占用的组合：停在录制态、说明原因、草稿不动', () => {
    // 【为什么必须显式给 darwin】`shortcutProblem` 只在 darwin 上会返回 'reserved'（other
    // 平台没有保留清单），而壳默认是 win32——不换平台，这一整条分支**零覆盖**（实测：把那个
    // `if` 删掉，整组照样全绿）。
    setup({ platform: 'darwin', shortcuts: resolveShortcuts({}, 'darwin') })
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    // ⌘Q 是 macOS 的「退出」，在 RESERVED 清单里
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      code: 'KeyQ',
      metaKey: true
    })

    // 停在这一条上：既没记下来，也没退出录制态
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('请按下组合键')
    expect(screen.getByTestId('toast').textContent).toContain('系统菜单')

    // 草稿也没被动过：退出录制态（Esc）之后看，还是原来那个键
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      key: 'Escape',
      code: 'Escape'
    })
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('⌘O')
  })

  it('按 Esc 只是取消录制，不会顺手把整个对话框关掉（草稿全丢）', () => {
    setup({})
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    // `key` 与 `code` 都给：真机上按 Esc 两个都有，而对话框自己的关闭键判的是 `key`
    // （少了它，用例连「Esc 会关对话框」这半边都验不到）
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      key: 'Escape',
      code: 'Escape'
    })
    // Esc 也是对话框自己的关闭键：录制那一下必须 stopPropagation，否则用户想取消录制
    // 会把整个对话框关掉，那一瞬间的草稿（包括刚录的别的键）全丢
    expect(screen.getByTestId('settings')).toBeTruthy()
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+O')
  })

  it('改完要点保存才生效——并进「手动保存」那一组', () => {
    const onShortcutsChange = vi.fn()
    setup({ onShortcutsChange })
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), { code: 'KeyI', ctrlKey: true })
    expect(onShortcutsChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onShortcutsChange).toHaveBeenCalledWith(
      expect.objectContaining({ import: 'Ctrl+KeyI' })
    )
  })

  it('↺ 恢复该平台默认值，并且这一条从稀疏表里消失', () => {
    const onShortcutsChange = vi.fn()
    setup({ shortcuts: { import: 'Ctrl+KeyI' }, onShortcutsChange })
    openViaButton()
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+I')

    fireEvent.click(screen.getByTestId('shortcut-import-reset'))
    // 恢复默认后 import 变回 Ctrl+O ……
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+O')

    fireEvent.click(screen.getByTestId('settings-save'))
    // ……而且「和默认一样」时不该写进稀疏表：`{}` ＝ 全默认。稀疏表里「显式写回默认值」
    // 与「从未改过」对读取方完全没区别，没有理由把表撑大。
    expect(onShortcutsChange).toHaveBeenCalledWith({})
  })

  it('录制期间分发器必须静音——否则录 ⌘O 会当场触发一次真导入', () => {
    const onImport = vi.fn()
    setup({ onImport })
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), { code: 'KeyO', ctrlKey: true })
    expect(onImport).not.toHaveBeenCalled()
  })

  it('录制中关掉对话框：录制态要清掉（分发器解除静音，重开时不还停在录制态）', () => {
    const onRecordingChange = vi.fn()
    setup({ onRecordingChange })
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    expect(onRecordingChange).toHaveBeenLastCalledWith(true)

    // 【「关掉对话框」不是「卸载」】`open` 为假时组件只是 `return null`，它本身还在树里——
    // 所以「整树卸载时上报 false」那条 effect 管不到这里，得由 `open` 变假这一条来兜。
    fireEvent.click(screen.getByTestId('settings-close'))
    expect(onRecordingChange).toHaveBeenLastCalledWith(false)

    // 重开时那个按钮不该还停在「请按下组合键…」
    openViaButton()
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+O')
  })

  it('整棵界面被卸载时（应用退出）也要报一次 false——否则分发器会一直哑着', () => {
    const onRecordingChange = vi.fn()
    const { unmount } = setup({ onRecordingChange })
    openViaButton()
    expect(onRecordingChange).toHaveBeenLastCalledWith(false)

    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    expect(onRecordingChange).toHaveBeenLastCalledWith(true)

    unmount()
    expect(onRecordingChange).toHaveBeenLastCalledWith(false)
  })
})
```

> **写这些用例时必须知道的两件事**（本节原文的用例两件都漏了）：
> 1. **每条都要先 `openViaButton()`**。`SettingsDialog` 在 `open` 为假时直接 `return null`，
>    录制框那些 `data-testid` 根本不在文档里——不先开对话框，一条都跑不起来。
> 2. **Esc 那条 `key` 与 `code` 都要给**。实现判的是 `e.key`（与本文件既有的「Esc 关闭对话框」
>    同一条判据），只给 `code` 的话那条用例**过不了**，而且更糟——把 `stopPropagation` 去掉
>    也不会红，而「去掉就红」正是这条用例存在的理由。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/settings.test.tsx -t '设置里的快捷键录制'`
Expected: FAIL —— `Unable to find an element by: [data-testid="shortcut-import-input"]`

- [ ] **Step 3: 给 `SettingsDialog` 加 props 与字段表**

文件顶部补 import：

```ts
// `KeyboardEvent` 要**改名**导入：这个名字一进来就盖住了 DOM 那个（下面 Esc 关闭用的
// `window.addEventListener('keydown', …)` 收的正是 DOM 事件），而两者不通用——React 的
// `KeyboardEvent<Element>` 上多一个 `nativeEvent`、DOM 的则多十几个字段，互相都赋不过去，
// 直接照抄会把那条既有代码判成类型错。
import {
  useEffect,
  useMemo,
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
import { MAX_RATIO, MIN_RATIO } from '../../../core/types'
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
```

> **`KeyboardEvent` 必须改名导入**（`type KeyboardEvent as ReactKeyboardEvent`）。这个名字一进来
> 就**盖住了 DOM 的** `KeyboardEvent`，而本文件下面「Esc 关闭」那条
> `window.addEventListener('keydown', …)` 收的正是 DOM 事件——React 的 `KeyboardEvent<Element>`
> 多一个 `nativeEvent`、DOM 的多十几个字段，互相都赋不过去。直接写 `type KeyboardEvent` 会把
> 那段**既有**代码判成类型错（实测 TS2769），而且报错位置在下面几十行外，不查是想不到的。
> 处理函数签名随之写 `ReactKeyboardEvent<HTMLElement>`。

`SettingsDialogProps` 末尾追加：

```ts
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
}
```

> **`shortcuts` / `onShortcutsChange` 的值类型里那个 `| undefined` 是有意的，别「修」成
> `Record<string, string>`**：上游是 `AppSettings.shortcuts`，它的类型是
> `Partial<Record<ShortcutId, string>>`，传进 `Record<string, string>` 编译不过（实测 TS2345：
> `'string' index signatures are incompatible`）。宽一格之后，稀疏表与补齐过的表都收得下，
> 而下面每一条的 `?? defaultShortcut(...)` 才是那个兜底真正该待的地方。

组件内这一段（`const kind` 到末尾那三条效应，放在 `useToolbar()` 之后）。中间那段
「导入小说按钮 title」的文本**是 Task 6 加的**，一并切进来是为了让片段与文件不脱节：

```ts
  const kind = platformKind(platform)

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
```

把快捷键并进 `fields`（**每一条一行**，用 `SHORTCUTS` 推出来）：

```ts
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
    [docTitle, ratio, globalRatio, onDocTitleChange, setRatio, setGlobalRatio, shortcuts, onShortcutsChange, kind]
  )
  const { drafts, setDraft, blur, dirty, save, reset } = useDeferredSettings(fields)
```

- [ ] **Step 4: 加录制交互**

组件里加「把草稿也算进去的那张表」：

```ts
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
```

再加录制键位那个处理函数：

```ts
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
```

- [ ] **Step 5: 加 JSX**

在「小说」那一行之前插入一节：

```tsx
          {/* 快捷键：三条各一行。加一条只需在 core 的 SHORTCUTS 表里加一行，这里自动跟上。 */}
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
```

- [ ] **Step 6: 加样式**

在 `src/renderer/src/styles/ribbon.css` 末尾追加：

```css
/* 快捷键录制框。做成 button 而不是 input：这个应用的焦点豁免名单里有 `input`，
   而录制要自己接管 keydown——做成 input 的话那一下会同时被当作「在输入框里打字」。 */
.wt-shortcut {
  min-width: 148px;
  padding: 4px 10px;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--wt-text);
  background: var(--wt-chrome);
  border: 1px solid var(--wt-chrome-border);
  border-radius: var(--wt-radius);
  cursor: pointer;
}

.wt-shortcut--recording {
  color: var(--wt-text-muted);
  border-color: var(--wt-primary);
  border-style: dashed;
}
```

> 这几个 token 都在 `word.css` 里，浅深两套都有（`--wt-chrome` 是面板底色、
> `--wt-chrome-border` 是它的描边、`--wt-text` / `--wt-text-muted` 是正文与次要文字、
> `--wt-primary` 是主色）。**别用 `--wt-blue`**——它在深色主题下是**提亮**过的强调色
> （`#6cb0ff`），那是给深底上的文字用的，当边框会亮得刺眼。

- [ ] **Step 7: Ribbon 加四个 prop 并透传**

四个默认值放模块顶层（`Ribbon` 上面）：

```tsx
/**
 * 四个可选 prop 的默认值。
 *
 * 【为什么放在模块顶层而不是写成内联箭头函数】`onRecordingChange` 的**身份必须稳定**：
 * 对话框里那个 effect 拿它当依赖，每次渲染都换一个新函数的话，effect 会跟着每次渲染重跑
 * ——「有没有在录制」这个状态就会被反复上报。空函数放在这里，一次创建、终身复用。
 */
const ignoreShortcutsChange = (): void => {}
const ignoreRecordingChange = (): void => {}

/**
 * 空稀疏表＝一条都没改过。**不要在这里先 `resolveShortcuts` 补齐**：真接上之后 App 传下来
 * 的就是那张稀疏表（缺条目＝用该平台的默认值），而补齐这一步在设置对话框里按当前平台做。
 */
const DEFAULT_SHORTCUTS: Record<string, string | undefined> = {}

/**
 * 宿主平台。**现取而不是在模块顶层缓存**：与 App.tsx 的 getApi 同一个理由——缓存等于把
 * 「preload 一定在模块加载前注入」写死进加载顺序，一旦不成立就是永久错的。缺桥时按
 * `'other'` 走：宁可显示成 Windows 的那一套，也不要因为一个读不到的值把界面炸掉。
 */
function hostPlatform(): string {
  const host = (window as unknown as { api?: { platform?: string } }).api
  return host?.platform ?? 'other'
}
```

`Ribbon` 的签名加上它们（下面是**当前**形状：Task 6 后来又加了 `settingsOpen` /
`onSettingsOpenChange` / `settingsShortcut` 三个，一并切进来以免片段与文件脱节）：

```tsx
export function Ribbon({
  docTitle,
  onDocTitleChange,
  darkPaper,
  onDarkPaperChange,
  themeSource,
  onThemeSourceChange,
  novelOpen,
  settingsOpen,
  onSettingsOpenChange,
  shortcuts = DEFAULT_SHORTCUTS,
  platform = hostPlatform(),
  onShortcutsChange = ignoreShortcutsChange,
  onRecordingChange = ignoreRecordingChange,
  settingsShortcut = formatShortcut(defaultShortcut('open-settings', platformKind(platform)), platformKind(platform))
}: {
  docTitle: string
  onDocTitleChange: (next: string) => void
  darkPaper: boolean
  onDarkPaperChange: (next: boolean) => void
  themeSource: ThemeSource
  onThemeSourceChange: (next: ThemeSource) => void
  /** 有没有打开小说。设置里「当前书」的比例框据此禁用——没有书就没有「当前书」。 */
  novelOpen: boolean
  /**
   * 设置对话框开不开。**从 Task 6 起由调用方持有**：原先这个状态住在本组件内部，而
   * 「按 ⌘/Ctrl + , 打开设置」那条监听已经删掉了（它归全局分发器），分发器长在调用方
   * 那一层、碰不到组件内部的状态——所以这个状态必须提上去。
   */
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  /**
   * 下面这四个**暂时是可选**的：真值住在 `App` 里（稀疏表、平台原值、录制态），而 App 的
   * 接线还没做。给默认值是为了让还没接上这一层的调用方（`App` 与既有测试）不必为此改动，
   * 同时设置里的快捷键那一组仍然显示成该平台的默认值而不是一片空白。
   */
  shortcuts?: Record<string, string | undefined>
  platform?: string
  onShortcutsChange?: (next: Record<string, string | undefined>) => void
  onRecordingChange?: (recording: boolean) => void
  /**
   * 「设置」那个按钮的 title 里显示的快捷键。**默认值从注册表推**（注册表里那一条的默认
   * 键，按上面那个 `platform` 格式化）——所以调用方不传也是对的，而用户改过键之后要由
   * 调用方把那一份喂进来。默认值里引用的 `platform` 是本参数表**前面**那个形参，顺序别调。
   */
  settingsShortcut?: string
}) {
```

再原样透传给 `SettingsDialog`（`open` / `onClose` 从 Task 6 起走受控的那一对）：

```tsx
      <SettingsDialog
        open={settingsOpen}
        onClose={() => onSettingsOpenChange(false)}
        docTitle={docTitle}
        onDocTitleChange={onDocTitleChange}
        darkPaper={darkPaper}
        onDarkPaperChange={onDarkPaperChange}
        themeSource={themeSource}
        onThemeSourceChange={onThemeSourceChange}
        novelOpen={novelOpen}
        shortcuts={shortcuts}
        platform={platform}
        onShortcutsChange={onShortcutsChange}
        onRecordingChange={onRecordingChange}
      />
```

> 【为什么默认值放在顶层而不是写成内联箭头】`onRecordingChange` 的**身份必须稳定**：它是
> `SettingsDialog` 里那个上报效应的依赖，每次渲染换一个新函数的话，效应会跟着每次渲染重跑，
> 「有没有在录制」就会变成「渲染了几次」。这条在壳里（`tests/unit/settings.test.tsx`）也是
> 同一个坑，那边用 `useCallback` 钉住。
>
> 【为什么不在这里 `resolveShortcuts` 补齐】App 传下来的就是那张**稀疏表**（缺条目＝用该平台
> 的默认值），补齐在对话框里按当前平台做。

- [ ] **Step 8: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/settings.test.tsx`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add src/renderer/src/components/SettingsDialog.tsx src/renderer/src/components/Ribbon.tsx \
  src/renderer/src/styles/ribbon.css tests/unit/settings.test.tsx
git commit -F /tmp/msg-task5.txt
```

---

### Task 6: 文案统一 —— 四处硬编码改成读注册表

> **【不要再引入平台判断】** `formatShortcut(spec, kind)` 是显示文本的**唯一出口**。这四处
> 原先各写各的「⌘/Ctrl」，本次要做的就是把这个判断收进 core 一处。改的时候如果发现某处
> 「看起来需要」自己判一下平台（比如想给 macOS 显示 ⌘、给 Windows 显示 Ctrl），那是
> `formatShortcut` 已经在做的事——把 spec 和 kind 传进去就行。
>
> Task 2 之后，四处拿到的都应该是**已经按平台补齐的表**（`resolveShortcuts` 的结果），
> 所以组件收到的那个字符串就是可以直接显示的成品。

**Files:**
- Modify: `src/renderer/src/components/Page.tsx`
- Modify: `src/renderer/src/components/ChapterList.tsx`
- Modify: `src/renderer/src/components/Ribbon.tsx`（**别按行号找**：Task 5 已经改过这个文件，行号全漂了）
- Modify: `src/renderer/src/components/Toolbar.tsx`
- Modify: `src/renderer/src/App.tsx`（只加 `settingsOpen` 那一个状态，见 Step 3.5）
- Modify: `tests/unit/settings.test.tsx`（壳里把 `open-settings` 真接上，见 Step 3.5）
- Modify: `tests/unit/ribbon.test.tsx`（壳要自己持 `settingsOpen`，见 Step 3.6）
- Test: `tests/unit/page.test.tsx`、`tests/unit/chapterList.test.tsx`（各追加一条）

- [ ] **Step 1: `Page.tsx` —— 空状态文案**

`PageProps` 加一个字段：

```ts
  /** 导入快捷键的**显示文本**（已按平台格式化）。空状态那句提示用它。 */
  importShortcut: string
```

把空状态那段改成：

```tsx
        <div className="wt-page__empty" data-testid="page-empty">
          {`文件 → 设置 → 导入小说，或按 ${importShortcut}`}
          <br />
          导入后在文档区打字，字会按比例从小说里取出来。
        </div>
```

测试（`tests/unit/page.test.tsx` 追加）：

```ts
  it('空状态显示的是传进来的那条快捷键，不是写死的 Ctrl+O', () => {
    render(<Page visibleText="" expanded={false} onToggleExpand={() => {}} empty importShortcut="⌘O" />)
    expect(screen.getByTestId('page-empty').textContent).toContain('⌘O')
    expect(screen.getByTestId('page-empty').textContent).not.toContain('Ctrl+O')
  })
```

- [ ] **Step 2: `ChapterList.tsx` —— 去掉自己的监听**

删掉 `useEffect` 那段 `window.addEventListener('keydown')`（原文注释里写的「为什么挂在 window 上还能收到」那段说明**挪进** `renderer/src/state/shortcuts.ts`，那里已经有对应的版本了）。

`ChapterListProps` 加：

```ts
  /** 章节栏快捷键的**显示文本**（已按平台格式化）。两个按钮的 title 用它。 */
  sidebarShortcut: string
  /** 点这两个按钮时切换折叠。快捷键由全局分发器转成同一次调用。 */
```

把两个 `title` 改成：

```tsx
        title={`显示章节栏（${sidebarShortcut}）`}
```
```tsx
          title={`隐藏章节栏（${sidebarShortcut}）`}
```

测试（`tests/unit/chapterList.test.tsx` 追加）：

```ts
  it('title 里显示的是传进来的快捷键，不是写死的 ⌘/Ctrl + Shift + H', () => {
    renderChapterList({ sidebarShortcut: '⌘⇧H' })
    expect(screen.getByTestId('sidebar-toggle').getAttribute('title')).toContain('⌘⇧H')
  })
```

- [ ] **Step 3: `Ribbon.tsx` —— 去掉自己的 ⌘, 监听，并把它改成受控**

删掉 `useEffect(() => { … e.code !== 'Comma' … })` 整段。那条快捷键从此归**全局分发器**
（Task 7 把它接到 `setSettingsOpen(true)` 上）。

**四个快捷键 prop 这一步不要再动。** Task 5 已经把 `shortcuts` / `platform` /
`onShortcutsChange` / `onRecordingChange` 连同透传写好了，签名是

```ts
  shortcuts?: Record<string, string | undefined>
  platform?: string
  onShortcutsChange?: (next: Record<string, string | undefined>) => void
  onRecordingChange?: (recording: boolean) => void
```

——**可选带默认值**，将来 App 接上真值即可。别顺手改成必填。

**这一步要加的是另外三个**（`settingsOpen` / `onSettingsOpenChange` 必填、`settingsShortcut`
可选）：

```ts
  /** 设置对话框开不开。**从本任务起是受控的**：原先这个状态住在 Ribbon 内部。 */
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  /**
   * 「设置」那个按钮的 title 里显示的快捷键。**默认值从注册表推**（缺省值按当前平台格式化），
   * 所以调用方不传也是对的——Task 7 会把用户改过的那一份喂进来。
   */
  settingsShortcut?: string
```

内部那个 `const [settingsOpen, setSettingsOpen] = useState(false)` 删掉，改用它俩；
`settingsShortcut` 的默认值写成 `formatShortcut(defaultShortcut('open-settings', platformKind(platform)), platformKind(platform))`
（**它引用的是前面那个 `platform` 形参**，所以 destructuring 里的顺序别调）。

> 【为什么非受控不可】删掉 ⌘, 监听之后，键盘打开设置**只剩**分发器一条路，而
> `tests/unit/settings.test.tsx` 里有三条既有用例断言的正是「按 ⌘/Ctrl + , 对话框出现」。
> 壳要把分发器那一条动作接到「把对话框打开」上（Step 3.5），而它接得到的只能是 prop——
> 一个住在组件内部的状态，壳碰不到。`tests/unit/ribbon.test.tsx` 里那条「点设置按钮对话框
> 才出现」同理（Step 3.6）。
>
> 【为什么不是「可选 + 内部状态兜底」】那等于同一个状态两条路，而这条路从 Task 7 起就永久
> 用不上了。宁可让两个测试壳各加三行。

`<Toolbar>` 与 `<SettingsDialog>` 相应传下去；`Toolbar` 加一个 `settingsShortcut: string` prop，把

```tsx
          title="设置 (⌘/Ctrl + ,)"
```

改成

```tsx
          title={`设置 (${settingsShortcut})`}
```

- [ ] **Step 3.5: `App.tsx` 加那一个状态，`settings.test.tsx` 的壳把 `open-settings` 接上**

`Ribbon` 那两个 prop 从本任务起是**必填**的，所以 `App.tsx` 也得补上（不补，`pnpm typecheck`
从这一步起就是红的——它是本仓库的门禁之一）：

```ts
  /** 设置对话框开不开。**本任务从 Ribbon 里提上来的**（Ribbon 改成受控了）。 */
  const [settingsOpen, setSettingsOpen] = useState(false)
```

传给 `<Ribbon>`：

```tsx
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
```

`tests/unit/settings.test.tsx` 里 Task 5 加的那个壳（`Harness`）：再加一个 `settingsOpen`
状态、把这两个 prop 传给 `Ribbon`，并把分发器那一条占位动作改成真的打开：

```tsx
        // 【本任务起这一条必须真打开对话框】Ribbon 不再自己监听 ⌘,，而三条既有用例断言的
        // 正是「按 ⌘/Ctrl + , 对话框出现」——占位空函数会让它们全红。
        'open-settings': () => setSettingsOpen(true)
```

- [ ] **Step 3.6: `tests/unit/ribbon.test.tsx` 的壳**

那个文件里有一条「点了『设置』按钮，对话框才出现」的用例，它断言的正是受控行为，所以壳要
自己持状态（**顺带 `import { useState } from 'react'`**）：

```tsx
function setup(): void {
  /**
   * 壳自己持 `settingsOpen`：`Ribbon` 从 Task 6 起是**受控**的（原先这个状态住在它里面），
   * 而下面那条「点设置按钮对话框才出现」的用例正是按受控行为断言的。
   */
  function Harness() {
    const [settingsOpen, setSettingsOpen] = useState(false)
    return (
      <Ribbon
        docTitle="文档1"
        onDocTitleChange={() => {}}
        darkPaper={false}
        onDarkPaperChange={() => {}}
        themeSource="system"
        onThemeSourceChange={() => {}}
        novelOpen={false}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
      />
    )
  }
  render(
    <ToolbarProvider>
      <Harness />
      <Toast />
    </ToolbarProvider>
  )
}
```

> 四个快捷键 prop 这里**不用传**（Task 5 把它们做成可选带默认值就是为了这件事）；
> `settingsShortcut` 也不用（它的默认值从注册表推）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test`
Expected: 全部 exit 0

> 这一步会**红一批既有用例**，红的是「Ribbon 是受控的了」这件事：`settings.test.tsx` 的壳要接
> `settingsOpen`（Step 3.5），`ribbon.test.tsx` 的壳要自己持它（Step 3.6）。这不是「顺手改
> 测试」——组件契约变了，调用方必须跟上。**别用「把断言删掉」的方式让它变绿。**
>
> 反过来，**这四个快捷键 prop 一个都不必补**：Task 5 把它们做成可选带默认值，正是为了不让
> 本任务为此改动每一处 `render(<Ribbon … />)`。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/Page.tsx src/renderer/src/components/ChapterList.tsx \
  src/renderer/src/components/Ribbon.tsx src/renderer/src/components/Toolbar.tsx \
  src/renderer/src/App.tsx tests/unit/page.test.tsx tests/unit/chapterList.test.tsx \
  tests/unit/ribbon.test.tsx tests/unit/settings.test.tsx
git commit -F /tmp/msg-task6.txt
```

---

### Task 7: 在 `App.tsx` 里接线

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Test: `tests/unit/app.test.tsx`（追加）

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/app.test.tsx` 追加：

```ts
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
```

> **上面这段是交付版**（Step 1 初稿里第二条用例的负向断言是
> `expect(screen.queryByTestId('page-text')).toBeNull()`，**它是空转的**，评审实测过：
> 把表写成 `resolveShortcuts({}, kind)`——忽略用户表，正是这条用例自称要防的那件事——
> 其余用例全红，只有它保持绿。导入要跨几个微任务才提交，而那一句是同步跑的，
> `page-text` 必然还没出现，「没触发」与「触发了但没渲染完」同形；它下面那句
> `waitFor(page-text)` 则被刚才那次 Ctrl+O 的导入满足了。改法是数 `importNovel` 的
> **调用次数**——`handleImport` 在第一个 await 之前就调了它，所以同步数得到）。
>
> **交付版还多几条用例，不在这段片段里**，以 `tests/unit/app.test.tsx` 为准：
> 点章节栏按钮（受控回调那半边，键盘那半边由上面的快捷键用例覆盖）、录制期间分发器静音、
> 以及在设置里录一条新键并保存（同时钉住 `onShortcutsChange` 与 memo 依赖数组两处漏接）。
> 不把它们抄进计划是有意的：多一份副本就多一处要同步的地方。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/app.test.tsx -t '快捷键接线'`
Expected: FAIL —— 按下 Ctrl+O 后 `importNovel` 一次都没被调用（分发器还没挂上）

- [ ] **Step 3: 接线**

`App.tsx` 里加状态与派生表：

```ts
  /** 用户改过的快捷键（稀疏表）。默认 `{}` ＝ 全用该平台的默认值。 */
  const [shortcuts, setShortcuts] = useState<Partial<Record<ShortcutId, string>>>({})
  /** 设置对话框正在录制键位。录制期间分发器必须静音。 */
  const [recording, setRecording] = useState(false)

  /**
   * 平台原值。`window.api` 可能不存在（见 getApi 的说明），那时按 `'other'` 走——
   * 宁可让 Windows 的默认值在 macOS 上显示错，也不要因为一个缺失的桥把整棵树炸掉。
   */
  const platform = getApi()?.platform ?? 'other'
  const shortcutTable = useMemo(() => resolveShortcuts(shortcuts, platformKind(platform)), [shortcuts, platform])
```

启动流程里把 `shortcuts` 读回来（在 `setGlobalRatio(settings.ratio)` 之后）：

```ts
      setShortcuts(settings.shortcuts)
```

`settings` 那个 `useMemo` 补上字段（**这是本次最容易漏的一处**：漏了就等于快捷键改完只在内存里）：

```ts
  const settings: AppSettings = useMemo(
    () => ({ docTitle, themeSource, darkPaper, lastSourcePath, ratio: globalRatio, shortcuts }),
    [docTitle, themeSource, darkPaper, lastSourcePath, globalRatio, shortcuts]
  )
```

挂分发器（放在菜单命令那个 effect 之后）：

```ts
  /**
   * 全局快捷键分发器。
   *
   * 【为什么 `enabled` 要连录制态一起算】录制期间按下的组合键必须先被设置对话框拿走：
   * 不静音的话，用户在录制框里按下 ⌘O 的那一刻就会弹出文件选择框。
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
```

> **交付版在 `platform` 那个实参上多写了一段说明，片段里没有**：这个值传错**单测查不出来**
> （测试里 `window.api.platform` 那个桩与它同源，表与按键按同一个值算，两边一起错是自洽的），
> 只有真机能判——macOS 上它会同时让默认值补齐与 `RESERVED` 走错那一套，并让「darwin 上
> import 让给原生菜单」那条跳过失效，于是表里 `import` 只要是条 ⌘ 组合，按下去菜单与分发器
> 会各触发一次。见末尾真机验收清单。**别以为它被覆盖了。**

> **注意**：`sidebarCollapsed` 现在住在 `ChapterList` 里（组件的 local state），而分发器在
> `App` 上，所以要**把它提升到 `App`** 再作为受控 prop 传下去——改法与 `expanded` 那个状态
> 完全一样。`settingsOpen` 走的是同一条路，但**Task 6 已经提过了**（那时 Ribbon 就得受控，
> 否则那三条「按 ⌘/Ctrl + , 打开设置」的用例没法在壳里验），这里只管把它传给 `Ribbon`。

把 `sidebarCollapsed` 提上来（`settingsOpen` **Task 6 已经提过了**，别再加一遍——
App 里重复声明一个同名 state 是编译错误）：

```ts
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
```

`ChapterList` 改成受控：

```tsx
          <ChapterList
            novel={novel}
            activeChapter={state?.activeChapter ?? 0}
            chapterPos={state?.chapterPos ?? []}
            onJump={(i) => engineRef.current?.jumpToChapter(i)}
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
            sidebarShortcut={formatShortcut(shortcutTable['toggle-sidebar'], platformKind(platform))}
          />
```

`Ribbon` 接上快捷键那一组（受控的 `settingsOpen` / `onSettingsOpenChange` 是 Task 6 加的，
这里只是把 App 的状态与真值传进去）：

```tsx
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
          settingsShortcut={formatShortcut(shortcutTable['open-settings'], platformKind(platform))}
        />
```

> **这一段的 prop 名与类型是照 Task 5/6 交付后的 `Ribbon.tsx` 抄的，别改**：四个快捷键 prop 的
> 值类型是 `Record<string, string | undefined>`（Task 5 的说明里写了为什么不能收窄成
> `Record<string, string>`），而 `settingsOpen` / `onSettingsOpenChange` 是 Task 6 加的受控
> 那一对。**实测过**这两行直接传得进去：`App` 的 `shortcuts`（`Partial<Record<ShortcutId, string>>`）
> 与 `setShortcuts`（`Dispatch<SetStateAction<…>>`）都能赋给上面那两个 prop 类型，不需要强转、
> 也不需要包一层箭头函数。
>
> `settingsShortcut` 那一行是本任务第一次给它真值：Task 6 的默认值是从注册表推的**缺省**
> 值，而这里给的是**用户改过之后**的那一份。

`Page` 接上导入快捷键的显示文本：

```tsx
            <Page
              visibleText={visibleText}
              expanded={expanded}
              onToggleExpand={() => setExpanded(true)}
              empty={!novel}
              importShortcut={formatShortcut(shortcutTable.import, platformKind(platform))}
            >
```

- [ ] **Step 3.5: 补一条载荷断言（规格评审指定的挂点，别跳过）**

评审核实了一个**静默**风险：Task 2 给那个 memo 补的是 `shortcuts: {}`，而 `settingsLoaded` 翻 true 时防抖 effect 必然重跑一次——于是手改过 `settings.json` 的人启动一次，非空表会在 600ms 后**被无声冲成空**（评审实测拍到 `{"import":"Ctrl+KeyI"}` → `{}`，全程没人碰键盘）。

本步把 memo 接上真实状态之后这条就没了，**但没有任何现有测试会因此变红**——所以必须显式钉一条，否则将来有人把这里改回写死，谁也不会发现。

挂点用现成的：`tests/unit/app.test.tsx` 里那条「读回设置之前不写盘（否则会用自己的默认值覆盖磁盘）」。它已经断言了载荷的另外几个字段，而且第二段是**前提自检**（放行之后必须写），正好可以扩。在它第二段补一行：

```ts
  expect((saveSettings.mock.calls[0][0] as AppSettings).shortcuts).toEqual({ import: 'Ctrl+KeyI' })
```

并把该用例里 `release(...)` 的入参从 `shortcuts: {}` 换成 `shortcuts: { import: 'Ctrl+KeyI' }`。

**验证方式**：把 memo 里的 `shortcuts` 换回写死的 `{}`，这条必须红。

- [ ] **Step 4: 跑全量门禁**

Run: `pnpm typecheck && pnpm test`
Expected: 两个都 exit 0

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/App.tsx tests/unit/app.test.tsx src/renderer/src/components/ChapterList.tsx \
  src/renderer/src/components/Ribbon.tsx
git commit -F /tmp/msg-task7.txt
```

---

## 真机验收清单（跑完七个任务之后）

单测覆盖不到的两件事，只有真机能判。**跑之前先 `pnpm build`**（否则测的是旧产物）。

- [ ] **macOS 上 ⌘O 仍然只导入一次**（不是两次）。这条是「一条快捷键只在一个地方执行」
      那个硬规则的判据：把 `useShortcutDispatcher` 里 `kind === 'darwin'` 那个 `continue`
      删掉，真机上应当变成弹出两次文件选择框。
- [ ] **改了导入快捷键之后，macOS 顶部「文件」菜单里那一项显示的键跟着变**。
- [ ] **输入法合成期间按键不会被分发器吃掉**：切到输入法模式，敲一段中文，候选框正常、
      上屏正常、正文照常抽字。**这一条单测抓不到**（jsdom 没有真实合成会话）。
- [ ] `settings.json` 里出现 `"shortcuts"`，形如 `{"import":"Ctrl+KeyI"}`；把某个键改回默认值
      之后那一条**消失**（稀疏表的「与默认相同就不存」）。
- [ ] 旧版 `settings.json`（没有 `shortcuts` 键）启动一次之后，文档名 / 外观 / 纸张**都还在**。
- [ ] **设置里那一组快捷键的三个控件在同一行、高度齐平**。`.wt-shortcut` 的高度是按 padding
      撑出来的，而同一行的 ↺ 是 `.wt-btn` 的 30px——**jsdom 量不出来**（没有布局），单测只断言
      了文本。差得明显就给它补一个 `height`。

## 与仓库硬约定的关系

每个被改动的源文件都要把实现计划里对应的代码围栏同步过去（口径见 CLAUDE.md 第 1 节：
`md5(围栏原始内容) == md5(文件)`，含末尾换行、不要 rstrip）。判据是**正向**的：遍历全部
源/测试文件，报告「没有任何围栏与它逐字节相等」的集合——那个集合必须是空的。

**围栏归属：一份文件一个家。** 本计划**新增的两个源文件**（`src/core/shortcuts.ts`、
`src/renderer/src/state/shortcuts.ts`）的围栏就留在这份计划里，**不再往
`2026-10-06-word-disguised-typing-reader.md` 末尾补一份**。理由：判据只要求「每份文件至少
有一个围栏与它逐字节相等」，而重复一份等于同一个文件有两处要同步——下次改代码时忘掉其中
一处的代价，比省下的那点查找成本高。**被本计划修改的既有文件**（`sessionStore.ts` /
`menu.ts` / `ipc.ts` / `index.ts` / `SettingsDialog.tsx` / `Page.tsx` / `ChapterList.tsx` /
`Ribbon.tsx` / `Toolbar.tsx` / `App.tsx` / `types.ts`）它们的围栏住在旧计划里，**改了就
同步改那一份**。

> 注意本计划里为这些既有文件写的代码块大多是**片段**（一个函数、几行 JSX），它们不构成
> 「逐字节等于某个文件」的围栏——旧计划里那份完整的才是。别把片段当围栏去比对。
