import { app, Menu, shell, type BrowserWindow } from 'electron'
import { CH, type MenuCommand } from './ipc'
import type { ResolvedShortcuts } from '../core/shortcuts'
import { toAccelerator } from '../core/shortcuts'

/**
 * 建原生应用菜单。**只有 macOS 会真的建出菜单**，见下面的注释。
 *
 * 【为什么快捷键表是**取**而不是**传**】菜单要在设置改动之后重建，而设置是渲染层改的。
 * 传一个取值函数而不是一张表，调用方（`index.ts` 与 `ipc.ts`）就不必各自维护「当前是哪
 * 一份」——它们只管在需要的时候重建一次。
 */
export function buildAppMenu(
  getWindow: () => BrowserWindow | null,
  getShortcuts: () => ResolvedShortcuts
): void {
  const send = (cmd: MenuCommand): void => {
    getWindow()?.webContents.send(CH.menuCommand, cmd)
  }

  // 【为什么非 macOS 一个菜单都不建】Windows / Linux 的原生菜单栏渲染在**窗口内部**、
  // 标题栏正下方那一行，而真 Word 那个位置是功能区（文件 / 开始 / 插入 …）。一条
  // 「文件 编辑 视图 帮助」横在那儿，伪装的意图当场就露了——这跟状态栏那几处破绽是同一类问题。
  //
  // macOS 相反：菜单在**屏幕顶部**，每个 Mac 应用都有、真 Word 也有，不构成破绽；而且
  // ⌘Q / ⌘H / ⌘C 这些系统级快捷键靠它，去掉会连带废掉。
  //
  // 【不建菜单会连带失去什么（仅 Windows / Linux）】
  //  - `Ctrl+O`（导入小说）失效——改从设置对话框进（`⌘/Ctrl + ,` →「导入小说」按钮）；
  //  - 撤销/重做/复制/粘贴这些 `role` 没了——但**可编辑元素里的 Ctrl+C/V/X/A/Z 由 Chromium
  //    自己处理，与菜单无关**，所以设置里的文档名、比例框照常能复制粘贴。
  //
  // 【为什么不用 setMenuBarVisibility(false) 保留加速键】那条路是「菜单还在、只是藏起来」，
  // 藏得干不干净依赖平台行为（autoHideMenuBar 与 Alt 键的交互），而本机只有 macOS、
  // 验不了 Windows。`setApplicationMenu(null)` 是**确定没有菜单**，伪装上不留任何余地。
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { label: '关于 ' + app.name, click: () => send('about') },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '文件',
      submenu: [
        {
          label: '导入小说…',
          // 【为什么这里可能为空】非 darwin 根本走不到这一段（下面直接 return 了），而
          // darwin 上 `shortcutProblem` 与白名单保证了 accelerator 一定转得出来。取空是
          // 防御性的：真为空时菜单项只是不显示快捷键，功能照旧。
          ...(toAccelerator(getShortcuts().import) === null
            ? {}
            : { accelerator: toAccelerator(getShortcuts().import) as string }),
          click: () => send('import-novel')
        },
        {
          label: '清除阅读记录',
          click: () => send('clear-session')
        },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于', click: () => send('about') },
        {
          label: '项目主页',
          click: () => {
            void shell.openExternal('https://github.com/')
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
