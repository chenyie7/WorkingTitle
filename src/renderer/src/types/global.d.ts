import type { Novel, PersistedSession } from '../../../core/types'

export interface WtApi {
  /** 'darwin' | 'win32' | 'linux'。渲染层靠它决定要不要给红绿灯让位 */
  platform: string
  importNovel: () => Promise<Novel | null>
  openNovelPath: (path: string) => Promise<Novel>
  initialNovelPath: () => Promise<string | null>
  loadSession: () => Promise<PersistedSession | null>
  saveSession: (session: PersistedSession) => Promise<void>
  clearSession: () => Promise<void>
  onMenuCommand: (cb: (cmd: string) => void) => () => void
  getTheme: () => Promise<boolean>
  onThemeChange: (cb: (dark: boolean) => void) => () => void
}

declare global {
  interface Window {
    api: WtApi
  }
}
