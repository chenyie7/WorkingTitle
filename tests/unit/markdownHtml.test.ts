import { describe, it, expect } from 'vitest'
import { tokenizeHtml } from '../../src/renderer/src/markdown/html'
import type { HtmlToken } from '../../src/renderer/src/markdown/html'

/** 把所有 text token 拼起来。断言「哪些字上了屏」比逐 token 对着写更贴核心不变量。 */
function textOf(tokens: HtmlToken[]): string {
  return tokens
    .filter((t) => t.kind === 'text')
    .map((t) => t.value)
    .join('')
}

describe('tokenizeHtml —— 白名单', () => {
  it('白名单标签切成 open / close', () => {
    expect(tokenizeHtml('<div>内容</div>')).toEqual([
      { kind: 'open', tag: 'div' },
      { kind: 'text', value: '内容' },
      { kind: 'close', tag: 'div' }
    ])
  })

  it('自闭合与空元素', () => {
    expect(tokenizeHtml('<br>')).toEqual([{ kind: 'void', tag: 'br' }])
    expect(tokenizeHtml('<hr/>')).toEqual([{ kind: 'void', tag: 'hr' }])
  })

  it('标签名大小写不敏感', () => {
    expect(tokenizeHtml('<B>x</B>')).toEqual([
      { kind: 'open', tag: 'b' },
      { kind: 'text', value: 'x' },
      { kind: 'close', tag: 'b' }
    ])
  })

  /**
   * 【这一组才是这个模块存在的理由】白名单之外的标签：标签本身丢掉，
   * **里面的文字照旧留下**（设计第 11 节的口径）。
   */
  it('白名单外的标签被丢掉，里面的文字留下', () => {
    expect(tokenizeHtml('<script>alert(1)</script>')).toEqual([
      { kind: 'text', value: 'alert(1)' }
    ])
    expect(tokenizeHtml('<iframe src="http://x"></iframe>')).toEqual([])
    expect(tokenizeHtml('<blink>闪</blink>')).toEqual([{ kind: 'text', value: '闪' }])
  })

  it('属性一律丢掉，包括 style / class / on*', () => {
    expect(tokenizeHtml('<div style="color:red" onclick="x()" class="a">t</div>')).toEqual([
      { kind: 'open', tag: 'div' },
      { kind: 'text', value: 't' },
      { kind: 'close', tag: 'div' }
    ])
  })

  it('带引号的属性里有 > 也不会把标签切断', () => {
    expect(tokenizeHtml('<div title="a>b">t</div>')).toEqual([
      { kind: 'open', tag: 'div' },
      { kind: 'text', value: 't' },
      { kind: 'close', tag: 'div' }
    ])
  })

  it('没有标签时就是一整段文字', () => {
    expect(tokenizeHtml('就是文字')).toEqual([{ kind: 'text', value: '就是文字' }])
  })

  it('空字符串什么也不产出', () => {
    expect(tokenizeHtml('')).toEqual([])
  })

  it('不配对的标签也照切（合不合成树是渲染那一层的事）', () => {
    expect(tokenizeHtml('<div>开')).toEqual([
      { kind: 'open', tag: 'div' },
      { kind: 'text', value: '开' }
    ])
  })

  /**
   * 【属性段必须按 HTML 规范的 ASCII 名字收窄】不是洁癖，是核心不变量：
   * 属性段一旦允许任意字符，「`<` 紧跟字母」到下一个 `>` 之间的东西就会被**当属性吃掉**，
   * 于是那段字上不了屏——正是「已揭示的字少上屏」。
   *
   * 下面两条喂的都是**真能从 markdown 走到这里**的输入：块级 HTML 整段是一个 html 节点、
   * 原样送进来（`<div>后面的话</div>` 那种），所以注释结束符那样的字面量、中文，
   * 都会跟着 `<` 一起到。
   */
  it('`<b */>` 不是标签：`*/` 一个字不丢，也不凭空多出一个 b', () => {
    const out = tokenizeHtml('<style>/* a<b */</style>')
    expect(textOf(out)).toContain('/* a<b */')
    expect(out).not.toContainEqual({ kind: 'open', tag: 'b' })
  })

  it('属性名不是 ASCII 名字时不按标签吃：`<b 且 c>` 整段落回文字', () => {
    // 块级 HTML `<div>\n如果 a<b 且 c>d\n</div>` 就是一个 html 节点，
    // 中文与尖括号一起原样进来——这条不是为了凑输入而构造的。
    const out = tokenizeHtml('<div>\n如果 a<b 且 c>d\n</div>')
    expect(textOf(out)).toContain('如果 a<b 且 c>d')
    expect(out).not.toContainEqual({ kind: 'open', tag: 'b' })
  })

  it('ASCII 属性名仍然算标签（`<b and c>` 按规范本来就是标签，别顺手改严）', () => {
    expect(tokenizeHtml('a <b and c> d')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'open', tag: 'b' },
      { kind: 'text', value: ' d' }
    ])
  })
})

/**
 * 【注释为什么单独一组】它既不是白名单标签、也不属于「标签丢掉、文字留下」那一类
 * ——注释里没有给人看的文字。整段丢掉是设计第 11 节的口径；不丢的话它**不是标签**
 * （标签匹配式够不着 `<!`），会原样成为屏幕上的字面文字。
 */
describe('tokenizeHtml —— HTML 注释', () => {
  it('整段丢掉，一个字都不上屏', () => {
    expect(tokenizeHtml('<!-- 这是注释 -->')).toEqual([])
    expect(tokenizeHtml('<!--多行\n注释\n-->')).toEqual([])
  })

  it('夹在文字与标签之间的注释：文字与标签照旧，注释消失', () => {
    expect(textOf(tokenizeHtml('前<!-- 注 -->后'))).toBe('前后')
    expect(tokenizeHtml('<div>a<!-- c -->b</div>')).toEqual([
      { kind: 'open', tag: 'div' },
      { kind: 'text', value: 'a' },
      { kind: 'text', value: 'b' },
      { kind: 'close', tag: 'div' }
    ])
  })

  it('注释里的标签不算标签', () => {
    // 注释内的 <script> 只是注释的一部分，不该被切成 token——更不该被执行
    expect(tokenizeHtml('<!-- <script>alert(1)</script> -->')).toEqual([])
    expect(tokenizeHtml('<!-- <div> -->')).toEqual([])
  })

  it('没有收尾的注释按 HTML 规范吃到末尾', () => {
    // 注释一直没关：`-->` 之后的一切都是注释，于是后面那个 <div> 也一起没了
    expect(tokenizeHtml('<!-- 没关')).toEqual([])
    expect(tokenizeHtml('<!-- 没关\n<div>内容</div>')).toEqual([])
    // 末尾恰好是个换行时也得吃干净：这一支写成 `[^\n]*` 就只吃掉第一行，
    // 剩下的 `\n`（以及再多行的正文）会落回 text 上屏 —— 这条钉的就是那件事
    expect(tokenizeHtml('<!-- 没关\n')).toEqual([])
    expect(textOf(tokenizeHtml('<!-- 没关\n第二行'))).toBe('')
  })

  it('`<!` 后面不是 `--` 的（doctype 之类）不是注释，也不该被吃掉', () => {
    // 这条钉的是「别把注释那条规则写宽」：`<!doctype html>` 现在按普通文字上屏，
    // 是有意留着的现状（设计第 11 节只处置注释），改动它要另开一条口径
    expect(textOf(tokenizeHtml('<!doctype html>'))).toBe('<!doctype html>')
  })
})

/**
 * 【第二组：白名单之外】对应设计文档第 11 节「安全边界」。
 *
 * 上面那一组测的是**切分对不对**，这一组测的是**挡没挡住**。这个模块的价值全在
 * 后者——所以这里逐条来，一条标签一条断言，别用一个样本代表一整类。
 */
describe('tokenizeHtml —— 白名单之外（安全边界）', () => {
  /** 拿不到门票的标签，逐个走一遍。含能执行脚本的与能取网络的。 */
  const NOT_ALLOWED = [
    'script',
    'iframe',
    'img',
    'svg',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'style',
    'link',
    'meta',
    'base',
    'template',
    'video',
    'audio',
    'canvas',
    'math',
    'a',
    'table'
  ]

  it('逐条：白名单外的标签整个丢掉，里面的文字按普通文字留下', () => {
    for (const tag of NOT_ALLOWED) {
      // 标签名一起塞进比较值：红的时候能一眼看出是哪个标签漏了，不用去数第几行
      expect([tag, tokenizeHtml(`<${tag}>t</${tag}>`)]).toEqual([tag, [{ kind: 'text', value: 't' }]])
      // 开标签、闭标签各自单独出现时也一个 token 都不产出
      expect([tag, tokenizeHtml(`<${tag}>`)]).toEqual([tag, []])
      expect([tag, tokenizeHtml(`</${tag}>`)]).toEqual([tag, []])
    }
  })

  it('事件属性带不出执行面：整条标签连同属性一起丢', () => {
    expect(tokenizeHtml('<img src=x onerror="alert(1)">')).toEqual([])
    expect(tokenizeHtml('<svg onload=alert(1)></svg>')).toEqual([])
    expect(tokenizeHtml('<a href="javascript:alert(1)">点</a>')).toEqual([{ kind: 'text', value: '点' }])
  })

  it('引号里的尖括号夹带不出一个标签', () => {
    // 属性值里的 `<script>` 只是属性值。匹配式先整段吃掉引号里的内容，
    // 所以它字面上长得像标签也不该被切出来。
    expect(tokenizeHtml('<div title="<script>">t</div>')).toEqual([
      { kind: 'open', tag: 'div' },
      { kind: 'text', value: 't' },
      { kind: 'close', tag: 'div' }
    ])
  })

  it('白名单里的标签逐个都在（设计文档第 11 节列的那 18 个）', () => {
    const ALLOWED_TAGS = [
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
      'mark'
    ]
    for (const tag of ALLOWED_TAGS) {
      expect([tag, tokenizeHtml(`<${tag}>`)]).toEqual([tag, [{ kind: 'open', tag }]])
    }
    expect(tokenizeHtml('<br>')).toEqual([{ kind: 'void', tag: 'br' }])
    expect(tokenizeHtml('<hr>')).toEqual([{ kind: 'void', tag: 'hr' }])
  })
})
