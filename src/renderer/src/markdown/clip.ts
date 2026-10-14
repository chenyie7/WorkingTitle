import type { Content, Root } from 'mdast'

/**
 * 按字符偏移裁剪语法树：树进、树出。**纯函数，没有副作用，不碰 DOM。**
 *
 * 【两条规则，合起来就是「结构预知」】
 *
 * 1. **顶层块的起始偏移 ≥ to 的整个丢掉**。光标还没走到的块，屏幕上一点都不该有
 *    ——这是「还没开始的块不存在」。
 * 2. **跨越 to 的文本被截断**。剩下的部分照常显示。
 *
 * 【「丢掉」只在顶层发生，往下一律只截断】这不是省事，是设计 3.2 钉死的口径：
 * **「块」= `root.children`（mdast 根节点的直接子节点）**，表格的行、列表的项都
 * **不是**块，而是块的内部结构——「一旦所在的块被保留，它们整体跟着保留」。
 *
 * 于是「已经开始、但没抽完」的块会**保留完整结构**：表格的表头一露头，整张网格
 * 就在树里了，只是后面几行的文字是空的；列表的第一项开始揭示时，后面几项也在，
 * 只是文字是空的。这正是设计 3.2 那条——看着像「正在填表」，
 * 代价是提前泄露「后面还有几行」这类结构信息，这是明确接受的。
 *
 * **把丢弃规则也用到块内部是错的**（本模块第一版就是这么写的）：那样表格只会画出
 * 已揭示的那几行，整张网格画不出来，上面那条口径当场失效。判据是设计 3.2 与
 * 计划末尾验收清单第 9 条，不是任何一条单测。
 *
 * 【为什么 from 也要判】它是折点（折叠前文）或 revealStart。折点是按块边界算的，
 * 但 `revealStart` 不是——`jumpToChapter` 抬起来的那个值可能落在块中间，所以两边
 * 都要能切。`from` 落在块中间时，块本身留着，块内 `from` 之前的那部分文字被截成空。
 *
 * 【哪些节点算「文本」】只有 `text` / `code` / `inlineCode` 三个带可裁的 `value`。
 * 其余的分两类：
 *   - 有 `children` 的（段落、列表、表格…）递归下去裁；
 *   - 没有 `children` 也没有可裁文本的（图片、分隔线、脚注引用、以及**内嵌 HTML**）
 *     只要「已经开始」就**整体出现**。HTML 归这一类是刻意的：标签不是文本，
 *     把它从中间切开只会得到一个不配对的标签。
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
    out.push(clipInside(node, from, to))
  }
  return out
}

/**
 * 已经开始揭示的块**内部**：结构一个都不丢，只有文本被截断到 [from, to) 这个窗口。
 * 窗口之外的文本变成空串，于是「还没抽到的行 / 项」是空骨架。
 */
function clipInside(node: ClipNode, from: number, to: number): ClipNode {
  /**
   * 【为什么要这层 cast】mdast 的节点是几十个 interface 的联合，`value` 与 `children`
   * 各自只在其中一部分上存在。逐类型窄化的写法在这里会变成几十行只做类型收窄、
   * 不做任何事的代码，所以退一步：按「有没有这两个字段」在运行期分派，
   * 类型上留一处显式断言。
   */
  const n = node as unknown as {
    type: string
    value?: string
    children?: ClipNode[]
    position?: { start: { offset?: number }; end: { offset?: number } }
  }
  const start = n.position?.start.offset
  if (VALUE_TYPES.has(n.type) && typeof n.value === 'string') {
    // 位置都没有就没法按偏移切，原样保留（宁可多显示，也不丢字）
    if (start === undefined) return node
    const head = Math.max(0, from - start)
    const tail = Math.max(head, to - start)
    return { ...n, value: n.value.slice(head, tail) } as unknown as ClipNode
  }
  if (Array.isArray(n.children)) {
    return { ...n, children: n.children.map((child) => clipInside(child, from, to)) } as unknown as ClipNode
  }
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
