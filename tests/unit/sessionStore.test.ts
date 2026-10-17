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
import { resolveShortcuts } from '../../src/core/shortcuts'
import {
  DEFAULT_DOC_TITLE,
  DEFAULT_RATIO,
  PAGE_FONT_SIZE_DEFAULT,
  defaultSettings
} from '../../src/core/types'
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
      lastSourcePath: '/tmp/A.txt',
      ratio: 10,
      // 后加的必填字段；这里给默认值，本用例要钉的是「清除记录不动设置」
      workDocPath: null,
      bossFillPercent: 100,
      pageFontSize: PAGE_FONT_SIZE_DEFAULT,
      // shortcuts 是后加的必填字段；这里给空表，本用例要钉的是「清除记录不动设置」
      shortcuts: {}
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
      lastSourcePath: '/tmp/A.txt',
      ratio: 10,
      workDocPath: null,
      bossFillPercent: 100,
      pageFontSize: PAGE_FONT_SIZE_DEFAULT,
      shortcuts: {}
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
      lastSourcePath: '/tmp/测试书.txt',
      ratio: 10,
      workDocPath: null,
      bossFillPercent: 100,
      pageFontSize: PAGE_FONT_SIZE_DEFAULT,
      shortcuts: {}
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
    { name: 'ratio 不是有限数字', token: 'ratio 不是有限数字', mangle: (s) => ({ ...s, ratio: '10' }) },
    { name: '记录是 null', token: '不是一个对象', mangle: () => null },
    { name: '记录是裸数字', token: '不是一个对象', mangle: () => 42 }
  ]

  it.each(BAD_SETTINGS)('设置里的 $name → 按默认值处理，且警告点出该字段', ({ mangle, token }) => {
    const store = createSessionStore(dir)
    const good: AppSettings = {
      docTitle: '季度汇报',
      themeSource: 'dark',
      darkPaper: true,
      lastSourcePath: null,
      ratio: 10,
      workDocPath: null,
      bossFillPercent: 100,
      pageFontSize: PAGE_FONT_SIZE_DEFAULT,
      shortcuts: {}
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

  // 【旧版记录里没有 ratio】它是后加的字段。若按必填校验，升级一次就会把用户改过的
  // 文档名 / 外观 / 纸张一起退回默认值——「缺字段」是旧版本，「写错」才是坏文件，
  // 这两件事必须分开：前者补上默认值，后者整份退回（上面那张表管的正是后者）。
  it('旧版没有 ratio 的 settings.json 仍被接受，并补上默认值', () => {
    const store = createSessionStore(dir)
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        docTitle: '季度汇报',
        themeSource: 'dark',
        darkPaper: true,
        lastSourcePath: '/tmp/A.txt'
      }),
      'utf8'
    )
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(store.readSettings()).toEqual({
        docTitle: '季度汇报',
        themeSource: 'dark',
        darkPaper: true,
        lastSourcePath: '/tmp/A.txt',
        ratio: DEFAULT_RATIO,
        // 与 ratio 同为「旧文件里没有、读时补上」的字段
        workDocPath: null,
        bossFillPercent: 100,
        pageFontSize: PAGE_FONT_SIZE_DEFAULT,
        shortcuts: {}
      })
      // 补默认值这条正常路径不该报 warn（一条在正常路径上也会响的告警等于没有告警）
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('旧版设置文件缺 workDocPath / bossFillPercent 时补默认值，且不冲掉用户原有的字段', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-'))
    // 手工写一份**旧版**形状：没有这两个键，但用户改过文档名与快捷键
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        docTitle: '季度汇报',
        themeSource: 'dark',
        darkPaper: true,
        lastSourcePath: '/tmp/A.txt',
        ratio: 25,
        shortcuts: { import: 'Ctrl+KeyI' }
      }),
      'utf8'
    )
    const s = createSessionStore(dir).readSettings()
    // 【这一条是本用例的全部意义】整份退回默认值的话，这四行全红
    expect(s.docTitle).toBe('季度汇报')
    expect(s.themeSource).toBe('dark')
    expect(s.ratio).toBe(25)
    expect(s.shortcuts).toEqual({ import: 'Ctrl+KeyI' })
    // 两个新键补成了默认值
    expect(s.workDocPath).toBeNull()
    expect(s.bossFillPercent).toBe(100)
  })

  it('workDocPath 结构不合法时整份退回默认值', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-'))
    const store = createSessionStore(dir)
    store.writeSettings({ ...defaultSettings(), docTitle: '季度汇报', workDocPath: 7 as unknown as string })
    const s = store.readSettings()
    expect(s.docTitle).toBe(DEFAULT_DOC_TITLE)
    expect(s.workDocPath).toBeNull()
  })

  it('bossFillPercent 不是有限数字时整份退回默认值', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-'))
    const store = createSessionStore(dir)
    store.writeSettings({
      ...defaultSettings(),
      docTitle: '季度汇报',
      bossFillPercent: Number.NaN
    })
    expect(store.readSettings().docTitle).toBe(DEFAULT_DOC_TITLE)
  })

  it('workDocPath 是字符串时照常读回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-'))
    const store = createSessionStore(dir)
    store.writeSettings({ ...defaultSettings(), workDocPath: '/tmp/周报.txt', bossFillPercent: 40 })
    const s = store.readSettings()
    expect(s.workDocPath).toBe('/tmp/周报.txt')
    expect(s.bossFillPercent).toBe(40)
  })

  it('旧版设置文件缺 pageFontSize 时补默认值，且不冲掉用户原有的字段', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-'))
    // 手工写一份**旧版**形状：有老板键那两个键（上一版加的），但没有 pageFontSize
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        docTitle: '季度汇报',
        themeSource: 'dark',
        darkPaper: true,
        lastSourcePath: '/tmp/A.txt',
        ratio: 25,
        workDocPath: null,
        bossFillPercent: 40,
        shortcuts: { import: 'Ctrl+KeyI' }
      }),
      'utf8'
    )
    const s = createSessionStore(dir).readSettings()
    // 【这一条是本用例的全部意义】整份退回默认值的话，这五行全红
    expect(s.docTitle).toBe('季度汇报')
    expect(s.ratio).toBe(25)
    expect(s.bossFillPercent).toBe(40)
    expect(s.shortcuts).toEqual({ import: 'Ctrl+KeyI' })
    // 新键补成了默认值
    expect(s.pageFontSize).toBe(PAGE_FONT_SIZE_DEFAULT)
  })

  it('pageFontSize 不是有限数字时整份退回默认值', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-'))
    const store = createSessionStore(dir)
    store.writeSettings({ ...defaultSettings(), docTitle: '季度汇报', pageFontSize: Number.NaN })
    expect(store.readSettings().docTitle).toBe(DEFAULT_DOC_TITLE)
  })

  it('pageFontSize 是数字时照常读回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-'))
    const store = createSessionStore(dir)
    store.writeSettings({ ...defaultSettings(), pageFontSize: 18 })
    expect(store.readSettings().pageFontSize).toBe(18)
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
    // 旧版写会话用的是 temp+rename，进程死在中间会留下这个半截文件。迁移要把它一起清掉，
    // 否则「清除阅读记录」之外的路径永远碰不到它——而它正是 clearReadingHistory 列表里
    // 那一项想清的东西（那一项由 Task 4 的另一条用例钉住，这里管的是迁移这一句）。
    writeFileSync(join(dir, 'session.json.tmp'), '{"novelTitle":"半', 'utf8')
    expect(existsSync(join(dir, 'session.json.tmp'))).toBe(true)

    store.migrateLegacySession()

    expect(store.readSession('/tmp/旧书.txt')).toEqual(legacy)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
    expect(existsSync(join(dir, 'session.json.tmp'))).toBe(false)
    // 旧版没有 settings.json，「上次打开的是哪本」原先只写在会话里；不补这一步，
    // 升级后的第一次启动会停在空状态——进度在，但没人去开那本书。
    expect(store.readSettings().lastSourcePath).toBe('/tmp/旧书.txt')
  })

  it('重复调用是幂等的（旧文件已删，第二次什么都不做）', () => {
    const store = createSessionStore(dir)
    writeFileSync(join(dir, 'session.json'), JSON.stringify(makeSession({ cursor: 5 })), 'utf8')
    store.migrateLegacySession()
    const after = store.readSession(SRC)
    // 前提：第一次迁移**确实搬了东西**——少了这行，一个空实现也能让这条用例全绿
    // （after 为 null 时 toEqual(null) 成立，而 not.toHaveBeenCalled() 对空实现同样成立）
    expect(after).not.toBeNull()

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

  it('旧会话文件不是合法 JSON 时不迁移、也不删除，并警告', () => {
    const store = createSessionStore(dir)
    writeFileSync(join(dir, 'session.json'), '{ 这不是 JSON', 'utf8')
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

  // 【判据为什么是「读得出来」而不是「有个文件在那儿」】一个存在但**读不出来**的 target
  // （写了一半就崩掉的那种）如果被当成「已经迁过了」，迁移就会跳过写、然后把旧文件删掉——
  // 用一个读不出来的残留压掉一份完好的旧记录。这条用例把那个 target 真的造成那样。
  it('新位置那份读不出来时，迁移仍然把旧记录写进去', () => {
    const store = createSessionStore(dir)
    const legacy = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 88 })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(legacy), 'utf8')
    mkdirSync(join(dir, 'sessions'), { recursive: true })
    writeFileSync(sessionFile(dir, '/tmp/旧书.txt'), '{"novelTitle":"半', 'utf8')

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.migrateLegacySession()
    } finally {
      spy.mockRestore()
    }

    // 旧记录被搬了过去（而不是被那份坏残留挡住）
    expect(store.readSession('/tmp/旧书.txt')).toEqual(legacy)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
  })

  // 【「上次打开的是哪本」那一半的短路】settings 里已经记着**另一本**书时，不去覆盖它：
  // 它已经有值就意味着设置这一半不需要迁移来补（旧版根本没有 settings.json，所以「已记着
  // 别的书」只可能是新版已经跑过、或用户在新版里开过别的书）。会话那一半照旧搬、旧文件
  // 照旧删——迁移负责的是「进度别丢」，不是「把 lastSourcePath 改成这本」。
  it('settings 已经记着另一本书时，不把它顶掉', () => {
    const store = createSessionStore(dir)
    const legacy = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 33 })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(legacy), 'utf8')
    store.writeSettings({
      docTitle: '季度汇报',
      themeSource: 'dark',
      darkPaper: true,
      lastSourcePath: '/tmp/另一本.txt',
      ratio: 10,
      workDocPath: null,
      bossFillPercent: 100,
      pageFontSize: PAGE_FONT_SIZE_DEFAULT,
      shortcuts: {}
    })

    store.migrateLegacySession()

    expect(store.readSettings().lastSourcePath).toBe('/tmp/另一本.txt')
    expect(store.readSession('/tmp/旧书.txt')).toEqual(legacy)
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
      // 前提：会话那次写**确实失败了**（而不是「本来就什么都没写」）。
      // 原先这里断言的是 `existsSync(sessionFile(dir, ...))` 为 false——但 `sessions` 是个
      // 普通文件，它下面任何路径的 existsSync 恒为 false，那条断言无论实现做什么都成立，
      // 是空的。改成钉住「失败这条 warn 真的出现过」。
      // 不看 calls[0]：**第一条** warn 是 writeSessionFile 自己那条「保存会话失败」，
      // 迁移那条在它之后。要看的是「迁移有没有报出这件事」，所以整组拼起来查。
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('保存会话失败')
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('未能落地')
    } finally {
      spy.mockRestore()
    }
    // 进度唯一的副本还在，下次启动会重试
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')).cursor).toBe(77)
    // 顺序的判据：会话那半没落地时，绝不能让 lastSourcePath 指向一本进度还没搬过去的书
    // ——否则下次启动自动打开它、600ms 后把 cursor 0 落盘，真进度就没了。
    expect(store.readSettings().lastSourcePath).toBeNull()
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

describe('shortcuts 字段的向后兼容', () => {
  it('旧版的 settings.json 没有 shortcuts 键，补成空表而不是整份退回默认值', () => {
    // 这是本次改动最容易毁数据的地方：settingsProblem 的取舍是「一个字段不合格就整份退回
    // 默认值」，而 shortcuts 是后加的必填字段——不特殊处理的话，老用户升级一次就把改过的
    // 文档名 / 外观 / 纸张一起丢掉。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        docTitle: '我的文档',
        themeSource: 'dark',
        darkPaper: true,
        lastSourcePath: '/tmp/某本书.txt'
      }),
      'utf8'
    )
    const store = createSessionStore(dir)
    const settings = store.readSettings()
    expect(settings.docTitle).toBe('我的文档')
    expect(settings.themeSource).toBe('dark')
    expect(settings.darkPaper).toBe(true)
    expect(settings.lastSourcePath).toBe('/tmp/某本书.txt')
    expect(settings.shortcuts).toEqual({})
  })

  it('shortcuts 不是对象时整份退回默认值（坏文件，与别处姿态一致）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: 'Meta+KeyO' }),
      'utf8'
    )
    expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
  })

  it('shortcuts 是数组时整份退回默认值', () => {
    // 【为什么要单列一条】`Array.isArray(sc)` 是**独立于** `typeof sc !== 'object'` 的一道
    // 守卫：数组的 typeof 恰好就是 'object'，少了它，`[]` 会被当成「一张合法的空表」放行。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: [] }),
      'utf8'
    )
    expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
  })

  it('shortcuts 是 null 时整份退回默认值，且警告点出是哪个字段', () => {
    // 【为什么要单列一条】`sc === null` 是**独立于** `typeof sc !== 'object'` 的一道守卫——
    // `typeof null` 恰好是 'object'。少了它，null 会走进 `Object.entries(null)` 抛错，
    // 被 readSettingsFile 的 catch 接住，返回值与干净拒绝**一模一样**（两边都是
    // defaultSettings()），差别只在那行警告：干净拒绝报 `shortcuts 不是对象`，
    // 抛异常报 `读取设置失败`。所以断言里必须带上 warn，否则这条用例没有区分能力。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: null }),
      'utf8'
    )
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('shortcuts 不是对象')
    } finally {
      spy.mockRestore()
    }
  })

  it('shortcuts 里某一条的值不是字符串时整份退回默认值，且警告点出是哪一条', () => {
    // 【断言里为什么必须带上那行 warn】只看返回值的话这条用例没有区分能力：把
    // `typeof spec !== 'string'` 这道守卫删掉，非字符串会一路走进 `shortcutProblem`、
    // 在 `spec.split` 上抛 TypeError——而 `readSettingsFile` 的 catch 也返回
    // `defaultSettings()`，于是返回值一模一样，变异体活下来。两边的差别只在那行警告里：
    // 干净拒绝报的是 `shortcuts.import 不是字符串`，抛异常报的是 `读取设置失败`。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { import: 123 } }),
      'utf8'
    )
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
        'shortcuts.import 不是字符串'
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('白名单外的键位整份退回默认值，且警告点出原因', () => {
    // 【这一条钉的是枚举里 `unsupported-key` 那半边】`problem === 'no-modifier'` 由
    // 「没带修饰键」那条用例覆盖，而 `'unsupported-key'` 此前零覆盖。
    //
    // 【拦住这只变异的是**返回值**断言，不是 warn】把枚举收成只剩 `'no-modifier'` 之后，
    // 白名单外的键位会被放行、**原样留在读回来的设置里**——实测红的就是
    // `toEqual(defaultSettings())` 那一行，warn 那行根本走不到。（这一点与上面那条 null
    // 用例相反：那条的变异是被 catch 接住的，返回值两边一样，只能靠 warn 分。）
    //
    // 下面那行 warn 断言钉的是**理由**：它要求这条是在 sessionStore 这一层被判成
    // 「不合法的快捷键（unsupported-key）」并报出来的。少了它，将来有人把这个校验块整个
    // 删掉、改由 core 的 `resolveShortcuts` 事后退默认值，最终生效的表看着一样，日志里却
    // 再也说不出是哪一条、按什么理由退的。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { import: 'Meta+IntlRo' } }),
      'utf8'
    )
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
        'shortcuts.import 不是合法的快捷键（unsupported-key）'
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('shortcuts 里有一条坏串时整份退回默认值', () => {
    // 【为什么是整份而不是只丢那一条】坏串意味着这个文件被人改过或写坏了；设置项全是
    // 可再生的，退回默认值是既有姿态。逐条退让会让「哪几条是我改的」变得无法解释。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { import: 'KeyO' } }),
      'utf8'
    )
    expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
  })

  it('macOS 的保留键**不**导致整份退回——它归 core 按平台逐条处理', () => {
    // 【这一条是钉住两层校验的分工，不是补一条覆盖率】`resolveShortcuts` 的逐条校验要是
    // 永远走不到，它就是纸面路径。保留键是平台相关的，必须**穿过** sessionStore 这一层
    // （它拿不到平台，判不了），到 core 那里才被退回默认值。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        ...defaultSettings(),
        docTitle: '还在',
        shortcuts: { import: 'Meta+KeyQ' }
      }),
      'utf8'
    )
    const settings = createSessionStore(dir).readSettings()
    // 文件本身没被当坏文件，其它字段照旧
    expect(settings.docTitle).toBe('还在')
    expect(settings.shortcuts).toEqual({ import: 'Meta+KeyQ' })
    // 到了 core 这一层才按平台分道扬镳
    expect(resolveShortcuts(settings.shortcuts, 'darwin').import).toBe('Meta+KeyO')
    expect(resolveShortcuts(settings.shortcuts, 'other').import).toBe('Meta+KeyQ')
  })

  it('shortcuts 里的未知 id 不拦——那是更新版本写的，本版本应当照常读', () => {
    // 【这一条的值必须是**结构上非法**的串】原先喂的是 `'Meta+KeyJ'`，它本身就合法，
    // 于是「只校验已知 id」与「一视同仁校验所有 id」两种实现结果一样——用例空转。
    // 换成没带修饰键的 `'KeyJ'` 才有区分能力：`isShortcutId` 那道守卫一旦被去掉，这个
    // 文件就会被当坏文件整份退回，下面第一行断言当场红。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { 'future-thing': 'KeyJ' } }),
      'utf8'
    )
    const settings = createSessionStore(dir).readSettings()
    expect(settings.shortcuts).toEqual({ 'future-thing': 'KeyJ' })
    // 未知 id 不参与解析，所以默认值一条都不受影响
    expect(resolveShortcuts(settings.shortcuts, 'other').import).toBe('Ctrl+KeyO')
  })

  it('合法的 shortcuts 原样读回来', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { import: 'Ctrl+KeyI' } }),
      'utf8'
    )
    expect(createSessionStore(dir).readSettings().shortcuts).toEqual({ import: 'Ctrl+KeyI' })
  })

  it('写进去的 shortcuts 能原样读回来（往返）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    const store = createSessionStore(dir)
    const settings = { ...defaultSettings(), shortcuts: { 'toggle-sidebar': 'Ctrl+Alt+KeyB' } }
    store.writeSettings(settings)
    expect(store.readSettings()).toEqual(settings)
  })
})

describe('写通道先校验再落盘', () => {
  it('writeSettings 拒绝不合法载荷，磁盘上原来那份不被覆盖', () => {
    const store = createSessionStore(dir)
    const good = { ...defaultSettings(), docTitle: '季度汇报' }
    expect(store.writeSettings(good).ok).toBe(true)
    const result = store.writeSettings({ ...good, ratio: Number.NaN })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('ratio 不是有限数字')
    expect(store.readSettings().docTitle).toBe('季度汇报')
  })

  it('writeSession 拒绝不合法载荷，上一份进度不被覆盖', () => {
    const store = createSessionStore(dir)
    const good = makeSession({ cursor: 120 })
    expect(store.writeSession(good).ok).toBe(true)
    const result = store.writeSession({ ...good, cursor: Number.NaN })
    expect(result.ok).toBe(false)
    expect(store.readSession('/tmp/测试书.txt')).toEqual(good)
  })

  it('clearReadingHistory 返回 ok，只清阅读记录、不碰设置', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession())
    store.writeSettings(defaultSettings())
    expect(store.clearReadingHistory().ok).toBe(true)
    expect(existsSync(join(dir, 'sessions'))).toBe(false)
    expect(existsSync(join(dir, 'settings.json'))).toBe(true)
  })
})
