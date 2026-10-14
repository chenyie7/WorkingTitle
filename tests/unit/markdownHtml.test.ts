import { describe, it, expect } from 'vitest'
import { tokenizeHtml } from '../../src/renderer/src/markdown/html'

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
