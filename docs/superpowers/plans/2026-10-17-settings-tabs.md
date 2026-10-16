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
```

**注意：这个 `describe` 这里先不要闭合。** Step 6b 还要往**同一组**里再追加两条用例，由那一步收尾——初稿在 Step 1 就把 `})` 写上了，照字面做会拼出「describe 提前闭合 + 两条游离的 `it`」（落地时更正）。

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

- [ ] **Step 6b: 加两条测试（它们现在是红的）**

> **这一条是计划写完之后补的，原因见文末的修订记录。** 它原本排在 Task 3，但代码质量评审查出「只在 effect 里把 `page` 拉回第一页」**修不掉下面这个缺陷**，所以连缺陷带修法一起前移到了 Task 1（`page` 这个持久状态本来就是 Task 1 引入的）。

在 `describe('设置对话框的左栏分页')` 里那 7 条**之后**追加：

```tsx
  it('关掉再打开，回到「阅读设置」（不记住上次那一页）', () => {
    setup()
    openViaButton()
    fireEvent.click(screen.getByTestId('settings-tab-shortcuts'))
    expect(hiddenPages()).toEqual([true, true, false])

    fireEvent.click(screen.getByTestId('settings-close'))
    openViaButton()

    expect(hiddenPages()).toEqual([false, true, true])
  })

  it('关掉再打开，焦点仍在文档名上（回到第一页还不够）', () => {
    // 【这条守的不是「焦点在对话框里」那件老事，而是它的一个**新**破口】`page` 是持久状态、
    // 组件在 open 为假时不卸载，所以重开的那一次提交里 page 可能还是旧值——非当前页带着
    // `hidden`，而**对 hidden（display:none）子树里的元素调 focus() 是 no-op**，于是
    // `autoFocus` 静默失效。
    //
    // 【焦点落在哪儿：隐形 textarea，不是 body】**实测**出来的（这条用例第一次跑、
    // 修还没上时，红灯里 `document.activeElement` 就是 `<textarea data-testid="input-capture">`）：
    // `SettingsDialog` 自己那条 effect 在**关闭**时把焦点交给了它，重开时 `autoFocus` 失效，
    // 焦点就原地留在那个 textarea 上。这比「落在 body 上」更糟——落在 body 上还要用户再点
    // 一下才会被抢回去，而隐形 textarea **本来就是抽字那条路的入口**：`InputCapture` 里那道
    // `role="dialog"` 闸**只存在于抢焦点的 `focusIfNotTextInput` 里**，`handleKeyDown` 与
    // `handleInput` 上**一条都没有**。所以焦点一落在那儿，按键**立刻**开始抽字。
    //
    // 光把 page 拉回 'reading' **不够**：`autoFocus` 只在挂载那一次跑，input 不会重新挂载。
    // 所以修法是让「打开」的那一次提交本身就是对的（见 `SettingsDialog` 里那段渲染期重置）。
    setup({ capture: true })
    openViaButton()
    fireEvent.click(screen.getByTestId('settings-tab-shortcuts'))
    fireEvent.click(screen.getByTestId('settings-close'))
    openViaButton()

    expect(document.activeElement).toBe(screen.getByTestId('doc-title-input'))
  })
})
```

**末尾那个 `})` 收的是 Step 1 留下的、故意没闭合的 `describe`。** 这两条要加在那一组**里面**（源码里就是这样：9 条在同一个 `describe('设置对话框的左栏分页')` 下）。

Run: `pnpm vitest run tests/unit/settings.test.tsx -t '设置对话框的左栏分页'`

Expected: 这两条**必须红**（第一条红在 `[true, true, false]`、第二条红在 `activeElement` 是 `body`）。**这一对红灯就是那个缺陷存在与否的判据**——第二条要是绿的，先停下重估机制，别径直往下修。

- [ ] **Step 6c: 把「拉回第一页」写在渲染期，不要写在 effect 里**

把 Step 3 加的那两行：

```tsx
  /** 当前显示哪一页。默认「阅读设置」；每次重新打开都拉回它，见下面那条 effect。 */
  const [page, setPage] = useState<SettingsPage>('reading')
```

整段换成：

```tsx
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
```

（`jsdom` 实测：`<div hidden><input></div>` 里对 `input.focus()` 之后 `document.activeElement` 原地不动；去掉 `hidden` 之后同一句就生效。浏览器与规范一致。）

- [ ] **Step 6d: 两条转绿，且既有那条 autoFocus 用例仍然绿**

Run: `pnpm vitest run tests/unit/settings.test.tsx`

Expected: 全绿，**特别确认既有的「打开时焦点就落在对话框里（autoFocus），不在隐形输入框上」还在**。

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
 * 【max-height 修的是**缩放**，不是小窗口】窗口本身下不去——`src/main/index.ts` 的
 * `minHeight: 620`，而改动前那版一页到底的对话框在最小窗口高度上是**放得下**的
 * （footer 够得着）。真正会把它顶出屏幕的是**页面缩放**：视图菜单里就有
 * resetZoom / zoomIn / zoomOut 三条 role，⌘+ 把视口压到 400 出头时，面板那一坨内容
 * （固定高的 header + footer + 按内容高的 body）并不会跟着变矮，于是上下都出界、
 * footer 够不着。将来某一页变高同理。
 *
 * 【别照字面去最小窗口高度上试】那儿什么都看不出来，于是很容易判定这条是死代码而删掉——
 * 而删掉之后 200% 缩放下 footer 当场够不着（实测）。
 *
 * 配合下面 `.wt-modal__body` 的 `overflow-y: auto` 生效。
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

- [ ] **Step 1b: 给标题条钉住高度（本次 `max-height` 的连带回归，评审实测确认）**

> **这一条是计划写完之后补的**，原因见文末修订记录二。它改的是一条**既有规则**，落在本次「不许动其它任何既有规则」之外——这是 lead 的决定：它是**本次自己引入的回归**（面板第一次有了确定高度），修法一行，且按的是病根不是症状。

`.wt-modal__header`（现在是 527-536 行）上面那条注释改写成下面这样，并**在规则体末尾加一条 `flex: 0 0 auto`**：

```css
/* 标题条沿用蓝条的配色：Word 的「选项」对话框也是这个观感。
 *
 * 【flex 不能省】它是面板这个 column flex 容器的第一项，而面板的高度是 auto 被 max-height
 * 夹出来的——夹紧的那一刻 main 的 `flex-basis: 0%` 在**高度不确定**的容器里解不出 0，会退回
 * 内容高（实测 316px），于是出现负自由空间、进入收缩相：标题条按 (38 : 内容高) 的比例被压扁
 * （实测 150% 缩放 → 34.06px；200% → 26px，正好是下面那个 26px 的 ✕ 按钮的高度，也就是它
 * 自己的自动最小尺寸，压到那儿就停）。footer 的内容是 30px 按钮 + 18px 下内边距、自动最小
 * 尺寸正好 48px，所以从不参与收缩。钉成 `0 0 auto` 后全部溢出落到 main（它已有 min-height: 0）。
 *
 * 【判据】压缩与不压缩时 `header + main + footer` 都等于面板高度（flex 本来就这样），
 * 有区分度的只有 `header.offsetHeight === 38`。
 */
.wt-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  flex: 0 0 auto;
  padding: 0 8px 0 16px;
  background: var(--wt-titlebar);
  color: var(--wt-titlebar-text);
  font-size: 13px;
}
```

**阈值（夹紧什么时候发生）**：`38 + H + 48 > 100vh − 48`，即 `H > 100vh − 134`（`H` = 最高那一页的 `body.scrollHeight`）。在应用的最小窗口（`minHeight: 620`）下：100% 缩放需 `H > 486`（永不）、**150% 需 `H > 279`**、**200% 需 `H > 176`**、250% 需 `H > 90`。阅读页那 6 行远超这个数，所以在 150% 起就会发生。

- [ ] **Step 2: 内容区交出「排列行」的职责，改成可滚动**

把 `.wt-modal__body`（现在是 565-570 行）改成：

```css
/*
 * 内容区。`display: flex` / `flex-direction: column` / `gap: 16px` 三条**整体挪去了
 * `.wt-tabpanel`**（见下）——行间距的来源没变，只是从「body 直接管着行」变成
 * 「每个页各管自己那一组行」。
 *
 * 【min-width: 0 与下面的 overflow-y 是同一个保险的两半】overflow 一旦不是 visible，
 * flex 子项的自动最小尺寸按规范就是 0，所以本条**在这条规则里是冗余的**——实测把它删掉，
 * 无论内容多宽（试到 4300px 不可断行）body 宽度都不变。留着是因为它与 `overflow-y: auto`
 * 互为保险：谁将来把 `overflow-y` 拿掉，它立刻开始承重（实测那种组合下 body 会被顶到 4326px）。
 *
 * 【overflow-y: auto】与面板的 max-height 配套，见上。反过来，它也是上面那句
 * 「min-width 冗余」成立的前提——两半拆开都别单删。
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
 * 【这一条必须写】`hidden` 属性本身不带任何样式，它靠的是 **UA 样式表**里的
 * `[hidden] { display: none }`。而级联里**来源（origin）**比特异度更优先：任何一条
 * **作者**样式表里的规则都能盖掉 UA 的那条——上面 `.wt-tabpanel` 的 `display: flex`
 * 正是如此。少了这一条，三个面板会同时显示、`hidden` 形同虚设（而单测只看属性，照样全绿）。
 *
 * 【它为什么赢：靠特异度，不是靠源码顺序】`.wt-tabpanel[hidden]` 是 (0,2,0)、
 * `.wt-tabpanel` 是 (0,1,0)，**高的恒赢、与先后无关**。所以这条写在前写在后都成立——
 * 但**不能删**：删了就没有任何作者规则去盖 UA 那条了。
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

## Task 3: 左栏的交互 —— 切页取消录制、方向键

**对应设计：** 第 5 节（交互）、第 5.1 节（无障碍）。**「默认页」那一条已在 Task 1 落地**（渲染期重置），本 Task 不再碰它。

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
 * - `hidden` 是 DOM 属性，判得了（上面那一组同理）。
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

  it('Home / End 跳到第一页 / 最后一页，焦点也跟着落过去', () => {
    // 【「焦点也跟着」这半句不能省】设计第 8.1 节第 8 条要求的是 ↑/↓/Home/End **都**把焦点
    // 带过去，而只断言 `hiddenPages` 是不够的——变异实测过：把 `focus()` 限制成只对
    // ArrowUp / ArrowDown 调，只断言 `hiddenPages` 的那一版**全绿**。也就是说那半句此前
    // 无人看住。
    setup()
    openViaButton()

    fireEvent.keyDown(screen.getByTestId('settings-tab-reading'), { key: 'End' })
    expect(hiddenPages()).toEqual([true, true, false])
    expect(document.activeElement).toBe(screen.getByTestId('settings-tab-shortcuts'))

    fireEvent.keyDown(screen.getByTestId('settings-tab-shortcuts'), { key: 'Home' })
    expect(hiddenPages()).toEqual([false, true, true])
    expect(document.activeElement).toBe(screen.getByTestId('settings-tab-reading'))
  })

  it('方向键之外的键不动页签（左栏不该吃掉别的按键）', () => {
    setup()
    openViaButton()
    const reading = screen.getByTestId('settings-tab-reading')

    // 【逐键断言，绝不能只断言末态】三个键连着按、每键各前进一页的话，3 键 ≡ 0 (mod 3)，
    // 末态与「一个都没动」**长得一模一样**——变异实测过：把认不出的键也改成前进一页，
    // 只断言末态的那一版 **80/80 全绿**。这正是「用例声称自身输入时要自检前提」那种形态。
    for (const key of ['ArrowLeft', 'a', 'Enter']) {
      fireEvent.keyDown(reading, { key })
      expect(hiddenPages()).toEqual([false, true, true])
    }
  })
})
```

**「关掉再打开」那两条不在这里**——它们随那段渲染期重置一起前移到了 Task 1（Step 6b），原因见文末的修订记录。

- [ ] **Step 2: 跑测试确认它红**

Run: `pnpm vitest run tests/unit/settings.test.tsx -t '设置对话框左栏的键盘与录制'`

Expected: **4 条红、1 条绿**。（计划初稿写的是「5 条全红」，**实测是 4 红**——落地时更正。）方向键那三条红在 `expect(hiddenPages()).toEqual(...)`（按了没反应），「切页取消录制」那条红在 `onRecordingChange` 没收到 `false`。

**第 5 条「方向键之外的键不动页签」天然是绿的**：它断言的是「什么都没变」，没实现时当然没有东西会变。它是一条**防误吃按键的守卫**，不是驱动实现的用例——**别因为它绿了就以为实现对了**，也别为了让「预期 5 红」成立而去改它。

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

**3d.** ~~把「打开时拉回第一页」放进 `[open, reset]` 那条 effect。~~ **这一步已经作废，改由 Task 1 的 Step 6c 在渲染期做。** 原因：effect 跑在提交之后，所以「打开」的那一次提交里第一页还是 `hidden`，而 `autoFocus` 只在挂载那一次跑——焦点会静默落在 `body` 上。详见文末的修订记录。**Task 3 不要再去动那条 effect。**

**3e.** 在 `[open, reset]` 那条 effect **之后**再加一条：

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

**3g.** ~~顺手改准两句已经不准确的注释。~~ **这一步已经作废——两条注释在 Task 1 的第三个提交里就改掉了。** 它们是：①焦点落在哪儿那句（源码里两处写着 `body`，实测是隐形 textarea，而**这句正是整个修复的立论**，评审把它当成「同一提交里自相矛盾」报了出来）；②快捷键那块上面那条既有注释的「三条各一行」（`SHORTCUTS` 是 6 条）。**Task 3 不要再动这两处。**

- [ ] **Step 4: 跑测试确认它绿**

Run: `pnpm vitest run tests/unit/settings.test.tsx -t '设置对话框左栏的键盘与录制'`

Expected: 5 passed。

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

**这条断言的判别力是「推理的」，不是「实测的」——落地时如实记下来。** 它的推理是「点到 `<button>` 时 Chromium 会把焦点给它 ⇒ `activeElement` 是 BUTTON ⇒ 断言红」，所以坐标哪天又落回按钮上会被抓到。**但没有人跑过那个反事实**（把坐标改回 `(4,60)` 看它是否变红），而且这条恰恰是本仓库自己标注过平台差异的地方——`SettingsDialog` 里那条注释就写着「点一个 `<button>` 在有些平台**根本不给它焦点**（macOS 上的 Safari 就是这样）」。**如果 Chromium-on-macOS 也不给按钮焦点，这条断言的判别力就是零**（落回按钮上照样绿）。

**已确证的那一半**：坐标本身落在空白上是**实测过的**——评审用 `elementFromPoint` 量过 `(4,10)` 命中 `.wt-modal__footer`（一个普通 div），且在 1×/1.25×/1.5×/2×/2.5×/3× 六档缩放全部命中。e2e 在 1× 下实际跑过一次，`BODY` 那条绿。

**若要把它从「推理的判据」变成「实测的判据」**，唯一办法是在共享树之外跑一次反事实（临时把坐标改回 `(4,60)`、只跑那一条、再还原）——按本仓库口径那是变异实验，**得在隔离副本里做**，别在共享树上改已提交的文件。这一条留给 lead 判断值不值。

- [ ] **Step 1b: 在同一个 test 末尾补一条「重开之后焦点仍在对话框里」——这一条只有真机判得了**

同一个 `test(...)` 的最后几行现在是：

```ts
  // 快捷键⌘/Ctrl + , 同样能开
  await win.keyboard.press('Meta+Comma')
  await expect(win.locator('[data-testid="settings"]')).toBeVisible()
})
```

在 `await expect(...toBeVisible())` **之后**、`})` **之前**追加：

```ts
  // 重开之后焦点必须仍在对话框里——**这一条只有真机判得了**。
  //
  // `page` 是持久状态、组件在 open 为假时不卸载，而 `autoFocus` 落在 `hidden`
  // （display:none）子树里的元素上是 no-op，且只在挂载那一次跑。单测已经判到了
  // 「jsdom 里焦点会留在 body 上」，但**「Chromium 会不会也这样」jsdom 判不了**。
  // 焦点漏到 body 的后果是用户敲的键会在遮罩后面抽进小说（InputCapture 那条「焦点已经在
  // 对话框里」的闸失守），而屏幕上完全看不出来——所以这条实机判据不能省。
  await win.locator('[data-testid="settings-tab-shortcuts"]').click()
  await win.locator('[data-testid="settings-close"]').click()
  await expect(win.locator('[data-testid="settings"]')).toBeHidden()
  await win.locator('[data-testid="btn-settings"]').click()
  await expect(win.locator('[data-testid="settings"]')).toBeVisible()
  await expect(win.locator('[data-testid="doc-title-input"]')).toBeFocused()

  // 【只断言「焦点在文档名上」不够，还要断言**后果】**——这才是设计第 5 节那条修订在真机上
  // 的判据。焦点没回来的话，下面这几个字母会在遮罩后面抽进小说，`revealed` 就从 0 变成 3
  // （`.wt-input` 那个隐形 textarea 就是抽字那条路的入口，`InputCapture` 的抽字路径上
  // 没有任何 `role="dialog"` 闸）。
  await win.keyboard.type('xxx')
  await expect.poll(revealed).toBe(0)
```

**这条会红吗？** 在这批全部落地（Task 1 的渲染期重置已进）之后**应当是绿的**。如果前一条 `toBeFocused()` 红了，说明 Chromium 的行为与 jsdom 判定的那版不一致——**先别改断言**，把红灯原文贴回来，那意味着设计第 5 节那条修订要重估。

**这一条为什么必须在这里（而不能只靠单测）**：评审明确划过边界——整条链里**只有「jsdom 对 `[hidden]` 子树的 `focus()` 是 no-op」「渲染期重置与 effect 重置的差别」「红的是哪一条用例」三步是实跑过的**；**「Chromium 上会不会同样漏字」没有任何实测**。上面这条 e2e 断的就是那一步。少了它，这次修复的立论在真机上就是**未验证**的。

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

## 修订记录

### 修订一（2026-10-17，Task 1 的代码质量评审查出来的）：默认页的修法从 effect 前移到渲染期

**原来的写法**（本文件初稿的 Task 3 Step 3d）：在 `[open, reset]` 那条 effect 里 `setPage('reading')`。

**为什么不成立**：那条 effect 跑在**提交之后**。而 `open` 为假时 `SettingsDialog` 只是 `return null`——**它并不卸载**，所以「打开」的那一次提交里 `page` 还是上一次的值、阅读设置面板仍带着 `hidden`。此时：

- **对 `hidden`（`display:none`）子树里的元素调 `focus()` 是 no-op。** jsdom 30.1.2 实测：`<div hidden><input></div>` 里对 `input.focus()` 之后 `document.activeElement` 原地不动；去掉 `hidden` 之后同一句才生效。浏览器与规范一致。
- **React 的 `autoFocus` 只在挂载那一次跑。** 事后把 `page` 拉回 `reading` 不会重新挂载那个 input，`autoFocus` 也不会重跑。

两条叠起来的后果：`autoFocus` 静默失效、焦点**原地留在关闭时被交还的那个隐形 textarea 上**。

> **落地时实测更正（比上面推的更糟）**：修之前那两条用例跑出来的第二条红灯，`document.activeElement` 是 `input-capture` 那个 textarea，**不是 `body`**——`SettingsDialog` 自己那条 effect（`if (open) return; …[data-testid="input-capture"]?.focus(…)`）在**关闭**时把焦点交给了它，重开时 `autoFocus` 失效，焦点就留在原地。
>
> 这比「落在 body 上」严重一档：落在 body 上还要用户再点一下才会被抢回去，而隐形 textarea **本来就是抽字那条路的入口**——`InputCapture` 里那道 `role="dialog"` 闸**只存在于抢焦点的 `focusIfNotTextInput` 里**（`InputCapture.tsx:103-107`），`handleKeyDown` 与 `handleInput` 上**一条都没有**（它们的闸只有 `isComposing` / `mode !== 'key'` / 修饰键 / `NON_CHAR_KEYS`）。所以隐形 textarea 一拿到焦点，按键**立刻**开始抽字，不需要任何额外动作。
>
> 顺带一条与结论无关但值得记住的事实：**那道 `role="dialog"` 闸只防「焦点被抢走」，从来不防「按键被抽走」。** 真正拦住「对话框开着时打字不抽字」的，是「焦点必须待在对话框里」这个前提。

**修法**：把「打开时拉回第一页」写在**渲染期**（React 官方的「props 变了就地调整 state」写法），这样「打开」的那一次提交本身就是对的，`autoFocus` 落得下去。落在 **Task 1 Step 6c**，连同两条判据用例（Step 6b）。Task 3 那一步作废。

**为什么前移到 Task 1**：`page` 这个持久状态是 Task 1 引入的，缺陷在 Task 1 那一提交里就已经存在（与 Task 3 无关）。留在 Task 3 意味着这份计划要带着一条已知 Important 缺陷跨两个 Task。

**这条同时也证明了原 Task 3 那条用例（「关掉再打开回到阅读设置」）不够**：它只判 `hidden`，而 `hidden` 对的那一版焦点照样是坏的。新加的第二条判 `document.activeElement` 才咬得住。

**顺带记两条 Task 1 阶段确认的事实**：

- `.wt-tabpanel[hidden] { display: none }` 在 Task 1 落地时**还不是必需的**——那时没有任何规则给 `.wt-tabpanel` 设 `display`，UA 默认样式表的那条照样生效。Task 2 一加 `display: flex` 它就变成必需的，漏了就是三页同时显示。
- Task 1 单独落地时左栏是三个没有样式的普通按钮、行间距也还没跟着 `.wt-tabpanel` 走。这是 Task 2 的范围。

### 修订二（2026-10-17，Task 2 的评审查出来的）：`max-height` 带出来的两处修正

Task 2 的评审在 `/tmp/wtprobe/` 里用**仓库自带的 Electron 44.5.1** 起了个隐藏窗口，页面 `<link>` 直接加载仓库里那四个真实 CSS 文件（逐字节就是交付物），DOM 按 `SettingsDialog.tsx` 手抄骨架，并在副本上做变异实验。三件事：

**① `max-height` 那条注释把触发条件写错了（M-1）。** 初稿写「小窗口里照样会把面板顶出屏幕」。实测：应用允许的最小窗口是 `minHeight: 620`，而改动前那版一页到底的对话框在**最小窗口高度上是放得下的**（footer 够得着）。真正可达的触发是**页面缩放**（视图菜单里就有 `resetZoom` / `zoomIn` / `zoomOut`）或某一页变高。这条注释必须改准——照字面读，维护者会在最小窗口高度上试一次、发现什么都没发生，进而判定 `max-height` 是死代码删掉，而删掉之后 200% 缩放下 footer **当场够不着**（变异实测）。已按评审给的措辞改（**去掉了它复刻行高量出来的 `540px`**，只留源码可查的 `minHeight: 620` 与三条 zoom role）。

**② `min-width: 0` 那句「不能省」不成立（M-2）。** `overflow-y: auto` 让 overflow 不再是 `visible`，按规范该 flex 子项的**自动最小尺寸已经是 0**，所以 `min-width: auto` 与 `min-width: 0` 在这条规则里**完全等价**——差分实验（塞一行约 4300px 不可断行内容）实测四种组合：交付态 440、`min-width:auto`+`overflow-y:auto` 440（**无差别**）、`min-width:auto`+`overflow-y:visible` 4326、`min-width:0`+`overflow-y:visible` 440。所以它是**冗余但无害的保险**，不是零覆盖、也不该删（谁将来把 `overflow-y` 拿掉，它立刻开始承重）。注释已改成「同一个保险的两半」那套写法。

**③ 新引入了一处回归：面板被夹紧时标题条会被压扁（M-3）。** 这是 `max-height` 让面板**第一次有了确定高度**的连带结果——改动前面板从不夹紧、也就从不收缩。机制（评审在 7 个缩放档上用同一个公式对上，误差 ≤0.03px）：

面板是 `height: auto` + `max-height`，flex 布局跑的时候容器主尺寸**不确定**，`max-height` 是**事后**才夹的；百分比 flex-basis 在容器主尺寸不确定时**解不出来**，Blink 退回该项的**内容尺寸**。于是 `main` 的基准不是 0 而是内容高，`38 + H + 48` 一旦超过 `max-height` 就出现**负自由空间**、进入**收缩相**，标题条按 (38 : H) 的比例被压扁（150% → 34.06px；200% → 26px，正好是它自己的自动最小尺寸、也就是那个 26px 的 ✕ 按钮）。阈值：`夹紧 ⟺ H > 100vh − 134`。

修法是一行 `flex: 0 0 auto`（**落在 Task 2 的 Step 1b**）。它按的是**病根**不是症状：标题条被压是因为它自己可收缩；钉死之后全部溢出落到 `main`（已有 `min-height: 0`），body 照旧滚、footer 不动。

**加固后的实测（七档缩放，100% → 300%）**：`header` **七档全是 38**（使用值从 `34.06 / 27.73 / 26px` 回到 `38px`）；footer 恒 48 且可见、几何逐位与加固前相同；不夹紧的两档（100% / 125%）**逐像素相同**（全字段几何差异只有 `headerFlex` 这一项）；夹紧档的差异恰好是「header、main、bodyClientH，以及坐在 main 里的 nav / navItem 的**纯垂直位移**」——**所有宽度一位没变**。

**一处要实现者与评审都容易预期反的取舍**：夹紧档里 `main` 是**变小**（150% −4px、175% −11px、200% 起 −12px），**不是变大**。因为面板高度是被 `max-height` 夹死的**恒量**，`header + main + footer` 不变——标题条拿回的那几像素正是从 main 的**滚动视口**里出。方向是想要的（用 4–12px 滚动视口换回一个诚实的 38px 标题条，溢出仍全部落在 main），但**别把「阅读区矮了几个像素」当成新 bug**。

**这条加固不依赖复刻行高**（论证是结构性的）：它只在**收缩相**里起作用——不夹紧时什么都不动（实测逐像素相同），夹紧时把挤压从标题条挪到 main。所以**无论真实那一页比复刻的更高还是更矮，都不存在可达的回归**：更矮只会让「不夹紧」的档更多（那时前后相同），更高只会让夹紧来得更早（那正是它该起作用的地方）。依赖复刻 DOM 的只有「夹紧从第几档开始」与那几个增量，而真机判据（DevTools 读 `header.offsetHeight` 应为 38）已写进验收清单第四条。

**一个方法论上的教训（我自己的）**：我最初提的判据是「`header + main + footer` 是否等于面板高度」，评审指出它**没有区分度**——flex 本来就让三者之和等于容器，被压与不被压都成立；唯一有区分度的是 `header.offsetHeight === 38`。**「看着像是自证的判据」要先用两个世界各验一遍再拿去用。**

### 修订三（2026-10-17，Task 3 的规格评审查出来的）：两条用例守不住自己声称守的东西

评审在 `bfedb6d` 的副本上跑了一整套变异（删 `[page]` effect / 删 `focus()` / 删 `ref` / 删 `onKeyDown` / 删 `setPage` / Home→末页 / ↑↓ 互换），代码本身**逐条有 witness**。但它同时实测出**两条断言的强度不够**，而且都不是代码缺陷、是**用例的问题**：

**① 「方向键之外的键不动页签」对它命名的那个坏法是假绿。** 变异成「认不出的键也前进一页」→ **80/80 全绿、exit 0**。根因是一个**模数巧合**：它连按 `ArrowLeft` / `a` / `Enter` 三个键，而只有 3 页，每键 +1 ≡ 0 (mod 3)，**末态与「一个都没动」长得一模一样**。修法是**逐键断言**（改为循环，每个键之后各查一次）。

它原来的敏感度不是零（只让 `ArrowLeft` 前进会红），但**它守不住它自己名字里那件事**——这正是本仓库「用例声称自身输入时要自检前提」那条忌讳的形态。

**② 「Home / End 时焦点跟着落过去」此前零覆盖。** 设计第 8.1 节第 8 条要求的是 ↑/↓/Home/End **都**把焦点带过去，但只有 ↑/↓ 那条断言了 `document.activeElement`。变异：把 `focus()` 限制成只对 `ArrowUp` / `ArrowDown` 调 → **全绿**。修法是把那两句 `document.activeElement` 断言补进 Home / End 那条。

**③ 有一处零覆盖是 jsdom 的边界，不要追**：注释里写的「不认的键直接 `return`、不做 `preventDefault`」，其中 `preventDefault` 那半句**jsdom 观察不到**（它不建模默认行为），所以「认不出的键调了 `preventDefault` 但不换页」这个变异也全绿。**代码本身是对的**（`preventDefault()` 严格在 `if (next < 0) return` 之后、只对认出的四个键生效）。这一条**只能靠读代码**，别为它写用例。

---

## 交给用户的真机验收清单

这几条 jsdom 判不了，**由用户跑**（本仓库惯例）。**等 Task 5 做完再跑。**

1. **左栏三项**：打开设置（「文件」选项卡里的「设置」按钮，或 `⌘/Ctrl + ,`），左边应当是「阅读设置 / 外观设置 / 快捷键设置」三项、从上到下这个顺序，**当前停在阅读设置**。右边只有阅读设置那 6 行，看不到外观与快捷键。
2. **点一下就切**：点「外观设置」，右边只剩「外观」和「纸张」两行；点「快捷键设置」，右边是 6 条快捷键。
3. **加宽之后不挤**：面板明显比原来宽。特别看「阅读替换」那一行的「当前书 1 键显示 [ ] 字」和「工作文档」那一行（状态 + 导入 + 移除三个东西）**有没有折行或被截断**。
4. **小窗口不溢出**：把窗口拖矮（高度压到 500px 左右），面板底部那两个按钮应当**始终够得着**，内容区自己出滚动条。

   **但真正会顶出屏幕的是缩放，不是小窗口**（窗口高度最低就是 620，拖不到 500——那一步其实是拖不动，别误判成「修好了」）。所以要**再按两下 `⌘+` 到 200% 缩放**再看一次：footer 仍要够得着、内容区出滚动条，而且**标题条那一行的高度不能变**。标题条被压扁过（本次的连带回归），判据在 DevTools 控制台里一行：

   ```js
   document.querySelector('.wt-modal__header').offsetHeight   // 38 = 没被压；26 = 又被压了
   ```

   （顺带核：`⌘0` 是复位缩放，`src/main/menu.ts` 里那三条 role。）
5. **深色主题**：切到深色，看左栏选中的那一项——**底色应当是一块深灰蓝（`#2b2b34`），不是浅蓝、也不是刺眼的白**；左缘那道竖条与文字应当是提亮过的蓝。切换外观三选一之后单独再看一眼。
6. **键盘**：焦点在左栏上时按 `↑` / `↓` 应当当场换页、且焦点跟着走到新的那一项；`Home` / `End` 跳首尾。按 `Tab` 应当从当前页签进到右边内容区。
7. **方向键不误伤**：焦点在内容区的输入框里（例如「正文字号」）按 `↑` / `↓`，**不该**换页。
8. **切页取消录制**：在「快捷键设置」里点开某条开始录制（按钮变成「请按下组合键…」），然后点「外观设置」——回到快捷键那一页，那个按钮应当已经退出录制态；此后再按 `⌘O` 之类应当照常触发导入（说明分发器没有一直哑着）。
9. **草稿跨页**：在「阅读设置」把正文字号改成 20（先别保存），切到「外观设置」再切回来——框里应当还是 20，「保存」按钮应当一直亮着；点保存之后字号真的变了。
10. **关掉再打开**：切到「快捷键设置」，**点「设置」按钮**关掉对话框再点开——应当回到「阅读设置」；而且**光标应当在「文档名」输入框里**，随便敲几个字母应当只进那个框、小说一个字都不抽（焦点没回到对话框时，敲的字会在遮罩后面抽进小说，屏幕上看不出来——这是本条真正要试的东西）。
11. **打字不受影响**：整个对话框开着的时候，敲键盘（不带修饰键的那些）**不该**有字抽进小说；关掉对话框之后，不用点阅读区也能直接接着打字。
