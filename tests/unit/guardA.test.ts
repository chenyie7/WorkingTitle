// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PersistedSession } from '../../src/core/types'

// 注入一次「写到一半就死」的写入：把数据的前 20 字节落盘后抛错。
// 这不是「中断真实的 writeFileSync」（那是做不到的），而是把它【换掉】——
// 于是「进程死在写入中途」这件事在进程内变成可观测的。
let armed = false
let mockHits = 0
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    writeFileSync: (p: unknown, data: unknown, enc?: unknown) => {
      if (armed && typeof p === 'string' && p.includes('sessions')) {
        mockHits++
        actual.writeFileSync(p, String(data).slice(0, 20), 'utf8')
        throw new Error('模拟进程在写入中途被杀')
      }
      return (actual.writeFileSync as (...a: unknown[]) => void)(p, data, enc)
    }
  }
})

const { createSessionStore } = await import('../../src/main/sessionStore')

/** `makeSession()` 默认那本书的路径——按书取会话文件之后，读也要带上它。 */
const SRC = '/tmp/测试书.txt'

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

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-atomic-'))
  armed = false
  mockHits = 0
})
afterEach(() => {
  armed = false
  rmSync(dir, { recursive: true, force: true })
})

describe('writeSession 的原子替换', () => {
  it('一次半途而废的保存不得破坏上一份完好会话', () => {
    const store = createSessionStore(dir)
    const good = makeSession({ cursor: 4242 })
    store.writeSession(good)
    expect(store.readSession(SRC)).toEqual(good)

    armed = true
    store.writeSession(makeSession({ cursor: 999999 })) // 半途抛错，被 catch 吞掉
    armed = false

    // 前提自检：注入确实生效。少了这行，用例在「注入失效」时会静默退化成空跑。
    expect(mockHits).toBe(1)
    expect(store.readSession(SRC)).toEqual(good)
  })
})
