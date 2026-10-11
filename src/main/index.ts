import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { platformKind, resolveShortcuts } from '../core/shortcuts'
import { registerIpc } from './ipc'
import { buildAppMenu } from './menu'
import { getStore, resetStore } from './session'
import { applyUserDataOverride, resolveInitialNovelPath } from './startup'
import { CH } from './channels'

/**
 * 窗口自身的底色（不是网页内容的底色，是它【画出来之前】那一层）。
 *
 * 必须跟着系统外观走：macOS 在深色外观下画的是深色的原生标题栏，而窗口底色若仍是浅色，
 * 启动的一瞬间会闪一块白，之后网页内容再把浅色铺满——用户看到的就是「红绿灯那块是黑的、
 * 旁边却是白的」。网页内容本身由渲染层按 data-theme 上色，这一层只负责别闪。
 */
const WINDOW_BG_LIGHT = '#f7f7f8'
const WINDOW_BG_DARK = '#1f1f22'

/**
 * 标题条配色。Windows 上这一对是给**系统画的那三个窗口按钮**用的（`titleBarOverlay`），
 * 取值必须与 CSS 里的 `--wt-titlebar` / `--wt-titlebar-text` 一致，否则按钮那一小块底色
 * 会和网页画的蓝条差一档，看起来就是「右上一块方形补丁」。
 *
 * 【为什么颜色要在主进程再存一份】`titleBarOverlay` 吃的是 JS 字面量，读不到 CSS 变量。
 * 改这里就要同步改 `src/renderer/src/styles/word.css` 的那两个 token——WINDOW_BG_* 与
 * word.css 里的窗口底色也是同样的成对关系，本仓库没有 CSS↔TS 的共享通道。
 */
const TITLEBAR_LIGHT = { color: '#185abd', symbolColor: '#ffffff' }
const TITLEBAR_DARK = { color: '#1f1f22', symbolColor: '#f0f0f2' }
/** 与 `ribbon.css` 里 `.wt-ribbon__title` 的 height 一致；不等的话按钮会错位。 */
const TITLEBAR_HEIGHT = 32

/**
 * 「标题栏交给网页画」所需的窗口选项。Linux 返回空对象，保留系统标题栏。
 *
 * 【为什么 macOS 与 Windows 都要交出去】默认值（`default`）下标题栏由系统画，它的底色跟随
 * 系统外观与强调色，**应用改不了**——而网页里的标题条用的是自己的颜色，两者对不上，用户
 * 看到的正是「标题栏那一块和旁边不是一个色」。交出去之后那一块归我们上色，也顺带没有了
 * 「原生标题条 + 网页里再画一条」的两条标题条。
 *
 * 两平台交出去的程度不同：
 *  - macOS `hiddenInset`：整条归网页，红绿灯浮在网页之上（`trafficLightPosition` 定位）；
 *  - Windows `hidden` + `titleBarOverlay`：整条归网页，但**右上角那三个按钮仍由系统画**，
 *    并按 `titleBarOverlay` 给的底色上色。系统不画标题文字，标题由网页画。
 *
 * Linux 不支持这套，原样保留系统标题栏。
 */
function titleBarOptions(dark: boolean): Electron.BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      // 竖直居中对齐 32px 的标题条（灯本身约 12px 高）
      trafficLightPosition: { x: 14, y: 10 }
    }
  }
  if (process.platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        ...(dark ? TITLEBAR_DARK : TITLEBAR_LIGHT),
        height: TITLEBAR_HEIGHT
      }
    }
  }
  return {}
}

applyUserDataOverride(process.env, (name, path) => app.setPath(name, path))
resetStore()

let win: BrowserWindow | null = null
let initialNovelPath: string | null = null

function createWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const w = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: '文档1 - Word',
    ...titleBarOptions(dark),
    backgroundColor: dark ? WINDOW_BG_DARK : WINDOW_BG_LIGHT,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  w.on('ready-to-show', () => w.show())
  w.on('closed', () => {
    // 置空，保证 activate 分支与 IPC 的 getWindow() 拿不到已销毁的窗口引用。
    //
    // 注意：不要以为「读了 win 就能阻止摇树」——实测不成立。只要读取不可观察
    // （模块内、未导出、且无副作用），Rollup 会把整个变量连同这个 handler 一起摇掉：
    // 产物里只剩下 `createWindow();` 和 `w.on("closed", () => {})`（空函数）。
    // 直到 registerIpc({ getWindow: () => win }) 把 win 作为参数传出本模块，
    // 那个赋值与这个 handler 才会一并变活。
    // 也就是说：此结构是为 Task 6 预备的，在此之前它是无害的空转，不必试图「修好」它。
    if (win === w) win = null
  })

  // 只把 http(s) 交给系统浏览器；其它 scheme（file:、自定义协议等）不转发给 OS。
  // 必须是前缀匹配：写成 /^https?:$/ 会锚定整串，任何真实 URL 都不匹配，
  // 于是外链永远不会真的被打开。
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 顶层导航一律拒绝。本应用是单文档 SPA，生产环境（loadFile）不存在任何合法的跨文档导航。
  // 若放行，新文档会继承已注入的 window.api——本任务起该接口包含文件 IO 能力，
  // 等于把读写文件的能力交给被导航到的页面。
  // 注意：will-navigate 不会被下面的启动加载（loadURL / loadFile）或页内导航
  // （hash 变化）触发，所以不影响启动流程，也不影响将来的前端路由。
  w.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return // Vite full-reload 是页面自身发起的导航
    event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void w.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void w.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return w
}

/**
 * 命令行里的路径必须是【普通文件】。不能传 existsSync：名叫 `xxx.txt` 的目录
 * existsSync 说 true、statSync(...).isFile() 说 false，而 loadNovelFromFile 会对它抛
 * EISDIR。谓词的形状与 Task 5 文档里的写法一致（见设计文档 §13）。
 */
function isRegularFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

app.whenReady().then(() => {
  initialNovelPath = resolveInitialNovelPath(process.argv, isRegularFile)

  /**
   * 当前生效的快捷键表（已按平台补齐）。菜单与它同源——这是「菜单里显示的键」与
   * 「用户按下去真正生效的键」不会分岔的唯一保证。
   *
   * 【为什么现取而不是缓存】设置随时会变（设置对话框里改完点保存，`ipc.ts` 就会重建菜单），
   * 缓存一份就要维护失效，而读一次 `settings.json` 是这个量级的应用完全付得起的。
   */
  const getShortcuts = (): ReturnType<typeof resolveShortcuts> =>
    resolveShortcuts(getStore().readSettings().shortcuts, platformKind(process.platform))

  registerIpc({
    getWindow: () => win,
    getInitialNovelPath: () => initialNovelPath,
    rebuildMenu: () => buildAppMenu(() => win, getShortcuts)
  })
  buildAppMenu(() => win, getShortcuts)
  win = createWindow()

  // 系统外观变了就同时改两处：窗口底色（防闪）与网页的 data-theme（上色）。
  // 渲染层读不到系统外观——preload 里那段注释记了实测：`prefers-color-scheme`
  // 在这个应用里恒为浅色，主进程不推它就没人知道。
  nativeTheme.on('updated', () => {
    const dark = nativeTheme.shouldUseDarkColors
    for (const w of BrowserWindow.getAllWindows()) {
      w.setBackgroundColor(dark ? WINDOW_BG_DARK : WINDOW_BG_LIGHT)
      // Windows：右上角那三个按钮是【系统】画的，翻主题时它不会自己跟着变——不显式喂新底色，
      // 深色下就会留一条蓝的。macOS 的红绿灯由系统按外观自理，不需要这一步。
      if (process.platform === 'win32') {
        w.setTitleBarOverlay({
          ...(dark ? TITLEBAR_DARK : TITLEBAR_LIGHT),
          height: TITLEBAR_HEIGHT
        })
      }
      w.webContents.send(CH.themeChanged, dark)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
