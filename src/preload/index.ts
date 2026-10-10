import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../main/channels'

const api = {
  /**
   * 宿主平台。渲染层要据此决定标题条左侧留多少空位——macOS 用了
   * `titleBarStyle: 'hiddenInset'`，红绿灯浮在网页上，必须给它们让出位置；
   * Windows/Linux 没有红绿灯，留空反而是个洞。
   *
   * 沙箱化的 preload 能拿到 `process.platform`（Electron 在沙箱里保留了这几个字段），
   * 但**渲染层拿不到**——所以在这里读取、作为普通值交给它。
   */
  platform: process.platform,
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
