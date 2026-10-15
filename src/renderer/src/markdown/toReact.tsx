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
      // 【第三条判据：这一串里有没有**兜底目标**（`Caret.tail`）】这条路**只调
      // `renderTokens(tokens)`、从不 `renderNode`**，于是 `splitAtCaret` 不被调用、`tail`
      // 没人消费——光标一路落到 `renderMarkdown` 末尾那条兜底，落在**块外**。实测
      // `'> <b>x</b>甲一\n> 乙二\n\n末段\n'` 的 18、19 与 `'甲 <b>乙</b>\n\n末段\n'` 的 7、8、9
      // （设计 3.5 那条兜底的注释里记着它的成因不是「链尾是 html 叶子」——那几格
      // `tailTarget` 返回的是**文本节点**）。
      //
      // 【位置仍取串尾是对的】`tailTarget` 沿**最后一个孩子**往下走，所以 tail 落在一串里时
      // 它必然就是这一串的**最后一个节点**——「串尾」与「那个节点的末尾」是同一个 DOM 位置，
      // 不必再算下标。
      if (ctx.caret && !ctx.caret.placed) {
        const at = ctx.caret.at
        const nodeStart = n.position?.start.offset
        if (
          ctx.caret.tail === n ||
          caretIndexIn(n, at) !== null ||
          (nodeStart !== undefined && nodeStart >= at)
        ) {
          caretHere = true
        }
      }
      i++
    }
    if (!hasHtml) {
      // 没有 html 时每个节点各成一个 Fragment——这条路上光标能精确落进某一个文本节点
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
