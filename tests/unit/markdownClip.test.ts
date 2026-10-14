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
