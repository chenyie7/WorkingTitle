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
 *    （设计 8.2：只抓已经抽出来的那张），带文字的内嵌 HTML 会把没抽到的字直接画出来。
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
 * 剩下的叶子（图片、分隔线、脚注引用、硬换行，以及**内嵌 HTML**）整块留或整个丢。
 * HTML 归叶子是刻意的：它的 `value` 里可能整段带着文字（块级 HTML 就是一个整块），
 * 而标签一旦从中间切开只会得到不配对的碎片。
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
 * 字画到屏幕上（内嵌 HTML 的 `value` 里可能整段带着文字，见下面第三支）。两条都破契约。
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
