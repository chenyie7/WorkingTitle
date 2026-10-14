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
 * 标签的匹配式。三处都不能改松：
 *
 * 1. **属性段按 HTML 规范写**（ASCII 属性名 + 可选的值），不用「任何字符」那种宽松写法。
 *    宽松写法会把「`<` 紧跟字母」到下一个 `>` 之间的东西整个当属性吃掉，
 *    于是那段字**上不了屏**——比如块级 HTML `<div>\n如果 a<b 且 c>d\n</div>`
 *    （整段是一个 html 节点，会原样送到这里），` 且 c` 会被当成 `<b>` 的属性吞掉，
 *    还凭空多出一个 `open b`。按规范收紧后 `且` 不是合法属性名，`<b 且 c>` 整个
 *    匹配不上、整段落回 text 照常上屏。
 *    而 `<b and c>` 仍然匹配——按 HTML 规范**那本来就是标签**，不是缺陷。
 * 2. **属性值要能含 `>`**（引号里先整段吃掉），否则 `<div title="a>b">` 会被那个 `>`
 *    切断——这是这类正则最常见的错法。
 * 3. **注释排在最前面**（`<!-- … -->`，见下面那条 `if`）：注释不是标签，
 *    不先吃掉它，它就会整段落回 text 上屏（设计第 11 节要它消失）。
 *    第二条注释分支是没有收尾的那一种——按 HTML 规范吃到**输入末尾**，
 *    所以它写成 `[\s\S]*` 而不是 `[\s\S]*?$`：后者在「末尾恰好是个换行」时
 *    只吃到换行之前，会把那个换行留下变成一个字面换行。
 *    `<!` 后面**不是** `--` 的（doctype / CDATA 之类）不在这条规则的范围内。
 */
const TAG =
  /<!--[\s\S]*?-->|<!--[\s\S]*|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*)(\/?)>/g

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
    // 注释整段丢掉（设计第 11 节）：它是写给作者看的，不是内容。这里靠「匹配到的
    // 是什么」分叉，不看捕获组——注释那一支的 `m[1]` / `m[2]` 是 undefined。
    if (m[0].startsWith('<!--')) continue
    const tag = m[2].toLowerCase()
    if (!ALLOWED.has(tag)) continue
    if (m[1] === '/') out.push({ kind: 'close', tag })
    else if (m[4] === '/' || VOID.has(tag)) out.push({ kind: 'void', tag })
    else out.push({ kind: 'open', tag })
  }
  if (last < raw.length) out.push({ kind: 'text', value: raw.slice(last) })
  return out
}
