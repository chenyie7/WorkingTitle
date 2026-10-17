import type {
  AppSettings,
  Chapter,
  ChapterRule,
  ImportNovelResult,
  LibraryEntry,
  Novel,
  PersistedSession,
  ThemeSource
} from './types'

/**
 * 跨进程调用的统一结果。
 *
 * `reason === 'canceled'` 表示用户取消，不是错误；其余 reason 直接给用户看。
 * 写通道必须返回它：`void` 会把「磁盘满 / 目录只读」变成静默丢数据。
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; reason: string }

/**
 * 渲染层眼里的 `window.api`。preload 的对象字面量以它为目标类型，
 * 多写或漏写方法都会在编译期报错。
 *
 * `platform` 是同步值：主题与标题条留白要在首次渲染前就拿到。
 */
export interface WtApi {
  /** 'darwin' | 'win32' | 'linux' */
  platform: string
  importNovel: () => Promise<IpcResult<ImportNovelResult>>
  importWorkDoc: () => Promise<IpcResult<Novel>>
  /** 读不出来是正常路径，返回 null，不抛 */
  loadWorkDoc: (path: string) => Promise<Novel | null>
  /** 取一张工作文档里的图片，回来的是 `data:` URL；失败给 `null` */
  loadWorkDocImage: (src: string) => Promise<string | null>
  openNovelPath: (path: string) => Promise<IpcResult<Novel>>
  listNovels: () => Promise<LibraryEntry[]>
  deleteNovel: (id: string) => Promise<IpcResult<void>>
  /** 按新规则重切已打开的书，返回新的章节目录；正文与进度由调用方原样保留。 */
  resplitNovel: (sourcePath: string, rule: ChapterRule) => Promise<IpcResult<Chapter[]>>
  initialNovelPath: () => Promise<string | null>
  loadSession: (sourcePath: string) => Promise<PersistedSession | null>
  saveSession: (session: PersistedSession) => Promise<IpcResult<void>>
  loadSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<IpcResult<void>>
  onMenuCommand: (cb: (cmd: string) => void) => () => void
  getTheme: () => Promise<boolean>
  setThemeSource: (source: ThemeSource) => Promise<IpcResult<void>>
  onThemeChange: (cb: (dark: boolean) => void) => () => void
}
