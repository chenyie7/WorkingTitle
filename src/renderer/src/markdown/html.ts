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
 * 标签的匹配式。三段属性用「先吃掉引号里的内容、再吃非 `>`」写，是为了让
 * `<div title="a>b">` 不被那个 `>` 切断——这是这类正则最常见的错法。
 */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g

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
    const tag = m[2].toLowerCase()
    if (!ALLOWED.has(tag)) continue
    if (m[1] === '/') out.push({ kind: 'close', tag })
    else if (m[4] === '/' || VOID.has(tag)) out.push({ kind: 'void', tag })
    else out.push({ kind: 'open', tag })
  }
  if (last < raw.length) out.push({ kind: 'text', value: raw.slice(last) })
  return out
}
