import type { Content, Root } from 'mdast'
import { valueStartOf, WT_VALUE_START } from './parse'

/**
 * 按字符偏移裁剪语法树：树进、树出。**纯函数，没有副作用，不碰 DOM。**
 *
 * 【四条规则，合起来就是「结构预知」】
 *
 * 1. **顶层块的起始偏移 ≥ to 的整个丢掉**。光标还没走到的块，屏幕上一点都不该有
 *    ——这是「还没开始的块不存在」。
 * 2. **块内的「重复单元」（表格的行、列表的项）也按它自己的区间判**。光标走到第几行 /
 *    第几项，那一行 / 那一项才画出来；没走到的整个丢掉。丢掉的行 / 项由渲染层按
 *    「默认一行高」留白，**不留任何结构**（设计 3.2，2026-10-15 修订）。
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
 */
export function readBlankCount(node: unknown, field: string): number {
  const raw = (node as Record<string, unknown> | null | undefined)?.[field]
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

export function clipTree(root: Root, from: number, to: number): Root {
  return { ...root, children: clipBlocks(root.children, from, to) as Root['children'] }
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
    // 缩进块根本没有定界符（差一段缩进），容器里的还会逐行变。设计 3.6 的残留那一段
    // 讲了哪些形态是精确的、哪些不是。
    const origin = valueStartOf(n) ?? start
    // 位置都没有就没法按偏移切，原样保留（宁可多显示，也不丢字）
    if (origin === undefined) return node
    const head = Math.max(0, from - origin)
    const tail = Math.max(head, to - origin)
    const value = n.value.slice(head, tail)
    // 【切完之后起点要跟着挪】`wtValueStart` 的语义是「**这个节点当前的** `value` 的第一个
    // 字符在源码里的偏移」。切掉了前 `head` 个字符，起点就后移 `head`——不挪的话这棵树上的
    // 节点会带着一个**失真**的起点，而下游（设计 3.5 的光标按「揭示偏移 − 内容起点」算位置）
    // 拿到它就是静默差几个字符，**不报错**。
    const shiftedStart = origin + head
    // 【代码块多挂一个占位行数】它的框只包住已揭示的行，没揭示的行由渲染层按「默认一行高」
    // 留白。`rest` 是没揭示的那一段，里面的**换行符个数**就是还没出现的新行数 ——
    // 当前这一行的余下部分不另算一行（它已经由框里那半行占着了）。
    if (n.type === 'code') {
      const rest = n.value.slice(tail)
      const blankLines = rest === '' ? 0 : rest.split('\n').length - 1
      return {
        ...n,
        value,
        [WT_VALUE_START]: shiftedStart,
        [WT_BLANK_LINES]: blankLines
      } as unknown as ClipNode
    }
    return { ...n, value, [WT_VALUE_START]: shiftedStart } as unknown as ClipNode
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
    // 【表格：丢掉了几行要报出去】渲染层拿它在表格底下留白。
    // 数的是**行数差**，不是被丢掉的那些行本身——判据与这里是不是表格无关，
    // 只有这个数字是表格专属的。（表格的子节点只可能是 `tableRow`，所以这个差就是行数。）
    if (n.type === 'table') {
      return {
        ...n,
        children,
        [WT_BLANK_ROWS]: n.children.length - children.length
      } as unknown as ClipNode
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
