# 小说书库实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导入小说时拷贝一份到 `userData/library/<id>/`，之后一律读拷贝件；设置里新增「小说管理」页，可查看、切换、删除书；「清除阅读记录」改为只清当前书。

**Architecture:** 每本书一个目录（拷贝件 + `meta.json`），目录名是原文件绝对路径的 sha256 前 32 位。`Novel.sourcePath` 指向拷贝路径，`sessions/` 与单槽缓存机制不变。主进程新增 `libraryStore.ts` 负责书库文件系统，`ipc.ts` 负责编排导入、列表、删除。

**Tech Stack:** Electron 44 / TypeScript / React 19 / vitest + jsdom / Node `fs`（同步 API，与 `sessionStore.ts` 一致）。

**Spec:** `docs/superpowers/specs/2026-10-18-novel-library-design.md`

## Global Constraints

- 所有代码注释、提交信息、文档用中文。注释默认不写；只允许不变量、非显然取舍、外部系统怪癖、安全/数据风险四类，每条不超过 3 行。
- 不新增依赖。
- `src/core/` 不能出现 DOM 或 Node API（`tsconfig.node.json` 的 `lib` 是 `["ES2023"]`，且 core 被两个 project 同时检查）。
- 书库 id 一律匹配 `^[0-9a-f]{32}$`；`meta.fileName` 必须是 basename。
- 导入只读原文件，绝不修改它。
- 每个任务结束跑：`pnpm typecheck`、`pnpm vitest run <本任务测试文件>`。最终门禁：`pnpm test`（看 exit code，不看摘要行）与 `pnpm build`。
- 提交前先 `git branch --show-current`；`git add` 用显式路径；提交信息写进文件后用 `git commit -F <文件>`。
- 真机验收由用户执行，不写探针脚本或变异矩阵。

---

## 文件结构

**新建**

- `src/main/libraryStore.ts`：书库目录、元数据校验、导入计划与拷贝、列表遍历、删除。
- `src/main/library.ts`：`getLibraryStore()` 单例（`app.getPath('userData')`）。
- `src/renderer/src/components/LibraryPanel.tsx`：「小说管理」页内容。
- `tests/unit/libraryStore.test.ts`
- `tests/unit/libraryPanel.test.tsx`

**修改**

- `src/main/sessionStore.ts`：加 `deleteSession` / `copySession` / `deleteCacheFor` / `sessionFileMtime`；最后移除 `clearReadingHistory`。
- `src/main/channels.ts`、`src/core/api.ts`、`src/preload/index.ts`：新通道与类型。
- `src/core/types.ts`：`LibraryMeta` / `LibraryEntry` / `ImportNovelResult`。
- `src/main/ipc.ts`：导入编排、列表、删除、库外路径先入库。
- `src/renderer/src/components/SettingsDialog.tsx`、`Ribbon.tsx`：新页签与 prop 链。
- `src/renderer/src/App.tsx`：导入三态、从书库打开、删除当前书、清除语义。
- `src/renderer/src/state/ToolbarContext.tsx`：`onImport` 返回 `void | Promise<void>`。
- `src/renderer/src/styles/ribbon.css`：书库列表样式。
- 测试：`sessionStore.test.ts`、`ipcContract.test.ts`、`app.test.tsx`、`settings.test.tsx`、`tests/setup.ts`、`tests/e2e/app.spec.ts`。
- 文档：`CLAUDE.md`、`README.md`、`README.zh-CN.md`。

---

### Task 1: sessionStore 的删除、复制与时间

**Files:**
- Modify: `src/main/sessionStore.ts`
- Test: `tests/unit/sessionStore.test.ts`

**Interfaces:**
- Consumes: 现有 `sessionFile(sourcePath)` / `readSessionFile(file, sourcePath)` / `writeSessionFile(file, session)`。
- Produces:
  - `deleteSession(sourcePath: string): IpcResult<void>`
  - `copySession(fromSourcePath: string, toSourcePath: string): boolean`
  - `deleteCacheFor(sourcePath: string): void`
  - `sessionFileMtime(sourcePath: string): number | null`

- [ ] **Step 1: 写失败用例**

在 `tests/unit/sessionStore.test.ts` 末尾追加：

```ts
describe('书库用到的会话与缓存操作', () => {
  it('deleteSession 只删指定书', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession({ sourcePath: '/tmp/A.txt' }))
    store.writeSession(makeSession({ sourcePath: '/tmp/B.txt' }))

    expect(store.deleteSession('/tmp/A.txt').ok).toBe(true)
    expect(existsSync(sessionFile(dir, '/tmp/A.txt'))).toBe(false)
    expect(existsSync(sessionFile(dir, '/tmp/B.txt'))).toBe(true)
  })

  it('deleteSession 对不存在的文件也返回 ok', () => {
    const store = createSessionStore(dir)
    expect(store.deleteSession('/tmp/从来没有过.txt').ok).toBe(true)
  })

  it('copySession 把会话复制到新路径，旧文件仍在', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession({ sourcePath: '/tmp/原路径.txt', cursor: 42 }))

    expect(store.copySession('/tmp/原路径.txt', '/tmp/库/拷贝.txt')).toBe(true)
    expect(existsSync(sessionFile(dir, '/tmp/原路径.txt'))).toBe(true)

    const copied = store.readSession('/tmp/库/拷贝.txt')
    expect(copied?.sourcePath).toBe('/tmp/库/拷贝.txt')
    expect(copied?.cursor).toBe(42)
  })

  it('copySession 目标已可读时不覆盖', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession({ sourcePath: '/tmp/原路径.txt', cursor: 42 }))
    store.writeSession(makeSession({ sourcePath: '/tmp/库/拷贝.txt', cursor: 99 }))

    expect(store.copySession('/tmp/原路径.txt', '/tmp/库/拷贝.txt')).toBe(true)
    expect(store.readSession('/tmp/库/拷贝.txt')?.cursor).toBe(99)
  })

  it('copySession 源不存在时返回 false', () => {
    const store = createSessionStore(dir)
    expect(store.copySession('/tmp/没有.txt', '/tmp/库/拷贝.txt')).toBe(false)
  })

  it('sessionFileMtime 有会话给数字，没有给 null', () => {
    const store = createSessionStore(dir)
    expect(store.sessionFileMtime('/tmp/A.txt')).toBeNull()
    store.writeSession(makeSession({ sourcePath: '/tmp/A.txt' }))
    expect(typeof store.sessionFileMtime('/tmp/A.txt')).toBe('number')
  })

  it('deleteCacheFor 只删属于这本书的缓存', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src), DEFAULT_CHAPTER_RULE)

    store.deleteCacheFor('/tmp/别的书.txt')
    expect(existsSync(join(dir, 'novel-cache.json'))).toBe(true)

    store.deleteCacheFor(src)
    expect(existsSync(join(dir, 'novel-cache.json'))).toBe(false)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(false)
  })
})
```

- [ ] **Step 2: 跑用例确认失败**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: FAIL，报 `store.deleteSession is not a function`（或 TS 报缺少成员）。

- [ ] **Step 3: 加接口**

`src/main/sessionStore.ts` 的 `SessionStore` 接口里加：

```ts
  /** 删掉一本书的进度文件。文件不存在也算成功。 */
  deleteSession(sourcePath: string): IpcResult<void>
  /** 把一本书的会话写到另一个路径下，旧文件保留。目标已可读时短路。 */
  copySession(fromSourcePath: string, toSourcePath: string): boolean
  /** 单槽缓存属于这本书时，把两个缓存文件一起删掉。 */
  deleteCacheFor(sourcePath: string): void
  /** 会话文件的修改时间，用来排「最近阅读」。没有会话给 null。 */
  sessionFileMtime(sourcePath: string): number | null
```

- [ ] **Step 4: 实现**

放在 `clearReadingHistory` 之前：

```ts
    deleteSession(sourcePath: string): IpcResult<void> {
      if (typeof sourcePath !== 'string') return { ok: false, reason: '路径不是字符串' }
      try {
        rmSync(sessionFile(sourcePath), { force: true })
        return { ok: true, value: undefined }
      } catch (err) {
        console.warn('[wt] 删除会话失败：', err)
        return { ok: false, reason: '删除会话失败' }
      }
    },

    copySession(fromSourcePath: string, toSourcePath: string): boolean {
      const session = readSessionFile(sessionFile(fromSourcePath), fromSourcePath)
      if (session === null) return false
      const target = sessionFile(toSourcePath)
      // 目标已可读时短路：那一份通常更新（同一本书上一次已经迁过）。
      if (readSessionFile(target, toSourcePath) !== null) return true
      return writeSessionFile(target, { ...session, sourcePath: toSourcePath })
    },

    deleteCacheFor(sourcePath: string): void {
      try {
        if (!existsSync(cacheMetaPath)) return
        const parsed: unknown = JSON.parse(readFileSync(cacheMetaPath, 'utf8'))
        if (typeof parsed !== 'object' || parsed === null) return
        if ((parsed as Record<string, unknown>).sourcePath !== sourcePath) return
        rmSync(cacheMetaPath, { force: true })
        rmSync(cacheTextPath, { force: true })
      } catch (err) {
        console.warn('[wt] 删除小说缓存失败：', err)
      }
    },

    sessionFileMtime(sourcePath: string): number | null {
      if (typeof sourcePath !== 'string') return null
      try {
        return statSync(sessionFile(sourcePath)).mtimeMs
      } catch {
        return null
      }
    },
```

- [ ] **Step 5: 跑用例确认通过**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
cat > /tmp/wt-msg.txt <<'EOF'
feat: 会话存储支持按书删除与复制

书库删除要带走这本书的进度，旧版会话迁移要复制到拷贝路径。
EOF
git add src/main/sessionStore.ts tests/unit/sessionStore.test.ts
git commit -F /tmp/wt-msg.txt
```

---

### Task 2: libraryStore（书库文件系统）

**Files:**
- Create: `src/main/libraryStore.ts`
- Modify: `src/core/types.ts`
- Test: `tests/unit/libraryStore.test.ts`

**Interfaces:**
- Consumes: `LibraryMeta`（本任务新增）。
- Produces:
  - `libraryId(sourcePath: string): string`
  - `titleFromFileName(fileName: string): string`
  - `libraryMetaProblem(v: unknown): string | null`
  - `createLibraryStore(baseDir: string): LibraryStore`
  - `ImportPlan`、`RawLibraryEntry`、`LibraryStore` 类型。

- [ ] **Step 1: 加类型**

`src/core/types.ts` 末尾加：

```ts
export interface LibraryMeta {
  version: 1
  /** 原文件绝对路径（resolve 之后）。只用于说明与排查，重复判定靠目录名。 */
  originalPath: string
  /** 拷贝件的文件名。必须是 basename。 */
  fileName: string
  importedAt: number
  /** 拷贝件的字节数。 */
  size: number
  /** 解码后的全文长度，进度百分比的分母。 */
  charCount: number
}

export interface LibraryEntry {
  id: string
  title: string
  /** 拷贝路径；坏条目可能是空串。 */
  sourcePath: string
  originalPath: string
  size: number
  importedAt: number
  charCount: number
  /** 会话里的 cursor；没有会话为 0。 */
  cursor: number
  /** 会话文件 mtime；从没读过为 null。 */
  lastReadAt: number | null
  broken: boolean
}
```

- [ ] **Step 2: 写失败用例**

新建 `tests/unit/libraryStore.test.ts`：

```ts
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
```

- [ ] **Step 3: 跑用例确认失败**

Run: `pnpm vitest run tests/unit/libraryStore.test.ts`
Expected: FAIL，模块 `src/main/libraryStore.ts` 不存在。

- [ ] **Step 4: 写实现**

新建 `src/main/libraryStore.ts`：

```ts
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
        .filter((d) => d.isFile() && d.name !== META_NAME)
        .map((d) => d.name)
      return files.length === 1 ? files[0] : null
    } catch {
      return null
    }
  }

  return {
    dir,

    isInsideLibrary(p: string): boolean {
      const root = resolve(dir)
      const target = resolve(p)
      return target === root || target.startsWith(root + sep)
    },

    planImport(sourcePath: string): ImportPlan {
      const id = libraryId(sourcePath)
      const targetDir = entryDir(id)
      const fallbackName = basename(sourcePath) || '未命名.txt'
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
      try {
        mkdirSync(entryDir(id), { recursive: true })
        const target = metaPath(id)
        const tmp = `${target}.${process.pid}.${++tempSeq}.tmp`
        writeFileSync(tmp, JSON.stringify(meta), 'utf8')
        renameSync(tmp, target)
        return { ok: true, value: undefined }
      } catch (err) {
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
```

- [ ] **Step 5: 跑用例确认通过**

Run: `pnpm vitest run tests/unit/libraryStore.test.ts`
Expected: PASS。若 `copyIntoLibrary` 对不存在文件抛 `ENOENT` 的用例失败，检查 `mkdirSync` 是否在 `copyFileSync` 之前。

- [ ] **Step 6: 类型检查并提交**

Run: `pnpm typecheck`
Expected: exit 0。

```bash
cat > /tmp/wt-msg.txt <<'EOF'
feat: 书库文件系统

每本书一个目录，放拷贝件与 meta；按原路径判重，支持补拷与重建。
EOF
git add src/main/libraryStore.ts src/core/types.ts tests/unit/libraryStore.test.ts
git commit -F /tmp/wt-msg.txt
```

---

### Task 3: 导入、列表、删除接入主进程与 IPC

**Files:**
- Create: `src/main/library.ts`
- Modify: `src/main/channels.ts`、`src/core/api.ts`、`src/preload/index.ts`、`src/main/ipc.ts`、`src/core/types.ts`、`src/renderer/src/App.tsx`
- Test: `tests/unit/ipcContract.test.ts`、`tests/unit/app.test.tsx`、`tests/setup.ts`、`tests/e2e/app.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `copySession` / `deleteSession` / `deleteCacheFor` / `sessionFileMtime`；Task 2 的 `createLibraryStore`。
- Produces:
  - `CH.listNovels = 'wt:list-novels'`、`CH.deleteNovel = 'wt:delete-novel'`
  - `WtApi.importNovel(): Promise<IpcResult<ImportNovelResult>>`
  - `WtApi.listNovels(): Promise<LibraryEntry[]>`
  - `WtApi.deleteNovel(id: string): Promise<IpcResult<void>>`
  - `ImportNovelResult = { novel: Novel; status: 'imported' | 'already-imported' | 'repaired' }`

- [ ] **Step 1: 加结果类型**

`src/core/types.ts` 加：

```ts
export type ImportNovelStatus = 'imported' | 'already-imported' | 'repaired'

export interface ImportNovelResult {
  novel: Novel
  status: ImportNovelStatus
}
```

- [ ] **Step 2: 写失败用例**

`tests/unit/ipcContract.test.ts` 的 `CH` 断言里，在 `openNovelPath` 后加：

```ts
      listNovels: 'wt:list-novels',
      deleteNovel: 'wt:delete-novel',
```

Run: `pnpm vitest run tests/unit/ipcContract.test.ts`
Expected: FAIL（实际对象里没有这两个键）。

`tests/unit/app.test.tsx` 的 `installApi` 里，把 `importNovel` 改成：

```ts
    importNovel: vi.fn(async () =>
      novel
        ? { ok: true as const, value: { novel, status: 'imported' as const } }
        : { ok: false as const, reason: 'canceled' }
    ),
```

并在同一对象里、`clearSession` 之后加：

```ts
    listNovels: vi.fn(async () => []),
    deleteNovel: vi.fn(async () => ({ ok: true as const, value: undefined })),
```

Run: `pnpm vitest run tests/unit/app.test.tsx`
Expected: FAIL（`App` 里 `openNovel(result.value)` 现在拿到的是 `{novel, status}`，类型或运行期报错）。

- [ ] **Step 3: 加通道与 API**

`src/main/channels.ts` 在 `openNovelPath` 后加：

```ts
  listNovels: 'wt:list-novels',
  deleteNovel: 'wt:delete-novel',
```

`src/core/api.ts` 的类型导入加 `ImportNovelResult, LibraryEntry`，并把三个方法改成：

```ts
  importNovel: () => Promise<IpcResult<ImportNovelResult>>
  listNovels: () => Promise<LibraryEntry[]>
  deleteNovel: (id: string) => Promise<IpcResult<void>>
```

`src/preload/index.ts` 对应加：

```ts
  listNovels: () => ipcRenderer.invoke(CH.listNovels),
  deleteNovel: (id: string) => call<void>(CH.deleteNovel, id),
```

- [ ] **Step 4: 单例**

新建 `src/main/library.ts`：

```ts
import { app } from 'electron'
import { createLibraryStore, type LibraryStore } from './libraryStore'

let store: LibraryStore | null = null

/** 必须在 app ready 之后、且 setPath('userData') 之后调用。 */
export function getLibraryStore(): LibraryStore {
  if (!store) store = createLibraryStore(app.getPath('userData'))
  return store
}
```

- [ ] **Step 5: ipc 编排**

`src/main/ipc.ts` 顶部：

```ts
import { statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { getLibraryStore } from './library'
import { titleFromFileName } from './libraryStore'
import type {
  AppSettings,
  Chapter,
  ChapterRule,
  ImportNovelResult,
  LibraryEntry,
  LibraryMeta,
  Novel,
  PersistedSession
} from '../core/types'
```

在 `loadWorkDoc` 之后加：

```ts
async function importNovelToLibrary(sourcePath: string): Promise<ImportNovelResult> {
  const store = getStore()
  const library = getLibraryStore()

  let sourceSize: number
  try {
    sourceSize = statSync(sourcePath).size
  } catch (err) {
    throw new Error(`读不了这个文件：${err instanceof Error ? err.message : String(err)}`)
  }
  if (sourceSize === 0) throw new Error('这个文件是空的，换一个')

  const plan = library.planImport(sourcePath)
  library.copyIntoLibrary(sourcePath, plan)

  // 迁移必须先于打开：openNovelWithRule 要从会话里读分章规则。
  if (plan.kind === 'fresh' || plan.kind === 'rebuild') {
    store.copySession(sourcePath, plan.copyPath)
  }

  let novel: Novel
  try {
    novel = await openNovel(plan.copyPath)
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
      originalPath: plan.meta?.originalPath ?? resolve(sourcePath),
      fileName: plan.fileName,
      importedAt: plan.meta?.importedAt ?? Date.now(),
      size: statSync(plan.copyPath).size,
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
    if (plan.kind === 'fresh' || plan.kind === 'rebuild') store.deleteSession(sourcePath)
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
```

把 `importNovel` handler 的返回类型与调用改成：

```ts
  ipcMain.handle(CH.importNovel, async (): Promise<IpcResult<ImportNovelResult>> => {
```

以及：

```ts
      if (result.canceled || result.filePaths.length === 0) return { ok: false, reason: 'canceled' }
      return { ok: true, value: await importNovelToLibrary(result.filePaths[0]) }
```

把 `openNovelPath` handler 整个替换成：

```ts
  ipcMain.handle(CH.openNovelPath, async (_e, filePath: unknown): Promise<IpcResult<Novel>> => {
    if (typeof filePath !== 'string') return { ok: false, reason: '路径不是字符串' }
    try {
      if (getLibraryStore().isInsideLibrary(filePath)) {
        return { ok: true, value: await openNovel(filePath) }
      }
      return { ok: true, value: (await importNovelToLibrary(filePath)).novel }
    } catch (err) {
      console.warn('[wt] 打开小说失败：', filePath, err)
      return { ok: false, reason: `打开失败：${err instanceof Error ? err.message : String(err)}` }
    }
  })
```

在 `clearSession` handler 之后加：

```ts
  ipcMain.handle(CH.listNovels, (): LibraryEntry[] => {
    const store = getStore()
    const library = getLibraryStore()
    return library.listRawEntries().map((raw) => {
      const sourcePath = raw.copyPath ?? ''
      const session = sourcePath === '' ? null : store.readSession(sourcePath)
      return {
        id: raw.id,
        title: raw.fileName === null ? '无法读取的条目' : titleFromFileName(raw.fileName),
        sourcePath,
        originalPath: raw.meta?.originalPath ?? '',
        size: raw.meta?.size ?? 0,
        importedAt: raw.meta?.importedAt ?? 0,
        charCount: raw.meta?.charCount ?? 0,
        cursor: session?.cursor ?? 0,
        lastReadAt: sourcePath === '' ? null : store.sessionFileMtime(sourcePath),
        broken: raw.broken
      }
    })
  })

  ipcMain.handle(CH.deleteNovel, (_e, id: unknown): IpcResult<void> => {
    if (typeof id !== 'string') return { ok: false, reason: 'id 不是字符串' }
    const library = getLibraryStore()
    const raw = library.listRawEntries().find((entry) => entry.id === id)
    // 先删拷贝目录：失败就会话不动，书还在。
    const removed = library.removeEntry(id)
    if (!removed.ok) return removed
    if (raw?.copyPath == null) return { ok: true, value: undefined }
    const store = getStore()
    const session = store.deleteSession(raw.copyPath)
    store.deleteCacheFor(raw.copyPath)
    return session
  })
```

- [ ] **Step 6: App 处理导入结果**

`src/renderer/src/App.tsx` 的 `handleImport` 改成：

```ts
  const handleImport = useCallback(async () => {
    const api = getApi()
    if (!api) return
    const result = await api.importNovel()
    if (!result.ok) {
      if (result.reason !== 'canceled') notify(`导入失败：${result.reason}`)
      return
    }
    const { novel, status } = result.value
    if (status === 'already-imported') notify('这本书已经导入过了')
    else if (status === 'repaired') notify('这本书已经在书库里，拷贝文件已修复')
    await openNovel(novel)
  }, [openNovel, notify])
```

- [ ] **Step 7: 更新测试桩**

`tests/setup.ts` 的 `benignApi` 在 `openNovelPath` 后加：

```ts
  listNovels: async () => [],
  deleteNovel: async () => ({ ok: true, value: undefined }),
```

`tests/e2e/app.spec.ts` 的 `expected` 对象在 `resplitNovel` 后加：

```ts
    listNovels: 'function',
    deleteNovel: 'function',
```

- [ ] **Step 8: 跑测试**

Run: `pnpm vitest run tests/unit/ipcContract.test.ts tests/unit/app.test.tsx`
Expected: PASS。

Run: `pnpm typecheck`
Expected: exit 0。

- [ ] **Step 9: 提交**

```bash
cat > /tmp/wt-msg.txt <<'EOF'
feat: 导入小说拷贝入库并新增书库通道

导入返回三态（新导入 / 已导入 / 已修复），库外路径先拷贝再打开；
新增 listNovels 与 deleteNovel。
EOF
git add src/main/library.ts src/main/libraryStore.ts src/main/channels.ts src/main/ipc.ts src/core/api.ts src/core/types.ts src/preload/index.ts src/renderer/src/App.tsx tests/setup.ts tests/unit/ipcContract.test.ts tests/unit/app.test.tsx tests/e2e/app.spec.ts
git commit -F /tmp/wt-msg.txt
```

---

### Task 4: 小说管理页

**Files:**
- Create: `src/renderer/src/components/LibraryPanel.tsx`
- Modify: `src/renderer/src/components/SettingsDialog.tsx`、`src/renderer/src/components/Ribbon.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/state/ToolbarContext.tsx`、`src/renderer/src/styles/ribbon.css`
- Test: `tests/unit/libraryPanel.test.tsx`、`tests/unit/settings.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `listNovels` / `deleteNovel` / `openNovelPath`；`useToolbar().onImport`。
- Produces:
  - `LibraryPanel` 组件
  - `SettingsDialogProps` 新增 `currentSourcePath` / `onOpenNovel` / `onDeleteNovel`
  - `Ribbon` 同名可选 props
  - `ToolbarValue.onImport: () => void | Promise<void>`

- [ ] **Step 1: 写失败用例**

新建 `tests/unit/libraryPanel.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { LibraryPanel } from '../../src/renderer/src/components/LibraryPanel'
import { ToolbarProvider } from '../../src/renderer/src/state/ToolbarContext'
import { defaultSettings } from '../../src/core/types'
import type { LibraryEntry } from '../../src/core/types'
import type { WtApi } from '../../src/core/api'

const entries: LibraryEntry[] = [
  {
    id: 'a'.repeat(32),
    title: '甲书',
    sourcePath: '/lib/a/甲书.txt',
    originalPath: '/src/甲书.txt',
    size: 2048,
    importedAt: 100,
    charCount: 1000,
    cursor: 500,
    lastReadAt: 100,
    broken: false
  },
  {
    id: 'b'.repeat(32),
    title: '乙书',
    sourcePath: '/lib/b/乙书.txt',
    originalPath: '/src/乙书.txt',
    size: 1024 * 1024,
    importedAt: 300,
    charCount: 2000,
    cursor: 0,
    lastReadAt: 200,
    broken: false
  },
  {
    id: 'c'.repeat(32),
    title: '坏书',
    sourcePath: '/lib/c/坏书.txt',
    originalPath: '/src/坏书.txt',
    size: 10,
    importedAt: 50,
    charCount: 10,
    cursor: 0,
    lastReadAt: null,
    broken: true
  }
]

function installApi(overrides: Partial<WtApi> = {}): void {
  ;(window as unknown as { api: WtApi }).api = {
    platform: 'darwin',
    importNovel: async () => ({ ok: false, reason: 'canceled' }),
    importWorkDoc: async () => ({ ok: false, reason: 'canceled' }),
    loadWorkDoc: async () => null,
    loadWorkDocImage: async () => null,
    openNovelPath: async () => ({ ok: false, reason: '测试桩' }),
    resplitNovel: async () => ({ ok: false, reason: '测试桩' }),
    initialNovelPath: async () => null,
    loadSession: async () => null,
    saveSession: async () => ({ ok: true, value: undefined }),
    clearSession: async () => ({ ok: true, value: undefined }),
    loadSettings: async () => defaultSettings(),
    saveSettings: async () => ({ ok: true, value: undefined }),
    onMenuCommand: () => () => {},
    getTheme: async () => false,
    setThemeSource: async () => ({ ok: true, value: undefined }),
    onThemeChange: () => () => {},
    listNovels: vi.fn(async () => entries),
    deleteNovel: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides
  }
}

function setup(overrides: Partial<WtApi> = {}) {
  installApi(overrides)
  const onImport = vi.fn(async () => {})
  const onOpenNovel = vi.fn(async () => true)
  const onDeleteNovel = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const onClose = vi.fn()
  render(
    <ToolbarProvider onImport={onImport}>
      <LibraryPanel
        active
        currentSourcePath="/lib/b/乙书.txt"
        onOpenNovel={onOpenNovel}
        onDeleteNovel={onDeleteNovel}
        onClose={onClose}
      />
    </ToolbarProvider>
  )
  return { onImport, onOpenNovel, onDeleteNovel, onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LibraryPanel', () => {
  it('按最近阅读排序并显示进度', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('乙书')).toBeTruthy())
    const rows = screen.getAllByTestId(/^library-row-/)
    expect(within(rows[0]).getByText('乙书')).toBeTruthy()
    expect(within(rows[1]).getByText('甲书')).toBeTruthy()
    expect(screen.getByText(/已读 50%/)).toBeTruthy()
  })

  it('当前书标「正在阅读」且没有打开按钮', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('正在阅读')).toBeTruthy())
    const row = screen.getByTestId(`library-row-${'b'.repeat(32)}`)
    expect(within(row).queryByText('打开')).toBeNull()
  })

  it('坏条目只显示「文件丢失」，不能打开', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('文件丢失')).toBeTruthy())
    const row = screen.getByTestId(`library-row-${'c'.repeat(32)}`)
    expect(within(row).queryByText('打开')).toBeNull()
  })

  it('打开一本书：调用 onOpenNovel 后关闭对话框', async () => {
    const { onOpenNovel, onClose } = setup()
    await waitFor(() => expect(screen.getByText('甲书')).toBeTruthy())
    const row = screen.getByTestId(`library-row-${'a'.repeat(32)}`)
    fireEvent.click(within(row).getByText('打开'))
    await waitFor(() => expect(onOpenNovel).toHaveBeenCalledWith('/lib/a/甲书.txt'))
    expect(onClose).toHaveBeenCalled()
  })

  it('删除要二次确认，确认后调用 onDeleteNovel 并重拉列表', async () => {
    const { onDeleteNovel } = setup()
    await waitFor(() => expect(screen.getByText('甲书')).toBeTruthy())
    const row = screen.getByTestId(`library-row-${'a'.repeat(32)}`)
    fireEvent.click(within(row).getByText('删除'))
    expect(within(row).getByText(/不可恢复/)).toBeTruthy()
    fireEvent.click(within(row).getByText('确认删除'))
    await waitFor(() => expect(onDeleteNovel).toHaveBeenCalled())
    const listNovels = window.api.listNovels as unknown as { mock: { calls: unknown[][] } }
    await waitFor(() => expect(listNovels.mock.calls.length).toBeGreaterThan(1))
  })

  it('导入按钮走 onImport，完成后重拉列表', async () => {
    const { onImport } = setup()
    await waitFor(() => expect(screen.getByText('甲书')).toBeTruthy())
    fireEvent.click(screen.getByTestId('library-import'))
    await waitFor(() => expect(onImport).toHaveBeenCalled())
    const listNovels = window.api.listNovels as unknown as { mock: { calls: unknown[][] } }
    await waitFor(() => expect(listNovels.mock.calls.length).toBeGreaterThan(1))
  })

  it('空书库显示空态', async () => {
    setup({ listNovels: vi.fn(async () => []) })
    await waitFor(() => expect(screen.getByText('书库里还没有小说')).toBeTruthy())
  })
})
```

- [ ] **Step 2: 跑用例确认失败**

Run: `pnpm vitest run tests/unit/libraryPanel.test.tsx`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 LibraryPanel**

新建 `src/renderer/src/components/LibraryPanel.tsx`：

```tsx
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { IpcResult } from '../../../core/api'
import type { LibraryEntry } from '../../../core/types'
import { getApi } from '../api'
import { useToolbar } from '../state/ToolbarContext'
import { IconBibliography, IconImport } from './icons'

export interface LibraryPanelProps {
  /** 当前页是不是「小说管理」。面板始终挂载，靠这个值判断何时拉数据。 */
  active: boolean
  currentSourcePath: string | null
  onOpenNovel: (sourcePath: string) => Promise<boolean>
  onDeleteNovel: (entry: LibraryEntry) => Promise<IpcResult<void>>
  onClose: () => void
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function progressOf(entry: LibraryEntry): number {
  if (entry.charCount <= 0) return 0
  return Math.min(100, Math.floor((entry.cursor / entry.charCount) * 100))
}

export function LibraryPanel({
  active,
  currentSourcePath,
  onOpenNovel,
  onDeleteNovel,
  onClose
}: LibraryPanelProps): ReactElement {
  const { onImport, notify } = useToolbar()
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const api = getApi()
    if (!api) {
      setEntries([])
      return
    }
    try {
      setEntries(await api.listNovels())
    } catch {
      setEntries([])
    }
  }, [])

  useEffect(() => {
    if (active) void refresh()
  }, [active, refresh])

  const handleImport = async (): Promise<void> => {
    setPending(true)
    try {
      await onImport()
      await refresh()
    } finally {
      setPending(false)
    }
  }

  const handleOpen = async (entry: LibraryEntry): Promise<void> => {
    setPending(true)
    try {
      if (await onOpenNovel(entry.sourcePath)) onClose()
    } finally {
      setPending(false)
    }
  }

  const handleDelete = async (entry: LibraryEntry): Promise<void> => {
    setPending(true)
    try {
      const result = await onDeleteNovel(entry)
      if (!result.ok) notify(`删除失败：${result.reason}`)
      setConfirmId(null)
      await refresh()
    } finally {
      setPending(false)
    }
  }

  const sorted = [...(entries ?? [])].sort(
    (a, b) => (b.lastReadAt ?? b.importedAt) - (a.lastReadAt ?? a.importedAt)
  )

  return (
    <div className="wt-library">
      <div className="wt-library__head">
        <span className="wt-library__title">
          <IconBibliography className="wt-modal__label-icon" />
          书库
        </span>
        <button
          type="button"
          className="wt-btn wt-btn--primary"
          data-testid="library-import"
          disabled={pending}
          onClick={() => void handleImport()}
        >
          <IconImport className="wt-btn__icon" />
          导入小说
        </button>
      </div>

      {entries === null ? (
        <p className="wt-library__empty">正在读取书库…</p>
      ) : entries.length === 0 ? (
        <p className="wt-library__empty">书库里还没有小说</p>
      ) : (
        <ul className="wt-library__list">
          {sorted.map((entry) => {
            const current = entry.sourcePath === currentSourcePath
            return (
              <li
                key={entry.id}
                data-testid={`library-row-${entry.id}`}
                className={`wt-library__row ${current ? 'wt-library__row--current' : ''}`}
              >
                <div className="wt-library__main">
                  <span className="wt-library__name">{entry.title}</span>
                  <span className="wt-library__meta">
                    {entry.broken ? (
                      <span className="wt-library__broken">文件丢失</span>
                    ) : (
                      <>
                        已读 {progressOf(entry)}% · {formatSize(entry.size)} · 导入于{' '}
                        {formatDate(entry.importedAt)}
                      </>
                    )}
                  </span>
                </div>
                <div className="wt-library__actions">
                  {current && <span className="wt-library__badge">正在阅读</span>}
                  {!entry.broken && !current && (
                    <button
                      type="button"
                      className="wt-btn"
                      disabled={pending}
                      onClick={() => void handleOpen(entry)}
                    >
                      打开
                    </button>
                  )}
                  {confirmId === entry.id ? (
                    <>
                      <span className="wt-library__confirm">
                        将同时删除拷贝文件与阅读进度，不可恢复
                      </span>
                      <button
                        type="button"
                        className="wt-btn wt-library__danger"
                        disabled={pending}
                        onClick={() => void handleDelete(entry)}
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        className="wt-btn"
                        disabled={pending}
                        onClick={() => setConfirmId(null)}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="wt-btn"
                      disabled={pending}
                      onClick={() => setConfirmId(entry.id)}
                    >
                      删除
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 样式**

`src/renderer/src/styles/ribbon.css` 末尾加：

```css
/* ---- 小说管理页 ---- */
.wt-library {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  min-height: 0;
}

.wt-library__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.wt-library__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.wt-library__empty {
  margin: 0;
  font-size: 12px;
  color: var(--wt-text-muted);
}

.wt-library__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}

.wt-library__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--wt-chrome-border);
  border-radius: var(--wt-radius);
}

.wt-library__row--current {
  border-color: var(--wt-primary);
  background: var(--wt-chrome);
}

.wt-library__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.wt-library__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wt-library__meta {
  font-size: 11px;
  color: var(--wt-text-muted);
}

.wt-library__broken {
  color: var(--wt-danger);
}

.wt-library__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.wt-library__badge {
  font-size: 11px;
  color: var(--wt-primary);
}

.wt-library__confirm {
  max-width: 220px;
  font-size: 11px;
  color: var(--wt-danger);
}

.wt-library__danger {
  color: var(--wt-danger);
}
```

- [ ] **Step 5: 接进 SettingsDialog**

`SettingsDialog.tsx`：

1. 导入里加 `IconBibliography`，并加 `import { LibraryPanel } from './LibraryPanel'`。
2. 类型导入加 `LibraryEntry`。
3. `SettingsDialogProps` 加：

```ts
  /** 当前正在读的那本书的拷贝路径；null＝没打开小说。 */
  currentSourcePath: string | null
  /** 从书库打开一本。返回是否成功——成功才关对话框。 */
  onOpenNovel: (sourcePath: string) => Promise<boolean>
  /** 删除一本。渲染层对「删的是当前书」的状态清理在 App 里做。 */
  onDeleteNovel: (entry: LibraryEntry) => Promise<IpcResult<void>>
```

4. `PAGES` 改成：

```ts
const PAGES = [
  { id: 'reading', label: '阅读设置', icon: IconBook },
  { id: 'library', label: '小说管理', icon: IconBibliography },
  { id: 'appearance', label: '外观设置', icon: IconDarkTheme },
  { id: 'shortcuts', label: '快捷键设置', icon: IconKeyboard },
  { id: 'chapters', label: '分章设置', icon: IconToc }
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: FluentIcon }>
```

5. 展开参数列表加 `currentSourcePath, onOpenNovel, onDeleteNovel`。
6. 在「阅读设置」面板之后加：

```tsx
            <div
              className="wt-tabpanel"
              role="tabpanel"
              id="wt-tabpanel-library"
              aria-labelledby="wt-tab-library"
              data-testid="settings-tabpanel-library"
              hidden={page !== 'library'}
            >
              <LibraryPanel
                active={page === 'library'}
                currentSourcePath={currentSourcePath}
                onOpenNovel={onOpenNovel}
                onDeleteNovel={onDeleteNovel}
                onClose={onClose}
              />
            </div>
```

- [ ] **Step 6: Ribbon 透传**

`Ribbon.tsx` 参数列表加默认值：

```ts
  currentSourcePath = null,
  onOpenNovel = ignoreOpenNovel,
  onDeleteNovel = ignoreDeleteNovel,
```

类型声明加：

```ts
  /** 当前书的拷贝路径；null＝没打开。 */
  currentSourcePath?: string | null
  onOpenNovel?: (sourcePath: string) => Promise<boolean>
  onDeleteNovel?: (entry: LibraryEntry) => Promise<IpcResult<void>>
```

文件顶部加 `import type { LibraryEntry } from '../../../core/types'`，并加两个默认实现：

```ts
const ignoreOpenNovel = async (): Promise<boolean> => false
const ignoreDeleteNovel = async (): Promise<IpcResult<void>> => ({
  ok: false,
  reason: '未接线'
})
```

`<SettingsDialog>` 上补：

```tsx
        currentSourcePath={currentSourcePath}
        onOpenNovel={onOpenNovel}
        onDeleteNovel={onDeleteNovel}
```

- [ ] **Step 7: ToolbarContext 允许异步导入**

`ToolbarValue.onImport` 与 `ToolbarProviderProps.onImport` 的类型都改成：

```ts
  onImport: () => void | Promise<void>
```

provider 的默认实现不用改。

- [ ] **Step 8: App 接线**

`App.tsx` 加类型导入 `LibraryEntry`，并在 `handleImport` 之后加：

```ts
  const handleOpenNovel = useCallback(
    async (sourcePath: string): Promise<boolean> => {
      const api = getApi()
      if (!api) return false
      const result = await api.openNovelPath(sourcePath)
      if (!result.ok) {
        notify(`打开失败：${result.reason}`)
        return false
      }
      await openNovel(result.value)
      return true
    },
    [notify, openNovel]
  )

  const handleDeleteNovel = useCallback(
    async (entry: LibraryEntry): Promise<IpcResult<void>> => {
      const api = getApi()
      if (!api) return { ok: false, reason: '应用接口不可用' }
      // 删当前书时先把状态清空，否则待发的防抖写会在删除之后把会话写回来。
      if (novel?.sourcePath === entry.sourcePath) {
        openSeqRef.current++
        setNovel(null)
        setEngine(null)
        setChapterRule(DEFAULT_CHAPTER_RULE)
        patchSettings({ lastSourcePath: null })
      }
      return api.deleteNovel(entry.id)
    },
    [novel, patchSettings]
  )
```

`<Ribbon>` 上补：

```tsx
          currentSourcePath={novel?.sourcePath ?? null}
          onOpenNovel={handleOpenNovel}
          onDeleteNovel={handleDeleteNovel}
```

`toolbarProps` 的 `onImport` 改成：

```ts
      onImport: () => handleImport(),
```

- [ ] **Step 9: 跑用例**

Run: `pnpm vitest run tests/unit/libraryPanel.test.tsx tests/unit/settings.test.tsx tests/unit/ribbon.test.tsx`
Expected: PASS。若 `settings.test.tsx` 的类型报 `onImport` 不兼容，把 `SetupOptions.onImport` 改成 `() => void | Promise<void>`。

Run: `pnpm typecheck`
Expected: exit 0。

- [ ] **Step 10: 提交**

```bash
cat > /tmp/wt-msg.txt <<'EOF'
feat: 设置里新增小说管理页

列表按最近阅读排序，可打开、删除；当前书高亮。
EOF
git add src/renderer/src/components/LibraryPanel.tsx src/renderer/src/components/SettingsDialog.tsx src/renderer/src/components/Ribbon.tsx src/renderer/src/App.tsx src/renderer/src/state/ToolbarContext.tsx src/renderer/src/styles/ribbon.css tests/unit/libraryPanel.test.tsx tests/unit/settings.test.tsx
git commit -F /tmp/wt-msg.txt
```

---

### Task 5: 「清除阅读记录」只清当前书

**Files:**
- Modify: `src/renderer/src/App.tsx`、`src/main/channels.ts`、`src/core/api.ts`、`src/preload/index.ts`、`src/main/ipc.ts`、`src/main/sessionStore.ts`
- Test: `tests/unit/app.test.tsx`、`tests/unit/sessionStore.test.ts`、`tests/unit/ipcContract.test.ts`、`tests/setup.ts`、`tests/e2e/app.spec.ts`

**Interfaces:**
- Consumes: 现有 `TypingEngine.fromSession` 与 `saveSession`。
- Produces: `WtApi.clearSession` 删除；`SessionStore.clearReadingHistory` 删除。

- [ ] **Step 1: 改失败用例**

把 `tests/unit/app.test.tsx` 里 `it('清除阅读记录后回到空状态', ...)` 整条替换为：

```ts
  it('清除阅读记录只重置当前书的进度，书仍开着', async () => {
    const novel = makeNovel()
    const session: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: '/tmp/测试书.txt',
      ratio: 5,
      mode: 'key',
      cursor: 15,
      revealStart: 0,
      chapterPos: [15, 0],
      activeChapter: 0,
      startedAt: null
    }
    installApi(novel, session)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(revealedChars()).toBe(15))

    openSettings()
    fireEvent.click(screen.getByTestId('btn-clear-session'))
    await waitFor(() => expect(revealedChars()).toBe(0))

    // 书没有关掉：章节栏还在，空状态不出现。
    expect(screen.queryByTestId('page-empty')).toBeNull()
    expect(screen.getByTestId('chapter-item-0')).toBeTruthy()

    const saveSession = window.api.saveSession as unknown as {
      mock: { calls: PersistedSession[][] }
    }
    await waitFor(() => expect(saveSession.mock.calls.length).toBeGreaterThan(0))
    const payload = saveSession.mock.calls[saveSession.mock.calls.length - 1][0]
    expect(payload.cursor).toBe(0)
    expect(payload.revealStart).toBe(0)
    expect(payload.chapterPos).toEqual([0, 0])
    expect(payload.activeChapter).toBe(0)
    // 「怎么读」的偏好保留：比例与输入模式不被清零。
    expect(payload.ratio).toBe(5)
    expect(payload.mode).toBe('key')
  })

  it('没有打开小说时清除只提示，不写任何东西', async () => {
    installApi(null)
    render(<App />)
    openSettings()
    fireEvent.click(screen.getByTestId('btn-clear-session'))

    await waitFor(() =>
      expect(screen.getByTestId('toast').textContent).toContain('还没有打开小说')
    )
    expect(window.api.saveSession).not.toHaveBeenCalled()
  })
```

同时把 `installApi` 里的 `clearSession` 一行删掉，把 `tests/setup.ts` 的 `clearSession` 一行删掉。

Run: `pnpm vitest run tests/unit/app.test.tsx`
Expected: FAIL（`clearSession` 已被断言删除，但 App 还在调用它；reset 逻辑也还没实现）。

- [ ] **Step 2: 改 App**

把 `handleClearSession` 整个替换成：

```ts
  const handleClearSession = useCallback(async () => {
    const api = getApi()
    const currentNovel = novel
    const currentEngine = engine
    if (!api || !currentNovel || !currentEngine) {
      notify('还没有打开小说')
      return
    }

    const snap = currentEngine.toSession()
    const fresh = TypingEngine.fromSession(currentNovel, {
      ...snap,
      cursor: 0,
      revealStart: 0,
      chapterPos: currentNovel.chapters.map(() => 0),
      activeChapter: 0,
      startedAt: null
    })
    setEngine(fresh)
    setExpanded(false)

    // 不删会话文件：删了分章规则会跟着丢。立刻写回零进度才是「清了位置、留下偏好」。
    const result = await api.saveSession({
      ...fresh.toSession(),
      chapterRule: chapterRuleRef.current
    })
    if (!result.ok) notify(`清除阅读记录失败：${result.reason}`)
  }, [engine, novel, notify])
```

Run: `pnpm vitest run tests/unit/app.test.tsx`
Expected: PASS。

- [ ] **Step 3: 拆掉旧通道**

1. `src/main/channels.ts` 删 `clearSession: 'wt:clear-session',`。
2. `src/core/api.ts` 删 `clearSession: () => Promise<IpcResult<void>>`。
3. `src/preload/index.ts` 删 `clearSession: () => call<void>(CH.clearSession),`。
4. `src/main/ipc.ts` 删 `ipcMain.handle(CH.clearSession, ...)`。
5. `src/main/sessionStore.ts`：从 `SessionStore` 接口与返回对象里删 `clearReadingHistory`。
6. 删掉 `sessionStore.test.ts` 里所有 `clearReadingHistory` 用例（搜索 `clearReadingHistory`，三处 `it` 与相关辅助注释一并清理）。
7. `tests/unit/ipcContract.test.ts` 的 `CH` 断言删 `clearSession`。
8. `tests/e2e/app.spec.ts` 的 `expected` 删 `clearSession: 'function'`。
9. `tests/unit/libraryPanel.test.tsx` 的 `installApi` 里删掉 `clearSession` 那一行（`WtApi` 已经没有这个成员，留着会报多余属性）。

Run: `pnpm vitest run tests/unit/ipcContract.test.ts tests/unit/sessionStore.test.ts tests/unit/app.test.tsx`
Expected: PASS。

Run: `pnpm typecheck`
Expected: exit 0。

- [ ] **Step 4: 提交**

```bash
cat > /tmp/wt-msg.txt <<'EOF'
feat: 清除阅读记录只重置当前书

位置清零、书仍打开；比例、输入模式与分章规则保留。
EOF
git add src/renderer/src/App.tsx src/main/channels.ts src/core/api.ts src/preload/index.ts src/main/ipc.ts src/main/sessionStore.ts tests/unit/app.test.tsx tests/unit/sessionStore.test.ts tests/unit/ipcContract.test.ts tests/setup.ts tests/e2e/app.spec.ts
git commit -F /tmp/wt-msg.txt
```

---

### Task 6: 文档与全量门禁

**Files:**
- Modify: `CLAUDE.md`、`README.md`、`README.zh-CN.md`

- [ ] **Step 1: 更新 CLAUDE.md**

1. 持久化表在 `session.json` 行之后加一行：

```markdown
| `library/<id>/` + `meta.json` | **每本书一份**的拷贝件与元数据（原路径、文件名、导入时间、字节数、总字数） | 目录名是原文件绝对路径的 sha256 前 32 hex；拷贝件丢失或 meta 不合法时列表里是坏条目，只能删；同一路径再次导入不再建第二条 |
```

2. 「清除阅读记录」相关描述改为「只清当前书的阅读位置，保留比例 / 输入模式 / 分章规则」。
3. 架构一节在 `sessionStore.ts` 之后补一句：
   `libraryStore.ts` 只管书库文件系统（拷贝、元数据、列表、删除）；导入编排在 `ipc.ts`。
4. 把 `lastSourcePath` 的描述改成「指向拷贝路径」。

- [ ] **Step 2: 更新 README（两份）**

`README.zh-CN.md` 第 43 行附近改成：

```markdown
1. **导入小说** —— `⌘/Ctrl + ,` 打开设置 →「导入小说」。导入时会拷贝一份到应用目录，
   原文件删掉也不影响阅读；设置里的「小说管理」可以查看书库、切换和删除。
```

第 51 行附近补一句：

```markdown
书库里的每本书都可以单独删除，删除会同时删掉拷贝件与这本书的阅读进度。
```

`README.md` 做同结构、同位置的英文对应修改：

```markdown
1. **Import a novel** — press `⌘/Ctrl + ,`, open Settings → "Import Novel". The file is copied
   into the app's data directory, so deleting the original does not affect reading. The
   "Novel Library" page lets you browse, switch, and delete books.
```

```markdown
Each book can be deleted on its own; deleting removes both the copied file and that book's progress.
```

- [ ] **Step 3: 全量门禁**

Run: `pnpm typecheck`
Expected: exit 0。

Run: `pnpm test`
Expected: exit 0。**看 exit code**；摘要行里出现 `Errors` 或 `Test Files … failed` 都算失败。

Run: `pnpm build`
Expected: exit 0。

- [ ] **Step 4: 提交**

```bash
cat > /tmp/wt-msg.txt <<'EOF'
docs: 同步书库与清除阅读记录的说明

CLAUDE.md 的持久化表、README 两份的功能说明。
EOF
git add CLAUDE.md README.md README.zh-CN.md
git commit -F /tmp/wt-msg.txt
```

---

## 自审记录

- 规格第 3 节（磁盘布局与元数据）→ Task 2。
- 规格第 4 节（导入、迁移、启动与命令行）→ Task 3。
- 规格第 5 节（列表）→ Task 2 的 `listRawEntries` + Task 3 的 `listNovels`。
- 规格第 6 节（删除）→ Task 2 的 `removeEntry` + Task 3 的 `deleteNovel` + Task 4 的确认与当前书清理。
- 规格第 7 节（清除语义）→ Task 5。
- 规格第 8 节（界面）→ Task 4。
- 规格第 9 节（IPC 与文件分工）→ Task 1 至 5。
- 规格第 10 节（错误与边界）→ Task 2 的校验与回滚、Task 3 的编排、Task 4 的坏条目。
- 规格第 11 节（测试）→ 各任务的用例；真机验收留给用户。
- 规格第 12 节（文档）→ Task 6。
