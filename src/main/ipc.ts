import { dialog, ipcMain, nativeTheme, type BrowserWindow } from 'electron'
import { dirname } from 'node:path'
import { loadNovelFromFile } from './loadNovel'
import { chapterRuleProblem } from '../core/chapters'
import {
  NovelWorkerTimeoutError,
  NovelWorkerUnavailableError,
  openNovelInBackground,
  resplitNovelInBackground
} from './novelLoader'
import { openNovelWithRule, resplitNovelWithRule } from './novelService'
import { getStore } from './session'
import { loadWorkDocImage } from './workDocImage'
// 必须【既 import 又 re-export】：`export … from` 只把名字交给外部，**不在本模块作用域里
// 绑定 CH**，而下面的 registerIpc 要用 CH.*。实测（Task 6）：只写一行 re-export，typecheck
// 报 TS2304「Cannot find name 'CH'」6 处，全部落在本文件的 ipcMain.handle 调用上。
import { CH } from './channels'
import type { IpcResult } from '../core/api'
import type { AppSettings, Chapter, ChapterRule, Novel, PersistedSession } from '../core/types'

export { CH, MENU_COMMANDS, type MenuCommand } from './channels'

/**
 * 打开小说：命中缓存则复用，避免重复解码与重新检测编码。
 *
 * 【走后台进程】解码与缓存读写都不该占住主进程的事件循环——9MB 的样本实测会让其它 IPC
 * 排队约 220ms。只有后台进程自身起不来时才回退到同步路径（打包异常时仍能用，只是会卡）。
 */
export async function openNovel(filePath: string): Promise<Novel> {
  try {
    return await openNovelInBackground(filePath)
  } catch (err) {
    if (!(err instanceof NovelWorkerUnavailableError)) throw err
    console.warn('[wt] 后台解码不可用，回退到主进程同步读取：', err)
  }
  const store = getStore()
  return openNovelWithRule(store, filePath)
}

/**
 * 读一份**工作文档**。**只管读，不判空**。
 *
 * 【与 `openNovel` 的两处不同，每一处都是有意的】
 *
 * 1. **不写小说缓存**。缓存是单槽的（`novel-cache.json` + `novel-cache.txt` 共用一份），
 *    工作文档占了它，小说每次启动都要重解码一遍（9MB 那本是秒级）。工作文档是小文本，
 *    每次启动直接读，几十毫秒。
 * 2. **不抛异常，只返回 null**。文件读不出来（被移走、权限、EISDIR）是一条正常路径——
 *    渲染层据此在设置里标红并给一句提示，而不是把那次 `invoke` 打成 rejection。
 *    （「解不出编码」今天传不到这里：`decodeBuffer` 是全域的，自带 catch、空缓冲也短路；
 *    留在 catch 里只是兜底。）
 *
 * 【空文本这一条为什么从这里挪走了】它原先也在这里判，于是「对话框取消」与「选了个空文件」
 * 在渲染层是**同一个 null**，`if (!doc) return` 只能沉默——用户选了个空 txt，屏幕上什么都
 * 不发生，而设计 §9 承诺的是「当场拒绝 + toast」。两者必须分得开，判空因此各归各路：
 * **boot 那条路当「读不出来」**（`wt:load-work-doc` 里判，切过去一片空白等于没有），
 * **import 那条路把空 Novel 原样返回**，由渲染层出声并拒绝。**别看到两处判空就以为是重复。**
 */
function loadWorkDoc(filePath: string): Novel | null {
  if (typeof filePath !== 'string') return null
  try {
    return loadNovelFromFile(filePath)
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
  ipcMain.handle(CH.importNovel, async (): Promise<IpcResult<Novel>> => {
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
    // 【与下面 import-work-doc 那个对话框是同一套骨架】改一处要改两处——这 8 行逐字重复。
    // 没提成公共函数是刻意的：这条路径至今零测试覆盖，顺手重构等于拿纯外观收益去冒静默回归。
    try {
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return { ok: false, reason: 'canceled' }
      return { ok: true, value: await openNovel(result.filePaths[0]) }
    } catch (err) {
      console.warn('[wt] 导入小说失败：', err)
      return { ok: false, reason: `导入失败：${err instanceof Error ? err.message : String(err)}` }
    }
  })

  ipcMain.handle(CH.importWorkDoc, async (): Promise<IpcResult<Novel>> => {
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
    // 骨架与上面 import-novel 那个逐字相同，改一处要改两处（理由见那处的注释）。
    try {
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return { ok: false, reason: 'canceled' }
      // **空 Novel 原样返回**（不判空）：返回失败会与「取消」撞成同一个值，渲染层就没法
      // 出声了。出声与拒绝都归渲染层——见 `loadWorkDoc` 的说明与 App 里的 `handleImportWorkDoc`。
      const doc = loadWorkDoc(result.filePaths[0])
      return doc ? { ok: true, value: doc } : { ok: false, reason: '这个文件读不出来' }
    } catch (err) {
      console.warn('[wt] 导入工作文档失败：', err)
      return { ok: false, reason: `导入失败：${err instanceof Error ? err.message : String(err)}` }
    }
  })

  // 启动这条路**判空**：空文档在这里等同于「读不出来」，落到 `workDocBroken`（设置里标红、
  // 老板键给一句说明）。import 那条路刻意不判——理由见上面 `loadWorkDoc` 的说明。
  ipcMain.handle(CH.loadWorkDoc, (_e, filePath: string): Novel | null => {
    const novel = loadWorkDoc(filePath)
    return novel && novel.flatText.length > 0 ? novel : null
  })

  /**
   * 取工作文档里的图片。
   *
   * 【基准目录为什么在这里算，而不是让渲染层传】渲染层若能指定基准目录，
   * 就等于能把「读相对路径」变成「读任意目录下的任意图片」。这里从设置里读
   * 工作文档自己的路径、取它的目录，渲染层能碰的范围就锁死在「工作文档旁边 + 网络」。
   *
   * 【失败返回 null，不抛】与 `loadWorkDoc` 同一姿态：读不出来是一条正常路径，
   * 渲染层显示占位框，不该把那次 invoke 打成 rejection。
   */
  ipcMain.handle(CH.loadWorkDocImage, async (_e, src: string): Promise<string | null> => {
    const docPath = getStore().readSettings().workDocPath
    const baseDir = docPath ? dirname(docPath) : ''
    return loadWorkDocImage(src, baseDir)
  })

  ipcMain.handle(CH.openNovelPath, async (_e, filePath: string): Promise<IpcResult<Novel>> => {
    try {
      return { ok: true, value: await openNovel(filePath) }
    } catch (err) {
      console.warn('[wt] 打开小说失败：', filePath, err)
      return { ok: false, reason: `打开失败：${err instanceof Error ? err.message : String(err)}` }
    }
  })

  ipcMain.handle(
    CH.resplitNovel,
    async (_e, sourcePath: unknown, rule: unknown): Promise<IpcResult<Chapter[]>> => {
      if (typeof sourcePath !== 'string') return { ok: false, reason: '路径不是字符串' }
      const problem = chapterRuleProblem(rule)
      if (problem !== null) return { ok: false, reason: `分章规则不合法：${problem}` }
      const chapterRule = rule as ChapterRule
      try {
        return { ok: true, value: await resplitNovelInBackground(sourcePath, chapterRule) }
      } catch (err) {
        if (err instanceof NovelWorkerTimeoutError) {
          return { ok: false, reason: '规则执行超时，目录未改动' }
        }
        if (!(err instanceof NovelWorkerUnavailableError)) {
          // 预期内的失败（例如 0 章匹配）原样交给界面，不加前缀。
          return { ok: false, reason: err instanceof Error ? err.message : String(err) }
        }
        console.warn('[wt] 后台进程不可用，回退到主进程重新分章：', err)
        return resplitNovelWithRule(getStore(), sourcePath, chapterRule)
      }
    }
  )

  ipcMain.handle(CH.initialNovelPath, (): string | null => deps.getInitialNovelPath())

  ipcMain.handle(CH.loadSession, (_e, sourcePath: string): PersistedSession | null =>
    getStore().readSession(sourcePath)
  )

  ipcMain.handle(CH.saveSession, (_e, session: unknown): IpcResult<void> =>
    getStore().writeSession(session)
  )

  ipcMain.handle(CH.clearSession, (): IpcResult<void> => getStore().clearReadingHistory())

  ipcMain.handle(CH.loadSettings, (): AppSettings => getStore().readSettings())

  ipcMain.handle(CH.saveSettings, (_e, settings: unknown): IpcResult<void> => {
    const result = getStore().writeSettings(settings)
    // 只在确实落盘之后重建：菜单的 accelerator 要跟着磁盘上那份键走。
    if (result.ok) deps.rebuildMenu()
    return result
  })

  // 系统是不是深色外观。渲染层拿不到这个值（见 preload 里那段说明），只能从这里问。
  ipcMain.handle(CH.getTheme, (): boolean => nativeTheme.shouldUseDarkColors)

  // 用户在设置里选的外观（跟随系统 / 浅色 / 深色）。
  //
  // 【为什么必须落到 nativeTheme 而不是只翻一个 CSS 类】macOS 的**红绿灯与其它原生部分**
  // 由 `themeSource` 决定；只在页面里换 class 的话，网页变暗了而红绿灯仍是系统色——
  // 那正是刚修好的那个「两块颜色对不上」。改这里会触发下面的 `nativeTheme.on('updated')`
  // 广播，原生与网页一起变。
  ipcMain.handle(CH.setThemeSource, (_e, source: unknown): IpcResult<void> => {
    if (source !== 'system' && source !== 'light' && source !== 'dark') {
      return { ok: false, reason: '未知的外观取值' }
    }
    nativeTheme.themeSource = source
    return { ok: true, value: undefined }
  })
}
