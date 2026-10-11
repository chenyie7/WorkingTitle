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
import { defaultSettings } from '../core/types'
import type { AppSettings, Novel, NovelCacheMeta, PersistedSession } from '../core/types'

export interface SessionStore {
  readSettings(): AppSettings
  writeSettings(s: AppSettings): void
  readSession(sourcePath: string): PersistedSession | null
  writeSession(s: PersistedSession): void
  clearReadingHistory(): void
  migrateLegacySession(): void
  writeNovelCache(novel: Novel): void
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

/** 返回「这一次是否确实落地了」——迁移那条路要拿它当「能不能删旧文件」的判据。 */
function writeSettingsFile(path: string, s: AppSettings): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    // 与 session 同样的 temp+rename。文档名是用户敲进去的、不可再生，
    // 截断的 settings.json 读回来只会是默认值。
    writeFileSync(`${path}.tmp`, JSON.stringify(s), 'utf8')
    renameSync(`${path}.tmp`, path)
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

/** 返回「这一次是否确实落地了」——迁移那条路要拿它当「能不能删旧文件」的判据。 */
function writeSessionFile(file: string, s: PersistedSession): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true })
    // 先写临时文件再改名（同一个目录内，rename 是原子的）：读取方要么看到旧的完整文件、
    // 要么看到新的完整文件，不会看到「写了一半的会话文件」。直接写目标路径的话，
    // 进程在写完之前死掉，留下的是截断甚至空的文件，readSession 只能返回 null——
    // 游标、chapterPos、activeChapter、ratio、mode、startedAt 全部静默丢失。
    // 实测这种残留的表现：截断成 20 字节与空文件都读回 null。
    // 注意这条保护的是一次写入【之内】的完整性，写入之间的窗口只能靠调用方的防抖收敛。
    writeFileSync(`${file}.tmp`, JSON.stringify(s), 'utf8')
    renameSync(`${file}.tmp`, file)
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

  return {
    readSettings(): AppSettings {
      return readSettingsFile(settingsPath)
    },

    writeSettings(s: AppSettings): void {
      writeSettingsFile(settingsPath, s)
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

    writeSession(s: PersistedSession): void {
      if (typeof s?.sourcePath !== 'string') {
        console.warn('[wt] 保存会话失败：sourcePath 不是字符串，本次进度未落盘')
        return
      }
      writeSessionFile(sessionFile(s.sourcePath), s)
    },

    clearReadingHistory(): void {
      // 「清除阅读记录」= 回到「从未导入」：所有书的进度、小说缓存、以及旧版留下的那一份
      // 单槽会话文件。**settings.json 刻意不在此列**——文档名 / 外观 / 纸张是用户的偏好，
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
      // 整个目录一起删，而不是先 readdir 再逐个删：少一次「列目录时多出来一个新文件」的
      // 竞态，也不用维护「哪些文件算会话」这份名单。
      try {
        rmSync(sessionsDir, { recursive: true, force: true })
      } catch (err) {
        console.warn('[wt] 删除会话目录失败：', sessionsDir, err)
      }
    },

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
      const alreadyMigrated = readSessionFile(target, legacy.sourcePath) !== null
      const migrated = alreadyMigrated || writeSessionFile(target, legacy)
      const settings = readSettingsFile(settingsPath)
      const lastSourcePathWritten =
        settings.lastSourcePath !== null ||
        writeSettingsFile(settingsPath, { ...settings, lastSourcePath: legacy.sourcePath })

      if (!migrated || !lastSourcePathWritten) {
        console.warn('[wt] 旧版会话迁移未能落地，保留原文件、下次启动重试：', legacySessionPath)
        return
      }

      try {
        rmSync(legacySessionPath, { force: true })
        rmSync(`${legacySessionPath}.tmp`, { force: true })
      } catch (err) {
        console.warn('[wt] 删除旧版会话文件失败：', err)
      }
    },

    writeNovelCache(novel: Novel): void {
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

    readNovelCache(filePath: string): Novel | null {
      try {
        if (!existsSync(cacheMetaPath) || !existsSync(cacheTextPath)) return null
        const parsed: unknown = JSON.parse(readFileSync(cacheMetaPath, 'utf8'))
        if (!isNovelCacheMeta(parsed)) {
          // 形状不对同样是「未命中」，不是「命中但字段是 undefined」——后者会一路
          // 送到渲染进程（Task 6 的 openNovel 是 `if (cached) return cached`）。
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
        // 提交点校验。少了这一行，「新 text + 旧 meta」这种崩溃残留也能通过上面三项
        // （meta 记的是自己那本书的 sourcePath/mtime/size，全都自洽），
        // 于是把 A 书的章节目录配上 B 书的正文交给用户。
        // 反过来「旧 text + 新 meta」同样在这里被拦下。旧版本写的缓存没有 textBytes
        // 字段，比较时 undefined 必然不等 → 自动降级为 cache miss 重读源文件。
        //
        // 【这一道门同时管住「text 自己写坏」，所以不必拆成两道】text 没有 temp+rename，
        // 也不需要：半截的 text 会让 meta 里描述【源文件】的 sourcePath/mtimeMs/size 依然
        // 成立，而 textBytes 描述的是一个更短的文件，于是被同一处比较拒掉。实测：66 字节的
        // 正文只落盘前 56 字节（确为原文前缀、源文件未变）时 readNovelCache 返回 null。
        // 一个提交点覆盖「meta 写坏」与「text 写坏」两个方向。
        //
        // 【这一门的边界，别当成保证】它比的是字节数，所以两段【等长】的文本仍会被放行：
        // 实测为 A 书写好缓存后，把 novel-cache.txt 覆写成另一段等长文本而 meta 不动，
        // readNovelCache(A) 仍返回 A 的章节目录配那段新文本。要彻底关掉这个窗口，
        // textBytes 得换成内容哈希——那要改动 types.ts 里的 NovelCacheMeta（Task 2 的文件），
        // 本次不做（见设计文档 §13）。
        if (statSync(cacheTextPath).size !== meta.textBytes) return null
        return {
          title: meta.title,
          sourcePath: meta.sourcePath,
          encoding: meta.encoding,
          hadBom: meta.hadBom,
          flatText: readFileSync(cacheTextPath, 'utf8'),
          chapters: meta.chapters
        }
      } catch (err) {
        console.warn('[wt] 读取小说缓存失败，将重新读取源文件：', err)
        return null
      }
    }
  }
}
