import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createLibraryStore,
  libraryId,
  libraryMetaProblem,
  titleFromFileName
} from '../../src/main/libraryStore'
import type { LibraryMeta } from '../../src/core/types'

let dir = ''
let library: ReturnType<typeof createLibraryStore>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-library-'))
  library = createLibraryStore(dir)
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeSource(name: string, content = '第一章 甲\n正文。\n'): string {
  const p = join(dir, name)
  writeFileSync(p, content, 'utf8')
  return p
}

function makeMeta(copyPath: string, sourcePath: string, fileName: string): LibraryMeta {
  return {
    version: 1,
    originalPath: resolve(sourcePath),
    fileName,
    importedAt: 1000,
    size: statSync(copyPath).size,
    charCount: 9
  }
}

function importFresh(sourcePath: string): { id: string; copyPath: string } {
  const plan = library.planImport(sourcePath)
  library.copyIntoLibrary(sourcePath, plan)
  const meta = makeMeta(plan.copyPath, sourcePath, plan.fileName)
  expect(library.writeMeta(plan.id, meta).ok).toBe(true)
  return { id: plan.id, copyPath: plan.copyPath }
}

describe('libraryId 与标题', () => {
  it('同一路径稳定、不同路径不同，并对路径做 resolve', () => {
    expect(libraryId('/tmp/书.txt')).toBe(libraryId('/tmp/书.txt'))
    expect(libraryId('/tmp/A.txt')).not.toBe(libraryId('/tmp/B.txt'))
    expect(libraryId('/tmp/a/../书.txt')).toBe(libraryId('/tmp/书.txt'))
  })

  it('标题从文件名去扩展名', () => {
    expect(titleFromFileName('测试书.txt')).toBe('测试书')
    expect(titleFromFileName('没有扩展名')).toBe('没有扩展名')
  })
})

describe('导入计划', () => {
  it('首次导入是 fresh，并原样拷贝字节', () => {
    const src = makeSource('书.txt', '第一章 乙\n正文。\n')
    const { copyPath } = importFresh(src)

    expect(readFileSync(copyPath, 'utf8')).toBe('第一章 乙\n正文。\n')
    expect(library.planImport(src).kind).toBe('existing')
  })

  it('不同路径同内容算两本书', () => {
    const a = makeSource('A.txt', '同样的内容')
    const b = makeSource('B.txt', '同样的内容')
    const first = importFresh(a)
    const second = importFresh(b)
    expect(first.id).not.toBe(second.id)
    expect(library.listRawEntries()).toHaveLength(2)
  })

  it('拷贝件丢失后计划是 repair，补拷之后恢复', () => {
    const src = makeSource('书.txt')
    const { copyPath } = importFresh(src)
    rmSync(copyPath)

    const plan = library.planImport(src)
    expect(plan.kind).toBe('repair')
    library.copyIntoLibrary(src, plan)
    expect(existsSync(copyPath)).toBe(true)
    expect(library.planImport(src).kind).toBe('existing')
  })

  it('meta 不合法时计划是 rebuild', () => {
    const src = makeSource('书.txt')
    const { id } = importFresh(src)
    writeFileSync(join(dir, 'library', id, 'meta.json'), '{坏 json', 'utf8')

    expect(library.planImport(src).kind).toBe('rebuild')
    const plan = library.planImport(src)
    library.copyIntoLibrary(src, plan)
    expect(library.readMeta(id)).toBeNull()
  })

  it('meta 能解析但字段不合格时同样是 rebuild', () => {
    const src = makeSource('书.txt')
    const { id, copyPath } = importFresh(src)
    const invalid = { ...makeMeta(copyPath, src, '书.txt'), version: 2 }
    writeFileSync(join(dir, 'library', id, 'meta.json'), JSON.stringify(invalid), 'utf8')

    expect(library.planImport(src).kind).toBe('rebuild')
  })

  it('拷贝失败时清掉临时目录', () => {
    const missing = join(dir, '不存在.txt')
    const plan = library.planImport(missing)
    expect(() => library.copyIntoLibrary(missing, plan)).toThrow()
    const leftovers = existsSync(join(dir, 'library'))
      ? readdirSync(join(dir, 'library')).filter((n) => n.startsWith('.tmp-'))
      : []
    expect(leftovers).toEqual([])
  })
})

describe('meta 校验', () => {
  const ok: LibraryMeta = {
    version: 1,
    originalPath: '/tmp/书.txt',
    fileName: '书.txt',
    importedAt: 1,
    size: 10,
    charCount: 9
  }

  it('合格返回 null', () => {
    expect(libraryMetaProblem(ok)).toBeNull()
  })

  it('逐字段返回不合格字段名', () => {
    expect(libraryMetaProblem({ ...ok, version: 2 })).toContain('version')
    expect(libraryMetaProblem({ ...ok, originalPath: 1 })).toContain('originalPath')
    expect(libraryMetaProblem({ ...ok, fileName: '../逃逸.txt' })).toContain('fileName')
    expect(libraryMetaProblem({ ...ok, fileName: '' })).toContain('fileName')
    expect(libraryMetaProblem({ ...ok, importedAt: 'x' })).toContain('importedAt')
    expect(libraryMetaProblem({ ...ok, size: Number.NaN })).toContain('size')
    expect(libraryMetaProblem({ ...ok, charCount: 'x' })).toContain('charCount')
  })
})

describe('列表与删除', () => {
  it('列表忽略非 id 目录与临时目录，坏条目仍然返回', () => {
    const src = makeSource('书.txt')
    const { id, copyPath } = importFresh(src)
    rmSync(copyPath)

    mkdirSync(join(dir, 'library', '.tmp-1'), { recursive: true })
    mkdirSync(join(dir, 'library', '不是id'), { recursive: true })

    const entries = library.listRawEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe(id)
    expect(entries[0].broken).toBe(true)
    expect(entries[0].fileName).toBe('书.txt')
  })

  it('目录不存在时列表是空数组', () => {
    expect(library.listRawEntries()).toEqual([])
  })

  it('removeEntry 删掉整棵目录', () => {
    const src = makeSource('书.txt')
    const { id } = importFresh(src)
    expect(library.removeEntry(id).ok).toBe(true)
    expect(existsSync(join(dir, 'library', id))).toBe(false)
  })

  it('removeEntry 拒绝非法 id', () => {
    expect(library.removeEntry('../x').ok).toBe(false)
    expect(library.removeEntry('A'.repeat(32)).ok).toBe(false)
    expect(library.removeEntry('a'.repeat(31)).ok).toBe(false)
  })

  it('isInsideLibrary 只认书库目录内的路径', () => {
    expect(library.isInsideLibrary(join(dir, 'library', 'x', '书.txt'))).toBe(true)
    expect(library.isInsideLibrary(join(dir, '书.txt'))).toBe(false)
    expect(library.isInsideLibrary(join(dir, 'library-evil', '书.txt'))).toBe(false)
  })
})
