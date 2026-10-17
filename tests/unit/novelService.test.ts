import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore } from '../../src/main/sessionStore'
import { openNovelWithRule, resplitNovelWithRule } from '../../src/main/novelService'
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
  })

  it('缓存不存在时拒绝重分章', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    const r = resplitNovelWithRule(store, src, { kind: 'preset', id: 'special' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('缓存')
  })
})
