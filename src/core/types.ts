export interface Chapter {
  index: number
  title: string
  /** 在 flatText 中的起始偏移（含） */
  start: number
  /** 结束偏移（不含） */
  end: number
  charCount: number
}

export interface Novel {
  /** 文件名（去扩展名） */
  title: string
  sourcePath: string
  /** 检测到的编码名，如 'UTF-8' / 'GB18030' */
  encoding: string
  hadBom: boolean
  /** 所有章节首尾相接（含标题行本身） */
  flatText: string
  chapters: Chapter[]
}

export type InputMode = 'ime' | 'key'

export interface PersistedSession {
  novelTitle: string
  sourcePath: string
  ratio: number
  mode: InputMode
  /**
   * 下一个要被抽出来的字符在 `Novel.flatText` 中的下标。
   * 全项目唯一的核心不变量就在这几个字段上：**阅读区显示的内容恒等于
   * `flatText.slice(revealStart, cursor)`**，除它以外阅读区不显示任何小说文字。
   */
  cursor: number
  /** 当前显示窗口的起点（`flatText` 下标）。打字时不变，只在跳章时移动——「跨章连续」就是这么来的。 */
  revealStart: number
  /**
   * 每章「上次离开该章时，光标停在该章内的偏移」，长度恒等于 `chapters.length`。
   * 由「统一收尾规则」维护：任何一次游标变化之后，都重算 cursor 所在章的那一项。
   */
  chapterPos: number[]
  /** `cursor` 所在章的下标。 */
  activeChapter: number
  /** 首次打字的时间戳（状态栏计时用）；从未打过字时为 null。 */
  startedAt: number | null
}

export interface NovelCacheMeta {
  sourcePath: string
  mtimeMs: number
  size: number
  encoding: string
  hadBom: boolean
  title: string
  chapters: Chapter[]
  /**
   * novel-cache.txt 的 UTF-8 字节数，用作缓存两个文件之间的「提交点」（见 Task 5）：
   * 只有本字段与实际文本文件大小一致时，才承认这对缓存有效。
   *
   * 没有它的话，进程若在写 txt 与写 json 之间崩溃，磁盘上会留下「旧 meta + 新 text」
   * 或「新 meta + 旧 text」，两种组合都能通过 sourcePath/mtime/size 校验，
   * 于是会读出「A 书的章节目录配 B 书的正文」。给每个文件各自做 temp+rename
   * 也修不好，因为崩溃仍会落在两次改名之间——必须让 meta 能自我校验。
   *
   * 刻意声明为必填而非可选：旧版本写下的缓存没有这个字段，比较时 undefined
   * 必然不等，于是自动降级为 cache miss 重读源文件。这是「失败关闭」，
   * 写成可选反而会放行陈旧 meta。
   */
  textBytes: number
}

export const DEFAULT_RATIO = 10
export const MIN_RATIO = 1
export const MAX_RATIO = 500
/** 阅读区渲染窗口上限，超出则折叠前文 */
export const RENDER_WINDOW_LIMIT = 30_000
