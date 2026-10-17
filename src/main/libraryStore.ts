import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'
import type { IpcResult } from '../core/api'
import type { LibraryMeta } from '../core/types'

const ID_RE = /^[0-9a-f]{32}$/
const META_NAME = 'meta.json'
let tempSeq = 0

export interface RawLibraryEntry {
  id: string
  meta: LibraryMeta | null
  fileName: string | null
  copyPath: string | null
  broken: boolean
}

export interface ImportPlan {
  kind: 'fresh' | 'existing' | 'repair' | 'rebuild'
  id: string
  fileName: string
  copyPath: string
  /** 只有 existing / repair 才有。 */
  meta: LibraryMeta | null
}

export interface LibraryStore {
  readonly dir: string
  isInsideLibrary(p: string): boolean
  planImport(sourcePath: string): ImportPlan
  copyIntoLibrary(sourcePath: string, plan: ImportPlan): void
  writeMeta(id: string, meta: LibraryMeta): IpcResult<void>
  readMeta(id: string): LibraryMeta | null
  listRawEntries(): RawLibraryEntry[]
  removeEntry(id: string): IpcResult<void>
}

export function libraryId(sourcePath: string): string {
  return createHash('sha256').update(resolve(sourcePath), 'utf8').digest('hex').slice(0, 32)
}

export function titleFromFileName(fileName: string): string {
  return basename(fileName, extname(fileName)) || '未命名'
}

export function libraryMetaProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return '不是一个对象'
  const m = v as Record<string, unknown>
  if (m.version !== 1) return 'version 不是 1'
  if (typeof m.originalPath !== 'string') return 'originalPath 不是字符串'
  if (
    typeof m.fileName !== 'string' ||
    m.fileName === '' ||
    m.fileName === '.' ||
    m.fileName === '..' ||
    basename(m.fileName) !== m.fileName
  ) {
    return 'fileName 不是合法文件名'
  }
  if (m.fileName.toLowerCase() === META_NAME) return 'fileName 是保留名'
  for (const key of ['importedAt', 'size', 'charCount']) {
    const n = m[key]
    if (typeof n !== 'number' || !Number.isFinite(n)) return `${key} 不是有限数字`
  }
  return null
}

export function createLibraryStore(baseDir: string): LibraryStore {
  const dir = join(baseDir, 'library')

  const entryDir = (id: string): string => join(dir, id)
  const metaPath = (id: string): string => join(entryDir(id), META_NAME)
  const tempName = (): string => `.tmp-${process.pid}-${++tempSeq}`

  const readMeta = (id: string): LibraryMeta | null => {
    if (!ID_RE.test(id)) return null
    try {
      const p = metaPath(id)
      if (!existsSync(p)) return null
      const parsed: unknown = JSON.parse(readFileSync(p, 'utf8'))
      const problem = libraryMetaProblem(parsed)
      if (problem !== null) {
        console.warn(`[wt] 书库元数据不合法（${problem}）：`, p)
        return null
      }
      return parsed as LibraryMeta
    } catch (err) {
      console.warn('[wt] 读取书库元数据失败：', err)
      return null
    }
  }

  const firstBookFile = (id: string): string | null => {
    try {
      const files = readdirSync(entryDir(id), { withFileTypes: true })
        .filter(
          (d) =>
            d.isFile() &&
            d.name !== META_NAME &&
            !d.name.startsWith('.') &&
            !d.name.endsWith('.tmp')
        )
        .map((d) => d.name)
      return files.length === 1 ? files[0] : null
    } catch {
      return null
    }
  }

  return {
    dir,

    isInsideLibrary(p: string): boolean {
      return resolve(p).startsWith(resolve(dir) + sep)
    },

    planImport(sourcePath: string): ImportPlan {
      const id = libraryId(sourcePath)
      const targetDir = entryDir(id)
      const base = basename(sourcePath)
      const fallbackName = base !== '' && base.toLowerCase() !== META_NAME ? base : '未命名.txt'
      if (!existsSync(targetDir)) {
        return {
          kind: 'fresh',
          id,
          fileName: fallbackName,
          copyPath: join(targetDir, fallbackName),
          meta: null
        }
      }
      const meta = readMeta(id)
      if (meta === null) {
        return {
          kind: 'rebuild',
          id,
          fileName: fallbackName,
          copyPath: join(targetDir, fallbackName),
          meta: null
        }
      }
      const copyPath = join(targetDir, meta.fileName)
      return {
        kind: existsSync(copyPath) ? 'existing' : 'repair',
        id,
        fileName: meta.fileName,
        copyPath,
        meta
      }
    },

    copyIntoLibrary(sourcePath: string, plan: ImportPlan): void {
      if (plan.kind === 'existing') return
      mkdirSync(dir, { recursive: true })

      if (plan.kind === 'repair') {
        const tmp = join(entryDir(plan.id), tempName())
        try {
          copyFileSync(sourcePath, tmp)
          renameSync(tmp, plan.copyPath)
        } catch (err) {
          rmSync(tmp, { force: true })
          throw err
        }
        return
      }

      const tmpDir = join(dir, tempName())
      mkdirSync(tmpDir, { recursive: true })
      try {
        copyFileSync(sourcePath, join(tmpDir, plan.fileName))
        if (plan.kind === 'rebuild') rmSync(entryDir(plan.id), { recursive: true, force: true })
        renameSync(tmpDir, entryDir(plan.id))
      } catch (err) {
        rmSync(tmpDir, { recursive: true, force: true })
        throw err
      }
    },

    writeMeta(id: string, meta: LibraryMeta): IpcResult<void> {
      if (!ID_RE.test(id)) return { ok: false, reason: 'id 不合法' }
      const problem = libraryMetaProblem(meta)
      if (problem !== null) return { ok: false, reason: `元数据不合法：${problem}` }
      const tmp = `${metaPath(id)}.${process.pid}.${++tempSeq}.tmp`
      try {
        mkdirSync(entryDir(id), { recursive: true })
        writeFileSync(tmp, JSON.stringify(meta), 'utf8')
        renameSync(tmp, metaPath(id))
        return { ok: true, value: undefined }
      } catch (err) {
        try {
          rmSync(tmp, { force: true })
        } catch (cleanupErr) {
          console.warn('[wt] 清理书库临时文件失败：', cleanupErr)
        }
        console.warn('[wt] 写入书库元数据失败：', err)
        return { ok: false, reason: '元数据写盘失败' }
      }
    },

    readMeta,

    listRawEntries(): RawLibraryEntry[] {
      let names: string[]
      try {
        names = readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && ID_RE.test(d.name))
          .map((d) => d.name)
      } catch {
        return []
      }
      return names.map((id) => {
        try {
          const meta = readMeta(id)
          if (meta !== null) {
            const copyPath = join(entryDir(id), meta.fileName)
            return {
              id,
              meta,
              fileName: meta.fileName,
              copyPath,
              broken: !existsSync(copyPath)
            }
          }
          const fallback = firstBookFile(id)
          return {
            id,
            meta: null,
            fileName: fallback,
            copyPath: fallback === null ? null : join(entryDir(id), fallback),
            broken: true
          }
        } catch (err) {
          console.warn('[wt] 读取书库条目失败：', id, err)
          return { id, meta: null, fileName: null, copyPath: null, broken: true }
        }
      })
    },

    removeEntry(id: string): IpcResult<void> {
      if (!ID_RE.test(id)) return { ok: false, reason: 'id 不合法' }
      try {
        rmSync(entryDir(id), { recursive: true, force: true })
        return { ok: true, value: undefined }
      } catch (err) {
        console.warn('[wt] 删除书库条目失败：', err)
        return { ok: false, reason: '删除书库条目失败' }
      }
    }
  }
}
