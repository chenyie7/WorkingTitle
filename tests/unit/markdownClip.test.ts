import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'
import { clipTree } from '../../src/renderer/src/markdown/clip'
import type { Root } from 'mdast'

const DOC = [
  '# 季度汇报', //         这一段从第 0 字开始
  '',
  '本季度共归档 3 项。', //  第二段
  '',
  '- 归档流程上线',
  '- 复核环节压缩到 2 天'
].join('\n')

/** 把树里所有文本拼起来，用来断言「屏幕上会出现哪些字」。 */
function textOf(node: unknown): string {
  const n = node as { value?: string; children?: unknown[] }
  if (typeof n.value === 'string') return n.value
  return (n.children ?? []).map(textOf).join('')
}

function typesOf(tree: Root): string[] {
  return tree.children.map((n) => n.type)
}

/** 深度遍历，收集树里出现过的所有节点类型——用来断言某个结构节点到底在不在。 */
function typesDeep(node: unknown): string[] {
  const n = node as { type?: string; children?: unknown[] }
  return [n.type ?? '', ...(n.children ?? []).flatMap((c) => typesDeep(c))]
}

const doc = parseMarkdown(DOC)!

/** 取某个字符串在 DOC 里的起始下标——用例里要按真实偏移切，不能拍脑袋写数字。 */
function at(s: string): number {
  const i = DOC.indexOf(s)
  if (i < 0) throw new Error(`夹具里没有这段字：${s}`)
  return i
}

describe('clipTree —— 结构预知', () => {
  it('光标之后的顶层块整个丢掉（还没开始的块不存在）', () => {
    const cut = at('本季度')
    const out = clipTree(doc, 0, cut)
    expect(typesOf(out)).toEqual(['heading'])
  })

  it('已经开始、但只抽到一半的块：结构保留，没抽到的文字留空', () => {
    // 抽到「- 归档流」——列表这个块已经开始了
    const cut = at('归档流') + 3
    const out = clipTree(doc, 0, cut)
    // 三个块都在：标题、段落、列表（列表开始了）
    expect(typesOf(out)).toEqual(['heading', 'paragraph', 'list'])
    // 列表的第二项整个在光标之后 —— 它的文字是空的，但项本身还在（结构预知）
    const list = out.children[2] as unknown as { children: unknown[] }
    expect(list.children).toHaveLength(2)
    expect(textOf(list.children[0])).toBe('归档流')
    expect(textOf(list.children[1])).toBe('')
  })

  it('跨越光标的文本节点被截断，而不是整段出现或整段消失', () => {
    const cut = at('本季度共归档')
    const out = clipTree(doc, 0, cut + 3) // 「本季度」
    expect(textOf(out.children[1])).toBe('本季度')
  })

  it('整段在折点之前的块被丢掉（折叠前文）', () => {
    const from = at('本季度')
    const out = clipTree(doc, from, DOC.length)
    expect(typesOf(out)).toEqual(['paragraph', 'list'])
  })

  it('块内的行内结构：记号没抽到也不显示字，但结构节点在', () => {
    const src = '前**加粗**后\n'
    const t = parseMarkdown(src)!
    // 光标落在「加粗」的第一个字上：strong 节点已开始（** 在它之前）
    const out = clipTree(t, 0, src.indexOf('加粗'))
    expect(textOf(out.children[0])).toBe('前')
    // 【结构预知】这条用例的名字承诺了「结构节点在」，所以必须真的断言到结构——
    // 只断言文字的话，把 strong 整个丢掉这条照样绿（实测）。
    expect(typesDeep(out.children[0])).toContain('strong')
  })

  it('偏移之外的节点原样保留，不会把整棵树丢掉', () => {
    const out = clipTree(doc, 0, DOC.length)
    expect(typesOf(out)).toEqual(['heading', 'paragraph', 'list'])
    // 记号（`# ` 与 `- `）是由**结构**生成的，不在任何 text 节点里，所以按 text 节点
    // 拼出来天然不含它们。期望值要把行首记号去掉，不能拿 DOC 直接删换行。
    expect(textOf(out)).toBe(
      DOC.replace(/^(?:#|-)\s/gm, '').replace(/\n/g, '')
    )
  })

  it('光标在 0：整棵树是空的', () => {
    expect(clipTree(doc, 0, 0).children).toHaveLength(0)
  })
})

/**
 * 块内的**叶子**（没有 `value` 可裁、也没有 `children`）——图片、内嵌 HTML、
 * 脚注引用、硬换行。它们截不出「半个」，所以只能在「留整块」与「丢」之间二选一。
 *
 * 二选一的判据是**它自己的字符区间**（与顶层块同一条规则），不是「所在块已经开始」：
 * 留着没抽到的图片就等于提前去抓图（设计 8.2：只抓已经抽出来的那张），
 * 留着没抽到的 HTML 就等于把还没有揭示的字画到屏幕上。
 */
describe('clipTree —— 块内的叶子节点', () => {
  const IMG = '前 ![图](a.png) 后\n'

  it('还没抽到的图片不留在树里（留着就等于提前发 IPC 去抓图）', () => {
    const out = clipTree(parseMarkdown(IMG)!, 0, IMG.indexOf('前') + 1) // 只抽到「前」
    expect(textOf(out)).toBe('前')
    expect(typesDeep(out)).not.toContain('image')
  })

  it('光标落在图片源码中间：图片整张在树里（设计 8.3，一揭示就整张出现）', () => {
    // 这条与上一条一起把边界钉死：判据是图片**自己的起始偏移**，不是它的结束偏移
    // ——路径还没抽完时图就该跳出来，而它一旦开始就整张出现、不做半张。
    const out = clipTree(parseMarkdown(IMG)!, 0, IMG.indexOf('a.png'))
    expect(typesDeep(out)).toContain('image')
  })

  it('光标推过整张图之后：图片还在（上一条的反面对照）', () => {
    const out = clipTree(parseMarkdown(IMG)!, 0, IMG.length)
    expect(typesDeep(out)).toContain('image')
    expect(textOf(out)).toContain('后')
  })

  it('还没抽到的内嵌 HTML 标签同样不留在树里', () => {
    const src = '前文 <span>后面</span>\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('前文') + 2) // 只抽到「前文」
    expect(typesDeep(out)).not.toContain('html')
    expect(textOf(out)).toBe('前文')
  })

  it('折点已经翻过去的图片也丢掉（叶子看的是自己的区间，不是所在块开没开始）', () => {
    // from 落在块**中间**：`revealStart` 是 jumpToChapter 抬起来的，可以落在任何位置，
    // 所以「块留着、块里的图在窗口之外」是会发生的。留着它就等于给一张窗口外的图发
    // IPC 去抓（设计 8.2）。边界是 `end <= from`——这条用例正好卡在 end == from 上。
    const from = IMG.indexOf(' 后')
    const out = clipTree(parseMarkdown(IMG)!, from, IMG.length)
    expect(typesDeep(out)).not.toContain('image')
    expect(textOf(out)).toContain('后')
  })
})

/**
 * 内嵌 HTML 的 `value` 里**连文字一起**（块级 HTML 是一个整节点：`<div>后面的话</div>`
 * 是 0..15 的一个 html 节点）。所以它不能像图片那样「一揭示就整体出现」，两条路都堵着：
 *
 * - 从中间切开 → 得到 `<di` 这种碎片，`tokenizeHtml` 认不出它是标签、会当普通文字吐出来，
 *   等于把裸源码字符弄上屏；
 * - 不切、整块留着 → 未揭示的字跟着一起上屏。
 *
 * 于是只有第三条路：**等它整个抽完（`end <= to`）才出现**。图片、脚注引用、硬换行没有这个
 * 问题（它们没有文字，切不出半个也无所谓），仍然是一开始揭示就整体出现。
 */
describe('clipTree —— 内嵌 HTML 等抽完才出现', () => {
  const BLOCK = '<div>后面的话</div>\n'

  it('块级 HTML 抽到一半：不在树里，未揭示的字也不在', () => {
    const out = clipTree(parseMarkdown(BLOCK)!, 0, BLOCK.indexOf('后') + 1) // 刚过 `<div>后`
    expect(typesDeep(out)).not.toContain('html')
    expect(textOf(out)).not.toContain('面的话')
  })

  it('块级 HTML 抽完之后：在树里，value 是完整那串（反面对照）', () => {
    const out = clipTree(parseMarkdown(BLOCK)!, 0, BLOCK.length)
    expect(typesDeep(out)).toContain('html')
    expect(textOf(out)).toContain('<div>后面的话</div>')
  })

  it('行内 HTML 抽到一半（光标在标签中间）：不在树里', () => {
    // 【为什么单补这一条】上一条「还没抽到的内嵌 HTML 不留在树里」喂的是 to = 2，那时
    // html 节点**还没开始**，是叶子那条 `start >= to` 把它挡掉的——把 html 这条规则整个
    // 撤掉，那条用例照样绿。要真正压住 html 规则，光标必须落在**标签中间**（start < to
    // 而 end > to），也就是这一条。
    const src = '前文 <span>后面</span>\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('<span>') + 3) // 光标在 `<spa|n>` 里
    expect(typesDeep(out)).not.toContain('html')
    expect(textOf(out)).not.toContain('后面')
  })

  it('行内 HTML 刚好抽完：在树里（边界是 end <= to，取等）', () => {
    const src = '前文 <span>后面</span>\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('后面')) // `<span>` 的 end 正好是 9
    expect(textOf(out)).toContain('<span>')
    expect(textOf(out)).not.toContain('</span>') // 闭合标签还没抽到，不在
  })
})
