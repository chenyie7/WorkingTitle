import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Nodes, Root } from 'mdast'
import { isContiguous, linesOf } from './offsets'
import { setLineStarts, setValueStart, valueStartOf } from './nodeMeta'

/**
 * 工作文档的 md 解析：**全仓唯一 import remark 的地方**，也是唯一手上有源码的地方。
 *
 * 【只解析】裁剪与映射在别的模块；解析只做一次（调用方按文档缓存），后面几步每次渲染重跑。
 * 【`Root | null`】解析失败给 null，调用方退回纯文本（设计第 12 节：不许白屏）。
 * 【ESM-only】别把它挪出渲染层，`src/core` 的 tsconfig 没有 DOM 且 main 不该解析 remark。
 */
const processor = unified().use(remarkParse).use(remarkGfm)

export function parseMarkdown(text: string): Root | null {
  try {
    const tree = processor.parse(text)
    annotateOffsets(tree, text)
    return tree
  } catch (err) {
    console.warn('[wt] 解析 markdown 失败，退回纯文本：', err)
    return null
  }
}

/**
 * 这份工作文档要不要渲染。`.md.txt` 判 false 是有意的：`extname` 只看最后一段，用户的意图是 txt。
 * 按扩展名而不是内容嗅探——判错两个方向都是用户可见的坏结果，扩展名是他能自己改回来的。
 */
const MARKDOWN_EXT = /\.(md|markdown)$/i

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_EXT.test(filePath)
}

/**
 * 给代码类节点记下 `value` 的真实源码起点，并给多行节点挂逐行偏移表（设计 3.6 / 3.6.1）。
 * `position` 从定界符起算而 `value` 不含定界符；容器里 remark 还会逐行剥前缀，所以常量原点只对首行精确。
 */
function annotateOffsets(node: Nodes, source: string): void {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start !== undefined && end !== undefined) {
    if (node.type === 'code' || node.type === 'inlineCode') {
      setValueStart(node, contentStartOf(node.type, source, start, end, node.value))
    }
    if (node.type === 'text' || node.type === 'code' || node.type === 'inlineCode') {
      const base = node.type === 'text' ? start : (valueStartOf(node) ?? start)
      const starts = buildLineStarts(node.type, source, start, end, node.value)
      // 能由「起点 + 字符数」推出来的表是重复信息，不挂
      if (starts !== null && !isContiguous(starts, base, node.value)) {
        setLineStarts(node, starts)
      }
    }
  }
  if ('children' in node) {
    for (const child of node.children) annotateOffsets(child, source)
  }
}

/**
 * `value` 首字符在源码里的偏移。依据是「`value` 首行收在它那一源码行的行尾」：
 * 从行尾往回退首行长度，不必识别前缀长什么样。围栏块的「那一行」是围栏的下一行。
 */
function contentStartOf(
  kind: string,
  source: string,
  start: number,
  end: number,
  value: string
): number {
  if (kind === 'inlineCode') return inlineBounds(source, start, end, value).from
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
 * 行内代码的内容边界。CommonMark 会在内容两侧各剥一个空格，所以用 `value` 回验；
 * 对不上（跨行的行内代码）退回「跳过起首反引号」。
 */
function inlineBounds(
  source: string,
  start: number,
  end: number,
  value: string
): { from: number; to: number } {
  let from = start
  while (from < end && source[from] === '`') from++
  let to = end
  while (to > from && source[to - 1] === '`') to--
  const raw = source.slice(from, to)
  if (raw === value) return { from, to }
  if (
    raw.length >= 2 &&
    raw.startsWith(' ') &&
    raw.endsWith(' ') &&
    raw.trim() !== '' &&
    raw.slice(1, -1) === value
  ) {
    return { from: from + 1, to }
  }
  return { from, to }
}

/**
 * 逐行偏移表：每个 `value` 行的首字符在源码里的偏移。
 *
 * 用**回验**求值：在该行源码里找这行文字最后一次出现，并要求其后到行尾全是空白（remark 会剥行尾空白，
 * 所以「行尾 − 行长」会把被剥掉的字符也算进去）。回验失败退回「行尾 − 行长」——它恒不提前，
 * 代价是那一行首字晚若干按键；**晚是少显示，提前是多显示**。
 */
function buildLineStarts(
  kind: 'text' | 'code' | 'inlineCode',
  source: string,
  start: number,
  end: number,
  value: string
): number[] | null {
  if (value === '') return null
  const nodeEnd = kind === 'inlineCode' ? inlineBounds(source, start, end, value).to : end
  const nl = source.indexOf('\n', start)
  const firstLineEnd = nl >= 0 && nl < nodeEnd ? nl : nodeEnd
  const fenced = kind === 'code' && /^ {0,3}(`{3,}|~{3,})/.test(source.slice(start, firstLineEnd))
  let lineStart = fenced ? (firstLineEnd < nodeEnd ? firstLineEnd + 1 : firstLineEnd) : start
  const out: number[] = []
  for (const line of linesOf(value, null, start)) {
    const text = value.slice(line.base, line.base + line.len)
    const next = source.indexOf('\n', lineStart)
    const lineEnd = next >= 0 && next < nodeEnd ? next : nodeEnd
    const at = source.lastIndexOf(text, lineEnd)
    if (at >= lineStart && /^[ \t]*$/.test(source.slice(at + text.length, lineEnd))) out.push(at)
    else out.push(lineEnd - text.length)
    lineStart = lineEnd + 1
  }
  return out
}
