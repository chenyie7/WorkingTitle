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
      // 【`null`（回验没找到）与「连续」走同一条退路】两种都不挂表，下游按「起点 + 字符数」
      // 切——回验没找到时那是 4b 之前的行为，宁可少精确一处，也不挂一张偏掉的表。
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
    if (at < lineStart || !/^[ \t]*$/.test(source.slice(at + line.length, lineEnd))) return null
    out.push(at)
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
