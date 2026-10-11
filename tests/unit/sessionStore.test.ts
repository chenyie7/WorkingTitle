import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
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
import { defaultSettings } from '../../src/core/types'
import type { AppSettings, Novel, PersistedSession } from '../../src/core/types'

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

/** `makeSession()` 默认那本书的路径——多数「那一份会话文件」的用例说的都是它。 */
const SRC = '/tmp/测试书.txt'

/**
 * 会话文件在磁盘上的位置。
 *
 * 【为什么测试自己算一遍 sha256 而不是从实现里 import】判据要独立：把实现里的算法换掉
 * （比如换成 base64），这些用例必须跟着红，而不是跟着实现一起漂。仓库里已有的会话路径
 * 断言（clearReadingHistory 那条）也是这个姿势。
 */
function sessionFile(dir: string, sourcePath: string): string {
  const key = createHash('sha256').update(sourcePath, 'utf8').digest('hex').slice(0, 32)
  return join(dir, 'sessions', `${key}.json`)
}

// 这两个辅助函数放在模块级而不是第二个 describe 里：clearReadingHistory 那条用例也要用它
// （此前它一个缓存都没写，于是它的两条 novel-cache 断言在测「两个从未创建的文件的缺失」）。
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

describe('sessionStore 会话读写', () => {
  it('两本书各存一份，互不覆盖', () => {
    const store = createSessionStore(dir)
    const a = makeSession({ sourcePath: '/tmp/A.txt', cursor: 100 })
    const b = makeSession({ sourcePath: '/tmp/B.txt', cursor: 200 })
    store.writeSession(a)
    store.writeSession(b)
    expect(store.readSession('/tmp/A.txt')).toEqual(a)
    expect(store.readSession('/tmp/B.txt')).toEqual(b)
  })

  it('读取路径上的书从未存过时返回 null', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession({ sourcePath: '/tmp/A.txt' }))
    expect(store.readSession('/tmp/B.txt')).toBeNull()
  })

  // 文件名是 sourcePath 的哈希，所以「文件里的 sourcePath 与请求的不是同一本」只有手工改
  // 文件名或哈希撞车才造得出来。但一旦发生，后果是把 B 书的进度套到 A 书上——章节目录与
  // 光标一起错位，而 fromSession 对错位的 chapterPos 不抛错，只会表现成「进度莫名其妙不对」。
  it('文件内容里的 sourcePath 与请求的书对不上时按无记录处理', () => {
    const store = createSessionStore(dir)
    const a = makeSession({ sourcePath: '/tmp/A.txt', cursor: 100 })
    store.writeSession(a)
    // 把 A 那份的内容冒充成 B 的：文件名按 B 的哈希、内容仍是 A 的
    writeFileSync(sessionFile(dir, '/tmp/B.txt'), JSON.stringify(a), 'utf8')

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(store.readSession('/tmp/B.txt')).toBeNull()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain('不是同一本')
    } finally {
      spy.mockRestore()
    }
    // 前提：A 自己那份仍在、且仍读得回来——证明上面那次 null 是被 sourcePath 那道门拦下的，
    // 而不是这两本书本来就都没有记录（少了这行，一个「readSession 永远返回 null」的实现
    // 也能让上面两条断言全绿）
    expect(store.readSession('/tmp/A.txt')).toEqual(a)
  })

  it('未写过时 readSession 返回 null', () => {
    const store = createSessionStore(dir)
    expect(store.readSession(SRC)).toBeNull()
  })

  it('写入后能读回同样的内容', () => {
    const store = createSessionStore(dir)
    const s = makeSession()
    store.writeSession(s)
    expect(store.readSession(SRC)).toEqual(s)
    expect(existsSync(sessionFile(dir, SRC))).toBe(true)
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
      expect(existsSync(sessionFile(notADir, SRC))).toBe(false)

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][1]).toBeInstanceOf(Error)
    } finally {
      spy.mockRestore()
    }
  })

  it('会话文件损坏时返回 null 而不抛异常', () => {
    const store = createSessionStore(dir)
    mkdirSync(join(dir, 'sessions'), { recursive: true })
    writeFileSync(sessionFile(dir, SRC), '{ 这不是 JSON', 'utf8')
    expect(store.readSession(SRC)).toBeNull()
  })

  // 与上一条（`{ 这不是 JSON`，连 JSON.parse 都过不去）走的是不同代码路径：这一组是
  // 【合法 JSON】但字段不合规——只挡解析错误的实现会把它当成一份会话交给
  // TypingEngine.fromSession（实测不抛错，只会伪装成一次「进度回到开头」的恢复）。
  //
  // 【为什么是一张表而不是一份残缺记录】原先只有一条「只留 novelTitle/sourcePath」的用例，
  // 它只能证明「有校验」，证明不了任何**单条**字段检查在不在：实测把七条检查里任意一条删掉，
  // 整套 16 条仍全绿。现在一个字段一份残缺记录、各占一条用例，并且每条都断言警告里
  // **点出了那个字段**——于是「校验存在」被拆成「每条腿都在，而且报得出名字」。
  // 多字段缺失那种情形被「mode 缺失」这条覆盖（前面几条都会先通过，最后卡在 mode 上）。
  // 【令牌必须写成完整短语，不能只写字段名】这条规则是【逐腿清扫】发现的，不是写表时想到的：
  // 第一版令牌用的是字段名（'chapters'），而删掉「chapters 是不是数组」那条检查后，消息变成
  // 'chapters[0] 不是对象'——**同样含 'chapters'**，于是那条用例照样通过，那条腿等于没有被
  // 观测到。同一形状还有 'chapters[0]' 被 'chapters[0].title 不是字符串' 满足。
  // 断言活着，只是它测的不是它声称的东西——与「断言的两个操作数同源」是同一类错误。
  //
  // 【而且：这张表建成之后，仍不足以说明每条腿被观测到了】第一版表建成后做逐腿清扫，
  // 仍有 4 条腿不可见（原因是令牌太松，不是缺用例）。所以「一个字段一条用例」是**必要而非
  // 充分**；判据是**逐条删掉检查、要求至少有一条用例变红**——本任务扫了 25 条腿，最终 0 条
  // 不可见。请在写完表之后仍然跑一遍清扫，别跳过：这 4 条正是只在第二步才会露出来的。
  const CRIPPLED: Array<{
    name: string
    token: string
    build: (s: PersistedSession) => unknown
  }> = [
    { name: 'novelTitle 不是字符串', token: 'novelTitle 不是字符串', build: (s) => ({ ...s, novelTitle: 42 }) },
    { name: 'sourcePath 不是字符串', token: 'sourcePath 不是字符串', build: (s) => ({ ...s, sourcePath: null }) },
    { name: 'mode 不是 ime/key', token: 'mode 既不是 ime 也不是 key', build: (s) => ({ ...s, mode: 'garbage' }) },
    {
      name: 'mode 整个缺失',
      token: 'mode',
      build: (s) => {
        const copy: Record<string, unknown> = { ...s }
        delete copy.mode
        return copy
      }
    },
    { name: 'chapterPos 不是数组', token: 'chapterPos 不是数组', build: (s) => ({ ...s, chapterPos: '0,1' }) },
    {
      name: 'chapterPos 含非数字项',
      token: 'chapterPos 含非数字项',
      build: (s) => ({ ...s, chapterPos: [1, '2'] })
    },
    {
      name: 'startedAt 既不是 null 也不是数字',
      token: 'startedAt 既不是 null 也不是数字',
      build: (s) => ({ ...s, startedAt: 'now' })
    },
    { name: 'ratio 不是数字', token: 'ratio 不是有限数字', build: (s) => ({ ...s, ratio: '10' }) },
    { name: 'cursor 不是数字', token: 'cursor 不是有限数字', build: (s) => ({ ...s, cursor: null }) },
    { name: 'revealStart 不是数字', token: 'revealStart 不是有限数字', build: (s) => ({ ...s, revealStart: {} }) },
    {
      name: 'activeChapter 不是数字',
      token: 'activeChapter 不是有限数字',
      build: (s) => ({ ...s, activeChapter: '0' })
    },
    // 注意不能拿数组当这一条的输入：`typeof [] === 'object'`，数组会通过「是不是对象」
    // 那一关、最后卡在 novelTitle 上（实测：断言 token 会红）。JSON 的 null 与裸数字才
    // 真的走到那条 return。
    { name: '记录是 null', token: '不是一个对象', build: () => null },
    { name: '记录是裸数字', token: '不是一个对象', build: () => 42 }
  ]

  it.each(CRIPPLED)('$name → 按无记录处理，且警告点出该字段', ({ build, token }) => {
    const store = createSessionStore(dir)
    const crippled = build(makeSession())
    mkdirSync(join(dir, 'sessions'), { recursive: true })
    writeFileSync(sessionFile(dir, SRC), JSON.stringify(crippled), 'utf8')
    // 前提一：写下去的确实是合法 JSON——否则本用例只是在重复「损坏时返回 null」那一条
    expect(() => JSON.parse(readFileSync(sessionFile(dir, SRC), 'utf8'))).not.toThrow()
    // 前提二：这份记录与一份完好的记录确实不同——否则它什么都没坏，用例是空跑
    expect(JSON.stringify(crippled)).not.toBe(JSON.stringify(makeSession()))

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(store.readSession(SRC)).toBeNull()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain(token)
    } finally {
      spy.mockRestore()
    }
  })

  it('clearReadingHistory 清掉所有书的进度与缓存，留下设置', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession({ sourcePath: '/tmp/A.txt' }))
    store.writeSession(makeSession({ sourcePath: '/tmp/B.txt' }))
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src))
    store.writeSettings({
      docTitle: '季度汇报',
      themeSource: 'dark',
      darkPaper: true,
      lastSourcePath: '/tmp/A.txt'
    })
    // 前提：这些东西确实落盘了。少了这几行，下面的断言测的是「几个从未被创建过的文件
    // 不存在」——无论 clearReadingHistory 做什么都会通过。
    expect(existsSync(sessionFile(dir, '/tmp/A.txt'))).toBe(true)
    expect(existsSync(sessionFile(dir, '/tmp/B.txt'))).toBe(true)
    expect(existsSync(join(dir, 'novel-cache.json'))).toBe(true)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(true)
    expect(existsSync(join(dir, 'settings.json'))).toBe(true)
    // 旧版留下的单槽会话文件（没有 Task 5 的迁移时它就在那儿）：「清除阅读记录」应当把它清掉。
    writeFileSync(join(dir, 'session.json'), '{"novelTitle":"旧版残留', 'utf8')
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
    // 模拟崩溃留在磁盘上的临时文件（写了一半就死掉的那份）：「清除阅读记录」应当把它一起清掉。
    // 少了下面这一行，删除列表里 `${legacySessionPath}.tmp` 那一项就是**没有任何用例观测**的——
    // 把它删掉不会有断言变红。
    writeFileSync(join(dir, 'session.json.tmp'), '{"novelTitle":"半', 'utf8')
    expect(existsSync(join(dir, 'session.json.tmp'))).toBe(true)

    store.clearReadingHistory()

    // **两本书各一份**：清除要一次清干净，不是只清「最近那本」
    expect(store.readSession('/tmp/A.txt')).toBeNull()
    expect(store.readSession('/tmp/B.txt')).toBeNull()
    expect(existsSync(join(dir, 'sessions'))).toBe(false)
    expect(existsSync(join(dir, 'novel-cache.json'))).toBe(false)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(false)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
    expect(existsSync(join(dir, 'session.json.tmp'))).toBe(false)
    // 设置不在此列：它是用户的偏好，与「读到哪」无关
    expect(store.readSettings()).toEqual({
      docTitle: '季度汇报',
      themeSource: 'dark',
      darkPaper: true,
      lastSourcePath: '/tmp/A.txt'
    })
  })

  it('clearReadingHistory 在文件不存在时不抛异常', () => {
    const store = createSessionStore(dir)
    expect(() => store.clearReadingHistory()).not.toThrow()
  })
})

describe('sessionStore 小说缓存', () => {
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

  // 与 readSession 的字段校验同源：合法 JSON、但形状不对的 meta 原先会被断言成
  // NovelCacheMeta 并当作【命中】返回。这不是理论问题——实测在修复前，meta 只写
  // sourcePath/mtimeMs/size/textBytes 时返回的对象里 chapters/title/encoding/hadBom
  // 全是 undefined，而 flatText 是对的，于是 Task 6 的 `if (cached) return cached`
  // 会把它当小说交给渲染进程，chapters.length 当场抛错。
  // 与 readSession 那张表同源：isNovelCacheMeta 的每一条字段检查原先也【各自不可见】——
  // 删掉任意一条，整套仍是全绿（这一条是补完会话那张表之后发现的：新写的校验器落进了
  // 同一个形状）。一个字段一份残缺 meta，各占一条用例，并断言警告点出该字段。
  function validMeta(src: string, text: string): Record<string, unknown> {
    const st = statSync(src)
    return {
      sourcePath: src,
      mtimeMs: st.mtimeMs,
      size: st.size,
      encoding: 'UTF-8',
      hadBom: false,
      title: 'src',
      chapters: [{ index: 0, title: '第一章 甲', start: 0, end: 10, charCount: 10 }],
      textBytes: Buffer.byteLength(text, 'utf8')
    }
  }

  const BAD_METAS: Array<{ name: string; token: string; mangle: (m: Record<string, unknown>) => unknown }> =
    [
      { name: 'sourcePath 不是字符串', token: 'sourcePath 不是字符串', mangle: (m) => ({ ...m, sourcePath: 7 }) },
      { name: 'title 不是字符串', token: 'title 不是字符串', mangle: (m) => ({ ...m, title: null }) },
      { name: 'encoding 不是字符串', token: 'encoding 不是字符串', mangle: (m) => ({ ...m, encoding: 9 }) },
      { name: 'hadBom 不是布尔值', token: 'hadBom 不是布尔值', mangle: (m) => ({ ...m, hadBom: 'no' }) },
      { name: 'mtimeMs 不是数字', token: 'mtimeMs 不是有限数字', mangle: (m) => ({ ...m, mtimeMs: '1' }) },
      { name: 'size 不是数字', token: 'size 不是有限数字', mangle: (m) => ({ ...m, size: null }) },
      { name: 'textBytes 不是数字', token: 'textBytes 不是有限数字', mangle: (m) => ({ ...m, textBytes: {} }) },
      { name: 'chapters 不是数组', token: 'chapters 不是数组', mangle: (m) => ({ ...m, chapters: 'none' }) },
      {
        name: 'chapters[0] 不是对象',
        token: 'chapters[0] 不是对象',
        mangle: (m) => ({ ...m, chapters: ['第一章'] })
      },
      {
        name: 'chapters[0].title 不是字符串',
        token: 'chapters[0].title',
        mangle: (m) => ({ ...m, chapters: [{ ...(m.chapters as object[])[0], title: 1 }] })
      },
      {
        name: 'chapters[0].index 不是数字',
        token: 'chapters[0].index',
        mangle: (m) => ({ ...m, chapters: [{ ...(m.chapters as object[])[0], index: '0' }] })
      },
      {
        name: 'chapters[0].start 不是数字',
        token: 'chapters[0].start',
        mangle: (m) => ({ ...m, chapters: [{ ...(m.chapters as object[])[0], start: '0' }] })
      },
      {
        name: 'chapters[0].end 不是数字',
        token: 'chapters[0].end',
        mangle: (m) => ({ ...m, chapters: [{ ...(m.chapters as object[])[0], end: null }] })
      },
      {
        name: 'chapters[0].charCount 不是数字',
        token: 'chapters[0].charCount',
        mangle: (m) => ({ ...m, chapters: [{ ...(m.chapters as object[])[0], charCount: {} }] })
      }
    ]

  it.each(BAD_METAS)('meta 的 $name → 按未命中处理，且警告点出该字段', ({ mangle, token }) => {
    const store = createSessionStore(dir)
    const src = join(dir, 'src.txt')
    const text = '第一章 甲\n正文。\n'
    writeFileSync(src, text, 'utf8')
    writeFileSync(join(dir, 'novel-cache.txt'), text, 'utf8')
    const good = validMeta(src, text)
    const bad = mangle(good)
    writeFileSync(join(dir, 'novel-cache.json'), JSON.stringify(bad), 'utf8')

    // 前提一：写下去的确实是合法 JSON（否则只是在重复「元数据缺失/损坏」那几条）
    expect(() => JSON.parse(readFileSync(join(dir, 'novel-cache.json'), 'utf8'))).not.toThrow()
    // 前提二：完好的那份 meta 在【其余三道门】上确实自洽——把 good 写进去必须命中。
    // 少了这一步，这条用例证明不了「是被改坏的那个键拦下的」，也可能是这对文件本来就不算数。
    writeFileSync(join(dir, 'novel-cache.json'), JSON.stringify(good), 'utf8')
    expect(store.readNovelCache(src)).not.toBeNull()
    // 前提三：坏的那份与好的只差一个键（键数相同 ⇒ 是改坏而非删掉）
    expect(JSON.stringify(bad)).not.toBe(JSON.stringify(good))
    expect(Object.keys(bad as object).length).toBe(Object.keys(good).length)
    writeFileSync(join(dir, 'novel-cache.json'), JSON.stringify(bad), 'utf8')

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(store.readNovelCache(src)).toBeNull()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain(token)
    } finally {
      spy.mockRestore()
    }
  })

  it('meta 是合法 JSON 但形状不对时按未命中处理', () => {
    const store = createSessionStore(dir)
    const src = join(dir, 'src.txt')
    const text = '第一章 甲\n正文。\n'
    writeFileSync(src, text, 'utf8')
    const st = statSync(src)
    writeFileSync(join(dir, 'novel-cache.txt'), text, 'utf8')

    const partial = {
      sourcePath: src,
      mtimeMs: st.mtimeMs,
      size: st.size,
      textBytes: Buffer.byteLength(text, 'utf8')
    }
    writeFileSync(join(dir, 'novel-cache.json'), JSON.stringify(partial), 'utf8')

    // 前提：这一对在【其余三道门】上完全自洽——路径、源文件 stat、提交点全部通过，
    // 所以唯一能拦下它的就是形状校验；否则本用例会退化成「它因别的原因被拒」。
    expect(partial.sourcePath).toBe(src)
    expect(statSync(src).mtimeMs).toBe(partial.mtimeMs)
    expect(statSync(src).size).toBe(partial.size)
    expect(statSync(join(dir, 'novel-cache.txt')).size).toBe(partial.textBytes)
    expect(() => JSON.parse(readFileSync(join(dir, 'novel-cache.json'), 'utf8'))).not.toThrow()

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

describe('sessionStore 设置读写', () => {
  it('未写过时 readSettings 返回默认值', () => {
    const store = createSessionStore(dir)
    expect(store.readSettings()).toEqual(defaultSettings())
    expect(existsSync(join(dir, 'settings.json'))).toBe(false)
  })

  it('写入后能读回同样的内容', () => {
    const store = createSessionStore(dir)
    const s: AppSettings = {
      docTitle: '季度汇报',
      themeSource: 'dark',
      darkPaper: true,
      lastSourcePath: '/tmp/测试书.txt'
    }
    store.writeSettings(s)
    expect(store.readSettings()).toEqual(s)
    expect(existsSync(join(dir, 'settings.json'))).toBe(true)
  })

  // 与 readSession 那两张表同一套姿势：合法 JSON、但形状不对的设置**不能**被当成设置用。
  // 设置项全是可再生的（坏了就回默认值），所以这里没有「进度不能丢」那种压力；
  // 但「哪个字段坏了」仍要报出来——静默回默认会让「我改的文档名怎么没了」无从查起。
  const BAD_SETTINGS: Array<{ name: string; token: string; mangle: (s: AppSettings) => unknown }> = [
    { name: 'docTitle 不是字符串', token: 'docTitle 不是字符串', mangle: (s) => ({ ...s, docTitle: 7 }) },
    {
      name: 'themeSource 不是取值之一',
      token: 'themeSource 不是 system/light/dark',
      mangle: (s) => ({ ...s, themeSource: 'sepia' })
    },
    { name: 'darkPaper 不是布尔值', token: 'darkPaper 不是布尔值', mangle: (s) => ({ ...s, darkPaper: 'yes' }) },
    {
      name: 'lastSourcePath 既不是 null 也不是字符串',
      token: 'lastSourcePath 既不是 null 也不是字符串',
      mangle: (s) => ({ ...s, lastSourcePath: 42 })
    },
    { name: '记录是 null', token: '不是一个对象', mangle: () => null },
    { name: '记录是裸数字', token: '不是一个对象', mangle: () => 42 }
  ]

  it.each(BAD_SETTINGS)('设置里的 $name → 按默认值处理，且警告点出该字段', ({ mangle, token }) => {
    const store = createSessionStore(dir)
    const good: AppSettings = {
      docTitle: '季度汇报',
      themeSource: 'dark',
      darkPaper: true,
      lastSourcePath: null
    }
    const bad = mangle(good)
    // 前提三：完好的那份确实被接受——否则「坏的被拒」可能只是因为它本来就过不了。
    // 这一条同时钉住 lastSourcePath 允许 null：默认值与「清除阅读记录」之后写回的都是 null，
    // 而那两处若被误判成非法，症状是这个字段连着的四项设置一起回默认值。
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(good), 'utf8')
    expect(store.readSettings()).toEqual(good)
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(bad), 'utf8')
    // 前提一：写下去的确实是合法 JSON——否则本用例只是在重复「损坏文件」那一条
    expect(() => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).not.toThrow()
    // 前提二：坏的那份与好的确实不同——否则它什么都没坏，用例是空跑
    expect(JSON.stringify(bad)).not.toBe(JSON.stringify(good))

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(store.readSettings()).toEqual(defaultSettings())
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain(token)
    } finally {
      spy.mockRestore()
    }
  })

  it('settings.json 不是合法 JSON 时返回默认值而不抛异常', () => {
    const store = createSessionStore(dir)
    writeFileSync(join(dir, 'settings.json'), '{ 这不是 JSON', 'utf8')
    expect(store.readSettings()).toEqual(defaultSettings())
  })

  // 与 writeSession 那条同形：失败必须留下痕迹，而不是「应用看着健康、其实设置没存」。
  it('设置写入失败会带着原错误 console.warn 出来', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const notADir = join(dir, '不是一个目录')
      writeFileSync(notADir, 'x', 'utf8')
      const store = createSessionStore(notADir)
      store.writeSettings(defaultSettings())
      expect(existsSync(join(notADir, 'settings.json'))).toBe(false)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][1]).toBeInstanceOf(Error)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('旧版单槽会话的迁移', () => {
  it('合法的旧会话被搬进 sessions/ 并补上 lastSourcePath，旧文件删除', () => {
    const store = createSessionStore(dir)
    const legacy = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 77 })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(legacy), 'utf8')

    store.migrateLegacySession()

    expect(store.readSession('/tmp/旧书.txt')).toEqual(legacy)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
    // 旧版没有 settings.json，「上次打开的是哪本」原先只写在会话里；不补这一步，
    // 升级后的第一次启动会停在空状态——进度在，但没人去开那本书。
    expect(store.readSettings().lastSourcePath).toBe('/tmp/旧书.txt')
  })

  it('重复调用是幂等的（旧文件已删，第二次什么都不做）', () => {
    const store = createSessionStore(dir)
    writeFileSync(join(dir, 'session.json'), JSON.stringify(makeSession({ cursor: 5 })), 'utf8')
    store.migrateLegacySession()
    const after = store.readSession(SRC)

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.migrateLegacySession()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
    expect(store.readSession(SRC)).toEqual(after)
  })

  it('没有旧文件时什么都不做', () => {
    const store = createSessionStore(dir)
    expect(() => store.migrateLegacySession()).not.toThrow()
    expect(existsSync(join(dir, 'sessions'))).toBe(false)
  })

  // 这里与「读会话」那条路径的处置**刻意不同**：读会话时坏记录按无记录处理即可（文件还在），
  // 而迁移要先删掉旧文件——删是不可逆的。所以判不了的东西一律不删，只报出来。
  it('结构不合法的旧会话不迁移、也不删除，并警告', () => {
    const store = createSessionStore(dir)
    writeFileSync(join(dir, 'session.json'), JSON.stringify({ novelTitle: '只有书名' }), 'utf8')
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.migrateLegacySession()
      expect(String(spy.mock.calls[0][0])).toContain('未迁移')
    } finally {
      spy.mockRestore()
    }
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
  })

  it('新版已有同一本书的进度时不覆盖它', () => {
    const store = createSessionStore(dir)
    const legacy = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 1 })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(legacy), 'utf8')
    const fresh = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 999 })
    store.writeSession(fresh)

    store.migrateLegacySession()

    // 新版那份是更新的——旧文件只是上一代格式的残留，不该倒回去
    expect(store.readSession('/tmp/旧书.txt')).toEqual(fresh)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
  })

  // 【本任务唯一会毁数据的地方，所以单独一条】写不进新版位置时，旧文件是用户进度唯一的
  // 副本，绝不能删。触发条件很现实：磁盘满（写要空间、rm 不要），或 sessions 被一个同名
  // 文件占住（mkdir 抛、rm 照旧成功）。删掉的后果是进度不可恢复，而且下一次启动的 600ms
  // 自动保存会用 cursor=0 覆盖现场——用户看到的是「升级之后进度莫名其妙归零」。
  //
  // 造法：把 `sessions` 做成一个**文件**，于是 writeSessionFile 的 mkdirSync 必然
  // EEXIST。（不用 mock node:fs，与 guardA 那条注入式守卫分工不同：那条测写入中途被杀，
  // 这条测「写根本没成功时调用方有没有守住」。）
  it('迁移时写不进 sessions/ 就不删旧文件', () => {
    const store = createSessionStore(dir)
    const legacy = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 77 })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(legacy), 'utf8')
    writeFileSync(join(dir, 'sessions'), 'x', 'utf8') // 占位：让 sessions 目录建不出来

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.migrateLegacySession()
      // 前提：这次写入确实失败了——否则下面那条「旧文件还在」可能只是因为已经迁移成功
      expect(existsSync(sessionFile(dir, '/tmp/旧书.txt'))).toBe(false)
      // 不看 calls[0]：**第一条** warn 是 writeSessionFile 自己那条「保存会话失败」，
      // 迁移那条在它之后。要看的是「迁移有没有报出这件事」，所以整组拼起来查。
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('未能落地')
    } finally {
      spy.mockRestore()
    }
    // 进度唯一的副本还在，下次启动会重试
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')).cursor).toBe(77)
  })

  // 第二扇门：**会话那一半写成功了**，「上次打开的是哪本」没落盘时同样不能删。触发条件：
  // 两次写之间磁盘满了，或 settings.json 被一个同名目录占住（写 .tmp 成功、renameSync 到
  // 目录失败）。少了这道闸，迁移好的记录没有任何人去读它——用户手动导入那本书就被 cursor 0 覆盖。
  it('迁移时 lastSourcePath 写不进去也不删旧文件', () => {
    const store = createSessionStore(dir)
    const legacy = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 55 })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(legacy), 'utf8')
    mkdirSync(join(dir, 'settings.json')) // 占位：让 settings.json 写不进去

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.migrateLegacySession()
      // 前提：会话那一半**确实写成功了**——否则下面的断言可能只是因为整条迁移根本没跑起来
      expect(existsSync(sessionFile(dir, '/tmp/旧书.txt'))).toBe(true)
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('未能落地')
    } finally {
      spy.mockRestore()
    }
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
  })
})
