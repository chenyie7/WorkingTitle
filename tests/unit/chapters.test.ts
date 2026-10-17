import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHAPTER_PRESETS,
  chapterRuleEqual,
  chapterRuleProblem,
  hasChapterTitles,
  isChapterTitle,
  isVolumeTitle,
  resplitChapters,
  splitChapters,
  PREAMBLE_TITLE
} from '../../src/core/chapters'
import { DEFAULT_CHAPTER_RULE, type ChapterRule } from '../../src/core/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8')

/** 所有章节区间必须首尾相接、无缝、无重叠 */
function expectContiguous(flatText: string, chapters: ReturnType<typeof splitChapters>['chapters']): void {
  expect(chapters.length).toBeGreaterThan(0)
  expect(chapters[0].start).toBe(0)
  expect(chapters[chapters.length - 1].end).toBe(flatText.length)
  chapters.forEach((c, i) => {
    expect(c.index).toBe(i)
    expect(c.charCount).toBe(c.end - c.start)
    if (i > 0) expect(chapters[i - 1].end).toBe(c.start)
  })
}

/**
 * 长度上限相关的两条样本，提到 describe 外面是为了让「前提自检」用例引用【同一个常量】——
 * 样本被改小时自检立刻变红，而不是让用例悄悄退化成在测别的东西。
 */
/** 超长样本：原始 70 字，远超上限（无补白，trim 不改变它） */
const OVER_CAP_TITLE = 'Chapter 3 ' + 'x'.repeat(60)
/** 补白样本：原始 45 字超限，但 trim 后只有 5 字——上限量的是 trim 后的串，故它是合法标题 */
const PADDED_TITLE = '　'.repeat(20) + '第一章 风起' + '　'.repeat(20)

describe('isChapterTitle', () => {
  it.each([
    '第一章 风起',
    '第 12 章',
    '第十二章',
    '第3节 起手',
    '第一百零八回',
    '序章',
    '楔子 雪夜',
    '番外一',
    'Chapter 3 The Beginning',
    '1、开端',
    '12．转折',
    // 副标题里的句读不拦：强前缀（第 X 章 / 序章 / Chapter N）已经把「这是标题」说清楚了。
    // 句读闸门只服务于「数字 + 顿号」那条，见下面「不把正文当标题」里的编号正文样本。
    '第一章 风起，云涌',
    '序章 雪夜，风起',
    'Chapter 3 The Beginning, and More',
    // 前后各垫 20 个全角空格：上限量的是 trim 后的串，补白不该影响判定
    PADDED_TITLE
  ])('识别标题行：%s', (line) => {
    expect(isChapterTitle(line)).toBe(true)
  })

  it.each([
    '第三章的内容很有意思，我读了三遍。',
    '前言不搭后语',
    '林昭站在城墙上。',
    // 下面两条是【只】被 SENTENCE_PUNCT 那道闸拦下的样本：它们匹配 NUMBERED_TITLE
    // （数字 + 、/.． + 正文），长度也在上限内。删掉那道闸，这两条会红——一行普通的编号正文
    // 就会变成章节标题。上面三条其实都被【模式不匹配】拒掉，等于同一个分支测了三遍。
    '1．他说道，这是第一章。',
    '1、开端，转折',
    ''
  ])('不把正文当标题：%s', (line) => {
    expect(isChapterTitle(line)).toBe(false)
  })

  // 【前提自检】长度上限相关的样本必须真的如用例名所说。
  // Task 3 期间有一条样本（37 字）名字声称测上限，实际根本没超过 40 字、是被模式不匹配拒掉的
  // ——用例名在说谎，整个 Task 3 都没人发现。把前提写成断言，样本被改小就会立刻红。
  it('前提自检：长度上限相关的样本确实如用例名所说', () => {
    // 40 是 chapters.ts 里 MAX_TITLE_LEN 的值（模块私有、未导出）。这里写死是有意的：
    // 上限一旦被改，本用例会红，逼人重新核对「超长」「补白」这两条样本还成不成立。
    expect(OVER_CAP_TITLE.length).toBeGreaterThan(40)
    expect(isChapterTitle(OVER_CAP_TITLE)).toBe(false) // 超长 → 被上限拒掉
    expect(PADDED_TITLE.length).toBeGreaterThan(40) // 原始长度确实超限
    expect(PADDED_TITLE.trim().length).toBeLessThanOrEqual(40) // trim 后不超 → 合法标题
  })
})

describe('splitChapters', () => {
  it('无标题时退化为单章节，flatText 等于原文', () => {
    const text = fixture('sample-nochapters.txt')
    const { flatText, chapters } = splitChapters(text, '我的小说')
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('我的小说')
    expect(flatText).toBe(text)
    expectContiguous(flatText, chapters)
  })

  it('按 第X章 切出三章，且区间连续无缝', () => {
    const text = fixture('sample-utf8.txt')
    const { flatText, chapters } = splitChapters(text, 'sample-utf8')
    expect(chapters).toHaveLength(3)
    expect(chapters[0].title).toBe('第一章 风起')
    expect(chapters[1].title).toBe('第二章 云涌')
    expect(chapters[2].title).toBe('第三章 雷动')
    expectContiguous(flatText, chapters)
    // 这条是【唯一落在真实 fixture 上的保真断言】——重点在「真实 fixture」，不在「唯一」。
    // 「相邻标题之间无正文」那条用内联字符串断言了同一条律的同一支，两者被同一个变异一起
    // 打红；此前把「唯一」写在句子头部是不准确的。真正缺的是「拿读进来的真文件来比」这件事：
    // sample-utf8.txt 走的正是三章拼接，而 94 字的它此前从未与源文件比较过。
    // expectContiguous 只校验 (flatText, chapters) 这一对【自洽】：区间连续、下标、charCount。
    // 它对 flatText 是否等于源文件一言不发——去掉拼接时的章间 \n，它照样全绿（实测）。
    // 上面「无标题 → 单章节」那条虽然也断言了 flatText === text，但走的是提前返回分支
    // （titleIdx 为空直接 return { flatText: text }），那个断言恒真，碰不到拼接逻辑。
    // 而这条用例走的是三章拼接：只有 flatText 与源文件逐字相等，Task 4 那些指向 flatText
    // 的 cursor/revealStart/chapterPos 偏移，才对得上用户真正导入的那个文件。
    // 【保真律】完整表述见「标题前只有空白时…」那条：flatText 是 text 的后缀，被去掉的前缀全是空白。
    // 本用例是「前缀为空」的那一支（什么都没丢）→ flatText === text。
    expect(flatText).toBe(text)
  })

  it('副标题带标点时仍按标题切开（句读闸门只作用于数字 + 顿号那条）', () => {
    const text = '第一章 风起，云涌\n正文一。\n第二章 云涌；雷动\n正文二。\n'
    const { flatText, chapters } = splitChapters(text, 'x')
    expect(chapters.map((c) => c.title)).toEqual(['第一章 风起，云涌', '第二章 云涌；雷动'])
    expect(flatText).toBe(text)
    expectContiguous(flatText, chapters)
  })

  it('章节正文包含标题行本身', () => {
    const text = fixture('sample-utf8.txt')
    const { flatText, chapters } = splitChapters(text, 'x')
    expect(flatText.slice(chapters[0].start, chapters[0].end).startsWith('第一章 风起')).toBe(true)
    expect(flatText.slice(chapters[2].start, chapters[2].end)).toContain('第三章只有这一行。')
  })

  it('标题之前的内容归入「前言」伪章节', () => {
    const text = '版权声明\n作者：某人\n\n第一章 风起\n正文一。\n'
    const { flatText, chapters } = splitChapters(text, 'x')
    // 「前言」是设计文档 §7 定死的字面量，而且【用户可见】——侧栏直接把它显示出来。
    // 下面那条 toBe(PREAMBLE_TITLE) 是拿常量比自己，挡不住常量本身被改，所以在这里钉住字面量。
    // 与 decode.test.ts 里 expect(r.encoding).toBe('UTF-8') 同一用意。
    expect(PREAMBLE_TITLE).toBe('前言')
    expect(chapters[0].title).toBe(PREAMBLE_TITLE)
    expect(chapters[0].start).toBe(0)
    expect(flatText.slice(chapters[0].start, chapters[0].end)).toContain('版权声明')
    expect(chapters[1].title).toBe('第一章 风起')
    // 【保真律】前言被保留时前缀为空 → flatText === text。
    // 这一支此前没人守：把前言切片的 to 写成 titleIdx[0] - 1（一个"看起来更对称"的改动）
    // 会从 flatText 里悄悄吃掉一个 \n，而本用例其余断言连同 expectContiguous 在那之下全都
    // 自洽——它们校验的是 (flatText, chapters) 内部一致，与源文件无关。
    expect(flatText).toBe(text)
    expectContiguous(flatText, chapters)
  })

  it('全角空格缩进的标题行：能识别，且 Chapter.title 是 trim 后的（不含缩进）', () => {
    const indented = '　　第一章 风起　' // 首尾各一个 U+3000——中文 txt 小说的常见排版
    // 自检前提：两端确实各有一个全角空格，否则本用例会悄悄退化成一条普通标题用例
    expect(indented.startsWith('　')).toBe(true)
    expect(indented.endsWith('　')).toBe(true)
    expect(isChapterTitle(indented)).toBe(true)
    const { flatText, chapters } = splitChapters(indented + '\n正文。\n', 'x')
    // trim 掉缩进才是重点：Task 9 会把 title 原样渲染到侧栏，Task 5 会原样持久化。
    // 留着缩进的话，侧栏每条标题都多一段看不见的空白，看起来像排版风格而不像 bug。
    expect(chapters[0].title).toBe('第一章 风起')
    // 而 flatText 必须保留原文那份缩进——"标题要整洁"与"正文要逐字保真"是两件事，
    // 不能顺手一起处理掉。
    expect(flatText).toBe(indented + '\n正文。\n')
  })

  it('标题前只有空白时不产生前言章节', () => {
    const text = '\n\n第一章 风起\n正文。\n'
    const { flatText, chapters } = splitChapters(text, 'x')
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('第一章 风起')
    // 【保真律】flatText 是 text 的一个【后缀】，且被去掉的那段前缀【全是空白】。
    // 这是无检测器的完整表述——不需要先判断"丢没丢东西"，三种情形一并覆盖：
    //   · 什么都没丢（无前言 / 前言非空白 / 压根没有标题）→ 前缀是空串，flatText === text
    //   · 丢掉了一段全空白前言 → 前缀就是那段空白，flatText === text.slice(off)
    //   · 保留了非空白前言 → 前缀是空串
    // 此前只写了两条具名分支（"没丢" / "丢了空白前言"），漏了"保留了非空白前言"那一支：
    // 它既不经过提前返回、也不经过过滤器，正需要一个能覆盖它的表述。
    // 该律经 40000 例随机文本实测无例外，其中保留非空白前言的有 5778 例，全部成立。
    // 本用例属于前缀非空的那一支：flatText === text.slice(off)。
    // 之所以必须分成多条断言、不能统一写 flatText === text：丢掉一段空白前言是【合法】行为，
    // 此时 flatText 本来就不等于原文——保真的缺口在 Task 3 之前一直没人发现，正是这个原因。
    // off 的定义：第一个标题行首字符在原文中的下标
    //   = 它【前面每一行的长度】之和 + 每行一个 \n（原文按 \n 拆行，行间各有一个分隔符）。
    // 本例前两行都是空字符串（长度 0），各贡献 1 个 \n，故 off = 0 + 1 + 0 + 1 = 2。
    // 用 indexOf 而不是写死 2：让「off = 第一个标题行的起点」以定义的形式出现。
    // 但 indexOf 本身并不证明这个定义成立——钉住它的是下面两条断言：toBe(2) 钉住取值，
    // 与 flatText 的相等断言钉住语义。两者都在，这个定义才算被证明。
    const off = text.indexOf('第一章 风起')
    expect(off).toBe(2)
    expect(flatText).toBe(text.slice(off))
  })

  it('相邻标题之间无正文：区间仍连续，且两个标题都不被丢弃（flatText === 原文）', () => {
    // 【本用例不覆盖 kept 过滤器】原名字里的「空章节被丢弃」描述的是一个【不可达】的情况。
    // 每个章节切片都从它自己的标题行开始，而标题行 trim() 后必非空，所以真章节永远不可能为空；
    // 那个过滤器唯一能丢掉的只有「全空白的前言」，由「标题前只有空白时不产生前言章节」覆盖。
    // 两条用例职责不同：删过滤器只应让【那条前言用例】变红，本用例不该红（下面两个标题都不是空章）。
    // 因此改过滤器时请去改那条前言用例，**别把本用例当作它的守卫，也别以为删了它过滤器还有覆盖**。
    const text = '第一章 甲\n\n第二章 乙\n正文乙。\n'
    const { flatText, chapters } = splitChapters(text, 'x')
    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe('第一章 甲')
    // 非末章的区间末尾会带一个 \n 作为章间分隔（见 splitChapters 的拼接逻辑），
    // 所以这里 trim 后比较标题内容，而不是期望切片严格等于标题。
    // 注意：正是这个 \n 让 flatText 与原文逐字相等，见下面那条断言。
    expect(flatText.slice(chapters[0].start, chapters[0].end).trim()).toBe('第一章 甲')
    // 本章没有章节被丢弃（两个标题都不是空章），所以 flatText 必须与原文逐字相等。
    expect(flatText).toBe(text)
    expectContiguous(flatText, chapters)
  })

  it('空字符串不抛异常，产生一个 0 字章节', () => {
    const { flatText, chapters } = splitChapters('', 'x')
    expect(flatText).toBe('')
    expect(chapters).toHaveLength(1)
    expect(chapters[0].charCount).toBe(0)
  })

  it('大量章节时区间依然连续', () => {
    const text = Array.from({ length: 300 }, (_, i) => `第${i + 1}章 标题\n第${i + 1}章正文。`).join('\n')
    const { flatText, chapters } = splitChapters(text, 'x')
    expect(chapters).toHaveLength(300)
    expectContiguous(flatText, chapters)
    // 加这条不是为了让规模更大，而是为了让本用例有牙：expectContiguous 只查结构，
    // 一个内部自洽但内容被改错的 flatText 能让它全绿。300 章约 9 KB，比真实输入小三个
    // 数量级，所以它是【结构冒烟测试】而非规模测试——给它牙齿靠的是这条保真断言，
    // 而不是把样本加大。
    expect(flatText).toBe(text)
  })
})

describe('isVolumeTitle', () => {
  it.each(['第一卷 起势', '第1卷', '卷一 起势', '上 部 楔子', '第三部 起势', '第 12 篇'])(
    '卷级标题：%s',
    (title) => {
      expect(isVolumeTitle(title)).toBe(true)
    }
  )

  it.each(['第1章 开端', '第一章初入江湖', '前言', '序章', '正文', '上部人员名单', '卷'])(
    '不是卷级标题：%s',
    (title) => {
      expect(isVolumeTitle(title)).toBe(false)
    }
  )
})

describe('自动识别的规则选择', () => {
  it.each([
    {
      name: '副标题直接黏着写',
      text: '第一章初入江湖\n正文。\n第二章再入江湖\n正文。\n',
      titles: ['第一章初入江湖', '第二章再入江湖']
    },
    {
      name: '副标题用冒号',
      text: '第一章：初入江湖\n正文。\n第二章：再入江湖\n正文。\n',
      titles: ['第一章：初入江湖', '第二章：再入江湖']
    },
    {
      name: '卷X',
      text: '卷一 风起\n正文。\n卷二 云涌\n正文。\n',
      titles: ['卷一 风起', '卷二 云涌']
    },
    {
      name: '章X / 卷X 在前',
      text: '章1 甲\n正文。\n章2 乙\n正文。\n',
      titles: ['章1 甲', '章2 乙']
    },
    {
      name: '上/中/下 部',
      text: '上 部 一\n正文。\n中 部 二\n正文。\n下 部 三\n正文。\n',
      titles: ['上 部 一', '中 部 二', '下 部 三']
    }
  ])('$name 也能切出来', ({ text, titles }) => {
    const { flatText, chapters } = splitChapters(text, 'x')
    expect(chapters.map((c) => c.title)).toEqual(titles)
    expect(flatText).toBe(text)
  })

  it('混用写法时只选命中最多的一条，不把规则取并集', () => {
    const text = '序章\n正文。\n第一章 甲\n正文一。\n第二章 乙\n正文二。\n'
    // 第X章 命中 2 次、序章 1 次 → 选第X章；若取并集，第一章会是「序章」
    expect(splitChapters(text, 'x').chapters.map((c) => c.title)).toEqual([
      '前言',
      '第一章 甲',
      '第二章 乙'
    ])
  })

  it('只有装饰符号的行不算章节', () => {
    const text = '※　　　※\n正文一。\n※　　　※\n正文二。\n'
    expect(splitChapters(text, 'x').chapters).toHaveLength(1)
  })
})

describe('可配置的分章规则', () => {
  it('cn-chapter 只认中文章节标题', () => {
    const rule = { kind: 'preset', id: 'cn-chapter' } as const
    expect(isChapterTitle('第一百零八回 聚义', rule)).toBe(true)
    expect(isChapterTitle('第3节 起手', rule)).toBe(true)
    expect(isChapterTitle('序章', rule)).toBe(false)
    expect(isChapterTitle('Chapter 3 The Beginning', rule)).toBe(false)
    expect(isChapterTitle('1、开端', rule)).toBe(false)
  })

  it('numbered 只认数字序号，句读闸门仍在', () => {
    const rule = { kind: 'preset', id: 'numbered' } as const
    expect(isChapterTitle('1、开端', rule)).toBe(true)
    expect(isChapterTitle('12．转折', rule)).toBe(true)
    expect(isChapterTitle('1、开端，转折', rule)).toBe(false)
    expect(isChapterTitle('第一章 风起', rule)).toBe(false)
  })

  it('chapter-en 只认英文 Chapter N，不区分大小写', () => {
    const rule = { kind: 'preset', id: 'chapter-en' } as const
    expect(isChapterTitle('chapter 3 the beginning', rule)).toBe(true)
    expect(isChapterTitle('Chapter 3 The Beginning', rule)).toBe(true)
    expect(isChapterTitle('第一章 风起', rule)).toBe(false)
  })

  it('special 认特殊符号与单独一行的关键词', () => {
    const rule = { kind: 'preset', id: 'special' } as const
    expect(isChapterTitle('☆、晋江标题', rule)).toBe(true)
    expect(isChapterTitle('【第一章】', rule)).toBe(true)
    expect(isChapterTitle('简介', rule)).toBe(true)
    expect(isChapterTitle('前言不搭后语', rule)).toBe(false)
    expect(isChapterTitle('正文完', rule)).toBe(false)
  })

  it.each([
    '☆、开端', '★ 开端', '✦ 开端', '✧ 开端', '※ 开端',
    '简介', '内容简介', '文章简介', '文案', '前言', '序章',
    '楔子', '正文', '终章', '尾声', '后记', '番外', '【第一章】'
  ])('special 认得 %s', (line) => {
    expect(isChapterTitle(line, { kind: 'preset', id: 'special' })).toBe(true)
  })

  it('自定义正则按 trim 后的整行匹配，且不区分大小写', () => {
    const rule = { kind: 'custom', pattern: '^chapter\\s+\\d+.*$' } as const
    expect(isChapterTitle('  CHAPTER 3 The Beginning  ', rule)).toBe(true)
    expect(isChapterTitle('正文里提到 chapter 3 不算', rule)).toBe(false)
  })

  it('自定义正则不受 40 字上限约束', () => {
    const rule = { kind: 'custom', pattern: '^.+$' } as const
    const long = '字'.repeat(80)
    expect(isChapterTitle(long, rule)).toBe(true)
    expect(isChapterTitle(long, DEFAULT_CHAPTER_RULE)).toBe(false)
  })

  it('自定义正则也不把空行 / 纯空白行当标题', () => {
    expect(isChapterTitle('', { kind: 'custom', pattern: '^$' })).toBe(false)
    expect(isChapterTitle('   ', { kind: 'custom', pattern: '^.*$' })).toBe(false)
  })

  it('chapterRuleProblem 逐项校验', () => {
    expect(chapterRuleProblem({ kind: 'auto' })).toBeNull()
    expect(chapterRuleProblem({ kind: 'preset', id: 'numbered' })).toBeNull()
    expect(chapterRuleProblem({ kind: 'preset', id: 'nope' })).toContain('id')
    expect(chapterRuleProblem({ kind: 'custom', pattern: '^第.+章$' })).toBeNull()
    expect(chapterRuleProblem({ kind: 'custom', pattern: '(' })).toContain('正则')
    expect(chapterRuleProblem({ kind: 'custom', pattern: '' })).toContain('pattern')
    expect(chapterRuleProblem({ kind: 'custom', pattern: '   ' })).toContain('pattern')
    expect(chapterRuleProblem({ kind: 'nope' })).toContain('kind')
    expect(chapterRuleProblem(null)).toContain('不是对象')
    // 原型链上的名字不能当 preset id
    expect(chapterRuleProblem({ kind: 'preset', id: 'toString' })).toContain('id')
  })

  it('chapterRuleEqual 只认完全相同的规则', () => {
    expect(chapterRuleEqual({ kind: 'auto' }, { kind: 'auto' })).toBe(true)
    expect(
      chapterRuleEqual({ kind: 'preset', id: 'numbered' }, { kind: 'preset', id: 'numbered' })
    ).toBe(true)
    expect(
      chapterRuleEqual({ kind: 'preset', id: 'numbered' }, { kind: 'preset', id: 'special' })
    ).toBe(false)
    expect(chapterRuleEqual({ kind: 'custom', pattern: '^a' }, { kind: 'custom', pattern: '^a' })).toBe(true)
    expect(chapterRuleEqual({ kind: 'custom', pattern: '^a' }, { kind: 'custom', pattern: '^b' })).toBe(false)
    expect(chapterRuleEqual({ kind: 'auto' }, { kind: 'custom', pattern: '^a' })).toBe(false)
  })

  it('chapterRuleEqual 把 undefined 归一成 auto', () => {
    expect(chapterRuleEqual(undefined, { kind: 'auto' })).toBe(true)
    expect(chapterRuleEqual({ kind: 'auto' }, undefined)).toBe(true)
    expect(chapterRuleEqual(undefined, { kind: 'preset', id: 'numbered' })).toBe(false)
  })

  it('CHAPTER_PRESETS 覆盖四个 id 且文案非空', () => {
    expect(Object.keys(CHAPTER_PRESETS).sort()).toEqual([
      'chapter-en',
      'cn-chapter',
      'numbered',
      'special'
    ])
    for (const label of Object.values(CHAPTER_PRESETS)) expect(label.length).toBeGreaterThan(0)
  })

  it('非法规则在切章入口直接抛错，不静默退化', () => {
    const bogus = { kind: 'preset', id: 'nope' } as unknown as ChapterRule
    expect(() => isChapterTitle('第一章 甲', bogus)).toThrow('id')
    expect(() => splitChapters('第一章 甲\n正文。\n', 'x', bogus)).toThrow('id')
  })

  it('splitChapters 接受规则参数', () => {
    const text = '☆、开端\n故事开始。\n【第二章】\n继续。'
    const { flatText, chapters } = splitChapters(text, 'x', { kind: 'preset', id: 'special' })
    expect(chapters.map((c) => c.title)).toEqual(['☆、开端', '【第二章】'])
    expect(flatText).toBe(text)
    // 前提自检：换一条认不出这两行的规则，结果必须不同，否则证明不了第三个参数生效
    // （自动识别本身就含特殊符号，不能拿它当反例）
    expect(splitChapters(text, 'x', { kind: 'preset', id: 'cn-chapter' }).chapters).toHaveLength(1)
  })
})

describe('resplitChapters', () => {
  const text = '第一章 甲\n正文一。\n第二章 乙\n正文二。\n'

  it('flatText 永远等于输入，章节按新规则重切', () => {
    const result = resplitChapters(text, 'x', { kind: 'preset', id: 'cn-chapter' })
    expect(result.flatText).toBe(text)
    expect(result.chapters.map((c) => c.title)).toEqual(['第一章 甲', '第二章 乙'])
    expectContiguous(result.flatText, result.chapters)
  })

  it('开头有非空白前言时单列前言一章', () => {
    const withPreamble = '作者的话\n' + text
    const result = resplitChapters(withPreamble, 'x', { kind: 'preset', id: 'cn-chapter' })
    expect(result.chapters.map((c) => c.title)).toEqual([PREAMBLE_TITLE, '第一章 甲', '第二章 乙'])
    expect(result.flatText).toBe(withPreamble)
    expectContiguous(result.flatText, result.chapters)
  })

  it('开头只有空白时折进第一章，不丢字符', () => {
    const withBlank = '\n\n' + text
    const result = resplitChapters(withBlank, 'x', { kind: 'preset', id: 'cn-chapter' })
    expect(result.flatText).toBe(withBlank)
    expect(result.chapters[0].title).toBe('第一章 甲')
    expect(result.chapters[0].start).toBe(0)
    expectContiguous(result.flatText, result.chapters)
  })

  it('一条标题都没有时整本一章，flatText 仍是输入', () => {
    const plain = '没有标题的正文。\n第二行。'
    const result = resplitChapters(plain, '我的小说', { kind: 'preset', id: 'cn-chapter' })
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0]).toMatchObject({
      index: 0,
      title: '我的小说',
      start: 0,
      end: plain.length
    })
    expect(result.flatText).toBe(plain)
  })

  it('输入开头不是全空白时，结果与 splitChapters 一致', () => {
    const preambleInput = '作者的话\n' + text
    // 前提自检：两个输入分别对应「前缀为空」与「前缀非空白」两支。
    expect(text.startsWith('第一章 甲')).toBe(true)
    expect(preambleInput.slice(0, preambleInput.indexOf('第一章 甲')).trim()).not.toBe('')
    const rules = [DEFAULT_CHAPTER_RULE, { kind: 'preset', id: 'cn-chapter' } as const]
    for (const rule of rules) {
      for (const input of [text, preambleInput]) {
        const a = splitChapters(input, 'x', rule)
        const b = resplitChapters(input, 'x', rule)
        expect(b.chapters).toEqual(a.chapters)
      }
    }
  })

  it('规则参数真的生效：自定义规则认得出 auto 认不出的标题', () => {
    const customText = '===开端===\n正文。\n===终局===\n正文。\n'
    const rule = { kind: 'custom', pattern: '^={2,6}.+={2,6}$' } as const
    expect(resplitChapters(customText, 'x', rule).chapters[0].title).toBe('===开端===')
    expect(resplitChapters(customText, 'x').chapters).toHaveLength(1)
    expect(hasChapterTitles(customText, rule)).toBe(true)
    expect(hasChapterTitles(customText)).toBe(false)
  })

  it('标题取 trim 后的行', () => {
    const padded = '　第一章 甲　\n正文。\n'
    const result = resplitChapters(padded, 'x', { kind: 'preset', id: 'cn-chapter' })
    expect(result.chapters[0].title).toBe('第一章 甲')
  })

  it('hasChapterTitles：有标题为真，无标题为假', () => {
    expect(hasChapterTitles(text, { kind: 'preset', id: 'cn-chapter' })).toBe(true)
    expect(hasChapterTitles('纯正文。', { kind: 'preset', id: 'cn-chapter' })).toBe(false)
  })
})
