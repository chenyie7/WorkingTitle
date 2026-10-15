import { createElement, Fragment, type CSSProperties, type ReactNode } from 'react'
import type { Root } from 'mdast'
import { tokenizeHtml, type HtmlToken } from './html'
import { MarkdownImage } from './MarkdownImage'
import { readBlankCount, WT_BLANK_LINES, WT_BLANK_ROWS } from './clip'
import { valueStartOf } from './parse'

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
 */
interface Caret {
  readonly at: number
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
  // 【一个都没命中就退回老位置】**实测**它走到的时候只有两类（真管线逐偏移扫过六份夹具
  // 共 102 个偏移位，判据是「光标是不是容器最后一个子节点」，且每个偏移位上都**恰好一个**
  // 光标、一个不漏）：
  //  1. 整篇还没开始揭示（`to = 0`）：每个顶层块都满足「起始偏移 ≥ to」而被 `clip` 丢掉，
  //     树是空的，一个节点都没有——本来也没有别的位置可放。
  //  2. 揭示偏移落在**所有已揭示文字的后面**：要么下一个块还没到它的起点，要么已经过了
  //     文档末尾那个换行。实测落点：表格 `to = 38–41`（表里最后的文字到 37 为止，而下一块
  //     `末段` 的起点是 41）与 `44`；代码块 `to = 10–14`；纯文字 `'甲乙丙\n'` 的 `to = 4`
  //     （那正是末尾那个换行）；硬换行 / 图片 / 行内 HTML 各自夹具体末尾那一格。这时内容
  //     本来也到头了，追加在末尾与插在中间看不出差别。
  //  **中间那段曾经也走这里，那不是兜底而是缺陷**：揭示偏移落在「整段节点都被丢掉、只剩
  //  占位代表它」的那一格时（表格 `to = 8–20` / `28–30`、代码块 `to = 1–3`），光标被甩到
  //  占位**后面**。已经由「占位自己接光标」修掉（见 `BlankSpace`）——**这条口径要保住：
  //  兜底不该在文档中间开火**。
  // 外面套一层 Fragment 只为挂 `key`——`CaretSpan` 没有 props，别给它传。
  if (caret && !caret.placed) out.push(<Fragment key="caret-fallback"><CaretSpan /></Fragment>)
  return out
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
      if (n.type === 'text' && ctx.caret && !ctx.caret.placed && originOf(n) + n.value.length >= ctx.caret.at) {
        caretHere = true
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
      const parts = splitAtCaret(node.value, originOf(node), ctx)
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
    case 'inlineCode': {
      const parts = splitAtCaret(node.value, originOf(node), ctx)
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
      const parts = splitAtCaret(node.value, originOf(node), ctx)
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
      return <tr>{renderAll(node.children, ctx)}</tr>
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
 * 【判据是**区间包含**】`起点 ≤ 揭示偏移 ≤ 起点 + 长度` 才接得住，与 `holdsCaret` 同一套。
 * 它同时管住两件事，少任何一边都不行：
 * - **空节点照样接得住**：列表项刚开始、文字还没出来时，那个空文本节点的起点 = 结束 =
 *   揭示偏移，区间退化成一点、仍然包含它，光标于是落在序号后面而不是掉到列表下面；
 * - **值节点不抢它前面的光标**：只判「结束偏移 ≥ 揭示偏移」的话，一个**起点在揭示偏移
 *   之后**的值节点也会命中（它的结束当然不小于揭示偏移），于是把本该落在它**前面**的光标
 *   吸进它里面。实测过这个形态：表格里那一串空单元格文字节点就是这么把光标接走的。
 *   `caretBefore` 靠 `holdsCaret` 让路，走的正是同一套判据。设计 3.5 是这条规则的正本。
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
    **表格于是多出一列**（复审实测宽 115→172、第二列 x 57→114）。

    这一格是本轮新引入的：旧判据在那些位置把光标放在第二个 `<th>` **里面**（合法），
    而区间判据让 `cell.start >= caret.at` 先开火、把它挪到了格外。下面那条「插在它
    前面」针对的是**叶子**（硬换行、图片、占位），不是容器。

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
