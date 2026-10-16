# Markdown 渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把导入的 `.md` 工作文档渲染成 Word 风的排版，同时保持「按字符逐字抽出」这条既有机制不变。

**Architecture:** 用 `remark` 把 `flatText` 解析成带**字符偏移**的 mdast（偏移与 `cursor` / `revealStart` 同一个坐标系），每次渲染时按偏移裁出一棵「该显示什么」的树，再映射成 React 元素。结构**预知**：一个块只要开始被揭示，它的完整结构就画出来，文本没抽到的部分留空。

**Tech Stack:** React 19 / TypeScript / vitest + jsdom / `unified` + `remark-parse` + `remark-gfm`

**设计文档：** `docs/superpowers/specs/2026-10-14-markdown-rendering-design.md`。每个 Task 开头都标了它对应设计文档的哪几节，有疑问先读那一节。

**分支：** `feat/boss-key`（工作文档这个概念整个来自那一批，它还没合并）。**本功能直接在这条分支上继续开发，不另开分支。**

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
import {
  parseMarkdown,
  isMarkdownPath,
  valueStartOf,
  lineStartsOf,
  WT_LINE_STARTS
} from '../../src/renderer/src/markdown/parse'
import { clipTree } from '../../src/renderer/src/markdown/clip'

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

/**
 * 取树里第一个带 `value` 的文本节点（深度优先）。逐行表那几条夹具的内容都落在一个
 * 节点里（容器层是 blockquote / list / listItem，都会被走穿），取第一个就够。
 */
function textOf(tree: { children?: unknown[] }): Record<string, unknown> {
  let found: Record<string, unknown> | null = null
  const walk = (nodes: unknown[]): void => {
    for (const node of nodes) {
      if (found) return
      const n = node as { type?: string; value?: unknown; children?: unknown[] }
      if (n.type === 'text' && typeof n.value === 'string') {
        found = n as Record<string, unknown>
        return
      }
      walk(n.children ?? [])
    }
  }
  walk(tree.children ?? [])
  if (!found) throw new Error('夹具里没有 text 节点')
  return found
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

  it('列表项里的围栏块：同样精确（前缀是列表项的缩进）', () => {
    const src = '- ```\n  甲\n  ```\n'
    const list = parseMarkdown(src)!.children[0] as unknown as {
      children: { children: unknown[] }[]
    }
    expect(valueStartOf(list.children[0].children[0])).toBe(src.indexOf('甲'))
  })

  it('超过四格的缩进块：多出来的空格算内容，不能被当成缩进一起跳掉', () => {
    const src = '     甲\n     乙\n'
    const node = parseMarkdown(src)!.children[0] as unknown as { value: string }
    const origin = valueStartOf(node)!
    const firstLine = node.value.split('\n')[0]
    // 起点算对了的话，从它切出的首行恰好等于 value 的首行，而且正好收在行尾
    expect(src.slice(origin, origin + firstLine.length)).toBe(firstLine)
    expect(src[origin + firstLine.length]).toBe('\n')
    // 被剥掉的只有固定那四格
    expect(src.slice(0, origin)).toBe('    ')
  })

  it('八格缩进同样只剥四格（「跳过所有前导空白」会差 4）', () => {
    const src = '        甲\n'
    const node = parseMarkdown(src)!.children[0] as unknown as { value: string }
    const origin = valueStartOf(node)!
    expect(node.value).toBe('    甲')
    expect(src.slice(0, origin)).toBe('    ')
  })

  it('空代码块：起点兜回内容行首，不是 end —— 设计 3.5 的光标用的是同一个数', () => {
    const src = '```\n```\n'
    const node = parseMarkdown(src)!.children[0] as unknown as {
      value: string
      position: { end: { offset: number } }
    }
    expect(node.value).toBe('')
    const origin = valueStartOf(node)!
    expect(origin).not.toBe(node.position.end.offset)
    expect(origin).toBe(src.lastIndexOf('```'))
  })

  it('行内代码两侧各有一个空格时，起点在空格之后（CommonMark 会剥掉那一对）', () => {
    const src = '前 `` 甲 `` 后\n'
    const para = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(para.children[1])).toBe(src.indexOf('甲'))
  })

  it('反引号当字面量：`` ` `` 的起点是中间那个反引号，不是开头那串', () => {
    const src = '`` ` ``\n'
    const para = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(para.children[0])).toBe(src.indexOf('`', 2))
  })

  /**
   * 【这条用例钉的是**已知偏差**，不是在守正确行为】
   *
   * 带前缀的块，remark 逐行剥前缀；而 `valueStartOf` 只给一个常量原点，所以首行精确、
   * **第二行起仍差一个前缀宽度**。设计 3.6 记着这条、判定为可接受——但「可接受」也得
   * 有机器可读的记录，否则将来谁无意改了 `contentStartOf`，不会有任何东西出声。
   * 这条红了不等于回归：先读 3.6 再决定是改代码还是改这条用例。
   */
  it('已知偏差：带前缀的块，第二行首字符仍差一个前缀宽度（设计 3.6 接受的残留）', () => {
    const src = '> ```\n> 甲\n> 乙\n> ```\n'
    const quote = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    const code = quote.children[0] as unknown as { value: string }
    const origin = valueStartOf(code)!
    // 首行是精确的
    const firstLine = code.value.split('\n')[0]
    expect(src.slice(origin, origin + firstLine.length)).toBe(firstLine)
    // 前缀宽度从源码里量：第二行行首到「乙」之间那一段
    const prefix = src.slice(src.lastIndexOf('\n', src.indexOf('乙')) + 1, src.indexOf('乙'))
    expect(prefix).toBe('> ')
    // 第二行不是：按「起点 + value 内下标」线性推出来的位置，比真值小一个前缀宽度
    expect(src.indexOf('乙') - (origin + code.value.indexOf('乙'))).toBe(prefix.length)
  })

  it('普通文本节点没有这个标注 —— 读出来是 null，调用方退回 position', () => {
    const para = parseMarkdown('甲\n')!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(para.children[0])).toBeNull()
  })
})

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
    expect(lineStartsOf({ [WT_LINE_STARTS]: [2, 7] })).toEqual([2, 7])
    expect(lineStartsOf({ [WT_LINE_STARTS]: [2, Number.NaN] })).toBeNull()
    expect(lineStartsOf({ [WT_LINE_STARTS]: [Number.POSITIVE_INFINITY] })).toBeNull()
    expect(lineStartsOf({ [WT_LINE_STARTS]: [] })).toEqual([])
  })

  /**
   * 【夹具为什么是**容器里的**围栏块，不是顶格那个】顶格的围栏块逐行是**连续**的
   * （三行前缀一样长），`isContiguous` 判定「按 `valueStartOf` + 字符数就能推」于是
   * **不挂表**——挂了只是重复信息。挂表的是前缀**逐行不同**的那些：容器里的围栏块每行
   * 多一个 `> `。所以这条用容器里的，下面一条钉顶格那个形态。
   */
  it('围栏代码块（在引用块里）：挂表，第一行起点在围栏之后', () => {
    const src = '> ```\n> 甲\n> 乙\n> ```\n'
    const quote = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    expect(lineStartsOf(quote.children[0])).toEqual([src.indexOf('甲'), src.indexOf('乙')])
  })

  it('顶格的围栏代码块：逐行连续，不挂表；首行起点仍然在围栏之后', () => {
    const src = '```\n第一行\n第二行\n```\n'
    const code = parseMarkdown(src)!.children[0]
    expect(lineStartsOf(code)).toBeNull()
    // 不挂表不等于没坐标：首行起点由 `valueStartOf` 给，退回按字符数切是精确的
    expect(src.slice(valueStartOf(code)!, valueStartOf(code)! + '第一行'.length)).toBe('第一行')
  })

  /**
   * 行尾空白被 remark 剥掉时，行起点要用**回验**得到，不能「行尾 − 行长」（设计 3.6.1）。
   *
   * 【真值怎么来的】第 k 行文字在**它自己那一源码行**里从后往前找（行尾空白是它后面唯一
   * 允许多出来的东西），再加上前面各行累计的长度。**必须按行界住**：拿
   * `src.lastIndexOf(line, src.length)` 在整篇源码里找，会把**别的行**里相同的文字也找出来
   * （实测 `'> 甲 \n> 甲\n'` 它给 `[7,7]`、真值 `[2,7]`）。写死数字是「测实现」，不界住同样
   * 是「测实现」，只是错在另一个方向上。
   *
   * 【为什么末尾四条是重复行的】前面四条夹具里每行文字在整篇源码里恰好**唯一**，所以
   * 「在整篇源码里找」那版写法在它们身上**也是绿的**——两版写法分不开。这四条才分得开：
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

  /**
   * 空 `value` 的代码节点**不挂表**（计划 Step 3b）：两条路对空 `value` 要给同一个原点。
   *
   * 【为什么】`contentStartOf` 对 `value === ''` 给的是**围栏之后**那个位置，而「行尾 − 行长」
   * 里的那个「行尾」是**收尾围栏那一行**的换行——于是同一个节点在同一棵树上有**两个原点**
   * （实测 `'```\n```\n'`：`wtValueStart` 是 4 而表是 `[7]`）。空 `value` 没有下标可言，
   * 表让位，`contentStartOf` 那个数成为唯一的原点。
   *
   * 【只断言解析期】`to=8` 那一格上的跳变是「解析期挂上了表」的后果，表不挂它就不存在。
   */
  it.each([
    ['无语言标注', '```\n```\n'],
    ['带语言标注', '```md\n```\n']
  ])('空代码块（%s）：不挂表，起点是围栏之后那个位置', (_name, src) => {
    const code = parseMarkdown(src)!.children[0]
    expect(lineStartsOf(code)).toBeNull()
    expect(valueStartOf(code)).toBe(src.indexOf('\n') + 1)
  })
})

/**
 * 屏幕上那段文字：把裁剪后的树里所有带 `value` 的节点按文档顺序拼起来。
 *
 * 【为什么按 `value` 拼就够】`text` / `code` / `inlineCode` 的 `value` 就是它们在屏幕上的
 * 字形（`toReact.tsx` 只负责给它套标签），所以这个拼接与「把 `renderMarkdown` 的结果取
 * `textContent`」是同一个串——而它不用起 React，判据也就少一层依赖。
 */
function renderVisible(src: string, to: number): string {
  const tree = parseMarkdown(src)
  if (tree === null) throw new Error('解析失败')
  const out: string[] = []
  const walk = (nodes: readonly unknown[]): void => {
    for (const node of nodes) {
      const n = node as { value?: unknown; children?: unknown[] }
      if (typeof n.value === 'string') out.push(n.value)
      walk(n.children ?? [])
    }
  }
  walk(clipTree(tree, 0, to).children)
  return out.join('')
}

/** `needle` 的每个字符能不能在 `haystack` 里**按序**找到（贪心子序列）。 */
function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0
  for (const ch of haystack) {
    if (i < needle.length && needle[i] === ch) i++
  }
  return i === needle.length
}

/**
 * 把源码里的记号解回来。**这一步不可省**：`&amp;` 与 `\*` 上屏的是 `&` 与 `*`，而源码里
 * 没有这两个字符的裸形态；`&nbsp;` 更极端——上屏的是 U+00A0，源码里是六个 ASCII 字节。
 * 不先解码就比对，**正确的实现也会被判成泄漏**（实测：`&nbsp;` 的 to=16、17 与 `&lt;` 的
 * to=14、15 这四格，那时屏幕上显示的确实只是已揭示范围内该有的字）。
 */
function decodeMarks(s: string): string {
  const ENTITIES: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': '\u00a0' // 实体解码出来的是不换行空格，不是普通空格
  }
  return s
    .replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTITIES[m] ?? m)
    .replace(/\\([\\`*_{}[\]()#+\-.!<>~|$])/g, '$1')
}

/**
 * 回验失败的那一类（实体、转义、重复文字）**不许把未揭示的字上屏**（设计 3.6.1 第四轮）。
 *
 * 【判据为什么长这样】摘表之后 `clip` 退回按字符数切，而裁剪原点是**首行**的内容起点，
 * 于是从第二行起每一行的前缀宽度都变成**提前量**——屏幕上会出现还没揭示的字。
 * 这里不写死期望串，而是问一条性质：**显示出来的整段文字，能不能在 `src[0, to)` 里
 * 按序匹配出来**（源码那一段要先解掉实体与转义）。匹配不上就是泄漏。
 *
 * 【为什么这几条夹具】`&amp;` / `\*` / `&nbsp;` / `&lt;` / `\_` 这几类让 `lastIndexOf`
 * 回验失败（`value` 与源码不是逐字相同），它们都是**多行**的——单行节点的裁剪原点是
 * 自己的起点，摘不摘表都一样，测不出这条。
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
        const shown = renderVisible(src, to)
        const leaked = !isSubsequence(shown, decodeMarks(src.slice(0, to)))
        expect([src, to, leaked, shown]).toEqual([src, to, false, shown])
      }
    }
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
 * 坐标系，所以裁剪时不需要任何换算（设计 3.1）。**唯一的例外是 `code` / `inlineCode`**：
 * 它们的 `value` 不含定界符、也不含容器前缀，得先用 `valueStartOf` 换成真实起点（设计 3.6）。
 *
 * 【为什么 `unified` 实例提到模块级】`.use()` 会重建 processor，每次调用都建一遍
 * 是白扔的。processor 本身无可变状态，`.parse()` 也是纯的。
 *
 * 【ESM-only，别把它挪出渲染层】remark 全族是 `"type": "module"`。挪进 `src/core`
 * 会让 main 那份 tsconfig 也去解析它。Task 1 的用例守不住这条（类型检查才守得住），
 * 所以它是靠 `pnpm typecheck` 与这条注释一起守的。
 */
const processor = unified().use(remarkParse).use(remarkGfm)

/**
 * 挂在节点上的字段：**当前** `value` 的第一个字符在源码里的偏移。
 *
 * 【谁盖它，别以为只有代码节点有】解析期只有 `code` / `inlineCode` 需要（`parse.ts`
 * 自己盖，见 `annotateValueStarts`）；而 `clip.ts` 切完片之后给**所有可裁类型**——含
 * `text`——重新盖一遍，因为切过的 `value` 起点不再是解析期那个数了。
 *
 * 【为什么出这个口】它有两个使用者：同文件的 `valueStartOf` 读它，`clip.ts` 裁剪时
 * **写**它（`value` 切掉一段，起点要跟着后移）。两个写者意味着字段名必须只在一处定义
 * ——下游各自拼字符串的话，两侧对不上是**静默**的。
 */
export const WT_VALUE_START = 'wtValueStart'

/**
 * 读 `value` 的真实源码起点。没标注、标注不是有限数一律给 `null`——调用方据此退回
 * `position.start.offset`（普通 `text` 节点就是那一类，它们的两套坐标本来就重合）。
 *
 * 【读它一律走这个口，别去读裸字段】导出上面那个常量只是给第二个**写者**（`clip.ts`）
 * 定位字段名用，**不等于读的口子也放开了**：裸读会绕过「不是有限数一律 `null`」这一步，
 * 拿到 `undefined` / `NaN` / 字符串全都不出声。
 */
export function valueStartOf(node: unknown): number | null {
  const raw = (node as Record<string, unknown> | null | undefined)?.[WT_VALUE_START]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

export function parseMarkdown(text: string): Root | null {
  try {
    const tree = processor.parse(text)
    annotateValueStarts(tree, text)
    return tree
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
 * 【常量原点只对首行精确，逐行那一半由逐行表兜】带前缀的块（引用块、列表项里）与超过
 * 四格的缩进块，remark 是**逐行**剥前缀/缩进的，不是常量偏移；这里给的是常量原点，
 * 所以**首行精确、第二行起差一个前缀宽度**（用例「已知偏差：……」钉的就是这一条）。
 * 这一层由本函数末尾挂的逐行表补齐（设计 3.6.1）——**读 `valueStartOf` 的下游要连同
 * `lineStartsOf` 一起读**，只读前者在多行容器里会错。
 */
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
  }
  for (const child of n.children ?? []) annotateValueStarts(child, source)
}

/**
 * `value` 的第一个字符在源码里的偏移。
 *
 * 【原理：`value` 的首行必然收在「它那一源码行的行尾」】容器前缀（`> `、列表项缩进）、
 * 代码块自己的缩进、围栏全都在它前面。所以从那一行的行尾往回退首行长度，就是内容起点——
 * 不用去识别前缀长什么样，也就不用管它有几层。
 *
 * 【「那一行」是哪一行】围栏块是**围栏的下一行**（围栏那一行不是内容），缩进块是节点
 * 自己那行。这一处用错对**所有**块都错。
 *
 * 【缩进块剥的是固定四格，多出来的算内容】`     甲`（五格）的 `value` 是 ` 甲`——首字符
 * 是那个多出来的空格，不是「甲」。所以「跳过所有前导空白」是错的（八格会差 4）。
 *
 * 【怎么区分围栏与缩进】看首行：行首最多三个空格之后以三个及以上 `` ` `` 或 `~` 开头
 * 就是围栏——remark 只认这两种围栏，所以这个判据与它一致。
 *
 * 【空 `value` 为什么要单独兜】没有字符可切，但设计 3.5 的光标用的是同一个数——退回
 * `end` 会把空代码框里的光标推出框外。
 */
function contentStartOf(
  kind: string,
  source: string,
  start: number,
  end: number,
  value: string
): number {
  if (kind === 'inlineCode') return inlineContentStart(source, start, end, value)
  const nl = source.indexOf('\n', start)
  const firstLineEnd = nl >= 0 && nl < end ? nl : end
  const fenced = /^ {0,3}(`{3,}|~{3,})/.test(source.slice(start, firstLineEnd))
  const lineStart = fenced ? (firstLineEnd < end ? firstLineEnd + 1 : firstLineEnd) : start
  if (value === '') return lineStart
  if (lineStart > end) return end
  const nl2 = source.indexOf('\n', lineStart)
  const lineEnd = nl2 >= 0 && nl2 < end ? nl2 : end
  return Math.max(start, lineEnd - (value.split('\n')[0] ?? '').length)
}

/**
 * 行内代码的 `value` 起点。
 *
 * 【为什么要拿 `value` 回验】CommonMark 在内容两侧各有一个空格时会各剥掉一个，于是
 * 「跳过起首反引号」不再精确：` `` 甲 `` ` 的 `value` 是 `甲`，而它在源码里从那个空格
 * **之后**才开始。所以算完拿 `value` 对一下：对得上就采用；对不上（跨行的行内代码
 * remark 会把换行折成空格）就退回「跳过起首反引号」——宁可差一点点，也不给一个错的、
 * 偏得更远的原点。
 */
function inlineContentStart(source: string, start: number, end: number, value: string): number {
  let from = start
  while (from < end && source[from] === '`') from++
  let to = end
  while (to > from && source[to - 1] === '`') to--
  const raw = source.slice(from, to)
  if (raw === value) return from
  if (
    raw.length >= 2 &&
    raw.startsWith(' ') &&
    raw.endsWith(' ') &&
    raw.trim() !== '' &&
    raw.slice(1, -1) === value
  ) {
    return from + 1
  }
  return from
}

/** 挂在节点上的逐行偏移表（设计 3.6.1）：每个 value **行**的首字符在源码里的偏移。 */
export const WT_LINE_STARTS = 'wtLineStarts'

/**
 * 读逐行偏移表：没有、不是数组一律给 `null`（调用方退回按字符数切）。
 *
 * 【与 `valueStartOf` 同一口径：不是有限数一律当没挂表】两个读口是一对兄弟，判据必须一样
 * ——只查 `typeof n === 'number'` 的话 `NaN` / `Infinity` 会被原样当成行起点，下游按它算
 * 出来的位置**不报错**、只是错到天边。今天上游产不出这种值（`parse.ts` 与 `clip.ts` 都只
 * 写整数），但读口松一格就是给下一个人留坑：他按 `valueStartOf` 的注释来理解这里就会踩。
 */
export function lineStartsOf(node: unknown): number[] | null {
  const raw = (node as Record<string, unknown> | null | undefined)?.[WT_LINE_STARTS]
  return Array.isArray(raw) && raw.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (raw as number[])
    : null
}

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
 * 它后面唯一允许多出来的东西），并要求找到的位置之后到行尾**全是空白**。
 *
 * 【对不上时退回的是**保守算式**，不是「不挂表」】(设计 3.6.1 第四轮改) 原先写的是「找不到
 * 就不挂表，退回『起点 + 字符数』那条路——宁可少精确一处」。那把退路定性成**精度问题**，
 * 实测它是**方向问题**：摘表之后 `clip` 退回按字符数切，而裁剪原点是**首行**的内容起点，
 * 于是从第二行起每一行的前缀宽度都变成**提前量**，**未揭示的字上屏**——核心不变量被破。
 * 现在退的是 `行尾 − 行长`，它恒不早于真实内容起点（推导见循环里那段注释），方向是「晚」。
 * **晚是少显示，提前是多显示**，两害相权取前者。
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
  // 【解析期空 `value` 不挂表】`contentStartOf` 对空 `value` 给的是**围栏之后**那个位置，而
  // 「行尾 − 行长」里的那个「行尾」是**收尾围栏那一行**的换行——同一个节点于是在同一棵树上
  // 有**两个原点**（实测 `'```\n```\n'`：`wtValueStart` 是 4 而表是 `[7]`）。空 `value`
  // 没有下标可言，表让位，让 `contentStartOf` 定的那个数成为唯一的原点。
  //
  // **别把这条读成全局不变量**：它管的是**解析出来的**空 `value`。**裁剪之后** `value` 为空
  // 是**空窗口**的结果（容器里的围栏块，`to` 落在围栏那一段），那几格归 `clip.ts` 的空窗口
  // 守卫，与这里无关——把两者并成一条规则会两边都错。
  if (value === '') return null
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
    // 【回验对不上时**不摘表**，退回恒不提前的保守算式】(设计 3.6.1 第四轮) 摘表之后
    // `clip` 会退回按字符数切，而裁剪原点是**首行**的内容起点——从第二行起每一行的前缀
    // 宽度都变成**提前量**，屏幕于是显示**还没揭示的字**（评审 10 个夹具 79 格；本仓这 6 个
    // 夹具实测 43 格，判据见 `tests/unit/markdownParse.test.ts` 里那条逐偏移扫描）。
    // `lineEnd - line.length` 恒 >= 真实内容起点：value 行是源码某连续片段的解码结果，
    // 剥前缀把起点右移、剥行尾空白与解码只让它更短（评审用独立对齐器在 42808 行上验过，0 违例）。
    // 代价是那一行的首字**晚**若干按键（晚的格数 = 该行记号的超出量）——**晚是少显示，提前是多显示**。
    if (at >= lineStart && /^[ \t]*$/.test(source.slice(at + line.length, lineEnd))) out.push(at)
    else out.push(lineEnd - line.length)
    lineStart = lineEnd + 1
  }
  return out
}

/**
 * 这张表能不能由「起点 + 字符数」直接推出来。能的话不挂——挂了也只是重复信息。
 *
 * 【同一件事有三处实现，别只改一处】「沿 `value` 的 `\n` 走行、每行进 `lineLen + 1`」这个
 * 循环在这里、`clip.ts` 的 `sliceByLineStarts`、`toReact.tsx` 的 `rowsOf` 各写了一份——用途
 * 不同（判连续性 / 求窗口 / 摊成行），所以**不合并**，但**行尾口径三份不一样**：这里把换行
 * **算给上一行**（`v` 一步跳过它），`sliceByLineStarts` 用 `+ 1` 把换行**括进窗口**，
 * `rowsOf` 的行长**不含**换行。动任何一处之前先把三处对一遍。
 */
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
import { clipTree, readBlankCount, WT_BLANK_LINES, WT_BLANK_ROWS } from '../../src/renderer/src/markdown/clip'
import { parseMarkdown, valueStartOf, lineStartsOf } from '../../src/renderer/src/markdown/parse'
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

  it('光标正好压在第一行行尾：占位 2 行（那个换行还没揭示，它属于后一行）', () => {
    const out = clipTree(parseMarkdown(CODE)!, 0, CODE.indexOf('第一行') + 3)
    const code = out.children[0]
    expect((code as unknown as { value: string }).value).toBe('第一行')
    expect(readBlankCount(code, WT_BLANK_LINES)).toBe(2)
  })

  it('整个抽完：占位 0 行', () => {
    const out = clipTree(parseMarkdown(CODE)!, 0, CODE.length)
    expect(readBlankCount(out.children[0], WT_BLANK_LINES)).toBe(0)
  })
})

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

/**
 * 逐行切片（设计 3.6.1）：容器里的文字在窗口两侧都要按**行**求交，不能按字符数硬减。
 *
 * 【这四条里只有一条是逐行表带来的】把它们原样搬到 `12fac2d`（引进逐行偏移表之前）上跑，
 * **四条里三条是绿的**，只有「光标走到第二行中间」那条红（实收 `'引用甲\n引用乙'`，期望
 * `'引用甲\n引'`）——那是唯一一条**窗口切在两行之间**的（`to = 8 + 1 = 9`，跨过第一行行尾）。
 * 另外三条的窗口要么整个落在**第一行之内**、或正好收在它的行尾（`to = 5`、`to = 6`），
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
   * 【为什么单独钉一条】这条判据在**已经揭示的中间几行**上看不出来——那些行的 `tail` 会被
   * 后面某一行的 `tail` 覆盖掉，只有窗口正好收在「某行末尾那个 `\n`」上时才分得出。
   * 计划里那条变异（把 `+ 1` 去掉）在原来那三条用例上**一条都不红**，就是漏了这一格。
   */
  it('中间的换行符属于它上面那一行：越过它才显示', () => {
    expect(textOf(clipTree(parseMarkdown(QUOTE)!, 0, QUOTE.indexOf('\n')))).toBe('引用甲')
    expect(textOf(clipTree(parseMarkdown(QUOTE)!, 0, QUOTE.indexOf('\n') + 1))).toBe('引用甲\n')
  })

  it('折点切进第一行中间：窗口起点也按行算，前面的字不显示', () => {
    const out = clipTree(parseMarkdown(QUOTE)!, QUOTE.indexOf('用'), QUOTE.length)
    expect(textOf(out)).toBe('用甲\n引用乙')
  })
})

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

- [ ] **Step 2: 跑测试，确认它红**

```bash
pnpm vitest run tests/unit/markdownClip.test.ts
```

期望：FAIL，`Failed to resolve import .../markdown/clip`。

- [ ] **Step 3: 写实现**

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
import type { Root } from 'mdast'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'
import { clipTree, WT_BLANK_LINES, WT_BLANK_ROWS } from '../../src/renderer/src/markdown/clip'
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
  })

  it('光标插进代码框里，而不是掉到框下面', () => {
    const doc = {
      type: 'root',
      children: [
        {
          type: 'code',
          value: '第一行',
          position: { start: { offset: 0 }, end: { offset: 10 } },
          wtValueStart: 4
        }
      ]
    } as unknown as Root
    const c = render(<>{renderMarkdown(doc, { caretAt: 6 })}</>).container
    const pre = c.querySelector('pre')!
    expect(pre.textContent).toBe('第一行')
    const caret = pre.querySelector('[data-testid="caret"]')
    expect(caret).not.toBeNull()
    // `caretAt: 6`、`wtValueStart: 4` ⇒ `at = clamp(6 − 4, 0, 3) = 2` ⇒ 切成 ['第一', '行']
    // 【这两个字面量差一个字符就整条失效】原计划写的是 `'第'` / `'一行'`，
    // 那与实现自相矛盾——实施者量出来了。这条用例的真正作用是**守住 `origin`**。
    expect(caret!.previousSibling!.textContent).toBe('第一')
    expect(caret!.nextSibling!.textContent).toBe('行')
  })
})

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
   * 光标不能是 `<tr>` 的**直接子元素**——那不是合法的表格内容，CSS 会给它套一个匿名
   * 表格盒，**表格于是多出一列**（复审实测：宽 115→172、第二列 x 57→114）。
   *
   * 【这个 `to` 是量出来的，不是推的】实施者逐偏移扫过 `TABLE`：非法父元素出现在
   * `to = 4 / 24 / 34`，正好是**每个非首单元格的起点**（表头第二个格子 `[4..9]`、
   * 正文两行的第二个格子 `[24..29]` 与 `[34..39]`）。那些位置上，区间判据让
   * `caretBefore(cell)` 先于格子里的文本节点开火，把光标挪到了格外。
   */
  it('光标落在单元格里，不是 `<tr>` 的直接子元素', () => {
    const c = at(TABLE, 4)
    const caret = c.querySelector('[data-testid="caret"]')
    expect(caret).not.toBeNull()
    expect(caret!.closest('th, td')).not.toBeNull()
  })

  it('量高度那一份**永远**不带光标（`caret: null` 那条闸）', () => {
    const doc = parseMarkdown('甲乙丙\n')!
    const c = render(<>{renderMarkdown(doc, { withBlockEnds: true, caretAt: 2 })}</>).container
    expect(c.querySelectorAll('[data-testid="caret"]')).toHaveLength(0)
  })

  /**
   * 行内 HTML 的**接受的近似**：连续的 text / html 合成一段 token 流之后，光标放在
   * **这一串的末尾**（设计 3.5 末段、`renderAll` 的 `caretHere`）。
   *
   * 【为什么非要钉它】这个近似原先一条用例都没有——把它从「串尾」挪到「串首」是**零红**
   * 的。而两处不是一回事：串首时，`前 <b>甲</b>后` 在「后」还没揭示的那一刻，光标会跑到
   * 「前」**前面**去，而隐形输入框与候选框都按这个坐标摆。
   */
  it('行内 HTML：光标落在这一串的**末尾**（紧贴 `</b>`），不是跑到串首', () => {
    const c = at('前 <b>甲</b>后\n', 6)
    const p = c.querySelector('p')!
    expect(p.textContent).toBe('前 甲') // 「后」还没揭示出来
    const caret = p.querySelector('[data-testid="caret"]')!
    expect(caret).not.toBeNull()
    // 串的末尾：光标的前一个兄弟就是那个 `<b>`，不是「前 」那个文本节点
    expect(caret.previousSibling).toBe(c.querySelector('b'))
    expect(p.firstChild!.textContent).toBe('前 ')
  })

  /**
   * 容器里**逐行剥前缀**的文字，下标要按行换算（设计 3.6.1）。
   *
   * 【为什么用整棵树、不裁】裁到 `to = 9` 时 `clip` 自己就把 `value` 切到了那一格，光标
   * 靠 `Math.min` 夹到末尾也会落到对的地方——两条路都对，就分不出守的是哪一条。整棵树
   * 才能把 `toReact` 这一段的换算单独逼出来：`value` 是完整的 `'引用甲\n引用乙'`，而下标
   * 必须落在**第二行**里，不能拿 `揭示偏移 − 起点 = 7` 一路减到底。
   */
  it('引用块里的多行文字：下标记在**那一行**上，不做全局减法', () => {
    const c = render(
      <>{renderMarkdown(parseMarkdown('> 引用甲\n> 引用乙\n')!, { caretAt: 9 })}</>
    ).container
    const caret = c.querySelector('[data-testid="caret"]')!
    expect(caret).not.toBeNull()
    expect(caret.closest('blockquote')).not.toBeNull()
    // 源码偏移 9 落在第二行的第二个字上（第二行从 8 起）⇒ 切在 value 下标 5
    expect(caret.previousSibling!.textContent).toBe('引用甲\n引')
    expect(caret.nextSibling!.textContent).toBe('用乙')
  })

  /**
   * 容器里**逐行剥前缀**的多行文字 + 行内 HTML：光标仍落在**这一串的末尾**。
   *
   * 【为什么单独钉一条】`renderAll` 那个「这一串接得住光标吗」的判据，与
   * `splitAtCaret` / `holdsCaret` 是**同一个问题**。算术版「起点 + 长度 ≥ 揭示偏移」在有
   * 逐行表的节点上会**偏小**（那个长度不再等于「揭示偏移 − 起点」），于是光标被判定不在
   * 这一串里、一路掉到整篇末尾——掉出 `<blockquote>` 外面去了。
   *
   * 【夹具为什么长这样】条件有三个，缺一个就测不到那条判据：
   * 1. 那一串里**得有活着的 html 节点**（`clip` 对 html 是「等它整个抽完才留」，
   *    `end > to` 的直接丢掉）——所以 `</b>`（end = 10）必须已经在揭示范围里，
   *    `<b>x</b>` 得排在多行文字**前面**；
   * 2. 多行文字要**挂得上逐行表**（前缀逐行不同）；
   * 3. 揭示偏移要落在算术版够不着、真区间够得着的那一段：`to = 16` 时那个文本节点的
   *    `value` 是 `'甲一\n乙'`（起点 10、长度 4 ⇒ 算术版说「到 14 为止」），而它第二行
   *    的内容一直伸到源码 16。**`to = 14` 及以下两条判据一致，测不出差别**。
   */
  it('引用块里多行文字 + 行内 HTML：光标没掉出容器', () => {
    const SRC = '> <b>x</b>甲一\n> 乙二\n'
    const c = at(SRC, SRC.indexOf('二'))
    const caret = c.querySelector('[data-testid="caret"]')!
    expect(caret).not.toBeNull()
    expect(caret.closest('blockquote')).not.toBeNull()
    // 落在这一串的末尾（`</b>` 之后、'甲一\n乙' 之后），不是掉到整篇末尾
    expect(caret.closest('p')!.textContent).toBe('x甲一\n乙')
  })

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

  /**
   * **保守表的**那几行（回验对不上的行，第四轮）照样要接得住光标——逐偏移扫**全部**偏移位。
   *
   * 【为什么单开一条】上面那三条钉的是**精确表**（`> 引用甲\n> 引用乙\n` 这类行起点回验命中）
   * 与**没有表**这两种形态。第四轮之后多出第三种：那几行的起点是按 `行尾 − 行长` 退的**保守值**，
   * 比真实内容起点**晚**（`&amp;` 晚 4、`\*` 晚 1）。而接受窗口的两端都拿这张表在算
   * （下界 `rows[0].src`、上界 `position.end`），所以保守表与窗口的交互是**新的一格**，
   * 上面那几条一条都碰不到。
   *
   * 【它有没有牙：有，但在**上界**那一侧】实测（把 `upper` 从 `max(position.end, contentEnd)`
   * 改回 `contentEnd`）：**在 4f 那个提交（`31d9813`）上**这条红，`实体` 夹具在 to=13、14 上
   * 掉出引用块（同一条变异当时共红 5 条）。**今天同一条变异全绿**（收尾时重测）——那几格改由
   * 4g 之后新增的兜底路径接住（把末尾兜底连同 `upper` 一起摘掉，那 5 条才重新红起来），所以
   * **这条用例今天不再是上界的守卫**。上界仍有牙、只是没人守着：同一条变异在加厚语料 300 篇
   * 上逐格差 9 格（`inlineCode` 那几格，光标从 `<code>` 里被挪到它**后面**）。
   * **下界那一侧它拦不住**
   * ——把下界整个去掉（`at > upper` 才拒绝）时这条**照样绿**：夹具上没有一格能触发下界
   * （表存在时 `rows[0].src < to` 恒成立，表被摘掉时 `rows[0].src` 就是 `originOf(node)`）。
   * 所以别把它当成「下界有覆盖」的证据。
   *
   * 【但「这条测不到下界」不等于「下界是死代码」——第四轮把这两件事并成过一句】逐格实测的
   * 口径是三段：① 只有把下界**换成 `originOf(node)`** 才是**逐格字节相同**（加厚语料 300 篇 /
   * 5261 格 0 差异，全仓 623 条全绿）——那条候选修法作废，换了等于没换；② 把下界**整条删掉
   * 却不等价**——本文件里 4i 那三条围栏守卫当场红（4f 当时是「全绿」，因为那几格的守门人当时
   * 不是这个下界），加厚语料逐格差 **61 格 / 跨 49 篇**，方向全是「把光标拉进一个**还没开始**
   * 的元素」（`BLOCKQUOTE>SPAN` → `BLOCKQUOTE>PRE>CODE>SPAN`）；③ 第三轮那条接受窗口保护的
   * 是「**值节点不抢它前面的光标**」，它看的是**节点自己的 `position.start`**，与 `rows[0].src`
   * 在空节点 / 围栏节点上**不是同一个数**（4i 正是把左端松开到 `min(内容起点, position.start)`）。
   * **「全绿」是覆盖事实，不是等价事实**——所以下界留着。
   */
  it.each([
    ['实体', '> 甲 &amp; 乙\n> 丙\n'],
    ['反斜杠转义', '> 甲 \\* 乙\n> 丙\n']
  ])('回验失败的那几行（%s）：逐偏移扫，光标不出容器', (_name, SRC) => {
    for (let to = 1; to < SRC.length; to++) {
      const c = at(SRC, to)
      const carets = c.querySelectorAll('[data-testid="caret"]')
      expect(carets, `to=${to} 光标数不对`).toHaveLength(1)
      expect(carets[0].closest('blockquote'), `to=${to} 掉出引用块`).not.toBeNull()
    }
  })
})

/**
 * 光标**不许掉到块下方**（设计 3.5；Task 5 的评审逐格扫出来的四种形态）。
 *
 * 【判据一：末尾兜底的签名】它把光标 `push` 进顶层数组，于是光标成为容器的**最后一个**
 * 子元素，落点是「最后一个已渲染块下面一行、左边缘」——正是用户最初报的那条。
 *
 * 【判据二：顶层还允许一种落点，它必须紧挨占位】占位代表「还没到的东西」，设计 3.5 让光标
 * 落在它**前面**（`BlankSpace` 那一格，是 Step 5 点名要回归的老账，实测连续 13 个偏移位）。
 * 那个谱上的光标**也是**容器的直接子元素——所以「父元素是不是容器」这条判据会把它一起
 * 判红，不能用（实测：表格夹具的 8–20 全是这种合法落点）。真正的区别是它后面**跟着**占位元素。
 *
 * 【为什么不写成「父元素的 class 里有没有 `wt-page__text`」】那是计划 Step 1 稿子里的写法，
 * 在本文件的 `at()` 下**恒为绿**（这里的容器是 testing-library 造的那个无类名 div，
 * 实测缺陷代码上 0 格变红——判据空转，测不出任何东西）。真实的 `.wt-page__text` 那一层
 * 由 `markdownView.test.tsx` 逐偏移扫。
 *
 * 【为什么不能用 `closest('p')`】`<h1>` / `<li>` / `<td>` / `<pre>` 里的正确落点会被它误伤。
 *
 * 【`to = 0` 是唯一的例外】那时每个顶层块都满足「起始偏移 ≥ to」被 `clip` 丢掉，树是空的，
 * 末尾兜底是**唯一**能放的位置（下面单列一条钉住它）。
 *
 * 【夹具为什么是这六份】前四份是计划 Step 1 给的，第六份是评审那张表里「表格尾部 32–35」
 * 对应的夹具（那份表的数字只有它对得上）；第五份（**单行**的那种容器里的围栏）是补的：
 * 计划那张表把「容器里的代码 3–7」列为坏格，而**多行**围栏（计划 Step 1 用的那份）实测
 * 一格都不坏——`wtBlankLines > 0`，占位自己接住了光标（那是 Step 5 要回归的口径）。
 * 坏格的机制是「`code` 的 `value` 为空、内容起点在揭示偏移之后、**围栏里没有第二行可留白**」，
 * 所以复现它要用单行的那种。
 */
describe('光标不出块（真管线，逐偏移）', () => {
  function at(md: string, to: number): HTMLElement {
    const clipped = clipTree(parseMarkdown(md)!, 0, to)
    return render(<>{renderMarkdown(clipped, { caretAt: to })}</>).container
  }

  const FIXTURES = [
    '- 甲\n- 乙\n- 丙\n',
    '> ```\n> 甲\n> 乙\n> ```\n',
    '> ```\n> 甲\n> ```\n',
    '| 甲 | 乙 |\n| - | - |\n| 1 | 2 |\n',
    '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n末段\n',
    '# 季度汇报\n\n正文一行。\n\n又一段。\n'
  ]

  it.each(FIXTURES)('逐偏移：光标都在内容里（%s）', (src) => {
    for (let to = 1; to <= src.length; to++) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]') as HTMLElement | null
      expect(caret, `to=${to} 没有光标`).not.toBeNull()
      expect(c.lastElementChild === caret, `to=${to} 掉到块下方（末尾兜底开火处）`).toBe(false)
      if (caret!.parentElement === c) {
        // 顶层只剩「占位之前」这一种合法落点（判据二）
        expect(
          caret!.nextElementSibling?.className ?? '',
          `to=${to} 顶层的光标后面不是占位`
        ).toMatch(/wt-md-(table|pre)-blank/)
      }
    }
  })

  it.each(FIXTURES)('to = 0：树是空的，末尾兜底是唯一的位置（唯一的例外）', (src) => {
    const c = at(src, 0)
    const carets = c.querySelectorAll('[data-testid="caret"]')
    expect(carets).toHaveLength(1)
    expect(carets[0].parentElement).toBe(c)
  })
})

/**
 * 打着围栏时光标要**在框里**（设计 3.5；Task 4i）。
 *
 * 【这一条修的是用户最初报的那句】原话是「代码块的问题是光标不在代码块里面而是在代码块
 * 下面」。Task 4g 之后剩下的就是这一批：**代码块里还有没揭示的行**（占位存在）时，4g 按
 * 「占位之前」那条把光标留在**框外、紧挨占位**——两条位置都在设计 3.5 之内（框本来就在
 * 占位前面），区别只是「框内第一格」还是「框外紧挨着」。
 *
 * 【判据：光标在不在 `CODE` 元素内】`closest('code')` 同时管住行内代码（`wt-md-code-inline`）
 * 与围栏里的 `<pre><code>`，正是「在框里」这句话的字面意思。
 *
 * 【期望值为什么逐格写死】这张表是 Task 4g 的实施者在加厚语料上量出来的三状态表里的
 * 「目标」列，它等于「4g + 窄修法」的行为；**错的不是那些仍在框外的格**——`0` 那一格树是
 * 空的、`1` 那几格围栏自身还没开始（`code.position.start > at`），按设计 3.5 规则二光标
 * 就该插在它**前面**。所以这里断言的是**整个集合相等**，多一格少一格都要红。
 */
describe('围栏里的光标（真管线，逐偏移）', () => {
  function at(md: string, to: number): HTMLElement {
    const clipped = clipTree(parseMarkdown(md)!, 0, to)
    return render(<>{renderMarkdown(clipped, { caretAt: to })}</>).container
  }

  /** [名字, 源码, 「光标不在 CODE 内」的那些偏移] */
  const CASES: [string, string, number[]][] = [
    ['单行围栏', '```\n甲\n```\n', [0]],
    ['两行围栏', '```\n甲\n乙\n```\n', [0]],
    ['引用块里的围栏', '> ```\n> 甲\n> ```\n', [0, 1]],
    ['引用块里的多行围栏 + 尾段', '> ```\n> 甲\n> 乙\n> ```\n\n尾段\n', [0, 1, 22, 23, 24]],
    ['列表项里的围栏', '- ```\n  甲\n  ```\n', [0, 1]],
    ['空围栏', '```\n```\n', [0]],
    ['缩进代码块', '    甲\n    乙\n', [0]],
    ['只有行内代码', '`乙`\n', [0]]
  ]

  it.each(CASES)('%s：光标不在框里的格只有那几个', (_name, src, expected) => {
    const outside: number[] = []
    for (let to = 0; to <= src.length; to++) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]') as HTMLElement | null
      expect(caret, `to=${to} 没有光标`).not.toBeNull()
      expect(
        c.querySelectorAll('[data-testid="caret"]'),
        `to=${to} 光标数不对`
      ).toHaveLength(1)
      if (caret!.closest('code') === null) outside.push(to)
    }
    expect(outside, '「光标不在框里」的偏移集合').toEqual(expected)
  })
})

/**
 * 兜底那三支路各自的守卫（Task 4j）。
 *
 * 【为什么补这三条】4g 的评审逐条单独变异发现**三条支路零覆盖**（关掉它们、全仓 608 条照旧
 * 全绿）：`renderMarkdown` 里 `hasPlaceholder` 那条让路、`tailTarget` 里 `?? node`（容器收留）、
 * `tailTarget` 里 `definition` 跳过。三条都属「4g 自己写的、没人守着的」——零覆盖的支路等于
 * 下一批人随手改掉它也不会有任何信号。
 *
 * 【三条的判据都取「可观察的后果」，不取实现细节】占位那支守的是设计 3.5 记的**连续 13 格**
 * 老账（关掉它，光标从「`</table>` 之后、占位之前」被挪进表头单元格，20 行表上差出十几行）；
 * 另两条守的是「链尾退回容器之后光标**仍在那个块里**」（关掉它，光标掉到最后一个块下方）。
 *
 * 【夹具与窗口都是量出来的】不是推的：四行表的顶层窗口 = 8–20 ∪ {28,29,30}（8–20 正是设计里
 * 那 13 格），20 行表 = 每行三格、从 8–20 起共 67 格；三份「以叶子收尾」的夹具上，**除 to=0
 * 之外没有一格**是顶层的。
 */
describe('兜底三支路的守卫', () => {
  function at(md: string, to: number): HTMLElement {
    const clipped = clipTree(parseMarkdown(md)!, 0, to)
    return render(<>{renderMarkdown(clipped, { caretAt: to })}</>).container
  }

  const TABLE_ROWS_4 = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\n末段\n'
  const TABLE_ROWS_20 =
    '| a | b |\n| - | - |\n' + Array.from({ length: 19 }, (_, i) => `| ${i} | x |`).join('\n') + '\n'

  it('占位在场：光标紧挨 `</table>` 之后的占位，不在任何格子里（关掉让路那支就红）', () => {
    const WINDOWS: [string, number[]][] = [
      [TABLE_ROWS_4, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 28, 29, 30]],
      [
        TABLE_ROWS_20,
        // 表头那一窗 + 之后每行三格（量出来的，不是推的）
        [
          8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 28, 29, 30, 38, 39, 40, 48, 49, 50, 58,
          59, 60, 68, 69, 70, 78, 79, 80, 88, 89, 90, 98, 99, 100, 108, 109, 110, 118, 119, 120,
          129, 130, 131, 140, 141, 142, 151, 152, 153, 162, 163, 164, 173, 174, 175, 184, 185, 186,
          195, 196, 197, 206, 207, 208
        ]
      ]
    ]
    for (const [src, window] of WINDOWS) {
      for (const to of window) {
        const c = at(src, to)
        const caret = c.querySelector('[data-testid="caret"]') as HTMLElement
        expect(caret, `to=${to} 没有光标`).not.toBeNull()
        // 关掉让路那支之后：光标进了 `<th>` / `<td>`，这一条当场红
        expect(caret.closest('th, td'), `to=${to} 光标进了格子`).toBeNull()
        // 也不许掉到表格**下面**去：它必须紧挨着占位那块的**前面**
        expect(caret.parentElement, `to=${to} 不是顶层`).toBe(c)
        expect(
          caret.nextElementSibling?.className ?? '',
          `to=${to} 后面不是占位`
        ).toContain('wt-md-table-blank')
      }
    }
  })

  it.each([
    ['图片收尾', '甲 ![图](a.png)\n', 'p'],
    /*
      【脚注那份的容器选择器要带上 `.wt-md-fndef`】它渲染成
      `<div class="wt-md-fndef"><span>标号</span><p>…</p></div>`，而 to=8–13 那几格光标
      合法地待在**那个 div 里、`<p>` 前面**（`caretBefore` 的「插在它前面」）——只认 `p`
      会把正确的落点判成失败（实测踩到过）。
    */
    ['脚注引用收尾', '甲[^1]\n\n[^1]: 脚注\n', 'p, .wt-md-fndef'],
    ['硬换行收尾', '甲  \n', 'p']
  ])('段落以叶子收尾（%s）：链尾退回容器，光标仍在块里（关掉 `?? node` 就红）', (_n, src, sel) => {
    for (let to = 1; to <= src.length; to++) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]') as HTMLElement
      expect(caret, `to=${to} 没有光标`).not.toBeNull()
      expect(caret.parentElement, `to=${to} 掉到块下方`).not.toBe(c)
      expect(caret.closest(sel), `to=${to} 不在 ${sel} 里`).not.toBeNull()
    }
  })

  it('文档以 `[ref]:` 定义收尾：跳过它看前一个兄弟（关掉 definition 跳过那支就红）', () => {
    const src = '甲\n\n[a]: https://example.com\n'
    for (let to = 1; to <= src.length; to++) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]') as HTMLElement
      expect(caret, `to=${to} 没有光标`).not.toBeNull()
      expect(caret.parentElement, `to=${to} 掉到块下方`).not.toBe(c)
      expect(caret.closest('p'), `to=${to} 不在段落里`).not.toBeNull()
    }
  })
})

/**
 * 合并 text / html 那条串上的链尾（Task 4j）。
 *
 * 【缺陷】`renderAll` 里 `hasHtml` 那条路**只调 `renderTokens(tokens)`、从不 `renderNode`**，
 * 于是 `splitAtCaret` 不被调用、`caret.tail` 没人消费——光标一路落到 `renderMarkdown` 末尾
 * 那条兜底，落在**块外**。实测：`'> <b>x</b>甲一\n> 乙二\n\n末段\n'` 的 **18、19** 与
 * `'甲 <b>乙</b>\n\n末段\n'` 的 **7、8、9**（老代码 871 格里这类 110 格，4g 修好 108，剩这 2 处）。
 *
 * 【成因不是「链尾是 html 叶子」】那几格 `tailTarget` 返回的是**文本节点**（line 里那个
 * 「非值叶子返回 null」的分支只在这两份夹具的 `to = 0` 附近开火，而那时光标本来也在块内）。
 * 所以修法是让这条串**也认 `caret.tail`**：串尾命中 tail 时把光标放在这一串的末尾
 * （tail 恒是这一串的最后一个节点，所以「串尾」就是「那个节点的末尾」）。
 */
describe('合并串上的链尾（真管线，逐偏移）', () => {
  function at(md: string, to: number): HTMLElement {
    const clipped = clipTree(parseMarkdown(md)!, 0, to)
    return render(<>{renderMarkdown(clipped, { caretAt: to })}</>).container
  }

  it.each([
    ['引用块里的行内 HTML', '> <b>x</b>甲一\n> 乙二\n\n末段\n', 'blockquote', [18, 19]],
    ['段落里的行内 HTML', '甲 <b>乙</b>\n\n末段\n', 'p', [7, 8, 9]]
  ])('%s：光标在块内（%s）', (_n, src, sel, named) => {
    for (const to of named) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]') as HTMLElement
      expect(caret, `to=${to} 没有光标`).not.toBeNull()
      expect(caret.closest(sel), `to=${to} 掉出 ${sel}`).not.toBeNull()
    }
    // 整段逐偏移一起守：除 to=0（树是空的）之外，一格都不许落在顶层
    for (let to = 1; to <= src.length; to++) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]') as HTMLElement
      expect(caret.parentElement, `to=${to} 掉到块下方`).not.toBe(c)
    }
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
import { createElement, Fragment, type CSSProperties, type ReactNode } from 'react'
import type { Root } from 'mdast'
import { tokenizeHtml, type HtmlToken } from './html'
import { MarkdownImage } from './MarkdownImage'
import { readBlankCount, WT_BLANK_LINES, WT_BLANK_ROWS } from './clip'
import { lineStartsOf, valueStartOf } from './parse'

/** mdast 的节点联合。`Root['children'][number]` 就是 `Content`，写出来更直白。 */
type MdNode = Root['children'][number]

/** 表头单元格与普通单元格的唯一区别，外加阅读光标那一份状态。 */
interface Ctx {
  readonly header: boolean
  /**
   * 阅读光标。`null` 表示不插，有**两条**路走到这里：
   * 1. **没传 `caretAt`**——`renderMarkdown(tree)` 不带 opts 的整篇渲染，量高度那份副本
   *    与一切「只想要排版、不要光标」的调用都走这条；
   * 2. `withBlockEnds` 那条支路**显式写死 `caret: null`**（见那里的注释），与调用方传没传
   *    `caretAt` 无关——那是「机器保证」，不是「靠自觉」。
   */
  readonly caret: Caret | null
}

/**
 * 阅读光标的状态。
 *
 * 【为什么 `placed` 是可变字段】它要在整棵树里只命中一次，而渲染是深度优先的递归——
 * 用一个共享的小对象带下去，比让每一层返回「插过了没」再往上并简单得多。
 * 它每次 `renderMarkdown` 都新造一个，所以两次渲染之间不会互相串。
 *
 * 【`tail` 是「末尾兜底」该落进哪个节点】由 `tailTarget` 在渲染前算一次，渲染中按节点身份
 * 比对——**不是**让每一层自己判「我在不在文档末尾」（渲染是自上而下的，一个容器看不到
 * 它后面还有没有兄弟）。
 */
interface Caret {
  readonly at: number
  /** 末尾兜底的目标节点；`null` 表示这一趟不做那条兜底（树是空的、或者树上还有占位） */
  readonly tail: MdNode | null
  placed: boolean
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
 *
 * 【`caretAt` 是「揭示到哪个偏移」，见设计 3.5；量高度那一份永远不传它】
 */
export function renderMarkdown(
  root: Root,
  opts: { withBlockEnds?: boolean; caretAt?: number | null } = {}
): ReactNode {
  const caret: Caret | null =
    typeof opts.caretAt === 'number' && Number.isFinite(opts.caretAt)
      ? {
          at: opts.caretAt,
          placed: false,
          tail: hasPlaceholder(root) ? null : tailTarget(root.children)
        }
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
  // 【这一句只在「一个能放光标的节点都没有」时才走到】它是**最后一条**兜底，落点是容器的
  // 末尾，也就是最后一个块**下方**——正是用户最初报的那条（隐形输入框与输入法候选框都按
  // 这个坐标摆）。所以它现在只留给两类情形：
  //  1. 整篇还没开始揭示（`to = 0`）：每个顶层块都满足「起始偏移 ≥ to」而被 `clip` 丢掉，
  //     树是空的，一个节点都没有——本来也没有别的位置可放。
  //  2. 链尾是**放不下光标**的节点：文档以分隔线 / 图片 / 内嵌 HTML 收尾，或者树上还有占位
  //     （`tail` 为 `null`，见 `tailTarget`）。这时光标落在最后一个元素**之后**，与「放在
  //     它后面」是同一个位置。
  //
  // 【前一版这里写的是「实测只有两类」，第二类不成立】它把「揭示偏移落在所有已揭示文字的
  // 后面」也归进兜底、还说「内容本来也到头了，位置看不出差别」。**实测那正是缺陷**：
  // 14 份夹具逐偏移 230 格里有 15 格落在文档**中间**（多行列表的每个列表项边界、容器里的
  // 围栏、表格尾部、标题后面那个换行），内容都还剩很多——「下一个块还没到它的起点」时，
  // 屏幕上明明还有一整块已渲染的内容，光标却在它下面一行。现在那些格子由 `tailTarget`
  // 收进**最后一块已渲染的内容**里，只有上面两类才落到这里。
  //
  // 【这一句也**不该**在文档中间开火】占位那几格（表格 `to = 8–20` / `28–30`、代码块
  // `to = 1–3`）曾经也走这里，被甩到占位**后面**；已经由「占位自己接光标」修掉
  // （见 `BlankSpace`）。两条的优先级由 `tailTarget` 那句「树上有占位就返回 null」保证。
  // 外面套一层 Fragment 只为挂 `key`——`CaretSpan` 没有 props，别给它传。
  if (caret && !caret.placed) out.push(<Fragment key="caret-fallback"><CaretSpan /></Fragment>)
  return out
}

/** 节点有没有 `children`（mdast 里「容器」与「叶子」就是按这一条分的）。`Root` 也算容器。 */
function childrenOf(node: Root | MdNode): readonly MdNode[] | null {
  return 'children' in node ? node.children : null
}

/** 带**可裁**文本、能自己接住光标的三个节点类型（`clip.ts` 的 `VALUE_TYPES` 是同一组）。 */
function isValueNode(node: MdNode): boolean {
  return node.type === 'text' || node.type === 'code' || node.type === 'inlineCode'
}

/**
 * 树上还有没有「未揭示的占位」（`wtBlankLines` / `wtBlankRows`，`clip.ts` 挂的）。
 *
 * 它决定 `tailTarget` 要不要整个让路——理由见那里的最后一段。
 */
function hasPlaceholder(node: Root | MdNode): boolean {
  if (readBlankCount(node, WT_BLANK_LINES) > 0 || readBlankCount(node, WT_BLANK_ROWS) > 0) {
    return true
  }
  const kids = childrenOf(node)
  return kids !== null && kids.some((child) => hasPlaceholder(child))
}

/**
 * 末尾兜底该把光标放进哪个节点里（`Caret.tail`）。
 *
 * 【为什么需要它】`clip` 把「起始偏移 ≥ 揭示偏移」的节点**整块丢掉**，于是设计 3.5 里
 * 「整个在揭示偏移之后的节点 → 光标插在它前面」那条规则对被丢掉的节点永远开不了火
 * （它们不在树上）；容器里正在敲的围栏又被 `caretIndexIn` 的左界挡掉。两头都堵上之后，
 * 光标一路走到 `renderMarkdown` 末尾那条兜底，被追加成最后一个块的**下方**。
 * 评审逐格扫过（14 份夹具 × 逐偏移 = 230 格）：文档中间有 15 格落在这里，四种形态——
 * 多行列表的每个列表项边界、容器里的围栏、表格尾部、标题后面那个换行。本 Task 按同一条
 * 判据在六份夹具上逐偏移复核过：四种形态都在，而「容器里的围栏」那一组要用**单行**的夹具
 * 才复现（多行的那种 `wtBlankLines > 0`，占位自己接住了光标）——见测试里那段说明。
 *
 * 【判据：沿「最后一个孩子」一路往下走】走到头的那个节点就是**最后一块已渲染的内容**
 * （`clip` 丢掉的节点不在树上，所以「最后一个孩子」恒是最后一个**已经开始揭示**的）：
 * - 它带可裁文本（`text` / `code` / `inlineCode`）→ 光标落在它 `value` 的**末尾**
 *   （`splitAtCaret` 里那条夹到上界的路）；
 * - 它是个容器（一格里什么都没有的表格单元之类）→ 落在它最后一个孩子**之后**。
 * 两条都让光标**留在块里**。
 *
 * 【链尾是 `code` / `inlineCode` 也要管】容器里的围栏那几格（`'> ```\n> 甲\n> ```\n'`
 * 的 3–7）树上只有 `blockquote > code`，而那个 `code` 的 `value` 是空的、内容起点在揭示
 * 偏移之后。链尾这时是 `code` 本身，光标于是进 `<pre><code>`——那正是用户最初报的
 * 「光标不在代码块里面」。
 *
 * 【链尾是分隔线 / 图片 / 内嵌 HTML 这类叶子时返回 `null`】它们没有文本、也收不下一个 span；
 * 但它们既然后面什么都没有，「追加在末尾」与「放在它后面」是同一个位置，不必区别对待。
 * （`definition` 渲染成 `null`，跳过它接着看前一个兄弟。）
 *
 * 【树上有占位（`wtBlankLines` / `wtBlankRows`）时一律返回 `null`——这条必须保住】
 * 占位代表「还没到的东西」，设计 3.5 让它**自己**接住光标（`BlankSpace`），而占位渲染在
 * 块的内部、比链尾更深也**更晚**：不让路的话，表格剩余行、代码块剩余行那几格会被本条抢回
 * 块里，「光标落在占位之前」这条既有口径（实测连续 13 个偏移位）当场就破。两者本来也
 * 互斥——占位那几格里没有「最后一块已渲染的内容」可放，占位就是它。
 */
function tailTarget(children: readonly MdNode[]): MdNode | null {
  for (let i = children.length - 1; i >= 0; i--) {
    const node = children[i]
    if (node.type === 'definition') continue // 渲染成 null，放不下光标
    const kids = childrenOf(node)
    if (kids) return tailTarget(kids) ?? node
    if (isValueNode(node)) return node
    return null
  }
  return null
}

/**
 * 容器「收下」兜底光标：`Caret.tail` 命中它时，追加在最后一个已渲染的孩子**之后**。
 *
 * 【为什么只有容器才调它】带文本的节点自己会把光标劈开（`splitAtCaret`），那样落点更准
 * （落在正确的字符之间）；这里管的是「容器里一个孩子都没接住」的那一半，见 `tailTarget`。
 *
 * 【表格与表格行**不调它**】一个 span 做成 `<tr>` / `<table>` 的直接子元素会让 CSS 套一个
 * 匿名表格盒，**表格于是多出一列**（复审实测：宽 115→172）。与 `caretBefore` 那条
 * 让路是同一个理由。链尾真落在表格里时，最内层的那个格子会先收下它。
 */
function tailCaretIn(node: MdNode, ctx: Ctx): ReactNode {
  const caret = ctx.caret
  if (!caret || caret.placed || caret.tail !== node) return null
  caret.placed = true
  return <CaretSpan />
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

function renderNode(node: MdNode, ctx: Ctx): ReactNode {
  switch (node.type) {
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
    // 【下面这些容器都挂了一句 `tailCaretIn(node, ctx)`】它在孩子渲染完之后跑（JSX 的孩子
    // 按书写顺序求值），于是「孩子里一个都没接住光标」时，兜底目标就落在这个容器的末尾。
    // 判据与理由见 `tailCaretIn` / `tailTarget`——**表格与表格行不挂**（见那里的注释）。
    case 'paragraph':
      return (
        <p className="wt-md-p">
          {renderAll(node.children, ctx)}
          {tailCaretIn(node, ctx)}
        </p>
      )
    case 'heading': {
      const Tag = HEADING_TAGS[Math.min(Math.max(node.depth, 1), 6) - 1]
      return (
        <Tag className={`wt-md-h wt-md-h${node.depth}`}>
          {renderAll(node.children, ctx)}
          {tailCaretIn(node, ctx)}
        </Tag>
      )
    }
    case 'emphasis':
      return (
        <em className="wt-md-em">
          {renderAll(node.children, ctx)}
          {tailCaretIn(node, ctx)}
        </em>
      )
    case 'strong':
      return (
        <strong className="wt-md-strong">
          {renderAll(node.children, ctx)}
          {tailCaretIn(node, ctx)}
        </strong>
      )
    case 'delete':
      return (
        <del className="wt-md-del">
          {renderAll(node.children, ctx)}
          {tailCaretIn(node, ctx)}
        </del>
      )
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
    }
    case 'break':
      return <br />
    case 'thematicBreak':
      return <hr className="wt-md-hr" />
    case 'blockquote':
      return (
        <blockquote className="wt-md-quote">
          {renderAll(node.children, ctx)}
          {tailCaretIn(node, ctx)}
        </blockquote>
      )
    case 'list':
      return node.ordered ? (
        <ol className="wt-md-list" start={node.start ?? undefined}>
          {renderAll(node.children, ctx)}
          {tailCaretIn(node, ctx)}
        </ol>
      ) : (
        <ul className="wt-md-list">
          {renderAll(node.children, ctx)}
          {tailCaretIn(node, ctx)}
        </ul>
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
          {tailCaretIn(node, ctx)}
        </li>
      )
    }
    case 'link':
      return (
        <span className="wt-md-link" title={node.url}>
          {renderAll(node.children, ctx)}
          {tailCaretIn(node, ctx)}
        </span>
      )
    case 'linkReference':
      // 引用的定义没找到时 remark 留着这种节点。画成链接的样子，但没有地址可给。
      return (
        <span className="wt-md-link">
          {renderAll(node.children, ctx)}
          {tailCaretIn(node, ctx)}
        </span>
      )
    case 'image':
      return <MarkdownImage url={node.url} alt={node.alt ?? ''} />
    case 'imageReference':
      return <MarkdownImage url="" alt={node.alt ?? ''} />
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
    case 'tableRow':
      // 【这里**不挂** `tailCaretIn`】光标做成 `<tr>` 的直接子元素会让表格多出一列（理由
      // 见 `tailCaretIn`）。链尾真落在表格里时由下面那个格子收下。
      return <tr>{renderAll(node.children, ctx)}</tr>
    case 'tableCell': {
      const Tag = (ctx.header ? 'th' : 'td') as 'th'
      return (
        <Tag className="wt-md-cell">
          {renderAll(node.children, ctx)}
          {tailCaretIn(node, ctx)}
        </Tag>
      )
    }
    case 'footnoteReference':
      return <sup className="wt-md-fn">{node.label}</sup>
    case 'footnoteDefinition':
      return (
        <div className="wt-md-fndef">
          <span className="wt-md-fndef__label">{node.label}</span>
          {renderAll(node.children, ctx)}
          {tailCaretIn(node, ctx)}
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

/** 摊平后的一行：它在 `value` 里的下标、长度（不含行尾换行），以及它在源码里的起点。 */
interface Row {
  /** 这一行首字符在 `value` 里的下标 */
  readonly base: number
  /** 这一行在 `value` 里的长度（**不含**行尾换行） */
  readonly len: number
  /** 这一行首字符在源码里的偏移 */
  readonly src: number
}

/**
 * 把一个带文本节点的 `value` 摊成「行」（设计 3.6.1）。
 *
 * 【没有逐行表时摊成**一行**】那时候「起点 + 字符数」本来就是线性的，退化成一行正好等价于
 * 旧算法（下标 `= 揭示偏移 − 起点`、区间 `[起点, 起点 + 长度]`），所以下面两处调用都不必
 * 分岔——分岔两份判据就等于两份会各自走样的东西。
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

/**
 * 揭示偏移落在这个带文本节点上的哪里；**接不住给 `null`**。
 *
 * 【判据是**区间包含**】`首行起点 ≤ 揭示偏移 ≤ 末行内容的结束偏移` 才接得住，
 * 它是同一条规则的两处使用者（`splitAtCaret` 与 `holdsCaret`）共用的唯一实现。
 * 它同时管住两件事，少任何一边都不行：
 * - **空节点照样接得住**：列表项刚开始、文字还没出来时，那个空文本节点的起点 = 结束 =
 *   揭示偏移，区间退化成一点、仍然包含它，光标于是落在序号后面而不是掉到列表下面；
 * - **值节点不抢它前面的光标**：只判「结束偏移 ≥ 揭示偏移」的话，一个**起点在揭示偏移
 *   之后**的值节点也会命中（它的结束当然不小于揭示偏移），于是把本该落在它**前面**的光标
 *   吸进它里面。实测过这个形态：表格里那一串空单元格文字节点就是这么把光标接走的。
 *   `caretBefore` 靠 `holdsCaret` 让路，走的正是同一套判据。设计 3.5 是这条规则的正本。
 *
 * 【有逐行表时下标要**查表**，不能做减法】`揭示偏移 − 内容起点` 只在**行内**成立：容器里
 * 逐行剥前缀的文字（引用块的 `> `、列表项的续行缩进），第二行起每行差一个前缀宽度
 * （设计 3.6.1）。查表的算法是「找到**起点不超过揭示偏移的最后一行**，下标 = 该行在
 * `value` 里的起点 +（揭示偏移 − 该行起点），并夹到该行长度」。
 *
 * 【揭示偏移落在末行之后是对的一格】末尾那一行已经揭示完、下一行的字还没到时，循环停在
 * 末行，光标落在**已揭示文字的末尾**——正是该在的地方。没有表时这一格由 `Math.min` 夹住，
 * 两条路给的是同一个数。
 *
 * 【为什么量的是**裁后**的 `value`】树上已经没有未揭示的字了，所以末行内容的结束偏移就是
 * 光标该在的位置；有表时这个位置与「起点 + 长度」不再相等，差的就是逐行前缀那一段。
 *
 * 【上界取**节点源码的结束**，不是末行内容的结束】末行内容之后到节点结束之间只剩语法：
 * 尾随换行，以及**下一行还没揭示的行前缀**（引用块的 `> `、列表项的续行缩进）。逐行表只收
 * 「起点小于揭示偏移」的行，而前缀的偏移比它所属那一行的内容起点还靠前，所以那几个偏移位
 * 不属于表里任何一行；上界若取末行内容结束，它们就一个节点都接不住，光标掉出块外
 * （实测 `'> 引用甲\n> 引用乙\n'` 的 6、7、8 三格从块内跳到篇末）。
 * **「末行内容结束 + 1」不够**（评审实测）：中间还隔着 `> ` 那两个字符，掉出集合只各减一个。
 *
 * 【下界取**节点自己的源码起点**，不是内容起点】（Task 4i）
 * `value` 里不含定界符，所以 `code` / `inlineCode` 的**内容起点在围栏之后**（设计 3.6）：
 * 「光标还在打围栏」那几格（`'```\n甲\n```\n'` 的 1–3、容器里的 1–6）上，内容起点比揭示偏移
 * 还靠后，于是**没有任何节点接得住**，光标落到占位前/兜底上——**在框外**。而用户最初报的
 * 正是这一条（「代码块的问题是光标不在代码块里面而是在代码块下面」）。
 *
 * 判据于是松开到「**这个节点已经开始了**就允许它接住光标」：
 * `lower = min(内容起点, position.start)`，下标在循环里自然夹到 0（那几格的内容还没出来，
 * 光标落在框内第一格，正是下一个字要出现的地方）。
 *
 * 【为什么这样松开不会破「值节点不抢它前面的光标」】`min()` 只在
 * `position.start < rows[0].src` 时把下界往下拉，而那条保护管的是**节点起点在 `at` 之后**
 * （`position.start > at`）——两件事不相交。而且它只在 `at ≥ position.start` 时才放行：
 * 围栏自身还没开始那几格（`'> ```\n> 甲\n> ```\n'` 的 `at = 1`，`code.position.start = 2`）
 * **照样拒绝**，走设计 3.5 规则二「整个在揭示偏移之后的节点 → 光标插在它前面」✓。
 *
 * 【它结构上动不到表格】`text` 节点的 `position.start` **就是**内容起点，`min()` 对它是恒等
 * 变换；受影响的只有「`position` 从定界符起算」的 `code` 类节点。评审在加厚表格语料
 * （表头带空格、空单元格、两行表头、多行表体）上逐格量过：**0 差异**。
 *
 * 【别把下界整条删掉】那样会多改 61 格，全是「把光标拉进一个**还没开始**的元素」——
 * 上面那条保护的退化形态（实测：`'甲甲\n> 甲\n> ```ts\n> ```ts\n'` 的 `to = 7`，
 * 真值该紧跟已揭示的『甲』之后，删掉下界后光标被拉进 `<pre><code>`）。
 *
 * 【`isTail`：这一次是**夹**而不是**拒**】末尾兜底的目标节点（`Caret.tail`，见 `tailTarget`）
 * 带这个标记：它明知揭示偏移在区间外也要接住光标，两端都夹——落在起点之前给 0、落在上界
 * 之后给 `value.length`。整篇的最后一个字已经全部揭示、而揭示偏移落在它后面（文档末尾那个
 * 换行、或者下一个块还没开始）时，光标于是落在**那个字的末尾**，而不是掉到最后一个块下方。
 * 下面那个循环本来就兼着夹的功能（`rows` 一行都没有超过 `at` 时 `index` 停在 0），
 * 所以这里只多一个闸。
 */
function caretIndexIn(
  node: MdNode,
  at: number,
  isTail = false
): { value: string; index: number } | null {
  if (node.type !== 'text' && node.type !== 'code' && node.type !== 'inlineCode') return null
  const value = node.value
  const rows = rowsOf(node, value, originOf(node))
  const last = rows[rows.length - 1]
  // 【`Math.max` 那一下是防位置失真】正常情形 `position.end` 一定不小于末行内容结束；
  // 手工造的树或者位置缺失时退回 `contentEnd`，判据不因此放宽。
  const contentEnd = last.src + last.len
  const upper = Math.max(node.position?.end.offset ?? contentEnd, contentEnd)
  // 下界见上面那段：节点**已经开始**（`position.start ≤ at`）就允许它接住光标，
  // 哪怕内容起点（围栏之后）还在揭示偏移的后面。位置缺失时退回内容起点——不放宽。
  const lower = Math.min(rows[0].src, node.position?.start.offset ?? rows[0].src)
  if (!isTail && (at < lower || at > upper)) return null
  let index = 0
  for (const row of rows) {
    if (at < row.src) break
    index = row.base + Math.min(at - row.src, row.len)
  }
  return { value, index }
}

/**
 * 把一个带文本的节点的 `value` 按光标切成两段；没命中给 `null`（调用方原样渲染）。
 *
 * 【`isTail` 那一下是**兜底**，不是放宽】`caret.tail === node` 说明它就是**最后一块已渲染
 * 的内容**（`tailTarget` 一路沿最后一个孩子走到的那个节点），而走到这里说明没有别的节点
 * 接得住光标。这时夹进它的区间——`at` 落在它前面给 0、落在后面给 `value.length`——
 * 光标于是落在块**里面**，而不是掉到最后一个块下方。
 */
function splitAtCaret(node: MdNode, ctx: Ctx): [string, string] | null {
  const caret = ctx.caret
  if (!caret || caret.placed) return null
  const hit = caretIndexIn(node, caret.at, caret.tail === node)
  if (hit === null) return null
  // 【先置位再返回】置位是「整棵树只插一个」的闸，必须在返回前落下
  caret.placed = true
  return [hit.value.slice(0, hit.index), hit.value.slice(hit.index)]
}

/** 这个节点能不能**自己**接住光标：它带可裁文本，且 `caretIndexIn` 那条区间包含揭示偏移。 */
function holdsCaret(node: MdNode, ctx: Ctx): boolean {
  return ctx.caret !== null && caretIndexIn(node, ctx.caret.at) !== null
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
 * 实测过（`甲  ␊乙` 在 2–4；`甲 ![图](…) 乙` 在**复审的夹具上** 3–19、本仓夹具
 * `甲 ![图](a.png) 乙\n` 上 3–15——URL 长度不同，坏区宽度就不同）。所以对「没有
 * children、也不是可裁文本」的叶子再判一次**结束偏移**。
 *
 * 【为什么值节点不在这里处理】它能自己把文本**劈开**（`splitAtCaret`），那样光标落在
 * 它**里面**那个正确的字符上，比落在它前面准。上面 `holdsCaret` 那一句就是把这个机会
 * 让给它。
 *
 * 【占位**不走**这一条了，它是**自己接**】`BlankSpace` 不是语法树里的节点，本函数曾经由
 * `code` / `table` 两个分支在渲染占位之前显式调一次——**那是死代码**：本函数的「整个在
 * 揭示偏移之后」判据是 `起始偏移 ≥ caret.at`，而被渲染出来的块恒有 `起始偏移 < to`
 * （`clipBlocks` 早把 `start >= to` 的整块丢了），两个条件互斥、**永远开不了火**。实测：
 * 表格 `to = 8–20` / `28–30`、代码块 `to = 1–3` 这连环区里，光标会被一路甩到占位之后。
 * 现在由 `BlankSpace` 在 `count > 0` 时自己接，理由见那里的注释——**别把那两个调用点
 * 加回来**。
 */
function caretBefore(node: MdNode, ctx: Ctx): ReactNode {
  const caret = ctx.caret
  if (!caret || caret.placed) return null
  if (holdsCaret(node, ctx)) return null
  /*
    【给表格的行与格让路】它们里面**通常**有子文本节点会接住光标；在它们身上开火会把
    光标插成 `<tr>` 的**直接子元素**——那不是合法的表格内容，CSS 会给它套一个匿名表格盒，
    **表格于是多出一列**（复审实测宽 115→172、第二列 x 57→114）。

    这一格是加这条让路之前新引入的：旧判据在那些位置把光标放在第二个 `<th>` **里面**
    （合法），而区间判据让 `cell.start >= caret.at` 先开火、把它挪到了格外。

    【一处残留，别把上面那句读成「一定落在格里」】**格子没有子节点时没人接得住**——例如
    `| a |  |` 的第二个表头格子（解析出来是 `tableCell [4..8]`，**一个子节点都没有**）。
    实测 `to = 4–19` 这一整段上，光标落到占位**之前**（`</table>` 之后、
    `.wt-md-table-blank` 之前）。那是**合法 DOM**（不再是 `<tr>` 的孩子），位置也比加本条
    之前好，但它确实不在任何格内——记在这里，不假装做到了。

    【「插在它前面」这句只对**叶子**成立，不是整个函数】`after`（`起始偏移 ≥ 揭示偏移`）
    那一支对**容器**照样开火，而且是必要的：实测 `> 引用甲\n> 引用乙\n` 在 `to = 1 / 2` 上
    命中的是 `paragraph`，光标插在 `<blockquote>` 里那个 `<p>` **前面**——合法且位置正确。
    所以「容器一律往下递归」说的是 `leafAcross` 那一支，不要说成整条规则。

    实测位置：`to = 4 / 24 / 34`——正好是**每个非首单元格的起点**。
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
 * 【为什么值要转成字符串 —— 理由已按实测更正】原来那句「取决于 React 版本行为、可能补
 * 一个 `px`」**在本仓库不成立**：实测 React 19.3.0 对 `--*` 自定义属性走 `setProperty`，
 * **不补**单位（`style={{ '--x': 2 }}` 渲染出来就是 `--x: 2;`）。所以 `String(count)` 留着
 * 只是把类型收干净（`CSSProperties` 的值允许 `number`），它**不再**承担「防补 `px`、
 * 防高度静默归零」那层理由——下一个人动它时不必以为去掉就有风险。
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

  /* 未揭示部分占位用的两个「一行多高」。**必须是绝对长度**：自定义属性是在*使用处*
     解析的，写成 `1.9em` 会在占位块那儿按它自己的字号算，与表格行、代码行的真实高度
     对不上（占位块是表格/代码块的兄弟节点，字号与它们不同）。 */
  --wt-md-code-line: calc(13px * 1.6);    /* `.wt-md-pre` 的 font-size × line-height */
  --wt-md-row-h: calc(14px * 1.9 + 10px); /* `.wt-md-table` 的字号 × 正文行高 + 单元格上下内边距与边框 */
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
  /* 光标刚走到某一行、里面的字还没抽出来时，那一行是空的——不给高度就缩成一条细线，
     这正是改之前「太拥挤」那个观感的一半。表格单元格上的 `height` 是**最小高度**，
     内容多的行照常撑开，不会被压扁。 */
  height: var(--wt-md-row-h);
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

  it('md 这条路**没有** `.wt-page__novel` 那一层，正文字体与字号够不着它', () => {
    // 【为什么要钉这一条】新正文的字体与字号挂在 `.wt-page__novel` 上（`page.css`）。
    // 这一层若被套到 md 上（或字体被挂回共用的 `.wt-page`），md 就会跟着换字体、
    // 跟着缩字号——而它那一整套 px 是照着 Word 的标题层级写死的，缩了层级就散了。
    const c = page(source()).container
    expect(c.querySelector('.wt-page__novel')).toBeNull()
    // 前提自检：这一份确实渲染出了块，不是因为整棵树空着才没有那一层。
    expect(c.querySelector('h1')).not.toBeNull()
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

/**
 * 阅读光标（设计 3.5）。
 *
 * 【判据一：不是 `.wt-page__text` 的**最后一个**子元素】光标原来由 `Page` 追加在内容末尾，
 * 落在最后一个块**下方**；`renderMarkdown` 那条末尾兜底是同一个签名。修好之后它落在
 * **块里面**——`<h1>` / `<p>` / `<li>` / `<pre>` / `<td>` 里。
 *
 * 【为什么不用 `closest('p')`】它把正确地待在标题、列表项、单元格、代码框里的落点全判成失败
 * （本文件这份 DOC 上实测 5 格不成立、10 格误伤——评审逐偏移量过）。
 *
 * 【为什么不用「父元素是不是 `.wt-page__text`」】顶层还允许「占位**之前**」这一种落点
 * （设计 3.5，`BlankSpace` 接的那几格），它同样是直接子元素；靠「是不是最后一个」才分得开。
 *
 * 【`cursor = 0` 是唯一的例外】那时树是空的，末尾兜底是唯一能放的位置。
 */
describe('Page —— 阅读光标', () => {
  it('md 那条路：逐偏移扫，光标恰好一个，且不是末尾兜底那一下', () => {
    for (let cursor = 0; cursor <= DOC.length; cursor++) {
      const c = page(source({ cursor })).container
      const text = c.querySelector('[data-testid="page-text"]')!
      const carets = text.querySelectorAll('[data-testid="caret"]')
      expect(carets, `cursor=${cursor} 光标数不对`).toHaveLength(1)
      if (cursor === 0) {
        // 树是空的（每个顶层块都满足「起始偏移 ≥ to」被丢掉），兜底是唯一的位置
        expect(text.firstElementChild, `cursor=0 应当是末尾兜底`).toBe(carets[0])
        continue
      }
      expect(text.lastElementChild === carets[0], `cursor=${cursor} 掉到块下方`).toBe(false)
    }
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
 *
 * 【阅读光标由 `renderMarkdown` 插进树里，`Page` 不再追加】光标画在「揭示到哪」那个字
 * 后面，而不是内容的末尾（设计 3.5）：这条路的内容是块级元素的树，追加在末尾的 span
 * 只落得到最后一个块**下方**，而隐形输入框与输入法候选框都按这个坐标摆。
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
      {/*
        【`caretAt` 只给可见那一份】它是「揭示到哪个偏移」，光标据此插进树里
        （设计 3.5）。下面那份整篇副本永远不传——它只是拿来量高度的，多一个光标
        不但没用，还会让 `[data-testid="caret"]` 在文档里出现两次，
        而 `InputCapture` 取的是**第一个**。
      */}
      {renderMarkdown(visible, { caretAt: cursor })}
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
              /*
                【这一层只为了字体】新正文的字体与字号挂在 `.wt-page__novel` 上，而不是
                挂在共用的 `.wt-page__text` 上——md 那条路没有自己的根元素（各块都是
                `.wt-page__text` 的直接子元素），字体挂在外层会让它一起跟着换。
                详见 `page.css` 里那段说明。

                【光标为什么在里面】它是 `height: 1.15em`，留在外面就按 `.wt-page` 那个
                写死的 15px 算——正文字号调大时光标会矮一截。
              */
              <span className="wt-page__novel" data-testid="novel-text">
                {shown}
                {/*
                  【这个光标只属于纯文本那条路】md 那条路的光标由 `MarkdownView`
                  里的 `renderMarkdown` 插进语法树（设计 3.5）——内容是块级元素的树，
                  追加在末尾只会落在最后一个块**下方**，而隐形输入框与输入法候选框
                  都按这个坐标摆。
                */}
                <span className="wt-caret" data-testid="caret" />
              </span>
            )}
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

**实施时实测出来的一条**：上面这两条用例还缺两样东西——`pressBossKey()` 要包进 `act`（与那个文件里其余用例一致），以及按之前要 `await waitForWorkDocLoaded()`。少了后者时按老板键会收到 toast 而不是切换，用例会以「没有 h1」这种**看起来像功能没做**的样子红掉，而那正是那个助手存在的理由。当时连跑几轮都是绿的，所以这是防将来偶发、不是修一条已经红的用例。

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

**7b.** 在 `const state = useTypingEngine(shownEngine)` **之后**加（**不是** `shownEngine` 之后——下面那段片段读了 `state`，而它是下一行才声明的，照字面放在 `shownEngine` 后面会 TDZ / TS2448。这是实施时实测出来的）：

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

- [ ] **Step 7: 补一条只有换个观测点才写得出来的 witness**

**这条是实施时量出来的一个缺口，不是原计划的一部分。** 进老板模式那一下要量块高，而它在 jsdom 里**从结果上不可观测**：量到与量不到**都会**调 `revealTo(fillCharsFor(percent))`（前者因为 jsdom 量不出高度、也走同一条兜底），返回值一模一样。所以只能换观测点——`vi.mock` 掉 `measure` 模块、把 `measureBlocks` 换成 spy，按 ⌘⇧B 之后断言**它被调用过**。

这份文件单独一份（`vi.mock` 按文件提升），内容如下。它的四条用例**两两成对**：第 2 条守「`.txt` 不量」（否则「一律去量」也能过第 1 条），第 4 条守「`.txt` 照旧带字数」（否则「一律不带字数」也能过第 3 条）。第 3 条用 `toBe` 不用 `toContain` —— 带字数那版也满足 `toContain`，等于没测。

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import App from '../../src/renderer/src/App'
import { fillCharsFor } from '../../src/core/bossKey'
import { splitChapters } from '../../src/core/chapters'
import { defaultSettings } from '../../src/core/types'
import type { Novel } from '../../src/core/types'
import type { WtApi } from '../../src/renderer/src/types/global'

/**
 * 铺满那一路的**接线**判据：进老板模式那一下，到底有没有去量块高。
 *
 * 【为什么必须单开一个文件】`vi.mock` 是按文件提升的（工厂会被提到所有 import 之前），写在
 * `app.test.tsx` 里就等于把那个文件所有渲染 `App` 的用例的 `measureBlocks` 全换掉。
 *
 * 【为什么不能靠屏幕内容判】jsdom 里量不出高度（`offsetHeight` / `offsetTop` 恒为 0），
 * 于是**量到与量不到都会走 `revealTo(fillCharsFor(percent))`**——两条路在屏幕上完全同形。
 * 这正是 Task 11 最初那条用例空转的原因：它断言的是「屏幕不是空的」，而那件事在两种实现下
 * 都成立。唯一的判据是「`measureBlocks` 有没有被调用」。
 *
 * 【它守的东西有一个真机后果】按 `mdDoc`（= 当前显示的那一份）分岔时，按下 ⌘⇧B 那一刻
 * `bossActive` 还是 false、`mdDoc` 还是小说那一份的（txt → null），于是进老板模式永远走
 * 「按字符数铺」：屏幕底部切在半句话上，要再按一次 ⌘⇧↑/↓ 才对齐到块边界——计划末尾验收
 * 清单第 2 条看的就是这个。实测：把分岔改回 `mdDoc`，下面第一条当场红。
 */
const { measureBlocksSpy } = vi.hoisted(() => ({
  /**
   * 固定返回 `null`。**这不是「mock 掉布局」**：jsdom 里量不出高度就是真实行为
   * （`measureBlocks` 的判据是「所有块高都是 0 就返回 null」），这里借它当探针用。
   */
  measureBlocksSpy: vi.fn((): null => null)
}))

vi.mock('../../src/renderer/src/markdown/measure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/src/markdown/measure')>()
  // 【只换 measureBlocks】`BLOCK_END_ATTR` 必须留真的——渲染那一侧（`toReact.tsx`）在用它，
  // 换成假的会让块包装上读不到偏移，那就成了另一个 bug。
  return { ...actual, measureBlocks: measureBlocksSpy }
})

function makeNovel(): Novel {
  const text = '第一章 甲\nAAAAAAAAAA\n第二章 乙\nBBBBBBBBBB\n'
  const { flatText, chapters } = splitChapters(text, '测试书')
  return { title: '测试书', sourcePath: '/tmp/测试书.txt', encoding: 'UTF-8', hadBom: false, flatText, chapters }
}

/**
 * 工作文档。**正文长过 `CHARS_PER_SHEET`（1330）**：短于它的话「铺满 100%」会被
 * `revealTo` 夹到全文长度，`90%` 与 `100%` 铺出来一样多，下面那条 toast 判据就没意义了。
 */
function makeWorkDoc(sourcePath: string): Novel {
  const body = Array.from(
    { length: 60 },
    (_, i) => `${i + 1}. 本季度把导入管线与老板键做完了，细节见周报附件。`
  ).join('\n')
  const { flatText, chapters } = splitChapters(`# 季度汇报\n\n${body}\n`, '季度汇报')
  return { title: '季度汇报', sourcePath, encoding: 'UTF-8', hadBom: false, flatText, chapters }
}

let loadWorkDoc: Mock<(path: string) => Promise<Novel | null>>

/**
 * 装 `window.api`。**这里可以 spread 良性替身，与 `app.test.tsx` 的告诫相反**——那份文件
 * 是在**定义**一个替身（spread 会把「漏写一个方法」从响亮的 TypeError 变成静默的错误值），
 * 而这里只是在 `tests/setup.ts` 已经装好的良性替身上覆盖三个方法，其余照旧。
 *
 * 【为什么走「设置里配了路径 → 启动读进来」这条路】造的是真实场景：小说是 txt、工作文档
 * 是 md。工作文档经 `loadSettings().workDocPath` 交给启动流程读，与真机一致。
 */
function installApi(workDoc: Novel | null): void {
  loadWorkDoc = vi.fn(async (_path: string) => workDoc)
  ;(window as unknown as { api: WtApi }).api = {
    ...(window.api as WtApi),
    importNovel: async () => makeNovel(),
    loadSettings: async () => ({ ...defaultSettings(), workDocPath: workDoc?.sourcePath ?? null }),
    loadWorkDoc
  }
}

/** 走界面导入小说（真实功能都在设置对话框里），与 `app.test.tsx` 同一套交互 */
function importViaSettings(): void {
  fireEvent.click(screen.getByTestId('tab-文件'))
  fireEvent.click(screen.getByTestId('btn-settings'))
  fireEvent.click(screen.getByTestId('btn-import'))
  fireEvent.click(screen.getByTestId('settings-close'))
}

/** 按一次老板键（macOS 默认是 ⌘⇧B） */
function pressBossKey(): void {
  fireEvent.keyDown(window, { code: 'KeyB', key: 'B', metaKey: true, shiftKey: true })
}

/**
 * 等启动流程把工作文档读进来。
 *
 * 【为什么不能只等 `page-empty`】那个元素在 boot 的第二个 await（`loadWorkDoc`）之前就渲染
 * 出来了；紧接着按老板键会撞上「工作文档还没进内存」，用例收到的是一条 toast 而不是切换。
 */
async function waitForWorkDocLoaded(): Promise<void> {
  await waitFor(() => expect(loadWorkDoc).toHaveBeenCalled())
  await act(async () => {})
}

/** 等到真的进了老板模式（阅读区里是工作文档那一段渲染后的内容） */
async function enterBossMode(): Promise<void> {
  await act(async () => {
    pressBossKey()
  })
  await waitFor(() => expect(screen.getByTestId('page-text').textContent!.length).toBeGreaterThan(0))
}

beforeEach(() => {
  // 【每个用例都要清】不然「上一条调用过」会让下一条假绿——这个文件里第一条判据就是
  // 「有没有被调用」，而 spy 是模块级的、跨用例活着。
  measureBlocksSpy.mockClear()
})

describe('铺满的接线：进老板模式时去不去量块高', () => {
  it('进老板模式那一下真的去量了块高（按 ⌘⇧B 就会调 measureBlocks）', async () => {
    installApi(makeWorkDoc('/tmp/季度汇报.md'))
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await waitForWorkDocLoaded()

    // 前提自检：进老板模式之前一次都没量过——否则下面那句「被调用过」可能来自别处
    expect(measureBlocksSpy).not.toHaveBeenCalled()

    await enterBossMode()

    await waitFor(() => expect(measureBlocksSpy).toHaveBeenCalled())
  })

  it('.txt 工作文档不量：它没有结构可量，本来就是按字符数铺', async () => {
    installApi(makeWorkDoc('/tmp/季度汇报.txt'))
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await waitForWorkDocLoaded()

    await enterBossMode()
    // 【这一半是前一条的边界】少了它，「一律去量」也能让前一条通过——而 txt 那一路去量
    // 等于白渲染一份整篇的隐藏副本（还开着 `measuring`，每个按键重建一次）。
    expect(measureBlocksSpy).not.toHaveBeenCalled()
  })
})

describe('铺满的提示文案', () => {
  it('md 工作文档：toast 只报档位，不报那个兜底估算的字数', async () => {
    installApi(makeWorkDoc('/tmp/季度汇报.md'))
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await waitForWorkDocLoaded()
    await enterBossMode()

    await act(async () => {
      fireEvent.keyDown(window, { code: 'ArrowDown', key: 'ArrowDown', metaKey: true, shiftKey: true })
    })
    // 【判据是「不出现字数」，而不只是「出现了档位」】`toContain('铺满 90%')` 在带字数的
    // 那一版上也成立，等于没测。
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toBe('铺满 90%'))
  })

  it('.txt 工作文档：还是照旧带字数（那一路的字数是真的）', async () => {
    installApi(makeWorkDoc('/tmp/季度汇报.txt'))
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())
    await waitForWorkDocLoaded()
    await enterBossMode()

    await act(async () => {
      fireEvent.keyDown(window, { code: 'ArrowDown', key: 'ArrowDown', metaKey: true, shiftKey: true })
    })
    await waitFor(() =>
      expect(screen.getByTestId('toast').textContent).toBe(`铺满 90% ≈ ${fillCharsFor(90)} 字`)
    )
  })
})
```

**做完必须验**：把 `applyFill` 的分岔改回按 `shownNovel` 判（即回退「进老板模式也量」那个补丁）→ 这份文件里**只有第 1 条**应当红。

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

**这一节的三条判据在实施期间是「边做边跑」的**（每交付一个 Task 就回写一次），所以到真正收尾时：判据 1 已经是 **0**，判据 3 的四份 CSS 都已逐字节相等。剩下的活主要是**复核**，而不是一次性追平。

**判据 2（片段）在收尾时会报出 9 面失配，全部有据可查，`别为了让它变绿去删它们`：**

- 一半是**示意性片段**——单行 `import`、`/**` 起头的注释块、`describe(...)` 头，它们本来就只是「在这里加这些行」的说明，不是任何文件的完整片段；
- 另一半是**实施时被实测替换掉的用例**：Task 10 Step 5 那两条（原本是恒真的，已按报告里的口径拆成两条能真红的）与 Task 11 Step 1 那两条（原本够不到它们要守的那条路，已改到真能走到）。这两处的更正都写在各自 Task 节里。

**逐字节判据管的是整文件围栏**（判据 1），而本功能动过的每个文件——包括实施者新建的 `markdownParseFallback.test.ts` 与 `bossFillWiring.test.tsx`——都在五份计划里有逐字节相等的围栏。**片段判据的价值是「发现漂移」，不是「要求每一面都逐字命中」**；把示意性片段也逼成逐字相等，只会让人不敢写说明性片段。

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
9. **逐行逐项**（**2026-10-16 替换**，2026-10-15 那份计划修订掉了「结构预知」这条旧行为）：抽到表格第二行时，第三行还不该出现——它底下只留一段空白（没有网格线）；列表抽到第几项就只看到第几项。另外留意打字时**下面的内容会往下推一下**：这是设计 3.2 里写明的取舍，不是 bug。
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
