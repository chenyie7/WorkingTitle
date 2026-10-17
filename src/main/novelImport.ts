import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ImportNovelResult, LibraryMeta, Novel } from '../core/types'
import type { LibraryStore } from './libraryStore'
import type { SessionStore } from './sessionStore'

export interface ImportDeps {
  store: SessionStore
  library: LibraryStore
  openNovel: (filePath: string) => Promise<Novel>
}

export async function importNovelToLibrary(
  sourcePath: string,
  deps: ImportDeps
): Promise<ImportNovelResult> {
  const store = deps.store
  const library = deps.library
  // 书库 id 按 resolve 后的路径算；命令行给的相对路径否则与旧会话对不上。
  const src = resolve(sourcePath)

  let sourceSize: number
  try {
    sourceSize = statSync(src).size
  } catch (err) {
    throw new Error(`读不了这个文件：${err instanceof Error ? err.message : String(err)}`)
  }
  if (sourceSize === 0) throw new Error('这个文件是空的，换一个')

  const plan = library.planImport(src)
  library.copyIntoLibrary(src, plan)

  // 迁移必须先于打开：openNovelWithRule 要从会话里读分章规则。
  if (plan.kind === 'fresh' || plan.kind === 'rebuild') {
    const hadOldSession = store.readSession(src) !== null
    const migrated = store.copySession(src, plan.copyPath)
    if (hadOldSession && !migrated) {
      library.removeEntry(plan.id)
      store.deleteSession(plan.copyPath)
      throw new Error('阅读进度迁移失败')
    }
  }

  let novel: Novel
  try {
    novel = await deps.openNovel(plan.copyPath)
  } catch (err) {
    if (plan.kind === 'fresh' || plan.kind === 'rebuild') {
      library.removeEntry(plan.id)
      store.deleteSession(plan.copyPath)
    }
    throw err
  }

  if (plan.kind !== 'existing') {
    const meta: LibraryMeta = {
      version: 1,
      originalPath: plan.meta?.originalPath ?? src,
      fileName: plan.fileName,
      importedAt: plan.meta?.importedAt ?? Date.now(),
      size: sourceSize,
      charCount: novel.flatText.length
    }
    const wrote = library.writeMeta(plan.id, meta)
    if (!wrote.ok) {
      if (plan.kind === 'fresh' || plan.kind === 'rebuild') {
        library.removeEntry(plan.id)
        store.deleteSession(plan.copyPath)
      }
      throw new Error(wrote.reason)
    }
    // 整个导入成功之后才删旧会话：失败时旧进度原样还在。
    if (plan.kind === 'fresh' || plan.kind === 'rebuild') store.deleteSession(src)
  }

  return {
    novel,
    status:
      plan.kind === 'existing'
        ? 'already-imported'
        : plan.kind === 'repair'
          ? 'repaired'
          : 'imported'
  }
}
