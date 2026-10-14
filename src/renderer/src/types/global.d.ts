import type { AppSettings, Novel, PersistedSession, ThemeSource } from '../../../core/types'

// 外观偏好的定义只留 core 一处（`ThemeSource`）：渲染层再声明一份的话两处会各自漂移。
export type { ThemeSource }

/**
 * 渲染层眼里的 `window.api`。
 *
 * 【这是一份**手写**接口，与 preload 那句 `export type WtApi = typeof api` 没有编译期联系】
 * 实测：后者（`src/preload/index.ts` 末尾）**零引用者**——全仓库搜 `WtApi` 只有定义处，
 * 使用者（本文件的 `Window.api`、`App.tsx` 的 `getApi()`、`state/theme.ts`、
 * `tests/setup.ts` 的 `benignApi`）全部指向这一份。**所以往 preload 加方法不会让任何东西编译不过**，
 * 那份替身也不会因为「跟 preload 不同步」而报错——两边各自漂移都没有闸拦着。
 * 改动 API 面时【两边都要手动改】，别以为有一处会替你报错。
 */
export interface WtApi {
  /** 'darwin' | 'win32' | 'linux'。渲染层靠它决定要不要给红绿灯让位 */
  platform: string
  importNovel: () => Promise<Novel | null>
  importWorkDoc: () => Promise<Novel | null>
  loadWorkDoc: (path: string) => Promise<Novel | null>
  /** 取一张工作文档里的图片，回来的是 `data:` URL；失败给 `null` */
  loadWorkDocImage: (src: string) => Promise<string | null>
  openNovelPath: (path: string) => Promise<Novel>
  initialNovelPath: () => Promise<string | null>
  /** 取【某一本书】自己的阅读进度。按书存之后，sourcePath 是必填的那把钥匙。 */
  loadSession: (sourcePath: string) => Promise<PersistedSession | null>
  saveSession: (session: PersistedSession) => Promise<void>
  clearSession: () => Promise<void>
  loadSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<void>
  onMenuCommand: (cb: (cmd: string) => void) => () => void
  getTheme: () => Promise<boolean>
  setThemeSource: (source: ThemeSource) => Promise<void>
  onThemeChange: (cb: (dark: boolean) => void) => () => void
}

declare global {
  interface Window {
    api: WtApi
  }
}
