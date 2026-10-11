# 可配置快捷键 —— 设计文档

日期：2026-10-11
状态：待用户审阅

## 1. 目标

把散在各组件里、硬编码、没有平台区分的快捷键，收敛成**一处定义、按平台格式化、可在设置里改、可持久化**的注册表。

本次纳入三条：

| id | 标签 | macOS 默认 | 其它平台默认 |
|---|---|---|---|
| `import` | 导入小说 | `⌘O` | `Ctrl+O` |
| `toggle-sidebar` | 显示/隐藏章节栏 | `⌘⇧H` | `Ctrl+Shift+H` |
| `open-settings` | 打开设置 | `⌘,` | `Ctrl+,` |

## 2. 现状 —— 这次要修的到底是什么

- **实现散在三处**，各自 `window.addEventListener('keydown')` + 硬编码键位：`ChapterList.tsx:66`、`Ribbon.tsx:1225`、`SettingsDialog.tsx:158`（最后一个见 §10）。
- **文案硬编码在四处**，没有一处做平台判断：`Page.tsx:26`、`SettingsDialog.tsx:377`、`ChapterList.tsx:95,112`、`Toolbar.tsx:267`。
- **Windows 上的 `Ctrl+O` 是死的。** `menu.ts:27` 对非 darwin 直接 `setApplicationMenu(null)`，而渲染层没有任何 O 的监听。于是「或按 Ctrl+O」在 Windows 上是一句**做不到的指引**；macOS 上则把键写错了（应是 ⌘O）。也就是说，**两个平台的提示都不对**。
- 章节栏的折叠状态只在内存里（`ChapterList.tsx:64` 的取舍）——本次不动这一点。

## 3. 快捷键的三种表示

| 用途 | 形状 | 例子 |
|---|---|---|
| 存储 / 比较 | 规范串（基于 `e.code`） | `Meta+Shift+KeyH` |
| 界面显示 | 平台本地化文本 | `⌘⇧H` / `Ctrl+Shift+H` |
| 喂 Electron 菜单 | accelerator | `Cmd+Shift+H` |

**规范串的规则：**

1. 修饰键顺序固定 `Meta` → `Ctrl` → `Alt` → `Shift`，再接键位；
2. 键位沿用 `e.code` 原样（`KeyO` / `Digit1` / `Comma` / `F5`）——它按**物理按键位置**判定，不受键盘布局与 Shift 影响（`ChapterList.tsx:57` 已经记过这个理由）；
3. **`Meta` 与 `Ctrl` 分开存**，这是「两个平台不一样」的落点；
4. 至少有**一个修饰键**，否则不构成合法规范串。

**为什么不拿 accelerator 当存储格式**：`CmdOrCtrl+O` 把两个平台合并成一个记号，恰好表达不了「各平台不同」。只在喂菜单那一刻转过去。

## 4. 注册表：`src/core/shortcuts.ts`

```ts
export type ShortcutId = 'import' | 'toggle-sidebar' | 'open-settings'

export interface ShortcutDef {
  id: ShortcutId
  /** 设置界面里的行标题；冲突提示也用它 */
  label: string
  defaults: { darwin: string; other: string }
}
```

导出：

- `SHORTCUTS: readonly ShortcutDef[]` —— 唯一的事实来源。加一条快捷键就是加一行
- `platformKind(raw)` → 把 `process.platform` 的原值收敛成 `'darwin' | 'other'`
- `defaultShortcuts(kind: PlatformKind)` → 该平台的完整表
- `parseShortcut(spec)` → 解析结果或 `null`
- `fromChord(chord: KeyChord)` → 规范串或 `null`（录制用）
- `formatShortcut(spec, platform)` → `⌘O` / `Ctrl+O`
- `toAccelerator(spec)` → `Cmd+O`
- `findConflict(table, spec, exceptId)` → 撞到的另一条 `ShortcutId` 或 `null`

**纯净性约束（不能破）**：`tsconfig.node.json` 的 `lib` 是 `["ES2023"]`（没有 DOM），而 `core` 在它的 include 里。所以 `fromChord` **不能收 `KeyboardEvent`**，只吃一个裸字段结构：

```ts
export interface KeyChord {
  code: string
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
}
```

`KeyboardEvent` → `KeyChord` 的适配由渲染层做。

**平台怎么流进来**：主进程用 `process.platform`、渲染层用 `window.api.platform`（preload 已经暴露了它），两边各自经 `platformKind()` 收敛成 `'darwin' | 'other'` 再交给 core。**core 自己不读 `process`**——那是 node 的东西，而 core 要能被两个进程共用。

## 5. 持久化与向后兼容

`AppSettings` 加：

```ts
shortcuts: Record<ShortcutId, string>
```

`defaultSettings()` 因此要收一个 `PlatformKind`——默认值是分平台的，这个函数没法再保持零参。同理 `createSessionStore()` 也要能拿到平台（由 `session.ts` 把 `process.platform` 传进去，而不是让它自己去读 `process`，这样测试能指定平台）。

**向后兼容是本次最容易毁数据的地方。** `sessionStore.ts` 现在的 `withRatioFilled` 只认 `ratio` 一个字段。旧 `settings.json` 里没有 `shortcuts`，而 `settingsProblem` 的取舍是「**一个字段不合格就整份退回默认值**」——直接加这个必填字段，会让老用户升级一次就把改过的**文档名 / 外观 / 纸张一起丢掉**。

所以要把它泛化成 `withDefaultsFilled(v, platform)`：

- **「键不存在」= 旧版本写的** → 补该平台的默认值
- **「值不合法」= 坏文件** → 整份退回默认值（既有姿态不变）

**为什么泛化而不是再写一个专用函数**：必须**逐条补**才能覆盖「将来加第四条快捷键、老用户的表里没有它」这种情况。写成「有 `shortcuts` 就整个跳过」的话，下一次加字段又会踩同一个坑。

## 6. 分发 —— 一条快捷键只在一个地方执行

| 平台 | `import` | `toggle-sidebar` | `open-settings` |
|---|---|---|---|
| macOS | **原生菜单** accelerator | 渲染层分发器 | 渲染层分发器 |
| Windows / Linux | 渲染层分发器 | 渲染层分发器 | 渲染层分发器 |

- **macOS 的 `import` 必须交给菜单。** 菜单 accelerator 一旦设置，按键就被菜单消费并触发 click；渲染层若也监听同一个键就会**双触发**（选一次文件却导入两次）。所以 macOS 上分发器显式跳过 `import`。
- `open-settings` **没有菜单项**（`menu.ts` 里根本没有设置项，已核实），所以三个平台都归渲染层。
- **菜单跟随设置**：`buildAppMenu` 增加一个「取当前快捷键表」的入参；`ipc.ts:62` 的 `saveSettings` handler 在写盘后重建一次菜单。**不加新 IPC 通道**——设置本来就要从这条路进主进程。
- 非 darwin 上 `buildAppMenu` 仍然 `setApplicationMenu(null)` 直接返回——**菜单策略一个字不改**，伪装上不留破绽。
- 渲染层分发器 = 一个 `window` keydown 监听，从注册表 + 当前设置建出「规范串 → 动作」表；命中则 `preventDefault()` 再执行。

**与输入法的关系（本应用最不能碰的地方）：**

- 分发器只认**带修饰键**的组合，裸按键一律放行 → 不与抽字逻辑抢键
- `isComposing` 为真时直接返回；不监听 keyup，不处理合成事件
- `InputCapture` 的逻辑**一个字不改**

## 7. 设置界面：录制框，并进「手动保存」组

`DeferredField.committed` 就是 `string`（`deferredSettings.ts:18`），而快捷键的规范串天然是字符串——所以 **`deferredSettings.ts` 不需要任何改动**，只需把三条加进 `SettingsDialog` 的字段表。

交互：

- 点输入框 → 进录制态，显示「请按下组合键…」
- 按下合法组合 → 显示 `formatShortcut()` 的结果，退出录制态
- 按 **Esc** → 退出录制态，**值不变**
- 按非法组合（无修饰键 / 撞车 / 命中保留清单）→ **停在录制态**并给出提示
- `↺` → 把草稿设成该平台默认值（仍是草稿，要点「保存」才生效）

**录制期间必须把分发器静音**，否则录 `⌘O` 会当场触发一次真导入。

## 8. 可录制的键位：白名单

只接受能**一对一映射成 Electron accelerator** 的键位：

- `KeyA`–`KeyZ`、`Digit0`–`Digit9`、`F1`–`F12`
- 常用标点：`Comma` `Period` `Slash` `Semicolon` `Quote` `BracketLeft` `BracketRight` `Backslash` `Minus` `Equal` `Backquote`
- `Space` `Enter` `Tab` `Home` `End` `PageUp` `PageDown` `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight`

**为什么用白名单**：accelerator 不是所有 `e.code` 都能表达。白名单让 `toAccelerator` **永远不会失败**，从而让 §6 那张「谁执行」的表保持**静态**——不需要「这条能不能进菜单」这种运行时判断。

## 9. 校验、冲突与错误处理

- **必须带修饰键。** 这个应用每一次裸按键都是有意义的，录成裸 `O` 等于把打字吃掉。拒绝。
- **应用内撞车** → 拒绝，提示撞的是哪一条（用 `ShortcutDef.label`）。
- **macOS 保留清单** → 硬拦 ⌘Q / ⌘W / ⌘M / ⌘H / ⌘C / ⌘V / ⌘X / ⌘A / ⌘Z。这些是 `menu.ts` 里 role 正在用的键，抢过来会废掉退出 / 关闭窗口 / 复制粘贴。
  - 这张清单**录制时和读盘时都要过**：手工改过 `settings.json` 的人同样能塞一个 ⌘Q 进来，只在录制端拦等于没拦。
- **Windows 不设保留清单**：那里没有菜单，Ctrl+C/V/X/A/Z 由 Chromium 对可编辑元素自理，而本应用的可编辑元素只有设置里的几个输入框。
- **磁盘上读到解析不了的串** → 该条退回该平台默认值 + `console.warn`。**不整份退回**——设置项是可再生的，没必要因为一条快捷键写坏而丢掉文档名。姿态与 `settingsProblem` 一致（说出是哪个字段）。

## 10. 明确不做

- **章节栏折叠状态的持久化**：仍是内存态，`ChapterList.tsx:64` 的取舍不变
- **Esc 进注册表**：`SettingsDialog.tsx:158` 的 Esc 是对话框内语义（「关掉这个对话框」），不是全局快捷键
- **全局快捷键**：`globalShortcut` 不碰，应用失焦时不响应
- **组合键序列（chord）**：不做 VS Code 那种「先按 ⌘K 再按 ⌘S」

## 11. 影响面

| 文件 | 改动 |
|---|---|
| `src/core/shortcuts.ts` | **新增**：注册表 + 纯函数 |
| `src/core/types.ts` | `AppSettings` 加 `shortcuts`；`defaultSettings()` 带上它 |
| `src/main/sessionStore.ts` | `withRatioFilled` → `withDefaultsFilled`；`settingsProblem` 加校验 |
| `src/main/menu.ts` | `buildAppMenu` 加「取快捷键表」入参，accelerator 从表里读 |
| `src/main/ipc.ts` | `saveSettings` handler 写盘后重建菜单 |
| `src/main/index.ts` | 给 `buildAppMenu` 传取值函数 |
| `src/main/session.ts` | 给 `createSessionStore` 传 `process.platform` |
| `src/renderer/src/state/shortcuts.ts` | **新增**：分发器 |
| `src/renderer/src/components/SettingsDialog.tsx` | 新增「快捷键」一节 + 录制框 |
| `src/renderer/src/components/Page.tsx` | 空状态文案改读注册表 |
| `src/renderer/src/components/ChapterList.tsx` | 去掉自己的监听；文案改读注册表 |
| `src/renderer/src/components/Ribbon.tsx` | 去掉自己的 ⌘, 监听，交给分发器；文案改读注册表 |
| `src/renderer/src/components/Toolbar.tsx` | title 文案改读注册表 |
| `src/renderer/src/App.tsx` | 挂分发器，把动作接进去 |

约 14 个文件。按仓库硬约定，每个被改动的源文件都要同步实现计划里的代码围栏。

## 12. 测试策略

- **`core/shortcuts.ts`**：三种表示互转、非法组合、修饰键顺序归一化、冲突查找、平台默认值 —— 纯函数，好测
- **`sessionStore`**：逐条补默认值（旧 `settings.json` 的形状）、坏值回退、新字段不污染其他字段
- **渲染层**：录制交互（进入 / 退出 / Esc / 非法 / ↺）、冲突提示、分发器命中与放行
- keydown 在 jsdom 里**是可测的**（`ChapterList` / `Ribbon` 现有用例就在测 window keydown），所以分发器不是只能真机验
- **只有一件必须真机验**：输入法合成期间按键会不会被分发器吃掉
