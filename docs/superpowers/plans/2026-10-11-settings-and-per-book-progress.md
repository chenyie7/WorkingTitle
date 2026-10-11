# 设置持久化与每本书各留一份阅读进度 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把文档名 / 外观 / 纸张三个只活在内存里的设置落盘，并把阅读进度从「单槽会话」改成「每本书各一份」，切换小说不再互相覆盖。

**Architecture:** 沿用现有的 `SessionStore`（主进程、纯 `node:fs`、无第三方依赖）。新增一个 `settings.json` 存全局设置，进度改为 `sessions/<sha256(sourcePath) 前 32 位>.json` 每本书一份；`settings.json` 里的 `lastSourcePath` 记「上次打开的是哪本」，供启动恢复。渲染层多一对 IPC 通道读写设置，`loadSession` 带上 `sourcePath`。旧版单槽 `session.json` 在首次取 store 时迁移。

**Tech Stack:** Electron 44 + electron-vite、React 19、TypeScript、vitest（jsdom）、`node:crypto` / `node:fs`。

---

## 本计划的两条前置约定

**围栏口径。** 本仓库硬约定 1 说「实现计划的代码围栏 = 源文件逐字节副本」，指的是
`docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md` 那一份。本计划里的代码块
是**将要落地的正文**（可逐字粘贴），但不承担「整文件副本」的角色——整文件副本仍由那份旧计划
承担，由 **Task 8** 统一同步。这样每份文件只有一个镜像，不会出现三处对不齐。

**不做的事（用户明确要求）。** 不写探针脚本、不做变异矩阵；每个任务跑门禁、改完交给用户真机验收。
每条任务结束时 `pnpm typecheck && pnpm test` 必须全绿——**看 exit code，不要只看摘要行**。

**环境事实：** 仓库根目录是 `/Users/chenyi/ai-project/WorkingTitle`；`pnpm vitest run <file>` 可单跑一个文件；
`tests/unit/guardA.test.ts` 是 `@vitest-environment node`，那里没有 `window`。

---

## 文件结构

| 文件 | 职责 | 本计划中的变化 |
|---|---|---|
| `src/core/types.ts` | 共享类型与常量（无 DOM、无 node 依赖） | 加 `ThemeSource` / `AppSettings` / `defaultSettings()` |
| `src/main/sessionStore.ts` | userData 下所有文件的读写与校验 | 设置读写、进度按书存、只清进度、旧文件迁移 |
| `src/main/session.ts` | 懒创建 store 单例 | 取 store 时跑一次迁移 |
| `src/main/channels.ts` | 通道名常量 | 加两条通道 |
| `src/main/ipc.ts` | IPC handler | 设置两条、会话两条改签名 |
| `src/preload/index.ts` | 唯一的桥 | 暴露设置两条、`loadSession` 带参 |
| `src/renderer/src/types/global.d.ts` | 渲染层看到的 `window.api` 契约 | 同步签名；`ThemeSource` 改为从 core 转出 |
| `src/renderer/src/App.tsx` | 启动读设置、改动写回 | 唯一改动的渲染层文件 |

**不动的文件（有意）：** `novel-cache.json` / `novel-cache.txt` 保持单槽。它本来就按
`sourcePath` + mtime/size + `textBytes` 自我校验，换书只是丢缓存重读源文件，不影响正确性；
跟着改成按书存会同时改动缓存命名、校验与清理三处，收益只是省一次解码。

---

## Task 1: 共享类型 `AppSettings`

**Files:**
- Modify: `src/core/types.ts`（在文件末尾 `RENDER_WINDOW_LIMIT` 之后追加）

- [ ] **Step 1: 追加类型与默认值工厂**

在 `src/core/types.ts` 末尾（`export const RENDER_WINDOW_LIMIT = 30_000` 之后）加：

```ts
/** 外观偏好：跟随系统 / 强制浅色 / 强制深色。与主进程的 `nativeTheme.themeSource` 同构。 */
export type ThemeSource = 'system' | 'light' | 'dark'

/**
 * 应用级设置：**不属于任何一本书**的那些偏好。
 *
 * 【为什么与 PersistedSession 分开】两者的生命周期不同。进度是「读到哪」，每本书一份、
 * 随阅读不断变化；设置是「怎么读、长什么样」，全局一份、很少变。此前文档名 / 外观 / 纸张
 * 三个只在渲染进程的内存里，关掉应用就没了；而比例与输入模式挤在会话里，换一本书就被打回默认。
 */
export interface AppSettings {
  /** 蓝条上的文档名。刻意与 novelTitle（真实文件名）无关，见 App.tsx 里那段说明。 */
  docTitle: string
  themeSource: ThemeSource
  /** 「深色模式下纸张也变暗」。默认关——真 Word 的深色模式里纸张仍是白的。 */
  darkPaper: boolean
  /** 上次打开的书；启动时用它决定恢复哪一本。从未导入过时为 null。 */
  lastSourcePath: string | null
}

/** 蓝条上那个文档名的默认值：刻意中性，不泄露在读什么。 */
export const DEFAULT_DOC_TITLE = '文档1'

/**
 * 默认设置。
 *
 * 【写成函数而不是共享常量】常量会被消费方就地改掉（`s.themeSource = 'dark'`），
 * 于是「默认值」在下一次读取时已经变了——那类 bug 只在测试之间串味时才显形。
 */
export function defaultSettings(): AppSettings {
  return {
    docTitle: DEFAULT_DOC_TITLE,
    themeSource: 'system',
    darkPaper: false,
    lastSourcePath: null
  }
}
```

- [ ] **Step 2: 确认纯净性门禁仍然通过**

Run: `pnpm typecheck`
Expected: 两条 tsc 都无输出、exit 0。若报 `Cannot find name 'document'` 之类，说明代码写进了
`src/core/` 却被判成有 DOM——本步骤只加了类型与纯函数，不该出现。

- [ ] **Step 3: 提交**

```bash
git add src/core/types.ts
git commit -F /tmp/wt-msg.txt   # 见下方说明
```

本仓库的硬约定 3 要求 `git commit -F <文件>`，**不要内联 `-m`**（ASCII 引号会静默截断消息）。
先把消息写进文件再提交，例如：

```bash
cat > /tmp/wt-msg.txt <<'MSG'
feat: 加应用级设置的类型与默认值

文档名 / 外观 / 纸张三个设置此前只活在渲染进程内存里，关掉应用即丢。
先把共享类型与默认值工厂放好，落盘在各平台上都是同一份形状。
MSG
```

---

## Task 2: `sessionStore` 读写 `settings.json`

**Files:**
- Modify: `src/main/sessionStore.ts`
- Test: `tests/unit/sessionStore.test.ts`（在文件末尾追加一个 `describe`）

- [ ] **Step 1: 写用例**

在 `tests/unit/sessionStore.test.ts` 末尾追加：

```ts
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
    { name: '记录是 null', token: '不是一个对象', mangle: () => null }
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
```

同时把文件顶部的 import 改成：

```ts
import { createSessionStore } from '../../src/main/sessionStore'
import { defaultSettings } from '../../src/core/types'
import type { AppSettings, Novel, PersistedSession } from '../../src/core/types'
```

- [ ] **Step 2: 跑一遍，确认红**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: FAIL —— `store.readSettings is not a function`。

- [ ] **Step 3: 实现**

在 `src/main/sessionStore.ts` 里：

(a) 顶部 import 加 `dirname` 与类型（保持本文件既有的「值一行、类型一行」写法）：

```ts
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { defaultSettings } from '../core/types'
import type { AppSettings, Novel, NovelCacheMeta, PersistedSession } from '../core/types'
```

（`import { join } from 'node:path'` 那一行替换掉。）

(b) `SessionStore` 接口**只加这两个**（会话相关的三个签名分别在 Task 3/4/5 里改——
一次改到位的话，接口要求的方法还没实现，本任务的 `pnpm typecheck` 会当场红）：

```ts
export interface SessionStore {
  readSettings(): AppSettings
  writeSettings(s: AppSettings): void
  readSession(): PersistedSession | null   // Task 3 改成带 sourcePath
  writeSession(s: PersistedSession): void
  clearAll(): void                          // Task 4 改名并改语义
  writeNovelCache(novel: Novel): void
  readNovelCache(filePath: string): Novel | null
}
```

(c) 在 `isNovelCacheMeta` 之后加校验器与两个设置函数：

```ts
/**
 * 校验读回来的 JSON 是不是一份完整的 AppSettings；返回第一个不合格字段的描述。
 *
 * 【与 sessionProblem 是同一套姿势，取舍也相同】设置项全都是可再生的（坏了就回默认值），
 * 所以这里不像会话那样有「进度不能丢」的压力；但仍然返回**字段名**而不是 true/false——
 * 静默回默认会让「我改的文档名怎么没了」无从查起。
 */
function settingsProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return '不是一个对象'
  const s = v as Record<string, unknown>
  if (typeof s.docTitle !== 'string') return 'docTitle 不是字符串'
  if (s.themeSource !== 'system' && s.themeSource !== 'light' && s.themeSource !== 'dark') {
    return 'themeSource 不是 system/light/dark'
  }
  if (typeof s.darkPaper !== 'boolean') return 'darkPaper 不是布尔值'
  if (s.lastSourcePath !== null && typeof s.lastSourcePath !== 'string') {
    return 'lastSourcePath 既不是 null 也不是字符串'
  }
  return null
}

function isAppSettings(v: unknown): v is AppSettings {
  return settingsProblem(v) === null
}

function readSettingsFile(path: string): AppSettings {
  try {
    if (!existsSync(path)) return defaultSettings()
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isAppSettings(parsed)) {
      console.warn(
        `[wt] 设置文件结构不合法（${settingsProblem(parsed) ?? '未知'}），按默认值处理：`,
        path
      )
      return defaultSettings()
    }
    return parsed
  } catch (err) {
    console.warn('[wt] 读取设置失败，按默认值处理：', err)
    return defaultSettings()
  }
}

function writeSettingsFile(path: string, s: AppSettings): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    // 与 session 同样的 temp+rename。文档名是用户敲进去的、不可再生，
    // 截断的 settings.json 读回来只会是默认值。
    writeFileSync(`${path}.tmp`, JSON.stringify(s), 'utf8')
    renameSync(`${path}.tmp`, path)
  } catch (err) {
    console.warn('[wt] 保存设置失败，本次改动未落盘：', err)
  }
}
```

**一条口径说明（写进注释或留在这里都行，但别读错）：** 校验失败是**整份回退**，不是逐字段恢复：一份手改过的
`"themeSource": "sepia"` 会连 `docTitle` / `darkPaper` / `lastSourcePath` 一起丢掉。这是刻意与
`sessionProblem` / `cacheMetaProblem` 两个家族保持一致（三份校验器同一个姿势），**不是**说受影响的
只有坏的那个键——`readSettingsFile` 的警告里「按默认值处理」指的是整份。丢掉 `lastSourcePath` 是
有行为后果的：应用不再自动打开上次那本书。

(d) `createSessionStore` 里加路径与两个方法（`settingsPath` 紧跟 `sessionPath` 那几行）：

```ts
  const settingsPath = join(baseDir, 'settings.json')
```

```ts
    readSettings(): AppSettings {
      return readSettingsFile(settingsPath)
    },

    writeSettings(s: AppSettings): void {
      writeSettingsFile(settingsPath, s)
    },
```

（放在 `readSession` 之前。）

- [ ] **Step 4: 跑一遍，确认绿**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cat > /tmp/wt-msg.txt <<'MSG'
feat: 设置落盘到 settings.json

文档名 / 外观 / 纸张三项此前只活在渲染进程内存里。读写沿用会话那一套：temp+rename
原子写、读回时逐字段校验、不合格按默认值处理并把坏在哪个字段报出来。
MSG
git add src/main/sessionStore.ts tests/unit/sessionStore.test.ts
git commit -F /tmp/wt-msg.txt
```

---

## Task 3: 阅读进度改成每本书一份

**Files:**
- Modify: `src/main/sessionStore.ts`
- Modify: `tests/unit/sessionStore.test.ts`、`tests/unit/guardA.test.ts`、`tests/unit/guardB.test.ts`

- [ ] **Step 1: 写用例（新行为）**

在 `tests/unit/sessionStore.test.ts` 的 `describe('sessionStore 会话读写')` 开头追加两条：

```ts
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
```

- [ ] **Step 2: 改造既有用例的路径与签名**

同一文件里，凡是读写「那一份会话文件」的地方都改成按书取路径。加一个模块级辅助：

```ts
/**
 * 会话文件在磁盘上的位置。
 *
 * 【为什么测试自己算一遍 sha256 而不是从实现里 import】判据要独立：把实现里的算法换掉
 * （比如换成 base64），这些用例必须跟着红，而不是跟着实现一起漂。仓库里已有的会话路径
 * 断言（clearAll 那条）也是这个姿势。
 */
function sessionFile(dir: string, sourcePath: string): string {
  const key = createHash('sha256').update(sourcePath, 'utf8').digest('hex').slice(0, 32)
  return join(dir, 'sessions', `${key}.json`)
}
```

顶部 import 追加 `import { createHash } from 'node:crypto'` 与 `mkdirSync`（若尚未导入）。

逐条替换：

| 现在 | 改成 |
|---|---|
| `store.readSession()` | `store.readSession(SRC)`，其中 `const SRC = '/tmp/测试书.txt'`（= `makeSession()` 的默认 sourcePath） |
| `join(dir, 'session.json')` | `sessionFile(dir, SRC)` |
| `writeFileSync(join(dir, 'session.json'), ...)` | 先 `mkdirSync(join(dir, 'sessions'), { recursive: true })`，再 `writeFileSync(sessionFile(dir, SRC), ...)` |

`CRIPPLED` 那张表那条用例（`it.each(CRIPPLED)`）里写坏记录的那三行同样要改；它写坏的是
**默认 sourcePath 那本书**的记录，所以 `readSession(SRC)` 才读得到它。

- [ ] **Step 3: 跑一遍，确认红**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: FAIL —— `readSession` 忽略参数（还没改）、文件路径对不上。

- [ ] **Step 4: 实现**

在 `src/main/sessionStore.ts` 里：

(a) 模块级加：

```ts
/**
 * 一本书的进度文件名：`sourcePath` 的 sha256 前 16 字节（32 个 hex 字符）。
 *
 * 【为什么是哈希而不是把路径编码进文件名】路径可能很长、含 `/` 与冒号等各平台保留字符，
 * 直接拼进去会撞上文件名长度上限（多数文件系统 255 字节）。哈希定长、且只含 hex。
 * 代价是文件名不再可读——所以文件**内容**里仍带着 sourcePath，读取时比对（见下）。
 */
function sessionFileName(sourcePath: string): string {
  return `${createHash('sha256').update(sourcePath, 'utf8').digest('hex').slice(0, 32)}.json`
}

/** 按书取会话文件路径。book 的路径 → 定长文件名，见 sessionFileName。 */
function sessionFilePath(sessionsDir: string, sourcePath: string): string {
  return join(sessionsDir, sessionFileName(sourcePath))
}

function readSessionFile(file: string, sourcePath: string): PersistedSession | null {
  try {
    if (!existsSync(file)) return null
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!isPersistedSession(parsed)) {
      console.warn(
        `[wt] 会话文件结构不合法（${sessionProblem(parsed) ?? '未知'}），按无记录处理：`,
        file
      )
      return null
    }
    // 文件名是路径的哈希，所以「文件里的 sourcePath 与请求的不是同一本」只可能来自手工改名
    // 或哈希撞车。放行的话会把 B 书的进度套到 A 书上——章节目录与光标全部错位，而
    // fromSession 对错位的 chapterPos 不抛错，只会表现为「进度莫名其妙不对」。
    if (parsed.sourcePath !== sourcePath) {
      console.warn('[wt] 会话文件与请求的书不是同一本，按无记录处理：', file)
      return null
    }
    return parsed
  } catch (err) {
    console.warn('[wt] 读取会话失败，按无记录处理：', err)
    return null
  }
}

function writeSessionFile(file: string, s: PersistedSession): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    // 先写临时文件再改名（同一个目录内，rename 是原子的）：读取方要么看到旧的完整文件、
    // 要么看到新的完整文件，不会看到「写了一半的 session.json」。直接写目标路径的话，
    // 进程在写完之前死掉，留下的是截断甚至空的文件，readSession 只能返回 null——
    // 游标、chapterPos、activeChapter、ratio、mode、startedAt 全部静默丢失。
    // 注意这条保护的是一次写入【之内】的完整性，写入之间的窗口只能靠调用方的防抖收敛。
    writeFileSync(`${file}.tmp`, JSON.stringify(s), 'utf8')
    renameSync(`${file}.tmp`, file)
  } catch (err) {
    console.warn('[wt] 保存会话失败，本次进度未落盘：', err)
  }
}
```

(b) `createSessionStore` 里加会话目录与路径函数：

```ts
  const sessionsDir = join(baseDir, 'sessions')
  /** 这本书的进度文件。每本书一份——换书不再覆盖上一本的进度。 */
  const sessionFile = (sourcePath: string): string => sessionFilePath(sessionsDir, sourcePath)
```

(c) 接口里 `readSession` 那一行改签名（其余不动）：

```ts
  readSession(sourcePath: string): PersistedSession | null
```

(d) 两个会话方法改成薄壳（并且**删掉旧的 `readSession`/`writeSession` 方法体**）：

```ts
    readSession(sourcePath: string): PersistedSession | null {
      return readSessionFile(sessionFile(sourcePath), sourcePath)
    },

    writeSession(s: PersistedSession): void {
      writeSessionFile(sessionFile(s.sourcePath), s)
    },
```

- [ ] **Step 5: 适配两个守卫**

`tests/unit/guardA.test.ts`——它注入的写坏动作按路径筛选，改成筛会话目录：

```ts
      if (armed && typeof p === 'string' && p.includes('sessions')) {
```

`store.readSession()` 两处改成 `store.readSession(SRC)`（`SRC` = `makeSession()` 的默认
`sourcePath`，即 `'/tmp/测试书.txt'`），并在文件顶部加 `const SRC = '/tmp/测试书.txt'`。

`tests/unit/guardB.test.ts`——它直接构造文件路径，改成**从目录里找那一份**，而不是自己算哈希：

```ts
        const store = createSessionStore(dir)
        const sessionsDir = join(dir, 'sessions')
        const sessionPath = (): string => {
          const entries = readdirSync(sessionsDir)
          expect(entries.length).toBe(1)   // 只有一本书被写过
          return join(sessionsDir, entries[0])
        }
        const tmpLeftover = (): string[] => readdirSync(sessionsDir).filter((f) => f.endsWith('.tmp'))

        store.writeSession(makeSession(1))
        // 一次成功的保存不该留下临时文件：rename 会把 .tmp 消费掉。
        // 这一条就是矩阵 row B 的探测器：copyFileSync 保留了目标的 inode（所以 inode 断言
        // 也看得见它），但它【不消费】临时文件，于是 .tmp 留在磁盘上；「写了临时文件却忘了
        // 改名」同样被它抓住。放在 statSync 与 inode 断言【之前】，是为了让这两种回退红在
        // 这一条说得清原因的断言上——放到后面的话，「忘了改名」会让目标文件根本不存在，
        // 于是 statSync 先抛 ENOENT，红得看不出所以然（实测踩到过）。
        expect(tmpLeftover()).toEqual([])
        const first = statSync(sessionPath()).ino
        store.writeSession(makeSession(2))
        expect(tmpLeftover()).toEqual([])
        const second = statSync(sessionPath()).ino
        ...
        expect(store.readSession(SRC)!.cursor).toBe(2)
```

顶部补 `import { readdirSync } from 'node:fs'` 与 `const SRC = '/tmp/测试书.txt'`。
两处 `makeSession` 的 sourcePath 保持默认（同一本书 → 同一个文件）。

- [ ] **Step 6: 跑这两个文件，确认绿**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts tests/unit/guardA.test.ts tests/unit/guardB.test.ts`
Expected: 全 PASS，exit 0。

> **本步骤还要额外改 `src/main/ipc.ts` 一行，否则 `pnpm typecheck` 到这里就是红的。**（这一条是计划初稿的疏漏，实施时实测踩到。）
>
> `readSession` 的唯一生产调用点是 `ipc.ts` 里那条 `wt:load-session` handler，而计划把它的修改排在了 Task 6。签名一改，`tsc` 当场报：
> `src/main/ipc.ts(48,76): error TS2554: Expected 1 arguments, but got 0`。
>
> 而且**不只是编译问题**：`vite build` 不做类型检查，产物照样打得出来，而运行期 handler 收不到参数会让 `sessionFileName(undefined)` 抛在 `readSessionFile` 的 try **之外**，于是渲染层这次 `invoke` 直接 reject——「会话恢复」这条链在 Task 3~6 之间是断的，而**任何门禁都抓不到它**（单测不碰 handler，e2e 要 Task 8 才跑）。
>
> 所以在 `ipc.ts` 里放一条过渡实现（Task 6 会把 `sourcePath` 改成必填、并删掉这个分支）：
>
> ```ts
>   ipcMain.handle(CH.loadSession, (_e, sourcePath: unknown): PersistedSession | null => {
>     // Task 6 之前渲染层还不传 sourcePath。按书取进度需要它，缺了就当「无记录」——
>     // 比让 sessionFileName(undefined) 抛出去、把整条恢复链路打断要好。Task 6 会把
>     // 这条契约连同 preload 一起改成必填。
>     return typeof sourcePath === 'string' ? getStore().readSession(sourcePath) : null
>   })
> ```
>
> **代价（这段初稿写错过，实测复核时纠正）**：Task 3~6 之间**不是**「只是恢复不了、进度不受影响」。
> `App.tsx` 的保存 effect 在 `engine` 变成非 null 之后 **600ms 自动落盘一次，不需要用户敲一个字**，
> 于是这个窗口的准确描述是：**恢复死了、清除也死了（此时的 `clearAll` 根本不碰 `sessions/`）、
> 而用户只要重新导入那本书，cursor 0 就写进了它的记录**。
>
> 三件事因此成立：
> 1. 别拿在读的那本书试这个分支，也别把这个中间提交单独合出去；
> 2. Task 5 会给 `readSession` / `writeSession` 补入参类型闸（见 Task 5），那时 `ipc.ts` 这条
>    guard 就冗余了——Task 6 删掉它，行为由 store 自己兜住；
> 3. 真正的收口在 Task 7：`openNovel` 必须读会话（见 Task 7 那条），否则「导入一本读过的书」
>    永远是重新开始。
>
> 提交时把 `src/main/ipc.ts` 一并 `git add`。

- [ ] **Step 7: 提交**

```bash
cat > /tmp/wt-msg.txt <<'MSG'
feat: 阅读进度改成每本书各留一份

原先只有一个 session 槽：导入 A 读一半、再导入 B，A 的进度就被覆盖，重启只恢复到
最后打开的那一本。改成按 sourcePath 的 sha256 取文件名、每本书一个文件；读回时比对
文件里的 sourcePath，只可能来自手工改名或哈希撞车的那种错配一律按无记录处理。
MSG
git add src/main/sessionStore.ts tests/unit/sessionStore.test.ts tests/unit/guardA.test.ts tests/unit/guardB.test.ts
git commit -F /tmp/wt-msg.txt
```

---

## Task 4: 「清除阅读记录」只清进度，留下设置

**Files:**
- Modify: `src/main/sessionStore.ts`
- Modify: `tests/unit/sessionStore.test.ts`

- [ ] **Step 1: 写用例**

把 `sessionStore.test.ts` 里 `clearAll` 那两条用例改成：

```ts
  it('clearReadingHistory 清掉所有书的进度与缓存，留下设置', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession({ sourcePath: '/tmp/A.txt' }))
    store.writeSession(makeSession({ sourcePath: '/tmp/B.txt' }))
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src))
    store.writeSettings({ docTitle: '季度汇报', themeSource: 'dark', darkPaper: true, lastSourcePath: '/tmp/A.txt' })
    // 前提：这些东西确实落盘了。少了这几行，下面的断言测的是「几个从未被创建过的文件
    // 不存在」——无论 clearReadingHistory 做什么都会通过（实测：把删除列表写成空的，全量仍全绿）。
    expect(existsSync(sessionFile(dir, '/tmp/A.txt'))).toBe(true)
    expect(existsSync(sessionFile(dir, '/tmp/B.txt'))).toBe(true)
    expect(existsSync(join(dir, 'novel-cache.json'))).toBe(true)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(true)
    expect(existsSync(join(dir, 'settings.json'))).toBe(true)
    // 模拟崩溃留在磁盘上的临时文件：「清除阅读记录」应当把它一起清掉
    writeFileSync(join(dir, 'session.json'), '{"novelTitle":"旧版残留', 'utf8')

    store.clearReadingHistory()

    expect(store.readSession('/tmp/A.txt')).toBeNull()
    expect(store.readSession('/tmp/B.txt')).toBeNull()
    expect(existsSync(join(dir, 'sessions', sessionFileNameOf('/tmp/A.txt')))).toBe(false)
    expect(existsSync(join(dir, 'novel-cache.json'))).toBe(false)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(false)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
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
```

为此在测试辅助里补一个只算文件名的函数（`sessionFile` 复用它）：

```ts
function sessionFileNameOf(sourcePath: string): string {
  return `${createHash('sha256').update(sourcePath, 'utf8').digest('hex').slice(0, 32)}.json`
}
```

- [ ] **Step 2: 跑一遍，确认红**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: FAIL —— `store.clearReadingHistory is not a function`。

- [ ] **Step 3: 实现**

把 `createSessionStore` 里的 `clearAll()` 整体换成（**同时把 `SessionStore` 接口里那一行
`clearAll(): void` 改成 `clearReadingHistory(): void`**——不一起改的话 `typecheck` 会报
「对象字面量缺少 clearAll」）：

```ts
    clearReadingHistory(): void {
      // 「清除阅读记录」= 回到「从未导入」：所有书的进度、小说缓存、以及旧版留下的那一份
      // 单槽会话文件。**settings.json 刻不在此列**——文档名 / 外观 / 纸张是用户的偏好，
      // 与「读到哪」无关；把它们一起清掉正是本次改动要修的那个语义。
      for (const p of [legacySessionPath, `${legacySessionPath}.tmp`, cacheMetaPath, cacheTextPath]) {
        try {
          // force: true 而不是先 existsSync 再删——分开写的话，「文件本来就不存在」这条
          // 正常路径会走进 catch 打出一行「删除失败」。一条在成功时也会响的告警，比没有
          // 告警更糟：它教会看日志的人忽略这一行。
          rmSync(p, { force: true })
        } catch (err) {
          console.warn('[wt] 删除持久化文件失败：', p, err)
        }
      }
      // 整个目录一起删，而不是先 readdir 再逐个删：少一次「列目录时多出来一个新文件」的竞态，
      // 也不用维护「哪些文件算会话」这份名单。
      try {
        rmSync(sessionsDir, { recursive: true, force: true })
      } catch (err) {
        console.warn('[wt] 删除会话目录失败：', sessionsDir, err)
      }
    },
```

其中 `legacySessionPath` 在 Task 5 才引入；本任务先在本行加：

```ts
  const legacySessionPath = join(baseDir, 'session.json')
```

- [ ] **Step 4: 跑一遍，确认绿**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cat > /tmp/wt-msg.txt <<'MSG'
feat: 清除阅读记录只清进度，保留设置

设置是用户的偏好，与「读到哪」无关。原先的 clearAll 把两者一起删掉，等于用户改一次
文档名 / 外观，按一次清除就白改。
MSG
git add src/main/sessionStore.ts tests/unit/sessionStore.test.ts
git commit -F /tmp/wt-msg.txt
```

---

## Task 5: 迁移旧的单槽 `session.json`

**Files:**
- Modify: `src/main/sessionStore.ts`、`src/main/session.ts`
- Modify: `tests/unit/sessionStore.test.ts`

- [ ] **Step 1: 写用例**

在 `tests/unit/sessionStore.test.ts` 末尾追加：

```ts
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
    const after = store.readSession('/tmp/测试书.txt')

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.migrateLegacySession()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
    expect(store.readSession('/tmp/测试书.txt')).toEqual(after)
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
      // 【不能看 calls[0]】writeSessionFile 自己那条「保存会话失败，本次进度未落盘：」
      // 是同步先响的，迁移那条 warn 在它之后——`calls[0]` 必然不含这个令牌（实测红在这里）。
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
```

> **同时把 `writeSessionFile` 与 `writeSettingsFile` 的返回类型从 `void` 改成 `boolean`**
> （`true` = 确实落地了）：迁移那条路必须能问出「写成功了没有」，否则只能靠 `existsSync` 猜。
> 改法就是把各自的 `return` 分别写成 `return true` / `return false`（catch 里那条 warn 保留）。
> 两个公开方法 `writeSession` / `writeSettings` **忽略**返回值、接口仍是 `void`——「这一次
> 有没有存上」不是渲染层能处置的事，它只该在日志里留痕。
>
> **同一个提交里再给 `readSession` / `writeSession` 补一道入参类型闸**：
>
> ```ts
>     readSession(sourcePath: string): PersistedSession | null {
>       // 【为什么要闸】sourcePath 不是字符串时，sessionFileName 会在 createHash 里抛
>       // ERR_INVALID_ARG_TYPE，而那是**在 readSessionFile 的 try 之外**（参数先求值）——
>       // 异常会一路冒到 ipcMain.handle，把渲染层那次 invoke 打成 rejection。
>       // 仓库内当前不可达（toSession 恒给字符串、ipc.ts 那条 guard 还在），但这条通道
>       // 收的是渲染层未经校验的载荷，而「读回来的东西一律校验」是本文件的既有姿态——
>       // 这属于同一类，只是站在 IPC 那一侧。问不到就按无记录，与别处一致。
>       if (typeof sourcePath !== 'string') return null
>       return readSessionFile(sessionFile(sourcePath), sourcePath)
>     },
>
>     writeSession(s: PersistedSession): void {
>       if (typeof s?.sourcePath !== 'string') {
>         console.warn('[wt] 保存会话失败：sourcePath 不是字符串，本次进度未落盘')
>         return
>       }
>       writeSessionFile(sessionFile(s.sourcePath), s)
>     },
> ```
>
> 有了它，Task 3 在 `ipc.ts` 放的那条过渡 guard 就冗余了——Task 6 可以放心删掉它，
> 行为由 store 自己兜住（见 Task 6）。
>
> **再补两处小东西（都是同一次改动顺手）：**
> - `readSessionFile(file, sourcePath)` 的两个参数**必须互相一致**（`file` 得是
>   `sessionFile(sourcePath)` 的结果），这条不变量目前只靠唯一的调用点保证——在它上面写一行
>   注释点明。
> - 错配那条 warn 现在只给 32 位 hex 的文件名，读日志的人既不知道记的是哪本、也不知道请求的
>   是哪本。**把两个路径都打出来**（现有断言只查「不是同一本」这个子串，不会红）。
> - 顺手修掉注释里还写着 `session.json` 的地方：`sessionStore.ts` 里 `writeSessionFile` 中
>   「写了一半的 session.json」→「写了一半的会话文件」。（`cacheMetaProblem` 与
>   `guardB.test.ts` 那两处由 Task 4 修。）

- [ ] **Step 2: 跑一遍，确认红**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: FAIL —— `store.migrateLegacySession is not a function`。

- [ ] **Step 3: 实现**

在 `createSessionStore` 返回的对象里加（放在 `clearReadingHistory` 之后），并给 `SessionStore`
接口补上一行 `migrateLegacySession(): void`：

```ts
    migrateLegacySession(): void {
      // 旧版只有一个 session.json 槽位，新版按书分文件。升级后第一次取 store 时把它搬过去，
      // 否则用户的进度还躺在磁盘上、却永远不会再被读到了。
      let legacy: PersistedSession
      try {
        if (!existsSync(legacySessionPath)) return
        const raw: unknown = JSON.parse(readFileSync(legacySessionPath, 'utf8'))
        if (!isPersistedSession(raw)) {
          // **刻意不删**：删除是不可逆的，而留着最多每次启动多一条警告。这份文件已经不是
          // 本应用能读懂的东西了（手改过、或来自更早的版本），交给看日志的人自行处置。
          console.warn(
            `[wt] 旧版会话文件结构不合法（${sessionProblem(raw) ?? '未知'}），未迁移：`,
            legacySessionPath
          )
          return
        }
        legacy = raw
      } catch (err) {
        console.warn('[wt] 读取旧版会话失败，未迁移：', err)
        return
      }

      const target = sessionFile(legacy.sourcePath)
      // 【本任务唯一会毁数据的地方，判据要强】下面删掉的是用户进度唯一的副本，所以
      // 「能不能删」必须两条同时成立，任何一条不成立就原样留着、下次启动重试：
      //
      // 1. 新位置确实有一份**读得出来**的记录。判据用 `readSessionFile(...) !== null` 而不是
      //    `existsSync`：后者只回答「有个东西在那儿」，一个空的或截断的 target 会让这次迁移
      //    跳过写、然后把旧文件删掉——用一个读不出来的残留压掉一份完好的旧记录。
      //    （target 本来就有一份**能读**的记录时短路掉写：那一份是更新的，旧文件只是上一代
      //    格式的残留，不该倒回去。）
      // 2. 「上次打开的是哪本」也落盘了。它在旧版只写在会话文件里；这一条写不进去，迁移好的
      //    记录就没有任何人去读它——用户手动导入那本书时会被 cursor 0 覆盖掉。
      //    （Task 7 把导入路径改成「先读会话」之后，这一条的后果降级成「不会自动打开」，
      //    但闸留着仍然对：能确认的事就确认。）
      //
      // 触发条件都很现实：磁盘满（写要空间、rm 不要）、sessions 被一个同名文件占住
      // （mkdir 抛、rm 照旧成功）。删掉的后果是进度不可恢复。
      // 【顺序不能反——初稿把这里写反了，实测会丢数据】会话那半必须排在设置那半**之前**：
      // 反过来的话，「会话写失败而设置写成功」会让 lastSourcePath 指向一本进度还没搬过去的书，
      // 下次启动按它自动打开那本书、600ms 自动保存把 cursor 0 落盘，再下次启动就满足
      // 「已经迁过」+「lastSourcePath 非空」而把旧文件删掉——真进度没了，而且是应用自己干的。
      if (readSessionFile(target, legacy.sourcePath) === null) writeSessionFile(target, legacy)
      // 删之前**再读一次**，而不是信 writeSessionFile 的返回值：保证的是「这份记录确实在
      // 新位置读得出来」，而不是「那次调用说自己成功了」。将来有人让它在没落盘时返回 true，
      // 这道读仍然守得住（否则整条保证就只由一行注释保护着）。
      if (readSessionFile(target, legacy.sourcePath) === null) {
        console.warn('[wt] 旧版会话迁移未能落地，保留原文件、下次启动重试：', legacySessionPath)
        return
      }

      const settings = readSettingsFile(settingsPath)
      if (
        settings.lastSourcePath === null &&
        !writeSettingsFile(settingsPath, { ...settings, lastSourcePath: legacy.sourcePath })
      ) {
        console.warn('[wt] 旧版会话迁移未能落地，保留原文件、下次启动重试：', legacySessionPath)
        return
      }

      try {
        rmSync(legacySessionPath, { force: true })
      } catch (err) {
        console.warn('[wt] 删除旧版会话文件失败：', err)
      }
      // 各自一个 try：共用的话，删 session.json 一抛错，.tmp 就永远不被尝试
      try {
        rmSync(`${legacySessionPath}.tmp`, { force: true })
      } catch (err) {
        console.warn('[wt] 删除旧版临时会话文件失败：', err)
      }
    },
```

- [ ] **Step 4: 接上启动路径**

`src/main/session.ts` 的 `getStore()` 改成：

```ts
/** 必须在 app ready 之后、且 setPath('userData') 之后调用。 */
export function getStore(): SessionStore {
  if (!store) {
    store = createSessionStore(app.getPath('userData'))
    // 迁移放在这里而不是 index.ts 的启动序列里：它是「第一次真正用到 store」的那一刻，
    // 而渲染层启动时问的第一件事就是设置——所以迁移一定发生在任何一次读取之前。
    // 写成幂等的（跑完就把旧文件删掉），进程内重复调用与多次启动都安全。
    store.migrateLegacySession()
  }
  return store
}
```

- [ ] **Step 5: 跑一遍，确认绿**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
cat > /tmp/wt-msg.txt <<'MSG'
feat: 迁移旧版单槽会话，升级不丢进度

旧版只有一份 session.json。首次取 store 时把它搬进 sessions/ 并按需补上
lastSourcePath；判不了结构的一律不删（删除不可逆），只报出路径。
MSG
git add src/main/sessionStore.ts src/main/session.ts tests/unit/sessionStore.test.ts
git commit -F /tmp/wt-msg.txt
```

---

## Task 6: IPC 通道

**Files:**
- Modify: `src/main/channels.ts`、`src/main/ipc.ts`、`src/preload/index.ts`
- Modify: `tests/unit/ipcContract.test.ts`

> **`global.d.ts` 刻意不在这里改。** 它声明的是**渲染层**看到的契约，而 `loadSession` 改成
> 必填参数之后，唯一的调用点 `App.tsx` 不跟着改就是 `TS2554: Expected 1 arguments, but got 0`
> ——于是本任务的 `pnpm typecheck` 会当场红（这是初稿的排期错误，复核时发现）。契约与它的
> 唯一消费者必须同一次改，所以 `global.d.ts` 挪到 Task 7 与 `App.tsx` 一起。
>
> preload 不受影响：`global.d.ts` 与 preload 各自的 `WtApi` 是两份独立声明，preload 加参数
> 不会让渲染层那侧报错。

- [ ] **Step 1: 改契约用例**

`tests/unit/ipcContract.test.ts` 里那份期望对象加两行（放在 `clearSession` 之后）：

```ts
      clearSession: 'wt:clear-session',
      loadSettings: 'wt:load-settings',
      saveSettings: 'wt:save-settings',
```

- [ ] **Step 2: 跑一遍，确认红**

Run: `pnpm vitest run tests/unit/ipcContract.test.ts`
Expected: FAIL —— 实际对象里多了两个键。

- [ ] **Step 3: 实现**

`src/main/channels.ts` 的 `CH` 里加：

```ts
  clearSession: 'wt:clear-session',
  loadSettings: 'wt:load-settings',
  saveSettings: 'wt:save-settings',
```

`src/main/ipc.ts`：import 类型加 `AppSettings`，四条 handler 改成：

```ts
  ipcMain.handle(CH.loadSession, (_e, sourcePath: string): PersistedSession | null =>
    getStore().readSession(sourcePath)
  )

  ipcMain.handle(CH.saveSession, (_e, session: PersistedSession): void => {
    getStore().writeSession(session)
  })

  ipcMain.handle(CH.clearSession, (): void => {
    getStore().clearReadingHistory()
  })

  ipcMain.handle(CH.loadSettings, (): AppSettings => getStore().readSettings())

  ipcMain.handle(CH.saveSettings, (_e, settings: AppSettings): void => {
    getStore().writeSettings(settings)
  })
```

**同时删掉 Task 3 放的那条过渡 guard**（连同它的注释），把 handler 写成上面那一行。
删得掉是因为 Task 5 给 `readSession` 补了入参类型闸：渲染层在本任务之后、Task 7 之前仍然
不传 `sourcePath`，那时 `readSession(undefined)` 直接返回 `null`（按无记录），**不会抛**。
两条 guard 留成两份才是要避免的。

`src/preload/index.ts`（`loadSession` / `saveSession` / `clearSession` 那三行替换成五条）：

```ts
  loadSession: (sourcePath: string) => ipcRenderer.invoke(CH.loadSession, sourcePath),
  saveSession: (session: unknown) => ipcRenderer.invoke(CH.saveSession, session),
  clearSession: () => ipcRenderer.invoke(CH.clearSession),
  loadSettings: () => ipcRenderer.invoke(CH.loadSettings),
  saveSettings: (settings: unknown) => ipcRenderer.invoke(CH.saveSettings, settings),
```

（preload 的返回值刻意不标具体类型，与 `importNovel` 一致——渲染层看到的契约由 `global.d.ts`
负责，两处不重复维护。）

- [ ] **Step 4: 跑门禁**

Run: `pnpm typecheck && pnpm vitest run tests/unit/ipcContract.test.ts`
Expected: 两条 tsc 无输出、用例 PASS、exit 0。

- [ ] **Step 5: 提交**

```bash
cat > /tmp/wt-msg-t6.txt <<'MSG'
feat: 加设置的 IPC 通道，loadSession 按书取

load-session 现在带 sourcePath：进度按书分文件之后，「读哪一本的进度」必须问得明确。
设置走 load-settings / save-settings 两条新通道。Task 3 那条过渡 guard 删掉——入参类型闸
已经挪进 store 的 readSession 里，缺参按无记录返回，不再需要 handler 自己兜。
MSG
git add src/main/channels.ts src/main/ipc.ts src/preload/index.ts tests/unit/ipcContract.test.ts
git commit -F /tmp/wt-msg-t6.txt
```

---

## Task 7: 渲染层读设置、写设置

**Files:**
- Modify: `src/renderer/src/App.tsx`、`src/renderer/src/types/global.d.ts`
- Modify: `tests/setup.ts`、`tests/unit/app.test.tsx`

> **`global.d.ts` 在本任务里（从 Task 6 挪过来的）**：它声明的渲染层契约必须与它的唯一消费者
> `App.tsx` 同一次改，否则中间那个提交的 `pnpm typecheck` 是红的。
>
> **本任务还要修一个真 bug（复核时发现的，计划初稿漏了）**：`openNovel` 一直是
> `new TypingEngine(next)`——**从不读会话**，而「导入小说」走的正是它。叠加那条 600ms 自动保存，
> 最终形态下「导入一本读过的书」= 全新引擎 → 落盘 cursor 0 → **覆盖那本书的进度**。
> 那正是本特性存在的理由，也会让 Task 8 验收的第 2 条在真机上必失败。见 Step 4 (b)。

- [ ] **Step 1: 改两个桩，让门禁先编译得过**

`tests/setup.ts` 的 `benignApi`：

```ts
  loadSession: async () => null,
  saveSession: async () => {},
  clearSession: async () => {},
  loadSettings: async () => defaultSettings(),
  saveSettings: async () => {},
```

顶部加 `import { defaultSettings } from '../src/core/types'`。

`tests/unit/app.test.tsx` 的 `installApi` 里同样补 `loadSettings` / `saveSettings`
（`loadSettings: vi.fn(async () => defaultSettings())`、`saveSettings: vi.fn(async () => {})`），
顶部加同一条 import，并把类型 import 补成
`import type { AppSettings, Novel, PersistedSession } from '../../src/core/types'`
（下面那条守卫用例要用 `AppSettings`）。

**`src/renderer/src/types/global.d.ts`**：顶部 import 与 `ThemeSource` 改成从 core 转出：

```ts
import type { AppSettings, Novel, PersistedSession, ThemeSource } from '../../../core/types'

export type { ThemeSource }
```

（删掉原先那行 `export type ThemeSource = 'system' | 'light' | 'dark'`——定义只留 core 一处，
渲染层再声明一份的话两处会各自漂移。）`WtApi` 里 `loadSession` 改签名并补两条：

```ts
  loadSession: (sourcePath: string) => Promise<PersistedSession | null>
  saveSession: (session: PersistedSession) => Promise<void>
  clearSession: () => Promise<void>
  loadSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<void>
```

- [ ] **Step 2: 写用例**

在 `tests/unit/app.test.tsx` 末尾追加：

```ts
describe('设置的持久化', () => {
  it('启动时把磁盘上的设置读进界面', async () => {
    installApi(null)
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      docTitle: '季度汇报',
      themeSource: 'dark' as const,
      darkPaper: true,
      lastSourcePath: null
    }))
    render(<App />)
    // doc-title 是蓝条上那个文档名（Ribbon.tsx 里 data-testid="doc-title"）
    await waitFor(() => expect(screen.getByTestId('doc-title').textContent).toBe('季度汇报'))
  })

  // 【这条是本次改动里最容易写错的一条】设置是「改了就写回」的，而首帧渲染时三个状态
  // 还都是默认值——读盘是异步的。少了 settingsLoaded 那道闸，启动会先拿着默认值写一遍，
  // 把磁盘上真正的设置冲掉，然后才读到已经被自己冲掉的默认值。
  //
  // 【读盘必须真的挂住】桩若立即 resolve，settingsLoaded 马上就是 true，那个 effect 写盘
  // 是**正确行为**——这条用例就变成了「测不出守卫在不在」的空跑。所以这里用一个手动放行的
  // Promise，并分两段断言：挂住时一次都不许写，放行之后必须写。第二段是前提自检，
  // 少了它，一个「防抖根本没接上」的实现也能让第一段绿。
  it('读回设置之前不写盘（否则会用自己的默认值覆盖磁盘）', async () => {
    installApi(null)
    const saveSettings = vi.fn(async () => {})
    let release: (s: AppSettings) => void = () => {}
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(
      () =>
        new Promise<AppSettings>((resolve) => {
          release = resolve
        })
    )
    ;(window.api as unknown as { saveSettings: unknown }).saveSettings = saveSettings
    render(<App />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(saveSettings).not.toHaveBeenCalled()

    await act(async () => {
      release({ docTitle: '季度汇报', themeSource: 'dark', darkPaper: true, lastSourcePath: null })
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(saveSettings).toHaveBeenCalled()
  })

  it('改了文档名之后会把设置写回去', async () => {
    installApi(makeNovel())
    const saveSettings = vi.fn(async () => {})
    ;(window.api as unknown as { saveSettings: unknown }).saveSettings = saveSettings
    render(<App />)
    importViaSettings()
    openSettings()
    fireEvent.change(screen.getByTestId('doc-title-input'), { target: { value: '季度汇报' } })
    fireEvent.blur(screen.getByTestId('doc-title-input'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(saveSettings).toHaveBeenCalled()
    const last = saveSettings.mock.calls[saveSettings.mock.calls.length - 1][0]
    expect(last.docTitle).toBe('季度汇报')
  })
})
```

`doc-title` 是 `Ribbon` 里蓝条上那个 testid（`Ribbon.tsx` 传给 `TitleBar` 的），若实际名字不同，
以 `grep -n 'data-testid' src/renderer/src/components/Ribbon.tsx` 查到的为准再改写这条断言。

- [ ] **Step 3: 跑一遍，确认红**

Run: `pnpm vitest run tests/unit/app.test.tsx`
Expected: FAIL —— 第一条红在文档名仍是 `文档1`。

- [ ] **Step 4: 实现 `App.tsx`**

(a) import 与三个初始状态。文件顶部现有的两行 import 改成：

```tsx
import { TypingEngine } from '../../core/engine'
import { DEFAULT_DOC_TITLE } from '../../core/types'
import type { AppSettings, InputMode, Novel } from '../../core/types'
```

（`TypingEngine` 来自 `core/engine`，`DEFAULT_DOC_TITLE` 是值、来自 `core/types`——本文件既有的
写法就是「值一行、类型一行」，照它写。`import type { ThemeSource, WtApi } from './types/global'`
那一行不动。）

```tsx
  const [docTitle, setDocTitle] = useState(DEFAULT_DOC_TITLE)
  const [darkPaper, setDarkPaper] = useState(false)
  const [themeSource, setThemeSource] = useState<ThemeSource>('system')
  /** 上次打开的书。启动时读回来、导入时更新，写进 settings.json 供下次启动恢复。 */
  const [lastSourcePath, setLastSourcePath] = useState<string | null>(null)
  /**
   * 设置是否已经读回来了。
   *
   * 【少了这道闸，启动会把用户存的设置覆盖成默认值】设置是「改了就写回」的（下面那个
   * 防抖 effect），而首帧渲染时这三个状态还都是默认值——读盘是异步的。于是那个 effect
   * 会先拿着「文档1 / 浅色 / 不暗」写一遍，把磁盘上真正的设置冲掉，然后才读到已经被
   * 自己冲掉的默认值。jsdom 里读盘是立即 resolve 的，所以只有盯着「读回之前不许写」
   * 的用例能钉住它。
   */
  const [settingsLoaded, setSettingsLoaded] = useState(false)
```

(b) `openNovel` 改成**先读这本书自己的进度再决定是接着读还是从头**。这是本特性能否成立的那一处
——「导入小说」走的正是它，而它原先无条件 `new TypingEngine(next)`：

```tsx
  /**
   * 打开一本书：**先问磁盘上有没有这本书的进度**，有就接着读，没有才从零开始。
   *
   * 【为什么必须在这里问】「导入小说」走的就是这个函数，而启动恢复也走它。少了这次读盘，
   * 导入一本读过的书＝全新引擎 ＝600ms 后把 cursor 0 落盘覆盖掉那本书的进度——而「每本书
   * 各留一份进度」存在的全部意义就是这一条。判断只有这一处，调用方不必各自判一遍。
   */
  const openNovel = useCallback(async (next: Novel): Promise<void> => {
    // 递增序号，用来丢掉过期的那一次：读盘是异步的，用户连续导入两本时，先发起、后返回的
    // 那一次会把后打开的书顶掉。
    const seq = ++openSeqRef.current
    const api = getApi()
    const session = api ? await api.loadSession(next.sourcePath) : null
    if (seq !== openSeqRef.current) return

    setNovel(next)
    setEngine(session ? TypingEngine.fromSession(next, session) : new TypingEngine(next))
    setExpanded(false)
    setLastSourcePath(next.sourcePath)
  }, [])
```

配套：在 `engineRef` 那几行旁边加

```tsx
  /** 见 openNovel 里那段说明：只用来丢弃过期的打开结果 */
  const openSeqRef = useRef(0)
```

并把两处调用点改成 `void openNovel(...)`：`handleImport` 里是
`await openNovel(next)`（`handleImport` 本身已经是 async），启动 flow 里见 (d)。

> **顺带修掉一个既有问题（换成按书存之后更显眼了）**：会话保存那个 `useEffect` 的 cleanup 会
> `clearTimeout` 掉待发的定时器，而换书时 `engine` 变了，于是**上一本那一次的进度不会落盘**
> （600ms 之内换书就丢一次）。天然修法是在 `openNovel` 开头先把当前这本 flush 一次——
> 复用下面 beforeunload 那个 `flush` 的函数体，把它提成一个 `useCallback` 再在两处调用。

(c) `handleClearSession` 里补一行：

```tsx
    setNovel(null)
    setEngine(null)
    // 「上次打开的是哪本」也是阅读记录的一部分：不清掉的话，用户按下「清除阅读记录」
    // 再重启，那本书又自己开回来了——而设置（文档名 / 外观 / 纸张）照旧留着。
    setLastSourcePath(null)
```

(d) 启动 effect 的 `boot` 换成：

```tsx
    const boot = async (): Promise<void> => {
      // 设置先读：它同时给出「上次打开的是哪本」。命令行参数优先于它。
      const settings = await api.loadSettings()
      if (cancelled) return
      setDocTitle(settings.docTitle)
      setDarkPaper(settings.darkPaper)
      setThemeSource(settings.themeSource)
      setLastSourcePath(settings.lastSourcePath)
      setSettingsLoaded(true)

      const target = (await api.initialNovelPath()) ?? settings.lastSourcePath
      if (!target || cancelled) return

      // 目标文件可能打不开（已删除、权限、EISDIR、解不出编码……）。没有这个 try 的话错误
      // 会以【未处理的 rejection】形式冒到启动期：空状态不显示、也没有任何提示。catch 里
      // 刻意不做别的：失败就停在空状态，用户至少还能看到界面并重新导入。
      // 真机实测过（Task 12）：无 unhandled rejection，且会话照常恢复。
      // 注意这条**单测里是零覆盖**——把整个 try/catch 删掉，渲染层用例全绿。
      try {
        const loaded = await api.openNovelPath(target)
        if (cancelled) return
        // 「接着读还是从头」交给 openNovel 一个人判——它读的正是 loaded.sourcePath 名下的
        // 那本书的进度，别的书留在磁盘上、这一次不去读。
        await openNovel(loaded)
      } catch {
        // 原文件已不可用：停在空状态，等用户重新导入
      }
    }
```

（原先「先 loadSession 再比 sourcePath」的那段连同它的 `if (initialPath)` / `if (session)` 两个分支
一并删掉——按书取会话之后，比 sourcePath 这件事已经由 store 自己做了。）

(e) 会话持久化 effect 之后加设置的（同一套 600ms 防抖、同一个常量）：

```tsx
  // 设置持久化（防抖）。与会话同一套节奏：600ms 内的连续改动只落盘一次。
  useEffect(() => {
    const api = getApi()
    // 读回来之前不写，见 settingsLoaded 的说明
    if (!api || !settingsLoaded) return
    const timer = window.setTimeout(() => {
      void api.saveSettings({ docTitle, themeSource, darkPaper, lastSourcePath })
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [docTitle, themeSource, darkPaper, lastSourcePath, settingsLoaded])
```

(f) `engineRef.current = engine` 那一行附近加一个设置快照 ref，并让 `beforeunload` 一并落盘：

```tsx
  const settingsRef = useRef<AppSettings | null>(null)
  settingsRef.current = settingsLoaded ? { docTitle, themeSource, darkPaper, lastSourcePath } : null
```

```tsx
    const flush = (): void => {
      const current = engineRef.current
      if (current) void api.saveSession(current.toSession())
      // 设置也有防抖窗口：改完文档名立刻关窗（或退出）会落在窗口里。与上面同理，关窗前的
      // 最后一次也补上。
      const settings = settingsRef.current
      if (settings) void api.saveSettings(settings)
    }
```

- [ ] **Step 5: 跑门禁**

Run: `pnpm typecheck && pnpm test`
Expected: 全部 PASS、exit 0。

- [ ] **Step 6: 提交**

```bash
cat > /tmp/wt-msg.txt <<'MSG'
feat: 渲染层读写设置，启动按上次打开的书恢复

启动先把设置读回来灌进三个状态（docTitle / themeSource / darkPaper）与 lastSourcePath，
再打开命令行参数指定的书、否则打开上次那本，并按【它的路径】取进度。
读回之前一律不写盘——否则首帧的默认值会覆盖掉磁盘上的设置。
MSG
git add src/renderer/src/App.tsx tests/setup.ts tests/unit/app.test.tsx
git commit -F /tmp/wt-msg.txt
```

---

## Task 8: 围栏同步、设计文档、全量验收

**Files:**
- Modify: `docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md`（硬约定 1 的围栏）
- Modify: `docs/superpowers/specs/2026-10-06-word-disguised-typing-reader-design.md`

- [ ] **Step 1: 同步围栏**

本计划改到的每个源/测试文件，在旧计划里都有一个逐字节副本；把它们换成新内容。
用脚本做（块内行整体替换、保留围栏行），**不要手抄**。判据是**正向**的：

```python
# 遍历全部源/测试文件，报告「没有任何围栏与它逐字节相等」的集合——必须是空的
# 口径：md5('\n'.join(块内行) + '\n') == md5(文件内容)，含末尾换行，不要 rstrip
```

替换时按「旧内容的 md5」定位（改动前先记下每个文件的 md5），而不是按行号或锚点行——
同一份代码在计划里可能出现多次，且有些块是**历史版本**（注定与当前文件不符，不要动它们）。

**只同步 `2026-10-06` 那一份。** 本计划（`2026-10-11`）里的代码块是**指令、不是镜像**：
实施过程中它们已经在若干处与最终源码不同（例如 `sessionStore.test.ts` 里那条 `.tmp` 断言、
`writeSessionFile` 的返回类型），这是设计如此——本计划的正文只保证「照着做能得到正确结果」，
逐字节镜像的角色由旧计划承担。别反过来去改本计划的代码块来迎合源码：那会把「当时要求做什么」
这段历史抹掉。唯一例外是本计划里已经被实施者指出**写错了**的地方（例如那条 `calls[0]` 令牌），
那类是可读性 bug，可以修。

- [ ] **Step 2: 更新设计文档**

在 `docs/superpowers/specs/2026-10-06-word-disguised-typing-reader-design.md` 里：

- **§8 持久化**（第 293 行起）补上 `settings.json` 与 `sessions/<sha256 前 32 位>.json` 的位置与
  职责、「清除阅读记录 = 清进度 + 缓存、留设置」这条语义，以及旧版单槽 `session.json` 的迁移；
  顺带修掉这一节里与代码脱节的一处：**「游标变化防抖 1s」实际是 600ms**
  （`App.tsx` 的 `SAVE_DEBOUNCE_MS`），设置走同一个值；
- **§3 IPC 契约**（第 139 行起）补 `wt:load-settings` / `wt:save-settings`，并给 `wt:load-session`
  标上「带 sourcePath」；
- **§13 未决 / 风险**（第 426 行起）补一条：`textBytes` 仍是字节数而非内容哈希（等长文本互换
  仍会被放行），本次未改。

- [ ] **Step 3: 全量门禁**

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

四条都要看 **exit code**，不要只看摘要行（本仓库出现过两类「摘要行看着是绿的」：unhandled
rejection 让汇总多一行 `Errors 1 error`、以及某个测试文件整体失败而 `Tests N passed` 里没有
一个 failed）。

- [ ] **Step 4: 提交**

```bash
cat > /tmp/wt-msg.txt <<'MSG'
docs: 同步围栏与设计文档

围栏照硬约定 1 重抽比对（正向判据：没有任何围栏与文件逐字节相等的集合为空）；
设计文档补上 settings.json 与按书分文件的进度、以及清除阅读记录的新语义。
MSG
git add docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md docs/superpowers/specs/2026-10-06-word-disguised-typing-reader-design.md
git commit -F /tmp/wt-msg.txt
```

- [ ] **Step 5: 交给用户真机验收**

门禁绿**不等于**功能对。请用户在自己机器上确认这三条（自动化测不到）：

1. 改文档名 / 切外观 / 勾纸张 → 退出 → 重开，三项都还在；
2. 导入 A 读到一半 → 导入 B 读几页 → 重开：回到 B；再导入 A：A 的进度还在；
3. 「清除阅读记录」之后重启：空状态、设置还在。

---

## 自查记录

- **覆盖**：三项设置落盘（Task 1/2/7）、每本书一份进度（Task 3）、上次打开哪本（Task 1/5/7）、
  清除只清进度（Task 4）、旧数据不丢（Task 5）、契约同步（Task 6）、围栏与文档（Task 8）。
- **命名一致**：`readSettings` / `writeSettings` / `readSession(sourcePath)` / `clearReadingHistory` /
  `migrateLegacySession` / `sessionFileName` / `sessionFilePath` / `defaultSettings` / `DEFAULT_DOC_TITLE`
  —— 全计划只有这一套拼写。
- **已知缺口（有意）**：小说缓存仍是单槽（理由见「文件结构」一节）；`textBytes` 仍是字节数而非
  内容哈希（等长文本互换仍会被放行，见设计文档 §13，本次不做）。
