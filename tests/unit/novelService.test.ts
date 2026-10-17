import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore } from '../../src/main/sessionStore'
import { openNovelWithRule, resplitNovelWithRule } from '../../src/main/novelService'
import { CHAPTER_SPLIT_VERSION } from '../../src/core/chapters'
import { DEFAULT_CHAPTER_RULE } from '../../src/core/types'
import type { ChapterRule, PersistedSession } from '../../src/core/types'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-service-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 自动识别只认「第一章」，特殊符号规则只认「☆、开端」——两条规则结果不同。 */
const TEXT = '☆、开端\n正文。\n第一章 甲\n正文一。\n'

function writeBook(): string {
  const p = join(dir, 'book.txt')
  writeFileSync(p, TEXT, 'utf8')
  return p
}

function writeSessionRule(
  store: ReturnType<typeof createSessionStore>,
  sourcePath: string,
  chapterRule: ChapterRule
): void {
  const s: PersistedSession = {
    novelTitle: 'book',
    sourcePath,
    ratio: 10,
    mode: 'ime',
    cursor: 0,
    revealStart: 0,
    chapterPos: [0],
    activeChapter: 0,
    startedAt: null,
    chapterRule
  }
  expect(store.writeSession(s).ok).toBe(true)
}

describe('novelService', () => {
  it('打开时按会话里记的规则切章', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    writeSessionRule(store, src, { kind: 'preset', id: 'special' })
    const novel = openNovelWithRule(store, src)
    expect(novel.chapters.map((c) => c.title)).toEqual(['☆、开端'])
    expect(novel.flatText).toBe(TEXT)
  })

  it('缓存里的规则与会话规则不一致时重切并回写', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    const auto = openNovelWithRule(store, src)
    expect(auto.chapters.map((c) => c.title)).toEqual(['前言', '第一章 甲'])

    writeSessionRule(store, src, { kind: 'preset', id: 'special' })
    const re = openNovelWithRule(store, src)
    expect(re.chapters.map((c) => c.title)).toEqual(['☆、开端'])
    expect(store.readNovelCacheEntry(src)?.chapterRule).toEqual({
      kind: 'preset',
      id: 'special'
    })
  })

  it('规则不一致时在缓存正文上重切，不重读源文件（开头空白不会回来）', () => {
    const store = createSessionStore(dir)
    const src = join(dir, 'blank.txt')
    const SOURCE = '\n\n第一章 甲\n正文一。\n☆、开端\n正文。\n'
    writeFileSync(src, SOURCE, 'utf8')

    const auto = openNovelWithRule(store, src)
    // 前提自检：导入时开头空白已被丢掉，缓存正文不以空行开头
    expect(auto.flatText.startsWith('\n')).toBe(false)

    writeSessionRule(store, src, { kind: 'preset', id: 'special' })
    const re = openNovelWithRule(store, src)
    expect(re.flatText).toBe(auto.flatText)
    expect(re.chapters.map((c) => c.title)).toEqual(['前言', '☆、开端'])
  })

  it('规则相同且缓存命中时不重写缓存', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    const first = openNovelWithRule(store, src)

    const spy = vi.spyOn(store, 'writeNovelCache')
    const second = openNovelWithRule(store, src)
    expect(second.flatText).toBe(first.flatText)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('重分章返回新章节目录、写回缓存，正文一字不动', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    openNovelWithRule(store, src)

    const r = resplitNovelWithRule(store, src, { kind: 'preset', id: 'special' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.map((c) => c.title)).toEqual(['☆、开端'])
    expect(store.readNovelCacheEntry(src)?.novel.flatText).toBe(TEXT)
    expect(store.readNovelCacheEntry(src)?.chapterRule).toEqual({
      kind: 'preset',
      id: 'special'
    })
    expect(store.readNovelCacheEntry(src)?.novel.chapters.map((c) => c.title)).toEqual(['☆、开端'])
  })

  it('0 章匹配时拒绝，缓存里的规则不变', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    openNovelWithRule(store, src)

    const r = resplitNovelWithRule(store, src, { kind: 'custom', pattern: '^不存在$' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('没有识别出任何章节')
    expect(store.readNovelCacheEntry(src)?.chapterRule).toEqual(DEFAULT_CHAPTER_RULE)
    expect(store.readNovelCacheEntry(src)?.novel.chapters.map((c) => c.title)).toEqual([
      '前言',
      '第一章 甲'
    ])
  })

  it('选回自动识别时，即使 0 章也允许（回到最初的单章目录）', () => {
    const store = createSessionStore(dir)
    const src = join(dir, 'no-auto-titles.txt')
    const SOURCE = '===开端===\n正文一。\n===终局===\n正文三。\n'
    writeFileSync(src, SOURCE, 'utf8')

    // 自动识别在这本书上一条标题都认不出 → 单章
    const auto = openNovelWithRule(store, src)
    expect(auto.chapters).toHaveLength(1)

    // 先用自定义规则切成两章
    const custom: ChapterRule = { kind: 'custom', pattern: '^={2,6}.+={2,6}$' }
    const special = resplitNovelWithRule(store, src, custom)
    expect(special.ok).toBe(true)

    // 再选回自动识别：0 匹配也必须允许，目录回到单章
    const back = resplitNovelWithRule(store, src, DEFAULT_CHAPTER_RULE)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.value).toHaveLength(1)
    expect(store.readNovelCacheEntry(src)?.chapterRule).toEqual(DEFAULT_CHAPTER_RULE)
  })

  it('缓存不存在时拒绝重分章', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    const r = resplitNovelWithRule(store, src, { kind: 'preset', id: 'special' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('缓存')
  })

  it('切章算法版本变旧时用缓存正文重切，并回写新版本', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    openNovelWithRule(store, src)

    // 只改 meta：源文件与缓存正文都没动，缓存本身仍然有效，只有目录是旧算法留下的
    const metaPath = join(dir, 'novel-cache.json')
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    meta.chapters = [
      { index: 0, title: '旧目录', start: 0, end: TEXT.length, charCount: TEXT.length }
    ]
    meta.splitVersion = 1
    writeFileSync(metaPath, JSON.stringify(meta), 'utf8')

    const re = openNovelWithRule(store, src)
    expect(re.chapters.map((c) => c.title)).toEqual(['前言', '第一章 甲'])
    expect(store.readNovelCacheEntry(src)?.splitVersion).toBe(CHAPTER_SPLIT_VERSION)
  })
})
