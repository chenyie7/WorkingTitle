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
- `defaultShortcut(id, kind)` → 某一条在该平台的默认值（设置界面那个 ↺ 用它）
- `resolveShortcuts(raw, kind)` → 稀疏表 → 完整表。**这就是「该平台的完整表」**，空表传进去即可
- `parseShortcut(spec)` / `normalizeSpec(spec)` → 解析结果或 `null`
- `fromChord(chord: KeyChord)` → 规范串或 `null`（录制用）
- `shortcutProblem(spec, kind)` → `'no-modifier' | 'unsupported-key' | 'reserved' | null`
- `formatShortcut(spec, kind)` → `⌘O` / `Ctrl+O`
- `toAccelerator(spec)` → `Cmd+O`
- `findConflict(table, spec, exceptId)` → 撞到的另一条 `ShortcutId` 或 `null`

【为什么不设一个 `defaultShortcuts(kind)`】它等于 `resolveShortcuts({}, kind)`，而那正是「一张空表」这个最常见输入的自然用法。多一个只转发一层的函数，只会让读代码的人多问一次「这两个有什么区别」。

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
shortcuts: Partial<Record<ShortcutId, string>>
```

**稀疏表：缺条目 = 用该平台的默认值**，由 core 的 `resolveShortcuts(raw, kind)` 补齐；`{}` 就是「全默认」。

【为什么是稀疏而不是完整表】完整表要求「谁读设置谁就得知道平台」，于是 `defaultSettings()` 与 `createSessionStore()` 都得加一个 `PlatformKind` 参数——而它们在测试里有六十多处调用点（写这句时实测 63；**这个数随测试增长只多不少**，所以别写成精确值——第一版写的「40 处 / 15 处」在合并时就已经错了）。稀疏之后这两个函数的签名**一个都不用动**，core 也不必去读 `process`（那是 node 的东西，而 core 要能被渲染层共用）。顺带一个好处：将来加第四条快捷键时，老用户的文件天然就是「缺这一条」。

**向后兼容是本次最容易毁数据的地方。** `sessionStore.ts` 现在的 `withRatioFilled` 只认 `ratio` 一个字段。旧 `settings.json` 里没有 `shortcuts`，而 `settingsProblem` 的取舍是「**一个字段不合格就整份退回默认值**」——直接加这个必填字段，会让老用户升级一次就把改过的**文档名 / 外观 / 纸张一起丢掉**。

所以要把它泛化成 `withDefaultsFilled`，补的是**键本身**：旧文件缺 `shortcuts` 就补成 `{}`（逐条的默认值归 `resolveShortcuts` 管，不在这层）。

- **「键不存在」= 旧版本写的** → 补上默认值
- **「值不合法」= 坏文件** → 整份退回默认值（既有姿态不变）

写成「缺哪个键补哪个」而不是再写一个专用函数：`ratio` 那次就是专用函数，再来一个 `withShortcutsFilled` 之后，下一次加字段还是得记得写第三个。

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
- **macOS 保留清单** → 硬拦 ⌘Q / ⇧⌘Q / ⌘W / ⌘M / ⌘H / ⌘C / ⌘V / ⌘X / ⌘A / ⌘Z。分两类：
  - **本应用菜单里 role 正在用的八个**：⌘Q 退出 / ⌘W 关闭 / ⌘H 隐藏 / ⌘X 剪切 / ⌘C 复制 / ⌘V 粘贴 / ⌘A 全选 / ⌘Z 撤销。（实测 `menu.ts` 只绑了这八个 role——**没有 `minimize`**，所以 ⌘M 不在此列）
  - **macOS 系统的两个**：⇧⌘Q 退出登录、⌘M 最小化。它们**不在**我们的菜单里，但应用级 accelerator 一样会把系统约定顶掉。
  - 这张清单**录制时和读盘时都要过**：手工改过 `settings.json` 的人照样塞得进来，只在录制端拦等于没拦。
  - 【刻意没做的一件事】菜单里其它 role 的键按同样的理由也算「被占」，但**没进清单**——那等于问「清单要不要从菜单模板推导出来」，是另一个决定。现在收的是「丢掉了最难受」的那几个。**没进的完整名单**（免得被读成漏项）：redo ⇧⌘Z、hideOthers ⌥⌘H、reload ⌘R、开发者工具 ⌥⌘I、实际大小 ⌘0、放大 ⌘+、缩小 ⌘−、全屏 ⌃⌘F。
- **Windows 不设保留清单**：`menu.ts` 对非 darwin 直接 `setApplicationMenu(null)`，那里一条菜单都没有，「抢了菜单 role」这件事不存在；⇧⌘Q / ⌘M 那类系统约定也没有对应物（关窗走 Alt+F4 与窗口按钮，归系统管）。
  - 【别写成「没有代价」——那句话核完之后站不住】Ctrl+C/V/X/A/Z 在这里**是有代价的**：Chromium 只对可编辑元素自理，而本应用**有活的可编辑元素**（`InputCapture` 的 `.wt-input`、设置里的几个输入框）。真正的理由是**代价可撤回**——那是用户自己录进去的，再录一次就拿得回来；而 macOS 那份清单拦的是「抢走 ⌘Q 之后应用给不回来」的能力。两者不是一回事。
- **磁盘上读到的串不合法时分两种情况，判据是「这层拿不拿得到平台」**：

  | 情况 | 谁判 | 结果 |
  |---|---|---|
  | 结构不合法（解析不了 / 没带修饰键） | `sessionStore.settingsProblem` | **整份退回默认值**，与其它所有字段姿态一致（见 §5） |
  | 平台不允许（macOS 保留键） | `core.resolveShortcuts` | **该条**退回该平台默认值，其余条目与其它设置项都不受影响 |

  第二行必须留在 core：`sessionStore` **拿不到平台**（那正是 §5 用稀疏表要避免的事），所以保留键它本来就判不了。反过来「解析不了」是纯结构问题，那一层能判、也该在那儿判——于是两层校验在真机路径上都跑得到，没有一层是摆设。

- **不在这里加 `console.warn`。** §7 之前的写法要求它，但 `resolveShortcuts` 是**渲染期每次都要跑**的热路径（`App` 的 `useMemo` 一次、菜单读取一次），在里面 warn 会刷屏；而读盘那一层拿不到平台，本来就说不出「是哪一条被忽略了」。用户能在设置界面里看见当前生效的键，这比日志更直接。

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
