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
  /** 阅读光标。`null` 表示不插（量高度那份副本用） */
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
  // 【一个都没命中就退回老位置】揭示偏移落在文档末尾的换行之后、或者整篇都还没开始揭示
  // 时会走到这里。那时内容本来也到头了，追加在末尾与插在中间看不出差别。
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
      out.push(<Fragment key={i}>{renderNode(node, ctx)}</Fragment>)
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
      for (let k = start; k < i; k++) out.push(<Fragment key={k}>{renderNode(nodes[k], ctx)}</Fragment>)
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
          <BlankSpace
            node={node}
            field={WT_BLANK_LINES}
            className="wt-md-pre-blank"
            cssVar="--wt-md-blank-lines"
          />
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
          <BlankSpace
            node={node}
            field={WT_BLANK_ROWS}
            className="wt-md-table-blank"
            cssVar="--wt-md-blank-rows"
          />
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
 * 【判据】**内容结束偏移 ≥ 揭示偏移**就算命中，而不是「起点 ≤ 揭示偏移 ≤ 结束」。
 * 前者让**空节点**也能接住光标——列表项刚开始、文字还没出来时，那个空文本节点正好
 * 命中，光标于是落在序号后面，而不是掉到列表下面。后者会漏掉这一格。设计 3.5 是
 * 这条规则的正本。
 *
 * 【为什么切的是**裁后**的 `value`】树上已经没有未揭示的字了，所以
 * 「内容结束偏移」= 内容起点 + 裁后的长度 = 光标该在的位置。
 */
function splitAtCaret(value: string, origin: number, ctx: Ctx): [string, string] | null {
  const caret = ctx.caret
  if (!caret || caret.placed) return null
  if (origin + value.length < caret.at) return null
  const at = Math.max(0, Math.min(caret.at - origin, value.length))
  // 【先置位再返回】置位是「整棵树只插一个」的闸，必须在返回前落下
  caret.placed = true
  return [value.slice(0, at), value.slice(at)]
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
 * 【为什么值要转成字符串】内联到 CSS 自定义属性上时，数字会不会被 React 补一个 `px`
 * 取决于版本行为；补了的话 `calc(2px * 20.8px)` 是无效值，高度会静默变成 0——占位
 * 凭空消失而且**不报错**。写成字符串就没有这一层不确定性。
 */
function BlankSpace({
  node,
  field,
  className,
  cssVar
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
}): ReactNode {
  const count = readBlankCount(node, field)
  if (count <= 0) return null
  return <div className={className} style={{ [cssVar]: String(count) } as CSSProperties} />
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
