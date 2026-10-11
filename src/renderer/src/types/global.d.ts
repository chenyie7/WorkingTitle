import type { AppSettings, Novel, PersistedSession, ThemeSource } from '../../../core/types'

// 外观偏好的定义只留 core 一处（`ThemeSource`）：渲染层再声明一份的话两处会各自漂移。
export type { ThemeSource }

export interface WtApi {
  /** 'darwin' | 'win32' | 'linux'。渲染层靠它决定要不要给红绿灯让位 */
  platform: string
  importNovel: () => Promise<Novel | null>
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
