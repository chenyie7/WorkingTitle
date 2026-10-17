import type { Content, Root } from 'mdast'
import { sliceValueByLines } from './offsets'
import {
  copyMeta,
  lineStartsOf,
  setBlankCount,
  setLineStarts,
  setValueStart,
  valueStartOf
} from './nodeMeta'

/**
 * 按字符偏移裁剪语法树：树进、树出，**纯函数**。
 *
 * 【谁该显示只有本模块决定】上层只负责把拿到的树画出来。规则（设计 3.2）：
 * 1. 顶层块起始偏移 ≥ `to` 的整个丢掉；
 * 2. 块内的重复单元（表格行、列表项）各自按自己的区间判，没走到的整个丢掉；
 * 3. 跨越 `to` 的可裁文本截断；
 * 4. 块内其余叶子按自己的区间判，内嵌 HTML 是例外——要等整个抽完（`end <= to`），
 *    否则 `value` 里连文字一起被切成 `<di` 这种碎片。
 *
 * 【粒度只下到重复单元】表格按格判会出缺列的残行，行内按区间判会提前露出空 `<strong>`；
 * 行内记号必须比文字更早被结构预知（设计 3.4）。
 * 【保留还是丢掉只在本文件判】占位计数（`blankCountOf`）是这里算好挂上的，视图层只读数字。
 */
type ClipNode = Content

/** 带可裁文本的节点。加新类型之前先想清楚它算文本还是算结构。 */
type ValueNode = Extract<ClipNode, { type: 'text' | 'code' | 'inlineCode' }>

/** 「重复单元」：块内按自己的区间判的那两类节点（设计 3.2 修订）。 */
const REPEAT_UNITS = new Set<string>(['listItem', 'tableRow'])

export function clipTree(root: Root, from: number, to: number): Root {
  return { ...root, children: clipBlocks(root.children, from, to) }
}

/**
 * 顶层块：保留还是丢掉只在这一层判。`from` 侧也要判：折点可能落在块中间。
 * 没有偏移的节点原样保留，交给下游按「无文本」处理。
 */
function clipBlocks(nodes: readonly ClipNode[], from: number, to: number): Content[] {
  const out: Content[] = []
  for (const node of nodes) {
    const position = positionOf(node)
    if (position === null) {
      out.push(node)
      continue
    }
    if (position.start >= to) continue
    if (position.end <= from) continue
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

function clipInside(node: ClipNode, from: number, to: number): Content | null {
  const valueNode = valueNodeOf(node)
  if (valueNode) return clipValue(valueNode, from, to)
  if ('children' in node) {
    const children: Content[] = []
    for (const child of node.children) {
      if (REPEAT_UNITS.has(child.type) && !inWindow(child, from, to)) continue
      const kept = clipInside(child, from, to)
      if (kept) children.push(kept)
    }
    const kept = withChildren(node, children)
    copyMeta(node, kept)
    // 【表格的占位只数「起始偏移 ≥ to」】`children` 变少还有 `from` 侧（已经翻上去的行），
    // 那些行在光标上方、不在表格底下，用长度差会把它们算成空白。
    if (kept.type === 'table') {
      let notYet = 0
      for (const row of node.children) {
        const rowPos = positionOf(row)
        if (rowPos !== null && rowPos.start >= to) notYet++
      }
      setBlankCount(kept, 'rows', notYet)
    }
    return kept
  }
  const position = positionOf(node)
  if (position === null) return node
  if (position.start >= to) return null
  if (position.end <= from) return null
  // 【内嵌 HTML 等整个抽完】它没有可裁的 value，从中间切只会得到会被当普通文字上屏的碎片。
  if (node.type === 'html') return position.end <= to ? node : null
  return node
}

function clipValue(node: ValueNode, from: number, to: number): Content {
  // 【原点不是 position.start】`code` / `inlineCode` 的 value 不含定界符（设计 3.6）。
  const origin = valueStartOf(node) ?? node.position?.start.offset
  if (origin === undefined) return node
  const starts = lineStartsOf(node)
  let head: number
  let tail: number
  let revealed: number[] | null = null
  if (starts) {
    const window = sliceValueByLines(node.value, starts, from, to)
    head = window.head
    tail = window.tail
    revealed = window.starts.length > 0 ? window.starts : null
  } else {
    head = Math.max(0, from - origin)
    tail = Math.max(head, to - origin)
  }
  const value = node.value.slice(head, tail)
  // 【切完起点与表都要跟着挪】它们描述的是**当前**这个 value；不挪的话下游光标换算静默差几个字符。
  const kept = { ...node, value }
  copyMeta(node, kept)
  setValueStart(kept, revealed ? revealed[0] : origin + head)
  setLineStarts(kept, revealed)
  // 【代码块的占位行数】未揭示那一段里的换行个数。框里那半行已经占着当前行，不另算。
  if (node.type === 'code') {
    const rest = node.value.slice(tail)
    setBlankCount(kept, 'lines', rest === '' ? 0 : rest.split('\n').length - 1)
  }
  return kept
}

function valueNodeOf(node: ClipNode): ValueNode | null {
  if (node.type === 'text' || node.type === 'code' || node.type === 'inlineCode') return node
  return null
}

function withChildren<T extends ClipNode>(node: T, children: Content[]): T {
  return { ...node, children } as T
}

/** 取节点的字符区间；两端偏移缺一不可，缺了就当「没有偏移」。 */
function positionOf(node: ClipNode): { start: number; end: number } | null {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return start === undefined || end === undefined ? null : { start, end }
}
