# 设置界面分页（左栏三页签）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「一页到底」的设置对话框拆成左栏三个页签（阅读设置 / 外观设置 / 快捷键设置），点左栏右边只显示那一类设置；默认固定停「阅读设置」。

**Architecture:** 只动渲染层的一层壳。`SettingsDialog.tsx` 里加一张 `PAGES` 表与一个 `page` 状态，把现有那 9 行**原样**裹进三个 `.wt-tabpanel`，非当前页加 `hidden` 属性；`ribbon.css` 把面板从 440px 加宽到 680px、加一条 152px 的左栏并给内容区加滚动。`src/core/`、`src/main/`、`src/preload/`、`deferredSettings.ts`、`Ribbon.tsx`、任何持久化字段**全部不动**。

**Tech Stack:** React 19 / TypeScript / vitest + jsdom / Playwright（`_electron`）。无新依赖，无新图标（三个页签图标都已在 `icons.tsx` 里导出、也已在 `SettingsDialog.tsx` 顶部 import）。

**设计文档：** `docs/superpowers/specs/2026-10-17-settings-tabs-design.md`。**判据取设计文档，不是本计划里的片段自己。** 每个 Task 开头标了对应哪一节。

**分支：** `feat/reading-font`。**继续在这条分支上开发，不另开分支**——它还没合并、也没有开放 PR，正文字号那批与本次这批长在同一条分支上。

---

## 读这份计划之前必须知道的五件仓库硬约定

与 `docs/superpowers/plans/2026-10-15-markdown-progressive-reveal.md` 开头那五条**同一套**（那里写得更细），这里只列结论：

1. **计划里的代码围栏 = 源文件的逐字节副本。** 口径 `md5(围栏原始内容) == md5(文件)`（原样相等，含末尾换行，**不要 rstrip**）。

   **但本次有一条特殊情况，先看懂再动手：本计划不新建任何源文件。** 实测过本仓库的既有排法——正本 `2026-10-06-word-disguised-typing-reader.md`（下称 **06**）承载**所有已有文件**的最终态围栏（94 块里 52 块逐字节，正好覆盖 52 个源/测试文件）；新计划只承载**它自己新建**的文件的围栏（markdown-rendering 那 22 面逐字节围栏正好是它新建的 22 个文件；boss-key 74 块里只有 2 块命中）。

   所以本次要回写的是 **06 里那四面的最终态**（Task 5 做），本计划里的代码块是**待落地的目标代码**，不是围栏副本。

2. **`git add` 用显式路径**（绝不 `-A`），**`git commit -F <消息文件>`**（绝不内联 `-m`——消息里的 ASCII 双引号会静默截断），**绝不 `--amend`**。提交前先 `git branch --show-current`，并重读 `git log --oneline -1`。

3. **验收由用户跑**，不要自建探针脚本、不要写变异矩阵留在仓库里。门禁照跑，**一律看 exit code，不要只 grep 摘要行**（本仓库出现过两种「摘要行看着是绿的」：unhandled rejection 与某个测试文件整体失败）。

4. **`git add` 之前确认工作区里没有别人的在途改动**；`books/` 是未跟踪的测试语料，**永远不要入库**。

5. **jsdom 没有布局**（`clientHeight` / `offsetLeft` 恒为 0），也**没有真实的可见性语义**——本仓库没装 `@testing-library/jest-dom`，`toBeVisible()` / `toBeInTheDocument()` 都不存在。所以本次分页的单测**断言 `hidden` 属性**（那是 DOM 属性，判得了），**不断言「看得见」**。

---

## 文件结构

**改动（4 个源码/测试 + 1 份计划文档）：**

| 文件 | 改什么 | Task |
|---|---|---|
| `src/renderer/src/components/SettingsDialog.tsx` | `PAGES` 表、`page` 状态、左栏 JSX、三个 `.wt-tabpanel`、方向键、切页取消录制、打开时重置回第一页 | 1、3 |
| `src/renderer/src/styles/ribbon.css` | 面板加宽 + 左栏样式 + 内容区滚动 + `.wt-tabpanel[hidden]` | 2 |
| `tests/unit/settings.test.tsx` | 新增两组用例（分页、左栏键盘与录制） | 1、3 |
| `tests/e2e/app.spec.ts` | 一处点击坐标（那条用例会静默失去意义） | 4 |
| `docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md` | 回写上面四个文件的最终态围栏 | 5 |

**明确不改：** `src/core/**`、`src/main/**`、`src/preload/**`、`src/renderer/src/state/deferredSettings.ts`、`src/renderer/src/components/Ribbon.tsx`、`src/renderer/src/components/icons.tsx`、任何持久化字段（`settings.json` 一个字段都不加）。

**为什么这些不用改：** 分组是纯粹的视图层问题——`deferredSettings` 的草稿本来就住在对话框这一层（所以草稿天然跨页），`Ribbon` 只是把 `settingsOpen` 交给 `SettingsDialog`，持久化那边没有任何新东西要存（默认页固定，不记住上次）。

---

## Task 1: `SettingsDialog.tsx` —— 左栏、三个页签面板、`hidden`

**对应设计：** 第 3 节（结构与组件）、第 4 节（非当前页怎么藏）、第 5 节里「草稿跨页保留」那一条。

**Files:**
- Modify: `src/renderer/src/components/SettingsDialog.tsx`
- Modify: `tests/unit/settings.test.tsx`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/settings.test.tsx` 末尾追加（文件现在最后一个 `describe` 是「设置里的工作文档」，追加在它后面）：

```tsx
/**
 * 左栏分页。
 *
 * 【为什么断言的是 `hidden` 属性而不是「看得见」】jsdom 没有布局，也没有真实的可见性
 * 语义，而本仓库没装 `@testing-library/jest-dom`——`toBeVisible()` 根本不存在。
 * 而 `hidden` 是 **DOM 属性**，正是这次用来藏非当前页的机制：断言它等于断言机制本身。
 *
 * 【为什么用 `hasAttribute` 而不是 `getAttribute() === ''`】React 对 `hidden` 走的是布尔
 * 属性，**实测过**（react-dom 19.3.0，`renderToStaticMarkup`）：`hidden={true}` 渲染成
 * `hidden=""`、`hidden={false}` 是**整条属性不出现**。但别把这个细节写进断言——
 * `hasAttribute` 对「有/没有」这个我们真正关心的问题成立，而 React 哪天改成
 * `hidden="true"` 这类形态，`hasAttribute` 仍然是对的。
 */
describe('设置对话框的左栏分页', () => {
  /** 三个面板是不是 hidden 的，按左栏从上到下的顺序 */
  const hiddenPages = (): boolean[] =>
    ['reading', 'appearance', 'shortcuts'].map((id) =>
      screen.getByTestId(`settings-tabpanel-${id}`).hasAttribute('hidden')
    )

  it('左栏三项的文案与顺序是「阅读设置 / 外观设置 / 快捷键设置」', () => {
    setup()
    openViaButton()

    expect(
      ['reading', 'appearance', 'shortcuts'].map(
        (id) => screen.getByTestId(`settings-tab-${id}`).textContent
      )
    ).toEqual(['阅读设置', '外观设置', '快捷键设置'])
  })

  it('打开时停在「阅读设置」，另两页是 hidden 的', () => {
    setup()
    openViaButton()

    expect(hiddenPages()).toEqual([false, true, true])
  })

  it('点「外观设置」：两页的 hidden 互换，aria-selected 跟着走', () => {
    setup()
    openViaButton()

    fireEvent.click(screen.getByTestId('settings-tab-appearance'))

    expect(hiddenPages()).toEqual([true, false, true])
    expect(screen.getByTestId('settings-tab-appearance').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('settings-tab-reading').getAttribute('aria-selected')).toBe('false')
  })

  it('点「快捷键设置」：那一页才显示', () => {
    setup()
    openViaButton()

    fireEvent.click(screen.getByTestId('settings-tab-shortcuts'))

    expect(hiddenPages()).toEqual([true, true, false])
  })

  it('行归属：阅读设置收文档名 / 阅读替换 / 输入模式 / 正文字号 / 小说 / 工作文档', () => {
    setup()
    openViaButton()
    const reading = screen.getByTestId('settings-tabpanel-reading')

    for (const id of [
      'doc-title-input',
      'global-ratio-input',
      'ratio-input',
      'mode-button',
      'page-font-size-input',
      'btn-import',
      'btn-clear-session',
      'work-doc-status',
      'btn-import-work-doc'
    ]) {
      expect(reading.contains(screen.getByTestId(id))).toBe(true)
    }

    // 外观与快捷键那几块**不**在这一页
    expect(reading.contains(screen.getByTestId('theme-dark'))).toBe(false)
    expect(reading.contains(screen.getByTestId('dark-paper'))).toBe(false)
    expect(reading.contains(screen.getByTestId('shortcut-import-input'))).toBe(false)
  })

  it('行归属：外观设置收主题与纸张，快捷键设置收六条快捷键', () => {
    setup()
    openViaButton()

    const appearance = screen.getByTestId('settings-tabpanel-appearance')
    expect(appearance.contains(screen.getByTestId('theme-system'))).toBe(true)
    expect(appearance.contains(screen.getByTestId('theme-light'))).toBe(true)
    expect(appearance.contains(screen.getByTestId('theme-dark'))).toBe(true)
    expect(appearance.contains(screen.getByTestId('dark-paper'))).toBe(true)

    const shortcuts = screen.getByTestId('settings-tabpanel-shortcuts')
    for (const def of SHORTCUTS) {
      expect(shortcuts.contains(screen.getByTestId(`shortcut-${def.id}-input`))).toBe(true)
      expect(shortcuts.contains(screen.getByTestId(`shortcut-${def.id}-reset`))).toBe(true)
    }
  })

  it('切页不丢草稿：在阅读设置改字号，切到外观设置后「保存」仍在、点下去照样提交', () => {
    const { onPageFontSizeChange } = setup()
    openViaButton()

    fireEvent.change(screen.getByTestId('page-font-size-input'), { target: { value: '20' } })
    fireEvent.click(screen.getByTestId('settings-tab-appearance'))

    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onPageFontSizeChange).toHaveBeenCalledWith(20)
  })
})
```

这一组用到 `SHORTCUTS`，而文件顶部现在只 import 了两个名字。把这一句（现在是**第 9 行**）改成：

```ts
import { SHORTCUTS, platformKind, resolveShortcuts } from '../../src/core/shortcuts'
```

- [ ] **Step 2: 跑测试确认它红**

Run: `pnpm vitest run tests/unit/settings.test.tsx -t '设置对话框的左栏分页'`

Expected: 7 条全红。前几条会红在 `Unable to find an element by: [data-testid="settings-tabpanel-reading"]`。

- [ ] **Step 3: 加 `PAGES` 表与 `page` 状态**

在 `SettingsDialog.tsx` 里 `THEME_OPTIONS` 那段**之后**（现在是 118-122 行）加：

```tsx
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
```

在组件里 `const kind = platformKind(platform)` 那一行**之后**加：

```tsx
  /** 当前显示哪一页。默认「阅读设置」；每次重新打开都拉回它，见下面那条 effect。 */
  const [page, setPage] = useState<SettingsPage>('reading')
```

- [ ] **Step 4: 把 `wt-modal__body` 那一段换成左栏 + 三个面板**

这一步是**纯结构搬移**：现有 9 行**一行不改**，只是被裹进三个面板、其中三块换个位置。

**边界**（现在文件里的行号，改之前先核一遍）：

| 现位置 | 内容 | 去到哪儿 |
|---|---|---|
| 453-474 | 「文档名」那一行 | 阅读设置面板，第 1 行 |
| 476-526 | 「阅读替换」那一行（全局 + 当前书） | 阅读设置面板，第 2 行 |
| 528-547 | 「输入模式」那一行 | 阅读设置面板，第 3 行 |
| 549-578 | 「外观」那一行（三选一） | **外观设置面板**，第 1 行 |
| 580-599 | 「纸张」那一行 | **外观设置面板**，第 2 行 |
| 601-631 | 「正文字号」那一行 | 阅读设置面板，第 4 行 |
| 633-668 | `{SHORTCUTS.map((def) => {…})}` 那一整块 | **快捷键设置面板**，唯一的块 |
| 670-695 | 「小说」那一行 | 阅读设置面板，第 5 行 |
| 697-751 | 「工作文档」那一行 | 阅读设置面板，第 6 行 |

于是**阅读设置面板里那 6 行的相对顺序，就是它们现在在文件里的相对顺序**（文档名 → 阅读替换 → 输入模式 → 正文字号 → 小说 → 工作文档）——把中间抽走的三块拿掉之后不用再排序。这个顺序与设计评审时给用户看的那张草图一致。

把现在这样一段：

```tsx
        <div className="wt-modal__body">
          <div className="wt-modal__row">
            <span className="wt-modal__label">
              <IconRename className="wt-modal__label-icon" />
              文档名
            </span>
```

……到 body 的收尾 `</div>`（现在是 752 行）为止，整段替换成下面这个骨架。**每一行现有的行体照原样搬进来，只改缩进（整体多两级，因为外面多了 `.wt-modal__main` 与 `.wt-tabpanel` 两层）；行内那些注释一句都不要动。**

```tsx
        <div className="wt-modal__main">
          {/*
            左栏。`role="tablist"` + `aria-orientation="vertical"` 是 ARIA 垂直页签的标准写法。
            `tabIndex` 是 roving 的：只有选中的那一项在 Tab 顺序里，从它往右一按 Tab 就进内容区
            （见设计 5.1）。
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
              三个面板**都渲染**，非当前页加 `hidden`（见设计第 4 节）。
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
              {/* 文档名 / 阅读替换 / 输入模式 / 正文字号 / 小说 / 工作文档 六行原样在此 */}
            </div>

            <div
              className="wt-tabpanel"
              role="tabpanel"
              id="wt-tabpanel-appearance"
              aria-labelledby="wt-tab-appearance"
              data-testid="settings-tabpanel-appearance"
              hidden={page !== 'appearance'}
            >
              {/* 外观 / 纸张 两行原样在此 */}
            </div>

            <div
              className="wt-tabpanel"
              role="tabpanel"
              id="wt-tabpanel-shortcuts"
              aria-labelledby="wt-tab-shortcuts"
              data-testid="settings-tabpanel-shortcuts"
              hidden={page !== 'shortcuts'}
            >
              {/* 现在那一段 {SHORTCUTS.map(…)} 原样在此，连同它上面那条注释 */}
            </div>
          </div>
        </div>
```

**面板的 `id` / `aria-labelledby` / `data-testid` 三处里的那个词必须是 `PAGES` 表里的 `id` 原文**（`reading` / `appearance` / `shortcuts`），三处拼法一致，否则 `aria-labelledby` 指向一个不存在的元素——那是**静默**的，测试与门禁都查不出来。

**别给面板加 `tabIndex={0}`。** ARIA 的写法是：tabpanel 里已经有可聚焦控件时，面板自己不需要再占一个 Tab 停靠点——三个页面里都有（输入框、按钮），加了会让键盘用户从页签 Tab 进去时先撞上一个空的停靠点。

**搬完先自查一遍内容。** `git diff` 里那 9 块的行**只该有缩进的变化**（整体多两级），任何别的改动都说明搬错了。行内那些注释一句都不能动——本文件里大部分注释是在解释「为什么要这么写」，丢了它们就等于丢了后面所有改动的依据。搬完可以这样粗核：

```bash
# 忽略空白之后，看的应当只有新增的骨架行与位置移动
git diff -w src/renderer/src/components/SettingsDialog.tsx | head -60
```

- [ ] **Step 5: 跑测试确认它绿**

Run: `pnpm vitest run tests/unit/settings.test.tsx -t '设置对话框的左栏分页'`

Expected: 7 passed。

- [ ] **Step 6: 跑整个文件，确认既有断言一条都没坏**

Run: `pnpm vitest run tests/unit/settings.test.tsx tests/unit/ribbon.test.tsx`

Expected: 全绿，**既有用例一条都不用改**。这正是选 `hidden` 而不是条件渲染的理由——红了就是这一步走错了，别去改断言。

- [ ] **Step 7: 提交**

```bash
git branch --show-current    # 必须是 feat/reading-font
git add src/renderer/src/components/SettingsDialog.tsx tests/unit/settings.test.tsx
git commit -F /tmp/wt-msg.txt
```

消息文件（`/tmp/wt-msg.txt`）里写清楚：左栏三页签的壳、非当前页用 `hidden` 而不是条件渲染、以及「既有 40 多处跨页断言一条没改」这个结果的证据。

---

## Task 2: `ribbon.css` —— 面板加宽、左栏样式、内容区滚动

**对应设计：** 第 6 节（视觉）全节。

**Files:**
- Modify: `src/renderer/src/styles/ribbon.css`

**这个 Task 没有单测**——CSS 不参与 vitest，jsdom 也没有布局。它的验收是真机肉眼（用户跑，见文末清单）与 Task 4 的 e2e。

- [ ] **Step 1: 面板加宽 + 给出高度上限**

把 `.wt-modal__panel`（现在是 503-514 行）改成：

```css
/*
 * 设置面板。680px 是「152px 左栏 + 约 500px 内容区」的宽度；内容区那一侧要放得下
 * 「当前书 1 键显示 [10] 字」这种整行不折的组合。
 *
 * 【max-height 不能省】三页之后单页最高的还是「阅读设置」那 6 行，小窗口里照样会把
 * 面板顶出屏幕、footer 的按钮够不着。那是本次顺带修的既有毛病：现在 9 行一页到底，
 * 更早就已经会溢出。配合下面 `.wt-modal__body` 的 `overflow-y: auto` 生效。
 */
.wt-modal__panel {
  width: 680px;
  max-width: calc(100% - 48px);
  max-height: calc(100vh - 48px);
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

- [ ] **Step 2: 内容区交出「排列行」的职责，改成可滚动**

把 `.wt-modal__body`（现在是 565-570 行）改成：

```css
/*
 * 内容区。`display: flex` / `flex-direction: column` / `gap: 16px` 三条**整体挪去了
 * `.wt-tabpanel`**（见下）——行间距的来源没变，只是从「body 直接管着行」变成
 * 「每个页各管自己那一组行」。
 *
 * 【min-width: 0 不能省】它是 flex 子项，而 flex 子项的默认 `min-width: auto` 会让
 * 最小内容宽度顶破面板：「阅读替换」那一行是 96px 固定标签 + 一串固定宽元素。
 * 【overflow-y: auto】与面板的 max-height 配套，见上。
 */
.wt-modal__body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 18px;
}
```

- [ ] **Step 3: 加左栏、页签项、面板那几条新规则**

紧接在 `.wt-modal__body` 那条**之后**插入：

```css
/*
 * 左栏与内容区并排。
 * 【min-height: 0 不能省】flex 子项的默认 `min-height: auto` 会让内容把面板撑破，
 * 而不是让内容区滚动。
 */
.wt-modal__main {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* 白底 + 一条分隔线，就是真 Word「选项」对话框左栏的样子。分隔线走 token，深浅自动翻。 */
.wt-modal__nav {
  flex: 0 0 152px;
  padding: 8px 0;
  border-right: 1px solid var(--wt-chrome-border);
}

/*
 * 页签项：整宽、方角、贴边。选中靠【底色 + 左缘一道竖条】区分。
 *
 * 【border-left 常态也要占位】常态是 2px 透明、选中才上色。写成「常态不给 border」的话，
 * 选中时这一项会整体右移 2px，字与图标跳一下。
 */
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
}

.wt-nav__item:hover {
  background: var(--wt-chrome);
}

/*
 * 选中态**全部走 token**，一个写死的颜色都没有。
 * `--wt-blue-light` 就是全应用「选中项底色」的既有答案（功能区里已在用），深浅两套
 * 各有一个值（#eaf1fb / #2b2b34）——所以深色下**不需要**再写一份 `[data-theme='dark']`
 * 规则。往这儿塞一个写死的浅蓝，深色下就会出现一块刺眼的白。
 */
.wt-nav__item--active {
  background: var(--wt-blue-light);
  border-left-color: var(--wt-accent);
  color: var(--wt-accent);
  font-weight: 600;
}

/* 本次给左栏加了方向键导航（Task 3），焦点样式不能缺 */
.wt-nav__item:focus-visible {
  outline: 2px solid var(--wt-accent);
  outline-offset: -2px;
}

.wt-nav__icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

/* 每个页自己管自己那组行：这三条是从 `.wt-modal__body` 挪过来的 */
.wt-tabpanel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/*
 * 【这一条必须写，而且必须排在 `.wt-tabpanel` 之后】
 * `hidden` 属性本身不带任何样式，它靠的是 UA 默认样式表里的 `[hidden] { display: none }`；
 * 任何一条给该元素设了 `display` 的规则都会盖掉它——上面那条 `.wt-tabpanel` 正是如此。
 * 少了这一条，三个面板会同时显示、`hidden` 形同虚设（而单测只看属性，照样全绿）。
 */
.wt-tabpanel[hidden] {
  display: none;
}
```

- [ ] **Step 4: 跑门禁确认没碰坏别的**

Run: `pnpm typecheck && pnpm test`

Expected: 两个 tsconfig 都过；测试全绿。CSS 不进这两条，但这条命令确认本 Task 没顺手改坏别的文件。

- [ ] **Step 5: 提交**

```bash
git branch --show-current    # 必须是 feat/reading-font
git add src/renderer/src/styles/ribbon.css
git commit -F /tmp/wt-msg.txt
```

---

## Task 3: 左栏的交互 —— 默认页、切页取消录制、方向键

**对应设计：** 第 5 节（交互）、第 5.1 节（无障碍）。

**Files:**
- Modify: `src/renderer/src/components/SettingsDialog.tsx`
- Modify: `tests/unit/settings.test.tsx`

- [ ] **Step 1: 写失败的测试**

在 Task 1 追加的那个 `describe` **之后**再加一组：

```tsx
/**
 * 左栏的键盘与录制。
 *
 * 【这一组里几条为什么单测判得了】
 * - `hidden` 是 DOM 属性，判得了（Task 1 那组同理）。
 * - 方向键换页之后焦点跟不跟过去，判的是 `document.activeElement`——**jsdom 里判得了**，
 *   因为那是我们自己在 keydown 处理里显式 `focus()` 的，不依赖浏览器的命中测试。
 * - 「切页取消录制」判的是报给外面的布尔值，与真机行为无关。
 *
 * 判不了的（只能真机）：面板实际画出来多宽、滚动条出没出来、深色下页签的底色。
 * 那几条在文末的验收清单里。
 */
describe('设置对话框左栏的键盘与录制', () => {
  const hiddenPages = (): boolean[] =>
    ['reading', 'appearance', 'shortcuts'].map((id) =>
      screen.getByTestId(`settings-tabpanel-${id}`).hasAttribute('hidden')
    )

  it('切页会取消正在进行的录制（否则分发器一直哑着，而用户看不出为什么）', () => {
    const onRecordingChange = vi.fn()
    setup({ onRecordingChange })
    openViaButton()

    fireEvent.click(screen.getByTestId('settings-tab-shortcuts'))
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    expect(onRecordingChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByTestId('settings-tab-appearance'))

    expect(onRecordingChange).toHaveBeenLastCalledWith(false)
  })

  it('↓ / ↑ 在左栏里移动、当场切页，焦点跟着落到新页签上', () => {
    setup()
    openViaButton()
    const reading = screen.getByTestId('settings-tab-reading')

    fireEvent.keyDown(reading, { key: 'ArrowDown' })

    expect(hiddenPages()).toEqual([true, false, true])
    expect(document.activeElement).toBe(screen.getByTestId('settings-tab-appearance'))

    fireEvent.keyDown(screen.getByTestId('settings-tab-appearance'), { key: 'ArrowUp' })

    expect(hiddenPages()).toEqual([false, true, true])
    expect(document.activeElement).toBe(reading)
  })

  it('↑ 从第一项绕到最后一项，↓ 从最后一项绕回第一项', () => {
    setup()
    openViaButton()

    fireEvent.keyDown(screen.getByTestId('settings-tab-reading'), { key: 'ArrowUp' })
    expect(hiddenPages()).toEqual([true, true, false])

    fireEvent.keyDown(screen.getByTestId('settings-tab-shortcuts'), { key: 'ArrowDown' })
    expect(hiddenPages()).toEqual([false, true, true])
  })

  it('Home / End 跳到第一页 / 最后一页', () => {
    setup()
    openViaButton()

    fireEvent.keyDown(screen.getByTestId('settings-tab-reading'), { key: 'End' })
    expect(hiddenPages()).toEqual([true, true, false])

    fireEvent.keyDown(screen.getByTestId('settings-tab-shortcuts'), { key: 'Home' })
    expect(hiddenPages()).toEqual([false, true, true])
  })

  it('方向键之外的键不动页签（左栏不该吃掉别的按键）', () => {
    setup()
    openViaButton()
    const reading = screen.getByTestId('settings-tab-reading')

    fireEvent.keyDown(reading, { key: 'ArrowLeft' })
    fireEvent.keyDown(reading, { key: 'a' })
    fireEvent.keyDown(reading, { key: 'Enter' })

    expect(hiddenPages()).toEqual([false, true, true])
  })

  it('关掉再打开，回到「阅读设置」（不记住上次那一页）', () => {
    setup()
    openViaButton()
    fireEvent.click(screen.getByTestId('settings-tab-shortcuts'))
    expect(hiddenPages()).toEqual([true, true, false])

    fireEvent.click(screen.getByTestId('settings-close'))
    openViaButton()

    expect(hiddenPages()).toEqual([false, true, true])
  })
})
```

- [ ] **Step 2: 跑测试确认它红**

Run: `pnpm vitest run tests/unit/settings.test.tsx -t '设置对话框左栏的键盘与录制'`

Expected: 6 条全红。方向键那三条会红在 `expect(hiddenPages()).toEqual(...)`（按了没反应）；「关掉再打开」那条会红在第二次打开时停在 `shortcuts`。

- [ ] **Step 3: 实现方向键、切页取消录制、打开时拉回第一页**

**3a.** 把文件顶部 react 的 import（现在是 5-11 行）加上 `useRef`：

```tsx
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
```

**3b.** 在 `const [page, setPage] = useState<SettingsPage>('reading')` **之后**加：

```tsx
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
```

**3c.** 在左栏那个 `PAGES.map` 的 `<button>` 上补两个属性（`ref` 与 `onKeyDown`），加完是这样：

```tsx
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
```

**3d.** 找到现在这条 effect：

```tsx
  // 每次打开都从当前值起稿：上次关掉时没保存的草稿不该留到下一次（关闭＝丢弃，是刻意的）
  useEffect(() => {
    if (open) reset()
  }, [open, reset])
```

改成：

```tsx
  // 每次打开都从当前值起稿：上次关掉时没保存的草稿不该留到下一次（关闭＝丢弃，是刻意的）
  useEffect(() => {
    if (open) {
      reset()
      // 【「固定打开第一页」必须在这里做】`open` 为假时本组件只是 `return null`——
      // **它并不卸载**，`useState` 的初值只在第一次挂载时起作用。少了这一句，用户上次
      // 停在快捷键那一页、关掉再打开就还在那一页。
      setPage('reading')
    }
  }, [open, reset])
```

**3e.** 在它**之后**再加一条：

```tsx
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
```

**3f.** 给左栏的容器 `div` 补一个 `onKeyDown` 兜底**不需要**——事件从按钮冒泡上来时 `e.target` 已经是按钮，而处理函数挂在每个按钮上。这一条只是提醒：**别把 `handleNavKeyDown` 挂到左栏容器上**，那样按 Tab 之外的东西也会被当成页签键处理。

- [ ] **Step 4: 跑测试确认它绿**

Run: `pnpm vitest run tests/unit/settings.test.tsx -t '设置对话框左栏的键盘与录制'`

Expected: 6 passed。

- [ ] **Step 5: 跑整个文件 + 相邻文件，确认没坏别的**

Run: `pnpm vitest run tests/unit/settings.test.tsx tests/unit/ribbon.test.tsx tests/unit/app.test.tsx`

Expected: 全绿。

**特别核一条**：`app.test.tsx` 里有钱夹住「关掉对话框之后焦点交还给隐形输入框」的用例——本 Task 只动了 `page` 的 effect，不该碰到它。红了先回头看是不是把 `setRecording(null)` 写进了 `open` 那条 effect。

- [ ] **Step 6: 提交**

```bash
git branch --show-current    # 必须是 feat/reading-font
git add src/renderer/src/components/SettingsDialog.tsx tests/unit/settings.test.tsx
git commit -F /tmp/wt-msg.txt
```

---

## Task 4: e2e —— 那条会静默失去意义的点击坐标

**对应设计：** 第 7.1 节。

**这一条是本设计里唯一「没人报错、但用例已经不验它声称要验的东西」的地方。** 现在 `tests/e2e/app.spec.ts` 里那条用例点的是 `.wt-modal__panel` 的 `(4, 60)`，注释写着「点对话框里不可聚焦的**空白处**（面板左边缘、行标号左侧）」。加了 152px 宽的左栏之后，x=4 落在左栏里、y=60 落在第一个页签上——**点击目标变成一个可聚焦的按钮**。下面的断言（`input-capture` 没被聚焦、敲键盘不抽字）在两个世界里都会绿。

**Files:**
- Modify: `tests/e2e/app.spec.ts`

- [ ] **Step 1: 换坐标，并顺带把这条用例变成自证的**

现在是这样（`tests/e2e/app.spec.ts` 的 120-125 行）：

```ts
  // 点对话框里不可聚焦的空白处（面板左边缘、行标号左侧）：浏览器会把焦点交给 body，
  // 此后键盘没有焦点宿主，更不该被抢回阅读区
  await win.locator('[data-testid="settings"] .wt-modal__panel').click({ position: { x: 4, y: 60 } })
  await expect(win.locator('[data-testid="input-capture"]')).not.toBeFocused()
  await win.keyboard.type('bbb')
  await expect.poll(revealed).toBe(0)
```

改成：

```ts
  // 点对话框里不可聚焦的空白处：浏览器会把焦点交给 body，此后键盘没有焦点宿主，
  // 更不该被抢回阅读区。
  //
  // 【坐标为什么从面板挪到 footer】原先点的是 `.wt-modal__panel` 的 (4, 60)，那句话写的
  // 是「面板左边缘、行标号左侧」。加了 152px 宽的左栏之后，x=4 落在左栏里、y=60 落在
  // 第一个页签上——点击目标成了一个**可聚焦的按钮**。下面那两条断言在两个世界里都会绿，
  // 也就是说这条用例会**静默地**不再验它声称要验的东西（评审实测出来的那一类）。
  // footer 的左侧永远是空的：两个按钮 `justify-content: flex-end` 靠右排。
  const panel = win.locator('[data-testid="settings"] .wt-modal__panel')
  await win.locator('[data-testid="settings"] .wt-modal__footer').click({ position: { x: 4, y: 10 } })
  // 【这一条是新加的，它让坐标自证】点到不可聚焦的空白处时，浏览器把焦点交给 body。
  // 少了它，上面那个坐标哪天又落回某个按钮上，这条用例照样绿——而它是本次唯一能在
  // 真机里判「焦点宿主」的用例。
  await expect.poll(() => win.evaluate(() => document.activeElement?.tagName ?? '')).toBe('BODY')
  await expect(win.locator('[data-testid="input-capture"]')).not.toBeFocused()
  await win.keyboard.type('bbb')
  await expect.poll(revealed).toBe(0)
  await expect(panel).toBeVisible()
```

**注意那个 `panel` 变量**：它只用来在末尾补一句「面板还开着」——原用例在这一段之后还要按 Escape 并断言对话框关掉，中间任何一步让面板没了都会让后面那几条红得更难懂。不想留这个变量的话，把最后一行删掉即可，但**不要**删中间那条 `activeElement === 'BODY'`。

- [ ] **Step 2: 构建 + 跑 e2e**

Run: `pnpm test:e2e`

（`test:e2e` 自带 `pnpm build`——**不要**跳过构建直接手跑 `_electron`，`out/` 里的陈旧产物量出来的是旧代码。）

Expected: 全绿。

**这一条要真看，不要只看摘要行。** 如果新加的那条 `activeElement === 'BODY'` 红了，说明 `(4, 10)` 仍然落在某个可聚焦的东西上——**先怀疑坐标，别怀疑断言**。

- [ ] **Step 3: 提交**

```bash
git branch --show-current    # 必须是 feat/reading-font
git add tests/e2e/app.spec.ts
git commit -F /tmp/wt-msg.txt
```

---

## Task 5: 收尾 —— 围栏回写、门禁、验收清单

**这个 Task 由 lead 自己做，不要派实现者。** 它会改 `docs/`。

**Files:**
- Modify: `docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md`
- Modify: `docs/superpowers/specs/2026-10-17-settings-tabs-design.md`

- [ ] **Step 1: 先量出要回写哪几面围栏，别照抄这份清单**

源码一动这张表就陈旧，所以**必须自己重测**。遍历 `git ls-files src tests` 的全部 `.ts/.tsx/.css/.json`，逐文件与**六份计划**的全部围栏比 md5（原样含末尾换行），报告「没有任何围栏与它逐字节相等」的集合。

**预期**：那四个改过的文件落在集合里，其余为空。回写落点按下面的路由。

- [ ] **Step 2: 路由**

`SettingsDialog.tsx` / `ribbon.css` / `settings.test.tsx` / `app.spec.ts` **在 06 里各有一面逐字节围栏**（写这份计划时实测确认过；`2026-10-11-configurable-shortcuts` 里也各有 0 面）。按仓库口径「**改动已有文件一律写进 06**」，回写目标是 **06**——**别去动那几份 10-11 / 10-13 / 10-14 / 10-15 里注定对不上的旧块**。

取围栏的正则必须写成**任意标签** `^```[^\n]*\n`：06 里有 16 个 `bash` 围栏，窄枚举（只认 `ts`/`tsx`/`css`）会把配对带错。

用 python 抽/写块：**块内行整体替换、保留围栏行**；多块按块索引**倒序** splice；**不要手抄**。

- [ ] **Step 3: 正向判据必须为空**

重跑 Step 1 那个脚本，集合必须是空的。

- [ ] **Step 4: 片段判据**

另跑一条子串判据：06 里每一个 `ts` / `tsx` 围栏的正文，都必须是某个源/测试文件的子串。**预期有失配**，逐条核对——示意性的（历史版本、起草期的示意稿）要在计划里写明它是示意、不是源码，别当成缺口去追。**别用等长窗口去凑长片段**（窗口会切在注释或表达式中间，拿到的内容是错的）；要追就得当**整段构造**重抽。

- [ ] **Step 5: CSS 手核**

`ribbon.css` 那面围栏（06 里的整文件）逐字比一遍。**CSS 对前两条判据都不可见，只能手核。**

另外手核 Task 2 那几个新类**没有**引入任何写死的颜色（选中的浅蓝必须是 `var(--wt-blue-light)` 而不是 `#eaf1fb`）——否则深色主题下会出现一块刺眼的白，而单测、typecheck、围栏判据**全都看不见**。

- [ ] **Step 6: 把设计文档的状态改准**

`docs/superpowers/specs/2026-10-17-settings-tabs-design.md` 第 3 行现在是 `状态：待用户审阅`。改成 `状态：已实现`，并在文末追加一节「实现记录」，写清三件事：实际改动的文件清单、门禁四条的实测结果（**含 exit code**）、以及任何与设计不符的落地差异。

- [ ] **Step 7: 门禁四条**

```bash
pnpm typecheck     # 两个 tsconfig，缺一不可
pnpm test
pnpm build
pnpm test:e2e      # 自带 build
```

**一律看 exit code，不要只 grep 摘要行。** 本仓库出现过两种「摘要行看着是绿的」：unhandled rejection（用例行照旧 `passed`，只有汇总行多一条 `Errors 1 error`，exit code 是 1）与某个测试文件整体失败（`Test Files 1 failed | 15 passed` 而 `Tests 195 passed` 那行一个 failed 都没有）。

- [ ] **Step 8: 提交**

```bash
git branch --show-current    # 必须是 feat/reading-font
git add docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md docs/superpowers/specs/2026-10-17-settings-tabs-design.md
git commit -F /tmp/wt-msg.txt
```

---

## 交给用户的真机验收清单

这几条 jsdom 判不了，**由用户跑**（本仓库惯例）。**等 Task 5 做完再跑。**

1. **左栏三项**：打开设置（「文件」选项卡里的「设置」按钮，或 `⌘/Ctrl + ,`），左边应当是「阅读设置 / 外观设置 / 快捷键设置」三项、从上到下这个顺序，**当前停在阅读设置**。右边只有阅读设置那 6 行，看不到外观与快捷键。
2. **点一下就切**：点「外观设置」，右边只剩「外观」和「纸张」两行；点「快捷键设置」，右边是 6 条快捷键。
3. **加宽之后不挤**：面板明显比原来宽。特别看「阅读替换」那一行的「当前书 1 键显示 [ ] 字」和「工作文档」那一行（状态 + 导入 + 移除三个东西）**有没有折行或被截断**。
4. **小窗口不溢出**：把窗口拖矮（高度压到 500px 左右），面板底部那两个按钮应当**始终够得着**，内容区自己出滚动条。
5. **深色主题**：切到深色，看左栏选中的那一项——**底色应当是一块深灰蓝（`#2b2b34`），不是浅蓝、也不是刺眼的白**；左缘那道竖条与文字应当是提亮过的蓝。切换外观三选一之后单独再看一眼。
6. **键盘**：焦点在左栏上时按 `↑` / `↓` 应当当场换页、且焦点跟着走到新的那一项；`Home` / `End` 跳首尾。按 `Tab` 应当从当前页签进到右边内容区。
7. **方向键不误伤**：焦点在内容区的输入框里（例如「正文字号」）按 `↑` / `↓`，**不该**换页。
8. **切页取消录制**：在「快捷键设置」里点开某条开始录制（按钮变成「请按下组合键…」），然后点「外观设置」——回到快捷键那一页，那个按钮应当已经退出录制态；此后再按 `⌘O` 之类应当照常触发导入（说明分发器没有一直哑着）。
9. **草稿跨页**：在「阅读设置」把正文字号改成 20（先别保存），切到「外观设置」再切回来——框里应当还是 20，「保存」按钮应当一直亮着；点保存之后字号真的变了。
10. **关掉再打开**：切到「快捷键设置」，关掉对话框，再打开——应当回到「阅读设置」。
11. **打字不受影响**：整个对话框开着的时候，敲键盘（不带修饰键的那些）**不该**有字抽进小说；关掉对话框之后，不用点阅读区也能直接接着打字。
