# 设置界面分页 —— 设计文档

日期：2026-10-17
状态：待用户审阅

## 1. 目标

设置对话框现在是一页到底：9 行依次排下来，从「文档名」到「工作文档」，中间夹着外观三选一与三条快捷键。行数只会继续涨，一页到底会越来越难找。

本次把它拆成**左栏三个页签 + 右侧内容区**：左栏点一下，右边只显示那一类设置。

用户拍板的三件事：

- 左栏三项，顺序固定为 **阅读设置 → 外观设置 → 快捷键设置**。
- 分组归属（用户原话逐项落到具体行）：**阅读设置**收「文档名、阅读替换、输入法、导入小说、工作文档、正文字号」；**外观设置**收「外观、纸张」；**快捷键设置**收全部快捷键。
- 打开时**固定停在「阅读设置」**，不记住上次看的那一页。

## 2. 现状

`src/renderer/src/components/SettingsDialog.tsx` 一个文件 783 行，结构是：

```
.wt-modal                      遮罩（点它自己关闭）
  .wt-modal__panel             440px 宽的白色面板
    .wt-modal__header          「选项」+ ✕
    .wt-modal__body            flex column，gap 16px，9 行 .wt-modal__row
    .wt-modal__footer          有未保存改动时出现「保存」+ 常驻「关闭」
```

`.wt-modal__body` 里那 9 行是：

| 行 | testid | 归属（本次） |
|---|---|---|
| 文档名 | `doc-title-input` | 阅读设置 |
| 阅读替换（全局 + 当前书） | `global-ratio-input` / `ratio-input` | 阅读设置 |
| 输入模式 | `mode-button` | 阅读设置 |
| 正文字号 | `page-font-size-input` | 阅读设置 |
| 外观（跟随系统/浅色/深色） | `theme-system` / `theme-light` / `theme-dark` | 外观设置 |
| 纸张（深色下也变暗） | `dark-paper` | 外观设置 |
| 快捷键 ×6 | `shortcut-<id>-input` / `-reset` | 快捷键设置 |
| 小说（导入小说 / 清除阅读记录） | `btn-import` / `btn-clear-session` | 阅读设置 |
| 工作文档（状态 / 导入 / 移除） | `work-doc-status` / `btn-import-work-doc` / `btn-remove-work-doc` | 阅读设置 |

**快捷键是 6 条不是 3 条**（`src/core/shortcuts.ts` 的 `SHORTCUTS`）：导入小说、显示/隐藏章节栏、打开设置、老板键、老板键铺满 +、老板键铺满 −。设置界面按表自动生成，所以「快捷键设置」页会有 6 行。

「清除阅读记录」用户没点名。它与「导入小说」是同一行里的两个按钮，按同一组归进阅读设置。

## 3. 结构与组件

面板 440px → **680px**，中间多一条 **152px** 的左栏：

```
.wt-modal__panel                 max-height: calc(100vh - 48px)，flex column
  .wt-modal__header              「选项」+ ✕                        （不变）
  .wt-modal__main                新增，flex row，min-height: 0
    .wt-modal__nav               新增，flex: 0 0 152px，role="tablist"
      button.wt-nav__item ×3     role="tab"
    .wt-modal__body              现有那个，改成 flex: 1 / min-width: 0 / overflow-y: auto
      .wt-tabpanel ×3            新增，flex column / gap 16px
        .wt-modal__row …         现有那些行，一行不动地搬进来
  .wt-modal__footer              「保存」/「关闭」                   （不变）
```

**行本身一行不动，testid 全部保留。** 本次改的只是外面那层壳。

`.wt-modal__body` 原来的 `display: flex; flex-direction: column; gap: 16px` 三条**整体挪到 `.wt-tabpanel` 上**，body 自己不再设 `display`（退回块级，只留着 `padding` 与 `overflow-y`）——行间距的来源不变，只是从「body 直接管着行」变成「每个页各管自己那一组行」。

### 3.1 页签表

跟文件里既有的 `THEME_OPTIONS` 同一套写法：

```ts
/** 左栏的页签。**加一页就是加一行**——数组顺序就是左栏从上到下的顺序。 */
const PAGES = [
  { id: 'reading', label: '阅读设置', icon: IconBook },
  { id: 'appearance', label: '外观设置', icon: IconDarkTheme },
  { id: 'shortcuts', label: '快捷键设置', icon: IconKeyboard }
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: FluentIcon }>

type SettingsPage = (typeof PAGES)[number]['id']
```

三个图标都已在 `icons.tsx` 里导出，也已经在 `SettingsDialog.tsx` 顶部 import，不用新增图标。

每行标签左侧那些图标**保留不动**（`IconRename` / `IconFontSize` / `IconKeyboard` / `IconDarkTheme` / `IconDocument` / `IconBook`）。于是 `IconBook`、`IconDarkTheme`、`IconKeyboard` 会同时出现在左栏与某一行上。这是刻意接受的：左栏的图标是**分类标记**，行上的是**字段标记**，功能区里同一图标重复出现也是既有的常态；去掉行图标是纯装饰性的改动，白白多动 7 行。

## 4. 非当前页怎么藏

**三页都渲染，非当前页加 `hidden` 属性。**

另一条路是只渲染当前页。不选它，理由有两条，第一条是硬的：

- 现有测试里有 **40 多处 `getByTestId` 跨页取元素**（`ratio-input`、`mode-button`、`theme-dark`、`shortcut-*-input`、`work-doc-status`…）。`hidden` 的话它们一条都不用改；条件渲染的话每条都得先切页才拿得到元素，而且 `tests/unit/settings.test.tsx` 里「打开时焦点落在文档名上（autoFocus）」那条会当场坏。
- 非当前 tabpanel 加 `hidden` 是 ARIA tabs 的标准做法，不是为测试让路的将就。

**必须补一条 `.wt-tabpanel[hidden] { display: none }`。** `hidden` 属性靠的是 UA 默认样式表里的 `display: none`，任何一条给该元素设了 `display` 的规则都会盖掉它——而本次正要给 `.wt-tabpanel` 写 `display: flex`（见第 3 节）。少了这条，三页会同时显示、`hidden` 形同虚设。

代价（写清楚，免得将来当成 bug）：非当前页的表单控件仍在 DOM 里。`display: none` 的元素不可聚焦、不可点击、也不在无障碍树里，所以用户侧没有可感知差别；但**取 DOM 的代码对三页一视同仁**（测试尤其要记得这一点）。

## 5. 交互

- **默认停「阅读设置」**，不记住上次。注意 `SettingsDialog` 在 `open` 为假时只是 `return null`——**组件并不卸载，`useState` 会跨开关保留**。所以「固定打开第一页」要靠现有的 `useEffect(() => { if (open) reset() }, [open, reset])` 那条一起把 `page` 重置回 `'reading'`，不能只靠 `useState` 的初值。
- **草稿跨页保留。** 切页签不碰草稿。「保存」按钮在 footer 里，与当前是哪一页无关——在阅读设置改了字号、切去外观设置，它照样亮着，点下去照样提交。这正是 `useDeferredSettings` 把草稿放在对话框这一层的好处，本次不动它。
- **切页签＝取消正在进行的快捷键录制。** 录制框在快捷键页上，切走就看不见了；留着录制态只会让分发器一直哑着，而用户完全看不出为什么快捷键失效了。这是既有语义（点别处＝放弃录制，见录制框的 `onBlur`）的直接延伸，用 `useEffect(() => setRecording(null), [page])` 落。
- **左栏 ↑ / ↓ 移动并当场切页**（ARIA tabs 的「自动激活」），Home / End 跳首尾。左栏只有一个 Tab 停靠点（roving tabindex：选中的那一项 `tabIndex={0}`，其余 `tabIndex={-1}`），Tab 从它进内容区。
  方向键那一下要 `preventDefault()`，并且**显式把焦点移到新页签的按钮上**——roving tabindex 换人之后浏览器不会自己跟过去。
- 关闭路径四条全不变：Esc、点遮罩、标题栏 ✕、footer「关闭」。
- 打开时的 `autoFocus` 仍在「文档名」输入框上。它在默认页，与分页不冲突。

### 5.1 无障碍

- `.wt-modal__nav`：`role="tablist"`，`aria-orientation="vertical"`，`aria-label="设置分类"`。
- 每个页签按钮：`role="tab"`，`id="wt-tab-<id>"`，`aria-selected`，`aria-controls="wt-tabpanel-<id>"`，roving `tabIndex`。
- 每个面板：`role="tabpanel"`，`id="wt-tabpanel-<id>"`，`aria-labelledby="wt-tab-<id>"`，`hidden={page !== id}`。**不给面板加 `tabIndex={0}`**：三个页面里都有可聚焦的控件，ARIA 的写法是这种情况下不必给面板自己一个停靠点。

## 6. 视觉

### 6.1 尺寸

- `.wt-modal__panel`：`width: 680px`，`max-width: calc(100% - 48px)`（小窗口下照旧自动缩），新增 `max-height: calc(100vh - 48px)` 与 `display: flex; flex-direction: column`。
- `.wt-modal__main`：`flex: 1; min-height: 0; display: flex`。`min-height: 0` 不能省——flex 子项的默认 `min-height: auto` 会让内容把面板撑破，而不是让内容区滚动。
- `.wt-modal__nav`：`flex: 0 0 152px`，`padding: 8px 0`，`border-right: 1px solid var(--wt-chrome-border)`，白底（与面板同色）。分隔线用既有的 token，深浅两套自动跟着翻。
- `.wt-modal__body`：`flex: 1; min-width: 0; overflow-y: auto`，保留 `padding: 20px 18px`。**`min-width: 0` 同样不能省**，否则「阅读替换」那一行（96px 固定标签 + 一串固定宽元素）的最小内容宽度会把面板顶宽。
- `.wt-tabpanel`：`display: flex; flex-direction: column; gap: 16px`（从 `.wt-modal__body` 挪过来的那两条）。
- `.wt-tabpanel[hidden]`：`display: none`（见第 4 节，**必须排在 `.wt-tabpanel` 那条之后**）。

内容区加滚动是顺带修的一个既有毛病：现在 9 行在小窗口里会把面板顶出屏幕，footer 的按钮够不着。三页之后最高的是阅读设置（6 行，其中「阅读替换」与「工作文档」两行本身就占两行高），仍然会超。

### 6.2 左栏项

```
.wt-nav__item            整宽、方角、贴边的一条
  height: 32px, padding: 0 12px
  display: flex, align-items: center, gap: 8px
  font-size: 12px, text-align: left
  border: none; border-left: 2px solid transparent
  background: transparent
  color: var(--wt-text-muted)
```

- **常态**：透明底、`--wt-text-muted` 的字。
- **悬停**：`background: var(--wt-chrome)`。
- **选中**：`background: var(--wt-blue-light)`，`border-left-color: var(--wt-accent)`，`color: var(--wt-accent)`，`font-weight: 600`。
- **键盘焦点**：`:focus-visible` 给 `outline: 2px solid var(--wt-accent); outline-offset: -2px`。本次给左栏加了方向键导航，焦点样式不能缺。
- 图标 `filled={active}`：与同一个对话框里外观三选一那个 `.wt-seg`、以及功能区那些切换按钮同一套语义（未选中画线框、选中画实心）。

左栏的选中底色**用 `--wt-blue-light` 而不是写死一个浅蓝**。那个 token 就是全应用「选中项底色」的既有答案（功能区里已在用），深浅两套各有一个值（`#eaf1fb` / `#2b2b34`），选了它就不必再给深色写第二份。

### 6.3 深色主题

`.wt-nav__item` 的选中态与悬停态**全部走 token**（`--wt-blue-light` / `--wt-chrome` / `--wt-accent` / `--wt-text-muted` / `--wt-chrome-border`），这些在 `[data-theme='dark']` 里都已经各有一档。所以深色下**不需要新增任何一条 `[data-theme='dark']` 规则**。

这与 `word.css` 里那条反复出现的取舍是同一个道理：一个值要在两种底上扮演两种角色时才必须拆成两个变量，而这里每个角色都已经有现成的 token。**实现时如果发现漏了某个写死的颜色，正确的做法是找/补 token，而不是在深色块里再抄一遍。**

## 7. 影响面

改动文件：

| 文件 | 改什么 |
|---|---|
| `src/renderer/src/components/SettingsDialog.tsx` | 加 `PAGES` 表、`page` 状态、左栏 JSX、把现有 9 行裹进三个 `.wt-tabpanel` |
| `src/renderer/src/styles/ribbon.css` | 第 3、6 节那些新类与改动的旧类 |
| `tests/unit/settings.test.tsx` | 新增分页用例（见第 8 节） |
| `tests/e2e/app.spec.ts` | 第 7.1 节那处坐标 |
| `docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md` | 回写上面四个文件的逐字节围栏 |

不动：`src/core/`（本次一行都不进）、`src/main/`、`src/preload/`、`deferredSettings.ts`、`Ribbon.tsx`、持久化的任何字段。

### 7.1 e2e 有一条必须动

`tests/e2e/app.spec.ts` 里那条「设置对话框：按钮与 ⌘, 都能开，开着时敲键盘不抽字，Esc 关」有这么一行：

```ts
await win.locator('[data-testid="settings"] .wt-modal__panel').click({ position: { x: 4, y: 60 } })
```

它的注释写着「点对话框里不可聚焦的**空白处**（面板左边缘、行标号左侧）」，用来验「点空白 → 焦点交给 body → 键盘也没有焦点宿主 → 更不该被抢回阅读区」。

改完之后 x=4 落在 152px 宽的左栏里、y=60 落在第一个页签上——它变成「点了一个页签按钮」，**断言仍会绿，但那条用例已经不再验它声称要验的东西**。必须把坐标挪到真正的空白处（内容区右侧或面板底部一片没有控件的区域），并且**顺带核一遍改完之后那个坐标真的落在空白上**。

### 7.2 围栏同步

四个被改的文件在 `2026-10-06-word-disguised-typing-reader.md` 里**各有一个逐字节围栏**（实测确认：`SettingsDialog.tsx` / `ribbon.css` / `settings.test.tsx` / `app.spec.ts` 都命中）。改完必须按仓库口径回写：

- 逐字节围栏：`md5(围栏原始内容) == md5(文件)`，含末尾换行，不要 rstrip。
- 片段围栏：另跑一遍子串判据（会有示意性假阳性，逐个看）。
- 交付前跑一遍「每个源/测试文件都命中至少一个围栏」的正向复核。
- 回写是**会改源码之外的文件**的收尾动作，排在所有源码改动之后做。

## 8. 测试策略

### 8.1 新增单测（`tests/unit/settings.test.tsx`）

jsdom 没有布局，「可见/不可见」判不了。但 `hidden` 是**DOM 属性**，判得了——这几条都断言 `hidden` 属性与 `aria-selected`，不断言视觉。

1. 打开时只有「阅读设置」那个面板没有 `hidden`，另两个有。
2. 点「外观设置」：`aria-selected` 跟着换，两个面板的 `hidden` 互换；点「快捷键设置」同理。
3. 左栏三项的文案与顺序是「阅读设置 / 外观设置 / 快捷键设置」。
4. **切页保留草稿**：在阅读设置改字号 → 切到外观设置 → 「保存」按钮仍在 → 点保存 → `onPageFontSizeChange` 收到新值。
5. **切页取消录制**：点开某条快捷键的录制 → 切到外观设置 → `onRecordingChange` 收到 `false`。
6. **关掉再打开回到第一页**：切到快捷键设置 → 关闭 → 再打开 → 停在阅读设置。
7. **方向键**：左栏 ↑ / ↓ / Home / End 切页且焦点跟着落到新页签上（`document.activeElement`）。

### 8.2 必须仍然全绿的既有用例

第 4 节那条路（`hidden` 而不是条件渲染）就是为了这个：**`tests/unit/settings.test.tsx` 与 `ribbon.test.tsx` 里所有既有断言一条都不该改**。改完先跑一遍，红了说明选了条件渲染或漏了 `hidden`。

同时要**正面确认**前面那个判断——那 40 多处跨页取元素确实还在 DOM 里，而不是我们碰巧没跑到。

### 8.3 门禁

`pnpm typecheck`（两个 tsconfig）、`pnpm test`、第 7.2 节的围栏复核。`pnpm test:e2e` 需要先 `pnpm build`，e2e 里那条改坐标的用例是本设计第 7.1 节唯一能在真机判的部分。

## 9. 明确不做

- **不做「记住上次停留的页」**。用户选了固定第一页；记住上次要多一个落盘字段（多一处校验、多一处旧文件兼容），并且要给「关掉＝丢弃」的既有语义打补丁。
- **不给「快捷键设置」里的 6 行再分「常用 / 老板键」两组。** 这需要在 core 的 `SHORTCUTS` 注册表里加一个分组字段（否则新增一条老板键快捷键会静默落错组）。而 `src/core/shortcuts.ts` 的逐字节围栏**只活在 `2026-10-11-configurable-shortcuts` 那份计划里**（06 里没有它），改它就得去补一份本不该再动的围栏。为一个装饰性的小标题不值。真要做的话是独立一次改动。
- **不把 `SettingsDialog.tsx` 拆成多个文件。** 拆开之后 `drafts` / `setDraft` / `blur` / `recording` / `handleSave` 这一整套要在文件之间穿透，而仓库的既有写法就是「一张表 + 一个文件」（`Ribbon.tsx` 1300 多行、7 个选项卡全在里面）。加完约 900 行，仍在同一个量级。
- **不给非当前页做懒加载。** 三个页面加起来是十来个原生控件，没有可省的。
- **不动**：关闭路径、`Esc` 语义、录制期间的静音、`useDeferredSettings` 的草稿模型、任何持久化字段、`Ribbon.tsx` 里开对话框那个按钮。
- **不给老板键的 `bossFillPercent` 加界面**（它现在只由两条快捷键加减）。不在本次范围内。
