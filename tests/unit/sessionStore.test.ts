import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore } from '../../src/main/sessionStore'
import type { Novel, PersistedSession } from '../../src/core/types'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-store-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    novelTitle: '测试书',
    sourcePath: '/tmp/测试书.txt',
    ratio: 10,
    mode: 'ime',
    cursor: 120,
    revealStart: 0,
    chapterPos: [120, 0],
    activeChapter: 0,
    startedAt: null,
    ...overrides
  }
}

describe('sessionStore 会话读写', () => {
  it('未写过时 readSession 返回 null', () => {
    const store = createSessionStore(dir)
    expect(store.readSession()).toBeNull()
  })

  it('写入后能读回同样的内容', () => {
    const store = createSessionStore(dir)
    const s = makeSession()
    store.writeSession(s)
    expect(store.readSession()).toEqual(s)
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
  })

  it('session.json 损坏时返回 null 而不抛异常', () => {
    const store = createSessionStore(dir)
    writeFileSync(join(dir, 'session.json'), '{ 这不是 JSON', 'utf8')
    expect(store.readSession()).toBeNull()
  })

  // 与上一条走的是不同代码路径：那一份连 JSON.parse 都过不去，这一份是【合法 JSON】
  // 但字段残缺——只挡解析错误的实现会把它当成一份会话交给 TypingEngine.fromSession
  // （实测不抛错，只会伪装成一次「进度回到开头」的恢复）。
  it('readSession 对结构不合法的合法 JSON 返回 null', () => {
    const store = createSessionStore(dir)
    const partial = { novelTitle: '测试书', sourcePath: '/tmp/测试书.txt' }
    writeFileSync(join(dir, 'session.json'), JSON.stringify(partial), 'utf8')
    // 前提：这份内容确实是合法 JSON，否则本用例只是在重复上一条
    expect(() => JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'))).not.toThrow()
    expect(store.readSession()).toBeNull()
  })

  it('clearAll 删除会话与缓存', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession())
    // 模拟崩溃留在磁盘上的临时文件：「清除阅读记录」应当把它一起清掉
    writeFileSync(join(dir, 'session.json.tmp'), '{"novelTitle":"半', 'utf8')
    expect(existsSync(join(dir, 'session.json.tmp'))).toBe(true)
    store.clearAll()
    expect(store.readSession()).toBeNull()
    expect(existsSync(join(dir, 'novel-cache.json'))).toBe(false)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(false)
    expect(existsSync(join(dir, 'session.json.tmp'))).toBe(false)
  })

  it('clearAll 在文件不存在时不抛异常', () => {
    const store = createSessionStore(dir)
    expect(() => store.clearAll()).not.toThrow()
  })
})

describe('sessionStore 小说缓存', () => {
  function writeSource(content: string): string {
    const p = join(dir, 'src.txt')
    writeFileSync(p, content, 'utf8')
    return p
  }

  function makeNovel(sourcePath: string): Novel {
    return {
      title: 'src',
      sourcePath,
      encoding: 'UTF-8',
      hadBom: false,
      flatText: '第一章 甲\n正文。\n',
      chapters: [{ index: 0, title: '第一章 甲', start: 0, end: 10, charCount: 10 }]
    }
  }

  it('写缓存后能读回等价的 Novel', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    const novel = makeNovel(src)
    store.writeNovelCache(novel)

    const got = store.readNovelCache(src)
    expect(got).not.toBeNull()
    expect(got!.flatText).toBe(novel.flatText)
    expect(got!.chapters).toEqual(novel.chapters)
    expect(got!.encoding).toBe('UTF-8')
  })

  it('原文件被改动（mtime/size 变化）时缓存失效', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src))

    writeFileSync(src, '完全不同的内容，长度也不同。\n', 'utf8')
    expect(store.readNovelCache(src)).toBeNull()
  })

  it('sourcePath 不匹配时缓存失效', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src))
    expect(store.readNovelCache(join(dir, '另一个文件.txt'))).toBeNull()
  })

  it('原文件被删除时 readNovelCache 返回 null 而不抛异常', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src))
    rmSync(src)
    expect(store.readNovelCache(src)).toBeNull()
  })

  it('缓存文件缺失时返回 null', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    expect(store.readNovelCache(src)).toBeNull()
  })

  // 崩溃残留：进程死在「写完 novel-cache.txt、还没写 novel-cache.json」之间。
  // 磁盘上留下的是 A 书的 meta 配另一本书的正文，而 meta 记的
  // sourcePath / mtimeMs / size 全都是 A 书自己的、三项自洽，所以只有让 meta
  // 能自我校验（textBytes）才拦得住。少了那一项就会把 A 书的章节目录配 B 书的正文交给用户。
  it('崩溃残留的错配缓存对被拒绝（meta 与 text 不是同一次写入）', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    const novel = makeNovel(src)
    store.writeNovelCache(novel)

    // 只有 txt 被换成了另一本书的正文，meta 保持 A 书那份
    const tampered = '第二章 乙\n完全不同的正文内容。\n'
    writeFileSync(join(dir, 'novel-cache.txt'), tampered, 'utf8')

    const meta = JSON.parse(readFileSync(join(dir, 'novel-cache.json'), 'utf8'))
    // 前提：meta 记的确实还是原来那份文本，且两份文本的长度确实不同——
    // 否则本用例会在「长度恰好相等」或「meta 也被改了」的情况下虚假通过
    expect(meta.textBytes).toBe(Buffer.byteLength(novel.flatText, 'utf8'))
    expect(Buffer.byteLength(tampered, 'utf8')).not.toBe(meta.textBytes)
    expect(meta.sourcePath).toBe(src)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(true)

    expect(store.readNovelCache(src)).toBeNull()
  })
})
