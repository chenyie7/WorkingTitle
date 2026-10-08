import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  utimesSync
} from 'node:fs'
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

  // 原子性的机制级守卫：renameSync 会换成【另一个 inode】，而 writeFileSync 对已存在的
  // 路径是原地截断、inode 不变。读文件【内容】看不出这个差别——这正是原子性没有被任何
  // 内容级断言覆盖住的原因，也是这条用例存在的理由。
  //
  // 【为什么这是确定成立的，而不只是这一次观测到】临时文件在改名【之前】就已创建，所以
  // 新 inode 的分配发生在旧 inode 被释放之前，文件系统没有机会把它回收重用。实测连写
  // 20 次：temp+rename 得到 20 个互不相同的 inode，改成直接写则 20 次都是同一个 inode。
  //
  // 【它不是唯一可行的守卫，另一种其实更贴近性质】把 node:fs 的 writeFileSync 换成
  // 「先写 20 字节前缀再抛错」，断言上一次的会话仍然完好——那一条钉的是【性质】（不会
  // 出现半截文件）而不是机制，本来更该选它。没选它是因为它需要 `// @vitest-environment
  // node`：实测在 jsdom 下 mock 一次都拦不到（`vi.spyOn(fs, 'writeFileSync')` 报
  // "Module namespace is not configurable"，直接赋值报 "Cannot redefine property"），
  // 也就是那个 pragma 是承重的——为一条已由 inode 守卫覆盖的机制，让此后每个读者都背上
  // 环境与配置成本，不划算。顺带记下：那条 mock 守卫是【失败即安全】而非空转——若 mock
  // 没生效，第二次写入会成功，断言反而会红。
  it('writeSession 走的是 temp + rename（换 inode，而不是原地截断）', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession({ cursor: 1 }))
    const sessionPath = join(dir, 'session.json')
    const first = statSync(sessionPath).ino
    store.writeSession(makeSession({ cursor: 2 }))
    // 前提：这一步的平台确实给出有意义的 inode。若某个平台报 0，失败会指在这里，
    // 而不是让下面的守卫变成一句看不出所以然的自比较。
    expect(first).toBeGreaterThan(0)

    expect(statSync(sessionPath).ino).not.toBe(first)
    // 前提：第二次写真的发生了（否则 inode 变了也说明不了是这次写入造成的）
    expect(store.readSession()!.cursor).toBe(2)
  })

  // 持久化失败的守卫：失败必须留下痕迹，而不是「应用看着健康、其实什么都没存」。
  // 断言的是「报出来了、而且带着原错误」——那正是这条修复的全部内容。
  // 让 baseDir 指向一个【文件】：mkdirSync 必然 EEXIST，写入必然失败，且失败原因
  // 与文本内容、平台时序都无关（实测在 jsdom 下 spy 能正常拦到，且只调用一次）。
  it('写入失败会带着原错误 console.warn 出来，而不是静默吞掉', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const notADir = join(dir, '不是一个目录')
      writeFileSync(notADir, 'x', 'utf8')
      const store = createSessionStore(notADir)
      store.writeSession(makeSession())
      // 前提：这次写入确实失败了——否则「报了 warn」可能来自别处
      expect(existsSync(join(notADir, 'session.json'))).toBe(false)

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][1]).toBeInstanceOf(Error)
    } finally {
      spy.mockRestore()
    }
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

  // 上面那条同时改动了 mtime 与 size，所以它只证明「两条腿中的至少一条在起作用」。
  // 下面两条各自只动一条腿，把 `mtimeMs !== meta.mtimeMs || size !== meta.size` 的
  // 两个分支分别钉住——把 || 错写成 &&，只有它们会红。
  //
  // 整数秒的 mtime 是关键：实测 utimesSync(p, S, S) 之后 statSync(p).mtimeMs 恰好是
  // S * 1000，逐位可还原。不然「只动了 mtime」和「mtime 与记录一致」这两个前提
  // 都只能靠写入时序去赌，测出来的东西就不确定了。
  const MTIME_A = 1_700_000_000
  const MTIME_B = 1_700_000_001

  it('源文件只被 touch（内容与大小不变）时缓存失效', () => {
    const store = createSessionStore(dir)
    const src = join(dir, 'src.txt')
    writeFileSync(src, '第一章 甲\n正文。\n', 'utf8')
    utimesSync(src, MTIME_A, MTIME_A)
    store.writeNovelCache(makeNovel(src))

    const before = statSync(src)
    utimesSync(src, MTIME_B, MTIME_B)
    const after = statSync(src)
    // 前提：只动了 mtime，大小没变——否则这条用例测的不是 mtime 那条腿
    expect(before.mtimeMs).toBe(MTIME_A * 1000)
    expect(after.mtimeMs).toBe(MTIME_B * 1000)
    expect(after.size).toBe(before.size)

    expect(store.readNovelCache(src)).toBeNull()
  })

  it('源文件改成不同长度的内容、且 mtime 被逐位还原时缓存失效', () => {
    const store = createSessionStore(dir)
    const src = join(dir, 'src.txt')
    writeFileSync(src, '第一章 甲\n正文。\n', 'utf8')
    utimesSync(src, MTIME_A, MTIME_A)
    store.writeNovelCache(makeNovel(src))

    writeFileSync(src, '完全不同的内容，长度也不同。\n', 'utf8')
    utimesSync(src, MTIME_A, MTIME_A) // 把 mtime 拨回与 meta 记录一致
    const st = statSync(src)
    const meta = JSON.parse(readFileSync(join(dir, 'novel-cache.json'), 'utf8'))
    // 前提：mtime 与记录逐位相同、大小不同——即只剩 size 那条腿能拦下它
    expect(st.mtimeMs).toBe(meta.mtimeMs)
    expect(st.size).not.toBe(meta.size)

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
