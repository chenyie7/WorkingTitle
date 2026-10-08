import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore } from '../../src/main/sessionStore'
import type { PersistedSession } from '../../src/core/types'

function makeSession(cursor: number): PersistedSession {
  return {
    novelTitle: '测试书',
    sourcePath: '/tmp/测试书.txt',
    ratio: 10,
    mode: 'ime',
    cursor,
    revealStart: 0,
    chapterPos: [cursor, 0],
    activeChapter: 0,
    startedAt: null
  }
}

// 【这条守卫钉的是机制，guardA.test.ts 钉的是性质——两条都在，理由如下】
// 它看的是「整份换掉」与「就地截断」留下的差别：renameSync 会给 session.json 换上临时
// 文件的 inode，而 writeFileSync 对已存在的路径是原地截断、inode 不变。读文件【内容】
// 看不出这个差别——这正是原子性没有被任何内容级断言覆盖住的原因。
//
// 为什么这条机制型守卫值得留着：它不用 mock、不用 `@vitest-environment node`，在 jsdom 下
// 原样可跑。而「更该选的那条」是 guardA.test.ts——把写入换成「先写 20 字节再抛错」，直接
// 断言【一次半途而废的保存不得破坏上一份完好会话】。两者都能杀掉同一个回退，但只有 A 说的是
// 行为。A 的代价只是一个文件级 pragma（不是全局配置），所以两条都留：将来实现若改用第三方
// 的原子写工具，B 会继续通过却不再观测到任何有意义的东西，而 A 依然在测那件事。
//
// 【为什么这是确定成立的，而不只是这一次观测到】临时文件在改名【之前】就已创建，所以新
// inode 的分配发生在旧 inode 被释放之前，文件系统没有机会把它回收重用。实测连写 20 次：
// temp+rename 得到 20 个互不相同的 inode，改成直接写则 20 次都是同一个 inode。
//
// 【Windows 上跳过】这条守卫的前提是「inode 能区分不同文件」，而部分 Windows 与网络文件
// 系统对每个文件都报 0，于是【正确的实现】反而会红。Task 14 要做 Windows 验证，一条在正确
// 构建上失败的用例比没有用例更糟——会让人去找并不存在的缺陷。该平台上的性质由
// guardA.test.ts 覆盖，它不依赖 inode。
describe('session.json 是「整份换掉」而不是「就地截断」', () => {
  // 柯里化形式是唯一可用的形状：写成 it.skipIf(cond, name, fn) 时 Vitest 5 不报错，
  // 只是**一个用例都没注册**（整份文件报 "No test found in suite"），于是「加了守卫」
  // 会变成「守卫不在」。实测踩过。
  it.skipIf(process.platform === 'win32')(
    '重复写入后 inode 必须更换（换文件 = 读取方只会看到某一份完整文件）',
    (ctx) => {
      const dir = mkdtempSync(join(tmpdir(), 'wt-ino-'))
      try {
        const store = createSessionStore(dir)
        store.writeSession(makeSession(1))
        const sessionPath = join(dir, 'session.json')
        const first = statSync(sessionPath).ino
        store.writeSession(makeSession(2))
        const second = statSync(sessionPath).ino

        // 前提自检：这个文件系统确实给出有意义的 inode。报 0 时跳过而不是断言——
        // 在那种文件系统上这条守卫【按构造】无法工作，让它红等于谎报缺陷，
        // 而它声称覆盖的性质仍由 guardA.test.ts 守着。
        if (!(first > 0)) ctx.skip()
        expect(second).not.toBe(first)
        // 前提：第二次写真的发生了（否则 inode 变了也说明不了是这次写入造成的）
        expect(store.readSession()!.cursor).toBe(2)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  )
})
