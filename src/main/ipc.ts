import { dialog, ipcMain, nativeTheme, type BrowserWindow } from 'electron'
import { loadNovelFromFile } from './loadNovel'
import { getStore } from './session'
// 必须【既 import 又 re-export】：`export … from` 只把名字交给外部，**不在本模块作用域里
// 绑定 CH**，而下面的 registerIpc 要用 CH.*。实测（Task 6）：只写一行 re-export，typecheck
// 报 TS2304「Cannot find name 'CH'」6 处，全部落在本文件的 ipcMain.handle 调用上。
import { CH } from './channels'
import type { AppSettings, Novel, PersistedSession } from '../core/types'

export { CH, MENU_COMMANDS, type MenuCommand } from './channels'

/** 打开小说：命中缓存则复用，避免重复解码与重新检测编码。 */
export function openNovel(filePath: string): Novel {
  const store = getStore()
  const cached = store.readNovelCache(filePath)
  if (cached) return cached
  const novel = loadNovelFromFile(filePath)
  store.writeNovelCache(novel)
  return novel
}

/**
 * 读一份**工作文档**。
 *
 * 【与 `openNovel` 的三处不同，每一处都是有意的】
 *
 * 1. **不写小说缓存**。缓存是单槽的（`novel-cache.json` + `novel-cache.txt` 共用一份），
 *    工作文档占了它，小说每次启动都要重解码一遍（9MB 那本是秒级）。工作文档是小文本，
 *    每次启动直接读，几十毫秒。
 * 2. **不抛异常，只返回 null**。文件读不出来（被移走、权限、EISDIR、解不出编码）是一条
 *    正常路径——渲染层据此在设置里标红并给一句提示，而不是把那次 `invoke` 打成 rejection。
 * 3. **空文本判为不可用**。一份空文档放进来的话，老板键切过去是一片空白，等于没有。
 */
function loadWorkDoc(filePath: string): Novel | null {
  if (typeof filePath !== 'string') return null
  try {
    const novel = loadNovelFromFile(filePath)
    return novel.flatText.length === 0 ? null : novel
  } catch (err) {
    console.warn('[wt] 读取工作文档失败：', filePath, err)
    return null
  }
}

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  getInitialNovelPath: () => string | null
  /** 设置写盘后重建原生菜单——菜单里的 accelerator 要跟着用户改的键走。 */
  rebuildMenu: () => void
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle(CH.importNovel, async (): Promise<Novel | null> => {
    const win = deps.getWindow()
    const options: Electron.OpenDialogOptions = {
      title: '导入小说',
      buttonLabel: '导入',
      filters: [
        { name: '文本文件', extensions: ['txt'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return openNovel(result.filePaths[0])
  })

  ipcMain.handle(CH.importWorkDoc, async (): Promise<Novel | null> => {
    const win = deps.getWindow()
    const options: Electron.OpenDialogOptions = {
      title: '导入工作文档',
      buttonLabel: '导入',
      // 纯文本优先。docx 刻意不在列表里——那要一整套保真渲染，见设计文档第 3 节。
      filters: [
        { name: '文本文件', extensions: ['txt', 'md'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return loadWorkDoc(result.filePaths[0])
  })

  ipcMain.handle(CH.loadWorkDoc, (_e, filePath: string): Novel | null => loadWorkDoc(filePath))

  ipcMain.handle(CH.openNovelPath, async (_e, filePath: string): Promise<Novel> => openNovel(filePath))

  ipcMain.handle(CH.initialNovelPath, (): string | null => deps.getInitialNovelPath())

  ipcMain.handle(CH.loadSession, (_e, sourcePath: string): PersistedSession | null =>
    getStore().readSession(sourcePath)
  )

  ipcMain.handle(CH.saveSession, (_e, session: PersistedSession): void => {
    getStore().writeSession(session)
  })

  ipcMain.handle(CH.clearSession, (): void => {
    getStore().clearReadingHistory()
  })

  ipcMain.handle(CH.loadSettings, (): AppSettings => getStore().readSettings())

  ipcMain.handle(CH.saveSettings, (_e, settings: AppSettings): void => {
    getStore().writeSettings(settings)
    // 【为什么在这里重建而不是新开一条 IPC 通道】设置本来就要从这条路进主进程，顺手重建
    // 比让渲染层再喊一声省一条通道、也少一个「谁先谁后」的问题。
    // 【为什么可以无条件重建】非 darwin 上 buildAppMenu 直接 return，成本是一次判断。
    deps.rebuildMenu()
  })

  // 系统是不是深色外观。渲染层拿不到这个值（见 preload 里那段说明），只能从这里问。
  ipcMain.handle(CH.getTheme, (): boolean => nativeTheme.shouldUseDarkColors)

  // 用户在设置里选的外观（跟随系统 / 浅色 / 深色）。
  //
  // 【为什么必须落到 nativeTheme 而不是只翻一个 CSS 类】macOS 的**红绿灯与其它原生部分**
  // 由 `themeSource` 决定；只在页面里换 class 的话，网页变暗了而红绿灯仍是系统色——
  // 那正是刚修好的那个「两块颜色对不上」。改这里会触发下面的 `nativeTheme.on('updated')`
  // 广播，原生与网页一起变。
  ipcMain.handle(CH.setThemeSource, (_e, source: unknown): void => {
    if (source !== 'system' && source !== 'light' && source !== 'dark') return
    nativeTheme.themeSource = source
  })
}
