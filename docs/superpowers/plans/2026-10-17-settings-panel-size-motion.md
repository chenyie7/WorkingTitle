# 设置面板统一尺寸 + 切页动效 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把设置面板定成一个固定高度（三页完全一致、切换时面板不动），并给左栏与内容区各加一条克制的过渡。

**Architecture:** 纯 CSS + 一条 e2e。`ribbon.css` 里把 `.wt-modal__panel` 的 `max-height` 换成 `height: min(410px, calc(100vh - 48px))`，给 `.wt-nav__item` 加 `transition`、给 `.wt-tabpanel` 加一个 120ms 的 `opacity` 淡入。`SettingsDialog.tsx` **一行都不改**——三页仍全渲染、`hidden` 机制不变，动效靠「`display: none` → 有显示时动画自动重跑」这条规范行为。

**Tech Stack:** 纯 CSS（无新依赖）、Playwright `_electron`（尺寸只能由真机判）。无新文件。

**设计文档：** `docs/superpowers/specs/2026-10-17-settings-panel-size-motion-design.md`。**判据取设计文档，不是本计划里的片段自己。**

**分支：** `feat/reading-font`（继续在这条分支上，不另开）。

---

## 读这份计划之前必须知道的四件仓库硬约定

1. **`git add` 用显式路径**（绝不 `-A`），**`git commit -F <消息文件>`**（绝不内联 `-m`——消息里的 ASCII 双引号会静默截断），**绝不 `--amend`**。提交前先 `git branch --show-current`，并重读 `git log --oneline -1`。
2. **验收由用户跑**，不要自建探针脚本、不要写变异矩阵留在仓库里。门禁照跑，**一律看 exit code，不要只 grep 摘要行**（本仓库出现过两种「摘要行看着是绿的」：unhandled rejection 与某个测试文件整体失败）。
3. **工作区里可能有别人的未提交改动**——`git status` 里不认识的先问，别 `git add`。
4. **围栏回写**：本计划**不新建任何源文件**，所以按仓库排法，被改文件的逐字节围栏回写到正本 `2026-10-06-word-disguised-typing-reader.md`（06），本计划里的代码块是待落地的目标代码、不是围栏副本。

---

## 文件结构

| 文件 | 改什么 | Task |
|---|---|---|
| `tests/e2e/app.spec.ts` | 新增一条「三页面板大小一致」的真机断言 | 1 |
| `src/renderer/src/styles/ribbon.css` | `.wt-modal__panel` 固定高度 | 2 |
| `src/renderer/src/styles/ribbon.css` | `.wt-nav__item` 过渡、`.wt-tabpanel` 淡入、`@keyframes`、`prefers-reduced-motion` | 3 |
| `docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md` | 回写两面围栏 | 4 |

**明确不改：** `src/renderer/src/components/SettingsDialog.tsx`（一行都不动）、`src/core/**`、`src/main/**`、`src/preload/**`、任何持久化字段、`tests/unit/**`。

**为什么 `SettingsDialog.tsx` 不用改**：三页仍然都渲染、非当前页仍然 `hidden`（`display: none`）。而按规范，元素从 `display: none` 变成有显示时，它的动画会**从头开始**——所以切页时淡入会自然重跑，不需要 `key`、不需要强制 reflow、不需要任何 JS。

**为什么不改 `tests/unit/**`**：尺寸与动效**在 jsdom 里都判不了**（没有布局，`getBoundingClientRect()` 恒为 0；也没有动画语义）。为它们写单测只会得到恒真的假断言。

---

## Task 1: e2e —— 三页面板大小必须一致（先写会红的）

**对应设计：** 第 7.1 节。

**Files:**
- Modify: `tests/e2e/app.spec.ts`

- [ ] **Step 1: 写失败的测试**

在 `tests/e2e/app.spec.ts` 里，在 `test('设置对话框：按钮与 ⌘, 都能开，开着时敲键盘不抽字，Esc 关', …)` 那条**之后**追加：

```ts
/**
 * 三页的面板必须一样大。
 *
 * 【为什么只有这条判得了】jsdom 没有布局，`getBoundingClientRect()` 恒为 0——这个不变量
 * 在单测里根本不存在。它只能由真机判。
 *
 * 【改动前为什么是红的】面板高度由内容撑（`height: auto` + `max-height`），三页的行数是
 * 6 / 2 / 6，实测 410 / 198 / 386——而遮罩是垂直居中的，所以换页时面板既变高矮、又上下跳。
 */
test('设置面板三页大小一致', async () => {
  await win.locator('[data-testid="tab-文件"]').click()
  await win.locator('[data-testid="btn-settings"]').click()
  await expect(win.locator('[data-testid="settings"]')).toBeVisible()

  const heights: number[] = []
  const overflows: number[] = []
  for (const id of ['reading', 'appearance', 'shortcuts']) {
    await win.locator(`[data-testid="settings-tab-${id}"]`).click()
    // 【为什么等它可见再量】`click()` 只保证「点到了」，不保证「切过去了」。少了这一行，
    // 点击处理器坏掉时三次都会量到同一页的高度——下面那条 `Set.size === 1` 会**假绿**。
    // 等的是「被点那一页真的可见」，等价于断言切换确实生效。
    await expect(win.locator(`[data-testid="settings-tabpanel-${id}"]`)).toBeVisible()
    // 【另两页必须藏着】少了这一条还有一个假绿口子：若有人删掉
    // `.wt-tabpanel[hidden] { display: none }`，三页会叠在一起、面板每次都是同一个值，
    // `Set.size === 1` 照样绿（而被点的那块本来就可见，上面那个 settle 点也不会失败）。
    // 那条 CSS 自己的注释就写着「单测只看属性，照样全绿」——这条 e2e 正好补上。
    for (const other of ['reading', 'appearance', 'shortcuts'].filter((x) => x !== id)) {
      await expect(win.locator(`[data-testid="settings-tabpanel-${other}"]`)).toBeHidden()
    }
    heights.push(
      await win
        .locator('[data-testid="settings"] .wt-modal__panel')
        .evaluate((el) => el.getBoundingClientRect().height)
    )
    overflows.push(
      await win.evaluate(() => {
        const body = document.querySelector('.wt-modal__body') as HTMLElement
        return body.scrollHeight - body.clientHeight
      })
    )
  }

  // 【三者必须**严格**相等，不是「差不多」】三页的行数差得远，高度只要还由内容撑，
  // 这条当场红。
  expect(new Set(heights).size).toBe(1)

  // 【三页一致还不够：还要确认内容没被裁】少了这一条，把固定高度改小之后三页仍然相等，
  // 而阅读设置那页的内容被切掉——上面那条照样绿。
  //
  // 判的是 `scrollHeight <= clientHeight`，**不是某个绝对像素值**：它不依赖窗口高度、
  // 也不依赖字体度量，直接回答「有没有东西被切掉」。反方向它也管——将来阅读设置页加了
  // 一行、自然高度超过固定值时，这里会红。
  expect(Math.max(...overflows)).toBe(0)
})
```

- [ ] **Step 2: 跑它，确认是红的**

先确认没有 `pnpm dev` 在跑（`ps -eo pid,command | grep electron-vite | grep -v grep` 应为空——`test:e2e` 自带 `pnpm build`、会重写 `out/`，有 dev 会互相踩；**有的话停下报 BLOCKED，别自己去 kill**）。

Run: `pnpm test:e2e`

Expected: **8 passed / 1 failed**，exit code 非 0。红的就是新加的这条，红在 `expect(new Set(heights).size).toBe(1)`，实际是 3 个不同的值（约 410 / 198 / 386）。

**注意**：`Math.max(...overflows)` 那条在**改动前也是 0**（每页内容本来就装得下自己的高度），所以它不会掩盖「三页不等」这条红灯。改动前它会挡住的是「把固定高度改小」——那是 Task 2 之后的事。

**把红灯输出贴回来**——它是「改动前确实不一样」的判据。**如果它居然是绿的**，先停下（说明窗口高度或页面结构与我量的不同），别径直往下做。

- [ ] **Step 3: 提交（先交这条会红的测试）**

```bash
git branch --show-current    # feat/reading-font
git log --oneline -1         # 重读，确认没有并发提交
git add tests/e2e/app.spec.ts
git commit -F /tmp/wt-size-t1-msg.txt
```

消息用中文写：这条断言守的是什么、为什么只有真机判得了、改动前的实测三个值。末尾附 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

---

## Task 2: `ribbon.css` —— 面板固定高度

**对应设计：** 第 3 节。

**Files:**
- Modify: `src/renderer/src/styles/ribbon.css`

- [ ] **Step 1: 把 `.wt-modal__panel` 的注释与 `max-height` 换掉**

找到现在这一整块（注释 + 规则体），整段替换成：

```css
/*
 * 设置面板。680px 是「152px 左栏 + 约 500px 内容区」的宽度；内容区那一侧要放得下
 * 「当前书 1 键显示 [10] 字」这种整行不折的组合。
 *
 * 【为什么是**固定高度**】三页的行数差得远（阅读设置 6 行、外观设置 2 行、快捷键设置 6 行），
 * 而遮罩是垂直居中的——高度由内容撑的话，换页时面板既变高矮、又上下跳（实测：410 / 198 / 386，
 * 高矮差 212px、顶边跳 106px）。固定成一个值之后三页完全一致、切换时面板一动不动。
 *
 * 【410 是量出来的，不是拍的】它就是最高那页（阅读设置）的自然高度：38（标题条）
 * + 324（内容区）+ 48（footer）——在真 Electron 里跑 `out/` 构建量的。内容更少的那两页
 * 底部留白（真 Word 的「选项」对话框就是这个观感：窗口固定，内容少就空着）。
 *
 * 【`min()` 不能省】窗口矮或页面缩放时按视口收：200% 缩放下是 min(410, 262) = 262，
 * 内容区变 176、自己滚。写成裸的 `height: 410px` 会让面板在高缩放下顶出屏幕、footer 够不着
 * ——那正是上一批 `max-height` 要修的东西，绕回去等于白改。
 *
 * 【原来的 `max-height` 已删】它已经被这个 `height` 包进去了，两份互相重叠的约束只会让人
 * 将来以为都得改。顺带一个好处：固定 `height` 让面板的高度**恒为确定值**，百分比
 * flex-basis 不再是「容器主尺寸不确定时解不出来」的情形——上一批「标题条被压扁」那条链的
 * 根因就此消失（所以下面 `.wt-modal__header` 那条 `flex: 0 0 auto` 从「必需」降为
 * 「多余但无害」，**保留**）。
 */
.wt-modal__panel {
  width: 680px;
  max-width: calc(100% - 48px);
  height: min(410px, calc(100vh - 48px));
  background: #ffffff;
  border-radius: 8px;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.14),
    0 24px 56px rgba(0, 0, 0, 0.26);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

- [ ] **Step 2: 跑 e2e，确认 Task 1 那条转绿**

Run: `pnpm test:e2e`

Expected: **全绿**，那 8 条 + 新增的 1 条，共 **9 passed**。

- [ ] **Step 3: 提交**

```bash
git branch --show-current    # feat/reading-font
git log --oneline -1
git add src/renderer/src/styles/ribbon.css
git commit -F /tmp/wt-size-t2-msg.txt
```

消息用中文写清楚：410 怎么来的（38 + 324 + 48，实测）、`min()` 为什么不能省、删掉 `max-height` 的理由、以及顺带消掉的那条脆弱链。

---

## Task 3: `ribbon.css` —— 左栏过渡与内容淡入

**对应设计：** 第 4 节、第 5 节。

**Files:**
- Modify: `src/renderer/src/styles/ribbon.css`

**这个 Task 没有自动测试**——`transition` / `animation` 的观感 jsdom 判不了、e2e 也判不了（Playwright 能等到动画结束，但判不出「快慢对不对」）。它的验收是文末的真机清单。

- [ ] **Step 1: 给 `.wt-nav__item` 加过渡**

把它的规则体里的最后一行 `cursor: pointer;` 之后补上：

```css
  transition:
    background-color 90ms ease,
    border-color 90ms ease,
    color 90ms ease;
```

加完整个规则体是：

```css
.wt-nav__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  color: var(--wt-text-muted);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 90ms ease,
    border-color 90ms ease,
    color 90ms ease;
}
```

**`font-weight` 刻意不进 `transition`**：它从 400 跳到 600 时浏览器不做插值（本应用用的是系统字体栈、不是可变字体），进 transition 只会让「同一时刻一部分属性在动、一部分在跳」，反而更乱。`.wt-seg` 那组选中态也是「颜色过渡、`font-weight: 600` 硬跳」。

**`border-color` 为什么要进**：选中/未选中之间 `border-left` 从 `transparent` 变到 `--wt-accent`。不写它的话那道 2px 竖条会瞬间出现、而底色在 90ms 里慢慢变——两者不同步，肉眼很明显。

- [ ] **Step 2: 给 `.wt-tabpanel` 加淡入**

在 `.wt-tabpanel { … }` 那条**之前**插入关键帧，并在规则体里加一行 `animation`：

```css
/*
 * 切页时内容淡入。
 *
 * 【为什么不需要 key、不需要强制 reflow】非当前页是 `display: none`（见下面那条
 * `.wt-tabpanel[hidden]`）。按规范，元素从 `display: none` 变成有显示时，它的动画会
 * **从头开始**——所以切回来时这条自然重跑。任何 JS 都是多余的。
 *
 * 【打开对话框时当前页也会淡入一次】这是想要的：它顺带成了「对话框出现了」的提示。
 *
 * 【关键帧里只能动 `opacity`，别加 `transform`】`getBoundingClientRect()` 会被
 * `transform: scale()` 影响，而 e2e 里那条「三页等高」正是在切页之后读高度的——加了缩放，
 * 它会量到动画的中间态。（`translateY` 不影响高度，但本次连位移都不做。）
 *
 * 【`toBeVisible()` 不受这条动画影响，实测过】Playwright 1.63.0 的可见判据是
 * `element.checkVisibility()`（无参）+ `visibility !== 'hidden'` + 盒子非零，**整条链里
 * 没有 opacity**；在真 Chromium（Electron 44.5.1 / Chrome 152）里量过：
 * `opacity: 0` 的元素 `checkVisibility()` 返回 `true`，而显式的
 * `checkVisibility({ opacityProperty: true })` 才返回 `false`。所以淡入的第一帧
 * `toBeVisible()` 就返回，不会等动画、不会变慢。
 */
@keyframes wt-panel-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.wt-tabpanel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: wt-panel-in 120ms ease;
}
```

- [ ] **Step 3: 加 `prefers-reduced-motion` 那条**

紧接在 `.wt-tabpanel[hidden] { display: none }` 那条规则**之后**插入：

```css
/*
 * 关掉上面那两条动效。
 *
 * 【注意：本应用里的媒体查询能不能命中，是**没验证过**的】本仓库已知
 * `@media (prefers-color-scheme: dark)` 在渲染层**恒不命中**（Electron 那条坑，见 CLAUDE.md
 * 的「外观与主题」一节）。`prefers-reduced-motion` 是否命中**没有量过**。这条不命中时
 * 完全惰性（不影响任何用户），所以先按标准做法加上。
 *
 * 【若将来量出它恒不命中，别删掉这条】正解是走主进程 IPC 把它递过来——与主题
 * （`wt:get-theme` / `wt:theme-changed`）同一条路。删掉只会让「尊重减动效」这件事静默消失。
 *
 * 【必须排在这两个规则之后】`.wt-nav__item` 与 `.wt-tabpanel` 的特异度与本条相同
 * （都是 (0,1,0)），靠源码顺序胜出。
 */
@media (prefers-reduced-motion: reduce) {
  .wt-nav__item {
    transition: none;
  }

  .wt-tabpanel {
    animation: none;
  }
}
```

- [ ] **Step 4: 跑门禁**

Run: `pnpm typecheck && pnpm test`

Expected: 两个 tsconfig 都过、测试全绿。CSS 不进这两条，但确认没顺手改坏别的。

**特别核一条不变量**：`tests/unit/settings.test.tsx` 里「打开时焦点就落在对话框里（autoFocus）」与「关掉再打开，焦点仍在文档名上」——那是上一批建立的「对话框开着时打字不抽小说」的前提。本 Task 不碰焦点、不碰 `hidden` 的语义，它们**必须照旧全绿**。红了先回头看是不是动了 `display` 或 `hidden`。

- [ ] **Step 5: 提交**

```bash
git branch --show-current    # feat/reading-font
git log --oneline -1
git add src/renderer/src/styles/ribbon.css
git commit -F /tmp/wt-size-t3-msg.txt
```

消息用中文写：为什么 `font-weight` 不进 transition、为什么 `border-color` 要进、为什么淡入不需要 JS（`display: none` 会让动画自动重跑）、以及 `prefers-reduced-motion` 那条的「未验证」前提。

---

## Task 4: 收尾 —— 围栏回写、门禁、验收清单

**这个 Task 由 lead 自己做，不要派实现者。** 它会改 `docs/`。

**Files:**
- Modify: `docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md`
- Modify: `docs/superpowers/specs/2026-10-17-settings-panel-size-motion-design.md`

- [ ] **Step 1: 先量出要回写哪几面围栏，别照抄**

遍历 `git ls-files src tests` 的全部 `.ts/.tsx/.css/.json`，逐文件与**七份计划**的全部围栏比 md5（原样含末尾换行），报告「没有任何围栏与它逐字节相等」的集合。

**预期**：只有 `src/renderer/src/styles/ribbon.css` 与 `tests/e2e/app.spec.ts` 落在里面。

- [ ] **Step 2: 回写**

这两面在 06 里各有一面逐字节围栏（上一批刚回写过）。按仓库口径「改动已有文件一律写进 06」：

- 取围栏的正则必须写成**任意标签** `^```[^\n]*\n`（06 里有 16 个 `bash` 围栏，窄枚举会把配对带错）。
- 用 python 抽/写块：**块内行整体替换、保留围栏行**；多块按块索引**倒序** splice；**不要手抄**。
- 定位时要按「**上一个交付态**」的内容匹配（`git show <上一提交>:<文件>`），别用更早的历史版本——06 里同一个文件可能有历史片段。

- [ ] **Step 3: 正向判据必须为空**

重跑 Step 1 那个脚本，集合必须是空的。

- [ ] **Step 4: 片段判据**

另跑一条子串判据：06 里每一个 `ts` / `tsx` / `css` 围栏的正文，都必须是某个源/测试文件的子串。**预期有失配**（上一批量到 14 面：7 面是某文件的历史版本、7 面是从未等于任何源码的示意稿），逐条核对——**数不能比上一次多**，多了就是这次重抽弄坏了。**别用等长窗口去凑长片段**（窗口会切在注释或表达式中间，拿到的内容是错的）。

- [ ] **Step 5: CSS 手核**

`ribbon.css` 那面围栏（06 里的整文件）逐字比一遍。**CSS 对前两条判据都不可见，只能手核。**

另手核三条：① 新增的 `transition` / `animation` 里**没有写死的颜色**；② `@keyframes wt-panel-in` 只有 `opacity`，没有 `transform`（本次不做位移）；③ `.wt-modal__panel` 里 `max-height` **确实删了**、`height` 用的是 `min()` 不是裸值。

- [ ] **Step 6: 设计文档改成「已实现」并补实现记录**

把 `状态：待用户审阅` 改成 `状态：已实现（2026-10-17）`，并在文末补一节「实现记录」：实际改动、门禁四条的实测（**含 exit code**）、以及任何与设计不符的落地差异。

- [ ] **Step 7: 门禁四条**

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e      # 自带 build
```

**一律看 exit code，不要只 grep 摘要行。**

另核一条不变量：`tests/unit/settings.test.tsx` 里那两条 autoFocus 用例（「打开时焦点就落在对话框里」与「关掉再打开，焦点仍在文档名上」）必须照旧全绿——它们是「对话框开着时打字不抽小说」的前提。

- [ ] **Step 8: 提交**

```bash
git branch --show-current    # feat/reading-font
git add docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md docs/superpowers/specs/2026-10-17-settings-panel-size-motion-design.md
git commit -F /tmp/wt-size-t4-msg.txt
```

---

## 交给用户的真机验收清单

这几条 jsdom 与 e2e 都判不了，**由用户跑**。

1. **三页一样大**：打开设置，在三个页签之间来回点——**面板的高矮与位置全程不动**，不再像以前那样跳。外观设置那页底下的留白是刻意的（真 Word 的选项对话框就是这样）。
2. **内容有淡入**：切页时右边的内容应当有一个**很快的淡入**（约 0.12 秒），不是硬切。看的时候别眨眼——它刻意做得很短，「点了当场到位」比「看得出在动」重要。
3. **左栏的渐变**：鼠标划过左栏、点下页签时，**底色、文字色、左缘那道竖条**应当一起渐变过去。特别确认**没有「半截在动、半截在跳」**——`font-weight` 是会硬跳的（刻意），但颜色不该跳。
4. **文字不闪**：淡入期间文字**没有模糊、没有重影**（`opacity` 动画在某些组合下会触发次像素渲染差异，肉眼看得出来）。
5. **小窗口/高缩放**：把窗口拖矮到最低，再 `⌘+` 到 200%——面板应当缩到视口内、内容区自己出滚动条，**footer 的两个按钮始终够得着**。
6. **减动效设置（如果你方便试）**：macOS 的「辅助功能 → 显示 → 减弱动态效果」打开后，切页应当变成硬切。**这一条很可能不生效**——本仓库已知媒体查询在渲染层有问题（`prefers-color-scheme` 恒不命中），`prefers-reduced-motion` 未验证过。如果它确实不生效，告诉我，那是另一件事（要走主进程 IPC）。
