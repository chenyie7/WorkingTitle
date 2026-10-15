import { describe, it, expect } from 'vitest'
import { clipTree, readBlankCount, WT_BLANK_LINES, WT_BLANK_ROWS } from '../../src/renderer/src/markdown/clip'
import { parseMarkdown, valueStartOf } from '../../src/renderer/src/markdown/parse'
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

  it('块内的重复单元按自己的区间判：光标没走到的项不画', () => {
    // 抽到「归档流」——列表这个块已经开始了，但第二项还没开始
    const cut = at('归档流') + 3
    const out = clipTree(doc, 0, cut)
    // 三个块都在：标题、段落、列表（列表开始了）
    expect(typesOf(out)).toEqual(['heading', 'paragraph', 'list'])
    // 【2026-10-15 修订】第二项整个在光标之后 —— 它**不在树里**。
    // 旧口径是「项还在、只是文字空」，那正是真机上「块一露头全铺出来」的来源。
    const list = out.children[2] as unknown as { children: unknown[] }
    expect(list.children).toHaveLength(1)
    expect(textOf(list.children[0])).toBe('归档流')
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

/**
 * 代码类节点的坐标系（设计 3.6）。修之前这里的每一条都是错的——内容恒定领先光标
 * 一个定界符的长度，而**一条守它的用例都没有**（这是它能活下来的原因）。
 */
describe('clipTree —— 代码类节点的坐标系', () => {
  const FENCE = '```\n第一行\n第二行\n第三行\n```\n'

  it('光标还在围栏里：一个字都不显示（修之前第一行已经整行上屏）', () => {
    const out = clipTree(parseMarkdown(FENCE)!, 0, FENCE.indexOf('第一行')) // 走完围栏与换行
    expect((out.children[0] as unknown as { value: string }).value).toBe('')
  })

  it('光标走到第一行结尾：只显示到那里，不多一个字', () => {
    const out = clipTree(parseMarkdown(FENCE)!, 0, FENCE.indexOf('第一行') + 3)
    expect((out.children[0] as unknown as { value: string }).value).toBe('第一行')
  })

  it('光标走到第二行中间：第三行不在（修之前三行全在）', () => {
    const out = clipTree(parseMarkdown(FENCE)!, 0, FENCE.indexOf('第二行') + 1)
    expect((out.children[0] as unknown as { value: string }).value).toBe('第一行\n第')
  })

  it('带语言标注的围栏块同样对（那里的围栏长 6，偏差本来更大）', () => {
    const src = '```js\n甲\n```\n'
    expect(
      (clipTree(parseMarkdown(src)!, 0, src.indexOf('甲')).children[0] as unknown as { value: string }).value
    ).toBe('')
    expect(
      (clipTree(parseMarkdown(src)!, 0, src.indexOf('甲') + 1).children[0] as unknown as { value: string })
        .value
    ).toBe('甲')
  })

  it('行内代码：光标在起首反引号上时一个字都不显示', () => {
    const src = '前 `甲` 后\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('`') + 1)
    const para = out.children[0] as unknown as { children: { type: string; value?: string }[] }
    expect(para.children.find((c) => c.type === 'inlineCode')?.value).toBe('')
  })
})

/**
 * 块内的**重复单元**——表格的行、列表的项（设计 3.2，2026-10-15 修订）。
 *
 * 判据与顶层块、叶子是同一条：**按它自己的字符区间**。用例各守一面：
 * 没走到的丢掉、走到了就整体出现（表格整行含全部单元格）、打到了但文字没出来时
 * 结构在而文字空。
 */
describe('clipTree —— 块内的重复单元', () => {
  const LIST = '- 甲项\n- 乙项\n- 丙项\n'

  it('列表：光标只走到第二项，第三项整个不在树里', () => {
    const src = LIST
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('乙项') + 1)
    const list = out.children[0] as unknown as { children: unknown[] }
    expect(list.children).toHaveLength(2) // 甲、乙
    expect(textOf(list.children[1])).toBe('乙')
  })

  it('列表：打到了但文字还没出来 —— 项在、文字空（屏幕上先出一个项目符号）', () => {
    // 光标停在第二项的行首记号 `-` 上：项已开始，它的段落与文字都还在后面
    const src = LIST
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('- 乙项') + 1)
    const list = out.children[0] as unknown as { children: unknown[] }
    expect(list.children).toHaveLength(2)
    expect(textOf(list.children[1])).toBe('')
  })

  it('表格：整行一起出现，不会缺列', () => {
    // 光标只走到第一格的中间，第二格还没开始 —— 两格都必须画出来
    const src = '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('| 1 |') + 3)
    const table = out.children[0] as unknown as { children: unknown[] }
    const row = table.children[1] as unknown as { children: unknown[] }
    expect(row.children).toHaveLength(2)
    expect(textOf(row.children[1])).toBe('')
  })

  it('表格：光标只走到第二行，后面的行不在树里，剩余行数报得出来', () => {
    const src = '| 季度 | 收入 |\n| --- | --- |\n| Q1 | 120 |\n| Q2 | 240 |\n| Q3 | 360 |\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.indexOf('Q2') + 2)
    const table = out.children[0] as unknown as { children: unknown[] }
    // 表头 + Q1 + Q2 三行在（Q2 已开始、整行画出来），Q3 不在
    expect(table.children).toHaveLength(3)
    expect(readBlankCount(table, WT_BLANK_ROWS)).toBe(1)
  })

  it('全部揭示完之后：一行都不少，占位计数是 0', () => {
    const src = '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n'
    const out = clipTree(parseMarkdown(src)!, 0, src.length)
    const table = out.children[0] as unknown as { children: unknown[] }
    expect(table.children).toHaveLength(2)
    expect(readBlankCount(table, WT_BLANK_ROWS)).toBe(0)
  })

  it('折点切进表格中间：已经翻上去的行不算占位（它们在上方，不在表格底下）', () => {
    // 【为什么单补这一条】`children` 变少有**两个**来源：`to` 侧（还没走到，该留白）与
    // `from` 侧（已经翻过去了，**不该**留白）。按 `children.length` 的差去数会把两者混在
    // 一起——这条喂的 from 落在最后一行上，表头与前一行都被 from 挡掉，差是 2，于是表格
    // 底下凭空多两行空白，而**不报错**。判据要的是「起始偏移 ≥ to 的行数」，这里是 0。
    const src = '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n'
    const from = src.indexOf('| 3 |')
    const out = clipTree(parseMarkdown(src)!, from, src.length)
    const table = out.children[0] as unknown as { children: unknown[] }
    expect(readBlankCount(table, WT_BLANK_ROWS)).toBe(0)
  })
})

/**
 * 代码块的占位行数（设计 3.2 修订）。它的框只包住**已揭示的行**，没揭示的行由渲染层
 * 按「默认一行高」留白——留几行就是这里算的。
 *
 * 【数的口径】未揭示那一段里**换行符的个数**。当前这一行的余下部分不另算一行：它已经
 * 由框里那半行占着了。所以「光标停在同一行中间」时占位行数是 0，这是对的。
 */
describe('clipTree —— 代码块的占位行数', () => {
  const CODE = '```\n第一行\n第二行\n第三行\n```\n'

  it('只揭示到第一行中间：占位 2 行', () => {
    const out = clipTree(parseMarkdown(CODE)!, 0, CODE.indexOf('第一行') + 2)
    const code = out.children[0]
    expect((code as unknown as { value: string }).value).toBe('第一')
    expect(readBlankCount(code, WT_BLANK_LINES)).toBe(2)
  })

  it('光标正好压在第一行行尾：占位 2 行（那个换行还没揭示，它属于后一行）', () => {
    const out = clipTree(parseMarkdown(CODE)!, 0, CODE.indexOf('第一行') + 3)
    const code = out.children[0]
    expect((code as unknown as { value: string }).value).toBe('第一行')
    expect(readBlankCount(code, WT_BLANK_LINES)).toBe(2)
  })

  it('整个抽完：占位 0 行', () => {
    const out = clipTree(parseMarkdown(CODE)!, 0, CODE.length)
    expect(readBlankCount(out.children[0], WT_BLANK_LINES)).toBe(0)
  })
})

/**
 * 裁剪之后起点要跟着挪（Task 2 的质量评审量出来的）。
 *
 * `wtValueStart` 的语义是「**这个节点当前的** `value` 的第一个字符在源码里的偏移」。
 * 切片换了 `value` 却不挪它，这棵树上的节点就带着一个**失真**的起点——而下游
 * （设计 3.5 的光标按「揭示偏移 − 内容起点」算位置）拿到它**不报错**，只是光标
 * 差几个字符。修之前这条会红：它报的是原来那一段的起点。
 */
describe('clipTree —— 裁剪后起点跟着挪', () => {
  const SRC = '```\n第一行\n第二行\n```\n'

  it('从中间切进去：报的是自己那一段的起点', () => {
    const out = clipTree(parseMarkdown(SRC)!, SRC.indexOf('第一行') + 1, SRC.indexOf('第二行') + 1)
    const code = out.children[0]
    // 前面那个「第」被切掉了，剩下的是「一行」加换行再加「第」
    expect((code as unknown as { value: string }).value).toBe('一行\n第')
    // 起点必须是「一行」里那个「一」的位置，不是围栏之后那个「第」
    expect(valueStartOf(code)).toBe(SRC.indexOf('一行'))
  })

  it('一个字都没切掉时：起点没有变化（反面对照）', () => {
    const out = clipTree(parseMarkdown(SRC)!, 0, SRC.indexOf('第一行') + 3)
    expect(valueStartOf(out.children[0])).toBe(SRC.indexOf('第一行'))
  })
})

/**
 * 逐行切片（设计 3.6.1）：容器里的文字在窗口两侧都要按**行**求交，不能按字符数硬减。
 * 修之前这里的每一条都是错的，而且方向是**提前**——未揭示的字上屏。
 */
describe('clipTree —— 容器里的文字按行切', () => {
  const QUOTE = '> 引用甲\n> 引用乙\n'

  it('光标停在第一行结尾：第二行一个字都不显示', () => {
    const out = clipTree(parseMarkdown(QUOTE)!, 0, QUOTE.indexOf('引用甲') + 3)
    expect(textOf(out)).toBe('引用甲')
  })

  it('光标走到第二行中间：只显示到那里', () => {
    const out = clipTree(parseMarkdown(QUOTE)!, 0, QUOTE.indexOf('引用乙') + 1)
    expect(textOf(out)).toBe('引用甲\n引')
  })

  /**
   * 【换行符算谁的】两行之间那个 `\n` 在源码里位于「行 k 的源码结束偏移」处，所以它挂在
   * **行 k 名下**：`to` 越过它才显示。行 0 的内容到源码 5 为止、`\n` 就在 5，于是
   * `to = 5` 不含它、`to = 6` 含它。
   *
   * 【为什么单独钉一条】这条判据在**已经揭示的中间几行**上看不出来——那些行的 `tail` 会被
   * 后面某一行的 `tail` 覆盖掉，只有窗口正好收在「某行末尾那个 `\n`」上时才分得出。
   * 计划里那条变异（把 `+ 1` 去掉）在原来那三条用例上**一条都不红**，就是漏了这一格。
   */
  it('中间的换行符属于它上面那一行：越过它才显示', () => {
    expect(textOf(clipTree(parseMarkdown(QUOTE)!, 0, QUOTE.indexOf('\n')))).toBe('引用甲')
    expect(textOf(clipTree(parseMarkdown(QUOTE)!, 0, QUOTE.indexOf('\n') + 1))).toBe('引用甲\n')
  })

  it('折点切进第一行中间：窗口起点也按行算，前面的字不显示', () => {
    const out = clipTree(parseMarkdown(QUOTE)!, QUOTE.indexOf('用'), QUOTE.length)
    expect(textOf(out)).toBe('用甲\n引用乙')
  })
})
