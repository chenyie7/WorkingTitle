import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { Novel, NovelCacheMeta, PersistedSession } from '../core/types'

export interface SessionStore {
  readSession(): PersistedSession | null
  writeSession(s: PersistedSession): void
  clearAll(): void
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
 */
function isPersistedSession(v: unknown): v is PersistedSession {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  if (typeof s.novelTitle !== 'string' || typeof s.sourcePath !== 'string') return false
  if (s.mode !== 'ime' && s.mode !== 'key') return false
  if (!Array.isArray(s.chapterPos)) return false
  if (!s.chapterPos.every((n) => typeof n === 'number')) return false
  if (s.startedAt !== null && typeof s.startedAt !== 'number') return false
  for (const k of ['ratio', 'cursor', 'revealStart', 'activeChapter']) {
    const n = s[k]
    if (typeof n !== 'number' || !Number.isFinite(n)) return false
  }
  return true
}

/** NovelCacheMeta.chapters 里每个元素的必填字段。 */
function isChapter(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  if (typeof c.title !== 'string') return false
  for (const k of ['index', 'start', 'end', 'charCount']) {
    const n = c[k]
    if (typeof n !== 'number' || !Number.isFinite(n)) return false
  }
  return true
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
 */
function isNovelCacheMeta(v: unknown): v is NovelCacheMeta {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  if (typeof m.sourcePath !== 'string' || typeof m.title !== 'string') return false
  if (typeof m.encoding !== 'string' || typeof m.hadBom !== 'boolean') return false
  for (const k of ['mtimeMs', 'size', 'textBytes']) {
    const n = m[k]
    if (typeof n !== 'number' || !Number.isFinite(n)) return false
  }
  return Array.isArray(m.chapters) && m.chapters.every(isChapter)
}

export function createSessionStore(baseDir: string): SessionStore {
  const sessionPath = join(baseDir, 'session.json')
  const sessionTmpPath = join(baseDir, 'session.json.tmp')
  const cacheMetaPath = join(baseDir, 'novel-cache.json')
  const cacheTextPath = join(baseDir, 'novel-cache.txt')

  const ensureDir = (): void => {
    mkdirSync(baseDir, { recursive: true })
  }

  return {
    readSession(): PersistedSession | null {
      try {
        if (!existsSync(sessionPath)) return null
        const parsed: unknown = JSON.parse(readFileSync(sessionPath, 'utf8'))
        if (!isPersistedSession(parsed)) {
          // 结构不合法的记录同样要说出来：静默丢弃就是「进度莫名其妙没了」的成因。
          console.warn('[wt] 会话文件结构不合法，按无记录处理：', sessionPath)
          return null
        }
        return parsed
      } catch (err) {
        // 解析失败与「文件读不出来」都按无记录处理，启动不该被一份坏文件卡住；
        // 但要说出来——不然「目录只读 / 磁盘满」会表现成「应用一切正常，只是记不住进度」。
        console.warn('[wt] 读取会话失败，按无记录处理：', err)
        return null
      }
    },

    writeSession(s: PersistedSession): void {
      try {
        ensureDir()
        // 先写临时文件再改名（同一个目录内，rename 是原子的）：读取方要么看到旧的完整
        // 文件、要么看到新的完整文件，不会看到「写了一半的 session.json」。
        // 直接写目标路径的话，进程在写完之前死掉，留下的是截断甚至空的文件，readSession
        // 只能返回 null——游标、chapterPos、activeChapter、ratio、mode、startedAt 全部
        // 静默丢失。实测这种残留的表现：截断成 20 字节与空文件都读回 null。
        // 注意这条保护的是一次写入【之内】的完整性，写入之间的窗口只能靠调用方的防抖收敛。
        writeFileSync(sessionTmpPath, JSON.stringify(s), 'utf8')
        renameSync(sessionTmpPath, sessionPath)
      } catch (err) {
        console.warn('[wt] 保存会话失败，本次进度未落盘：', err)
      }
    },

    clearAll(): void {
      // 临时文件也要删：崩溃可能正好把 .tmp 留在磁盘上，「清除阅读记录」应当清干净。
      for (const p of [sessionPath, sessionTmpPath, cacheMetaPath, cacheTextPath]) {
        try {
          if (existsSync(p)) rmSync(p)
        } catch (err) {
          console.warn('[wt] 删除持久化文件失败：', p, err)
        }
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
          console.warn('[wt] 缓存元数据结构不合法，按未命中处理：', cacheMetaPath)
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
