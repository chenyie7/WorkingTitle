# Markdown 渲染：逐行揭示 + 阅读光标进树 + 代码块坐标系 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三件事一起：(1) 结构预知的粒度从「块」下沉到「表格的行、列表的项」；(2) 阅读光标由语法树产出，落在「揭示到哪」那个字后面，而不是块的下方；(3) 修掉代码类节点 `value` 与源码偏移的坐标系错位。

**Architecture:** 全在渲染层，四个模块各管一段：`parse.ts` 解析时记下代码节点 `value` 的真实源码起点；`clip.ts` 用它当裁剪原点、并按区间丢掉未走到的重复单元、顺手算出占位行数；`toReact.tsx` 把占位画成空白、把光标插进树里；`Page.tsx` 在 md 那条路上不再追加末尾的光标。`core/`、`main/`、`preload/`、铺满、折叠、测量**全部不动**。

**Tech Stack:** React 19 / TypeScript / vitest + jsdom。无新依赖。

**设计文档：** `docs/superpowers/specs/2026-10-14-markdown-rendering-design.md`。**先读第 3.2 节**（逐行揭示，整节重写）、**第 3.5 节**（光标进树，新增）、**第 3.6 节**（代码块坐标系，修一处既有缺陷），以及文末两轮修订记录。每个 Task 开头都标了对应哪一节；**判据取设计文档与验收清单，不是本计划里的片段自己**。

**分支：** `feat/boss-key`。**继续在这条分支上开发，不另开分支**——老板键那批与 markdown 渲染那批长在同一条分支上，是同一个 PR。

---

## 读这份计划之前必须知道的五件仓库硬约定

与 `docs/superpowers/plans/2026-10-14-markdown-rendering.md` 开头那四条**同一套**（那里写得更细，含命令与出处），这里只列结论：

1. **计划里的代码围栏 = 源文件的逐字节副本。** 改了源码（含只改注释）就要同步改围栏，口径 `md5(围栏原始内容) == md5(文件)`（原样相等，含末尾换行，不要 rstrip）。本计划里的**片段**围栏同样是逐字副本，实施者改完文件要把每个片段在文件里搜一遍、必须逐字命中。
2. **`git add` 用显式路径**（绝不 `-A`），**`git commit -F <消息文件>`**（绝不内联 `-m`），**绝不 `--amend`**。提交前先 `git branch --show-current`，并重读 `git log --oneline -1`（共享工作区，可能有并发提交者）。
3. **每个 Task 配一次变异验证**：把本 Task 加的那道机制单独回退，确认**指名道姓的那几条**用例变红。**回退前先写下预期红哪几条**，跑完对账。变异在一次性 `git worktree` 里做——**绝不在共享工作区改源码**；**绝不在 worktree 里跑 `pnpm`**（`node_modules` 是符号链接，pnpm 会试图删主仓库的），直接调 `node_modules/.bin/vitest`。
4. **验收由用户跑**，不要自建探针脚本、不要写变异矩阵留在仓库里。门禁照跑，**一律看 exit code，不要只 grep 摘要行**。
5. **`git add` 之前确认工作区里没有别人的在途改动**；`books/` 是未跟踪的测试语料，永远不要入库。

---

## 文件结构

**改动（7 个源码/测试 + 1 份文档）：**

| 文件 | 改什么 | Task |
|---|---|---|
| `src/renderer/src/markdown/parse.ts` | 解析后走一遍注释，给 `code` / `inlineCode` 记下 `value` 的真实源码起点；导出读口 | 1 |
| `src/renderer/src/markdown/clip.ts` | ① 裁剪原点改用真实起点；② 重复单元按区间判；③ 挂两个占位计数 | 2、3 |
| `src/renderer/src/markdown/toReact.tsx` | ① 占位元素；② 光标插进树；③ `Ctx` 多带一份光标状态 | 4 |
| `src/renderer/src/markdown/MarkdownView.tsx` | 把 `cursor` 当「揭示到哪」传给 `renderMarkdown` | 5 |
| `src/renderer/src/components/Page.tsx` | md 那条路不再追加末尾的 `.wt-caret` | 5 |
| `src/renderer/src/styles/markdown.css` | 两个占位样式 + 单元格最小高度 + 两个长度变量 | 6 |
| `CLAUDE.md` | 核心不变量那句改成逐层口径 | 7 |
| `tests/unit/*`（四个文件） | 见各 Task | 1、2、3、4、5 |

**明确不改：** `measure.ts`、`fill.ts`、`html.ts`、`MarkdownImage.tsx`、`App.tsx`、`src/core/**`、`src/main/**`、`src/preload/**`。

**为什么这些不用改**：`clipTree` 的签名没变（真实起点是从节点上读的），`MarkdownView` 只是多传一个参数；测量那条路渲染的是**整篇未裁剪**的文档，占位字段与光标都不存在，所以高度、铺满切点、折叠拿不到任何差异。

---

## Task 1: `parse.ts` —— 记下代码节点 `value` 的真实源码起点

**对应设计：** 第 3.6 节。

**Files:**
- Modify: `src/renderer/src/markdown/parse.ts`
- Modify: `tests/unit/markdownParse.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/markdownParse.test.ts` 末尾追加：

```ts
/**
 * 代码类节点的 `value` 与源码偏移**不是同一个坐标系**（设计 3.6）。
 *
 * mdast 的 `position` 从**定界符**起算，而 `value` 里不含定界符：
 *
 *     源码 '```\n第一行\n'   position.start.offset = 0   ← 第一个反引号
 *                           value = '第一行'             ← 没有围栏
 *
 * 记下 `value` 的真实起点，`clip.ts` 才不会把内容提前一个定界符的长度切出来。
 */
describe('parseMarkdown —— 代码节点 value 的真实起点（设计 3.6）', () => {
  it('围栏代码块：起点在首行换行之后', () => {
    const src = '```\n第一行\n'
    expect(valueStartOf(parseMarkdown(src)!.children[0])).toBe(src.indexOf('第一行'))
  })

  it('带语言标注的围栏块：标注算在围栏里', () => {
    const src = '```js\n第一行\n```\n'
    expect(valueStartOf(parseMarkdown(src)!.children[0])).toBe(src.indexOf('第一行'))
  })

  it('行内代码：起点在起首反引号之后', () => {
    const src = '前 `甲` 后\n'
    const para = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(para.children[1])).toBe(src.indexOf('甲'))
  })

  it('双反引号的行内代码同样对', () => {
    const src = '前 ``甲`` 后\n'
    const para = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(para.children[1])).toBe(src.indexOf('甲'))
  })

  it('四空格缩进的代码块：起点在首行缩进之后', () => {
    const src = '    甲\n    乙\n'
    expect(valueStartOf(parseMarkdown(src)!.children[0])).toBe(src.indexOf('甲'))
  })

  it('引用块里的围栏块：前缀不算在起点里，首行照样精确', () => {
    const src = '> ```\n> 甲\n> ```\n'
    const quote = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(quote.children[0])).toBe(src.indexOf('甲'))
  })
```

并把该文件头部的 import 那一行换成下面这样（`isMarkdownPath` 本来就在那一行里，别删）：

```ts
import { parseMarkdown, isMarkdownPath, valueStartOf } from '../../src/renderer/src/markdown/parse'
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `pnpm vitest run tests/unit/markdownParse.test.ts`
Expected: **红**——`valueStartOf` 还没导出（`does not provide an export` 一类）。

- [ ] **Step 3: 改 `parse.ts`**

三处改动，其余一个字节不改。

**改法一：import 之后、`processor` 那一行之前，插入字段名与读口**（放在 `processor` 定义**之后**、`parseMarkdown` **之前**）：

```ts
/** 挂在 `code` / `inlineCode` 上的字段：`value` 的第一个字符在源码里的偏移。 */
export const WT_VALUE_START = 'wtValueStart'

/**
 * 读 `value` 的真实源码起点。没标注、标注不是有限数一律给 `null`——调用方据此退回
 * `position.start.offset`（普通 `text` 节点就是那一类，它们的两套坐标本来就重合）。
 */
export function valueStartOf(node: unknown): number | null {
  const raw = (node as Record<string, unknown> | null | undefined)?.[WT_VALUE_START]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}
```

**改法二：`parseMarkdown` 的 try 分支**。把

```ts
  try {
    return processor.parse(text)
  } catch (err) {
```

换成

```ts
  try {
    const tree = processor.parse(text)
    annotateValueStarts(tree, text)
    return tree
  } catch (err) {
```

**改法三：在文件末尾（`isMarkdownPath` 之后）追加两个函数**：

```ts
/**
 * 给 `code` / `inlineCode` 记下 `value` 的真实源码起点（设计 3.6）。
 *
 * 【为什么需要它】mdast 的 `position` 从**定界符**起算，而 `value` 里不含定界符——
 * 按 `position.start.offset` 当原点去切 `value`，内容会**恒定领先光标一个定界符的
 * 长度**（围栏块 4、带语言标注 6、行内代码是反引号的个数）。实测：光标走完 ` ``` `
 * 那一刻、正文一个字都没揭示，第一行已经整行上屏。
 *
 * 【为什么在这里算】本模块是全仓唯一手上有源码的地方，而这是**解析的产物**——
 * remark 怎么从源码得到 `value`，只有它知道。算一次挂在节点上，`clip.ts` 与
 * `toReact.tsx` 各自取用。
 *
 * 【一处已知残留，别当成没修干净】四空格缩进的代码块，remark 是**逐行**剥缩进的，
 * 不是常量偏移；这里只修首部，那种块内部仍有小偏差（设计 3.6 记着这条，是接受的）。
 */
function annotateValueStarts(node: unknown, source: string): void {
  const n = node as {
    type?: string
    children?: unknown[]
    position?: { start: { offset?: number }; end: { offset?: number } }
  }
  if (n.type === 'code' || n.type === 'inlineCode') {
    const start = n.position?.start.offset
    const end = n.position?.end.offset
    if (start !== undefined && end !== undefined) {
      ;(n as Record<string, unknown>)[WT_VALUE_START] = contentStartOf(n.type, source, start, end)
    }
  }
  for (const child of n.children ?? []) annotateValueStarts(child, source)
}

/**
 * `value` 的第一个字符在源码里的偏移。
 *
 * - 行内代码：起首那串反引号之后；
 * - 围栏代码块：围栏那一行（首行）的换行之后；
 * - 缩进代码块：首行的缩进之后。
 *
 * 【怎么区分围栏与缩进】看首行：行首最多三个空格之后以三个及以上 `` ` `` 或 `~`
 * 开头就是围栏——remark 只认这两种围栏，所以这个判据与它一致。
 */
function contentStartOf(kind: string, source: string, start: number, end: number): number {
  if (kind === 'inlineCode') {
    let i = start
    while (i < end && source[i] === '`') i++
    return i
  }
  const nl = source.indexOf('\n', start)
  const firstLineEnd = nl >= 0 && nl < end ? nl : end
  if (/^ {0,3}(`{3,}|~{3,})/.test(source.slice(start, firstLineEnd))) {
    // 围栏块：内容在围栏那一行之后
    return firstLineEnd < end ? firstLineEnd + 1 : firstLineEnd
  }
  // 缩进块：内容在首行的缩进之后
  let i = start
  while (i < end && (source[i] === ' ' || source[i] === '\t')) i++
  return i
}
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `pnpm vitest run tests/unit/markdownParse.test.ts` → PASS
Run: `pnpm typecheck` → exit 0

- [ ] **Step 5: 变异验证**

**先写下预期**：把 `contentStartOf` 里围栏那一支的 `return firstLineEnd + 1` 改成 `return start`（即退回「用 position 当原点」），预测红的是：围栏块那条、带语言标注那条（行内、缩进、文本三条不该红——它们不走这一支）。

跑完逐条对账，**红得比预期多或少都要查清楚**再往下走。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/markdown/parse.ts tests/unit/markdownParse.test.ts
git commit -F /tmp/wt-msg.txt
```

消息文件写：`fix(md): 记下代码节点 value 的真实源码起点`，正文引用设计 3.6 与实测到的「内容领先光标 4 个字符」。

---

## Task 2: `clip.ts` —— 裁剪原点改用真实起点

**对应设计：** 第 3.6 节。

**依赖 Task 1 的契约**（名字对不上就停下来问）：

```ts
export function valueStartOf(node: unknown): number | null
```

**Files:**
- Modify: `src/renderer/src/markdown/clip.ts`
- Modify: `tests/unit/markdownClip.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/markdownClip.test.ts` 末尾追加：

```ts
/**
 * 代码类节点的坐标系（设计 3.6）。修之前这里的每一条都是错的——内容恒定领先光标
 * 一个定界符的长度，而**一条守它的用例都没有**（这是它能活下来的原因）。
 */
describe('clipTree —— 代码类节点的坐标系', () => {
  const FENCE = '```\n第一行\n第二行\n第三行\n```\n'

  it('光标还在围栏里：一个字都不显示（修之前第一行已经整行上屏）', () => {
    const out = clipTree(parseMarkdown(FENCE)!, 0, FENCE.indexOf('第一行')) // 走完围栏与换行
    expect((out.children[0] as unknown as { value: string }).value).toBe('')
  })

  it('光标走到第一行结尾：只显示到那里，不多一个字', () => {
    const out = clipTree(parseMarkdown(FENCE)!, 0, FENCE.indexOf('第一行') + 3)
    expect((out.children[0] as unknown as { value: string }).value).toBe('第一行')
  })

  it('光标走到第二行中间：第三行不在（修之前三行全在）', () => {
    const out = clipTree(parseMarkdown(FENCE)!, 0, FENCE.indexOf('第二行') + 1)
    expect((out.children[0] as unknown as { value: string }).value).toBe('第一行\n第')
  })

  it('带语言标注的围栏块同样对（那里的围栏长 6，偏差本来更大）', () => {
    const src = '```js\n甲\n```\n'
    expect(
      (clipTree(parseMarkdown(src)!, 0, src.indexOf('甲')).children[0] as unknown as { value: string }).value
    ).toBe('')
    expect(
      (clipTree(parseMarkdown(src)!, 0, src.indexOf('甲') + 1).children[0] as unknown as { value: string })
        .value
    ).toBe('甲')
  })

  it('行内代码：光标在起首反引号上时一个字都不显示', () => {
    const src = '前 `甲` 后\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('`') + 1)
    const para = out.children[0] as unknown as { children: { type: string; value?: string }[] }
    expect(para.children.find((c) => c.type === 'inlineCode')?.value).toBe('')
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `pnpm vitest run tests/unit/markdownClip.test.ts`
Expected: **红的是新加的五条**（`value` 比期望多出定界符那一段）。原有用例一条都不该红——若红了，说明改动超出了本 Task。

- [ ] **Step 3: 改 `clip.ts`（两处）**

**改法一：import。** 在 `import type { Content, Root } from 'mdast'` 之后加一行：

```ts
import { valueStartOf } from './parse'
```

**改法二：第一支（可裁文本）那条分支。** 把

```ts
    // 位置都没有就没法按偏移切，原样保留（宁可多显示，也不丢字）
    if (start === undefined) return node
    const head = Math.max(0, from - start)
    const tail = Math.max(head, to - start)
    return { ...n, value: n.value.slice(head, tail) } as unknown as ClipNode
```

换成

```ts
    // 【原点不是 position.start.offset】`code` / `inlineCode` 的 `value` 里不含定界符
    // （围栏、反引号），而 `position` 从定界符起算——两套坐标差着一个定界符的长度。
    // 真实起点由 `parse.ts` 在解析时算好挂在节点上（设计 3.6），这里只是取用。
    const origin = valueStartOf(n) ?? start
    // 位置都没有就没法按偏移切，原样保留（宁可多显示，也不丢字）
    if (origin === undefined) return node
    const head = Math.max(0, from - origin)
    const tail = Math.max(head, to - origin)
    return { ...n, value: n.value.slice(head, tail) } as unknown as ClipNode
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `pnpm vitest run tests/unit/markdownClip.test.ts` → PASS（含原有全部）
Run: `pnpm test` → exit 0
Run: `pnpm typecheck` → exit 0

- [ ] **Step 5: 变异验证**

**先写下预期**：把 `const origin = valueStartOf(n) ?? start` 改成 `const origin = start`，预测红的正是新加的那五条，**其余一条都不该红**。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/markdown/clip.ts tests/unit/markdownClip.test.ts
git commit -F /tmp/wt-msg.txt
```

---

## Task 3: `clip.ts` —— 重复单元下沉 + 两个占位计数

**对应设计：** 第 3.2 节（整节）、第 9.2 节最后一段。

**Files:**
- Modify: `src/renderer/src/markdown/clip.ts`（整个文件重写，见 Step 3）
- Modify: `src/renderer/src/markdown/parse.ts`（**只加一个词**：`WT_VALUE_START` 的 `export` 放回去，见 Step 0）
- Modify: `tests/unit/markdownClip.test.ts`

- [ ] **Step 0: 先把 `parse.ts` 那个 `export` 放回去**

Task 1 的质量评审把 `WT_VALUE_START` 的 `export` 收掉了，理由是「只有同文件的 `valueStartOf` 读它」。**那个前提现在不成立了**：本 Task 让 `clip.ts` 成为第二个写者（切完要把起点跟着挪），字段名必须只在一处定义。

把 `src/renderer/src/markdown/parse.ts` 里

```ts
const WT_VALUE_START = 'wtValueStart'
```

改成

```ts
export const WT_VALUE_START = 'wtValueStart'
```

并把它上面那句注释里「只有本文件用」的意思改掉（它现在有两个使用者）。**其余一个字节不改。**

- [ ] **Step 1: 改那条断言旧规则的用例，并补上新的**

打开 `tests/unit/markdownClip.test.ts`，把 `describe('clipTree —— 结构预知')` 里**这一条整个替换掉**：

```ts
  it('已经开始、但只抽到一半的块：结构保留，没抽到的文字留空', () => {
    // 抽到「- 归档流」——列表这个块已经开始了
    const cut = at('归档流') + 3
    const out = clipTree(doc, 0, cut)
    // 三个块都在：标题、段落、列表（列表开始了）
    expect(typesOf(out)).toEqual(['heading', 'paragraph', 'list'])
    // 列表的第二项整个在光标之后 —— 它的文字是空的，但项本身还在（结构预知）
    const list = out.children[2] as unknown as { children: unknown[] }
    expect(list.children).toHaveLength(2)
    expect(textOf(list.children[0])).toBe('归档流')
    expect(textOf(list.children[1])).toBe('')
  })
```

替换成：

```ts
  it('块内的重复单元按自己的区间判：光标没走到的项不画', () => {
    // 抽到「归档流」——列表这个块已经开始了，但第二项还没开始
    const cut = at('归档流') + 3
    const out = clipTree(doc, 0, cut)
    // 三个块都在：标题、段落、列表（列表开始了）
    expect(typesOf(out)).toEqual(['heading', 'paragraph', 'list'])
    // 【2026-10-15 修订】第二项整个在光标之后 —— 它**不在树里**。
    // 旧口径是「项还在、只是文字空」，那正是真机上「块一露头全铺出来」的来源。
    const list = out.children[2] as unknown as { children: unknown[] }
    expect(list.children).toHaveLength(1)
    expect(textOf(list.children[0])).toBe('归档流')
  })
```

**同一个 `describe` 里那条「块内的行内结构：记号没抽到也不显示字，但结构节点在」一个字都不要动。** 它守的是设计 3.4（屏幕上永不出现裸记号），本次修订**刻意不下沉行内粒度**（理由见 3.2 的「行内为什么不下沉」）。动它就是把 3.4 拆了。

然后在文件末尾追加：

```ts
/**
 * 块内的**重复单元**——表格的行、列表的项（设计 3.2，2026-10-15 修订）。
 *
 * 判据与顶层块、叶子是同一条：**按它自己的字符区间**。用例各守一面：
 * 没走到的丢掉、走到了就整体出现（表格整行含全部单元格）、打到了但文字没出来时
 * 结构在而文字空。
 */
describe('clipTree —— 块内的重复单元', () => {
  const LIST = '- 甲项\n- 乙项\n- 丙项\n'

  it('列表：光标只走到第二项，第三项整个不在树里', () => {
    const src = LIST
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('乙项') + 1)
    const list = out.children[0] as unknown as { children: unknown[] }
    expect(list.children).toHaveLength(2) // 甲、乙
    expect(textOf(list.children[1])).toBe('乙')
  })

  it('列表：打到了但文字还没出来 —— 项在、文字空（屏幕上先出一个项目符号）', () => {
    // 光标停在第二项的行首记号 `-` 上：项已开始，它的段落与文字都还在后面
    const src = LIST
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('- 乙项') + 1)
    const list = out.children[0] as unknown as { children: unknown[] }
    expect(list.children).toHaveLength(2)
    expect(textOf(list.children[1])).toBe('')
  })

  it('表格：整行一起出现，不会缺列', () => {
    // 光标只走到第一格的中间，第二格还没开始 —— 两格都必须画出来
    const src = '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('| 1 |') + 3)
    const table = out.children[0] as unknown as { children: unknown[] }
    const row = table.children[1] as unknown as { children: unknown[] }
    expect(row.children).toHaveLength(2)
    expect(textOf(row.children[1])).toBe('')
  })

  it('表格：光标只走到第二行，后面的行不在树里，剩余行数报得出来', () => {
    const src = '| 季度 | 收入 |\n| --- | --- |\n| Q1 | 120 |\n| Q2 | 240 |\n| Q3 | 360 |\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('Q2') + 2)
    const table = out.children[0] as unknown as { children: unknown[] }
    // 表头 + Q1 + Q2 三行在（Q2 已开始、整行画出来），Q3 不在
    expect(table.children).toHaveLength(3)
    expect(readBlankCount(table, WT_BLANK_ROWS)).toBe(1)
  })

  it('全部揭示完之后：一行都不少，占位计数是 0', () => {
    const src = '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.length)
    const table = out.children[0] as unknown as { children: unknown[] }
    expect(table.children).toHaveLength(2)
    expect(readBlankCount(table, WT_BLANK_ROWS)).toBe(0)
  })

  it('折点切进表格中间：已经翻上去的行不算占位（它们在上方，不在表格底下）', () => {
    // 【为什么单补这一条】`children` 变少有**两个**来源：`to` 侧（还没走到，该留白）与
    // `from` 侧（已经翻过去了，**不该**留白）。按 `children.length` 的差去数会把两者混在
    // 一起——这条喂的 from 落在最后一行上，表头与前一行都被 from 挡掉，差是 2，于是表格
    // 底下凭空多两行空白，而**不报错**。判据要的是「起始偏移 ≥ to 的行数」，这里是 0。
    const src = '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n'
    const from = src.indexOf('| 3 |')
    const out = clipTree(parseMarkdown(src)!, from, src.length)
    const table = out.children[0] as unknown as { children: unknown[] }
    expect(readBlankCount(table, WT_BLANK_ROWS)).toBe(0)
  })
})

/**
 * 代码块的占位行数（设计 3.2 修订）。它的框只包住**已揭示的行**，没揭示的行由渲染层
 * 按「默认一行高」留白——留几行就是这里算的。
 *
 * 【数的口径】未揭示那一段里**换行符的个数**。当前这一行的余下部分不另算一行：它已经
 * 由框里那半行占着了。所以「光标停在同一行中间」时占位行数是 0，这是对的。
 */
describe('clipTree —— 代码块的占位行数', () => {
  const CODE = '```\n第一行\n第二行\n第三行\n```\n'

  it('只揭示到第一行中间：占位 2 行', () => {
    const out = clipTree(parseMarkdown(CODE)!, 0, CODE.indexOf('第一行') + 2)
    const code = out.children[0]
    expect((code as unknown as { value: string }).value).toBe('第一')
    expect(readBlankCount(code, WT_BLANK_LINES)).toBe(2)
  })

```

最后把文件头部那两行 import 改成：

```ts
import { clipTree, readBlankCount, WT_BLANK_LINES, WT_BLANK_ROWS } from '../../src/renderer/src/markdown/clip'
import { parseMarkdown, valueStartOf } from '../../src/renderer/src/markdown/parse'
```

（第二行本来就有 `parseMarkdown`，只加 `valueStartOf`。）

再追加一组用例——它守的是 Task 2 的质量评审量出来的那件事：

```ts
/**
 * 裁剪之后起点要跟着挪（Task 2 的质量评审量出来的）。
 *
 * `wtValueStart` 的语义是「**这个节点当前的** `value` 的第一个字符在源码里的偏移」。
 * 切片换了 `value` 却不挪它，这棵树上的节点就带着一个**失真**的起点——而下游
 * （设计 3.5 的光标按「揭示偏移 − 内容起点」算位置）拿到它**不报错**，只是光标
 * 差几个字符。修之前这条会红：它报的是原来那一段的起点。
 */
describe('clipTree —— 裁剪后起点跟着挪', () => {
  const SRC = '```\n第一行\n第二行\n```\n'

  it('从中间切进去：报的是自己那一段的起点', () => {
    const out = clipTree(parseMarkdown(SRC)!, SRC.indexOf('第一行') + 1, SRC.indexOf('第二行') + 1)
    const code = out.children[0]
    // 前面那个「第」被切掉了，剩下的是「一行」加换行再加「第」
    expect((code as unknown as { value: string }).value).toBe('一行\n第')
    // 起点必须是「一行」里那个「一」的位置，不是围栏之后那个「第」
    expect(valueStartOf(code)).toBe(SRC.indexOf('一行'))
  })

  it('一个字都没切掉时：起点没有变化（反面对照）', () => {
    const out = clipTree(parseMarkdown(SRC)!, 0, SRC.indexOf('第一行') + 3)
    expect(valueStartOf(out.children[0])).toBe(SRC.indexOf('第一行'))
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `pnpm vitest run tests/unit/markdownClip.test.ts`
Expected: **红**——编译不过（`readBlankCount` 等还没导出），加上列表、表格、代码块那几条会失败。

**把实际红的那几条记下来**，Step 4 之后对账。此时不要去「顺手」改 `clip.ts`。

- [ ] **Step 3: 重写 `clip.ts`**

把 `src/renderer/src/markdown/clip.ts` **整个文件**替换成下面这一份（逐字节，含末尾换行）：

```ts
import type { Content, Root } from 'mdast'
import { lineStartsOf, valueStartOf, WT_LINE_STARTS, WT_VALUE_START } from './parse'

/**
 * 按字符偏移裁剪语法树：树进、树出。**纯函数，没有副作用，不碰 DOM。**
 *
 * 【四条规则，合起来就是「结构预知」】
 *
 * 1. **顶层块的起始偏移 ≥ to 的整个丢掉**。光标还没走到的块，屏幕上一点都不该有
 *    ——这是「还没开始的块不存在」。
 * 2. **块内的「重复单元」（表格的行、列表的项）也按它自己的区间判**。光标走到第几行 /
 *    第几项，那一行 / 那一项才画出来；没走到的整个丢掉。丢掉的**表格行 / 代码行**由渲染层
 *    按「默认一行高」留白，**不留任何结构**；**列表项不留白**（不画符号、也不占高度），
 *    理由见设计 3.2 那张表（2026-10-15 修订）。
 * 3. **跨越 to 的文本被截断**。剩下的部分照常显示。
 * 4. **块内的叶子（没 `value` 可裁、也没 `children`）按它自己的区间判**：没开始就丢。
 *    它们截不出「半个」，留着就等于提前把没揭示的东西弄上屏——图片会提前发 IPC 去抓
 *    （设计 8.2：只抓已经抽出来的那张）。**内嵌 HTML 是其中的特例，要等抽完**，理由见下。
 *
 * 【粒度只下到「重复单元」，这一条是刻意的】顶层块、表格的行、列表的项各自按自己的起始
 * 偏移判；**其余容器（引用块、段落、表格的单元格、行内的粗体…）一律无条件保留**。
 * 两个理由：
 * - 表格若按单元格判，一行里前面几个格子揭示、后面几个没揭示时，屏幕上是**缺列的残行**
 *   ——比空格子难看得多。所以表格这一层只下到行。
 * - 行内若也下沉，`**季度**` 抽到第二个 `*` 时会画出一个空 `strong`：屏幕上什么都没有，
 *   下一个字符却突然变粗。设计 3.4 那条「屏幕上永不出现裸记号」靠的正是「结构先于文字」，
 *   行内下沉会把那个破绽露出来。
 *
 * 【规则 2 的后果：布局会跳】占位只有「默认一行高」，光标走到它时变成真实高度，它下面的
 * 内容就往下推一次。这是设计 3.2 里写明并接受的取舍，不是缺陷——**别把这个当成 bug 去修**。
 *
 * 【为什么 from 也要判】它是折点（折叠前文）或 revealStart。折点是按块边界算的，
 * 但 `revealStart` 不是——`jumpToChapter` 抬起来的那个值可能落在块中间，所以两边
 * 都要能切。`from` 落在块中间时，块本身留着，块内 `from` 之前的那部分文字被截成空。
 *
 * 【三类节点】只有 `text` / `code` / `inlineCode` 三个带**可裁**的 `value`（截断）；
 * 有 `children` 的（段落、列表、表格…）递归下去裁；剩下的叶子（图片、分隔线、脚注引用、
 * 硬换行、内嵌 HTML）整块留或整个丢。
 *
 * 【代码与表格的占位计数】规则 2 丢掉的行 / 项要由渲染层留出高度，而「留多少」是个
 * 算出来的数——**只有本文件知道它**，所以在这里算出来挂在节点上（`wtBlankLines` /
 * `wtBlankRows`，读它们只有 `readBlankCount` 一个口）。这不是把判断漏到视图层：判断仍然
 * 只在本文件做，视图层拿到的是已经定好的数字。
 *
 * 【代码类节点的原点不是 `position.start.offset`】`value` 里不含定界符（围栏、反引号），
 * 而 `position` 从定界符起算。真实起点由 `parse.ts` 算好挂着，这里用 `valueStartOf` 取
 * （设计 3.6）。用错原点的后果是**内容恒定领先光标一个定界符的长度**。
 *
 * 【叶子里的两档时机，别合并】图片、脚注引用、硬换行**没有文字**，从中间「切」没有
 * 意义，所以「一开始揭示（`start < to`）就整体出现」是自洽的（设计 8.3）。**内嵌 HTML
 * 不同：它的 `value` 里连文字一起**（块级 HTML 是一个整节点，`<div>后面的话</div>` 的
 * value 就是那一整串）。切开 → `<di` 这种碎片会被 `tokenizeHtml` 当普通文字吐上屏；
 * 不切 → 未揭示的字跟着上屏。两条都不可接受，所以它**等整个抽完（`end <= to`）才出现**。
 * 这一档差别有实测撑着（本文件的用例里有卡在 `end == to` 上的边界）。
 *
 * 【一处近似，要连同条件一起读】文本节点里的转义与 HTML 实体在解码后**比源码短**
 * （`a\*b` 的 value 是 `a*b`）。这里按「解码后第几个字符」近似切，偏差不超过该节点里
 * 转义/实体的个数，且**永远不会越过这个节点自己的边界**（slice 会自然夹住）。
 * 没有转义与实体时是精确的。工作文档里这两样都罕见，所以不走「按源码切再解码」
 * 那条更重也更脆的路。
 */
type ClipNode = Content | Root

/** 带可裁文本的节点类型。加新类型之前先想清楚它算文本还是算结构。 */
const VALUE_TYPES = new Set(['text', 'code', 'inlineCode'])

/**
 * 「重复单元」：块内**按自己的区间判**的那两类节点（设计 3.2 修订）。
 * 加新类型之前先想清楚：它是不是「同一个块里会重复出现、且逐个揭示读起来才自然」的东西。
 * 段落、单元格、行内元素都**不是**——理由见文件头那条「粒度只下到重复单元」。
 */
const REPEAT_UNITS = new Set(['listItem', 'tableRow'])

/** 挂在节点上的占位计数字段名。只有本文件与 `readBlankCount` 用它，别处别自己拼字符串。 */
export const WT_BLANK_LINES = 'wtBlankLines'
export const WT_BLANK_ROWS = 'wtBlankRows'

/**
 * 读占位计数：没有这个字段、不是有限正数，一律当 0。
 *
 * 【为什么让 clip 出这个读口】字段名与「什么样的值算有效」只该有一处定义——
 * 由 `toReact.tsx` 自己拼字符串去读的话，两侧对不上时是**静默**的（占位少一截，不报错）。
 *
 * 【`field` 为什么收成这两个常量】它是**联合字面量类型**，不是裸 `string`：传
 * `WT_VALUE_START` 这类别的字段名会**当场编译不过**。裸 `string` 的话那两个字段名长得
 * 差不多、值也都是小整数，读错了没人出声。
 */
export function readBlankCount(
  node: unknown,
  field: typeof WT_BLANK_LINES | typeof WT_BLANK_ROWS
): number {
  const raw = (node as Record<string, unknown> | null | undefined)?.[field]
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

export function clipTree(root: Root, from: number, to: number): Root {
  return { ...root, children: clipBlocks(root.children, from, to) as Root['children'] }
}

/**
 * 逐行切片（设计 3.6.1）：`value` 的下标与源码偏移**逐行**是 +1 线性的（每行差一个
 * 前缀宽度），所以窗口两侧都要**按行求交**，不能按字符数硬减。
 *
 * 【换行符算谁的】行 k 与行 k+1 之间那个 `\n` 在源码里位于「行 k 的源码结束偏移」处，
 * 所以它挂在**行 k 名下**：`to` 越过它才显示。
 *
 * 【返回值里的 `starts`】已揭示那几行的行起点（第一行按窗口起点裁过的那个算）。
 * 光标的「偏移 → 下标」换算要用它，否则多行容器里的光标会差一个前缀宽度。
 *
 * 【同一件事有三处实现，别只改一处】「沿 `value` 的 `\n` 走行、每行进 `lineLen + 1`」这个
 * 循环在这里、`parse.ts` 的 `isContiguous`、`toReact.tsx` 的 `rowsOf` 各写了一份——用途不同
 * （求窗口 / 判连续性 / 摊成行），所以**不合并**，但**行尾口径三份不一样**：这里用 `+ 1` 把
 * 换行**括进窗口**（所以窗口正好收在某行行尾时会连那个 `\n` 一起显示），`isContiguous` 把换行
 * **算给上一行**，`rowsOf` 的行长**不含**换行。动任何一处之前先把三处对一遍。
 */
function sliceByLineStarts(
  value: string,
  starts: readonly number[],
  from: number,
  to: number
): { head: number; tail: number; starts: number[] } {
  let head = -1
  let tail = -1
  const revealed: number[] = []
  let base = 0
  for (let k = 0; k < starts.length; k++) {
    const nl = value.indexOf('\n', base)
    const lineLen = (nl < 0 ? value.length : nl) - base
    const srcStart = starts[k]
    const lo = Math.max(from, srcStart)
    const hi = Math.min(to, srcStart + lineLen + 1)
    if (lo < hi) {
      const i0 = base + (lo - srcStart)
      const i1 = base + (hi - srcStart)
      if (head < 0) head = i0
      tail = i1
      revealed.push(lo)
    }
    base += lineLen + 1
  }
  if (head < 0) return { head: 0, tail: 0, starts: [] }
  return { head, tail, starts: revealed }
}

/**
 * 顶层块：**保留还是丢掉只在这一层判**（设计 3.2）。
 * 留下来的块交给 `clipInside`，那里只截断、不丢整块。
 */
function clipBlocks(nodes: readonly ClipNode[], from: number, to: number): ClipNode[] {
  const out: ClipNode[] = []
  for (const node of nodes) {
    const position = positionOf(node)
    // 没有偏移的节点（本仓库用到的 md 语法里不该有）原样保留，交给下游按「无文本」处理
    if (position === null) {
      out.push(node)
      continue
    }
    if (position.start >= to) continue // 还没开始揭示
    if (position.end <= from) continue // 已经翻过去了
    // 上面两条已经判过这个块的窗口，所以 `clipInside` 在这里实际不会返回 null
    // （叶子那一支重判的是同一对边界）。这一下过滤只为把类型收干净。
    const kept = clipInside(node, from, to)
    if (kept) out.push(kept)
  }
  return out
}

/** 节点自己的区间是否与 `[from, to)` 相交。**没有区间的节点一律算「在」**（宁可多显示）。 */
function inWindow(node: ClipNode, from: number, to: number): boolean {
  const position = positionOf(node)
  if (position === null) return true
  return position.start < to && position.end > from
}

/**
 * 已经开始揭示的块**内部**：重复单元（表格行、列表项）各按各的区间判，
 * 其余容器结构一个不丢，块内三类可裁文本各按各的窗口截。
 *
 * 【为什么返回值可以是 null】块内的**叶子**（图片、内嵌 HTML、脚注引用、硬换行）
 * 截不出「半个」，只能在「留整块」与「丢」之间二选一，二选一的判据是它**自己的**
 * 字符区间。于是这里也会丢节点，调用方必须过滤。
 *
 * 【为什么叶子也要按窗口判，而不是「所在块已经开始就留着」】留着没抽到的图片 = 提前
 * 发 IPC 去抓图（设计 8.2：只抓已经抽出来的那张）；留着没抽到的 HTML = 把还没有揭示的
 * 字画到屏幕上（内嵌 HTML 的 `value` 里连文字一起，见下面第三支）。两条都破契约。
 *
 * 四支的分派依据是「有没有可裁的 `value` / 有没有 `children`」，不是节点类型：
 * 类型逐个窄化在这里会变成几十行只做类型收窄、不做任何事的代码。按类型分岔的只有
 * `code`（要数占位行）与 `table`（要数占位行数）两处，都带注释。
 */
function clipInside(node: ClipNode, from: number, to: number): ClipNode | null {
  const n = node as unknown as {
    type: string
    value?: string
    children?: ClipNode[]
    position?: { start: { offset?: number }; end: { offset?: number } }
  }
  const start = n.position?.start.offset
  // 第一支：可裁文本（text / code / inlineCode）——截到 [from, to) 那个窗口
  if (VALUE_TYPES.has(n.type) && typeof n.value === 'string') {
    // 【原点不是 position.start.offset】`code` / `inlineCode` 的 `value` 里不含定界符
    // （围栏、反引号），而 `position` 从定界符起算。真实起点由 `parse.ts` 在解析时算好
    // 挂在节点上（设计 3.6），这里取用。
    // **别把它读成「差一个定界符的长度」**：围栏块差的是「定界符 + 换行」（4 或 6），
    // 缩进块根本没有定界符（差一段缩进），容器里的还会逐行变。它只保证**首行**的那个数，
    // 逐行那一半由下面的逐行表补（设计 3.6.1）。
    const origin = valueStartOf(n) ?? start
    // 位置都没有就没法按偏移切，原样保留（宁可多显示，也不丢字）
    if (origin === undefined) return node
    // 【挂逐行表的节点要按行求交，不能按字符数硬减】容器里逐行剥前缀的文字（引用块的
    // `> `、列表项的续行缩进）与带前缀的代码块，`value` 的下标与源码偏移**逐行**才是
    // +1 线性的，每行差一个前缀宽度。按 `to − origin` 硬减会**提前**把未揭示的字上屏
    // （设计 3.6.1）。没有表的节点（本来就是线性的）走下面那条老路，两个结果一致。
    const lines = lineStartsOf(n)
    let head: number
    let tail: number
    // 【表要跟着切片走】它描述的是**这个节点当前的** `value` 的行；不切的话下游
    // （`toReact.tsx` 的光标换算）会拿一张错位的表算，多行容器里的光标差一个前缀宽度。
    let revealed: number[] | null = null
    if (lines) {
      const r = sliceByLineStarts(n.value, lines, from, to)
      head = r.head
      tail = r.tail
      // 【窗口与这个节点一行都不相交时给的是空数组，而空数组是真值】照直用会写出
      // `wtValueStart: undefined` 与一张空表——起点那条是**静默**失真，下游
      // （设计 3.5 的光标）拿着它算位置不报错、只是差几个字符。这一格可达：容器里的
      // 围栏块 `'> ```\n> 甲\n…'` 的 `position.start` 是围栏起点（2），而表的第一行
      // 起点在围栏之后（8），`to` 落在 2–7 那一段里就是这个情形。**空表按「没有表」算**，
      // 那一步退回 `origin + head`（此时 `head` 为 0，指的是首行起点，仍然是对的）。
      revealed = r.starts.length > 0 ? r.starts : null
    } else {
      head = Math.max(0, from - origin)
      tail = Math.max(head, to - origin)
    }
    const value = n.value.slice(head, tail)
    // 【切完之后起点要跟着挪】`wtValueStart` 的语义是「**这个节点当前的** `value` 的第一个
    // 字符在源码里的偏移」。切掉了前 `head` 个字符，起点就后移 `head`——不挪的话这棵树上的
    // 节点会带着一个**失真**的起点，而下游（设计 3.5 的光标按「揭示偏移 − 内容起点」算位置）
    // 拿到它就是静默差几个字符，**不报错**。有表时同理，报的是**已揭示那几行的首行起点**。
    const shiftedStart = revealed ? revealed[0] : origin + head
    // 【表要么跟着切成这一份，要么整个摘掉，不能留原样】`...n` 会把解析期那张原表带过去，
    // 而它描述的是**整条** `value` 的行——与切后的 `value` 对不上时下游（光标换算）会静默
    // 算错。`revealed` 为 `null` 有两种来源（本来没有表 / 空窗口），两种都不该留字段。
    const kept: Record<string, unknown> = {
      ...(n as unknown as Record<string, unknown>),
      value,
      [WT_VALUE_START]: shiftedStart
    }
    if (revealed) kept[WT_LINE_STARTS] = revealed
    else delete kept[WT_LINE_STARTS]
    // 【代码块多挂一个占位行数】它的框只包住已揭示的行，没揭示的行由渲染层按「默认一行高」
    // 留白。`rest` 是没揭示的那一段，里面的**换行符个数**就是还没出现的新行数。
    //
    // 【前提：框里已经占着一行】这个数**不含**光标当前所在的那一行，理由是「当前这一行的
    // 余下部分已经由框里那半行占着了」。**框里一个字都没有时这个前提不成立**——空 `<pre>`
    // 没有 line box，没有谁在替那一行占位。实测：3 行的代码块在「光标还在围栏里」那一刻
    // 报 2，比真实行数少 1。
    //
    // 【为什么不在这里补那 1 行】判据要保持单一：这个数就是「未揭示那一段里的换行符个数」，
    // 不带「框里有没有内容」这个附加条件。补偿交给渲染层——CSS 给代码框一个最小高度
    // （Task 6），空框自己撑住那一行。代价是这一窗内每次按键都少一行，是接受的。
    if (n.type === 'code') {
      const rest = n.value.slice(tail)
      kept[WT_BLANK_LINES] = rest === '' ? 0 : rest.split('\n').length - 1
    }
    return kept as unknown as ClipNode
  }
  // 第二支：容器——递归下去裁。重复单元按自己的区间判（规则 2），其余结构不丢
  if (Array.isArray(n.children)) {
    const children: ClipNode[] = []
    for (const child of n.children) {
      // 重复单元：光标还没走到就整个丢掉。它本来该占的高度由下面那个计数交给渲染层
      if (REPEAT_UNITS.has(child.type) && !inWindow(child, from, to)) continue
      const kept = clipInside(child, from, to)
      if (kept) children.push(kept)
    }
    // 【表格：还有几行没走到，要报出去】渲染层拿它在表格底下留白。
    // 【为什么不用 children.length 的差】`children` 变少有**两个**来源：`to` 侧（还没走到，
    // 该留白）与 `from` 侧（已经翻过去了，**不该**留白——那些行在光标上方）。用差会把两者
    // 混在一起，`from` 切进表格时凭空多留白，而且**不报错**。所以这里只数「起始偏移 ≥ to」。
    // 【`from` 切进表格的另一个后果，当前不可达但要写下来】那时 `children[0]` 是正文行，
    // 而 `toReact.tsx` 把 `children[0]` 无条件当表头，那一行会被渲染成 `<th>`。今天靠
    // `foldStart` 恒为块边界（0、块起点或 revealStart，而工作文档那一路 revealStart 恒为 0）
    // 才不发作——而本文件开头那条注释宣称「revealStart 可能落在块中间」，接线一改就放开。
    if (n.type === 'table') {
      let notYet = 0
      for (const row of n.children) {
        const rowPos = positionOf(row)
        if (rowPos !== null && rowPos.start >= to) notYet++
      }
      return { ...n, children, [WT_BLANK_ROWS]: notYet } as unknown as ClipNode
    }
    return { ...n, children } as unknown as ClipNode
  }
  // 第三支：叶子——没有可裁的文本，整块留或整个丢，按它自己的区间判
  const position = positionOf(node)
  if (position === null) return node
  if (position.start >= to) return null // 还没开始揭示
  if (position.end <= from) return null // 已经翻过去了
  // 内嵌 HTML 是叶子里的**特例**：它的 `value` 里连文字一起（块级 HTML 是一个整节点，
  // `<div>后面的话</div>` 的 value 就是那一整串），所以不能像图片那样「一揭示就整体
  // 出现」——从中间切开只会得到 `<di` 这种碎片，`tokenizeHtml` 会把它当普通文字吐上屏。
  // 两条路都堵着，只剩第三条：**等它整个抽完才出现**（边界取等：end == to 就算抽完）。
  if (n.type === 'html') return position.end <= to ? node : null
  return node
}

/** 取节点的字符区间；两端偏移缺一不可，缺了就当「没有偏移」。 */
function positionOf(node: ClipNode): { start: number; end: number } | null {
  const p = (node as unknown as { position?: { start: { offset?: number }; end: { offset?: number } } })
    .position
  const start = p?.start.offset
  const end = p?.end.offset
  return start === undefined || end === undefined ? null : { start, end }
}
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `pnpm vitest run tests/unit/markdownClip.test.ts` → PASS，且原有 **21** 条一条不少
Run: `pnpm test` → exit 0
Run: `pnpm typecheck` → exit 0

**回头对账**：Step 2 记下的那几条是不是都转绿了？有没有哪条**当时没红、现在红了**？

- [ ] **Step 5: 变异验证（两条，各自单独做）**

**先写下预期**，再逐条回退：

- 变异甲：把 `if (REPEAT_UNITS.has(child.type) && !inWindow(child, from, to)) continue` 改成 `if (false) continue`。预期红：`块内的重复单元` 里的**列表两条** + `结构预知` 里改写的那条「光标没走到的项不画」+ 表格那条「剩余行数报得出来」（行数差恒为 0）。**不该红**：表格「整行一起出现」那条（它数的是列数）。
- 变异乙：把 `const blankLines = rest === '' ? 0 : rest.split('\n').length - 1` 改成 `const blankLines = rest === '' ? 0 : 5`（**保留空串那一支**）。预期红：`代码块的占位行数` 里**前两条**，第三条（抽完 → 0）**不该红**。

  **别把它写成整行常量** `const blankLines = 5`——那样第三条**也会红**（`5` 是常量，`to = CODE.length` 时照样读到 5，而它断言 0）。那不是同一个变异。这一条是实施者量出来的：计划原先的写法与预期自相矛盾。

红得比预期多或少都要查清楚再往下走。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/markdown/clip.ts tests/unit/markdownClip.test.ts
git commit -F /tmp/wt-msg.txt
```

---

## Task 4: `toReact.tsx` —— 占位元素与光标进树

**对应设计：** 第 3.2 节那张表、第 3.5 节。

**依赖 Task 1 / Task 3 的契约**（先确认它们在文件里确实存在，名字对不上就停下来问）：

```ts
export function valueStartOf(node: unknown): number | null          // parse.ts
export const WT_BLANK_LINES = 'wtBlankLines'                        // clip.ts
export const WT_BLANK_ROWS = 'wtBlankRows'                          // clip.ts
export function readBlankCount(node: unknown, field: typeof WT_BLANK_LINES | typeof WT_BLANK_ROWS): number // clip.ts
```

**Files:**
- Modify: `src/renderer/src/markdown/toReact.tsx`
- Modify: `tests/unit/markdownToReact.test.tsx`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/markdownToReact.test.tsx` 末尾追加。（这个文件现有的用例渲染的都是**整篇**，整篇不裁剪就没有占位字段、也不传光标，所以它们一条都不该红——**这正是本 Task 只加不改的原因**；哪条现有用例红了，先查清楚再往下走。）

```tsx
/**
 * 未揭示部分的占位（设计 3.2 修订）。
 *
 * 【为什么这一层要测】`clip.ts` 只报「还有几行没到」，**留多少高度是这里的事**。
 * 判据是设计 3.2 那张表的表格行与代码块两行：占位只占高度，什么都不画。
 *
 * 【为什么要手工造树】占位字段是 `clipTree` 在裁剪时挂上去的，直接 `parseMarkdown`
 * 出来的树里没有。这里手工造最小树，把「有占位 / 没占位」两种输入都喂进去——
 * 比串起 clipTree 更小、也更能指名道姓。
 */
describe('renderMarkdown —— 未揭示部分的占位', () => {
  function withBlank(node: Record<string, unknown>, field: string, n: number): Root {
    return {
      type: 'root',
      children: [{ position: { start: { offset: 0 }, end: { offset: 10 } }, ...node, [field]: n }]
    } as unknown as Root
  }

  it('表格有剩余行时：表格之后多出一块空白，且不带任何网格线', () => {
    const doc = withBlank(
      {
        type: 'table',
        children: [
          {
            type: 'tableRow',
            children: [{ type: 'tableCell', children: [{ type: 'text', value: '甲' }] }]
          }
        ]
      },
      WT_BLANK_ROWS,
      2
    )
    const c = render(<>{renderMarkdown(doc)}</>).container
    const blank = c.querySelector('.wt-md-table-blank')
    expect(blank).not.toBeNull()
    // 空白里什么都没有 —— 不画空网格线、不画占位文字
    expect(blank!.textContent).toBe('')
    expect(blank!.querySelector('table')).toBeNull()
    // 行数进了 CSS 变量；换算成像素是 CSS 的事
    expect(blank!.getAttribute('style')).toContain('--wt-md-blank-rows: 2')
  })

  it('表格一行不缺时：一个占位元素都不多出', () => {
    const doc = withBlank(
      {
        type: 'table',
        children: [
          {
            type: 'tableRow',
            children: [{ type: 'tableCell', children: [{ type: 'text', value: '甲' }] }]
          }
        ]
      },
      WT_BLANK_ROWS,
      0
    )
    const c = render(<>{renderMarkdown(doc)}</>).container
    expect(c.querySelector('.wt-md-table-blank')).toBeNull()
  })

  it('代码块有未揭示的行时：代码框之后多出一块空白', () => {
    const doc = withBlank({ type: 'code', value: '第一行' }, WT_BLANK_LINES, 2)
    const c = render(<>{renderMarkdown(doc)}</>).container
    const blank = c.querySelector('.wt-md-pre-blank')
    expect(blank).not.toBeNull()
    expect(blank!.textContent).toBe('')
    expect(blank!.getAttribute('style')).toContain('--wt-md-blank-lines: 2')
    // 框里只有已揭示的那一行
    expect(c.querySelector('.wt-md-pre')!.textContent).toBe('第一行')
  })
})

/**
 * 阅读光标插在树里（设计 3.5）。
 *
 * 【为什么要测这一层】光标原来是 `Page` 追加在内容末尾的，而 md 那条路的内容是块级
 * 元素的树——末尾那个 span 只会落在最后一个块**下方**。而隐形输入框与输入法候选框
 * 都按这个坐标摆，所以这不是观感问题。
 */
describe('renderMarkdown —— 阅读光标', () => {
  /** 造一棵「一个段落、里面一串文字」的最小树，文字起点给在 0。 */
  function para(text: string): Root {
    return {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          position: { start: { offset: 0 }, end: { offset: text.length } },
          children: [
            {
              type: 'text',
              value: text,
              position: { start: { offset: 0 }, end: { offset: text.length } }
            }
          ]
        }
      ]
    } as unknown as Root
  }

  it('光标插在文字中间，而不是段落下方的末尾', () => {
    const c = render(<>{renderMarkdown(para('甲乙丙'), { caretAt: 2 })}</>).container
    const p = c.querySelector('p')!
    expect(p.textContent).toBe('甲乙丙')
    // 段落的子节点顺序必须是 [文字, 光标, 文字] —— 光标在段落**里面**
    const caret = p.querySelector('[data-testid="caret"]')
    expect(caret).not.toBeNull()
    // `caretAt: 2` ⇒ `at = clamp(2 − 0, 0, 3) = 2` ⇒ 切成 ['甲乙', '丙']
    expect(caret!.previousSibling!.textContent).toBe('甲乙')
    expect(caret!.nextSibling!.textContent).toBe('丙')
  })

  it('光标落在空节点上也算命中（列表项刚开头、文字还没出来那一格）', () => {
    const doc = {
      type: 'root',
      children: [
        {
          type: 'list',
          children: [
            {
              type: 'listItem',
              position: { start: { offset: 0 }, end: { offset: 4 } },
              children: [
                {
                  type: 'paragraph',
                  position: { start: { offset: 2 }, end: { offset: 4 } },
                  children: [{ type: 'text', value: '', position: { start: { offset: 2 }, end: { offset: 4 } } }]
                }
              ]
            }
          ]
        }
      ]
    } as unknown as Root
    const c = render(<>{renderMarkdown(doc, { caretAt: 2 })}</>).container
    const li = c.querySelector('li')!
    expect(li.querySelector('[data-testid="caret"]')).not.toBeNull()
  })

  /**
   * 【这条原来是反的，2026-10-15 按实测改（Task 4g）】原先它钉的是「偏移超出全部文字 →
   * 退回追加在末尾」，并在注释里写着「内容本来也到头了，位置看不出差别」。**那句话不成立**：
   * 追加在末尾落在最后一个块**下方一行、左边缘**，而隐形输入框与输入法候选框都按这个坐标
   * 摆（设计 3.5）——用户最初报的就是这条。现在夹到**最后一块已渲染内容**的末尾上，
   * 光标留在块里。判据由「`<p>` 里有没有光标」翻成「光标在不在 `甲乙丙` 之后、`<p>` 之内」。
   */
  it('给的光标偏移超出全部文字时：夹到内容的末尾，仍在块里面', () => {
    const c = render(<>{renderMarkdown(para('甲乙丙'), { caretAt: 99 })}</>).container
    expect(c.querySelectorAll('[data-testid="caret"]')).toHaveLength(1)
    const caret = c.querySelector('p')!.querySelector('[data-testid="caret"]')
    expect(caret).not.toBeNull()
    expect(caret!.previousSibling!.textContent).toBe('甲乙丙')
    expect(caret!.nextSibling).toBeNull()
    // 不是容器末尾那一下（那是缺陷的签名）
    expect(c.previousSibling).toBeNull()
    expect(c.lastElementChild!.tagName).toBe('P')
  })

  it('链尾放不下光标时（文档以分隔线收尾）才真的追加在末尾', () => {
    const doc = {
      type: 'root',
      children: [{ type: 'thematicBreak', position: { start: { offset: 0 }, end: { offset: 4 } } }]
    } as unknown as Root
    // 【揭示偏移要**越过**分隔线的区间】落在它区间里那几格由 `caretBefore` 的
    // 「提前渲染的叶子跨过了揭示偏移」接走（落在分隔线**之前**），走不到这一条
    const c = render(<>{renderMarkdown(doc, { caretAt: 5 })}</>).container
    expect(c.querySelectorAll('[data-testid="caret"]')).toHaveLength(1)
    // 分隔线后面什么都没有，「追加在末尾」与「放在它后面」是同一个位置
    expect(c.lastElementChild!.getAttribute('data-testid')).toBe('caret')
  })

  it('不传光标（量高度那份副本）：一个光标都不该有', () => {
    const c = render(<>{renderMarkdown(para('甲乙丙'))}</>).container
    expect(c.querySelector('[data-testid="caret"]')).toBeNull()
```

再追加一组**真管线**用例——它们守的是 Task 4 的质量评量出来的那三处**真缺陷**：

```tsx
/**
 * 光标的落点必须与「揭示到哪」重合 —— 这三条是量出来的真缺陷，不是假想的。
 *
 * 旧判据（「第一个**结束偏移 ≥ 揭示偏移**的**带文本**节点」）会被「命中节点之后的空文本
 * 节点」接走，而它前面/中间站着**提前渲染的非文本节点**：占位、硬换行、图片。于是光标
 * 落到占位之后、下一行、或图的右边——而**隐形输入框与输入法候选框都按这个坐标摆**。
 *
 * 【为什么必须走真管线】缺陷正出在 `clip` 与 `toReact` 的**接缝**上：手工造树造不出
 * `clip` 写的 `wtValueStart` 与占位计数的真实取值。这是本文件第一次跑完整链路。
 *
 * 【实现者注意】下面每个 `to` 都要**先确认它在旧代码上真的红**（Step 2 那一步），
 * 落点不对就自己找一个能复现的偏移并**在报告里写清实测数**——别为了让用例变绿去改断言。
 */
describe('renderMarkdown —— 光标的落点（真管线）', () => {
  function at(md: string, to: number): HTMLElement {
    const clipped = clipTree(parseMarkdown(md)!, 0, to)
    return render(<>{renderMarkdown(clipped, { caretAt: to })}</>).container
  }

  const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\n末段\n'

  it('表格：光标落在占位**之前**，不是之后', () => {
    // 【这个 `to` 是量出来的，不是推的】实施者逐偏移扫过：坏区是 **8–20 与 28–30**
    // （整段表格行全被丢掉、只剩表头，于是没有任何节点接得住光标）。表头那一行的换行
    // 正好在 9，落在坏区里。原先计划用的 `indexOf('| 1 |') + 5 = 25` 落在**好区**
    // （21–27 都好），所以那条用例红不了。
    const to = TABLE.indexOf('\n')
    const c = at(TABLE, to)
    const caret = c.querySelector('[data-testid="caret"]')
    const blank = c.querySelector('.wt-md-table-blank')
    expect(caret).not.toBeNull()
    expect(blank).not.toBeNull()
    // 光标在占位**前面**：从光标看，占位是 FOLLOWING
    expect(caret!.compareDocumentPosition(blank!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 【恰好一个】占位自己接光标与末尾兜底都写了 `placed` 的判据，而两处判的时机不同
    // （建元素 vs 渲染树）。实测这一格曾经同时冒出两个，见 `case 'code'` 那段注释。
    expect(c.querySelectorAll('[data-testid="caret"]')).toHaveLength(1)
  })

  it('硬换行：光标落在 `<br>` **之前**（还在第一行），不是之后', () => {
    const src = '甲  \n乙\n'
    const c = at(src, src.indexOf('乙') - 1) // 揭示偏移正好落在行尾那个换行上
    const caret = c.querySelector('[data-testid="caret"]')
    const br = c.querySelector('br')
    expect(caret).not.toBeNull()
    expect(br).not.toBeNull()
    expect(caret!.compareDocumentPosition(br!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('图片：光标落在图**之前**，不是图的右边', () => {
    const src = '甲 ![图](a.png) 乙\n'
    const c = at(src, src.indexOf('![') + 1)
    const caret = c.querySelector('[data-testid="caret"]')
    const img = c.querySelector('.wt-md-img')
    expect(caret).not.toBeNull()
    expect(img).not.toBeNull()
    expect(caret!.compareDocumentPosition(img!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('代码块：光标落在占位**之前**，不是之后', () => {
    // 坏区是 **1–3**（光标还在围栏里那几格）：整块只剩一个空框，没有任何文字节点接得住。
    const src = '```\n甲\n乙\n丙\n```\n'
    const c = at(src, 1)
    const caret = c.querySelector('[data-testid="caret"]')
    const blank = c.querySelector('.wt-md-pre-blank')
    expect(caret).not.toBeNull()
    expect(blank).not.toBeNull()
    expect(caret!.compareDocumentPosition(blank!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 【恰好一个】同表格那条
    expect(c.querySelectorAll('[data-testid="caret"]')).toHaveLength(1)
  })

  /**
```

并把该文件头部的 import 补齐（按它现有的写法调整，缺什么补什么）：

```tsx
import { renderMarkdown } from '../../src/renderer/src/markdown/toReact'
import { clipTree, WT_BLANK_LINES, WT_BLANK_ROWS } from '../../src/renderer/src/markdown/clip'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'
import type { Root } from 'mdast'
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `pnpm vitest run tests/unit/markdownToReact.test.tsx`
Expected: **红**，且红的必须是新加的那几条。现有用例一条都不该红。

- [ ] **Step 3: 改 `toReact.tsx`（六处，其余一个字节不改）**

**改法一：import 四行换成五行。**

```tsx
import { createElement, Fragment, type CSSProperties, type ReactNode } from 'react'
import type { Root } from 'mdast'
import { tokenizeHtml, type HtmlToken } from './html'
import { MarkdownImage } from './MarkdownImage'
import { readBlankCount, WT_BLANK_LINES, WT_BLANK_ROWS } from './clip'
import { lineStartsOf, valueStartOf } from './parse'
```

（多出来的是 `type CSSProperties`、`./clip` 那一行、`./parse` 那一行。`clip.ts` 与 `parse.ts` 都不 import 本文件，没有环。）

**改法二：`Ctx` 那个 interface 整个替换掉**（并加上 `Caret`）：

```tsx
/** 表头单元格与普通单元格的唯一区别，外加阅读光标那一份状态。 */
interface Ctx {
  readonly header: boolean
  /** 阅读光标。`null` 表示不插（量高度那份副本用） */
  readonly caret: Caret | null
}

/**
 * 阅读光标的状态。
 *
 * 【为什么 `placed` 是可变字段】它要在整棵树里只命中一次，而渲染是深度优先的递归——
 * 用一个共享的小对象带下去，比让每一层返回「插过了没」再往上并简单得多。
 * 它每次 `renderMarkdown` 都新造一个，所以两次渲染之间不会互相串。
 */
interface Caret {
  readonly at: number
  placed: boolean
}
```

**改法三：`renderMarkdown` 整个函数替换掉。**

```tsx
export function renderMarkdown(
  root: Root,
  opts: { withBlockEnds?: boolean; caretAt?: number | null } = {}
): ReactNode {
  const caret: Caret | null =
    typeof opts.caretAt === 'number' && Number.isFinite(opts.caretAt)
      ? { at: opts.caretAt, placed: false }
      : null
  if (opts.withBlockEnds) {
    return root.children.map((node, i) => (
      <div
        className="wt-md-measure-block"
        key={i}
        data-block-end={node.position?.end.offset ?? ''}
      >
        {/*
          【这里显式传 `caret: null`，不是省事】量高度那一份是**整篇未裁剪**的树，
          多一个光标不但没用，还会让 `[data-testid="caret"]` 在文档里出现两次——
          而 `InputCapture` 取的是**第一个**。今天靠「调用方永不传 `caretAt`」这条
          自觉，显式写 `null` 才有机器保证。
        */}
        {renderNode(node, { header: false, caret: null })}
      </div>
    ))
  }
  const out = renderAll(root.children, { header: false, caret })
  // 【一个都没命中就退回老位置】揭示偏移落在文档末尾的换行之后、或者整篇都还没开始揭示
  // 时会走到这里。那时内容本来也到头了，追加在末尾与插在中间看不出差别。
  // 外面套一层 Fragment 只为挂 `key`——`CaretSpan` 没有 props，别给它传。
  if (caret && !caret.placed) out.push(<Fragment key="caret-fallback"><CaretSpan /></Fragment>)
  return out
}
```

（`renderMarkdown` 上面那段说明照旧保留，只在末尾补一句：**`caretAt` 是「揭示到哪个偏移」，见设计 3.5；量高度那一份永远不传它**。）

**改法四：`renderAll` 整个函数替换掉。**

```tsx
function renderAll(nodes: readonly MdNode[], ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i]
    if (node.type !== 'text' && node.type !== 'html') {
      out.push(
        <Fragment key={i}>
          {caretBefore(node, ctx)}
          {renderNode(node, ctx)}
        </Fragment>
      )
      i++
      continue
    }
    // 一串连续的 text / html：先看它有多长、里面有没有 html，顺便看光标落没落在这串里
    const start = i
    let hasHtml = false
    let caretHere = false
    while (i < nodes.length && (nodes[i].type === 'text' || nodes[i].type === 'html')) {
      const n = nodes[i]
      if (n.type === 'html') hasHtml = true
      // 【光标落在这串里就放在这一串的末尾】一个接受的近似，理由见设计 3.5：
      // 揭示偏移之后的节点要么是空的、要么已被整条丢掉，所以末尾与中间看不出差别。
      // **第一条判据与 `holdsCaret` 共用 `caretIndexIn`**：这一格问的是同一个问题（这个文本
      // 节点接得住揭示偏移吗），而「有没有逐行表」会让「起点 + 长度」那个算术与真实区间分岔
      // （容器里的多行文字，见 `caretIndexIn` 的注释）。两处各写一份 = 两处会各自走样。
      //
      // 【第二条判据：串里有节点**整个在揭示偏移之后**】它就是设计 3.5 那条「光标插在它
      // 前面」的规则（`caretBefore` 对逐个节点正是这么做的），在这一串上必须显式补一次——
      // 因为 `!hasHtml` 那条路才有逐节点的 `caretBefore`，而这一串是**当成一整段 token 流
      // 渲染**的，光标只能落在串尾。
      //
      // 【为什么少了它会掉出容器】**不是 text 的节点会被 `clip` 整条丢掉**（内嵌 HTML 要等
      // 整个抽完、硬换行与图片按自己的区间判），于是树上留下一段**没有节点的缝**；缝后面的
      // 那个文本节点起点比揭示偏移大，第一条判据够不着它，这一串就一个光标都不插，整篇落到
      // `renderMarkdown` 末尾的兜底。实测 `'> <b>x</b>甲一\n> 乙二\n'` 的 7、8、9（正好落在
      // 还没抽完的 `</b>` 那四个字符里）：修前光标从 `<blockquote>` 里跳到篇末，`12fac2d` 上
      // 是在块内的——那时这一格判的是「起点 + 长度 ≥ 揭示偏移」的算术版，**没有下界**，
      // 所以漏不出来。位置仍取串尾是对的：被丢掉的那几个字符不上屏、缝后面的节点又都是空的，
      // 「串尾」与「插在它前面」落的是同一个 DOM 位置。
      if (ctx.caret && !ctx.caret.placed) {
        const at = ctx.caret.at
        const nodeStart = n.position?.start.offset
        if (caretIndexIn(n, at) !== null || (nodeStart !== undefined && nodeStart >= at)) {
          caretHere = true
        }
      }
      i++
    }
    // 【第三条判据：这一串里有没有**兜底目标**（`Caret.tail`）】这条路**只调
    // `renderTokens(tokens)`、从不 `renderNode`**，于是 `splitAtCaret` 不被调用、`tail`
    // 没人消费——光标一路落到 `renderMarkdown` 末尾那条兜底，落在**块外**。实测
    // `'> <b>x</b>甲一\n> 乙二\n\n末段\n'` 的 18、19 与 `'甲 <b>乙</b>\n\n末段\n'` 的 7、8、9
    // （设计 3.5 那条兜底的注释里记着它的成因不是「链尾是 html 叶子」——那几格
    // `tailTarget` 返回的是**文本节点**）。
    //
    // 【位置取串尾是对的，而这一句就**只跟串尾比**】`tailTarget` 沿**最后一个孩子**往下走，
    // 所以 tail 落在一串里时它必然就是这一串的**最后一个节点**——「串尾」与「那个节点的末尾」
    // 于是是同一个 DOM 位置，不必再算下标。**那是一条不变量，而这一句现在自己钉住它**：判据
    // 若写成「tail 出现在这一串里」（在循环里逐个节点比），它就把不变量当成了没人管的前提，
    // 将来 `tailTarget` 一改取值方式（比如返回链上的中间节点），光标会**静默**落到串尾而不是
    // 那个节点的末尾。串尾是循环消费到的最后一个下标，**写成 `nodes[i - 1]`**——别写成
    // `nodes[nodes.length - 1]`：`tailTarget` 会跳过渲染成 `null` 的 `definition`，链尾后面
    // 跟一个 `definition` 时那是**另一个**节点，判据会平白失效、光标退回篇末兜底。
    if (ctx.caret && !ctx.caret.placed && ctx.caret.tail === nodes[i - 1]) caretHere = true
    if (!hasHtml) {
      // 【这一条路上读不到 `caretHere`】每个节点各成一个 Fragment、光标由 `caretBefore`
      // 精确落进某一个文本节点，所以上面那三条判据算出来的 `caretHere` 只被**合成 token 流**
      // 那条路（下面 `renderTokens` 那一段）消费。**它不是死代码，只是多余的一次求值**：
      // 规格评审实测，把它改成「只在 `hasHtml` 时求值」（两遍扫描）**行为逐字节不变**
      // （200 份定种子文档 × 每个偏移 = 1988 格，光标 DOM 签名 0 差异）。拆循环比留着贵。
      for (let k = start; k < i; k++) {
        out.push(
          <Fragment key={k}>
            {caretBefore(nodes[k], ctx)}
            {renderNode(nodes[k], ctx)}
          </Fragment>
        )
      }
      continue
    }
    const tokens: HtmlToken[] = []
    for (let k = start; k < i; k++) {
      const n = nodes[k]
      if (n.type === 'html') tokens.push(...tokenizeHtml(n.value))
      else tokens.push({ kind: 'text', value: rawOf(n) })
    }
    out.push(
      <Fragment key={start}>
        {renderTokens(tokens)}
        {caretHere && ctx.caret && !ctx.caret.placed ? <CaretSpan /> : null}
      </Fragment>
    )
    if (caretHere && ctx.caret && !ctx.caret.placed) ctx.caret.placed = true
  }
  return out
}
```

（`renderAll` 上面那段长注释照旧保留。）

**改法五：`renderNode` 里的五处分支。** `text`、`inlineCode`、`code`、`table`、`tableRow` 各换成：

> **`tableRow` 那一处原计划漏了**（实施者量出来的）。它也在造 `Ctx`——
> `renderAll(node.children, { header: ctx.header })` 少了 `caret`，**编译不过**；
> 而且照原文整张表格的**正文**都收不到光标（只有表头那条路带了）。改成把 `ctx`
> 整个传下去：`ctx.header` 此刻已经是该行的值，等价，而且把 `caret` 带下去了。

```tsx
    case 'text': {
      const parts = splitAtCaret(node, ctx)
      return parts ? (
        <>
          {parts[0]}
          <CaretSpan />
          {parts[1]}
        </>
      ) : (
        node.value
      )
    }
```

```tsx
    case 'inlineCode': {
      const parts = splitAtCaret(node, ctx)
      return (
        <code className="wt-md-code-inline">
          {parts ? (
            <>
              {parts[0]}
              <CaretSpan />
              {parts[1]}
            </>
          ) : (
            node.value
          )}
        </code>
      )
    }
```

```tsx
    case 'code': {
      const parts = splitAtCaret(node, ctx)
      return (
        <>
          <pre className="wt-md-pre">
            <code>
              {parts ? (
                <>
                  {parts[0]}
                  <CaretSpan />
                  {parts[1]}
                </>
              ) : (
                node.value
              )}
            </code>
          </pre>
          {/*
            【为什么是**直接调用**、不是 JSX 元素】它是个不用 hook 的纯函数。写成
            `<BlankSpace …/>` 的话，React 要到**渲染这棵树的时候**才执行它、才置
            `placed`；而 `renderMarkdown` 末尾那句兜底是在**建元素的时候**判
            `caret.placed` 的，那时还是 false——于是同一次渲染里会冒出**两个**
            `[data-testid="caret"]`（实测：本文件的六份夹具上共 19 个偏移位——表格
            `to = 8–20` 与 `28–30`、代码块 `to = 1–3`；复审在他们那组夹具上是 81 个。
            产物长这样：`…</table><span caret/><div class="wt-md-table-blank"/>` +
            末尾又一个 `<span caret/>`）。`InputCapture` 取的是第一个，所以今天
            「恰好」还对——那是运气，不是设计。直接调用让置位发生在兜底之前。
          */}
          {BlankSpace({
            node,
            field: WT_BLANK_LINES,
            className: 'wt-md-pre-blank',
            cssVar: '--wt-md-blank-lines',
            ctx
          })}
        </>
      )
```

```tsx
    case 'table': {
      const [head, ...body] = node.children
      return (
        <>
          <table className="wt-md-table">
            {head && <thead>{renderNode(head, { ...ctx, header: true })}</thead>}
            {body.length > 0 && (
              <tbody>
                {body.map((row, i) => (
                  <Fragment key={i}>{renderNode(row, { ...ctx, header: false })}</Fragment>
                ))}
              </tbody>
            )}
          </table>
          {/* 同 `case 'code'`：**直接调用**，理由（渲染时序）见那里 */}
          {BlankSpace({
            node,
            field: WT_BLANK_ROWS,
            className: 'wt-md-table-blank',
            cssVar: '--wt-md-blank-rows',
            ctx
          })}
        </>
      )
    }
```

**改法六：新增八个小函数**，放在 `HtmlFragment` 那个函数**之后**：

```tsx
/** 阅读光标。类名与 `data-testid` 与纯文本那条路用的是同一套——`InputCapture` 按它定位。 */
function CaretSpan(): ReactNode {
  return <span className="wt-caret" data-testid="caret" />
}

/**
 * 这个节点的 `value` 在源码里的起点。
 *
 * 【它在这棵树上是准的】`parse.ts` 解析时挂上原始起点，`clip.ts` 每次切片都把起点
 * 跟着挪 `head`——所以「节点**当前的** `value` 的第一个字符在源码里的偏移」这个语义
 * 在裁剪后的树上照样成立，下面 `splitAtCaret` 的 `clamp(揭示偏移 − 起点, 0, 长度)`
 * 才算得对。**在裁剪后的树上读到失真的起点是静默的**（光标差几个字符、不报错），
 * 所以这条链路两侧的注释都点名了它。
 *
 * 普通 `text` 节点原本没有这个标注、用 `position.start.offset` 兜；切片之后 `clip.ts`
 * 也给它们写上了。两者都没有（手工造的单测树）时给 0——那时不会传 `caretAt`。
 */
function originOf(node: MdNode): number {
  return valueStartOf(node) ?? node.position?.start.offset ?? 0
}

/**
 * 把一个带文本的节点的 `value` 按光标切成两段；没命中给 `null`（调用方原样渲染）。
 *
 * 【判据】**内容结束偏移 ≥ 揭示偏移**就算命中，而不是「起点 ≤ 揭示偏移 ≤ 结束」。
 * 前者让**空节点**也能接住光标——列表项刚开始、文字还没出来时，那个空文本节点正好
 * 命中，光标于是落在序号后面，而不是掉到列表下面。后者会漏掉这一格。设计 3.5 是
 * 这条规则的正本。
 *
 * 【为什么切的是**裁后**的 `value`】树上已经没有未揭示的字了，所以
 * 「内容结束偏移」= 内容起点 + 裁后的长度 = 光标该在的位置。
 */
function splitAtCaret(value: string, origin: number, ctx: Ctx): [string, string] | null {
  const caret = ctx.caret
  if (!caret || caret.placed) return null
  // 判据与 `holdsCaret` 一致：**区间包含**揭示偏移才算接得住
  if (caret.at < origin || caret.at > origin + value.length) return null
  const at = Math.max(0, Math.min(caret.at - origin, value.length))
  // 【先置位再返回】置位是「整棵树只插一个」的闸，必须在返回前落下
  caret.placed = true
  return [value.slice(0, at), value.slice(at)]
}

/** 这个节点能不能**自己**接住光标：它带可裁文本，且区间 `[起点, 起点 + 长度]` 包含揭示偏移。 */
function holdsCaret(node: MdNode, ctx: Ctx): boolean {
  const caret = ctx.caret
  if (!caret) return false
  if (node.type !== 'text' && node.type !== 'code' && node.type !== 'inlineCode') return false
  const origin = originOf(node)
  return origin <= caret.at && caret.at <= origin + node.value.length
}

/** 节点的源码结束偏移。**没有位置的一律算「在揭示偏移之后」**。 */
function endOf(node: MdNode): number {
  return node.position?.end.offset ?? Number.POSITIVE_INFINITY
}

/** 没有 `children`、也不是可裁文本的叶子：硬换行、分隔线、图片、内嵌 HTML、脚注引用。 */
function isLeaf(node: MdNode): boolean {
  if (node.type === 'text' || node.type === 'code' || node.type === 'inlineCode') return false
  return !('children' in node)
}

/**
 * 渲染一个子节点**之前**，先看光标该不该落在它前面（设计 3.5 那条规则的正本）。
 *
 * 【判据一：这个节点整个在揭示偏移之后】起点 ≥ 揭示偏移 → 光标落在它前面。
 *
 * 【判据二：提前渲染的叶子跨过了揭示偏移】硬换行与图片的**起点在揭示偏移之前**、结束
 * 在之后（理由见设计 3.5）。只看起点会跳过它们，光标于是落到**下一行或图的右边**——
 * 实测过（`甲  ␊乙` 在 2–4、`甲 ![图](…) 乙` 在 3–19）。所以对「没有 children、也不是
 * 可裁文本」的叶子再判一次**结束偏移**。
 *
 * 【为什么值节点不在这里处理】它能自己把文本**劈开**（`splitAtCaret`），那样光标落在
 * 它**里面**那个正确的字符上，比落在它前面准。上面 `holdsCaret` 那一句就是把这个机会
 * 让给它。
 *
 * 【未揭示的占位也走这一条】`BlankSpace` 不是语法树里的节点，所以它由 `code` / `table`
 * 两个分支在渲染它之前显式调一次本函数——占位代表「还没到的东西」，光标永远在它**前面**。
 * 不这么做的话，实测一张表在揭示偏移 8–20 这连续 13 个位置上，光标会被一路甩到占位之后。
 */
function caretBefore(node: MdNode, ctx: Ctx): ReactNode {
  const caret = ctx.caret
  if (!caret || caret.placed) return null
  if (holdsCaret(node, ctx)) return null
  /*
    【给表格的行与格让路】它们的子文本节点会接住光标；在它们身上开火会把光标插成
    `<tr>` 的**直接子元素**——那不是合法的表格内容，CSS 会给它套一个匿名表格盒，
    **表格于是多出一列**（实测宽 115→172、第二列 x 57→114）。

    这一格是本轮新引入的：旧判据在那些位置把光标放在第二个 `<th>` **里面**（合法），
    而区间判据让 `cell.start >= caret.at` 先开火、把它挪到了格外。下面那条「插在它
    前面」针对的是**叶子**（硬换行、图片、占位），不是容器。
  */
  if (node.type === 'tableCell' || node.type === 'tableRow') return null
  const start = node.position?.start.offset
  const after = start !== undefined && start >= caret.at
  const leafAcross = isLeaf(node) && endOf(node) >= caret.at
  if (!after && !leafAcross) return null
  caret.placed = true
  return <CaretSpan />
}

/**
 * 「未揭示的部分」所占的空白（设计 3.2 修订）。
 *
 * 【它什么都不画】表格的剩余行不画空网格线、代码块的剩余行不画框——用户拍板的就是
 * 这一条：占位只有高度，屏幕上不该出现任何字形。所以这里只出一个空 div 加一个高度。
 *
 * 【为什么行数走 CSS 变量、不在这里算像素】「一行多高」是样式的事，而代码块的行高
 * （13px × 1.6）与表格行的行高（14px × 1.9 + 单元格内边距）**不是同一个数**。
 * 这里只报「几行」，换算留给 `markdown.css`，两处各自可调。
 *
 * 【行数从哪来】`clip.ts` 挂在节点上的（见那里的 `readBlankCount`）。它返回 0 时
 * 整个元素都不渲染——已经全部揭示的块不该在 DOM 里多出一样东西。
 *
 * 【为什么值要转成字符串】内联到 CSS 自定义属性上时，数字会不会被 React 补一个 `px`
 * 取决于版本行为；补了的话 `calc(2px * 20.8px)` 是无效值，高度会静默变成 0——占位
 * 凭空消失而且**不报错**。写成字符串就没有这一层不确定性。
 */
function BlankSpace({
  node,
  field,
  className,
  cssVar,
  ctx
}: {
  node: MdNode
  /**
   * 【为什么不是裸 `string`】`clip.ts` 把 `readBlankCount` 的参数收成了那两个常量的联合，
   * 传 `WT_VALUE_START` 之类会**编译不过**。这里必须跟它一致，否则本 Task 一落地就红。
   * 用 `typeof` 取那两个常量的类型，不必让 `clip.ts` 再多导出一个类型别名。
   */
  field: typeof WT_BLANK_LINES | typeof WT_BLANK_ROWS
  className: string
  cssVar: string
  ctx: Ctx
}): ReactNode {
  const count = readBlankCount(node, field)
  if (count <= 0) return null
  /*
    【占位自己接住光标】占位代表「还没走到的东西」，一个还没落地的光标本来就该落在它
    **前面**。这一格是实测出来的：**整段节点全被丢掉、只剩占位代表它**时（表格 8–20、
    代码块 1–3 这些位置），光标原本一路掉到末尾兜底、落在占位**之后**。

    推论也成立，所以不必再判别的：`count > 0` 蕴含「有不小于揭示偏移的行 / 行数」
    （`clip.ts` 就是按这个算出来的），所以那一刻光标**必然**属于这个块内部——不存在
    「本该由后面某个块接住」的情况。

    【为什么不能靠 `caretBefore` 在这一层接】它那条「整个在揭示偏移之后」的判据是
    `start >= caret.at`，而被渲染出来的块恒有 `start < to`（`clipBlocks` 早把
    `start >= to` 的整块丢了），两个条件互斥——实施者实测过，那样写是**死代码**。
  */
  const caret = ctx.caret
  const takesCaret = caret !== null && !caret.placed
  if (takesCaret) caret.placed = true
  return (
    <>
      {takesCaret && <CaretSpan />}
      <div className={className} style={{ [cssVar]: String(count) } as CSSProperties} />
    </>
  )
}
```

**自检：** 把上面六个片段各自在文件里搜一遍（含缩进），必须逐字命中；`case 'code'` 与 `case 'table'` 在 `renderNode` 的 `switch` 里各只剩一处；`renderAll` / `renderMarkdown` 各只剩一个定义。

- [ ] **Step 4: 跑测试，确认它绿**

Run: `pnpm vitest run tests/unit/markdownToReact.test.tsx` → PASS
Run: `pnpm typecheck` → exit 0

- [ ] **Step 5: 变异验证（两条，各自单独做）**

**先写下预期**：

- 变异甲：把 `BlankSpace` 里的 `if (count <= 0) return null` 改成 `if (false) return null`。预期红：**「表格一行不缺时：一个占位元素都不多出」这一条**，其余两条不该红。
- 变异乙：把 `splitAtCaret` 里的区间判据 `if (caret.at < origin || caret.at > origin + value.length) return null` 改成 `if (caret.at > value.length) return null`（**把 `origin` 整个丢掉**）。预期红：**只有「光标插进代码框里」一条**。

  **「空节点」那条不会再红，这是实施者量出来的**：它现在有**两个独立见证**——`splitAtCaret` 的区间判据，与 `caretBefore(paragraph)` 的 `start >= caret.at`（那个段落的起点正好等于揭示偏移）。单回退一个机制，光标照样落在 `<li>` 里。想让两条都红，得**同时**回退两个机制。原计划写「预期两条」是按 `caretBefore` 还不存在时的实现写的。
- 变异丙：把 `BlankSpace` 里的 `const takesCaret = caret !== null && !caret.placed` 改成 `const takesCaret = false`（占位不再接光标）。预期红：**真管线那组里的「表格」与「代码块」两条**——它们正是坏区（表格 8–20、代码块 1–3）。

  **这条是本 Task 的头条机制**：实施者实测过，**靠 `caretBefore` 在那两个分支里接是死代码**（它的判据与被渲染块的 `start < to` 互斥），所以这个缺陷只有「占位自己接」这一条路能修。

  **别用「`origin + 长度 < at` → `长度 < at − origin`」那种写法**——那是**同一个不等式**（两边同减 `origin`），恒等价、任何用例都区分不了。实施者实测 Δ = 0，并据此指出原计划里「`origin` 非 0 时不等价」那句话是错的。

  这条变异的意义：**如果它一条都不红，说明没有任何用例守住 `origin`，那条链就是零覆盖**。实施者量过一次，结论值得记：把代码块那条的断言修对**之前**，真正守住 `origin` 的是**空节点那条**（文本起点 2、长度 0、`caretAt` 2），而代码块那条因为断言差一个字符、什么都判不了；断言修对之后两条都红。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/markdown/toReact.tsx tests/unit/markdownToReact.test.tsx
git commit -F /tmp/wt-msg.txt
```

---

## Task 4b: 逐行偏移表 —— 容器里的文字与代码块共用一条坏坐标

**对应设计：** 第 3.6.1 节（它同时推翻了 3.6 里那条「不为它做逐行映射」的裁定）。

**为什么插在 Task 4 之后：** 它要改 `toReact.tsx` 的光标换算，而 Task 4 正在那条路上。**等 Task 4 的返工落地并评审通过再开工。**

**背景**：容器里**逐行剥前缀**的文字（引用块的 `> `、多行列表项的续行缩进）`value` 下标与源码偏移**不是差一个常量**——第二行起每行差一个前缀宽度，方向是**提前**（未揭示的字上屏）。实测（仓库里的 remark 复算）：

```
'> 引用甲\n> 引用乙\n' → text 节点 position=[2,11]、value='引用甲\n引用乙'
揭示偏移 7 时屏幕上是 '引用甲\n引'，而应当是 '引用甲' —— '引'（源码偏移 8）漏了
```

代码块那两处「已知残留」（缩进块、带缩进的围栏）是**同一套机制**，一并精确。

**Files:**
- Modify: `src/renderer/src/markdown/parse.ts`（加一个逐行表与它的读口）
- Modify: `src/renderer/src/markdown/clip.ts`（值那一支改成逐行切片）
- Modify: `src/renderer/src/markdown/toReact.tsx`（光标的「偏移 → 下标」换算用同一张表）
- Modify: `tests/unit/markdownParse.test.ts`、`tests/unit/markdownClip.test.ts`、`tests/unit/markdownToReact.test.tsx`

- [ ] **Step 1: 写失败的测试**

`tests/unit/markdownParse.test.ts` 追加（表本身）：

```ts
/**
 * 逐行偏移表（设计 3.6.1）。行起点要用**回验**得到——「每一行的 `value` 都贴在该行源码的
 * 尾部」这条依据**不成立**（remark 还会剥行尾空白，见本块最后那条 `it.each`）。
 */
describe('parseMarkdown —— 逐行偏移表', () => {
  it('多行引用块：第二行的起点是那一行自己的位置，不是第一行加字符数', () => {
    const src = '> 引用甲\n> 引用乙\n'
    const text = (parseMarkdown(src)!.children[0] as never as { children: { children: unknown[] }[] })
      .children[0].children[0]
    expect(lineStartsOf(text)).toEqual([src.indexOf('引用甲'), src.indexOf('引用乙')])
    // `'引用甲\n引用乙'` 里第 4 个字符是第二行的「引」——它的源码位置是 8，不是 2+4=6
    expect(src.indexOf('引用乙')).toBe(8)
  })

  it('普通的单行文本：不挂表（用 `position` 就够，挂了也只是重复信息）', () => {
    const para = parseMarkdown('甲\n')!.children[0] as unknown as { children: unknown[] }
    expect(lineStartsOf(para.children[0])).toBeNull()
  })

  /**
   * 读口与 `valueStartOf` 同一口径：**不是有限数一律当没挂表**。手工造节点——真管线今天
   * 产不出 `NaN` / `Infinity`（`parse.ts` 与 `clip.ts` 都只写整数），所以这条只能这么测。
   *
   * 【空数组为什么单独钉一句】它**不是 `null`**（`every` 对空数组恒真），而它是个**真值**
   * ——`clip.ts` 那个「空表按没有表算」的守卫（`r.starts.length > 0`）防的正是这一格。
   */
  it('表里混进 NaN / Infinity 一律当没挂表；空数组仍然原样返回', () => {
```

`tests/unit/markdownClip.test.ts` 追加（切片真的按行走）：

```ts
 * 要么把**整条 `value`** 都包住（`from = 3, to = 12`）——这两种情形下「常量原点 + 字符数」
 * 本来就是精确的（那是 Task 1 / Task 2 的成果）。所以原先那句「修之前这里的每一条都是错的」
 * 与事实不符，别照着它理解这一节在守什么。
 */
describe('clipTree —— 容器里的文字按行切', () => {
  const QUOTE = '> 引用甲\n> 引用乙\n'

  it('光标停在第一行结尾：第二行一个字都不显示', () => {
    const out = clipTree(parseMarkdown(QUOTE)!, 0, QUOTE.indexOf('引用甲') + 3)
    expect(textOf(out)).toBe('引用甲')
  })

  it('光标走到第二行中间：只显示到那里', () => {
    const out = clipTree(parseMarkdown(QUOTE)!, 0, QUOTE.indexOf('引用乙') + 1)
    expect(textOf(out)).toBe('引用甲\n引')
  })

  /**
   * 【换行符算谁的】两行之间那个 `\n` 在源码里位于「行 k 的源码结束偏移」处，所以它挂在
   * **行 k 名下**：`to` 越过它才显示。行 0 的内容到源码 5 为止、`\n` 就在 5，于是
   * `to = 5` 不含它、`to = 6` 含它。
   *
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `pnpm vitest run tests/unit/markdownParse.test.ts tests/unit/markdownClip.test.ts`
Expected: **红**（`lineStartsOf` 还没导出；切片那三条给出比期望多的字）。把实际红的样子记几条下来。

- [ ] **Step 3: 改三个文件**

**`parse.ts`：**

在 `contentStartOf` 那一带之后追加：

```ts
/** 挂在节点上的逐行偏移表（设计 3.6.1）：每个 value **行**的首字符在源码里的偏移。 */
export const WT_LINE_STARTS = 'wtLineStarts'

/** 读逐行偏移表：没有、不是数组一律给 `null`（调用方退回按字符数切）。 */
export function lineStartsOf(node: unknown): number[] | null {
  const raw = (node as Record<string, unknown> | null | undefined)?.[WT_LINE_STARTS]
  return Array.isArray(raw) && raw.every((n) => typeof n === 'number') ? (raw as number[]) : null
}

/**
 * 建逐行偏移表：每个 value 行的首字符在源码里的偏移。
 *
 * 【依据】**每一行的 `value` 都贴在该行源码的尾部**——前缀（引用块的 `> `、列表项的续行
 * 缩进、围栏、缩进块的缩进）全在它前面。所以「该行源码的结束偏移 − 该行在 value 里的
 * 长度」就是行起点。这与 3.6 给代码块算首部起点用的是同一条技巧，推广到逐行。
 *
 * 【为什么要跳过围栏那一行】围栏块的第一行不是内容，与 `contentStartOf` 同一套判据。
 */
function buildLineStarts(kind: string, source: string, start: number, end: number, value: string): number[] {
  const lines = value.split('\n')
  const nl = source.indexOf('\n', start)
  const firstLineEnd = nl >= 0 && nl < end ? nl : end
  const fenced = kind === 'code' && /^ {0,3}(`{3,}|~{3,})/.test(source.slice(start, firstLineEnd))
  let lineStart = fenced ? (firstLineEnd < end ? firstLineEnd + 1 : firstLineEnd) : start
  const out: number[] = []
  for (const line of lines) {
    const next = source.indexOf('\n', lineStart)
    const lineEnd = next >= 0 && next < end ? next : end
    out.push(lineEnd - line.length)
    lineStart = lineEnd + 1
  }
  return out
}

/** 这张表能不能由「起点 + 字符数」直接推出来。能的话不挂——挂了也只是重复信息。 */
function isContiguous(starts: readonly number[], base: number, value: string): boolean {
  let v = 0
  for (const s of starts) {
    if (s !== base + v) return false
    const nl = value.indexOf('\n', v)
    v = nl < 0 ? value.length : nl + 1
  }
  return true
}
```

并把 `annotateValueStarts` 改成（**`text` 也要判**——容器里的文字就走这一类）：

```ts
function annotateValueStarts(node: unknown, source: string): void {
  const n = node as {
    type?: string
    value?: string
    children?: unknown[]
    position?: { start: { offset?: number }; end: { offset?: number } }
  }
  const start = n.position?.start.offset
  const end = n.position?.end.offset
  if (typeof n.value === 'string' && start !== undefined && end !== undefined) {
    if (n.type === 'code' || n.type === 'inlineCode') {
      ;(n as Record<string, unknown>)[WT_VALUE_START] = contentStartOf(n.type, source, start, end, n.value)
    }
    if (n.type === 'text' || n.type === 'code') {
      const starts = buildLineStarts(n.type, source, start, end, n.value)
      const base = n.type === 'code' ? (valueStartOf(n) as number) : start
      // 【`null` 只剩一个来源：空 `value`】回验对不上**不再**摘表——那一支现在退回表里那个
      // 恒不提前的保守算式（第四轮）。所以「不挂表」的两种情形是：空 `value`（没有下标可言）
      // 与「连续」（`起点 + 字符数` 与表逐字等价，挂了只是重复信息），两条都不丢坐标。
      if (starts && !isContiguous(starts, base, n.value)) {
        ;(n as Record<string, unknown>)[WT_LINE_STARTS] = starts
      }
    }
```

**`clip.ts`：** 值那一支在算 `head` / `tail` 之前插一段分派——有表就逐行走，没表就按老办法：

```ts
    const lines = lineStartsOf(n)
    let head: number
    let tail: number
    let revealedStarts: number[] | null = null
    if (lines) {
      const r = sliceByLineStarts(n.value, lines, from, to)
      head = r.head
      tail = r.tail
      revealedStarts = r.starts
    } else {
      head = Math.max(0, from - origin)
      tail = Math.max(head, to - origin)
    }
```

切片完写回时，**表也要跟着切成「已揭示那几行」**（光标的换算靠它）：

```ts
const shiftedStart = revealedStarts ? revealedStarts[0] : origin + head
```
并在返回的对象里带上 `[WT_LINE_STARTS]: revealedStarts`（为 `null` 时不带）。

新增的两个纯函数（放 `readBlankCount` 附近）：

```ts
 *
 * 【返回值里的 `starts`】已揭示那几行的行起点（第一行按窗口起点裁过的那个算）。
 * 光标的「偏移 → 下标」换算要用它，否则多行容器里的光标会差一个前缀宽度。
 *
 * 【同一件事有三处实现，别只改一处】「沿 `value` 的 `\n` 走行、每行进 `lineLen + 1`」这个
 * 循环在这里、`parse.ts` 的 `isContiguous`、`toReact.tsx` 的 `rowsOf` 各写了一份——用途不同
 * （求窗口 / 判连续性 / 摊成行），所以**不合并**，但**行尾口径三份不一样**：这里用 `+ 1` 把
 * 换行**括进窗口**（所以窗口正好收在某行行尾时会连那个 `\n` 一起显示），`isContiguous` 把换行
 * **算给上一行**，`rowsOf` 的行长**不含**换行。动任何一处之前先把三处对一遍。
 */
function sliceByLineStarts(
  value: string,
  starts: readonly number[],
  from: number,
  to: number
): { head: number; tail: number; starts: number[] } {
  let head = -1
  let tail = -1
  const revealed: number[] = []
  let base = 0
  for (let k = 0; k < starts.length; k++) {
    const nl = value.indexOf('\n', base)
    const lineLen = (nl < 0 ? value.length : nl) - base
    const srcStart = starts[k]
    const lo = Math.max(from, srcStart)
    const hi = Math.min(to, srcStart + lineLen + 1)
    if (lo < hi) {
      const i0 = base + (lo - srcStart)
      const i1 = base + (hi - srcStart)
      if (head < 0) head = i0
      tail = i1
      revealed.push(lo)
    }
    base += lineLen + 1
  }
  if (head < 0) return { head: 0, tail: 0, starts: [] }
  return { head, tail, starts: revealed }
}
```

**`toReact.tsx`：** `splitAtCaret` 里那个 `at = clamp(caret.at − origin, 0, value.length)` 换成**查表**：有 `wtLineStarts` 时，`at` = 「第一个行起点 ≥ 揭示偏移的那一行」在 value 里的下标；没有时按现在的算术。同理 `holdsCaret` 的区间判据在有表时用「首行起点 ≤ 揭示偏移 ≤ 末行起点 + 末行长度」。

> 这一段是**规则**不是逐字代码：实施者按它写，写完把最终代码贴回报告，我回写进计划。判据是设计 3.6.1 与上面那张表的语义。

- [ ] **Step 4: 跑测试，确认它绿**

Run: `pnpm vitest run tests/unit/markdownParse.test.ts tests/unit/markdownClip.test.ts tests/unit/markdownToReact.test.tsx` → PASS
Run: `pnpm test` → **exit 0**；Run: `pnpm typecheck` → exit 0

- [ ] **Step 5: 变异验证（三条，各自单独做）**

**先写下预期**再回退：

- 甲：`sliceByLineStarts` 里的 `const hi = Math.min(to, srcStart + lineLen + 1)` 改成 `Math.min(to, srcStart + lineLen)`（换行符不归行 k）→ 预测红的是「光标走到第二行中间」那条。
- 乙：`buildLineStarts` 里 `out.push(lineEnd - line.length)` 改成 `out.push(lineEnd)` → 预测红的是**多行引用块那两条 + 折点那条**。
- 丙：`annotateValueStarts` 里那句 `if (!isContiguous(...))` 改成 `if (false)`（表一律不挂）→ 预测红的是同样的三条（退回旧行为）。

红得比预期多或少都要查清楚再往下走。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/markdown/parse.ts src/renderer/src/markdown/clip.ts src/renderer/src/markdown/toReact.tsx tests/unit/markdownParse.test.ts tests/unit/markdownClip.test.ts tests/unit/markdownToReact.test.tsx
git commit -F /tmp/wt-msg.txt
```

消息末尾保留 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

---

## Task 4c: `parse.ts` —— 逐行表的行起点改用**回验**（行尾空白被剥时整张表右移）

**对应设计：** 第 3.6.1 节。**这一节要改掉它自己的一句话**——「每一行的 `value` 都贴在该行源码的尾部」这条依据**不成立**（理由见下）。

**为什么排在最前：** 这是 4b 带出来、**现在就在线上**的内容回归——`Page.tsx` 早就接了 `MarkdownView`，内容那一半是活的（只有 `caretAt` 还没接）。表现为**那一行的首字晚一个按键上屏**，方向与 4b 要治的那个（提前）相反。

**背景（实测，评审与我都独立跑过真管线）：** remark 除了剥**行首前缀**，还会剥**行尾空白**，于是「行尾 − 行长」那个减法把被剥掉的字也算进去了：

| 源码 | `value` | 现在的表 | 真值 |
|---|---|---|---|
| `甲 \n乙\n` | `甲\n乙` | `[1, 3]` | `[0, 3]` |
| `> 甲 \n> 乙\n` | `甲\n乙` | `[3, 7]` | `[2, 7]` |
| `> 甲 \t\n> 乙\n` | `甲\n乙` | `[4, 8]` | `[2, 8]` |
| `- 甲 \n  乙\n` | `甲\n乙` | `[3, 7]` | `[2, 7]` |

真管线后果（顶层 `'甲 \n乙\n'`）：`to = 1` 时 4b 之前显示 `甲`、现在显示空——**首字晚一个按键**。

**Files:**
- Modify: `src/renderer/src/markdown/parse.ts`（`buildLineStarts` 一个函数）
- Modify: `tests/unit/markdownParse.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/unit/markdownParse.test.ts`，接在已有的「逐行偏移表」那个 `describe` 里：

```ts
   * 不界住那版会给 `[7,7]` / `[3,3]` / `[6,3]` / `[2,11,11]`，与实现对不上。
   */
  it.each([
    ['顶层段落', '甲 \n乙\n'],
    ['引用块', '> 甲 \n> 乙\n'],
    ['列表项', '- 甲 \n  乙\n'],
    ['行尾是制表符', '> 甲 \t\n> 乙\n'],
    ['引用块里两行文字相同', '> 甲 \n> 甲\n'],
    ['顶格两行文字相同', '甲 \n甲\n'],
    ['同样的文字在后面又出现一次', '甲 \n乙\n\n甲\n'],
    ['三行、后两行相同', '> 甲 \n> 乙\n> 乙\n']
  ])('%s：行尾空白被剥时表不右移', (_name, src) => {
    const text = textOf(parseMarkdown(src)!)
    const value = text.value as string
    const srcLines = src.split('\n')
    expect(lineStartsOf(text)).toEqual(
      value.split('\n').map((line, k) => {
        const lineStart = srcLines.slice(0, k).reduce((n, l) => n + l.length + 1, 0)
        return lineStart + srcLines[k].lastIndexOf(line)
      })
    )
  })
```

（`textOf` 是「取第一个 text 节点」的小助手，**文件里没有就自己加一个**，别改别处；断言的右半边必须由 `value` 与源码现算，**不许把 `[0,3]`、`[2,7]` 这些数写死**——写死就变成「测实现」了。）

**右半边必须按行界住**（这一条是实施者量出来的、我原先写错了）：`src.lastIndexOf(line, src.length)` 是**全源码**查找，只有当每行文字在整篇源码里**唯一**时才等于真值。反例（实现与按行界住的真值一致，是**断言那半边**错）：`'> 甲 \n> 甲\n'` 计划那条给 `[7,7]`（真值 `[2,7]`）、`'甲 \n甲\n'` 给 `[3,3]`（`[0,3]`）、`'甲 \n乙\n\n甲\n'` 给 `[6,3]`（`[0,3]`）、`'> 甲 \n> 乙\n> 乙\n'` 给 `[2,11,11]`（`[2,7,11]`）。**已交付的 `03ec224` 用的正是不界住的那版**——四个夹具恰好各行唯一，所以现在是绿的，但它是个**假判据**：谁加一条重复行的夹具，它就会把**对的实现判成红的**。改准与补重复行夹具归 **Task 4e**。

- [ ] **Step 2: 跑测试，确认它红**

Run: `pnpm vitest run tests/unit/markdownParse.test.ts`

预期：四条**全红**，且红的理由是**表右移**（`[1,3]` vs `[0,3]` 这种）。全仓其余用例一条都不动。

- [ ] **Step 3: 改 `buildLineStarts`（一个函数）**

```ts
/**
 * 建逐行偏移表：每个 value 行的首字符在源码里的偏移。
 *
 * 【依据是**回验**，不是「行尾 − 行长」】最初写的是「该行源码的结束偏移 − 该行在 value 里的
 * 长度」，依据是「每一行的 `value` 都贴在该行源码的尾部」——**这条依据不成立**：remark 除了
 * 剥行首前缀，还会剥**行尾空白**，那个减法于是把被剥掉的字也算进去，整张表往后偏（实测
 * `'甲 \n乙\n'` 得 `[1,3]`、真值 `[0,3]`；`'> 甲 \t\n> 乙\n'` 偏 2）。方向是「晚」——
 * 那一行的首字晚一个按键上屏。
 *
 * 现在的做法是**在这一行源码里把那行文字找出来**：从行尾往前找最后一次出现（行尾空白是
 * 它后面唯一允许多出来的东西），并要求找到的位置之后到行尾**全是空白**。找不到就返回
 * `null`、不挂表——退回「起点 + 字符数」那条路（4b 之前的行为）。**宁可少精确一处，也不要
 * 挂一张偏掉的表**：偏掉的表不报错，只让内容静默地差几个字。
 *
 * 【为什么要跳过围栏那一行】围栏块的第一行不是内容，与 `contentStartOf` 同一套判据。
 */
function buildLineStarts(
  kind: string,
  source: string,
  start: number,
  end: number,
  value: string
): number[] | null {
  const lines = value.split('\n')
  const nl = source.indexOf('\n', start)
  const firstLineEnd = nl >= 0 && nl < end ? nl : end
  const fenced = kind === 'code' && /^ {0,3}(`{3,}|~{3,})/.test(source.slice(start, firstLineEnd))
  let lineStart = fenced ? (firstLineEnd < end ? firstLineEnd + 1 : firstLineEnd) : start
  const out: number[] = []
  for (const line of lines) {
    const next = source.indexOf('\n', lineStart)
    const lineEnd = next >= 0 && next < end ? next : end
    const at = source.lastIndexOf(line, lineEnd)
    if (at < lineStart || !/^[ \t]*$/.test(source.slice(at + line.length, lineEnd))) return null
    out.push(at)
    lineStart = lineEnd + 1
  }
  return out
}
```

**调用点要跟着收窄**（`annotateValueStarts` 里那一句）：`buildLineStarts(...)` 现在可能给 `null`，那就**不挂表**——`null` 与「连续」走的是同一条退路。

**其余一个字节不改。**

- [ ] **Step 3b: 空 `value` 的 code 节点，两条路取同一个约定**

**由来（质量评审第 8 条，它实测的）**：`contentStartOf` 对 `value === ''` 提前返回**围栏之后**那个位置，而 `buildLineStarts` 对 `lines = ['']` 走「行尾 − 行长」——那个「行尾」是**收尾围栏那一行**的换行。两条路对空 `value` 的约定不同，于是同一个节点在同一棵树上有**两个原点**：

| 夹具 | 解析期 | 裁到 `to` 越过收尾围栏那一格 |
|---|---|---|
| `'```\n```\n'` | `wtValueStart=4`、表 `[7]` | `to=8` → `wtValueStart=7`、表 `[7]` |
| `'```md\n```\n'` | `wtValueStart=6`、表 `[9]` | `to=10` → `wtValueStart=9`、表 `[9]` |
| `'```\n\n```\n'` | 表 `null`（不发作） | 从不挂表 |

**非空围栏的对照**（同一支探针）：`'```\n甲\n```\n'` 在 `to = 1..10` 上 `wtValueStart` **恒为 4**、表恒为 `null`——不发作。归属上：`wtValueStart` 那一半是 Task 1 的约定，表那一半是 4b 新带出来的（`12fac2d` 上没有「表」这个概念，所以「两个原点」在 4b 之前不存在）。

**修法**：`value === ''` 时**不挂表**（`buildLineStarts` 早退给 `null`），让 `contentStartOf` 定的那个数成为**唯一**的原点。挂表本来是想说「下标与偏移不是线性关系」——空 `value` 没有下标可言。

**别顺手写过头**：**不许**把它推广成「空 `value` 的节点一律不许挂表」当成全局不变量。`'> ```\n> 甲\n> 乙\n> ```\n'` 的 `to = 1..7` 上 `value` 为空是**空窗口**的结果，那几格归 `clip.ts` 的空窗口守卫管（Task 4e 钉的就是它，且它用的判据必须钉在**空窗口那一格**上）。

**顺带记一句后果、别去追**：`to = 8` 那一格上，空代码框的区间退化成一点、接不住光标，走末尾兜底——那本来就是「内容到头」那一类，评审也判它低严重度。本步**只收「两个原点」这个不一致**。

测试（`tests/unit/markdownParse.test.ts`）：两个夹具各断言**解析期** `lineStartsOf(code) === null`，且 `valueStartOf(code)` 是那个数（4 / 6）。**只断言解析期**——`to=8` 那个跳变是「解析期挂上了表」的后果，表不挂它就不存在。（这个文件里若没有 `clipTree` 的 import，别为了这一步去加。）

**变异（单独做）**：把 `value === ''` 那条早退去掉 → 预测红的是**本步新加的那条**（表 `[7]` / `[9]` 又回来）。

- [ ] **Step 4: 跑测试，确认它绿**

Run: `pnpm vitest run tests/unit/markdownParse.test.ts tests/unit/markdownClip.test.ts` → PASS
Run: `pnpm test` → **exit 0**；Run: `pnpm typecheck` → exit 0

- [ ] **Step 5: 变异验证（两条，各自单独做）**

**先写下预期**再回退：

- 甲：把回验那句换回旧的 `out.push(lineEnd - line.length)`（并把返回类型的 `| null` 去掉、调用点改回原样）→ 预测红的是**本次新加的六条**：四条 `it.each` 加 **Step 3b 那两条**（空代码块）。**「六条」这个数在 Step 3b 加进来之后才成立**——实施者按「四条」的旧预期跑、实测红 6 条，如实报了差。
- 乙：把 `/^[ \t]*$/` 那个守卫改成 `true`（不做「后面全是空白」的检查，只留 `lastIndexOf`）→ 预测**四条仍绿**（`lastIndexOf` 已经找对了位置）。这条用来确认守卫是**多余的**还是**有主的**：若真的一条都不红，在报告里写清「守卫零覆盖」，**别删它**——它是「宁可退回旧行为」那条口径的落点，留着并说明理由。

- [ ] **Step 6: 顺手核一遍 `contentStartOf` 有没有同一形态**

`contentStartOf`（3.6，代码块 `value` 的首部起点）用的是**同一个技巧**（「行尾 − 行长」）。**实测**一个「围栏里第一行内容带行尾空白」的样本（例：`` ```\n甲 \n```\n ``），看它算出来的首部偏移对不对：

- 对 → 在报告里写一句「同形态不存在，实测样本是 X」；
- 不对 → **别顺手改**，停下报告：它属于 3.6 那条路，修法要跟本任务一起过一遍评审。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/markdown/parse.ts tests/unit/markdownParse.test.ts
git commit -F /tmp/wt-msg.txt
```

消息末尾保留 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

---

## Task 4d: `toReact.tsx` —— 行由 `value` 定、光标的接受窗口取节点源码结束

**对应设计：** 第 3.5 节末尾那一段（2026-10-15 第三轮补）。

**为什么排在 4c 之后：** 它读的是 4c 修好的那张表。

**背景（实测，两个夹具各扫过一遍）：** 两件事凑成一个症状——容器里的光标在**行前缀**上掉出块外。

**其一：表比 `value` 少一行。** `clip` 的 `sliceByLineStarts` 把末行那个**换行**算进了 revealed（`hi = srcStart + lineLen + 1`），于是切出来的 `value` 会多出一个**空行**；而表只有「起点 < 揭示偏移」的那几行的行起点。实测（6 个夹具 × 每个 `to`）：

```
'> 引用甲\n> 引用乙\n'  to=6:  value='引用甲\n'  表=[2]      value 2 行、表 1 个数
'> 甲\n> 乙\n> 丙\n'    to=8:  value='甲\n乙\n'   表=[2,6]    value 3 行、表 2 个数
```

**多出来的那一行恒为空行**（评审与我的两份扫描都只见到这一种）。而 `rowsOf` 的注释写着「切后的 `value` 有几行，表就有几个数」——**这句是假的**，得改。

**其二：接受窗口的上界取「末行内容的结束」，接不住行前缀。** 逐行表只收「起点 < 揭示偏移」的行；而前缀（`> `、续行缩进）的偏移比它所属那一行的**内容起点**还靠前，于是那几个偏移位**不属于表里任何一行**。`at` 落在那里时一个节点都接不住，走到 `renderMarkdown` 末尾的兜底 → **光标跳到篇末**（实测：`'> 引用甲\n> 引用乙\n'` 的 6/7/8，`'- 甲甲甲\n  乙乙乙\n'` 的 6/7/8，`'> <b>x</b>甲一\n> 乙二\n'` 的 7/8/9 与 13/14/15）。这三个夹具在 `12fac2d` 上那几格**在块内**（旧版拿「顺带显示未揭示的字」换的），所以这是回归。**评审另量到两处：它的坏区逐偏移集合在修前修后各有一半，净变化是各多 1、1、2 个位置。**

**顺手否掉一个看着显然的修法**（评审实测）：把上界写成 `last.src + last.len + 1`（把那个换行算进去）**不够**——**坏格子的宽度是「下一行前缀宽度 + 1」**：末行内容之后那一格是换行，再往后是整段前缀（引用块 `> ` 是 2 格、列表续行对齐缩进也是 2 格）。实测掉出集合只各减一个（`6` 修好了、`7`、`8` 还在）。所以上界要取**节点源码的结束偏移**。

**评审另一版原型差了一格，本任务的做法正好补上**：它那版只改上界、夹法仍是 `Math.min(at - row.src, row.len)`，落点是 `'引用甲'` 之后、**尾随换行之前**（value 下标 3）；而 `pre` 是 `white-space: pre-wrap`，那一格在代码块里是一个**可见的行高**。本任务的「行由 `value` 定」会让那个空行成为一行真实的 row（`min(…, 0) = 0`），落点自然是 `value.length`（下标 4）。

**Files:**
- Modify: `src/renderer/src/markdown/toReact.tsx`（`rowsOf` 与 `caretIndexIn` 两个函数，连它们上面的注释）
- Modify: `tests/unit/markdownToReact.test.tsx`

- [ ] **Step 1: 写失败的测试**

`tests/unit/markdownToReact.test.tsx`，加在「光标的落点（真管线）」那个 `describe` 里的最后一条之后（`at(...)` 辅助函数就在同一个 `describe` 里）：

```ts
  /**
   * 揭示偏移落在**下一行还没开始、而它的行前缀已经揭示**的那几个偏移位上（设计 3.5 第三轮）。
   *
   * 【为什么这几格会掉出去】`clip` 的逐行表只收「起点 < 揭示偏移」的行，而前缀（`> `、续行
   * 缩进）的偏移比它所属那一行的**内容起点**还靠前——于是那几个偏移位不属于表里任何一行。
   * 接受窗口的上界若取「末行内容结束」，它们就一个节点都接不住，光标掉到篇末。
   * （把上界写成「末行内容结束 + 1」也不够：中间还隔着 `> ` 那两个字符。）
   *
   * 【为什么这几格非修不可】隐形输入框与输入法候选框都按这个坐标摆：光标从引用块里跳出去，
   * 候选框跟着跳。它与用户报的「光标不在代码块里面」是同一个缺陷类，只是粒度更细。
   */
  it('引用块：揭示偏移落在第二行的 `> ` 上，光标不出块', () => {
    const SRC = '> 引用甲\n> 引用乙\n'
    for (const to of [6, 7, 8]) {
      const c = at(SRC, to)
      const carets = c.querySelectorAll('[data-testid="caret"]')
      // 【「恰好一个」不是顺手写的】置位闸（`caret.placed`）与 `caretBefore` 的让路判据
      // 共用 `caretIndexIn`；上界一放宽，两条路若不同步就会**各插一个**，而多出来的那个
      // 谁都不报错。本批次已经栽过一次（组件惰性求值 → 81 个偏移位上双光标）。
      expect(carets, `to=${to} 光标数不对`).toHaveLength(1)
      const caret = carets[0] as HTMLElement
      expect(caret.closest('blockquote'), `to=${to} 掉出引用块`).not.toBeNull()
      expect(caret.closest('p'), `to=${to} 掉出段落`).not.toBeNull()
      // 已揭示文字的**末尾**（`'引用甲\n'` 之后）——与「没有逐行表」那条路给同一个数
      expect(caret.previousSibling?.textContent, `to=${to} 落点不是已揭示文字的末尾`).toBe('引用甲\n')
    }
  })

  it('多行列表项：同样的偏移位同样不出列表项', () => {
    const SRC = '- 甲甲甲\n  乙乙乙\n'
    for (const to of [6, 7, 8]) {
      const c = at(SRC, to)
      const carets = c.querySelectorAll('[data-testid="caret"]')
      expect(carets, `to=${to} 光标数不对`).toHaveLength(1)
      expect(carets[0].closest('li'), `to=${to} 掉出列表项`).not.toBeNull()
    }
  })

  it('引用块 + 行内 HTML：前缀上的偏移同样不出容器', () => {
    const SRC = '> <b>x</b>甲一\n> 乙二\n'
    for (const to of [7, 8, 9, 13, 14, 15]) {
      const c = at(SRC, to)
      const carets = c.querySelectorAll('[data-testid="caret"]')
      expect(carets, `to=${to} 光标数不对`).toHaveLength(1)
      expect(carets[0].closest('blockquote'), `to=${to} 掉出引用块`).not.toBeNull()
    }
  })
```

- [ ] **Step 2: 跑测试，确认它们红**

Run: `pnpm vitest run tests/unit/markdownToReact.test.tsx`

预期：上面三条**全红**，红的理由必须是「掉出块 / 掉出列表项」。全仓其余用例一条都不动。

**红不出来就停下报告**：先自己逐偏移扫一遍这三个夹具，把实测落点写进报告，别改断言去凑。

- [ ] **Step 3: 改 `rowsOf` 与 `caretIndexIn`（两个函数，连注释）**

`rowsOf`：**行数由 `value` 定，表只供 `src`**（表可能比 `value` 少一行——末行那个换行算进 revealed 之后 `value` 会多出一个空行）。多出来的那一行用「上一行的起点 + 上一行长度 + 1」兜，它按构造恒为空行，所以这个兜法只影响判据的落点、不影响内容。

```ts
 *
 * 【行数由 `value` 定，**不是**由表长定】这两者会差一行：`clip` 把末行那个换行也算进
 * revealed，于是切出来的 `value` 会多出一个**空行**，而表里只有「起点 < 揭示偏移」的那几行
 * 的起点（实测 `'> 引用甲\n> 引用乙\n'` 在 `to=6` 上是 `value='引用甲\n'`、表 `[2]`）。
 * 差出来的那一行恒为空行，用「上一行起点 + 上一行长度 + 1」兜即可——它的**长度是 0**，
 * 所以这个兜法不会把任何字符划给它。
 *
 * 【空表当没有表】`parse.ts` 不会挂空表（空数组被判为「连续」），但手工造的树上可能出现；
 * 走空表会拿到不存在的 `rows[0]`。
 *
 * 【同一件事有三处实现，别只改一处】「沿 `value` 的 `\n` 走行、每行进 `lineLen + 1`」这个
 * 循环在这里、`parse.ts` 的 `isContiguous`、`clip.ts` 的 `sliceByLineStarts` 各写了一份——
 * 用途不同（摊成行 / 判连续性 / 求窗口），所以**不合并**，但**行尾口径三份不一样**：这里的
 * 行长**不含**换行（`base = nl + 1` 才进下一行），`isContiguous` 把换行**算给上一行**，
 * `sliceByLineStarts` 用 `+ 1` 把换行**括进窗口**。动任何一处之前先把三处对一遍。
 */
function rowsOf(node: MdNode, value: string, origin: number): Row[] {
  const starts = lineStartsOf(node)
  if (starts === null || starts.length === 0) return [{ base: 0, len: value.length, src: origin }]
  const rows: Row[] = []
  let base = 0
  for (let i = 0; ; i++) {
    const nl = value.indexOf('\n', base)
    const len = (nl < 0 ? value.length : nl) - base
    const prev = rows[rows.length - 1]
    rows.push({ base, len, src: starts[i] ?? (prev ? prev.src + prev.len + 1 : origin) })
    if (nl < 0) break
    base = nl + 1
  }
  return rows
}
```

`caretIndexIn`：**上界取节点源码的结束偏移**（末行内容之后到节点结束之间只剩语法——尾随换行、下一行还没揭示的行前缀）。上面那段长注释保留原样，只在末尾追加一段：

```ts
 * 【上界取**节点源码的结束**，不是末行内容的结束】末行内容之后到节点结束之间只剩语法：
 * 尾随换行，以及**下一行还没揭示的行前缀**（引用块的 `> `、列表项的续行缩进）。逐行表只收
 * 「起点小于揭示偏移」的行，而前缀的偏移比它所属那一行的内容起点还靠前，所以那几个偏移位
 * 不属于表里任何一行；上界若取末行内容结束，它们就一个节点都接不住，光标掉出块外
 * （实测 `'> 引用甲\n> 引用乙\n'` 的 6、7、8 三格从块内跳到篇末）。
 * **「末行内容结束 + 1」不够**（评审实测）：中间还隔着 `> ` 那两个字符，掉出集合只各减一个。
 */
function caretIndexIn(node: MdNode, at: number): { value: string; index: number } | null {
  if (node.type !== 'text' && node.type !== 'code' && node.type !== 'inlineCode') return null
  const value = node.value
  const rows = rowsOf(node, value, originOf(node))
  const last = rows[rows.length - 1]
  // 【`Math.max` 那一下是防位置失真】正常情形 `position.end` 一定不小于末行内容结束；
  // 手工造的树或者位置缺失时退回 `contentEnd`，判据不因此放宽。
  const contentEnd = last.src + last.len
  const upper = Math.max(node.position?.end.offset ?? contentEnd, contentEnd)
  if (at < rows[0].src || at > upper) return null
  let index = 0
  for (const row of rows) {
    if (at < row.src) break
    index = row.base + Math.min(at - row.src, row.len)
  }
  return { value, index }
}
```

**其余一个字节不改。**

- [ ] **Step 3b: `renderAll` 的 text/html token 串 —— 第三处机制（**计划原先漏了，落地时补上的**）**

**为什么有这一步**（规格评审复核过）：只做 Step 3 那两处，**本任务 Step 1 的第三条用例（`'> <b>x</b>甲一\n> 乙二\n'` 的 `7、8、9`）仍然红**——实测 `to=7` 时 `caret.closest('blockquote')` 仍是 `null`。也就是说 Step 3 与 Step 1 **自相矛盾**。

机制：`clip` 对 html 是「**等整个抽完才留**」，`to = 7/8/9` 时 `</b>`（源码 `[6,10)`）被整条丢掉，树上留下一段**没有节点的缝**；缝后面那个空文本节点起点是 10，被 `caretIndexIn` 的下界挡掉。所以这三格**不是**「落在行前缀上」（那是 `13/14/15`，那三格 Step 3 改得对）。

**补法**：设计 3.5 末尾那段本来就有这一条——「连续的 text / html 会被合并成一段 token 流渲染……光标落在这段里时放在**这一段的末尾**」，也就是规则二（「整个在揭示偏移之后的节点 → 光标插在它前面」）在这一串上的实现。落点取**串尾**是对的：被丢掉的字符不上屏、缝后面的节点又都被渲染成空，所以「串尾」与「插在它前面」是**同一个 DOM 位置**。

**为什么它不是「另立口径」**（评审的判据 1）：起点 ≥ `at` 的节点必然渲染为空（text 被 `clip` 切成空串、html 因 `end > start ≥ at` 被整条丢掉），所以插在它们前面与放在串尾落在同一处。

**评审另外逐偏移验过三件事**（18 份夹具 × 每个偏移 + 200 份定种子随机文档 × 每个偏移 = 1988 格）：**多光标 0、一个都没有 0、光标成为 `<tr>`/`<table>` 直接子节点 0**；把这一条**单独撤掉**再逐格比对，**63 处全是「篇末兜底 → 进入块内」，没有一处「块内 → 别处」**；4d 整体相对之前 **introduced 0 / removed 92**。

- [ ] **Step 4: 跑测试，确认它绿**

Run: `pnpm vitest run tests/unit/markdownToReact.test.tsx` → PASS
Run: `pnpm test` → **exit 0**；Run: `pnpm typecheck` → exit 0

- [ ] **Step 5: 变异验证（三条，各自单独做）**

**先写下预期**再回退：

- 甲：把 `caretIndexIn` 的 `const upper = Math.max(...)` 换回 `const upper = contentEnd` → 预测红的是**本次新加的三条**，理由是「掉出块 / 掉出列表项」。
- 乙：把 `rowsOf` 改回「按表长出行」（`for (const src of starts)` 那一版）→ 预测红的是**新加的第一条**（`previousSibling` 断言 `'引用甲\n'` 会变成 `'引用甲'`，差的就是那个换行算出来的空行）。**这一条如果只红一条，就把实测写清**——它同时说明另外两条夹具走不到那一格。
- 丙：把 `holdsCaret` **换回 4b 之前那一版**——即 `git show 512b07c -- src/renderer/src/markdown/toReact.tsx` 里被删掉的那几行（**带类型闸与下界的那版**）→ 预测**绿**：它是**行为等价**的变异，覆盖缺口仍在（`holdsCaret` 那三条新用例与它无关，红的是既有那条表格用例）。

  **⚠️ 这一条计划原先引错了**（规格评审实测推翻）：我原来引的那句 `return ctx.caret !== null && originOf(node) + (node.value?.length ?? 0) >= ctx.caret.at` **同时丢了两样东西**——类型闸（`text`/`code`/`inlineCode` 之外直接 false）与**下界**（`origin <= caret.at`）。丢了这两样之后，**容器与「起点在揭示偏移之后」的值节点都自称接住了光标**，把 `caretBefore` 的规则二堵死，于是**三个提交上都会红**（`512b07c` / `03ec224` / `0673f6b` 各 1 failed）。实测机制（`at(TABLE, 4)`）：第二个表头格的文字节点 `origin = 6 > at = 4`，在变异版里自称接住 → `caretBefore` 让路 → 没人放光标 → 掉到 `</table>` 之后。

  **所以「同一变异只在一个提交上红」这个前提本身不成立**：`512b07c` 与 `03ec224` 的 `holdsCaret` / `caretIndexIn` **逐字节相同**（评审 diff 过）——红不红取决于**那句变异怎么写**，与提交无关。

红得比预期多或少都要查清楚再往下走；每条都要指名道姓地报出「红的是哪一条、理由是什么」。**丙若一条都不红，别改断言去凑**——在报告里写清「`holdsCaret` 的覆盖缺口仍在」与实测落点。

- [ ] **Step 6: 重测兜底那一格，把 `renderMarkdown` 上面那段注释改准**

`renderMarkdown` 里「一个都没命中就退回老位置」那段注释**逐条列了实测落点**（表格 `to=38–41` 与 `44`、代码块 `to=10–14`、纯文字 `'甲乙丙\n'` 的 `to=4` 等）。本任务放宽了上界，**这些数字大概率已经不对了**。

**别照抄那几个数、也别照抄这段文字**：自己把同一批夹具逐偏移扫一遍（夹具就是这段注释与 `markdownToReact.test.tsx` 里已有的那些），把**兜底仍然开火**的偏移位重列一遍，按实测改注释。判据不变：**兜底不该在文档中间开火**——扫出来若仍有块中间的位置走兜底，那是缺陷，停下报告。

**评审已经量过一遍，可以拿来对照**（它用的是「末尾多一个 `尾段`」的夹具，判据是「光标是不是容器最后一个子节点」）：修对之后三个夹具剩下的兜底**只有 `to=0` 与文档末尾那两格**——引用块 `0, 12, 13, 16`、列表项 `0, 10, 11, 14`、引用里的围栏 `0, 20, 21, 24`。**与 `12fac2d` 的关系是「真子集」不是「一致」**（实施者与评审各自复算过：`12fac2d` 是**超集**——引用 `0,10,11,12,13,16`、列表 `0,8,9,10,11,14`、围栏 `0,12–21,24`；多出来的是它「按字符数硬减」那套老坐标留下的）。你扫出来的若比它多，就是还没修干净。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/markdown/toReact.tsx tests/unit/markdownToReact.test.tsx
git commit -F /tmp/wt-msg.txt
```

消息末尾保留 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Task 4e: 收口 —— 两条零覆盖的守卫、一句说谎的注释、两处读口对齐

**对应设计：** 没有新的设计条目——它守的都是已经定下的口径（3.6.1 的表、3.5 的光标、3.6 的 `wtValueStart`）。

**为什么排在 4d 之后：** 它只动测试与注释，**在基线 `512b07c` 上就是绿的**，本可以随时做；它与 4c/4d 改的文件也不重叠。排在后面**唯一的原因是不并发写**（两个写者同时 `git commit` 会把对方暂存的东西带进去——本仓库栽过）。

**由来：** Task 4b 的质量评审查出两条**可达、会改变可见行为、却零覆盖**的守卫（整条回退，全仓 573 条仍绿），外加一句与实际不符的注释。

| 变异 | 位置 | 行为差异（评审实测） |
|---|---|---|
| **M2** 去掉空窗口守卫（`revealed = r.starts.length > 0 ? r.starts : null` 改回 `revealed = r.starts`） | `clip.ts:224` | `'> ```\n> 甲\n> 乙\n> ```\n'` 的 `to=2`：光标从 `BLOCKQUOTE` 落进 `BLOCKQUOTE>PRE>CODE`（`shiftedStart` 取 `[][0]` 成 `undefined`，退回 `position.start`） |
| **M8** 去掉 `else delete kept[WT_LINE_STARTS]` | `clip.ts:244` | `'甲 \n乙\n'` 的 `to=1`：光标从根节点挪进 `<p>`（解析期那张**整条 `value`** 的表被留下） |

**Files:**
- Modify: `tests/unit/markdownClip.test.ts`（补一个 `describe` + 改两句注释）
- Modify: `src/renderer/src/markdown/parse.ts`（`lineStartsOf` 加 `Number.isFinite`）
- Modify: `tests/unit/markdownParse.test.ts`（给上面那条加用例）
- Modify: `src/renderer/src/markdown/clip.ts`、`src/renderer/src/markdown/toReact.tsx`（各补一句交叉引用注释）

- [ ] **Step 1: 补「空窗口那一格」的用例**

`tests/unit/markdownClip.test.ts` 末尾（紧接「clipTree —— 容器里的文字按行切」那个 `describe` 之后）。先加一个小助手（本文件里没有就加，**别改别处**）：

```ts
/** 树里第一个 `code` 节点（深度优先）。 */
function findCode(node: unknown): { value: string } | null {
  const n = node as { type?: string; children?: unknown[] } | null
  if (!n || typeof n !== 'object') return null
  if (n.type === 'code') return n as { value: string }
  for (const child of n.children ?? []) {
    const hit = findCode(child)
    if (hit) return hit
  }
  return null
}
```

再加这个 `describe`：

```ts
/**
 * 「空窗口那一格」：`value` 为 `''` 且窗口跟**任何一行都没相交**时，
 * 起点退回节点自己的 `position.start`（围栏之后那个内容起点 8）、**且不许挂表**。
 *
 * 【为什么单钉这一格】两条活着的路（本来没有表 / 空窗口）都该给「没有表」；
 * 挂一张空表、或者把解析期那张**整条 value** 的表原样留下，都是错的，而且都不出声。
 * 【断言为什么写成 `[to, 值]`】红的时候要一眼看出**是哪一格**红的。
 */
describe('空窗口那一格', () => {
  const SRC = '> ```\n> 甲\n> 乙\n> ```\n'

  it('起点退回 8（围栏之后那个内容起点）', () => {
    for (const to of [1, 2, 3, 4, 5, 6, 7]) {
      const code = findCode(clipTree(parseMarkdown(SRC)!, 0, to))!
      expect([to, code.value]).toEqual([to, ''])
      expect([to, valueStartOf(code)]).toEqual([to, 8])
    }
  })

  it('不许挂表', () => {
    for (const to of [1, 2, 3, 4, 5, 6, 7]) {
      const code = findCode(clipTree(parseMarkdown(SRC)!, 0, to))!
      expect([to, lineStartsOf(code)]).toEqual([to, null])
    }
  })
})
```

- [ ] **Step 2: 跑测试，确认它**绿**

Run: `pnpm vitest run tests/unit/markdownClip.test.ts` → **全绿**。

**这一条与前面几个 Task 相反**：它守的是**既有行为**，所以要的是「补上之后照样绿」。**它红了说明你对这两条守卫的理解错了**——停下报告，把实测的 `value` / `wtValueStart` / 表列出来，别改断言。

- [ ] **Step 3: 变异验证（两条，各自单独做）**

**先写下预期**再回退（预期来自评审实测，你要复现它）：

- M2：`clip.ts:224` 的 `revealed = r.starts.length > 0 ? r.starts : null` 改回 `revealed = r.starts` → 预测**两条都红**：第一条红在 `expected [ 1, null ] to deeply equal [ 1, 8 ]`，第二条红在 `expected [ 1, [] ] to deeply equal [ 1, null ]`。
- M8：`clip.ts:244` 的 `else delete kept[WT_LINE_STARTS]` 删掉 → 预测**只红第二条**：`expected [ 1, [ 8, 12 ] ] to deeply equal [ 1, null ]`，第一条仍绿。

红得与预期不符就查清楚再往下走。

- [ ] **Step 4: 把那两句说谎的注释改准**

`tests/unit/markdownClip.test.ts:357-358` 现在写着「**修之前这里的每一条都是错的**，而且方向是提前」。评审把这四条用例原样搬到 `12fac2d` 上跑：**四条里三条是绿的**，只有「光标走到第二行中间」那条红（`expect(textOf(out)).toBe('引用甲\n引')` 实收 `'引用甲\n引用乙'`）。

为什么那三条修前就绿：它们的窗口要么整个落在**第一行之内**（`to=5`），要么把**整条 `value`** 都包住（`to=6`、`from=3,to=12`）——这两种情形下「常量原点 + 字符数」本来就是精确的（那是 Task 1/2 的成果）。唯一红的那条是**唯一一条窗口切在两行之间**的。

把话说成：**四条里只有「光标走到第二行中间」在守逐行；另外三条守的是别的东西（第一行恒精确、`from` 一侧也按行算），修前就是绿的。**

- [ ] **Step 4b: 把 Task 4c 那条用例的右半边改准，并补重复行的夹具**

Task 4c 的 Step 1 给了一条**假判据**（实施者量出来的）：右半边 `src.lastIndexOf(line, src.length)` 是**全源码**查找，只有当每行文字在整篇源码里**唯一**时才等于真值。四个夹具恰好各行唯一，所以交付时是绿的——但谁加一条**两行文字相同**的夹具，它就会把**对的实现判成红的**。反例（实现与按行界住的真值一致，错的是断言那半边）：

| 夹具 | 实现 | 按行界住的真值 | 假判据给的 |
|---|---|---|---|
| `'> 甲 \n> 甲\n'` | `[2, 7]` | `[2, 7]` | `[7, 7]` |
| `'甲 \n甲\n'` | `[0, 3]` | `[0, 3]` | `[3, 3]` |
| `'甲 \n乙\n\n甲\n'` | `[0, 3]` | `[0, 3]` | `[6, 3]` |
| `'> 甲 \n> 乙\n> 乙\n'` | `[2, 7, 11]` | `[2, 7, 11]` | `[2, 11, 11]` |

改法：右半边**按行界住**（先按 `\n` 切出源码行，第 k 行文字在**第 k 行源码**里找，行起点由前面各行长度累加），即把 Task 4c Step 1 里已经改好的那版照过来；再**补上表里这四条夹具**（含两条重复行的）。

**验收**：补进来之后**必须绿**；再跑**两条**变异：

- **变异己**：把实现的回验整段换成**断言右半边本身**（`out.push(source.lastIndexOf(line, source.length))`）→ **这四条必须红**。（规格评审量过：在只有原来那四条夹具时，这一刀的区分度是 **0**，全仓唯一被它拦下的是一条**无关的**老板键用例。补上重复行夹具才有区分度——这就是本步存在的理由。）
- **变异庚**：把回验改回旧版 `lineEnd - line.length` → 这四条也要红。

红的条数比预期多或少都要查清楚，别改断言去凑。

- [ ] **Step 5: `lineStartsOf` 与 `valueStartOf` 的口径对齐**

`valueStartOf`（`parse.ts:52`）明写「不是有限数一律 `null`」并用 `Number.isFinite` 挡；`lineStartsOf`（`parse.ts:195`）只查 `typeof n === 'number'`，`NaN` / `Infinity` 会原样当行起点。今天上游产不出这种值（所以整条回退也不红），但**两个兄弟读口一个严一个松**，下一个人按 `valueStartOf` 的注释去理解 `lineStartsOf` 就会踩。

改成 `raw.every((n) => typeof n === 'number' && Number.isFinite(n))`，并在 `tests/unit/markdownParse.test.ts` 补一条用例把 `NaN` / `Infinity` 挡在门外（手工造节点即可，**别走真管线**——真管线今天产不出这种值）。

- [ ] **Step 6: 三处「沿 `value` 走行」补交叉引用注释**

`isContiguous`（`parse.ts:226`）、`sliceByLineStarts`（`clip.ts:110`）、`rowsOf`（`toReact.tsx`）各写了一份「沿 `value` 的 `\n` 走行、累加 `lineLen + 1`」的循环，而**行尾口径三份不同**：`isContiguous` 把换行算给上一行、`sliceByLineStarts` 用 `+ 1` 把换行括进窗口、`rowsOf` 的行长不含换行。第 4 轮那个「表比 `value` 少一行」正是这三份走样的产物。

**不合并**（三份的用途不同，合了反而更难读），只在**每一份的注释里加一句**指名另外两处、并点明行尾口径的差别。写清楚「这个量有三处算法」就是这一步的全部目的。

- [ ] **Step 7: 跑门禁并提交**

Run: `pnpm test` → **exit 0**；Run: `pnpm typecheck` → exit 0

```bash
git add tests/unit/markdownClip.test.ts tests/unit/markdownParse.test.ts src/renderer/src/markdown/parse.ts src/renderer/src/markdown/clip.ts src/renderer/src/markdown/toReact.tsx
git commit -F /tmp/wt-msg.txt
```

消息末尾保留 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Task 4f: 退路的方向 —— 摘表会让未揭示的字上屏

**对应设计：** 3.6.1 的「第四轮」那一段。

**为什么排在这里：** 4c 交付的那条退路（「回验对不上就**不挂表**」）我把它定性成「少精确一处」，**规格评审实测它是「提前」**——不挂表之后 `clip` 退回按字符数切，而容器节点的裁剪原点是**首行**的内容起点，于是从第二行起**每一行的前缀宽度都变成提前量**，**未揭示的字上屏**。这是核心不变量（不显示任何未揭示的字符）被破，不是精度问题。

**实测（评审，10 个转义/实体夹具逐偏移扫）**：夹具 `'> 甲 &amp; 乙\n> 丙\n'`（`丙` 在源码偏移 14）：

| to | 4c（摘表） | 真值 | 提案 |
|---|---|---|---|
| 6 | `"甲 & "` ← **泄漏** | `"甲"` | `""` |
| 9 | `"甲 & 乙\n丙"` ← **泄漏** | `"甲 &"` | `"甲 &"` |
| 12 | `"甲 & 乙\n丙"` ← **泄漏** | `"甲 & 乙\n"` | `"甲 & 乙\n"` |

泄漏计数（判据是「屏幕上显示的整段文字能不能在 `src[0, to)` 里**按序匹配**出来」，不依赖人眼）：**4c 79 格 → 提案 0 格**。触发条件是**回验失败**：`value` 与源码不是逐字相同（HTML 实体 `&amp;`、反斜杠转义 `\*`），或该行文字**在文档前文出现过**。

**修法**：回验失败时**不摘表**，退回那个**恒不提前**的保守算式 `lineEnd - line.length`。**只对 `value === ''` 保留不挂表**（第三轮那条：空值没有内容可泄漏）。

**「恒不提前」可证**（评审用一支不复用 `buildLineStarts` 任何逻辑的**独立对齐器**在 42808 行上验过，**违例 0**）：`value` 行是源码某连续片段的解码结果——剥前缀是把片段起点**右移**，剥行尾空白与解码只让它**更短**——所以 `line.length <= 该行源码内容长度`，于是 `lineEnd - line.length >= 真实内容起点`。

**代价要说清楚**：**左端晚**。那一行的首字晚若干个按键上屏，晚的格数**等于该行记号的超出量**（`&amp;` 是 4、`\*` 是 1、`&nbsp;` 是 5），`to` 够大之后就与真值逐格一致。**两害相权：晚是「少显示」，提前是「多显示」——后者破不变量。**

**Files:**
- Modify: `src/renderer/src/markdown/parse.ts`（`buildLineStarts` 的失败分支 + 两句将成假话的注释）
- Modify: `tests/unit/markdownParse.test.ts`（泄漏探测器）
- Modify: `src/renderer/src/markdown/toReact.tsx`（**只在 Step 6 动**：光标接受窗口的**下界**）
- Modify: `tests/unit/markdownToReact.test.tsx`

- [ ] **Step 1: 写失败的测试（泄漏探测器）**

`tests/unit/markdownParse.test.ts` 追加一个 `describe`。**判据不许写死数字**——用「显示出来的文字能在已揭示的源码里按序匹配出来」这条性质：

```ts
/**
 * 回验失败的那一类（实体、转义、重复文字）**不许把未揭示的字上屏**（设计 3.6.1 第四轮）。
 *
 * 【判据为什么长这样】摘表之后 `clip` 退回按字符数切，而裁剪原点是**首行**的内容起点，
 * 于是从第二行起每一行的前缀宽度都变成**提前量**——屏幕上会出现还没揭示的字。
 * 这里不写死期望串，而是问一条性质：**显示出来的整段文字，能不能在 `src[0, to)` 里
 * 按序匹配出来**（跳过记号后的源码）。匹配不上就是泄漏。
 *
 * 【为什么这几条夹具】`&amp;` / `\*` / `&nbsp;` 这些让 `lastIndexOf` 回验失败；都是**多行**的
 * ——单行节点的裁剪原点是自己的起点，摘不摘表都一样，测不出这条。
 * 【重复行那两条走不到失败分支】`'> 甲\n> 甲\n'` 实测**回验命中**（搜索已按行界住，4d 修过），
 * 挂表 `[2,6]`、**不碰失败分支**——留着无害（顺带钉住重复行），但别当它是失败分支的覆盖。
 */
describe('回验失败时的退路 —— 不许泄漏未揭示的字', () => {
  const FIXTURES = [
    '> 甲 &amp; 乙\n> 丙\n',
    '> 甲 \\* 乙\n> 丙\n',
    '> 甲 &nbsp; 乙\n> 丙\n',
    '> 甲\n> 甲\n',
    '> 甲 \\_ 乙\n> 丙\n',
    '> 甲 &lt; 乙\n> 丙\n'
  ]

  it('逐偏移：屏幕上的文字必须在已揭示范围内按序匹配得上', () => {
    for (const src of FIXTURES) {
      for (let to = 1; to <= src.length; to++) {
        const out = renderVisible(src, to)
        expect([src, to, leaked(src, to, out)]).toEqual([src, to, false])
      }
    }
  })
})
```

**⚠️ 判据按字面写会「把正确的实现判成泄漏」**（落地时实测）：源码里的实体与反斜杠转义**要先解回来**再匹配，否则 `&nbsp;`（源码六个 ASCII 字节对 value 一个 U+00A0）这类**正确的实现也会被判红**——实测修后仍有 **16 格**这种假阳性。落地时加了一步解码（`decodeMarks`），**判据方向不变**，并把这 16 格逐格说明写进了报告。

`renderVisible(src, to)` 走**真管线**（`parseMarkdown` → `clipTree` → 取所有带 `value` 的节点拼出屏幕上那段文字，或直接 `renderMarkdown` 后取 `textContent`）；`leaked(...)` 是那条性质判据（把显示的文字按序在 `src.slice(0, to)` 里贪心匹配）。两个助手都写在本文件里，**够用即可，别为它们写更多机制**。

- [ ] **Step 2: 跑测试，确认它红**

Run: `pnpm vitest run tests/unit/markdownParse.test.ts`

预期：**每条夹具都在中间那些偏移位上红**，且红的理由必须是泄漏（`leaked` 为 `true`）。**先记下你实测的泄漏格数**，报告里给出来——评审量到的是 10 个夹具合计 **79 格**（你这份夹具是它的子集）。

- [ ] **Step 3: 改 `buildLineStarts` 的失败分支 + 两句注释**

失败分支从「返回 `null`」改成「**推入保守算式**」；只有 `value === ''` 仍返回 `null`：

```ts
  const out: number[] = []
  for (const line of lines) {
    const next = source.indexOf('\n', lineStart)
    const lineEnd = next >= 0 && next < end ? next : end
    const at = source.lastIndexOf(line, lineEnd)
    // 【回验对不上时**不摘表**，退回恒不提前的保守算式】(设计 3.6.1 第四轮) 摘表之后
    // `clip` 会退回按字符数切，而裁剪原点是**首行**的内容起点——从第二行起每一行的前缀
    // 宽度都变成**提前量**，屏幕于是显示**还没揭示的字**（实测 10 个转义/实体夹具共 79 格）。
    // `lineEnd - line.length` 恒 >= 真实内容起点：value 行是源码某连续片段的解码结果，
    // 剥前缀把起点右移、剥行尾空白与解码只让它更短（评审用独立对齐器在 42808 行上验过，0 违例）。
    // 代价是那一行的首字**晚**若干按键（晚的格数 = 该行记号的超出量）——**晚是少显示，提前是多显示**。
    if (at >= lineStart && /^[ \t]*$/.test(source.slice(at + line.length, lineEnd))) out.push(at)
    else out.push(lineEnd - line.length)
    lineStart = lineEnd + 1
  }
  return out
```

函数返回类型**仍是 `number[] | null`**（原稿写成「回到 `number[]`」与紧跟的「`value === ''` 仍返回 `null`」自相矛盾；按后者落地——那是唯一能编译的读法）。调用点的 `null` 判断保留。

顺手把那两句将成假话的注释改准：`parse.ts` 里「`null`（回验没找到）与「连续」走同一条退路」与「找不到就不挂表——退回「起点 + 字符数」那条路」。**改法是把它们改成实情**，别只删。

- [ ] **Step 4: 跑测试，确认它绿**

Run: `pnpm vitest run tests/unit/markdownParse.test.ts` → PASS
Run: `pnpm test` → **exit 0**；Run: `pnpm typecheck` → exit 0

**注意用例数**：这一步会让**别的**用例也不动（表的值只在回验失败的行上变），若不减反增或出现意料外的红，查清楚再走。

- [ ] **Step 5: 变异验证（两条，各自单独做）**

- 甲：把失败分支改回 `return null`（也就是 4c 那一版）→ 预测**Step 1 那个 describe 整个红**，红的理由全是泄漏。
- 乙：把保守算式 `lineEnd - line.length` 换成 `lineStart`（该行源码的**起点**，含前缀与行尾空白）→ 预测**同一个 describe 红**。**「红得更早」这个说法不成立**（落地实测、后按正确备份口径重跑复核过）：首个红格与甲**完全相同**（`'> 甲 &amp; 乙\n> 丙\n'` 的 `to=6`，显示 `甲 & `），而总格数**更少**（**28 vs 43**）——方向描述反了。

  **为什么乙反而少 15 格（机制，重跑时量清的）**：乙在**第一行是精确的**——文本节点的 `lineStart` 就是 `position.start`，而容器前缀 `> ` 在它**之前**、不属于这一行；所以乙的「提前」只从**第二行**起（按前缀宽度）。甲的字符算术则从节点原点一路 1:1 推进，**整条尾巴都提前**（那个 `&amp;` 夹具甲漏到 `to=14`、乙在 `12..14` 一格不漏）。逐夹具格数：乙 `6/4/8/0/4/6`、甲 `9/7/11/0/7/9`。

  **结论**：两个方向（退回字符算术 / 把前缀算进起点）**都由同一条用例拦下**，泄漏探测器在「提前」这个方向上**没有缺口**。

- [ ] **Step 6: 光标接受窗口的**左端****——**落地时实测推翻了这一步的前提，结论：不改**

**这一步原本的预测（写在这里当记录，别照它做）**：换成保守算式后，表的第一项会偏晚（`'> 甲\*乙\n> 丙丁\n'` 预测 `[3,9]`、真值 `[2,9]`），于是 `caretIndexIn` 的下界 `rows[0].src` 会把 `to = 2..6` 挡掉，**光标掉出容器**；因此候选修法是把下界改取 `originOf(node)`。

**实测：那几格根本没掉出去**（8 个夹具逐偏移扫，改前 4c 与改后**都在段落内**）。真实形态是：保守起点偏晚 → 那一行当时还没揭示 → **段落是空的、光标落在空段落里、屏幕上一个字都没有**。那是「晚」的代价，**不是**掉出容器。

**机制（比静态看「表的第一项」准）**：有表时 `clip` 只收「窗口与 `[from, to)` 相交」的行 ⇒ `rows[0].src < to`，而真管线里 `caretAt === clip 的 to`；表被摘掉时 `rowsOf` 的退化行 `src` **就是** `originOf(node)`。⇒ **这一步盯的那个形态**（保守表的头几行与 `to` 的关系）下，这个下界开不了火。**别把它推广成「下界在真管线里不可能开火」**——4i 之后，「打着围栏那几格」的守门人正是它（见下面那条补正）。

**所以不改**。证据：候选修法（下界取 `originOf`）**逐格落点完全相同**（8 夹具 × 全部偏移，探针输出逐字节相同）；两条下界变异——改成 `originOf`、以及**把下界整个删掉**——跑全仓 **592 条全绿**。改了就是**死代码**，还会配一句声称它修好了什么的注释。

> **⚠️ 上面这一段在收尾时（2026-10-16，Task 8 Step 4c）按**当前**代码重测后更正过。** 第四轮的写法把**两件事并成了一句**：「这一步盯的形态下界开不了火」与「下界是死代码」不是一回事。三段实测口径（加厚语料 300 篇 / 5261 格逐格差分，探针与输出在 `/tmp/t8-probe/`）：
>
> ① **换成 `originOf(node)` 才逐格字节相同**——0 格差异、全仓 **623 条全绿**。那条候选修法作废，换了等于没换。
> ② **整条删掉并不等价**：全仓**红 3 条**（`markdownToReact.test.tsx` 里 4i 新增的那三条围栏守卫，`40a21d6`）——4f 当时报的「全绿」是真的，但那是因为**那几格的守门人当时还不是这个下界**；逐格差 **61 格 / 跨 49 篇**，方向全是「把光标拉进一个**还没开始**的元素」（`BLOCKQUOTE>SPAN` → `BLOCKQUOTE>PRE>CODE>SPAN`）。
> ③ 第三轮那条接受窗口保护的是「**值节点不抢它前面的光标**」，它看的是**节点自己的 `position.start`**；`rows[0].src` 在空节点 / 围栏节点上**不是同一个数**（4i 正是把左端松开到 `min(内容起点, position.start)`）。
>
> **「全绿」是覆盖事实，不是等价事实**——所以下界留着（4i 之后它**有**覆盖）。

**上界那一侧反而有牙**：把 `upper` 改回 `contentEnd` 会红 **5 条**（含本任务新加的 2 条保守表守卫）。**这条实测要写进新用例的注释里**，免得下一个人把它读成「下界也有覆盖」。

> **⚠️ 同批补正（2026-10-16，Task 8 Step 4c）**：那句「红 5 条」**只对 `31d9813` 成立**（收尾时在那个提交上原样复现过：引用块 / 多行列表项 / 行内 HTML / 保守表两条，五条一个不少）。**当前代码上同一条变异全仓 623 条全绿**——那几格改由 4g 之后新增的兜底路径（`tailTarget` / `isTail`）接住：把末尾兜底连同 `upper` 一起摘掉，那 5 条才重新红起来。**但上界仍然有牙，只是今天没有用例守着它**：同一条变异在加厚语料 300 篇 / 5261 格上逐格差 **9 格**（`inlineCode` 那几格，光标从 `<code>` 里被挪到它**后面**）。

**顺带一条覆盖事实**：接受窗口的**左下界在 4f 当天是零覆盖的**（删掉没有任何用例出声）——**这句只对 4f 那一刻成立**，4i 之后它由那三条围栏守卫看着。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/markdown/parse.ts src/renderer/src/markdown/toReact.tsx tests/unit/markdownParse.test.ts tests/unit/markdownToReact.test.tsx
git commit -F /tmp/wt-msg.txt
```

消息末尾保留 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Task 4g: md 路上的光标在**文档中间**仍会掉到块下方（Task 5 的评审查出来的）

**对应设计：** 3.5（规则二与那条兜底）、文末「第四轮」。

**由来**：Task 5 接线之后，md 路的光标第一次真的由语法树产出。它的规格评审逐格扫出：**「光标在内容里面」在文档中间的若干格不成立**——落点是「最后一个已渲染块**下面一行、左边缘**」，而设计 3.5 写明这个坐标是**隐形输入框与输入法候选框的锚点**，验收清单第 13 条要的正是「都不是掉到那个块的下方」。

**实测（评审，14 份夹具 × 逐偏移 = 230 格，判据「光标是不是 `.wt-page__text` 的最后一个子元素」）**：文档中间开火 **15 格 / 4 种形态**：

| 形态 | 夹具 | 偏移位 |
|---|---|---|
| 列表多项 | `- 甲\n- 乙\n- 丙\n` | **4、8**（每个列表项边界一格）|
| 容器里的代码 | `> ```\n…` | 3、4、5、6、7 |
| 表格尾部 | `\|甲\|乙\|…` | 32–35 |
| 标题正文 | `# 季度汇报…` | 7、8、20、21 |

列表那两格还额外偏了 `.wt-md-list` 的 `padding-left: 2em`（`markdown.css`）——**下一个字要出现的位置的左边 2em、下边约一个 margin**。

**机制（两个口都堵上）**：
1. `clip` 把 `start >= to` 的节点**整块丢掉**，于是设计 3.5 规则二（「整个在揭示偏移之后的节点 → 光标插在它前面」）**对被丢掉的节点永远开不了火**——那些节点根本不在树上；
2. 容器里 `value` 为空、内容起点在 `at` 之后的节点（正在敲的围栏）被接受窗口的**左界**挡掉（`caretIndexIn` 的 `at < rows[0].src`）。
于是走到 `renderMarkdown` 末尾那条兜底，被追加成 `.wt-page__text` 的最后一个子元素 = 块下方。

**`toReact.tsx` 那段兜底注释要一并改准**：它写「实测它走到的时候只有两类…那时内容本来也到头了，位置看不出差别」——**第一类（`to = 0`）成立，第二类不成立**（上面 15 格里内容都还剩很多）。

**候选修法（要实测，别直接信）**：让**还有未揭示子节点**的容器把光标**收在自己内部**——判据是「这个容器的 `position.end.offset > to`（即它还有没揭示的孩子），而它已渲染的孩子都没接住光标」，此时把光标追加在**最后一个已渲染子节点之后**（而不是追加在整篇末尾）。递归地取**最内层**这样的容器。列表那两格于是在 `<ul>` 内、`li[0]` 之后；容器里的围栏那几格进入 `<blockquote>` 内的空 `<pre><code>`。

**Files:**
- Modify: `src/renderer/src/markdown/toReact.tsx`
- Modify: `tests/unit/markdownToReact.test.tsx`
- Modify: `tests/unit/markdownView.test.tsx`（那条用例的判据按下面 Step 3 改）

- [ ] **Step 1: 写失败的测试（先钉住那 4 种形态）**

`tests/unit/markdownToReact.test.tsx` 追加一个 `describe`，走**真管线**（`parseMarkdown` → `clipTree` → `renderMarkdown(…, { caretAt: to })`）：

```ts
/**
 * md 路上的光标**不许掉到块下方**（设计 3.5；Task 5 的评审逐格扫出来的 4 种形态）。
 *
 * 【判据为什么是这条】`clamp` 到「父元素不是 `.wt-page__text` 的最后一个子元素」——
 * 用 `closest('p')` 会**误伤**：正确地待在 `<h1>` / `<li>` / `<td>` / `<pre>` 里的光标
 * 会被判成失败（评审实测 10 格）。
 */
describe('光标不出块（真管线，逐偏移）', () => {
  const FIXTURES = [
    '- 甲\n- 乙\n- 丙\n',
    '> ```\n> 甲\n> 乙\n> ```\n',
    '| 甲 | 乙 |\n| - | - |\n| 1 | 2 |\n',
    '# 季度汇报\n\n正文一行。\n\n又一段。\n'
  ]

  it.each(FIXTURES)('逐偏移：光标都在内容里（%s）', (src) => {
    for (let to = 0; to <= src.length; to++) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]')
      expect(caret, `to=${to} 没有光标`).not.toBeNull()
      expect(caret!.parentElement?.classList.contains('wt-page__text'), `to=${to} 掉到块下方`).toBe(false)
    }
  })
})
```

**`to = 0` 是例外**：树是空的，那时兜底是唯一的位置。若 `to = 0` 红，把它从循环里排除并在注释里写明理由（**别为了让测试绿而放宽判据**——先确认它红在哪一格）。

- [ ] **Step 2: 跑测试，确认它红**

预期：四条全红，红的格数**至少**覆盖评审那份表（列表 4/8、围栏 3–7、表格 32–35、标题正文 7/8/20/21）。**把你实测的红格数与那张表对一遍**，多或少都要在报告里说明。

- [ ] **Step 3: 改那条既有用例的判据（Task 5 自己产出的那条）**

`tests/unit/markdownView.test.tsx` 里「md 那条路：光标恰好一个，且插在内容里面」那条：**判据换成「父元素不是 `.wt-page__text` 的最后一个子元素」**（或「父元素是 `p/li/td/th/pre/h1..h6` 之一」），**并把它测的偏移从只有一格扩成逐偏移**（评审实测：同一份 DOC 的 7/8/20/21/30 五格上，原断言不成立；而 1–6、22、23、31、32 十格是它**误伤**）。

- [ ] **Step 4: 改 `toReact.tsx`（候选修法，落地时按实测调整）**

按上面那条候选规则改；**先把要改的那段注释读一遍**，改完把「只有两类」那句改成实测口径。

- [ ] **Step 5: 跑测试，确认它绿**

Run: `pnpm vitest run tests/unit/markdownToReact.test.tsx tests/unit/markdownView.test.tsx` → PASS
Run: `pnpm test` → **exit 0**；Run: `pnpm typecheck` → exit 0

**另外必须回归的两条**（设计 3.5 里量出来的老账，别修一个新的坏一个旧的）：
1. 「值节点不抢它前面的光标」——表格里那串空单元格文字节点把光标接走那个形态（**实测过连续 13 个偏移位**）；
2. 「未揭示的占位之前」——表格/代码块占位那几格光标落在**占位之前**。

- [ ] **Step 6: 变异验证（两条，各自单独做）**

- 甲：把你新加的「容器收留光标」那一段**关掉**（回到只走末尾兜底）→ 预测 Step 1 那四条全红，红格数与 Step 2 实测的相同。
- 乙：把判据写成「父元素不是 `.wt-page__text` 的最后一个子元素」**之外**再收紧成 `closest('p')` → 预测**误伤**那 10 格（`<h1>`/`<li>` 里的），即同样的输入下用例变红——**这条用来证明判据换对了**。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/markdown/toReact.tsx tests/unit/markdownToReact.test.tsx tests/unit/markdownView.test.tsx
git commit -F /tmp/wt-msg-task4g.txt
```

## Task 4i: 打着围栏时，光标要**在框里**（不是框下方）

**对应设计：** 3.5（规则二与「占位之前」那条——**「进框」同样满足它**，框本来就在占位前面）。

**由来**：Task 4g 把「光标掉到块下方」修掉之后，剩下 **118 格**是「**代码块里还有没揭示的行**」那一类：4g 按设计 3.5 的「占位之前」把光标留在**框外、紧挨占位**，而**用户最初报的正是这一类**——原话「代码块的问题是光标不在代码块里面而是在代码块下面」。两条位置都满足「在占位之前」，区别只是「框内第一行」还是「框外、占位之前」。

**实测（Task 4g 的实施者，同一加厚语料 300 篇 / 5261 格）**：

| 变体 | 「光标是容器最后一个子元素且后面还有内容」|
|---|---|
| 基线 `31d9813` | 1087 |
| 窄修法 `min(rows[0].src, node.position.start)` | 816 |
| 4g 落地版（容器收留） | **397** |
| 4g + 窄修法 | **397**（计数不再降，但**逐格 DOM 签名差 118 格**）|

⇒ **`397 = 397` 不是等价**：那 118 格正是本任务要动的格子（4g 在框外、窄修法在框内）。计数看不见它们。

**窄修法的安全性（规格评审早先量过）**：全仓 592/592 绿；**0 格原本在 `CODE` 内被挪出**；加厚表格语料（表头带空格、空单元格、两行表头、多行表体）**逐格 0 差异**；结构上它只对「`position` 从定界符起算」的 `code` 类节点生效（`text` 节点的 `position.start` 就是内容起点，`min()` 是恒等）——这解释了表格为什么一格没动。

**判据（为什么这一版是对的那一版）**：`lower = Math.min(rows[0].src, node.position?.start.offset ?? rows[0].src)` —— 它把下界从「内容起点」松开到「**节点自己的源码起点**」，也就是「**这个节点已经开始了**就允许它接住光标」。`at = 1` 而 `code.position.start = 2` 时仍然拒绝（规则二：整个在揭示偏移之后的节点 → 光标插在它前面）✓ 与设计 3.5 不冲突。

**表头那句括注要紧**（落地实测）：这张表的目标列是「**4g + 本任务**」的结果。窄修法**单独**作用于基线 `31d9813` 会给**另一组**数——`fence_top` 的 `to=10`、`fence_empty` 的 `to=8`、`fence_in_quote_tail` 的 `20/21` 那时**仍在框外**，它们靠 4g 的 `isTail` 夹上界才进框。后来人若把这张表当成「窄修法自己的效果」会读错。

**不要**用「把下界整条删掉」那条路：它在加厚语料上会多改 **61 格**，全是「把光标拉进一个**还没开始**的元素」（`BLOCKQUOTE[1]>PRE[1]>CODE[0]` 而真值该紧跟已揭示的『甲』之后）——那是设计 3.5「值节点不抢它前面的光标」的退化形态。

**Files:**
- Modify: `src/renderer/src/markdown/toReact.tsx`（`caretIndexIn` 的下界那一行 + 注释）
- Modify: `tests/unit/markdownToReact.test.tsx`

- [ ] **Step 1: 写失败的测试（用围栏那张表）**

`tests/unit/markdownToReact.test.tsx` 追加一个 `describe`，判据是「**光标在不在 `CODE` 元素内**」（`caret.closest('code') !== null`，或对非代码夹具用「在不在容器最后一个子元素」）。夹具与期望（Task 4g 量过的三状态表，`4g` 列给的是**当前**行为、`窄修法` 列是本任务的目标）：

| 夹具 | 长度 | 4g 现状（框外格） | 本任务目标（= **4g + 本任务**，不是窄修法单独的效果）|
|---|---|---|---|
| `` ```\n甲\n``` `` | 10 | 0 | 0（其余全进框）|
| 两行围栏 | 12 | 0,1,2,3 | **0** |
| `> ```\n> 甲\n> ```\n` | 16 | 0,1,2 | **0,1**（`at=1` 时 `code.position.start=2>1`，规则二要求插在它前面）|
| 带尾段的多行围栏 | 24 | 0,1–7,22–24 | 0,1,22–24 |
| 列表里的围栏 | 16 | 0,1,2 | **0,1** |
| 空围栏 `` ```\n``` `` | 8 | 0 | 0 |
| 缩进代码块 | 12 | 0,1,2,3 | **0** |
| 只有行内代码 | 4 | 0 | 0 |

**表格那几条 `to` 一格都不许动**（本来就是对的）；**两条老账**（「占位之前」「值节点不抢光标」）必须仍绿。

- [ ] **Step 2: 跑测试，确认它红**，红的格数与上表「4g 现状」列**逐格对齐**。

- [ ] **Step 3: 改那一行**（就是上面那条判据；连注释一起改，把「为什么松开到节点起点」写清）。

- [ ] **Step 4: 跑测试，确认它绿** + `pnpm test` exit 0 + `pnpm typecheck` exit 0。

- [ ] **Step 5: 变异验证（两条）**

- 甲：把下界改回 `rows[0].src` → 预测 Step 1 那批格子按「4g 现状」列全红。
- 乙：把下界**整条删掉** → **原稿写的「红得更多」不成立**（落地实测）：它红的是**更少**的夹具（3 < 甲的 5），而且失败方向**相反**——实际集合是期望集合的**真子集**（`引用块里的围栏` 实测 `[0]`、期望 `[0,1]`），也就是「**该在框外的那一格被拉进了一个还没开始的元素**」。那 61 格点名到了（加厚语料 300 篇 / 5261 格逐格差分：**恰好 61 格、跨 49 篇**，偏移以 `to=1` 为最多 24/61），方向全是「乙把光标拉进框」：`BLOCKQUOTE[0]>SPAN[0]` → `BLOCKQUOTE[0]>PRE[0]>CODE[0]>SPAN[0]`。这条变异的作用是**证明本任务没有走那条路**，判据看「反向的那几格」，不看红格数。

- [ ] **Step 6: 真机（`pnpm build` 之后）**：抽一个「框里还有没揭示的行」的夹具，逐字符打字，量**光标是否在 `pre>code` 内**、以及**隐形输入框的 `style.left/top` 是否仍等于光标的 `offsetLeft/offsetTop`**（候选框位置的代理指标）。另外量 Task 4g 报的那 5.75px：**本任务之后它应当消失**（光标不再在框下占一行）。

- [ ] **Step 7: 提交**（带 pathspec）

```bash
git commit -F /tmp/wt-msg-task4i.txt -- src/renderer/src/markdown/toReact.tsx tests/unit/markdownToReact.test.tsx
```

## Task 4j: 收 4g 评审的两条 —— 合并串里的链尾，以及三条零覆盖支路

**对应设计：** 3.5（兜底那条与「占位之前」那条）。

**由来**：Task 4g 的规格评审（判「有偏离」）查出两条，都不是回归，但都该收。

### 一条：合并 token 串里的链尾，兜底仍会开火

`renderAll` 的 `hasHtml` 那条路**只调 `renderTokens(tokens)`、从不 `renderNode`**，于是 `splitAtCaret` 不被调用、`caret.tail` 没人消费，光标落到末尾兜底。

实测（真管线逐偏移、871 格对拍）：`'> <b>x</b>甲一\n> 乙二\n\n末段\n'` 的 **to = 18、19** 光标在 `</blockquote>` **之后**；`'甲 <b>乙</b>\n\n末段\n'` 的 **7、8、9** 同理。老代码 871 格里「掉到块下方」110 格，4g 修好 **108**，剩下这 **2** 格。

**成因**（设计文档已按实测更正）：**不是**「`tailTarget` 对 html 叶子返回空」——那几格 `tailTarget` 返回的是**文本节点**（`leaf-null` 那支只在 `to = 10` 出现，而那一格光标在 `<p>` 里、不掉块外）。**修法**：让那条合并串的路**也认 `caret.tail`**——串尾命中 tail 的文本节点时，把光标放在**该节点末尾**，而不是靠 `caretHere`。

### 另一条：三条支路零覆盖，其中一条注释里点名「必须保住」

逐条单独变异（每条都还原过），跑全仓 608 条：

| 变异 | 行为差异 | 套件 |
|---|---|---|
| `:85` 去掉 `hasPlaceholder` 让路 | **168 格**（表格 8–20 那连续 13 格全变、20 行表 64 格）| **608 全绿** |
| `:192` 去掉 `?? node`（容器收留）| 14 格 | **608 全绿** |
| `:190` 去掉 `definition` 跳过 | 26 格 | **608 全绿** |

**第一条最要紧**：去掉之后，表格 `to=12` 的光标从「`</table>` 之后、占位之前」被挪进**表头单元格**，20 行表上差出十几行——正是设计 3.5 记的那条**连续 13 格**老账。而新用例的判据（「不是容器最后一个子元素」+「顶层落点后面紧跟占位」）**过**：光标进了 `<td>`，两个断言都不开火。

**Files:**
- Modify: `src/renderer/src/markdown/toReact.tsx`
- Modify: `tests/unit/markdownToReact.test.tsx`

- [ ] **Step 1: 补三条用例（先只写用例，确认它们在**当前**代码上红/绿）**

1. **占位在场**（窗口要写清出处，落地实测更正过）：那**连续 13 格**（8–20）是**四行表**（`| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\n末段\n`）的顶层窗口，四行表另加 `{28,29,30}`；**20 行表**的窗口是「从 8–20 起每行三格，共 **67 格**」。锁「光标**紧挨**占位（`.wt-md-table-blank`）、**不在**任何 `td/th` 里」。**两条窗口都写进用例**（各自标出处）。
2. **段落以叶子收尾**：脚注引用 / 图片收尾的段落，锁住 `?? node` 那支。
3. **文档以 `[ref]:` 定义收尾**：锁住 `definition` 跳过那支。

三条都要**先确认它们能红**（把对应支路关掉应当红）——**红不了就先别往下走**，报告实测。

- [ ] **Step 2: 改合并串那条路**（上面「一条」的修法），并补第 4 条用例：`'> <b>x</b>甲一\n> 乙二\n\n末段\n'` 的 `to = 18、19` 与 `'甲 <b>乙</b>\n\n末段\n'` 的 `7、8、9`，光标**在块内**。

- [ ] **Step 3: 跑门禁**（exit code）：`pnpm test`、`pnpm typecheck`。

- [ ] **Step 4: 变异验证（四条，各自单独做）**

上表那三条（`:85`/`:192`/`:190`）+ 本任务新改的那支（关掉它 → Step 2 那条红）。**每条都要指名红的是哪几条用例**。

- [ ] **Step 5: 真机**（`pnpm build` 后）：`'> <b>x</b>甲一\n> 乙二\n\n末段\n'` 逐字符打字到 18–19，量**光标是否在 `blockquote` 内**、以及**隐形输入框 `style.left/top` 是否等于光标的 `offsetLeft/offsetTop`**。

- [ ] **Step 6: 提交**（带 pathspec）

```bash
git commit -F /tmp/wt-msg-task4j.txt -- src/renderer/src/markdown/toReact.tsx tests/unit/markdownToReact.test.tsx
```

## Task 5: `MarkdownView.tsx` / `Page.tsx` —— 接线

**对应设计：** 第 3.5 节最后一段。

**Files:**
- Modify: `src/renderer/src/markdown/MarkdownView.tsx`
- Modify: `src/renderer/src/components/Page.tsx`
- Modify: `tests/unit/markdownView.test.tsx`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/markdownView.test.tsx` 末尾追加：

```tsx
/**
 * 阅读光标（设计 3.5）。
 *
 * 【判据：`closest` 查的是它在不在内容里】光标原来由 `Page` 追加在 `.wt-page__text`
 * 的末尾，落在最后一个块**下方**。修好之后它必须落在**块里面**——这一条用
 * `closest('p')` 钉住，光数个数钉不住。
 */
describe('Page —— 阅读光标', () => {
  it('md 那条路：光标恰好一个，且插在内容里面', () => {
    const c = page(source({ cursor: DOC.indexOf('本季度') + 2 })).container
    const carets = c.querySelectorAll('[data-testid="caret"]')
    expect(carets).toHaveLength(1)
    expect(carets[0].closest('p')).not.toBeNull()
  })

  it('纯文本那条路照旧：末尾那个光标还在', () => {
    const c = page(null, '第一章 甲').container
    const carets = c.querySelectorAll('[data-testid="caret"]')
    expect(carets).toHaveLength(1)
    expect(carets[0].closest('.wt-page__text')).not.toBeNull()
  })

  it('量高度那份副本里没有光标（找不着光标会让输入框退回纸张角上）', () => {
    const c = page(source({ cursor: 5, measuring: true })).container
    expect(c.querySelector('.wt-md-measure')!.querySelector('[data-testid="caret"]')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `pnpm vitest run tests/unit/markdownView.test.tsx`
Expected: **红的是第一条，但红在「位置」而不是「计数」**（**落地实测推翻了这里原稿**）：改之前 `MarkdownView` 调的是**不带 opts 的** `renderMarkdown(visible)`，树上**根本没有**光标，全文档只有 `Page` 追在末尾的那**一个**——所以 `toHaveLength(1)` 是**过**的，红的是 `closest('p')` 那一句（`expected null not to be null`）。另两条该绿。

**原稿写的是「现在有两个光标、`toHaveLength(1)` 当场失败」——那是错的**，而且**危险**：照「计数该红」去反推，会误以为 `caretAt` 的接线已经做好了。

- [ ] **Step 3: 改两个文件**

**`MarkdownView.tsx`：** 把

```tsx
      {renderMarkdown(visible)}
```

换成

```tsx
      {/*
        【`caretAt` 只给可见那一份】它是「揭示到哪个偏移」，光标据此插进树里
        （设计 3.5）。下面那份整篇副本永远不传——它只是拿来量高度的，多一个光标
        不但没用，还会让 `[data-testid="caret"]` 在文档里出现两次，
        而 `InputCapture` 取的是**第一个**。
      */}
      {renderMarkdown(visible, { caretAt: cursor })}
```

并把文件头那段组件说明末尾补一句：**阅读光标由 `renderMarkdown` 插进树里，`Page` 不再追加**。

**`Page.tsx`：** 把

```tsx
            {md ? (
              <MarkdownView
                doc={md.doc}
                foldStart={foldStart}
                cursor={md.cursor}
                measuring={md.measuring}
                onMeasureNode={md.onMeasureNode}
              />
            ) : (
              <>
                {shown}
                {/*
```

换成

```tsx
            {md ? (
              <MarkdownView
                doc={md.doc}
                foldStart={foldStart}
                cursor={md.cursor}
                measuring={md.measuring}
                onMeasureNode={md.onMeasureNode}
              />
            ) : (
              <>
                {shown}
                {/*
                  【这个光标只属于纯文本那条路】md 那条路的光标由 `MarkdownView`
                  里的 `renderMarkdown` 插进语法树（设计 3.5）——内容是块级元素的树，
                  追加在末尾只会落在最后一个块**下方**，而隐形输入框与输入法候选框
                  都按这个坐标摆。
                */}
                <span className="wt-caret" data-testid="caret" />
              </>
            )}
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `pnpm vitest run tests/unit/markdownView.test.tsx` → PASS
Run: `pnpm test` → **exit 0**。**这一条特别要紧**：`InputCapture` 与 `App` 都按 `[data-testid="caret"]` 找光标，先跑一句

```bash
grep -rn 'data-testid="caret"' tests/ src/renderer/src
```

把每一处都看一眼——凡是「断言光标只有一个」「按光标算位置」的用例，都要确认在新口径下仍然对。
Run: `pnpm typecheck` → exit 0

- [ ] **Step 5: 变异验证**

**先写下预期**：把 `Page.tsx` 里那个末尾的 `{md ? ... : <>...</>}` 改回「两条路都追加末尾光标」（即把末尾 span 挪回 `md ?` 那个三元之外）。预期红：**「md 那条路：光标恰好一个」这一条**（会变成两个），另两条不该红。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/markdown/MarkdownView.tsx src/renderer/src/components/Page.tsx tests/unit/markdownView.test.tsx
git commit -F /tmp/wt-msg.txt
```

---

## Task 6: `markdown.css` —— 占位的高度，以及空单元格的最小高度

**对应设计：** 第 3.2 节的表格那两行、第 10 节。

**Files:**
- Modify: `src/renderer/src/styles/markdown.css`

**这个 Task 没有单测。** CSS 对「逐字节围栏」与「片段是文件子串」两条判据都不可见，本仓库的做法是**收尾时手核**（见 Task 8）。所以这里的判据是**改动本身写清「为什么是这几个数」**——数字改了而注释没跟上，下一个人会按错的推导去调。

- [ ] **Step 1: 在 `:root` 里加两个长度变量**

在 `:root { ... }` 里、`--wt-md-th-bg` 那行**之后**插入：

```css
  /* 未揭示部分占位用的两个「一行多高」。**必须是绝对长度**：自定义属性是在*使用处*
     解析的，写成 `1.9em` 会在占位块那儿按它自己的字号算，与表格行、代码行的真实高度
     对不上（占位块是表格/代码块的兄弟节点，字号与它们不同）。 */
  --wt-md-code-line: calc(13px * 1.6);    /* `.wt-md-pre` 的 font-size × line-height */
  --wt-md-row-h: calc(14px * 1.9 + 10px); /* `.wt-md-table` 的字号 × 正文行高 + 单元格上下内边距与边框 */
```

**这两个数不是拍的**：`13px × 1.6` 来自下面 `.wt-md-pre` 那条；`14px × 1.9 + 10px` 里，`14px` 来自 `.wt-md-table`、`1.9` 是 `.wt-page` 的正文行高、`10px` 是 `.wt-md-cell` 的上下内边距（4px × 2）加边框（1px × 2）。**改那三条里任何一条，这两个变量都要跟着改。** 深色那一块不用给替身——它们是长度，不是颜色。

- [ ] **Step 2: 给单元格一个最小高度**

那条 `.wt-md-cell { ... }` 换成：

```css
.wt-md-cell {
  border: 1px solid var(--wt-md-grid);
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
  word-break: break-word;
  /* 光标刚走到某一行、里面的字还没抽出来时，那一行是空的——不给高度就缩成一条细线，
     这正是改之前「太拥挤」那个观感的一半。表格单元格上的 `height` 是**最小高度**，
     内容多的行照常撑开，不会被压扁。 */
  height: var(--wt-md-row-h);
}
```

- [ ] **Step 3: 加两个占位样式**

在「图片占位框」那一节（`/* ── 图片占位框 ... */`）**之前**插入：

```css
/* ── 未揭示部分的占位：**只占高度，什么都不画** ──────────────────────

   表格还没走到的行、代码块还没揭示的行，占的就是这两块空白（设计 3.2 修订）。
   行数由 `toReact.tsx` 的 `BlankSpace` 内联设成 `--wt-md-blank-lines` /
   `--wt-md-blank-rows`，这里只负责把「几行」换算成高度。

   【为什么不画网格线、不画代码框】用户拍板：占位只留白。画出来的话就是改之前那个
   「块一露头，整张空网格全铺出来」的画面，也就是这次要消灭的东西。

   【`.wt-md-measure-block` 那条禁令不适用于这里】占位元素只出现在**可见**的那一份里
   ——测量用的是整篇未裁剪的文档，占位字段根本不存在——所以碰不到 `measure.ts`
   那个 offsetTop 差值算法。 */
.wt-md-pre-blank {
  height: calc(var(--wt-md-blank-lines, 0) * var(--wt-md-code-line));
}

.wt-md-table-blank {
  height: calc(var(--wt-md-blank-rows, 0) * var(--wt-md-row-h));
}
```

- [ ] **Step 3b: 给代码框一个最小高度**

在 `.wt-md-pre` 那条规则里补一行。**这行不是可选的**——它盖住 `clip.ts` 里那段注释点名的缺口：

```css
  /* 【为什么必须有一行的高度】光标还在围栏里、框里一个字都没抽出来时，`<pre>` 没有
     line box，高度只剩上下 padding——而 `clip.ts` 按「未揭示文本里的换行个数」报占位行数，
     它**假设当前这一行已经由框里那半行占着了**；框是空的，这个前提就不成立，于是少报一行。
     把它撑到恰好一行高，「框内行数 + 占位行数 == 总行数」这条才在**每个**光标位置都成立。

     【那个 `+ 20px` 不是凑的，删了就退回原样】`min-height` 量的是**边框盒**
     ——`word.css` 那条 `* { box-sizing: border-box }` 是全仓唯一一条、无豁免——而框自己的
     上下内边距在内容盒**之外**，所以只写 `var(--wt-md-code-line)` 补的是
     `20.8 − 20 = 0.8px`，不是一行。真机实测（`pnpm build` 后跑 `_electron`，
     逐字符扫全部偏移，把 `min-height` 换成三个值各量一遍）：
     框高 20.000（`0`）/ 20.797（`var(--wt-md-code-line)`）/ 40.797（本行），
     而框里抽出第一个字符起恒为 40.797 ——**少写这 20px 的那一版仍然让下面整页跳 20px**，
     这一条本来就是为了堵这一跳。`+ 20px` 与上面那条 `padding: 10px 14px` 是一对，
     **改 padding 就要改它**。

     `min-height` 是**下限**：非空的框自己就已经是一行或更多，这时它不生效，
     所以两种机制不会叠加。表格那侧的 `.wt-md-cell { height }` 是同一条口径——
     差别只在它那个式子（`14px * 1.9 + 10px`）**记得**把内边距与边框加进去，这一侧当初漏了。 */
  min-height: calc(var(--wt-md-code-line) + 20px);
```

**为什么不在 `clip.ts` 里补那一行**：`blankLines` 的判据要保持单一（「未揭示文本里的换行个数」）。补 +1 会让「光标正好压在第一行行尾」那两条边界用例变红——那是判据被破坏，不是缺口被修好。

- [ ] **Step 4: 跑门禁**

Run: `pnpm typecheck` → exit 0
Run: `pnpm test` → exit 0（本 Task 不该改变任何用例的结果；变了就是改错了地方）

- [ ] **Step 5: 手核**

在文件里确认三件事：

1. `--wt-md-code-line` 与 `--wt-md-row-h` 都只在 `:root` 里定义一次，深色那一块里没有替身；
2. `.wt-md-pre-blank` 与 `.wt-md-table-blank` 各只有一条 `height`，**没有** `border` / `background`；
3. `.wt-md-measure-block` 仍然一条规则都没有（那一大段注释下面还是空的）。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/styles/markdown.css
git commit -F /tmp/wt-msg.txt
```

---

## Task 7: 改写 `CLAUDE.md` 里的核心不变量

**对应设计：** 第 13.1 节（那段引文这次又变了，见文末修订记录）。

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 找到那一句并替换**

`CLAUDE.md` 的「核心不变量」一节里，`.md` 那段现在是（**先搜一遍确认逐字一致再动手**）：

> **`.md` 工作文档：显示出来的文字等于「已揭示那一段去掉语法记号之后」的文字**，此外不显示任何未揭示的字符；只有已经开始（起始偏移 < cursor）的块才画结构骨架，骨架里不含未揭示的字符。

替换成：

> **`.md` 工作文档：显示出来的文字等于「已揭示那一段去掉语法记号之后」的文字**，此外不显示任何未揭示的字符；结构骨架**逐层按起始偏移给**——块开始了才画这个块，表格的行、列表的项也是一行/一项开始了才画，没开始的部分只占高度（列表连高度都不占），骨架里不含未揭示的字符。

**句子的其余部分（「也就是说…」到末尾那三节的指引）一个字不动。**

- [ ] **Step 2: 顺带确认紧邻的那一句仍然成立**

那一节里接着写的是「小说与 `.txt` 工作文档：阅读区显示的内容恒等于 `flatText.slice(revealStart, cursor)`」。本次修订**没有碰**那一路，所以它不用改——**确认一下即可，不要顺手改写它**。

- [ ] **Step 3: 提交**

```bash
git add CLAUDE.md
git commit -F /tmp/wt-msg.txt
```

---

## Task 8: 收尾 —— 围栏回写、替换过期的验收项、写最终验收清单

**这个 Task 由 lead 自己做，不要派实现者。** 它会改 `docs/`，而本仓库的规矩是 agent 不碰 `docs/`。

**Files:**
- Modify: `docs/superpowers/plans/2026-10-14-markdown-rendering.md`
- Modify: 本文件

- [ ] **Step 1: 先量出要回写哪几面围栏，别照抄这份清单**

**本次实测量到的工作清单**（lead 在 `c9b325b` 上跑的；**Step 2 冻结源码之后必须重测一遍**，别照抄——源码一动这张表就陈旧）：

- **正向判据**（遍历 `git ls-files src tests` 的 79 个 `.ts/.tsx/.css`，逐文件与**六份计划**的全部围栏比 md5，原样含末尾换行）：**没有逐字节围栏的恰好 10 个**，全是这一批改过的：
  `components/Page.tsx`、`markdown/MarkdownView.tsx`、`markdown/clip.ts`、`markdown/parse.ts`、`markdown/toReact.tsx`、`styles/markdown.css`、以及 `tests/unit/` 下的 `markdownClip.test.ts`、`markdownParse.test.ts`、`markdownToReact.test.tsx`、`markdownView.test.tsx`。
  （更早那批的 `shortcuts.ts` / `shortcutDispatch.test.ts` / `shortcuts.test.ts` **不在**这个集合里——它们由 `2026-10-11-*` 两份计划承载，说明扫计划时**必须六份全扫**，只扫本批四份会把这 4 个误报成缺口。）
- **路由**（按「这份计划里提到该文件名的行数」粗判）：markdown 模块那几个文件（`parse.ts` / `clip.ts` / `toReact.tsx` / `MarkdownView.tsx` / `markdown.css` / 四个测试）只在 **10-14** 与 **10-15** 里出现——它们**是 10-14 那批新建的**，所以回写目标是 **10-14**（外加 10-15 里那些片段）；而 **`Page.tsx` 在 06 里出现**——它是**早就存在的文件**，按仓库口径「改动已有文件一律写进 06」。
- **围栏取法**必须用「任意标签」`^[ \t]*```[^\n]*$`：`06` 那份里有 16 个 `bash` 围栏，窄枚举（只认 `ts`/`tsx`/`css`）会把配对带错。


本仓库的硬约定：改了源码（含只改注释）就要把 `docs/superpowers/plans/` 里对应的围栏同步回写，口径 `md5(围栏原始内容) == md5(文件)`。

**上一次量过**（2026-10-15，改这一批之前）：`clip.ts` / `toReact.tsx` / `markdown.css` / `MarkdownView.tsx` / `markdownClip.test.ts` / `markdownToReact.test.tsx` / `markdownView.test.tsx` 各有一面逐字节围栏，**全部在 10-14 那份计划里**；`CLAUDE.md` 没有任何围栏。本批还多动了 `parse.ts`、`markdownParse.test.ts`、`Page.tsx` 三个——**它们有没有围栏要先量**（`Page.tsx` 可能落在 06 那份正本里）。

用 python 抽/写块：**块内行整体替换、保留围栏行**；多块按块索引**倒序** splice；取围栏的正则必须写成**任意标签** `^```[^\n]*\n`（窄枚举会错配）。**不要手抄。**

- [ ] **Step 2: 正向判据必须为空**

遍历**全部**源/测试文件，报告「没有任何围栏与它逐字节相等」的集合，那个集合必须是空的。遍历范围要含**五份计划的全部围栏**——只扫本计划会漏掉这个任务真正要修的那几面。

- [ ] **Step 3: 片段判据**

另跑一条子串判据：本计划里每一个 `ts` / `tsx` 围栏的正文，都必须是某个源/测试文件的子串。**预期会有失配**，逐条核对——示意性的（例如变异验证里那几段故意写坏的代码）要在计划里写明它是示意、不是源码。

- [ ] **Step 4: CSS 手核**

`markdown.css` 那两面围栏（10-14 计划里的整文件 + 本计划 Task 6 的三个片段）逐字比一遍。CSS 对前两条判据都不可见，只能手核。

- [ ] **Step 4c: 把三处「下界不可能开火 / 改了就是死代码」的陈述改成实测口径**

4f 的规格评审查出这三处**把两件事并成了一句**（它逐格实测过）：

1. `tests/unit/markdownToReact.test.tsx:583-588` 的括号理由（**这也是唯一一处要改的源码注释**，所以排在这个收尾 Task 里）；同上那句话在**本计划 `Task 4f` Step 6** 与 **`31d9813` 的提交信息**里（提交信息不能改，别去 amend——改了计划与用例注释即可）。
2. 正确说法是三段：① **换成 `originOf(node)` 逐格字节相同**（实测，可保留）；② **整条删掉不等价**——全仓 592 条仍绿，但**逐格差 39 格**（`value` 为空、内容起点在揭示偏移之后的代码节点，如容器里正在敲的围栏），所以「**全绿是覆盖事实，不是等价事实**」；③ 第三轮那条接受窗口的保护对象（「值节点不抢它前面的光标」）与 `rows[0].src` 在空节点上**不是同一个数**。
3. **设计文档那一处已经改准了**（第四轮那段），这一步只管计划与用例注释。

- [ ] **Step 4b: 在 `toReact.tsx` 补一句注释（评审建议，实测支持）**

`renderAll` 里那条新判据（`caretHere`）**只有合成 token 流那条路消费它**——`!hasHtml` 的分支逐节点渲染后 `continue`，不读它。规格评审实测：把它改成「只在 `hasHtml` 时求值」（两遍扫描）**行为逐字节不变**（全仓 583 passed；200 份定种子文档 × 每个偏移 = 1988 格，光标 DOM 签名 **0 差异**）。所以这是**可选清理，不是死代码**——补一句注释比拆循环便宜。

**动这一处要在 Task 4f 落地之后**（同一个文件）。

- [ ] **Step 5: 替换 10-14 计划里那条过期的验收项**

10-14 计划末尾「交给用户的真机验收清单」的**第 9 条**现在写的是：

> 9. **结构预知**：抽到表格表头那一刻，整张网格就画出来了，后面几行是空的、随抽字被填上。

它描述的是**旧行为**，本次修订后不再成立。替换成：

> 9. **逐行逐项**：抽到表格第二行时，第三行还不该出现——它底下只留一段空白（没有网格线）；列表抽到第几项就只看到第几项。另外留意打字时**下面的内容会往下推一下**：这是设计 3.2 里写明的取舍，不是 bug。

- [ ] **Step 6: 确认本文件末尾的验收清单就是最终版**

下面那份清单已经含两轮的条目（9、11、12 来自第一轮，4、13、14 来自第二轮）。**照着核一遍**，别让 10-14 那份清单与本文件这份说法不一致。

- [ ] **Step 7: 提交**

```bash
git add docs/superpowers/plans/2026-10-14-markdown-rendering.md docs/superpowers/plans/2026-10-15-markdown-progressive-reveal.md
git commit -F /tmp/wt-msg.txt
```

---

## 收尾实测记录（2026-10-16 落地时量的）

- **正向判据**（遍历 `git ls-files src tests` 的 79 个 `.ts/.tsx/.css`，与**六份**计划的全部围栏比 md5，原样含末尾换行）：
  **回写前 10 个**（`components/Page.tsx`、`markdown/` 下的 `MarkdownView.tsx` / `clip.ts` / `parse.ts` / `toReact.tsx`、
  `styles/markdown.css`、`tests/unit/` 下的 `markdownClip` / `markdownParse` / `markdownToReact` / `markdownView`），
  **回写后 0 个**。回写落点共 12 面：10-14 九面（markdown 模块那批是它新建的）+ 06 一面（`Page.tsx` 是早就存在的文件，06 是正本）
  + 10-14 里 `Page.tsx` 的第二份全文副本 + 本计划 Task 3 那面 **clip.ts 整文件**（首末行都与文件一致）。
- **片段判据**（本计划里每面 `ts`/`tsx` 围栏的正文必须是某个源/测试文件的子串）：54 面里**回写前 42 面失配**、**回写后 25 面**。
  回写的 16 面是按对齐取回的源码区间（函数 / 接口 / 夹具级）。**剩下 25 面分两类，都不是本批漏掉的**：
  ① **刻意节选的片段**（2–6 行的「改这一行」式引用，带行内标注）——`110 / 141 / 248 / 312 / 318 / 328 / 515 / 915 / 1187 / 1860 / 1878 / 2879`；
  ② **起草期写、落地时被 4g/4i/4j 大改过的整段草稿**（与当前源码的最佳对齐只有 0.38–0.75，等长窗口会切在句子中间）——
  `125 / 159 / 390 / 1216 / 1239 / 1492 / 1783 / 2018 / 2245 / 2488 / 2537 / 2644 / 2838`。
  这两类从来就没与任何一版源码逐字节相等（`git log -S` 可查），**是示意稿**；要追上得逐面改写成整段源码，那是另一件事。
- **CSS 手核**：10-14 那面 `markdown.css` 整文件围栏已逐字节回写 ✓。本计划 Task 6 的**四面** css 片段里，
  前三面本来就是子串，第四面（`.wt-md-pre` 那条「为什么必须有一行的高度」注释 + `min-height`）**是旧的**——
  4h 补 `+ 20px` 之后没人回写，已按交付源码重抽（现在四面全是子串）。
- **`.wt-md-hr` 手核**（Task 6 的实施者曾把它的选择器吃掉一次，而四条门禁与两套围栏判据**都看不见**）：
  `src/renderer/src/styles/markdown.css:151-155` 完好 —— `.wt-md-hr { border: 0; border-top: 1px solid var(--wt-md-rule); margin: 1em 0; }`；
  另核 `.wt-md-pre`（117 起）里**没有**多出来的 `border*`（那正是上次出事的样子）✓。
- **围栏配对**：三份计划的围栏行数改前改后一致（06 = 190、10-14 = 190、本文件 = 154，都是偶数）✓；
  源码里没有任何以 ` ``` `（顶格）开头的行，回写不会把围栏带错 ✓。

---

## 交给用户的真机验收清单

这几条 jsdom 判不了，**由用户跑**（本仓库惯例）。**等 Task 8 做完再跑**——10-14 计划里那份清单的第 9 条描述的是旧行为。

1. **观感**：导入一份真的 `.md` 工作文档，按老板键。标题字号、列表、引用块、代码块、表格是不是像一份 Word 文档。
2. **铺满是不是真的满页**：按 `⌘⇧B` 之后看屏幕底部，应当是一整块（不切半句话、半张表）。再按 `⌘⇧↑` / `⌘⇧↓`，画面应当当场变多/变少，且**始终是整块的**。
3. **深色主题**：切到深色，看标题那个蓝是否看得清、代码块底色、表格网格线。**再单独看一眼「深色主题 + 浅色纸」**（纸张开关不打开）——那时纸仍是白的，标题必须还是浅色那一套蓝。
4. **中文输入法**：老板模式下用输入法打字，候选框正常、字正常出来。**特别看候选框的位置**——它应当贴着阅读光标，而不是飘到页面顶部或某个块的下方。
5. **图片**：本地相对路径的图能显示；外链图能显示；把本地那张图删掉，屏幕上退回占位框 + 替代文字，不报错。
6. **表格列多时不出横向滚动条**；代码块里的长行是折行的。
7. **任务列表的方框点不动**；**链接点了什么也不发生**。
8. **抽字过程中不会看到裸记号**：一边打字一边盯着看，`#`、`**`、`|` 一个都不该作为字形出现。
9. **逐行逐项**：抽到表格第二行时，第三行还不该出现——它底下只留一段空白（没有网格线）；列表抽到第几项就只看到第几项。另外留意打字时**下面的内容会往下推一下**：这是设计 3.2 里写明的取舍，不是 bug。

   **但要分清两种「跳」**：**设计内的跳**是「一行一行地长出来」（每多揭示一行，下面推一行的高度）；**bug 的跳**是**抽到代码块第一个字符那一刻、下面整页往下跳 20px**——那是 `.wt-md-pre` 的 `min-height` 被 `box-sizing: border-box` 吃掉造成的（真机实测：框只长了 0.797px 而不是 20.8px），Task 4h 已在修。**修完之后这一跳应当消失**：框里 0 个字与抽出第一个字符，整块高度应当相等。
10. **`.txt` 工作文档照旧**：导入一个 `.txt`，正文显示原文（包括里面的 `#`），不渲染。
11. **代码块**：抽到代码块第一行时，框只包住这一行，底下是一段空白；随打字往下长。
12. **空行不再是细线**：光标刚走到表格某一行、字还没出来时，那一行仍有一行的高度（不是被压成一条缝）。
13. **光标的位置**：光标应当贴在已揭示的最后一个字后面。走到**表格里**时它在那个单元格里、走到**列表项**里时在序号后面、走到**代码块**里时在框里——**都不是掉到那个块的下方**。
14. **代码块不再提前**：光标还在 ` ``` ` 那三个反引号里时，框里应当是**空的**（修之前第一行已经整行显示）。带语言标注的 ` ```js ` 更明显，那里偏差本来是 6 个字符。

### 这一批（4c/4d/4e/4f，第三、四轮）新加的四条

15. **光标在容器里不出块**（本批新修）：`>` 引用块里写满两三行、列表项换行续写，**在行与行之间**盯着光标——它应当一直在**块里 / 列表项里**（修之前它会跳到整篇末尾）。多行引用块与多行列表项各试一遍。
16. **行尾带空格的段落：那一行的首字会晚一个按键**（**已知代价，不是 bug**）。`.md` 里任何一行**末尾带空格或制表符**的段落，那一行的第一个字晚一个按键出现，之后就正常。理由：`value` 与源码不是逐字相同，行起点只能取一个**恒不提前**的保守值（设计 3.6.1 第四轮）。**要确认的是它「晚」而不是「多显示」**——屏幕上任何时候都不该出现你**还没打到**的字。
17. **转义与实体同理**：`\*`、`&amp;`、`&nbsp;` 这类写法所在的段落同样**晚几个按键**（`&amp;` 那类晚得更多——5 个源码字符对 1 个字），多行时**光标还会先停在空段落里**几拍。同样是取舍，不是 bug。
18. **已知残留（本批之前就有，没修）**：表头里**有一个空单元格**时（例如 `| 项目 |  |`），光标在表头那一段偏移上会落到表格**下方**。触发面窄（表头第二格为空、且当时还没打到表体）。**要不要现在修由你定**——修法是给「没有子节点的单元格」一个能接住光标的落点。

**第 16、17 两条请特别留意**：它们是这一批**刻意选的方向**。另一条路（不挂逐行表、退回按字符数切）会让屏幕上出现**还没打到的字**——那是破核心不变量；选了「晚」而不是「多显示」。所以你看到「晚了」是设计，看到「多了」才是 bug。

19. **已知残留（本批新量出来的）：段落以行内 HTML 收尾时，光标会落到段落下方。** 实测 `'甲 <b>乙</b>\n'` 的偏移 **7、8、9** 光标在 `<p>` **外面**（本该在「乙」之后）；`'甲\n\n<div>内容</div>\n'` 的 16、17 同理；300 篇语料里约 **57 格**是这形态。成因：4g 的「收进最后一块已渲染内容」对 html / 分隔线这类叶子返回空，仍走旧兜底。**要不要现在修由你定**——修法要区分「渲染成真盒子的叶子」与「渲染成行内标记的 html」。
20. **框架里还有没揭示的行**（占位存在）时，光标**在框外**、紧挨占位——那是设计 3.5 明文要的「占位之前」。**Task 4i 正在把它改成「进框」**（你最初报的就是这一类）；落地后这一条作废，改看 13 条。


---

## 自查记录

**设计文档覆盖情况：**

| 设计文档的节 | 落在哪个 Task |
|---|---|
| 3.2 重复单元按自己的区间判 | Task 3 |
| 3.2 表格整行出现、不缺列 | Task 3（用例） |
| 3.2 代码块占位行数 | Task 3（算）+ Task 4（画）+ Task 6（高度） |
| 3.2 列表完全不占位 | Task 3（丢掉即不占） |
| 3.2 行内粒度不下沉 | Task 3（写明「那条用例别动」） |
| 3.2「未揭示的字符一个都不上屏」 | Task 3 的叶子规则未动；Task 4 的占位有 `textContent` 为空断言 |
| 3.5 光标插进树 | Task 4（插）+ Task 5（接线） |
| 3.5 空节点也命中 | Task 4 的用例「光标落在空节点上也算命中」 |
| 3.5 命中不了退回末尾 | Task 4 的用例「给的光标偏移超出全部文字时」 |
| 3.5 行内 HTML 那段的近似 | Task 4 的 `renderAll` 改法（注释里写明是接受近似） |
| 3.5 `Page` 不再追加末尾光标 | Task 5 |
| 3.6 `value` 真实起点 | Task 1（算）+ Task 2（用）+ Task 4（光标也用） |
| 3.6 缩进块的残留 | Task 1 的注释写明；本轮不修 |
| 9.2 表格逐行揭示 | Task 3 + Task 6 |
| 10 样式 | Task 6 |
| 13.1 不变量改写 | Task 7 |
| 修订记录里「由新的实现计划替换验收项」 | Task 8 |

**类型一致性：** 本批新增的名字共九个，前四个在 Task 1 / Task 3 里定义、Task 4 里消费，后五个是 Task 4 内部私有的：

| 名字 | 定义处 | 消费处 |
|---|---|---|
| `valueStartOf(node)` | `parse.ts`（Task 1） | `clip.ts`（Task 2）、`toReact.tsx`（Task 4） |
| `WT_VALUE_START` | `parse.ts`（Task 1） | 只有 `valueStartOf` 用 |
| `readBlankCount(node, field)` | `clip.ts`（Task 3） | `toReact.tsx`（Task 4） |
| `WT_BLANK_LINES` / `WT_BLANK_ROWS` | `clip.ts`（Task 3） | `toReact.tsx`（Task 4） |
| `Caret` / `Ctx.caret` | `toReact.tsx`（Task 4） | 本文件内 |
| `splitAtCaret` / `originOf` / `CaretSpan` / `BlankSpace` | `toReact.tsx`（Task 4） | 本文件内 |

Task 4 的开头把前四个的签名原样抄了一遍，就是为了让两侧对不上时**当场看得见**。

**明确不做的：** 不给代码块的占位做「真实高度」（那要把测量下沉到行级）；不给列表做「符号占位」（理由见 3.2）；不动行内粒度；不修四空格缩进代码块的逐行偏差（理由见 3.6）。
