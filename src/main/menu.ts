import { app, Menu, shell, type BrowserWindow } from 'electron'
import { CH, type MenuCommand } from './ipc'

export function buildAppMenu(getWindow: () => BrowserWindow | null): void {
  const send = (cmd: MenuCommand): void => {
    getWindow()?.webContents.send(CH.menuCommand, cmd)
  }

  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
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
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '导入小说…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('import-novel')
        },
        {
          label: '清除阅读记录',
          click: () => send('clear-session')
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' }
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
