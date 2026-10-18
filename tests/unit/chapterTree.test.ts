import { describe, expect, it } from 'vitest'
import {
  buildTreeRows,
  chapterPercent,
  findChapterRow
} from '../../src/renderer/src/components/chapterTree'
import type { Chapter } from '../../src/core/types'

const chapters: Chapter[] = [
  { index: 0, title: '前言', start: 0, end: 10, charCount: 10 },
  { index: 1, title: '第一卷 起势', start: 10, end: 20, charCount: 10 },
  { index: 2, title: '第1章 开端', start: 20, end: 40, charCount: 20 },
  { index: 3, title: '第二卷 承接', start: 40, end: 50, charCount: 10 },
  { index: 4, title: '第2章 相遇', start: 50, end: 70, charCount: 20 }
]

function build(overrides: Partial<Parameters<typeof buildTreeRows>[1]> = {}) {
  return buildTreeRows(chapters, {
    bookTitle: '大书',
    query: '',
    bookCollapsed: false,
    collapsedVolumes: new Set(),
    ...overrides
  })
}

describe('buildTreeRows', () => {
  it('书名是根，无卷时章节为第二层', () => {
    const plain: Chapter[] = [
      { index: 0, title: '第1章 甲', start: 0, end: 1, charCount: 1 },
      { index: 1, title: '第2章 乙', start: 1, end: 2, charCount: 1 }
    ]
    const rows = buildTreeRows(plain, {
      bookTitle: '大书',
      query: '',
      bookCollapsed: false,
      collapsedVolumes: new Set()
    })
    expect(rows.map((r) => r.kind)).toEqual(['book', 'chapter', 'chapter'])
    expect(rows[1].depth).toBe(1)
  })

  it('卷是第二层，卷下章节是第三层', () => {
    const rows = build()
    expect(rows.map((r) => `${r.kind}:${r.title}`)).toEqual([
      'book:大书',
      'chapter:前言',
      'volume:第一卷 起势',
      'chapter:第1章 开端',
      'volume:第二卷 承接',
      'chapter:第2章 相遇'
    ])
    expect(rows[1].depth).toBe(1)
    expect(rows[3].depth).toBe(2)
    expect(rows[2]).toMatchObject({ hasChildren: true })
    expect(rows[1]).toMatchObject({ chapterIndex: 0, key: 'c-0' })
    expect(rows[3]).toMatchObject({ chapterIndex: 2, key: 'c-2' })
    expect(rows[5]).toMatchObject({ chapterIndex: 4, key: 'c-4' })
  })

  it('收起的卷不展开子章节', () => {
    const rows = build({ collapsedVolumes: new Set([1]) })
    expect(rows.some((r) => r.title === '第1章 开端')).toBe(false)
    expect(rows.some((r) => r.title === '第二卷 承接')).toBe(true)
  })

  it('书名收起时只剩书名行', () => {
    const rows = build({ bookCollapsed: true })
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('book')
  })

  it('搜索只匹配章节标题，卷作为父节点保留', () => {
    const rows = build({ query: '开端', collapsedVolumes: new Set([1]) })
    expect(rows.map((r) => r.title)).toEqual(['大书', '第一卷 起势', '第1章 开端'])
  })

  it('搜索无结果时只剩书名行', () => {
    const rows = build({ query: '不存在' })
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('book')
  })

  it('搜索不区分大小写', () => {
    const latin: Chapter[] = [
      { index: 0, title: 'Chapter Alpha', start: 0, end: 1, charCount: 1 }
    ]
    const rows = buildTreeRows(latin, {
      bookTitle: 'B',
      query: 'alpha',
      bookCollapsed: false,
      collapsedVolumes: new Set()
    })
    expect(rows.map((r) => r.title)).toEqual(['B', 'Chapter Alpha'])
  })

  it('搜索不匹配卷标题', () => {
    const rows = build({ query: '承接' })
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('book')
  })

  it('搜索时忽略收起的书名', () => {
    const rows = build({ bookCollapsed: true, query: '开端' })
    expect(rows.map((r) => r.title)).toEqual(['大书', '第一卷 起势', '第1章 开端'])
  })

  it('连续两个卷都没有子章节时标记为不可展开', () => {
    const consecutive: Chapter[] = [
      { index: 0, title: '第一卷 甲', start: 0, end: 1, charCount: 1 },
      { index: 1, title: '第二卷 乙', start: 1, end: 2, charCount: 1 }
    ]
    const rows = buildTreeRows(consecutive, {
      bookTitle: '大书',
      query: '',
      bookCollapsed: false,
      collapsedVolumes: new Set()
    })
    expect(rows.map((r) => r.kind)).toEqual(['book', 'volume', 'volume'])
    expect(rows[1]).toMatchObject({ hasChildren: false })
    expect(rows[2]).toMatchObject({ hasChildren: false })
  })

  it('空章节时书名行不可展开', () => {
    const rows = buildTreeRows([], {
      bookTitle: '大书',
      query: '',
      bookCollapsed: false,
      collapsedVolumes: new Set()
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('book')
    expect(rows[0]).toMatchObject({ hasChildren: false })
  })
})

describe('findChapterRow', () => {
  it('返回章节在行数组里的下标', () => {
    const rows = build()
    expect(findChapterRow(rows, 2)).toBe(3)
  })

  it('章节被卷收起时返回 -1', () => {
    const rows = build({ collapsedVolumes: new Set([1]) })
    expect(findChapterRow(rows, 2)).toBe(-1)
  })

  it('传入卷的下标时命中卷行', () => {
    const rows = build()
    expect(findChapterRow(rows, 1)).toBe(2)
  })
})

describe('chapterPercent', () => {
  it('按进度取整并封顶 100', () => {
    expect(chapterPercent(20, 10)).toBe(50)
    expect(chapterPercent(20, 40)).toBe(100)
  })

  it('空章节算 100', () => {
    expect(chapterPercent(0, 0)).toBe(100)
  })
})
