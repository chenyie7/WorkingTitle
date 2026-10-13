import { BOSS_FILL_MAX } from './bossKey'
import type { ShortcutId } from './shortcuts'

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
   * 由「统一收尾规则」维护：**`pump` 与 `backspace` 的每一次游标变化之后**，都重算
   * cursor 所在章的那一项。`jumpToChapter` 是刻意的例外——它只重算被点击的那一章，
   * 并把 `activeChapter` 直接设为该章（理由见 `engine.ts` 里该方法的注释与 spec §2）。
   *
   * 写成「任何一次游标变化之后」是不成立的：跳章也改变游标，却刻意不走这条路。
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
  /**
   * **全局**的阅读替换比例：新导入的书用它当起点。范围与当前书那个一样是 1–500。
   *
   * 【与 `PersistedSession.ratio` 的分工】那一份是**当前书**的比例，也是真正生效的那个
   * （引擎只认它）。这一份不是「覆盖值」，而是**导入时的初值**：一本书第一次被打开时取它，
   * 之后各管各的——**改全局不影响已经打开过的书，只影响之后导入的**。
   * 于是两者之间没有「跟随」这层状态，界面上两个普通输入框就够了。
   */
  ratio: number
  /**
   * 导入的**工作文档**源文件路径。`null` = 没配。
   *
   * 老板键切过去显示的就是它。它是一本普通的 `Novel`（走同一条 `loadNovelFromFile` 管线），
   * 只是**不落盘**——不写 novel-cache（缓存是单槽的，让它占了，小说每次启动都要重解码），
   * 也不写 `sessions/`（老板键每次进入都按铺满量重铺，见设计文档第 5 节）。
   */
  workDocPath: string | null
  /**
   * 老板键切过去时「铺满一页」的百分比，0–100。
   *
   * 【只做结构校验，值域夹紧归 core】与 `ratio` 同一姿态：这一层的职责是「这份 JSON 能不能
   * 信」，不是业务规则。夹紧在 `core/bossKey.ts` 的 `clampBossFillPercent`。
   */
  bossFillPercent: number
  /**
   * 用户改过的快捷键。**稀疏表：缺条目 = 用该平台的默认值**，`{}` 就是「全默认」。
   *
   * 【为什么是稀疏而不是完整表】完整表要求「谁读设置谁就得知道平台」，于是
   * `defaultSettings()` 与 `createSessionStore()` 都得加一个平台参数——而它们在测试里
   * 被调用很多次（**这里刻意不写数**：这个量随测试增长，而本句先后写过的「40 / 15」
   * 「55」「63」「六十多」四个版本，全在写下之后不久就过期了）。稀疏之后这两个函数的签名
   * 一个都不用动，`core` 也不必去读 `process`（那是 node 的东西，而 core 要能被渲染进程
   * 共用）。
   *
   * 【为什么值是规范串而不是 accelerator】得把话说准：**单看现在这三条默认值，
   * `CmdOrCtrl` 是够用的**——三条都只是 Meta↔Ctrl 互换（核 `SHORTCUTS` 即知），所以
   * 「合并成一个记号恰好表达不了各平台不一样」这句在该表上并不成立。扣住这个选择的是
   * 另外两件事：
   *
   * 1. core 这一整套（`KeyChord` / `fromChord` / `parseShortcut` / `RESERVED` /
   *    `formatShortcut`）吃的全是规范串，而 `KEY_CODES` 只提供 `e.code → 键名` 这一个
   *    方向（它的**键**被 `isRecordable` 当白名单用，**值**被 `formatShortcut` 与
   *    `toAccelerator` 当键名用），没有反向表——改存 accelerator 就得再造一张
   *    accelerator → `e.code` 的反查表，否则校验与显示都得重写；
   * 2. `ShortcutDef.defaults` 的形状是 `{ darwin, other }`，它容得下「两个平台根本不是
   *    同一个键」这种默认值，而 `CmdOrCtrl` 只表达得了「同一个键换修饰键」。
   *
   * 于是「只在喂菜单那一刻才转成 accelerator」是这条链上唯一的单向转换点。
   */
  shortcuts: Partial<Record<ShortcutId, string>>
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
    lastSourcePath: null,
    ratio: DEFAULT_RATIO,
    workDocPath: null,
    bossFillPercent: BOSS_FILL_MAX,
    /**
     * 默认的快捷键表：**空**。空的意思是「全用该平台的默认值」，逐条的默认值在
     * `shortcuts.ts` 的 `SHORTCUTS` 表里，由 `resolveShortcuts` 补齐。
     *
     * 【为什么不在这里写死一份】写死就要求这个函数知道平台，而它是零参的
     * （见 AppSettings.shortcuts 的说明）。
     *
     * 【为什么是就地写 `{}` 而不是提一个模块级常量】本函数上面那段说明的就是这件事：
     * 共享常量会被消费方就地改掉（`s.shortcuts.import = 'Meta+KeyI'`），于是「默认值」
     * 在下一次调用时已经变了。每次返回一个新的字面量才是这里要的形状。
     */
    shortcuts: {}
  }
}
