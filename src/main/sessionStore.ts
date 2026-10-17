import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { SHORTCUTS, shortcutProblem, type ShortcutId } from '../core/shortcuts'
import type { IpcResult } from '../core/api'
import { CHAPTER_SPLIT_VERSION, chapterRuleProblem } from '../core/chapters'
import { DEFAULT_CHAPTER_RULE, defaultSettings } from '../core/types'
import type {
  AppSettings,
  ChapterRule,
  Novel,
  NovelCacheMeta,
  PersistedSession
} from '../core/types'

/** 磁盘上那个 id 是不是本版本认识的。不认识的照常放行（见 settingsProblem 里的说明）。 */
function isShortcutId(id: string): id is ShortcutId {
  return SHORTCUTS.some((def) => def.id === id)
}

export interface SessionStore {
  readSettings(): AppSettings
  /** 写前按读盘同一套校验；不合格的载荷不落盘，把字段名交回去。 */
  writeSettings(s: unknown): IpcResult<void>
  readSession(sourcePath: string): PersistedSession | null
  writeSession(s: unknown): IpcResult<void>
  /** 删掉一本书的进度文件。文件不存在也算成功。 */
  deleteSession(sourcePath: string): IpcResult<void>
  /** 把一本书的会话写到另一个路径下，旧文件保留。目标已可读时短路。 */
  copySession(fromSourcePath: string, toSourcePath: string): boolean
  /** 单槽缓存属于这本书时，把两个缓存文件一起删掉。 */
  deleteCacheFor(sourcePath: string): void
  /** 会话文件的修改时间，用来排「最近阅读」。没有会话给 null。 */
  sessionFileMtime(sourcePath: string): number | null
  clearReadingHistory(): IpcResult<void>
  migrateLegacySession(): void
  writeNovelCache(novel: Novel, chapterRule?: ChapterRule): void
  readNovelCacheEntry(
    filePath: string
  ): { novel: Novel; chapterRule: ChapterRule; splitVersion: number } | null
  readNovelCache(filePath: string): Novel | null
}

/**
 * 校验读回来的 JSON 是不是一份完整的 PersistedSession。
 *
 * 【为什么不能只做 JSON.parse】持久化文件可能是旧版本写的、也可能被手工改过，
 * 而只要它还是合法 JSON，`as PersistedSession` 这个断言就能把残缺记录一路送进
 * TypingEngine.fromSession。实测 fromSession 对残缺记录【不抛错】：
 *   - 删掉 chapterPos：缺失的数组被当成全 0，只有游标所在章的项被重算，于是它照样返回
 *     一个引擎。快照的【具体数字取决于样本】，实测「两章各 10 字（[0,10) 与 [10,20)）、
 *     cursor=12」得 chapterPos=[0,2]、activeChapter=1，而「两章 20+10（[0,20) 与 [20,30)）、
 *     同样 cursor=12」得 chapterPos=[12,0]、activeChapter=0——别把那组数字读成这条路径的
 *     性质，它只是那个样本的值。
 *   - 只留 novelTitle / sourcePath：返回一个「从头开始」的引擎——cursor=0、ratio=10、
 *     mode='ime'、startedAt=null，chapterPos 全 0（长度等于章数）。这几个值与样本无关：
 *     cursor 缺失一律落 0，而 chapters[0].start 按构造恒为 0，所以第 0 章那一项也是 0。
 * 于是畸形数据不会崩溃，而是伪装成一次成功的恢复（比例、模式、计时都还在，进度却回到
 * 开头）。校验失败一律当作「没有记录」，由调用方走空状态。
 *
 * 【返回字段名而不是 true/false】这条警告原先只说「结构不合法」，读日志的人无法知道是哪个
 * 字段——而这正是「进度莫名其妙没了」时要查的东西。改成返回第一个不合格字段的描述，
 * isPersistedSession 只是它的布尔外壳（`=== null`），两条路径不会各写一套而漂移。
 */
function sessionProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return '不是一个对象'
  const s = v as Record<string, unknown>
  if (typeof s.novelTitle !== 'string') return 'novelTitle 不是字符串'
  if (typeof s.sourcePath !== 'string') return 'sourcePath 不是字符串'
  if (s.mode !== 'ime' && s.mode !== 'key') return 'mode 既不是 ime 也不是 key'
  if (!Array.isArray(s.chapterPos)) return 'chapterPos 不是数组'
  if (!s.chapterPos.every((n) => typeof n === 'number')) return 'chapterPos 含非数字项'
  if (s.startedAt !== null && typeof s.startedAt !== 'number') {
    return 'startedAt 既不是 null 也不是数字'
  }
  for (const k of ['ratio', 'cursor', 'revealStart', 'activeChapter']) {
    const n = s[k]
    if (typeof n !== 'number' || !Number.isFinite(n)) return `${k} 不是有限数字`
  }
  if (s.chapterRule !== undefined) {
    const problem = chapterRuleProblem(s.chapterRule)
    if (problem !== null) return problem
  }
  return null
}

function isPersistedSession(v: unknown): v is PersistedSession {
  return sessionProblem(v) === null
}

/**
 * NovelCacheMeta.chapters 里每个元素的必填字段；返回不合格字段的描述，合格返回 null。
 *
 * 【为什么要逐个元素查】`Array.isArray(v.chapters)` 单看像是够了，但它对元素一无所知：
 * 一个 `['第一章']` 这样的数组能过那道检查，随后下游读 `chapters[i].start` 得到 undefined，
 * 偏移就成了 NaN——章节目录与游标一起悄悄失效，而类型断言 `as NovelCacheMeta` 不会拦。
 * 数组的形状与元素的形状是两件事，这道检查就是往下多走的那一层。
 */
function chapterProblem(v: unknown, i: number): string | null {
  if (typeof v !== 'object' || v === null) return `chapters[${i}] 不是对象`
  const c = v as Record<string, unknown>
  if (typeof c.title !== 'string') return `chapters[${i}].title 不是字符串`
  for (const k of ['index', 'start', 'end', 'charCount']) {
    const n = c[k]
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return `chapters[${i}].${k} 不是有限数字`
    }
  }
  return null
}

/**
 * 校验读回来的 JSON 是不是一份完整的 NovelCacheMeta。
 *
 * 【与 isPersistedSession 是同一套姿势，理由也相同】这里原先是 `JSON.parse(...) as
 * NovelCacheMeta`——一个合法 JSON 就通过了断言。而**一份形状不对的 meta 会被当成【命中】
 * 返回**，不是未命中：路径、源文件 stat、提交点这三道门依赖的只是 meta 里那几个存在的
 * 字段，缺了 title/encoding/hadBom/chapters 照样自洽。实测：meta 只写
 * sourcePath/mtimeMs/size/textBytes 时，readNovelCache 返回一个 chapters、title、encoding、
 * hadBom 全为 undefined 的对象，而 flatText 是对的——于是 Task 6 的 `if (cached) return cached`
 * 会把这样一个「小说」交给渲染进程，chapters.length 当场抛错。
 *
 * 【为什么是必填字段校验而不是精确形状校验】与 isPersistedSession 同样的取舍：将来版本
 * 若在 meta 里多写几个键，旧记录仍应有效。所以这里只问「我需要的字段在不在、类型对不对」，
 * 不问「有没有多余的键」。
 *
 * 【丢弃这份缓存不会丢任何东西——这是 return null 而不是「尽力而为」的理由】缓存里没有
 * 不可再生的信息：title ← 文件名、encoding/hadBom ← 检测、chapters ← 切分、flatText ← 解码，
 * 而全应用唯一不可再生的状态是阅读进度，它在 `sessions/<hash>.json` 里（另一些文件、另一套校验），
 * 本路径不碰。所有 null 都落回 loadNovelFromFile(meta.sourcePath)，源文件是同一个路径；
 * 源文件若也没了，现有代码本来就会返回 null（statSync 抛）。所以这里只是把一种情况挪到
 * 一条【已经由四处未命中走过】的路径上，不引入新的行为类别。
 *
 * 【顺带约束了 Task 12：两次恢复不必互相同步】实测 fromSession 按【重建出来的】
 * chapters 长度建 chapterPos、用 s.chapterPos?.[i] 取值、缺失项落 0，且 cursor 被夹到新的
 * flatText 长度内——章数比记录多、少、或正文更短，它都是逐章降级而不是抛错。所以
 * 「缓存被判无效」最坏也就是首次启动慢一点（重读源文件 + 重新解码切分），
 * 不会让已存的阅读位置丢失或损坏。Task 12 的会话恢复因此无需与缓存有效性协调。
 */
function cacheMetaProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return '不是一个对象'
  const m = v as Record<string, unknown>
  if (typeof m.sourcePath !== 'string') return 'sourcePath 不是字符串'
  if (typeof m.title !== 'string') return 'title 不是字符串'
  if (typeof m.encoding !== 'string') return 'encoding 不是字符串'
  if (typeof m.hadBom !== 'boolean') return 'hadBom 不是布尔值'
  for (const k of ['mtimeMs', 'size', 'textBytes']) {
    const n = m[k]
    if (typeof n !== 'number' || !Number.isFinite(n)) return `${k} 不是有限数字`
  }
  if (!Array.isArray(m.chapters)) return 'chapters 不是数组'
  for (let i = 0; i < m.chapters.length; i++) {
    const problem = chapterProblem(m.chapters[i], i)
    if (problem !== null) return problem
  }
  if (m.chapterRule !== undefined) {
    const problem = chapterRuleProblem(m.chapterRule)
    if (problem !== null) return `chapterRule 不合法（${problem}）`
  }
  if (m.splitVersion !== undefined) {
    const n = m.splitVersion
    if (typeof n !== 'number' || !Number.isFinite(n)) return 'splitVersion 不是有限数字'
  }
  return null
}

function isNovelCacheMeta(v: unknown): v is NovelCacheMeta {
  return cacheMetaProblem(v) === null
}

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
  const n = s.ratio
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'ratio 不是有限数字'
  if (s.workDocPath !== null && typeof s.workDocPath !== 'string') {
    return 'workDocPath 既不是 null 也不是字符串'
  }
  const fill = s.bossFillPercent
  if (typeof fill !== 'number' || !Number.isFinite(fill)) return 'bossFillPercent 不是有限数字'
  // 【只判「是不是有限数字」，不判值域】与 ratio / bossFillPercent 同一姿态：
  // 这一层的职责是「这份 JSON 能不能信」，业务规则（12–24）归 core 的 clampPageFontSize。
  const font = s.pageFontSize
  if (typeof font !== 'number' || !Number.isFinite(font)) return 'pageFontSize 不是有限数字'
  const sc = s.shortcuts
  if (typeof sc !== 'object' || sc === null || Array.isArray(sc)) return 'shortcuts 不是对象'
  for (const [id, spec] of Object.entries(sc as Record<string, unknown>)) {
    if (typeof spec !== 'string') return `shortcuts.${id} 不是字符串`
    // 未知 id 刻意**不拦**：那是更新版本写的，本版本应当照常读、照常写回去。
    // 已知 id 则必须能解析——解析不了说明这个文件被改坏了。
    // 【只拦结构问题，不拦保留键】解析不了 / 没带修饰键 → 这个文件被改坏了，与其它字段
    // 一样整份退回；保留键是**平台相关**的，而这一层拿不到平台，只能交给 core 的
    // `resolveShortcuts` 按平台逐条退回默认值。
    //
    // 【那个 'darwin' 是惰性的，别试图「修正」它】`shortcutProblem` 的 `no-modifier` /
    // `unsupported-key` 两个出口在**查保留清单之前**就返回了，与 kind 无关；所以这里传
    // 什么都一样，真正吃重的是下面这个枚举。写成枚举而不是 `!== 'reserved'`，就是为了
    // 让这件事在调用点上自明。
    if (isShortcutId(id)) {
      const problem = shortcutProblem(spec, 'darwin')
      if (problem === 'no-modifier' || problem === 'unsupported-key') {
        return `shortcuts.${id} 不是合法的快捷键（${problem}）`
      }
    }
  }
  return null
}

/**
 * 给**旧版**写下的设置补上后来才加的字段。
 *
 * 【为什么不能直接让它按必填校验失败】`ratio` 与 `shortcuts` 都是后加的。旧版写下的
 * settings.json 里没有它们，而校验是「一个字段不合格就整份退回默认值」——那等于：升级
 * 一次，用户改过的文档名 / 外观 / 纸张**一起没了**，只在日志里留一条 warn。
 *
 * 【判据是「键不存在」而不是「值是 undefined」】后者在 JSON 里从来写不出来，而前者正是
 * 旧版本留下的形状。值不合法仍然整份退回——那是坏文件，不是旧文件。
 *
 * 【为什么是「缺哪个键补哪个」而不是给每个字段配一个专用函数】`ratio` 那次就是专用函数。
 * 再来一个 `withShortcutsFilled` 之后，下一次加字段还是得记得写第三个；写成一张表就没有
 * 这个「记得」了。
 */
const FILLED_DEFAULTS = {
  ratio: () => defaultSettings().ratio,
  shortcuts: () => defaultSettings().shortcuts,
  // 【这两个是同一件事的两半】漏了它们，旧版写下、没有这两个键的 settings.json 会被
  // settingsProblem 判成不合法，于是**整份退回默认值**——用户改过的文档名 / 外观 / 纸张 /
  // 快捷键一次性全丢，且没有任何报错，只有一行 console.warn。
  workDocPath: () => defaultSettings().workDocPath,
  bossFillPercent: () => defaultSettings().bossFillPercent,
  pageFontSize: () => defaultSettings().pageFontSize
} satisfies Readonly<Partial<Record<keyof AppSettings, () => unknown>>>

function withDefaultsFilled(v: unknown): unknown {
  if (typeof v !== 'object' || v === null) return v
  const record = v as Record<string, unknown>
  const filled: Record<string, unknown> = { ...record }
  for (const [key, make] of Object.entries(FILLED_DEFAULTS)) {
    if (!(key in record)) filled[key] = make()
  }
  return filled
}

function isAppSettings(v: unknown): v is AppSettings {
  return settingsProblem(v) === null
}

function readSettingsFile(path: string): AppSettings {
  try {
    if (!existsSync(path)) return defaultSettings()
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    // 先给旧版记录补上后来才加的字段，再按必填校验（见 withDefaultsFilled 的说明）
    const filled = withDefaultsFilled(parsed)
    if (!isAppSettings(filled)) {
      console.warn(
        `[wt] 设置文件结构不合法（${settingsProblem(filled) ?? '未知'}），按默认值处理：`,
        path
      )
      return defaultSettings()
    }
    return filled
  } catch (err) {
    console.warn('[wt] 读取设置失败，按默认值处理：', err)
    return defaultSettings()
  }
}

/** 临时文件名带 pid 与自增序号：两个进程写同一目标时不会抢同一个临时文件。 */
let tempSeq = 0
function tempPathFor(path: string): string {
  tempSeq += 1
  return `${path}.${process.pid}.${tempSeq}.tmp`
}

/**
 * 返回「这一次是否确实落地了」——迁移里「上次打开的是哪本有没有落盘」那道闸用它。
 *
 * 设置项本身全是可再生的（坏了就回默认值），所以别处的调用方都不看返回值；这里返回它，
 * 只是因为迁移那条路必须先确认它落盘了才能删旧文件。
 */
function writeSettingsFile(path: string, s: AppSettings): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    // 与 session 同样的 temp+rename。文档名是用户敲进去的、不可再生，
    // 截断的 settings.json 读回来只会是默认值。
    const tmp = tempPathFor(path)
    writeFileSync(tmp, JSON.stringify(s), 'utf8')
    renameSync(tmp, path)
    return true
  } catch (err) {
    console.warn('[wt] 保存设置失败，本次改动未落盘：', err)
    return false
  }
}

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

/**
 * 【两个参数必须互相一致的不变量】`file` 得是 `sessionFile(sourcePath)` 的结果——下面那道
 * 「文件里的 sourcePath 与请求的不是同一本」的检查，前提正是「文件名由这个路径算出」。
 * 目前只靠唯一调用点保证（`readSession` 里就地算出来传进来），签名上没有任何东西拦着
 * 把一对不相干的参数传进来。
 */
function readSessionFile(file: string, sourcePath: string): PersistedSession | null {
  try {
    if (!existsSync(file)) return null
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    // 规则是附加信息：读盘时坏了只丢它，别把整份进度作废。
    // 写盘仍然整份拒绝（sessionProblem），两处刻意不对称。
    if (typeof parsed === 'object' && parsed !== null) {
      const raw = parsed as Record<string, unknown>
      if (raw.chapterRule !== undefined) {
        const problem = chapterRuleProblem(raw.chapterRule)
        if (problem !== null) {
          console.warn(
            `[wt] 会话里的 chapterRule 不可用（${problem}），按自动识别处理：`,
            file
          )
          delete raw.chapterRule
        }
      }
    }
    if (!isPersistedSession(parsed)) {
      // 结构不合法的记录同样要说出来，并且**点出是哪个字段**——静默丢弃是「进度
      // 莫名其妙没了」的成因，而只报「不合法」把定位工作留给了看日志的人。
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
      // 两个路径都打出来：文件名是 32 位 hex，只给文件名的话，读日志的人既不知道这份记的是
      // 哪本书、也不知道请求的是哪本——而「哪两本对不上」正是要查的东西。
      console.warn(
        '[wt] 会话文件与请求的书不是同一本，按无记录处理：文件里记的是',
        parsed.sourcePath,
        '，请求的是',
        sourcePath,
        '，文件：',
        file
      )
      return null
    }
    return parsed
  } catch (err) {
    // 解析失败与「文件读不出来」都按无记录处理，启动不该被一份坏文件卡住；
    // 但要说出来——不然「目录只读 / 磁盘满」会表现成「应用一切正常，只是记不住进度」。
    console.warn('[wt] 读取会话失败，按无记录处理：', err)
    return null
  }
}

/**
 * 返回「这一次是否确实落地了」。
 *
 * 【返回值目前**没有**调用方在看】`writeSession` 忽略它，迁移也不看——迁移的判据是
 * 「新位置那份**读得出来**」（删之前再读一次，见 `migrateLegacySession`），那比「写函数说
 * 自己成功了」强：将来有人让它在没落盘时返回 true，那道读仍然守得住。所以**别把返回值当成
 * 「旧文件能不能删」的依据**，要判就读一次。
 */
function writeSessionFile(file: string, s: PersistedSession): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true })
    // 先写临时文件再改名（同一个目录内，rename 是原子的）：读取方要么看到旧的完整文件、
    // 要么看到新的完整文件，不会看到「写了一半的会话文件」。直接写目标路径的话，
    // 进程在写完之前死掉，留下的是截断甚至空的文件，readSession 只能返回 null——
    // 游标、chapterPos、activeChapter、ratio、mode、startedAt 全部静默丢失。
    // 实测这种残留的表现：截断成 20 字节与空文件都读回 null。
    // 注意这条保护的是一次写入【之内】的完整性，写入之间的窗口只能靠调用方的防抖收敛。
    const tmp = tempPathFor(file)
    writeFileSync(tmp, JSON.stringify(s), 'utf8')
    renameSync(tmp, file)
    return true
  } catch (err) {
    console.warn('[wt] 保存会话失败，本次进度未落盘：', err)
    return false
  }
}

export function createSessionStore(baseDir: string): SessionStore {
  const settingsPath = join(baseDir, 'settings.json')
  const legacySessionPath = join(baseDir, 'session.json')
  const cacheMetaPath = join(baseDir, 'novel-cache.json')
  const cacheTextPath = join(baseDir, 'novel-cache.txt')
  const sessionsDir = join(baseDir, 'sessions')
  /** 这本书的进度文件。每本书一份——换书不再覆盖上一本的进度。 */
  const sessionFile = (sourcePath: string): string => sessionFilePath(sessionsDir, sourcePath)

  const ensureDir = (): void => {
    mkdirSync(baseDir, { recursive: true })
  }

  // textBytes 是 meta 与缓存文本之间的提交点：只比字节数，两段等长文本仍会被放行。
  // 崩溃窗口见 NovelCacheMeta.textBytes；这一道门也覆盖半截文本，不必拆成两道。
  const readNovelCacheEntry = (
    filePath: string
  ): { novel: Novel; chapterRule: ChapterRule; splitVersion: number } | null => {
    try {
      if (!existsSync(cacheMetaPath) || !existsSync(cacheTextPath)) return null
      const parsed: unknown = JSON.parse(readFileSync(cacheMetaPath, 'utf8'))
      if (!isNovelCacheMeta(parsed)) {
        console.warn(
          `[wt] 缓存元数据结构不合法（${cacheMetaProblem(parsed) ?? '未知'}），按未命中处理：`,
          cacheMetaPath
        )
        return null
      }
      const meta = parsed
      if (meta.sourcePath !== filePath) return null
      const st = statSync(filePath)
      if (st.mtimeMs !== meta.mtimeMs || st.size !== meta.size) return null
      if (statSync(cacheTextPath).size !== meta.textBytes) return null
      return {
        novel: {
          title: meta.title,
          sourcePath: meta.sourcePath,
          encoding: meta.encoding,
          hadBom: meta.hadBom,
          flatText: readFileSync(cacheTextPath, 'utf8'),
          chapters: meta.chapters
        },
        chapterRule: meta.chapterRule ?? DEFAULT_CHAPTER_RULE,
        splitVersion: meta.splitVersion ?? 1
      }
    } catch (err) {
      console.warn('[wt] 读取小说缓存失败，将重新读取源文件：', err)
      return null
    }
  }

  return {
    readSettings(): AppSettings {
      return readSettingsFile(settingsPath)
    },

    writeSettings(s: unknown): IpcResult<void> {
      const problem = settingsProblem(s)
      if (problem) {
        console.warn(`[wt] 保存设置失败：结构不合法（${problem}），本次改动未落盘`)
        return { ok: false, reason: `设置结构不合法：${problem}` }
      }
      return writeSettingsFile(settingsPath, s as AppSettings)
        ? { ok: true, value: undefined }
        : { ok: false, reason: '设置写盘失败' }
    },

    readSession(sourcePath: string): PersistedSession | null {
      // 【为什么要闸】sourcePath 不是字符串时，sessionFileName 会在 createHash 里抛
      // ERR_INVALID_ARG_TYPE，而那是**在 readSessionFile 的 try 之外**（参数先求值）——
      // 异常会一路冒到 ipcMain.handle，把渲染层那次 invoke 打成 rejection。
      // 这条通道收的是渲染层未经校验的载荷，而「读回来的东西一律校验」是本文件的既有姿态——
      // 这属于同一类，只是站在 IPC 那一侧。问不到就按无记录，与别处一致。
      //
      // 【这不是「不可达的防御」】渲染层传 sourcePath 要等 Task 7，在那之前每次启动都会
      // 走到这里并且**必须**返回 null（而不是抛）——所以它是眼下唯一兜住这条路的东西，
      // 不是给未来留的保险。
      if (typeof sourcePath !== 'string') return null
      return readSessionFile(sessionFile(sourcePath), sourcePath)
    },

    writeSession(s: unknown): IpcResult<void> {
      const problem = sessionProblem(s)
      if (problem) {
        console.warn(`[wt] 保存会话失败：结构不合法（${problem}），本次进度未落盘`)
        return { ok: false, reason: `会话结构不合法：${problem}` }
      }
      const session = s as PersistedSession
      return writeSessionFile(sessionFile(session.sourcePath), session)
        ? { ok: true, value: undefined }
        : { ok: false, reason: '会话写盘失败' }
    },

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

    clearReadingHistory(): IpcResult<void> {
      // 「清除阅读记录」= 回到「从未导入」：所有书的进度、小说缓存、以及旧版留下的那一份
      // 单槽会话文件。**settings.json 刻意不在此列**——文档名 / 外观 / 纸张是用户的偏好，
      // 与「读到哪」无关；把它们一起清掉正是本次改动要修的那个语义。
      const failed: string[] = []
      for (const p of [legacySessionPath, `${legacySessionPath}.tmp`, cacheMetaPath, cacheTextPath]) {
        try {
          // force: true 而不是先 existsSync 再删——分开写的话，「文件本来就不存在」这条
          // 正常路径会走进 catch 打出一行「删除失败」。一条在成功时也会响的告警，比没有
          // 告警更糟：它教会看日志的人忽略这一行。
          rmSync(p, { force: true })
        } catch (err) {
          failed.push(p)
          console.warn('[wt] 删除持久化文件失败：', p, err)
        }
      }
      // 整个目录一起删，而不是先 readdir 再逐个删：少一次「列目录时多出来一个新文件」的
      // 竞态，也不用维护「哪些文件算会话」这份名单。
      try {
        rmSync(sessionsDir, { recursive: true, force: true })
      } catch (err) {
        failed.push(sessionsDir)
        console.warn('[wt] 删除会话目录失败：', sessionsDir, err)
      }
      return failed.length === 0
        ? { ok: true, value: undefined }
        : { ok: false, reason: `删除失败：${failed.join('、')}` }
    },

    migrateLegacySession(): void {
      // 旧版只有一个 session.json 槽位，新版按书分文件。升级后第一次取 store 时把它搬过去，
      // 否则用户的进度还躺在磁盘上、却永远不会再被读到了。
      let legacy: PersistedSession
      try {
        if (!existsSync(legacySessionPath)) return
        const raw: unknown = JSON.parse(readFileSync(legacySessionPath, 'utf8'))
        // 旧版单槽会话不可能带 chapterRule；手改出坏规则时整份保留、不迁移，更安全。
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
      // 【本任务唯一会毁数据的地方，判据要强，而且顺序不能反】
      //
      // 1. 先把会话搬过去，并且**以「读得出来」为准**：`existsSync` 只回答「有个东西在那儿」，
      //    一个空的或截断的 target 会让迁移跳过写、然后把旧文件删掉——用一个读不出来的残留
      //    压掉一份完好的旧记录。target 本来就能读时短路掉写（那一份是更新的）。
      // 2. **删之前再读一次**，而不是信 `writeSessionFile` 的返回值：保证是「这份记录确实在
      //    新位置读得出来」，而不是「那次调用说自己成功了」。将来有人让它在没落盘时返回 true，
      //    这道读仍然守得住。
      if (readSessionFile(target, legacy.sourcePath) === null) writeSessionFile(target, legacy)
      if (readSessionFile(target, legacy.sourcePath) === null) {
        console.warn('[wt] 旧版会话迁移未能落地，保留原文件、下次启动重试：', legacySessionPath)
        return
      }

      // 3. 「上次打开的是哪本」排在上面两条**之后**。反过来的话，会话写失败而设置写成功时，
      //    `lastSourcePath` 会指向一本进度还没搬过去的书——下次启动自动打开它、600ms 后把
      //    cursor 0 落盘，再下次启动就满足「已经迁过」而把旧文件删掉，真进度没了。
      //    排在后面，「lastSourcePath 已设置 ⇒ 这本书的记录已经在新位置」才成为不变量。
      const settings = readSettingsFile(settingsPath)
      if (
        settings.lastSourcePath === null &&
        !writeSettingsFile(settingsPath, { ...settings, lastSourcePath: legacy.sourcePath })
      ) {
        console.warn('[wt] 旧版会话迁移未能落地，保留原文件、下次启动重试：', legacySessionPath)
        return
      }

      // 两个删除各占一个 try：共用一个的话，前一个抛错会让后一个**永远不被尝试**——
      // 两件互不相干的清理不该互相拖累。
      try {
        rmSync(legacySessionPath, { force: true })
      } catch (err) {
        console.warn('[wt] 删除旧版会话文件失败：', err)
      }
      try {
        rmSync(`${legacySessionPath}.tmp`, { force: true })
      } catch (err) {
        console.warn('[wt] 删除旧版会话临时文件失败：', err)
      }
    },

    writeNovelCache(novel: Novel, chapterRule: ChapterRule = DEFAULT_CHAPTER_RULE): void {
      try {
        ensureDir()
        const st = statSync(novel.sourcePath)
        const text = novel.flatText
        const meta: NovelCacheMeta = {
          sourcePath: novel.sourcePath,
          mtimeMs: st.mtimeMs,
          size: st.size,
          encoding: novel.encoding,
          hadBom: novel.hadBom,
          title: novel.title,
          chapters: novel.chapters,
          chapterRule,
          splitVersion: CHAPTER_SPLIT_VERSION,
          // 与下面写出的字节数同源：writeFileSync 用 'utf8' 写出的就是这么多字节，
          // 读取时拿 statSync(cacheTextPath).size 与它比对即可自我校验。
          textBytes: Buffer.byteLength(text, 'utf8')
        }
        // 全文单独存纯文本：20MB 小说塞进 JSON 会白白付出转义与解析开销
        writeFileSync(cacheTextPath, text, 'utf8')
        // meta 是这一对文件之间的【提交点】，必须最后写：崩溃若落在上面那行与这行之间，
        // 磁盘上是「新 text + 旧 meta」，而旧 meta 的 textBytes 对不上新文本的大小，
        // 读取时整对被拒。反过来（先写 meta）留下「新 meta + 旧 text」，同样被 textBytes
        // 拦下——两种顺序的残余风险相同，这里只是让 meta 承担提交语义。
        writeFileSync(cacheMetaPath, JSON.stringify(meta), 'utf8')
      } catch (err) {
        // 缓存失败不影响本次使用，但下次启动会重新读源文件——值得留一条痕迹。
        console.warn('[wt] 写入小说缓存失败，下次启动将重新读取源文件：', err)
      }
    },

    readNovelCacheEntry,

    readNovelCache(filePath: string): Novel | null {
      return readNovelCacheEntry(filePath)?.novel ?? null
    }
  }
}
