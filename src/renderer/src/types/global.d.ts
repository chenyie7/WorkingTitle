import type { Novel, PersistedSession } from '../../../core/types'

export interface WtApi {
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
