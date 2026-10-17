import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { splitChapters } from '../../src/core/chapters'
import { createLibraryStore, libraryId } from '../../src/main/libraryStore'
import { createSessionStore } from '../../src/main/sessionStore'
import { importNovelToLibrary, type ImportDeps } from '../../src/main/novelImport'
import type { Novel, PersistedSession } from '../../src/core/types'

let dataDir = ''
let srcDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'wt-import-data-'))
  srcDir = mkdtempSync(join(tmpdir(), 'wt-import-src-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(srcDir, { recursive: true, force: true })
})

/** 与 sessionStore 自己那套算法独立：换了算法这些用例要跟着红。 */
function sessionFile(sourcePath: string): string {
  const key = createHash('sha256').update(sourcePath, 'utf8').digest('hex').slice(0, 32)
  return join(dataDir, 'sessions', `${key}.json`)
}

function writeSource(content: string, name = '测试书.txt'): string {
  const p = join(srcDir, name)
  writeFileSync(p, content, 'utf8')
  return p
}

function makeSession(sourcePath: string): PersistedSession {
  return {
    novelTitle: '测试书',
    sourcePath,
    ratio: 10,
    mode: 'ime',
    cursor: 42,
    revealStart: 0,
    chapterPos: [42],
    activeChapter: 0,
    startedAt: null
  }
}

async function fakeOpenNovel(filePath: string): Promise<Novel> {
  const text = readFileSync(filePath, 'utf8')
  const { flatText, chapters } = splitChapters(text, '测试书')
  return { title: '测试书', sourcePath: filePath, encoding: 'UTF-8', hadBom: false, flatText, chapters }
}

function makeDeps(overrides: Partial<ImportDeps> = {}): ImportDeps {
  return {
    store: createSessionStore(dataDir),
    library: createLibraryStore(dataDir),
    openNovel: fakeOpenNovel,
    ...overrides
  }
}

describe('导入小说入库', () => {
  it('首次导入：拷贝入库、写 meta、旧会话迁到拷贝路径并删掉旧文件', async () => {
    const content = '第一章 甲\nAAAAAAAAAA\n'
    const src = writeSource(content)
    const deps = makeDeps()
    expect(deps.store.writeSession(makeSession(src)).ok).toBe(true)

    const result = await importNovelToLibrary(src, deps)

    expect(result.status).toBe('imported')
    const copyPath = result.novel.sourcePath
    expect(copyPath.startsWith(join(dataDir, 'library'))).toBe(true)
    expect(readFileSync(copyPath, 'utf8')).toBe(content)

    const entries = deps.library.listRawEntries()
    expect(entries.length).toBe(1)
    expect(entries[0].fileName).toBe('测试书.txt')
    expect(entries[0].meta?.originalPath).toBe(src)
    expect(entries[0].meta?.size).toBe(Buffer.byteLength(content))
    expect(entries[0].meta?.charCount).toBe(result.novel.flatText.length)

    expect(deps.store.readSession(copyPath)?.cursor).toBe(42)
    expect(existsSync(sessionFile(src))).toBe(false)
  })

  it('同路径再导入：already-imported，条目仍只有一个，importedAt 不变', async () => {
    const src = writeSource('第一章 甲\n')
    const deps = makeDeps()
    const first = await importNovelToLibrary(src, deps)
    const importedAt = deps.library.listRawEntries()[0].meta?.importedAt

    const second = await importNovelToLibrary(src, deps)

    expect(first.status).toBe('imported')
    expect(second.status).toBe('already-imported')
    expect(second.novel.sourcePath).toBe(first.novel.sourcePath)
    const entries = deps.library.listRawEntries()
    expect(entries.length).toBe(1)
    expect(entries[0].meta?.importedAt).toBe(importedAt)
  })

  it('拷贝件丢失后导入：repaired，拷贝恢复且 meta 的 charCount 更新', async () => {
    const src = writeSource('第一章 甲\n')
    const deps = makeDeps()
    const first = await importNovelToLibrary(src, deps)
    rmSync(first.novel.sourcePath)
    const updated = '第一章 甲\n第二章 乙\nBBBBBBBBBB\n'
    writeSource(updated)

    const second = await importNovelToLibrary(src, deps)

    expect(second.status).toBe('repaired')
    expect(readFileSync(second.novel.sourcePath, 'utf8')).toBe(updated)
    const meta = deps.library.listRawEntries()[0].meta
    expect(meta?.charCount).toBe(updated.length)
  })

  it('0 字节的文件当场拒绝', async () => {
    const src = writeSource('')
    await expect(importNovelToLibrary(src, makeDeps())).rejects.toThrow('这个文件是空的')
  })

  it('源文件不存在时给出可读的错误', async () => {
    await expect(importNovelToLibrary(join(srcDir, '没有这本书.txt'), makeDeps())).rejects.toThrow(
      '读不了这个文件'
    )
  })

  it('迁移失败：回滚书库条目，旧会话原样保留', async () => {
    const src = writeSource('第一章 甲\n')
    const deps = makeDeps()
    expect(deps.store.writeSession(makeSession(src)).ok).toBe(true)
    deps.store.copySession = () => false

    await expect(importNovelToLibrary(src, deps)).rejects.toThrow('阅读进度迁移失败')

    expect(deps.library.listRawEntries()).toEqual([])
    expect(existsSync(join(deps.library.dir, libraryId(src)))).toBe(false)
    expect(deps.store.readSession(src)?.cursor).toBe(42)
  })

  it('打开失败：回滚书库条目、删掉拷贝路径的会话，旧会话仍在', async () => {
    const src = writeSource('第一章 甲\n')
    const deps = makeDeps({
      openNovel: async () => {
        throw new Error('boom')
      }
    })
    expect(deps.store.writeSession(makeSession(src)).ok).toBe(true)
    const copyPath = join(deps.library.dir, libraryId(src), '测试书.txt')

    await expect(importNovelToLibrary(src, deps)).rejects.toThrow('boom')

    expect(deps.library.listRawEntries()).toEqual([])
    expect(existsSync(sessionFile(copyPath))).toBe(false)
    expect(deps.store.readSession(src)?.cursor).toBe(42)
  })
})
