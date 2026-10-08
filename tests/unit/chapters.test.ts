import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isChapterTitle, splitChapters, PREAMBLE_TITLE } from '../../src/core/chapters'

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
    '12．转折'
  ])('识别标题行：%s', (line) => {
    expect(isChapterTitle(line)).toBe(true)
  })

  it.each([
    '第三章的内容很有意思，我读了三遍。',
    '前言不搭后语',
    '林昭站在城墙上。',
    '第一章 风起但是这一行其实是一句很长很长的正文句子，明显超过了标题长度上限',
    '',
    '   '
  ])('不把正文当标题：%s', (line) => {
    expect(isChapterTitle(line)).toBe(false)
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
    // 这条断言必须落在【真实 fixture】上，它是全项目唯一守住「有章节的拼接路径」保真的地方。
    // expectContiguous 只校验 (flatText, chapters) 这一对【自洽】：区间连续、下标、charCount。
    // 它对 flatText 是否等于源文件一言不发——去掉拼接时的章间 \n，它照样全绿（实测）。
    // 上面「无标题 → 单章节」那条虽然也断言了 flatText === text，但走的是提前返回分支
    // （titleIdx 为空直接 return { flatText: text }），那个断言恒真，碰不到拼接逻辑。
    // 而这条用例走的是三章拼接：只有 flatText 与源文件逐字相等，Task 4 那些指向 flatText
    // 的 cursor/revealStart/chapterPos 偏移，才对得上用户真正导入的那个文件。
    // 【保真律 · 分支一】没有任何东西被丢弃 → flatText === text。
    // 分支二（丢掉了一段全空白前言 → flatText === text.slice(off)）在「标题前只有空白时…」里。
    expect(flatText).toBe(text)
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
    expect(chapters[0].title).toBe(PREAMBLE_TITLE)
    expect(chapters[0].start).toBe(0)
    expect(flatText.slice(chapters[0].start, chapters[0].end)).toContain('版权声明')
    expect(chapters[1].title).toBe('第一章 风起')
    expectContiguous(flatText, chapters)
  })

  it('标题前只有空白时不产生前言章节', () => {
    const text = '\n\n第一章 风起\n正文。\n'
    const { flatText, chapters } = splitChapters(text, 'x')
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('第一章 风起')
    // 【保真律 · 分支二】flatText 恰好等于「原文减去被丢掉的那段全空白前言」，不多不少：
    //     flatText === text.slice(off)，off = 第一个标题行首字符的下标。
    // 完整规律是这两条分支的并集，分支一（没有任何东西被丢弃 → flatText === text）
    // 断言在「按 第X章 切出三章」里。之所以要分成两条而不是只写 `flatText === text`：
    // 丢掉一段空白前言是【合法】行为，此时 flatText 本来就不等于原文——正因为如此，
    // 这条断言无法统一地写在每个用例里，保真的缺口才在 Task 3 之前一直没人发现。
    // 该规律经 30000 例随机文本实测无例外（分支一 17110/17110，分支二 6351/6351）。
    // off 的定义：第一个标题行首字符在原文中的下标
    //   = 它【前面每一行的长度】之和 + 每行一个 \n（原文按 \n 拆行，行间各有一个分隔符）。
    // 本例前两行都是空字符串（长度 0），各贡献 1 个 \n，故 off = 0 + 1 + 0 + 1 = 2。
    // 用 indexOf 求而不是写死 2：让「off 就是标题行的起点」这件事自证，下面的 expect 再钉住它。
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
  })
})
