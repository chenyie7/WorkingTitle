import { describe, it, expect, vi } from 'vitest'
import { TypingEngine, clampRatio } from '../../src/core/engine'
import { splitChapters } from '../../src/core/chapters'
import type { Novel, PersistedSession } from '../../src/core/types'

function makeNovel(text = '第一章 甲\nAAAAA\n第二章 乙\nBBBBB\n'): Novel {
  const { flatText, chapters } = splitChapters(text, '测试书')
  return {
    title: '测试书',
    sourcePath: '/tmp/测试书.txt',
    encoding: 'UTF-8',
    hadBom: false,
    flatText,
    chapters
  }
}

describe('clampRatio', () => {
  it('夹紧到 1..500 并取整', () => {
    expect(clampRatio(0)).toBe(1)
    expect(clampRatio(-5)).toBe(1)
    expect(clampRatio(10)).toBe(10)
    expect(clampRatio(10.6)).toBe(11)
    expect(clampRatio(9999)).toBe(500)
    expect(clampRatio(Number.NaN)).toBe(10)
    // 两条「太大」的策略刻意不同（见 clampRatio 的注释）：非有限值是不可用输入 → 默认值；
    // 有限的越界值 → 钳到上限。Infinity 走的是前者，与上面 9999 那行不是一个分支。
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(10)
  })
})

describe('TypingEngine 基础推进', () => {
  it('比例 10 时 pump(1) 抽出 10 个字', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 10 })
    e.pump(1)
    expect(e.getSnapshot().cursor).toBe(10)
    expect(e.visibleText).toBe(n.flatText.slice(0, 10))
    expect(e.visibleText).toHaveLength(10)
  })

  it('比例 1 时 pump(1) 只抽 1 个字', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    e.pump(1)
    expect(e.visibleText).toHaveLength(1)
  })

  it('比例 500 时 pump(1) 一次抽满上限', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 500 })
    e.pump(1)
    expect(e.getSnapshot().cursor).toBe(n.flatText.length)
    expect(e.visibleText).toBe(n.flatText)
  })

  it('pump(k) 一次上屏多个字时按 k × ratio 推进（输入法整词上屏）', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 3 })
    e.pump(4)
    expect(e.getSnapshot().cursor).toBe(12)
  })

  it('pump(0) 或负数不推进', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 10 })
    e.pump(0)
    e.pump(-3)
    expect(e.getSnapshot().cursor).toBe(0)
  })

  it('抵达末尾后 pump 为无操作', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 500 })
    const spy = vi.fn()
    e.subscribe(spy)
    e.pump(1)
    e.pump(1)
    expect(e.getSnapshot().cursor).toBe(n.flatText.length)
    // 「无操作」不只是游标不动，还必须【不通知】：末尾闸一旦去掉，状态完全相同、
    // 但每敲一键都换一次快照引用，useSyncExternalStore 于是持续重渲染
    // （变异实测：末尾连按三次，通知数 1 → 3）。
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('第一次 pump 记录 startedAt，后续不变', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    expect(e.getSnapshot().startedAt).toBeNull()
    e.pump(1, 1000)
    expect(e.getSnapshot().startedAt).toBe(1000)
    e.pump(1, 2000)
    expect(e.getSnapshot().startedAt).toBe(1000)
  })
})

describe('退格：只回吐显示，绝不改小说内容', () => {
  it('backspace 按 ratio 回退', () => {
    // 默认 fixture 只有 24 字，ratio 10 时 pump(3) = 30 会被夹紧到 24
    // （见 spec §2 的 min(cursor + k*ratio, flatText.length)），就测不出「按 ratio 回退」了。
    // 这里用一个足够长的单章小说，保证不触发末尾夹紧。
    const long = '第一章 甲\n' + 'A'.repeat(100) + '\n'
    const e = new TypingEngine(makeNovel(long), { ratio: 10 })
    e.pump(3)
    expect(e.getSnapshot().cursor).toBe(30)
    e.backspace(1)
    expect(e.getSnapshot().cursor).toBe(20)
  })

  it('backspace 不会退到 revealStart 之前', () => {
    // 本用例此前是【空的】：它构造出来的 revealStart 恰好是 0，于是「下界 = revealStart」
    // 与「下界 = 0」两种实现同值——把下界改成 0 它照样绿（变异实测）。
    // 要让它有牙，必须先把窗口起点推离 0，而跳章是唯一会移动 revealStart 的操作。
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 10 })
    e.pump(20)
    e.jumpToChapter(1)
    const before = e.getSnapshot()
    expect(before.revealStart).toBeGreaterThan(0) // 前提自检：起点确实不在 0，用例才不空

    e.backspace(20)
    const s = e.getSnapshot()
    // 下界本身，写成「恰好停在窗口起点」这个更精确的形式（它蕴含 cursor >= revealStart）。
    // 内容断言杀不掉下界变异：变异把游标退到 0 之后，slice(0, 0) 与 slice(12, 12) 都是空串。
    expect(s.cursor).toBe(s.revealStart)
    // 退格只回吐显示，窗口起点不动（spec §2 的 backspace 一行）。
    expect(s.revealStart).toBe(before.revealStart)
    // 结果与源数据比对，而非只测长度。
    expect(e.visibleText).toBe(n.flatText.slice(s.revealStart, s.cursor))

    // 输入闸：非正数与非数是【无操作】，而不是「按符号前进」。
    // 实测去掉 backspace 的 k > 0 闸：backspace(-1) 会让游标【前进】（12 → 22，多吐字），
    // backspace(NaN) 会把游标变成 NaN（chapterPos 里跟着出现 null）。两条都钉住契约。
    e.backspace(-1)
    expect(e.getSnapshot().cursor).toBe(s.cursor)
    e.backspace(Number.NaN)
    expect(e.getSnapshot().cursor).toBe(s.cursor)
  })

  it('backspace 不修改 novel.flatText 与 chapters', () => {
    const n = makeNovel()
    const before = n.flatText
    const chaptersBefore = JSON.stringify(n.chapters)
    const e = new TypingEngine(n, { ratio: 10 })
    e.pump(5)
    e.backspace(3)
    expect(n.flatText).toBe(before)
    expect(JSON.stringify(n.chapters)).toBe(chaptersBefore)
  })
})

describe('跨章节', () => {
  it('跨界打字时 revealStart 保持不变，阅读区连续', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 1 })
    const c0 = n.chapters[0]
    const c1 = n.chapters[1]
    // 推进到第二章中间。第二章区间是 [c0.charCount, c0.charCount + c1.charCount)，
    // 取中点才能确保已越过标题行（标题行位于该章开头），否则下面的 toContain(c1.title) 会失败。
    const steps = c0.charCount + Math.floor(c1.charCount / 2)
    for (let i = 0; i < steps; i++) e.pump(1)
    const s = e.getSnapshot()
    expect(s.revealStart).toBe(0)
    expect(s.activeChapter).toBe(1)
    expect(e.visibleText).toBe(n.flatText.slice(0, steps))
    expect(e.visibleText).toContain(c1.title)
  })

  it('比例大于整章长度时，被越过的整章标记为已读完', () => {
    // 用三章：默认的两章 fixture 里 prev === 0，收尾循环的起点写 prev 还是写 0 完全同值，
    // 那个变异在两种实现下都绿。先跳到第 2 章把 prev 推离 0，循环起点才可分辨。
    const n = makeNovel('第一章 甲\nAAAAA\n第二章 乙\nBBBBB\n第三章 丙\nCCCCC\n')
    const e = new TypingEngine(n, { ratio: 500 })
    e.jumpToChapter(1)
    e.pump(1)
    expect(e.getSnapshot().chapterPos[1]).toBe(n.chapters[1].charCount)
    // 且没读过的那一章【不能】被顺手标记为已读完——循环起点写成 0 时它会被写成 charCount。
    expect(e.getSnapshot().chapterPos[0]).toBe(0)
  })

  it('activeChapter 随光标推进而更新', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 1 })
    expect(e.getSnapshot().activeChapter).toBe(0)
    for (let i = 0; i < n.chapters[0].charCount; i++) e.pump(1)
    expect(e.getSnapshot().activeChapter).toBe(1)
  })
})

describe('章节跳转与回填', () => {
  it('跳到没读过的章：阅读区为空，游标在该章开头', () => {
    // 默认 fixture 只有 2 章，索引 2 越界——越界是无操作，另有专门用例覆盖
    // （见下面的「跳到越界索引为无操作」）。这里用第 2 章（索引 1），它在全新引擎上尚未读过。
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 1 })
    // 跳章必须通知订阅者：不通知则 Task 9 的列表与 Task 10 的正文都不会重渲染。
    const spy = vi.fn()
    e.subscribe(spy)
    e.jumpToChapter(1)
    expect(spy).toHaveBeenCalledTimes(1)
    const s = e.getSnapshot()
    expect(s.activeChapter).toBe(1)
    expect(s.revealStart).toBe(n.chapters[1].start)
    expect(s.cursor).toBe(n.chapters[1].start)
    expect(e.visibleText).toBe('')
  })

  it('跳到读过的章：回填该章上次的阅读进度', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 1 })
    e.jumpToChapter(1)
    for (let i = 0; i < 4; i++) e.pump(1)
    const savedCursor = e.getSnapshot().cursor
    const savedText = e.visibleText
    // 这条【不是】夹具自检，而是钉住 revealStart/窗口关系的那一条——无视 revealStart 的
    // 变异正是死在它上面（expected '第一章 甲\nAAAAA\n第二章 ' to have a length of 4
    // but got 16）。它与下面那条「窗口内容 = flatText.slice(revealStart, cursor)」是一对：
    // 少了后者，它就退化成只测长度；少了它，后者在空窗口上恒真。
    expect(savedText).toHaveLength(4)

    // 长度对不代表内容对：窗口内容必须与【源数据】直接比对。revealStart > 0 且窗口非空，
    // 这是整套用例里唯一能钉住「等长但内容错位」（把第 1 章的文字渲染到第 2 章的位置上）
    // 的地方——只测长度时那种变异 24 条用例全绿。
    const mid = e.getSnapshot()
    expect(mid.revealStart).toBeGreaterThan(0) // 前提：窗口起点不在 0
    expect(mid.cursor).toBeGreaterThan(mid.revealStart) // 前提：窗口非空
    expect(e.visibleText).toBe(n.flatText.slice(mid.revealStart, mid.cursor))

    // 离开去别处
    e.jumpToChapter(0)
    expect(e.visibleText).toBe('')

    // 跳回来：进度被回填
    e.jumpToChapter(1)
    expect(e.getSnapshot().cursor).toBe(savedCursor)
    expect(e.visibleText).toBe(savedText)
    // 回填的不只是 cursor，该章的 chapterPos 也要同步成章内相对偏移。
    expect(e.getSnapshot().chapterPos[1]).toBe(savedCursor - n.chapters[1].start)
  })

  it('跳到越界索引为无操作', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    e.pump(1)
    const before = e.getSnapshot()
    e.jumpToChapter(-1)
    e.jumpToChapter(99)
    expect(e.getSnapshot()).toBe(before)
  })

  it('退格后同步更新 chapterPos', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 1 })
    e.jumpToChapter(1)
    for (let i = 0; i < 4; i++) e.pump(1)
    expect(e.getSnapshot().chapterPos[1]).toBe(4)
    e.backspace(1)
    expect(e.getSnapshot().chapterPos[1]).toBe(3)
  })
})

describe('比例与模式', () => {
  it('setRatio 夹紧到 1..500 且不改动游标', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 10 })
    e.pump(1)
    const cursor = e.getSnapshot().cursor
    e.setRatio(9999)
    expect(e.getSnapshot().ratio).toBe(500)
    expect(e.getSnapshot().cursor).toBe(cursor)

    e.setRatio(0)
    expect(e.getSnapshot().ratio).toBe(1)

    const spy = vi.fn()
    e.subscribe(spy)
    e.setRatio(1)
    // 夹紧后与现值相同，仍然是「无实际变化」，不该通知（否则拖动比例滑块会持续重渲染）。
    expect(spy).not.toHaveBeenCalled()
  })

  it('setMode 切换输入模式', () => {
    const e = new TypingEngine(makeNovel())
    expect(e.getSnapshot().mode).toBe('ime')
    e.setMode('key')
    expect(e.getSnapshot().mode).toBe('key')

    const spy = vi.fn()
    e.subscribe(spy)
    e.setMode('key')
    // 设成与现值相同的模式是【无实际变化】，不该通知——通知一次就是一次快照更换与重渲染。
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('订阅与快照', () => {
  it('状态变化时通知订阅者，且快照引用只在变化时更换', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    const spy = vi.fn()
    const off = e.subscribe(spy)
    const spy2 = vi.fn()
    e.subscribe(spy2)

    const before = e.getSnapshot()
    expect(e.getSnapshot()).toBe(before)

    e.pump(1)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(e.getSnapshot()).not.toBe(before)

    const after = e.getSnapshot()
    expect(e.getSnapshot()).toBe(after)

    off()
    e.pump(1)
    expect(spy).toHaveBeenCalledTimes(1)
    // 第二个订阅者一直在收，且 off() 只摘掉自己——emit 是对所有订阅者广播。
    expect(spy2).toHaveBeenCalledTimes(2)
  })

  it('getSnapshot 交出的是只读快照，调用方改不动引擎', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    e.pump(1)
    const snap = e.getSnapshot()

    // 这条与 toSession 那条别名探针是两件事：这里探的是 getSnapshot 直接交出的内部状态。
    // 用 try 而不是「必须抛错」：冻结对象在严格模式下写会抛 TypeError，非严格模式下被
    // 静默丢弃，两种模式都必须保证引擎不变——所以断言的是值没变，而不是一定抛错。
    try {
      ;(snap.chapterPos as number[])[0] = 424242
    } catch {
      /* 严格模式：抛错也算通过 */
    }
    expect(e.getSnapshot().chapterPos[0]).toBe(1)
    expect(e.getSnapshot()).toBe(snap)
  })

  it('无实际变化的操作不触发通知', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    const spy = vi.fn()
    e.subscribe(spy)
    e.backspace(1) // cursor 已在 revealStart
    e.pump(0)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('持久化往返', () => {
  it('toSession / fromSession 保留游标、比例、模式与各章进度', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 7, mode: 'key' })
    e.pump(2, 1234)
    e.jumpToChapter(1)
    e.pump(1)
    const s = e.toSession()
    expect(s.startedAt).toBe(1234)

    const restored = TypingEngine.fromSession(n, s)
    expect(restored.getSnapshot()).toEqual(e.getSnapshot())
    expect(restored.visibleText).toBe(e.visibleText)

    const probe = e.toSession()
    probe.chapterPos[0] = 424242
    // toSession 必须交出【副本】：否则 Task 5 的持久化层一改返回值，就直接改到了
    // 引擎内部的 chapterPos（而 getSnapshot 交出去的还是同一个数组）。
    expect(e.toSession().chapterPos[0]).not.toBe(424242)
  })

  it('fromSession 会修复越界与畸形数据', () => {
    const n = makeNovel()
    const malformed: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: '/tmp/测试书.txt',
      ratio: 99999,
      mode: 'key',
      cursor: 999999,
      revealStart: 888888,
      chapterPos: [999999],
      activeChapter: 42,
      startedAt: null
    }
    const restored = TypingEngine.fromSession(n, malformed)
    const s = restored.getSnapshot()
    expect(s.ratio).toBe(500)
    expect(s.cursor).toBe(n.flatText.length)
    expect(s.revealStart).toBeLessThanOrEqual(s.cursor)
    expect(s.chapterPos).toHaveLength(n.chapters.length)
    expect(s.chapterPos.every((p) => p >= 0)).toBe(true)
    // 上界也必须夹。只断言 >= 0 的话 [999999] 会原样通过——而这条用例存在的理由
    // 正是「越界」，实测去掉 Math.min(v, c.charCount) 时它照样绿。
    expect(s.chapterPos.every((p, i) => p <= n.chapters[i].charCount)).toBe(true)
    expect(s.activeChapter).toBeGreaterThanOrEqual(0)
    expect(s.activeChapter).toBeLessThan(n.chapters.length)

    // 恢复出来的引擎必须【当场】满足自己的不变量：activeChapter 那一章的 chapterPos
    // 就等于 cursor 减去该章起点。畸形会话里 activeChapter 由 cursor 反推得出，
    // 而 chapterPos 是从会话里读来的——两者不同源时，这一条会红。
    // 实测（修复前）：这里读到 0，真值是 12。
    expect(s.chapterPos[s.activeChapter]).toBe(s.cursor - n.chapters[s.activeChapter].start)

    // mode 是从磁盘上的 JSON 读回来的（Task 5），字段没有任何类型保护：
    // 半截写入或手改都会落到这里，必须落到合法值上，而不是被原样带进引擎。
    const oddMode = { ...malformed, mode: 'garbage' } as unknown as PersistedSession
    expect(TypingEngine.fromSession(n, oddMode).getSnapshot().mode).toBe('ime')
  })

  it('陈旧会话（章节目录已被改过）恢复后：不变量成立，且跳到该章落在游标处', () => {
    // 4 章 / 48 字。会话里的 chapterPos 描述的是**另一份章节目录**——用户在同路径上改过小说，
    // 而 Task 12 只按 sourcePath 匹配会话，所以这是正常使用能到达的状态，不是手改文件。
    const n = makeNovel('第一章 甲\nAAAAA\n第二章 乙\nBBBBB\n第三章 丙\nCCCCC\n第四章 丁\nDDDDD\n')
    expect(n.chapters).toHaveLength(4) // 前提自检：夹具几何就是本条用例声称的那个
    expect(n.flatText).toHaveLength(48)
    const stale: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: '/tmp/测试书.txt',
      ratio: 10,
      mode: 'ime',
      cursor: 999999,
      revealStart: 0,
      chapterPos: [999999, -3],
      activeChapter: 0,
      startedAt: null
    }

    const restored = TypingEngine.fromSession(n, stale)
    const s = restored.getSnapshot()
    // 恢复当场满足不变量。修复前这里读到 0，而 cursor - start = 12。
    expect(s.chapterPos[s.activeChapter]).toBe(s.cursor - n.chapters[s.activeChapter].start)
    // 用户可见后果：跳到当前章必须落在游标处。修复前落在 36（第 4 章开头），而游标在 48（章末）
    // ——侧栏显示这一章 0% 而实际已读完，且点它一下反而把进度退回章首。
    restored.jumpToChapter(s.activeChapter)
    expect(restored.getSnapshot().cursor).toBe(s.cursor)
    expect(restored.getSnapshot().cursor).toBe(n.chapters[3].end)
  })

  it('重启后高亮跟随游标——「点了已读完的章」那次点击不会被回存', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 1 })
    for (let i = 0; i < n.flatText.length; i++) e.pump(1)
    e.jumpToChapter(0)
    // 偏差状态：jumpToChapter 刻意不走统一收尾，所以 activeChapter = 0 而 cursor 落在
    // 第 2 章开头（= 第 1 章的末尾）。实测 cursor=12、active=0、chapterPos=[12,12]。
    expect(e.getSnapshot().activeChapter).toBe(0)
    expect(e.getSnapshot().cursor).toBe(n.chapters[1].start)

    // fromSession 按 cursor 反推 activeChapter，无法区分「用户点了已读完的章」与脏数据，
    // 于是重启后高亮跟随游标（第 2 章）。这是刻意的取舍——信任会话里的 activeChapter
    // 会让陈旧/手改的会话驱动高亮，那是被别的断言抓住的变异。
    const restored = TypingEngine.fromSession(n, e.toSession())
    expect(restored.getSnapshot().activeChapter).toBe(1)
    // 而且这里的收尾**不是**无操作：修复写入用的是重算出来的那一章（第 2 章），
    // 会话里存的 chapterPos[1]=12 描述的是「游标在第 1 章」那个旧状态，
    // 所以它被改成 cursor-start = 0。实测 [12,12] → [12,0]，改完才自洽。
    expect(restored.getSnapshot().chapterPos).toEqual([12, 0])
    const rs = restored.getSnapshot()
    expect(rs.chapterPos[rs.activeChapter]).toBe(rs.cursor - n.chapters[rs.activeChapter].start)
  })
})

describe('随机序列下的不变量（播种，确定性）', () => {
  it('两千步随机操作后，七条不变量无一被破坏', () => {
    // 夹具几何前提：下面几处注释（退格的「默认 fixture 只有 24 字」、跳章的「只有 2 章」）
    // 一直只是声称，没有任何断言。样本一旦被改小或改成三章，这里立刻红。
    const probe = makeNovel()
    expect(probe.flatText).toHaveLength(24)
    expect(probe.chapters).toHaveLength(2)
    expect(probe.chapters.map((c) => c.charCount)).toEqual([12, 12])

    const THREE = '第一章 甲\nAAAAA\n第二章 乙\nBBBBB\n第三章 丙\nCCCCC\n'
    const novels = [makeNovel(), makeNovel(THREE), makeNovel('第一章 甲\n' + 'A'.repeat(100) + '\n')]

    // 确定性 LCG：失败可复现，不依赖 Math.random。
    let seed = 20261008
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }

    const violations: string[] = []
    for (const novel of novels) {
      const e = new TypingEngine(novel, { ratio: 1 })
      for (let step = 0; step < 2000; step++) {
        const roll = rnd()
        if (roll < 0.5) e.pump(rnd() < 0.7 ? 1 : 1 + Math.floor(rnd() * 4))
        else if (roll < 0.75) e.backspace(rnd() < 0.7 ? 1 : 1 + Math.floor(rnd() * 4))
        else if (roll < 0.95) e.jumpToChapter(Math.floor(rnd() * (novel.chapters.length + 1)))
        else e.setRatio(1 + Math.floor(rnd() * 600))

        const s = e.getSnapshot()
        const where = `${novel.chapters.length} 章 / 第 ${step} 步`
        if (!(s.revealStart <= s.cursor)) violations.push(`${where}: revealStart ${s.revealStart} > cursor ${s.cursor}`)
        if (!(s.cursor >= 0 && s.cursor <= novel.flatText.length))
          violations.push(`${where}: cursor ${s.cursor} 越界（长度 ${novel.flatText.length}）`)
        if (!(s.activeChapter >= 0 && s.activeChapter < novel.chapters.length))
          violations.push(`${where}: activeChapter ${s.activeChapter} 越界`)
        if (s.chapterPos.length !== novel.chapters.length)
          violations.push(`${where}: chapterPos 长度 ${s.chapterPos.length} ≠ ${novel.chapters.length}`)
        novel.chapters.forEach((c, i) => {
          if (!(s.chapterPos[i] >= 0 && s.chapterPos[i] <= c.charCount))
            violations.push(`${where}: chapterPos[${i}]=${s.chapterPos[i]} 越界（charCount ${c.charCount}）`)
        })
        const cur = novel.chapters[s.activeChapter]
        if (cur && s.chapterPos[s.activeChapter] !== s.cursor - cur.start)
          violations.push(
            `${where}: chapterPos[active]=${s.chapterPos[s.activeChapter]} ≠ cursor-start=${s.cursor - cur.start}`
          )
        // 窗口非空时，内容必须等于源切片——只测长度会漏掉等长错位。
        if (s.cursor > s.revealStart && e.visibleText !== novel.flatText.slice(s.revealStart, s.cursor))
          violations.push(`${where}: 窗口内容与 flatText.slice(revealStart, cursor) 不符`)
      }
    }
    expect(violations).toEqual([])
  })
})

describe('revealTo', () => {
  it('把光标设到指定位置，可增可减', () => {
    const e = new TypingEngine(makeNovel())
    e.revealTo(5)
    expect(e.visibleText).toBe(e.novel.flatText.slice(0, 5))
    // 【可减是刻意的】按 +/- 调铺满量时要把已经铺出来的字收回去
    e.revealTo(3)
    expect(e.visibleText).toBe(e.novel.flatText.slice(0, 3))
  })

  it('夹紧到 [0, 全文长度]', () => {
    const e = new TypingEngine(makeNovel())
    e.revealTo(-10)
    expect(e.visibleText).toBe('')
    e.revealTo(99999)
    expect(e.visibleText).toBe(e.novel.flatText)
  })

  it('非有限值是无操作，不会把游标写成 NaN', () => {
    // 【这条是承重的】Math.min(NaN, total) 与 Math.max(revealStart, NaN) 都返回 NaN，
    // 一路传到 commit 之后游标就成了 NaN——visibleText 变成空串、
    // 状态栏百分比变成 NaN%，而且再也恢复不了（后面每次 pump 都在 NaN 上算）。
    const e = new TypingEngine(makeNovel())
    e.revealTo(5)
    e.revealTo(Number.NaN)
    e.revealTo(Number.POSITIVE_INFINITY)
    expect(e.getSnapshot().cursor).toBe(5)
    expect(Number.isFinite(e.getSnapshot().cursor)).toBe(true)
  })

  it('走的是 commit，所以 chapterPos 与 activeChapter 跟着更新', () => {
    // 与 pump / backspace 共用同一条「统一收尾规则」：越过整章要把那些章标成读完
    const e = new TypingEngine(makeNovel())
    const second = e.novel.chapters[1]
    e.revealTo(second.start + 1)
    const s = e.getSnapshot()
    expect(s.activeChapter).toBe(1)
    expect(s.chapterPos[1]).toBe(1)
    // 第一章被整个越过 → 标成已读完
    expect(s.chapterPos[0]).toBe(e.novel.chapters[0].charCount)
  })

  it('光标没变时不 emit', () => {
    const e = new TypingEngine(makeNovel())
    const spy = vi.fn()
    e.subscribe(spy)
    e.revealTo(5)
    expect(spy).toHaveBeenCalledTimes(1)
    e.revealTo(5)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
