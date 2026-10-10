import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../main/channels'

const api = {
  importNovel: () => ipcRenderer.invoke(CH.importNovel),
  openNovelPath: (path: string) => ipcRenderer.invoke(CH.openNovelPath, path),
  initialNovelPath: () => ipcRenderer.invoke(CH.initialNovelPath),
  loadSession: () => ipcRenderer.invoke(CH.loadSession),
  saveSession: (session: unknown) => ipcRenderer.invoke(CH.saveSession, session),
  clearSession: () => ipcRenderer.invoke(CH.clearSession),
  onMenuCommand: (cb: (cmd: string) => void): (() => void) => {
    const listener = (_e: unknown, cmd: string): void => cb(cmd)
    ipcRenderer.on(CH.menuCommand, listener)
    return () => {
      ipcRenderer.removeListener(CH.menuCommand, listener)
    }
  },
  /**
   * 系统是不是深色外观。
   *
   * 【为什么必须走 IPC，而不是在 CSS 里写 `@media (prefers-color-scheme: dark)`】
   * 实测（Electron 44 / macOS 深色系统）：渲染层的 `matchMedia('(prefers-color-scheme: dark)')`
   * **恒为 false**——主进程 `nativeTheme.shouldUseDarkColors` 是 true、`themeSource` 设成 'dark'
   * 之后重载整窗也仍是 false。也就是说那条 media query 在本应用里**永远不会命中**，
   * 只能由主进程把值显式递过来。别把它"简化"回 CSS 媒体查询。
   */
  getTheme: (): Promise<boolean> => ipcRenderer.invoke(CH.getTheme),
  onThemeChange: (cb: (dark: boolean) => void): (() => void) => {
    const listener = (_e: unknown, dark: boolean): void => cb(dark)
    ipcRenderer.on(CH.themeChanged, listener)
    return () => {
      ipcRenderer.removeListener(CH.themeChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type WtApi = typeof api
