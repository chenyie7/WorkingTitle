# 设置面板：统一尺寸 + 切页动效 —— 设计文档

日期：2026-10-17
状态：已实现（2026-10-17）

## 1. 目标

左栏分页落地之后暴露出两件事：

1. **三页的面板大小不一样**，换页时整块面板既变高矮、又上下跳（遮罩是垂直居中的）。用户的原话是「打开不同的界面大小不一致」。
2. **左栏点击没有任何动效**，点页签是硬切。

本次把面板定成一个固定高度、三页完全一致，并给左栏与内容区各加一条克制的过渡。

用户拍板的两件事：

- **接受留白**：固定高度取最高那页的自然高度，内容少的页底部空着（真 Word 的「选项」对话框就是这个观感）。
- **动效走克制的**：左栏颜色过渡 + 内容 120ms 淡入。不位移、不弹、不做滑动指示器。

## 2. 现状（实测）

在真 Electron 里跑 `out/` 构建、窗口内容高 860，逐页量 `.wt-modal__panel` 的 `getBoundingClientRect()`：

| 页签 | 面板高 | 内容区 `clientHeight` | 面板顶边 |
|---|---|---|---|
| 阅读设置 | **410** | 324 | y = 225 |
| 外观设置 | **198** | 112 | y = 331 |
| 快捷键设置 | **386** | 300 | y = 237 |

换页时面板**高矮差 212px、顶边跳 106px**。

根因：`.wt-modal__panel` 是 `height: auto` + `max-height: calc(100vh - 48px)`——高度由内容撑，`max-height` 只兜上限。而三页的行数差得远（阅读设置 6 行、外观设置 2 行、快捷键设置 6 行）。

动效现状：`.wt-nav__item` 与 `.wt-tabpanel` 上**一条 `transition` / `animation` 都没有**。全仓既有的动效词汇只有两种：`background-color 80–90ms ease`（`.wt-btn`、`.wt-page__fold`、`.chapter-item` 等）与 `border-color 90ms ease`，外加光标那条 `wt-blink` 关键帧。

## 3. 尺寸：固定 `height: min(410px, calc(100vh - 48px))`

**410 是实测得到的那一页（阅读设置）的自然高度**，不是猜的：`38`（标题条）+ `324`（内容区）+ `48`（footer）= `410`。

- 三页完全一致，切换时面板**一动不动**。
- 阅读设置刚好铺满（内容区 324 对 324，不出滚动条）；快捷键设置余 24px；外观设置余 212px，留白（已确认接受）。
- `min(410px, calc(100vh - 48px))` 让小窗口与高缩放下按视口收：200% 缩放（最小窗口）时是 `min(410, 262) = 262`，内容区变 176、自己滚。

### 3.1 顺带消掉一个已知脆弱点

现在 `height: auto` + `max-height` 会让面板的高度**在 flex 布局跑的时候是不确定的**——`max-height` 是事后才夹的，于是百分比 `flex-basis` 解不出来、Blink 退回内容尺寸、出现负自由空间、进入收缩相。上一批的「标题条被压扁到 26px」就是这条链造成的。

改成固定 `height` 之后，面板高度**恒为确定值**（`min()` 的两个操作数都是确定值），收缩相根本不发生。所以：

- `.wt-modal__header` 上那条 `flex: 0 0 auto` 从「必需」降为「多余但无害」——**保留**（它是一道不会错的保险，删掉只会让将来改动重新暴露在同一个坑里）。
- `.wt-modal__panel` 上原来的 `max-height` **可以删**（`height` 已经把它包进去了）。删掉比留着两份互相重叠的约束清楚。

**别写 `height: 410px` 而不带 `min()`**：那样高缩放/矮窗口下面板会顶出屏幕，footer 够不着——那正是上一批 `max-height` 要修的东西，绕回去等于白改。

## 4. 动效

### 4.1 左栏

```css
.wt-nav__item {
  transition:
    background-color 90ms ease,
    border-color 90ms ease,
    color 90ms ease;
}
```

与全仓既有的 `.wt-btn`（`background-color 90ms ease, border-color 90ms ease`）是同一个词汇。

**`font-weight` 刻意不进 `transition`**：它从 400 跳到 600 时浏览器不做插值（本应用用的是系统字体栈，不是可变字体），进 transition 只会让「同一时刻一部分属性在动、一部分在跳」，反而更乱。`.wt-seg` 那组选中态也是「颜色过渡、`font-weight: 600` 硬跳」，与之一致。

**`border-color` 要进 transition 的原因**：选中/未选中之间 `border-left` 的颜色从 `transparent` 变到 `--wt-accent`。不写它的话那道 2px 竖条会瞬间出现，而底色在 90ms 里慢慢变——两者不同步很明显。

### 4.2 内容区淡入

```css
@keyframes wt-panel-in {
  from { opacity: 0 }
  to { opacity: 1 }
}

.wt-tabpanel {
  animation: wt-panel-in 120ms ease;
}
```

**为什么不加 `key`、不强制 reflow**：非当前页是 `display: none`（`.wt-tabpanel[hidden]`），按规范，元素从 `display: none` 变成有显示时动画会**从头开始**。所以切回来时动画自然重跑，不需要任何 JS。

**打开对话框时当前页也会淡入一次**——这是想要的，它顺带成了「对话框出现了」的提示，与 `.wt-modal` 的 `backdrop-filter` 一起构成入口观感。

### 4.3 时长与缓动的取舍

| | 值 | 理由 |
|---|---|---|
| 左栏 | 90ms `ease` | 抄全仓既有值，不新造一档 |
| 内容 | 120ms `ease` | 只比左栏略长；再长（200ms+）会让「点了没反应」的错觉回来，而这次改动的前提之一就是「点了当场到位」 |

**不做的事**：不做位移/缩放/弹跳，不做转场方向（左切右切都一样），不做滑动指示器。理由是本应用的外壳是 Word，Word 的选项对话框切换是「换一页」，不是「翻一页」。

## 5. 边界

- **小窗口与高缩放**：高度由 `min(..., calc(100vh - 48px))` 兜住，内容区自己滚；左栏已有 `overflow-y: auto`（上一批加的）。三页在 200% 缩放下的内容区都是 176px。
- **`prefers-reduced-motion`**：加一条把这个动画与过渡关掉的媒体查询。

  **但必须说清一件事**：本仓库已知 `@media (prefers-color-scheme: dark)` 在渲染层**恒不命中**（Electron 那条坑，见 CLAUDE.md 的「外观与主题」一节）。`prefers-reduced-motion` **是否命中没有验证过**。这条不命中时完全惰性（不影响任何用户），所以先加上；**若将来量出它在本应用里恒不命中，正解是走主进程 IPC 把它递过来（与主题同一条路），不是删掉这条媒体查询**。

  ```css
  @media (prefers-reduced-motion: reduce) {
    .wt-nav__item { transition: none }
    .wt-tabpanel { animation: none }
  }
  ```

- **`hidden` 与非当前页**：不变。三页仍然都渲染、非当前页 `display: none`。

## 6. 影响面

| 文件 | 改什么 |
|---|---|
| `src/renderer/src/styles/ribbon.css` | `.wt-modal__panel` 的 `max-height` → `height: min(410px, calc(100vh - 48px))`；`.wt-nav__item` 加 `transition`；`.wt-tabpanel` 加 `animation`；新增 `@keyframes wt-panel-in` 与 `prefers-reduced-motion` 那条 |
| `tests/e2e/app.spec.ts` | 新增一条：切三页各量 `.wt-modal__panel` 的 `getBoundingClientRect().height`，三者相等 |
| `docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md` | 回写上面两个文件的逐字节围栏 |

**明确不动**：`SettingsDialog.tsx`（三页仍全渲染、`hidden` 机制不变，**不需要任何 JS 改动**）、`src/core/**`、`src/main/**`、`src/preload/**`、任何持久化字段。用户的选择（哪种动效、接受留白）都是**视图层的静态决定**，没有要记住的东西。

### 6.1 一条要留意的不变量

上一批建立的那条：**「打开即聚焦、焦点留在对话框里」是「对话框开着时打字不抽小说」的前提**。本次不碰焦点、不碰 `hidden` 的语义，所以那条不受影响——但改完仍然要跑 `pnpm test`，其中那条 autoFocus 用例（含「关掉再打开」）要照旧全绿。

## 7. 测试策略

### 7.1 尺寸只能由 e2e 判

jsdom 没有布局（`getBoundingClientRect()` 恒为 0），单测判不了「三页一样高」。判据进 `tests/e2e/app.spec.ts`：

1. 打开设置，依次点三个页签，每一页读到 `.wt-modal__panel` 的 `getBoundingClientRect().height`；
2. **三者相等**（`toBe` 级别的相等，不是「差不多」）；
3. 每页**同时**读 `.wt-modal__body` 的 `scrollHeight - clientHeight`，**三页都必须是 0**；
4. 每页**同时**断言另两个 tabpanel `toBeHidden()`。

这一条同时守住「不许回到 `height: auto`」——一旦回去，三页立刻不等。

**关于第 3 条（2026-10-17 修订，初稿写的是「顺带断言那个值 `>= 410`」）**：`>= 410` 是个**代理断言**，它挡的是「有人把 `min()` 的第一项改小」，但挡不住反方向——**阅读设置将来加一行、自然高度超过 410 时，面板仍是 410、内容被裁，而 `>= 410` 照样通过**。而 `scrollHeight <= clientHeight` 判的正是「有没有东西被切掉」本身，既覆盖「改小了」也覆盖「内容长了」，**且不依赖窗口高度**。所以替换。

**关于第 4 条**：少了它有一个**假绿口子**——如果有人把 `.wt-tabpanel[hidden] { display: none }` 删掉，三页会叠在一起，面板每次都是同一个值，第 2 条照样绿（而被点的那块本来就可见，第 2 步里的 `toBeVisible()` 也不会失败）。那条规则的注释自己就写着「单测只看属性，照样全绿」，这条 e2e 正好补上。

**窗口高度不再是判据**：第 1、2、3 条都与窗口高度无关——窗口再矮，三页也会被同一个 `calc(100vh - 48px)` 夹成同一个值，`scrollHeight <= clientHeight` 也仍然成立（内容区本来就会滚）。**别为了让它过而把窗口写死。**

### 7.2 动效只能由人判

`animation` / `transition` 的观感 jsdom 判不了，e2e 也判不了（Playwright 能等到动画结束，但判不出「快慢对不对」）。这一条进真机验收清单：

- 切换页签时**内容有一个很快的淡入**，不是硬切；
- 鼠标划过左栏、点下页签时，底色/文字色/左缘竖条**一起**渐变过去，没有「半截在动、半截在跳」；
- 动画期间文字**没有模糊或闪烁**（`opacity` 动画在某些组合下会触发次像素渲染差异，肉眼能看出来）。

### 7.3 门禁

`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:e2e`。**一律看 exit code。**

## 8. 明确不做

- **不做滑动指示器**：需要在左栏里加一层绝对定位的「选中底」元素，还要跟滚动、缩放、页签数量变化对齐。用户已选克制方案。
- **不做位移/缩放/方向感**：外壳是 Word，翻页动画与它的观感冲突。
- **不把内容垂直居中**：用户选了「接受留白」。
- **不记住「上次停在哪个尺寸」之类**：尺寸与动效都是静态决定，没有状态。
- **不给 `prefers-reduced-motion` 走主进程 IPC**：那是「量出它恒不命中」之后的事，本次先按标准做法加上。
- **不动 `SettingsDialog.tsx`**：本次纯 CSS + 一条 e2e。

## 9. 实现记录（2026-10-17）

### 9.1 落地了哪些

| 提交 | 改了什么 |
|---|---|
| `a1d743b` | `tests/e2e/app.spec.ts`：新增「三页面板大小一致」的真机断言（**先红**：实测 410 / 198 / 386） |
| `bf63293` | 同一条用例加固：堵两个假绿口子、把「>= 410」换成 `scrollHeight - clientHeight === 0` |
| `e3d9b7c` | `ribbon.css`：`max-height` → `height: min(410px, calc(100vh - 48px))`（让上面那条转绿） |
| `233d72e` | `ribbon.css`：同步三处还在讲旧 `max-height` 机制的注释 |
| `ee55c27` | `ribbon.css`：左栏 90ms 过渡、`.wt-tabpanel` 120ms 淡入、`prefers-reduced-motion` |

**明确没动**：`SettingsDialog.tsx`（一行都没改）、`src/core/**`、`src/main/**`、`src/preload/**`、任何持久化字段。

### 9.2 门禁实测

| 命令 | exit | 结果 |
|---|---|---|
| `pnpm typecheck` | **0** | 两个 tsconfig |
| `pnpm test` | **0** | 32 文件 / 659 用例，无 `Errors` 行 |
| `pnpm build` | **0** | — |
| `pnpm test:e2e` | **0** | **9 passed**（新增那条「三页等高」在内） |

### 9.3 评审实测出来的东西

**尺寸（真 Blink，五档缩放 × 两种窗口 × 三页）**：面板恒等于 `min(410, 100vh − 48)`——默认窗口 100%/150% 取 410、200% 起取 calc 支（382 / 296 / 238.67）；最小窗口 150% 起取 calc 支（365.33 / 262 / 200 / 158.67）。**`header` 五档全是 38**，footer 始终完整可见，三页在每一档都等高。

**一个变异实验把 3.1 从推演变成实测**：把 `.wt-modal__header` 的 `flex: 0 0 auto` 改成允许收缩的 `flex: 0 1 auto`——**新 CSS 五档仍是 38**，换回旧写法才复现 200% → 35.06、250%/300% → 26。固定 `height` 消掉了收缩相，`flex: 0 0 auto` 现在是保险。

**淡入（真 Blink）**：切页时 `opacity` 0 → 0.771（60ms）→ 1（150ms），`getAnimations()` 的 `currentTime` 回到 0；**切回来也一样**——「`display: none` 会让动画自动重跑、不需要 JS」成立。动画期间面板恒 410、`tabpanel.offsetHeight` 恒定（opacity 不碰布局）。

**左栏过渡（真 Blink）**：`transition-property` 是 `background-color, border-color, color`、`0.09s`；中途三条同步插值，而 **`font-weight` 在 t=0 就跳到 400、没有被插值**（正是刻意）。选中项强制 `:hover` 时计算值仍是 `rgb(234,241,251)`——上一批修的「悬停吃掉选中底」没被破坏。

### 9.4 `prefers-reduced-motion`：两件事必须分开记

**这是本条设计里唯一一处「未验证」，而本次也只验证了一半。**

- **(a) CSS 本身对不对 —— 已证实（CDP `Emulation.setEmulatedMedia`，真 Blink）**：模拟 `reduce` 之后 `matchMedia` 变 `true`、`.wt-nav__item` 的 `transition-property` 变 `none`、`.wt-tabpanel` 的 `animation-name` 变 `none`，去掉 `hidden` 后 `getAnimations()` 是空、`opacity` 直接是 1（没有 0 的首帧）。重置模拟后一切恢复。**级联顺序与关闭效果都正确。**

- **(b) 操作系统的设置能不能传到渲染层 —— 仍未证实，而且在这台机器上量不出来。** 系统「减弱动态效果」处于关闭（`ReduceMotionEnabled = 0`），此时「链路通、正确返回 false」与「恒返回 false」**观测值完全相同**，无法区分。同机还复现了 `prefers-color-scheme` 那条已知断链（主进程 `shouldUseDarkColors = true`、渲染层 `matchMedia` 为 false），说明这个环境正是那个坑。

**推论：别把 (a) 当成 (b)。** 要得到 (b) 的答案需要一台真的打开了「减弱动态效果」的机器；若那时发现它恒不命中，正解是走主进程 IPC（与主题同一条路），**不是删掉那条媒体查询**。

### 9.5 一处与设计的偏差（评审提出、已采纳）

初稿的 e2e 断言里有一条 `heights[0] >= 410`，用来「防止把 `min()` 的第一项改小、三页虽然一致但内容被裁」。评审指出这是个**代理断言**：它挡不住反方向——阅读设置将来加一行、自然高度超过 410 时，面板仍是 410、内容被裁，而它照样通过。已换成 `.wt-modal__body` 的 `scrollHeight - clientHeight === 0`（三页都要），既覆盖「改小了」也覆盖「内容长了」，且不依赖窗口高度。实测确认：往阅读页尾部加一行同构的行后，`324 → 370`、overflow 46，那条当场失败。

同一次还堵了另一个假绿口子：**三页同时可见时**（若有人删掉 `.wt-tabpanel[hidden] { display: none }`）面板恒为同一个值，只断言「三者相等」会绿。现在每轮另加两个 tabpanel 的 `toBeHidden()`。
