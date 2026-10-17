import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../main/channels'
import type { IpcResult, WtApi } from '../core/api'
import type { Chapter, ImportNovelResult, Novel } from '../core/types'

type Channel = (typeof CH)[keyof typeof CH]

/**
 * 统一把「主进程抛错」折成 `IpcResult`：invoke 的 rejection 在渲染层只是一个没有字段的
 * Error，而调用方需要区分「取消」与「出错」，不该各自再猜。
 */
async function call<T>(channel: Channel, ...args: unknown[]): Promise<IpcResult<T>> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

const api: WtApi = {
  /** 沙箱 preload 能拿到 process.platform，渲染层拿不到——在这里读一次当普通值交出去。 */
  platform: process.platform,
  importNovel: () => call<ImportNovelResult>(CH.importNovel),
  importWorkDoc: () => call<Novel>(CH.importWorkDoc),
  loadWorkDoc: (path: string) => ipcRenderer.invoke(CH.loadWorkDoc, path),
  loadWorkDocImage: (src: string) => ipcRenderer.invoke(CH.loadWorkDocImage, src),
  openNovelPath: (path: string) => call<Novel>(CH.openNovelPath, path),
  listNovels: () => ipcRenderer.invoke(CH.listNovels),
  deleteNovel: (id: string) => call<void>(CH.deleteNovel, id),
  resplitNovel: (sourcePath: string, rule) => call<Chapter[]>(CH.resplitNovel, sourcePath, rule),
  initialNovelPath: () => ipcRenderer.invoke(CH.initialNovelPath),
  loadSession: (sourcePath: string) => ipcRenderer.invoke(CH.loadSession, sourcePath),
  // 写通道的参数在 main 侧会再校验一遍；这里不做任何「看起来安全」的裁剪。
  saveSession: (session) => call<void>(CH.saveSession, session),
  clearSession: () => call<void>(CH.clearSession),
  loadSettings: () => ipcRenderer.invoke(CH.loadSettings),
  saveSettings: (settings) => call<void>(CH.saveSettings, settings),
  onMenuCommand: (cb: (cmd: string) => void): (() => void) => {
    const listener = (_e: unknown, cmd: string): void => cb(cmd)
    ipcRenderer.on(CH.menuCommand, listener)
    return () => {
      ipcRenderer.removeListener(CH.menuCommand, listener)
    }
  },
  // 渲染层读不到系统外观（`@media (prefers-color-scheme: dark)` 在本应用恒不命中），
  // 只能由主进程递过来。
  getTheme: () => ipcRenderer.invoke(CH.getTheme),
  setThemeSource: (source) => call<void>(CH.setThemeSource, source),
  onThemeChange: (cb: (dark: boolean) => void): (() => void) => {
    const listener = (_e: unknown, dark: boolean): void => cb(dark)
    ipcRenderer.on(CH.themeChanged, listener)
    return () => {
      ipcRenderer.removeListener(CH.themeChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
