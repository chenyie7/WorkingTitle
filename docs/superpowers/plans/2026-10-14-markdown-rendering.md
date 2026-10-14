# Markdown 渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把导入的 `.md` 工作文档渲染成 Word 风的排版，同时保持「按字符逐字抽出」这条既有机制不变。

**Architecture:** 用 `remark` 把 `flatText` 解析成带**字符偏移**的 mdast（偏移与 `cursor` / `revealStart` 同一个坐标系），每次渲染时按偏移裁出一棵「该显示什么」的树，再映射成 React 元素。结构**预知**：一个块只要开始被揭示，它的完整结构就画出来，文本没抽到的部分留空。

**Tech Stack:** React 19 / TypeScript / vitest + jsdom / `unified` + `remark-parse` + `remark-gfm`

**设计文档：** `docs/superpowers/specs/2026-10-14-markdown-rendering-design.md`。每个 Task 开头都标了它对应设计文档的哪几节，有疑问先读那一节。

**分支：** `feat/markdown-rendering`，从 `feat/boss-key` 切出（工作文档这个概念整个来自那一批，它还没合并）。**继续在这条分支上开发。**

---

## 读这份计划之前必须知道的四件仓库硬约定

### 1. 计划里的代码围栏 = 源码的逐字节副本

本文件里每个 ` ```ts ` / ` ```tsx ` / ` ```css ` 围栏**不是示意，是源文件的副本**。口径：

```
md5(围栏原始内容) == md5(文件)      # 原样相等，含末尾换行；不要 rstrip
```

**这里有个跟以往不同的地方：本计划要新建的文件，围栏里的代码就是最终源码**（照抄即可，逐字节一致由构造保证）；而**改动既有文件**的地方，围栏给的是**改动后的完整文件**或**片段**——片段用「锚点 + 替换」描述，做完之后要按交付源码把片段重切一遍。Task 11 是专门的收尾任务。

### 2. 提交

```bash
git add <显式路径>            # 不要用 -A：工作树里可能有别人的在途改动与未跟踪的 books/
git commit -F /tmp/msg.txt    # 不要内联 -m：ASCII 双引号会静默截断提交信息
```

提交前先跑一次 `git branch --show-current` 与 `git log --oneline -1`——共享工作树里别人可能正在提交。

### 3. 门禁一律看 exit code，别只 grep 摘要行

```bash
pnpm typecheck && echo TYPECHECK_OK
pnpm test && echo TEST_OK
```

两种「摘要行看着是绿的」形态：unhandled rejection（用例行照旧 passed，汇总行多一条 `Errors 1 error`，exit 1）；某个测试文件整份失败（`Test Files 1 failed` 而 `Tests N passed` 里没有 failed）。

### 4. 依赖是 ESM-only，只许渲染层引用

`remark` 全族都是 `"type": "module"`（实测 `unified@11.0.5`、`remark-parse@11.0.0`、`remark-gfm@4.0.1` 三个包的 `"type"` 都是 `module`）。**它们只允许出现在 `src/renderer/src/markdown/` 下**。一旦 `src/main/` 或 `src/core/` 引到，`tsconfig.node.json` 那条链就会去解析它们——那是本功能最容易引入的静默失败面。

守它的是 `pnpm typecheck`（两个 tsconfig 都跑），**没有独立的用例**——为了测「main 引用了 ESM 包」去 mock 一个 ESM 包并不现实。所以这条是靠类型检查 + `parse.ts` 里那段注释一起守的。

---

## 文件结构

**新建（全部在渲染层）：**

| 文件 | 职责 |
|---|---|
| `src/renderer/src/markdown/parse.ts` | md 文本 → mdast。**全仓唯一 import remark 的地方** |
| `src/renderer/src/markdown/clip.ts` | `(树, from, to)` → 树。纯函数，决定「什么该显示」 |
| `src/renderer/src/markdown/fill.ts` | `(块高表, 目标高度)` → 铺满切点；`(块跨度, 上限)` → 折叠切点。纯函数 |
| `src/renderer/src/markdown/html.ts` | 内嵌 HTML 的白名单标签切分（不碰 `innerHTML`） |
| `src/renderer/src/markdown/toReact.tsx` | 裁剪后的树 → React 元素 |
| `src/renderer/src/markdown/measure.ts` | 离屏量各顶层块的高度（DOM 侧，量不出返回 null） |
| `src/renderer/src/markdown/MarkdownView.tsx` | 把上面几步串起来 |
| `src/renderer/src/styles/markdown.css` | Word 风样式，颜色全走变量 |
| `src/main/workDocImage.ts` | 图片取回（本地按基准目录读、网络代取），**可单测、不碰 electron** |
| 测试 8 个 | 见各 Task |

**改动的既有文件：**

| 文件 | 改什么 |
|---|---|
| `src/main/channels.ts` | 加一条 `loadWorkDocImage` |
| `src/main/ipc.ts` | 加那个 handler |
| `src/preload/index.ts` | 加那个方法 |
| `src/renderer/src/types/global.d.ts` | 手写 `WtApi` 加那个方法（**没有闸，必须手改**） |
| `tests/setup.ts` | 良性替身加那个方法（**这份有闸**：少写一个报 TS2741） |
| `src/renderer/src/components/Page.tsx` | 加可选 `markdown`；有它走 md 分支 |
| `src/renderer/src/App.tsx` | 判定、解析缓存、图片缓存、铺满改走量高度 |
| `src/core/bossKey.ts` | **只改注释**：`bossFillPercent` 的含义从「一页字符数」变成「一页高度」，`fillCharsFor` 降级成兜底 |
| `CLAUDE.md` | 核心不变量那一段改写 |
| `package.json` | 3 个运行时依赖 + 1 个 devDependency |

---

## Task 1: `markdown/parse.ts` —— 文本解析成带偏移的语法树

对应设计文档第 3.1 节与第 5 节。

**Files:**
- Create: `src/renderer/src/markdown/parse.ts`
- Create: `tests/unit/markdownParse.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 装依赖**

```bash
pnpm add unified remark-parse remark-gfm
pnpm add -D @types/mdast
```

装完确认版本：`node -e "console.log(require('./package.json').dependencies)"`。

- [ ] **Step 2: 先核对两个 API 的形状，别凭记忆**

本计划后面几节按「`unified().use(remarkParse).use(remarkGfm).parse(text)` 同步返回 mdast」与「节点自带 `position.start.offset`」来写。**先跑一条最小脚本核实**，不成立就停下来报，别硬套：

```bash
node --input-type=module -e '
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
const p = unified().use(remarkParse).use(remarkGfm);
const t = p.parse("# 标题\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
console.log(JSON.stringify(t.children.map(n => [n.type, n.position.start.offset, n.position.end.offset])));
console.log("切片:", JSON.stringify("# 标题\n\n| a | b |\n| - | - |\n| 1 | 2 |\n".slice(t.children[0].position.start.offset, t.children[0].position.end.offset)));
'
```

期望：两行输出，第一行里能看到 `["heading",0,4]` 与一个 `"table"`，第二行的「切片」是 `"# 标题"`。

- [ ] **Step 3: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest'
import { parseMarkdown, isMarkdownPath } from '../../src/renderer/src/markdown/parse'

/**
 * 【这一批用例断言的是**关系**，不是字面数字】
 *
 * 偏移量的绝对值会随 remark 版本漂移，钉死数字等于把「升级一次依赖」变成「改一堆测试」。
 * 真正要守的是那条关系：`text.slice(start.offset, end.offset)` 必须等于该节点在源码里
 * 的那一段。这条关系一旦不成立，裁剪整条路都会错位。
 */
function sliceOf(text: string, node: { position?: { start: { offset?: number }; end: { offset?: number } } }): string {
  const s = node.position?.start.offset ?? -1
  const e = node.position?.end.offset ?? -1
  return text.slice(s, e)
}

describe('parseMarkdown', () => {
  it('标题：类型、层级、以及切片等于源码那一段', () => {
    const text = '# 季度汇报\n'
    const tree = parseMarkdown(text)!
    expect(tree.children[0].type).toBe('heading')
    expect(sliceOf(text, tree.children[0])).toBe('# 季度汇报')
  })

  it('GFM 表格被解析成 table 节点', () => {
    const text = '| 项目 | 负责人 |\n| --- | --- |\n| 归档 | 张三 |\n'
    const tree = parseMarkdown(text)!
    expect(tree.children[0].type).toBe('table')
    expect(sliceOf(text, tree.children[0])).toBe(text.trimEnd())
  })

  it('GFM 任务列表：listItem 上带 checked', () => {
    const tree = parseMarkdown('- [x] 已完成\n- [ ] 没做\n')!
    const items = (tree.children[0] as { children: { checked?: boolean | null }[] }).children
    expect(items[0].checked).toBe(true)
    expect(items[1].checked).toBe(false)
  })

  it('删除线与脚注都被认出来（这两种不是 CommonMark 核心，靠 GFM 与 remark 的扩展）', () => {
    const del = parseMarkdown('~~划掉~~\n')!
    const para = del.children[0] as { children: { type: string }[] }
    expect(para.children[0].type).toBe('delete')

    const foot = parseMarkdown('正文[^1]\n\n[^1]: 脚注内容\n')!
    const types = foot.children.map((n) => n.type)
    expect(types).toContain('footnoteDefinition')
    const first = foot.children[0] as { children: { type: string }[] }
    expect(first.children.some((n) => n.type === 'footnoteReference')).toBe(true)
  })

  it('行内 HTML 留下的是 html 节点，值就是那段原始标签', () => {
    const text = '<div class="x">内容</div>\n'
    const tree = parseMarkdown(text)!
    const node = tree.children[0] as { type: string; value: string }
    expect(node.type).toBe('html')
    expect(node.value).toContain('<div')
  })

  it('空串解析成空 root（remark 对畸形 md 基本不抛）', () => {
    // 【这条用例原来叫「解析不出来的输入返回 null，而不是抛出去」，名不副实】
    // 空串不是「解析不出来」——remark 把它**正常**解析成一个空的 root，返回的是树不是 null。
    // 也就是说这个文件里 `catch` 那条路一次都没走到，对降级契约是零覆盖。
    // 真正守「真有东西抛出来时不许冒到调用方」的是
    // tests/unit/markdownParseFallback.test.ts（它把 unified 换成必抛的替身）。
    // 这里保留两条断言，但只当「空串这个边角输入」的回归用。
    expect(() => parseMarkdown('')).not.toThrow()
    expect(parseMarkdown('')!.type).toBe('root')
  })

  it('按扩展名判定：.md / .markdown 才算，大小写不敏感', () => {
    expect(isMarkdownPath('/Users/某人/周报.md')).toBe(true)
    expect(isMarkdownPath('/Users/某人/周报.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('/Users/某人/周报.txt')).toBe(false)
    // 【这一条是刻意的】内容长得像 md 的 txt 不渲染：导入 txt 的人要的就是原文
    expect(isMarkdownPath('/Users/某人/周报.md.txt')).toBe(false)
    expect(isMarkdownPath('/Users/某人/周报')).toBe(false)
  })
})
```

- [ ] **Step 4: 跑测试，确认它红**

```bash
pnpm vitest run tests/unit/markdownParse.test.ts
```

期望：FAIL，`Failed to resolve import .../markdown/parse`。

- [ ] **Step 5: 写实现**

```ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root } from 'mdast'

/**
 * 工作文档的 md 解析。**全仓唯一 import remark 的地方。**
 *
 * 【为什么只解析、不渲染】裁剪与映射成 React 都在别的模块里，这里只负责
 * 「文本 → 带 position.offset 的语法树」。分开的理由是解析**只做一次**
 * （调用方按文档缓存），而后面几步每次渲染都要重跑——200KB 的 md 解析是几十毫秒
 * 量级，每次按键重解析不可接受。
 *
 * 【为什么返回 `Root | null` 而不是抛】调用方拿到 null 就退回纯文本那条路
 * （设计第 12 节：解析失败不许白屏）。remark 对畸形 md 基本不抛，这是兜底。
 *
 * 【position.offset 是整条路的坐标系地基】mdast 每个节点自带 `position.start.offset`
 * / `end.offset`，是**相对 flatText 的字符下标**——和 `cursor`、`revealStart` 同一个
 * 坐标系，所以裁剪时不需要任何换算（设计 3.1）。
 *
 * 【为什么 `unified` 实例提到模块级】`.use()` 会重建 processor，每次调用都建一遍
 * 是白扔的。processor 本身无可变状态，`.parse()` 也是纯的。
 *
 * 【ESM-only，别把它挪出渲染层】remark 全族是 `"type": "module"`。挪进 `src/core`
 * 会让 main 那份 tsconfig 也去解析它。Task 1 的用例守不住这条（类型检查才守得住），
 * 所以它是靠 `pnpm typecheck` 与这条注释一起守的。
 */
const processor = unified().use(remarkParse).use(remarkGfm)

export function parseMarkdown(text: string): Root | null {
  try {
    return processor.parse(text)
  } catch (err) {
    console.warn('[wt] 解析 markdown 失败，退回纯文本：', err)
    return null
  }
}

/**
 * 这份工作文档要不要渲染。
 *
 * 【为什么按扩展名而不是按内容嗅探】「内容长得像 md」判不准，而且判错的代价是
 * 双向的：把一份纯文本当 md 渲染会吃掉里面的 `*` 和 `#`，把一份 md 当纯文本
 * 又会露出记号。扩展名是用户的意图，也是他后来能自己改回来的东西。
 *
 * 【`.md.txt` 判 false 是有意的】`extname` 只看最后一段。用户的意图是 txt。
 */
const MARKDOWN_EXT = /\.(md|markdown)$/i

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_EXT.test(filePath)
}
```

- [ ] **Step 6: 跑测试，确认它绿**

```bash
pnpm vitest run tests/unit/markdownParse.test.ts
pnpm typecheck
```

期望：用例全过；`typecheck` exit 0。

**实测（Task 1 落地时的组合）：`processor.parse()` 的返回类型直接就是 `Root`，不需要任何显式断言。** 若将来换版本后报类型对不上，就地加一层显式断言并写清原因，**别改成 `any`**。

- [ ] **Step 6b: 补一条守降级路径的用例（它是 Step 6 那个 `catch` 的唯一 witness）**

Step 3 里那条用例名叫「解析不出来的输入返回 null，而不是抛出去」，但它喂的是**空串**——实测 remark 把空串**正常**解析成空 root，所以 `catch` 那个分支一次都没走到。

**实测证据**（Task 1 落地时做的，在一次性 worktree 里）：把 `parse.ts` 的 `try/catch` 去掉、只留 `return processor.parse(text)`，`markdownParse.test.ts` 那 6 条**照样全绿**，只有下面这一份文件会红。所以「解析失败退回纯文本、不许白屏」（设计第 12 节）这条契约，在补它之前是零覆盖的。

它必须是**单独一份文件**：`vi.mock` 是按文件提升的，塞进 `markdownParse.test.ts` 会把那个文件里其余用例也一起换掉 `unified`。

```ts
import { describe, it, expect, vi } from 'vitest'

/**
 * 【为什么单独一份文件】`vi.mock` 是按文件提升的，塞不进 markdownParse.test.ts。
 *
 * 这条守的是设计第 12 节那条降级契约：解析失败返回 null、不许把异常冒到调用方，
 * 调用方据此退回纯文本（不许白屏）。markdownParse.test.ts 里那条用例名字叫
 * 「解析不出来的输入返回 null」，但它喂的是空串——remark 把空串**正常**解析成
 * 空 root，`catch` 那条路一次都没走到。也就是说那边对 catch 是零覆盖，
 * 这条才是真正会红的那面 witness。
 *
 * 做法：把 `unified` 换成一个 parse 必抛的替身。`vi.mock` 的工厂会被提升到
 * import 之前，所以它只能自包含（要引用外层变量得用 `vi.hoisted`）——
 * 这里不需要外部变量，正好。
 */
vi.mock('unified', () => {
  const chain: { use: () => unknown; parse: () => never } = {
    use: () => chain,
    parse: () => {
      throw new Error('boom')
    }
  }
  return { unified: () => chain }
})

import { parseMarkdown } from '../../src/renderer/src/markdown/parse'

describe('parseMarkdown 的降级路径', () => {
  it('解析器抛异常时不冒到调用方：返回 null，并 warn 一行', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let result: ReturnType<typeof parseMarkdown> | undefined = undefined
    expect(() => {
      result = parseMarkdown('随便什么')
    }).not.toThrow()

    expect(result).toBeNull()
    // 别把错误吞得只剩一个 null——原始错误要一起交出来，否则线上无从查起
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('markdown')
    expect(warn.mock.calls[0][1]).toBeInstanceOf(Error)

    warn.mockRestore()
  })
})
```

写完做 witness 验证：去掉 `parse.ts` 的 `try/catch` → 确认**这一个文件红、而且只红这一条**；加回来 → 恢复绿。两边的结果都写进报告。

- [ ] **Step 7: 提交**

```bash
cat > /tmp/msg.txt <<'MSG'
feat(md): 加 markdown 解析 —— 文本到带字符偏移的语法树

工作文档的 .md 要渲染，第一步是解析。用 remark + GFM 得到 mdast，
每个节点自带 position.start.offset / end.offset，与 cursor / revealStart
是同一个坐标系，裁剪时不需要换算。

全仓唯一 import remark 的地方；ESM-only，只允许渲染层引用。
MSG
git add package.json pnpm-lock.yaml src/renderer/src/markdown/parse.ts tests/unit/markdownParse.test.ts tests/unit/markdownParseFallback.test.ts
git commit -F /tmp/msg.txt
```

---

## Task 2: `markdown/clip.ts` —— 决定「什么该显示」的纯函数

对应设计文档第 3.2 节（结构预知）、第 5 节，以及第 12 节里**折叠的边界这一半**（`from` 参数）。**折点的计算不在这个 Task**，在 Task 3 的 `pickFoldStart`。

**这是整个功能里唯一决定「什么该显示」的地方。** 它上面的组件只管把拿到的树画出来。这条边界是刻意的：它是唯一能被逐字钉死的部分，也是唯一会随口径变化的部分。

**Files:**
- Create: `src/renderer/src/markdown/clip.ts`
- Create: `tests/unit/markdownClip.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'
import { clipTree } from '../../src/renderer/src/markdown/clip'
import type { Root } from 'mdast'

const DOC = [
  '# 季度汇报', //         这一段从第 0 字开始
  '',
  '本季度共归档 3 项。', //  第二段
  '',
  '- 归档流程上线',
  '- 复核环节压缩到 2 天'
].join('\n')

/** 把树里所有文本拼起来，用来断言「屏幕上会出现哪些字」。 */
function textOf(node: unknown): string {
  const n = node as { value?: string; children?: unknown[] }
  if (typeof n.value === 'string') return n.value
  return (n.children ?? []).map(textOf).join('')
}

function typesOf(tree: Root): string[] {
  return tree.children.map((n) => n.type)
}

/** 深度遍历，收集树里出现过的所有节点类型——用来断言某个结构节点到底在不在。 */
function typesDeep(node: unknown): string[] {
  const n = node as { type?: string; children?: unknown[] }
  return [n.type ?? '', ...(n.children ?? []).flatMap((c) => typesDeep(c))]
}

const doc = parseMarkdown(DOC)!

/** 取某个字符串在 DOC 里的起始下标——用例里要按真实偏移切，不能拍脑袋写数字。 */
function at(s: string): number {
  const i = DOC.indexOf(s)
  if (i < 0) throw new Error(`夹具里没有这段字：${s}`)
  return i
}

describe('clipTree —— 结构预知', () => {
  it('光标之后的顶层块整个丢掉（还没开始的块不存在）', () => {
    const cut = at('本季度')
    const out = clipTree(doc, 0, cut)
    expect(typesOf(out)).toEqual(['heading'])
  })

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

  it('跨越光标的文本节点被截断，而不是整段出现或整段消失', () => {
    const cut = at('本季度共归档')
    const out = clipTree(doc, 0, cut + 3) // 「本季度」
    expect(textOf(out.children[1])).toBe('本季度')
  })

  it('整段在折点之前的块被丢掉（折叠前文）', () => {
    const from = at('本季度')
    const out = clipTree(doc, from, DOC.length)
    expect(typesOf(out)).toEqual(['paragraph', 'list'])
  })

  it('块内的行内结构：记号没抽到也不显示字，但结构节点在', () => {
    const src = '前**加粗**后\n'
    const t = parseMarkdown(src)!
    // 光标落在「加粗」的第一个字上：strong 节点已开始（** 在它之前）
    const out = clipTree(t, 0, src.indexOf('加粗'))
    expect(textOf(out.children[0])).toBe('前')
    // 【结构预知】这条用例的名字承诺了「结构节点在」，所以必须真的断言到结构——
    // 只断言文字的话，把 strong 整个丢掉这条照样绿（实测）。
    expect(typesDeep(out.children[0])).toContain('strong')
  })

  it('偏移之外的节点原样保留，不会把整棵树丢掉', () => {
    const out = clipTree(doc, 0, DOC.length)
    expect(typesOf(out)).toEqual(['heading', 'paragraph', 'list'])
    // 记号（`# ` 与 `- `）是由**结构**生成的，不在任何 text 节点里，所以按 text 节点
    // 拼出来天然不含它们。期望值要把行首记号去掉，不能拿 DOC 直接删换行。
    expect(textOf(out)).toBe(
      DOC.replace(/^(?:#|-)\s/gm, '').replace(/\n/g, '')
    )
  })

  it('光标在 0：整棵树是空的', () => {
    expect(clipTree(doc, 0, 0).children).toHaveLength(0)
  })
})

/**
 * 块内的**叶子**（没有 `value` 可裁、也没有 `children`）——图片、内嵌 HTML、
 * 脚注引用、硬换行。它们截不出「半个」，所以只能在「留整块」与「丢」之间二选一。
 *
 * 二选一的判据是**它自己的字符区间**（与顶层块同一条规则），不是「所在块已经开始」：
 * 留着没抽到的图片就等于提前去抓图（设计 8.2：只抓已经抽出来的那张），
 * 留着没抽到的 HTML 就等于把还没有揭示的字画到屏幕上。
 */
describe('clipTree —— 块内的叶子节点', () => {
  const IMG = '前 ![图](a.png) 后\n'

  it('还没抽到的图片不留在树里（留着就等于提前发 IPC 去抓图）', () => {
    const out = clipTree(parseMarkdown(IMG)!, 0, IMG.indexOf('前') + 1) // 只抽到「前」
    expect(textOf(out)).toBe('前')
    expect(typesDeep(out)).not.toContain('image')
  })

  it('光标落在图片源码中间：图片整张在树里（设计 8.3，一揭示就整张出现）', () => {
    // 这条与上一条一起把边界钉死：判据是图片**自己的起始偏移**，不是它的结束偏移
    // ——路径还没抽完时图就该跳出来，而它一旦开始就整张出现、不做半张。
    const out = clipTree(parseMarkdown(IMG)!, 0, IMG.indexOf('a.png'))
    expect(typesDeep(out)).toContain('image')
  })

  it('光标推过整张图之后：图片还在（上一条的反面对照）', () => {
    const out = clipTree(parseMarkdown(IMG)!, 0, IMG.length)
    expect(typesDeep(out)).toContain('image')
    expect(textOf(out)).toContain('后')
  })

  it('还没抽到的内嵌 HTML 标签同样不留在树里', () => {
    const src = '前文 <span>后面</span>\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('前文') + 2) // 只抽到「前文」
    expect(typesDeep(out)).not.toContain('html')
    expect(textOf(out)).toBe('前文')
  })

  it('折点已经翻过去的图片也丢掉（叶子看的是自己的区间，不是所在块开没开始）', () => {
    // from 落在块**中间**：`revealStart` 是 jumpToChapter 抬起来的，可以落在任何位置，
    // 所以「块留着、块里的图在窗口之外」是会发生的。留着它就等于给一张窗口外的图发
    // IPC 去抓（设计 8.2）。边界是 `end <= from`——这条用例正好卡在 end == from 上。
    const from = IMG.indexOf(' 后')
    const out = clipTree(parseMarkdown(IMG)!, from, IMG.length)
    expect(typesDeep(out)).not.toContain('image')
    expect(textOf(out)).toContain('后')
  })
})

/**
 * 内嵌 HTML 的 `value` 里**连文字一起**（块级 HTML 是一个整节点：`<div>后面的话</div>`
 * 是 0..15 的一个 html 节点）。所以它不能像图片那样「一揭示就整体出现」，两条路都堵着：
 *
 * - 从中间切开 → 得到 `<di` 这种碎片，`tokenizeHtml` 认不出它是标签、会当普通文字吐出来，
 *   等于把裸源码字符弄上屏；
 * - 不切、整块留着 → 未揭示的字跟着一起上屏。
 *
 * 于是只有第三条路：**等它整个抽完（`end <= to`）才出现**。图片、脚注引用、硬换行没有这个
 * 问题（它们没有文字，切不出半个也无所谓），仍然是一开始揭示就整体出现。
 */
describe('clipTree —— 内嵌 HTML 等抽完才出现', () => {
  const BLOCK = '<div>后面的话</div>\n'

  it('块级 HTML 抽到一半：不在树里，未揭示的字也不在', () => {
    const out = clipTree(parseMarkdown(BLOCK)!, 0, BLOCK.indexOf('后') + 1) // 刚过 `<div>后`
    expect(typesDeep(out)).not.toContain('html')
    expect(textOf(out)).not.toContain('面的话')
  })

  it('块级 HTML 抽完之后：在树里，value 是完整那串（反面对照）', () => {
    const out = clipTree(parseMarkdown(BLOCK)!, 0, BLOCK.length)
    expect(typesDeep(out)).toContain('html')
    expect(textOf(out)).toContain('<div>后面的话</div>')
  })

  it('行内 HTML 抽到一半（光标在标签中间）：不在树里', () => {
    // 【为什么单补这一条】上一条「还没抽到的内嵌 HTML 不留在树里」喂的是 to = 2，那时
    // html 节点**还没开始**，是叶子那条 `start >= to` 把它挡掉的——把 html 这条规则整个
    // 撤掉，那条用例照样绿。要真正压住 html 规则，光标必须落在**标签中间**（start < to
    // 而 end > to），也就是这一条。
    const src = '前文 <span>后面</span>\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('<span>') + 3) // 光标在 `<spa|n>` 里
    expect(typesDeep(out)).not.toContain('html')
    expect(textOf(out)).not.toContain('后面')
  })

  it('行内 HTML 刚好抽完：在树里（边界是 end <= to，取等）', () => {
    const src = '前文 <span>后面</span>\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('后面')) // `<span>` 的 end 正好是 9
    expect(textOf(out)).toContain('<span>')
    expect(textOf(out)).not.toContain('</span>') // 闭合标签还没抽到，不在
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

```bash
pnpm vitest run tests/unit/markdownClip.test.ts
```

期望：FAIL，`Failed to resolve import .../markdown/clip`。

- [ ] **Step 3: 写实现**

```ts
import type { Content, Root } from 'mdast'

/**
 * 按字符偏移裁剪语法树：树进、树出。**纯函数，没有副作用，不碰 DOM。**
 *
 * 【三条规则，合起来就是「结构预知」】
 *
 * 1. **顶层块的起始偏移 ≥ to 的整个丢掉**。光标还没走到的块，屏幕上一点都不该有
 *    ——这是「还没开始的块不存在」。
 * 2. **跨越 to 的文本被截断**。剩下的部分照常显示。
 * 3. **块内的叶子（没 `value` 可裁、也没 `children`）按它自己的区间判**：没开始就丢。
 *    它们截不出「半个」，留着就等于提前把没揭示的东西弄上屏——图片会提前发 IPC 去抓
 *    （设计 8.2：只抓已经抽出来的那张）。**内嵌 HTML 是其中的特例，要等抽完**，理由见下。
 *
 * 【规则 1 只在顶层判，块内的容器结构一个都不丢】这不是省事，是设计 3.2 钉死的口径：
 * **「块」= `root.children`（mdast 根节点的直接子节点）**，表格的行、列表的项都
 * **不是**块，而是块的内部结构——「一旦所在的块被保留，它们整体跟着保留」。
 *
 * 于是「已经开始、但没抽完」的块会**保留完整结构**：表格的表头一露头，整张网格
 * 就在树里了，只是后面几行的文字是空的；列表的第一项开始揭示时，后面几项也在，
 * 只是文字是空的。这正是设计 3.2 那条——看着像「正在填表」，
 * 代价是提前泄露「后面还有几行」这类结构信息，这是明确接受的。
 *
 * **把规则 1 也用到块内部是错的**（本模块第一版就是这么写的）：那样表格只会画出
 * 已揭示的那几行，整张网格画不出来，上面那条口径当场失效。判据是设计 3.2 与
 * 计划末尾验收清单第 9 条，不是任何一条单测。
 *
 * 【规则 3 与规则 1 的边界在哪】保留与否一律看**节点自己的区间**，与「它所在的块开没
 * 开始」无关。差别只在后果：块内容器丢不得（丢了整张网格就没了），块内叶子非丢不可
 * （留着就是提前抓图 / 提前上屏）。所以两条规则不矛盾，是同一条判据落在两类节点上。
 *
 * 【为什么 from 也要判】它是折点（折叠前文）或 revealStart。折点是按块边界算的，
 * 但 `revealStart` 不是——`jumpToChapter` 抬起来的那个值可能落在块中间，所以两边
 * 都要能切。`from` 落在块中间时，块本身留着，块内 `from` 之前的那部分文字被截成空。
 *
 * 【三类节点】只有 `text` / `code` / `inlineCode` 三个带**可裁**的 `value`（截断）；
 * 有 `children` 的（段落、列表、表格…）递归下去裁（结构不丢）；
 * 剩下的叶子（图片、分隔线、脚注引用、硬换行、内嵌 HTML）整块留或整个丢。
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

export function clipTree(root: Root, from: number, to: number): Root {
  return { ...root, children: clipBlocks(root.children, from, to) as Root['children'] }
}

/**
 * 顶层块：**保留还是丢掉只在这一层判**（设计 3.2）。
 * 留下来的块交给 `clipInside`，那里只截断、不丢。
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

/**
 * 已经开始揭示的块**内部**：容器结构一个都不丢，块内三类节点各按各的规则裁。
 *
 * 【为什么返回值可以是 null】块内的**叶子**（图片、内嵌 HTML、脚注引用、硬换行）
 * 截不出「半个」，只能在「留整块」与「丢」之间二选一，二选一的判据是它**自己的**
 * 字符区间。于是这里也会丢节点，调用方必须过滤。
 *
 * 【为什么叶子也要按窗口判，而不是「所在块已经开始就留着」】留着没抽到的图片 = 提前
 * 发 IPC 去抓图（设计 8.2：只抓已经抽出来的那张）；留着没抽到的 HTML = 把还没有揭示的
 * 字画到屏幕上（内嵌 HTML 的 `value` 里连文字一起，见下面第三支）。两条都破契约。
 *
 * 三支的分派依据是「有没有可裁的 `value` / 有没有 `children`」，不是节点类型：
 * 类型逐个窄化在这里会变成几十行只做类型收窄、不做任何事的代码。
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
    // 位置都没有就没法按偏移切，原样保留（宁可多显示，也不丢字）
    if (start === undefined) return node
    const head = Math.max(0, from - start)
    const tail = Math.max(head, to - start)
    return { ...n, value: n.value.slice(head, tail) } as unknown as ClipNode
  }
  // 第二支：容器——递归下去裁，**结构本身不丢**（设计 3.2：块内的行、项整体跟着保留）
  if (Array.isArray(n.children)) {
    const children = n.children
      .map((child) => clipInside(child, from, to))
      .filter((child): child is ClipNode => child !== null)
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

```bash
pnpm vitest run tests/unit/markdownClip.test.ts
pnpm typecheck
```

期望：全过，exit 0。

**这一节在实施时被实测改掉了两处，都在计划作者这边**（实施者把片段原样跑了一遍，7 条里红 2 条）：

1. **规则写错了一处。** Step 3 那个片段把「起始偏移 ≥ to 就丢掉」也用在**块内部**，于是列表的第二项、表格的后面几行会被整条丢掉——而设计 3.2 要的是「块一旦保留，它的内部结构整体跟着保留、只有文字是空的」。**丢弃只在顶层判，块内只截断。** 交付的 `clip.ts` 已按后者实现。
2. **夹具断言写错了一条。** 「偏移之外的节点原样保留」原本期望 `DOC.replace(/\n/g, '')`，但 `# ` 与 `- ` 这两个记号**不由任何 text 节点承载**（它们是结构），所以期望值要按结构记号去掉。交付的用例已按后者写。

同一条规则在实施中还补了一条**只有跑起来才看得见**的：**内嵌 HTML 的节点按「抽完才出现」判**（`end <= to`），而不是像图片那样「一揭示就整体出现」。原因是块级 HTML 的 `value` 里**连标签内的文字一起**，从中间切开只会得到 `<di` 这种碎片。设计文档 3.2 已补上这条。

- [ ] **Step 5: 提交**

```bash
cat > /tmp/msg.txt <<'MSG'
feat(md): 加按字符偏移裁剪语法树 —— 结构预知的落点

clipTree(树, from, to) 是纯函数：起始偏移 >= to 的节点整个丢掉，跨越 to 的
文本截断。于是「已经开始、没抽完」的块保留完整结构、后面几行的文字是空的，
就是设计里那条「一露头就画全、像正在填表」。

只有 text / code / inlineCode 三个类型算可裁文本；图片、分隔线、脚注引用、
内嵌 HTML **等整个抽完才出现**（`end <= to`）—— 它不能像图片那样一揭示就整体
出现，因为块级 HTML 的 value 里连标签内的文字一起，切开只会得到 `<di` 这种碎片。

文本节点里的转义与实体解码后比源码短，这里按解码后的字符近似切，
偏差不超过转义个数且不越过节点边界；无转义时精确。
MSG
git add src/renderer/src/markdown/clip.ts tests/unit/markdownClip.test.ts
git commit -F /tmp/msg.txt
```

---

## Task 3: `markdown/fill.ts` —— 铺满切点与折叠切点的两个纯函数

对应设计文档第 7 节（铺满）与第 12 节最后一行（折叠）。

**Files:**
- Create: `src/renderer/src/markdown/fill.ts`
- Create: `tests/unit/markdownFill.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest'
import { pickFillCut, pickFoldStart } from '../../src/renderer/src/markdown/fill'

/** 三个块，高度分别是 400 / 300 / 300，结束偏移 100 / 200 / 300。 */
const THREE = [
  { end: 100, height: 400 },
  { end: 200, height: 300 },
  { end: 300, height: 300 }
]

describe('pickFillCut', () => {
  it('装得下几个就铺几个，切点落在块边界上', () => {
    // 700 这一条就是「恰好等于时算装得下」那条边界：400 + 300 正好 700，
    // 改成 `>=` 会在这里断掉（返回 100 而不是 200）
    expect(pickFillCut(THREE, 700)).toBe(200)
    expect(pickFillCut(THREE, 699)).toBe(100)
    expect(pickFillCut(THREE, 1000)).toBe(300)
  })

  it('目标高度为 0 或负数：一个字都不铺', () => {
    // 铺满 0% 是一个合法设置（老板键那个旋钮能调到 0），此时就该是空白——
    // 绝不能因为「一个块都没装下」而触发下面那条兜底
    expect(pickFillCut(THREE, 0)).toBe(0)
    expect(pickFillCut(THREE, -10)).toBe(0)
  })

  it('第一个块就超过一页：铺满那一个块', () => {
    // 宁可溢出一页，也不能铺出一张白纸。
    // 目标高度是 0.5 这种「大于 0 却一个块都装不下」的也算这一条——
    // 只有 <= 0 才走「一个字都不铺」那条。
    expect(pickFillCut(THREE, 100)).toBe(100)
    expect(pickFillCut(THREE, 0.5)).toBe(100)
    expect(pickFillCut([{ end: 999, height: 5000 }], 912)).toBe(999)
  })

  it('空文档返回 0', () => {
    expect(pickFillCut([], 912)).toBe(0)
  })

  it('高度为 0 的块照常算装得下（分隔线这类）', () => {
    expect(pickFillCut([{ end: 10, height: 0 }, { end: 20, height: 900 }], 912)).toBe(20)
  })
})

describe('pickFoldStart', () => {
  const SPANS = [
    { start: 0, end: 100 },
    { start: 100, end: 200 },
    { start: 200, end: 400 }
  ]

  it('从末尾往前累加字符数，返回最早那个要保留的块的起始偏移', () => {
    expect(pickFoldStart(SPANS, 200)).toBe(200) // 最后一块正好 200 字
    expect(pickFoldStart(SPANS, 201)).toBe(100) // 再加一块
    expect(pickFoldStart(SPANS, 100)).toBe(200) // 最后一块就超了，只留它
  })

  it('全篇都不够上限：一个字都不折', () => {
    expect(pickFoldStart(SPANS, 99999)).toBe(0)
  })

  it('空文档返回 0', () => {
    expect(pickFoldStart([], 30000)).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

```bash
pnpm vitest run tests/unit/markdownFill.test.ts
```

期望：FAIL，`Failed to resolve import .../markdown/fill`。

- [ ] **Step 3: 写实现**

```ts
/**
 * 铺满切点与折叠切点。**两个纯函数，没有 DOM、没有副作用。**
 *
 * 【为什么切点要停在块边界】铺满一页时如果切在半句话、半张表、半个引用块上，
 * 屏幕底部就是残缺的东西——而这正是老板键要避免的「看起来不对」。切在块边界上，
 * 屏幕上永远是一整块一整块的（设计第 7 节）。
 *
 * 【为什么不在这里量高度】量高度要真实布局，只有 DOM 里有。这里吃的是**已经量好的
 * 高度表**，所以它是纯的、能单测；量不出来时调用方退回按字符数（见 Task 11）。
 * 这条分界是本功能唯一一处「jsdom 判不了」的地方，拆开就是为了让它别变成零覆盖。
 */

/** 一个顶层块的结束偏移与它的渲染高度。 */
export interface BlockHeight {
  /** 这个块在 `flatText` 里的结束偏移 */
  readonly end: number
  /** 它的渲染高度（px） */
  readonly height: number
}

/** 一个顶层块的字符跨度。折叠时只关心字符数，不关心高度。 */
export interface BlockSpan {
  readonly start: number
  readonly end: number
}

/**
 * 选铺满切点：从前往后累加块高，装得下就继续，装不下就停，返回**最后一个装得下的块的
 * 结束偏移**。调用方把它喂给 `engine.revealTo()`。
 *
 * 两条边界都是有意的：
 * - `targetHeight <= 0` 返回 0。铺满 0% 是合法设置，那时就该是空白。
 * - **一个块都装不下时铺满第一个块**。第一个块就超过一页（比如开头就是一张大表），
 *   返回 0 会让画面全白——宁可溢出一页。
 */
export function pickFillCut(blocks: readonly BlockHeight[], targetHeight: number): number {
  if (targetHeight <= 0 || blocks.length === 0) return 0
  let acc = 0
  let cut = 0
  let fitted = false
  for (const b of blocks) {
    if (acc + b.height > targetHeight) break
    acc += b.height
    cut = b.end
    fitted = true
  }
  return fitted ? cut : blocks[0].end
}

/**
 * 选折叠切点：从末尾往前累加各块的**字符数**，到 `limit` 为止，返回那个块的起始偏移。
 * 这个偏移之下（含）的块都是「前文」，折叠起来。
 *
 * 【为什么按字符数而不是按高度】折叠发生在渲染之前，那时没有布局信息，也不该为了折叠
 * 去量一次高度。字符数是现成的。所以这里**不复用 `pickFillCut`**——两个函数吃的
 * 根本不是同一种输入。
 */
export function pickFoldStart(blocks: readonly BlockSpan[], limit: number): number {
  if (blocks.length === 0) return 0
  let acc = 0
  let start = blocks[blocks.length - 1].start
  for (let i = blocks.length - 1; i >= 0; i--) {
    start = blocks[i].start
    acc += blocks[i].end - blocks[i].start
    if (acc >= limit) break
  }
  return start
}
```

- [ ] **Step 4: 跑测试，确认它绿**

```bash
pnpm vitest run tests/unit/markdownFill.test.ts
pnpm typecheck
```

期望：全过，exit 0。

**这一节在实施时改掉了一条断言**（计划作者抄错的）：Step 1 里 `expect(pickFillCut(THREE, 0.5)).toBe(0)` 与它所在用例的标题（「恰好等于时算装得下」）、与 Step 3 的实现、与设计第 7 节的兜底 1 都对不上——`0.5 > 0` **不触发**那条提前返回，第一个块高 400 装不下，于是走兜底、返回 `blocks[0].end`（100）。交付的用例把它挪进「第一个块就超过一页」那条并断言 100，另加一句注释说清「只有 `<= 0` 才是一个字都不铺」。**Step 3 的实现片段一字未动。**

**上面那句里提到的「恰好等于时算装得下」那条用例，后来被删掉了。** 规格评审量出来它是空转的：`fitted` 与「一个块都装不下」两条路都返回 `blocks[0].end`，所以把 `>` 改成 `>=` 时它照样绿（红的是旁边那条）。那条边界（400 + 300 正好 700）由 Step 1 第一句 `expect(pickFillCut(THREE, 700)).toBe(200)` 覆盖，已在那里注明；删掉后那条变异仍然红。

- [ ] **Step 5: 提交**

```bash
cat > /tmp/msg.txt <<'MSG'
feat(md): 加铺满切点与折叠切点两个纯函数

pickFillCut 吃「块的结束偏移 + 高度」表，选最后一个装得下的块作为切点，
于是铺满一页永远停在块边界上（不切半句话、半张表）。两条边界：目标高度
<= 0 返回 0（铺满 0% 是合法设置）；一个块都装不下时铺满第一个块
（宁可溢出一页也不铺出白纸）。

pickFoldStart 从末尾往前按字符数累加。折叠发生在渲染之前、没有布局信息，
所以它与 pickFillCut 不共用实现。
MSG
git add src/renderer/src/markdown/fill.ts tests/unit/markdownFill.test.ts
git commit -F /tmp/msg.txt
```

---

## Task 4: `markdown/html.ts` —— 内嵌 HTML 的白名单标签切分

对应设计文档第 11 节。

**这一节是安全边界的一部分，写测试时不要只测「白名单内的能用」，要**逐条**测「白名单外的进不来」**——那段代码的价值全在后者。

**Files:**
- Create: `src/renderer/src/markdown/html.ts`
- Create: `tests/unit/markdownHtml.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest'
import { tokenizeHtml } from '../../src/renderer/src/markdown/html'
import type { HtmlToken } from '../../src/renderer/src/markdown/html'

/** 把所有 text token 拼起来。断言「哪些字上了屏」比逐 token 对着写更贴核心不变量。 */
function textOf(tokens: HtmlToken[]): string {
  return tokens
    .filter((t) => t.kind === 'text')
    .map((t) => t.value)
    .join('')
}

describe('tokenizeHtml —— 白名单', () => {
  it('白名单标签切成 open / close', () => {
    expect(tokenizeHtml('<div>内容</div>')).toEqual([
      { kind: 'open', tag: 'div' },
      { kind: 'text', value: '内容' },
      { kind: 'close', tag: 'div' }
    ])
  })

  it('自闭合与空元素', () => {
    expect(tokenizeHtml('<br>')).toEqual([{ kind: 'void', tag: 'br' }])
    expect(tokenizeHtml('<hr/>')).toEqual([{ kind: 'void', tag: 'hr' }])
  })

  it('标签名大小写不敏感', () => {
    expect(tokenizeHtml('<B>x</B>')).toEqual([
      { kind: 'open', tag: 'b' },
      { kind: 'text', value: 'x' },
      { kind: 'close', tag: 'b' }
    ])
  })

  /**
   * 【这一组才是这个模块存在的理由】白名单之外的标签：标签本身丢掉，
   * **里面的文字照旧留下**（设计第 11 节的口径）。
   */
  it('白名单外的标签被丢掉，里面的文字留下', () => {
    expect(tokenizeHtml('<script>alert(1)</script>')).toEqual([
      { kind: 'text', value: 'alert(1)' }
    ])
    expect(tokenizeHtml('<iframe src="http://x"></iframe>')).toEqual([])
    expect(tokenizeHtml('<blink>闪</blink>')).toEqual([{ kind: 'text', value: '闪' }])
  })

  it('属性一律丢掉，包括 style / class / on*', () => {
    expect(tokenizeHtml('<div style="color:red" onclick="x()" class="a">t</div>')).toEqual([
      { kind: 'open', tag: 'div' },
      { kind: 'text', value: 't' },
      { kind: 'close', tag: 'div' }
    ])
  })

  it('带引号的属性里有 > 也不会把标签切断', () => {
    expect(tokenizeHtml('<div title="a>b">t</div>')).toEqual([
      { kind: 'open', tag: 'div' },
      { kind: 'text', value: 't' },
      { kind: 'close', tag: 'div' }
    ])
  })

  it('没有标签时就是一整段文字', () => {
    expect(tokenizeHtml('就是文字')).toEqual([{ kind: 'text', value: '就是文字' }])
  })

  it('空字符串什么也不产出', () => {
    expect(tokenizeHtml('')).toEqual([])
  })

  it('不配对的标签也照切（合不合成树是渲染那一层的事）', () => {
    expect(tokenizeHtml('<div>开')).toEqual([
      { kind: 'open', tag: 'div' },
      { kind: 'text', value: '开' }
    ])
  })

  /**
   * 【属性段必须按 HTML 规范的 ASCII 名字收窄】不是洁癖，是核心不变量：
   * 属性段一旦允许任意字符，「`<` 紧跟字母」到下一个 `>` 之间的东西就会被**当属性吃掉**，
   * 于是那段字上不了屏——正是「已揭示的字少上屏」。
   *
   * 下面两条喂的都是**真能从 markdown 走到这里**的输入：块级 HTML 整段是一个 html 节点、
   * 原样送进来（`<div>后面的话</div>` 那种），所以注释结束符那样的字面量、中文，
   * 都会跟着 `<` 一起到。
   */
  it('`<b */>` 不是标签：`*/` 一个字不丢，也不凭空多出一个 b', () => {
    const out = tokenizeHtml('<style>/* a<b */</style>')
    expect(textOf(out)).toContain('/* a<b */')
    expect(out).not.toContainEqual({ kind: 'open', tag: 'b' })
  })

  it('属性名不是 ASCII 名字时不按标签吃：`<b 且 c>` 整段落回文字', () => {
    // 块级 HTML `<div>\n如果 a<b 且 c>d\n</div>` 就是一个 html 节点，
    // 中文与尖括号一起原样进来——这条不是为了凑输入而构造的。
    const out = tokenizeHtml('<div>\n如果 a<b 且 c>d\n</div>')
    expect(textOf(out)).toContain('如果 a<b 且 c>d')
    expect(out).not.toContainEqual({ kind: 'open', tag: 'b' })
  })

  it('ASCII 属性名仍然算标签（`<b and c>` 按规范本来就是标签，别顺手改严）', () => {
    expect(tokenizeHtml('a <b and c> d')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'open', tag: 'b' },
      { kind: 'text', value: ' d' }
    ])
  })
})

/**
 * 【注释为什么单独一组】它既不是白名单标签、也不属于「标签丢掉、文字留下」那一类
 * ——注释里没有给人看的文字。整段丢掉是设计第 11 节的口径；不丢的话它**不是标签**
 * （标签匹配式够不着 `<!`），会原样成为屏幕上的字面文字。
 */
describe('tokenizeHtml —— HTML 注释', () => {
  it('整段丢掉，一个字都不上屏', () => {
    expect(tokenizeHtml('<!-- 这是注释 -->')).toEqual([])
    expect(tokenizeHtml('<!--多行\n注释\n-->')).toEqual([])
  })

  it('夹在文字与标签之间的注释：文字与标签照旧，注释消失', () => {
    expect(textOf(tokenizeHtml('前<!-- 注 -->后'))).toBe('前后')
    expect(tokenizeHtml('<div>a<!-- c -->b</div>')).toEqual([
      { kind: 'open', tag: 'div' },
      { kind: 'text', value: 'a' },
      { kind: 'text', value: 'b' },
      { kind: 'close', tag: 'div' }
    ])
  })

  it('注释里的标签不算标签', () => {
    // 注释内的 <script> 只是注释的一部分，不该被切成 token——更不该被执行
    expect(tokenizeHtml('<!-- <script>alert(1)</script> -->')).toEqual([])
    expect(tokenizeHtml('<!-- <div> -->')).toEqual([])
  })

  it('没有收尾的注释按 HTML 规范吃到末尾', () => {
    // 注释一直没关：`-->` 之后的一切都是注释，于是后面那个 <div> 也一起没了
    expect(tokenizeHtml('<!-- 没关')).toEqual([])
    expect(tokenizeHtml('<!-- 没关\n<div>内容</div>')).toEqual([])
    // 末尾恰好是个换行时也得吃干净：这一支写成 `[^\n]*` 就只吃掉第一行，
    // 剩下的 `\n`（以及再多行的正文）会落回 text 上屏 —— 这条钉的就是那件事
    expect(tokenizeHtml('<!-- 没关\n')).toEqual([])
    expect(textOf(tokenizeHtml('<!-- 没关\n第二行'))).toBe('')
  })

  it('`<!` 后面不是 `--` 的（doctype 之类）不是注释，也不该被吃掉', () => {
    // 这条钉的是「别把注释那条规则写宽」：`<!doctype html>` 现在按普通文字上屏，
    // 是有意留着的现状（设计第 11 节只处置注释），改动它要另开一条口径
    expect(textOf(tokenizeHtml('<!doctype html>'))).toBe('<!doctype html>')
  })
})

/**
 * 【第二组：白名单之外】对应设计文档第 11 节「安全边界」。
 *
 * 上面那一组测的是**切分对不对**，这一组测的是**挡没挡住**。这个模块的价值全在
 * 后者——所以这里逐条来，一条标签一条断言，别用一个样本代表一整类。
 */
describe('tokenizeHtml —— 白名单之外（安全边界）', () => {
  /** 拿不到门票的标签，逐个走一遍。含能执行脚本的与能取网络的。 */
  const NOT_ALLOWED = [
    'script',
    'iframe',
    'img',
    'svg',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'style',
    'link',
    'meta',
    'base',
    'template',
    'video',
    'audio',
    'canvas',
    'math',
    'a',
    'table'
  ]

  it('逐条：白名单外的标签整个丢掉，里面的文字按普通文字留下', () => {
    for (const tag of NOT_ALLOWED) {
      // 标签名一起塞进比较值：红的时候能一眼看出是哪个标签漏了，不用去数第几行
      expect([tag, tokenizeHtml(`<${tag}>t</${tag}>`)]).toEqual([tag, [{ kind: 'text', value: 't' }]])
      // 开标签、闭标签各自单独出现时也一个 token 都不产出
      expect([tag, tokenizeHtml(`<${tag}>`)]).toEqual([tag, []])
      expect([tag, tokenizeHtml(`</${tag}>`)]).toEqual([tag, []])
    }
  })

  it('事件属性带不出执行面：整条标签连同属性一起丢', () => {
    expect(tokenizeHtml('<img src=x onerror="alert(1)">')).toEqual([])
    expect(tokenizeHtml('<svg onload=alert(1)></svg>')).toEqual([])
    expect(tokenizeHtml('<a href="javascript:alert(1)">点</a>')).toEqual([{ kind: 'text', value: '点' }])
  })

  it('引号里的尖括号夹带不出一个标签', () => {
    // 属性值里的 `<script>` 只是属性值。匹配式先整段吃掉引号里的内容，
    // 所以它字面上长得像标签也不该被切出来。
    expect(tokenizeHtml('<div title="<script>">t</div>')).toEqual([
      { kind: 'open', tag: 'div' },
      { kind: 'text', value: 't' },
      { kind: 'close', tag: 'div' }
    ])
  })

  it('白名单里的标签逐个都在（设计文档第 11 节列的那 18 个）', () => {
    const ALLOWED_TAGS = [
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'del',
      'sub',
      'sup',
      'span',
      'div',
      'p',
      'code',
      'pre',
      'small',
      'mark'
    ]
    for (const tag of ALLOWED_TAGS) {
      expect([tag, tokenizeHtml(`<${tag}>`)]).toEqual([tag, [{ kind: 'open', tag }]])
    }
    expect(tokenizeHtml('<br>')).toEqual([{ kind: 'void', tag: 'br' }])
    expect(tokenizeHtml('<hr>')).toEqual([{ kind: 'void', tag: 'hr' }])
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

```bash
pnpm vitest run tests/unit/markdownHtml.test.ts
```

期望：FAIL，`Failed to resolve import .../markdown/html`。

- [ ] **Step 3: 写实现**

```ts
/**
 * 内嵌 HTML 的**白名单**切分。产出的是 token，不是 HTML 字符串——
 * 这一层与它的调用方**都不碰 `innerHTML`**（设计第 11 节）。
 *
 * 【安全口径，三条一起读】
 *
 * 1. **只有白名单里的标签名会变成 token**，其余标签整个丢掉，但**里面的文字留下**
 *    （`<script>alert(1)</script>` → 文字 `alert(1)`）。它永远不会被执行，因为
 *    没有任何一步把它当代码看。
 * 2. **属性一律丢掉**，包括 `style`。留着 `style` 等于让文档控制页面外观，
 *    而外观正是这个应用用来伪装的东西。
 * 3. 因此这个模块**不需要**「清洗」：它产出的 token 只带标签名，
 *    不存在能把属性带出去的形状。
 *
 * 【为什么自己写而不上 sanitize 那一套】白名单只有十几个标签、属性全丢，
 * 需求比通用清洗器小一个数量级；自己写还能保证「不配对的标签怎么办」这类边角
 * 完全由本仓库决定，而不是跟着某个包的默认 schema 走。
 *
 * 【一处不做的事】token 里的文字**不解码 HTML 实体**（`&amp;` 原样显示）。
 * 工作文档里的裸 HTML 本就罕见，为一个罕见分支引入实体表不划算。
 */
const ALLOWED = new Set([
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'del',
  'sub',
  'sup',
  'span',
  'div',
  'p',
  'code',
  'pre',
  'small',
  'mark',
  'hr'
])

/** 空元素：没有闭合标签，也不该被当成「开了一个还没关的标签」。 */
const VOID = new Set(['br', 'hr'])

export type HtmlToken =
  | { kind: 'open'; tag: string }
  | { kind: 'close'; tag: string }
  | { kind: 'void'; tag: string }
  | { kind: 'text'; value: string }

/**
 * 标签的匹配式。三处都不能改松：
 *
 * 1. **属性段按 HTML 规范写**（ASCII 属性名 + 可选的值），不用「任何字符」那种宽松写法。
 *    宽松写法会把「`<` 紧跟字母」到下一个 `>` 之间的东西整个当属性吃掉，
 *    于是那段字**上不了屏**——比如块级 HTML `<div>\n如果 a<b 且 c>d\n</div>`
 *    （整段是一个 html 节点，会原样送到这里），` 且 c` 会被当成 `<b>` 的属性吞掉，
 *    还凭空多出一个 `open b`。按规范收紧后 `且` 不是合法属性名，`<b 且 c>` 整个
 *    匹配不上、整段落回 text 照常上屏。
 *    而 `<b and c>` 仍然匹配——按 HTML 规范**那本来就是标签**，不是缺陷。
 * 2. **属性值要能含 `>`**（引号里先整段吃掉），否则 `<div title="a>b">` 会被那个 `>`
 *    切断——这是这类正则最常见的错法。
 * 3. **注释排在最前面**（`<!-- … -->`，见下面那条 `if`）：注释不是标签，
 *    不先吃掉它，它就会整段落回 text 上屏（设计第 11 节要它消失）。
 *    第二支注释是**没有收尾**的那一种：按 HTML 规范它一直吃到**输入末尾**。
 *    那支要写成 `[\s\S]*`——**别用 `[^\n]*`，也别给它加锚点**：`[^\n]*` 只会吃掉
 *    第一行，后面的字整段落回 text 上屏；而锚点更阴——`$` 在 JS 里不带 `m` 时是
 *    「输入末尾」（看着能用），一旦有人给这个匹配式补上 `m`（本文件的 flags 是从
 *    `TAG` 取的，`g` 顺手写成 `gm` 太容易了），`$` 就变成「行尾」，注释只吃掉第一行。
 *    这两条边界各有一条用例钉着。
 *    `<!` 后面**不是** `--` 的（doctype / CDATA 之类）不在这条规则的范围内。
 */
const TAG =
  /<!--[\s\S]*?-->|<!--[\s\S]*|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*)(\/?)>/g

export function tokenizeHtml(raw: string): HtmlToken[] {
  const out: HtmlToken[] = []
  // 【正则建在函数里，不做成模块级常量】带 `g` 的正则有 `lastIndex` 状态，
  // 模块级共享意味着两个调用交错时会读到对方的进度。这里是同步的，不会交错，
  // 但那种 bug 一旦出现极难查，不值得为省一次 RegExp 构造去冒。
  const re = new RegExp(TAG.source, TAG.flags)
  let last = 0
  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) {
    if (m.index > last) out.push({ kind: 'text', value: raw.slice(last, m.index) })
    last = m.index + m[0].length
    // 注释整段丢掉（设计第 11 节）：它是写给作者看的，不是内容。这里靠「匹配到的
    // 是什么」分叉，不看捕获组——注释那一支的 `m[1]` / `m[2]` 是 undefined。
    if (m[0].startsWith('<!--')) continue
    const tag = m[2].toLowerCase()
    if (!ALLOWED.has(tag)) continue
    if (m[1] === '/') out.push({ kind: 'close', tag })
    else if (m[4] === '/' || VOID.has(tag)) out.push({ kind: 'void', tag })
    else out.push({ kind: 'open', tag })
  }
  if (last < raw.length) out.push({ kind: 'text', value: raw.slice(last) })
  return out
}
```

- [ ] **Step 4: 跑测试，确认它绿**

```bash
pnpm vitest run tests/unit/markdownHtml.test.ts
pnpm typecheck
```

期望：全过，exit 0。

- [ ] **Step 5: 提交**

```bash
cat > /tmp/msg.txt <<'MSG'
feat(md): 加内嵌 HTML 的白名单切分

产出 token 而不是 HTML 字符串，这一层与它的调用方都不碰 innerHTML。
白名单外的标签整个丢掉、里面的文字留下；属性一律丢掉（含 style）。
自己写而不是上通用清洗器：白名单只有十几个标签，需求小一个数量级，
且边角行为由本仓库决定。
MSG
git add src/renderer/src/markdown/html.ts tests/unit/markdownHtml.test.ts
git commit -F /tmp/msg.txt
```

---

## Task 5: `markdown/toReact.tsx` 与 `markdown/MarkdownImage.tsx` —— 树映射成 React 元素

对应设计文档第 4 节（语法表）与第 9 节。

**图片这一节是占位版**：本任务只画一个框加替代文字，真正去取图是 Task 9。这样每个 Task 自己都是绿的，不会出现「引用一个还不存在的组件」。

**Files:**
- Create: `src/renderer/src/markdown/MarkdownImage.tsx`
- Create: `src/renderer/src/markdown/toReact.tsx`
- Create: `tests/unit/markdownToReact.test.tsx`

- [ ] **Step 1: 写失败的测试**

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'
import { clipTree } from '../../src/renderer/src/markdown/clip'
import { renderMarkdown } from '../../src/renderer/src/markdown/toReact'

/** 把 md 渲染进一个容器，返回容器本身——断言一律用 querySelector / textContent。 */
function dom(md: string): HTMLElement {
  const tree = parseMarkdown(md)
  expect(tree).not.toBeNull()
  return render(<div>{renderMarkdown(tree!)}</div>).container
}

/** 与 `dom()` 相同，但先按 `cursor` 裁一次——钉「揭示到一半」时的形态。 */
function domAt(md: string, cursor: number): HTMLElement {
  const tree = parseMarkdown(md)
  expect(tree).not.toBeNull()
  return render(<div>{renderMarkdown(clipTree(tree!, 0, cursor))}</div>).container
}

describe('renderMarkdown —— 块级', () => {
  it('标题：深度映射到 h1–h6，并带一个可用于样式的类名', () => {
    const c = dom('## 二、进展\n')
    const h = c.querySelector('h2')
    expect(h).not.toBeNull()
    expect(h!.className).toContain('wt-md-h2')
    expect(h!.textContent).toBe('二、进展')
  })

  it('代码块是 pre + code，文本原样（不做语法高亮）', () => {
    const c = dom('```\nconst a = 1\n```\n')
    expect(c.querySelector('pre')).not.toBeNull()
    expect(c.querySelector('pre code')!.textContent).toBe('const a = 1')
  })

  it('无序列表与有序列表', () => {
    expect(dom('- a\n- b\n').querySelector('ul')).not.toBeNull()
    const ol = dom('3. a\n4. b\n').querySelector('ol')
    expect(ol).not.toBeNull()
    expect(ol!.getAttribute('start')).toBe('3')
  })

  it('任务列表：方框 + 文字，**没有 input 元素**', () => {
    const c = dom('- [x] 完成\n- [ ] 没做\n')
    expect(c.textContent).toContain('完成')
    // 不可点：文档运行期只读。出现 input 就等于给了「能改文档」的样子
    expect(c.querySelector('input')).toBeNull()
    expect(c.querySelectorAll('.wt-md-check')).toHaveLength(2)
  })

  it('引用块与分隔线', () => {
    expect(dom('> 引用\n').querySelector('blockquote')).not.toBeNull()
    expect(dom('---\n').querySelector('hr')).not.toBeNull()
  })

  it('表格：表头进 thead/th，其余进 tbody/td', () => {
    const c = dom('| 项目 | 负责人 |\n| --- | --- |\n| 归档 | 张三 |\n')
    expect(c.querySelectorAll('thead th')).toHaveLength(2)
    expect(c.querySelectorAll('tbody td')).toHaveLength(2)
    expect(c.querySelector('tbody td')!.textContent).toBe('归档')
  })

  it('脚注引用是上标，定义是一段带标号的文字', () => {
    const c = dom('正文[^1]\n\n[^1]: 脚注内容\n')
    expect(c.querySelector('sup.wt-md-fn')!.textContent).toBe('1')
    expect(c.querySelector('.wt-md-fndef')!.textContent).toContain('脚注内容')
  })
})

describe('renderMarkdown —— 行内', () => {
  it('粗体、斜体、删除线、行内代码', () => {
    const c = dom('**粗** *斜* ~~删~~ `码`\n')
    expect(c.querySelector('strong')!.textContent).toBe('粗')
    expect(c.querySelector('em')!.textContent).toBe('斜')
    expect(c.querySelector('del')!.textContent).toBe('删')
    expect(c.querySelector('code')!.textContent).toBe('码')
  })

  it('链接画成 span 而不是 a —— 点了不做事', () => {
    const c = dom('[内网](http://x)\n')
    expect(c.textContent).toContain('内网')
    expect(c.querySelector('a')).toBeNull()
    expect(c.querySelector('.wt-md-link')!.getAttribute('title')).toBe('http://x')
  })

  it('图片这一版是占位：框 + 替代文字 + data-src', () => {
    const c = dom('![架构图](img/a.png)\n')
    const box = c.querySelector('[data-testid="md-image"]')!
    expect(box.textContent).toBe('架构图')
    expect(box.getAttribute('data-src')).toBe('img/a.png')
    expect(c.querySelector('img')).toBeNull()
  })
})

describe('renderMarkdown —— 内嵌 HTML（安全断言）', () => {
  it('白名单标签变成真元素', () => {
    expect(dom('<div>内容</div>\n').querySelector('div')!.textContent).toBe('内容')
  })

  it('script / iframe 一个元素都建不出来', () => {
    const c = dom('<script>alert(1)</script>\n<iframe src="http://x"></iframe>\n')
    expect(c.querySelector('script')).toBeNull()
    expect(c.querySelector('iframe')).toBeNull()
    // 文字留下（设计第 11 节的口径），但它永远不会被执行
    expect(c.textContent).toContain('alert(1)')
  })

  it('事件属性不会被搬到元素上', () => {
    const c = dom('<div onclick="alert(1)" class="x" style="color:red">t</div>\n')
    // `firstElementChild` 那一跳不能省：`c` 是 RTL 自己造的那个包裹 div，而
    // `c.querySelector('div')` 命中的是**它**（`dom()` 里那一层），markdown 渲出来的
    // 那个 div 在它里面。少了这一跳，下面三条断言查的是一个测试助手造的、永远没有
    // 属性的元素——它们恒真（实测：给 `renderTokens` 建的每个元素都加上 class，全绿）。
    const div = c.firstElementChild!.querySelector('div')!
    expect(div.textContent).toBe('t')
    expect(div.hasAttribute('onclick')).toBe(false)
    expect(div.hasAttribute('class')).toBe(false)
    expect(div.hasAttribute('style')).toBe(false)
  })

  it('不配对的开标签不会把后面的内容吞掉', () => {
    // 没有闭合标签时，收尾那一步会把它合上——后面兄弟节点仍然渲染得出来
    const c = dom('<div>开\n\n后面一段\n')
    expect(c.textContent).toContain('后面一段')
    // 「合上」这件事本身也要单独钉：上面那条断言是**兄弟段落**给的，与收尾那一步
    // 无关（实测：整段删掉收尾那一步，只断言上一句时全绿）。真删掉的话，这个 div
    // 连元素都建不出来，「开」这个**已揭示的字**就上不了屏了——那才是要防的那条。
    expect(c.firstElementChild!.querySelector('div')!.textContent).toBe('开')
  })

  it('HTML 注释一个字都不上屏', () => {
    // 整段是一个 html 节点，注释不是标签——不处置的话它会原样成为屏幕上的字面文字
    const c = dom('前文\n\n<!-- 这是注释 -->\n\n后文\n')
    expect(c.textContent).toContain('前文')
    expect(c.textContent).toContain('后文')
    expect(c.textContent).not.toContain('这是注释')
  })

  it('没关的注释会一直吃到文末（HTML 规范如此，浏览器对同样的字节也是这个行为）', () => {
    // remark 把「`<!--` 到文末」整段做成**一个** html 节点，所以那个注释之后的内容
    // 也跟着不显示。这条把那个后果明写出来——它是刻意的（注释没关就没法知道
    // 作者想表达什么），不是漏掉了「后文」两个字
    const c = dom('前文\n\n<!-- 没关的注释\n\n后文\n')
    expect(c.textContent).toBe('前文')
  })
})

/**
 * 【行内 HTML 为什么要单独一组】行内标签在 mdast 里是**一个标签一个节点**——
 * `前文 <b>加粗</b> 后文` 是 text / html / text / html 四个兄弟节点。上一组用的
 * `<div>内容</div>` 是**块级** HTML（整段一个节点），凭空就对；这一组钉的是行内那一半。
 */
describe('renderMarkdown —— 行内 HTML（合并兄弟节点）', () => {
  it('行内标签包住文字，不是一个空元素', () => {
    const c = dom('前文 <b>加粗</b> 后文\n')
    expect(c.querySelector('b')).not.toBeNull()
    expect(c.querySelector('b')!.textContent).toBe('加粗')
    expect(c.textContent).toBe('前文 加粗 后文')
  })

  it('mark / u 这些行内标签同样包住文字', () => {
    const c = dom('x <mark>高亮</mark> y <u>下划线</u> z\n')
    expect(c.querySelector('mark')!.textContent).toBe('高亮')
    expect(c.querySelector('u')!.textContent).toBe('下划线')
    expect(c.textContent).toBe('x 高亮 y 下划线 z')
  })

  it('嵌套的行内标签各归各的层', () => {
    const c = dom('x <span>a<b>b</b></span> y\n')
    expect(c.querySelector('span')!.textContent).toBe('ab')
    expect(c.querySelector('b')!.textContent).toBe('b')
    expect(c.textContent).toBe('x ab y')
  })

  it('白名单之外的行内标签：标签丢掉、文字留在原处', () => {
    const c = dom('前文 <blink>闪</blink> 后文\n')
    expect(c.querySelector('blink')).toBeNull()
    expect(c.textContent).toBe('前文 闪 后文')
  })

  it('收尾标签还没被揭示时，标签仍然包住已揭示的那几个字', () => {
    // clip 会把「没抽完」的 html 节点丢掉，于是流里只剩 `<b>加粗`
    // ——收尾那一步补上闭标签，这两个字照样是粗的
    const c = domAt('前文 <b>加粗</b> 后文\n', 8)
    expect(c.querySelector('b')!.textContent).toBe('加粗')
    expect(c.textContent).toBe('前文 加粗')
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

```bash
pnpm vitest run tests/unit/markdownToReact.test.tsx
```

期望：FAIL，`Failed to resolve import .../markdown/toReact`。

- [ ] **Step 3: 先写图片占位组件**

```tsx
import type { ReactNode } from 'react'

export interface MarkdownImageProps {
  url: string
  alt: string
}

/**
 * 图片。**本任务的版本是占位**：不取图，只画一个虚线框，里面是替代文字。
 *
 * 【为什么要分两步】取图要走 IPC（渲染层是沙箱，读不到磁盘也拿不到网络），
 * 而那条通道属于 Task 9。先给一个不依赖任何东西的占位版，本任务才能自己绿。
 * Task 9 会把这里改成真的取图 + 缓存，并保留 `data-testid` 与 `data-src` 这两个钩子。
 *
 * 【为什么框里放替代文字而不是空的】抽字是逐字来的，图片那一段语法被揭示之前
 * 这个节点根本不在树里（`clip.ts` 管这个）。一旦在树里，它就该占住位置——
 * 一个空框会让人以为渲染坏了。
 */
export function MarkdownImage({ url, alt }: MarkdownImageProps): ReactNode {
  return (
    <span className="wt-md-img" data-src={url} data-testid="md-image">
      {alt}
    </span>
  )
}
```

- [ ] **Step 4: 写映射实现**

```tsx
import { createElement, Fragment, type ReactNode } from 'react'
import type { Root } from 'mdast'
import { tokenizeHtml, type HtmlToken } from './html'
import { MarkdownImage } from './MarkdownImage'

/** mdast 的节点联合。`Root['children'][number]` 就是 `Content`，写出来更直白。 */
type MdNode = Root['children'][number]

/** 表头单元格与普通单元格的唯一区别。 */
interface Ctx {
  readonly header: boolean
}

/** 标题的深度是 1–6，用一张表取标签名而不是拼字符串再断言——后者要一个假类型。 */
const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const

/**
 * 裁剪后的树 → React 元素。
 *
 * 【这一层不做任何「该不该显示」的判断】那是 `clip.ts` 的事。这里只把拿到的树
 * 按类型画出来，所以它是纯粹的视图层。
 *
 * 【全仓不出现 `dangerouslySetInnerHTML`】内嵌 HTML 那一行走 `tokenizeHtml` →
 * `createElement`，白名单之外的标签**连元素都建不出来**（设计第 11 节）。
 * `renderTokens` 那几处 `createElement` **一个属性都不传**，这是安全性的来源，
 * 不是省事——别顺手把 `class` 之类透传进去。
 *
 * 【链接为什么不是 `<a>`】点了不做事是明确的决定（设计 9.3）：点开会拉起系统浏览器，
 * 一个伪装成 Word 的应用突然开浏览器太显眼。画成 `<span>` 配链接的样子，
 * `title` 里留着真实地址，想复制的人拿得到。
 *
 * 【表格对齐不做】GFM 的 `align` 要逐列算，而真 Word 里数字右对齐是「单元格属性」
 * 而不是「表格属性」。这一段做到「细网格线 + 表头加粗」为止。
 *
 * 【`default` 分支落到哪里】`definition`（链接引用定义）走那里：它本身不该出现在正文里。
 * 其余 mdast 节点类型（yaml / toml / math 之类）本仓库的插件集产不出来。
 *
 * 【`withBlockEnds` 是给量高度那一份用的】它为真时每个顶层块**多套一层带
 * `data-block-end` 的包装**，让「有几个块」只由这一处决定：渲染成 `null` 的节点
 * （`definition`）也照样有一个包装、高度 0，于是 DOM 与偏移按构造一一对应，
 * `measureBlocks` 那条「对不上就退回兜底」永远不会因为节点类型被误触。
 * 包装本身没有内外边距与边框，子元素的外边距**照常折叠穿透**，所以量出来的高度
 * 与不套包装时一致；有可见那一份在，这一份的层级再多也不影响用户看到的东西。
 * 为假时走 `renderAll`，输出**一个字节都不变**。
 */
export function renderMarkdown(root: Root, opts: { withBlockEnds?: boolean } = {}): ReactNode {
  if (opts.withBlockEnds) {
    return root.children.map((node, i) => (
      <div
        className="wt-md-measure-block"
        key={i}
        data-block-end={node.position?.end.offset ?? ''}
      >
        {renderNode(node, { header: false })}
      </div>
    ))
  }
  return renderAll(root.children, { header: false })
}

/** 一段 text / html 节点的原文字符串。别处取不到——这两种节点才带 `value`。 */
const rawOf = (node: MdNode): string => (node.type === 'text' || node.type === 'html' ? node.value : '')

/**
 * 渲染一串兄弟节点。
 *
 * 【为什么要合并连续节点】行内 HTML 在 mdast 里是**一个标签一个节点**：`前文 <b>加粗</b> 后文`
 * 是 text / html / text / html 四个兄弟节点。逐个节点各自 token 一次的话，`<b>` 那个节点
 * 永远看不到自己的内容（内容在兄弟节点里），于是画出一个空的 `<b></b>`、文字落在元素外面——
 * 白名单 18 个里有 12 个是行内标签，等于大半是空转的。把连续的一串 text / html 合成
 * **一段 token 流**再渲染，`<b>` 与 `</b>` 就落进同一次 `renderTokens`，元素包住了内容。
 *
 * 【拼的是 token，不是原文】两处区别都来自「这些字符**已经**被 markdown 解析过一遍」：
 * 一是 text 节点里的 `<` 可能是 `\<` 或实体转义来的，拼回原文再 tokenize 等于把它当标签
 * 重新解析一次（正是 `html.ts` 那个属性段收窄要防的东西）；二是相邻节点的碎片本来不是
 * 一个标签（`<div title="a"` + `>`），拼起来会凭空合成一个。逐个 html 节点 tokenize、
 * 把 token 接起来，这两件事都不会发生。
 *
 * 【纯文字的串一个字节都不变】一串里**没有** html 节点时走原来那条路（每个节点一个
 * Fragment，内容就是它的 value），合并只在至少有一个 html 节点时发生。
 *
 * 【一个接受的退化：md 的行内节点不拉进来】`strong` / `emphasis` / `code` 这些**会打断**
 * 这一串，于是 `前 <b>**粗**</b> 后` 退化成「空的 `<b>` + 一个 `<strong>粗</strong>`」——
 * 文字一个字不丢，只是那个 `<b>` 没包住东西。要归并它得多一套跨类型匹配规则，而收益
 * 只是这种交错写法好看一点（设计第 11 节承诺的是「安全的排版标签生效」，不是「与 md
 * 记号交错时也归并」）。
 */
function renderAll(nodes: readonly MdNode[], ctx: Ctx): ReactNode {
  const out: ReactNode[] = []
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i]
    if (node.type !== 'text' && node.type !== 'html') {
      out.push(<Fragment key={i}>{renderNode(node, ctx)}</Fragment>)
      i++
      continue
    }
    // 一串连续的 text / html：先看它有多长、里面有没有 html
    const start = i
    let hasHtml = false
    while (i < nodes.length && (nodes[i].type === 'text' || nodes[i].type === 'html')) {
      if (nodes[i].type === 'html') hasHtml = true
      i++
    }
    if (!hasHtml) {
      for (let k = start; k < i; k++) out.push(<Fragment key={k}>{rawOf(nodes[k])}</Fragment>)
      continue
    }
    const tokens: HtmlToken[] = []
    for (let k = start; k < i; k++) {
      const n = nodes[k]
      if (n.type === 'html') tokens.push(...tokenizeHtml(n.value))
      else tokens.push({ kind: 'text', value: rawOf(n) })
    }
    out.push(<Fragment key={start}>{renderTokens(tokens)}</Fragment>)
  }
  return out
}

function renderNode(node: MdNode, ctx: Ctx): ReactNode {
  switch (node.type) {
    case 'text':
      return node.value
    case 'paragraph':
      return <p className="wt-md-p">{renderAll(node.children, ctx)}</p>
    case 'heading': {
      const Tag = HEADING_TAGS[Math.min(Math.max(node.depth, 1), 6) - 1]
      return <Tag className={`wt-md-h wt-md-h${node.depth}`}>{renderAll(node.children, ctx)}</Tag>
    }
    case 'emphasis':
      return <em className="wt-md-em">{renderAll(node.children, ctx)}</em>
    case 'strong':
      return <strong className="wt-md-strong">{renderAll(node.children, ctx)}</strong>
    case 'delete':
      return <del className="wt-md-del">{renderAll(node.children, ctx)}</del>
    case 'inlineCode':
      return <code className="wt-md-code-inline">{node.value}</code>
    case 'code':
      return (
        <pre className="wt-md-pre">
          <code>{node.value}</code>
        </pre>
      )
    case 'break':
      return <br />
    case 'thematicBreak':
      return <hr className="wt-md-hr" />
    case 'blockquote':
      return <blockquote className="wt-md-quote">{renderAll(node.children, ctx)}</blockquote>
    case 'list':
      return node.ordered ? (
        <ol className="wt-md-list" start={node.start ?? undefined}>
          {renderAll(node.children, ctx)}
        </ol>
      ) : (
        <ul className="wt-md-list">{renderAll(node.children, ctx)}</ul>
      )
    case 'listItem': {
      // `checked` 是 GFM 任务列表才有的字段：普通项是 **null**（实测，不是 undefined），
      // 任务项是 true / false。所以这里判的是「等不等于那两个布尔值」，不是「字段在不在」
      const task = node.checked === true || node.checked === false
      return (
        <li className={task ? 'wt-md-li wt-md-li--task' : 'wt-md-li'}>
          {task && (
            /**
             * 不可点，而且**不是 `<input>`**（设计第 4 节）。文档运行期只读、
             * 永不修改是既有硬规则；一个能点的复选框会把这条前提破掉，
             * 连「看起来能点」的样子都不给。
             */
            <span className="wt-md-check" aria-label={node.checked ? '已完成' : '未完成'}>
              {node.checked ? '☑' : '☐'}
            </span>
          )}
          {renderAll(node.children, ctx)}
        </li>
      )
    }
    case 'link':
      return (
        <span className="wt-md-link" title={node.url}>
          {renderAll(node.children, ctx)}
        </span>
      )
    case 'linkReference':
      // 引用的定义没找到时 remark 留着这种节点。画成链接的样子，但没有地址可给。
      return <span className="wt-md-link">{renderAll(node.children, ctx)}</span>
    case 'image':
      return <MarkdownImage url={node.url} alt={node.alt ?? ''} />
    case 'imageReference':
      return <MarkdownImage url="" alt={node.alt ?? ''} />
    case 'table': {
      const [head, ...body] = node.children
      return (
        <table className="wt-md-table">
          {head && <thead>{renderNode(head, { header: true })}</thead>}
          {body.length > 0 && (
            <tbody>
              {body.map((row, i) => (
                <Fragment key={i}>{renderNode(row, { header: false })}</Fragment>
              ))}
            </tbody>
          )}
        </table>
      )
    }
    case 'tableRow':
      return <tr>{renderAll(node.children, { header: ctx.header })}</tr>
    case 'tableCell': {
      const Tag = (ctx.header ? 'th' : 'td') as 'th'
      return <Tag className="wt-md-cell">{renderAll(node.children, ctx)}</Tag>
    }
    case 'footnoteReference':
      return <sup className="wt-md-fn">{node.label}</sup>
    case 'footnoteDefinition':
      return (
        <div className="wt-md-fndef">
          <span className="wt-md-fndef__label">{node.label}</span>
          {renderAll(node.children, ctx)}
        </div>
      )
    case 'html':
      return <HtmlFragment raw={node.value} />
    default:
      return null
  }
}

/** 一段内嵌 HTML 走完白名单之后剩下的东西。 */
function HtmlFragment({ raw }: { raw: string }): ReactNode {
  return <>{renderTokens(tokenizeHtml(raw))}</>
}

/**
 * 把 token 拼成 React 树。
 *
 * 【为什么要有栈】token 是**扁平的**，而元素是嵌套的。栈上每一帧是「一个开了还没关
 * 的标签」。
 *
 * 【两处容错，都是「不配对」的产物】
 * - 遇到一个没有对应开标签的闭标签 → 忽略（`lastIndexOf` 返回 -1）；
 * - 走到末尾还有没关的帧 → 按出现顺序补上闭标签。
 *
 * 两种情况下渲染出来的东西都是**平衡的树**，不会把后面的兄弟节点吞掉。
 *
 * 【`key` 用自增序号】这一段的节点身份本来就随打字每次都变（内容一直在改），
 * 没有稳定的身份可用。用序号至少能保证同一次渲染里互不重复。
 */
function renderTokens(tokens: readonly HtmlToken[]): ReactNode[] {
  const root: ReactNode[] = []
  const stack: { tag: string; children: ReactNode[] }[] = []
  const top = (): ReactNode[] => (stack.length > 0 ? stack[stack.length - 1].children : root)
  let seq = 0
  for (const t of tokens) {
    if (t.kind === 'text') {
      top().push(t.value)
      continue
    }
    // 注意：下面三处 createElement 都【只传 key】，不传任何属性。
    // 属性全丢是这个模块的安全口径（设计第 11 节），不是漏写。
    if (t.kind === 'void') {
      top().push(createElement(t.tag, { key: seq++ }))
      continue
    }
    if (t.kind === 'open') {
      stack.push({ tag: t.tag, children: [] })
      continue
    }
    const at = stack.map((f) => f.tag).lastIndexOf(t.tag)
    if (at < 0) continue
    const frame = stack.splice(at, 1)[0]
    top().push(createElement(frame.tag, { key: seq++ }, ...frame.children))
  }
  while (stack.length > 0) {
    const frame = stack.pop() as { tag: string; children: ReactNode[] }
    top().push(createElement(frame.tag, { key: seq++ }, ...frame.children))
  }
  return root
}
```

- [ ] **Step 5: 跑测试，确认它绿**

```bash
pnpm vitest run tests/unit/markdownToReact.test.tsx
pnpm typecheck
```

期望：全过，exit 0。

**若「表格」那两条没过**，先用 `console.log(JSON.stringify(tree, null, 2))` 看一眼 mdast 的实际形状——GFM 的表格第一个 `tableRow` 就是表头，这是本实现的前提。前提不成立就停下来报，别改成猜的。

**这一节的 `renderAll` 在实施之后改过一次（规格评审量出来的一个缺口），围栏已同步：**

**行内 HTML 的标签原来是空转的。** 原实现逐个节点渲染，而行内标签在 mdast 里是**一个标签一个节点**——`前文 <b>加粗</b> 后文` 是 text / html / text / html 四个兄弟节点，于是 `<b>` 那个节点看不到自己的内容（内容在兄弟节点里），画出来是一个空的 `<b></b>`、文字落在元素外面。白名单 18 个里 12 个是行内标签，等于大半是空转的；上一组用例用的 `<div>内容</div>` 是**块级** HTML（整段一个节点），凭空就对，所以这个缺口没被测试逮住。现在把连续的 text / html 兄弟节点合成**一段 token 流**再渲染。**拼的是 token 不是原文**，理由（转义过的 `<` 不该被重新解析、相邻碎片不该被合成一个标签）写在 `renderAll` 的注释里；md 的行内节点（`strong` / `emphasis` / `code`）**不拉进来**，那是刻意的取舍，也写在注释里。测试新增一组「行内 HTML（合并兄弟节点）」。

**另外 `renderMarkdown` 多了 `withBlockEnds` 那个参数**（Task 7 量高度那一份用的包装），Task 7 当时没回写本节的围栏，这次一并补上——所以本节的围栏现在才是与源码逐字节相等的那一面。

- [ ] **Step 6: 提交**

```bash
cat > /tmp/msg.txt <<'MSG'
feat(md): 裁剪后的语法树映射成 React 元素

覆盖设计语法表里的每一项。三处刻意的选择都写在注释里：链接画成 span
而不是 a（点了不做事）；任务列表是不可点的符号而不是 input（文档只读）；
内嵌 HTML 走白名单 token + createElement，且一个属性都不传。

图片这一版是占位（框 + 替代文字），真取图是后面那个任务。
MSG
git add src/renderer/src/markdown/MarkdownImage.tsx src/renderer/src/markdown/toReact.tsx tests/unit/markdownToReact.test.tsx
git commit -F /tmp/msg.txt
```

---

## Task 6: `styles/markdown.css` —— Word 风，配色跟着纸走

对应设计文档第 10 节。

**这一步没有「失败的测试」可写**：CSS 在 jsdom 里没有布局，也没有计算样式的有效断言，本仓库对样式一贯是真机截图验收。所以本任务的门禁是 `pnpm typecheck` 与 `pnpm test`（确认没把别的弄坏）+ Task 8 的结构断言 + 最后的真机验收。**别为了「有测试」去写断言类名的假用例。**

**Files:**
- Create: `src/renderer/src/styles/markdown.css`
- Modify: `src/renderer/src/main.tsx`（加一行 import）

- [ ] **Step 1: 写样式**

```css
/**
 * 工作文档的 markdown 排版。
 *
 * 【配色为什么按 `data-paper` 而不是按 `data-theme` 分叉】这是本文件最容易写错的一处。
 * 深色主题**不等于**深色纸：`data-theme='dark'` 而 `data-paper` 不是 `dark` 时，
 * `.wt-page` 仍然是白底（`page.css` 里那条底色写在 `.wt-page` 上，只有
 * `[data-theme='dark'][data-paper='dark']` 才把它换掉）。所以浅色那一套颜色要挂在
 * **默认**上，深色那一套只挂在「深色主题 **且** 深色纸」上——挂错了，深色系统下那张
 * 白纸上的标题会变成暗蓝、代码块变成深灰底，一眼就看出破绽。
 *
 * 【对比度】深色那一套的取值比浅色亮一档，是为了在深色纸上有足够对比度。
 * 这一条只有真机能判，验收清单里有一条专门看它。
 */

:root {
  /* Word「标题 1」的默认蓝，以及默认超链接蓝 —— 对着真 Word 取的 */
  --wt-md-h: #2f5496;
  --wt-md-link: #0563c1;
  --wt-md-code-bg: #f3f3f3;
  --wt-md-code-fg: #24292f;
  --wt-md-quote-fg: #595959;
  --wt-md-quote-bar: #d0d0d0;
  --wt-md-rule: #d8d8d8;
  --wt-md-grid: #c8c8c8;
  --wt-md-th-bg: #f7f7f7;
}

[data-theme='dark'][data-paper='dark'] {
  --wt-md-h: #7aa7e0;
  --wt-md-link: #6cb6ff;
  --wt-md-code-bg: #2a2a2e;
  --wt-md-code-fg: #d8d8d8;
  --wt-md-quote-fg: #a8a8a8;
  --wt-md-quote-bar: #4a4a4a;
  --wt-md-rule: #3a3a3a;
  --wt-md-grid: #3f3f3f;
  --wt-md-th-bg: #26262a;
}

/* ── 块级 ───────────────────────────────────────────────── */

/**
 * 【这四条里的 `white-space: normal` 是必须显式写的，别当成冗余删掉】
 *
 * `white-space` **会被继承**，而 markdown 这一段长在 `.wt-page__text` 下面——
 * 那里写的是 `pre-wrap`（纯文本那条路要的：它显示的是一个字符串，换行就是换行）。
 * 不重置的话，段落里的**软换行**（md 源文件里就是一个换行，CommonMark 让它折成空格）
 * 会变成硬换行，屏幕上于是出现一行行对齐源文件的短行——真 Word 不是这样排的。
 *
 * 反过来 `.wt-md-pre` 要保住 `pre-wrap`（代码就是要保行），所以它在下面自己写了一条。
 * 表格单元格与脚注定义（`.wt-md-cell` / `.wt-md-fndef`）**没有**跟着重置：它们不是
 * 段落那种连续文字，源文件里的换行在单元格里保不保留都说得过去，暂按现状。
 */
.wt-md-p {
  margin: 0 0 0.85em;
  white-space: normal;
}

.wt-md-h {
  /* 标题换成无衬线：真 Word 的标题样式用的就是微软雅黑 / 等线那一系，
     而正文是宋体系（`.wt-page` 上的 Georgia / Songti SC）。这一处差异是伪装的一部分。 */
  font-family: 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
  color: var(--wt-md-h);
  margin: 0.9em 0 0.45em;
  line-height: 1.4;
  font-weight: 600;
  white-space: normal;
}

.wt-md-h1 { font-size: 26px; }
.wt-md-h2 { font-size: 21px; }
.wt-md-h3 { font-size: 18px; }
.wt-md-h4 { font-size: 16px; }
.wt-md-h5 { font-size: 15px; }
.wt-md-h6 { font-size: 15px; font-weight: 500; }

/* 第一个块不带上外边距：铺满一页时顶上多一截空白会让「从纸中间开始」露馅 */
.wt-page__text > :first-child {
  margin-top: 0;
}

.wt-md-list {
  margin: 0 0 0.85em;
  padding-left: 2em;
}

.wt-md-li {
  margin: 0.15em 0;
  white-space: normal;
}

.wt-md-li--task {
  list-style: none;
  margin-left: -1.4em;
}

.wt-md-check {
  display: inline-block;
  width: 1.5em;
  color: var(--wt-md-quote-fg);
}

.wt-md-quote {
  margin: 0 0 0.85em;
  padding: 0.1em 0 0.1em 14px;
  border-left: 3px solid var(--wt-md-quote-bar);
  color: var(--wt-md-quote-fg);
  white-space: normal;
}

.wt-md-pre {
  margin: 0 0 0.85em;
  padding: 10px 14px;
  background: var(--wt-md-code-bg);
  color: var(--wt-md-code-fg);
  border-radius: 3px;
  font-family: Consolas, Menlo, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  /* 换行而不是横向滚动：设计第 9.2 节那条「不出现横向滚动条」的口径对代码块同样适用，
     而纸是固定宽度的，长行溢出会直接盖到纸外面去。代码行被折行在这里是可以接受的。 */
  white-space: pre-wrap;
  word-break: break-word;
}

.wt-md-hr {
  border: 0;
  border-top: 1px solid var(--wt-md-rule);
  margin: 1em 0;
}

/* ── 表格：固定宽度 + 单元格换行，绝不横向滚动 ────────────── */

.wt-md-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin: 0 0 0.85em;
  font-size: 14px;
}

.wt-md-cell {
  border: 1px solid var(--wt-md-grid);
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
  word-break: break-word;
}

.wt-md-table thead .wt-md-cell {
  font-weight: 600;
  background: var(--wt-md-th-bg);
}

/* ── 行内 ───────────────────────────────────────────────── */

.wt-md-code-inline {
  font-family: Consolas, Menlo, 'Courier New', monospace;
  font-size: 0.92em;
  background: var(--wt-md-code-bg);
  color: var(--wt-md-code-fg);
  padding: 0.1em 0.35em;
  border-radius: 2px;
}

.wt-md-link {
  color: var(--wt-md-link);
  text-decoration: underline;
}

.wt-md-fn {
  font-size: 0.75em;
  color: var(--wt-md-link);
  vertical-align: super;
  line-height: 0;
}

.wt-md-fndef {
  margin: 0.3em 0;
  padding-left: 1.8em;
  text-indent: -1.8em;
  font-size: 0.9em;
  color: var(--wt-md-quote-fg);
}

.wt-md-fndef__label::after {
  content: '. ';
}

/* ── 图片占位框（Task 9 会把真图放进来，这个框留着给加载中与加载失败用） ── */

.wt-md-img {
  display: inline-block;
  padding: 6px 10px;
  border: 1px dashed var(--wt-md-rule);
  border-radius: 2px;
  color: var(--wt-md-quote-fg);
  font-size: 0.9em;
}

/* ── 量高度那份副本的包装：**一条规则都不要加** ─────────────────────────

   `.wt-md-measure-block` 是「量高度」那份隐藏副本里每个顶层块的包装
   （`renderMarkdown(doc, { withBlockEnds: true })` 产出，见 `markdown/toReact.tsx`）。

   【为什么一条都不能加】`measure.ts` 量的不是 `offsetHeight`，而是
   `下一个包装的 offsetTop − 这个包装的 offsetTop`（`measure.ts:58`），
   因为相邻块之间的**外边距是折叠到包装之外**的、`offsetHeight` 量不到那一段。
   这个算法成立的前提是：包装在布局上是一条**透明的通道**——它自己不产生任何
   可见的盒子。包装上挂了 `padding` / `border` / `overflow`（非 visible）里任何一条，
   它就变成一个真实的盒子，子元素的外边距不再穿透它（`position` 不在此列，
   它不阻止折叠），于是量出来的数与不套包装的可见那份**不是同一份文档**，
   而且**不报错**——只是铺满铺少了。

   真 Chromium 实测（4 个 `margin-bottom: 0.85em` 的段落，套/不套包装各量一遍，
   用的是 `measure.ts` 那个 offsetTop 差值算法）：

     不套包装（基准）        137
     套包装、无规则（现状）  137   ← 相等，这就是这条禁令要保住的不变量
     包装 + padding 10px 0   231
     包装 + border 1px       159
     包装 + overflow: hidden 151
     包装 + position: relative 137  ← 这条实测无影响，但同样别加

   差额随块数线性累加（外边距从「折叠一次」变成「每个块各算一次 + padding」），
   几十个块就是几百像素。`position: relative` 那条之所以「没事」是因为它既不阻止
   外边距折叠、也不改变包装自己相对 `.wt-md-measure` 的 `offsetParent`
   （`measure.ts` 读的是包装自己的 `offsetTop`，不是它后代的）；**别把它的「没事」
   推广到别的属性上** —— 上面那三条看着同样无辜。

   所以这个类名出现在 CSS 里的唯一意义就是「别给它写规则」。 */

/* 量高度用的隐藏副本：绝对定位 + 不可见，但**参与布局**（`visibility: hidden`
   而不是 `display: none`——后者会让 offsetHeight 恒为 0，量不了）。 */
.wt-md-measure {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  visibility: hidden;
  pointer-events: none;
}

/* 真图：最宽不超过正文宽，高度自适应。`display: block` 让块级图片独占一行，
   与 Word 里「嵌入型」图片的行为一致。 */
.wt-md-img-real {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0.4em 0;
}
```

- [ ] **Step 2: 在入口引进来**

`src/renderer/src/main.tsx` 现在是这样（第 4–6 行）：

```tsx
import './styles/word.css'
import './styles/ribbon.css'
import './styles/page.css'
```

在 `page.css` 那一行**之后**加一行（顺序有意义：markdown.css 要能盖住 page.css 里的通用段落规则）：

```tsx
import './styles/markdown.css'
```

- [ ] **Step 3: 跑门禁**

```bash
pnpm typecheck && echo TYPECHECK_OK
pnpm test && echo TEST_OK
pnpm build && echo BUILD_OK
```

期望：三条都出 OK。

- [ ] **Step 4: 提交**

```bash
cat > /tmp/msg.txt <<'MSG'
feat(md): 加 markdown 的 Word 风样式

标题用微软雅黑那一系、深蓝 #2f5496（Word「标题 1」的默认值），正文仍是
宋体系；列表、引用、代码块、表格各按其形。

配色按 data-paper 分叉而不是按 data-theme：深色主题不等于深色纸，
data-theme='dark' 而纸不是深色时 .wt-page 仍是白底，跟着主题换色会
在白纸上画出暗蓝标题。

表格固定宽度 + 单元格换行，代码块 pre-wrap，全篇不出现横向滚动条。
MSG
git add src/renderer/src/styles/markdown.css src/renderer/src/main.tsx
git commit -F /tmp/msg.txt
```

---

## Task 7: `markdown/measure.ts` —— 量高度，量不出就说量不出

对应设计文档第 7 节的第 2 步与兜底 2。

**这个模块的返回值有第三种状态（`null` = 量不出来）**，那不是「出错」，而是 jsdom 的常态。调用方必须能分辨「量到了 0 高」与「根本没法量」，所以它不返回空数组。

**Files:**
- Create: `src/renderer/src/markdown/measure.ts`
- Create: `tests/unit/markdownMeasure.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { measureBlocks, BLOCK_END_ATTR } from '../../src/renderer/src/markdown/measure'
import { renderMarkdown } from '../../src/renderer/src/markdown/toReact'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'

/**
 * 【怎么在 jsdom 里造出布局】jsdom 没有布局，`offsetTop` / `offsetHeight` 恒为 0。
 * 但它们是可写的，`Object.defineProperty` 能给某个元素钉一个假值——
 * 这样「映射逻辑」就能单测，只有「浏览器真的这么算」那一半留给真机。
 */
function block(end: string | null, top: number, height = 0): HTMLElement {
  const el = document.createElement('div')
  if (end !== null) el.setAttribute(BLOCK_END_ATTR, end)
  Object.defineProperty(el, 'offsetTop', { value: top, configurable: true })
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true })
  return el
}

function container(...els: HTMLElement[]): HTMLElement {
  const c = document.createElement('div')
  for (const el of els) c.appendChild(el)
  return c
}

describe('measureBlocks', () => {
  it('把每个块的结束偏移与高度配起来，高度取「下一个块的 offsetTop − 这个块的 offsetTop」', () => {
    // 末块后面没有下一个块，用它自己的 offsetHeight。若改成一律用 offsetHeight，
    // 前两块量出来会是 0 而不是 400 / 300 —— 中间那段外边距就丢了
    expect(measureBlocks(container(block('100', 0), block('200', 400), block('300', 700, 300)))).toEqual([
      { end: 100, height: 400 },
      { end: 200, height: 300 },
      { end: 300, height: 300 }
    ])
  })

  it('元素一个都没有：返回 null，不是空数组', () => {
    // 空数组会被上层当成「量到了，只是没有块」，于是切点变成 0、屏幕全白
    expect(measureBlocks(container())).toBeNull()
    expect(measureBlocks(null)).toBeNull()
  })

  it('高度全是 0：这是 jsdom 的常态，返回 null 让上层走兜底', () => {
    expect(measureBlocks(container(block('100', 0), block('200', 0)))).toBeNull()
  })

  it('读不到 data-block-end：返回 null', () => {
    // 读不到说明这一份不是在渲染时套出来的，硬凑的偏移是错的
    expect(measureBlocks(container(block(null, 0), block('200', 400)))).toBeNull()
    expect(measureBlocks(container(block('100', 0), block(null, 400)))).toBeNull()
  })

  it('偏移不是有限数：返回 null（空串也算——Number("") 是 0，不显式挡就会被当成偏移 0 收下）', () => {
    expect(measureBlocks(container(block('abc', 0), block('200', 400)))).toBeNull()
    expect(measureBlocks(container(block('', 0), block('200', 400)))).toBeNull()
  })

  it('只要有一个块真的量到了高度，就算量到了', () => {
    expect(measureBlocks(container(block('100', 0), block('200', 0, 300)))).toEqual([
      { end: 100, height: 0 },
      { end: 200, height: 300 }
    ])
  })
})

describe('量高度那一份的块数', () => {
  it('witness：含 definition 与 HTML 注释的文档，包装个数仍等于顶层节点数', () => {
    const md = '前一段。\n\n[a]: https://example.com\n\n<!-- 注释 -->\n\n后一段。\n'
    const doc = parseMarkdown(md)
    expect(doc).not.toBeNull()
    // 前提自检：这份文档确实含有那两个「渲染不出 Element」的类型，否则这条用例是空转
    expect(doc!.children.map((n) => n.type)).toEqual(['paragraph', 'definition', 'html', 'paragraph'])

    // 反面对照：可见那一份（不套包装）的直接子元素**比顶层节点少**——`definition` 渲染成
    // null、注释那段只剩文本子节点，而 `children` 只数 Element。这正是「偏移另算一份」
    // 会踩的坑：measureBlocks 判「对不上」，整篇静默退回按字符数铺
    const visible = render(createElement('div', null, renderMarkdown(doc!))).container
      .firstElementChild as HTMLElement
    expect(visible.children.length).toBeLessThan(doc!.children.length)

    const { container } = render(
      createElement('div', { className: 'wt-md-measure' }, renderMarkdown(doc!, { withBlockEnds: true }))
    )
    const el = container.querySelector('.wt-md-measure') as HTMLElement
    expect(el).not.toBeNull()
    expect(el.children).toHaveLength(doc!.children.length)

    // 每个包装自己带着偏移，正好是那个节点的结束偏移；顺带钉上假布局（definition 那个块
    // 渲染成空 div，所以它高度为 0，其余三块各 100）
    const ends = doc!.children.map((n) => n.position?.end.offset ?? '')
    const tops = [0, 100, 100, 200]
    Array.from(el.children).forEach((c, i) => {
      expect(c.getAttribute(BLOCK_END_ATTR)).toBe(String(ends[i]))
      Object.defineProperty(c, 'offsetTop', { value: tops[i], configurable: true })
      Object.defineProperty(c, 'offsetHeight', { value: 100, configurable: true })
    })

    // 四条都读得回来——包括渲染成空的 definition 那条（高度 0，但它在表里，不是被丢掉
    // 一个 → 对不上 → null）
    expect(measureBlocks(el)).toEqual([
      { end: ends[0], height: 100 },
      { end: ends[1], height: 0 },
      { end: ends[2], height: 100 },
      { end: ends[3], height: 100 }
    ])
  })

  it('不带 withBlockEnds 时输出不变：可见那一份一个包装都不加', () => {
    const doc = parseMarkdown('## 标题\n\n段落\n')
    const holder = render(createElement('div', null, renderMarkdown(doc!))).container
      .firstElementChild as HTMLElement
    expect(holder.querySelector('.wt-md-measure-block')).toBeNull()
    expect(holder.children).toHaveLength(2)
    expect(holder.children[0].tagName).toBe('H2')
    expect(holder.children[1].tagName).toBe('P')
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

```bash
pnpm vitest run tests/unit/markdownMeasure.test.ts
```

期望：FAIL，`Failed to resolve import .../markdown/measure`。

- [ ] **Step 3: 写实现**

```ts
import type { BlockHeight } from './fill'

/**
 * 每个顶层块在「量高度用的那一份隐藏副本」里带的结束偏移属性。
 *
 * 【为什么偏移写在 DOM 上，而不是另外算一份数组传进来】「有几个块」如果由两处各自决定，
 * 就永远能对不上——而这里的判据是「对不上就整篇退回按字符数铺」，于是对不上是**静默**的。
 * 实测能触发它的两种节点：
 * - `definition`（`[a]: https://example.com`，真 md 里很常见）走 `renderMarkdown` 的
 *   `default` 分支渲染成 `null`，**零个 Element**；
 * - 只含注释 / `<script>` 的 HTML 块，`tokenizeHtml` 白名单过滤之后产物只剩文本子节点，
 *   而 `container.children` **只数 Element、不数文本**。
 *
 * 两种都让 DOM 的直接子元素比「块」少一个。现在每个顶层块由
 * `renderMarkdown(root, { withBlockEnds: true })` 套一层带偏移的包装，一一对应由构造保证。
 * **渲染与测量共用这一个常量，改名要同步 `toReact.tsx`。**
 */
export const BLOCK_END_ATTR = 'data-block-end'

/**
 * 从一个装着「整篇文档」的隐藏容器里，量出每个顶层块的高度。
 *
 * 【为什么返回 `BlockHeight[] | null` 而不是空数组】`null` 的语义是**量不出来**，
 * 与「量到了，只是没有块」是两件事。上层拿到 null 要退回按字符数铺（设计第 7 节
 * 兜底 2），拿到空数组则会算出切点 0、铺出一张白纸。jsdom 里 `offsetHeight` 恒为 0，
 * 所以这条路径在单测里是**常态**而不是异常——`tests/` 跑的就是 jsdom。
 *
 * 【高度为什么取「下一个块的 offsetTop − 这个块的 offsetTop」，而不是 `offsetHeight`】
 * 相邻块之间的**外边距是折叠到包装元素之外的**，`offsetHeight` 量不到那一段。按
 * `offsetHeight` 累加，一页几十个块会少算几百像素——铺满就成了永远铺不满。末块后面
 * 没有下一个块，用它自己的 `offsetHeight`。
 * （前提是所有块共享同一个 `offsetParent`：`.wt-md-measure` 是 `position: absolute`，
 * 静态子元素的 offsetParent 就是它。换掉那条样式会让这里量出垃圾。）
 *
 * 【为什么要求每个块都读得到偏移】读不到说明这一份不是渲染时套出来的（有人往容器里
 * 塞了别的东西，或者包装被去掉了）。此时硬凑出来的偏移是错的，宁可退回兜底路径。
 *
 * 【为什么是「全是 0 才算量不出来」而不是「有一个是 0 就算」】高度真的可以为 0
 * （分隔线、空段落、`[a]: url` 那种渲染成空的块）。判据取严的那一侧：只要有一个块
 * 量到了非零高度，就说明这台环境是有布局的，那就照实返回。
 */
export function measureBlocks(container: HTMLElement | null): BlockHeight[] | null {
  if (!container) return null
  const kids = Array.from(container.children) as HTMLElement[]
  if (kids.length === 0) return null

  const ends: number[] = []
  for (const el of kids) {
    const raw = el.getAttribute(BLOCK_END_ATTR)
    // 空串要单独挡：`Number('')` 是 0，只判 `Number.isFinite` 会把「没写偏移」当成偏移 0 收下
    if (raw === null || raw.trim() === '') return null
    const end = Number(raw)
    if (!Number.isFinite(end)) return null
    ends.push(end)
  }

  const heights = kids.map((el, i) =>
    i + 1 < kids.length ? kids[i + 1].offsetTop - el.offsetTop : el.offsetHeight
  )
  if (heights.every((h) => h === 0)) return null

  return heights.map((height, i) => ({ end: ends[i], height }))
}
```

- [ ] **Step 4: 跑测试，确认它绿**

```bash
pnpm vitest run tests/unit/markdownMeasure.test.ts
pnpm typecheck
```

期望：全过，exit 0。

- [ ] **Step 5: 提交**

```bash
cat > /tmp/msg.txt <<'MSG'
feat(md): 加离屏量块高 —— 量不出来时明确返回 null

null 的语义是「量不出来」，与「量到了、只是没有块」分开：前者让上层退回
按字符数铺，后者会让切点变成 0、铺出白纸。jsdom 里 offsetHeight 恒为 0，
所以这条路径在单测里是常态——用例用 defineProperty 钉假高度来测映射那半边。
MSG
git add src/renderer/src/markdown/measure.ts tests/unit/markdownMeasure.test.ts
git commit -F /tmp/msg.txt
```

---

## Task 8: `markdown/MarkdownView.tsx` 与 `Page.tsx` 接线

对应设计文档第 6 节。

**`Page.tsx` 是被改的既有文件**，它的整文件围栏在 06 那份正本里（Task 13 统一回写）。本任务给的是**改动后的完整文件**，照抄。

**Files:**
- Create: `src/renderer/src/markdown/MarkdownView.tsx`
- Create: `tests/unit/markdownView.test.tsx`
- Modify: `src/renderer/src/components/Page.tsx`

- [ ] **Step 1: 写失败的测试**

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Page, type MarkdownSource } from '../../src/renderer/src/components/Page'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'

const DOC = ['# 季度汇报', '', '本季度共归档 3 项。', '', '- 归档流程上线', '- 复核环节压缩到 2 天'].join('\n')

function source(over: Partial<MarkdownSource> = {}): MarkdownSource {
  return { doc: parseMarkdown(DOC)!, revealStart: 0, cursor: DOC.length, measuring: false, ...over }
}

/** 每次渲染都按这几个必填 prop 调一遍 `Page`，省得每个用例重复十行。 */
function page(src: MarkdownSource | null, visibleText = '', props: { expanded?: boolean } = {}) {
  return render(
    <Page
      visibleText={visibleText}
      expanded={props.expanded ?? true}
      onToggleExpand={() => {}}
      empty={false}
      markdown={src}
    />
  )
}

describe('Page —— md 分支', () => {
  it('给了 markdown 就渲染结构，而不是裸文本', () => {
    const c = page(source()).container
    expect(c.querySelector('h1')).not.toBeNull()
    expect(c.querySelector('ul')).not.toBeNull()
    // 记号一个都不该露出来
    expect(c.querySelector('[data-testid="page-text"]')!.textContent).not.toContain('#')
    expect(c.querySelector('[data-testid="page-text"]')!.textContent).not.toContain('-')
  })

  it('光标推进，屏幕上就多一块（clipTree 真的接上了）', () => {
    const c = page(source({ cursor: DOC.indexOf('本季度') })).container
    expect(c.querySelector('h1')).not.toBeNull()
    expect(c.querySelector('p')).toBeNull() // 第二段还没开始
  })

  it('**不给 markdown 时行为完全不变**：渲染的还是那一个字符串', () => {
    const c = page(null, '第一章 甲').container
    expect(c.querySelector('[data-testid="page-text"]')!.textContent).toContain('第一章 甲')
    expect(c.querySelector('h1')).toBeNull()
    expect(c.querySelector('p')).toBeNull()
  })

  it('measuring 为真时多出一份隐藏的整篇副本，为假时没有', () => {
    // 【为什么必须能关掉】那份副本是**整篇**文档的 DOM，每次按键都渲染它
    // 是不可接受的；它只在算铺满的时候开一下
    expect(page(source({ cursor: 5 })).container.querySelector('.wt-md-measure')).toBeNull()
    const withMeasure = page(source({ cursor: 5, measuring: true })).container
    const measure = withMeasure.querySelector('.wt-md-measure')
    expect(measure).not.toBeNull()
    // 隐藏副本里的内容与光标无关，永远是整篇
    expect(measure!.querySelector('ul')).not.toBeNull()
  })

  it('measuring 为真时把容器交给上层', () => {
    const seen: (HTMLElement | null)[] = []
    page(source({ cursor: 5, measuring: true, onMeasureNode: (el) => seen.push(el) }))
    expect(seen.some((el) => el !== null && el.className.includes('wt-md-measure'))).toBe(true)
  })

  it('折叠条：按块边界折，数字是折点之前的字符数', () => {
    // 光标推到很后面，且 expanded 为假 —— 触发折叠
    const long = '# 标题\n\n' + '啊'.repeat(40000) + '\n'
    const doc = parseMarkdown(long)!
    const c = page({ doc, revealStart: 0, cursor: long.length, measuring: false }, '', { expanded: false }).container
    const fold = c.querySelector('[data-testid="page-fold"]')
    expect(fold).not.toBeNull()
    // 数字必须是个正数，而且小于总长——具体值随块边界走，不做字面断言
    const n = Number(fold!.textContent!.replace(/\D+/g, ''))
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(long.length)
  })

  /**
   * 【这条守的是「块的对齐」这件事本身】
   *
   * 量高度那一份副本里，**DOM 的直接子元素个数必须等于语法树的顶层节点个数**。
   * 少了这一条，`definition`（`[a]: url`，真 md 里很常见）与只含注释 / `<script>`
   * 的 HTML 块都会渲染出零个 Element，于是 DOM 比「块」少一个，
   * `measureBlocks` 恒返回 null，**整篇静默退回按字符数铺**——不报错、不白屏。
   *
   * 缺口是 Task 7 的实施者量出来的：他拿真实的 `renderMarkdown(doc)` 跑，
   * 数出来比 `doc.children.length` 少。
   */
  it('量高度那一份：DOM 子元素个数必须等于顶层节点个数（含 definition 与纯注释块）', () => {
    const src = [
      '# 标题',
      '',
      '[a]: https://example.com',
      '',
      '<!-- 一段注释 -->',
      '',
      '正文'
    ].join('\n')
    const doc = parseMarkdown(src)!
    const measure = page({ doc, revealStart: 0, cursor: 0, measuring: true }).container.querySelector(
      '.wt-md-measure'
    )!
    expect(measure.children.length).toBe(doc.children.length)
    // 顺带钉住每个包装都带着自己的结束偏移——`measureBlocks` 靠它配对
    for (const el of Array.from(measure.children)) {
      expect(el.getAttribute('data-block-end')).not.toBeNull()
    }
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

```bash
pnpm vitest run tests/unit/markdownView.test.tsx
```

期望：FAIL，**6 failed / 1 passed**。

**这条期望在实施时被改准过**（原文写的是「FAIL——`Page` 还没有 `markdown` 这个 prop（TS 报错），`MarkdownView` 也不存在」，两处都不成立）：`vitest run` **不做类型检查**，所以不会有 TS 报错；而且这份测试**根本不 import `MarkdownView`**（只 import `Page` 与 `parseMarkdown`）。真实的红全部来自**运行期断言**——旧 `Page` 把 `markdown` 当未知 prop 直接忽略掉。TDD 那一步照样成立，只是红的理由与原来写的不一样。

- [ ] **Step 3: 写 `MarkdownView`**

```tsx
import { useMemo, type ReactNode } from 'react'
import type { Root } from 'mdast'
import { clipTree } from './clip'
import { renderMarkdown } from './toReact'

export interface MarkdownViewProps {
  /** 整篇的语法树（解析一次，由上层缓存） */
  doc: Root
  /** 折叠起点：`revealStart` 或折点。它以下的内容不显示 */
  foldStart: number
  /** 阅读光标 */
  cursor: number
  /**
   * 为真时**额外**渲染一份整篇的隐藏副本，供量高度用。
   *
   * 【为什么不做成常开】那份副本是整篇文档的 DOM，而且每次按键都会重建。
   * 它只在「算铺满切点」那一下需要（进老板模式、按 ⌘⇧↑/↓），
   * 所以由上层开一下、量完就关。
   */
  measuring: boolean
  /** 隐藏副本挂载后把它交给上层——上层要拿它的直接子元素去量高度 */
  onMeasureNode?: (el: HTMLElement | null) => void
}

/**
 * 阅读区里那一段 markdown。
 *
 * 【它自己不做任何「该不该显示」的判断】裁剪全部在 `clipTree` 里（那份模块的注释
 * 是这条口径的正本）。这里只负责把裁剪后的树画出来，外加那份隐藏的整篇副本。
 *
 * 【隐藏副本为什么排在可见内容之后】它在 CSS 上是绝对定位、不参与流，位置在哪都不影响
 * 布局；但 `markdown.css` 有一条 `.wt-page__text > :first-child { margin-top: 0 }`，
 * 那条规则是给**第一个内容块**写的。副本排在前面就会把它顶掉。
 */
export function MarkdownView({
  doc,
  foldStart,
  cursor,
  measuring,
  onMeasureNode
}: MarkdownViewProps): ReactNode {
  const visible = useMemo(() => clipTree(doc, foldStart, cursor), [doc, foldStart, cursor])
  return (
    <>
      {renderMarkdown(visible)}
      {measuring && (
        <div className="wt-md-measure" ref={onMeasureNode} aria-hidden="true">
          {/*
            【`withBlockEnds` 是这一份副本独有的】它给每个顶层块套一层带
            `data-block-end` 的包装。这样「有几个块」就只由渲染这一处决定——
            渲染出 null 的节点（`definition`，即 `[a]: url` 那种链接引用定义，
            真 md 里很常见）照样有一个包装、高度 0。少了这一层，「DOM 子元素个数」
            与「外部数组长度」是两处各自决定的，永远能对不上，而对不上的后果是
            **整篇静默退回按字符数铺**：不报错、不白屏，只有真机上铺不满才看得出来。
          */}
          {renderMarkdown(doc, { withBlockEnds: true })}
        </div>
      )}
    </>
  )
}
```

**并在 `markdown.css` 末尾补上隐藏副本的样式**（Task 6 那个文件是新建的，此刻往它末尾追加一段，Task 13 会把这面围栏一起回写）：

```css
/* 量高度用的隐藏副本：绝对定位 + 不可见，但**参与布局**（`visibility: hidden`
   而不是 `display: none`——后者会让 offsetHeight 恒为 0，量不了）。 */
.wt-md-measure {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  visibility: hidden;
  pointer-events: none;
}
```

- [ ] **Step 4: 改写 `Page.tsx`**

整文件替换成：

```tsx
import type { ReactNode } from 'react'
import type { Root } from 'mdast'
import { RENDER_WINDOW_LIMIT } from '../../../core/types'
import { defaultShortcutText } from '../state/shortcuts'
import { pickFoldStart, type BlockSpan } from '../markdown/fill'
import { MarkdownView } from '../markdown/MarkdownView'

/** 当前显示的是 md 工作文档时，`Page` 需要知道的全部东西。 */
export interface MarkdownSource {
  /** 整篇的语法树。解析一次、由 `App` 缓存（见 `markdown/parse.ts` 的说明） */
  doc: Root
  /** 引擎的 `revealStart` */
  revealStart: number
  /** 引擎的 `cursor` */
  cursor: number
  /** 为真时额外渲染一份隐藏的整篇副本，供量高度用。见 `MarkdownView` */
  measuring: boolean
  onMeasureNode?: (el: HTMLElement | null) => void
}

export interface PageProps {
  visibleText: string
  expanded: boolean
  onToggleExpand: () => void
  empty: boolean
  /**
   * 导入快捷键的**显示文本**（已按平台格式化）。空状态那句提示用它。
   *
   * 【为什么是可选带默认值】真值住在 `App` 里（只有它手里有按平台补齐过的快捷键表），
   * 把真值喂下来是它的事；在那之前不传也得显示成**该平台的默认值**——写死一句
   * 「Ctrl+O」正是这次要消灭的东西（见 `defaultShortcutText` 的说明）。
   */
  importShortcut?: string
  /**
   * 给了它就走 markdown 分支，**不看 `visibleText`**；不给就是今天那条纯文本路。
   *
   * 【为什么是一个对象而不是几个平铺的 prop】这些值同生同灭（都只在「当前显示的是
   * md 工作文档」时才有意义）。平铺成五个可选 prop 会出现「给了 doc 却没给 cursor」
   * 这类半截状态，而那种状态没法在类型上排除。
   */
  markdown?: MarkdownSource | null
  children?: ReactNode
}

export function Page({
  visibleText,
  expanded,
  onToggleExpand,
  empty,
  importShortcut = defaultShortcutText('import'),
  markdown = null,
  children
}: PageProps) {
  const md = markdown ?? null
  /** md 这一路的「长度」是字符数，与纯文本那一路同一个量纲。 */
  const shownLength = md ? md.cursor - md.revealStart : visibleText.length
  const folded = !expanded && shownLength > RENDER_WINDOW_LIMIT
  /**
   * 【md 的折叠为什么按块边界】按字符硬切会把一段话、一张表切成两半，屏幕上就是残缺的
   * 东西（设计第 12 节最后一行）。块的字符跨度从语法树上直接读得到，不需要布局信息，
   * 所以折叠这一步**不**去量高度——它吃的是 `BlockSpan`，与铺满吃的 `BlockHeight`
   * 不是一回事。
   */
  const spans: BlockSpan[] = md
    ? md.doc.children.map((n) => ({
        start: n.position?.start.offset ?? 0,
        end: n.position?.end.offset ?? 0
      }))
    : []
  const foldStart = md ? (folded ? pickFoldStart(spans, RENDER_WINDOW_LIMIT) : md.revealStart) : 0
  const foldedChars = md ? foldStart - md.revealStart : visibleText.length - RENDER_WINDOW_LIMIT
  const shown = !md && folded ? visibleText.slice(visibleText.length - RENDER_WINDOW_LIMIT) : visibleText

  return (
    <div className="wt-page" data-testid="page">
      {empty ? (
        <div className="wt-page__empty" data-testid="page-empty">
          {`文件 → 设置 → 导入小说，或按 ${importShortcut}`}
          <br />
          导入后在文档区打字，字会按比例从小说里取出来。
        </div>
      ) : (
        <>
          {folded && (
            <div
              className="wt-page__fold"
              data-testid="page-fold"
              onClick={onToggleExpand}
              role="button"
            >
              ……已折叠前文 {foldedChars} 字（点击展开全部）
            </div>
          )}
          <div className="wt-page__text" data-testid="page-text">
            {md ? (
              <MarkdownView
                doc={md.doc}
                foldStart={foldStart}
                cursor={md.cursor}
                measuring={md.measuring}
                onMeasureNode={md.onMeasureNode}
              />
            ) : (
              shown
            )}
            <span className="wt-caret" data-testid="caret" />
          </div>
        </>
      )}
      {children}
    </div>
  )
}
```

- [ ] **Step 5: 跑测试与门禁，确认全绿**

```bash
pnpm vitest run tests/unit/markdownView.test.tsx
pnpm typecheck && echo TYPECHECK_OK
pnpm test && echo TEST_OK
```

期望：新用例全过；`pnpm test` **整轮** exit 0——`Page` 是老组件，改它最容易碰坏既有用例（`layout.test.tsx`、`app.test.tsx` 都渲染它）。**这一步红了就必须当场修，别带着红进下一个 Task。**

- [ ] **Step 6: 提交**

```bash
cat > /tmp/msg.txt <<'MSG'
feat(md): Page 接上 markdown 分支

Page 多一个可选的 markdown 对象；给了它就渲染结构、不给就还是今天那个
字符串，纯文本那一路一个字没变。

折叠对 md 改成按块边界切（按字符硬切会把一段话、一张表切成两半）。
量高度用的隐藏副本由 measuring 控制开关：它是整篇的 DOM，每次按键都渲染
不可接受，只在算铺满时开一下。
MSG
git add src/renderer/src/markdown/MarkdownView.tsx src/renderer/src/components/Page.tsx src/renderer/src/styles/markdown.css tests/unit/markdownView.test.tsx
git commit -F /tmp/msg.txt
```

---

## Task 9: 图片 —— 主进程那条通道，以及把占位换成真图

对应设计文档第 8 节。

**基准目录由主进程自己算**（从设置里读 `workDocPath` 取 `dirname`），**不接受渲染层传进来的路径**。这是本任务唯一一处刻意的收紧，别顺手改成让渲染层传 `baseDir`——那样渲染层就能指定任意基准目录去读文件。

**取图逻辑放在一个不碰 electron 的模块里**，因为它必须能被单测（`registerIpc` 全仓零覆盖，把逻辑写在 handler 里等于没有覆盖）。

**Files:**
- Create: `src/main/workDocImage.ts`
- Create: `tests/unit/workDocImage.test.ts`
- Create: `tests/unit/markdownImage.test.tsx`
- Modify: `src/main/channels.ts`、`src/main/ipc.ts`、`src/preload/index.ts`
- Modify: `src/renderer/src/types/global.d.ts`、`tests/setup.ts`
- Modify: `src/renderer/src/markdown/MarkdownImage.tsx`

- [ ] **Step 1: 写主进程侧的失败测试**

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadWorkDocImage, IMAGE_MAX_BYTES } from '../../src/main/workDocImage'

/** 一张最小的合法 PNG（1×1 透明）。用真字节，别用字符串假装。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

let dir: string | null = null
async function scratch(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'wt-img-'))
  return dir
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = null
  vi.unstubAllGlobals()
})

describe('loadWorkDocImage —— 本地', () => {
  it('相对路径按基准目录解析，产出 data: URL', async () => {
    const base = await scratch()
    await writeFile(join(base, 'a.png'), PNG)
    const out = await loadWorkDocImage('a.png', base)
    expect(out).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
  })

  it('绝对路径直接用', async () => {
    const base = await scratch()
    const full = join(base, 'b.png')
    await writeFile(full, PNG)
    expect(await loadWorkDocImage(full, '/完全无关的目录')).toBe(
      `data:image/png;base64,${PNG.toString('base64')}`
    )
  })

  it('文件不存在返回 null', async () => {
    expect(await loadWorkDocImage('没有这个.png', await scratch())).toBeNull()
  })

  it('不是图片扩展名一律不读', async () => {
    const base = await scratch()
    await writeFile(join(base, 'x.txt'), '内容')
    await writeFile(join(base, 'noext'), PNG)
    expect(await loadWorkDocImage('x.txt', base)).toBeNull()
    expect(await loadWorkDocImage('noext', base)).toBeNull()
  })

  it('超过大小上限返回 null', async () => {
    const base = await scratch()
    await writeFile(join(base, 'big.png'), Buffer.alloc(IMAGE_MAX_BYTES + 1))
    expect(await loadWorkDocImage('big.png', base)).toBeNull()
  })

  it('本来就是 data: URL 的原样交回', async () => {
    const inline = `data:image/png;base64,${PNG.toString('base64')}`
    expect(await loadWorkDocImage(inline, '/x')).toBe(inline)
  })
})

describe('loadWorkDocImage —— 网络', () => {
  function stubFetch(impl: () => Promise<Response> | Response): void {
    vi.stubGlobal('fetch', vi.fn(impl))
  }

  it('取回来转成 data: URL', async () => {
    stubFetch(
      () =>
        new Response(PNG, { headers: { 'content-type': 'image/png', 'content-length': String(PNG.length) } })
    )
    expect(await loadWorkDocImage('https://example.com/a.png', '/x')).toBe(
      `data:image/png;base64,${PNG.toString('base64')}`
    )
  })

  it('content-type 不是 image/* 的拒掉', async () => {
    stubFetch(() => new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }))
    expect(await loadWorkDocImage('https://example.com/a.json', '/x')).toBeNull()
  })

  it('HTTP 状态不是 2xx 的拒掉', async () => {
    stubFetch(() => new Response('', { status: 404 }))
    expect(await loadWorkDocImage('https://example.com/a.png', '/x')).toBeNull()
  })

  it('抛异常（超时、DNS 失败）时返回 null，不冒出去', async () => {
    stubFetch(() => Promise.reject(new Error('timeout')))
    expect(await loadWorkDocImage('https://example.com/a.png', '/x')).toBeNull()
  })

  it('声明的大小超上限就不读了', async () => {
    stubFetch(
      () =>
        new Response(PNG, {
          headers: { 'content-type': 'image/png', 'content-length': String(IMAGE_MAX_BYTES + 1) }
        })
    )
    expect(await loadWorkDocImage('https://example.com/big.png', '/x')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

```bash
pnpm vitest run tests/unit/workDocImage.test.ts
```

期望：FAIL，`Failed to resolve import .../main/workDocImage`。

- [ ] **Step 3: 写主进程实现**

```ts
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, resolve } from 'node:path'

/**
 * 取一张工作文档里引用的图片，产出 `data:` URL 交给渲染层。
 *
 * 【为什么必须经主进程】渲染层是沙箱（`sandbox: true`），读不到磁盘；而
 * `index.html` 里那条 CSP 是 `img-src 'self' data:`——**网络图片也进不来**。
 * 两条路都收在这一处：本地读文件、网络去取，出去的都是 `data:`，
 * 于是一个字节的 CSP 都不用改（设计 8.1）。
 *
 * 【为什么不做成 IPC handler 里的几行】`registerIpc` 全仓零测试覆盖。
 * 逻辑放在这个不碰 electron 的模块里，才能用真文件、真 fetch 桩去单测。
 *
 * 【大小与超时是硬闸】工作文档里的一个外链不该让应用卡住或吃光内存：
 * 单张 8MB、网络 10 秒。超了就当失败处理（渲染层显示占位框）。
 *
 * 【只认图片扩展名】本地这一路按扩展名判，判不过的直接不读——不靠「读出来再看
 * magic bytes」，那样等于先把任意文件读进内存。
 */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const IMAGE_TIMEOUT_MS = 10_000

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  // SVG 也收：它经 `<img>` 加载时**不会执行脚本**，是浏览器层面的保证
  '.svg': 'image/svg+xml'
}

export async function loadWorkDocImage(src: string, baseDir: string): Promise<string | null> {
  if (typeof src !== 'string' || src.length === 0) return null
  if (src.startsWith('data:image/')) return src
  if (/^https?:\/\//i.test(src)) return fetchRemote(src)
  return readLocal(src, baseDir)
}

async function readLocal(src: string, baseDir: string): Promise<string | null> {
  const mime = MIME[extname(src).toLowerCase()]
  if (!mime) return null
  const full = isAbsolute(src) ? src : resolve(baseDir, src)
  try {
    const buf = await readFile(full)
    if (buf.byteLength === 0 || buf.byteLength > IMAGE_MAX_BYTES) return null
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (err) {
    console.warn('[wt] 读工作文档图片失败：', full, err)
    return null
  }
}

async function fetchRemote(url: string): Promise<string | null> {
  try {
    // `AbortSignal.timeout` 与 `fetch` 都来自 `@types/node`：`tsconfig.node.json`
    // 的 lib 里没有 DOM，这两个名字是靠 `types: ["node"]` 拿到的
    const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
    if (!res.ok) return null
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!mime.startsWith('image/')) return null
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > IMAGE_MAX_BYTES) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > IMAGE_MAX_BYTES) return null
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (err) {
    console.warn('[wt] 取工作文档图片失败：', url, err)
    return null
  }
}
```

- [ ] **Step 4: 跑测试，确认它绿**

```bash
pnpm vitest run tests/unit/workDocImage.test.ts
pnpm typecheck
```

期望：全过，exit 0。**若 `AbortSignal` / `fetch` 报「找不到名字」**，那是 `tsconfig.node.json` 的 `types` 没生效，停下来报，别用 `any` 糊过去。

- [ ] **Step 5: 接线到 IPC**

`src/main/channels.ts` 的 `CH` 里加一条（放在 `loadWorkDoc` 之后）：

```ts
  loadWorkDocImage: 'wt:load-work-doc-image',
```

`src/main/ipc.ts` 顶部加 import：

```ts
import { loadWorkDocImage } from './workDocImage'
```

并在 `registerIpc` 里、`loadWorkDoc` 那个 handler **之后**加：

```ts
  /**
   * 取工作文档里的图片。
   *
   * 【基准目录为什么在这里算，而不是让渲染层传】渲染层若能指定基准目录，
   * 就等于能把「读相对路径」变成「读任意目录下的任意图片」。这里从设置里读
   * 工作文档自己的路径、取它的目录，渲染层能碰的范围就锁死在「工作文档旁边 + 网络」。
   *
   * 【失败返回 null，不抛】与 `loadWorkDoc` 同一姿态：读不出来是一条正常路径，
   * 渲染层显示占位框，不该把那次 invoke 打成 rejection。
   */
  ipcMain.handle(CH.loadWorkDocImage, async (_e, src: string): Promise<string | null> => {
    const docPath = getStore().readSettings().workDocPath
    const baseDir = docPath ? dirname(docPath) : ''
    return loadWorkDocImage(src, baseDir)
  })
```

（`dirname` 从 `node:path` 引：在 `src/main/ipc.ts` 顶部加 `import { dirname } from 'node:path'`。）

`src/preload/index.ts` 的 `api` 里、`loadWorkDoc` 之后加：

```ts
  loadWorkDocImage: (src: string) => ipcRenderer.invoke(CH.loadWorkDocImage, src),
```

- [ ] **Step 6: 补两处手写的 API 形状**

`src/renderer/src/types/global.d.ts` 的 `WtApi` 里、`loadWorkDoc` 之后加：

```ts
  /** 取一张工作文档里的图片，回来的是 `data:` URL；失败给 `null` */
  loadWorkDocImage: (src: string) => Promise<string | null>
```

`tests/setup.ts` 的 `benignApi` 里、`loadWorkDoc` 之后加：

```ts
  // 单测里一律「取不到图」，于是渲染层走占位框那条路
  loadWorkDocImage: async () => null,
```

**这两处必须都改。** `types/global.d.ts` 是**手写接口、没有闸**（往 preload 加方法不会让任何东西编译不过）；`tests/setup.ts` 那份**有闸**（少写一个报 TS2741）。跑 `pnpm typecheck` 确认第二处那条闸真的响了——把刚加的那行注释掉再跑一次，应当报 TS2741，然后加回来。

- [ ] **Step 7: 写渲染层的失败测试（图片组件）**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MarkdownImage } from '../../src/renderer/src/markdown/MarkdownImage'
import type { WtApi } from '../../src/renderer/src/types/global'

function install(load: (src: string) => Promise<string | null>): ReturnType<typeof vi.fn> {
  const spy = vi.fn(load)
  ;(window as unknown as { api: Partial<WtApi> }).api = { loadWorkDocImage: spy }
  return spy
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// 【每个用例用自己的地址，别复用】缓存是**模块级、跨用例存活**的（设计 8.4 要求它
// 不淘汰），而 `afterEach` 也清不掉它。两个用例用同一个地址就会互相污染：先跑的那个
// 把它定住（先挂起的那个永不 resolve，后跑的就永远停在占位框上）。实测过：三个用例
// 都用 `a.png` 时，「取不到就停在占位框上」红在「上一个用例缓存了 AAA」上。
describe('MarkdownImage', () => {
  it('还没取到时显示占位框与替代文字', () => {
    install(() => new Promise(() => {})) // 永不 resolve
    const c = render(<MarkdownImage url="还没回来.png" alt="架构图" />).container
    expect(c.querySelector('[data-testid="md-image"]')!.textContent).toBe('架构图')
    expect(c.querySelector('img')).toBeNull()
  })

  it('取到之后换成真的 img，src 是拿回来的 data URL', async () => {
    install(async () => 'data:image/png;base64,AAA')
    const c = render(<MarkdownImage url="a.png" alt="架构图" />).container
    await waitFor(() => expect(c.querySelector('img')).not.toBeNull())
    expect(c.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAA')
  })

  it('取不到（null）就停在占位框上，不抛', async () => {
    install(async () => null)
    const c = render(<MarkdownImage url="取不到.png" alt="架构图" />).container
    await waitFor(() => expect(c.querySelector('[data-testid="md-image"]')).not.toBeNull())
    expect(c.querySelector('img')).toBeNull()
  })

  it('同一个地址只请求一次（模块级缓存）', async () => {
    const spy = install(async () => 'data:image/png;base64,BBB')
    render(<MarkdownImage url="同一条.png" alt="a" />)
    render(<MarkdownImage url="同一条.png" alt="b" />)
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('空地址不请求，直接是占位框', () => {
    const spy = install(async () => 'x')
    render(<MarkdownImage url="" alt="没地址" />)
    expect(spy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 8: 把占位换成真取图**

整文件替换 `src/renderer/src/markdown/MarkdownImage.tsx`：

```tsx
import { useEffect, useState, type ReactNode } from 'react'

export interface MarkdownImageProps {
  url: string
  alt: string
}

/**
 * 取过的图片按地址缓存。**存的是那次请求本身（Promise），不是它的结果。**
 *
 * 【为什么必须有这一层】阅读区每次按键都重渲染，而图片节点在树里是稳定的；
 * 没有缓存的话，节点每重建一次就重发一次 IPC——大图的 base64 会一次次地搬。
 *
 * 【为什么存 Promise 而不是结果】同一个地址在一份文档里出现两次是常事，而两个
 * `MarkdownImage` 是在**同一次提交里挂载**的：那会儿第一次请求还没回来，
 * 「结果缓存」两次都落空，于是发两次 IPC。存 Promise 才是真的「同一个地址只请求一次」。
 * （写成本文件最初那一版时实测过：两个同地址节点 `toHaveBeenCalledTimes(2)`。）
 *
 * 【为什么必带 catch】这个 Promise 会一直躺在缓存里，一旦是 rejected 的，之后每次
 * 挂载都会拿到同一个拒绝——不但永远画不出图，还会变成一个 unhandled rejection
 * （本仓库实测过：那会让整轮 vitest 的 exit code 变 1，而用例行照旧 passed）。
 *
 * 【为什么不做淘汰】地址来自工作文档，一个文档里的图片地址个数天然有限；
 * 换文档时整棵子树都会被重建，而模块级的这份缓存会留下来。留下的是 base64，
 * 有界但不清——真出现「换了很多文档、内存涨上去」再考虑，现在加淘汰是过度设计。
 */
const cache = new Map<string, Promise<string | null>>()

/** 按地址取一次图。同一个地址并发调用只发一次 IPC。 */
function fetchOnce(url: string): Promise<string | null> {
  const hit = cache.get(url)
  if (hit) return hit
  const api = (
    window as unknown as { api?: { loadWorkDocImage?: (s: string) => Promise<string | null> } }
  ).api
  const p = (api?.loadWorkDocImage?.(url) ?? Promise.resolve(null)).catch(() => null)
  cache.set(url, p)
  return p
}

/**
 * markdown 图片。
 *
 * 【两种形态】拿不到图（还没回来 / 失败 / 空地址）时是**占位框 + 替代文字**，
 * 拿到了才是 `<img>`。占位框那一态是有用的：抽字是逐字来的，图片那一小段语法
 * 刚被揭示时请求还没回来，屏幕上得有个东西占住位置，否则会看到文字跳一下。
 *
 * 【为什么地址交给主进程解析】相对路径的基准目录只有主进程知道（它从设置里读
 * 工作文档自己的路径）。渲染层传的只是一个原样的 `src`。
 */
export function MarkdownImage({ url, alt }: MarkdownImageProps): ReactNode {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!url) return
    let alive = true
    void fetchOnce(url).then((v) => {
      if (alive) setDataUrl(v)
    })
    return () => {
      alive = false
    }
  }, [url])

  if (!url || !dataUrl) {
    return (
      <span className="wt-md-img" data-src={url} data-testid="md-image">
        {alt}
      </span>
    )
  }
  return <img className="wt-md-img-real" src={dataUrl} alt={alt} data-testid="md-image-real" />
}
```

**并在 `markdown.css` 末尾追加**（真图的样式；限宽是为了不把纸撑破）：

```css
/* 真图：最宽不超过正文宽，高度自适应。`display: block` 让块级图片独占一行，
   与 Word 里「嵌入型」图片的行为一致。 */
.wt-md-img-real {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0.4em 0;
}
```

- [ ] **Step 9: 跑门禁**

```bash
pnpm vitest run tests/unit/workDocImage.test.ts tests/unit/markdownImage.test.tsx
pnpm typecheck && echo TYPECHECK_OK
pnpm test && echo TEST_OK
```

期望：新用例全过；整轮 exit 0。

- [ ] **Step 10: 提交**

```bash
cat > /tmp/msg.txt <<'MSG'
feat(md): 工作文档里的图片能真的显示了

本地与网络两条路都收在主进程：本地的按「工作文档所在目录」解析相对路径，
网络的主进程去取；出去的统一是 data: URL，所以 index.html 里那条
img-src 'self' data: 一个字都不用改。

基准目录由主进程自己从设置里算，不接受渲染层传路径——否则「读相对路径」
就等于「读任意目录」。

单张 8MB、网络 10 秒；本地只认图片扩展名，不靠先读进来再看 magic bytes。
取图逻辑放在不碰 electron 的模块里，因为它必须能被单测
（registerIpc 全仓零覆盖）。
MSG
git add src/main/workDocImage.ts src/main/channels.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/types/global.d.ts tests/setup.ts src/renderer/src/markdown/MarkdownImage.tsx src/renderer/src/styles/markdown.css tests/unit/workDocImage.test.ts tests/unit/markdownImage.test.tsx
git commit -F /tmp/msg.txt
```

---

## Task 10: `App.tsx` 接线 —— 判定、解析缓存、把 md 交给 `Page`

对应设计文档第 6 节的「渲染一次按键的数据流」。

**Files:**
- Modify: `src/renderer/src/markdown/parse.ts`（加 `isMarkdownPath`）
- Modify: `tests/unit/markdownParse.test.ts`（加一条用例）
- Modify: `src/renderer/src/App.tsx`
- Modify: `tests/unit/app.test.tsx`

- [ ] **Step 1: 给 `parse.ts` 加判定函数，先写用例**

在 `tests/unit/markdownParse.test.ts` 的 `describe` 里追加：

```ts
  it('按扩展名判定：.md / .markdown 才算，大小写不敏感', () => {
    expect(isMarkdownPath('/Users/某人/周报.md')).toBe(true)
    expect(isMarkdownPath('/Users/某人/周报.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('/Users/某人/周报.txt')).toBe(false)
    // 【这一条是刻意的】内容长得像 md 的 txt 不渲染：导入 txt 的人要的就是原文
    expect(isMarkdownPath('/Users/某人/周报.md.txt')).toBe(false)
    expect(isMarkdownPath('/Users/某人/周报')).toBe(false)
  })
```

并把文件顶部的 import 改成：

```ts
import { parseMarkdown, isMarkdownPath } from '../../src/renderer/src/markdown/parse'
```

- [ ] **Step 2: 跑测试，确认它红**

```bash
pnpm vitest run tests/unit/markdownParse.test.ts
```

期望：FAIL——`isMarkdownPath` 不是 `parse.ts` 的导出。

- [ ] **Step 3: 实现 `isMarkdownPath`**

在 `src/renderer/src/markdown/parse.ts` 末尾追加：

```ts
/**
 * 这份工作文档要不要渲染。
 *
 * 【为什么按扩展名而不是按内容嗅探】「内容长得像 md」判不准，而且判错的代价是
 * 双向的：把一份纯文本当 md 渲染会吃掉里面的 `*` 和 `#`，把一份 md 当纯文本
 * 又会露出记号。扩展名是用户的意图，也是他后来能自己改回来的东西。
 *
 * 【`.md.txt` 判 false 是有意的】`extname` 只看最后一段。用户的意图是 txt。
 */
const MARKDOWN_EXT = /\.(md|markdown)$/i

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_EXT.test(filePath)
}
```

- [ ] **Step 4: 跑测试，确认它绿**

```bash
pnpm vitest run tests/unit/markdownParse.test.ts
```

期望：全过。

- [ ] **Step 5: 写 App 层的失败测试**

在 `tests/unit/app.test.tsx` 里加一组（**别新建文件**：这一组要用到 `installApi` / `makeWorkDoc` / `pressBossKey` / `importViaSettings` 这几个既有助手）。

**动手前先核两件事**，因为下面 7b 与 7c 的代码按它们成立来写：

1. `useTypingEngine` 返回的那个 state 上有没有 `revealStart` 与 `cursor` 两个字段（`EngineState` 的定义在 `src/core/engine.ts` 顶部）。若只有 `revealStart` 没有 `cursor`，就用引擎上的 `visibleText` 长度换算，**并在注释里写明为什么**——别默默改成别的写法。
2. `bossFillPercentRef` 与 `bossFillPercent` 这对名字是否就是既有代码用的（铺满量在 `App` 里的那份 ref + state）。

两条有一条不成立就**停下来报**，别自己改口径。

```tsx
describe('工作文档的 markdown 渲染', () => {
  it('导入 .md 后按老板键：阅读区是渲染后的结构，不是裸文本', async () => {
    const doc: Novel = {
      ...makeWorkDoc(),
      sourcePath: '/tmp/季度汇报.md',
      flatText: '# 季度汇报\n\n本季度共归档 3 项。\n'
    }
    installApi(makeNovel(), null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await pressBossKey()

    await waitFor(() => expect(screen.getByTestId('page-text').querySelector('h1')).not.toBeNull())
    // 记号一个都不该露出来
    expect(screen.getByTestId('page-text').textContent).not.toContain('#')
  })

  it('.txt 工作文档走纯文本那条路：既不渲染，也不掉字', async () => {
    const doc: Novel = {
      ...makeWorkDoc(),
      sourcePath: '/tmp/季度汇报.txt',
      flatText: '# 季度汇报\n\n本季度共归档 3 项。\n'
    }
    installApi(makeNovel(), null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await pressBossKey()

    await waitFor(() => expect(screen.getByTestId('page-text').textContent).toContain('#'))
    expect(screen.getByTestId('page-text').querySelector('h1')).toBeNull()
  })

  it('小说那条路一个字没变（.md 判定不会漏到它身上）', async () => {
    const n: Novel = { ...makeNovel(), sourcePath: '/tmp/书.md' }
    installApi(n, null, defaultSettings())
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    expect(screen.getByTestId('page-text').querySelector('h1')).toBeNull()
  })
})
```

**`installApi` / `makeWorkDoc` 若签名与本任务假设的不一致**（比如 `installApi` 的第四个参数名字不同），按它们的实际签名写，别去改助手——那几个助手是老板键那一批的交付物，改动会波及一批用例。

- [ ] **Step 6: 跑测试，确认它红**

```bash
pnpm vitest run tests/unit/app.test.tsx
```

期望：第一条 FAIL（`page-text` 里没有 `h1`）；后两条此时应当已经通过（它们断言的是「没变」）。

- [ ] **Step 7: 改 `App.tsx`**

**7a.** 顶部 import 加两条（与既有的 import 放在一起）：

```ts
import { isMarkdownPath, parseMarkdown } from './markdown/parse'
import type { MarkdownSource } from './components/Page'
```

**7b.** 在 `const shownEngine = ...`（现约 248 行）之后加：

```tsx
  /**
   * 【解析只做一次，缓存在这里】`useMemo` 的键是 `shownNovel` 这个对象：
   * 它只在「换书 / 切老板模式 / 重新导入」时换身份，按键时不换。
   * 200KB 的 md 解析是几十毫秒量级，每次按键重解析不可接受。
   *
   * 【判定按扩展名，只在工作文档这一路生效】小说的导入过滤器只收 txt，
   * 但「所有文件」那个入口能让人选到 .md——那种情况下这里的判定也会为真，
   * 而它与「工作文档」是同一套渲染，行为一致，不是漏洞。
   *
   * 【解析失败（null）就退回纯文本】`mdDoc` 为 null 时下面那个 `mdSource` 也是 null，
   * `Page` 走纯文本那条路（设计第 12 节：不许白屏）。
   */
  const mdDoc = useMemo(() => {
    if (!shownNovel || !isMarkdownPath(shownNovel.sourcePath)) return null
    return parseMarkdown(shownNovel.flatText)
  }, [shownNovel])

  /**
   * 量高度用的隐藏副本开关。默认关：那份副本是**整篇**文档的 DOM，
   * 每次按键都渲染它不可接受。只有「要算铺满切点」时才开一下（Task 11）。
   */
  const [measuring, setMeasuring] = useState(false)
  /** 隐藏副本的根元素。`MarkdownView` 挂载时交过来，量高度时读它的直接子元素 */
  const measureElRef = useRef<HTMLElement | null>(null)
  const onMeasureNode = useCallback((el: HTMLElement | null): void => {
    measureElRef.current = el
  }, [])

  const mdSource: MarkdownSource | null =
    mdDoc && state
      ? {
          doc: mdDoc,
          revealStart: state.revealStart,
          cursor: state.cursor,
          measuring,
          onMeasureNode
        }
      : null
```

**7c.** 把 `<Page ...>` 那一处（现约 778 行）加上一个 prop：

```tsx
            <Page
              visibleText={visibleText}
              expanded={expanded}
              onToggleExpand={() => setExpanded(true)}
              empty={!shownNovel}
              importShortcut={formatShortcut(shortcutTable.import, kind)}
              markdown={mdSource}
            >
```

- [ ] **Step 8: 跑门禁**

```bash
pnpm vitest run tests/unit/app.test.tsx
pnpm typecheck && echo TYPECHECK_OK
pnpm test && echo TEST_OK
```

期望：全绿，整轮 exit 0。

- [ ] **Step 9: 提交**

```bash
cat > /tmp/msg.txt <<'MSG'
feat(md): App 接上渲染分支

按 sourcePath 的扩展名判定（.md / .markdown），解析结果按 shownNovel
这个对象缓存在 useMemo 里——按键时不换身份，所以不会每次按键重解析。

解析失败退回纯文本那条路。小说那条路与 .txt 工作文档一个字没变，
各有一条用例守着。
MSG
git add src/renderer/src/markdown/parse.ts src/renderer/src/App.tsx tests/unit/markdownParse.test.ts tests/unit/app.test.tsx
git commit -F /tmp/msg.txt
```

---

## Task 11: 铺满改走「量高度 → 算切点」，量不出退回字符数

对应设计文档第 7 节。

**这是本功能最容易做歪的一处**：它是唯一需要真实布局的地方，而 `tests/` 跑的是 jsdom、没有布局。所以它必须拆成两半——量（只有真机能做）与算（纯函数，Task 3 已经做完并有用例）。本任务要保证的正是**那条降级路径真的存在、且被用例钉住**。

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/core/bossKey.ts`（**只改注释**）
- Modify: `tests/unit/app.test.tsx`

- [ ] **Step 1: 写失败的测试**

```tsx
  it('进老板模式时量不出块高（jsdom 没有布局）→ 退回按字符数铺，屏幕不是空的', async () => {
    const doc = makeWorkDoc()
    installApi(makeNovel(), null, { ...defaultSettings(), bossFillPercent: 100, workDocPath: doc.sourcePath }, doc)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await pressBossKey()

    // 【这条守的是降级路径本身】jsdom 里 offsetHeight 恒为 0，measureBlocks 返回 null，
    // 于是走 fillCharsFor(100) = 1330 字那条老路。屏幕上有字，而不是空白。
    await waitFor(() => {
      const text = screen.getByTestId('page-text').textContent ?? ''
      expect(text.length).toBeGreaterThan(0)
    })
    expect(screen.getByTestId('page-text').textContent!.length).toBeLessThanOrEqual(1330)
  })

  it('量高度期间不渲染那份隐藏副本之外的东西：measuring 关掉之后副本就没了', async () => {
    const doc = makeWorkDoc()
    installApi(makeNovel(), null, { ...defaultSettings(), workDocPath: doc.sourcePath }, doc)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await pressBossKey()
    await waitFor(() => expect(screen.getByTestId('page-text').textContent!.length).toBeGreaterThan(0))
    // 副本只在算铺满那一下存在；量完必须关掉，否则每个按键都在重建整篇 DOM
    await waitFor(() => expect(document.querySelector('.wt-md-measure')).toBeNull())
  })
```

- [ ] **Step 2: 跑测试，确认第二条红**

```bash
pnpm vitest run tests/unit/app.test.tsx -t '量高度期间'
```

期望：FAIL——`measuring` 这一版永远是 `false`，所以隐藏副本从来不存在，`toBeNull()` 会**通过**……**注意这一条会假绿**。所以先做 Step 3 把 `measuring` 打开，再回来看它红不红。**这正是本任务最容易自欺的地方：一条「关掉了所以不存在」的断言在开关从没打开过时也是绿的。** 把这条用例改成先断言它出现过：

```tsx
    // 先确认它真的出现过（否则「量完就没了」这条断言在开关从没打开时也成立）
    await waitFor(() => expect(document.querySelector('.wt-md-measure')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('.wt-md-measure')).toBeNull())
```

- [ ] **Step 3: 改 `App.tsx` —— 铺满那条路**

**3a.** 顶部 import 补上：

```ts
import { clampBossFillPercent, fillCharsFor } from '../core/bossKey'
import { pickFillCut, type BlockHeight } from './markdown/fill'
import { measureBlocks } from './markdown/measure'
```

（`clampBossFillPercent` / `fillCharsFor` 若已在 import 里就只补后两条。）

**3b.** 在 `measuring` 那几个 state 之后加：

```tsx
  /**
   * 量好的块高表。
   *
   * 【为什么缓存】算铺满切点要用它，而它只跟「文档 + 样式」有关，与铺满百分比无关。
   * 于是按 ⌘⇧↑/↓ 时只重算切点，不重量。挂 `doc` 一起存，换文档自然失效。
   */
  const heightsRef = useRef<{ doc: unknown; heights: BlockHeight[] } | null>(null)
  /** 有一次「开量高度」在等结果：量完要拿它接着算切点 */
  const pendingFillRef = useRef<number | null>(null)

  /** 纸张正文区的高度。**量出来的，不是写死的 912**。 */
  const pageTextHeight = useCallback((): number => {
    const el = document.querySelector('.wt-page')
    if (!(el instanceof HTMLElement)) return 0
    const cs = getComputedStyle(el)
    const inner = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    return Number.isFinite(inner) && inner > 0 ? inner : 0
  }, [])

  /**
   * 铺满：能算就直接算，算不了就先开量高度、等量完再算。
   *
   * 【三条路，顺序不能换】
   * 1. 有缓存（同一份文档量过）→ 直接算切点；
   * 2. 没有缓存 → 开 `measuring` 渲染隐藏副本，把百分比记在 `pendingFillRef` 里，
   *    量完的那个 effect 接着算；
   * 3. 量不出来（jsdom、或者量出来是 0）→ **退回按字符数**（`fillCharsFor`）。
   *    这条兜底是设计第 7 节写明的，也是这条路径唯一能在单测里跑到的那一半。
   */
  const applyFill = useCallback(
    (percent: number): void => {
      const eng = workEngine
      if (!eng) return
      const cached = heightsRef.current
      if (mdDoc && cached && cached.doc === mdDoc) {
        eng.revealTo(pickFillCut(cached.heights, (pageTextHeight() * percent) / 100))
        return
      }
      if (!mdDoc) {
        // 不是 md：没有结构可量，本来就是按字符数铺
        eng.revealTo(fillCharsFor(percent))
        return
      }
      pendingFillRef.current = percent
      setMeasuring(true)
    },
    [workEngine, mdDoc, pageTextHeight]
  )

  /**
   * 隐藏副本渲染完之后：量高度、算切点、把开关关掉。
   *
   * 【为什么必须在 effect 里】量的是 DOM 的布局，而布局要等 commit 之后才有。
   */
  useEffect(() => {
    if (!measuring) return
    const el = measureElRef.current
    /**
     * 【为什么整个包在 try 里】设计第 7 节那条兜底写的是「量不出高度（jsdom 里
     * `offsetHeight` 恒为 0，**或测量抛错**）→ 退回按字符数」。`offsetHeight` 本身
     * 不抛，但读布局在渲染异常、DOM 已被卸载之类的情况下会抛，而这条 effect 里抛出去
     * 就是一次未捕获异常。包住它，兜底路径才真的是兜底。
     *
     * 【为什么不再传 ends】`measureBlocks` 现在从 DOM 自己的 `data-block-end` 读偏移，
     * 不再吃一个外部数组。原因是那样是「两处各自决定有几个块」，永远能对不上；
     * 而对不上的后果是整篇静默退回按字符数铺（见 `MarkdownView` 里那段说明）。
     */
    let heights: BlockHeight[] | null = null
    try {
      heights = measureBlocks(el)
    } catch (err) {
      console.warn('[wt] 量 markdown 块高失败，退回按字符数铺：', err)
    }
    const percent = pendingFillRef.current
    pendingFillRef.current = null
    if (heights && mdDoc) heightsRef.current = { doc: mdDoc, heights }
    // 量到了就用高度算，量不到就退回按字符数 —— 两条都在这里分岔
    workEngine?.revealTo(
      heights ? pickFillCut(heights, (pageTextHeight() * (percent ?? 0)) / 100) : fillCharsFor(percent ?? 0)
    )
    setMeasuring(false)
  }, [measuring, mdDoc, workEngine, pageTextHeight])
```

**3c.** 把 `toggleBoss` 里那一行 `if (next) workEngine.revealTo(fillCharsFor(bossFillPercentRef.current))` 换成：

```tsx
    if (next) applyFill(bossFillPercentRef.current)
```

并把 `toggleBoss` 的依赖数组里的 `workEngine` 换成 `applyFill`（`workEngine` 若还被函数体用到就留着，两者都列）。

**3d.** 把 `adjustBossFill` 里那一行 `if (bossActive) workEngine?.revealTo(fillCharsFor(next))` 换成：

```tsx
      if (bossActive) applyFill(next)
```

并把它的依赖数组里的 `workEngine` 换成 `applyFill`。

**3e.** 导入 / 移除工作文档时把量好的高度丢掉。在 `handleImportWorkDoc` 与 `handleRemoveWorkDoc` 里各加一行：

```tsx
    heightsRef.current = null
```

- [ ] **Step 4: 改 `src/core/bossKey.ts` 的注释（逻辑一行不动）**

`CHARS_PER_SHEET` 上面那段推导注释之后补一段：

```ts
/**
 * 【本常量的地位变了：从「唯一的路」降级成「兜底的路」】
 *
 * markdown 工作文档的铺满改成了「量出每个块的真实高度、切在块边界上」——因为渲染
 * 之后这个纯文本估算不再成立：记号被吃掉不显示、标题字号更大、列表有缩进、
 * 表格有边框。所以那个 1330 只在**量不出高度**时兜底（jsdom、或量出来是 0）。
 *
 * `bossFillPercent` 的含义也随之从「一页**字符数**的百分比」变成「一页**高度**的
 * 百分比」。100% 仍然是「刚好一页」，只是这个「一页」从估的变成量的。
 *
 * 别把这条兜底删掉：它是铺满那条路上唯一能在单测里跑到的一支。
 */
```

- [ ] **Step 5: 跑门禁**

```bash
pnpm vitest run tests/unit/app.test.tsx
pnpm typecheck && echo TYPECHECK_OK
pnpm test && echo TEST_OK
```

期望：全绿。

**若第一条用例红在「文本长度超过 1330」**，说明 `applyFill` 走进了高度那条路而 jsdom 里又量出了非零高度——那是 `measureBlocks` 的判据有问题（jsdom 里 `offsetHeight` 恒为 0），回去看 Task 7 的用例是不是漏了。

- [ ] **Step 6: 提交**

```bash
cat > /tmp/msg.txt <<'MSG'
feat(md): 铺满改走「量真实高度、切在块边界」

进老板模式与按 ⌘⇧↑/↓ 时：先量每个顶层块的高度，再选中最后一个装得下的块
作为切点，于是屏幕底部永远是一整块（不切半句话、半张表）。块高表按文档缓存，
按 +/- 时只重算切点、不重量。

量不出来时退回按字符数（CHARS_PER_SHEET 那套）——这条兜底是 jsdom 里唯一
能跑到的一支，有一条用例专门钉它。bossKey.ts 只改注释，逻辑一行没动。
MSG
git add src/renderer/src/App.tsx src/core/bossKey.ts tests/unit/app.test.tsx
git commit -F /tmp/msg.txt
```

---

## Task 12: 改写 `CLAUDE.md` 里的核心不变量

对应设计文档第 13 节第 1 条。

**这一条不改代码，但必须做。** 现在 `CLAUDE.md` 写的是「阅读区显示的内容恒等于 `flatText.slice(revealStart, cursor)`」——渲染之后这句话在 `.md` 那一路上**不再成立**，而 `CLAUDE.md` 是下一个改这块代码的人第一个读的东西。不改它，那条不变量就变成了一句会误导人的话。

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 找到那一段**

在 `CLAUDE.md` 里搜「### 核心不变量」（在「### `src/core/` 的纯净性是被构建配置强制的」那一节之后）。它现在是这样：

```
### 核心不变量

**阅读区显示的内容恒等于 `flatText.slice(revealStart, cursor)`**，除此之外阅读区不显示任何小说文字。导入的文本**运行期只读、永不修改**；用户感知到的一切「变化」都只是游标整数在动。改 `engine.ts` 前先读这一段与 spec §2。
```

- [ ] **Step 2: 整段替换成**

```
### 核心不变量

**小说与 `.txt` 工作文档：阅读区显示的内容恒等于 `flatText.slice(revealStart, cursor)`**，除此之外阅读区不显示任何小说文字。

**`.md` 工作文档：显示出来的文字等于「已揭示那一段去掉语法记号之后」的文字**，此外不显示任何未揭示的字符；只有已经开始（起始偏移 < cursor）的块才画结构骨架，骨架里不含未揭示的字符。也就是说，「按字符揭示」这套机制没有变，变的是**同样的字符在屏幕上长什么样**——`#`、`**`、`|` 是字符但不作为字形出现，表格与图片的框会提前占位。改这一路之前先读 `docs/superpowers/specs/2026-10-14-markdown-rendering-design.md` 的第 3.1 / 3.2 / 5 三节。

导入的文本**运行期只读、永不修改**；用户感知到的一切「变化」都只是游标整数在动。改 `engine.ts` 前先读这一段与 spec 第 2 节。
```

改动只有两处：把原来那一句拆成「不渲染的那两路」与「渲染的那一路」，以及把末尾那个 `§2` 写成「第 2 节」（这份文档其余地方的 `§` 是历史写法，**新写的部分不跟着抄**）。

- [ ] **Step 3: 提交**

```bash
cat > /tmp/msg.txt <<'MSG'
docs: CLAUDE.md 的核心不变量按「渲染 / 不渲染」两条路改写

原来那句「阅读区显示的内容恒等于 flatText.slice(revealStart, cursor)」
在 .md 工作文档那一路不再成立：记号是字符但不作为字形出现，表格与图片的
框会提前占位。不写清这条，「按字符揭示」会被读成「屏幕上就是那一串字符」。

小说与 .txt 那两路一个字没变。
MSG
git add CLAUDE.md
git commit -F /tmp/msg.txt
```

---

## Task 13: 收尾 —— 把实现计划里的围栏同步成源码

**这是最后一步，而且必须是最后一步。** 源码一旦冻结并提交，就把前面那些改动过的既有文件在 `docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md`（06 那份正本）里的**整文件围栏**同步过去；本计划自己那些围栏，凡是实现期间与源码不一致的，也一并同步。

**这个 Task 在源码冻结之后跑。** 若跑完之后源码又变了（返工、修 bug），**不要硬提交**——重跑一遍。一份陈旧的「已同步」提交比没有更糟，因为它读起来像做完了。

**Files:**
- Modify: `docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md`
- Modify: `docs/superpowers/plans/2026-10-14-markdown-rendering.md`

- [ ] **Step 1: 钉基线，别用 `git show HEAD`**

```
BASE=9f8be20     # 本功能动手之前的那个提交（feat/boss-key 的 tip）
```

**`git show HEAD:<path>` 在这里是错的**：回写在若干个提交之后跑，那时 HEAD 已经是改完的版本，于是脚本「替换了 0 块」而且不报错。

- [ ] **Step 2: 写回写脚本**

抽围栏的正则**必须写成「任意标签」**：

```python
FENCE = re.compile(r'^```[^\n]*\n', re.M)
```

写成 `(?:ts|tsx|js|json|css)?` 这种窄枚举会漏掉 06 那份里的 16 个 ` ```bash ` 围栏，配对于是错位。**正向检查与回写脚本必须同源。**

块内行整体替换、保留围栏行本身；多块按块索引**倒序** splice，否则前面的替换会让后面的行号失效。

「改动前」的内容要匹配**基线或区间内任一版本**（`git show $BASE:<path>`，以及 `$BASE..HEAD` 之间该文件的每一个版本）——评审返工之后，计划里的围栏可能等于的是中间某个提交，既不等于基线也不等于新 HEAD。

**脚本里那个文件清单要硬编码在脚本内部，不要写成 `CHANGED="a b c"` 再加 `$CHANGED`**：zsh 不会对未加引号的变量做分词，于是脚本只收到一个 argv、三个文件全部「替换了 0 块」而 exit code 是 0。这条实测踩过。清单里少一个路径就让脚本 `sys.exit(1)`。

- [ ] **Step 3: 跑三条判据**

```
1. 正向判据：遍历 src/**/*.{ts,tsx,css} 与 tests/**/*.ts*，
   报告「没有任何围栏与它逐字节相等」的文件集合 —— 必须是 0 个。
   口径：md5(围栏原始内容) == md5(文件)，原样相等，含末尾换行，不要 rstrip。

2. 片段判据：每面 ```ts / ```tsx 围栏正文（容忍结尾一个换行）必须是某个文件的子串。
   【口径要说清】这条判据只在**本次交付的那份计划**上有意义：四份计划一起跑会报出
   几十面失配，那些全是 06 / configurable-shortcuts / settings-and-per-book-progress
   三份里的历史版本（例如 06 里那面 70 行的 ipc.ts 旧全文），按约定本来就不追。
   所以报数字时必须带上口径。

3. CSS 手核：两条自动判据都看不见 word.css / ribbon.css / page.css / markdown.css。
   本任务新增/改动过 markdown.css，它要有整文件围栏，且与文件逐字节相等。
```

- [ ] **Step 4: 重跑门禁并提交**

```bash
pnpm typecheck && echo TYPECHECK_OK
pnpm test && echo TEST_OK
git add docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md docs/superpowers/plans/2026-10-14-markdown-rendering.md
git commit -F /tmp/msg.txt
```

期望：门禁全绿；正向判据 0；片段判据只剩有据可查的示意性片段（本计划里至少有一面是刻意的合成片段，别为了让它变绿去删）。

---

## 交给用户的真机验收清单

这几条 jsdom 判不了，**由用户跑**（本仓库惯例）：

1. **观感**：导入一份真的 `.md` 工作文档，按老板键。标题字号、列表、引用块、代码块、表格是不是像一份 Word 文档。
2. **铺满是不是真的满页**——这是本次最容易做歪的一条。按 `⌘⇧B` 之后看屏幕底部：应当是一整块（不切半句话、半张表）。再按 `⌘⇧↑` / `⌘⇧↓`，画面应当当场变多/变少，且**始终是整块的**。
3. **深色主题**：切到深色，看标题那个蓝是否看得清、代码块底色、表格网格线。**再单独看一眼「深色主题 + 浅色纸」**（纸张开关不打开）——那时纸仍是白的，标题必须还是浅色那一套蓝。这条是本次配色最容易写错的地方。
4. **中文输入法**：老板模式下用输入法打字，候选框正常、字正常出来。
5. **图片**：本地相对路径的图（和 md 放同一个目录）能显示；外链图能显示；把本地那张图删掉，屏幕上退回占位框 + 替代文字，不报错。
6. **表格列多时不出横向滚动条**；代码块里的长行是折行的。
7. **任务列表的方框点不动**；**链接点了什么也不发生**（不该拉起浏览器）。
8. **抽字过程中不会看到裸记号**：一边打字一边盯着看，`#`、`**`、`|` 一个都不该作为字形出现。
9. **结构预知**：抽到表格表头那一刻，整张网格就画出来了，后面几行是空的、随抽字被填上。
10. **`.txt` 工作文档照旧**：导入一个 `.txt`，正文显示原文（包括里面的 `#`），不渲染。

---

## 自查记录

**设计文档覆盖情况：**

| 设计文档的节 | 落在哪个 Task |
|---|---|
| 3.1 偏移裁剪 | Task 1（解析出偏移）、Task 2（按偏移裁） |
| 3.2 结构预知 | Task 2 |
| 3.3 只在渲染层 | Task 1 的依赖检查、Task 6 的文件位置 |
| 3.4 不见裸记号 | Task 2 + Task 5（记号被解析掉，不产生字形） |
| 4 语法表 | Task 5（逐项）、Task 6（逐项样式） |
| 5 渲染管线 | Task 1 / 2 / 5 |
| 6 模块边界与数据流 | Task 8、Task 10 |
| 7 铺满 | Task 3（算）、Task 7（量）、Task 11（接线 + 兜底） |
| 8 图片 | Task 9 |
| 9.1 脚注 | Task 5 |
| 9.2 表格 | Task 5 + Task 6 的 CSS |
| 9.3 链接不可点 | Task 5 |
| 10 样式 | Task 6 |
| 11 安全边界 | Task 4（白名单）、Task 5（不传属性、不用 innerHTML）、Task 9（基准目录由主进程算） |
| 12 错误处理与边界 | 各 Task 的兜底分支；折叠在 Task 8 |
| 13.1 不变量改写 | Task 12 |
| 13.2 bossKey 注释 | Task 11 Step 4 |
| 13.3 围栏回写 | Task 13 |
| 13.4 新依赖 | Task 1 |
| 14 测试策略 | 各 Task 的用例 + 末尾的验收清单 |
| 16 明确不做 | 无人认领是**对的**——那一节列的就是不做的东西 |

**类型一致性：** `parseMarkdown` / `clipTree` / `pickFillCut` / `pickFoldStart` / `measureBlocks` / `renderMarkdown` / `tokenizeHtml` / `isMarkdownPath` / `loadWorkDocImage` 九个名字在各自 Task 定义，后续 Task 按同名调用（`parseMarkdown` 被 Task 2、Task 8、Task 10 引用；`clipTree` 的调用是 `clipTree(doc, foldStart, cursor)`）；`BlockHeight` 在 Task 3 定义，Task 7 返回它、Task 11 消费它；`BlockSpan` 在 Task 3 定义，Task 8 用它；`MarkdownSource` 在 Task 8 定义、Task 10 构造它；`measuring` / `onMeasureNode` 两个名字在 Task 8 的 `MarkdownViewProps`、`MarkdownSource` 与 Task 10 的 `App` 三处同名。
