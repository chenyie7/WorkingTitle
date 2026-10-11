# 伪装成 Word 的打字阅读器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个外观模仿 Microsoft Word 的 Electron 桌面应用：导入 txt 小说后，用户在文档区打字时不显示原字符，而是按顺序抽出小说后续文本显示，比例可配置（1 键 : N 字）。

**Architecture:** Electron 三进程（main / preload / renderer），用 electron-vite 构建。`src/core/` 是零依赖的纯 TypeScript 状态机与解析模块（解码、章节切分、游标推进），被 main 与 renderer 共享，全部由 Vitest 单测覆盖。主进程负责文件 IO 与编码检测，渲染进程持有一份只读 `Novel` 并驱动 `TypingEngine`。

**Tech Stack:** Electron 44 · electron-vite 5 · Vite 7 · React 19 · TypeScript 5.9 · Vitest 5 · Playwright 1.63 · electron-builder 26 · jschardet 4 · iconv-lite 0.7

**Spec:** `docs/superpowers/specs/2026-10-06-word-disguised-typing-reader-design.md`

## Global Constraints

- **Node 运行时**：22.23.2（`electron@44` 要求 `>=22.12.0`）。
- **版本矩阵必须照抄，不要「顺手升到最新」**：`electron-vite@5.0.0` peer 是 `vite: ^5||^6||^7`，**不支持 Vite 8**；而 `@vitejs/plugin-react@6.x` peer 是 `vite: ^8`。因此 **Vite 锁 7.3.7，plugin-react 锁 5.2.0**。详见 spec §11.1。
- **不要安装 `@types/jschardet`** —— 该包在 registry 上不存在；`jschardet@4.0.0` 自带 `build/index.d.ts`。
- **TypeScript 锁 5.9.3**，不用 7.0.2。TS 只做 `tsc --noEmit`；转译由 esbuild/oxc 负责。
- **`package.json` 不得设置 `"type": "module"`** —— Electron 主进程与 sandboxed preload 需要 CJS 输出。
- **导入的小说文本运行期只读，永不修改。** 所有「改动」都只体现为游标整数变化。
- **`src/core/` 不得 import 任何 Electron / React / DOM API。** 只允许 `node:util`（TextDecoder）、`iconv-lite`、`jschardet`。
- **`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`** 不可放宽。渲染进程只能通过 preload 白名单访问主进程。
- **绝不无条件 `preventDefault()` 所有 keydown** —— 那会彻底禁用中文输入法。见 Task 11。
- **显示内容恒等于 `flatText.slice(revealStart, cursor)`**，除此之外阅读区不显示任何小说文字。
- **每个 Task 结束必须 commit。** 任何「通过」声明必须附实际命令与输出。
- **`git add -A` 只在独占一棵工作树时安全。** 各任务的提交步骤写的都是 `git add -A`，但实际执行时树上可能有**不属于本任务的在途改动**（另一个 agent 刚写的注释、上一任务未及提交的收尾、编辑器里未保存的临时文件）。**开工前先 `git status` 看一眼**；若发现不属于自己的改动，**改用显式路径提交**，并把那段改动交回它的归属者处理，**不要扫进自己的提交**——否则历史里看不出是谁写的。本项目已出现两次（Task 2、Task 6），两次都是实施者自己发现并改用了显式路径。
- 包管理器统一用 `pnpm`。npm 的全局 cache 在本机有 root 权限残留问题（`EPERM`），不要用 npm 安装。
- **React 组件一律不写返回类型注解。** `@types/react@19.3.0` 是 `export = React` + `export as namespace React`，在模块文件里写 `React.JSX.Element` 而不 import React 会报「refers to a UMD global」错误。让 TS 推断返回类型，事件类型用具名导入（如 `import type { KeyboardEvent as ReactKeyboardEvent } from 'react'`）。
- 模块导入风格已按各包实际声明验证，不要改：`iconv-lite` 用默认导入（`export = iconv`），`jschardet` 用**具名导入** `{ detect }`（dual ESM/CJS，默认导入依赖打包器 interop，不稳）。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/core/types.ts` | 全项目共享类型与常量，无逻辑 |
| `src/core/decode.ts` | Buffer → 文本 + 编码名（BOM → 严格 UTF-8 → jschardet + 打分择优） |
| `src/core/chapters.ts` | 文本 → 扁平全文 + 章节区间（连续、无缝、无重叠） |
| `src/core/engine.ts` | `TypingEngine` 游标状态机：pump / backspace / jumpToChapter |
| `src/main/sessionStore.ts` | **纯函数**读写会话与缓存，接受 `baseDir` 参数，可脱离 Electron 单测 |
| `src/main/session.ts` | Electron 绑定层：把 `app.getPath('userData')` 喂给 sessionStore |
| `src/main/loadNovel.ts` | 读文件 → decode → splitChapters → `Novel` |
| `src/main/startup.ts` | `WT_USER_DATA` 覆盖、命令行 txt 路径解析（纯函数，可单测） |
| `src/main/ipc.ts` | IPC 通道注册，`openNovel` 带缓存复用 |
| `src/main/menu.ts` | 原生应用菜单 |
| `src/main/index.ts` | 窗口创建与启动流程 |
| `src/preload/index.ts` | `contextBridge` 暴露 `window.api` |
| `src/renderer/src/state/ToolbarContext.tsx` | Ribbon 按钮状态、toast、比例、模式 |
| `src/renderer/src/state/useTypingEngine.ts` | `useSyncExternalStore` 绑定引擎 |
| `src/renderer/src/input/InputCapture.tsx` | 透明 textarea + 双模式输入捕获 ★ |
| `src/renderer/src/components/*.tsx` | Ribbon / Toolbar / ChapterList / Page / StatusBar / Toast |
| `src/renderer/src/App.tsx` | 接线：引擎 ↔ UI ↔ 持久化 |

---

## Task 1: 项目脚手架与可启动的空窗口

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `electron.vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `tests/setup.ts`, `tests/smoke.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 可运行的空 Electron 应用；`out/main/index.js` 为产物入口；`pnpm dev / build / test / typecheck` 可用；`window.api` 雏形

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "working-title",
  "version": "0.1.0",
  "description": "伪装成 Word 的打字阅读器",
  "main": "out/main/index.js",
  "license": "MIT",
  "packageManager": "pnpm@11.21.0",
  "engines": {
    "node": ">=22.12.0"
  },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "electron-vite build && playwright test",
    "dist:dir": "electron-vite build && electron-builder --dir",
    "dist:mac": "electron-vite build && electron-builder --mac",
    "dist:win": "electron-vite build && electron-builder --win"
  },
  "dependencies": {
    "iconv-lite": "0.7.3",
    "jschardet": "4.0.0",
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "@testing-library/dom": "10.4.2",
    "@testing-library/react": "16.3.3",
    "@types/node": "^22.0.0",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "5.2.0",
    "electron": "44.5.1",
    "electron-builder": "26.15.3",
    "electron-vite": "5.0.0",
    "jsdom": "30.1.2",
    "typescript": "5.9.3",
    "vite": "7.3.7",
    "vitest": "5.0.3"
  }
}
```

注意：**没有 `"type": "module"`**，这是刻意的（Global Constraints）。

- [ ] **Step 2: 安装并验证依赖树能解析**

Run: `pnpm install`
Expected: 成功，无 `ERR_PNPM_PEER_DEP_ISSUES`。

Run: `pnpm ls vite electron-vite @vitejs/plugin-react vitest --depth 0`
Expected: 依次输出 `7.3.7` / `5.0.0` / `5.2.0` / `5.0.3`。若出现 Vite 8 或 plugin-react 6.x，说明锁版本被改动了，回到 Step 1 修正。

- [ ] **Step 3: 写 `.gitignore`**

```
node_modules/
out/
release/
dist/
coverage/
.DS_Store
*.log
test-results/
playwright-report/
```

- [ ] **Step 4: 写 `tsconfig.json`（渲染进程 + 测试）**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/renderer/src", "src/core", "tests"]
}
```

- [ ] **Step 5: 写 `tsconfig.node.json`（主进程 + 配置）**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": [
    "src/main",
    "src/preload",
    "src/core",
    "electron.vite.config.ts",
    "vitest.config.ts",
    "playwright.config.ts"
  ]
}
```

- [ ] **Step 6: 写 `electron.vite.config.ts`**

```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    }
  }
})
```

- [ ] **Step 7: 写 `vitest.config.ts` 和 `tests/setup.ts`**

`vitest.config.ts`：
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/*.test.{ts,tsx}']
  }
})
```

刻意用**单一 jsdom 环境**而不是 vitest projects：`src/core` 的测试不碰 DOM，在 jsdom 下照常运行，省掉一套 projects 配置和一类配置错误。`Buffer` 等 Node 全局在 vitest 的 jsdom 环境下依然可用。

`tests/setup.ts`：

> **这是 Task 1 时期的版本，已经过期。** Task 12 往里面加了两样 jsdom 环境缺口的东西——良性的
> `window.api` 桩（`render(<App/>)` 的用例需要它）和 `ResizeObserver` 替身——**当前有效的是
> Task 12「`window.api` 可能在渲染进程里根本不存在」那条必读下面的围栏**；这一版留在 Task 1 里备查。

```ts
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
```

- [ ] **Step 8: 写 `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']]
})
```

Electron 测试用的是应用自带的 Chromium，**不需要** `playwright install`。若安装 `@playwright/test` 时它试图下载浏览器，设 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`。

- [ ] **Step 9: 写 `src/main/index.ts`**

```ts
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

let win: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: '文档1 - Word',
    backgroundColor: '#f3f3f3',
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
  // 若放行，新文档会继承已注入的 window.api——Task 6 起该接口包含文件 IO 能力，
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

app.whenReady().then(() => {
  win = createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 10: 写 `src/preload/index.ts`（雏形）**

```ts
import { contextBridge } from 'electron'

const api = {
  ping: (): string => 'pong'
}

contextBridge.exposeInMainWorld('api', api)

export type WtApi = typeof api
```

- [ ] **Step 11: 写渲染进程入口三件套**

`src/renderer/index.html`：
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <!--
      注意：本 CSP meta 的【位置】是承重的，不要上移、不要加 nonce、更不要删掉它改成响应头。
      1) dev 下 Vite 会把 React Fast Refresh 的前导代码作为内联 module script 注入到 <head>
         最前面，恰好落在本 meta 之前；而 CSP3 规定 meta 下发的策略不追溯其之前的内容，
         所以那段内联脚本能执行、dev 正常。
      2) 若改为整篇文档生效的响应头（onHeadersReceived），那段内联脚本会被拒绝 → dev 白屏，
         报错是 "@vitejs/plugin-react can't detect preamble"，而不是 $RefreshReg$ is not defined
         （后者会被 refresh wrapper 里提升的模块级函数声明遮蔽掉）。且 file:// 生产加载下
         该回调是否触发未经证实——删掉 meta 风险是生产彻底没有 CSP 却看起来加固过。
         真要用响应头，顺序必须是：先保留 meta，确认响应头确实生效后再删。
      3) 反之，将来任何注入到本 meta【之后】的内联脚本都会被 script-src 回退的
         default-src 'self' 拦掉（例如某些分析脚本、配置 blob、或用 injectTo:'head' 的插件）。
    -->
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
    />
    <title>文档1 - Word</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`：
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

`src/renderer/src/App.tsx`：
```tsx
export default function App() {
  return <div data-testid="app-root">Word 外壳占位</div>
}
```

- [ ] **Step 12: 写 `tests/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('脚手架', () => {
  it('vitest 可以运行', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 13: 验证 typecheck 与单测**

Run: `pnpm typecheck`
Expected: 两个 tsconfig 都无错误输出（exit 0）。

Run: `pnpm test`
Expected: `1 passed`。

- [ ] **Step 14: 验证构建产物存在**

Run: `pnpm build`
Expected: exit 0，且 `out/main/index.js`、`out/preload/index.js`、`out/renderer/index.html` 三个文件都存在。

Run: `ls out/main/index.js out/preload/index.js out/renderer/index.html`
Expected: 三个路径都列出，无 "No such file"。

- [ ] **Step 15: Commit**

```bash
git add <本任务改动的显式路径…>   # 不要用 -A：见文件头「git add -A 只在独占一棵工作树时安全」
cat > /tmp/wt-commit-msg.txt <<'EOF'
chore: 项目脚手架（electron-vite + React 19 + Vitest + Playwright）
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## Task 2: 共享类型与编码检测

**Files:**
- Create: `src/core/types.ts`, `src/core/decode.ts`
- Test: `tests/unit/decode.test.ts`

**Interfaces:**
- Consumes: Task 1 的工程配置
- Produces:
  - `types.ts`: `Chapter`, `Novel`, `InputMode`, `PersistedSession`, `NovelCacheMeta`，常量 `DEFAULT_RATIO=10` `MIN_RATIO=1` `MAX_RATIO=500` `RENDER_WINDOW_LIMIT=30000`
  - `decode.ts`: `decodeBuffer(buf: Buffer): DecodeResult`、`normalizeNewlines(s: string): string`、`detectBom(buf: Buffer): { encoding: string; length: number } | null`、`needsGbFallback(detected: string): boolean`、`CONFIDENT_MULTIBYTE_NAMES: readonly string[]`（后两个只为词汇表测试而导出；`needsGbFallback` 自带归一化，调用方不必先大写）
  - `DecodeResult = { text: string; encoding: string; hadBom: boolean }`

- [ ] **Step 1: 写 `src/core/types.ts`**

```ts
import type { ShortcutId } from './shortcuts'

export interface Chapter {
  index: number
  title: string
  /** 在 flatText 中的起始偏移（含） */
  start: number
  /** 结束偏移（不含） */
  end: number
  charCount: number
}

export interface Novel {
  /** 文件名（去扩展名） */
  title: string
  sourcePath: string
  /** 检测到的编码名，如 'UTF-8' / 'GB18030' */
  encoding: string
  hadBom: boolean
  /** 所有章节首尾相接（含标题行本身） */
  flatText: string
  chapters: Chapter[]
}

export type InputMode = 'ime' | 'key'

export interface PersistedSession {
  novelTitle: string
  sourcePath: string
  ratio: number
  mode: InputMode
  /**
   * 下一个要被抽出来的字符在 `Novel.flatText` 中的下标。
   * 全项目唯一的核心不变量就在这几个字段上：**阅读区显示的内容恒等于
   * `flatText.slice(revealStart, cursor)`**，除它以外阅读区不显示任何小说文字。
   */
  cursor: number
  /** 当前显示窗口的起点（`flatText` 下标）。打字时不变，只在跳章时移动——「跨章连续」就是这么来的。 */
  revealStart: number
  /**
   * 每章「上次离开该章时，光标停在该章内的偏移」，长度恒等于 `chapters.length`。
   * 由「统一收尾规则」维护：**`pump` 与 `backspace` 的每一次游标变化之后**，都重算
   * cursor 所在章的那一项。`jumpToChapter` 是刻意的例外——它只重算被点击的那一章，
   * 并把 `activeChapter` 直接设为该章（理由见 `engine.ts` 里该方法的注释与 spec §2）。
   *
   * 写成「任何一次游标变化之后」是不成立的：跳章也改变游标，却刻意不走这条路。
   */
  chapterPos: number[]
  /** `cursor` 所在章的下标。 */
  activeChapter: number
  /** 首次打字的时间戳（状态栏计时用）；从未打过字时为 null。 */
  startedAt: number | null
}

export interface NovelCacheMeta {
  sourcePath: string
  mtimeMs: number
  size: number
  encoding: string
  hadBom: boolean
  title: string
  chapters: Chapter[]
  /**
   * novel-cache.txt 的 UTF-8 字节数，用作缓存两个文件之间的「提交点」（见 Task 5）：
   * 只有本字段与实际文本文件大小一致时，才承认这对缓存有效。
   *
   * 没有它的话，进程若在写 txt 与写 json 之间崩溃，磁盘上会留下「旧 meta + 新 text」
   * 或「新 meta + 旧 text」，两种组合都能通过 sourcePath/mtime/size 校验，
   * 于是会读出「A 书的章节目录配 B 书的正文」。给每个文件各自做 temp+rename
   * 也修不好，因为崩溃仍会落在两次改名之间——必须让 meta 能自我校验。
   *
   * 刻意声明为必填而非可选：旧版本写下的缓存没有这个字段，比较时 undefined
   * 必然不等，于是自动降级为 cache miss 重读源文件。这是「失败关闭」，
   * 写成可选反而会放行陈旧 meta。
   */
  textBytes: number
}

export const DEFAULT_RATIO = 10
export const MIN_RATIO = 1
export const MAX_RATIO = 500
/** 阅读区渲染窗口上限，超出则折叠前文 */
export const RENDER_WINDOW_LIMIT = 30_000

/** 外观偏好：跟随系统 / 强制浅色 / 强制深色。与主进程的 `nativeTheme.themeSource` 同构。 */
export type ThemeSource = 'system' | 'light' | 'dark'

/**
 * 应用级设置：**不属于任何一本书**的那些偏好。
 *
 * 【为什么与 PersistedSession 分开】两者的生命周期不同。进度是「读到哪」，每本书一份、
 * 随阅读不断变化；设置是「怎么读、长什么样」，全局一份、很少变。此前文档名 / 外观 / 纸张
 * 三个只在渲染进程的内存里，关掉应用就没了；而比例与输入模式挤在会话里，换一本书就被打回默认。
 */
export interface AppSettings {
  /** 蓝条上的文档名。刻意与 novelTitle（真实文件名）无关，见 App.tsx 里那段说明。 */
  docTitle: string
  themeSource: ThemeSource
  /** 「深色模式下纸张也变暗」。默认关——真 Word 的深色模式里纸张仍是白的。 */
  darkPaper: boolean
  /** 上次打开的书；启动时用它决定恢复哪一本。从未导入过时为 null。 */
  lastSourcePath: string | null
  /**
   * **全局**的阅读替换比例：新导入的书用它当起点。范围与当前书那个一样是 1–500。
   *
   * 【与 `PersistedSession.ratio` 的分工】那一份是**当前书**的比例，也是真正生效的那个
   * （引擎只认它）。这一份不是「覆盖值」，而是**导入时的初值**：一本书第一次被打开时取它，
   * 之后各管各的——**改全局不影响已经打开过的书，只影响之后导入的**。
   * 于是两者之间没有「跟随」这层状态，界面上两个普通输入框就够了。
   */
  ratio: number
  /**
   * 用户改过的快捷键。**稀疏表：缺条目 = 用该平台的默认值**，`{}` 就是「全默认」。
   *
   * 【为什么是稀疏而不是完整表】完整表要求「谁读设置谁就得知道平台」，于是
   * `defaultSettings()` 与 `createSessionStore()` 都得加一个平台参数——而它们在测试里
   * 有六十多处调用点（写这句时实测 63 = `tests/` 下这两个名字的出现次数；这个数随测试
   * 增长只多不少，别当成会停住的量）。稀疏之后这两个函数的签名一个都不用动，`core` 也不必
   * 去读 `process`（那是 node 的东西，而 core 要能被渲染进程共用）。
   *
   * 【为什么值是规范串而不是 accelerator】`CmdOrCtrl+O` 把两个平台合并成一个记号，恰好
   * 表达不了「各平台不一样」。规范串（`Meta+KeyO` / `Ctrl+KeyO`）把 Meta 与 Ctrl 分开存，
   * 只在喂菜单那一刻才转成 accelerator。
   */
  shortcuts: Partial<Record<ShortcutId, string>>
}

/** 蓝条上那个文档名的默认值：刻意中性，不泄露在读什么。 */
export const DEFAULT_DOC_TITLE = '文档1'

/**
 * 默认设置。
 *
 * 【写成函数而不是共享常量】常量会被消费方就地改掉（`s.themeSource = 'dark'`），
 * 于是「默认值」在下一次读取时已经变了——那类 bug 只在测试之间串味时才显形。
 */
export function defaultSettings(): AppSettings {
  return {
    docTitle: DEFAULT_DOC_TITLE,
    themeSource: 'system',
    darkPaper: false,
    lastSourcePath: null,
    ratio: DEFAULT_RATIO,
    /**
     * 默认的快捷键表：**空**。空的意思是「全用该平台的默认值」，逐条的默认值在
     * `shortcuts.ts` 的 `SHORTCUTS` 表里，由 `resolveShortcuts` 补齐。
     *
     * 【为什么不在这里写死一份】写死就要求这个函数知道平台，而它是零参的
     * （见 AppSettings.shortcuts 的说明）。
     *
     * 【为什么是就地写 `{}` 而不是提一个模块级常量】本函数上面那段说明的就是这件事：
     * 共享常量会被消费方就地改掉（`s.shortcuts.import = 'Meta+KeyI'`），于是「默认值」
     * 在下一次调用时已经变了。每次返回一个新的字面量才是这里要的形状。
     */
    shortcuts: {}
  }
}
```

- [ ] **Step 2: 写失败测试 `tests/unit/decode.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { VERSION as JSCHARDET_VERSION } from 'jschardet'
import iconv from 'iconv-lite'
import {
  decodeBuffer,
  normalizeNewlines,
  detectBom,
  needsGbFallback,
  CONFIDENT_MULTIBYTE_NAMES
} from '../../src/core/decode'

const ZH = '第一章 风起\n\n林昭站在城墙上，望着远方的烽火。\n他想起十年前的那个雪夜。\n'

describe('detectBom', () => {
  it('识别 UTF-8 BOM', () => {
    expect(detectBom(Buffer.from([0xef, 0xbb, 0xbf, 0x41]))).toEqual({ encoding: 'UTF-8', length: 3 })
  })
  it('识别 UTF-16LE BOM', () => {
    expect(detectBom(Buffer.from([0xff, 0xfe, 0x41, 0x00]))).toEqual({ encoding: 'UTF-16LE', length: 2 })
  })
  it('无 BOM 返回 null', () => {
    expect(detectBom(Buffer.from('abc'))).toBeNull()
  })
})

describe('normalizeNewlines', () => {
  it('CRLF 与 CR 都归一为 LF', () => {
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  it('重复转换的 \\r\\r\\n 折叠成一个 LF，不产生空行', () => {
    expect(normalizeNewlines('a\r\r\nb')).toBe('a\nb')
  })

  it('三个及以上 \\r 加 \\n 同样只折叠成一个 LF', () => {
    expect(normalizeNewlines('a\r\r\r\nb')).toBe('a\nb')
  })

  it('真正的空白行（\\r\\n\\r\\n）不被折叠掉', () => {
    expect(normalizeNewlines('a\r\n\r\nb')).toBe('a\n\nb')
  })

  it('\\r\\r\\n 与 CRLF 混排时逐段各自归一', () => {
    expect(normalizeNewlines('a\r\r\nb\r\nc\rd')).toBe('a\nb\nc\nd')
  })
})

describe('decodeBuffer', () => {
  it('无 BOM 的 UTF-8 中文识别为 UTF-8', () => {
    const r = decodeBuffer(Buffer.from(ZH, 'utf8'))
    expect(r.encoding).toBe('UTF-8')
    expect(r.hadBom).toBe(false)
    expect(r.text).toBe(ZH)
  })

  it('UTF-8 BOM 被剥离且 hadBom 为 true', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ZH, 'utf8')])
    const r = decodeBuffer(buf)
    expect(r.encoding).toBe('UTF-8')
    expect(r.hadBom).toBe(true)
    expect(r.text).toBe(ZH)
    expect(r.text.charCodeAt(0)).toBe('第'.charCodeAt(0))
  })

  it('GBK 中文能正确还原（不会走 UTF-8 分支）', () => {
    const buf = iconv.encode(ZH, 'gbk')
    const r = decodeBuffer(buf)
    expect(r.encoding).not.toBe('UTF-8')
    expect(r.text).toBe(ZH)
    expect(r.text).not.toContain('\uFFFD')
  })

  it('UTF-16LE（带 BOM）能正确还原', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(ZH, 'utf16le')])
    const r = decodeBuffer(buf)
    expect(r.encoding).toBe('UTF-16LE')
    expect(r.text).toBe(ZH)
  })

  it('CRLF 被归一为 LF', () => {
    const r = decodeBuffer(Buffer.from('a\r\nb', 'utf8'))
    expect(r.text).toBe('a\nb')
  })

  it('空 buffer 不抛异常', () => {
    const r = decodeBuffer(Buffer.alloc(0))
    expect(r.text).toBe('')
    expect(r.hadBom).toBe(false)
  })

  it('Shift_JIS 日文不被 GB18030 兜底误选', () => {
    // scoreText 奖励 CJK 表意文字占比，而 GB18030 会把任意字节对映射进该区：
    // 日文正确解码（假名不在该区）几乎不得分，GB18030 乱码反而得高分。
    // 本样本实测：正确 400.0 / 乱码 1000.0（同样注意这数字随文本而变，不是固有属性）。
    // 若兜底追加不设条件，这里就会被解成乱码。
    const ja = '風が吹く\n彼は城壁に立っていた。\n'
    const buf = iconv.encode(ja, 'shift_jis')
    const r = decodeBuffer(buf)
    expect(r.text).toBe(ja)
  })

  it('EUC-KR 韩文不被 GB18030 兜底误选', () => {
    const ko = '바람이 분다\n그는 성벽에 서 있었다.\n'
    const buf = iconv.encode(ko, 'euc-kr')
    const r = decodeBuffer(buf)
    expect(r.text).toBe(ko)
  })

  it('无 BOM 的 UTF-16LE 不被 GB18030 兜底误选', () => {
    // 为什么必须用【无 BOM】的样本：带 BOM 的 UTF-16 在第一步就被 BOM 检查短路由掉，
    // 根本走不到 needsGbFallback，所以那个用例覆盖不到这条路径。
    // jschardet 对无 BOM 的 UTF-16 返回 `utf-16-le`（带连字符的 WHATWG 标签），
    // 照 compat 表写的正则（UTF-16LE）会漏配 → 追加 GB18030 → 乱码胜出。
    const ko = '바람이 분다\n그는 성벽에 서 있었다.\n'
    const buf = iconv.encode(ko, 'utf16le') // iconv-lite 的 utf16le 不加 BOM
    const r = decodeBuffer(buf)
    expect(r.text).toBe(ko)
    expect(r.encoding).not.toBe('GB18030')
  })
})

/**
 * 快照 JSCHARDET_EMITTED_NAMES 测得时安装的 jschardet 版本。
 * 与快照绑在一起、由下面的版本断言守着，两者必须一起更新——分开写就会各自过期。
 */
const JSCHARDET_VERSION_MEASURED = '4.0.0'

/**
 * jschardet@4.0.0 实际会吐出的编码名【实测快照】（86 个）。
 *
 * 为什么用快照而不是运行时去读 jschardet 的词表：它的 exports map 只暴露 "."，也没有
 * 公开的枚举 API，唯一办法是绕过 exports map 去读包内私有的 build 产物——用
 * `createRequire(import.meta.url).resolve('jschardet')` 拿到入口、再 `path.join` 取同目录的
 * registry.js / output_names.js（可移植，不需要写死绝对路径）。但那会让一份「本应稳定」的
 * 测试绑死在包内部的产物布局上，不值得。快照同样能抓住本测试要抓的那类 bug：
 * 词表里的 `utf-16-le` 若前缀匹配不上，这里立刻失败。
 *
 * 【机制】同一个族会以两种拼写并存：`UTF-16` / `UTF-32` 是 compat 改名后的裸名，
 * 而 `utf-16-le` / `utf-16-be` / `utf-32-be` / `utf-32-le` 是原样吐出的 WHATWG 标签。
 * 照 compat 表写正则就会「看起来对、实际漏配」，于是这些编码被误加 GB18030 兜底并被
 * 解成乱码——这是本测试存在的理由。
 *
 * 【这份快照抓不到什么】它看不见「库自己变了」：jschardet 改名或新增名字都不会改动下面的
 * 字面量。改名由本文件的版本断言兜住（升级即失败并要求重新测量）；而「新增了一个前缀匹配
 * 不到的多字节 CJK 名」无人能看见，属 Task 15 的 (b) 覆盖范围。
 */
const JSCHARDET_EMITTED_NAMES = [
  "ascii", "utf-8", "UTF-8-SIG", "UTF-16",
  "utf-16-be", "utf-16-le", "UTF-32", "utf-32-be",
  "utf-32-le", "utf-7", "Big5", "CP932",
  "CP949", "EUC-JP", "EUC-KR", "GB18030",
  "HZ-GB-2312", "ISO-2022-JP", "iso2022_jp_2004", "iso2022_jp_ext",
  "ISO-2022-KR", "SHIFT_JIS", "CP874", "Windows-1250",
  "Windows-1251", "Windows-1252", "Windows-1253", "Windows-1254",
  "Windows-1255", "Windows-1256", "Windows-1257", "cp1258",
  "KOI8-R", "koi8-u", "TIS-620", "ISO-8859-1",
  "ISO-8859-2", "iso8859-3", "iso8859-4", "ISO-8859-5",
  "ISO-8859-6", "ISO-8859-7", "ISO-8859-8", "ISO-8859-9",
  "iso8859-10", "ISO-8859-13", "iso8859-14", "iso8859-15",
  "iso8859-16", "Johab", "MacCyrillic", "MacGreek",
  "MacIceland", "MacLatin2", "MacRoman", "MacTurkish",
  "cp720", "cp1006", "cp1125", "koi8-t",
  "KZ1048", "ptcp154", "hp-roman8", "cp437",
  "cp737", "cp775", "cp850", "cp852",
  "IBM855", "cp856", "cp857", "cp858",
  "cp860", "cp861", "cp862", "cp863",
  "cp864", "cp865", "IBM866", "cp869",
  "cp1140", "cp424", "cp500", "cp875",
  "cp1026", "cp273"
]

/**
 * 快照里属于【多字节 CJK / Unicode】的名字——必须免于 GB18030 兜底。
 * 完整枚举而非抽样：单字节拉丁系不需要豁免（兜底正是为它们准备的）；
 * GB* 家族由 candidateEncodings 另行映射成 GB18030，不走本名单。
 */
const MUST_BE_EXEMPT = [
  'Big5',
  'CP932',
  'CP949',
  'EUC-JP',
  'EUC-KR',
  'SHIFT_JIS',
  'Johab',
  'UTF-16',
  'utf-16-be',
  'utf-16-le',
  'UTF-32',
  'utf-32-be',
  'utf-32-le'
]

/**
 * 【文档性例外清单，不是被校验的性质】快照里 6 个「多字节 CJK / 中文体系、但本谓词不豁免」
 * 的名字中，除 GB18030 之外的那 5 个。GB18030 不在此列是因为 candidateEncodings 会主动把
 * GB* 系列映射成 GB18030，本就不该走这个名单。
 *
 * 显式点名列出，而不是靠过滤条件默默排除：它们都是 7-bit 编码（每个字节 < 0x80），会先被
 * 严格 UTF-8 短路接管，根本走不到候选列表，所以豁免与否对它们没有意义。见设计文档 §13。
 * 静默排除正是这类 bug 藏身之处，所以宁可写死在这里。
 *
 * 注意下面那条断言只检查这些名字确实在快照里（防名单打错字），**并不校验这个划分本身**：
 * 划分来自对 86 个名字的实测，而静态快照看不见新增名字，所以这里不做（也不该做）一个
 * 「自动推导例外集」的断言。
 */
const SEVEN_BIT_BEYOND_REACH = [
  'HZ-GB-2312',
  'ISO-2022-JP',
  'iso2022_jp_2004',
  'iso2022_jp_ext',
  'ISO-2022-KR'
]

/**
 * 注意：本组是这些编码名【唯一】的守卫。行为用例的样本经 detect() 后只落到
 * GB18030 / CP932 / CP949 / utf-16-le 四个名字（Shift_JIS 与 EUC-KR 的样本分别被
 * PREFERRED_SUPERSET 重映射为 CP932 / CP949），于是 13 个信念名里有 10 个没有任何
 * 行为用例触达：Big5、EUC-JP、EUC-KR、SHIFT_JIS、Johab、UTF-16、utf-16-be、
 * UTF-32、utf-32-be、utf-32-le。**删掉本组不等于行为测试仍覆盖这些编码。**
 */
describe('词汇表：黑名单必须与 jschardet 的名字表一致', () => {
  const norm = (s: string): string => s.toUpperCase().replace(/[-_]/g, '')

  it('安装的 jschardet 版本与快照测得时一致（升级必须重新测量）', () => {
    // 本快照是【实测】结果，它只能看见「有人把黑名单改错」，看不见「库自己变了」：
    // jschardet 改名/新增名字都不会改动我们的字面量。版本断言正是补这个洞——
    // 任何升级都会在这里大声失败，逼我们重新测量，而不是安静地继续用过期快照。
    expect(
      JSCHARDET_VERSION,
      `快照 JSCHARDET_EMITTED_NAMES 是对 jschardet ${JSCHARDET_VERSION_MEASURED} 实测得到的，`
        + `当前安装的是 ${JSCHARDET_VERSION}。编码名表可能已变：请重新测量快照`
        + `（读 build/registry.js 与 build/output_names.js），并同时更新`
        + ` JSCHARDET_EMITTED_NAMES、MUST_BE_EXEMPT、SEVEN_BIT_BEYOND_REACH 与`
        + ` JSCHARDET_VERSION_MEASURED。`
    ).toBe(JSCHARDET_VERSION_MEASURED)
  })

  it('快照自检：两张名单都确实取自快照', () => {
    // 长度断言是唯一能盖住「快照里被删掉一个【不豁免】名字」的守卫——那种改动不触发
    // 别的任何断言。所以失败信息要给下一步动作，而不只是 expected 86。
    expect(
      JSCHARDET_EMITTED_NAMES,
      `快照是对 jschardet ${JSCHARDET_VERSION_MEASURED} 实测得到的 86 个名字，`
        + `当前有 ${JSCHARDET_EMITTED_NAMES.length} 个。名字表可能被改错或漏抄：`
        + `请重新测量（读 build/registry.js 与 build/output_names.js），并同时更新`
        + ` JSCHARDET_EMITTED_NAMES、MUST_BE_EXEMPT、SEVEN_BIT_BEYOND_REACH 与`
        + ` JSCHARDET_VERSION_MEASURED。`
    ).toHaveLength(86)
    expect(MUST_BE_EXEMPT.filter((n) => !JSCHARDET_EMITTED_NAMES.includes(n))).toEqual([])
    expect(SEVEN_BIT_BEYOND_REACH.filter((n) => !JSCHARDET_EMITTED_NAMES.includes(n))).toEqual([])
  })

  it('谓词自带归一化：大小写与分隔符都由它自己处理', () => {
    // 回归守卫：调用方忘了 .toUpperCase() 时，不能再静默返回 true（= 追加兜底）。
    // 这正是要防的 footgun：调用方漏了归一化，兜底就会静默生效。
    expect(needsGbFallback('utf-16-le')).toBe(false)
    expect(needsGbFallback('utf_16_le')).toBe(false)
    expect(needsGbFallback('shift_jis')).toBe(false)
    expect(needsGbFallback('BIG5')).toBe(false)

    // 反向：该兜底的仍然要兜底，别把归一化写成「一律不兜底」。
    expect(needsGbFallback('windows-1252')).toBe(true)
    expect(needsGbFallback('koi8-r')).toBe(true)
    expect(needsGbFallback('')).toBe(true)
  })

  it('多字节 CJK/Unicode 名全部免于 GB18030 兜底，且豁免集合不多不少', () => {
    // 这条就是当初能抓住 UTF-16LE 那个 bug 的断言：旧正则写 UTF-16LE，
    // 而 jschardet 吐的是 utf-16-le，于是这里会列出 utf-16-be/le、utf-32-be/le。
    // 刻意传【原始名字】不做预处理——归一化是谓词自己的责任（见上一条用例）。
    expect(MUST_BE_EXEMPT.filter((n) => needsGbFallback(n))).toEqual([])

    // 反向：豁免集合必须与上面严格相等——多了（死条款）少了（漏配）都失败。
    const exempt = JSCHARDET_EMITTED_NAMES.filter((n) => !needsGbFallback(n)).sort()
    expect(exempt).toEqual([...MUST_BE_EXEMPT].sort())
  })

  it('黑名单里没有死条款：每个前缀都能对上快照里的真名字', () => {
    const dead = CONFIDENT_MULTIBYTE_NAMES.filter(
      (alt) => !JSCHARDET_EMITTED_NAMES.some((v) => norm(v).startsWith(alt))
    )
    expect(dead).toEqual([])
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm vitest run tests/unit/decode.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/core/decode"`。

- [ ] **Step 4: 写 `src/core/decode.ts`**

```ts
import { TextDecoder } from 'node:util'
import iconv from 'iconv-lite'
// 具名导入而非默认导入：jschardet@4 是 dual ESM/CJS 包（package.json 里
// "type": "module" + exports 同时给 import/require），默认导入要依赖打包器的
// CJS interop 才能拿到 _default，具名导入在两种模块格式下都稳定。
// iconv-lite 则相反，声明文件是 `export = iconv`，必须用默认导入。
import { detect as detectEncoding } from 'jschardet'

export interface DecodeResult {
  text: string
  encoding: string
  hadBom: boolean
}

const BOMS: Array<{ bytes: number[]; encoding: string }> = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'UTF-8' },
  { bytes: [0xff, 0xfe], encoding: 'UTF-16LE' },
  { bytes: [0xfe, 0xff], encoding: 'UTF-16BE' }
]

export function detectBom(buf: Buffer): { encoding: string; length: number } | null {
  for (const bom of BOMS) {
    if (buf.length < bom.bytes.length) continue
    if (bom.bytes.every((b, i) => buf[i] === b)) {
      return { encoding: bom.encoding, length: bom.bytes.length }
    }
  }
  return null
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r+\n/g, '\n').replace(/\r/g, '\n')
}

/** 用严格模式试解 UTF-8：非法字节序列会抛错，返回 null。 */
function tryStrictUtf8(buf: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return null
  }
}

/** 解码质量打分：替换字符扣分，CJK 表意文字占比加分。 */
function scoreText(text: string): number {
  let replacement = 0
  let cjk = 0
  let total = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x0a) continue
    total++
    if (cp === 0xfffd) replacement++
    else if (cp >= 0x4e00 && cp <= 0x9fff) cjk++
  }
  if (total === 0) return 0
  return (cjk / total) * 1000 - replacement * 100
}

/**
 * 判断是否需要用 GB18030 兜底。
 *
 * jschardet 对中文的常见误判是给出单字节拉丁系（windows-125x / ISO-8859-*）或干脆给不出编码
 * ——这些情况才需要 GB18030 兜底。但如果它已经明确指出一个多字节 CJK / Unicode 编码，
 * 就【不能】再追加 GB18030：scoreText 奖励的是 CJK 表意文字占比（U+4E00–U+9FFF），
 * 而 GB18030 会把任意字节对映射进该区，于是日文/韩文的正确解码（假名、谚文都不在该区）
 * 反而得分更低。
 *
 * 【下面的数字只是样本观测，不是编码的固有属性】scoreText 是占比比值，换一段文本数字就变：
 * 同一批样本上 Shift_JIS 正确 400 / 乱码 1000，EUC-KR 正确 0 / 乱码 737。
 * 不要在别处引用它们当定论。
 *
 * 【本函数的边界，别当成保证】这是一个黑名单：只有列出的多字节 CJK / Unicode 编码才免于兜底。
 * 任何未列出的编码——尤其是 KOI8-R 这类遗留单字节集——仍然会追加 GB18030；只要正确解码里
 * 几乎没有 CJK 表意文字，乱码就可能在占比上胜出。根因是 scoreText 在【跨文字系统】之间
 * 比较得分，靠增删名单救不干净（见设计文档 §13）。
 *
 * 【为什么不改成正向白名单】把 windows-125x / ISO-8859-* 也排除在兜底之外，会破坏
 * 「GBK 被误判成 windows-1252 时把它救回来」这个兜底存在的主要理由。本应用面向中文小说，
 * 黑名单偏向「救中文」是刻意的取舍，代价是非中文的遗留单字节编码仍可能被解错（见 §13）。
 *
 * 【必须先自己归一化（大小写 + 分隔符）再匹配】
 * jschardet 4 只给裸名 `utf-16` / `utf-32` 做了 compat 改名；四个带端序的名字
 * （`utf-16-le` / `utf-16-be` / `utf-32-le` / `utf-32-be`）会**原样吐出 WHATWG 标签**
 * （见 jschardet/build/output_names.js 的 _COMPAT_NAMES），别名表里还有 `utf_16_le`
 * 这种下划线拼写。只做大小写（`/i`）不解决连字符：`UTF-16-LE` 前缀匹配不上 `UTF16`，
 * 这些编码就会被误加兜底、进而被解成乱码。所以先抹掉 `-` `_` 并统一大小写，
 * 且由本函数自己做——它已导出，前提条件无法强制。
 *
 * 【用前缀而非整串锚定】jschardet 对同一族会给多种拼写（`Big5` / `Shift_JIS` / `utf-16-le`），
 * 前缀能一并覆盖，且规范化后 `SHIFT_JIS` 与 `SHIFTJIS` 等价。
 * 【名单里只放 jschardet 真会吐出的名字】`SJIS` / `EUCJIS` / `UCS-2` 这类「想当然的拼写」
 * 它一个都不产出（`shift_jis_2004` 由 SHIFTJIS 前缀覆盖，注册表里根本没有 UCS-2），属于
 * 永远不会命中的死条款，已删除。名单与词表的对应关系由 tests/unit/decode.test.ts 的
 * 词汇表测试逐条核对（核对的是实测快照；jschardet 升级则由该测试的版本断言发现）。
 * 前缀匹配在此安全：注册表里没有任何不属于上述家族的编码名以
 * BIG5 / CP93 / CP94 / SHIFT / EUC / JOHAB / UTF 开头（CP9xx 只有 932/949）。
 */
export const CONFIDENT_MULTIBYTE_NAMES: readonly string[] = Object.freeze([
  'BIG5',
  'CP932',
  'CP949',
  'SHIFTJIS',
  'EUCJP',
  'EUCKR',
  'JOHAB',
  'UTF16',
  'UTF32'
])

const CONFIDENT_MULTIBYTE = new RegExp(`^(?:${CONFIDENT_MULTIBYTE_NAMES.join('|')})`)

export function needsGbFallback(detected: string): boolean {
  // 大小写与分隔符都在这里归一化，不依赖调用方。传进小写/带连字符的原名会静默返回
  // true（= 追加兜底），所以归一化必须是本函数的责任：函数已导出，参数名不是防线。
  const normalized = detected.toUpperCase().replace(/[-_]/g, '')
  return normalized === '' || !CONFIDENT_MULTIBYTE.test(normalized)
}

function candidateEncodings(detected: string): string[] {
  const names: string[] = []
  const push = (n: string): void => {
    if (n && iconv.encodingExists(n) && !names.includes(n)) names.push(n)
  }
  // upper 只服务于本函数自己的 GB* / ASCII 分支判断；needsGbFallback 不再依赖它，
  // 传原始名字进去即可（它自己会归一化）。
  const upper = (detected || '').toUpperCase()
  if (upper === 'GB2312' || upper === 'GBK' || upper === 'GB18030') push('GB18030')
  else if (upper === 'ASCII') push('UTF-8')
  else push(detected)

  // 条件性追加兜底。GB* 的情况上面已经 push 过，这里被去重成空操作。
  // 不要为了「保险」无条件追加——那会让日文/韩文被解成乱码（见 needsGbFallback 的注释）。
  // 也不要改成「只按 U+FFFD 数量打分」来回避：GB18030 几乎把所有字节对都映射到某个字符，
  // 乱码里的替换字符数同样≈0，两边打平，救不了。
  if (needsGbFallback(detected)) push('GB18030')
  return names
}

export function decodeBuffer(buf: Buffer): DecodeResult {
  if (buf.length === 0) return { text: '', encoding: 'UTF-8', hadBom: false }

  const bom = detectBom(buf)
  if (bom) {
    const text = iconv.decode(buf.subarray(bom.length), bom.encoding)
    return { text: normalizeNewlines(text), encoding: bom.encoding, hadBom: true }
  }

  // 合法 UTF-8 是极强的信号：GBK 中文几乎不可能碰巧构成合法 UTF-8 序列。
  const strict = tryStrictUtf8(buf)
  if (strict !== null) {
    return { text: normalizeNewlines(strict), encoding: 'UTF-8', hadBom: false }
  }

  const detected = detectEncoding(buf)?.encoding ?? ''
  const candidates = candidateEncodings(detected)

  let bestEncoding = candidates[0] ?? 'GB18030'
  let bestText = iconv.decode(buf, bestEncoding)
  let bestScore = scoreText(bestText)

  for (const enc of candidates.slice(1)) {
    const text = iconv.decode(buf, enc)
    const score = scoreText(text)
    if (score > bestScore) {
      bestScore = score
      bestText = text
      bestEncoding = enc
    }
  }

  return { text: normalizeNewlines(bestText), encoding: bestEncoding, hadBom: false }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm vitest run tests/unit/decode.test.ts`
Expected: 全部 PASS（18 个用例）。

若 GBK 用例失败，打印 `detectEncoding(buf)`（即 `jschardet` 的具名导出 `detect`）的实际结果，并确认 `candidateEncodings` 里确实包含 `GB18030`。

- [ ] **Step 6: typecheck**

Run: `pnpm typecheck`
Expected: exit 0。若 `jschardet` 报缺少类型声明，确认装的是 `jschardet@4.0.0`（自带 `.d.ts`），而不是去装不存在的 `@types/jschardet`。

- [ ] **Step 6.5: 删除已过时的 `tests/smoke.test.ts`**

Task 1 的 Step 12 建了它，唯一作用是让 `pnpm test` 非空（vitest 在「没找到测试文件」时退出码非 0）。
它断言的是 `1 + 1 === 2`，既不碰本项目行为也不碰 jsdom / `tests/setup.ts`，属于「绿了但什么都没证明」的测试。
本任务的 `decode.test.ts`（9 个真实用例）落地后它已无任何作用，删掉。

Run: `git rm tests/smoke.test.ts`
Expected: 文件被删除；`pnpm test` 仍然通过（此时至少有 18 个用例）。

- [ ] **Step 7: Commit**

```bash
git add <本任务改动的显式路径…>   # 不要用 -A：见文件头「git add -A 只在独占一棵工作树时安全」
cat > /tmp/wt-commit-msg.txt <<'EOF'
feat(core): 编码检测与解码（BOM + 严格 UTF-8 + jschardet 打分择优）
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## Task 3: 章节切分

**Files:**
- Create: `src/core/chapters.ts`, `tests/fixtures/sample-utf8.txt`, `tests/fixtures/sample-nochapters.txt`
- Test: `tests/unit/chapters.test.ts`

**Interfaces:**
- Consumes: `Chapter` from `src/core/types.ts`
- Produces:
  - `PREAMBLE_TITLE = '前言'`
  - `isChapterTitle(line: string): boolean`
  - `splitChapters(text: string, fallbackTitle: string): SplitResult`
  - `SplitResult = { flatText: string; chapters: Chapter[] }`
  - **不变式**（后续所有任务依赖）：`chapters[0].start === 0`；`chapters[i].end === chapters[i+1].start`；`chapters[last].end === flatText.length`；`chapters[i].charCount === end - start`

- [ ] **Step 1: 写 fixtures**

`tests/fixtures/sample-utf8.txt`（注意文件末尾保留一个换行）：
```
第一章 风起

这是第一章的正文。林昭站在城墙上，望着远方的烽火。

他想起十年前的那个雪夜。
第二章 云涌

第二章开始了。城下的军队已经列阵三日。
第三章 雷动

第三章只有这一行。
```

`tests/fixtures/sample-nochapters.txt`：
```
这是一段没有任何章节标题的纯文本。

它应该被当作单章节处理，整篇都是正文。
```

- [ ] **Step 2: 写失败测试 `tests/unit/chapters.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isChapterTitle, splitChapters, PREAMBLE_TITLE } from '../../src/core/chapters'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8')

/** 所有章节区间必须首尾相接、无缝、无重叠 */
function expectContiguous(flatText: string, chapters: ReturnType<typeof splitChapters>['chapters']): void {
  expect(chapters.length).toBeGreaterThan(0)
  expect(chapters[0].start).toBe(0)
  expect(chapters[chapters.length - 1].end).toBe(flatText.length)
  chapters.forEach((c, i) => {
    expect(c.index).toBe(i)
    expect(c.charCount).toBe(c.end - c.start)
    if (i > 0) expect(chapters[i - 1].end).toBe(c.start)
  })
}

/**
 * 长度上限相关的两条样本，提到 describe 外面是为了让「前提自检」用例引用【同一个常量】——
 * 样本被改小时自检立刻变红，而不是让用例悄悄退化成在测别的东西。
 */
/** 超长样本：原始 70 字，远超上限（无补白，trim 不改变它） */
const OVER_CAP_TITLE = 'Chapter 3 ' + 'x'.repeat(60)
/** 补白样本：原始 45 字超限，但 trim 后只有 5 字——上限量的是 trim 后的串，故它是合法标题 */
const PADDED_TITLE = '　'.repeat(20) + '第一章 风起' + '　'.repeat(20)

describe('isChapterTitle', () => {
  it.each([
    '第一章 风起',
    '第 12 章',
    '第十二章',
    '第3节 起手',
    '第一百零八回',
    '序章',
    '楔子 雪夜',
    '番外一',
    'Chapter 3 The Beginning',
    '1、开端',
    '12．转折',
    // 前后各垫 20 个全角空格：上限量的是 trim 后的串，补白不该影响判定
    PADDED_TITLE
  ])('识别标题行：%s', (line) => {
    expect(isChapterTitle(line)).toBe(true)
  })

  it.each([
    '第三章的内容很有意思，我读了三遍。',
    '前言不搭后语',
    '林昭站在城墙上。',
    // 下面这条是【唯一】只被 SENTENCE_PUNCT 那道闸拦下的样本：它匹配 TITLE_PATTERNS[3]
    // （数字 + 、/.． + 正文），长度也在上限内。上面三条其实都被【模式不匹配】拒掉，
    // 等于同一个分支测了三遍——删掉那道闸，只有这一条会红。没有它，一行普通的编号正文
    // （「1．他说道，这是第一章。」）就会变成章节标题。
    '1．他说道，这是第一章。',
    ''
  ])('不把正文当标题：%s', (line) => {
    expect(isChapterTitle(line)).toBe(false)
  })

  // 【前提自检】长度上限相关的样本必须真的如用例名所说。
  // Task 3 期间有一条样本（37 字）名字声称测上限，实际根本没超过 40 字、是被模式不匹配拒掉的
  // ——用例名在说谎，整个 Task 3 都没人发现。把前提写成断言，样本被改小就会立刻红。
  it('前提自检：长度上限相关的样本确实如用例名所说', () => {
    // 40 是 chapters.ts 里 MAX_TITLE_LEN 的值（模块私有、未导出）。这里写死是有意的：
    // 上限一旦被改，本用例会红，逼人重新核对「超长」「补白」这两条样本还成不成立。
    expect(OVER_CAP_TITLE.length).toBeGreaterThan(40)
    expect(isChapterTitle(OVER_CAP_TITLE)).toBe(false) // 超长 → 被上限拒掉
    expect(PADDED_TITLE.length).toBeGreaterThan(40) // 原始长度确实超限
    expect(PADDED_TITLE.trim().length).toBeLessThanOrEqual(40) // trim 后不超 → 合法标题
  })
})

describe('splitChapters', () => {
  it('无标题时退化为单章节，flatText 等于原文', () => {
    const text = fixture('sample-nochapters.txt')
    const { flatText, chapters } = splitChapters(text, '我的小说')
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('我的小说')
    expect(flatText).toBe(text)
    expectContiguous(flatText, chapters)
  })

  it('按 第X章 切出三章，且区间连续无缝', () => {
    const text = fixture('sample-utf8.txt')
    const { flatText, chapters } = splitChapters(text, 'sample-utf8')
    expect(chapters).toHaveLength(3)
    expect(chapters[0].title).toBe('第一章 风起')
    expect(chapters[1].title).toBe('第二章 云涌')
    expect(chapters[2].title).toBe('第三章 雷动')
    expectContiguous(flatText, chapters)
    // 这条是【唯一落在真实 fixture 上的保真断言】——重点在「真实 fixture」，不在「唯一」。
    // 「相邻标题之间无正文」那条用内联字符串断言了同一条律的同一支，两者被同一个变异一起
    // 打红；此前把「唯一」写在句子头部是不准确的。真正缺的是「拿读进来的真文件来比」这件事：
    // sample-utf8.txt 走的正是三章拼接，而 94 字的它此前从未与源文件比较过。
    // expectContiguous 只校验 (flatText, chapters) 这一对【自洽】：区间连续、下标、charCount。
    // 它对 flatText 是否等于源文件一言不发——去掉拼接时的章间 \n，它照样全绿（实测）。
    // 上面「无标题 → 单章节」那条虽然也断言了 flatText === text，但走的是提前返回分支
    // （titleIdx 为空直接 return { flatText: text }），那个断言恒真，碰不到拼接逻辑。
    // 而这条用例走的是三章拼接：只有 flatText 与源文件逐字相等，Task 4 那些指向 flatText
    // 的 cursor/revealStart/chapterPos 偏移，才对得上用户真正导入的那个文件。
    // 【保真律】完整表述见「标题前只有空白时…」那条：flatText 是 text 的后缀，被去掉的前缀全是空白。
    // 本用例是「前缀为空」的那一支（什么都没丢）→ flatText === text。
    expect(flatText).toBe(text)
  })

  it('章节正文包含标题行本身', () => {
    const text = fixture('sample-utf8.txt')
    const { flatText, chapters } = splitChapters(text, 'x')
    expect(flatText.slice(chapters[0].start, chapters[0].end).startsWith('第一章 风起')).toBe(true)
    expect(flatText.slice(chapters[2].start, chapters[2].end)).toContain('第三章只有这一行。')
  })

  it('标题之前的内容归入「前言」伪章节', () => {
    const text = '版权声明\n作者：某人\n\n第一章 风起\n正文一。\n'
    const { flatText, chapters } = splitChapters(text, 'x')
    // 「前言」是设计文档 §7 定死的字面量，而且【用户可见】——侧栏直接把它显示出来。
    // 下面那条 toBe(PREAMBLE_TITLE) 是拿常量比自己，挡不住常量本身被改，所以在这里钉住字面量。
    // 与 decode.test.ts 里 expect(r.encoding).toBe('UTF-8') 同一用意。
    expect(PREAMBLE_TITLE).toBe('前言')
    expect(chapters[0].title).toBe(PREAMBLE_TITLE)
    expect(chapters[0].start).toBe(0)
    expect(flatText.slice(chapters[0].start, chapters[0].end)).toContain('版权声明')
    expect(chapters[1].title).toBe('第一章 风起')
    // 【保真律】前言被保留时前缀为空 → flatText === text。
    // 这一支此前没人守：把前言切片的 to 写成 titleIdx[0] - 1（一个"看起来更对称"的改动）
    // 会从 flatText 里悄悄吃掉一个 \n，而本用例其余断言连同 expectContiguous 在那之下全都
    // 自洽——它们校验的是 (flatText, chapters) 内部一致，与源文件无关。
    expect(flatText).toBe(text)
    expectContiguous(flatText, chapters)
  })

  it('全角空格缩进的标题行：能识别，且 Chapter.title 是 trim 后的（不含缩进）', () => {
    const indented = '　　第一章 风起　' // 首尾各一个 U+3000——中文 txt 小说的常见排版
    // 自检前提：两端确实各有一个全角空格，否则本用例会悄悄退化成一条普通标题用例
    expect(indented.startsWith('　')).toBe(true)
    expect(indented.endsWith('　')).toBe(true)
    expect(isChapterTitle(indented)).toBe(true)
    const { flatText, chapters } = splitChapters(indented + '\n正文。\n', 'x')
    // trim 掉缩进才是重点：Task 9 会把 title 原样渲染到侧栏，Task 5 会原样持久化。
    // 留着缩进的话，侧栏每条标题都多一段看不见的空白，看起来像排版风格而不像 bug。
    expect(chapters[0].title).toBe('第一章 风起')
    // 而 flatText 必须保留原文那份缩进——"标题要整洁"与"正文要逐字保真"是两件事，
    // 不能顺手一起处理掉。
    expect(flatText).toBe(indented + '\n正文。\n')
  })

  it('标题前只有空白时不产生前言章节', () => {
    const text = '\n\n第一章 风起\n正文。\n'
    const { flatText, chapters } = splitChapters(text, 'x')
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('第一章 风起')
    // 【保真律】flatText 是 text 的一个【后缀】，且被去掉的那段前缀【全是空白】。
    // 这是无检测器的完整表述——不需要先判断"丢没丢东西"，三种情形一并覆盖：
    //   · 什么都没丢（无前言 / 前言非空白 / 压根没有标题）→ 前缀是空串，flatText === text
    //   · 丢掉了一段全空白前言 → 前缀就是那段空白，flatText === text.slice(off)
    //   · 保留了非空白前言 → 前缀是空串
    // 此前只写了两条具名分支（"没丢" / "丢了空白前言"），漏了"保留了非空白前言"那一支：
    // 它既不经过提前返回、也不经过过滤器，正需要一个能覆盖它的表述。
    // 该律经 40000 例随机文本实测无例外，其中保留非空白前言的有 5778 例，全部成立。
    // 本用例属于前缀非空的那一支：flatText === text.slice(off)。
    // 之所以必须分成多条断言、不能统一写 flatText === text：丢掉一段空白前言是【合法】行为，
    // 此时 flatText 本来就不等于原文——保真的缺口在 Task 3 之前一直没人发现，正是这个原因。
    // off 的定义：第一个标题行首字符在原文中的下标
    //   = 它【前面每一行的长度】之和 + 每行一个 \n（原文按 \n 拆行，行间各有一个分隔符）。
    // 本例前两行都是空字符串（长度 0），各贡献 1 个 \n，故 off = 0 + 1 + 0 + 1 = 2。
    // 用 indexOf 而不是写死 2：让「off = 第一个标题行的起点」以定义的形式出现。
    // 但 indexOf 本身并不证明这个定义成立——钉住它的是下面两条断言：toBe(2) 钉住取值，
    // 与 flatText 的相等断言钉住语义。两者都在，这个定义才算被证明。
    const off = text.indexOf('第一章 风起')
    expect(off).toBe(2)
    expect(flatText).toBe(text.slice(off))
  })

  it('相邻标题之间无正文：区间仍连续，且两个标题都不被丢弃（flatText === 原文）', () => {
    // 【本用例不覆盖 kept 过滤器】原名字里的「空章节被丢弃」描述的是一个【不可达】的情况。
    // 每个章节切片都从它自己的标题行开始，而标题行 trim() 后必非空，所以真章节永远不可能为空；
    // 那个过滤器唯一能丢掉的只有「全空白的前言」，由「标题前只有空白时不产生前言章节」覆盖。
    // 两条用例职责不同：删过滤器只应让【那条前言用例】变红，本用例不该红（下面两个标题都不是空章）。
    // 因此改过滤器时请去改那条前言用例，**别把本用例当作它的守卫，也别以为删了它过滤器还有覆盖**。
    const text = '第一章 甲\n\n第二章 乙\n正文乙。\n'
    const { flatText, chapters } = splitChapters(text, 'x')
    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe('第一章 甲')
    // 非末章的区间末尾会带一个 \n 作为章间分隔（见 splitChapters 的拼接逻辑），
    // 所以这里 trim 后比较标题内容，而不是期望切片严格等于标题。
    // 注意：正是这个 \n 让 flatText 与原文逐字相等，见下面那条断言。
    expect(flatText.slice(chapters[0].start, chapters[0].end).trim()).toBe('第一章 甲')
    // 本章没有章节被丢弃（两个标题都不是空章），所以 flatText 必须与原文逐字相等。
    expect(flatText).toBe(text)
    expectContiguous(flatText, chapters)
  })

  it('空字符串不抛异常，产生一个 0 字章节', () => {
    const { flatText, chapters } = splitChapters('', 'x')
    expect(flatText).toBe('')
    expect(chapters).toHaveLength(1)
    expect(chapters[0].charCount).toBe(0)
  })

  it('大量章节时区间依然连续', () => {
    const text = Array.from({ length: 300 }, (_, i) => `第${i + 1}章 标题\n第${i + 1}章正文。`).join('\n')
    const { flatText, chapters } = splitChapters(text, 'x')
    expect(chapters).toHaveLength(300)
    expectContiguous(flatText, chapters)
    // 加这条不是为了让规模更大，而是为了让本用例有牙：expectContiguous 只查结构，
    // 一个内部自洽但内容被改错的 flatText 能让它全绿。300 章约 9 KB，比真实输入小三个
    // 数量级，所以它是【结构冒烟测试】而非规模测试——给它牙齿靠的是这条保真断言，
    // 而不是把样本加大。
    expect(flatText).toBe(text)
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm vitest run tests/unit/chapters.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/core/chapters"`。

- [ ] **Step 4: 写 `src/core/chapters.ts`**

```ts
import type { Chapter } from './types'

export const PREAMBLE_TITLE = '前言'

/** 正文里常见的句读符号：标题行不会包含它们 */
const SENTENCE_PUNCT = /[。！？；，]/

/**
 * 标题行的长度上限（量的是 trim 后的串）。
 *
 * 这是 TITLE_PATTERNS[2]（`chapter\s+\d+.*$`）唯一的界：那条正则的 `.*$` 本身无界，
 * 没有这个上限，一整段以 "Chapter 3" 开头的英文正文会被整行当成标题。
 * 上限量的是 trim 后的串，所以缩进与补白不占额度。
 */
const MAX_TITLE_LEN = 40

/**
 * 【每个模式都不得带 /g 或 /y】——这条靠注释与评审守，类型系统守不住。
 *
 * `RegExp.prototype.test` 在带 /g 或 /y 的正则上会读写自身的 lastIndex，于是同一行的判定
 * 会取决于「它前面刚测过什么」：isChapterTitle 就变成有状态的函数，第 n 行是不是标题
 * 要看第 n-1 行。导入一部二十多万行的小说时，这种错误既不可复现、也几乎不可见。
 *
 * 下面的 readonly 挡不住这件事：它只能阻止往表里 push、或对元素重新赋值，管不到
 * 「有人在某个模式字面量末尾写了个 /g」。所以真正的防线是这条注释加评审时的留意；
 * readonly 守的是另一件小事（别往这张表里塞模式）。
 */
const TITLE_PATTERNS: readonly RegExp[] = [
  // 第一章 / 第 12 章 / 第十二章 / 第一百零八回 / 第3节
  /^\s*第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节回卷篇](?:\s+\S.{0,30})?\s*$/,
  // 序章 / 楔子 雪夜 / 番外一 —— 后面必须跟空白才能带副标题，
  // 所以「前言不搭后语」不会被误判。
  /^\s*(?:序章|楔子|尾声|后记|前言|引子|番外)(?:[0-9零一二三四五六七八九十]+|[\s　]+\S.{0,30})?\s*$/,
  // Chapter 3 The Beginning
  /^\s*chapter\s+\d+.*$/i,
  // 1、开端 / 12．转折
  /^\s*[0-9]{1,4}\s*[、.．]\s*\S.{0,30}$/
]

export function isChapterTitle(line: string): boolean {
  const t = line.trim()
  if (t.length === 0 || t.length > MAX_TITLE_LEN) return false
  if (SENTENCE_PUNCT.test(t)) return false
  return TITLE_PATTERNS.some((re) => re.test(t))
}

export interface SplitResult {
  flatText: string
  chapters: Chapter[]
}

/**
 * 在**已归一化换行**（只含 \n）的文本上切分章节。
 * 保证 chapters[0].start === 0 且各章节 [start, end) 首尾相接、无缝、无重叠。
 */
export function splitChapters(text: string, fallbackTitle: string): SplitResult {
  const lines = text.split('\n')

  const titleIdx: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (isChapterTitle(lines[i])) titleIdx.push(i)
  }

  // 一个标题都没有 → 单章节模式，flatText 严格等于原文
  if (titleIdx.length === 0) {
    return {
      flatText: text,
      chapters: [
        { index: 0, title: fallbackTitle, start: 0, end: text.length, charCount: text.length }
      ]
    }
  }

  // 单位不一样，是刻意保留的：slices 里的 from/to 是【行号】（lines 的下标），
  // 而下面 Chapter 的 start/end 是【flatText 的字符偏移】。本函数的全部工作就是在这两种量
  // 之间换算，两个名字看着像却量不同的东西——统一命名反而会把两种单位伪装成同一种。
  const slices: Array<{ title: string; from: number; to: number }> = []
  if (titleIdx[0] > 0) {
    slices.push({ title: PREAMBLE_TITLE, from: 0, to: titleIdx[0] })
  }
  for (let i = 0; i < titleIdx.length; i++) {
    slices.push({
      title: lines[titleIdx[i]].trim(),
      from: titleIdx[i],
      to: i + 1 < titleIdx.length ? titleIdx[i + 1] : lines.length
    })
  }

  const bodies = slices.map((s) => ({
    title: s.title,
    body: lines.slice(s.from, s.to).join('\n')
  }))
  // 【这个过滤器只能丢掉「全空白的前言」，它不是通用的空章节清理】
  // 每个章节切片都从它自己的标题行开始（from = titleIdx[i]），而 isChapterTitle 要求
  // 该行 trim() 后非空，所以真章节的 body 必然包含自己的标题行，body.trim() 永不为 ''。
  // 也就是说「相邻标题之间的空章节」根本不可能存在——没有可丢的空章节。
  // 唯一会被丢掉的，是文件开头到第一个标题之间那段全空白区域（例如文件以若干空行开头）。
  const kept = bodies.filter((b) => b.body.trim() !== '')

  // 除最后一章外，每章正文末尾补一个 \n，计入该章。
  //
  // 【这个 \n 不负责区间连续】end === 下一章 start 是【构造性】成立的：start 取自
  // 追加前的 flatText.length，追加之后再取一次作为 end。把这段 \n 去掉，各章区间
  // 照样首尾相接——连续性只来自 start/end 的取值方式，与这里补不补字符无关。
  //
  // 【它唯一的用途是还原原文】lines.slice(from, to).join('\n') 丢掉了第 to-1 行之后
  // 本应存在的那个换行；补回来，flatText 才与源文件逐字相等。末章之后原文没有换行，
  // 故末章不补——这正是下面那个三元判断存在的原因。
  //
  // 逐字相等是刚需而非洁癖：Task 4 的 cursor / revealStart / chapterPos 全是 flatText
  // 的下标，Task 5 又会把它们持久化。只有 flatText === 原文，这些偏移才对得上用户
  // 真正导入的那个文件。
  let flatText = ''
  const chapters: Chapter[] = []
  kept.forEach((b, i) => {
    const chunk = i === kept.length - 1 ? b.body : `${b.body}\n`
    const start = flatText.length
    flatText += chunk
    chapters.push({
      index: i,
      title: b.title,
      start,
      end: flatText.length,
      charCount: chunk.length
    })
  })

  return { flatText, chapters }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm vitest run tests/unit/chapters.test.ts`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add <本任务改动的显式路径…>   # 不要用 -A：见文件头「git add -A 只在独占一棵工作树时安全」
cat > /tmp/wt-commit-msg.txt <<'EOF'
feat(core): 章节切分（标题正则 + 前言伪章节 + 区间连续性保证）
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## Task 4: 游标状态机 TypingEngine ★核心

**Files:**
- Create: `src/core/engine.ts`
- Test: `tests/unit/engine.test.ts`

**Interfaces:**
- Consumes: `Novel`, `Chapter`, `InputMode`, `PersistedSession`, `DEFAULT_RATIO`, `MIN_RATIO`, `MAX_RATIO` from `types.ts`
- Produces:
  - `EngineState = { cursor: number; revealStart: number; chapterPos: readonly number[]; activeChapter: number; ratio: number; mode: InputMode; startedAt: number | null }`
  - `class TypingEngine`：
    - `constructor(novel: Novel, init?: { ratio?: number; mode?: InputMode })`
    - `getSnapshot(): EngineState`（同一状态返回同一引用，供 `useSyncExternalStore`；因此**不得**做防御性拷贝，只能靠冻结保证交出去的状态不可改）
    - `get novel(): Novel`
    - `get visibleText(): string` ＝ `flatText.slice(revealStart, cursor)`
    - `pump(k: number, now?: number): void`
    - `backspace(k: number): void`
    - `jumpToChapter(i: number): void`
    - `setRatio(n: number): void`
    - `setMode(m: InputMode): void`
    - `subscribe(fn: () => void): () => void`
    - `toSession(): PersistedSession`
    - `static fromSession(novel: Novel, s: PersistedSession): TypingEngine`
  - `clampRatio(n: number): number`（导出以便单测）

- [ ] **Step 1: 写失败测试 `tests/unit/engine.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { TypingEngine, clampRatio } from '../../src/core/engine'
import { splitChapters } from '../../src/core/chapters'
import type { Novel, PersistedSession } from '../../src/core/types'

function makeNovel(text = '第一章 甲\nAAAAA\n第二章 乙\nBBBBB\n'): Novel {
  const { flatText, chapters } = splitChapters(text, '测试书')
  return {
    title: '测试书',
    sourcePath: '/tmp/测试书.txt',
    encoding: 'UTF-8',
    hadBom: false,
    flatText,
    chapters
  }
}

describe('clampRatio', () => {
  it('夹紧到 1..500 并取整', () => {
    expect(clampRatio(0)).toBe(1)
    expect(clampRatio(-5)).toBe(1)
    expect(clampRatio(10)).toBe(10)
    expect(clampRatio(10.6)).toBe(11)
    expect(clampRatio(9999)).toBe(500)
    expect(clampRatio(Number.NaN)).toBe(10)
    // 两条「太大」的策略刻意不同（见 clampRatio 的注释）：非有限值是不可用输入 → 默认值；
    // 有限的越界值 → 钳到上限。Infinity 走的是前者，与上面 9999 那行不是一个分支。
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(10)
  })
})

describe('TypingEngine 基础推进', () => {
  it('比例 10 时 pump(1) 抽出 10 个字', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 10 })
    e.pump(1)
    expect(e.getSnapshot().cursor).toBe(10)
    expect(e.visibleText).toBe(n.flatText.slice(0, 10))
    expect(e.visibleText).toHaveLength(10)
  })

  it('比例 1 时 pump(1) 只抽 1 个字', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    e.pump(1)
    expect(e.visibleText).toHaveLength(1)
  })

  it('比例 500 时 pump(1) 一次抽满上限', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 500 })
    e.pump(1)
    expect(e.getSnapshot().cursor).toBe(n.flatText.length)
    expect(e.visibleText).toBe(n.flatText)
  })

  it('pump(k) 一次上屏多个字时按 k × ratio 推进（输入法整词上屏）', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 3 })
    e.pump(4)
    expect(e.getSnapshot().cursor).toBe(12)
  })

  it('pump(0) 或负数不推进', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 10 })
    e.pump(0)
    e.pump(-3)
    expect(e.getSnapshot().cursor).toBe(0)
  })

  it('抵达末尾后 pump 为无操作', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 500 })
    const spy = vi.fn()
    e.subscribe(spy)
    e.pump(1)
    e.pump(1)
    expect(e.getSnapshot().cursor).toBe(n.flatText.length)
    // 「无操作」不只是游标不动，还必须【不通知】：末尾闸一旦去掉，状态完全相同、
    // 但每敲一键都换一次快照引用，useSyncExternalStore 于是持续重渲染
    // （变异实测：末尾连按三次，通知数 1 → 3）。
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('第一次 pump 记录 startedAt，后续不变', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    expect(e.getSnapshot().startedAt).toBeNull()
    e.pump(1, 1000)
    expect(e.getSnapshot().startedAt).toBe(1000)
    e.pump(1, 2000)
    expect(e.getSnapshot().startedAt).toBe(1000)
  })
})

describe('退格：只回吐显示，绝不改小说内容', () => {
  it('backspace 按 ratio 回退', () => {
    // 默认 fixture 只有 24 字，ratio 10 时 pump(3) = 30 会被夹紧到 24
    // （见 spec §2 的 min(cursor + k*ratio, flatText.length)），就测不出「按 ratio 回退」了。
    // 这里用一个足够长的单章小说，保证不触发末尾夹紧。
    const long = '第一章 甲\n' + 'A'.repeat(100) + '\n'
    const e = new TypingEngine(makeNovel(long), { ratio: 10 })
    e.pump(3)
    expect(e.getSnapshot().cursor).toBe(30)
    e.backspace(1)
    expect(e.getSnapshot().cursor).toBe(20)
  })

  it('backspace 不会退到 revealStart 之前', () => {
    // 本用例此前是【空的】：它构造出来的 revealStart 恰好是 0，于是「下界 = revealStart」
    // 与「下界 = 0」两种实现同值——把下界改成 0 它照样绿（变异实测）。
    // 要让它有牙，必须先把窗口起点推离 0，而跳章是唯一会移动 revealStart 的操作。
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 10 })
    e.pump(20)
    e.jumpToChapter(1)
    const before = e.getSnapshot()
    expect(before.revealStart).toBeGreaterThan(0) // 前提自检：起点确实不在 0，用例才不空

    e.backspace(20)
    const s = e.getSnapshot()
    // 下界本身，写成「恰好停在窗口起点」这个更精确的形式（它蕴含 cursor >= revealStart）。
    // 内容断言杀不掉下界变异：变异把游标退到 0 之后，slice(0, 0) 与 slice(12, 12) 都是空串。
    expect(s.cursor).toBe(s.revealStart)
    // 退格只回吐显示，窗口起点不动（spec §2 的 backspace 一行）。
    expect(s.revealStart).toBe(before.revealStart)
    // 结果与源数据比对，而非只测长度。
    expect(e.visibleText).toBe(n.flatText.slice(s.revealStart, s.cursor))

    // 输入闸：非正数与非数是【无操作】，而不是「按符号前进」。
    // 实测去掉 backspace 的 k > 0 闸：backspace(-1) 会让游标【前进】（12 → 22，多吐字），
    // backspace(NaN) 会把游标变成 NaN（chapterPos 里跟着出现 null）。两条都钉住契约。
    e.backspace(-1)
    expect(e.getSnapshot().cursor).toBe(s.cursor)
    e.backspace(Number.NaN)
    expect(e.getSnapshot().cursor).toBe(s.cursor)
  })

  it('backspace 不修改 novel.flatText 与 chapters', () => {
    const n = makeNovel()
    const before = n.flatText
    const chaptersBefore = JSON.stringify(n.chapters)
    const e = new TypingEngine(n, { ratio: 10 })
    e.pump(5)
    e.backspace(3)
    expect(n.flatText).toBe(before)
    expect(JSON.stringify(n.chapters)).toBe(chaptersBefore)
  })
})

describe('跨章节', () => {
  it('跨界打字时 revealStart 保持不变，阅读区连续', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 1 })
    const c0 = n.chapters[0]
    const c1 = n.chapters[1]
    // 推进到第二章中间。第二章区间是 [c0.charCount, c0.charCount + c1.charCount)，
    // 取中点才能确保已越过标题行（标题行位于该章开头），否则下面的 toContain(c1.title) 会失败。
    const steps = c0.charCount + Math.floor(c1.charCount / 2)
    for (let i = 0; i < steps; i++) e.pump(1)
    const s = e.getSnapshot()
    expect(s.revealStart).toBe(0)
    expect(s.activeChapter).toBe(1)
    expect(e.visibleText).toBe(n.flatText.slice(0, steps))
    expect(e.visibleText).toContain(c1.title)
  })

  it('比例大于整章长度时，被越过的整章标记为已读完', () => {
    // 用三章：默认的两章 fixture 里 prev === 0，收尾循环的起点写 prev 还是写 0 完全同值，
    // 那个变异在两种实现下都绿。先跳到第 2 章把 prev 推离 0，循环起点才可分辨。
    const n = makeNovel('第一章 甲\nAAAAA\n第二章 乙\nBBBBB\n第三章 丙\nCCCCC\n')
    const e = new TypingEngine(n, { ratio: 500 })
    e.jumpToChapter(1)
    e.pump(1)
    expect(e.getSnapshot().chapterPos[1]).toBe(n.chapters[1].charCount)
    // 且没读过的那一章【不能】被顺手标记为已读完——循环起点写成 0 时它会被写成 charCount。
    expect(e.getSnapshot().chapterPos[0]).toBe(0)
  })

  it('activeChapter 随光标推进而更新', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 1 })
    expect(e.getSnapshot().activeChapter).toBe(0)
    for (let i = 0; i < n.chapters[0].charCount; i++) e.pump(1)
    expect(e.getSnapshot().activeChapter).toBe(1)
  })
})

describe('章节跳转与回填', () => {
  it('跳到没读过的章：阅读区为空，游标在该章开头', () => {
    // 默认 fixture 只有 2 章，索引 2 越界——越界是无操作，另有专门用例覆盖
    // （见下面的「跳到越界索引为无操作」）。这里用第 2 章（索引 1），它在全新引擎上尚未读过。
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 1 })
    // 跳章必须通知订阅者：不通知则 Task 9 的列表与 Task 10 的正文都不会重渲染。
    const spy = vi.fn()
    e.subscribe(spy)
    e.jumpToChapter(1)
    expect(spy).toHaveBeenCalledTimes(1)
    const s = e.getSnapshot()
    expect(s.activeChapter).toBe(1)
    expect(s.revealStart).toBe(n.chapters[1].start)
    expect(s.cursor).toBe(n.chapters[1].start)
    expect(e.visibleText).toBe('')
  })

  it('跳到读过的章：回填该章上次的阅读进度', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 1 })
    e.jumpToChapter(1)
    for (let i = 0; i < 4; i++) e.pump(1)
    const savedCursor = e.getSnapshot().cursor
    const savedText = e.visibleText
    // 这条【不是】夹具自检，而是钉住 revealStart/窗口关系的那一条——无视 revealStart 的
    // 变异正是死在它上面（expected '第一章 甲\nAAAAA\n第二章 ' to have a length of 4
    // but got 16）。它与下面那条「窗口内容 = flatText.slice(revealStart, cursor)」是一对：
    // 少了后者，它就退化成只测长度；少了它，后者在空窗口上恒真。
    expect(savedText).toHaveLength(4)

    // 长度对不代表内容对：窗口内容必须与【源数据】直接比对。revealStart > 0 且窗口非空，
    // 这是整套用例里唯一能钉住「等长但内容错位」（把第 1 章的文字渲染到第 2 章的位置上）
    // 的地方——只测长度时那种变异 24 条用例全绿。
    const mid = e.getSnapshot()
    expect(mid.revealStart).toBeGreaterThan(0) // 前提：窗口起点不在 0
    expect(mid.cursor).toBeGreaterThan(mid.revealStart) // 前提：窗口非空
    expect(e.visibleText).toBe(n.flatText.slice(mid.revealStart, mid.cursor))

    // 离开去别处
    e.jumpToChapter(0)
    expect(e.visibleText).toBe('')

    // 跳回来：进度被回填
    e.jumpToChapter(1)
    expect(e.getSnapshot().cursor).toBe(savedCursor)
    expect(e.visibleText).toBe(savedText)
    // 回填的不只是 cursor，该章的 chapterPos 也要同步成章内相对偏移。
    expect(e.getSnapshot().chapterPos[1]).toBe(savedCursor - n.chapters[1].start)
  })

  it('跳到越界索引为无操作', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    e.pump(1)
    const before = e.getSnapshot()
    e.jumpToChapter(-1)
    e.jumpToChapter(99)
    expect(e.getSnapshot()).toBe(before)
  })

  it('退格后同步更新 chapterPos', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 1 })
    e.jumpToChapter(1)
    for (let i = 0; i < 4; i++) e.pump(1)
    expect(e.getSnapshot().chapterPos[1]).toBe(4)
    e.backspace(1)
    expect(e.getSnapshot().chapterPos[1]).toBe(3)
  })
})

describe('比例与模式', () => {
  it('setRatio 夹紧到 1..500 且不改动游标', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 10 })
    e.pump(1)
    const cursor = e.getSnapshot().cursor
    e.setRatio(9999)
    expect(e.getSnapshot().ratio).toBe(500)
    expect(e.getSnapshot().cursor).toBe(cursor)

    e.setRatio(0)
    expect(e.getSnapshot().ratio).toBe(1)

    const spy = vi.fn()
    e.subscribe(spy)
    e.setRatio(1)
    // 夹紧后与现值相同，仍然是「无实际变化」，不该通知（否则拖动比例滑块会持续重渲染）。
    expect(spy).not.toHaveBeenCalled()
  })

  it('setMode 切换输入模式', () => {
    const e = new TypingEngine(makeNovel())
    expect(e.getSnapshot().mode).toBe('ime')
    e.setMode('key')
    expect(e.getSnapshot().mode).toBe('key')

    const spy = vi.fn()
    e.subscribe(spy)
    e.setMode('key')
    // 设成与现值相同的模式是【无实际变化】，不该通知——通知一次就是一次快照更换与重渲染。
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('订阅与快照', () => {
  it('状态变化时通知订阅者，且快照引用只在变化时更换', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    const spy = vi.fn()
    const off = e.subscribe(spy)
    const spy2 = vi.fn()
    e.subscribe(spy2)

    const before = e.getSnapshot()
    expect(e.getSnapshot()).toBe(before)

    e.pump(1)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(e.getSnapshot()).not.toBe(before)

    const after = e.getSnapshot()
    expect(e.getSnapshot()).toBe(after)

    off()
    e.pump(1)
    expect(spy).toHaveBeenCalledTimes(1)
    // 第二个订阅者一直在收，且 off() 只摘掉自己——emit 是对所有订阅者广播。
    expect(spy2).toHaveBeenCalledTimes(2)
  })

  it('getSnapshot 交出的是只读快照，调用方改不动引擎', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    e.pump(1)
    const snap = e.getSnapshot()

    // 这条与 toSession 那条别名探针是两件事：这里探的是 getSnapshot 直接交出的内部状态。
    // 用 try 而不是「必须抛错」：冻结对象在严格模式下写会抛 TypeError，非严格模式下被
    // 静默丢弃，两种模式都必须保证引擎不变——所以断言的是值没变，而不是一定抛错。
    try {
      ;(snap.chapterPos as number[])[0] = 424242
    } catch {
      /* 严格模式：抛错也算通过 */
    }
    expect(e.getSnapshot().chapterPos[0]).toBe(1)
    expect(e.getSnapshot()).toBe(snap)
  })

  it('无实际变化的操作不触发通知', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    const spy = vi.fn()
    e.subscribe(spy)
    e.backspace(1) // cursor 已在 revealStart
    e.pump(0)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('持久化往返', () => {
  it('toSession / fromSession 保留游标、比例、模式与各章进度', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 7, mode: 'key' })
    e.pump(2, 1234)
    e.jumpToChapter(1)
    e.pump(1)
    const s = e.toSession()
    expect(s.startedAt).toBe(1234)

    const restored = TypingEngine.fromSession(n, s)
    expect(restored.getSnapshot()).toEqual(e.getSnapshot())
    expect(restored.visibleText).toBe(e.visibleText)

    const probe = e.toSession()
    probe.chapterPos[0] = 424242
    // toSession 必须交出【副本】：否则 Task 5 的持久化层一改返回值，就直接改到了
    // 引擎内部的 chapterPos（而 getSnapshot 交出去的还是同一个数组）。
    expect(e.toSession().chapterPos[0]).not.toBe(424242)
  })

  it('fromSession 会修复越界与畸形数据', () => {
    const n = makeNovel()
    const malformed: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: '/tmp/测试书.txt',
      ratio: 99999,
      mode: 'key',
      cursor: 999999,
      revealStart: 888888,
      chapterPos: [999999],
      activeChapter: 42,
      startedAt: null
    }
    const restored = TypingEngine.fromSession(n, malformed)
    const s = restored.getSnapshot()
    expect(s.ratio).toBe(500)
    expect(s.cursor).toBe(n.flatText.length)
    expect(s.revealStart).toBeLessThanOrEqual(s.cursor)
    expect(s.chapterPos).toHaveLength(n.chapters.length)
    expect(s.chapterPos.every((p) => p >= 0)).toBe(true)
    // 上界也必须夹。只断言 >= 0 的话 [999999] 会原样通过——而这条用例存在的理由
    // 正是「越界」，实测去掉 Math.min(v, c.charCount) 时它照样绿。
    expect(s.chapterPos.every((p, i) => p <= n.chapters[i].charCount)).toBe(true)
    expect(s.activeChapter).toBeGreaterThanOrEqual(0)
    expect(s.activeChapter).toBeLessThan(n.chapters.length)

    // 恢复出来的引擎必须【当场】满足自己的不变量：activeChapter 那一章的 chapterPos
    // 就等于 cursor 减去该章起点。畸形会话里 activeChapter 由 cursor 反推得出，
    // 而 chapterPos 是从会话里读来的——两者不同源时，这一条会红。
    // 实测（修复前）：这里读到 0，真值是 12。
    expect(s.chapterPos[s.activeChapter]).toBe(s.cursor - n.chapters[s.activeChapter].start)

    // mode 是从磁盘上的 JSON 读回来的（Task 5），字段没有任何类型保护：
    // 半截写入或手改都会落到这里，必须落到合法值上，而不是被原样带进引擎。
    const oddMode = { ...malformed, mode: 'garbage' } as unknown as PersistedSession
    expect(TypingEngine.fromSession(n, oddMode).getSnapshot().mode).toBe('ime')
  })

  it('陈旧会话（章节目录已被改过）恢复后：不变量成立，且跳到该章落在游标处', () => {
    // 4 章 / 48 字。会话里的 chapterPos 描述的是**另一份章节目录**——用户在同路径上改过小说，
    // 而 Task 12 只按 sourcePath 匹配会话，所以这是正常使用能到达的状态，不是手改文件。
    const n = makeNovel('第一章 甲\nAAAAA\n第二章 乙\nBBBBB\n第三章 丙\nCCCCC\n第四章 丁\nDDDDD\n')
    expect(n.chapters).toHaveLength(4) // 前提自检：夹具几何就是本条用例声称的那个
    expect(n.flatText).toHaveLength(48)
    const stale: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: '/tmp/测试书.txt',
      ratio: 10,
      mode: 'ime',
      cursor: 999999,
      revealStart: 0,
      chapterPos: [999999, -3],
      activeChapter: 0,
      startedAt: null
    }

    const restored = TypingEngine.fromSession(n, stale)
    const s = restored.getSnapshot()
    // 恢复当场满足不变量。修复前这里读到 0，而 cursor - start = 12。
    expect(s.chapterPos[s.activeChapter]).toBe(s.cursor - n.chapters[s.activeChapter].start)
    // 用户可见后果：跳到当前章必须落在游标处。修复前落在 36（第 4 章开头），而游标在 48（章末）
    // ——侧栏显示这一章 0% 而实际已读完，且点它一下反而把进度退回章首。
    restored.jumpToChapter(s.activeChapter)
    expect(restored.getSnapshot().cursor).toBe(s.cursor)
    expect(restored.getSnapshot().cursor).toBe(n.chapters[3].end)
  })

  it('重启后高亮跟随游标——「点了已读完的章」那次点击不会被回存', () => {
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 1 })
    for (let i = 0; i < n.flatText.length; i++) e.pump(1)
    e.jumpToChapter(0)
    // 偏差状态：jumpToChapter 刻意不走统一收尾，所以 activeChapter = 0 而 cursor 落在
    // 第 2 章开头（= 第 1 章的末尾）。实测 cursor=12、active=0、chapterPos=[12,12]。
    expect(e.getSnapshot().activeChapter).toBe(0)
    expect(e.getSnapshot().cursor).toBe(n.chapters[1].start)

    // fromSession 按 cursor 反推 activeChapter，无法区分「用户点了已读完的章」与脏数据，
    // 于是重启后高亮跟随游标（第 2 章）。这是刻意的取舍——信任会话里的 activeChapter
    // 会让陈旧/手改的会话驱动高亮，那是被别的断言抓住的变异。
    const restored = TypingEngine.fromSession(n, e.toSession())
    expect(restored.getSnapshot().activeChapter).toBe(1)
    // 而且这里的收尾**不是**无操作：修复写入用的是重算出来的那一章（第 2 章），
    // 会话里存的 chapterPos[1]=12 描述的是「游标在第 1 章」那个旧状态，
    // 所以它被改成 cursor-start = 0。实测 [12,12] → [12,0]，改完才自洽。
    expect(restored.getSnapshot().chapterPos).toEqual([12, 0])
    const rs = restored.getSnapshot()
    expect(rs.chapterPos[rs.activeChapter]).toBe(rs.cursor - n.chapters[rs.activeChapter].start)
  })
})

describe('随机序列下的不变量（播种，确定性）', () => {
  it('两千步随机操作后，七条不变量无一被破坏', () => {
    // 夹具几何前提：下面几处注释（退格的「默认 fixture 只有 24 字」、跳章的「只有 2 章」）
    // 一直只是声称，没有任何断言。样本一旦被改小或改成三章，这里立刻红。
    const probe = makeNovel()
    expect(probe.flatText).toHaveLength(24)
    expect(probe.chapters).toHaveLength(2)
    expect(probe.chapters.map((c) => c.charCount)).toEqual([12, 12])

    const THREE = '第一章 甲\nAAAAA\n第二章 乙\nBBBBB\n第三章 丙\nCCCCC\n'
    const novels = [makeNovel(), makeNovel(THREE), makeNovel('第一章 甲\n' + 'A'.repeat(100) + '\n')]

    // 确定性 LCG：失败可复现，不依赖 Math.random。
    let seed = 20261008
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }

    const violations: string[] = []
    for (const novel of novels) {
      const e = new TypingEngine(novel, { ratio: 1 })
      for (let step = 0; step < 2000; step++) {
        const roll = rnd()
        if (roll < 0.5) e.pump(rnd() < 0.7 ? 1 : 1 + Math.floor(rnd() * 4))
        else if (roll < 0.75) e.backspace(rnd() < 0.7 ? 1 : 1 + Math.floor(rnd() * 4))
        else if (roll < 0.95) e.jumpToChapter(Math.floor(rnd() * (novel.chapters.length + 1)))
        else e.setRatio(1 + Math.floor(rnd() * 600))

        const s = e.getSnapshot()
        const where = `${novel.chapters.length} 章 / 第 ${step} 步`
        if (!(s.revealStart <= s.cursor)) violations.push(`${where}: revealStart ${s.revealStart} > cursor ${s.cursor}`)
        if (!(s.cursor >= 0 && s.cursor <= novel.flatText.length))
          violations.push(`${where}: cursor ${s.cursor} 越界（长度 ${novel.flatText.length}）`)
        if (!(s.activeChapter >= 0 && s.activeChapter < novel.chapters.length))
          violations.push(`${where}: activeChapter ${s.activeChapter} 越界`)
        if (s.chapterPos.length !== novel.chapters.length)
          violations.push(`${where}: chapterPos 长度 ${s.chapterPos.length} ≠ ${novel.chapters.length}`)
        novel.chapters.forEach((c, i) => {
          if (!(s.chapterPos[i] >= 0 && s.chapterPos[i] <= c.charCount))
            violations.push(`${where}: chapterPos[${i}]=${s.chapterPos[i]} 越界（charCount ${c.charCount}）`)
        })
        const cur = novel.chapters[s.activeChapter]
        if (cur && s.chapterPos[s.activeChapter] !== s.cursor - cur.start)
          violations.push(
            `${where}: chapterPos[active]=${s.chapterPos[s.activeChapter]} ≠ cursor-start=${s.cursor - cur.start}`
          )
        // 窗口非空时，内容必须等于源切片——只测长度会漏掉等长错位。
        if (s.cursor > s.revealStart && e.visibleText !== novel.flatText.slice(s.revealStart, s.cursor))
          violations.push(`${where}: 窗口内容与 flatText.slice(revealStart, cursor) 不符`)
      }
    }
    expect(violations).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/unit/engine.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/core/engine"`。

- [ ] **Step 3: 写 `src/core/engine.ts`**

```ts
import type { Chapter, InputMode, Novel, PersistedSession } from './types'
import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO } from './types'

export interface EngineState {
  /** 下一个要被抽出来的字符下标；**阅读位置**的唯一指针——注意不是全部状态的唯一指针，
   * chapterPos 是独立的持久化状态，cursor 反推不出它（jumpToChapter 要读它） */
  cursor: number
  /** 当前显示窗口的起点 */
  revealStart: number
  /**
   * 每章「上次离开该章时，光标停在该章内的偏移」（章内相对偏移）。
   *
   * 两点别读错：对**当前章**而言它就是此刻的偏移（不是「上次」）；而被整章越过的章
   * 会被直接写成 `charCount`——那些章从未「停留」过。
   *
   * 刻意是 `readonly`：`getSnapshot()` 直接把内部状态交出去（`useSyncExternalStore`
   * 要求同一状态返回同一引用，不能每次渲染新建副本），于是这个数组同时也是
   * `commit` 要改的那个数组。`readonly` 让 Task 9/10/12 的消费者在**编译期**就
   * 无法把 `snap.chapterPos[i]` 写坏——那是唯一能无声破坏本项目核心不变量
   * （阅读区恒等于 `flatText.slice(revealStart, cursor)`）却既无类型错误、
   * 也无测试发现的路径。运行时由 `Object.freeze` 兜住（见 `freezeState`）。
   */
  chapterPos: readonly number[]
  activeChapter: number
  ratio: number
  mode: InputMode
  startedAt: number | null
}

/**
 * 两条策略，刻意不同，别当成不一致：
 *   · **非有限输入**（NaN / ±Infinity）→ `DEFAULT_RATIO`。这类值不是「太大」而是**不可用**
 *     （多半来自算错或缺失的输入），丢掉它比钳到上限更诚实。
 *   · **有限但越界** → 钳到 `[MIN_RATIO, MAX_RATIO]`。用户拖滑块拖到头是合法意图。
 * 实测：clampRatio(Infinity) === 10 而 clampRatio(9999) === 500；两条都有断言钉住。
 */
export function clampRatio(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RATIO
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, Math.round(n)))
}

/**
 * 冻结状态对象**和**它的 `chapterPos` 数组——两个都要冻，只冻外层等于没冻
 * （`state.chapterPos[0] = x` 照样写得进去）。
 *
 * 就地冻结并返回同一个引用，不复制：调用点全都在构造新对象，没有共享可变数组。
 *
 * 三个必须写下来的注意点：
 * 1. **浅冻结**。只冻这一层；将来若给 `EngineState` 加嵌套对象或数组字段，
 *    那个字段得自己冻，`Object.freeze` 不会替它做。
 * 2. **越界写的表现取决于模式**：渲染进程的打包产物是严格模式，写入抛
 *    `TypeError`；非严格模式下被静默丢弃。两种情况下引擎自身都完好——
 *    这正是要冻结的目的：坏的是调用方，不是状态。
 * 3. **不影响 IPC**。冻结对象的结构化克隆（structured clone）正常，
 *    所以 `toSession()` 的返回值照旧能过进程间通信。
 */
function freezeState(state: EngineState): Readonly<EngineState> {
  Object.freeze(state.chapterPos)
  return Object.freeze(state)
}

export class TypingEngine {
  private readonly _novel: Novel
  private _state: Readonly<EngineState>
  private readonly _listeners = new Set<() => void>()

  constructor(novel: Novel, init?: { ratio?: number; mode?: InputMode }) {
    this._novel = novel
    this._state = freezeState({
      cursor: 0,
      revealStart: 0,
      chapterPos: novel.chapters.map(() => 0),
      activeChapter: 0,
      ratio: clampRatio(init?.ratio ?? DEFAULT_RATIO),
      mode: init?.mode ?? 'ime',
      startedAt: null
    })
  }

  get novel(): Novel {
    return this._novel
  }

  /** 阅读区唯一的内容来源 */
  get visibleText(): string {
    const { revealStart, cursor } = this._state
    return this._novel.flatText.slice(revealStart, cursor)
  }

  /**
   * 返回**同一个引用**直到状态真的变化——`useSyncExternalStore` 每次渲染都调用它，
   * 并用 `Object.is` 比对；每次新建副本会让 React 认为每帧都在变，直接触发
   * 「The result of getSnapshot should be cached to avoid an infinite loop」。
   * 所以这里【不能】用防御性拷贝，只能靠 `freezeState` 保证交出去的状态不可改。
   */
  getSnapshot(): EngineState {
    return this._state
  }

  subscribe(fn: () => void): () => void {
    this._listeners.add(fn)
    return () => {
      this._listeners.delete(fn)
    }
  }

  /**
   * 通知所有订阅者。
   *
   * 【订阅者抛异常会中断整个循环，后面的订阅者收不到这次通知】——这是刻意的，与
   * React 的 store 契约一致（渲染函数的异常应当冒泡，而不是被吞掉）。别把它「加固」
   * 成 try/catch 吞异常：那会把渲染错误变成静默的状态不同步。
   */
  private emit(): void {
    for (const fn of this._listeners) fn()
  }

  /**
   * 二分查找 pos 落在哪一章；pos === 长度时取最后一章。
   *
   * `chapters.length === 0` 那一行经 splitChapters 不可达（空文本也会产出 1 章），
   * 它**正是** commit 里 `if (current)` 存在的唯一理由——两处是一件事，
   * 要删就一起删，别只删一个（只删守卫，空章节目录会让 `chapters[idx]` 变成 undefined 解引用）。
   */
  private chapterIndexOf(pos: number): number {
    const chapters = this._novel.chapters
    if (chapters.length === 0) return 0
    if (pos >= this._novel.flatText.length) return chapters.length - 1
    let lo = 0
    let hi = chapters.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (chapters[mid].start <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /**
   * 统一收尾规则：把中间被整章越过的章节标记为已读完，再把 chapterPos[新章]
   * 同步为章内偏移。
   *
   * 【调用者只有 pump 与 backspace——jumpToChapter 刻意不走这里】（见该方法的注释）。
   * 「统一收尾规则」这条名字容易读成「任何游标变化之后都执行」，那不是事实，
   * 也不是笔误：跳章要的是「点了哪章就高亮哪章」，与本方法算出来的 activeChapter
   * 在目标章已读完时并不一致。
   */
  private commit(nextCursor: number): void {
    const chapters = this._novel.chapters
    const total = this._novel.flatText.length
    // 下夹 0 是【不可达的防守】，别把它当成 commit 的一般性范围闸：pump 有 k > 0 闸
    // 且 ratio ≥ 1、backspace 以 revealStart(≥ 0) 为下界、jump 至少是 chapter.start、
    // fromSession 夹到 ≥ 0——差分实测 0/5200 有差异。真正承重的是 Math.min 那半边：
    // 「游标不越过正文末尾」全靠它（去掉它，末尾钳制立刻失守）。
    const cursor = Math.max(0, Math.min(nextCursor, total))
    const idx = this.chapterIndexOf(cursor)
    const chapterPos = this._state.chapterPos.slice()

    const prev = this._state.activeChapter
    if (idx > prev) {
      for (let i = prev; i < idx; i++) chapterPos[i] = chapters[i].charCount
    }
    const current = chapters[idx]
    if (current) chapterPos[idx] = cursor - current.start

    this._state = freezeState({ ...this._state, cursor, activeChapter: idx, chapterPos })
    this.emit()
  }

  /**
   * 输入 k 个字，抽出 k × ratio 个字符。
   *
   * 【这个 `k > 0` 闸是承重的，不要照 backspace 的样子删掉】：它是**唯一**维持
   * `revealStart ≤ cursor` 的东西——`commit` 只把游标夹到 `[0, total]`，
   * **从不夹到 revealStart**。实测：去掉它，一次 `pump(-5)` 就把游标退到窗口起点之前
   * （15 → 10，而 revealStart 是 12），阅读区从此永久空白。
   * 与之相对，backspace 的 `k > 0` 闸只是契约性的（见那里）。两者看着对称，作用不同。
   */
  pump(k: number, now: number = Date.now()): void {
    if (!(k > 0)) return
    const total = this._novel.flatText.length
    if (this._state.cursor >= total) return
    if (this._state.startedAt === null) {
      this._state = freezeState({ ...this._state, startedAt: now })
    }
    this.commit(this._state.cursor + k * this._state.ratio)
  }

  /**
   * 退格 k 次，回吐 k × ratio 个字符；小说内容不变。
   *
   * 这里的 `k > 0` 闸【只守契约、不守不变量】：下面那行 `Math.max(revealStart, …)`
   * 对 k 的任何符号都保得住 `revealStart ≤ cursor`（k 为负时 `cursor - k*ratio` 更大，
   * 仍被 revealStart 托住）。所以这个闸的作用是「负数不当成前进」——若哪天被绕过，
   * `k = -1` 的效果是**向前跳**（`cursor - (-1 × ratio)` 变大），而不是无操作。
   * 与 pump 那个闸不同（那个承重），但也别删：Task 11 只会用 k ≥ 1，这是给调用方的契约。
   */
  backspace(k: number): void {
    if (!(k > 0)) return
    const next = Math.max(this._state.revealStart, this._state.cursor - k * this._state.ratio)
    if (next === this._state.cursor) return
    this.commit(next)
  }

  /**
   * 跳转到第 i 章，并回填该章上次的阅读进度。
   *
   * 【本方法刻意不走 commit（统一收尾规则）】，而是直接写 activeChapter = i。
   * 理由是「点了哪章就高亮哪章」：用户点第 i 章，左侧列表必须高亮第 i 章。
   * 若改用 commit 的算法（activeChapter = chapterIndexOf(cursor)），当第 i 章
   * 已经整章读完时 chapterPos[i] === charCount，游标正好落在**下一章**的开头，
   * 于是高亮的是下一章——用户点了 A、列表高亮 B。下一键打字会由 commit 自动
   * 纠正回 cursor 所在章，那是打字推进的正常语义，不是这次点击的语义。
   * （变异实测：把这里改成 chapterIndexOf(cursor) 全套用例全绿，
   * 所以两种语义都「没人守」；本注释与 spec §2 是唯一把选择钉下来的地方。）
   */
  jumpToChapter(i: number): void {
    const chapters = this._novel.chapters
    if (!Number.isInteger(i) || i < 0 || i >= chapters.length) return
    const chapter = chapters[i]
    const raw = chapter.start + (this._state.chapterPos[i] ?? 0)
    const cursor = Math.max(chapter.start, Math.min(raw, chapter.end))

    // 这一行【保留，不要为了「让 jumpToChapter 更精简」删掉】：它是本方法内的**本地保证**
    // ——跳转之后 chapterPos[i] 一定与刚算出的 cursor 一致，与 chapterPos 当初从哪来无关。
    // 删掉它，跳章的这份一致性就得依赖三个方法之外的某次夹紧（fromSession 那条），
    // 而那正是本任务里 important-1 的成因形状：把保证挪到看不见的地方，用简洁换掉它。
    const chapterPos = this._state.chapterPos.slice()
    chapterPos[i] = cursor - chapter.start

    this._state = freezeState({
      ...this._state,
      revealStart: chapter.start,
      cursor,
      activeChapter: i,
      chapterPos
    })
    this.emit()
  }

  setRatio(n: number): void {
    const ratio = clampRatio(n)
    if (ratio === this._state.ratio) return
    this._state = freezeState({ ...this._state, ratio })
    this.emit()
  }

  setMode(mode: InputMode): void {
    // 与 fromSession 同一套归一：非法值落到 'ime'。此前只有恢复时会校验，构造器与
    // 这里都不校验，于是 `toSession → fromSession` 对非法 mode 不是恒等
    // （存进去 'garbage'、读回来 'ime'）。加上这一行，往返对 mode 才是恒等的。
    const next = mode === 'key' ? 'key' : 'ime'
    if (next === this._state.mode) return
    this._state = freezeState({ ...this._state, mode: next })
    this.emit()
  }

  toSession(): PersistedSession {
    const s = this._state
    return {
      novelTitle: this._novel.title,
      sourcePath: this._novel.sourcePath,
      ratio: s.ratio,
      mode: s.mode,
      cursor: s.cursor,
      revealStart: s.revealStart,
      chapterPos: s.chapterPos.slice(),
      activeChapter: s.activeChapter,
      startedAt: s.startedAt
    }
  }

  /**
   * 从磁盘上的会话恢复。
   *
   * 最后一步必须自己跑一遍「收尾」——把 `chapterPos[activeChapter]` 对齐成
   * `cursor - chapters[activeChapter].start`——不能指望打字来修。原因有两层：
   *
   * 1. 会话里的 `chapterPos` 与**当前**的章节目录未必同源。Task 12 只按
   *    `sourcePath` 匹配会话，用户在同路径上改了小说就会拿到一份描述着
   *    「已经不存在的章节目录」的 chapterPos；而 Task 5 的缓存闸让这更常见，
   *    因为改过的文件必然 cache miss，而 cache miss 正是重建章节目录、
   *    把陈旧会话套到新目录上的那一刻。
   * 2. 即便不修，`pump` 的末尾闸（`cursor >= total` 即返回）会让它**永远修不好**：
   *    在末尾时 pump 直接返回、根本不 commit，而 commit 恰恰是唯一会重算
   *    `chapterPos[active]` 的地方。实测：cursor=48/48 的会话被恢复后，
   *    chapterPos[3] 停在 0，再 pump 仍是 0。于是「上次读到全书结尾」的用户
   *    看到一个永远是 0% 的进度条，打字也救不回来。
   *
   * 这个写入是**无条件**的：只要 cursor 落在某一章上就写，绝不写成「看起来不一致才修」
   * ——那种条件判断本身会成为第二条需要单独测试的规则，而且恰恰会在它判断失误的输入上
   * 悄悄保留这个 bug。对格式良好的会话它是无操作（chapterPos[activeChapter] 本来
   * 就等于该差值，包括 jumpToChapter 造成的 activeChapter ≠ cursor 所在章那种状态）。
   *
   * 它**不**碰 activeChapter：那一项照旧由 cursor 反推。信任会话里存着的
   * activeChapter 是另一个变异——陈旧或手改的会话会让侧栏高亮与 cursor 完全无关，
   * 那是被现有用例正确抓住的。
   */
  static fromSession(novel: Novel, s: PersistedSession): TypingEngine {
    const engine = new TypingEngine(novel, { ratio: s.ratio, mode: s.mode })
    const total = novel.flatText.length

    const chapterPos = novel.chapters.map((c, i) => {
      const v = s.chapterPos?.[i]
      if (typeof v !== 'number' || !Number.isFinite(v)) return 0
      return Math.max(0, Math.min(v, c.charCount))
    })

    const cursor = Math.max(0, Math.min(Number.isFinite(s.cursor) ? s.cursor : 0, total))
    const revealStart = Math.max(0, Math.min(Number.isFinite(s.revealStart) ? s.revealStart : 0, cursor))

    // 建 → 夹 → 修 → 冻结：写入必须排在冻结之前（见下一条提交加上 Object.freeze 后，
    // 顺序就承重了——冻结之后再写，严格模式下直接抛 TypeError）。
    const activeChapter = engine.chapterIndexOf(cursor)
    const current = novel.chapters[activeChapter]
    if (current) chapterPos[activeChapter] = cursor - current.start

    engine._state = freezeState({
      cursor,
      revealStart,
      chapterPos,
      activeChapter,
      ratio: clampRatio(s.ratio),
      mode: s.mode === 'key' ? 'key' : 'ime',
      // Number.isFinite 挡的是 NaN / Infinity。JSON.parse 产不出这两个值，
      // 所以这条【不算】对「磁盘数据畸形」的防护，只是把类型收窄到 number | null。
      startedAt: typeof s.startedAt === 'number' && Number.isFinite(s.startedAt) ? s.startedAt : null
    })
    return engine
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/unit/engine.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 跑全量单测 + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 全绿，exit 0。

- [ ] **Step 6: Commit**

```bash
git add <本任务改动的显式路径…>   # 不要用 -A：见文件头「git add -A 只在独占一棵工作树时安全」
cat > /tmp/wt-commit-msg.txt <<'EOF'
feat(core): TypingEngine 游标状态机（pump/backspace/jumpToChapter + 回填）
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## Task 5: 小说加载、会话存储与启动参数

**Files:**
- Create: `src/main/loadNovel.ts`, `src/main/sessionStore.ts`, `src/main/startup.ts`
- Test: `tests/unit/sessionStore.test.ts`, `tests/unit/startup.test.ts`, `tests/unit/loadNovel.test.ts`, `tests/unit/guardA.test.ts`, `tests/unit/guardB.test.ts`（后两条为评审补入，见 Step 10.5）

**Interfaces:**
- Consumes: `decodeBuffer`（Task 2）、`splitChapters`（Task 3）、`Novel` / `PersistedSession` / `NovelCacheMeta`
- Produces:
  - `loadNovelFromFile(filePath: string): Novel`
  - `createSessionStore(baseDir: string)` → `{ readSession, writeSession, clearAll, writeNovelCache, readNovelCache }`
  - `applyUserDataOverride(env: Record<string, string | undefined>, setPath: (name: string, path: string) => void): boolean`
  - `resolveInitialNovelPath(argv: string[], isFile: (p: string) => boolean): string | null`
    （谓词回答的是「**是不是普通文件**」而不是「存在不存在」：名叫 `xxx.txt` 的目录必须被拒绝，
    见 §13 与 Task 6 里 `isRegularFile` 的写法）

**关键设计**：`sessionStore.ts` 是**纯函数模块**，接受 `baseDir` 参数，不 import `electron`，因此可以在 Vitest 里用 `mkdtemp` 直接测。Electron 绑定放在 Task 6 的 `session.ts`。

- [ ] **Step 1: 写失败测试 `tests/unit/sessionStore.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  utimesSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore } from '../../src/main/sessionStore'
import { resolveShortcuts } from '../../src/core/shortcuts'
import { DEFAULT_RATIO, defaultSettings } from '../../src/core/types'
import type { AppSettings, Novel, PersistedSession } from '../../src/core/types'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-store-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    novelTitle: '测试书',
    sourcePath: '/tmp/测试书.txt',
    ratio: 10,
    mode: 'ime',
    cursor: 120,
    revealStart: 0,
    chapterPos: [120, 0],
    activeChapter: 0,
    startedAt: null,
    ...overrides
  }
}

/** `makeSession()` 默认那本书的路径——多数「那一份会话文件」的用例说的都是它。 */
const SRC = '/tmp/测试书.txt'

/**
 * 会话文件在磁盘上的位置。
 *
 * 【为什么测试自己算一遍 sha256 而不是从实现里 import】判据要独立：把实现里的算法换掉
 * （比如换成 base64），这些用例必须跟着红，而不是跟着实现一起漂。仓库里已有的会话路径
 * 断言（clearReadingHistory 那条）也是这个姿势。
 */
function sessionFile(dir: string, sourcePath: string): string {
  const key = createHash('sha256').update(sourcePath, 'utf8').digest('hex').slice(0, 32)
  return join(dir, 'sessions', `${key}.json`)
}

// 这两个辅助函数放在模块级而不是第二个 describe 里：clearReadingHistory 那条用例也要用它
// （此前它一个缓存都没写，于是它的两条 novel-cache 断言在测「两个从未创建的文件的缺失」）。
function writeSource(content: string): string {
  const p = join(dir, 'src.txt')
  writeFileSync(p, content, 'utf8')
  return p
}

function makeNovel(sourcePath: string): Novel {
  return {
    title: 'src',
    sourcePath,
    encoding: 'UTF-8',
    hadBom: false,
    flatText: '第一章 甲\n正文。\n',
    chapters: [{ index: 0, title: '第一章 甲', start: 0, end: 10, charCount: 10 }]
  }
}

describe('sessionStore 会话读写', () => {
  it('两本书各存一份，互不覆盖', () => {
    const store = createSessionStore(dir)
    const a = makeSession({ sourcePath: '/tmp/A.txt', cursor: 100 })
    const b = makeSession({ sourcePath: '/tmp/B.txt', cursor: 200 })
    store.writeSession(a)
    store.writeSession(b)
    expect(store.readSession('/tmp/A.txt')).toEqual(a)
    expect(store.readSession('/tmp/B.txt')).toEqual(b)
  })

  it('读取路径上的书从未存过时返回 null', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession({ sourcePath: '/tmp/A.txt' }))
    expect(store.readSession('/tmp/B.txt')).toBeNull()
  })

  // 文件名是 sourcePath 的哈希，所以「文件里的 sourcePath 与请求的不是同一本」只有手工改
  // 文件名或哈希撞车才造得出来。但一旦发生，后果是把 B 书的进度套到 A 书上——章节目录与
  // 光标一起错位，而 fromSession 对错位的 chapterPos 不抛错，只会表现成「进度莫名其妙不对」。
  it('文件内容里的 sourcePath 与请求的书对不上时按无记录处理', () => {
    const store = createSessionStore(dir)
    const a = makeSession({ sourcePath: '/tmp/A.txt', cursor: 100 })
    store.writeSession(a)
    // 把 A 那份的内容冒充成 B 的：文件名按 B 的哈希、内容仍是 A 的
    writeFileSync(sessionFile(dir, '/tmp/B.txt'), JSON.stringify(a), 'utf8')

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(store.readSession('/tmp/B.txt')).toBeNull()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain('不是同一本')
    } finally {
      spy.mockRestore()
    }
    // 前提：A 自己那份仍在、且仍读得回来——证明上面那次 null 是被 sourcePath 那道门拦下的，
    // 而不是这两本书本来就都没有记录（少了这行，一个「readSession 永远返回 null」的实现
    // 也能让上面两条断言全绿）
    expect(store.readSession('/tmp/A.txt')).toEqual(a)
  })

  it('未写过时 readSession 返回 null', () => {
    const store = createSessionStore(dir)
    expect(store.readSession(SRC)).toBeNull()
  })

  it('写入后能读回同样的内容', () => {
    const store = createSessionStore(dir)
    const s = makeSession()
    store.writeSession(s)
    expect(store.readSession(SRC)).toEqual(s)
    expect(existsSync(sessionFile(dir, SRC))).toBe(true)
  })

  // 持久化失败的守卫：失败必须留下痕迹，而不是「应用看着健康、其实什么都没存」。
  // 断言的是「报出来了、而且带着原错误」——那正是这条修复的全部内容。
  // 让 baseDir 指向一个【文件】：mkdirSync 必然 EEXIST，写入必然失败，且失败原因
  // 与文本内容、平台时序都无关（实测在 jsdom 下 spy 能正常拦到，且只调用一次）。
  it('写入失败会带着原错误 console.warn 出来，而不是静默吞掉', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const notADir = join(dir, '不是一个目录')
      writeFileSync(notADir, 'x', 'utf8')
      const store = createSessionStore(notADir)
      store.writeSession(makeSession())
      // 前提：这次写入确实失败了——否则「报了 warn」可能来自别处
      expect(existsSync(sessionFile(notADir, SRC))).toBe(false)

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][1]).toBeInstanceOf(Error)
    } finally {
      spy.mockRestore()
    }
  })

  it('会话文件损坏时返回 null 而不抛异常', () => {
    const store = createSessionStore(dir)
    mkdirSync(join(dir, 'sessions'), { recursive: true })
    writeFileSync(sessionFile(dir, SRC), '{ 这不是 JSON', 'utf8')
    expect(store.readSession(SRC)).toBeNull()
  })

  // 与上一条（`{ 这不是 JSON`，连 JSON.parse 都过不去）走的是不同代码路径：这一组是
  // 【合法 JSON】但字段不合规——只挡解析错误的实现会把它当成一份会话交给
  // TypingEngine.fromSession（实测不抛错，只会伪装成一次「进度回到开头」的恢复）。
  //
  // 【为什么是一张表而不是一份残缺记录】原先只有一条「只留 novelTitle/sourcePath」的用例，
  // 它只能证明「有校验」，证明不了任何**单条**字段检查在不在：实测把七条检查里任意一条删掉，
  // 整套 16 条仍全绿。现在一个字段一份残缺记录、各占一条用例，并且每条都断言警告里
  // **点出了那个字段**——于是「校验存在」被拆成「每条腿都在，而且报得出名字」。
  // 多字段缺失那种情形被「mode 缺失」这条覆盖（前面几条都会先通过，最后卡在 mode 上）。
  // 【令牌必须写成完整短语，不能只写字段名】这条规则是【逐腿清扫】发现的，不是写表时想到的：
  // 第一版令牌用的是字段名（'chapters'），而删掉「chapters 是不是数组」那条检查后，消息变成
  // 'chapters[0] 不是对象'——**同样含 'chapters'**，于是那条用例照样通过，那条腿等于没有被
  // 观测到。同一形状还有 'chapters[0]' 被 'chapters[0].title 不是字符串' 满足。
  // 断言活着，只是它测的不是它声称的东西——与「断言的两个操作数同源」是同一类错误。
  //
  // 【而且：这张表建成之后，仍不足以说明每条腿被观测到了】第一版表建成后做逐腿清扫，
  // 仍有 4 条腿不可见（原因是令牌太松，不是缺用例）。所以「一个字段一条用例」是**必要而非
  // 充分**；判据是**逐条删掉检查、要求至少有一条用例变红**——本任务扫了 25 条腿，最终 0 条
  // 不可见。请在写完表之后仍然跑一遍清扫，别跳过：这 4 条正是只在第二步才会露出来的。
  const CRIPPLED: Array<{
    name: string
    token: string
    build: (s: PersistedSession) => unknown
  }> = [
    { name: 'novelTitle 不是字符串', token: 'novelTitle 不是字符串', build: (s) => ({ ...s, novelTitle: 42 }) },
    { name: 'sourcePath 不是字符串', token: 'sourcePath 不是字符串', build: (s) => ({ ...s, sourcePath: null }) },
    { name: 'mode 不是 ime/key', token: 'mode 既不是 ime 也不是 key', build: (s) => ({ ...s, mode: 'garbage' }) },
    {
      name: 'mode 整个缺失',
      token: 'mode',
      build: (s) => {
        const copy: Record<string, unknown> = { ...s }
        delete copy.mode
        return copy
      }
    },
    { name: 'chapterPos 不是数组', token: 'chapterPos 不是数组', build: (s) => ({ ...s, chapterPos: '0,1' }) },
    {
      name: 'chapterPos 含非数字项',
      token: 'chapterPos 含非数字项',
      build: (s) => ({ ...s, chapterPos: [1, '2'] })
    },
    {
      name: 'startedAt 既不是 null 也不是数字',
      token: 'startedAt 既不是 null 也不是数字',
      build: (s) => ({ ...s, startedAt: 'now' })
    },
    { name: 'ratio 不是数字', token: 'ratio 不是有限数字', build: (s) => ({ ...s, ratio: '10' }) },
    { name: 'cursor 不是数字', token: 'cursor 不是有限数字', build: (s) => ({ ...s, cursor: null }) },
    { name: 'revealStart 不是数字', token: 'revealStart 不是有限数字', build: (s) => ({ ...s, revealStart: {} }) },
    {
      name: 'activeChapter 不是数字',
      token: 'activeChapter 不是有限数字',
      build: (s) => ({ ...s, activeChapter: '0' })
    },
    // 注意不能拿数组当这一条的输入：`typeof [] === 'object'`，数组会通过「是不是对象」
    // 那一关、最后卡在 novelTitle 上（实测：断言 token 会红）。JSON 的 null 与裸数字才
    // 真的走到那条 return。
    { name: '记录是 null', token: '不是一个对象', build: () => null },
    { name: '记录是裸数字', token: '不是一个对象', build: () => 42 }
  ]

  it.each(CRIPPLED)('$name → 按无记录处理，且警告点出该字段', ({ build, token }) => {
    const store = createSessionStore(dir)
    const crippled = build(makeSession())
    mkdirSync(join(dir, 'sessions'), { recursive: true })
    writeFileSync(sessionFile(dir, SRC), JSON.stringify(crippled), 'utf8')
    // 前提一：写下去的确实是合法 JSON——否则本用例只是在重复「损坏时返回 null」那一条
    expect(() => JSON.parse(readFileSync(sessionFile(dir, SRC), 'utf8'))).not.toThrow()
    // 前提二：这份记录与一份完好的记录确实不同——否则它什么都没坏，用例是空跑
    expect(JSON.stringify(crippled)).not.toBe(JSON.stringify(makeSession()))

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(store.readSession(SRC)).toBeNull()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain(token)
    } finally {
      spy.mockRestore()
    }
  })

  it('clearReadingHistory 清掉所有书的进度与缓存，留下设置', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession({ sourcePath: '/tmp/A.txt' }))
    store.writeSession(makeSession({ sourcePath: '/tmp/B.txt' }))
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src))
    store.writeSettings({
      docTitle: '季度汇报',
      themeSource: 'dark',
      darkPaper: true,
      lastSourcePath: '/tmp/A.txt',
      ratio: 10,
      // shortcuts 是后加的必填字段；这里给空表，本用例要钉的是「清除记录不动设置」
      shortcuts: {}
    })
    // 前提：这些东西确实落盘了。少了这几行，下面的断言测的是「几个从未被创建过的文件
    // 不存在」——无论 clearReadingHistory 做什么都会通过。
    expect(existsSync(sessionFile(dir, '/tmp/A.txt'))).toBe(true)
    expect(existsSync(sessionFile(dir, '/tmp/B.txt'))).toBe(true)
    expect(existsSync(join(dir, 'novel-cache.json'))).toBe(true)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(true)
    expect(existsSync(join(dir, 'settings.json'))).toBe(true)
    // 旧版留下的单槽会话文件（没有 Task 5 的迁移时它就在那儿）：「清除阅读记录」应当把它清掉。
    writeFileSync(join(dir, 'session.json'), '{"novelTitle":"旧版残留', 'utf8')
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
    // 模拟崩溃留在磁盘上的临时文件（写了一半就死掉的那份）：「清除阅读记录」应当把它一起清掉。
    // 少了下面这一行，删除列表里 `${legacySessionPath}.tmp` 那一项就是**没有任何用例观测**的——
    // 把它删掉不会有断言变红。
    writeFileSync(join(dir, 'session.json.tmp'), '{"novelTitle":"半', 'utf8')
    expect(existsSync(join(dir, 'session.json.tmp'))).toBe(true)

    store.clearReadingHistory()

    // **两本书各一份**：清除要一次清干净，不是只清「最近那本」
    expect(store.readSession('/tmp/A.txt')).toBeNull()
    expect(store.readSession('/tmp/B.txt')).toBeNull()
    expect(existsSync(join(dir, 'sessions'))).toBe(false)
    expect(existsSync(join(dir, 'novel-cache.json'))).toBe(false)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(false)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
    expect(existsSync(join(dir, 'session.json.tmp'))).toBe(false)
    // 设置不在此列：它是用户的偏好，与「读到哪」无关
    expect(store.readSettings()).toEqual({
      docTitle: '季度汇报',
      themeSource: 'dark',
      darkPaper: true,
      lastSourcePath: '/tmp/A.txt',
      ratio: 10,
      shortcuts: {}
    })
  })

  it('clearReadingHistory 在文件不存在时不抛异常', () => {
    const store = createSessionStore(dir)
    expect(() => store.clearReadingHistory()).not.toThrow()
  })
})

describe('sessionStore 小说缓存', () => {
  it('写缓存后能读回等价的 Novel', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    const novel = makeNovel(src)
    store.writeNovelCache(novel)

    const got = store.readNovelCache(src)
    expect(got).not.toBeNull()
    expect(got!.flatText).toBe(novel.flatText)
    expect(got!.chapters).toEqual(novel.chapters)
    expect(got!.encoding).toBe('UTF-8')
  })

  it('原文件被改动（mtime/size 变化）时缓存失效', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src))

    writeFileSync(src, '完全不同的内容，长度也不同。\n', 'utf8')
    expect(store.readNovelCache(src)).toBeNull()
  })

  // 上面那条同时改动了 mtime 与 size，所以它只证明「两条腿中的至少一条在起作用」。
  // 下面两条各自只动一条腿，把 `mtimeMs !== meta.mtimeMs || size !== meta.size` 的
  // 两个分支分别钉住——把 || 错写成 &&，只有它们会红。
  //
  // 整数秒的 mtime 是关键：实测 utimesSync(p, S, S) 之后 statSync(p).mtimeMs 恰好是
  // S * 1000，逐位可还原。不然「只动了 mtime」和「mtime 与记录一致」这两个前提
  // 都只能靠写入时序去赌，测出来的东西就不确定了。
  const MTIME_A = 1_700_000_000
  const MTIME_B = 1_700_000_001

  it('源文件只被 touch（内容与大小不变）时缓存失效', () => {
    const store = createSessionStore(dir)
    const src = join(dir, 'src.txt')
    writeFileSync(src, '第一章 甲\n正文。\n', 'utf8')
    utimesSync(src, MTIME_A, MTIME_A)
    store.writeNovelCache(makeNovel(src))

    const before = statSync(src)
    utimesSync(src, MTIME_B, MTIME_B)
    const after = statSync(src)
    // 前提：只动了 mtime，大小没变——否则这条用例测的不是 mtime 那条腿
    expect(before.mtimeMs).toBe(MTIME_A * 1000)
    expect(after.mtimeMs).toBe(MTIME_B * 1000)
    expect(after.size).toBe(before.size)

    expect(store.readNovelCache(src)).toBeNull()
  })

  it('源文件改成不同长度的内容、且 mtime 被逐位还原时缓存失效', () => {
    const store = createSessionStore(dir)
    const src = join(dir, 'src.txt')
    writeFileSync(src, '第一章 甲\n正文。\n', 'utf8')
    utimesSync(src, MTIME_A, MTIME_A)
    store.writeNovelCache(makeNovel(src))

    writeFileSync(src, '完全不同的内容，长度也不同。\n', 'utf8')
    utimesSync(src, MTIME_A, MTIME_A) // 把 mtime 拨回与 meta 记录一致
    const st = statSync(src)
    const meta = JSON.parse(readFileSync(join(dir, 'novel-cache.json'), 'utf8'))
    // 前提：mtime 与记录逐位相同、大小不同——即只剩 size 那条腿能拦下它
    expect(st.mtimeMs).toBe(meta.mtimeMs)
    expect(st.size).not.toBe(meta.size)

    expect(store.readNovelCache(src)).toBeNull()
  })

  it('sourcePath 不匹配时缓存失效', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src))
    expect(store.readNovelCache(join(dir, '另一个文件.txt'))).toBeNull()
  })

  it('原文件被删除时 readNovelCache 返回 null 而不抛异常', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src))
    rmSync(src)
    expect(store.readNovelCache(src)).toBeNull()
  })

  it('缓存文件缺失时返回 null', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    expect(store.readNovelCache(src)).toBeNull()
  })

  // 与 readSession 的字段校验同源：合法 JSON、但形状不对的 meta 原先会被断言成
  // NovelCacheMeta 并当作【命中】返回。这不是理论问题——实测在修复前，meta 只写
  // sourcePath/mtimeMs/size/textBytes 时返回的对象里 chapters/title/encoding/hadBom
  // 全是 undefined，而 flatText 是对的，于是 Task 6 的 `if (cached) return cached`
  // 会把它当小说交给渲染进程，chapters.length 当场抛错。
  // 与 readSession 那张表同源：isNovelCacheMeta 的每一条字段检查原先也【各自不可见】——
  // 删掉任意一条，整套仍是全绿（这一条是补完会话那张表之后发现的：新写的校验器落进了
  // 同一个形状）。一个字段一份残缺 meta，各占一条用例，并断言警告点出该字段。
  function validMeta(src: string, text: string): Record<string, unknown> {
    const st = statSync(src)
    return {
      sourcePath: src,
      mtimeMs: st.mtimeMs,
      size: st.size,
      encoding: 'UTF-8',
      hadBom: false,
      title: 'src',
      chapters: [{ index: 0, title: '第一章 甲', start: 0, end: 10, charCount: 10 }],
      textBytes: Buffer.byteLength(text, 'utf8')
    }
  }

  const BAD_METAS: Array<{ name: string; token: string; mangle: (m: Record<string, unknown>) => unknown }> =
    [
      { name: 'sourcePath 不是字符串', token: 'sourcePath 不是字符串', mangle: (m) => ({ ...m, sourcePath: 7 }) },
      { name: 'title 不是字符串', token: 'title 不是字符串', mangle: (m) => ({ ...m, title: null }) },
      { name: 'encoding 不是字符串', token: 'encoding 不是字符串', mangle: (m) => ({ ...m, encoding: 9 }) },
      { name: 'hadBom 不是布尔值', token: 'hadBom 不是布尔值', mangle: (m) => ({ ...m, hadBom: 'no' }) },
      { name: 'mtimeMs 不是数字', token: 'mtimeMs 不是有限数字', mangle: (m) => ({ ...m, mtimeMs: '1' }) },
      { name: 'size 不是数字', token: 'size 不是有限数字', mangle: (m) => ({ ...m, size: null }) },
      { name: 'textBytes 不是数字', token: 'textBytes 不是有限数字', mangle: (m) => ({ ...m, textBytes: {} }) },
      { name: 'chapters 不是数组', token: 'chapters 不是数组', mangle: (m) => ({ ...m, chapters: 'none' }) },
      {
        name: 'chapters[0] 不是对象',
        token: 'chapters[0] 不是对象',
        mangle: (m) => ({ ...m, chapters: ['第一章'] })
      },
      {
        name: 'chapters[0].title 不是字符串',
        token: 'chapters[0].title',
        mangle: (m) => ({ ...m, chapters: [{ ...(m.chapters as object[])[0], title: 1 }] })
      },
      {
        name: 'chapters[0].index 不是数字',
        token: 'chapters[0].index',
        mangle: (m) => ({ ...m, chapters: [{ ...(m.chapters as object[])[0], index: '0' }] })
      },
      {
        name: 'chapters[0].start 不是数字',
        token: 'chapters[0].start',
        mangle: (m) => ({ ...m, chapters: [{ ...(m.chapters as object[])[0], start: '0' }] })
      },
      {
        name: 'chapters[0].end 不是数字',
        token: 'chapters[0].end',
        mangle: (m) => ({ ...m, chapters: [{ ...(m.chapters as object[])[0], end: null }] })
      },
      {
        name: 'chapters[0].charCount 不是数字',
        token: 'chapters[0].charCount',
        mangle: (m) => ({ ...m, chapters: [{ ...(m.chapters as object[])[0], charCount: {} }] })
      }
    ]

  it.each(BAD_METAS)('meta 的 $name → 按未命中处理，且警告点出该字段', ({ mangle, token }) => {
    const store = createSessionStore(dir)
    const src = join(dir, 'src.txt')
    const text = '第一章 甲\n正文。\n'
    writeFileSync(src, text, 'utf8')
    writeFileSync(join(dir, 'novel-cache.txt'), text, 'utf8')
    const good = validMeta(src, text)
    const bad = mangle(good)
    writeFileSync(join(dir, 'novel-cache.json'), JSON.stringify(bad), 'utf8')

    // 前提一：写下去的确实是合法 JSON（否则只是在重复「元数据缺失/损坏」那几条）
    expect(() => JSON.parse(readFileSync(join(dir, 'novel-cache.json'), 'utf8'))).not.toThrow()
    // 前提二：完好的那份 meta 在【其余三道门】上确实自洽——把 good 写进去必须命中。
    // 少了这一步，这条用例证明不了「是被改坏的那个键拦下的」，也可能是这对文件本来就不算数。
    writeFileSync(join(dir, 'novel-cache.json'), JSON.stringify(good), 'utf8')
    expect(store.readNovelCache(src)).not.toBeNull()
    // 前提三：坏的那份与好的只差一个键（键数相同 ⇒ 是改坏而非删掉）
    expect(JSON.stringify(bad)).not.toBe(JSON.stringify(good))
    expect(Object.keys(bad as object).length).toBe(Object.keys(good).length)
    writeFileSync(join(dir, 'novel-cache.json'), JSON.stringify(bad), 'utf8')

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(store.readNovelCache(src)).toBeNull()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain(token)
    } finally {
      spy.mockRestore()
    }
  })

  it('meta 是合法 JSON 但形状不对时按未命中处理', () => {
    const store = createSessionStore(dir)
    const src = join(dir, 'src.txt')
    const text = '第一章 甲\n正文。\n'
    writeFileSync(src, text, 'utf8')
    const st = statSync(src)
    writeFileSync(join(dir, 'novel-cache.txt'), text, 'utf8')

    const partial = {
      sourcePath: src,
      mtimeMs: st.mtimeMs,
      size: st.size,
      textBytes: Buffer.byteLength(text, 'utf8')
    }
    writeFileSync(join(dir, 'novel-cache.json'), JSON.stringify(partial), 'utf8')

    // 前提：这一对在【其余三道门】上完全自洽——路径、源文件 stat、提交点全部通过，
    // 所以唯一能拦下它的就是形状校验；否则本用例会退化成「它因别的原因被拒」。
    expect(partial.sourcePath).toBe(src)
    expect(statSync(src).mtimeMs).toBe(partial.mtimeMs)
    expect(statSync(src).size).toBe(partial.size)
    expect(statSync(join(dir, 'novel-cache.txt')).size).toBe(partial.textBytes)
    expect(() => JSON.parse(readFileSync(join(dir, 'novel-cache.json'), 'utf8'))).not.toThrow()

    expect(store.readNovelCache(src)).toBeNull()
  })

  // 崩溃残留：进程死在「写完 novel-cache.txt、还没写 novel-cache.json」之间。
  // 磁盘上留下的是 A 书的 meta 配另一本书的正文，而 meta 记的
  // sourcePath / mtimeMs / size 全都是 A 书自己的、三项自洽，所以只有让 meta
  // 能自我校验（textBytes）才拦得住。少了那一项就会把 A 书的章节目录配 B 书的正文交给用户。
  it('崩溃残留的错配缓存对被拒绝（meta 与 text 不是同一次写入）', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    const novel = makeNovel(src)
    store.writeNovelCache(novel)

    // 只有 txt 被换成了另一本书的正文，meta 保持 A 书那份
    const tampered = '第二章 乙\n完全不同的正文内容。\n'
    writeFileSync(join(dir, 'novel-cache.txt'), tampered, 'utf8')

    const meta = JSON.parse(readFileSync(join(dir, 'novel-cache.json'), 'utf8'))
    // 前提：meta 记的确实还是原来那份文本，且两份文本的长度确实不同——
    // 否则本用例会在「长度恰好相等」或「meta 也被改了」的情况下虚假通过
    expect(meta.textBytes).toBe(Buffer.byteLength(novel.flatText, 'utf8'))
    expect(Buffer.byteLength(tampered, 'utf8')).not.toBe(meta.textBytes)
    expect(meta.sourcePath).toBe(src)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(true)

    expect(store.readNovelCache(src)).toBeNull()
  })
})

describe('sessionStore 设置读写', () => {
  it('未写过时 readSettings 返回默认值', () => {
    const store = createSessionStore(dir)
    expect(store.readSettings()).toEqual(defaultSettings())
    expect(existsSync(join(dir, 'settings.json'))).toBe(false)
  })

  it('写入后能读回同样的内容', () => {
    const store = createSessionStore(dir)
    const s: AppSettings = {
      docTitle: '季度汇报',
      themeSource: 'dark',
      darkPaper: true,
      lastSourcePath: '/tmp/测试书.txt',
      ratio: 10,
      shortcuts: {}
    }
    store.writeSettings(s)
    expect(store.readSettings()).toEqual(s)
    expect(existsSync(join(dir, 'settings.json'))).toBe(true)
  })

  // 与 readSession 那两张表同一套姿势：合法 JSON、但形状不对的设置**不能**被当成设置用。
  // 设置项全是可再生的（坏了就回默认值），所以这里没有「进度不能丢」那种压力；
  // 但「哪个字段坏了」仍要报出来——静默回默认会让「我改的文档名怎么没了」无从查起。
  const BAD_SETTINGS: Array<{ name: string; token: string; mangle: (s: AppSettings) => unknown }> = [
    { name: 'docTitle 不是字符串', token: 'docTitle 不是字符串', mangle: (s) => ({ ...s, docTitle: 7 }) },
    {
      name: 'themeSource 不是取值之一',
      token: 'themeSource 不是 system/light/dark',
      mangle: (s) => ({ ...s, themeSource: 'sepia' })
    },
    { name: 'darkPaper 不是布尔值', token: 'darkPaper 不是布尔值', mangle: (s) => ({ ...s, darkPaper: 'yes' }) },
    {
      name: 'lastSourcePath 既不是 null 也不是字符串',
      token: 'lastSourcePath 既不是 null 也不是字符串',
      mangle: (s) => ({ ...s, lastSourcePath: 42 })
    },
    { name: 'ratio 不是有限数字', token: 'ratio 不是有限数字', mangle: (s) => ({ ...s, ratio: '10' }) },
    { name: '记录是 null', token: '不是一个对象', mangle: () => null },
    { name: '记录是裸数字', token: '不是一个对象', mangle: () => 42 }
  ]

  it.each(BAD_SETTINGS)('设置里的 $name → 按默认值处理，且警告点出该字段', ({ mangle, token }) => {
    const store = createSessionStore(dir)
    const good: AppSettings = {
      docTitle: '季度汇报',
      themeSource: 'dark',
      darkPaper: true,
      lastSourcePath: null,
      ratio: 10,
      shortcuts: {}
    }
    const bad = mangle(good)
    // 前提三：完好的那份确实被接受——否则「坏的被拒」可能只是因为它本来就过不了。
    // 这一条同时钉住 lastSourcePath 允许 null：默认值与「清除阅读记录」之后写回的都是 null，
    // 而那两处若被误判成非法，症状是这个字段连着的四项设置一起回默认值。
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(good), 'utf8')
    expect(store.readSettings()).toEqual(good)
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(bad), 'utf8')
    // 前提一：写下去的确实是合法 JSON——否则本用例只是在重复「损坏文件」那一条
    expect(() => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).not.toThrow()
    // 前提二：坏的那份与好的确实不同——否则它什么都没坏，用例是空跑
    expect(JSON.stringify(bad)).not.toBe(JSON.stringify(good))

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(store.readSettings()).toEqual(defaultSettings())
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain(token)
    } finally {
      spy.mockRestore()
    }
  })

  // 【旧版记录里没有 ratio】它是后加的字段。若按必填校验，升级一次就会把用户改过的
  // 文档名 / 外观 / 纸张一起退回默认值——「缺字段」是旧版本，「写错」才是坏文件，
  // 这两件事必须分开：前者补上默认值，后者整份退回（上面那张表管的正是后者）。
  it('旧版没有 ratio 的 settings.json 仍被接受，并补上默认值', () => {
    const store = createSessionStore(dir)
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        docTitle: '季度汇报',
        themeSource: 'dark',
        darkPaper: true,
        lastSourcePath: '/tmp/A.txt'
      }),
      'utf8'
    )
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(store.readSettings()).toEqual({
        docTitle: '季度汇报',
        themeSource: 'dark',
        darkPaper: true,
        lastSourcePath: '/tmp/A.txt',
        ratio: DEFAULT_RATIO,
        // 与 ratio 同为「旧文件里没有、读时补上」的字段
        shortcuts: {}
      })
      // 补默认值这条正常路径不该报 warn（一条在正常路径上也会响的告警等于没有告警）
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('settings.json 不是合法 JSON 时返回默认值而不抛异常', () => {
    const store = createSessionStore(dir)
    writeFileSync(join(dir, 'settings.json'), '{ 这不是 JSON', 'utf8')
    expect(store.readSettings()).toEqual(defaultSettings())
  })

  // 与 writeSession 那条同形：失败必须留下痕迹，而不是「应用看着健康、其实设置没存」。
  it('设置写入失败会带着原错误 console.warn 出来', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const notADir = join(dir, '不是一个目录')
      writeFileSync(notADir, 'x', 'utf8')
      const store = createSessionStore(notADir)
      store.writeSettings(defaultSettings())
      expect(existsSync(join(notADir, 'settings.json'))).toBe(false)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][1]).toBeInstanceOf(Error)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('旧版单槽会话的迁移', () => {
  it('合法的旧会话被搬进 sessions/ 并补上 lastSourcePath，旧文件删除', () => {
    const store = createSessionStore(dir)
    const legacy = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 77 })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(legacy), 'utf8')
    // 旧版写会话用的是 temp+rename，进程死在中间会留下这个半截文件。迁移要把它一起清掉，
    // 否则「清除阅读记录」之外的路径永远碰不到它——而它正是 clearReadingHistory 列表里
    // 那一项想清的东西（那一项由 Task 4 的另一条用例钉住，这里管的是迁移这一句）。
    writeFileSync(join(dir, 'session.json.tmp'), '{"novelTitle":"半', 'utf8')
    expect(existsSync(join(dir, 'session.json.tmp'))).toBe(true)

    store.migrateLegacySession()

    expect(store.readSession('/tmp/旧书.txt')).toEqual(legacy)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
    expect(existsSync(join(dir, 'session.json.tmp'))).toBe(false)
    // 旧版没有 settings.json，「上次打开的是哪本」原先只写在会话里；不补这一步，
    // 升级后的第一次启动会停在空状态——进度在，但没人去开那本书。
    expect(store.readSettings().lastSourcePath).toBe('/tmp/旧书.txt')
  })

  it('重复调用是幂等的（旧文件已删，第二次什么都不做）', () => {
    const store = createSessionStore(dir)
    writeFileSync(join(dir, 'session.json'), JSON.stringify(makeSession({ cursor: 5 })), 'utf8')
    store.migrateLegacySession()
    const after = store.readSession(SRC)
    // 前提：第一次迁移**确实搬了东西**——少了这行，一个空实现也能让这条用例全绿
    // （after 为 null 时 toEqual(null) 成立，而 not.toHaveBeenCalled() 对空实现同样成立）
    expect(after).not.toBeNull()

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.migrateLegacySession()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
    expect(store.readSession(SRC)).toEqual(after)
  })

  it('没有旧文件时什么都不做', () => {
    const store = createSessionStore(dir)
    expect(() => store.migrateLegacySession()).not.toThrow()
    expect(existsSync(join(dir, 'sessions'))).toBe(false)
  })

  // 这里与「读会话」那条路径的处置**刻意不同**：读会话时坏记录按无记录处理即可（文件还在），
  // 而迁移要先删掉旧文件——删是不可逆的。所以判不了的东西一律不删，只报出来。
  it('结构不合法的旧会话不迁移、也不删除，并警告', () => {
    const store = createSessionStore(dir)
    writeFileSync(join(dir, 'session.json'), JSON.stringify({ novelTitle: '只有书名' }), 'utf8')
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.migrateLegacySession()
      expect(String(spy.mock.calls[0][0])).toContain('未迁移')
    } finally {
      spy.mockRestore()
    }
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
  })

  it('旧会话文件不是合法 JSON 时不迁移、也不删除，并警告', () => {
    const store = createSessionStore(dir)
    writeFileSync(join(dir, 'session.json'), '{ 这不是 JSON', 'utf8')
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.migrateLegacySession()
      expect(String(spy.mock.calls[0][0])).toContain('未迁移')
    } finally {
      spy.mockRestore()
    }
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
  })

  it('新版已有同一本书的进度时不覆盖它', () => {
    const store = createSessionStore(dir)
    const legacy = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 1 })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(legacy), 'utf8')
    const fresh = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 999 })
    store.writeSession(fresh)

    store.migrateLegacySession()

    // 新版那份是更新的——旧文件只是上一代格式的残留，不该倒回去
    expect(store.readSession('/tmp/旧书.txt')).toEqual(fresh)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
  })

  // 【判据为什么是「读得出来」而不是「有个文件在那儿」】一个存在但**读不出来**的 target
  // （写了一半就崩掉的那种）如果被当成「已经迁过了」，迁移就会跳过写、然后把旧文件删掉——
  // 用一个读不出来的残留压掉一份完好的旧记录。这条用例把那个 target 真的造成那样。
  it('新位置那份读不出来时，迁移仍然把旧记录写进去', () => {
    const store = createSessionStore(dir)
    const legacy = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 88 })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(legacy), 'utf8')
    mkdirSync(join(dir, 'sessions'), { recursive: true })
    writeFileSync(sessionFile(dir, '/tmp/旧书.txt'), '{"novelTitle":"半', 'utf8')

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.migrateLegacySession()
    } finally {
      spy.mockRestore()
    }

    // 旧记录被搬了过去（而不是被那份坏残留挡住）
    expect(store.readSession('/tmp/旧书.txt')).toEqual(legacy)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
  })

  // 【「上次打开的是哪本」那一半的短路】settings 里已经记着**另一本**书时，不去覆盖它：
  // 它已经有值就意味着设置这一半不需要迁移来补（旧版根本没有 settings.json，所以「已记着
  // 别的书」只可能是新版已经跑过、或用户在新版里开过别的书）。会话那一半照旧搬、旧文件
  // 照旧删——迁移负责的是「进度别丢」，不是「把 lastSourcePath 改成这本」。
  it('settings 已经记着另一本书时，不把它顶掉', () => {
    const store = createSessionStore(dir)
    const legacy = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 33 })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(legacy), 'utf8')
    store.writeSettings({
      docTitle: '季度汇报',
      themeSource: 'dark',
      darkPaper: true,
      lastSourcePath: '/tmp/另一本.txt',
      ratio: 10,
      shortcuts: {}
    })

    store.migrateLegacySession()

    expect(store.readSettings().lastSourcePath).toBe('/tmp/另一本.txt')
    expect(store.readSession('/tmp/旧书.txt')).toEqual(legacy)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
  })

  // 【本任务唯一会毁数据的地方，所以单独一条】写不进新版位置时，旧文件是用户进度唯一的
  // 副本，绝不能删。触发条件很现实：磁盘满（写要空间、rm 不要），或 sessions 被一个同名
  // 文件占住（mkdir 抛、rm 照旧成功）。删掉的后果是进度不可恢复，而且下一次启动的 600ms
  // 自动保存会用 cursor=0 覆盖现场——用户看到的是「升级之后进度莫名其妙归零」。
  //
  // 造法：把 `sessions` 做成一个**文件**，于是 writeSessionFile 的 mkdirSync 必然
  // EEXIST。（不用 mock node:fs，与 guardA 那条注入式守卫分工不同：那条测写入中途被杀，
  // 这条测「写根本没成功时调用方有没有守住」。）
  it('迁移时写不进 sessions/ 就不删旧文件', () => {
    const store = createSessionStore(dir)
    const legacy = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 77 })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(legacy), 'utf8')
    writeFileSync(join(dir, 'sessions'), 'x', 'utf8') // 占位：让 sessions 目录建不出来

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.migrateLegacySession()
      // 前提：会话那次写**确实失败了**（而不是「本来就什么都没写」）。
      // 原先这里断言的是 `existsSync(sessionFile(dir, ...))` 为 false——但 `sessions` 是个
      // 普通文件，它下面任何路径的 existsSync 恒为 false，那条断言无论实现做什么都成立，
      // 是空的。改成钉住「失败这条 warn 真的出现过」。
      // 不看 calls[0]：**第一条** warn 是 writeSessionFile 自己那条「保存会话失败」，
      // 迁移那条在它之后。要看的是「迁移有没有报出这件事」，所以整组拼起来查。
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('保存会话失败')
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('未能落地')
    } finally {
      spy.mockRestore()
    }
    // 进度唯一的副本还在，下次启动会重试
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')).cursor).toBe(77)
    // 顺序的判据：会话那半没落地时，绝不能让 lastSourcePath 指向一本进度还没搬过去的书
    // ——否则下次启动自动打开它、600ms 后把 cursor 0 落盘，真进度就没了。
    expect(store.readSettings().lastSourcePath).toBeNull()
  })

  // 第二扇门：**会话那一半写成功了**，「上次打开的是哪本」没落盘时同样不能删。触发条件：
  // 两次写之间磁盘满了，或 settings.json 被一个同名目录占住（写 .tmp 成功、renameSync 到
  // 目录失败）。少了这道闸，迁移好的记录没有任何人去读它——用户手动导入那本书就被 cursor 0 覆盖。
  it('迁移时 lastSourcePath 写不进去也不删旧文件', () => {
    const store = createSessionStore(dir)
    const legacy = makeSession({ sourcePath: '/tmp/旧书.txt', cursor: 55 })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(legacy), 'utf8')
    mkdirSync(join(dir, 'settings.json')) // 占位：让 settings.json 写不进去

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      store.migrateLegacySession()
      // 前提：会话那一半**确实写成功了**——否则下面的断言可能只是因为整条迁移根本没跑起来
      expect(existsSync(sessionFile(dir, '/tmp/旧书.txt'))).toBe(true)
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('未能落地')
    } finally {
      spy.mockRestore()
    }
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
  })
})

describe('shortcuts 字段的向后兼容', () => {
  it('旧版的 settings.json 没有 shortcuts 键，补成空表而不是整份退回默认值', () => {
    // 这是本次改动最容易毁数据的地方：settingsProblem 的取舍是「一个字段不合格就整份退回
    // 默认值」，而 shortcuts 是后加的必填字段——不特殊处理的话，老用户升级一次就把改过的
    // 文档名 / 外观 / 纸张一起丢掉。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        docTitle: '我的文档',
        themeSource: 'dark',
        darkPaper: true,
        lastSourcePath: '/tmp/某本书.txt'
      }),
      'utf8'
    )
    const store = createSessionStore(dir)
    const settings = store.readSettings()
    expect(settings.docTitle).toBe('我的文档')
    expect(settings.themeSource).toBe('dark')
    expect(settings.darkPaper).toBe(true)
    expect(settings.lastSourcePath).toBe('/tmp/某本书.txt')
    expect(settings.shortcuts).toEqual({})
  })

  it('shortcuts 不是对象时整份退回默认值（坏文件，与别处姿态一致）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: 'Meta+KeyO' }),
      'utf8'
    )
    expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
  })

  it('shortcuts 是数组时整份退回默认值', () => {
    // 【为什么要单列一条】`Array.isArray(sc)` 是**独立于** `typeof sc !== 'object'` 的一道
    // 守卫：数组的 typeof 恰好就是 'object'，少了它，`[]` 会被当成「一张合法的空表」放行。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: [] }),
      'utf8'
    )
    expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
  })

  it('shortcuts 里某一条的值不是字符串时整份退回默认值，且警告点出是哪一条', () => {
    // 【断言里为什么必须带上那行 warn】只看返回值的话这条用例没有区分能力：把
    // `typeof spec !== 'string'` 这道守卫删掉，非字符串会一路走进 `shortcutProblem`、
    // 在 `spec.split` 上抛 TypeError——而 `readSettingsFile` 的 catch 也返回
    // `defaultSettings()`，于是返回值一模一样，变异体活下来。两边的差别只在那行警告里：
    // 干净拒绝报的是 `shortcuts.import 不是字符串`，抛异常报的是 `读取设置失败`。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { import: 123 } }),
      'utf8'
    )
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
      expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
        'shortcuts.import 不是字符串'
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('shortcuts 里有一条坏串时整份退回默认值', () => {
    // 【为什么是整份而不是只丢那一条】坏串意味着这个文件被人改过或写坏了；设置项全是
    // 可再生的，退回默认值是既有姿态。逐条退让会让「哪几条是我改的」变得无法解释。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { import: 'KeyO' } }),
      'utf8'
    )
    expect(createSessionStore(dir).readSettings()).toEqual(defaultSettings())
  })

  it('macOS 的保留键**不**导致整份退回——它归 core 按平台逐条处理', () => {
    // 【这一条是钉住两层校验的分工，不是补一条覆盖率】`resolveShortcuts` 的逐条校验要是
    // 永远走不到，它就是纸面路径。保留键是平台相关的，必须**穿过** sessionStore 这一层
    // （它拿不到平台，判不了），到 core 那里才被退回默认值。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        ...defaultSettings(),
        docTitle: '还在',
        shortcuts: { import: 'Meta+KeyQ' }
      }),
      'utf8'
    )
    const settings = createSessionStore(dir).readSettings()
    // 文件本身没被当坏文件，其它字段照旧
    expect(settings.docTitle).toBe('还在')
    expect(settings.shortcuts).toEqual({ import: 'Meta+KeyQ' })
    // 到了 core 这一层才按平台分道扬镳
    expect(resolveShortcuts(settings.shortcuts, 'darwin').import).toBe('Meta+KeyO')
    expect(resolveShortcuts(settings.shortcuts, 'other').import).toBe('Meta+KeyQ')
  })

  it('shortcuts 里的未知 id 不拦——那是更新版本写的，本版本应当照常读', () => {
    // 【这一条的值必须是**结构上非法**的串】原先喂的是 `'Meta+KeyJ'`，它本身就合法，
    // 于是「只校验已知 id」与「一视同仁校验所有 id」两种实现结果一样——用例空转。
    // 换成没带修饰键的 `'KeyJ'` 才有区分能力：`isShortcutId` 那道守卫一旦被去掉，这个
    // 文件就会被当坏文件整份退回，下面第一行断言当场红。
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { 'future-thing': 'KeyJ' } }),
      'utf8'
    )
    const settings = createSessionStore(dir).readSettings()
    expect(settings.shortcuts).toEqual({ 'future-thing': 'KeyJ' })
    // 未知 id 不参与解析，所以默认值一条都不受影响
    expect(resolveShortcuts(settings.shortcuts, 'other').import).toBe('Ctrl+KeyO')
  })

  it('合法的 shortcuts 原样读回来', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...defaultSettings(), shortcuts: { import: 'Ctrl+KeyI' } }),
      'utf8'
    )
    expect(createSessionStore(dir).readSettings().shortcuts).toEqual({ import: 'Ctrl+KeyI' })
  })

  it('写进去的 shortcuts 能原样读回来（往返）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-shortcuts-'))
    const store = createSessionStore(dir)
    const settings = { ...defaultSettings(), shortcuts: { 'toggle-sidebar': 'Ctrl+Alt+KeyB' } }
    store.writeSettings(settings)
    expect(store.readSettings()).toEqual(settings)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: FAIL —— 无法解析 `../../src/main/sessionStore`。

- [ ] **Step 3: 写 `src/main/sessionStore.ts`**

```ts
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { SHORTCUTS, shortcutProblem, type ShortcutId } from '../core/shortcuts'
import { defaultSettings } from '../core/types'
import type { AppSettings, Novel, NovelCacheMeta, PersistedSession } from '../core/types'

/** 磁盘上那个 id 是不是本版本认识的。不认识的照常放行（见 settingsProblem 里的说明）。 */
function isShortcutId(id: string): id is ShortcutId {
  return SHORTCUTS.some((def) => def.id === id)
}

export interface SessionStore {
  readSettings(): AppSettings
  writeSettings(s: AppSettings): void
  readSession(sourcePath: string): PersistedSession | null
  writeSession(s: PersistedSession): void
  clearReadingHistory(): void
  migrateLegacySession(): void
  writeNovelCache(novel: Novel): void
  readNovelCache(filePath: string): Novel | null
}

/**
 * 校验读回来的 JSON 是不是一份完整的 PersistedSession。
 *
 * 【为什么不能只做 JSON.parse】持久化文件可能是旧版本写的、也可能被手工改过，
 * 而只要它还是合法 JSON，`as PersistedSession` 这个断言就能把残缺记录一路送进
 * TypingEngine.fromSession。实测 fromSession 对残缺记录【不抛错】：
 *   - 删掉 chapterPos：缺失的数组被当成全 0，只有游标所在章的项被重算，于是它照样返回
 *     一个引擎。快照的【具体数字取决于样本】，实测「两章各 10 字（[0,10) 与 [10,20)）、
 *     cursor=12」得 chapterPos=[0,2]、activeChapter=1，而「两章 20+10（[0,20) 与 [20,30)）、
 *     同样 cursor=12」得 chapterPos=[12,0]、activeChapter=0——别把那组数字读成这条路径的
 *     性质，它只是那个样本的值。
 *   - 只留 novelTitle / sourcePath：返回一个「从头开始」的引擎——cursor=0、ratio=10、
 *     mode='ime'、startedAt=null，chapterPos 全 0（长度等于章数）。这几个值与样本无关：
 *     cursor 缺失一律落 0，而 chapters[0].start 按构造恒为 0，所以第 0 章那一项也是 0。
 * 于是畸形数据不会崩溃，而是伪装成一次成功的恢复（比例、模式、计时都还在，进度却回到
 * 开头）。校验失败一律当作「没有记录」，由调用方走空状态。
 *
 * 【返回字段名而不是 true/false】这条警告原先只说「结构不合法」，读日志的人无法知道是哪个
 * 字段——而这正是「进度莫名其妙没了」时要查的东西。改成返回第一个不合格字段的描述，
 * isPersistedSession 只是它的布尔外壳（`=== null`），两条路径不会各写一套而漂移。
 */
function sessionProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return '不是一个对象'
  const s = v as Record<string, unknown>
  if (typeof s.novelTitle !== 'string') return 'novelTitle 不是字符串'
  if (typeof s.sourcePath !== 'string') return 'sourcePath 不是字符串'
  if (s.mode !== 'ime' && s.mode !== 'key') return 'mode 既不是 ime 也不是 key'
  if (!Array.isArray(s.chapterPos)) return 'chapterPos 不是数组'
  if (!s.chapterPos.every((n) => typeof n === 'number')) return 'chapterPos 含非数字项'
  if (s.startedAt !== null && typeof s.startedAt !== 'number') {
    return 'startedAt 既不是 null 也不是数字'
  }
  for (const k of ['ratio', 'cursor', 'revealStart', 'activeChapter']) {
    const n = s[k]
    if (typeof n !== 'number' || !Number.isFinite(n)) return `${k} 不是有限数字`
  }
  return null
}

function isPersistedSession(v: unknown): v is PersistedSession {
  return sessionProblem(v) === null
}

/**
 * NovelCacheMeta.chapters 里每个元素的必填字段；返回不合格字段的描述，合格返回 null。
 *
 * 【为什么要逐个元素查】`Array.isArray(v.chapters)` 单看像是够了，但它对元素一无所知：
 * 一个 `['第一章']` 这样的数组能过那道检查，随后下游读 `chapters[i].start` 得到 undefined，
 * 偏移就成了 NaN——章节目录与游标一起悄悄失效，而类型断言 `as NovelCacheMeta` 不会拦。
 * 数组的形状与元素的形状是两件事，这道检查就是往下多走的那一层。
 */
function chapterProblem(v: unknown, i: number): string | null {
  if (typeof v !== 'object' || v === null) return `chapters[${i}] 不是对象`
  const c = v as Record<string, unknown>
  if (typeof c.title !== 'string') return `chapters[${i}].title 不是字符串`
  for (const k of ['index', 'start', 'end', 'charCount']) {
    const n = c[k]
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return `chapters[${i}].${k} 不是有限数字`
    }
  }
  return null
}

/**
 * 校验读回来的 JSON 是不是一份完整的 NovelCacheMeta。
 *
 * 【与 isPersistedSession 是同一套姿势，理由也相同】这里原先是 `JSON.parse(...) as
 * NovelCacheMeta`——一个合法 JSON 就通过了断言。而**一份形状不对的 meta 会被当成【命中】
 * 返回**，不是未命中：路径、源文件 stat、提交点这三道门依赖的只是 meta 里那几个存在的
 * 字段，缺了 title/encoding/hadBom/chapters 照样自洽。实测：meta 只写
 * sourcePath/mtimeMs/size/textBytes 时，readNovelCache 返回一个 chapters、title、encoding、
 * hadBom 全为 undefined 的对象，而 flatText 是对的——于是 Task 6 的 `if (cached) return cached`
 * 会把这样一个「小说」交给渲染进程，chapters.length 当场抛错。
 *
 * 【为什么是必填字段校验而不是精确形状校验】与 isPersistedSession 同样的取舍：将来版本
 * 若在 meta 里多写几个键，旧记录仍应有效。所以这里只问「我需要的字段在不在、类型对不对」，
 * 不问「有没有多余的键」。
 *
 * 【丢弃这份缓存不会丢任何东西——这是 return null 而不是「尽力而为」的理由】缓存里没有
 * 不可再生的信息：title ← 文件名、encoding/hadBom ← 检测、chapters ← 切分、flatText ← 解码，
 * 而全应用唯一不可再生的状态是阅读进度，它在 `sessions/<hash>.json` 里（另一些文件、另一套校验），
 * 本路径不碰。所有 null 都落回 loadNovelFromFile(meta.sourcePath)，源文件是同一个路径；
 * 源文件若也没了，现有代码本来就会返回 null（statSync 抛）。所以这里只是把一种情况挪到
 * 一条【已经由四处未命中走过】的路径上，不引入新的行为类别。
 *
 * 【顺带约束了 Task 12：两次恢复不必互相同步】实测 fromSession 按【重建出来的】
 * chapters 长度建 chapterPos、用 s.chapterPos?.[i] 取值、缺失项落 0，且 cursor 被夹到新的
 * flatText 长度内——章数比记录多、少、或正文更短，它都是逐章降级而不是抛错。所以
 * 「缓存被判无效」最坏也就是首次启动慢一点（重读源文件 + 重新解码切分），
 * 不会让已存的阅读位置丢失或损坏。Task 12 的会话恢复因此无需与缓存有效性协调。
 */
function cacheMetaProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return '不是一个对象'
  const m = v as Record<string, unknown>
  if (typeof m.sourcePath !== 'string') return 'sourcePath 不是字符串'
  if (typeof m.title !== 'string') return 'title 不是字符串'
  if (typeof m.encoding !== 'string') return 'encoding 不是字符串'
  if (typeof m.hadBom !== 'boolean') return 'hadBom 不是布尔值'
  for (const k of ['mtimeMs', 'size', 'textBytes']) {
    const n = m[k]
    if (typeof n !== 'number' || !Number.isFinite(n)) return `${k} 不是有限数字`
  }
  if (!Array.isArray(m.chapters)) return 'chapters 不是数组'
  for (let i = 0; i < m.chapters.length; i++) {
    const problem = chapterProblem(m.chapters[i], i)
    if (problem !== null) return problem
  }
  return null
}

function isNovelCacheMeta(v: unknown): v is NovelCacheMeta {
  return cacheMetaProblem(v) === null
}

/**
 * 校验读回来的 JSON 是不是一份完整的 AppSettings；返回第一个不合格字段的描述。
 *
 * 【与 sessionProblem 是同一套姿势，取舍也相同】设置项全都是可再生的（坏了就回默认值），
 * 所以这里不像会话那样有「进度不能丢」的压力；但仍然返回**字段名**而不是 true/false——
 * 静默回默认会让「我改的文档名怎么没了」无从查起。
 */
function settingsProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return '不是一个对象'
  const s = v as Record<string, unknown>
  if (typeof s.docTitle !== 'string') return 'docTitle 不是字符串'
  if (s.themeSource !== 'system' && s.themeSource !== 'light' && s.themeSource !== 'dark') {
    return 'themeSource 不是 system/light/dark'
  }
  if (typeof s.darkPaper !== 'boolean') return 'darkPaper 不是布尔值'
  if (s.lastSourcePath !== null && typeof s.lastSourcePath !== 'string') {
    return 'lastSourcePath 既不是 null 也不是字符串'
  }
  const n = s.ratio
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'ratio 不是有限数字'
  const sc = s.shortcuts
  if (typeof sc !== 'object' || sc === null || Array.isArray(sc)) return 'shortcuts 不是对象'
  for (const [id, spec] of Object.entries(sc as Record<string, unknown>)) {
    if (typeof spec !== 'string') return `shortcuts.${id} 不是字符串`
    // 未知 id 刻意**不拦**：那是更新版本写的，本版本应当照常读、照常写回去。
    // 已知 id 则必须能解析——解析不了说明这个文件被改坏了。
    // 【只拦结构问题，不拦保留键】解析不了 / 没带修饰键 → 这个文件被改坏了，与其它字段
    // 一样整份退回；保留键是**平台相关**的，而这一层拿不到平台，只能交给 core 的
    // `resolveShortcuts` 按平台逐条退回默认值。
    //
    // 【那个 'darwin' 是惰性的，别试图"修正"它】`shortcutProblem` 的 `no-modifier` /
    // `unsupported-key` 两个出口在**查保留清单之前**就返回了，与 kind 无关；所以这里传
    // 什么都一样，真正吃重的是下面这个枚举。写成枚举而不是 `!== 'reserved'`，就是为了
    // 让这件事在调用点上自明。
    if (isShortcutId(id)) {
      const problem = shortcutProblem(spec, 'darwin')
      if (problem === 'no-modifier' || problem === 'unsupported-key') {
        return `shortcuts.${id} 不是合法的快捷键（${problem}）`
      }
    }
  }
  return null
}

/**
 * 给**旧版**写下的设置补上后来才加的字段。
 *
 * 【为什么不能直接让它按必填校验失败】`ratio` 与 `shortcuts` 都是后加的。旧版写下的
 * settings.json 里没有它们，而校验是「一个字段不合格就整份退回默认值」——那等于：升级
 * 一次，用户改过的文档名 / 外观 / 纸张**一起没了**，只在日志里留一条 warn。
 *
 * 【判据是「键不存在」而不是「值是 undefined」】后者在 JSON 里从来写不出来，而前者正是
 * 旧版本留下的形状。值不合法仍然整份退回——那是坏文件，不是旧文件。
 *
 * 【为什么是「缺哪个键补哪个」而不是给每个字段配一个专用函数】`ratio` 那次就是专用函数。
 * 再来一个 `withShortcutsFilled` 之后，下一次加字段还是得记得写第三个；写成一张表就没有
 * 这个「记得」了。
 */
const FILLED_DEFAULTS: Readonly<Record<string, () => unknown>> = {
  ratio: () => defaultSettings().ratio,
  shortcuts: () => ({})
}

function withDefaultsFilled(v: unknown): unknown {
  if (typeof v !== 'object' || v === null) return v
  const record = v as Record<string, unknown>
  const filled: Record<string, unknown> = { ...record }
  for (const [key, make] of Object.entries(FILLED_DEFAULTS)) {
    if (!(key in record)) filled[key] = make()
  }
  return filled
}

function isAppSettings(v: unknown): v is AppSettings {
  return settingsProblem(v) === null
}

function readSettingsFile(path: string): AppSettings {
  try {
    if (!existsSync(path)) return defaultSettings()
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    // 先给旧版记录补上后来才加的字段，再按必填校验（见 withDefaultsFilled 的说明）
    const filled = withDefaultsFilled(parsed)
    if (!isAppSettings(filled)) {
      console.warn(
        `[wt] 设置文件结构不合法（${settingsProblem(filled) ?? '未知'}），按默认值处理：`,
        path
      )
      return defaultSettings()
    }
    return filled
  } catch (err) {
    console.warn('[wt] 读取设置失败，按默认值处理：', err)
    return defaultSettings()
  }
}

/**
 * 返回「这一次是否确实落地了」——迁移里「上次打开的是哪本有没有落盘」那道闸用它。
 *
 * 设置项本身全是可再生的（坏了就回默认值），所以别处的调用方都不看返回值；这里返回它，
 * 只是因为迁移那条路必须先确认它落盘了才能删旧文件。
 */
function writeSettingsFile(path: string, s: AppSettings): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    // 与 session 同样的 temp+rename。文档名是用户敲进去的、不可再生，
    // 截断的 settings.json 读回来只会是默认值。
    writeFileSync(`${path}.tmp`, JSON.stringify(s), 'utf8')
    renameSync(`${path}.tmp`, path)
    return true
  } catch (err) {
    console.warn('[wt] 保存设置失败，本次改动未落盘：', err)
    return false
  }
}

/**
 * 一本书的进度文件名：`sourcePath` 的 sha256 前 16 字节（32 个 hex 字符）。
 *
 * 【为什么是哈希而不是把路径编码进文件名】路径可能很长、含 `/` 与冒号等各平台保留字符，
 * 直接拼进去会撞上文件名长度上限（多数文件系统 255 字节）。哈希定长、且只含 hex。
 * 代价是文件名不再可读——所以文件**内容**里仍带着 sourcePath，读取时比对（见下）。
 */
function sessionFileName(sourcePath: string): string {
  return `${createHash('sha256').update(sourcePath, 'utf8').digest('hex').slice(0, 32)}.json`
}

/** 按书取会话文件路径。book 的路径 → 定长文件名，见 sessionFileName。 */
function sessionFilePath(sessionsDir: string, sourcePath: string): string {
  return join(sessionsDir, sessionFileName(sourcePath))
}

/**
 * 【两个参数必须互相一致的不变量】`file` 得是 `sessionFile(sourcePath)` 的结果——下面那道
 * 「文件里的 sourcePath 与请求的不是同一本」的检查，前提正是「文件名由这个路径算出」。
 * 目前只靠唯一调用点保证（`readSession` 里就地算出来传进来），签名上没有任何东西拦着
 * 把一对不相干的参数传进来。
 */
function readSessionFile(file: string, sourcePath: string): PersistedSession | null {
  try {
    if (!existsSync(file)) return null
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!isPersistedSession(parsed)) {
      // 结构不合法的记录同样要说出来，并且**点出是哪个字段**——静默丢弃是「进度
      // 莫名其妙没了」的成因，而只报「不合法」把定位工作留给了看日志的人。
      console.warn(
        `[wt] 会话文件结构不合法（${sessionProblem(parsed) ?? '未知'}），按无记录处理：`,
        file
      )
      return null
    }
    // 文件名是路径的哈希，所以「文件里的 sourcePath 与请求的不是同一本」只可能来自手工改名
    // 或哈希撞车。放行的话会把 B 书的进度套到 A 书上——章节目录与光标全部错位，而
    // fromSession 对错位的 chapterPos 不抛错，只会表现为「进度莫名其妙不对」。
    if (parsed.sourcePath !== sourcePath) {
      // 两个路径都打出来：文件名是 32 位 hex，只给文件名的话，读日志的人既不知道这份记的是
      // 哪本书、也不知道请求的是哪本——而「哪两本对不上」正是要查的东西。
      console.warn(
        '[wt] 会话文件与请求的书不是同一本，按无记录处理：文件里记的是',
        parsed.sourcePath,
        '，请求的是',
        sourcePath,
        '，文件：',
        file
      )
      return null
    }
    return parsed
  } catch (err) {
    // 解析失败与「文件读不出来」都按无记录处理，启动不该被一份坏文件卡住；
    // 但要说出来——不然「目录只读 / 磁盘满」会表现成「应用一切正常，只是记不住进度」。
    console.warn('[wt] 读取会话失败，按无记录处理：', err)
    return null
  }
}

/**
 * 返回「这一次是否确实落地了」。
 *
 * 【返回值目前**没有**调用方在看】`writeSession` 忽略它，迁移也不看——迁移的判据是
 * 「新位置那份**读得出来**」（删之前再读一次，见 `migrateLegacySession`），那比「写函数说
 * 自己成功了」强：将来有人让它在没落盘时返回 true，那道读仍然守得住。所以**别把返回值当成
 * 「旧文件能不能删」的依据**，要判就读一次。
 */
function writeSessionFile(file: string, s: PersistedSession): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true })
    // 先写临时文件再改名（同一个目录内，rename 是原子的）：读取方要么看到旧的完整文件、
    // 要么看到新的完整文件，不会看到「写了一半的会话文件」。直接写目标路径的话，
    // 进程在写完之前死掉，留下的是截断甚至空的文件，readSession 只能返回 null——
    // 游标、chapterPos、activeChapter、ratio、mode、startedAt 全部静默丢失。
    // 实测这种残留的表现：截断成 20 字节与空文件都读回 null。
    // 注意这条保护的是一次写入【之内】的完整性，写入之间的窗口只能靠调用方的防抖收敛。
    writeFileSync(`${file}.tmp`, JSON.stringify(s), 'utf8')
    renameSync(`${file}.tmp`, file)
    return true
  } catch (err) {
    console.warn('[wt] 保存会话失败，本次进度未落盘：', err)
    return false
  }
}

export function createSessionStore(baseDir: string): SessionStore {
  const settingsPath = join(baseDir, 'settings.json')
  const legacySessionPath = join(baseDir, 'session.json')
  const cacheMetaPath = join(baseDir, 'novel-cache.json')
  const cacheTextPath = join(baseDir, 'novel-cache.txt')
  const sessionsDir = join(baseDir, 'sessions')
  /** 这本书的进度文件。每本书一份——换书不再覆盖上一本的进度。 */
  const sessionFile = (sourcePath: string): string => sessionFilePath(sessionsDir, sourcePath)

  const ensureDir = (): void => {
    mkdirSync(baseDir, { recursive: true })
  }

  return {
    readSettings(): AppSettings {
      return readSettingsFile(settingsPath)
    },

    writeSettings(s: AppSettings): void {
      writeSettingsFile(settingsPath, s)
    },

    readSession(sourcePath: string): PersistedSession | null {
      // 【为什么要闸】sourcePath 不是字符串时，sessionFileName 会在 createHash 里抛
      // ERR_INVALID_ARG_TYPE，而那是**在 readSessionFile 的 try 之外**（参数先求值）——
      // 异常会一路冒到 ipcMain.handle，把渲染层那次 invoke 打成 rejection。
      // 这条通道收的是渲染层未经校验的载荷，而「读回来的东西一律校验」是本文件的既有姿态——
      // 这属于同一类，只是站在 IPC 那一侧。问不到就按无记录，与别处一致。
      //
      // 【这不是「不可达的防御」】渲染层传 sourcePath 要等 Task 7，在那之前每次启动都会
      // 走到这里并且**必须**返回 null（而不是抛）——所以它是眼下唯一兜住这条路的东西，
      // 不是给未来留的保险。
      if (typeof sourcePath !== 'string') return null
      return readSessionFile(sessionFile(sourcePath), sourcePath)
    },

    writeSession(s: PersistedSession): void {
      if (typeof s?.sourcePath !== 'string') {
        console.warn('[wt] 保存会话失败：sourcePath 不是字符串，本次进度未落盘')
        return
      }
      writeSessionFile(sessionFile(s.sourcePath), s)
    },

    clearReadingHistory(): void {
      // 「清除阅读记录」= 回到「从未导入」：所有书的进度、小说缓存、以及旧版留下的那一份
      // 单槽会话文件。**settings.json 刻意不在此列**——文档名 / 外观 / 纸张是用户的偏好，
      // 与「读到哪」无关；把它们一起清掉正是本次改动要修的那个语义。
      for (const p of [legacySessionPath, `${legacySessionPath}.tmp`, cacheMetaPath, cacheTextPath]) {
        try {
          // force: true 而不是先 existsSync 再删——分开写的话，「文件本来就不存在」这条
          // 正常路径会走进 catch 打出一行「删除失败」。一条在成功时也会响的告警，比没有
          // 告警更糟：它教会看日志的人忽略这一行。
          rmSync(p, { force: true })
        } catch (err) {
          console.warn('[wt] 删除持久化文件失败：', p, err)
        }
      }
      // 整个目录一起删，而不是先 readdir 再逐个删：少一次「列目录时多出来一个新文件」的
      // 竞态，也不用维护「哪些文件算会话」这份名单。
      try {
        rmSync(sessionsDir, { recursive: true, force: true })
      } catch (err) {
        console.warn('[wt] 删除会话目录失败：', sessionsDir, err)
      }
    },

    migrateLegacySession(): void {
      // 旧版只有一个 session.json 槽位，新版按书分文件。升级后第一次取 store 时把它搬过去，
      // 否则用户的进度还躺在磁盘上、却永远不会再被读到了。
      let legacy: PersistedSession
      try {
        if (!existsSync(legacySessionPath)) return
        const raw: unknown = JSON.parse(readFileSync(legacySessionPath, 'utf8'))
        if (!isPersistedSession(raw)) {
          // **刻意不删**：删除是不可逆的，而留着最多每次启动多一条警告。这份文件已经不是
          // 本应用能读懂的东西了（手改过、或来自更早的版本），交给看日志的人自行处置。
          console.warn(
            `[wt] 旧版会话文件结构不合法（${sessionProblem(raw) ?? '未知'}），未迁移：`,
            legacySessionPath
          )
          return
        }
        legacy = raw
      } catch (err) {
        console.warn('[wt] 读取旧版会话失败，未迁移：', err)
        return
      }

      const target = sessionFile(legacy.sourcePath)
      // 【本任务唯一会毁数据的地方，判据要强，而且顺序不能反】
      //
      // 1. 先把会话搬过去，并且**以「读得出来」为准**：`existsSync` 只回答「有个东西在那儿」，
      //    一个空的或截断的 target 会让迁移跳过写、然后把旧文件删掉——用一个读不出来的残留
      //    压掉一份完好的旧记录。target 本来就能读时短路掉写（那一份是更新的）。
      // 2. **删之前再读一次**，而不是信 `writeSessionFile` 的返回值：保证是「这份记录确实在
      //    新位置读得出来」，而不是「那次调用说自己成功了」。将来有人让它在没落盘时返回 true，
      //    这道读仍然守得住。
      if (readSessionFile(target, legacy.sourcePath) === null) writeSessionFile(target, legacy)
      if (readSessionFile(target, legacy.sourcePath) === null) {
        console.warn('[wt] 旧版会话迁移未能落地，保留原文件、下次启动重试：', legacySessionPath)
        return
      }

      // 3. 「上次打开的是哪本」排在上面两条**之后**。反过来的话，会话写失败而设置写成功时，
      //    `lastSourcePath` 会指向一本进度还没搬过去的书——下次启动自动打开它、600ms 后把
      //    cursor 0 落盘，再下次启动就满足「已经迁过」而把旧文件删掉，真进度没了。
      //    排在后面，「lastSourcePath 已设置 ⇒ 这本书的记录已经在新位置」才成为不变量。
      const settings = readSettingsFile(settingsPath)
      if (
        settings.lastSourcePath === null &&
        !writeSettingsFile(settingsPath, { ...settings, lastSourcePath: legacy.sourcePath })
      ) {
        console.warn('[wt] 旧版会话迁移未能落地，保留原文件、下次启动重试：', legacySessionPath)
        return
      }

      // 两个删除各占一个 try：共用一个的话，前一个抛错会让后一个**永远不被尝试**——
      // 两件互不相干的清理不该互相拖累。
      try {
        rmSync(legacySessionPath, { force: true })
      } catch (err) {
        console.warn('[wt] 删除旧版会话文件失败：', err)
      }
      try {
        rmSync(`${legacySessionPath}.tmp`, { force: true })
      } catch (err) {
        console.warn('[wt] 删除旧版会话临时文件失败：', err)
      }
    },

    writeNovelCache(novel: Novel): void {
      try {
        ensureDir()
        const st = statSync(novel.sourcePath)
        const text = novel.flatText
        const meta: NovelCacheMeta = {
          sourcePath: novel.sourcePath,
          mtimeMs: st.mtimeMs,
          size: st.size,
          encoding: novel.encoding,
          hadBom: novel.hadBom,
          title: novel.title,
          chapters: novel.chapters,
          // 与下面写出的字节数同源：writeFileSync 用 'utf8' 写出的就是这么多字节，
          // 读取时拿 statSync(cacheTextPath).size 与它比对即可自我校验。
          textBytes: Buffer.byteLength(text, 'utf8')
        }
        // 全文单独存纯文本：20MB 小说塞进 JSON 会白白付出转义与解析开销
        writeFileSync(cacheTextPath, text, 'utf8')
        // meta 是这一对文件之间的【提交点】，必须最后写：崩溃若落在上面那行与这行之间，
        // 磁盘上是「新 text + 旧 meta」，而旧 meta 的 textBytes 对不上新文本的大小，
        // 读取时整对被拒。反过来（先写 meta）留下「新 meta + 旧 text」，同样被 textBytes
        // 拦下——两种顺序的残余风险相同，这里只是让 meta 承担提交语义。
        writeFileSync(cacheMetaPath, JSON.stringify(meta), 'utf8')
      } catch (err) {
        // 缓存失败不影响本次使用，但下次启动会重新读源文件——值得留一条痕迹。
        console.warn('[wt] 写入小说缓存失败，下次启动将重新读取源文件：', err)
      }
    },

    readNovelCache(filePath: string): Novel | null {
      try {
        if (!existsSync(cacheMetaPath) || !existsSync(cacheTextPath)) return null
        const parsed: unknown = JSON.parse(readFileSync(cacheMetaPath, 'utf8'))
        if (!isNovelCacheMeta(parsed)) {
          // 形状不对同样是「未命中」，不是「命中但字段是 undefined」——后者会一路
          // 送到渲染进程（Task 6 的 openNovel 是 `if (cached) return cached`）。
          console.warn(
            `[wt] 缓存元数据结构不合法（${cacheMetaProblem(parsed) ?? '未知'}），按未命中处理：`,
            cacheMetaPath
          )
          return null
        }
        const meta = parsed
        if (meta.sourcePath !== filePath) return null
        const st = statSync(filePath)
        if (st.mtimeMs !== meta.mtimeMs || st.size !== meta.size) return null
        // 提交点校验。少了这一行，「新 text + 旧 meta」这种崩溃残留也能通过上面三项
        // （meta 记的是自己那本书的 sourcePath/mtime/size，全都自洽），
        // 于是把 A 书的章节目录配上 B 书的正文交给用户。
        // 反过来「旧 text + 新 meta」同样在这里被拦下。旧版本写的缓存没有 textBytes
        // 字段，比较时 undefined 必然不等 → 自动降级为 cache miss 重读源文件。
        //
        // 【这一道门同时管住「text 自己写坏」，所以不必拆成两道】text 没有 temp+rename，
        // 也不需要：半截的 text 会让 meta 里描述【源文件】的 sourcePath/mtimeMs/size 依然
        // 成立，而 textBytes 描述的是一个更短的文件，于是被同一处比较拒掉。实测：66 字节的
        // 正文只落盘前 56 字节（确为原文前缀、源文件未变）时 readNovelCache 返回 null。
        // 一个提交点覆盖「meta 写坏」与「text 写坏」两个方向。
        //
        // 【这一门的边界，别当成保证】它比的是字节数，所以两段【等长】的文本仍会被放行：
        // 实测为 A 书写好缓存后，把 novel-cache.txt 覆写成另一段等长文本而 meta 不动，
        // readNovelCache(A) 仍返回 A 的章节目录配那段新文本。要彻底关掉这个窗口，
        // textBytes 得换成内容哈希——那要改动 types.ts 里的 NovelCacheMeta（Task 2 的文件），
        // 本次不做（见设计文档 §13）。
        if (statSync(cacheTextPath).size !== meta.textBytes) return null
        return {
          title: meta.title,
          sourcePath: meta.sourcePath,
          encoding: meta.encoding,
          hadBom: meta.hadBom,
          flatText: readFileSync(cacheTextPath, 'utf8'),
          chapters: meta.chapters
        }
      } catch (err) {
        console.warn('[wt] 读取小说缓存失败，将重新读取源文件：', err)
        return null
      }
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 写失败测试 `tests/unit/startup.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyUserDataOverride, resolveInitialNovelPath } from '../../src/main/startup'

/** 调用方应当注入的谓词形状：区分「是普通文件」与「存在」。 */
function realIsFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

describe('applyUserDataOverride', () => {
  it('设置 WT_USER_DATA 时覆盖 userData 路径', () => {
    const setPath = vi.fn()
    const applied = applyUserDataOverride({ WT_USER_DATA: '/tmp/wt-profile' }, setPath)
    expect(applied).toBe(true)
    expect(setPath).toHaveBeenCalledWith('userData', '/tmp/wt-profile')
  })

  it('未设置时不覆盖', () => {
    const setPath = vi.fn()
    expect(applyUserDataOverride({}, setPath)).toBe(false)
    expect(setPath).not.toHaveBeenCalled()
  })
})

describe('resolveInitialNovelPath', () => {
  // 名字是 isFile 而不是 exists：这两个问题在「名叫 xxx.txt 的目录」上分道扬镳，
  // 而本函数依赖的是后者（见下一条用例）。
  const isFile = (p: string): boolean => p === '/books/三国演义.txt' || p === './小说.txt'

  it('从 argv 里挑出存在的 txt 路径', () => {
    expect(resolveInitialNovelPath(['/Applications/WT', '/books/三国演义.txt'], isFile)).toBe(
      '/books/三国演义.txt'
    )
  })

  it('dev 模式下跳过 "." 之类的非 txt 参数', () => {
    expect(resolveInitialNovelPath(['/path/electron', '.', './小说.txt'], isFile)).toBe('./小说.txt')
  })

  it('忽略不存在的 txt 路径', () => {
    expect(resolveInitialNovelPath(['/Applications/WT', '/books/不存在.txt'], isFile)).toBeNull()
  })

  it('忽略开关参数', () => {
    expect(resolveInitialNovelPath(['/Applications/WT', '--inspect', '--flag.txt'], isFile)).toBeNull()
  })

  it('没有候选时返回 null', () => {
    expect(resolveInitialNovelPath(['/Applications/WT'], isFile)).toBeNull()
  })

  it('多个候选时取最后一个', () => {
    expect(
      resolveInitialNovelPath(['/Applications/WT', '/books/三国演义.txt', './小说.txt'], isFile)
    ).toBe('./小说.txt')
  })

  // 名叫 xxx.txt 的目录：existsSync 说 true，statSync(...).isFile() 说 false，
  // 而 readFileSync 会抛 EISDIR。传 existsSync 的话这样一个目录会被选中 →
  // loadNovelFromFile 当场抛错 → Task 12 的 initialPath 分支没有 try/catch →
  // 启动期未处理 rejection。用真实的 statSync 谓词把这条契约钉住。
  it('名叫 xxx.txt 的目录不会被选中', () => {
    const root = mkdtempSync(join(tmpdir(), 'wt-startup-'))
    const dirAsTxt = join(root, '其实是个目录.txt')
    const realFile = join(root, '真文件.txt')
    mkdirSync(dirAsTxt)
    writeFileSync(realFile, '正文', 'utf8')

    // 前提：它确实是个目录、而且确实以 .txt 结尾（否则这条用例测不到那个分支）
    expect(statSync(dirAsTxt).isDirectory()).toBe(true)
    expect(dirAsTxt.endsWith('.txt')).toBe(true)

    expect(resolveInitialNovelPath(['/Applications/WT', dirAsTxt], realIsFile)).toBeNull()
    expect(resolveInitialNovelPath(['/Applications/WT', dirAsTxt, realFile], realIsFile)).toBe(
      realFile
    )
    rmSync(root, { recursive: true, force: true })
  })
})
```

- [ ] **Step 6: 写 `src/main/startup.ts`**

```ts
/**
 * 纯逻辑启动辅助，不 import electron，便于单测。
 */

/** WT_USER_DATA 允许把配置目录重定向（E2E 测试与便携模式使用）。 */
export function applyUserDataOverride(
  env: Record<string, string | undefined>,
  setPath: (name: string, path: string) => void
): boolean {
  const dir = env.WT_USER_DATA
  if (!dir) return false
  setPath('userData', dir)
  return true
}

/**
 * 从命令行参数里找出要自动打开的小说路径。
 *
 * 【注入的谓词要回答的是「是不是普通文件」，不是「存在不存在」】这两个问题在
 * 「名叫 `xxx.txt` 的目录」上分道扬镳：实测 `existsSync(目录)` 为 true，
 * `statSync(目录).isFile()` 为 false，而 `readFileSync(目录)` 抛 `EISDIR`。
 * 于是传 `existsSync` 的话，这样一个目录会被选中，`loadNovelFromFile` 当场抛错；
 * Task 12 的 `initialPath` 分支没有 try/catch，一次启动期的未处理 rejection。
 * 调用方应传 `(p) => { try { return statSync(p).isFile() } catch { return false } }`。
 *
 * 本函数是纯的，管不到调用方传什么：Task 6 的 `index.ts` 若仍传 `existsSync`
 * （它是合法的 `(p: string) => boolean`，不会报类型错），这条修复等于没落地。
 * 已记入设计文档 §13。
 */
export function resolveInitialNovelPath(
  argv: string[],
  isFile: (p: string) => boolean
): string | null {
  for (let i = argv.length - 1; i >= 1; i--) {
    const arg = argv[i]
    if (!arg || arg.startsWith('-')) continue
    if (!arg.toLowerCase().endsWith('.txt')) continue
    if (isFile(arg)) return arg
  }
  return null
}
```

- [ ] **Step 7: 运行确认通过**

Run: `pnpm vitest run tests/unit/startup.test.ts`
Expected: 全部 PASS。

- [ ] **Step 8: 写失败测试 `tests/unit/loadNovel.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { loadNovelFromFile } from '../../src/main/loadNovel'

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-load-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const ZH = '第一章 风起\n\n林昭站在城墙上。\n第二章 云涌\n\n城下列阵三日。\n'

describe('loadNovelFromFile', () => {
  it('读取 UTF-8 小说并切出章节，title 取文件名', () => {
    const p = join(dir, '我的小说.txt')
    writeFileSync(p, ZH, 'utf8')
    const novel = loadNovelFromFile(p)
    expect(novel.title).toBe('我的小说')
    expect(novel.sourcePath).toBe(p)
    expect(novel.encoding).toBe('UTF-8')
    expect(novel.chapters).toHaveLength(2)
    expect(novel.chapters[0].start).toBe(0)
    expect(novel.chapters[1].end).toBe(novel.flatText.length)
  })

  it('读取 GBK 小说也能正确还原中文', () => {
    const p = join(dir, 'gbk小说.txt')
    writeFileSync(p, iconv.encode(ZH, 'gbk'))
    const novel = loadNovelFromFile(p)
    expect(novel.flatText).toContain('林昭站在城墙上')
    expect(novel.encoding).not.toBe('UTF-8')
  })

  // 管线级用例（decode → 归一化 → splitChapters）：flatText 是 cursor / revealStart /
  // chapterPos 的坐标系，Task 4 拿它算、Task 5 把它持久化，所以它必须与用户导入的那份
  // 文本逐字一致。期望值在这里手写，不用实现里的 normalizeNewlines——两个操作数同源的话，
  // 实现错了两边会一起错、断言照样打印「相等」。
  it('CRLF 源文件：flatText 与归一化后的原文逐字相等', () => {
    const raw = '第一章 风起\r\n\r\n林昭站在城墙上。\r\n第二章 云涌\r\n\r\n城下列阵三日。\r\n'
    const p = join(dir, 'crlf.txt')
    writeFileSync(p, Buffer.from(raw, 'utf8'))
    // 前提：这份源文件真的是 CRLF，否则本用例在测一个并不存在的场景
    expect(readFileSync(p, 'utf8')).toContain('\r\n')

    const novel = loadNovelFromFile(p)
    expect(novel.chapters).toHaveLength(2)
    expect(novel.flatText).toBe(
      '第一章 风起\n\n林昭站在城墙上。\n第二章 云涌\n\n城下列阵三日。\n'
    )
    expect(novel.flatText).not.toContain('\r')
  })

  // 【钉住「必须先归一化」的是这一条，不是上面那条】单独 \r（旧 Mac 换行）的文本里一个
  // \n 都没有，splitChapters 按 '\n' 切行会得到「整份文件就是一行」，章节结构塌成单章。
  // 实测 2 章的 CR-only 文本直接切只得 1 章。所以去掉 decodeBuffer 的归一化，
  // 这里会红（上面那条 CRLF 用例不会——实测 raw CRLF 与归一化后的切分结论逐例相同）。
  it('CR-only 源文件：先归一化才切得出多章', () => {
    const raw = '第一章 风起\r林昭站在城墙上。\r第二章 云涌\r城下列阵三日。\r'
    const p = join(dir, 'cronly.txt')
    writeFileSync(p, Buffer.from(raw, 'utf8'))
    // 前提：一个 \n 都没有，否则「不归一化就会塌成单章」的前提不成立
    expect(readFileSync(p, 'utf8')).not.toContain('\n')

    const novel = loadNovelFromFile(p)
    expect(novel.chapters).toHaveLength(2)
    expect(novel.flatText).toBe('第一章 风起\n林昭站在城墙上。\n第二章 云涌\n城下列阵三日。\n')
  })
})
```

- [ ] **Step 9: 写 `src/main/loadNovel.ts`**

```ts
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { decodeBuffer } from '../core/decode'
import { splitChapters } from '../core/chapters'
import type { Novel } from '../core/types'

/**
 * 读文件 → 解码 → 切章，顺序是契约而不是风格。
 *
 * 【归一化必须排在切章之前】splitChapters 按 '\n' 切行，它假定输入只含 \n。
 *   - CRLF 不是问题：实测 36 种 CRLF 形状，`splitChapters(raw).flatText === raw` 与
 *     `splitChapters(normalized).flatText === normalized` **结论逐例相同**（两边都是
 *     12/36 保真）。那 24 例不保真的换行种类无关——纯 LF 也 24 例——失败集合恰好是
 *     「文件开头有空白行 → 前言切片被 kept 过滤器丢掉」，那是 chapters.ts 已写明并有
 *     用例守着的行为。机制上也不是「join 丢掉 \r」：实测
 *     `'第一章 甲\r\n正文一。\r\n'.split('\n').slice(0, 2).join('\n')` 得
 *     `"第一章 甲\r\n正文一。\r"`，\r 被保留，随后补的那个 \n 正好补全 \r\n。
 *   - 【单独 \r（旧 Mac 换行）才是真会坏的】这类文本里一个 \n 都没有，split('\n')
 *     无从下刀，整份文件变成一行，章节结构塌成单章：实测 2 章的 CR-only 文本直接切
 *     只得 1 章，归一化后才是 2 章。此时 flatText 仍严格等于原文（坐标系没坏），
 *     坏的是章节列表、跳章目标与 chapterPos 的长度。
 *   - 【\r\r\n（行尾被重复转换的产物）必须折叠成一个 \n】中文网络小说里很常见，不是个例。
 *     归一化漏掉它的话，整本书每行后面都会被多插一个空行，阅读区呈双倍行距——这是在用户的
 *     真实小说上实测到的（见设计文档 §7）。
 * 归一化由 decodeBuffer 承担（它的三条返回路径都经过 normalizeNewlines），所以这里只需
 * 保证 decode 的结果直接喂给 splitChapters，中间不要再插入别的处理。
 *
 * 【去掉归一化时，两条端到端用例都会红，但红的理由不同】CRLF 那条红在字符串比较上——
 * 它断言 flatText 等于【归一化后】的字面量（Task 2 的 'CRLF 被归一为 LF' 用例守着同一契约
 * 的单元层）；CR-only 那条红的更早，章节数就从 2 变成 1。别把上面「CRLF 保真」读成
 * 「CRLF 可以不用归一化」：保真说的是 splitChapters 喂进原文时的输出等于原文，
 * 而归一化是 decode 对外的契约（设计文档 §8 也写明缓存的是「解码并归一化后的全文」）。
 * tests/unit/loadNovel.test.ts 里的这两条用例锁住本函数这一段管线。
 */
export function loadNovelFromFile(filePath: string): Novel {
  const buf = readFileSync(filePath)
  const { text, encoding, hadBom } = decodeBuffer(buf)
  // `|| '未命名'` 是防御性兜底，对本函数【能读到的】路径不可达：主干为空只可能出现在以 '/'
  // 结尾的路径上（basename('/') === ''），而那类路径在上一行的 readFileSync 就抛
  // EISDIR/ENOTDIR，轮不到这里。点文件也不是空主干——实测 path.extname('.txt') 返回 ''
  // （点文件没有扩展名），于是 basename('.txt', '') 得到 '.txt' 本身，标题就是 '.txt'。
  // 所以没有用例钉它：不是漏了，是没有可构造的输入。
  const title = basename(filePath, extname(filePath)) || '未命名'
  const { flatText, chapters } = splitChapters(text, title)
  return { title, sourcePath: filePath, encoding, hadBom, flatText, chapters }
}
```

- [ ] **Step 10: 跑全量单测**

Run: `pnpm test`
Expected: 全绿。六组测试通过：decode / chapters / engine / sessionStore / startup / loadNovel
（原文写的「七组」含 smoke，而 tests/smoke.test.ts 已在 Task 3 的 Step 6.5 删除。
 紧接着的 Step 10.5 会再补入 guardA / guardB 两个文件，那时是**八组**。）

> **此处刻意不写具体用例数。** 这一行位于所有 fence 之外，而逐字节一致约定只保证「代码 = fence 里的代码」——**它对 fence 之外的散文一言不发**，所以散文里的计数会静默过期（曾写「98 个用例」，后续批次加了两条腿的用例后就成了 100，而没有任何检查会发现）。需要数字时请以 `pnpm test` 的实际输出为准。

- [ ] **Step 10.5: 写两条原子性守卫（评审补入）**

Step 3 的 `writeSession` 用的是 temp + rename，但它的**唯一**证据原本是「直接写会留下截断/空的
session.json」这条实测，没有守卫。评审指出：我原先「原子性无法在进程内观测」的论断下得太宽——
它排除的是**针对真实文件系统的崩溃注入**（`writeFileSync` 是同步的，测试线程打不断它），
但守卫并不需要打断写入，**换掉它**、或者**根本不看它**，都可以。于是补下面两条：

- `guardA.test.ts` 钉**性质**：把 `writeFileSync` 换成「先写 20 字节前缀再抛错」，断言
  **一次半途而废的保存不得破坏上一份完好会话**。顶部的 `// @vitest-environment node` 是承重的：
  实测在 jsdom 下 `vi.mock('node:fs')` 一次都拦不到（`vi.spyOn` 报
  "Module namespace is not configurable"，直接赋值报 "Cannot redefine property"）。
  它的前提自检（`expect(mockHits).toBe(1)`）是关键——去掉 pragma 时实测红在这一行
  （`expected +0 to be 1`），也就是**注入失效会被指名道姓地报出来**，而不是静默退化成空跑。
- `guardB.test.ts` 钉**机制**：`renameSync` 会给 `session.json` 换上临时文件的 inode，而
  `writeFileSync` 是原地截断、inode 不变。它不用 mock、在 jsdom 下原样可跑；代价不是全局配置，
  只是 A 的一个文件级 pragma，所以两条都留——将来实现若改用第三方的原子写工具，B 会继续通过
  却不再观测到任何有意义的东西，而 A 依然在测那件事。Windows 上跳过（部分文件系统对每个文件
  都报 0，正确的实现反而会红），该平台的性质由 A 覆盖。

两条守卫杀的是同一个回退：把 `writeSession` 改回直接写，它们**同时**变红，其余用例不受影响。

Run: `pnpm vitest run tests/unit/guardA.test.ts tests/unit/guardB.test.ts`
Expected: 2 passed。

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PersistedSession } from '../../src/core/types'

// 注入一次「写到一半就死」的写入：把数据的前 20 字节落盘后抛错。
// 这不是「中断真实的 writeFileSync」（那是做不到的），而是把它【换掉】——
// 于是「进程死在写入中途」这件事在进程内变成可观测的。
let armed = false
let mockHits = 0
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    writeFileSync: (p: unknown, data: unknown, enc?: unknown) => {
      if (armed && typeof p === 'string' && p.includes('sessions')) {
        mockHits++
        actual.writeFileSync(p, String(data).slice(0, 20), 'utf8')
        throw new Error('模拟进程在写入中途被杀')
      }
      return (actual.writeFileSync as (...a: unknown[]) => void)(p, data, enc)
    }
  }
})

const { createSessionStore } = await import('../../src/main/sessionStore')

/** `makeSession()` 默认那本书的路径——按书取会话文件之后，读也要带上它。 */
const SRC = '/tmp/测试书.txt'

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    novelTitle: '测试书',
    sourcePath: '/tmp/测试书.txt',
    ratio: 10,
    mode: 'ime',
    cursor: 120,
    revealStart: 0,
    chapterPos: [120, 0],
    activeChapter: 0,
    startedAt: null,
    ...overrides
  }
}

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-atomic-'))
  armed = false
  mockHits = 0
})
afterEach(() => {
  armed = false
  rmSync(dir, { recursive: true, force: true })
})

describe('writeSession 的原子替换', () => {
  it('一次半途而废的保存不得破坏上一份完好会话', () => {
    const store = createSessionStore(dir)
    const good = makeSession({ cursor: 4242 })
    store.writeSession(good)
    expect(store.readSession(SRC)).toEqual(good)

    armed = true
    store.writeSession(makeSession({ cursor: 999999 })) // 半途抛错，被 catch 吞掉
    armed = false

    // 前提自检：注入确实生效。少了这行，用例在「注入失效」时会静默退化成空跑。
    expect(mockHits).toBe(1)
    expect(store.readSession(SRC)).toEqual(good)
  })
})
```

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore } from '../../src/main/sessionStore'
import type { PersistedSession } from '../../src/core/types'

/** `makeSession()` 那本书的路径——进度按书存之后，读也要带上它。 */
const SRC = '/tmp/测试书.txt'

function makeSession(cursor: number): PersistedSession {
  return {
    novelTitle: '测试书',
    sourcePath: '/tmp/测试书.txt',
    ratio: 10,
    mode: 'ime',
    cursor,
    revealStart: 0,
    chapterPos: [cursor, 0],
    activeChapter: 0,
    startedAt: null
  }
}

// 【这条守卫钉的是机制，guardA.test.ts 钉的是性质——两条都在，理由如下】
// 它看的是「整份换掉」与「就地截断」留下的差别：renameSync 会给会话文件换上临时
// 文件的 inode，而 writeFileSync 对已存在的路径是原地截断、inode 不变。读文件【内容】
// 看不出这个差别——这正是原子性没有被任何内容级断言覆盖住的原因。
//
// 【为什么两条都要：实测的变异矩阵】同一批回退各跑一次，红/绿与「红在哪条断言上」
// 都是实测值——
//   把 temp+rename 换成直接写目标文件   → A 红（旧会话没活下来）  B 红（inode 没换）
//   renameSync 换成 copyFileSync        → A **绿**　　　　　　　 B 红（临时文件没被消费）
//   先把目标截断、再走 temp+rename       → A 红（旧会话没活下来）  B **绿**
//   只写临时文件、忘了改名               → A 红（第一次保存就读不回来）B 红（临时文件没被消费）
// 红在哪条【断言】上比行号可靠：行号会随注释本身改动而漂移（写这一条时就踩过一次——
// 引用的 61 在补完这段注释后变成了 71）。
// 第一行是两条的重叠（同一个回退的两个角度）。**第二、三行才是理由，而且两个方向各有一条**：
// copyFileSync 保留了目标的 inode、也不消费临时文件，所以 B 看得见；但「旧会话会不会在写入
// 半途而死时被毁」它看不见，那是 A 的事。反过来「先截断目标」把旧会话毁在原子步骤【之前】，
// A 立刻红，而 B 因为文件确实被整份换掉而全绿。各自都漏得掉一个回退，所以两条都留。
//
// 各自已知的盲区（同样实测得出）：A 的注入点固定在 writeFileSync 上，只覆盖「在那一行崩掉」，
// 所以 copyFileSync 自身的不原子（先截断目标、再拷贝）它看不见；B 只问「inode 换没换、
// 临时文件被没被消费」，所以「旧内容被毁、但文件确实被整份换掉」它看不见。
// **另一个守卫覆盖的正是对方的盲区。**
//
// B 的额外价值是不用 mock、在 jsdom 下原样可跑；A 的代价只是一个文件级 pragma（不是全局
// 配置）。将来实现若改用第三方的原子写工具，B 未必还观测得到有意义的东西，而 A 仍在测那件事。
//
// 【为什么这是确定成立的，而不只是这一次观测到】临时文件在改名【之前】就已创建，所以新
// inode 的分配发生在旧 inode 被释放之前，文件系统没有机会把它回收重用。实测连写 20 次：
// temp+rename 得到 20 个互不相同的 inode，改成直接写则 20 次都是同一个 inode。
//
// 【Windows 上跳过】这条守卫的前提是「inode 能区分不同文件」，而部分 Windows 与网络文件
// 系统对每个文件都报 0，于是【正确的实现】反而会红。Task 14 要做 Windows 验证，一条在正确
// 构建上失败的用例比没有用例更糟——会让人去找并不存在的缺陷。该平台上的性质由
// guardA.test.ts 覆盖，它不依赖 inode。
describe('会话文件是「整份换掉」而不是「就地截断」', () => {
  // 柯里化形式是唯一可用的形状：写成 it.skipIf(cond, name, fn) 时 Vitest 5 不报错，
  // 只是**一个用例都没注册**（整份文件报 "No test found in suite"），于是「加了守卫」
  // 会变成「守卫不在」。实测踩过。
  it.skipIf(process.platform === 'win32')(
    '重复写入后 inode 必须更换（换文件 = 读取方只会看到某一份完整文件）',
    (ctx) => {
      const dir = mkdtempSync(join(tmpdir(), 'wt-ino-'))
      try {
        const store = createSessionStore(dir)
        // 从目录里【找】那一份，而不是自己算一遍哈希：这条守卫问的是「写入有没有换掉文件」，
        // 文件名怎么来与它无关；照着实现算哈希会把守卫绑到实现的算法上。
        const sessionsDir = join(dir, 'sessions')
        const sessionPath = (): string => {
          const entries = readdirSync(sessionsDir)
          expect(entries.length).toBe(1) // 只有一本书被写过
          return join(sessionsDir, entries[0])
        }
        const tmpLeftover = (): string[] =>
          readdirSync(sessionsDir).filter((f) => f.endsWith('.tmp'))

        store.writeSession(makeSession(1))
        // 一次成功的保存不该留下临时文件：rename 会把 .tmp 消费掉。
        // 这一条就是矩阵 row B 的探测器：copyFileSync 保留了目标的 inode（所以 inode 断言
        // 也看得见它），但它【不消费】临时文件，于是 .tmp 留在磁盘上；「写了临时文件却忘了
        // 改名」同样被它抓住。放在 statSync 与 inode 断言【之前】，是为了让这两种回退红在
        // 这一条说得清原因的断言上——放到后面的话，「忘了改名」会让目标文件根本不存在，
        // 于是 statSync 先抛 ENOENT，红得看不出所以然（实测踩到过）。
        expect(tmpLeftover()).toEqual([])
        const first = statSync(sessionPath()).ino
        store.writeSession(makeSession(2))
        expect(tmpLeftover()).toEqual([])
        const second = statSync(sessionPath()).ino

        // 前提自检：这个文件系统确实给出有意义的 inode。报 0 时跳过而不是断言——
        // 在那种文件系统上这条守卫【按构造】无法工作，让它红等于谎报缺陷，
        // 而它声称覆盖的性质仍由 guardA.test.ts 守着。
        if (!(first > 0)) ctx.skip()
        expect(second).not.toBe(first)
        // 前提：第二次写真的发生了（否则 inode 变了也说明不了是这次写入造成的）
        expect(store.readSession(SRC)!.cursor).toBe(2)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  )
})
```

- [ ] **Step 11: Commit**

```bash
git add <本任务改动的显式路径…>   # 不要用 -A：见文件头「git add -A 只在独占一棵工作树时安全」
cat > /tmp/wt-commit-msg.txt <<'EOF'
feat(main): 小说加载、会话存储（纯函数可测）与启动参数解析
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## Task 6: IPC、Electron 绑定与原生菜单

**Files:**
- Create: `src/main/session.ts`, `src/main/ipc.ts`, `src/main/menu.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/unit/ipcContract.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `createSessionStore` / `loadNovelFromFile` / `resolveInitialNovelPath`；Task 2-4 的类型
- Produces:
  - `window.api`（渲染进程可见）：
    - `importNovel(): Promise<Novel | null>` —— null 表示用户取消
    - `openNovelPath(path: string): Promise<Novel>`
    - `loadSession(): Promise<PersistedSession | null>`
    - `saveSession(s: PersistedSession): Promise<void>`
    - `clearSession(): Promise<void>`
    - `initialNovelPath(): Promise<string | null>`
    - `onMenuCommand(cb: (cmd: string) => void): () => void`
  - IPC 通道名常量 `CH`（`wt:import-novel` / `wt:open-novel-path` / `wt:load-session` / `wt:save-session` / `wt:clear-session` / `wt:initial-novel-path`）
  - 菜单命令字符串：`'import-novel' | 'clear-session' | 'about'`

- [ ] **Step 1: 写失败测试 `tests/unit/ipcContract.test.ts`**

用**字符串常量契约测试**锁住通道名与 API 形状，避免主进程和 preload 各写各的导致运行时静默失败。

```ts
import { describe, it, expect } from 'vitest'
import { CH, MENU_COMMANDS } from '../../src/main/ipc'

describe('IPC 契约', () => {
  it('通道名稳定且带 wt: 前缀', () => {
    expect(CH).toEqual({
      importNovel: 'wt:import-novel',
      openNovelPath: 'wt:open-novel-path',
      loadSession: 'wt:load-session',
      saveSession: 'wt:save-session',
      clearSession: 'wt:clear-session',
      loadSettings: 'wt:load-settings',
      saveSettings: 'wt:save-settings',
      initialNovelPath: 'wt:initial-novel-path',
      menuCommand: 'wt:menu-command',
      getTheme: 'wt:get-theme',
      themeChanged: 'wt:theme-changed',
      setThemeSource: 'wt:set-theme-source'
    })
  })

  it('每一条通道名都唯一', () => {
    const values = Object.values(CH)
    expect(new Set(values).size).toBe(values.length)
  })

  it('菜单命令集合稳定', () => {
    expect(MENU_COMMANDS).toEqual(['import-novel', 'clear-session', 'about', 'toggle-devtools'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/ipcContract.test.ts`
Expected: FAIL —— 无法解析 `../../src/main/ipc`。

- [ ] **Step 3: 写 `src/main/ipc.ts`**

```ts
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { loadNovelFromFile } from './loadNovel'
import { getStore } from './session'
import type { Novel, PersistedSession } from '../core/types'

export const CH = {
  importNovel: 'wt:import-novel',
  openNovelPath: 'wt:open-novel-path',
  loadSession: 'wt:load-session',
  saveSession: 'wt:save-session',
  clearSession: 'wt:clear-session',
  initialNovelPath: 'wt:initial-novel-path',
  menuCommand: 'wt:menu-command'
} as const

export const MENU_COMMANDS = [
  'import-novel',
  'clear-session',
  'about',
  'toggle-devtools'
] as const

export type MenuCommand = (typeof MENU_COMMANDS)[number]

/** 打开小说：命中缓存则复用，避免重复解码与重新检测编码。 */
export function openNovel(filePath: string): Novel {
  const store = getStore()
  const cached = store.readNovelCache(filePath)
  if (cached) return cached
  const novel = loadNovelFromFile(filePath)
  store.writeNovelCache(novel)
  return novel
}

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  getInitialNovelPath: () => string | null
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

  ipcMain.handle(CH.openNovelPath, async (_e, filePath: string): Promise<Novel> => openNovel(filePath))

  ipcMain.handle(CH.initialNovelPath, (): string | null => deps.getInitialNovelPath())

  ipcMain.handle(CH.loadSession, (): PersistedSession | null => getStore().readSession())

  ipcMain.handle(CH.saveSession, (_e, session: PersistedSession): void => {
    getStore().writeSession(session)
  })

  ipcMain.handle(CH.clearSession, (): void => {
    getStore().clearAll()
  })
}
```

- [ ] **Step 4: 写 `src/main/session.ts`（Electron 绑定层）**

```ts
import { app } from 'electron'
import { createSessionStore, type SessionStore } from './sessionStore'

let store: SessionStore | null = null

/** 必须在 app ready 之后、且 setPath('userData') 之后调用。 */
export function getStore(): SessionStore {
  if (!store) {
    store = createSessionStore(app.getPath('userData'))
    // 迁移放在这里而不是 index.ts 的启动序列里：它是「第一次真正用到 store」的那一刻，
    // 而渲染层启动时问的第一件事就是设置——所以迁移一定发生在任何一次读取之前。
    // 写成幂等的（跑完就把旧文件删掉），进程内重复调用与多次启动都安全。
    store.migrateLegacySession()
  }
  return store
}

/**
 * 供 E2E / 便携模式在 setPath 之后重置缓存实例。
 *
 * 注意它生效的**前提**：只有在「store 已经被建出来之后」调用才有意义。
 * 在 `index.ts` 的调用位置（模块顶层、紧跟 applyUserDataOverride）它是**惰性的**——
 * store 是懒创建的，那时还没有人调用过 getStore()，所以那行是「把 null 置成 null」。
 * 不要把它的存在读成「启动时一定会按新的 userData 重新解析」。
 */
export function resetStore(): void {
  store = null
}
```

- [ ] **Step 5: 写 `src/main/menu.ts`**

```ts
import { app, Menu, shell, type BrowserWindow } from 'electron'
import { CH, type MenuCommand } from './ipc'

/**
 * 建原生应用菜单。**只有 macOS 会真的建出菜单**，见下面的注释。
 */
export function buildAppMenu(getWindow: () => BrowserWindow | null): void {
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
          accelerator: 'CmdOrCtrl+O',
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
```

- [ ] **Step 6: 重写 `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../main/ipc'

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
  }
}

contextBridge.exposeInMainWorld('api', api)

export type WtApi = typeof api
```

注意：preload import 了 `../main/ipc`，而 `ipc.ts` 会**传递地**拉到 `session.ts` → `sessionStore.ts`（`node:fs`）与 `loadNovel.ts`（`iconv-lite`）。**沙箱化的 preload 可以 `require('electron')`，但加载不了 Node 内建模块。** 实测（Task 6）：`Unable to load preload script` / `Error: module not found: node:fs`，`window.api === undefined`（而页面本身照常渲染）。**因此 `CH` 与 `MENU_COMMANDS` 必须放在一个零依赖的独立模块里**——`channels.ts` 实测 `imports: []`，拆出后 preload 只需 `electron`。

> 此前这里写的是「在 sandboxed preload 里 `ipcMain` 不可用，会导致运行时错误」——**约束对、机制错**。`ipcMain` 只是从 `require('electron')` 上读的一个属性，**读一个 undefined 属性不会抛**；真正在加载期抛的是 Node 内建模块。**照错误的机制去防，人会去防 `ipcMain` 而漏掉 `node:fs`**，所以这条必须按实测写。


**本步之后 `src/main/ipc.ts` 的最终全文**（`fence#2` 去掉本地 `CH` / `MENU_COMMANDS` / `MenuCommand` 三个定义，换成上面那两行，外加一段注释）：

```ts
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

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  getInitialNovelPath: () => string | null
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
```

- [ ] **Step 7: 拆出 `src/main/channels.ts`，修正上面的隐患**

`src/main/channels.ts`：
```ts
export const CH = {
  importNovel: 'wt:import-novel',
  openNovelPath: 'wt:open-novel-path',
  loadSession: 'wt:load-session',
  saveSession: 'wt:save-session',
  clearSession: 'wt:clear-session',
  loadSettings: 'wt:load-settings',
  saveSettings: 'wt:save-settings',
  initialNovelPath: 'wt:initial-novel-path',
  menuCommand: 'wt:menu-command',
  getTheme: 'wt:get-theme',
  themeChanged: 'wt:theme-changed',
  setThemeSource: 'wt:set-theme-source'
} as const

export const MENU_COMMANDS = [
  'import-novel',
  'clear-session',
  'about',
  'toggle-devtools'
] as const

export type MenuCommand = (typeof MENU_COMMANDS)[number]
```

`src/main/ipc.ts` 改为从 `./channels` 重新导出，并删掉本地的 `CH` / `MENU_COMMANDS` 定义：
```ts
import { CH } from './channels'
export { CH, MENU_COMMANDS, type MenuCommand } from './channels'
```

**两行都要有，只写第二行会挂。** `export … from` **不会在当前模块作用域绑定该名字**，而下面的 `registerIpc` 用了六次 `CH.*`；只写重新导出会得到 `TS2304: Cannot find name 'CH'`（外加五条同类错误），**而 `pnpm test` 仍然全绿**——因为 `ipcContract.test.ts` 只 import 那两个常量、从不执行 `registerIpc`。**这是一个「测试绿、typecheck 红」的形状**：那六处 `CH.*` 对测试不可见、只对 `tsc` 可见。（Task 6 实测。）

测试 `tests/unit/ipcContract.test.ts` 仍然 import `../../src/main/ipc`，接口不变，无需改动。

`src/preload/index.ts` 的 import 改为：
```ts
import { CH } from '../main/channels'
```

**本步之后 `src/preload/index.ts` 的最终全文**（上面那份只改了一行 import）：

```ts
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
  loadSession: (sourcePath: string) => ipcRenderer.invoke(CH.loadSession, sourcePath),
  saveSession: (session: unknown) => ipcRenderer.invoke(CH.saveSession, session),
  clearSession: () => ipcRenderer.invoke(CH.clearSession),
  loadSettings: () => ipcRenderer.invoke(CH.loadSettings),
  saveSettings: (settings: unknown) => ipcRenderer.invoke(CH.saveSettings, settings),
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
  setThemeSource: (source: 'system' | 'light' | 'dark'): Promise<void> =>
    ipcRenderer.invoke(CH.setThemeSource, source),
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
```

- [ ] **Step 8: 重写 `src/main/index.ts`**

```ts
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { buildAppMenu } from './menu'
import { resetStore } from './session'
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

  registerIpc({
    getWindow: () => win,
    getInitialNovelPath: () => initialNovelPath
  })
  buildAppMenu(() => win)
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
```

- [ ] **Step 9: 跑测试 + typecheck + 构建**

Run: `pnpm test`
Expected: 全绿（含 `ipcContract.test.ts`）。

Run: `pnpm typecheck`
Expected: exit 0。

Run: `pnpm build`
Expected: exit 0。

- [ ] **Step 10: 手动验证应用能启动**

Run: `pnpm dev`
Expected: 弹出窗口，标题为「文档1 - Word」，显示「Word 外壳占位」，菜单栏有 文件 / 编辑 / 视图 / 帮助。按 Ctrl+C 结束。

- [ ] **Step 11: Commit**

```bash
git add <本任务改动的显式路径…>   # 不要用 -A：见文件头「git add -A 只在独占一棵工作树时安全」
cat > /tmp/wt-commit-msg.txt <<'EOF'
feat(main): IPC 通道、会话绑定、原生菜单与启动流程
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## Task 7: Word 视觉外壳（布局与样式）

**Files:**
- Create: `src/renderer/src/styles/word.css`, `src/renderer/src/styles/ribbon.css`, `src/renderer/src/styles/page.css`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: 无（纯样式与布局骨架）
- Produces:
  - CSS 类名契约（后续任务依赖）：**下面 57 个是三份 CSS 里实际定义的全部 `.wt-*` 选择器**，Task 8–16 用到的每一个都在其中，且后续任务不再新建 CSS 文件——所以这些名字是公共契约，改名会静默打断后面的任务（而渲染层测试多半看不见）。本清单由 Task 7 交付后实测补全（原先是 17 个，漏了后半），后续每次改动都按「三份 CSS 里实际出现的 `.wt-*`」重扫一遍：
                    `.wt-app` `.wt-body` `.wt-btn` `.wt-btn--active` `.wt-btn--icon-only` `.wt-btn--large` `.wt-btn__icon` `.wt-btn__label` `.wt-canvas` `.wt-caret` `.wt-group` `.wt-group__body` `.wt-group__label` `.wt-input` `.wt-modal` `.wt-modal__body` `.wt-modal__check` `.wt-modal__close` `.wt-modal__close-icon` `.wt-modal__footer` `.wt-modal__header` `.wt-modal__label` `.wt-modal__label-icon` `.wt-modal__panel` `.wt-modal__row` `.wt-modal__text` `.wt-modal__title` `.wt-modal__title-icon` `.wt-page` `.wt-page__empty` `.wt-page__fold` `.wt-page__text` `.wt-ratio` `.wt-ratio__input` `.wt-ratio__label` `.wt-ribbon` `.wt-ribbon__title` `.wt-ribbon__title-app` `.wt-ribbon__title-doc` `.wt-seg` `.wt-sep` `.wt-sidebar` `.wt-sidebar__header` `.wt-sidebar__list` `.wt-sidebar__rail` `.wt-sidebar__rail-icon` `.wt-sidebar__sub` `.wt-sidebar__toggle` `.wt-sidebar__toggle-icon` `.wt-statusbar` `.wt-statusbar__dim` `.wt-statusbar__spacer` `.wt-tab` `.wt-tab--active` `.wt-tabs` `.wt-toast` `.wt-toolbar`

    （37 → 46 的变动来自 Task 16：删掉随「就地改名」一起作废的 `.wt-ribbon__title-input`，
    加上设置对话框那 10 个 `.wt-modal*`。对话框复用了既有的 `.wt-btn` 与 `.wt-ratio*`。）
  - `App.tsx` 渲染出 `.wt-app` 骨架，含 `data-testid="app-root"`
  - `<Ribbon docTitle={string} onDocTitleChange={(t: string) => void} />`：蓝条上的文档名，**由用户自己定、与 `novel.title` 无关**；`data-testid="doc-title"`
    （原本是就地改名的按钮 + `doc-title-input`；Task 16 起蓝条上只剩一段静态文本，
    改名挪进设置对话框，`doc-title-input` 那个 testid 跟着搬过去）

- [ ] **Step 1: 写 `src/renderer/src/styles/word.css`**

```css
/**
 * 设计 token + 外壳骨架。
 *
 * 【这一版是往「今天的 Word」靠，不是往「好看的通用应用」靠】这个应用的全部价值在于
 * 看起来像大家熟悉的 Word。所以改了观感，但**没有改结构**：还是标题条 + 选项卡 + 功能区，
 * 还是灰底上一张白纸。变的只是"哪一代的 Word"——从 2013 那版（发灰的蓝、发丝边、
 * 中灰画布、极小字号）挪到 M365 / Fluent 2 那一版。
 *
 * 【色值是照着实机观感挑的，不是微软的设计 token】下面这些十六进制值是我按"看起来对"
 * 定的，没有从 Fluent 的设计规范里抄。要再调就照观感调，别把它们当成权威值引用。
 */
:root {
  /* Word 的品牌蓝。2013 那版是 #2b579a（偏灰、偏暗）；今天更亮、更饱和。
     `--wt-blue` 是【强调色】（选中态、焦点环、进度条…），`--wt-titlebar` 是标题条底色——
     两者在浅色下同一个值，但深色下必须分开：真 Word 的深色模式里标题条是深灰的，
     强调色反而要提亮，共用一个变量就没法同时满足。 */
  --wt-blue: #185abd;
  --wt-blue-dark: #0f4a9e;
  --wt-blue-light: #eaf1fb;
  --wt-accent: #185abd;
  --wt-titlebar: #185abd;

  /* 实心主按钮（对话框里的「保存」）的底与悬停。
     **刻意不复用 `--wt-blue`**：深色下那个被【提亮】成 #6cb0ff，那是给深底上的文字/图标用的
     强调色，拿它当实心按钮的底就是白字压浅蓝（对比度约 2:1，基本读不出来），而且它的
     「hover」在深色下更浅（`--wt-blue-dark` = #a5cfff），越划过越糊。
     与 `--wt-titlebar` / `--wt-statusbar` 是同一个理由：**一个值要在两种主题下扮演两种角色，
     就必须拆成两个变量**。 */
  --wt-primary: #185abd;
  --wt-primary-hover: #0f4a9e;

  /* 中性阶：现代 Word 的 chrome 是极浅的冷灰，不是纯白，也不是 2013 那个 #f3f3f3 */
  --wt-chrome: #f7f7f8;
  --wt-chrome-border: #e3e3e5;
  --wt-chrome-border-strong: #d2d2d6;
  --wt-text: #242424;
  --wt-text-muted: #616161;

  --wt-statusbar: #185abd;
  --wt-titlebar-text: #ffffff;

  /* 画布：2013 是 #9e9e9e 的中灰，今天的 Word 浅得多，纸张才跳得出来 */
  --wt-canvas: #e9e9ec;
  --wt-page-shadow:
    0 1px 2px rgba(0, 0, 0, 0.08),
    0 8px 28px rgba(0, 0, 0, 0.1);

  --wt-radius: 4px;
  --wt-radius-lg: 6px;

  /* macOS 上 Segoe UI 不存在，会落到 PingFang SC（中文）与 -apple-system（拉丁）；
     Windows 上则命中 Segoe UI Variable。两边都拿到本机的现代系统字体。 */
  --wt-font:
    -apple-system, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui,
    sans-serif;

  /* 告诉 Chromium「本页按浅色渲染原生控件」。
     这一条同时管住：滚动条、`<input type="checkbox">` 这类原生控件、以及默认底色。
     不设的话深色外观下侧栏与画布的滚动条仍是浅色（用户实测报的就是这个），
     而设置里那个复选框也会是一块刺眼的白。 */
  color-scheme: light;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--wt-font);
  font-size: 13px;
  color: var(--wt-text);
  background: var(--wt-chrome);
  overflow: hidden;
  user-select: none;
  -webkit-font-smoothing: antialiased;
}

.wt-app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.wt-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.wt-canvas {
  flex: 1;
  overflow: auto;
  background: var(--wt-canvas);
  padding: 28px 0 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}

.wt-sidebar {
  width: 240px;
  flex: 0 0 240px;
  background: #fbfbfc;
  border-right: 1px solid var(--wt-chrome-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.wt-sidebar__header {
  position: relative;
  /* 右侧留出收起按钮的位置，免得书名长的时候文字压到按钮底下 */
  padding: 12px 32px 12px 14px;
  border-bottom: 1px solid var(--wt-chrome-border);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.01em;
}

.wt-sidebar__toggle,
.wt-sidebar__rail {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--wt-text-muted);
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--wt-radius);
}

.wt-sidebar__toggle {
  position: absolute;
  top: 8px;
  right: 6px;
  width: 22px;
  height: 22px;
}

.wt-sidebar__toggle:hover,
.wt-sidebar__rail:hover {
  background: #e8e8ea;
  color: var(--wt-text);
}

/* 收起后整条侧栏只剩这条 12px 的细缝：颜色很淡、视觉上近乎不存在，但鼠标用户得有入口
   把它调回来——那个快捷键是新用户不会知道的，全无入口等于收起即锁死。 */
.wt-sidebar__rail {
  flex: 0 0 12px;
  width: 12px;
  border-right: 1px solid var(--wt-chrome-border);
  background: #fbfbfc;
  color: #c8c8cc;
}

.wt-sidebar__rail:hover {
  color: var(--wt-text);
}

.wt-sidebar__sub {
  font-weight: 400;
  color: var(--wt-text-muted);
  font-size: 11px;
  margin-top: 2px;
}

.wt-sidebar__list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.wt-statusbar {
  display: flex;
  align-items: center;
  gap: 18px;
  height: 26px;
  flex: 0 0 26px;
  padding: 0 14px;
  background: var(--wt-statusbar);
  color: var(--wt-titlebar-text);
  font-size: 11px;
  white-space: nowrap;
  letter-spacing: 0.01em;
}

.wt-statusbar__spacer {
  flex: 1;
}

.wt-toast {
  position: fixed;
  left: 50%;
  bottom: 60px;
  transform: translateX(-50%);
  background: rgba(28, 28, 30, 0.94);
  color: #ffffff;
  padding: 10px 18px;
  border-radius: var(--wt-radius-lg);
  font-size: 12px;
  z-index: 999;
  pointer-events: none;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
}

/* 侧栏那两个三角形按钮的图标尺寸：Fluent 图标默认 1em，这里显式定死，
   免得受父级 font-size 影响（rail 的 font-size 与 toggle 不同）。 */
.wt-sidebar__toggle-icon,
.wt-sidebar__rail-icon {
  width: 12px;
  height: 12px;
}

/* ================= 深色外观 =================
 *
 * 【为什么不写 @media (prefers-color-scheme: dark)】实测过：这个应用里那条 media query
 * **恒不命中**——主进程 `nativeTheme.shouldUseDarkColors` 是 true、`themeSource` 手动设成
 * 'dark' 之后连整窗重载都仍然是 false（见 preload 与 state/theme.ts 里的说明）。
 * 所以主题由主进程经 IPC 递过来，写成 `<html data-theme="dark">`，这里按属性选择器取。
 *
 * 浅色是默认：`data-theme="light"` 或没有这个属性时都走上面 :root 那套。
 */
[data-theme='dark'] {
  /* 深色下把原生控件也切过去：滚动条、复选框、默认底色一起变。
     这是修「滚动条没做深色适配」的正解——比手写 ::-webkit-scrollbar 覆盖面广得多，
     而且滚动条会跟系统一致（macOS 上就是那条半透明的浮层滚动条）。 */
  color-scheme: dark;

  /* 强调色在深色下要【提亮】——原色 #185abd 压在深灰上几乎看不见 */
  --wt-blue: #6cb0ff;
  --wt-blue-dark: #a5cfff;
  --wt-blue-light: #2b2b34;
  --wt-accent: #6cb0ff;

  /* 主按钮**不跟着提亮**：它是「深底 + 白字」的实心块，要压得住面板（#26262c）而不是浮在上面。
     取比浅色主题那一版稍亮一点的蓝，白字对比度约 5:1；悬停再亮一档（深色下悬停变亮才像话）。 */
  --wt-primary: #2b6fc4;
  --wt-primary-hover: #3a80d8;

  /* 标题条与状态条在真 Word 的深色模式里是深灰，不是品牌蓝——两者在浅色下同值，
     所以上面 :root 里拆成了两个变量。 */
  --wt-titlebar: #1f1f22;
  --wt-titlebar-text: #f0f0f2;
  --wt-statusbar: #1f1f22;

  --wt-chrome: #202024;
  --wt-chrome-border: #33333a;
  --wt-chrome-border-strong: #45454e;
  --wt-text: #e6e6ea;
  --wt-text-muted: #9c9ca6;

  --wt-canvas: #151518;
  --wt-page-shadow:
    0 1px 2px rgba(0, 0, 0, 0.55),
    0 10px 30px rgba(0, 0, 0, 0.5);
}

[data-theme='dark'] .wt-sidebar {
  background: #1c1c20;
}

[data-theme='dark'] .wt-sidebar__toggle:hover,
[data-theme='dark'] .wt-sidebar__rail:hover {
  background: #2e2e35;
}

[data-theme='dark'] .wt-sidebar__rail {
  background: #1c1c20;
  color: #55555e;
}

/* 状态栏里刻意压低一档的信息（目前只有那个章节位置）。
   它得在，但不该抢眼——见 StatusBar.tsx 顶部那段说明。 */
.wt-statusbar__dim {
  opacity: 0.66;
}
```

- [ ] **Step 2: 写 `src/renderer/src/styles/ribbon.css`**

```css
/* 标题条 + 选项卡 + 功能区 + 设置对话框。
   尺寸与层级按今天的 Word 调过：标题条 32px、选项卡 34px、功能区 92px，
   切换按钮用「未按下线框 / 按下实心」的图标对（见 icons.tsx）。 */

.wt-ribbon {
  flex: 0 0 auto;
  background: var(--wt-chrome);
}

.wt-ribbon__title {
  display: flex;
  align-items: center;
  /* 三个子元素是「文档名 / - / Word」，要挨着排成一个标题；10px 的 gap 会把它拉成
     「文档1  -  Word」，不像标题。连字符两侧的呼吸感由它自己的左右外边距给。 */
  gap: 5px;
  height: 32px;
  padding: 0 14px;
  background: var(--wt-titlebar);
  color: var(--wt-titlebar-text);
  font-size: 12px;
  letter-spacing: 0.01em;
}

.wt-ribbon__title-app {
  font-weight: 600;
}

/* 蓝条上的文档名。**一段静态文本**：改名搬进了设置对话框，这里不再可点——
   一个能点开输入框的「文档1」正是伪装里最显眼的那类破绽。
   仍旧做成独立元素（而不是并在 title-app 里）是为了 `doc-title` 这个 testid；
   同理，下面那个连字符也是独立元素——一旦并进这个 span，`doc-title` 的 textContent
   就不再是「文档1」而是「文档1 - Word」，多处断言都会跟着变。 */
.wt-ribbon__title-doc {
  opacity: 0.88;
}

/* 「文档1 - Word」里那个连字符。压暗一档，让两个实词更清楚。 */
.wt-ribbon__title-sep {
  opacity: 0.6;
}

.wt-tabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 0 10px;
  height: 34px;
  /* 与标题条共用同一个 token：两条合成一整块蓝。这正是真 Word「彩色」主题的样子——
     标题栏与标签条同色，选中的页签是一块从白色功能区升上来的白形状，靠「与下方功能区
     连成一片」表达选中，而不是靠描边。深色下这个 token 是近黑，但标签条另有覆盖，见
     文件末尾那段深色外观。 */
  background: var(--wt-titlebar);
}

.wt-tab {
  border: none;
  background: transparent;
  padding: 6px 14px 7px;
  font-size: 12.5px;
  font-family: inherit;
  /* 蓝底上写白字。用 --wt-titlebar-text 而不是写死 #fff：深色下标签条是近黑，
     这个 token 也跟着翻成浅色。 */
  color: var(--wt-titlebar-text);
  cursor: pointer;
  border-radius: var(--wt-radius-lg) var(--wt-radius-lg) 0 0;
  transition: background-color 90ms ease;
}

/* 未选中的页签在蓝底上不能压暗——压暗出来是脏蓝，不是「次要」。用一层半透明白提亮。 */
.wt-tab:hover {
  background: rgba(255, 255, 255, 0.16);
  color: var(--wt-titlebar-text);
}

/* 选中态靠「与下方白色功能区连成一片」表达，而不是加一圈描边——
   这正是 Word 的做法，也是这一版和 2013 那版观感差别最大的地方。 */
.wt-tab--active {
  background: #ffffff;
  color: var(--wt-blue);
  font-weight: 600;
}

/* 悬停**已经选中的**那个页签时，要维持它「与下方功能区连成一片」的样子。
   没有这一条会坏在特异度上：`.wt-tab:hover` 是 (0,2,0)，`.wt-tab--active` 只有 (0,1,0)，
   前者盖后者——白底被换成 16% 的半透明白、字色也翻成白色，在蓝底标签条上就是
   「一块淡蓝 + 白字看不见」。本条特异度与 `.wt-tab:hover` **相同**，靠**源码顺序**
   （排在它之后）胜出，所以不能往上挪。 */
.wt-tab--active:hover {
  background: #ffffff;
  color: var(--wt-blue);
}

.wt-toolbar {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 6px 8px 4px;
  min-height: 92px;
  background: #ffffff;
  border-bottom: 1px solid var(--wt-chrome-border);
  overflow-x: auto;
}

.wt-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 12px;
  border-right: 1px solid var(--wt-chrome-border);
}

.wt-group:last-child {
  border-right: none;
}

/* 组内的排布：**两行、按列填充**。
 *
 * 这正是真 Word 功能区的排法——小按钮分两行填满组高，大按钮占满整列。
 * `grid-auto-flow: column` + 固定两行 = 先把第一列的两个位置填掉、再开下一列。
 * 于是「剪贴板」组按 [粘贴(大), 剪切, 复制, 格式刷(大)] 的顺序自然排成
 *
 *     粘贴 | 剪切 | 格式刷
 *          | 复制 |
 *
 * 而不用在数据里描述任何位置。哪些项占满整列，见下面 `grid-row: span 2` 那组规则。
 */
.wt-group__body {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(2, auto);
  align-items: center;
  justify-items: center;
  gap: 2px;
}

/* 占满整列（跨两行）的几种控件：大按钮、下拉框、样式库。
   小按钮（含分割按钮）只占一格，两行填满时才是 Word 那个样子。 */
.wt-btn--large,
.wt-combo,
.wt-gallery {
  grid-row: span 2;
}

.wt-group__label {
  font-size: 10.5px;
  color: var(--wt-text-muted);
  margin-top: 5px;
  white-space: nowrap;
}

.wt-btn {
  min-width: 28px;
  height: 28px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: var(--wt-radius);
  background: transparent;
  color: var(--wt-text);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
  transition:
    background-color 90ms ease,
    border-color 90ms ease;
}

.wt-btn:hover {
  background: var(--wt-blue-light);
  border-color: #c4d9f5;
}

.wt-btn:active {
  background: #d3e3fa;
}

/* 按下态（加粗/斜体/对齐这类切换按钮）。图标本身也会从线框换成实心，见 icons.tsx。 */
.wt-btn--active {
  background: #d3e3fa;
  border-color: #a8c7ef;
}

/* 大按钮：图标在上、标签在下（新建/保存/导入这类）。真 Word 就是这么混着排的。 */
.wt-btn--large {
  flex-direction: column;
  gap: 4px;
  width: 62px;
  height: 64px;
  padding: 8px 4px 6px;
}

.wt-btn--large .wt-btn__icon {
  width: 24px;
  height: 24px;
}

.wt-btn__icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.wt-btn__label {
  font-size: 11px;
  line-height: 1;
}

/* 有图标的小按钮只显示图标（Word 的 B/I/U 那一排就没有可见文字）。
   标签用「视觉隐藏」而不是 display:none —— 后者会把它从无障碍树里也拿掉。 */
.wt-btn--icon-only {
  width: 28px;
  padding: 0;
}

/* 没有图标的按钮（宋体 / 五号 / 标题 1 / 正文）画成带框的组合框观感——
   真 Word 里这几个正是有边框的下拉框，光秃秃一片文字会显得没做完。
 *
 * 【`:not(.wt-btn--active)` 不能省】这条规则的特异性是 (0,4,0)（三个 `:not()` 各自都算），
 * 压得过 `.wt-btn--active` 的 (0,1,0)。少了这个 `:not`，选中态的背景会被它整个吃掉——
 * 实测过：设置里「外观」那三个按钮的 aria-pressed 正确切换、而三个背景色一模一样。
 *
 * 【`:not(.wt-btn--primary)` 同理，这一条是踩过才补的】主按钮那条只有 (0,2,0)，压不过这条
 * (0,4,0)。少了这个 `:not`，对话框里的「保存」会是**近白底 + 白字**（`color: #fff` 来自主按钮
 * 规则，而这条例外只让开了背景）——等于一个字都看不见。一切「靠底色区分主次」的按钮变体都要
 * 加进这份排除名单，否则它的背景会被这条吃掉。 */
.wt-btn:not(.wt-btn--large):not(.wt-btn--active):not(.wt-btn--primary):not(:has(.wt-btn__icon)) {
  border-color: var(--wt-chrome-border-strong);
  background: #fbfbfc;
  padding: 0 10px;
}

.wt-btn--icon-only .wt-btn__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* ---- 下拉框（字体名 / 字号 / 行距） ----
 *
 * 它是 `<button>` 而不是原生 `<select>`。原因见 `Toolbar.tsx` 里 Combo 的注释：
 * `select` 在 InputCapture 的焦点豁免名单里，点一下焦点就留在它身上，之后敲键盘
 * 既不打字也不抽字。做成按钮才会走「mousedown 时把焦点抢回 textarea」那条路。
 */
.wt-combo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  height: 28px;
  padding: 0 6px 0 10px;
  border: 1px solid var(--wt-chrome-border-strong);
  border-radius: var(--wt-radius);
  background: #fbfbfc;
  color: var(--wt-text);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.wt-combo:hover {
  background: var(--wt-blue-light);
  border-color: #a8c7ef;
}

.wt-combo__value {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.wt-combo__caret {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  color: var(--wt-text-muted);
}

/* 弹出层 portal 到了 body，所以 `position: fixed` 相对视口；坐标由 JS 从按钮的
   getBoundingClientRect() 算。jsdom 没有布局、rect 全是 0，那不影响测试断言。 */
.wt-combo__panel {
  position: fixed;
  z-index: 60;
  min-width: 96px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--wt-chrome-border-strong);
  border-radius: var(--wt-radius);
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}

.wt-combo__option {
  display: block;
  width: 100%;
  padding: 5px 10px;
  border: none;
  border-radius: var(--wt-radius);
  background: transparent;
  color: var(--wt-text);
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.wt-combo__option:hover {
  background: var(--wt-blue-light);
}

.wt-combo__option--active {
  background: #d3e3fa;
}

/* ---- 样式库 ----
 * 与下拉框不同，展开就是全部选项，所以直接在流内排开、不需要弹层，
 * 也就不涉及焦点问题——每一项本身是 `<button>`。
 */
.wt-gallery {
  display: flex;
  gap: 2px;
}

.wt-gallery__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 58px;
  padding: 5px 2px 4px;
  border: 1px solid transparent;
  border-radius: var(--wt-radius);
  background: transparent;
  color: var(--wt-text);
  font-family: inherit;
  cursor: pointer;
}

.wt-gallery__item:hover {
  background: var(--wt-blue-light);
  border-color: #c4d9f5;
}

.wt-gallery__item--active {
  background: #ffffff;
  border-color: var(--wt-chrome-border-strong);
}

.wt-gallery__preview {
  font-size: 13px;
  line-height: 1;
  letter-spacing: -0.02em;
}

.wt-gallery__name {
  font-size: 10.5px;
  line-height: 1;
  color: var(--wt-text-muted);
  white-space: nowrap;
}

/* ---- 分割按钮（下划线 / 项目符号 / 编号）----
 * 主体与箭头贴在一起、合起来看才像一个控件，所以贴边那侧的圆角归零。
 * 两条规则的特异性都是 (0,1,0)，靠**源码顺序**压过上面 `.wt-btn` 的全圆角——别往上挪。
 */
.wt-split {
  display: flex;
  align-items: center;
}

.wt-split__main {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.wt-split__arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-left: none;
  border-top-right-radius: var(--wt-radius);
  border-bottom-right-radius: var(--wt-radius);
  background: transparent;
  color: var(--wt-text-muted);
  cursor: pointer;
}

.wt-split__arrow:hover {
  background: var(--wt-blue-light);
  border-color: #c4d9f5;
}

.wt-split__caret {
  width: 10px;
  height: 10px;
}

.wt-sep {
  width: 1px;
  height: 22px;
  background: var(--wt-chrome-border);
  margin: 0 5px;
}

.wt-ratio {
  display: flex;
  align-items: center;
  gap: 5px;
}

/* 「阅读替换」的两格（全局 / 当前书）：一行一个，竖着排。
   横排的话两行说明文字会把这一行撑得很宽，而对话框的行是「标签 + 内容」两列。 */
.wt-ratio-pair {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 一格：输入框在前、说明文字在后（说明里带着「全局/当前书」与它的作用）。
   竖着对齐而不是居中——两行的说明文字长度不同，居中会让两个输入框错开。 */
.wt-ratio-line {
  display: flex;
  align-items: center;
  gap: 5px;
}

/* 两格的标签（全局 / 当前书）。定宽，让两行的输入框竖直对齐。 */
.wt-ratio__caption {
  width: 44px;
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--wt-text);
}

/* 跟在后面的一句小字（「新导入的书用它」/「未打开小说」）。 */
.wt-ratio__note {
  font-size: 11px;
  color: var(--wt-text-muted);
}

/*
 * 「当前书」那格在没打开小说时禁用：没有书就没有「当前书」。
 *
 * 【必须让它看得出来，而且光靠底色不够】`.wt-ratio__input` 本来就没设 background，
 * 靠的是浏览器给输入框的默认白底；拿 `--wt-chrome`（#f7f7f8）当禁用底色，两者在浅色下
 * 几乎一模一样——真机截图里根本分不出哪格是禁用的。所以这里叠一层半透明：
 * 它在两种主题下都与可用态明显不同。 */
.wt-ratio__input:disabled {
  background: var(--wt-chrome);
  color: var(--wt-text-muted);
  opacity: 0.55;
  cursor: not-allowed;
}

.wt-ratio__label {
  font-size: 11px;
  color: var(--wt-text-muted);
}

.wt-ratio__input {
  width: 58px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--wt-chrome-border-strong);
  border-radius: var(--wt-radius);
  font-family: inherit;
  font-size: 12px;
  text-align: center;
}

.wt-ratio__input:focus {
  outline: none;
  border-color: var(--wt-accent);
  box-shadow: 0 0 0 2px rgba(24, 90, 189, 0.22);
}

/* ---- 设置对话框 ---- */

/* 遮罩铺满窗口。z-index 刻意【低于】.wt-toast 的 999：比例夹紧的提示是从对话框里发出来
   的，压在遮罩上才看得见；反过来就被遮罩盖住了。 */
.wt-modal {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(1.5px);
}

.wt-modal__panel {
  width: 440px;
  max-width: calc(100% - 48px);
  background: #ffffff;
  border-radius: 8px;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.14),
    0 24px 56px rgba(0, 0, 0, 0.26);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 标题条沿用蓝条的配色：Word 的「选项」对话框也是这个观感 */
.wt-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 8px 0 16px;
  background: var(--wt-titlebar);
  color: var(--wt-titlebar-text);
  font-size: 13px;
}

.wt-modal__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.wt-modal__title-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}

.wt-modal__close {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--wt-radius);
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.wt-modal__close-icon {
  width: 12px;
  height: 12px;
}

.wt-modal__close:hover {
  background: rgba(255, 255, 255, 0.22);
}

.wt-modal__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 18px;
}

.wt-modal__row {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 每行的标签：一个小图标 + 文字。加了图标之后基准宽度要放宽，
   否则「阅读替换」这种四字标签会把右边的控件推歪。 */
.wt-modal__label {
  flex: 0 0 96px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--wt-text-muted);
}

.wt-modal__label-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: var(--wt-accent);
}

.wt-modal__text {
  flex: 1;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--wt-chrome-border-strong);
  border-radius: var(--wt-radius);
  font-family: inherit;
  font-size: 12px;
}

.wt-modal__text:focus {
  outline: none;
  border-color: var(--wt-accent);
  box-shadow: 0 0 0 2px rgba(24, 90, 189, 0.22);
}

.wt-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 18px 18px;
}

/* 面板里的按钮要有实边框：`.wt-btn` 在工具栏里靠 hover 才有轮廓，放到白底上会像纯文本 */
.wt-modal__body .wt-btn,
.wt-modal__footer .wt-btn {
  border-color: var(--wt-chrome-border-strong);
  padding: 0 14px;
  height: 30px;
}

.wt-modal__body .wt-btn:hover,
.wt-modal__footer .wt-btn:hover {
  border-color: #c4d9f5;
}

/*
 * 「保存」是主按钮：真 Word 的对话框里确定键就是蓝底白字，与旁边的「关闭」拉开主次。
 *
 * 【必须排在上面那两条 `.wt-modal__footer .wt-btn` 之后】同特异度 (0,2,0) 靠源码顺序决胜，
 * 上移的话底色会被上面那条吃掉。深色那侧另有一处同名排除，见下面 `:not(.wt-btn--primary)`。
 */
.wt-modal__footer .wt-btn--primary {
  background: var(--wt-primary);
  border-color: var(--wt-primary);
  color: #fff;
}

.wt-modal__footer .wt-btn--primary:hover {
  background: var(--wt-primary-hover);
  border-color: var(--wt-primary-hover);
}

/* 按下态也要单独写：`.wt-btn:active` 是 (0,2,0) 且只管背景，不管的话按下去会闪成浅蓝底
   （`.wt-btn:active` 的 #d3e3fa），配着蓝边框看起来像按钮坏了。 */
.wt-modal__footer .wt-btn--primary:active {
  background: var(--wt-primary-hover);
}

/* ================= 深色外观 =================
   这里只放【写死了浅色值】的那些规则；能用 token 表达的在 word.css 里已经跟着翻了。 */
/* 深色下**不**跟 --wt-titlebar（那是 #1f1f22）走：选中页签的底色与功能区同为 #202024，
   标签条若也落在 #1f1f22 就只差一档，「选中页签与下方功能区连成一片」当场看不出来。
   压到 #191919 拉开一档，选中态才立得住。 */
[data-theme='dark'] .wt-tabs {
  background: #191919;
}

[data-theme='dark'] .wt-tab:hover {
  background: rgba(255, 255, 255, 0.07);
}

/* 选中页签仍靠「与下方功能区连成一片」表达：两边用同一个底色 */
[data-theme='dark'] .wt-tab--active {
  background: #202024;
  color: var(--wt-accent);
}

/* 与浅色那条同理，只是这里两边都多一个属性选择器：`[data-theme='dark'] .wt-tab:hover`
   是 (0,3,0)，`[data-theme='dark'] .wt-tab--active` 是 (0,2,0)，前者照样盖后者。
   本条 (0,3,0) 且排在后面，胜出。 */
[data-theme='dark'] .wt-tab--active:hover {
  background: #202024;
  color: var(--wt-accent);
}

[data-theme='dark'] .wt-toolbar {
  background: #202024;
}

/* 下拉框与样式库那几处写死的浅色值。悬停用的是 --wt-blue-light，那个 token 自己会翻。 */
[data-theme='dark'] .wt-combo {
  background: #2a2a31;
}

[data-theme='dark'] .wt-combo__panel {
  background: #26262c;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

[data-theme='dark'] .wt-combo__option--active {
  background: #3a3a44;
}

[data-theme='dark'] .wt-gallery__item--active {
  background: #2a2a31;
}

/* 【`:not(.wt-btn--primary)` 与 `:not(.wt-btn--active)` 同理，不能省】这条链的特异度是
   (0,5,0)（`[data-theme]` + `.wt-btn` + 三个 `:not()` 各自的简单选择器），压得过主按钮那条
   (0,2,0)。少了这个 `:not`，深色下「保存」会被铺成灰底——蓝底白字正是它区别于「关闭」的地方。 */
[data-theme='dark']
  .wt-btn:not(.wt-btn--large):not(.wt-btn--active):not(.wt-btn--primary):not(:has(.wt-btn__icon)) {
  background: #2a2a31;
}

[data-theme='dark'] .wt-btn:hover {
  border-color: #3d4d66;
}

[data-theme='dark'] .wt-btn:active,
[data-theme='dark'] .wt-btn--active {
  background: #2c3a52;
  border-color: #405a80;
}

[data-theme='dark'] .wt-modal {
  background: rgba(0, 0, 0, 0.52);
}

[data-theme='dark'] .wt-modal__panel {
  background: #26262b;
}

[data-theme='dark'] .wt-modal__close:hover {
  background: rgba(255, 255, 255, 0.14);
}

[data-theme='dark'] .wt-ratio__input,
[data-theme='dark'] .wt-modal__text {
  background: #1c1c20;
  color: var(--wt-text);
}

[data-theme='dark'] .wt-modal__body .wt-btn:hover,
[data-theme='dark'] .wt-modal__footer .wt-btn:hover {
  border-color: #3d4d66;
}

/* 主按钮的悬停 / 按下在深色下也要保住蓝底蓝边：上面那条与主按钮同特异度 (0,3,0)、
   靠源码顺序压过去，而 `.wt-btn:active` 那一对同样是 (0,3,0)。不写这两条的话，
   鼠标一划过或一按下，「保存」就变成灰边 / 暗蓝灰底。 */
[data-theme='dark'] .wt-modal__footer .wt-btn--primary:hover,
[data-theme='dark'] .wt-modal__footer .wt-btn--primary:active {
  background: var(--wt-primary-hover);
  border-color: var(--wt-primary-hover);
}

/* 复选框那行 */
.wt-modal__check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  cursor: pointer;
}

.wt-modal__check input {
  width: 14px;
  height: 14px;
  accent-color: var(--wt-accent);
  cursor: pointer;
}

[data-theme='dark'] .wt-modal__check input {
  accent-color: var(--wt-accent);
}

/* ---- 平台各自的标题条 ----
 *
 * 两个平台都把原生标题栏交给了网页画（见 `src/main/index.ts` 的 `titleBarOptions`），
 * 所以这一条在两边都是窗口**唯一的拖拽区**——`-webkit-app-region: drag` 不设，
 * 窗口就没法用鼠标移动。行内没有可交互元素（文档名现在是静态文本），
 * 所以不需要再挑出 no-drag 的例外。
 *
 * 标题在两个平台都**居中**，区别只在要给系统让出多宽。既然要居中，留白就必须**两侧
 * 对称**——只留一侧会把标题顶偏，而两侧都留不影响居中，只是可用宽度窄一点：
 *  - macOS（`hiddenInset`）：红绿灯浮在网页上、落在这一行里。要让开的是 78px
 *    （三个灯 + 间距约 52px，从 x=14 起）。
 *  - Windows（`hidden` + `titleBarOverlay`）：右上角那三个按钮由系统画在这一行上，
 *    约 138px（三枚 × 46px），两边各让 150px 留点余量。
 */
[data-platform='darwin'] .wt-ribbon__title {
  padding: 0 78px;
  justify-content: center;
  -webkit-app-region: drag;
}

[data-platform='win32'] .wt-ribbon__title {
  padding: 0 150px;
  justify-content: center;
  -webkit-app-region: drag;
}

/* 分段控件（设置里的「外观」三选一）。真 Word 的「Office 主题」是个下拉框，
   三个选项用分段按钮更好按、也更好看出当前选的是哪个。 */
.wt-seg {
  display: inline-flex;
  border: 1px solid var(--wt-chrome-border-strong);
  border-radius: var(--wt-radius);
  overflow: hidden;
}

.wt-seg .wt-btn {
  border: none;
  border-radius: 0;
  height: 28px;
  padding: 0 12px;
}

.wt-seg .wt-btn + .wt-btn {
  border-left: 1px solid var(--wt-chrome-border-strong);
}

/* 分段控件的选中态用**实心强调色**，而不是在浅底上再压一层浅底——
   后者在两种主题下都几乎看不出来（实测：深色下未选/已选分别是 #2a2a31 与 #2c3a52，
   人眼分不出）。这是设置里唯一需要「一眼看出选了哪个」的控件。 */
.wt-seg .wt-btn--active,
.wt-seg .wt-btn--active:hover {
  background: var(--wt-accent);
  color: #ffffff;
  font-weight: 600;
}

[data-theme='dark'] .wt-seg .wt-btn--active,
[data-theme='dark'] .wt-seg .wt-btn--active:hover {
  /* 深色下强调色是浅蓝，配深字对比最强 */
  color: #10141a;
}
```

- [ ] **Step 3: 写 `src/renderer/src/styles/page.css`**

```css
.wt-page {
  width: 794px;
  min-height: 1080px;
  background: #ffffff;
  /* 投影走 token：画布变浅之后，原来那圈重投影会显得很脏 */
  box-shadow: var(--wt-page-shadow);
  padding: 72px 84px 96px;
  font-family: Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif;
  font-size: 15px;
  line-height: 1.9;
  color: #1a1a1a;
  position: relative;
  flex: 0 0 auto;
}

.wt-page__text {
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 40px;
}

.wt-caret {
  display: inline-block;
  width: 1px;
  height: 1.15em;
  background: #1a1a1a;
  vertical-align: text-bottom;
  animation: wt-blink 1.06s steps(1, end) infinite;
}

@keyframes wt-blink {
  0%,
  49% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

.wt-page__empty {
  color: #a8a8ad;
  font-family: var(--wt-font);
  font-size: 13px;
  line-height: 1.9;
}

.wt-page__fold {
  font-family: var(--wt-font);
  font-size: 12px;
  color: var(--wt-text-muted);
  background: #f4f6f9;
  border: 1px solid #dde3ec;
  border-radius: var(--wt-radius);
  padding: 6px 12px;
  margin-bottom: 16px;
  cursor: pointer;
  user-select: none;
  transition: background-color 90ms ease;
}

.wt-page__fold:hover {
  background: #e9eef6;
}

/* 隐形输入框只占「阅读光标那一点」，【绝不铺满整张纸】。
   铺满（原来的 `inset: 0`）在真机上有两个后果，都是用户实测报上来的：
   (1) 输入法候选框跟着「textarea 自己的文本光标」定位，而铺满纸的 textarea 光标恒在纸的
       左上角；纸被滚上去之后那个点远在视野上方，系统把候选框钳到窗口顶部——「输入框跑到
       页面顶部」。
   (2) 更糟：Chromium 会把「获得焦点的可编辑元素的光标」滚进视野，于是每次击键都把
       `.wt-canvas` 按回页首。`App` 里那段 rAF 补滚是在跟这次原生滚动赛跑，实测会输。
   位置由 `InputCapture` 在每次渲染后按 `.wt-caret` 的 `offsetLeft` / `offsetTop` 写成
   行内样式；下面这组值同时是「没有阅读光标时」的兜底（纸张左上角）。 */
.wt-input {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1.15em; /* 与 .wt-caret 同高；JS 会按实测到的光标高度覆盖 */
  opacity: 0;
  overflow: hidden;
  border: none;
  resize: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: transparent;
  background: transparent;
  caret-color: transparent;
  cursor: text;
}

.chapter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  cursor: pointer;
  font-size: 12px;
  color: var(--wt-text);
  white-space: nowrap;
  overflow: hidden;
  transition: background-color 80ms ease;
}

.chapter-item:hover {
  background: #edf2fa;
}

/* 选中用「左侧一条圆角竖条 + 浅底」，不再用整条边框——后者在浅色侧栏上显得很硬 */
.chapter-item--active {
  background: var(--wt-blue-light);
  box-shadow: inset 3px 0 0 var(--wt-blue);
  font-weight: 600;
  color: var(--wt-blue-dark);
}

.chapter-item__title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chapter-item__pct {
  color: #999999;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

/* ================= 深色外观 ================= */
[data-theme='dark'] .chapter-item:hover {
  background: #26262d;
}

[data-theme='dark'] .wt-page__empty {
  color: #63636c;
}

[data-theme='dark'] .wt-page__fold {
  background: #24242b;
  border-color: #34343d;
}

[data-theme='dark'] .wt-page__fold:hover {
  background: #2b2b34;
}

/* ---- 「纸也变暗」 ----
 *
 * 只在 **系统深色 + 用户在设置里勾了那个开关** 同时成立时生效。
 * 默认不勾：真 Word 的深色模式里纸张仍然是白的，保持这一点伪装才完整；
 * 勾上是为了夜里看书不刺眼，代价是不再像 Word。
 */
[data-theme='dark'][data-paper='dark'] .wt-page {
  background: #1b1b1f;
  color: #cfcfd6;
}

[data-theme='dark'][data-paper='dark'] .wt-caret {
  background: #cfcfd6;
}

[data-theme='dark'][data-paper='dark'] .wt-page__empty {
  color: #63636c;
}
```

- [ ] **Step 4: 更新 `src/renderer/src/main.tsx` 引入样式**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/word.css'
import './styles/ribbon.css'
import './styles/page.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 5: 写骨架版 `src/renderer/src/App.tsx`**

此步只验证布局与样式，功能在后续任务接入。

> **这是 Task 7 时期的版本，已经过期。** Task 8 的 Step 7 把 Ribbon 接进了 `ToolbarProvider` 并在末尾渲染 `Toast`，Task 12 的 Step 3 又整体重写了它。**当前有效的是 Task 12 Step 3 的围栏**；Task 8 那一版留在 Task 8 Step 7 里备查。

```tsx
export default function App() {
  return (
    <div className="wt-app" data-testid="app-root">
      <div className="wt-ribbon">
        <div className="wt-ribbon__title">
          <span className="wt-ribbon__title-app">Word</span>
          <span className="wt-ribbon__title-doc">文档1</span>
        </div>
        <div className="wt-tabs">
          <button className="wt-tab wt-tab--active">文件</button>
          <button className="wt-tab">开始</button>
        </div>
        <div className="wt-toolbar" />
      </div>

      <div className="wt-body">
        <aside className="wt-sidebar">
          <div className="wt-sidebar__header">章节</div>
          <div className="wt-sidebar__list" />
        </aside>
        <main className="wt-canvas">
          <div className="wt-page">
            <div className="wt-page__empty">
              文件 → 导入小说，或按 Ctrl+O
              <br />
              导入后在文档区打字，字会按比例从小说里取出来。
            </div>
          </div>
        </main>
      </div>

      <div className="wt-statusbar">
        <span>就绪</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: 手动验证外观**

Run: `pnpm dev`
Expected: 看到蓝色标题条、选项卡、左侧灰色章节栏、中间灰底上一张白色 A4 纸、底部蓝色状态栏。整体观感接近 Word。

- [ ] **Step 7: 写渲染层测试 `tests/unit/layout.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../../src/renderer/src/App'

describe('Word 外壳骨架', () => {
  it('渲染出应用根节点与五个主要区域', () => {
    const { container } = render(<App />)
    expect(screen.getByTestId('app-root')).toBeTruthy()
    expect(container.querySelector('.wt-ribbon')).not.toBeNull()
    expect(container.querySelector('.wt-tabs')).not.toBeNull()
    expect(container.querySelector('.wt-sidebar')).not.toBeNull()
    expect(container.querySelector('.wt-page')).not.toBeNull()
    expect(container.querySelector('.wt-statusbar')).not.toBeNull()
  })

  it('伪装文案与区域嵌套正确（内容被换掉时必须红）', () => {
    const { container } = render(<App />)

    expect(container.querySelector('.wt-ribbon__title-app')?.textContent).toBe('Word')
    expect(container.querySelector('.wt-ribbon__title-doc')?.textContent).toBe('文档1')

    // 用 toBeTruthy 而非 not.toBeNull：父元素缺失时可选链返回 undefined，
    // not.toBeNull 会静默放行。
    const ribbon = container.querySelector('.wt-ribbon')
    expect(ribbon, '.wt-ribbon 必须存在').toBeTruthy()
    expect(ribbon?.querySelector('.wt-tabs')).toBeTruthy()
    expect(ribbon?.querySelector('.wt-toolbar')).toBeTruthy()

    const body = container.querySelector('.wt-body')
    expect(body, '.wt-body 必须存在').toBeTruthy()
    expect(body?.querySelector('.wt-sidebar')).toBeTruthy()
    expect(body?.querySelector('.wt-canvas')).toBeTruthy()
    expect(body?.querySelector('.wt-page')).toBeTruthy()
  })
})
```

- [ ] **Step 8: 跑测试**

Run: `pnpm vitest run tests/unit/layout.test.tsx`
Expected: PASS。若报 `document is not defined`，检查 `vitest.config.ts` 的 `environment` 是否为 `jsdom`。

- [ ] **Step 9: Commit**

```bash
git add <本任务改动的显式路径…>   # 不要用 -A：见文件头「git add -A 只在独占一棵工作树时安全」
cat > /tmp/wt-commit-msg.txt <<'EOF'
feat(renderer): Word 视觉外壳（Ribbon/侧栏/纸张/状态栏样式与布局）
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## Task 8: Ribbon 选项卡、工具栏按钮与 Toast

**Files:**
- Create: `src/renderer/src/state/ToolbarContext.tsx`, `src/renderer/src/components/Toast.tsx`, `src/renderer/src/components/Toolbar.tsx`, `src/renderer/src/components/Ribbon.tsx`
- Test: `tests/unit/ribbon.test.tsx`

**Interfaces:**
- Consumes: Task 7 的 CSS 类名
- Produces:
  - `ToolbarProvider` / `useToolbar()`，上下文值：
    ```ts
    interface ToolbarValue {
      toggles: Record<string, boolean>
      toggle(id: string): void
      notify(message: string): void
      toast: string | null
      ratio: number
      setRatio(n: number): void
      mode: InputMode
      setMode(m: InputMode): void
      onImport(): void
      onClearSession(): void
    }
    ```
  - `<Ribbon />`：七个选项卡；文件 / 开始 / 插入 / 布局 / 引用 / 审阅 / 视图
  - `<Toast />`：`toast` 非空时渲染 `.wt-toast`，1.8 秒后自动消失
  - `data-testid`：`tab-文件` 等（`tab-${name}`）、`btn-${id}`、`toast`
    （`ratio-input` / `mode-button` / `btn-import` / `btn-clear-session` 四个 testid 原有，
    但渲染它们的控件已经搬进设置对话框——见 Task 16）

**行为契约**（spec §5.2）：
- `toggle` 类按钮点击 → 切换按下态（`.wt-btn--active` + `aria-pressed`）
- `placeholder` 类按钮点击 → 弹出 toast「演示占位功能，未实现」
- 比例输入 → 真实改 `ratio`，夹紧 1..500（控件在设置对话框里，Task 16）
- 模式按钮 → 真实切换 `ime` / `key`（同上）

- [ ] **Step 1: 写 `src/renderer/src/state/ToolbarContext.tsx`**

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO, type InputMode } from '../../../core/types'

export interface ToolbarValue {
  toggles: Record<string, boolean>
  toggle: (id: string) => void
  /**
   * 下拉框与样式库当前选中的值，键是控件的 `id`。
   *
   * 【为什么与 toggles 分开、而不是塞进同一个 map】两者是**不同的状态种类**：toggle 是
   * 布尔（加粗：开/关），choice 是「从一组里选一个」（字体名、字号、样式）。合成一个
   * `Record<string, boolean | string>` 会让每个读它的地方都要先判类型，而它们读法完全不同。
   *
   * 【默认值不进这里】没选过的控件读出来是 `undefined`，由控件自己退回到第一个选项。
   * 这样切换选项卡再切回来不会丢，也不需要在初始化时把所有控件遍历一遍。
   */
  choices: Record<string, string>
  choose: (id: string, value: string) => void
  notify: (message: string) => void
  toast: string | null
  /** **当前书**的比例：真正生效的那个 */
  ratio: number
  setRatio: (n: number) => void
  /** **全局**比例：只是新导入的书的起点，改了不影响已经打开过的书 */
  globalRatio: number
  setGlobalRatio: (n: number) => void
  mode: InputMode
  setMode: (m: InputMode) => void
  onImport: () => void
  onClearSession: () => void
}

const ToolbarContext = createContext<ToolbarValue | null>(null)

export function clampRatioInput(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RATIO
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, Math.round(n)))
}

export interface ToolbarProviderProps {
  children: ReactNode
  ratio?: number
  globalRatio?: number
  mode?: InputMode
  onRatioChange?: (n: number) => void
  onGlobalRatioChange?: (n: number) => void
  onModeChange?: (m: InputMode) => void
  onImport?: () => void
  onClearSession?: () => void
}

export function ToolbarProvider({
  children,
  ratio: ratioProp,
  globalRatio: globalRatioProp,
  mode: modeProp,
  onRatioChange,
  onGlobalRatioChange,
  onModeChange,
  onImport,
  onClearSession
}: ToolbarProviderProps) {
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [innerRatio, setInnerRatio] = useState(DEFAULT_RATIO)
  const [innerGlobalRatio, setInnerGlobalRatio] = useState(DEFAULT_RATIO)
  const [innerMode, setInnerMode] = useState<InputMode>('ime')

  const ratio = ratioProp ?? innerRatio
  const globalRatio = globalRatioProp ?? innerGlobalRatio
  const mode = modeProp ?? innerMode

  const toggle = useCallback((id: string) => {
    setToggles((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const choose = useCallback((id: string, value: string) => {
    setChoices((prev) => ({ ...prev, [id]: value }))
  }, [])

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current))
    }, 1800)
  }, [])

  const setRatio = useCallback(
    (n: number) => {
      const next = clampRatioInput(n)
      setInnerRatio(next)
      onRatioChange?.(next)
    },
    [onRatioChange]
  )

  const setGlobalRatio = useCallback(
    (n: number) => {
      const next = clampRatioInput(n)
      setInnerGlobalRatio(next)
      onGlobalRatioChange?.(next)
    },
    [onGlobalRatioChange]
  )

  const setMode = useCallback(
    (m: InputMode) => {
      setInnerMode(m)
      onModeChange?.(m)
    },
    [onModeChange]
  )

  const value = useMemo<ToolbarValue>(
    () => ({
      toggles,
      toggle,
      choices,
      choose,
      notify,
      toast,
      ratio,
      setRatio,
      globalRatio,
      setGlobalRatio,
      mode,
      setMode,
      onImport: onImport ?? (() => notify('演示占位功能，未实现')),
      onClearSession: onClearSession ?? (() => notify('演示占位功能，未实现'))
    }),
    [
      toggles,
      toggle,
      choices,
      choose,
      notify,
      toast,
      ratio,
      setRatio,
      globalRatio,
      setGlobalRatio,
      mode,
      setMode,
      onImport,
      onClearSession
    ]
  )

  return <ToolbarContext.Provider value={value}>{children}</ToolbarContext.Provider>
}

export function useToolbar(): ToolbarValue {
  const ctx = useContext(ToolbarContext)
  if (!ctx) throw new Error('useToolbar 必须在 ToolbarProvider 内使用')
  return ctx
}
```

- [ ] **Step 2: 写 `src/renderer/src/components/Toast.tsx`**

```tsx
import { useToolbar } from '../state/ToolbarContext'

export function Toast() {
  const { toast } = useToolbar()
  if (!toast) return null
  return (
    <div className="wt-toast" data-testid="toast" role="status">
      {toast}
    </div>
  )
}
```

- [ ] **Step 3: 写 `src/renderer/src/components/Toolbar.tsx`**

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { FluentIcon } from '@fluentui/react-icons'
import { useToolbar } from '../state/ToolbarContext'
import { IconSettings, IconCaretDown } from './icons'

/**
 * 工具栏里能出现的东西。
 *
 * 【`ratio` / `mode` / `import` / `clear-session` 四种 kind 已经不在这里了】它们渲染的是
 * 应用的真实功能，现在统一由 `SettingsDialog` 渲染（那四种控件连同各自的 testid 一起搬了
 * 过去）。工具栏只留一个 `settings` kind：一个打开对话框的按钮。
 *
 * 【`icon` 可选是有意的】功能区里不是每样东西都有合适的图标——Word 自己的「样式」库就是
 * 一组文字预览（`AaBbCc` + 样式名），不是图标。没有 `icon` 的项退回去渲染 `label` 文字。
 *
 * 【`large` 对应 Word 功能区的两种尺寸】大按钮是「图标在上、标签在下」（新建/保存/导入这类），
 * 小按钮是纯图标（加粗/对齐那一排）。真 Word 就是这么混着排的，全用小按钮会显得空、全用大的
 * 又放不下。
 *
 * 【六种 kind 的来源】`toggle` / `placeholder` / `settings` 是最初三种。补「开始/插入/布局」
 * 三页时发现光靠按钮做不像 Word：字体名、字号、行距在真 Word 里是**下拉框**，「样式」是
 * 带预览的**库**，「下划线」右侧还有一个**展开箭头**。于是加了 `combo` / `gallery` / `split`。
 * 三者都只做外观与「选中态」，点开后的真实功能一律走 `notify` 的占位提示——它们不是真功能。
 */
export type ToolbarItem =
  | { kind: 'toggle'; id: string; label: string; title: string; icon?: FluentIcon; large?: boolean }
  | {
      kind: 'placeholder'
      id: string
      label: string
      title: string
      icon?: FluentIcon
      large?: boolean
    }
  | { kind: 'settings'; large?: boolean }
  /** 下拉框（字体名 / 字号 / 行距）。`width` 用来对齐真 Word 里那几栏宽窄不一的观感。 */
  | { kind: 'combo'; id: string; title: string; options: readonly string[]; width?: number }
  /** 带预览的样式库。每一项都画成 `AaBbCc` + 样式名。 */
  | { kind: 'gallery'; id: string; title: string; entries: readonly string[] }
  /** 主按钮 + 右侧展开箭头（下划线 / 项目符号 / 编号）。主按钮是 toggle，箭头只弹提示。 */
  | { kind: 'split'; id: string; label: string; title: string; icon: FluentIcon }

export interface ToolbarGroup {
  label: string
  items: ToolbarItem[]
}

/**
 * 下拉框。
 *
 * 【为什么不用原生 `<select>` —— 这是本组件最要紧的一条】全应用的按键都落在
 * `InputCapture` 那个透明 textarea 上（按键处理挂在**它**的 onKeyDown 上，不是 window）。
 * 而 `focusIfNotTextInput` 的豁免名单里**有 `select`**——那是给设置对话框里的输入框用的。
 * 于是原生 `<select>` 一点下去焦点就留在它身上，之后敲键盘**既不打字也不抽字**，
 * 整个应用等于废了。做成 `<button>` + 一列 `<button>` 就不在豁免名单里：`mousedown` 时
 * 焦点会被自动抢回 textarea，与工具栏里其它按钮走的是同一条路径。
 *
 * 【为什么面板要 portal 到 body】`.wt-toolbar` 有 `overflow-x: auto`（窄窗口时横向滚动）。
 * 按 CSS 规则，一个轴不是 visible 时另一个轴也会变成 auto，于是绝对定位的面板会被**裁掉**。
 * portal 到 body 再用 `position: fixed` 就完全跳出了那个裁剪上下文。
 *
 * 【面板里不接键盘】不做输入过滤、不接 Esc。按键要继续去抽字，面板只认鼠标：
 * 选中一项、或点到面板外面，就关。真 Word 的字体框能打字过滤，这里刻意不做。
 */
function Combo({
  id,
  title,
  options,
  width
}: {
  id: string
  title: string
  options: readonly string[]
  width?: number
}) {
  const { choices, choose } = useToolbar()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // 没选过就退回第一项，而不是在 Provider 里预填一遍所有控件——那样得先知道有哪些控件。
  const value = choices[id] ?? options[0]

  const openPanel = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    // jsdom 没有布局，rect 全是 0；那不是错误路径，面板照样要挂出来（测试靠这个断言）。
    setPos({ left: r?.left ?? 0, top: (r?.bottom ?? 0) + 2, width: r?.width ?? 0 })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Element)) return
      if (btnRef.current?.contains(t)) return
      if (t.closest('.wt-combo__panel')) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="wt-combo"
        data-testid={`combo-${id}`}
        title={title}
        aria-label={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={width === undefined ? undefined : { width }}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <span className="wt-combo__value">{value}</span>
        <IconCaretDown className="wt-combo__caret" />
      </button>
      {open && pos
        ? createPortal(
            <div
              className="wt-combo__panel"
              role="listbox"
              aria-label={title}
              data-testid={`combo-${id}-panel`}
              style={{ left: pos.left, top: pos.top, minWidth: Math.max(pos.width, 96) }}
            >
              {options.map((o) => (
                <button
                  key={o}
                  type="button"
                  role="option"
                  aria-selected={o === value}
                  className={`wt-combo__option${o === value ? ' wt-combo__option--active' : ''}`}
                  onClick={() => {
                    choose(id, o)
                    setOpen(false)
                  }}
                >
                  {o}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

/**
 * 样式库。真 Word 的「样式」组就是几个白色小方块，每块里是 `AaBbCc` 加样式名。
 *
 * 与 `Combo` 不同，这里展开就是全部选项，所以直接在流内排开、不需要弹层，
 * 也就不涉及焦点问题——每一项本身是 `<button>`。
 */
function Gallery({
  id,
  title,
  entries
}: {
  id: string
  title: string
  entries: readonly string[]
}) {
  const { choices, choose } = useToolbar()
  const value = choices[id] ?? entries[0]

  return (
    <div className="wt-gallery" role="group" aria-label={title} data-testid={`gallery-${id}`}>
      {entries.map((name) => {
        const active = name === value
        return (
          <button
            key={name}
            type="button"
            className={`wt-gallery__item${active ? ' wt-gallery__item--active' : ''}`}
            data-testid={`gallery-${id}-${name}`}
            aria-pressed={active}
            title={`${title}：${name}`}
            onClick={() => choose(id, name)}
          >
            {/* 预览那行 `AaBbCc` 只是形状，读屏念出来是噪音，所以 aria-hidden */}
            <span className="wt-gallery__preview" aria-hidden="true">
              AaBbCc
            </span>
            <span className="wt-gallery__name">{name}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * 主按钮 + 右侧展开箭头。真 Word 的「下划线」「项目符号」「编号」都是这个形状：
 * 点主体是直接应用，点箭头是展开更多选择。
 *
 * 箭头只弹占位提示——本应用没有「更多选择」那套东西，为它造一个空菜单反而更像没做完。
 */
function SplitButton({
  id,
  label,
  title,
  icon: Icon
}: {
  id: string
  label: string
  title: string
  icon: FluentIcon
}) {
  const { toggles, toggle, notify } = useToolbar()
  const active = Boolean(toggles[id])

  return (
    <div className="wt-split" data-testid={`split-${id}`}>
      <button
        type="button"
        className={`wt-btn wt-btn--icon-only wt-split__main${active ? ' wt-btn--active' : ''}`}
        data-testid={`btn-${id}`}
        title={title}
        aria-label={title}
        aria-pressed={active}
        onClick={() => toggle(id)}
      >
        <Icon filled={active} className="wt-btn__icon" />
        <span className="wt-btn__label">{label}</span>
      </button>
      <button
        type="button"
        className="wt-split__arrow"
        data-testid={`split-${id}-more`}
        title={`${title}（更多）`}
        aria-label={`${title}（更多）`}
        onClick={() => notify('演示占位功能，未实现')}
      >
        <IconCaretDown className="wt-split__caret" />
      </button>
    </div>
  )
}

export function Toolbar({
  groups,
  onOpenSettings
}: {
  groups: ToolbarGroup[]
  onOpenSettings: () => void
}) {
  const { toggles, toggle, notify } = useToolbar()

  /**
   * 渲染一个控件。抽成函数只是因为它在两处被调用（组内、以及下面那份兜底）——
   * 组内的两行排布是 CSS 的事，与这里无关，见 `ribbon.css` 的 `.wt-group__body`。
   */
  const renderItem = (item: ToolbarItem): ReactNode => {
    if (item.kind === 'settings') {
      return (
        <button
          key="settings"
          type="button"
          className={`wt-btn${item.large ? ' wt-btn--large' : ''}`}
          data-testid="btn-settings"
          title="设置 (⌘/Ctrl + ,)"
          onClick={onOpenSettings}
        >
          <IconSettings className="wt-btn__icon" />
          <span className="wt-btn__label">设置</span>
        </button>
      )
    }

    if (item.kind === 'combo') {
      return (
        <Combo
          key={item.id}
          id={item.id}
          title={item.title}
          options={item.options}
          width={item.width}
        />
      )
    }

    if (item.kind === 'gallery') {
      return <Gallery key={item.id} id={item.id} title={item.title} entries={item.entries} />
    }

    if (item.kind === 'split') {
      return (
        <SplitButton
          key={item.id}
          id={item.id}
          label={item.label}
          title={item.title}
          icon={item.icon}
        />
      )
    }

    const active = Boolean(toggles[item.id])
    const Icon = item.icon
    // 有图标、又不是大按钮 → 只显示图标（Word 的 B/I/U 那一排就没有可见文字）。
    // 标签仍渲染在 DOM 里但被 CSS 藏起来，`aria-label` 保证读屏拿得到名字。
    const iconOnly = Boolean(Icon) && !item.large
    return (
      <button
        key={item.id}
        type="button"
        className={`wt-btn${item.large ? ' wt-btn--large' : ''}${iconOnly ? ' wt-btn--icon-only' : ''}${active ? ' wt-btn--active' : ''}`}
        data-testid={`btn-${item.id}`}
        title={item.title}
        aria-label={iconOnly ? item.title : undefined}
        aria-pressed={item.kind === 'toggle' ? active : undefined}
        onClick={() => {
          if (item.kind === 'toggle') toggle(item.id)
          else notify('演示占位功能，未实现')
        }}
      >
        {/* filled 切换线框/实心，就是 Word 切换按钮的语义（见 icons.tsx 的说明） */}
        {Icon ? <Icon filled={active} className="wt-btn__icon" /> : null}
        <span className="wt-btn__label">{item.label}</span>
      </button>
    )
  }

  return (
    <div className="wt-toolbar" data-testid="toolbar">
      {groups.map((group) => (
        <div className="wt-group" key={group.label}>
          <div className="wt-group__body">{group.items.map(renderItem)}</div>
          <div className="wt-group__label">{group.label}</div>
        </div>
      ))}
    </div>
  )
}
```

说明：用 `switch (item.kind)` 而不是连续的 `if` 提前返回，是为了让 TS 在 `default` 分支里把类型正确收窄成 `'toggle' | 'placeholder'`，从而能安全访问 `item.id` / `item.label` / `item.title`。

- [ ] **Step 4: 写 `src/renderer/src/components/Ribbon.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { SettingsDialog } from './SettingsDialog'
import type { ThemeSource } from '../types/global'
import { Toolbar, type ToolbarGroup } from './Toolbar'
import {
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconBorders,
  IconBullets,
  IconClearFormat,
  IconColumns,
  IconComment,
  IconCopy,
  IconCut,
  IconExport,
  IconFontColor,
  IconFontGrow,
  IconFontShrink,
  IconFootnote,
  IconFormatPainter,
  IconGrid,
  IconHighlight,
  IconIndentDecrease,
  IconIndentIncrease,
  IconItalic,
  IconLineSpacing,
  IconMargins,
  IconMultiLevelList,
  IconNew,
  IconNumbering,
  IconOrientation,
  IconPageBreak,
  IconPaste,
  IconPicture,
  IconPrint,
  IconReadingView,
  IconRedo,
  IconReplace,
  IconRuler,
  IconSave,
  IconSearch,
  IconSelect,
  IconShading,
  IconShape,
  IconShowMarks,
  IconSort,
  IconSpellCheck,
  IconStrike,
  IconSubscript,
  IconSuperscript,
  IconTable,
  IconTextEffects,
  IconToc,
  IconUnderline,
  IconUndo,
  IconWordCount,
  /* 「插入 / 布局 / 文件」三页补密度时新增的。上面那批是按名字排的，这批按用途聚在一起，
     不再跟着排——它们只在这三页用，混进去反而更难读。 */
  Icon3DModel,
  IconAddin,
  IconAlignObjects,
  IconAudio,
  IconBlankPage,
  IconBookmark,
  IconBringForward,
  IconChart,
  IconClose,
  IconCoverPage,
  IconCrossRef,
  IconDateTime,
  IconDropCap,
  IconFooter,
  IconFormula,
  IconGroupObjects,
  IconHeader,
  IconHyperlink,
  IconHyphenation,
  IconIcons,
  IconImport,
  IconLineNumbers,
  IconObject,
  IconPageNumber,
  IconPaperSize,
  IconPosition,
  IconRotate,
  IconSaveAs,
  IconScreenshot,
  IconSelectionPane,
  IconSendBackward,
  IconShare,
  IconSignature,
  IconSmartArt,
  IconSpaceAfter,
  IconSpaceBefore,
  IconSymbols,
  IconTextbox,
  IconVideo,
  IconWrapText,
  /* 「引用 / 审阅 / 视图」三页补密度时新增的。 */
  IconAccessibility,
  IconAccept,
  IconAddText,
  IconBibliography,
  IconCaption,
  IconCitation,
  IconCompare,
  IconDeleteComment,
  IconDraftView,
  IconEndnote,
  IconInsertIndex,
  IconLanguage,
  IconMacro,
  IconMarkEntry,
  IconMergeDocs,
  IconMultiPage,
  IconNewWindow,
  IconNextItem,
  IconOutlineView,
  IconPageView,
  IconPageWidth,
  IconPrevItem,
  IconReject,
  IconRestrictEditing,
  IconReviewPane,
  IconShowComments,
  IconSideBySide,
  IconSources,
  IconSplitWindow,
  IconSwitchWindow,
  IconSyncScroll,
  IconThesaurus,
  IconTrackChanges,
  IconTranslate,
  IconUpdateField,
  IconUpdateTable,
  IconWebLayout,
  IconZoom
} from './icons'

export const RIBBON_TABS = ['文件', '开始', '插入', '布局', '引用', '审阅', '视图'] as const
export type RibbonTab = (typeof RIBBON_TABS)[number]

/**
 * 「开始」页那几个下拉框与样式库里的候选。都是真 Word 里装的东西，顺序也照它排——
 * 这类列表的可信度全在「里面装的东西像不像」上，随便编几个名字反而更假。
 */
const FONT_FAMILIES = [
  '宋体',
  '黑体',
  '楷体',
  '仿宋',
  '微软雅黑',
  '等线',
  'Times New Roman',
  'Arial'
] as const

const FONT_SIZES = [
  '初号',
  '小初',
  '一号',
  '小一',
  '二号',
  '小二',
  '三号',
  '小三',
  '四号',
  '小四',
  '五号',
  '小五'
] as const

const LINE_SPACINGS = ['1.0', '1.15', '1.5', '2.0', '2.5', '3.0'] as const

const STYLE_ENTRIES = ['正文', '标题 1', '标题 2', '标题 3', '无间隔', '引用', '强调'] as const

const CLIPBOARD_GROUP: ToolbarGroup = {
  label: '剪贴板',
  items: [
    // 数组顺序就是排布顺序。组内按【两行、按列填充】排（见 ribbon.css 的 `.wt-group__body`），
    // 大按钮占满整列，于是这四项落成「格式刷(大) | 粘贴(大) | 剪切 / 复制」。
    // 格式刷摆在粘贴左边是明确要求的；剪切/复制留在粘贴右侧（它们本来就是粘贴的下级动作）。
    {
      kind: 'placeholder',
      id: 'brush',
      label: '格式刷',
      title: '格式刷',
      icon: IconFormatPainter,
      large: true
    },
    { kind: 'placeholder', id: 'paste', label: '粘贴', title: '粘贴', icon: IconPaste, large: true },
    { kind: 'placeholder', id: 'cut', label: '剪切', title: '剪切', icon: IconCut },
    { kind: 'placeholder', id: 'copy', label: '复制', title: '复制', icon: IconCopy }
  ]
}

const FONT_GROUP: ToolbarGroup = {
  label: '字体',
  items: [
    // 字体名与字号在真 Word 里就是**下拉框**（combo），不再是文字按钮。
    // 宽度照真 Word 那两栏的观感给：字体名宽、字号窄。
    { kind: 'combo', id: 'font-family', title: '字体', options: FONT_FAMILIES, width: 118 },
    { kind: 'combo', id: 'font-size', title: '字号', options: FONT_SIZES, width: 58 },
    // 【下面的顺序是被排布方式决定的，别按“重要性”重排】组内是两行按列填充，
    // **相邻两项自然成上下两格**。所以要成对地写：增大/减小、加粗/斜体、下划线/删除线…
    // 乱序的话会排出「清除格式 压在 加粗 上面」这种没道理的配对。
    { kind: 'placeholder', id: 'font-grow', label: '增大字号', title: '增大字号', icon: IconFontGrow },
    {
      kind: 'placeholder',
      id: 'font-shrink',
      label: '减小字号',
      title: '减小字号',
      icon: IconFontShrink
    },
    { kind: 'toggle', id: 'bold', label: '加粗', title: '加粗', icon: IconBold },
    { kind: 'toggle', id: 'italic', label: '斜体', title: '斜体', icon: IconItalic },
    // 下划线在真 Word 里是「主按钮 + 展开箭头」，箭头里是双下划线、波浪线那些。
    { kind: 'split', id: 'underline', label: '下划线', title: '下划线', icon: IconUnderline },
    { kind: 'toggle', id: 'strike', label: '删除线', title: '删除线', icon: IconStrike },
    { kind: 'toggle', id: 'subscript', label: '下标', title: '下标', icon: IconSubscript },
    { kind: 'toggle', id: 'superscript', label: '上标', title: '上标', icon: IconSuperscript },
    { kind: 'toggle', id: 'highlight', label: '突出显示', title: '突出显示', icon: IconHighlight },
    {
      kind: 'placeholder',
      id: 'font-color',
      label: '字体颜色',
      title: '字体颜色',
      icon: IconFontColor
    },
    {
      kind: 'placeholder',
      id: 'clear-format',
      label: '清除格式',
      title: '清除所有格式',
      icon: IconClearFormat
    },
    {
      kind: 'toggle',
      id: 'text-effects',
      label: '文本效果',
      title: '文本效果',
      icon: IconTextEffects
    }
  ]
}

const PARAGRAPH_GROUP: ToolbarGroup = {
  label: '段落',
  items: [
    // 顺序同样被「相邻两项成上下两格」决定，见 FONT_GROUP 上面那段说明。
    // 这一组正好 14 个小控件 = 7 列排满，行距（combo，占满整列）落在最右。
    // 14 这个数是**凑出来的**：底纹/边框本来就该成对，段落间距是补的那一项。
    // 项目符号与编号在真 Word 里同样是分割按钮（箭头里是各种符号 / 编号样式）。
    { kind: 'split', id: 'bullets', label: '项目符号', title: '项目符号', icon: IconBullets },
    { kind: 'split', id: 'numbering', label: '编号', title: '编号', icon: IconNumbering },
    {
      kind: 'placeholder',
      id: 'multilevel',
      label: '多级列表',
      title: '多级列表',
      icon: IconMultiLevelList
    },
    { kind: 'placeholder', id: 'sort', label: '排序', title: '排序', icon: IconSort },
    {
      kind: 'placeholder',
      id: 'indent-decrease',
      label: '减少缩进',
      title: '减少缩进量',
      icon: IconIndentDecrease
    },
    {
      kind: 'placeholder',
      id: 'indent-increase',
      label: '增加缩进',
      title: '增加缩进量',
      icon: IconIndentIncrease
    },
    {
      kind: 'toggle',
      id: 'show-marks',
      label: '编辑标记',
      title: '显示/隐藏编辑标记',
      icon: IconShowMarks
    },
    {
      kind: 'placeholder',
      id: 'para-spacing',
      label: '段落间距',
      title: '段前段后间距',
      icon: IconLineSpacing
    },
    { kind: 'placeholder', id: 'shading', label: '底纹', title: '底纹', icon: IconShading },
    { kind: 'placeholder', id: 'borders', label: '边框', title: '边框', icon: IconBorders },
    { kind: 'toggle', id: 'align-left', label: '左对齐', title: '左对齐', icon: IconAlignLeft },
    { kind: 'toggle', id: 'align-center', label: '居中', title: '居中', icon: IconAlignCenter },
    { kind: 'toggle', id: 'align-right', label: '右对齐', title: '右对齐', icon: IconAlignRight },
    {
      kind: 'toggle',
      id: 'align-justify',
      label: '两端对齐',
      title: '两端对齐',
      icon: IconAlignJustify
    },
    { kind: 'combo', id: 'line-spacing', title: '行距', options: LINE_SPACINGS, width: 58 }
  ]
}

/**
 * 【原先这里挂着一个 `READING_GROUP`（比例 + 输入模式），摆在「开始」和「视图」两个选项卡下】
 * 那是全应用最容易被一眼看穿的地方：假 Word 的工具栏里放着「1 键显示 N 字」。整组连同
 * 「文件」选项卡里的「小说」组一起搬进了 `SettingsDialog`，工具栏只留一个「设置」按钮。
 *
 * 【`large` 的用法照抄真 Word 的取舍】文件/插入/布局这些页里的项基本都是大按钮（图标在上、
 * 标签在下），因为它们数量少、辨识靠图标；「开始」页里的格式与对齐是一排小按钮，
 * 因为只有并排才看得出对比。
 */
const TABS: Record<RibbonTab, ToolbarGroup[]> = {
  文件: [
    {
      // 真 Word 里「文件」不是选项卡，是整页的 backstage（新建/打开/信息/打印…竖排）。
      // 这里刻意**没做**那一层：backstage 会整页盖住正文，而本应用的正事就是那块正文，
      // 点错一下就把阅读区盖了。所以它保持成一个普通选项卡，只把内容补丰富。
      label: '文件',
      items: [
        { kind: 'placeholder', id: 'new', label: '新建', title: '新建', icon: IconNew, large: true },
        { kind: 'placeholder', id: 'open', label: '打开', title: '打开', icon: IconImport, large: true },
        { kind: 'placeholder', id: 'save', label: '保存', title: '保存', icon: IconSave, large: true },
        {
          kind: 'placeholder',
          id: 'save-as',
          label: '另存为',
          title: '另存为',
          icon: IconSaveAs,
          large: true
        },
        { kind: 'placeholder', id: 'print', label: '打印', title: '打印', icon: IconPrint, large: true },
        { kind: 'placeholder', id: 'share', label: '共享', title: '共享', icon: IconShare, large: true },
        {
          kind: 'placeholder',
          id: 'export-docx',
          label: '导出 docx',
          title: '导出为 docx',
          icon: IconExport,
          large: true
        },
        { kind: 'placeholder', id: 'close-doc', label: '关闭', title: '关闭', icon: IconClose, large: true }
      ]
    },
    // 真实功能的唯一入口。排在占位组【后面】——它是整个界面上唯一「有用」的按钮，
    // 摆在最左边反而显眼。
    { label: '设置', items: [{ kind: 'settings', large: true }] }
  ],
  开始: [
    CLIPBOARD_GROUP,
    FONT_GROUP,
    PARAGRAPH_GROUP,
    {
      // 样式在真 Word 里是一排带 `AaBbCc` 预览的小方块，不是按钮——所以用 gallery。
      label: '样式',
      items: [{ kind: 'gallery', id: 'style', title: '样式', entries: STYLE_ENTRIES }]
    },
    {
      label: '编辑',
      items: [
        {
          kind: 'placeholder',
          id: 'find',
          label: '查找',
          title: '查找',
          icon: IconSearch,
          large: true
        },
        { kind: 'placeholder', id: 'replace', label: '替换', title: '替换', icon: IconReplace },
        { kind: 'placeholder', id: 'select', label: '选择', title: '选择', icon: IconSelect }
      ]
    }
  ],
  插入: [
    {
      label: '页面',
      items: [
        {
          kind: 'placeholder',
          id: 'cover-page',
          label: '封面',
          title: '封面',
          icon: IconCoverPage,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'blank-page',
          label: '空白页',
          title: '空白页',
          icon: IconBlankPage,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'pagebreak',
          label: '分页',
          title: '分页符',
          icon: IconPageBreak,
          large: true
        }
      ]
    },
    {
      label: '表格',
      items: [
        { kind: 'placeholder', id: 'table', label: '表格', title: '表格', icon: IconTable, large: true }
      ]
    },
    {
      label: '插图',
      items: [
        { kind: 'placeholder', id: 'picture', label: '图片', title: '图片', icon: IconPicture, large: true },
        { kind: 'placeholder', id: 'shape', label: '形状', title: '形状', icon: IconShape, large: true },
        { kind: 'placeholder', id: 'icons', label: '图标', title: '图标', icon: IconIcons, large: true },
        { kind: 'placeholder', id: 'model3d', label: '3D 模型', title: '3D 模型', icon: Icon3DModel, large: true },
        { kind: 'placeholder', id: 'smartart', label: 'SmartArt', title: 'SmartArt', icon: IconSmartArt, large: true },
        { kind: 'placeholder', id: 'chart', label: '图表', title: '图表', icon: IconChart, large: true },
        {
          kind: 'placeholder',
          id: 'screenshot',
          label: '屏幕截图',
          title: '屏幕截图',
          icon: IconScreenshot,
          large: true
        }
      ]
    },
    {
      label: '加载项',
      items: [
        { kind: 'placeholder', id: 'addin', label: '加载项', title: '加载项', icon: IconAddin, large: true }
      ]
    },
    {
      label: '媒体',
      items: [
        { kind: 'placeholder', id: 'video', label: '视频', title: '视频', icon: IconVideo, large: true },
        { kind: 'placeholder', id: 'audio', label: '音频', title: '音频', icon: IconAudio, large: true }
      ]
    },
    {
      label: '链接',
      items: [
        {
          kind: 'placeholder',
          id: 'link',
          label: '链接',
          title: '链接',
          icon: IconHyperlink,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'bookmark',
          label: '书签',
          title: '书签',
          icon: IconBookmark,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'crossref',
          label: '交叉引用',
          title: '交叉引用',
          icon: IconCrossRef,
          large: true
        }
      ]
    },
    {
      label: '批注',
      items: [
        { kind: 'placeholder', id: 'comment', label: '批注', title: '批注', icon: IconComment, large: true }
      ]
    },
    {
      label: '页眉和页脚',
      items: [
        { kind: 'placeholder', id: 'header', label: '页眉', title: '页眉', icon: IconHeader, large: true },
        { kind: 'placeholder', id: 'footer', label: '页脚', title: '页脚', icon: IconFooter, large: true },
        {
          kind: 'placeholder',
          id: 'page-number',
          label: '页码',
          title: '页码',
          icon: IconPageNumber,
          large: true
        }
      ]
    },
    {
      label: '文本',
      items: [
        {
          kind: 'placeholder',
          id: 'textbox',
          label: '文本框',
          title: '文本框',
          icon: IconTextbox,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'wordart',
          label: '艺术字',
          title: '艺术字',
          icon: IconTextEffects,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'dropcap',
          label: '首字下沉',
          title: '首字下沉',
          icon: IconDropCap,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'signature',
          label: '签名行',
          title: '签名行',
          icon: IconSignature,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'datetime',
          label: '日期和时间',
          title: '日期和时间',
          icon: IconDateTime,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'object',
          label: '对象',
          title: '对象',
          icon: IconObject,
          large: true
        }
      ]
    },
    {
      label: '符号',
      items: [
        {
          kind: 'placeholder',
          id: 'equation',
          label: '公式',
          title: '公式',
          icon: IconFormula,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'symbol',
          label: '符号',
          title: '符号',
          icon: IconSymbols,
          large: true
        }
      ]
    }
  ],
  布局: [
    {
      label: '页面设置',
      items: [
        { kind: 'placeholder', id: 'margin', label: '页边距', title: '页边距', icon: IconMargins, large: true },
        {
          kind: 'placeholder',
          id: 'orientation',
          label: '纸张方向',
          title: '纸张方向',
          icon: IconOrientation,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'paper-size',
          label: '纸张大小',
          title: '纸张大小',
          icon: IconPaperSize,
          large: true
        },
        { kind: 'placeholder', id: 'columns', label: '分栏', title: '分栏', icon: IconColumns, large: true },
        {
          kind: 'placeholder',
          id: 'breaks',
          label: '分隔符',
          title: '分隔符',
          icon: IconPageBreak,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'line-numbers',
          label: '行号',
          title: '行号',
          icon: IconLineNumbers,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'hyphenation',
          label: '断字',
          title: '断字',
          icon: IconHyphenation,
          large: true
        }
      ]
    },
    {
      label: '段落',
      items: [
        {
          kind: 'placeholder',
          id: 'indent-decrease',
          label: '减少缩进',
          title: '减少缩进量',
          icon: IconIndentDecrease,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'indent-increase',
          label: '增加缩进',
          title: '增加缩进量',
          icon: IconIndentIncrease,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'space-before',
          label: '段前间距',
          title: '段前间距',
          icon: IconSpaceBefore,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'space-after',
          label: '段后间距',
          title: '段后间距',
          icon: IconSpaceAfter,
          large: true
        },
        {
          // 与「开始」页那个行距是同一个命令，所以共用 `line-spacing` 这个 id——
          // 那边的 combo 选了值，这边的按钮读的是同一份状态（按钮本身不读，见 Toolbar）。
          kind: 'placeholder',
          id: 'line-spacing',
          label: '行距',
          title: '行距',
          icon: IconLineSpacing,
          large: true
        }
      ]
    },
    {
      label: '排列',
      items: [
        {
          kind: 'placeholder',
          id: 'position',
          label: '位置',
          title: '位置',
          icon: IconPosition,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'wrap-text',
          label: '环绕文字',
          title: '环绕文字',
          icon: IconWrapText,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'bring-forward',
          label: '上移一层',
          title: '上移一层',
          icon: IconBringForward,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'send-backward',
          label: '下移一层',
          title: '下移一层',
          icon: IconSendBackward,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'selection-pane',
          label: '选择窗格',
          title: '选择窗格',
          icon: IconSelectionPane,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'align-objects',
          label: '对齐',
          title: '对齐',
          icon: IconAlignObjects,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'group-objects',
          label: '组合',
          title: '组合',
          icon: IconGroupObjects,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'rotate',
          label: '旋转',
          title: '旋转',
          icon: IconRotate,
          large: true
        }
      ]
    }
  ],
  引用: [
    {
      label: '目录',
      items: [
        { kind: 'placeholder', id: 'toc', label: '目录', title: '目录', icon: IconToc, large: true },
        {
          kind: 'placeholder',
          id: 'add-text',
          label: '添加文字',
          title: '添加文字',
          icon: IconAddText,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'update-toc',
          label: '更新目录',
          title: '更新目录',
          icon: IconUpdateField,
          large: true
        }
      ]
    },
    {
      label: '脚注',
      items: [
        {
          kind: 'placeholder',
          id: 'footnote',
          label: '插入脚注',
          title: '插入脚注',
          icon: IconFootnote,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'endnote',
          label: '插入尾注',
          title: '插入尾注',
          icon: IconEndnote,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'next-footnote',
          label: '下一条脚注',
          title: '下一条脚注',
          icon: IconNextItem,
          large: true
        }
      ]
    },
    {
      label: '引文与书目',
      items: [
        {
          kind: 'placeholder',
          id: 'citation',
          label: '插入引文',
          title: '插入引文',
          icon: IconCitation,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'sources',
          label: '管理源',
          title: '管理源',
          icon: IconSources,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'bibliography',
          label: '书目',
          title: '书目',
          icon: IconBibliography,
          large: true
        }
      ]
    },
    {
      label: '题注',
      items: [
        {
          kind: 'placeholder',
          id: 'caption',
          label: '插入题注',
          title: '插入题注',
          icon: IconCaption,
          large: true
        },
        {
          // 与「插入」页那个交叉引用是同一个命令，共用 id。
          kind: 'placeholder',
          id: 'crossref',
          label: '交叉引用',
          title: '交叉引用',
          icon: IconCrossRef,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'update-table',
          label: '更新表',
          title: '更新表',
          icon: IconUpdateTable,
          large: true
        }
      ]
    },
    {
      label: '索引',
      items: [
        {
          kind: 'placeholder',
          id: 'mark-entry',
          label: '标记条目',
          title: '标记条目',
          icon: IconMarkEntry,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'insert-index',
          label: '插入索引',
          title: '插入索引',
          icon: IconInsertIndex,
          large: true
        }
      ]
    }
  ],
  审阅: [
    {
      label: '校对',
      items: [
        {
          kind: 'placeholder',
          id: 'spellcheck',
          label: '拼写和语法',
          title: '拼写和语法',
          icon: IconSpellCheck,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'thesaurus',
          label: '同义词库',
          title: '同义词库',
          icon: IconThesaurus,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'wordcount',
          label: '字数统计',
          title: '字数统计',
          icon: IconWordCount,
          large: true
        }
      ]
    },
    {
      label: '辅助功能',
      items: [
        {
          kind: 'placeholder',
          id: 'accessibility',
          label: '检查辅助功能',
          title: '检查辅助功能',
          icon: IconAccessibility,
          large: true
        }
      ]
    },
    {
      label: '语言',
      items: [
        {
          kind: 'placeholder',
          id: 'translate',
          label: '翻译',
          title: '翻译',
          icon: IconTranslate,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'language',
          label: '语言',
          title: '语言',
          icon: IconLanguage,
          large: true
        }
      ]
    },
    {
      label: '批注',
      items: [
        {
          kind: 'placeholder',
          id: 'comment',
          label: '新建批注',
          title: '新建批注',
          icon: IconComment,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'delete-comment',
          label: '删除',
          title: '删除批注',
          icon: IconDeleteComment,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'prev-comment',
          label: '上一条',
          title: '上一条批注',
          icon: IconPrevItem,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'next-comment',
          label: '下一条',
          title: '下一条批注',
          icon: IconNextItem,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'show-comments',
          label: '显示批注',
          title: '显示批注',
          icon: IconShowComments,
          large: true
        }
      ]
    },
    {
      label: '修订',
      items: [
        {
          kind: 'placeholder',
          id: 'track-changes',
          label: '修订',
          title: '修订',
          icon: IconTrackChanges,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'markup',
          label: '显示标记',
          title: '显示标记',
          icon: IconShowMarks,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'review-pane',
          label: '审阅窗格',
          title: '审阅窗格',
          icon: IconReviewPane,
          large: true
        }
      ]
    },
    {
      label: '更改',
      items: [
        { kind: 'placeholder', id: 'accept', label: '接受', title: '接受', icon: IconAccept, large: true },
        { kind: 'placeholder', id: 'reject', label: '拒绝', title: '拒绝', icon: IconReject, large: true }
      ]
    },
    {
      label: '比较',
      items: [
        {
          kind: 'placeholder',
          id: 'compare',
          label: '比较',
          title: '比较',
          icon: IconCompare,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'merge-docs',
          label: '合并',
          title: '合并',
          icon: IconMergeDocs,
          large: true
        }
      ]
    },
    {
      label: '保护',
      items: [
        {
          kind: 'placeholder',
          id: 'restrict',
          label: '限制编辑',
          title: '限制编辑',
          icon: IconRestrictEditing,
          large: true
        }
      ]
    }
  ],
  视图: [
    {
      label: '视图',
      items: [
        {
          kind: 'placeholder',
          id: 'read-mode',
          label: '阅读视图',
          title: '阅读视图',
          icon: IconReadingView,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'page-view',
          label: '页面视图',
          title: '页面视图',
          icon: IconPageView,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'web-view',
          label: 'Web 版式视图',
          title: 'Web 版式视图',
          icon: IconWebLayout,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'outline-view',
          label: '大纲视图',
          title: '大纲视图',
          icon: IconOutlineView,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'draft-view',
          label: '草稿视图',
          title: '草稿视图',
          icon: IconDraftView,
          large: true
        }
      ]
    },
    {
      label: '显示',
      items: [
        { kind: 'placeholder', id: 'ruler', label: '标尺', title: '标尺', icon: IconRuler, large: true },
        { kind: 'placeholder', id: 'gridlines', label: '网格线', title: '网格线', icon: IconGrid, large: true },
        {
          // 与「布局」页那个选择窗格是同一类东西，共用图标出口。
          kind: 'placeholder',
          id: 'nav-pane',
          label: '导航窗格',
          title: '导航窗格',
          icon: IconSelectionPane,
          large: true
        }
      ]
    },
    {
      label: '显示比例',
      items: [
        {
          kind: 'placeholder',
          id: 'one-page',
          label: '单页',
          title: '单页',
          icon: IconPageView,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'multi-page',
          label: '多页',
          title: '多页',
          icon: IconMultiPage,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'page-width',
          label: '页宽',
          title: '页宽',
          icon: IconPageWidth,
          large: true
        },
        { kind: 'placeholder', id: 'zoom', label: '缩放', title: '缩放', icon: IconZoom, large: true }
      ]
    },
    {
      label: '窗口',
      items: [
        {
          kind: 'placeholder',
          id: 'new-window',
          label: '新建窗口',
          title: '新建窗口',
          icon: IconNewWindow,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'split',
          label: '拆分',
          title: '拆分',
          icon: IconSplitWindow,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'side-by-side',
          label: '并排查看',
          title: '并排查看',
          icon: IconSideBySide,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'sync-scroll',
          label: '同步滚动',
          title: '同步滚动',
          icon: IconSyncScroll,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'switch-window',
          label: '切换窗口',
          title: '切换窗口',
          icon: IconSwitchWindow,
          large: true
        }
      ]
    },
    {
      label: '宏',
      items: [
        { kind: 'placeholder', id: 'macro', label: '宏', title: '宏', icon: IconMacro, large: true }
      ]
    }
  ]
}

export function Ribbon({
  docTitle,
  onDocTitleChange,
  darkPaper,
  onDarkPaperChange,
  themeSource,
  onThemeSourceChange,
  novelOpen
}: {
  docTitle: string
  onDocTitleChange: (next: string) => void
  darkPaper: boolean
  onDarkPaperChange: (next: boolean) => void
  themeSource: ThemeSource
  onThemeSourceChange: (next: ThemeSource) => void
  /** 有没有打开小说。设置里「当前书」的比例框据此禁用——没有书就没有「当前书」。 */
  novelOpen: boolean
}) {
  const [tab, setTab] = useState<RibbonTab>('开始')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 设置对话框的快捷键：⌘/Ctrl + ,（macOS 上「设置」的惯例键）
  //
  // 【为什么用 e.code 而不是 e.key】与左侧栏的 ⌘/Ctrl+Shift+H 同理：`e.key` 会随修饰键
  // 与键盘布局变（按住 Shift 时 ',', 在非 QWERTY 布局下还可能是别的字符），而
  // `e.code === 'Comma'` 按物理按键位置判定，不受这两件事影响。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.code !== 'Comma') return
      e.preventDefault()
      setSettingsOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="wt-ribbon" data-testid="ribbon">
      <div className="wt-ribbon__title">
        {/* 这里显示的是用户可改的文档名，**不是小说文件名**——那是导入时唯一的泄露点。
            它现在是一段静态文本：改名挪进了设置对话框，蓝条上不再有可点的东西。 */}
        <span className="wt-ribbon__title-doc" data-testid="doc-title">
          {docTitle}
        </span>
        {/* 分隔符**单独成一个元素**，不并进上面那个 span：`doc-title` 的 textContent 必须
            ***正好*** 是文档名（设置对话框与多条测试都按这个口径断言），并进去就变成
            「文档1 - Word」了。顺序按 Windows 的惯例写成「文档名 - 应用名」。 */}
        <span className="wt-ribbon__title-sep">-</span>
        <span className="wt-ribbon__title-app">Word</span>
      </div>
      <div className="wt-tabs" role="tablist">
        {RIBBON_TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`wt-tab ${tab === name ? 'wt-tab--active' : ''}`}
            data-testid={`tab-${name}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <Toolbar groups={TABS[tab]} onOpenSettings={() => setSettingsOpen(true)} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        docTitle={docTitle}
        onDocTitleChange={onDocTitleChange}
        darkPaper={darkPaper}
        onDarkPaperChange={onDarkPaperChange}
        themeSource={themeSource}
        onThemeSourceChange={onThemeSourceChange}
        novelOpen={novelOpen}
      />
    </div>
  )
}
```

- [ ] **Step 5: 写失败测试 `tests/unit/ribbon.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Ribbon, RIBBON_TABS } from '../../src/renderer/src/components/Ribbon'
import { Toast } from '../../src/renderer/src/components/Toast'
import { ToolbarProvider } from '../../src/renderer/src/state/ToolbarContext'

function setup(): void {
  render(
    <ToolbarProvider>
      <Ribbon
        docTitle="文档1"
        onDocTitleChange={() => {}}
        darkPaper={false}
        onDarkPaperChange={() => {}}
        themeSource="system"
        onThemeSourceChange={() => {}}
        novelOpen={false}
      />
      <Toast />
    </ToolbarProvider>
  )
}

describe('蓝条上的文档名', () => {
  it('是一段静态文本：点它不再变成输入框（改名挪进了设置对话框）', () => {
    setup()
    expect(screen.getByTestId('doc-title').textContent).toBe('文档1')

    fireEvent.click(screen.getByTestId('doc-title'))

    expect(screen.queryByTestId('doc-title-input')).toBeNull()
    expect(screen.getByTestId('doc-title').textContent).toBe('文档1')
  })
})

describe('Ribbon 选项卡', () => {
  it('渲染七个选项卡，默认选中「开始」', () => {
    setup()
    expect(RIBBON_TABS).toHaveLength(7)
    for (const name of RIBBON_TABS) {
      expect(screen.getByTestId(`tab-${name}`)).toBeTruthy()
    }
    expect(screen.getByTestId('tab-开始').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('tab-文件').getAttribute('aria-selected')).toBe('false')
  })

  it('点击选项卡切换选中态并换出对应工具组', () => {
    setup()
    fireEvent.click(screen.getByTestId('tab-文件'))
    expect(screen.getByTestId('tab-文件').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('btn-settings')).toBeTruthy()
    expect(screen.queryByTestId('btn-bold')).toBeNull()
  })
})

describe('占位按钮必须可点击且有反馈', () => {
  it('点击「导出 docx」弹出 toast', async () => {
    setup()
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-export-docx'))
    expect(screen.getByTestId('toast').textContent).toBe('演示占位功能，未实现')
    await waitFor(() => expect(screen.queryByTestId('toast')).toBeNull(), { timeout: 3000 })
  })

  it('点击格式按钮切换按下态，再点一次取消', () => {
    setup()
    const bold = screen.getByTestId('btn-bold')
    expect(bold.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(bold)
    expect(screen.getByTestId('btn-bold').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('btn-bold').className).toContain('wt-btn--active')
    fireEvent.click(screen.getByTestId('btn-bold'))
    expect(screen.getByTestId('btn-bold').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('真实功能不再摆在工具栏里', () => {
  it('七个选项卡下都找不到比例/模式/导入/清除（它们整组搬进了设置对话框）', () => {
    setup()
    for (const name of RIBBON_TABS) {
      fireEvent.click(screen.getByTestId(`tab-${name}`))
      expect(screen.queryByTestId('ratio-input')).toBeNull()
      expect(screen.queryByTestId('mode-button')).toBeNull()
      expect(screen.queryByTestId('btn-import')).toBeNull()
      expect(screen.queryByTestId('btn-clear-session')).toBeNull()
    }
  })

  it('工具栏里唯一的真实功能入口是「文件」选项卡下的「设置」按钮', () => {
    setup()
    // 默认的「开始」选项卡下没有它
    expect(screen.queryByTestId('btn-settings')).toBeNull()

    fireEvent.click(screen.getByTestId('tab-文件'))
    expect(screen.getByTestId('btn-settings')).toBeTruthy()

    // 点了它，对话框才出现（这两个控件才算「在界面上」）
    fireEvent.click(screen.getByTestId('btn-settings'))
    expect(screen.getByTestId('settings')).toBeTruthy()
    expect(screen.getByTestId('ratio-input')).toBeTruthy()
  })
})
```

- [ ] **Step 6: 运行确认失败，然后实现，再确认通过**

Run: `pnpm vitest run tests/unit/ribbon.test.tsx`
先 FAIL（模块不存在），按 Step 1–4 实现后再次运行。
Expected: 全部 PASS。

- [ ] **Step 7: 接进 App 并手动验证**

把 `App.tsx` 里写死的 `div.wt-ribbon` 整块（标题条 + 两个假选项卡 + 空的 `.wt-toolbar`）换成 `<Ribbon docTitle="文档1" />`，并在 `App` 末尾渲染 `<Toast />`。

**`ToolbarProvider` 必须包住整个 `App`，不能只包 `Ribbon`。** `Toast` 内部调用 `useToolbar()`，落在 Provider 之外会抛 `useToolbar 必须在 ToolbarProvider 内使用`，`layout.test.tsx` 的 `render(<App />)` 会当场变红——所以「替换 `.wt-ribbon` 骨架为 `<ToolbarProvider><Ribbon/></ToolbarProvider>`」这句要读成「Ribbon 必须处于 Provider 之内」，而不是「Provider 的范围就到此为止」。

Run: `pnpm dev`
Expected: 点「文件」「插入」等选项卡能切换工具组；点「B」会高亮；点「导出 docx」右下弹出提示；比例框能改。

本步之后 `src/renderer/src/App.tsx` 的最终全文：

> **这是 Task 8 时期的版本，Task 12 之后已更新**（Task 12 的 Step 3 整体重写：接引擎、会话持久化、
> 缺 `window.api` 时降级、让 `.wt-canvas` 跟随光标）。**当前有效的是 Task 12 Step 3 的围栏**，
> 这一版留在 Task 8 里备查。

```tsx
import { Ribbon } from './components/Ribbon'
import { Toast } from './components/Toast'
import { ToolbarProvider } from './state/ToolbarContext'

export default function App() {
  return (
    <ToolbarProvider>
      <div className="wt-app" data-testid="app-root">
        <Ribbon docTitle="文档1" />

        <div className="wt-body">
          <aside className="wt-sidebar">
            <div className="wt-sidebar__header">章节</div>
            <div className="wt-sidebar__list" />
          </aside>
          <main className="wt-canvas">
            <div className="wt-page">
              <div className="wt-page__empty">
                文件 → 导入小说，或按 Ctrl+O
                <br />
                导入后在文档区打字，字会按比例从小说里取出来。
              </div>
            </div>
          </main>
        </div>

        <div className="wt-statusbar">
          <span>就绪</span>
        </div>
        <Toast />
      </div>
    </ToolbarProvider>
  )
}
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/state/ToolbarContext.tsx \
        src/renderer/src/components/Toast.tsx \
        src/renderer/src/components/Toolbar.tsx \
        src/renderer/src/components/Ribbon.tsx \
        src/renderer/src/App.tsx \
        tests/unit/ribbon.test.tsx \
        docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md
git commit -F /tmp/task8-msg.txt   # 切勿用内联 -m：ASCII 引号会静默截断提交信息
```

---

## Task 9: 左侧章节列表（虚拟滚动 + 跳转 + 进度）

**Files:**
- Create: `src/renderer/src/components/ChapterList.tsx`
- Test: `tests/unit/chapterList.test.tsx`

**Interfaces:**
- Consumes: `Novel` / `Chapter` 类型；Task 7 的 `.chapter-item` 样式
- Produces: `<ChapterList novel={Novel | null} activeChapter={number} chapterPos={readonly number[]} onJump={(i: number) => void} />`
  - `data-testid="chapter-list"`、`chapter-item-${i}`、`chapter-pct-${i}`
  - `data-testid="sidebar-toggle"`（收起/展开整条左侧栏；收起后它是左边那条 12px 细缝上的按钮，另有 ⌘/Ctrl+Shift+H 快捷键）
  - 行高常量 `ROW_HEIGHT = 32`

- [ ] **Step 1: 写 `src/renderer/src/components/ChapterList.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Novel } from '../../../core/types'
import { IconCollapse, IconExpand } from './icons'

export const ROW_HEIGHT = 32
const OVERSCAN = 6

export interface ChapterListProps {
  novel: Novel | null
  activeChapter: number
  // 与 EngineState.chapterPos 同型：快照是冻结的只读数组，这里照抄类型，
  // 别在组件里写回它（写了在严格模式下抛 TypeError，非严格模式下被静默丢弃）。
  chapterPos: readonly number[]
  onJump: (index: number) => void
}

export function ChapterList({
  novel,
  activeChapter,
  chapterPos,
  onJump
}: ChapterListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(400)
  /** 整条左栏（书名信息 + 章节列表）是否收起。刻意只放在内存里，见下面 effect 的注释。 */
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => setViewport(el.clientHeight || 400)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
    // 依赖 collapsed 而不是 []：收起时整条 aside 不渲染、scrollRef.current 是 null，
    // 这个 effect 会直接返回；重新展开后必须【再跑一次】去量真实高度，否则 viewport
    // 会一直停在默认的 400，虚拟滚动按错误的视口高度算窗口。
  }, [collapsed])

  // 打字推进时，让当前章节滚进可视区域
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !novel) return
    const top = activeChapter * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    // 带上 collapsed：重新展开时列表是刚挂载的，需要把当前章节滚回可视区
  }, [activeChapter, novel, collapsed])

  // 左侧栏的显示/隐藏快捷键：⌘/Ctrl + Shift + H
  //
  // 【为什么挂在 window 上还能收到】InputCapture 在「纯按键」模式下对**带修饰键的组合键**
  // 是直接放行的（它的 handleKeyDown 里 `if (e.ctrlKey || e.metaKey || e.altKey) return`），
  // 输入法模式下更是完全不拦截 keydown——所以这个组合不会被抽字逻辑吃掉。
  //
  // 【为什么用 e.code 而不是 e.key】按住 Shift 时 `e.key` 是大写 'H'，而输入法或非 QWERTY
  // 布局还可能给出别的字符；`e.code === 'KeyH'` 是按物理按键位置判定的，不受这两件事影响。
  //
  // 【为什么状态只在内存里】用户没要求持久化，而且它现在不属于 PersistedSession 的字段——
  // 那个结构由引擎产出、还有一条必填字段的校验器，加 UI 状态进去要连带动 schema 与校验。
  // 要「重启后仍保持隐藏」的话，单独给这个开关做持久化即可，不必塞进会话。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return
      if (e.code !== 'KeyH') return
      e.preventDefault()
      setCollapsed((v) => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const chapters = novel?.chapters ?? []
  const total = chapters.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
  const visible = chapters.slice(first, last)

  // 收起时整条 aside 都不渲染，只留一条细缝（下面那个按钮）。
  //
  // 【为什么还留一条缝，而不是干脆什么都不留】那个快捷键是新用户不会知道的；全无入口的话，
  // 鼠标用户一旦收起就再也调不回来（只能重启）。细缝只有 12px、颜色很淡，视觉上近乎不存在，
  // 但鼠标总能找回来。
  if (collapsed) {
    return (
      <button
        type="button"
        className="wt-sidebar__rail"
        data-testid="sidebar-toggle"
        aria-expanded={false}
        aria-label="显示章节栏"
        title="显示章节栏（⌘/Ctrl + Shift + H）"
        onClick={() => setCollapsed(false)}
      >
        <IconExpand className="wt-sidebar__rail-icon" />
      </button>
    )
  }

  return (
    <aside className="wt-sidebar">
      <div className="wt-sidebar__header">
        <button
          type="button"
          className="wt-sidebar__toggle"
          data-testid="sidebar-toggle"
          aria-expanded
          aria-label="隐藏章节栏"
          title="隐藏章节栏（⌘/Ctrl + Shift + H）"
          onClick={() => setCollapsed(true)}
        >
          <IconCollapse className="wt-sidebar__toggle-icon" />
        </button>
        {novel ? novel.title : '未导入小说'}
        <div className="wt-sidebar__sub">
          {novel ? `共 ${total} 章 · ${novel.encoding}` : '文件 → 设置 → 导入小说'}
        </div>
      </div>
      <div
        className="wt-sidebar__list"
        data-testid="chapter-list"
        ref={scrollRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
          {visible.map((chapter, offset) => {
            const index = first + offset
            const pos = chapterPos[index] ?? 0
            const pct = chapter.charCount === 0 ? 100 : Math.min(100, Math.round((pos / chapter.charCount) * 100))
            return (
              <div
                key={chapter.index}
                className={`chapter-item ${index === activeChapter ? 'chapter-item--active' : ''}`}
                data-testid={`chapter-item-${index}`}
                style={{
                  position: 'absolute',
                  top: index * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT
                }}
                title={chapter.title}
                onClick={() => onJump(index)}
              >
                <span className="chapter-item__title">{chapter.title}</span>
                <span className="chapter-item__pct" data-testid={`chapter-pct-${index}`}>
                  {pct}%
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: 写测试 `tests/unit/chapterList.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChapterList, ROW_HEIGHT } from '../../src/renderer/src/components/ChapterList'
import { splitChapters } from '../../src/core/chapters'
import type { Novel } from '../../src/core/types'

beforeAll(() => {
  // jsdom 不实现 ResizeObserver
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
})

function makeNovel(count: number): Novel {
  const text = Array.from({ length: count }, (_, i) => `第${i + 1}章 标题${i + 1}\n正文内容。`).join('\n')
  const { flatText, chapters } = splitChapters(text, '大书')
  return {
    title: '大书',
    sourcePath: '/tmp/大书.txt',
    encoding: 'UTF-8',
    hadBom: false,
    flatText,
    chapters
  }
}

describe('ChapterList', () => {
  it('未导入时显示引导文案', () => {
    render(<ChapterList novel={null} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByText('未导入小说')).toBeTruthy()
    // 导入按钮搬进设置对话框之后，这条引导文案跟着改了（旧的指向一个已经不存在的按钮）
    expect(screen.getByText('文件 → 设置 → 导入小说')).toBeTruthy()
  })

  it('显示书名与章节数', () => {
    const novel = makeNovel(5)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByText('大书')).toBeTruthy()
    expect(screen.getByText(/共 5 章/)).toBeTruthy()
  })

  it('点按钮收起整条左栏，章节列表一起消失；再点一次展开', () => {
    const novel = makeNovel(5)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByText('大书')).toBeTruthy()
    expect(screen.getByTestId('chapter-list')).toBeTruthy()

    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    // 书名、【章节列表本身】、以及里面的行，都要没
    expect(screen.queryByText('大书')).toBeNull()
    expect(screen.queryByText(/共 5 章/)).toBeNull()
    expect(screen.queryByTestId('chapter-list')).toBeNull()
    expect(screen.queryByTestId('chapter-item-0')).toBeNull()
    expect(screen.queryByTestId('chapter-pct-0')).toBeNull()

    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    expect(screen.getByText('大书')).toBeTruthy()
    expect(screen.getByTestId('chapter-list')).toBeTruthy()
    expect(screen.getByTestId('chapter-item-0')).toBeTruthy()
  })

  it('收起后细缝按钮仍在，且真的能把它调回来', () => {
    const novel = makeNovel(5)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    // 只断言「按钮还在」不够——一个点不动的残留按钮也能过。要断言它真的切回来了。
    const rail = screen.getByTestId('sidebar-toggle')
    expect(rail.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(rail)
    expect(screen.getByText('大书')).toBeTruthy()
    expect(screen.getByTestId('chapter-list')).toBeTruthy()
  })

  it('⌘/Ctrl + Shift + H 与按钮等效', () => {
    const novel = makeNovel(5)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)

    fireEvent.keyDown(window, { key: 'H', code: 'KeyH', metaKey: true, shiftKey: true })
    expect(screen.queryByTestId('chapter-list')).toBeNull()

    fireEvent.keyDown(window, { key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true })
    expect(screen.getByTestId('chapter-list')).toBeTruthy()
  })

  it('少了 Shift 或修饰键时不触发（别把正常打字吃掉）', () => {
    const novel = makeNovel(5)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)

    fireEvent.keyDown(window, { key: 'h', code: 'KeyH' })
    fireEvent.keyDown(window, { key: 'H', code: 'KeyH', shiftKey: true })
    fireEvent.keyDown(window, { key: 'h', code: 'KeyH', metaKey: true })
    fireEvent.keyDown(window, { key: 'K', code: 'KeyK', metaKey: true, shiftKey: true })
    expect(screen.getByText('大书')).toBeTruthy()
  })

  it('章节很多时只渲染可视区附近的行（虚拟滚动）', () => {
    const novel = makeNovel(2000)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    const rendered = screen.getAllByTestId(/^chapter-item-\d+$/)
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(100)
    expect(screen.getByTestId('chapter-item-0')).toBeTruthy()
    expect(screen.queryByTestId('chapter-item-1500')).toBeNull()
  })

  it('点击章节回调索引', () => {
    const novel = makeNovel(10)
    const onJump = vi.fn()
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={onJump} />)
    fireEvent.click(screen.getByTestId('chapter-item-3'))
    expect(onJump).toHaveBeenCalledWith(3)
  })

  it('当前章节带高亮类', () => {
    const novel = makeNovel(10)
    render(<ChapterList novel={novel} activeChapter={2} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByTestId('chapter-item-2').className).toContain('chapter-item--active')
    expect(screen.getByTestId('chapter-item-1').className).not.toContain('chapter-item--active')
  })

  it('按 chapterPos 显示阅读百分比', () => {
    const novel = makeNovel(3)
    const c0 = novel.chapters[0]
    const chapterPos = [Math.floor(c0.charCount / 2), 0, 0]
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={chapterPos} onJump={() => {}} />)
    const pct = Number.parseInt(screen.getByTestId('chapter-pct-0').textContent ?? '0', 10)
    expect(pct).toBeGreaterThanOrEqual(49)
    expect(pct).toBeLessThanOrEqual(51)
    expect(screen.getByTestId('chapter-pct-1').textContent).toBe('0%')
  })

  it('行高常量与样式一致', () => {
    expect(ROW_HEIGHT).toBe(32)
  })
})

// —— 以下为 Task 9 实现者补的用例：计划里那 7 条从未触发过 scroll ——
// 也就是说「滚动 → 重算可视窗口 → 换出不同的行」这条组件的核心机制零覆盖，
// 把 onScroll 回调改成空函数，上面 7 条全绿。

// 组件内部的 overscan 行数（ChapterList.tsx 的 OVERSCAN）与 jsdom 下的视口兜底值：
// jsdom 没有布局，clientHeight 恒为 0，mount 时的 measure() 会退回 400px。
// 两个数字都与组件实现保持一致，改组件时必须同步改这里。
const OVERSCAN = 6
const VIEWPORT_FALLBACK = 400

describe('ChapterList 虚拟滚动', () => {
  it('滚动后重算可视窗口，换出不同的行', () => {
    const novel = makeNovel(3000)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByTestId('chapter-item-0')).toBeTruthy()
    expect(screen.queryByTestId('chapter-item-2000')).toBeNull()

    const el = screen.getByTestId('chapter-list') as HTMLDivElement
    el.scrollTop = 2000 * ROW_HEIGHT
    fireEvent.scroll(el)

    // 2000 行进了可视区，0 行被换出去 —— 这两条只有在 onScroll 真的把 scrollTop
    // 写进 state、组件因此重算窗口时才会同时成立。
    expect(screen.getByTestId('chapter-item-2000')).toBeTruthy()
    expect(screen.queryByTestId('chapter-item-0')).toBeNull()
  })

  it('窗口在可视区两端各多渲染 OVERSCAN 行（滚动时不闪白）', () => {
    const novel = makeNovel(3000)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    const el = screen.getByTestId('chapter-list') as HTMLDivElement
    el.scrollTop = 2000 * ROW_HEIGHT
    fireEvent.scroll(el)

    // 可视区从第 2000 行开始，高度 400px ≈ 12.5 行，所以可视区末端（不含）是第 2013 行；
    // 窗口再向两端各扩 OVERSCAN 行 —— 实际渲染 1994..2018。
    // 少了这个 overscan，快速滚动时刚进视口的那几行会来不及渲染（闪白）。
    const topRow = 2000
    const bottomRow = topRow + Math.ceil(VIEWPORT_FALLBACK / ROW_HEIGHT)
    expect(screen.getByTestId(`chapter-item-${topRow - OVERSCAN}`)).toBeTruthy()
    expect(screen.queryByTestId(`chapter-item-${topRow - OVERSCAN - 1}`)).toBeNull()
    expect(screen.getByTestId(`chapter-item-${bottomRow + OVERSCAN - 1}`)).toBeTruthy()
    expect(screen.queryByTestId(`chapter-item-${bottomRow + OVERSCAN}`)).toBeNull()
  })

  it('chapterPos 比章节数短时，缺项按 0 计（不显示 NaN%）', () => {
    const novel = makeNovel(5)
    // 快照里的 chapterPos 长度恒等于 chapters.length，但只有第 0 章有进度
    render(
      <ChapterList
        novel={novel}
        activeChapter={0}
        chapterPos={[novel.chapters[0].charCount]}
        onJump={() => {}}
      />
    )
    expect(screen.getByTestId('chapter-pct-0').textContent).toBe('100%')
    expect(screen.getByTestId('chapter-pct-4').textContent).toBe('0%')
  })

  it('进度超过该章长度时百分比封顶 100', () => {
    const novel = makeNovel(3)
    // 存档是旧正文、当前是重新导入的新正文时，pos 可以超过 charCount
    const stale = novel.chapters[0].charCount * 2
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[stale, 0, 0]} onJump={() => {}} />)
    expect(screen.getByTestId('chapter-pct-0').textContent).toBe('100%')
  })
})

describe('ChapterList 当前章节自动滚进可视区', () => {
  it('当前章节在视口下方时滚到行底对齐，在上方时滚到行顶对齐', () => {
    const novel = makeNovel(200)
    const { rerender } = render(
      <ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />
    )
    const el = screen.getByTestId('chapter-list') as HTMLDivElement
    // jsdom 没有布局，clientHeight 恒为 0。不补一个真实视口高度，「目标行是否已在
    // 可视区内」这个判断就只剩 clientHeight === 0 的退化分支（挂载时会把 scrollTop
    // 顶到目标行底边），所以这里在实例上覆盖掉它，测的是带视口高度时真正会跑的那条式子。
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 400 })
    el.scrollTop = 0

    // 第 30 行（top=960, bottom=992）在视口 0..400 之外 → 滚到行底贴着视口下沿
    rerender(<ChapterList novel={novel} activeChapter={30} chapterPos={[]} onJump={() => {}} />)
    expect(el.scrollTop).toBe(30 * ROW_HEIGHT + ROW_HEIGHT - 400)

    // 第 25 行（top=800, bottom=832）已落在 592..992 里 → 不该动列表
    rerender(<ChapterList novel={novel} activeChapter={25} chapterPos={[]} onJump={() => {}} />)
    expect(el.scrollTop).toBe(30 * ROW_HEIGHT + ROW_HEIGHT - 400)

    // 第 2 行（top=64）在视口上方 → 滚到行顶对齐
    rerender(<ChapterList novel={novel} activeChapter={2} chapterPos={[]} onJump={() => {}} />)
    expect(el.scrollTop).toBe(2 * ROW_HEIGHT)
  })
})
```

> **实施者补记（Task 9）**：上面这段测试是计划原样。但它 7 条用例**从未触发过 `scroll`**——把 `onScroll`
> 回调改成空函数，7 条全绿，也就是说「滚动 → 重算可视窗口 → 换出不同的行」这条核心机制零覆盖。
> 实际交付的 `tests/unit/chapterList.test.tsx` 在此之后追加了 5 条：滚动换行、窗口两端 overscan 边界、
> `chapterPos` 缺项按 0 计、百分比封顶 100、`activeChapter` 变化时的自动滚动。**围栏里就是交付的文件**（12 条）。
> 注意：自动滚动那条依赖 `clientHeight`，而 jsdom 里它恒为 0，用例是在元素实例上 `Object.defineProperty`
> 覆盖成 400 才走到「目标行是否已在可视区内」的真实分支；不覆盖时只会走 clientHeight === 0 的退化分支。

- [ ] **Step 3: 运行测试并修复**

Run: `pnpm vitest run tests/unit/chapterList.test.tsx`
Expected: PASS。若虚拟滚动用例失败，多半是 jsdom 里 `clientHeight` 为 0 —— `viewport` 的默认值 400 已经兜底，确认 `setViewport` 没有被 `measure()` 覆盖成 0。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ChapterList.tsx \
        tests/unit/chapterList.test.tsx \
        docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md
git commit -F /tmp/task9-msg.txt   # 切勿用内联 -m：ASCII 引号会静默截断提交信息
```

---

## Task 10: 阅读页面与状态栏

**Files:**
- Create: `src/renderer/src/components/Page.tsx`, `src/renderer/src/components/StatusBar.tsx`
- Test: `tests/unit/page.test.tsx`, `tests/unit/statusBar.test.tsx`

**Interfaces:**
- Consumes: `RENDER_WINDOW_LIMIT`；Task 7 的 CSS
- Produces:
  - `<Page visibleText={string} expanded={boolean} onToggleExpand={() => void} empty={boolean} children />`
    - `data-testid="page-text"`、`page-fold`、`page-empty`
    - 折叠逻辑：`visibleText.length > RENDER_WINDOW_LIMIT && !expanded` 时只渲染末尾 `RENDER_WINDOW_LIMIT` 字，顶部显示折叠提示
  - `<StatusBar novel={Novel | null} revealedChars={number} activeChapter={number} ratio={number} mode={InputMode} startedAt={number | null} now={number} />`
    - `data-testid="status-chars"`、`status-chapter`、`status-ratio`、`status-mode`、`status-encoding`、`status-elapsed`
  - `formatElapsed(ms: number): string`（导出以便单测）

- [ ] **Step 1: 写 `src/renderer/src/components/Page.tsx`**

```tsx
import type { ReactNode } from 'react'
import { RENDER_WINDOW_LIMIT } from '../../../core/types'

export interface PageProps {
  visibleText: string
  expanded: boolean
  onToggleExpand: () => void
  empty: boolean
  children?: ReactNode
}

export function Page({
  visibleText,
  expanded,
  onToggleExpand,
  empty,
  children
}: PageProps) {
  const folded = !expanded && visibleText.length > RENDER_WINDOW_LIMIT
  const shown = folded ? visibleText.slice(visibleText.length - RENDER_WINDOW_LIMIT) : visibleText

  return (
    <div className="wt-page" data-testid="page">
      {empty ? (
        <div className="wt-page__empty" data-testid="page-empty">
          文件 → 设置 → 导入小说，或按 Ctrl+O
          <br />
          导入后在文档区打字，字会按比例从小说里取出来。
        </div>
      ) : (
        <>
          {folded && (
            <div
              className="wt-page__fold"
              data-testid="page-fold"
              onClick={onToggleExpand}
              role="button"
            >
              ……已折叠前文 {visibleText.length - RENDER_WINDOW_LIMIT} 字（点击展开全部）
            </div>
          )}
          <div className="wt-page__text" data-testid="page-text">
            {shown}
            <span className="wt-caret" data-testid="caret" />
          </div>
        </>
      )}
      {children}
    </div>
  )
}
```

- [ ] **Step 2: 写 `src/renderer/src/components/StatusBar.tsx`**

```tsx
import type { InputMode, Novel } from '../../../core/types'

export interface StatusBarProps {
  novel: Novel | null
  revealedChars: number
  activeChapter: number
  ratio: number
  mode: InputMode
}

/**
 * 底部状态栏。
 *
 * 【刻意【不】显示的三样东西，以及为什么】它们曾经都在这里，都是伪装上的破绽：
 *
 * 1. **「已显示 N / 全书 M 字」**——真 Word 的状态栏只报**全文字数**，从不报「已显示多少」。
 *    「已显示」这个词组本身就说明了有人在按进度往外吐字。
 * 2. **「用时 HH:MM:SS」**——真 Word 没有阅读计时器。它同时是 App 里那个每秒一次
 *    `setInterval` 的唯一用途，去掉之后那一层重渲染也一并没了。
 * 3. **「第 N 章 / 共 M 章」**——改写成 `N / M`（见下）。
 *
 * 【章节位置为什么写成 `2 / 1382`】真 Word 状态栏左下角就是页码，形如「第 1 页，共 3 页」
 * 或简写成 `1 / 3`。写成 `2 / 1382` 反而**比中文全称更像 Word**，同时把「章」这个字
 * （小说阅读器最直接的标志）去掉了。配色再压低一档，不让它抢眼。
 */
export function StatusBar({ novel, revealedChars, activeChapter, ratio, mode }: StatusBarProps) {
  const totalChars = novel?.flatText.length ?? 0
  const totalChapters = novel?.chapters.length ?? 0
  const percent = totalChars === 0 ? 0 : Math.floor((revealedChars / totalChars) * 100)

  return (
    <div className="wt-statusbar" data-testid="statusbar">
      <span className="wt-statusbar__dim" data-testid="status-chapter">
        {novel ? `${activeChapter + 1} / ${totalChapters}` : '—'}
      </span>
      <span data-testid="status-ratio">比例 1:{ratio}</span>
      <span data-testid="status-encoding">编码 {novel?.encoding ?? '—'}</span>
      <span data-testid="status-mode">输入模式 {mode === 'ime' ? '输入法' : '纯按键'}</span>
      <span className="wt-statusbar__spacer" />
      <span data-testid="status-percent">{percent}%</span>
      <span>中文(中国)</span>
    </div>
  )
}
```

- [ ] **Step 3: 写测试 `tests/unit/page.test.tsx` 与 `tests/unit/statusBar.test.tsx`**

`tests/unit/page.test.tsx`：
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Page } from '../../src/renderer/src/components/Page'
import { RENDER_WINDOW_LIMIT } from '../../src/core/types'

/**
 * 折叠用例的 fixture 必须让「渲染的是哪一段」可判：文本全同质（例如全是 'A'）时，
 * 取开头、取末尾、根本不折叠，三种实现渲染出来的字符串看起来一模一样，断言分辨不出来
 * ——那等于折叠逻辑没有测试。头尾各放一个标记就够了。
 */
const HEAD = 'HEAD-MARKER'
const TAIL = 'TAIL-MARKER'
/** 长 RENDER_WINDOW_LIMIT + HEAD.length + TAIL.length，必然触发折叠。 */
const LONG_TEXT = HEAD + 'A'.repeat(RENDER_WINDOW_LIMIT) + TAIL

describe('Page', () => {
  it('空状态显示引导文案且没有光标', () => {
    render(<Page visibleText="" expanded={false} onToggleExpand={() => {}} empty />)
    expect(screen.getByTestId('page-empty')).toBeTruthy()
    expect(screen.queryByTestId('caret')).toBeNull()
  })

  it('把 visibleText 原样渲染进文档区', () => {
    render(<Page visibleText="第一章 风起\n正文。" expanded={false} onToggleExpand={() => {}} empty={false} />)
    expect(screen.getByTestId('page-text').textContent).toContain('第一章 风起')
    expect(screen.getByTestId('page-text').textContent).toContain('正文。')
    expect(screen.getByTestId('caret')).toBeTruthy()
  })

  it('超过上限时折叠前文，只渲染末尾部分', () => {
    // 前提自检：fixture 必须真的越过上限，否则本用例什么都没测。
    expect(LONG_TEXT.length).toBeGreaterThan(RENDER_WINDOW_LIMIT)
    render(<Page visibleText={LONG_TEXT} expanded={false} onToggleExpand={() => {}} empty={false} />)
    // 「折叠」的实质是丢掉开头那一截：末尾标记在、开头标记不在。
    // 末条断言不是 not.toContain('已折叠')——折叠提示是 page-text 的兄弟节点，
    // 那句话恒真，测不出任何东西。
    const shownText = screen.getByTestId('page-text').textContent ?? ''
    expect(shownText).toContain(TAIL)
    expect(shownText).not.toContain(HEAD)
    expect(screen.getByTestId('page-fold').textContent).toContain(
      String(LONG_TEXT.length - RENDER_WINDOW_LIMIT)
    )
  })

  it('点击折叠提示会请求展开', () => {
    const onToggleExpand = vi.fn()
    const text = 'A'.repeat(RENDER_WINDOW_LIMIT + 10)
    render(<Page visibleText={text} expanded={false} onToggleExpand={onToggleExpand} empty={false} />)
    fireEvent.click(screen.getByTestId('page-fold'))
    expect(onToggleExpand).toHaveBeenCalledTimes(1)
  })

  it('展开后显示全文，且不再显示折叠提示', () => {
    render(<Page visibleText={LONG_TEXT} expanded onToggleExpand={() => {}} empty={false} />)
    expect(screen.queryByTestId('page-fold')).toBeNull()
    // 只断言提示消失是不够的：提示没了、正文却仍停在折叠窗口上，同样满足上一条。
    const shownText = screen.getByTestId('page-text').textContent ?? ''
    expect(shownText).toContain(HEAD)
    expect(shownText).toContain(TAIL)
  })

  it('未超过上限时不折叠', () => {
    render(<Page visibleText={'短文本'} expanded={false} onToggleExpand={() => {}} empty={false} />)
    expect(screen.queryByTestId('page-fold')).toBeNull()
  })
})
```

`tests/unit/statusBar.test.tsx`：
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar } from '../../src/renderer/src/components/StatusBar'
import type { Novel } from '../../src/core/types'

const novel: Novel = {
  title: '大书',
  sourcePath: '/tmp/大书.txt',
  encoding: 'GB18030',
  hadBom: false,
  flatText: 'A'.repeat(1000),
  chapters: [
    { index: 0, title: '第一章', start: 0, end: 500, charCount: 500 },
    { index: 1, title: '第二章', start: 500, end: 1000, charCount: 500 }
  ]
}

describe('StatusBar', () => {
  it('未导入小说时显示占位', () => {
    render(<StatusBar novel={null} revealedChars={0} activeChapter={0} ratio={10} mode="ime" />)
    expect(screen.getByTestId('status-chapter').textContent).toBe('—')
    expect(screen.getByTestId('status-encoding').textContent).toBe('编码 —')
    // 全书 0 字时百分比必须短路成 0，否则是 NaN%（0/0）。
    expect(screen.getByTestId('status-percent').textContent).toBe('0%')
  })

  it('章节位置写成 `2 / 2`，而不是「第 2 章 / 共 2 章」', () => {
    render(<StatusBar novel={novel} revealedChars={250} activeChapter={1} ratio={25} mode="key" />)
    // 写成页码形状（真 Word 状态栏左下角就是页码）。**断言里刻意不含「章」字**——
    // 那个字是小说阅读器最直接的标志，这份用例守的就是「它不出现」。
    const chapter = screen.getByTestId('status-chapter').textContent
    expect(chapter).toBe('2 / 2')
    expect(chapter).not.toContain('章')
  })

  it('显示比例、编码与模式', () => {
    render(<StatusBar novel={novel} revealedChars={250} activeChapter={1} ratio={25} mode="key" />)
    expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:25')
    expect(screen.getByTestId('status-encoding').textContent).toBe('编码 GB18030')
    expect(screen.getByTestId('status-mode').textContent).toBe('输入模式 纯按键')
    expect(screen.getByTestId('status-percent').textContent).toBe('25%')
  })

  it('不再有「已显示字数」与「用时」这两项', () => {
    render(<StatusBar novel={novel} revealedChars={250} activeChapter={1} ratio={25} mode="key" />)
    const text = screen.getByTestId('statusbar').textContent ?? ''
    // 「已显示 N / 全书 M 字」是伪装上的破绽：真 Word 只报全文字数，从不报「已显示多少」。
    expect(text).not.toContain('已显示')
    // 真 Word 没有阅读计时器。
    expect(text).not.toContain('用时')
    expect(screen.queryByTestId('status-chars')).toBeNull()
    expect(screen.queryByTestId('status-elapsed')).toBeNull()
  })

  it('百分比向下取整', () => {
    // 259 / 1000 = 25.9%：floor 得 25，round 得 26，两者可判。
    render(<StatusBar novel={novel} revealedChars={259} activeChapter={0} ratio={10} mode="ime" />)
    expect(screen.getByTestId('status-percent').textContent).toBe('25%')
  })
})
```

- [ ] **Step 4: 运行测试**

Run: `pnpm vitest run tests/unit/page.test.tsx tests/unit/statusBar.test.tsx`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add <本任务改动的显式路径…>   # 不要用 -A：见文件头「git add -A 只在独占一棵工作树时安全」
cat > /tmp/wt-commit-msg.txt <<'EOF'
feat(renderer): 阅读页面（折叠护栏 + 光标）与状态栏
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## Task 11: 输入捕获 InputCapture ★核心交互

**Files:**
- Create: `src/renderer/src/input/InputCapture.tsx`
- Test: `tests/unit/ime.test.tsx`

**Interfaces:**
- Consumes: 一个只要求 `pump(k: number): void` 与 `backspace(k: number): void` 的引擎接口（用结构类型，测试可传 mock）
- Produces: `<InputCapture engine={{ pump, backspace }} mode={InputMode} />`
  - `data-testid="input-capture"`
  - 挂载后自动 focus，且点击窗口任意位置都会把焦点拉回来

**行为契约**（spec §4）：
- **输入法友好模式（`ime`）**
  - `compositionend` → `pump(e.data.length)`，且不把拼音字母算进去
  - `compositionstart` → 进入合成态，期间 `input` 不抽字
  - 非合成态的 `input`（直接敲英文/数字）→ 按新插入字符数 `pump`
  - `keydown` **不** `preventDefault`（否则输入法失效）
- **纯按键模式（`key`）**
  - 可打印键 `keydown`（`key.length === 1` 且无修饰键）→ `pump(1)` + `preventDefault()`
- **两模式共用**
  - `Backspace` → `backspace(1)` + `preventDefault()`
  - textarea 的 value 始终被清空，保持为空接收器
  - 方向键 / Home / End / PageUp / PageDown 不拦截

- [ ] **Step 1: 写失败测试 `tests/unit/ime.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InputCapture } from '../../src/renderer/src/input/InputCapture'
import type { InputMode } from '../../src/core/types'

// 刻意【不】写返回类型注解。Vitest 5 下 ReturnType<typeof vi.fn> 会把 T 冻结成
// 默认的 Mock<Procedure | Constructable>，赋给 (k: number) => void 时报 TS2322，
// 于是 pnpm typecheck 门禁失败——而 Task 11 的步骤只跑 vitest，这个错要到
// Task 12/13/14 和 CI 才炸。让 TS 自行推断即可（得到 Mock<Procedure>，照样带
// .mock / .mock.calls）。也不要为了「显式化」去 import Mock：引擎契约是结构类型
// （见本任务 Interfaces），不该把 Vitest 的类型漏进去。
function makeEngine() {
  return { pump: vi.fn(), backspace: vi.fn() }
}

function setup(mode: InputMode): ReturnType<typeof makeEngine> {
  const engine = makeEngine()
  render(<InputCapture engine={engine} mode={mode} />)
  return engine
}

const input = (): HTMLTextAreaElement => screen.getByTestId('input-capture') as HTMLTextAreaElement

describe('输入法友好模式', () => {
  it('compositionend 时按上屏字数 × 1 抽字（比例由引擎内部负责）', () => {
    const engine = setup('ime')
    fireEvent.compositionStart(input())
    fireEvent.compositionUpdate(input(), { data: 'ni hao' })
    fireEvent.compositionEnd(input(), { data: '你好' })
    expect(engine.pump).toHaveBeenCalledTimes(1)
    expect(engine.pump).toHaveBeenCalledWith(2)
    expect(engine.backspace).not.toHaveBeenCalled()
  })

  it('合成过程中的拼音不产生抽字', () => {
    const engine = setup('ime')
    fireEvent.compositionStart(input())
    fireEvent.compositionUpdate(input(), { data: 'n' })
    fireEvent.compositionUpdate(input(), { data: 'ni' })
    fireEvent.compositionUpdate(input(), { data: 'nihao' })
    expect(engine.pump).not.toHaveBeenCalled()
  })

  it('合成中按退格交给输入法删除拼音：既不拦截也不回退', () => {
    const engine = setup('ime')
    const el = input()
    fireEvent.compositionStart(el)
    // isComposing 由 KeyboardEvent 构造函数透传，实现读的是 e.nativeEvent.isComposing
    const notPrevented = fireEvent.keyDown(el, { key: 'Backspace', isComposing: true })
    expect(notPrevented).toBe(true)
    expect(engine.backspace).not.toHaveBeenCalled()
  })

  it('非合成态按退格照常回退并拦截', () => {
    const engine = setup('ime')
    const notPrevented = fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(notPrevented).toBe(false)
    expect(engine.backspace).toHaveBeenCalledWith(1)
  })

  it('compositionend 后 textarea 被清空', () => {
    setup('ime')
    const el = input()
    el.value = '你好'
    fireEvent.compositionEnd(el, { data: '你好' })
    fireEvent.input(el)
    expect(el.value).toBe('')
  })

  it('keydown 不拦截，保证输入法可用', () => {
    const engine = setup('ime')
    const el = input()
    fireEvent.keyDown(el, { key: 'a' })
    expect(engine.pump).not.toHaveBeenCalled()
  })

  it('非合成态的 input（直接敲英文）也按插入字数抽字', () => {
    const engine = setup('ime')
    const el = input()
    el.value = 'abc'
    fireEvent.input(el)
    expect(engine.pump).toHaveBeenCalledWith(3)
    expect(el.value).toBe('')
  })

  it('合成态的 input 不抽字（交给 compositionend）', () => {
    const engine = setup('ime')
    const el = input()
    fireEvent.compositionStart(el)
    el.value = 'nihao'
    fireEvent.input(el)
    expect(engine.pump).not.toHaveBeenCalled()
  })

  it('合成态的 input 也绝不清空 textarea（清空会打断输入法合成）', () => {
    // 这条是【真机 bug 的回归用例】，抓的是上一条抓不到的东西：
    // 上一条只断言「没抽字」，而当初的实现正是「跳过抽字、但照常清空」——
    // 清空 textarea 会打断输入法的合成会话，真机表现为候选框闪一下就没、
    // 拼音永远上不了屏、正文一个字都不出。用户实测报的就是这个。
    // jsdom 里清空 value 不会取消任何东西，所以只有直接断言 value 才守得住。
    const engine = setup('ime')
    const el = input()
    fireEvent.compositionStart(el)
    el.value = 'nihao'
    fireEvent.input(el)
    expect(el.value).toBe('nihao')
    expect(engine.pump).not.toHaveBeenCalled()
  })
})

describe('纯按键模式', () => {
  it('可打印键每次抽 1 个字并阻止默认行为', () => {
    const engine = setup('key')
    const el = input()
    const notPrevented = fireEvent.keyDown(el, { key: 'a' })
    expect(engine.pump).toHaveBeenCalledWith(1)
    expect(notPrevented).toBe(false) // fireEvent 返回 false 表示 preventDefault 被调用
  })

  it('空格也算一次输入', () => {
    const engine = setup('key')
    fireEvent.keyDown(input(), { key: ' ' })
    expect(engine.pump).toHaveBeenCalledWith(1)
  })

  it('带 Ctrl/Meta 的组合键不抽字（保留快捷键）', () => {
    const engine = setup('key')
    fireEvent.keyDown(input(), { key: 'c', ctrlKey: true })
    fireEvent.keyDown(input(), { key: 'v', metaKey: true })
    expect(engine.pump).not.toHaveBeenCalled()
  })

  it('功能键不抽字', () => {
    const engine = setup('key')
    fireEvent.keyDown(input(), { key: 'Shift' })
    fireEvent.keyDown(input(), { key: 'ArrowLeft' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(engine.pump).not.toHaveBeenCalled()
  })
})

describe('两模式共用', () => {
  it('Backspace 触发回退并阻止默认行为', () => {
    const engine = setup('ime')
    const notPrevented = fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(engine.backspace).toHaveBeenCalledWith(1)
    expect(notPrevented).toBe(false)
  })

  it('纯按键模式下 Backspace 同样回退', () => {
    const engine = setup('key')
    fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(engine.backspace).toHaveBeenCalledWith(1)
  })

  it('方向键与翻页键不被拦截，交给页面滚动', () => {
    const engine = setup('ime')
    for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']) {
      expect(fireEvent.keyDown(input(), { key })).toBe(true)
    }
    expect(engine.pump).not.toHaveBeenCalled()
    expect(engine.backspace).not.toHaveBeenCalled()
  })

  it('挂载后自动获得焦点', () => {
    setup('ime')
    expect(document.activeElement).toBe(input())
  })

  it('点击窗口任意位置都会把焦点拉回输入接收器', () => {
    setup('ime')
    const el = input()
    el.blur()
    expect(document.activeElement).not.toBe(el)
    fireEvent.click(document.body)
    expect(document.activeElement).toBe(el)
  })

  it('切换模式后行为随之改变', () => {
    const engine = makeEngine()
    const { rerender } = render(<InputCapture engine={engine} mode="ime" />)
    fireEvent.keyDown(input(), { key: 'a' })
    expect(engine.pump).not.toHaveBeenCalled()

    rerender(<InputCapture engine={engine} mode="key" />)
    fireEvent.keyDown(input(), { key: 'a' })
    expect(engine.pump).toHaveBeenCalledWith(1)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/ime.test.tsx`
Expected: FAIL —— 无法解析 `InputCapture`。

- [ ] **Step 3: 写 `src/renderer/src/input/InputCapture.tsx`**

```tsx
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import type { InputMode } from '../../../core/types'

export interface InputEngine {
  pump: (k: number) => void
  backspace: (k: number) => void
}

export interface InputCaptureProps {
  engine: InputEngine
  mode: InputMode
}

/**
 * 「本身就要接收文字」的控件。焦点抢回必须跳过它们——见挂载 effect 里的 `focusIfNotTextInput`。
 *
 * 【`button` 刻意不在列】：工具栏按钮点完，焦点要回到阅读区，否则接下来的击键进不去
 * 输入接收器。只有真正吃文字的元素才跳过。
 */
const TEXT_INPUT_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/** 功能键与修饰键组合不参与抽字 */
const NON_CHAR_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'Tab',
  'Enter',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
  'Delete',
  'Backspace',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12'
])

export function InputCapture({ engine, mode }: InputCaptureProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const engineRef = useRef(engine)
  const modeRef = useRef(mode)

  engineRef.current = engine
  modeRef.current = mode

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const focusIfNotTextInput = (e: Event): void => {
      // 点在这些控件上时不抢焦点：否则 mousedown 一冒泡到 window 就把焦点抢回隐藏
      // textarea，它们当场 blur。设置对话框里的比例输入框就是这样废掉的——blur 触发
      // `commitRatio`，把 draft 重置回当前比例，用户看到的是「点一下就弹回原样、
      // 字根本打不进去」。应用里任何接受文字输入的控件都会中这一枪。
      // 隐藏 textarea 自己也是 `textarea`，但那时 `document.activeElement` 已经是它，
      // 跳不跳过都一样。
      if (e.target instanceof Element && e.target.closest(TEXT_INPUT_SELECTOR)) return
      // 设置对话框开着时**整块**都不抢：焦点待在对话框里是模态的应有之义，抢回来会让用户
      // 在对话框里敲的键漏进小说——而字出在遮罩后面，用户看不见。上面那条只挡住文字输入
      // 控件，点对话框的空白处或按钮时仍会中枪。
      //
      // 【用 role="dialog" 而不是给这个对话框造一个专用属性】这是 ARIA 的标准语义，以后
      // 再加进来的模态自动被覆盖；专用属性则每个新对话框都得记得挂一次，漏挂的表现是
      // 「打字抽到小说里」，与本次这个 bug 一模一样。
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return
      // 上面那条只看**点击目标**，还不够——「用『设置』按钮打开对话框」这一下会从另一条
      // 路漏进来：本监听挂在 window 上，而 React 的事件层挂在容器（#root）上，容器在
      // window 的【里面】，所以冒泡到 window 时 React 的 onClick 已经跑完——对话框挂载、
      // autoFocus 已经把焦点送进文档名输入框了。此刻 e.target 还是工具栏上那个按钮
      // （不在对话框里），于是这一下把刚送进去的焦点又抢回隐藏 textarea：对话框开着，
      // 用户敲的字全抽进小说。
      // 所以再判一次**当前焦点**：焦点已经在某个对话框里时，同样不抢。
      // 【两条都要，缺一不可】这条管「焦点还在对话框里」（刚打开的那一下），上一条管
      // 「焦点已经离开对话框」（点对话框里不可聚焦的空白处时，浏览器会把焦点交给 body）。
      if (
        document.activeElement instanceof Element &&
        document.activeElement.closest('[role="dialog"]')
      )
        return
      if (document.activeElement !== el) el.focus({ preventScroll: true })
    }

    // 挂载时先聚焦一次。不走上面那条闸（`e.target` 是隐藏 textarea 自己）。
    if (document.activeElement !== el) el.focus({ preventScroll: true })

    // 点击阅读区任意位置都要把按键接回接收器
    window.addEventListener('mousedown', focusIfNotTextInput)
    window.addEventListener('click', focusIfNotTextInput)
    return () => {
      window.removeEventListener('mousedown', focusIfNotTextInput)
      window.removeEventListener('click', focusIfNotTextInput)
    }
  }, [])

  /**
   * 把隐形输入框摆到阅读光标（`.wt-caret`）所在处——见 `page.css` 里 `.wt-input` 的注释，
   * 那是为什么必须这么做（候选框跑到页面顶部 + 小说被顶回页首，两个用户实测现象）。
   *
   * 【用 `offsetLeft` / `offsetTop`，不用 `getBoundingClientRect`】：`.wt-caret` 是
   * `display: inline-block`，`.wt-page__text` 是 static，所以它的 `offsetParent` 就是
   * `position: relative` 的 `.wt-page`；而绝对定位的 `left` / `top` 也是相对包含块（同一个
   * `.wt-page`）的。两者同一坐标系，于是【滚动 `.wt-canvas` 不影响相对位置，不需要在滚动时
   * 重算】。实测校验过两者确实可换：`caret.rect.x - page.rect.x == caret.offsetLeft`
   * （800 − 356 = 444）、y 同理（2233 − 132 = 2101）——`.wt-page` 没有 border，它的
   * border box 与 padding box 同原点。
   *
   * 【从自己的父节点往下找，不查 `document`】：`Page` 先渲染 `.wt-page__text`、后渲染
   * children，所以 `.wt-caret` 与本 textarea 同属一个 `.wt-page`。锚点用 `[data-testid]`
   * 而不是 `.wt-caret` 类名，跟单测/端到端用的是同一个。
   */
  const placeAtCaret = useCallback((): void => {
    const el = ref.current
    if (!el) return
    const caret = el.parentElement?.querySelector<HTMLElement>('[data-testid="caret"]') ?? null
    if (!caret) {
      // 空状态：`Page` 渲染的是 `.wt-page__empty`，没有阅读光标。退回纸张左上角——输入框
      // 仍在纸内、仍可聚焦，用户点一下照样能开始打字。【不能让输入框消失或抛错。】
      el.style.left = '0px'
      el.style.top = '0px'
      return
    }
    el.style.left = `${caret.offsetLeft}px`
    el.style.top = `${caret.offsetTop}px`
    el.style.height = `${caret.offsetHeight}px`
  }, [])

  /**
   * 【刻意不写依赖数组，每次渲染后都跑】：本组件只拿得到 `engine`（稳定引用）与 `mode`，
   * 没有任何 prop 会在阅读光标移动时变化——光标动不动是 `App` 那边 `visibleText` 的事。
   * 好在 `App` 每次引擎状态变化都会重渲染，而本组件没有 `memo`，所以「本组件重渲染」恰好
   * 就是「阅读光标可能移动了」的时刻。写了依赖数组反而会漏掉真正该跑的那些渲染。
   *
   * 用 `useLayoutEffect` 而不是 `useEffect`：它在 React 提交完 DOM、浏览器绘制之前同步跑，
   * 所以不会先画一帧停在旧位置的输入框。读 `offsetLeft` 会强制同步重排，量到的一定是提交
   * 之后的布局。
   */
  useLayoutEffect(placeAtCaret)

  // 窗口尺寸变化会让文字重排 → 阅读光标换位置 → 输入框得跟着挪。这条不靠重渲染
  // （resize 不会让 `App` 重渲染），所以单独立一个监听，并在卸载时摘掉。
  useEffect(() => {
    window.addEventListener('resize', placeAtCaret)
    return () => window.removeEventListener('resize', placeAtCaret)
  }, [placeAtCaret])

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Backspace') {
      // 合成中（拼音还没上屏）绝不能拦截退格：这时退格是输入法用来删除拼音的。
      // 拦截会导致用户删不掉自己打错的拼音，还会让正文莫名回退。
      // React 的合成事件不暴露 isComposing（取到的是 undefined），必须读 nativeEvent。
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      engineRef.current.backspace(1)
      return
    }

    if (modeRef.current !== 'key') return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (NON_CHAR_KEYS.has(e.key)) return

    // 可打印字符：抽字并阻止它真的落进 textarea
    if ([...e.key].length === 1) {
      e.preventDefault()
      engineRef.current.pump(1)
    }
  }

  const handleInput = (e: FormEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget
    // 合成中的输入交给 compositionend 处理，避免重复计数。
    //
    // 【这里必须直接 return，绝不能只是跳过 pump 然后照常清空】——清空 textarea 会
    // 打断输入法的合成会话。真机现象（用户实测）：候选框闪一下就消失、拼音永远上不了屏、
    // 正文一个字都不出（`compositionend` 再也不会带着内容触发）。
    // 单测抓不到：`fireEvent` 造的合成事件在 jsdom 里清空 value 不会取消任何东西，
    // 所以「合成态的 input 不抽字」这条用例在修复前后都是绿的。
    //
    // 【两种浏览器顺序都对，别改成只认 `e.nativeEvent.isComposing`】：若上屏时浏览器先发
    // `input` 再发 `compositionend`，那一刻 `composing.current` 仍为真 → 这里跳过（不计入、
    // 不清空），随后由 `compositionend` 计数并清空；若顺序相反，`compositionend` 先计数并
    // 清空，这里看到空串、`inserted` 为 0，也不会重复计。
    if (composing.current) return
    if (modeRef.current === 'ime') {
      const inserted = el.value.length
      if (inserted > 0) engineRef.current.pump(inserted)
    }
    el.value = ''
  }

  return (
    <textarea
      ref={ref}
      className="wt-input"
      data-testid="input-capture"
      aria-label="文档输入区"
      autoFocus
      spellCheck={false}
      autoComplete="off"
      onKeyDown={handleKeyDown}
      onInput={handleInput}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={(e) => {
        composing.current = false
        const text = e.data ?? ''
        if (text.length > 0) engineRef.current.pump(text.length)
        if (ref.current) ref.current.value = ''
      }}
    />
  )
}
```

- [ ] **Step 4: 运行测试并修复**

Run: `pnpm vitest run tests/unit/ime.test.tsx`
Expected: 全部 PASS。

注意两个易错点：
1. `fireEvent.keyDown` 返回 `false` 表示 `preventDefault()` 被调用；若「不拦截」用例失败，检查是否有多余的 `e.preventDefault()`。
2. `[...e.key].length === 1` 用扩展运算符而非 `e.key.length === 1`，是为了让 emoji 之类由代理对组成的字符也算「一个字符」。

- [ ] **Step 5: Commit**

```bash
git add <本任务改动的显式路径…>   # 不要用 -A：见文件头「git add -A 只在独占一棵工作树时安全」
cat > /tmp/wt-commit-msg.txt <<'EOF'
feat(renderer): InputCapture 双模式输入捕获（输入法友好 + 纯按键）
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## Task 12: App 接线（引擎 ↔ UI ↔ 持久化）

**Files:**
- Create: `src/renderer/src/state/useTypingEngine.ts`, `src/renderer/src/types/global.d.ts`
- Modify: `src/renderer/src/App.tsx`
- Test: `tests/unit/app.test.tsx`

**Interfaces:**
- Consumes: 前面全部任务
- Produces: 完整可用的应用；`window.api` 的渲染进程类型声明

> **开工前必读（Task 11 期间实测）：正文不会跟着光标滚，用户会「盲打」。**
>
> 实测环境：真实 Electron + 构建产物 + Task 7 的真实 CSS。量到 `.wt-canvas` 的可见高度是 **667px**，
> 而**第 900 个字**时 `.wt-caret` 的上沿就越过了可见区下沿；期间 `.wt-canvas.scrollTop` **始终是 0**——
> 全项目没有任何一处会滚动它。
>
> 按默认比例 1 键 : 10 字算，**约 90 次击键之后用户就看不见自己打出来的字了**。而用户的手在键盘上连续输入，
> 不会去拖滚动条。真 Word 是会跟着滚的。
>
> 这是**设计文档的疏漏，不是取舍**：spec §「左侧章节列表」明确要求了「打字推进时自动滚动到可见区域」，
> 并已由 Task 9 的 `ChapterList` 实现；**阅读区没有对应的一条**，plan 里 `Page.tsx` 也没有。
> spec 关于滚动的另外两处（§「方向键…交给页面滚动」、§「A4 纸…垂直可滚动」）说的都是**用户主动**滚动。
>
> 处理方式（本任务做）：在 `Page` 或 `App` 里让 `.wt-canvas` 跟随光标。判据是**在真实 Electron 里量**——
> 连续 pump 到 2000 字以上，断言 `.wt-canvas.scrollTop > 0` 且 `.wt-caret` 的矩形落在可见区内
> （jsdom 没有布局，这个断言在单测里没有意义，别写在 vitest 里假装测了）。
>
> **落地时才量出来的、比上面更要紧的一条（Task 12 实施期实测）：光在 effect 里滚一次是不够的，真机上等于没修。**
> Chromium 会在**真实按键**之后把「焦点里那个 textarea 的光标」滚进视野——那时的 `.wt-input` 是盖满整张纸的
> 隐形输入框（`inset: 0; height: 100%`），它自己的光标在纸的左上角，于是浏览器每次都把画布按回页首。
> 实测（140 键，每键采样）：effect 里同步设成 `1414`，**同一个 effect 里再量已经是 `30`**；只在 effect 里
> 同步滚一版，连敲 120 键后末尾 `scrollTop` 仍是 `30`、光标在 `1976px` 处（画布只有 667px 高）。
> 回滚发生在 rAF **之前**（sync 时 1243，1~5ms 后的 rAF 已经是 30），所以修正在 rAF 里补一次即可：
> 它落在回滚之后、这一帧画出来之前。**那次 rAF 刻意不 cancel**（cancel 会让快速连打时上一键排的那一帧
> 被下一键的 effect 清掉，实测 k70 之后全程停在页首）。
>
> **⚠️ 上面那条的【前提】已经不作数了（后续修复，不是本节落地时的事）：`.wt-input` 不再铺满整张纸。**
> 用户真机报的两个现象同源，都出在这个铺满纸的隐形输入框上：(1) 候选框跟着「textarea 自己的文本光标」
> 跑到页面顶部；(2) Chromium 每次击键把画布按回页首——也就是上面那段 rAF 一直在赛跑的那个回滚。
> 修法是把输入框摆到阅读光标 `.wt-caret` 上（见 `InputCapture.tsx` 的 `placeAtCaret` 与 `page.css` 里
> `.wt-input` 的注释）。摆对之后 Chromium 要滚进来的那个光标本来就在视野里，原生回滚变成空操作。
> 那段 rAF 补滚此后是否还承重，实测结论记在 Task 12 的交付说明里，**别照抄本节上面的旧叙述**。
>
> 还有一条**测法**上的坑（前提虽已变，这条仍然成立）：**合成事件测不出原生回滚**。用
> `el.dispatchEvent(new Event('input'))` 派发（哪怕焦点还在 textarea 上）浏览器根本不做这次回滚，
> 滚动看起来完全正常——只有真实的 `keyboard.press` 才复现。真机验证必须真敲键。

> **开工前必读（Task 7 期间实测，不是推测）：`window.api` 可能在渲染进程里根本不存在，而本任务的代码假定它一定在。**
>
> 可达性有实测依据：Task 6 量到 sandboxed preload 加载失败时（`Error: module not found: node:fs`）**页面照常渲染，而 `window.api === undefined`**。
>
> 两条具体的炸点，两种失败形态（下面的复现都是跑出来的）：
> 1. 下面 Step 6 的 `useEffect` 里 `window.api.onMenuCommand(...)` —— **同步抛** `TypeError`，`render(<App/>)` 当场抛，测试文件直接红。可见，好办。
> 2. 下面 Step 5 的 `boot()` 第一行 `await window.api.initialNovelPath()` —— 在 `void boot()` 里变成 **unhandled rejection**。形态更阴：用例行仍报 `passed`，但汇总行是 `Errors 1 error`，**`vitest` 的 exit code 是 1**。只看「Tests N passed」会以为没事。
>
> 而且**本任务一落地，Task 7 的 `tests/unit/layout.test.tsx` 就会红**：它 `render(<App/>)`，而 `tests/setup.ts` 至今**没有任何 `window.api` 桩**（`vitest.config.ts` 的 `setupFiles` 只做了 `cleanup()`）。`ribbon.test.tsx` 不受影响——它渲染的是 `<ToolbarProvider><Ribbon/><Toast/></ToolbarProvider>`，不经过 `App`。
>
> 类型层面**不会**提醒你：`global.d.ts` 里写的是 `api: WtApi`（非可选），`tsc` 认为它恒存在。
>
> 所以本任务要同时做两件事，缺一不可：
> - 给 `tests/setup.ts` 加一个**良性**（no-op async）的 `window.api` 桩，让渲染层测试能 `render(<App/>)`；
> - 决定 `App` 在缺 api 时怎么降级。倾向「渲染出外壳 + 不抛」，因为 preload 失败在用户侧就是「伪装成 Word 的窗口一片空白」，比显式报错更糟。
>
> **实施时又踩到两个 jsdom 环境缺口，都放进 `tests/setup.ts`，一并记在这里**：
> 1. `setupFiles` 是**每个测试文件**都跑，而 `tests/unit/guardA.test.ts` 顶上写着 `// @vitest-environment node`
>    ——那里没有 `window`。桩里必须 `if (typeof window === 'undefined') return`，否则该文件整份失败
>    （**0 个用例被执行**），而汇总行照旧是 `Tests N passed`，只有 exit code 是 1。
> 2. jsdom 不实现 `ResizeObserver`，而 `ChapterList` 用它测视口高度。Task 12 之后 `App` 会渲染
>    `ChapterList`，于是**Task 7 的 `layout.test.tsx` 也一并踩到**（它 `render(<App/>)`）。
> 放 `setupFiles` 里一处覆盖全部经过 `App` 的用例；`chapterList.test.tsx` 里那份同名 stub 留着无害。
>
> 本任务交付的 `tests/setup.ts` 全文（Task 1 那一版的围栏已过期，只作历史备查）：

```ts
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { defaultSettings } from '../src/core/types'
import type { WtApi } from '../src/renderer/src/types/global'

/**
 * 渲染层的**良性** `window.api` 替身：什么都不做，但每个方法都在，且都是 async。
 *
 * 为什么必须有：`preload` 在 jsdom 里根本不会跑，而 `App` 挂载时会走启动流程
 * （`initialNovelPath` / `loadSession` / `onMenuCommand`）。少了这个桩，任何
 * `render(<App/>)` 的用例都会以「TypeError」或「unhandled rejection」两种形态之一失败
 * （两种都是 Task 7 实测过的形态：前者让用例当场红，后者只让汇总行多一条
 * `Errors 1 error`，用例行照旧 passed，而 vitest 的 exit code 是 1）。
 *
 * `openNovelPath` 刻意抛异常而不是编一本小说出来：真的被调用到（有启动参数或有会话）
 * 说明用例自己该提供 api（见 `tests/unit/app.test.tsx` 的 `installApi`），此时一个
 * 假小说比一声响更危险——它会让用例在「用的是别人的数据」这种前提下静默通过。
 * 它唯一的调用点在 `App.tsx` 启动流程的 try/catch 里（那个 try 现在只护 `openNovelPath`
 * 与 `openNovel`，`loadSettings` / `initialNovelPath` 在它之外）——而这个良性桩的
 * `initialNovelPath` 恒返回 null，所以 `target` 为空、那个 try 根本进不去，异常不会冒出去。
 */
const benignApi: WtApi = {
  platform: 'darwin',
  importNovel: async () => null,
  openNovelPath: async () => {
    throw new Error('测试桩：没有实现 openNovelPath，用例应自行提供 window.api')
  },
  initialNovelPath: async () => null,
  loadSession: async () => null,
  saveSession: async () => {},
  clearSession: async () => {},
  loadSettings: async () => defaultSettings(),
  saveSettings: async () => {},
  onMenuCommand: () => () => {},
  // 单测里一律当作浅色系统外观——深色主题的判据是真机截图，不是 jsdom
  getTheme: async () => false,
  setThemeSource: async () => {},
  onThemeChange: () => () => {}
}

function installBenignApi(): void {
  // `setupFiles` 对**每个**测试文件都跑，而 `tests/unit/guardA.test.ts` 顶上写着
  // `// @vitest-environment node`——那个文件里根本没有 `window`。少了这行判空，
  // 该文件会以「ReferenceError: window is not defined」整份失败：**0 个用例被执行**，
  // 而汇总行照旧是 `Tests N passed`，只有 exit code 是 1。
  if (typeof window === 'undefined') return
  ;(window as unknown as { api: WtApi }).api = benignApi
}

installBenignApi()

/**
 * jsdom 不实现 ResizeObserver，而 `ChapterList` 用它测视口高度。
 *
 * 为什么放在这里而不是像 `tests/unit/chapterList.test.tsx` 那样各写一份：Task 12 之后
 * **`App` 会渲染 `ChapterList`**，于是 `layout.test.tsx`（Task 7 的用例）也一并踩到这个坑
 * ——它是 `render(<App/>)` 的。放在 `setupFiles` 里，一处即可覆盖所有经过 `App` 的用例；
 * 那个文件里的同名 stub 留着无害（后赋值的赢，行为一样）。
 *
 * 这个替身【不测量任何东西】：`observe` 是空操作，所以组件里的 `measure()` 只会跑一次
 * （挂载时那次 `clientHeight || 400`）。虚拟滚动窗口在 jsdom 里因此永远按 400px 算——
 * 用例若要断言渲染了哪些行，得自己按这个值推算，别以为它在跟着真实布局走。
 */
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  // 用例可能把 window.api 换成自己的替身（app.test.tsx 就是这么做的）。
  // 换回来，免得上一个用例的替身漏给下一个——那种漏给会让「本期用例没装 api」
  // 表现为「上一个用例的 spy 被调用」，红得莫名其妙。
  installBenignApi()
})
```

- [ ] **Step 1: 写 `src/renderer/src/types/global.d.ts`**

```ts
import type { AppSettings, Novel, PersistedSession, ThemeSource } from '../../../core/types'

// 外观偏好的定义只留 core 一处（`ThemeSource`）：渲染层再声明一份的话两处会各自漂移。
export type { ThemeSource }

export interface WtApi {
  /** 'darwin' | 'win32' | 'linux'。渲染层靠它决定要不要给红绿灯让位 */
  platform: string
  importNovel: () => Promise<Novel | null>
  openNovelPath: (path: string) => Promise<Novel>
  initialNovelPath: () => Promise<string | null>
  /** 取【某一本书】自己的阅读进度。按书存之后，sourcePath 是必填的那把钥匙。 */
  loadSession: (sourcePath: string) => Promise<PersistedSession | null>
  saveSession: (session: PersistedSession) => Promise<void>
  clearSession: () => Promise<void>
  loadSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<void>
  onMenuCommand: (cb: (cmd: string) => void) => () => void
  getTheme: () => Promise<boolean>
  setThemeSource: (source: ThemeSource) => Promise<void>
  onThemeChange: (cb: (dark: boolean) => void) => () => void
}

declare global {
  interface Window {
    api: WtApi
  }
}
```

- [ ] **Step 2: 写 `src/renderer/src/state/useTypingEngine.ts`**

```ts
import { useCallback, useSyncExternalStore } from 'react'
import type { TypingEngine, EngineState } from '../../../core/engine'

export function useTypingEngine(engine: TypingEngine | null): EngineState | null {
  const subscribe = useCallback(
    (onChange: () => void) => (engine ? engine.subscribe(onChange) : () => {}),
    [engine]
  )
  const getSnapshot = useCallback(() => (engine ? engine.getSnapshot() : null), [engine])
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
```

- [ ] **Step 3: 写 `src/renderer/src/App.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TypingEngine } from '../../core/engine'
import { DEFAULT_DOC_TITLE, DEFAULT_RATIO } from '../../core/types'
import type { AppSettings, InputMode, Novel } from '../../core/types'
import { ChapterList } from './components/ChapterList'
import { Page } from './components/Page'
import { Ribbon } from './components/Ribbon'
import { StatusBar } from './components/StatusBar'
import { Toast } from './components/Toast'
import { InputCapture } from './input/InputCapture'
import { useDarkPaper, useSystemTheme, useThemePreference } from './state/theme'
import { ToolbarProvider } from './state/ToolbarContext'
import { useTypingEngine } from './state/useTypingEngine'
import type { ThemeSource, WtApi } from './types/global'

const SAVE_DEBOUNCE_MS = 600
/** 光标与画布上下沿之间保留的空隙：.wt-canvas 上下各有 padding，贴着边等于贴到灰底上 */
const CARET_MARGIN = 24

/**
 * 取 preload 注入的接口；**它可能不存在**。
 *
 * sandboxed preload 加载失败时（Task 6 实测的形态：`Error: module not found: node:fs`），
 * 页面照常渲染而 `window.api === undefined`——用户看到的就是一个「伪装成 Word 的空窗口」。
 * `global.d.ts` 把它声明成必填（`api: WtApi`），所以 `tsc` 认为它恒存在、**不会提醒你判空**，
 * 这里必须自己转一道。
 *
 * 每次用的时候现取，【不要在模块顶层缓存成常量】：那等于把「preload 一定在模块加载前注入」
 * 写死进加载顺序，一旦不成立，拿到的就是永久为 null 的缓存。
 */
function getApi(): WtApi | null {
  return (window as unknown as { api?: WtApi }).api ?? null
}

export default function App() {
  const [novel, setNovel] = useState<Novel | null>(null)
  const [engine, setEngine] = useState<TypingEngine | null>(null)
  const [expanded, setExpanded] = useState(false)
  /**
   * 蓝条上的文档名。**刻意与 `novel.title` 无关**——那个是文件名（`诡秘之主（整理版）`），
   * 显示出来等于把「在看小说」写在了窗口最显眼的位置。这里永远是用户自己定的名字，
   * 默认取一个中性的 `文档1`。
   */
  const [docTitle, setDocTitle] = useState(DEFAULT_DOC_TITLE)
  /** 「深色模式下纸张也变暗」。默认关——真 Word 的深色模式里纸张仍是白的。 */
  const [darkPaper, setDarkPaper] = useState(false)
  /** 外观偏好，默认跟随系统。它决定原生部分（红绿灯）与网页部分一起怎么显示。 */
  const [themeSource, setThemeSource] = useState<ThemeSource>('system')
  /** 上次打开的书。启动时读回来、导入时更新，写进 settings.json 供下次启动恢复。 */
  const [lastSourcePath, setLastSourcePath] = useState<string | null>(null)
  /**
   * **全局**阅读替换比例：新导入的书拿它当起点。
   *
   * 真正生效的是**当前书**的比例（引擎里那个，存在会话里）。这个不是「覆盖值」而是「初值」：
   * 一本书第一次打开时取它，之后各管各的——改这个**不影响已经打开过的书**，只影响之后导入的。
   * 所以两者之间没有「跟随」状态，设置里两个普通输入框就够了。
   */
  const [globalRatio, setGlobalRatio] = useState(DEFAULT_RATIO)
  /**
   * 设置是否已经读回来了。
   *
   * 【少了这道闸，启动会把用户存的设置覆盖成默认值】设置是「改了就写回」的（下面那个
   * 防抖 effect），而首帧渲染时这四个状态还都是默认值——读盘是异步的。于是那个 effect
   * 会先拿着「文档1 / 跟随系统 / 不暗 / null」写一遍，把磁盘上真正的设置冲掉，然后才读到
   * 已经被自己冲掉的默认值。
   */
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  useSystemTheme()
  useDarkPaper(darkPaper)
  useThemePreference(themeSource)
  const engineRef = useRef<TypingEngine | null>(null)
  const canvasRef = useRef<HTMLElement | null>(null)
  engineRef.current = engine
  /**
   * 最新的全局比例，挂在 ref 上给 `openNovel` 读。
   *
   * 【为什么不能用闭包里的那个值】`openNovel` 的依赖是 `[flushSession]`，而那是个稳定引用
   * ——于是它永远保留**首次渲染**那一刻闭包里的 `globalRatio`（默认 10），启动读回真正的
   * 全局值之后也不会更新。实测过：全局设成 3、导入一本新书，引擎拿到的仍是 10。
   *
   * 【为什么也不把它加进依赖数组】`openNovel` 的身份一变，**启动那个 effect 就会重跑**，
   * 于是每次改全局比例都会把书重新打开一遍（重新读会话、重置 expanded…）。
   * 渲染期写 ref 是本文件既有的写法（见上面的 `engineRef.current = engine`）。
   */
  const globalRatioRef = useRef(DEFAULT_RATIO)
  globalRatioRef.current = globalRatio

  const settingsRef = useRef<AppSettings | null>(null)
  /**
   * 设置的当前值：**一处构造，两处消费**（防抖写盘的载荷、关窗前的快照）。
   *
   * 【为什么要合并】这些字段此前在三个地方各写了一遍：防抖 effect 的载荷、那个 effect 的
   * 依赖数组、以及 ref 的字面量。加设置项时漏改依赖数组＝「只在关窗时落盘」，漏改 ref
   * 字面量＝「防抖写了、关窗丢」——两种都只在特定退出路径下才显形。
   *
   * 【合并之后上面那句要重读】两条路现在读的是**同一个对象**：漏改下面那个依赖数组，
   * memo 不重算，于是防抖的载荷与关窗的快照一起停在旧值上——那个字段的改动在别的依赖也
   * 变化之前，哪条路都带不上去（既不报错、也不落盘，只是悄悄不变）。所以依赖数组必须与
   * 返回对象里的字段一一对应；字段也只在这一处增删。
   */
  // 【为什么这里先给空表】`shortcuts` 是必填字段，而稀疏表的 `{}` 就是「全默认」——
  // 行为与本次改动之前完全一致。真正的用户改动会在后续任务里接进来（届时这里换成状态）。
  const settings: AppSettings = useMemo(
    () => ({ docTitle, themeSource, darkPaper, lastSourcePath, ratio: globalRatio, shortcuts: {} }),
    [docTitle, themeSource, darkPaper, lastSourcePath, globalRatio]
  )
  settingsRef.current = settingsLoaded ? settings : null
  /** 见 openNovel 里那段说明：只用来丢弃过期的打开结果 */
  const openSeqRef = useRef(0)

  const state = useTypingEngine(engine)

  /** 把当前这本的进度立刻落盘（不等防抖）。换书前与关窗前各用一次。 */
  const flushSession = useCallback((): void => {
    const api = getApi()
    const current = engineRef.current
    if (api && current) void api.saveSession(current.toSession())
  }, [])

  /**
   * 打开一本书：**先问磁盘上有没有这本书的进度**，有就接着读，没有才从零开始。
   *
   * 【为什么必须在这里问】「导入小说」走的就是这个函数，启动恢复也走它。少了这次读盘，
   * 导入一本读过的书＝全新引擎＝600ms 后把 cursor 0 落盘覆盖掉那本书的进度——而「每本书
   * 各留一份进度」存在的全部意义就是这一条。判断只有这一处，调用方不必各自判一遍。
   */
  const openNovel = useCallback(
    async (next: Novel): Promise<void> => {
      // 递增序号，用来丢掉过期的那一次：读盘是异步的，用户连续导入两本时，先发起、后返回的
      // 那一次会把后打开的书顶掉。
      const seq = ++openSeqRef.current
      const api = getApi()
      const session = api ? await api.loadSession(next.sourcePath) : null
      if (seq !== openSeqRef.current) return

      // 换书之前先把上一本存一次：下面那个保存 effect 的 cleanup 会 clearTimeout 掉待发的
      // 定时器，而换书会让 engine 变——600ms 之内连开两本时，上一本那一次就永远不落盘了。
      //
      // 【放在提交点之前、而不是函数开头】开头到这里隔着一个 await：那期间落在旧引擎上的击键
      // 会重排防抖定时器、随后被 cleanup 清掉，开头那次 flush 并没有覆盖到它。放在这里，
      // `engineRef.current` 仍是上一本（还没人 setEngine），上面这句话才是字面为真的。
      flushSession()

      setNovel(next)
      // 有记录就接着用它自己的比例；没有记录才拿**全局**值当起点（这就是全局比例的全部作用）。
      // 读 ref 而不是闭包里的 `globalRatio`，理由见 `globalRatioRef` 那段说明。
      setEngine(
        session
          ? TypingEngine.fromSession(next, session)
          : new TypingEngine(next, { ratio: globalRatioRef.current })
      )
      setExpanded(false)
      setLastSourcePath(next.sourcePath)
    },
    [flushSession]
  )

  const handleImport = useCallback(async () => {
    const api = getApi()
    if (!api) return
    const next = await api.importNovel()
    if (!next) return
    await openNovel(next)
  }, [openNovel])

  const handleClearSession = useCallback(async () => {
    const api = getApi()
    if (!api) return
    // 【作废在飞的 open】导入已发起、`loadSession` 还没回来时按下清除，那次 open 回来后照样
    // 能通过 `openNovel` 里的 seq 检查，把书放回界面、600ms 后还重写进度与 lastSourcePath
    // ——清除等于没清。递增一次就等于把它标记成过期的。
    openSeqRef.current++
    // 【状态清空排在 await 之前】待发的会话写是靠 `setEngine(null)` 那次提交的 effect cleanup
    // 取消的；排在 await 之后的话，一个已排上队的防抖写可能落在 IPC 删除之后，把记录又写回来。
    setNovel(null)
    setEngine(null)
    // 「上次打开的是哪本」也是阅读记录的一部分：不清掉的话，用户按下「清除阅读记录」再重启，
    // 那本书又自己开回来了——而设置（文档名 / 外观 / 纸张）照旧留着。
    setLastSourcePath(null)
    await api.clearSession()
  }, [])

  // 启动：先把设置读回来，再打开命令行指定的书、否则打开上次那本
  useEffect(() => {
    const api = getApi()
    // 没有 api，就没有「设置」「命令行参数」「上次打开的书」这三件事可做——直接停在空状态。
    // 这【不是】多余的防御：少了它，下面第一个 await 会变成 unhandled rejection，
    // 用例行照旧报 passed、汇总行却是 `Errors 1 error`，vitest 的 exit code 是 1。
    if (!api) return

    let cancelled = false

    const boot = async (): Promise<void> => {
      // 设置先读：它同时给出「上次打开的是哪本」。命令行参数优先于它。
      const settings = await api.loadSettings()
      if (cancelled) return
      setDocTitle(settings.docTitle)
      setDarkPaper(settings.darkPaper)
      setThemeSource(settings.themeSource)
      setLastSourcePath(settings.lastSourcePath)
      setGlobalRatio(settings.ratio)
      setSettingsLoaded(true)

      // 【依次尝试，而不是只挑一个】命令行给的路径优先，**它打不开时回退到「上次打开的那本」**。
      // 这个回退原先是由两段式启动天然给的（第一段的 catch 刻意不 return，落到第二段），
      // 合并成一次之后必须显式写出来——否则「命令行指了一个打不开的文件」会直接落到空状态，
      // 而磁盘上明明有一本上次读的书。去重是为了两处指向同一个路径时不要试两遍。
      const initialPath = await api.initialNovelPath()
      const targets = [initialPath, settings.lastSourcePath].filter(
        (p, i, arr): p is string => typeof p === 'string' && p !== '' && arr.indexOf(p) === i
      )

      for (const target of targets) {
        // 目标文件可能打不开（已删除、权限、EISDIR、解不出编码……）。没有这个 try 的话错误会
        // 以【未处理的 rejection】形式冒到启动期：空状态不显示、也没有任何提示。
        // 真机实测过（Task 12，chmod 000 的 txt 当命令行参数 + 同一个 userData 里留着上次
        // 会话）：无 unhandled rejection，且会话照常恢复到「已显示 300 字」——那正是上面
        // 这条回退在起作用。
        //
        // 【覆盖情况，别再写「零覆盖」了】`命令行给的路径打不开时，回退到上次打开的那本书`
        // 那条用例会走进这个 catch，但只走了「第一个目标失败、第二个成功」这一半；
        // **两个目标都失败、最终停在空状态**那条路仍然没有用例。后半句的前提是真实的：
        // 把整个 try/catch 删掉，渲染层用例仍是全绿。
        try {
          const loaded = await api.openNovelPath(target)
          if (cancelled) return
          // 「接着读还是从头」交给 openNovel 一个人判——它读的正是 loaded.sourcePath 名下那本书的进度
          await openNovel(loaded)
          return
        } catch {
          // 这个目标不可用，试下一个；都不可用就停在空状态，等用户重新导入
        }
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [openNovel])

  // 菜单命令 → 渲染进程动作
  useEffect(() => {
    const api = getApi()
    if (!api) return
    const off = api.onMenuCommand((cmd) => {
      if (cmd === 'import-novel') void handleImport()
      else if (cmd === 'clear-session') void handleClearSession()
    })
    return off
  }, [handleImport, handleClearSession])

  // 会话持久化（防抖）
  useEffect(() => {
    const api = getApi()
    if (!engine || !api) return
    const timer = window.setTimeout(() => {
      void api.saveSession(engine.toSession())
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [engine, state])

  // 设置持久化（防抖）。与会话同一套节奏：600ms 内的连续改动只落盘一次。
  useEffect(() => {
    const api = getApi()
    // 读回来之前不写，见 settingsLoaded 的说明
    if (!api || !settingsLoaded) return
    const timer = window.setTimeout(() => {
      void api.saveSettings(settings)
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [settings, settingsLoaded])

  // 关闭前强制落盘
  useEffect(() => {
    const api = getApi()
    if (!api) return
    const flush = (): void => {
      flushSession()
      // 设置也有防抖窗口：改完文档名立刻关窗（或退出）会落在窗口里，关窗前的最后一次补上。
      const settings = settingsRef.current
      if (settings) void api.saveSettings(settings)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [flushSession])

  const visibleText = engine?.visibleText ?? ''
  const revealedChars = state ? state.cursor - state.revealStart : 0

  /**
   * 让阅读区跟着光标滚。
   *
   * 问题（真机实测，不是推测）：`.wt-canvas` 的可见高度是 667px，
   * **第 900 个字光标就掉出可见区**，而 `.wt-canvas.scrollTop` 全程是 0——
   * 全项目没有一处会滚动它。按默认比例算，约 90 次击键之后用户就看不见自己打的字了，
   * 而手在键盘上连续输入的人不会去拖滚动条。真 Word 是跟着滚的。
   *
   * 滚的是 `.wt-canvas`（`overflow: auto` 的是它，不是 `.wt-page`），所以这段在 `App`
   * 而不是 `Page`：画布归 App 所有。用 `querySelector` 找 `.wt-caret` 而不是给 `Page`
   * 加一个 ref 参数，是为了不动 `Page` 的公开接口（Task 10 交付的形状）。
   *
   * 【最后那一帧补滚不是多余的，删掉它真机上等于没修】：真实按键之后 Chromium 会把
   * 「焦点里那个 textarea 的光标」滚进视野——那是个盖满整张纸的隐形输入框，它自己的
   * 光标在纸的左上角，于是浏览器每次都把画布按回页首。实测（140 键）：effect 里同步
   * 设成 1414，同一个 effect 里再量已经是 30；去掉补滚那版连敲 120 键后末尾 scrollTop
   * 是 30、光标在 1976px 处（画布只有 667px 高）。这就是「合成事件测不出来」的原因：
   * 用 dispatchEvent 派发 input 时浏览器不做这次回滚，滚动完全正常。
   *
   * 补滚放在 rAF 里，且【刻意不 cancel】：回滚发生在 rAF 之前（实测 sync 时 1243，
   * 1~5ms 后的 rAF 已经是 30），所以 rAF 里这次修正在回滚之后、在这一帧画出来之前。
   * 不 cancel 是因为它幂等（每次都重新量当前布局），而 cancel 会让**快速连打**时上一键
   * 排的那一帧被下一键的 effect 清掉——实测那样会在 k70 之后全程停在页首。
   * 人速（10 键/秒）实测 120/120 次采样光标都在可见区内。
   * 不 cancel 也不会在卸载后乱动：那时 canvas 已脱离文档，量到的高度是 0，被下面那条闸挡住。
   *
   * 【画布高度为 0 就直接返回】：jsdom 没有布局，`getBoundingClientRect()` 全返回 0，
   * 据此算出来的「光标在可见区外」是假的。这条闸让单测里这段是空操作，而真机里画布
   * 高度恒不为 0。**滚动这条的判据只能在真机里量**，别在 vitest 里假装测了。
   *
   * `expanded` 也在依赖里：点折叠条展开前文时 `visibleText` 一字不变，但光标位置大变。
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !visibleText) return
    const caret = canvas.querySelector('.wt-caret')
    if (!caret) return

    // 幂等：已经滚到位时两次测量都落在空隙之内，位移是 0。
    const keepCaretVisible = (): void => {
      const canvasBox = canvas.getBoundingClientRect()
      if (canvasBox.height === 0) return
      const caretBox = caret.getBoundingClientRect()
      if (caretBox.bottom > canvasBox.bottom - CARET_MARGIN) {
        canvas.scrollTop += caretBox.bottom - (canvasBox.bottom - CARET_MARGIN)
      } else if (caretBox.top < canvasBox.top + CARET_MARGIN) {
        canvas.scrollTop -= canvasBox.top + CARET_MARGIN - caretBox.top
      }
    }

    keepCaretVisible()
    window.requestAnimationFrame(keepCaretVisible)
  }, [visibleText, expanded])

  const toolbarProps = useMemo(
    () => ({
      ratio: state?.ratio,
      mode: state?.mode,
      globalRatio,
      onRatioChange: (n: number) => engineRef.current?.setRatio(n),
      onGlobalRatioChange: setGlobalRatio,
      onModeChange: (m: InputMode) => engineRef.current?.setMode(m),
      onImport: () => void handleImport(),
      onClearSession: () => void handleClearSession()
    }),
    [state?.ratio, state?.mode, globalRatio, handleImport, handleClearSession]
  )

  return (
    <ToolbarProvider {...toolbarProps}>
      <div className="wt-app" data-testid="app-root">
        <Ribbon
          docTitle={docTitle}
          onDocTitleChange={setDocTitle}
          darkPaper={darkPaper}
          onDarkPaperChange={setDarkPaper}
          themeSource={themeSource}
          onThemeSourceChange={setThemeSource}
          novelOpen={novel !== null}
        />

        <div className="wt-body">
          <ChapterList
            novel={novel}
            activeChapter={state?.activeChapter ?? 0}
            chapterPos={state?.chapterPos ?? []}
            onJump={(i) => engineRef.current?.jumpToChapter(i)}
          />

          <main className="wt-canvas" ref={canvasRef}>
            <Page
              visibleText={visibleText}
              expanded={expanded}
              onToggleExpand={() => setExpanded(true)}
              empty={!novel}
            >
              {engine && state && (
                <InputCapture engine={engine} mode={state.mode} />
              )}
            </Page>
          </main>
        </div>

        <StatusBar
          novel={novel}
          revealedChars={revealedChars}
          activeChapter={state?.activeChapter ?? 0}
          ratio={state?.ratio ?? 10}
          mode={state?.mode ?? 'ime'}
        />

        <Toast />
      </div>
    </ToolbarProvider>
  )
}
```

- [ ] **Step 4: 写测试 `tests/unit/app.test.tsx`**

用假 `window.api` 驱动，验证「导入 → 打字 → 退格 → 章节跳转 → 会话恢复」整条链路。

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import App from '../../src/renderer/src/App'
import { splitChapters } from '../../src/core/chapters'
import { defaultSettings } from '../../src/core/types'
import type { AppSettings, Novel, PersistedSession } from '../../src/core/types'

function makeNovel(): Novel {
  const text = '第一章 甲\nAAAAAAAAAA\n第二章 乙\nBBBBBBBBBB\n'
  const { flatText, chapters } = splitChapters(text, '测试书')
  return { title: '测试书', sourcePath: '/tmp/测试书.txt', encoding: 'UTF-8', hadBom: false, flatText, chapters }
}

/**
 * 阅读区当前显示了多少字。
 *
 * 【为什么不再读状态栏】状态栏里那条「已显示 N / 全书 M 字」已经删掉了——真 Word 只报
 * 全文字数、从不报「已显示多少」，那个词组本身就是伪装破绽（见 StatusBar.tsx 顶部说明）。
 * 于是这份文件改用**正文长度**当观测点：那才是用户真正看到的东西，也是「抽了多少字」
 * 唯一的真相来源（状态栏那条本来就只是它的一个投影）。
 *
 * 空状态下没有 `page-text`（渲染的是空状态引导），返回 0。
 */
function revealedChars(): number {
  return screen.queryByTestId('page-text')?.textContent?.length ?? 0
}

let saved: PersistedSession | null = null
/** 最近一次 `loadSession` 是【按哪本书的路径】去取的。null = 从没按路径取过。 */
let sessionAskedFor: string | null = null

function installApi(novel: Novel | null, session: PersistedSession | null = null): void {
  saved = null
  sessionAskedFor = null
  ;(window as unknown as { api: unknown }).api = {
    importNovel: vi.fn(async () => novel),
    openNovelPath: vi.fn(async () => novel as Novel),
    initialNovelPath: vi.fn(async () => null),
    loadSession: vi.fn(async (sourcePath: string) => {
      sessionAskedFor = sourcePath
      return session
    }),
    saveSession: vi.fn(async (s: PersistedSession) => {
      saved = s
    }),
    clearSession: vi.fn(async () => {}),
    /**
     * 【默认桩刻意不指任何书】`lastSourcePath` 是启动恢复的唯一线索，给成 null 就等于
     * 「用户上次什么都没打开」——启动什么都不开。于是凡是要有书的用例**都必须自己走导入路径**
     * （`importViaSettings()`），而那正是「导入小说」这条真实路径要被覆盖的地方：桩若指着本用例
     * 这本书，书在测试体跑之前就已经由启动恢复加载好了，`importViaSettings()` 沦为装饰，
     * 连 `handleImport` 里那句 `await openNovel(next)` 删掉都没人发现。
     *
     * 需要「设置指路 → 启动恢复」那一条路径的用例（目前只有一条）在自己的体内显式覆盖它。
     */
    loadSettings: vi.fn(async () => defaultSettings()),
    saveSettings: vi.fn(async () => {}),
    onMenuCommand: vi.fn(() => () => {}),
    getTheme: vi.fn(async () => false),
    setThemeSource: vi.fn(async () => {}),
    onThemeChange: vi.fn(() => () => {})
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

/**
 * 走界面导入一本小说：真实功能现在都收在设置对话框里，所以是「文件 → 设置 → 导入小说」，
 * 导入完再把对话框关掉（对话框不会自己关：`onImport` 是异步的、且用户可能只是取消了选择框）。
 */
function importViaSettings(): void {
  fireEvent.click(screen.getByTestId('tab-文件'))
  fireEvent.click(screen.getByTestId('btn-settings'))
  fireEvent.click(screen.getByTestId('btn-import'))
  fireEvent.click(screen.getByTestId('settings-close'))
}

/** 打开设置对话框（比例等控件都在里面） */
function openSettings(): void {
  fireEvent.click(screen.getByTestId('tab-文件'))
  fireEvent.click(screen.getByTestId('btn-settings'))
}

describe('App 端到端（单测层）', () => {
  it('未导入时阅读区是空状态', async () => {
    installApi(null)
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('page-empty')).toBeTruthy())
    expect(screen.getByTestId('status-chapter').textContent).toBe('—')
  })

  it('导入后蓝条上不出现小说文件名（那是导入唯一的泄露点）', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)

    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 修复前这里是 `novel.title`（= 文件名「测试书」），等于把「在看小说」写在窗口最显眼处
    expect(screen.getByTestId('doc-title').textContent).toBe('文档1')
    expect(screen.getByTestId('ribbon').textContent).not.toContain('测试书')
  })

  it('导入小说后可打字，阅读区按比例增长', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)

    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    // 默认比例 10，敲 1 个键应显示 10 个字
    fireEvent.input(capture, { target: { value: 'x' } })
    await waitFor(() => expect(revealedChars()).toBe(10))
    expect(screen.getByTestId('page-text').textContent!.length).toBeGreaterThanOrEqual(10)
  })

  it('退格回吐显示，但小说内容不变', async () => {
    const novel = makeNovel()
    const originalFlat = novel.flatText
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    fireEvent.input(capture, { target: { value: 'x' } })
    await waitFor(() => expect(revealedChars()).toBe(10))

    fireEvent.keyDown(capture, { key: 'Backspace' })
    await waitFor(() => expect(revealedChars()).toBe(0))
    expect(novel.flatText).toBe(originalFlat)
  })

  it('点击章节跳转，当前章高亮跟随', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-1')).toBeTruthy())

    fireEvent.click(screen.getByTestId('chapter-item-1'))
    await waitFor(() => expect(screen.getByTestId('status-chapter').textContent).toBe('2 / 2'))
    expect(screen.getByTestId('chapter-item-1').className).toContain('chapter-item--active')

    // 跳章之后阅读区是**空的**：显示窗口从该章开头起算，而这一章还没读过。
    // 少了这一条，「已显示」把 revealStart 漏掉（写成 cursor）也没人发现——
    // 变异实测：把 `state.cursor - state.revealStart` 改成 `state.cursor`，全套用例全绿。
    expect(revealedChars()).toBe(0)
  })

  it('改比例后同样的击键抽出更多字', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 比例输入框在设置对话框里（原先挂在「开始」「视图」两个选项卡下，已于本次搬走）
    openSettings()

    const ratioInput = screen.getByTestId('ratio-input')
    fireEvent.change(ratioInput, { target: { value: '2' } })
    fireEvent.keyDown(ratioInput, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:2'))
    fireEvent.click(screen.getByTestId('settings-close'))

    const capture = screen.getByTestId('input-capture')
    fireEvent.input(capture, { target: { value: 'x' } })
    await waitFor(() => expect(revealedChars()).toBe(2))
  })

  it('有会话时启动即恢复到上次位置，无需重新输入', async () => {
    const novel = makeNovel()
    const session: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: '/tmp/测试书.txt',
      ratio: 5,
      mode: 'key',
      cursor: 15,
      revealStart: 0,
      chapterPos: [15, 0],
      activeChapter: 0,
      startedAt: null
    }
    installApi(novel, session)
    // 【这条用例测的正是「启动恢复」那条路】设置指路 → 打开那本书 → 取它自己的进度，
    // 全程不点导入。所以这里要显式把 `lastSourcePath` 指着这本书——那才是真的
    // settings.json 在读这本书【之后】的样子（默认桩是 null，见 installApi 的说明）。
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      ...defaultSettings(),
      lastSourcePath: novel.sourcePath
    }))
    render(<App />)

    await waitFor(() => expect(revealedChars()).toBe(15))
    expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:5')
    expect(screen.getByTestId('status-mode').textContent).toBe('输入模式 纯按键')
    expect(screen.getByTestId('page-text').textContent).toContain(novel.flatText.slice(0, 15))
  })

  /**
   * 【这条钉的是「命令行给的路径打不开」时的回退】
   *
   * 旧的两段式启动天然有它：第一段的 catch 刻意不 return，于是落到第二段去开「上次那本」。
   * Task 7 把两段合并成一次之后，光靠 `argv ?? lastSourcePath` 挑一个是不够的——用户手滑
   * 指了个打不开的路径就会落到空状态，而磁盘上明明有上次读的那本书。
   *
   * 少了下面这段回退（把 catch 改成直接 return），本用例会红成 0 个字。
   */
  it('命令行给的路径打不开时，回退到上次打开的那本书', async () => {
    const novel = makeNovel()
    const session: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: '/tmp/测试书.txt',
      ratio: 5,
      mode: 'key',
      cursor: 15,
      revealStart: 0,
      chapterPos: [15, 0],
      activeChapter: 0,
      startedAt: null
    }
    installApi(novel, session)
    ;(window.api as unknown as { initialNovelPath: unknown }).initialNovelPath = vi.fn(
      async () => '/tmp/打不开.txt'
    )
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      ...defaultSettings(),
      lastSourcePath: novel.sourcePath
    }))
    ;(window.api as unknown as { openNovelPath: unknown }).openNovelPath = vi.fn(
      async (p: string) => {
        if (p === '/tmp/打不开.txt') throw new Error('模拟：命令行指的文件打不开')
        return novel
      }
    )

    render(<App />)

    // 第一个目标失败、第二个成功 —— 于是恢复到 15 字，而不是停在空状态
    await waitFor(() => expect(revealedChars()).toBe(15))
    expect(screen.queryByTestId('page-empty')).toBeNull()
  })

  it('清除阅读记录后回到空状态', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 先把导入那次设置写盘的防抖推过去：不推的话，`lastSourcePath` 从来没有真正落过盘，
    // 下面「清成 null」那条断言就与「压根没写过」区分不开。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    openSettings()
    fireEvent.click(screen.getByTestId('btn-clear-session'))
    await waitFor(() => expect(screen.getByTestId('page-empty')).toBeTruthy())
    expect(window.api.clearSession).toHaveBeenCalled()

    // 【清除要连「上次打开的是哪本」一起清掉】不清的话，用户按下清除再重启，那本书又自己
    // 开回来了——而设置（文档名 / 外观 / 纸张）照旧留着。清除之后设置那一侧也会防抖写一次，
    // 推过去再断言（不推的话最后一条载荷还是导入时那条）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    const saveSettings = window.api.saveSettings as unknown as {
      mock: { calls: AppSettings[][] }
    }
    await waitFor(() => expect(saveSettings.mock.calls.length).toBeGreaterThan(0))
    const payload = saveSettings.mock.calls[saveSettings.mock.calls.length - 1][0]
    expect(payload.lastSourcePath).toBeNull()
    // 前提：这本书此前确实被记成了「上次打开的那本」——否则上面那条断言可能只是因为
    // lastSourcePath 从来就没被写过，「清成 null」与「压根没写过」区分不开。
    const seen = saveSettings.mock.calls.map((c) => c[0].lastSourcePath)
    expect(seen).toContain(novel.sourcePath)
  })

  it('在设置里改文档名，关掉之后蓝条上的字跟着变', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    openSettings()
    const input = screen.getByTestId('doc-title-input') as HTMLInputElement
    expect(input.value).toBe('文档1')
    fireEvent.change(input, { target: { value: '第 3 季度汇报' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByTestId('settings-close'))

    expect(screen.getByTestId('doc-title').textContent).toBe('第 3 季度汇报')
  })

  it('打字后会防抖保存会话', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    const saveSession = window.api.saveSession as unknown as { mock: { calls: unknown[] } }
    const before = saveSession.mock.calls.length

    // 连着敲 3 下（每次都是状态变化），但都发生在防抖窗口之内
    fireEvent.input(capture, { target: { value: 'x' } })
    fireEvent.input(capture, { target: { value: 'x' } })
    fireEvent.input(capture, { target: { value: 'x' } })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved!.cursor).toBe(30)
    expect(saved!.sourcePath).toBe('/tmp/测试书.txt')

    // 【防抖本身也要断言】：只断言「最终写了一次」的话，把防抖整个删掉
    //（每次状态变化都立刻写）用例照样全绿——变异实测确认过。3 次击键 + 推进一次
    // 防抖窗口，应当**恰好写一次**（写的是最后那个状态）。
    expect(saveSession.mock.calls.length - before).toBe(1)
  })

  it('没有 window.api 时也渲染出外壳，不抛（sandboxed preload 加载失败）', async () => {
    // 把 setup.ts 那份良性桩摘掉，模拟 Task 6 实测过的形态：preload 加载失败时
    // 页面照常渲染，而 window.api === undefined。global.d.ts 把它声明成必填，
    // 所以类型层面不会提醒任何人——这条用例是 App 里那几处 api 判空的唯一守卫。
    // 两种失败形态都会被抓到：effect 里同步抛（render 直接红），以及 void boot() 里
    // 的 unhandled rejection（用例行照旧 passed，但汇总行多一条 Errors、exit code 是 1）。
    delete (window as unknown as { api?: unknown }).api

    expect(() => render(<App />)).not.toThrow()
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId('app-root')).toBeTruthy()
    expect(screen.getByTestId('page-empty')).toBeTruthy()
    expect(screen.getByTestId('status-chapter').textContent).toBe('—')
    expect(revealedChars()).toBe(0)
  })
})

describe('设置的持久化', () => {
  it('启动时把磁盘上的设置读进界面', async () => {
    installApi(null)
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      docTitle: '季度汇报',
      themeSource: 'dark' as const,
      darkPaper: true,
      lastSourcePath: null
    }))
    render(<App />)
    // doc-title 是蓝条上那个文档名（Ribbon.tsx 里 data-testid="doc-title"）
    await waitFor(() => expect(screen.getByTestId('doc-title').textContent).toBe('季度汇报'))
  })

  // 【这条是本次改动里最容易写错的一条】设置是「改了就写回」的，而首帧渲染时三个状态
  // 还都是默认值——读盘是异步的。少了 settingsLoaded 那道闸，启动会先拿着默认值写一遍，
  // 把磁盘上真正的设置冲掉，然后才读到已经被自己冲掉的默认值。
  //
  // 【读盘必须真的挂住】桩若立即 resolve，settingsLoaded 马上就是 true，那个 effect 写盘
  // 是**正确行为**——这条用例就变成「测不出守卫在不在」的空跑。所以这里用一个手动放行的
  // Promise，并分两段断言：挂住时一次都不许写，放行之后必须写。第二段是前提自检，
  // 少了它，一个「防抖根本没接上」的实现也能让第一段绿。
  it('读回设置之前不写盘（否则会用自己的默认值覆盖磁盘）', async () => {
    installApi(null)
    const saveSettings = vi.fn(async (_settings: AppSettings) => {})
    let release: (s: AppSettings) => void = () => {}
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(
      () =>
        new Promise<AppSettings>((resolve) => {
          release = resolve
        })
    )
    ;(window.api as unknown as { saveSettings: unknown }).saveSettings = saveSettings
    render(<App />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(saveSettings).not.toHaveBeenCalled()

    // 【第二段为什么是 waitFor 而不是再推进一次定时器】`advanceTimersByTimeAsync(2000)` 跑在
    // React 把「settingsLoaded 变 true」那一帧提交【之前】：那个 effect 因此是在这一刻之后才
    // 排上 600ms 定时器的，推进窗口里根本没有它。`shouldAdvanceTime: true` 下 waitFor 的实时
    // 轮询会连带推进假时钟，600ms 一到就落盘——本文件里「打字后会防抖保存会话」也是这么等
    // 防抖的。实测：只写 advance 时这条红在 `toHaveBeenCalled`，换成 waitFor 才绿。
    await act(async () => {
      release({ docTitle: '季度汇报', themeSource: 'dark', darkPaper: true, lastSourcePath: null, ratio: 10, shortcuts: {} })
      await vi.advanceTimersByTimeAsync(2000)
    })
    await waitFor(() => expect(saveSettings).toHaveBeenCalled())
    // 【断言载荷，而不是只断言「被调用过」】只问「调用过没有」的话，一个写完空壳的实现
    // 也能过。这里要求落盘的正是刚从磁盘读回来的那份——release 进去的那三个非默认值
    // （文档名 / 外观 / 纸张）都必须原样带出来。
    const payload = saveSettings.mock.calls[0][0] as AppSettings
    expect(payload.docTitle).toBe('季度汇报')
    expect(payload.themeSource).toBe('dark')
    expect(payload.darkPaper).toBe(true)
  })

  it('改了文档名之后会把设置写回去', async () => {
    installApi(makeNovel())
    const saveSettings = vi.fn(async (_settings: AppSettings) => {})
    ;(window.api as unknown as { saveSettings: unknown }).saveSettings = saveSettings
    render(<App />)
    // 【先让启动那一次设置读盘落地】它是异步的，而下面几步是同步点击。少了这一句，
    // 启动读到默认值之后才 resolve，会把刚保存的文档名覆盖回「文档1」——
    // 那是测试里的时序假象（真机上启动那一次 IPC 早于人能点开对话框），但假象一样会让
    // 这条用例红在一个与它无关的地方。
    await act(async () => {})
    importViaSettings()
    openSettings()
    fireEvent.change(screen.getByTestId('doc-title-input'), { target: { value: '季度汇报' } })
    // 【必须点保存】失焦现在只归一化、不提交——文档名与阅读替换都归「手动保存」那一组
    fireEvent.click(screen.getByTestId('settings-save'))
    // 中间观测点：蓝条上那个名字变了就说明提交确实发生了（否则下面的失败会指向错误的层）
    expect(screen.getByTestId('doc-title').textContent).toBe('季度汇报')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    await waitFor(() => expect(saveSettings).toHaveBeenCalled())
    const last = saveSettings.mock.calls[saveSettings.mock.calls.length - 1][0]
    expect(last.docTitle).toBe('季度汇报')
  })
})

describe('全局比例与当前书比例', () => {
  // 全局比例的全部作用：**新导入**的书拿它当起点
  it('新导入的书用全局比例当起点', async () => {
    installApi(makeNovel())
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      ...defaultSettings(),
      ratio: 3
    }))
    render(<App />)
    await act(async () => {})
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 状态栏那条报的是**当前书**的比例——也就是引擎真正在用的那个
    expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:3')
  })

  // 这条是本设计的核心语义：全局不是「覆盖值」而是「初值」，已经打开过的书各管各的
  it('有记录的书用它自己的比例，不被全局顶掉', async () => {
    const novel = makeNovel()
    const session: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: '/tmp/测试书.txt',
      ratio: 5,
      mode: 'key',
      cursor: 0,
      revealStart: 0,
      chapterPos: [0, 0],
      activeChapter: 0,
      startedAt: null
    }
    installApi(novel, session)
    // 全局是 3、这本书的记录是 5 —— 必须显示 5。桩里把 lastSourcePath 也指着它，
    // 走的是「启动恢复」那条路（与手动导入同一条 openNovel）。
    ;(window.api as unknown as { loadSettings: unknown }).loadSettings = vi.fn(async () => ({
      ...defaultSettings(),
      ratio: 3,
      lastSourcePath: novel.sourcePath
    }))
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:5'))
  })
})

describe('导入一本读过的书', () => {
  // 【这是本特性存在的理由，也是初稿漏掉的那条】openNovel 原先是 `new TypingEngine(next)`
  // ——**从不读会话**，而「导入小说」走的正是它。少了读盘这一步，导入一本读过的书＝全新引擎
  // ＝600ms 后把 cursor 0 落盘覆盖掉那本书的进度。
  it('导入时接着上次读，而不是从头开始', async () => {
    const novel = makeNovel()
    const session: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: novel.sourcePath,
      ratio: 10,
      mode: 'ime',
      cursor: 20,
      revealStart: 0,
      chapterPos: [20, 0],
      activeChapter: 0,
      startedAt: null
    }
    installApi(novel, session)
    render(<App />)
    importViaSettings()

    // 接着上次读 ⇒ 阅读区显示 20 个字（而不是 0）
    await waitFor(() => expect(revealedChars()).toBe(20))
    // 【这一条才是钉住「按书取进度」的】只断言「显示了 20 个字」是不够的——实现之前它也是绿的：
    // 旧启动流程里那段「先 loadSession()（无参）再比 sourcePath」照样能恢复到 20 个字，于是这
    // 条用例在改之前就能通过（实测：只加用例、还没动 App.tsx 的那一轮，它已经在 12 passed 里）。
    // 有证明力的是「有人按这本书的路径去问过进度」：openNovel 若不读会话，这一项恒为 null。
    expect(sessionAskedFor).toBe(novel.sourcePath)
  })
})
```

- [ ] **Step 5: 运行测试并修复**

Run: `pnpm vitest run tests/unit/app.test.tsx`
Expected: 全部 PASS。

常见失败与对策：
- `Cannot read properties of undefined (reading 'importNovel')` → `installApi` 必须在 `render(<App />)` 之前调用。
- `act(...)` 警告 → 用 `await waitFor(...)` 包裹状态更新断言，计时器推进用 `await act(...)`。
- 会话恢复用例拿到 `已显示 0` → 检查 `TypingEngine.fromSession` 是否被调用，以及 `loadSession` mock 是否返回了非 null。

- [ ] **Step 6: 跑全量测试 + typecheck + 构建**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: 三项都 exit 0。

- [ ] **Step 7: 手动真机验证（必须做，不能只靠单测）**

先造一个真实小说样本：

```bash
mkdir -p /tmp/wt && python3 - <<'PY'
lines = []
for i in range(1, 21):
    lines.append(f"第{i}章 第{i}节")
    lines.append("")
    lines.append("这是一段用来验证打字替换的正文。" * 6)
    lines.append("")
open('/tmp/wt/测试小说.txt', 'w', encoding='utf-8').write("\n".join(lines))
PY
```

Run: `pnpm dev`
逐项确认：
1. 文件 → 导入小说，选中 `/tmp/wt/测试小说.txt`，左侧出现 20 章。
2. 在纸上敲键盘：**你自己敲的字符不出现**，出现的是小说文字，每次击键出现 10 个字符。
3. 切换比例到 1 再敲，每次只出现 1 个字符。
4. 切换比例到 200，一次出现 200 个字符。
5. 按退格，文字成块回退；再按，退到章节开头就停住。
6. 点左侧「第 5 章」，阅读区变化，状态栏显示「第 5 章」，高亮跟着走。
7. 一路敲过章节边界，文字**连续**，不会跳变或清空。
8. 点「加粗」「导出 docx」等按钮，有高亮或弹窗反馈。
9. 关掉应用再 `pnpm dev`，**自动回到上次位置**，不用重新敲。

- [ ] **Step 8: Commit**

```bash
git add <本任务改动的显式路径…>   # 不要用 -A：见文件头「git add -A 只在独占一棵工作树时安全」
cat > /tmp/wt-commit-msg.txt <<'EOF'
feat(renderer): App 接线（引擎 ↔ UI ↔ 会话持久化）
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## Task 13: E2E 冒烟测试

**Files:**
- Create: `tests/e2e/app.spec.ts`, `tests/fixtures/e2e-novel.txt`

**Interfaces:**
- Consumes: 构建产物 `out/main/index.js`；启动参数（txt 路径）；`WT_USER_DATA` 环境变量
- Produces: 真实 Electron 进程里的打字链路回归测试

- [ ] **Step 1: 写 `tests/fixtures/e2e-novel.txt`**

```
第一章 甲
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
第二章 乙
BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
第三章 丙
CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC
```

- [ ] **Step 2: 写 `tests/e2e/app.spec.ts`**

```ts
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const NOVEL = resolve(__dirname, '..', 'fixtures', 'e2e-novel.txt')

let app: ElectronApplication
let win: Page
let profileDir: string

test.beforeEach(async () => {
  profileDir = mkdtempSync(join(tmpdir(), 'wt-e2e-'))
  app = await electron.launch({
    args: ['.', NOVEL],
    cwd: resolve(__dirname, '..', '..'),
    env: { ...process.env, WT_USER_DATA: profileDir }
  })
  win = await app.firstWindow()
  await win.waitForSelector('[data-testid="app-root"]')
})

test.afterEach(async () => {
  // 「重启恢复」用例已经自己关过一次，这里必须容错
  try {
    await app.close()
  } catch {
    // 已关闭
  }
  rmSync(profileDir, { recursive: true, force: true })
})

/**
 * 「已经抽了多少字」的观测点。
 *
 * 【为什么不用状态栏】状态栏那条「已显示 N / 全书 M 字」已经删掉了——真 Word 只报全文字数、
 * 从不报「已显示多少」，那个词组本身就是伪装破绽。改读**正文长度**：那才是用户真正看到的，
 * 也是「抽了多少字」唯一的真相来源。`expect.poll` 负责重试（内容上屏不是同步的）。
 */
const revealed = async (): Promise<number> =>
  (await win.locator('[data-testid="page-text"]').textContent())?.length ?? 0

const focusEditor = async (): Promise<void> => {
  // 阅读区被一层透明 textarea（.wt-input）完全覆盖，点 .wt-page 会被它拦截。
  // 直接点这个 textarea —— opacity:0 不影响 Playwright 的可交互判定。
  await win.locator('[data-testid="input-capture"]').click()
}

test('启动即导入命令行传入的小说，并列出章节', async () => {
  await expect(win.locator('[data-testid="chapter-item-0"]')).toBeVisible()
  await expect(win.locator('[data-testid="chapter-item-2"]')).toBeVisible()
  await expect.poll(revealed).toBe(0)
})

test('打字不显示原字符，而是按比例抽出小说文字', async () => {
  await focusEditor()
  await win.keyboard.type('aaaaa')
  await expect.poll(revealed).toBe(50)

  const text = await win.locator('[data-testid="page-text"]').innerText()
  expect(text).not.toContain('a')
  expect(text.startsWith('第一章 甲')).toBe(true)
})

test('退格只回吐显示，小说内容不受影响', async () => {
  await focusEditor()
  await win.keyboard.type('aaa')
  await expect.poll(revealed).toBe(30)

  await win.keyboard.press('Backspace')
  await expect.poll(revealed).toBe(20)

  await win.keyboard.press('Backspace')
  await win.keyboard.press('Backspace')
  await expect.poll(revealed).toBe(0)

  // 再敲一次，仍然从同一位置重新抽出同样的文字
  await win.keyboard.type('a')
  await expect(win.locator('[data-testid="page-text"]')).toContainText('第一章 甲')
})

test('改比例后同样的击键抽出更多字', async () => {
  // 比例框现在在设置对话框里（原先挂在「开始」/「视图」两个选项卡的工具栏上）
  await win.locator('[data-testid="tab-文件"]').click()
  await win.locator('[data-testid="btn-settings"]').click()
  const ratio = win.locator('[data-testid="ratio-input"]')
  await ratio.fill('3')
  await ratio.press('Enter')
  await expect(win.locator('[data-testid="status-ratio"]')).toContainText('1:3')
  await win.locator('[data-testid="settings-close"]').click()
  await expect(win.locator('[data-testid="settings"]')).toBeHidden()

  await focusEditor()
  await win.keyboard.type('aa')
  await expect.poll(revealed).toBe(6)
})

/**
 * 【这条是本次唯一能在真机（真实 Chromium 的焦点语义 + 命中测试）里判的用例】
 *
 * jsdom 里测不到的是**后果**：对话框开着时用户敲的键会漏进小说，而字出在遮罩后面，
 * 用户看不见。单测里那两条守的是 InputCapture 里两条闸的机制，不是这个后果
 * ——尤其「点对话框里不可聚焦的空白处」这一下：浏览器会把焦点交给 body，而 jsdom 不会，
 * 单测是手工把那个状态摆出来的。
 */
test('设置对话框：按钮与 ⌘, 都能开，开着时敲键盘不抽字，Esc 关', async () => {
  await win.locator('[data-testid="tab-文件"]').click()
  await win.locator('[data-testid="btn-settings"]').click()
  await expect(win.locator('[data-testid="settings"]')).toBeVisible()

  // 打开那一瞬间焦点就得在对话框里：浏览器的 click 会先经过 React（对话框挂载 + autoFocus）、
  // 再冒泡到 window 上那个「点哪儿都把焦点抢回隐形输入框」的监听。少了那条闸，这一下就会
  // 把焦点抢走，下面的断言当场红。
  await expect(win.locator('[data-testid="doc-title-input"]')).toBeFocused()

  // 在文档名输入框里敲的字母进输入框，不许抽走小说
  await win.keyboard.type('aaa')
  await expect.poll(revealed).toBe(0)

  // 点对话框里不可聚焦的空白处（面板左边缘、行标号左侧）：浏览器会把焦点交给 body，
  // 此后键盘没有焦点宿主，更不该被抢回阅读区
  await win.locator('[data-testid="settings"] .wt-modal__panel').click({ position: { x: 4, y: 60 } })
  await expect(win.locator('[data-testid="input-capture"]')).not.toBeFocused()
  await win.keyboard.type('bbb')
  await expect.poll(revealed).toBe(0)

  await win.keyboard.press('Escape')
  await expect(win.locator('[data-testid="settings"]')).toBeHidden()

  // 快捷键⌘/Ctrl + , 同样能开
  await win.keyboard.press('Meta+Comma')
  await expect(win.locator('[data-testid="settings"]')).toBeVisible()
})

test('点击章节跳到该章，并在读过后回填进度', async () => {
  await win.locator('[data-testid="chapter-item-1"]').click()
  // 状态栏现在写的是页码形状的 `2 / 3`（真 Word 左下角就是页码），不再是「第 2 章 / 共 3 章」
  await expect(win.locator('[data-testid="status-chapter"]')).toHaveText('2 / 3')

  await focusEditor()
  await win.keyboard.type('a')
  await expect.poll(revealed).toBe(10)
  const afterTyping = await win.locator('[data-testid="page-text"]').innerText()

  // 离开再回来，进度应被回填
  await win.locator('[data-testid="chapter-item-0"]').click()
  await expect.poll(revealed).toBe(0)
  await win.locator('[data-testid="chapter-item-1"]').click()
  await expect.poll(revealed).toBe(10)
  expect(await win.locator('[data-testid="page-text"]').innerText()).toBe(afterTyping)
})

test('占位按钮点击有可见反馈', async () => {
  await win.locator('[data-testid="tab-文件"]').click()
  await win.locator('[data-testid="btn-export-docx"]').click()
  await expect(win.locator('[data-testid="toast"]')).toContainText('演示占位功能')
})

test('重启后恢复到上次阅读位置，无需重新输入', async () => {
  await focusEditor()
  await win.keyboard.type('aaaa')
  await expect.poll(revealed).toBe(40)

  // 等防抖保存落盘
  await win.waitForTimeout(1200)
  await app.close()

  app = await electron.launch({
    args: ['.', NOVEL],
    cwd: resolve(__dirname, '..', '..'),
    env: { ...process.env, WT_USER_DATA: profileDir }
  })
  win = await app.firstWindow()
  await win.waitForSelector('[data-testid="app-root"]')

  await expect.poll(revealed).toBe(40)
})
```

- [ ] **Step 3: 运行 E2E**

Run: `pnpm test:e2e`
Expected: 7 个用例全部 PASS。

失败排查：
- `Timed out waiting for firstWindow` → 先单独跑 `pnpm build`，确认 `out/main/index.js` 存在。
- `第一章 甲` 断言失败 → 输入法模式下 `keyboard.type` 触发的是 `input` 事件而非 `compositionend`；确认 `InputCapture.handleInput` 在非合成态下会 `pump(el.value.length)`。
- 重启恢复用例失败 → 确认 `saveSession` 防抖是 600ms 且测试等待了 1200ms；并在 `beforeunload` 之外确认 `afterEach`/`app.close()` 前数据已落盘。

- [ ] **Step 4: 跑一次完整验证**

Run: `pnpm typecheck && pnpm test && pnpm test:e2e`
Expected: 三项全绿。

- [ ] **Step 5: Commit**

```bash
git add <本任务改动的显式路径…>   # 不要用 -A：见文件头「git add -A 只在独占一棵工作树时安全」
cat > /tmp/wt-commit-msg.txt <<'EOF'
test(e2e): Playwright 驱动真实 Electron 的冒烟测试
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## Task 14: 打包与文档

**Files:**
- Create: `electron-builder.yml`, `README.md`, `.github/workflows/build.yml`
- Modify: `package.json`（补 `build` 元信息）

**Interfaces:**
- Consumes: `out/**` 构建产物
- Produces: macOS `.dmg`、Windows NSIS `.exe`、免安装目录

- [ ] **Step 1: 写 `electron-builder.yml`**

```yaml
appId: com.workingtitle.typingreader
productName: WorkingTitle
copyright: Copyright © 2026

directories:
  output: release
  buildResources: build

files:
  - out/**
  - package.json

asar: true

mac:
  category: public.app-category.productivity
  target:
    - target: dmg
      arch:
        - arm64
        - x64

dmg:
  title: ${productName}

win:
  target:
    - target: nsis
      arch:
        - x64

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  shortcutName: WorkingTitle

linux:
  target:
    - AppImage
  category: Office
```

- [ ] **Step 2: 验证免安装构建**

Run: `pnpm dist:dir`
Expected: exit 0，且 `release/mac-arm64/WorkingTitle.app`（或对应平台目录）存在。

Run: `ls release/`
Expected: 列出构建产物目录。

- [ ] **Step 3: 启动产物验证打包后的应用真的能用**

Run: `open "release/mac-arm64/WorkingTitle.app" --args /tmp/wt/测试小说.txt`
（Windows 上改为直接双击 exe 或 `release/win-unpacked/WorkingTitle.exe /tmp/wt/测试小说.txt`）

Expected: 应用启动并自动导入该 txt；在文档区打字能看到小说文字按比例出现。

**这是打包环节唯一有意义的验收标准** —— 只看构建成功不算通过。

- [ ] **Step 4: 构建 macOS dmg**

Run: `pnpm dist:mac`
Expected: exit 0，`release/` 下出现 `WorkingTitle-0.1.0-arm64.dmg` 与 `WorkingTitle-0.1.0-x64.dmg`。

若因缺少图标而告警，属正常（使用 Electron 默认图标），不阻塞。

- [ ] **Step 5: 尝试构建 Windows exe（可能失败，如实记录）**

Run: `pnpm dist:win`
Expected: 可能成功产出 `release/WorkingTitle Setup 0.1.0.exe`；**也可能因 macOS 上缺少 wine 而失败**。

无论结果如何，把**实际命令与完整输出**记录下来，写进 README 的「已知问题」。不要声称成功而实际没验证。

- [ ] **Step 6: 写 `.github/workflows/build.yml`**

在 macOS 上交叉构建 Windows 包不可靠时的兜底方案。

```yaml
name: Build

on:
  workflow_dispatch:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            script: dist:mac
            artifact: release/*.dmg
          - os: windows-latest
            script: dist:win
            artifact: release/*.exe
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm ${{ matrix.script }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.os }}-build
          path: ${{ matrix.artifact }}
```

- [ ] **Step 7: 写 `README.md`**

必须包含：项目简介、核心玩法（打字替换 + 比例）、双模式输入说明、开发命令、打包命令、**macOS 与 Windows 构建的实际验证结果（含失败输出）**、已知问题、数据存放位置（`userData` 下的 `session.json` / `novel-cache.*`）。

- [ ] **Step 8: 最终全量验证**

Run: `pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build`
Expected: 全部 exit 0。把真实输出贴进最终报告。

- [ ] **Step 9: Commit**

```bash
git add <本任务改动的显式路径…>   # 不要用 -A：见文件头「git add -A 只在独占一棵工作树时安全」
cat > /tmp/wt-commit-msg.txt <<'EOF'
build: electron-builder 双平台打包配置、CI 工作流与 README
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## Task 16: 设置对话框（把真实功能收进模态）

> **这一节是应用可用之后追加的**（Task 1–14 全部交付、Task 15 那条「建议新增」与它无关），
> 编号排在 Task 14 之后只是为了不重排前面的任务。

**Files:**
- Create: `src/renderer/src/components/SettingsDialog.tsx`、`tests/unit/settings.test.tsx`
- Modify: `src/renderer/src/components/Ribbon.tsx`、`src/renderer/src/components/Toolbar.tsx`、
  `src/renderer/src/input/InputCapture.tsx`、`src/renderer/src/styles/ribbon.css`、
  `src/renderer/src/components/ChapterList.tsx`、`src/renderer/src/components/Page.tsx`、
  `tests/unit/ribbon.test.tsx`、`tests/unit/app.test.tsx`、`tests/unit/chapterList.test.tsx`、
  `tests/e2e/app.spec.ts`
- 本任务**没有**动 `src/renderer/src/App.tsx`：对话框归 `Ribbon` 所有——打开它的按钮就在 Ribbon
  渲染的「文件」选项卡里，文档名本来也已经是 Ribbon 的 prop——所以 App 的接线一字未改。

**Interfaces:**
- Consumes: Task 8 的 `useToolbar()`、Task 7 的 CSS 类名（本任务新增 10 个 `.wt-modal*`）
- Produces:
  - `<SettingsDialog open={boolean} onClose={() => void} docTitle={string} onDocTitleChange={(t: string) => void} />`：
    居中模态，`role="dialog"` / `aria-modal="true"`
  - `data-testid` 新增：`settings`（对话框根）、`settings-close`（标题栏 ✕）、
    `settings-close-footer`（底部「关闭」）、`btn-settings`（「文件」页那个入口）
  - 搬进对话框的五个 testid **原样不变**：`doc-title-input`、`ratio-input`、`mode-button`、
    `btn-import`、`btn-clear-session`

**为什么做**：应用的真实功能原先直接摆在假 Word 的界面上——工具栏里一组「阅读替换」放着比例框和
模式按钮，「文件」页第一组就是「导入小说 / 清除阅读记录」，蓝条上的文档名还能点开改。这些是伪装
里最容易被一眼看穿的地方。收进一个模态之后界面上只剩两个入口，而两者都是真 Word 也有的东西。

**界面上因此去掉的**：
1. 「开始」和「视图」两个选项卡里的 `READING_GROUP`（比例 + 输入模式）——整组删除
2. 「文件」选项卡里的「小说」组 → 换成「设置」组（一个按钮）；同页原有的「文件」组
   （新建/保存/导出 docx/打印 这些占位）保留
3. 蓝条上的文档名不再可点，变回静态文本（仍显示 `docTitle`，只是不能就地编辑）

**不动的**：左侧栏的收起按钮（`sidebar-toggle`）与 ⌘/Ctrl+Shift+H 快捷键；阅读区、输入捕获、
章节列表、状态栏的逻辑。

**顺带改掉的两处文案**（是本任务造成的失实，不是顺手优化）：`Page` 的空状态提示与 `ChapterList`
的副标题里的「文件 → 导入小说」→「文件 → 设置 → 导入小说」。两个入口点的是同一条路径，而那条
路径上的按钮已经被本任务删掉了——留着就是把用户指向一个不存在的地方。

**⚠️ 一个必须处理的交互冲突**：`InputCapture` 在 window 上挂了 `mousedown` / `click` 把焦点抢回
隐藏 textarea（「点哪儿都能继续打字」）。它已经会跳过文字输入类元素，但**点对话框里的空白处或
按钮时仍会把焦点抢走**，后果是对话框开着、用户随手敲的字全抽进小说（字出在遮罩后面，看不见）。

修法是**两条闸**，都按 ARIA 的标准属性判定（不为此造专用属性）：

1. **点击目标**落在 `[role="dialog"]` 里 → 不抢。管的是「点对话框里不可聚焦的空白处」：那时浏览器
   已经把焦点交给了 `body`，只看当前焦点是判不出来的。
2. **当前焦点已经在** `[role="dialog"]` 里 → 不抢。管的是「用『设置』按钮打开」那一下：
   React 的事件层挂在容器（`#root`）上，而这两个监听挂在 `window` 上——容器在 `window` 的里面，
   所以冒泡到 window 时 React 的 `onClick` 已经跑完（对话框挂载、`autoFocus` 已把焦点送进文档名
   输入框），而 `e.target` 仍是工具栏上那个**不在对话框里**的按钮。少了第二条闸，这一下正好把焦点
   抢回去。

【这两条各自守到哪一层，说清楚】单测守的是**机制**（`tests/unit/settings.test.tsx` 里两条用例，
各自都能被对应的那条闸单独变红）。「抢回去之后用户的字真的会抽进小说」这个**后果**在 jsdom 里
求证不了（没有命中测试，也没有「点不可聚焦元素 → 焦点交给 body」这条浏览器行为），它由
`tests/e2e/app.spec.ts` 里驱动真实 Electron 的那条用例判——那条用例的
`toBeFocused()` 断言在删掉第二条闸之后实测会红（真机验过，不是推测）。

**Step 1: 写 `src/renderer/src/components/SettingsDialog.tsx`**
```tsx
import { useEffect, useMemo, type FocusEvent } from 'react'
import type { FluentIcon } from '@fluentui/react-icons'
import { MAX_RATIO, MIN_RATIO } from '../../../core/types'
import { useDeferredSettings, type DeferredField } from '../state/deferredSettings'
import { clampRatioInput, useToolbar } from '../state/ToolbarContext'
import type { ThemeSource } from '../types/global'
import {
  IconBook,
  IconClear,
  IconClose,
  IconDarkTheme,
  IconDesktop,
  IconDocument,
  IconFontSize,
  IconImport,
  IconKeyboard,
  IconMoon,
  IconRename,
  IconSettings,
  IconSun
} from './icons'

export interface SettingsDialogProps {
  /** 对话框归 Ribbon 所有：打开它的那个按钮就在「文件」选项卡的工具组里 */
  open: boolean
  onClose: () => void
  docTitle: string
  onDocTitleChange: (next: string) => void
  /** 「深色模式下纸张也变暗」。默认关（真 Word 深色模式下纸张仍是白的）。 */
  darkPaper: boolean
  onDarkPaperChange: (next: boolean) => void
  /** 外观偏好：跟随系统 / 浅色 / 深色 */
  themeSource: ThemeSource
  onThemeSourceChange: (next: ThemeSource) => void
  /** 有没有打开小说：「当前书」的比例框据此禁用——没有书就没有「当前书」 */
  novelOpen: boolean
}

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统', icon: IconDesktop },
  { value: 'light', label: '浅色', icon: IconSun },
  { value: 'dark', label: '深色', icon: IconMoon }
] as const satisfies ReadonlyArray<{ value: ThemeSource; label: string; icon: FluentIcon }>

/**
 * 设置对话框：应用**真实功能**的唯一去处（文档名 / 比例 / 输入模式 / 导入 / 清除阅读记录）。
 *
 * 【为什么要有一个对话框，而不是像原来那样把控件摆在工具栏里】那些控件是伪装的一部分里
 * 最扎眼的一处：「1 键显示 N 字」「导入小说」摆在假 Word 的工具栏和「文件」页上，任何一个
 * 瞥见屏幕的人都看得出这不是 Word。收进一个模态之后，界面上只剩一个「设置」按钮和一个
 * 快捷键——它们本身就是 Word 也有的东西（Word 的「选项」同样是模态框）。
 *
 * 【testid 一个都没改】`ratio-input` / `mode-button` / `btn-import` / `btn-clear-session` /
 * `doc-title-input` 原样搬进来，只是不再同时存在于工具栏里。
 */
export function SettingsDialog({
  open,
  onClose,
  docTitle,
  onDocTitleChange,
  darkPaper,
  onDarkPaperChange,
  themeSource,
  onThemeSourceChange,
  novelOpen
}: SettingsDialogProps) {
  const { ratio, setRatio, globalRatio, setGlobalRatio, mode, setMode, onImport, onClearSession, notify } =
    useToolbar()

  /**
   * 「手动保存」的那一组设置项——**加一项就是往这张表里加一行**。
   *
   * 表里只有这两项：文档名与阅读替换。外观、纸张、输入模式刻意**不**进来，它们的效果是
   * 当场看得见的（换个颜色、按一下就知道），要保存才生效会很别扭。
   *
   * 【两项底层是两条路】文档名是全局设置（App 状态 → 防抖写 `settings.json`），而比例跟着
   * 书走（`engine.setRatio`，存在那本书的会话里）。对用户是同一个「保存」按钮，这正是把表
   * 放在这里的理由：对话框不必知道背后是什么，它只调 `commit`。
   */
  const fields: DeferredField[] = useMemo(
    () => [
      {
        id: 'doc-title',
        committed: docTitle,
        // 空名退回当前值：蓝条上留一片空白比留着上一个名字更扎眼
        normalize: (raw, committed) => {
          const trimmed = raw.trim()
          return trimmed === '' ? committed : trimmed
        },
        commit: (value) => {
          if (value !== docTitle) onDocTitleChange(value)
        }
      },
      {
        id: 'ratio',
        committed: String(ratio),
        // 解析不出数字就退回当前值，而不是留一个 NaN 草稿——那种草稿会让「保存」一直亮着
        // 而点下去什么都不提交（用户会以为按钮坏了）
        normalize: (raw, committed) => {
          const parsed = Number.parseInt(raw, 10)
          return Number.isFinite(parsed) ? String(clampRatioInput(parsed)) : committed
        },
        commit: (value) => setRatio(Number(value))
      },
      {
        // 全局比例与当前书比例**用的是同一套解析与夹紧**，区别只在提交到哪儿：
        // 一个进 settings.json（新导入的书取它当起点），一个进那本书的会话（真正生效的那个）。
        id: 'global-ratio',
        committed: String(globalRatio),
        normalize: (raw, committed) => {
          const parsed = Number.parseInt(raw, 10)
          return Number.isFinite(parsed) ? String(clampRatioInput(parsed)) : committed
        },
        commit: (value) => setGlobalRatio(Number(value))
      }
    ],
    [docTitle, ratio, globalRatio, onDocTitleChange, setRatio, setGlobalRatio]
  )
  const { drafts, setDraft, blur, dirty, save, reset } = useDeferredSettings(fields)

  // 每次打开都从当前值起稿：上次关掉时没保存的草稿不该留到下一次（关闭＝丢弃，是刻意的）
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  /**
   * 比例那两格的失焦处理：只归一化、不提交；**被夹紧了才提示**（普通改个数字不该弹东西）。
   * 两格逻辑一模一样，只有 id 不同，所以抽出来——复制一份的话，夹紧提示的文案或边界一改就容易漏一处。
   */
  const blurRatio =
    (id: 'ratio' | 'global-ratio') =>
    (e: FocusEvent<HTMLInputElement>): void => {
      const raw = e.currentTarget.value
      const after = blur(id)
      const parsed = Number.parseInt(raw, 10)
      if (Number.isFinite(parsed) && String(clampRatioInput(parsed)) !== String(parsed)) {
        notify(`比例已夹紧到 ${MIN_RATIO}–${MAX_RATIO} 范围：${after}`)
      }
    }

  /** 保存：提交所有有改动的项，并给一条提示（不然点完没有任何反馈） */
  const handleSave = (): void => {
    if (!dirty) return
    save()
    notify('已保存')
  }

  /**
   * Esc 关闭。
   *
   * 【挂在 window 上收得到】InputCapture 在「纯按键」模式下对 `NON_CHAR_KEYS` 里的键
   * （Escape 在列）直接放行，输入法模式下更是完全不拦 keydown，所以这个键不会被抽字
   * 逻辑吃掉。反过来，对话框开着时焦点在对话框里（见下面的 `autoFocus`），隐藏 textarea
   * 根本收不到这些按键。
   */
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  /**
   * 关掉时把键盘焦点还给阅读区的隐形输入框。
   *
   * 【少了这一步，关掉对话框之后用户打不出字——而单测一字不差地全绿】：模态期间焦点在
   * 对话框里，关闭后浏览器把它交还给 `body`，而 InputCapture 只在「挂载时」和「点击
   * 页面其它地方时」抢焦点（它现在还会跳过整个对话框）——于是用户敲键盘什么都不会发生，
   * 得先拿鼠标在阅读区点一下。jsdom 没有真实的焦点移交，这条分支在 vitest 里是空转。
   *
   * 【用 preventScroll 与 InputCapture 自己一致】：不这样的话浏览器会把光标所在处滚进
   * 视野，等于关个设置就把用户的阅读位置跳一下。
   *
   * 查询用 `[data-testid]` 而不是给 InputCapture 加一个 ref 参数：与 App 里那段跟随
   * 滚动同样的取舍——不改别人的公开接口。空状态下（没有小说）根本没有这个元素，
   * 可选链吞掉。
   */
  useEffect(() => {
    if (open) return
    document.querySelector<HTMLElement>('[data-testid="input-capture"]')?.focus({ preventScroll: true })
  }, [open])

  if (!open) return null

  return (
    <div
      className="wt-modal"
      data-testid="settings"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wt-settings-title"
      // 只有点在遮罩自己身上才关：点在面板（及面板里的空白）上时 target 是面板，不是这里。
      // 用 click 而不是 mousedown：从面板里按下、拖出遮罩再松开不该算作「点了遮罩」。
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="wt-modal__panel">
        <div className="wt-modal__header">
          <span className="wt-modal__title" id="wt-settings-title">
            <IconSettings className="wt-modal__title-icon" />
            选项
          </span>
          <button
            type="button"
            className="wt-modal__close"
            data-testid="settings-close"
            aria-label="关闭"
            title="关闭 (Esc)"
            onClick={onClose}
          >
            <IconClose className="wt-modal__close-icon" />
          </button>
        </div>

        <div className="wt-modal__body">
          <div className="wt-modal__row">
            <span className="wt-modal__label">
              <IconRename className="wt-modal__label-icon" />
              文档名
            </span>
            <input
              className="wt-modal__text"
              data-testid="doc-title-input"
              aria-label="文档名"
              // 打开即聚焦：焦点留在对话框里，用户随手敲的键就不会漏进小说（见 InputCapture
              // 里那条 role="dialog" 的闸）。它同时是「第一个输入框」，Tab 顺序从这里开始。
              autoFocus
              value={drafts['doc-title'] ?? docTitle}
              onChange={(e) => setDraft('doc-title', e.target.value)}
              // 失焦只归一化（去两侧空白），**不提交**——生效要等「保存」
              onBlur={() => blur('doc-title')}
              // 回车＝保存：原先它触发提交，现在留着这个例外会和「保存」按钮打架
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
            />
          </div>

          <div className="wt-modal__row">
            <span className="wt-modal__label">
              <IconFontSize className="wt-modal__label-icon" />
              阅读替换
            </span>
            {/*
              两格：**全局**（新导入的书取它当起点）与**当前书**（真正生效的那个）。
              顺序刻意是全局在前——它是兜底，当前书才是引擎在用的。两格都归「手动保存」，
              点保存才生效。
            */}
            <div className="wt-ratio-pair">
              <div className="wt-ratio-line">
                <span className="wt-ratio__caption">全局</span>
                <span className="wt-ratio__label">1 键显示</span>
                <input
                  className="wt-ratio__input"
                  data-testid="global-ratio-input"
                  aria-label="全局比例：新导入的书，输入 1 个字显示小说多少字"
                  inputMode="numeric"
                  value={drafts['global-ratio'] ?? String(globalRatio)}
                  onChange={(e) => setDraft('global-ratio', e.target.value)}
                  onBlur={blurRatio('global-ratio')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave()
                  }}
                />
                <span className="wt-ratio__label">字</span>
                <span className="wt-ratio__note">新导入的书用它</span>
              </div>
              <div className="wt-ratio-line">
                <span className="wt-ratio__caption">当前书</span>
                <span className="wt-ratio__label">1 键显示</span>
                <input
                  className="wt-ratio__input"
                  data-testid="ratio-input"
                  aria-label="当前书比例：输入 1 个字显示小说多少字"
                  inputMode="numeric"
                  // 没有书就没有「当前书」——禁用而不是藏起来，免得两格一隐一现地跳
                  disabled={!novelOpen}
                  value={drafts['ratio'] ?? String(ratio)}
                  onChange={(e) => setDraft('ratio', e.target.value)}
                  onBlur={blurRatio('ratio')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave()
                  }}
                />
                <span className="wt-ratio__label">字</span>
                {!novelOpen && <span className="wt-ratio__note">未打开小说</span>}
              </div>
            </div>
          </div>

          <div className="wt-modal__row">
            <span className="wt-modal__label">
              <IconKeyboard className="wt-modal__label-icon" />
              输入模式
            </span>
            <button
              type="button"
              className={`wt-btn ${mode === 'ime' ? 'wt-btn--active' : ''}`}
              data-testid="mode-button"
              title="切换输入模式：输入法友好 / 纯按键"
              aria-pressed={mode === 'ime'}
              onClick={() => {
                const next = mode === 'ime' ? 'key' : 'ime'
                setMode(next)
                notify(next === 'ime' ? '已切换：输入法友好模式' : '已切换：纯按键模式')
              }}
            >
              {mode === 'ime' ? '输入法' : '纯按键'}
            </button>
          </div>

          <div className="wt-modal__row">
            {/*
              外观的三选一。**必须走主进程**（见 ipc.ts 里的说明）：只翻页面的 class 的话，
              macOS 的红绿灯不会跟着变，又会回到「两块颜色对不上」。
            */}
            <span className="wt-modal__label">
              <IconDarkTheme className="wt-modal__label-icon" />
              外观
            </span>
            <div className="wt-seg" role="group" aria-label="外观">
              {THEME_OPTIONS.map((opt) => {
                const active = themeSource === opt.value
                const OptIcon = opt.icon
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={`wt-btn${active ? ' wt-btn--active' : ''}`}
                    data-testid={`theme-${opt.value}`}
                    aria-pressed={active}
                    onClick={() => onThemeSourceChange(opt.value)}
                  >
                    {/* 选中时图标也换成实心——与功能区那些切换按钮同一套语义 */}
                    <OptIcon filled={active} className="wt-btn__icon" />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="wt-modal__row">
            {/*
              默认【关】：真 Word 的深色模式里纸张仍是白的，保持这一点伪装才完整。
              勾上之后阅读区整块也跟着暗下来——夜里看书不刺眼，代价是不再像 Word。
              只在系统是深色外观下才有意义；浅色外观下勾了也不动（CSS 按组合选择器处理）。
            */}
            <span className="wt-modal__label">
              <IconDocument className="wt-modal__label-icon" />
              纸张
            </span>
            <label className="wt-modal__check">
              <input
                type="checkbox"
                data-testid="dark-paper"
                checked={darkPaper}
                onChange={(e) => onDarkPaperChange(e.target.checked)}
              />
              深色模式下也变暗
            </label>
          </div>

          <div className="wt-modal__row">
            <span className="wt-modal__label">
              <IconBook className="wt-modal__label-icon" />
              小说
            </span>
            <button
              type="button"
              className="wt-btn"
              data-testid="btn-import"
              title="导入小说 (Ctrl+O)"
              onClick={() => onImport()}
            >
              <IconImport className="wt-btn__icon" />
              导入小说
            </button>
            <button
              type="button"
              className="wt-btn"
              data-testid="btn-clear-session"
              title="清除阅读记录"
              onClick={() => onClearSession()}
            >
              <IconClear className="wt-btn__icon" />
              清除阅读记录
            </button>
          </div>
        </div>

        <div className="wt-modal__footer">
          {/*
            保存按钮**只在有未保存改动时出现**：它一出现就是「你有东西没生效」这个信号，
            比一个常驻的灰按钮更说明问题。没改动时点它也没有任何事可做。
          */}
          {dirty && (
            <button
              type="button"
              className="wt-btn wt-btn--primary"
              data-testid="settings-save"
              onClick={handleSave}
            >
              保存
            </button>
          )}
          {/* 第二个关闭入口：标题栏那个 ✕ 是给「找关闭」的眼睛用的，这个是给读完设置的人用的 */}
          <button
            type="button"
            className="wt-btn"
            data-testid="settings-close-footer"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: 写 `tests/unit/settings.test.tsx`**
```tsx
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Ribbon } from '../../src/renderer/src/components/Ribbon'
import { Toast } from '../../src/renderer/src/components/Toast'
import { InputCapture } from '../../src/renderer/src/input/InputCapture'
import { ToolbarProvider } from '../../src/renderer/src/state/ToolbarContext'
import type { InputMode } from '../../src/core/types'
import type { ThemeSource } from '../../src/renderer/src/types/global'

interface SetupOptions {
  ratio?: number
  globalRatio?: number
  mode?: InputMode
  onRatioChange?: (n: number) => void
  onGlobalRatioChange?: (n: number) => void
  /** 「当前书」那格据此禁用；不传＝当作已经打开了小说 */
  novelOpen?: boolean
  onModeChange?: (m: InputMode) => void
  onImport?: () => void
  onClearSession?: () => void
  /** 额外挂一个 InputCapture：焦点那几条用例需要它来当「被抢的对象」 */
  capture?: boolean
  docTitle?: string
  darkPaper?: boolean
  themeSource?: ThemeSource
}

function setup(opts: SetupOptions = {}): {
  onDocTitleChange: ReturnType<typeof vi.fn>
  onDarkPaperChange: ReturnType<typeof vi.fn>
  onThemeSourceChange: ReturnType<typeof vi.fn>
} {
  const onDocTitleChange = vi.fn()
  const onDarkPaperChange = vi.fn()
  const onThemeSourceChange = vi.fn()
  const {
    capture,
    docTitle = '文档1',
    darkPaper = false,
    themeSource = 'system',
    novelOpen = true,
    ...provider
  } = opts
  render(
    <ToolbarProvider {...provider}>
      <Ribbon
        docTitle={docTitle}
        onDocTitleChange={onDocTitleChange}
        darkPaper={darkPaper}
        onDarkPaperChange={onDarkPaperChange}
        themeSource={themeSource}
        onThemeSourceChange={onThemeSourceChange}
        novelOpen={novelOpen}
      />
      {capture ? <InputCapture engine={{ pump: vi.fn(), backspace: vi.fn() }} mode="key" /> : null}
      <Toast />
    </ToolbarProvider>
  )
  return { onDocTitleChange, onDarkPaperChange, onThemeSourceChange }
}

const settings = (): HTMLElement => screen.getByTestId('settings')

/**
 * 会**回写**的壳：保存之后文档名 / 比例真的变了，`Ribbon` 收到的 props 跟着变。
 *
 * 【为什么不能复用上面的 `setup`】那个壳把 `docTitle` / `ratio` 写死成固定 prop，
 * 于是提交之后「已提交值」永远不会变——草稿与它一比就永远算「有改动」，保存按钮不会消失。
 * 拿它断言「保存后按钮消失」会假红。这条只有会回写的壳测得了。
 */
function setupLive(init: { docTitle?: string; ratio?: number } = {}): {
  onDocTitleChange: ReturnType<typeof vi.fn>
  onRatioChange: ReturnType<typeof vi.fn>
} {
  const onDocTitleChange = vi.fn()
  const onRatioChange = vi.fn()
  function Harness() {
    const [title, setTitle] = useState(init.docTitle ?? '文档1')
    const [ratio, setRatio] = useState(init.ratio ?? 10)
    return (
      <ToolbarProvider
        ratio={ratio}
        onRatioChange={(n) => {
          onRatioChange(n)
          setRatio(n)
        }}
      >
        <Ribbon
          docTitle={title}
          onDocTitleChange={(v) => {
            onDocTitleChange(v)
            setTitle(v)
          }}
          darkPaper={false}
          onDarkPaperChange={vi.fn()}
          themeSource="system"
          onThemeSourceChange={vi.fn()}
          novelOpen
        />
        <Toast />
      </ToolbarProvider>
    )
  }
  render(<Harness />)
  return { onDocTitleChange, onRatioChange }
}

/** 走「文件」选项卡那个按钮——与快捷键是两条独立的路，两边都得能开 */
function openViaButton(): void {
  fireEvent.click(screen.getByTestId('tab-文件'))
  fireEvent.click(screen.getByTestId('btn-settings'))
}

describe('设置对话框的打开方式', () => {
  it('「文件」选项卡里的「设置」按钮能打开，且带模态语义', () => {
    setup()
    expect(screen.queryByTestId('settings')).toBeNull()

    openViaButton()

    expect(settings().getAttribute('role')).toBe('dialog')
    expect(settings().getAttribute('aria-modal')).toBe('true')
  })

  it('⌘/Ctrl + , 都能打开（按物理键位 Comma 判定）', () => {
    setup()
    fireEvent.keyDown(window, { key: ',', code: 'Comma', metaKey: true })
    expect(screen.getByTestId('settings')).toBeTruthy()
  })

  it('Ctrl + ,（非 mac）同样打开', () => {
    setup()
    fireEvent.keyDown(window, { key: ',', code: 'Comma', ctrlKey: true })
    expect(screen.getByTestId('settings')).toBeTruthy()
  })

  it('不带修饰键的逗号不打开（那是正文里的标点，不该被吃掉）', () => {
    setup()
    fireEvent.keyDown(window, { key: ',', code: 'Comma' })
    expect(screen.queryByTestId('settings')).toBeNull()
  })
})

describe('设置对话框的关闭方式', () => {
  it('Esc 关闭', () => {
    setup()
    openViaButton()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('settings')).toBeNull()
  })

  it('点遮罩关闭', () => {
    setup()
    openViaButton()
    // 遮罩就是对话框根元素本身：面板盖在它上面，所以要点根元素才算「点在外面」
    fireEvent.click(settings())
    expect(screen.queryByTestId('settings')).toBeNull()
  })

  it('点面板里面不关闭', () => {
    setup()
    openViaButton()
    fireEvent.click(screen.getByText('选项'))
    expect(screen.getByTestId('settings')).toBeTruthy()
  })

  it('标题栏的 ✕ 与底部的「关闭」都能关', () => {
    setup()
    openViaButton()
    fireEvent.click(screen.getByTestId('settings-close'))
    expect(screen.queryByTestId('settings')).toBeNull()

    openViaButton()
    fireEvent.click(screen.getByTestId('settings-close-footer'))
    expect(screen.queryByTestId('settings')).toBeNull()
  })
})

describe('真实功能收在对话框里', () => {
  it('五个控件的 testid 原样搬了进来，工具栏里一个都没有', () => {
    setup()
    openViaButton()
    for (const id of [
      'doc-title-input',
      'ratio-input',
      'mode-button',
      'btn-import',
      'btn-clear-session'
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy()
      // 「在原处」而不是「在别处」：五个都必须落在对话框里
      expect(settings().contains(screen.getByTestId(id))).toBe(true)
    }

    // 关掉之后它们跟着消失（说明只在对话框里存在，不是复制了一份）
    fireEvent.click(screen.getByTestId('settings-close'))
    expect(screen.queryByTestId('ratio-input')).toBeNull()
    expect(screen.queryByTestId('mode-button')).toBeNull()
    expect(screen.queryByTestId('btn-import')).toBeNull()
    expect(screen.queryByTestId('btn-clear-session')).toBeNull()
    expect(screen.queryByTestId('doc-title-input')).toBeNull()
  })

  it('比例输入回车后回调夹紧后的值（改动本身不生效，回车＝保存）', () => {
    const onRatioChange = vi.fn()
    setup({ ratio: 10, onRatioChange })
    openViaButton()
    const input = screen.getByTestId('ratio-input')
    fireEvent.change(input, { target: { value: '25' } })
    // 先有改动、出保存按钮，但**还没有**生效
    expect(screen.getByTestId('settings-save')).toBeTruthy()
    expect(onRatioChange).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRatioChange).toHaveBeenCalledWith(25)
  })

  it('比例超出上限：失焦就夹紧并提示，回车保存夹紧后的值', () => {
    const onRatioChange = vi.fn()
    setup({ ratio: 10, onRatioChange })
    openViaButton()
    const input = screen.getByTestId('ratio-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '9999' } })
    fireEvent.blur(input)
    // 失焦只归一化：框里显示夹紧后的值、给一条提示，但**还没生效**
    // （提示压在遮罩之上，见 .wt-modal 的 z-index）
    expect(input.value).toBe('500')
    expect(screen.getByTestId('toast').textContent).toContain('500')
    expect(onRatioChange).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRatioChange).toHaveBeenCalledWith(500)
  })

  it('输入模式按钮真实切换并提示', () => {
    const onModeChange = vi.fn()
    setup({ mode: 'ime', onModeChange })
    openViaButton()
    expect(screen.getByTestId('mode-button').textContent).toBe('输入法')
    fireEvent.click(screen.getByTestId('mode-button'))
    expect(onModeChange).toHaveBeenCalledWith('key')
    expect(screen.getByTestId('toast').textContent).toContain('纯按键')
  })

  it('「导入小说」按钮触发真实回调而非占位提示', () => {
    const onImport = vi.fn()
    setup({ onImport })
    openViaButton()
    fireEvent.click(screen.getByTestId('btn-import'))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('「清除阅读记录」按钮触发真实回调', () => {
    const onClearSession = vi.fn()
    setup({ onClearSession })
    openViaButton()
    fireEvent.click(screen.getByTestId('btn-clear-session'))
    expect(onClearSession).toHaveBeenCalledTimes(1)
  })
})

describe('对话框里改文档名', () => {
  it('文档名：回车＝保存，两侧空白去掉', () => {
    const { onDocTitleChange: onChange } = setup({ docTitle: '文档1' })
    openViaButton()
    const input = screen.getByTestId('doc-title-input') as HTMLInputElement
    expect(input.value).toBe('文档1')

    fireEvent.change(input, { target: { value: '  第 3 季度汇报  ' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('第 3 季度汇报')
  })

  it('失焦只归一化，不提交——生效要等「保存」', () => {
    const { onDocTitleChange: onChange } = setup({ docTitle: '文档1' })
    openViaButton()
    const input = screen.getByTestId('doc-title-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  会议纪要  ' } })
    fireEvent.blur(input)
    // 归一化只体现在框里；没有提交，但已经算「有改动」
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('会议纪要')
    expect(screen.getByTestId('settings-save')).toBeTruthy()
  })

  it('空名不提交（蓝条不能变成一片空白）', () => {
    const { onDocTitleChange: onChange } = setup({ docTitle: '文档1' })
    openViaButton()
    const input = screen.getByTestId('doc-title-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('文档1')
  })

  it('外观三选一：默认跟随系统，点「深色」回调 dark', () => {
    const { onThemeSourceChange } = setup()
    openViaButton()
    expect(screen.getByTestId('theme-system').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('theme-dark').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByTestId('theme-dark'))
    expect(onThemeSourceChange).toHaveBeenCalledWith('dark')
  })

  it('「纸张也变暗」是个复选框，勾选时回调 true', () => {
    const { onDarkPaperChange } = setup()
    openViaButton()
    const box = screen.getByTestId('dark-paper') as HTMLInputElement
    expect(box.type).toBe('checkbox')
    // 默认关：真 Word 的深色模式里纸张仍然是白的，保持这一点伪装才完整
    expect(box.checked).toBe(false)

    fireEvent.click(box)
    expect(onDarkPaperChange).toHaveBeenCalledWith(true)
  })

  it('Esc 关掉对话框不算提交：草稿丢掉，名字不变', () => {
    const { onDocTitleChange: onChange } = setup({ docTitle: '文档1' })
    openViaButton()
    fireEvent.change(screen.getByTestId('doc-title-input'), { target: { value: '不该生效' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()

    openViaButton()
    expect((screen.getByTestId('doc-title-input') as HTMLInputElement).value).toBe('文档1')
  })
})

/**
 * 「手动保存」这一组：文档名与阅读替换改了不立即生效，点保存才生效。
 *
 * 外观 / 纸张 / 输入模式刻意**不**在这一组里——它们的效果当场看得见（换个颜色、按一下就知道），
 * 要保存才生效会很别扭。所以这里也顺带守住那条边界。
 */
describe('手动保存', () => {
  it('没有改动时不出现保存按钮', () => {
    setup({ ratio: 10, docTitle: '文档1' })
    openViaButton()
    expect(screen.queryByTestId('settings-save')).toBeNull()
  })

  it('改回原值之后保存按钮消失', () => {
    setup({ docTitle: '文档1' })
    openViaButton()
    const input = screen.getByTestId('doc-title-input')
    fireEvent.change(input, { target: { value: '会议纪要' } })
    expect(screen.getByTestId('settings-save')).toBeTruthy()

    fireEvent.change(input, { target: { value: '文档1' } })
    expect(screen.queryByTestId('settings-save')).toBeNull()
  })

  it('点保存才生效，给一条提示，并且按钮随之消失', () => {
    const { onDocTitleChange: onChange } = setupLive({ docTitle: '文档1' })
    openViaButton()
    fireEvent.change(screen.getByTestId('doc-title-input'), { target: { value: '会议纪要' } })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onChange).toHaveBeenCalledWith('会议纪要')
    expect(screen.getByTestId('toast').textContent).toContain('已保存')
    // 保存之后没有未提交的改动了（这一条靠会回写的壳才测得出来，见 setupLive）
    expect(screen.queryByTestId('settings-save')).toBeNull()
  })

  it('两项各有改动时，一次保存把它们一起提交', () => {
    const { onDocTitleChange, onRatioChange } = setupLive({ docTitle: '文档1', ratio: 10 })
    openViaButton()
    fireEvent.change(screen.getByTestId('doc-title-input'), { target: { value: '会议纪要' } })
    fireEvent.change(screen.getByTestId('ratio-input'), { target: { value: '25' } })
    expect(onDocTitleChange).not.toHaveBeenCalled()
    expect(onRatioChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onDocTitleChange).toHaveBeenCalledWith('会议纪要')
    expect(onRatioChange).toHaveBeenCalledWith(25)
  })

  it('外观与纸张不在这组里：点一下就生效，不经过保存', () => {
    const { onThemeSourceChange, onDarkPaperChange } = setup({
      themeSource: 'system',
      darkPaper: false
    })
    openViaButton()
    expect(screen.queryByTestId('settings-save')).toBeNull()

    fireEvent.click(screen.getByTestId('theme-dark'))
    fireEvent.click(screen.getByTestId('dark-paper'))

    // 两项都是即时回调（不经过保存）……
    expect(onThemeSourceChange).toHaveBeenCalledWith('dark')
    expect(onDarkPaperChange).toHaveBeenCalledWith(true)
    // ……所以它们不会让「有未保存的改动」为真，保存按钮不该被它们点亮
    expect(screen.queryByTestId('settings-save')).toBeNull()
  })

  it('全局比例与当前书比例：两格各有一个输入框，都归手动保存', () => {
    const onRatioChange = vi.fn()
    const onGlobalRatioChange = vi.fn()
    setup({ ratio: 10, globalRatio: 10, onRatioChange, onGlobalRatioChange })
    openViaButton()

    expect((screen.getByTestId('global-ratio-input') as HTMLInputElement).value).toBe('10')
    expect((screen.getByTestId('ratio-input') as HTMLInputElement).value).toBe('10')

    fireEvent.change(screen.getByTestId('global-ratio-input'), { target: { value: '4' } })
    fireEvent.change(screen.getByTestId('ratio-input'), { target: { value: '7' } })
    // 改了不生效——两格都在手动保存那一组里
    expect(onGlobalRatioChange).not.toHaveBeenCalled()
    expect(onRatioChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('settings-save'))

    // 点保存之后各回各的家：全局进设置，当前书进引擎
    expect(onGlobalRatioChange).toHaveBeenCalledWith(4)
    expect(onRatioChange).toHaveBeenCalledWith(7)
  })

  it('没打开小说时「当前书」那格禁用，而全局那格照旧可用', () => {
    setup({ novelOpen: false })
    openViaButton()
    // 没有书就没有「当前书」
    expect((screen.getByTestId('ratio-input') as HTMLInputElement).disabled).toBe(true)
    // 全局那格与「有没有书」无关：它管的是以后导入的书
    expect((screen.getByTestId('global-ratio-input') as HTMLInputElement).disabled).toBe(false)
  })

  it('未保存就关掉＝丢弃，重开时从当前值起稿且按钮不亮', () => {
    const { onDocTitleChange: onChange } = setup({ docTitle: '文档1' })
    openViaButton()
    fireEvent.change(screen.getByTestId('doc-title-input'), { target: { value: '不该生效' } })
    expect(screen.getByTestId('settings-save')).toBeTruthy()

    fireEvent.click(screen.getByTestId('settings-close-footer'))
    expect(onChange).not.toHaveBeenCalled()

    openViaButton()
    expect((screen.getByTestId('doc-title-input') as HTMLInputElement).value).toBe('文档1')
    expect(screen.queryByTestId('settings-save')).toBeNull()
  })
})

/**
 * 模态与「点哪儿都能继续打字」的冲突。
 *
 * 【这些用例守到哪一层，说清楚】它们守的是 InputCapture 里那两条闸的**机制**（点击目标
 * 在对话框里 / 焦点已经在对话框里 → 不抢）。「抢回去之后用户的字真的会抽进小说」这个
 * **后果**在 jsdom 里求证不了：jsdom 没有命中测试，也没有「点不可聚焦元素 → 焦点交给
 * body」这条浏览器行为（下面第二条用例是手工把它摆出来的）。那条只能由
 * tests/e2e/app.spec.ts 里驱动真实 Electron 的用例判。
 */
describe('对话框开着时，键盘焦点不会被抢回阅读区', () => {
  it('打开时焦点就落在对话框里（autoFocus），不在隐形输入框上', () => {
    setup({ capture: true })
    const capture = screen.getByTestId('input-capture')
    // 前提自检：InputCapture 挂载时真的抢了焦点。少了这行，下面那个断言在「它压根没抢过」
    // 的世界里也照样绿。
    expect(document.activeElement).toBe(capture)

    openViaButton()
    expect(document.activeElement).toBe(screen.getByTestId('doc-title-input'))
  })

  it('点对话框里不可聚焦的空白处，焦点不会被抢走', () => {
    setup({ capture: true })
    openViaButton()
    const capture = screen.getByTestId('input-capture')
    const input = screen.getByTestId('doc-title-input')
    // 浏览器里点不可聚焦的空白处会把焦点交给 body（jsdom 不会，这里手工摆出来）。
    // 这正是「点击目标」那条闸要拦的形态：target 在对话框里、而焦点已经不在。
    input.blur()
    expect(document.activeElement).not.toBe(capture)

    const panel = settings().querySelector('.wt-modal__panel') as HTMLElement
    fireEvent.mouseDown(panel)
    fireEvent.click(panel)

    expect(document.activeElement).not.toBe(capture)
  })

  it('对话框开着、焦点在对话框里时，点对话框【外】的东西也不抢焦点', () => {
    // 这条守的是**第二条**闸（`document.activeElement` 在对话框里 → 不抢）。
    //
    // 它对应的真实时序是「用『设置』按钮打开对话框」那一下：本监听挂在 window 上，而
    // React 的事件层挂在容器（#root）上——容器在 window 的【里面】，所以真机上冒泡到
    // window 时 React 的 onClick 已经跑完：对话框挂载、autoFocus 已经把焦点送进文档名
    // 输入框，而 `e.target` 仍是工具栏上那个按钮（不在对话框里）。少了第二条闸，正好在
    // 这一下把焦点抢回隐藏 textarea。
    //
    // 【为什么不直接断言「点一次按钮就够了」】jsdom 侧 testing-library 把 React 的 flush
    // 推到 act 结束，也就是整个事件派发（含 window 上那个监听）之后——于是那一下派发时
    // 对话框还没挂载、焦点还没进对话框，两条闸都拦不住也都不需要拦，**用例在两条闸都在
    // 和都不在的世界里一样绿**（实测：把第二条闸删掉，41 条用例全过）。所以这里按真机的
    // 形态把状态摆出来：对话框已开、焦点已在里面，再派发一次「点击」——此时 window 上那个
    // 监听看到的与真机上完全一致。
    setup({ capture: true })
    openViaButton()
    const titleInput = screen.getByTestId('doc-title-input')
    expect(document.activeElement).toBe(titleInput)

    const settingsButton = screen.getByTestId('btn-settings')
    fireEvent.mouseDown(settingsButton)
    fireEvent.click(settingsButton)

    expect(document.activeElement).toBe(titleInput)
  })

  it('关掉对话框后，焦点交还给隐形输入框（否则用户不打字就再也敲不进正文）', () => {
    setup({ capture: true })
    const capture = screen.getByTestId('input-capture')
    openViaButton()
    expect(document.activeElement).not.toBe(capture)

    fireEvent.click(screen.getByTestId('settings-close'))

    expect(screen.queryByTestId('settings')).toBeNull()
    expect(document.activeElement).toBe(capture)
  })
})
```

**Step 3: 就地更新的围栏**（本任务改了这些文件，围栏已在**原处**替换成当前内容；本节的表只是
索引，不是第二份副本）：

| 文件 | 围栏位置 |
|---|---|
| `src/renderer/src/styles/ribbon.css` | Task 7 Step 2 |
| `src/renderer/src/components/Toolbar.tsx` | Task 8 Step 3 |
| `src/renderer/src/components/Ribbon.tsx` | Task 8 Step 4 |
| `tests/unit/ribbon.test.tsx` | Task 8 Step 5 |
| `src/renderer/src/components/ChapterList.tsx` | Task 9 Step 1 |
| `tests/unit/chapterList.test.tsx` | Task 9 Step 2 |
| `src/renderer/src/components/Page.tsx` | Task 10 Step 1 |
| `src/renderer/src/input/InputCapture.tsx` | Task 11 Step 3 |
| `tests/unit/app.test.tsx` | Task 12 Step 4 |
| `tests/e2e/app.spec.ts` | Task 13 Step 2 |

`tests/unit/ribbon.test.tsx` 里那 4 条「点文档名就地改名」的用例整体搬进了
`tests/unit/settings.test.tsx`（判据一字未改），原处换成一条「点它不再变成输入框」；
比例/模式/导入/清除那几条同样搬了过去，前面统一加一步「打开设置」。

**Step 4: 跑门禁**

Run: `pnpm test && pnpm typecheck && pnpm build && pnpm test:e2e`
Expected: 四个命令全部 exit 0。

**Step 5: 真机看一眼**

`pnpm build` 之后用 Playwright `_electron` 起一次真的（给一个 mkdtemp 出来的空 `WT_USER_DATA`），
导入 `books/诡秘之主（整理版）.txt`，按 ⌘/Ctrl + , 打开对话框，截图确认三件事：设置能打开、
「开始」选项卡下没有「阅读替换」那一组、蓝条上是 `文档1` 而不是小说名。

**Step 6: Commit**

```bash
git add src/renderer/src/components/SettingsDialog.tsx src/renderer/src/components/Ribbon.tsx src/renderer/src/components/Toolbar.tsx src/renderer/src/components/ChapterList.tsx src/renderer/src/components/Page.tsx src/renderer/src/input/InputCapture.tsx src/renderer/src/styles/ribbon.css tests/unit/settings.test.tsx tests/unit/ribbon.test.tsx tests/unit/app.test.tsx tests/unit/chapterList.test.tsx tests/e2e/app.spec.ts docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md
cat > /tmp/wt-commit-msg.txt <<'EOF'
feat(renderer): 真实功能收进设置对话框（⌘/Ctrl + , 或「文件 → 设置」）
EOF
git commit -F /tmp/wt-commit-msg.txt   # 不要用内联 -m：ASCII 引号会静默截断信息
```

---

## 自查记录

**Spec 覆盖检查**（逐节对照 spec）：

| Spec 章节 | 落实任务 |
|---|---|
| §2 核心数据模型（Chapter/Novel/EngineState、状态迁移、边界） | Task 2（types）+ Task 4（engine） |
| §3 架构与 IPC 契约 | Task 1（脚手架）+ Task 6（IPC/preload/菜单） |
| §4 输入模型（双模式、光标、输入法兼容） | Task 11（InputCapture） |
| §5.1 Ribbon 七选项卡 + 导入按钮 | Task 8 |
| §5.2 工具栏按钮全部可点击有反馈 | Task 8（含「每个按钮可点且可见反馈」用例） |
| §5.3 章节列表（虚拟滚动 + 跳转 + 百分比） | Task 9 |
| §5.4 白色页面 + 折叠护栏 | Task 10（Page） |
| §5.5 状态栏 | Task 10（StatusBar） |
| §6 编码检测（BOM / 严格 UTF-8 / jschardet 打分） | Task 2（decode） |
| §7 章节切分（正则 + 前言 + 连续性） | Task 3（chapters） |
| §8 持久化（session.json + cache 拆分 + 恢复 + 清除） | Task 5（sessionStore）+ Task 6（绑定）+ Task 12（接线） |
| §9 打包（dmg / nsis / GH Actions） | Task 14 |
| §10 测试策略（单测 + IME + E2E） | Task 2-5、11、12、13 |
| §11 技术栈与锁定版本 | Task 1 Step 1-2 |

**类型一致性检查**：`Chapter` / `Novel` / `PersistedSession` / `EngineState` / `InputMode` 在 Task 2 定义后，Task 3-14 全部沿用同一套字段名；`pump` / `backspace` / `jumpToChapter` / `setRatio` / `setMode` / `getSnapshot` / `visibleText` / `toSession` / `fromSession` 在 Task 4 定义后未被改名。`CH` 通道名在 Task 6 集中定义并先由 `ipcContract.test.ts` 锁住。

**已知设计取舍**（执行时不要「顺手优化」掉）：
- 单一 tsconfig 拆两份（web / node）而非 project references —— 避免 `composite` + `tsc -b` 的配置坑。
- 单一 vitest jsdom 环境而非 projects —— core 测试在 jsdom 下照常运行。
- `CH` 常量必须放在不 import electron 的 `channels.ts`，否则 sandboxed preload 会崩。Task 6 Step 7 专门处理了这一点。


---

## Task 17: 界面现代化（Fluent 观感 + 微软官方图标）

**背景**：用户反馈「太丑了、像几十年前的 UI」。方向定为**靠向今天真实的 Word**（M365 / Fluent 2 观感），
而不是通用的现代 SaaS 风——这个应用的前提就是看起来像 Word，换成通用风格等于自毁伪装。

**做法**：
- 新增依赖 `@fluentui/react-icons@2.0.344`（MIT），就是 Office / Microsoft 365 在用的那一套。
  图标名**必须带 `Regular` / `Filled` 后缀**，且用 `bundleIcon(Filled, Regular)` 包一层——
  这正是 Word 切换按钮的语义：未按下线框、按下实心。

**本文件**（`src/renderer/src/components/icons.tsx`）：

```tsx
import { bundleIcon } from '@fluentui/react-icons'
import {
  TextBoldFilled,
  TextBoldRegular,
  TextItalicFilled,
  TextItalicRegular,
  TextUnderlineFilled,
  TextUnderlineRegular,
  TextStrikethroughFilled,
  TextStrikethroughRegular,
  TextFontFilled,
  TextFontRegular,
  TextFontSizeFilled,
  TextFontSizeRegular,
  ClipboardBrushFilled,
  ClipboardBrushRegular,
  TextBulletListFilled,
  TextBulletListRegular,
  TextNumberListLtrFilled,
  TextNumberListLtrRegular,
  TextAlignLeftFilled,
  TextAlignLeftRegular,
  TextAlignCenterFilled,
  TextAlignCenterRegular,
  TextAlignRightFilled,
  TextAlignRightRegular,
  TextAlignJustifyFilled,
  TextAlignJustifyRegular,
  TextLineSpacingFilled,
  TextLineSpacingRegular,
  TextParagraphFilled,
  TextParagraphRegular,
  SearchFilled,
  SearchRegular,
  ArrowUndoFilled,
  ArrowUndoRegular,
  ArrowRedoFilled,
  ArrowRedoRegular,
  DocumentAddFilled,
  DocumentAddRegular,
  SaveFilled,
  SaveRegular,
  DocumentArrowDownFilled,
  DocumentArrowDownRegular,
  PrintFilled,
  PrintRegular,
  FolderOpenFilled,
  FolderOpenRegular,
  SettingsFilled,
  SettingsRegular,
  DeleteFilled,
  DeleteRegular,
  TableFilled,
  TableRegular,
  ImageFilled,
  ImageRegular,
  ShapesFilled,
  ShapesRegular,
  DocumentPageBreakFilled,
  DocumentPageBreakRegular,
  DocumentMarginsFilled,
  DocumentMarginsRegular,
  ResizeLargeFilled,
  ResizeLargeRegular,
  LayoutColumnTwoFilled,
  LayoutColumnTwoRegular,
  BookOpenFilled,
  BookOpenRegular,
  CommentFilled,
  CommentRegular,
  TextGrammarCheckmarkFilled,
  TextGrammarCheckmarkRegular,
  TextFootnoteFilled,
  TextFootnoteRegular,
  TextWordCountFilled,
  TextWordCountRegular,
  ReadingModeMobileFilled,
  ReadingModeMobileRegular,
  RulerFilled,
  RulerRegular,
  GridFilled,
  GridRegular,
  ChevronLeftFilled,
  ChevronLeftRegular,
  ChevronRightFilled,
  ChevronRightRegular,
  ChevronDownFilled,
  ChevronDownRegular,
  DismissFilled,
  DismissRegular,
  RenameRegular,
  RenameFilled,
  KeyboardRegular,
  KeyboardFilled,
  DarkThemeRegular,
  DarkThemeFilled,
  DocumentRegular,
  DocumentFilled,
  BookRegular,
  BookFilled,
  DesktopRegular,
  DesktopFilled,
  WeatherSunnyRegular,
  WeatherSunnyFilled,
  WeatherMoonRegular,
  WeatherMoonFilled,
  ClipboardPasteFilled,
  ClipboardPasteRegular,
  CutFilled,
  CutRegular,
  CopyFilled,
  CopyRegular,
  FontIncreaseFilled,
  FontIncreaseRegular,
  FontDecreaseFilled,
  FontDecreaseRegular,
  TextClearFormattingFilled,
  TextClearFormattingRegular,
  TextSubscriptFilled,
  TextSubscriptRegular,
  TextSuperscriptFilled,
  TextSuperscriptRegular,
  TextEffectsFilled,
  TextEffectsRegular,
  HighlightFilled,
  HighlightRegular,
  TextColorFilled,
  TextColorRegular,
  TextListAbcUppercaseLtrFilled,
  TextListAbcUppercaseLtrRegular,
  TextIndentDecreaseFilled,
  TextIndentDecreaseRegular,
  TextIndentIncreaseFilled,
  TextIndentIncreaseRegular,
  ArrowSortFilled,
  ArrowSortRegular,
  TextGrammarWandFilled,
  TextGrammarWandRegular,
  PaintBucketFilled,
  PaintBucketRegular,
  BorderAllFilled,
  BorderAllRegular,
  ArrowSwapFilled,
  ArrowSwapRegular,
  CursorFilled,
  CursorRegular,
  LinkFilled,
  LinkRegular,
  BookmarkFilled,
  BookmarkRegular,
  BookmarkMultipleFilled,
  BookmarkMultipleRegular,
  EmojiFilled,
  EmojiRegular,
  CubeFilled,
  CubeRegular,
  ChartMultipleFilled,
  ChartMultipleRegular,
  FlowchartFilled,
  FlowchartRegular,
  ScreenshotFilled,
  ScreenshotRegular,
  PuzzlePieceFilled,
  PuzzlePieceRegular,
  VideoFilled,
  VideoRegular,
  MusicNote2Filled,
  MusicNote2Regular,
  DocumentOnePageFilled,
  DocumentOnePageRegular,
  DocumentOnePageAddFilled,
  DocumentOnePageAddRegular,
  DocumentHeaderFilled,
  DocumentHeaderRegular,
  DocumentFooterFilled,
  DocumentFooterRegular,
  DocumentPageNumberFilled,
  DocumentPageNumberRegular,
  TextboxFilled,
  TextboxRegular,
  DropFilled,
  DropRegular,
  SignatureFilled,
  SignatureRegular,
  CalendarFilled,
  CalendarRegular,
  SelectObjectFilled,
  SelectObjectRegular,
  MathFormulaFilled,
  MathFormulaRegular,
  SymbolsFilled,
  SymbolsRegular,
  ResizeFilled,
  ResizeRegular,
  NumberSymbolSquareFilled,
  NumberSymbolSquareRegular,
  AlignStraightenFilled,
  AlignStraightenRegular,
  GroupFilled,
  GroupRegular,
  ArrowRotateClockwiseFilled,
  ArrowRotateClockwiseRegular,
  PositionToFrontFilled,
  PositionToFrontRegular,
  PositionToBackFilled,
  PositionToBackRegular,
  TextPositionSquareFilled,
  TextPositionSquareRegular,
  PanelLeftFilled,
  PanelLeftRegular,
  PaddingTopFilled,
  PaddingTopRegular,
  PaddingDownFilled,
  PaddingDownRegular,
  TextWrapFilled,
  TextWrapRegular,
  SaveCopyFilled,
  SaveCopyRegular,
  SendFilled,
  SendRegular,
  TextProofingToolsFilled,
  TextProofingToolsRegular,
  TextAddFilled,
  TextAddRegular,
  ArrowClockwiseFilled,
  ArrowClockwiseRegular,
  DocumentEndnoteFilled,
  DocumentEndnoteRegular,
  TextQuoteFilled,
  TextQuoteRegular,
  DatabaseFilled,
  DatabaseRegular,
  LibraryFilled,
  LibraryRegular,
  ClosedCaptionFilled,
  ClosedCaptionRegular,
  TableSimpleFilled,
  TableSimpleRegular,
  TagFilled,
  TagRegular,
  DocumentTextFilled,
  DocumentTextRegular,
  ArrowNextFilled,
  ArrowNextRegular,
  ArrowPreviousFilled,
  ArrowPreviousRegular,
  BookQuestionMarkFilled,
  BookQuestionMarkRegular,
  AccessibilityFilled,
  AccessibilityRegular,
  TranslateFilled,
  TranslateRegular,
  LocalLanguageFilled,
  LocalLanguageRegular,
  CommentDismissFilled,
  CommentDismissRegular,
  CommentMultipleFilled,
  CommentMultipleRegular,
  DocumentEditFilled,
  DocumentEditRegular,
  PanelRightFilled,
  PanelRightRegular,
  CheckmarkCircleFilled,
  CheckmarkCircleRegular,
  DismissCircleFilled,
  DismissCircleRegular,
  ItemCompareFilled,
  ItemCompareRegular,
  MergeFilled,
  MergeRegular,
  LockClosedFilled,
  LockClosedRegular,
  DocumentGlobeFilled,
  DocumentGlobeRegular,
  DocumentBulletListFilled,
  DocumentBulletListRegular,
  DraftsFilled,
  DraftsRegular,
  DocumentOnePageMultipleFilled,
  DocumentOnePageMultipleRegular,
  ArrowAutofitWidthFilled,
  ArrowAutofitWidthRegular,
  ZoomInFilled,
  ZoomInRegular,
  WindowNewFilled,
  WindowNewRegular,
  BoardSplitFilled,
  BoardSplitRegular,
  DualScreenFilled,
  DualScreenRegular,
  ArrowSyncFilled,
  ArrowSyncRegular,
  WindowMultipleFilled,
  WindowMultipleRegular,
  CodeFilled,
  CodeRegular
} from '@fluentui/react-icons'

/**
 * 图标集用的是**微软官方那一套**（`@fluentui/react-icons`，MIT）——就是 Office / Microsoft 365
 * 自己用的，所以「像 Word」和「现代」这两件事在这里不冲突。
 *
 * 【为什么每个都用 `bundleIcon(Filled, Regular)` 包一层】
 * 这正是 Word 切换按钮的语义：**未按下画线框版，按下画实心版**（加粗、斜体、对齐那一排都是）。
 * 直接用单个变体的话，按下去只能靠换背景色表达，观感就差一截。
 * `bundleIcon` 返回的组件吃一个 `filled?: boolean`，其余 SVG 属性照传。
 *
 * 【图标名是怎么定的】不要凭记忆写。这个包导出几千个名字、且**必须带 `Regular` / `Filled` 后缀**
 * （`TextBold` 不存在，只有 `TextBoldRegular` / `TextBoldFilled`）。下面每个名字都是从包里
 * 实际枚举出来核对过的；其中 `TextLineSpacing`、`TextGrammarCheckmark`、`DocumentMargins`（复数）
 * 这几个是查出来的而非想当然。要换图标请同样先枚举。
 */
export const IconBold = bundleIcon(TextBoldFilled, TextBoldRegular)
export const IconItalic = bundleIcon(TextItalicFilled, TextItalicRegular)
export const IconUnderline = bundleIcon(TextUnderlineFilled, TextUnderlineRegular)
export const IconStrike = bundleIcon(TextStrikethroughFilled, TextStrikethroughRegular)
export const IconFont = bundleIcon(TextFontFilled, TextFontRegular)
export const IconFontSize = bundleIcon(TextFontSizeFilled, TextFontSizeRegular)
export const IconFormatPainter = bundleIcon(ClipboardBrushFilled, ClipboardBrushRegular)
export const IconBullets = bundleIcon(TextBulletListFilled, TextBulletListRegular)
export const IconNumbering = bundleIcon(TextNumberListLtrFilled, TextNumberListLtrRegular)
export const IconAlignLeft = bundleIcon(TextAlignLeftFilled, TextAlignLeftRegular)
export const IconAlignCenter = bundleIcon(TextAlignCenterFilled, TextAlignCenterRegular)
export const IconAlignRight = bundleIcon(TextAlignRightFilled, TextAlignRightRegular)
export const IconAlignJustify = bundleIcon(TextAlignJustifyFilled, TextAlignJustifyRegular)
export const IconLineSpacing = bundleIcon(TextLineSpacingFilled, TextLineSpacingRegular)
export const IconParagraph = bundleIcon(TextParagraphFilled, TextParagraphRegular)
export const IconSearch = bundleIcon(SearchFilled, SearchRegular)
export const IconUndo = bundleIcon(ArrowUndoFilled, ArrowUndoRegular)
export const IconRedo = bundleIcon(ArrowRedoFilled, ArrowRedoRegular)
export const IconNew = bundleIcon(DocumentAddFilled, DocumentAddRegular)
export const IconSave = bundleIcon(SaveFilled, SaveRegular)
export const IconExport = bundleIcon(DocumentArrowDownFilled, DocumentArrowDownRegular)
export const IconPrint = bundleIcon(PrintFilled, PrintRegular)
export const IconImport = bundleIcon(FolderOpenFilled, FolderOpenRegular)
export const IconSettings = bundleIcon(SettingsFilled, SettingsRegular)
export const IconClear = bundleIcon(DeleteFilled, DeleteRegular)
export const IconTable = bundleIcon(TableFilled, TableRegular)
export const IconPicture = bundleIcon(ImageFilled, ImageRegular)
export const IconShape = bundleIcon(ShapesFilled, ShapesRegular)
export const IconPageBreak = bundleIcon(DocumentPageBreakFilled, DocumentPageBreakRegular)
export const IconMargins = bundleIcon(DocumentMarginsFilled, DocumentMarginsRegular)
export const IconOrientation = bundleIcon(ResizeLargeFilled, ResizeLargeRegular)
export const IconColumns = bundleIcon(LayoutColumnTwoFilled, LayoutColumnTwoRegular)
export const IconToc = bundleIcon(BookOpenFilled, BookOpenRegular)
export const IconComment = bundleIcon(CommentFilled, CommentRegular)
export const IconSpellCheck = bundleIcon(TextGrammarCheckmarkFilled, TextGrammarCheckmarkRegular)
export const IconFootnote = bundleIcon(TextFootnoteFilled, TextFootnoteRegular)
export const IconWordCount = bundleIcon(TextWordCountFilled, TextWordCountRegular)
export const IconReadingView = bundleIcon(ReadingModeMobileFilled, ReadingModeMobileRegular)
export const IconRuler = bundleIcon(RulerFilled, RulerRegular)
export const IconGrid = bundleIcon(GridFilled, GridRegular)
export const IconCollapse = bundleIcon(ChevronLeftFilled, ChevronLeftRegular)
export const IconExpand = bundleIcon(ChevronRightFilled, ChevronRightRegular)

/* 下拉框与分割按钮右侧那个小箭头。用 Chevron（细）而不是 Caret/Triangle（实心块）：
   真 Word 功能区里那两种箭头都是细线，实心三角看起来像十几年前的控件。 */
export const IconCaretDown = bundleIcon(ChevronDownFilled, ChevronDownRegular)
export const IconClose = bundleIcon(DismissFilled, DismissRegular)

/* 「开始」页补密度用到的一组（剪贴板 / 字体 / 段落 / 编辑）。
   名字同样是从包里枚举核对过的，不是想当然——`TextColor` 这类看着该有的名字确实有，
   而 `FontColor`、`Shading`、`MultilevelList` 这些看着更顺的名字反而没有。 */
export const IconPaste = bundleIcon(ClipboardPasteFilled, ClipboardPasteRegular)
export const IconCut = bundleIcon(CutFilled, CutRegular)
export const IconCopy = bundleIcon(CopyFilled, CopyRegular)
export const IconFontGrow = bundleIcon(FontIncreaseFilled, FontIncreaseRegular)
export const IconFontShrink = bundleIcon(FontDecreaseFilled, FontDecreaseRegular)
export const IconClearFormat = bundleIcon(TextClearFormattingFilled, TextClearFormattingRegular)
export const IconSubscript = bundleIcon(TextSubscriptFilled, TextSubscriptRegular)
export const IconSuperscript = bundleIcon(TextSuperscriptFilled, TextSuperscriptRegular)
export const IconTextEffects = bundleIcon(TextEffectsFilled, TextEffectsRegular)
export const IconHighlight = bundleIcon(HighlightFilled, HighlightRegular)
export const IconFontColor = bundleIcon(TextColorFilled, TextColorRegular)
export const IconMultiLevelList = bundleIcon(
  TextListAbcUppercaseLtrFilled,
  TextListAbcUppercaseLtrRegular
)
export const IconIndentDecrease = bundleIcon(TextIndentDecreaseFilled, TextIndentDecreaseRegular)
export const IconIndentIncrease = bundleIcon(TextIndentIncreaseFilled, TextIndentIncreaseRegular)
export const IconSort = bundleIcon(ArrowSortFilled, ArrowSortRegular)
export const IconShowMarks = bundleIcon(TextGrammarWandFilled, TextGrammarWandRegular)
export const IconShading = bundleIcon(PaintBucketFilled, PaintBucketRegular)
export const IconBorders = bundleIcon(BorderAllFilled, BorderAllRegular)
export const IconReplace = bundleIcon(ArrowSwapFilled, ArrowSwapRegular)
export const IconSelect = bundleIcon(CursorFilled, CursorRegular)

/* 「插入」页用到的一组。
   名字同样逐个枚举核对过。几个换过名的：查不到 `CoverPage`，封面用的是 `DocumentOnePage`；
   查不到 `BlankPage`，空白页用 `DocumentOnePageAdd`；查不到 `Object`，对象用 `SelectObject`。 */
export const IconCoverPage = bundleIcon(DocumentOnePageFilled, DocumentOnePageRegular)
export const IconBlankPage = bundleIcon(DocumentOnePageAddFilled, DocumentOnePageAddRegular)
export const IconIcons = bundleIcon(EmojiFilled, EmojiRegular)
export const Icon3DModel = bundleIcon(CubeFilled, CubeRegular)
export const IconChart = bundleIcon(ChartMultipleFilled, ChartMultipleRegular)
export const IconSmartArt = bundleIcon(FlowchartFilled, FlowchartRegular)
export const IconScreenshot = bundleIcon(ScreenshotFilled, ScreenshotRegular)
export const IconAddin = bundleIcon(PuzzlePieceFilled, PuzzlePieceRegular)
export const IconVideo = bundleIcon(VideoFilled, VideoRegular)
export const IconAudio = bundleIcon(MusicNote2Filled, MusicNote2Regular)
export const IconHyperlink = bundleIcon(LinkFilled, LinkRegular)
export const IconBookmark = bundleIcon(BookmarkFilled, BookmarkRegular)
export const IconCrossRef = bundleIcon(BookmarkMultipleFilled, BookmarkMultipleRegular)
export const IconHeader = bundleIcon(DocumentHeaderFilled, DocumentHeaderRegular)
export const IconFooter = bundleIcon(DocumentFooterFilled, DocumentFooterRegular)
export const IconPageNumber = bundleIcon(DocumentPageNumberFilled, DocumentPageNumberRegular)
export const IconTextbox = bundleIcon(TextboxFilled, TextboxRegular)
export const IconDropCap = bundleIcon(DropFilled, DropRegular)
export const IconSignature = bundleIcon(SignatureFilled, SignatureRegular)
export const IconDateTime = bundleIcon(CalendarFilled, CalendarRegular)
export const IconObject = bundleIcon(SelectObjectFilled, SelectObjectRegular)
export const IconFormula = bundleIcon(MathFormulaFilled, MathFormulaRegular)
export const IconSymbols = bundleIcon(SymbolsFilled, SymbolsRegular)

/* 「布局」页用到的一组。 */
export const IconPaperSize = bundleIcon(ResizeFilled, ResizeRegular)
export const IconLineNumbers = bundleIcon(NumberSymbolSquareFilled, NumberSymbolSquareRegular)
export const IconHyphenation = bundleIcon(TextProofingToolsFilled, TextProofingToolsRegular)
export const IconSpaceBefore = bundleIcon(PaddingTopFilled, PaddingTopRegular)
export const IconSpaceAfter = bundleIcon(PaddingDownFilled, PaddingDownRegular)
export const IconPosition = bundleIcon(TextPositionSquareFilled, TextPositionSquareRegular)
export const IconWrapText = bundleIcon(TextWrapFilled, TextWrapRegular)
export const IconBringForward = bundleIcon(PositionToFrontFilled, PositionToFrontRegular)
export const IconSendBackward = bundleIcon(PositionToBackFilled, PositionToBackRegular)
export const IconSelectionPane = bundleIcon(PanelLeftFilled, PanelLeftRegular)
export const IconAlignObjects = bundleIcon(AlignStraightenFilled, AlignStraightenRegular)
export const IconGroupObjects = bundleIcon(GroupFilled, GroupRegular)
export const IconRotate = bundleIcon(ArrowRotateClockwiseFilled, ArrowRotateClockwiseRegular)

/* 「文件」页补充的几个。 */
export const IconSaveAs = bundleIcon(SaveCopyFilled, SaveCopyRegular)
export const IconShare = bundleIcon(SendFilled, SendRegular)

/* 「引用」页用到的一组。查不到 `Endnote`（尾注用 `DocumentEndnote`）、
   查不到 `Index`（插入索引用 `DocumentText`）。 */
export const IconAddText = bundleIcon(TextAddFilled, TextAddRegular)
export const IconUpdateField = bundleIcon(ArrowClockwiseFilled, ArrowClockwiseRegular)
export const IconEndnote = bundleIcon(DocumentEndnoteFilled, DocumentEndnoteRegular)
export const IconCitation = bundleIcon(TextQuoteFilled, TextQuoteRegular)
export const IconSources = bundleIcon(DatabaseFilled, DatabaseRegular)
export const IconBibliography = bundleIcon(LibraryFilled, LibraryRegular)
export const IconCaption = bundleIcon(ClosedCaptionFilled, ClosedCaptionRegular)
export const IconUpdateTable = bundleIcon(TableSimpleFilled, TableSimpleRegular)
export const IconMarkEntry = bundleIcon(TagFilled, TagRegular)
export const IconInsertIndex = bundleIcon(DocumentTextFilled, DocumentTextRegular)

/* 「审阅」页用到的一组。查不到 `CommentDelete` / `CommentPrevious` / `CommentNext`
   / `DocumentCompare`，分别用 `CommentDismiss` / `ArrowPrevious` / `ArrowNext`
   / `ItemCompare` 顶上。 */
export const IconThesaurus = bundleIcon(BookQuestionMarkFilled, BookQuestionMarkRegular)
export const IconAccessibility = bundleIcon(AccessibilityFilled, AccessibilityRegular)
export const IconTranslate = bundleIcon(TranslateFilled, TranslateRegular)
export const IconLanguage = bundleIcon(LocalLanguageFilled, LocalLanguageRegular)
export const IconDeleteComment = bundleIcon(CommentDismissFilled, CommentDismissRegular)
export const IconShowComments = bundleIcon(CommentMultipleFilled, CommentMultipleRegular)
export const IconTrackChanges = bundleIcon(DocumentEditFilled, DocumentEditRegular)
export const IconReviewPane = bundleIcon(PanelRightFilled, PanelRightRegular)
export const IconAccept = bundleIcon(CheckmarkCircleFilled, CheckmarkCircleRegular)
export const IconReject = bundleIcon(DismissCircleFilled, DismissCircleRegular)
export const IconCompare = bundleIcon(ItemCompareFilled, ItemCompareRegular)
export const IconMergeDocs = bundleIcon(MergeFilled, MergeRegular)
export const IconRestrictEditing = bundleIcon(LockClosedFilled, LockClosedRegular)
export const IconPrevItem = bundleIcon(ArrowPreviousFilled, ArrowPreviousRegular)
export const IconNextItem = bundleIcon(ArrowNextFilled, ArrowNextRegular)

/* 「视图」页用到的一组。
   `IconPageView` 与 `IconCoverPage` 用的是同一个字形（`DocumentOnePage`）：
   真 Word 里「页面视图」与「单页」本来就是同一个意思，这里照搬，不硬造区别。
   两处都用到它，所以导出两个名字。 */
export const IconPageView = bundleIcon(DocumentOnePageFilled, DocumentOnePageRegular)
export const IconWebLayout = bundleIcon(DocumentGlobeFilled, DocumentGlobeRegular)
export const IconOutlineView = bundleIcon(DocumentBulletListFilled, DocumentBulletListRegular)
export const IconDraftView = bundleIcon(DraftsFilled, DraftsRegular)
export const IconMultiPage = bundleIcon(
  DocumentOnePageMultipleFilled,
  DocumentOnePageMultipleRegular
)
export const IconPageWidth = bundleIcon(ArrowAutofitWidthFilled, ArrowAutofitWidthRegular)
export const IconZoom = bundleIcon(ZoomInFilled, ZoomInRegular)
export const IconNewWindow = bundleIcon(WindowNewFilled, WindowNewRegular)
export const IconSplitWindow = bundleIcon(BoardSplitFilled, BoardSplitRegular)
export const IconSideBySide = bundleIcon(DualScreenFilled, DualScreenRegular)
export const IconSyncScroll = bundleIcon(ArrowSyncFilled, ArrowSyncRegular)
export const IconSwitchWindow = bundleIcon(WindowMultipleFilled, WindowMultipleRegular)
export const IconMacro = bundleIcon(CodeFilled, CodeRegular)

/* 设置对话框用的一组 */
export const IconRename = bundleIcon(RenameFilled, RenameRegular)
export const IconKeyboard = bundleIcon(KeyboardFilled, KeyboardRegular)
export const IconDarkTheme = bundleIcon(DarkThemeFilled, DarkThemeRegular)
export const IconDocument = bundleIcon(DocumentFilled, DocumentRegular)
export const IconBook = bundleIcon(BookFilled, BookRegular)
export const IconDesktop = bundleIcon(DesktopFilled, DesktopRegular)
export const IconSun = bundleIcon(WeatherSunnyFilled, WeatherSunnyRegular)
export const IconMoon = bundleIcon(WeatherMoonFilled, WeatherMoonRegular)
```

**同批改动的文件**（围栏均已就地同步）：`word.css`（设计 token 全换：Word 蓝 `#2b579a` → `#185abd`、
画布 `#9e9e9e` → `#e9e9ec`、新增圆角与投影 token）、`ribbon.css`（标题条 32px / 标签条压深 /
功能区 92px / 大按钮与纯图标按钮两种尺寸 / 设置对话框圆角与投影）、`page.css`（纸张投影走 token、
章节项选中改为左侧竖条）、`Toolbar.tsx`（`icon` 与 `large` 两个新字段、`--icon-only`）、
`Ribbon.tsx`（数据表补图标）、`ChapterList.tsx`（两个三角换成 Fluent 箭头）。

**CSS 类名契约同步为 51 个**（新增 `.wt-btn__icon` `.wt-btn__label` `.wt-btn--icon-only` `.wt-btn--large`
`.wt-sidebar__rail-icon` `.wt-sidebar__toggle-icon` 与一组 `.wt-modal__*`；删掉已无人使用的 `.wt-btn--icon`）。


---

## Task 18: 深色外观

**背景**：用户发现 macOS 红绿灯那块是黑的（原生标题栏跟随系统），而网页内容永远是浅色。

**根因（实测，不是推测）**：Electron 的渲染层**读不到系统外观**——
`nativeTheme.shouldUseDarkColors` 在主进程里是 true，但渲染层的
`matchMedia('(prefers-color-scheme: dark)')` **恒为 false**；把 `themeSource` 手动设成 `'dark'`
、甚至**整窗重载**之后仍然是 false。所以 `@media (prefers-color-scheme: dark)` 在本应用里
**永远不会命中**，纯 CSS 方案不成立，主题只能由主进程经 IPC 递过来。
**别把它"简化"回媒体查询**——preload 与 state/theme.ts 两处都写了这条实测。

**做法**：主进程 `nativeTheme` → IPC（`wt:get-theme` / `wt:theme-changed`）→
渲染层写 `<html data-theme="dark">`，CSS 按属性选择器取。窗口自身的 `backgroundColor` 也跟着走
（否则启动会闪一块白）。

**纸张默认仍是白的**：真 Word 的深色模式里纸张保持白色，保持这一点伪装才完整。
设置对话框里有一个「纸张也变暗」的复选框，勾上后写 `<html data-paper="dark">`，
阅读区才跟着暗——那是为了夜里看书不刺眼，代价是不再像 Word。

```ts
import { useEffect } from 'react'
import type { ThemeSource, WtApi } from '../types/global'

/**
 * 平台在**模块加载时**就写进 `<html data-platform>`。
 *
 * 【为什么不做成 effect】它是静态信息，而 effect 要等首次渲染之后才跑——那一帧里
 * 标题条的文字会先跳到红绿灯底下、再弹回来。模块级副作用的代价是这一个文件不再"纯"，
 * 但 `App` 会 import 它，所以它的求值仍早于首次渲染。
 */
const hostApi = (window as unknown as { api?: WtApi }).api
if (hostApi?.platform) document.documentElement.dataset.platform = hostApi.platform

/**
 * 把系统外观写到 `<html data-theme>`，并在它变化时跟着更新。
 *
 * 【为什么不用 `@media (prefers-color-scheme: dark)`】实测（Electron 44 / macOS 深色系统）：
 * 这个应用里那条 media query **恒不命中**——主进程 `nativeTheme.shouldUseDarkColors` 是 true、
 * `themeSource` 手动设成 'dark' 之后**重载整窗**也仍然是 false。所以主题只能由主进程经 IPC 递过来
 * （见 `src/preload/index.ts` 里的说明）。别把这里"简化"回 CSS 媒体查询。
 */
export function useSystemTheme(): void {
  useEffect(() => {
    const el = document.documentElement
    const apply = (dark: boolean): void => {
      el.dataset.theme = dark ? 'dark' : 'light'
    }
    const api = (window as unknown as { api?: WtApi }).api
    if (!api) return

    void api.getTheme().then(apply)
    return api.onThemeChange(apply)
  }, [])
}

/**
 * 「深色模式下纸张也变暗」这个开关。
 *
 * 默认【关】：真 Word 的深色模式里纸张仍然是白的，保持这一点伪装才完整。
 * 打开之后阅读区整块也跟着暗下来——那是为了夜里看书不刺眼，代价是不再像 Word。
 *
 * 单独写一个 data 属性而不是塞进 data-theme：两者是正交的，
 * 深色纸只在深色外观下才有意义，浅色外观下开了也没用（CSS 里按组合选择器处理）。
 */
export function useDarkPaper(enabled: boolean): void {
  useEffect(() => {
    document.documentElement.dataset.paper = enabled ? 'dark' : 'light'
  }, [enabled])
}

/**
 * 把用户选的外观推给主进程。
 *
 * 【为什么不能只在页面里翻 class】macOS 的**红绿灯与其它原生部分**由主进程的
 * `nativeTheme.themeSource` 决定。只改网页的话会出现「网页变暗了、红绿灯还是系统色」——
 * 那正是刚修好的那种不一致。推给主进程之后，它会经 `themeChanged` 把**解析后的**结果
 * 广播回来（`useSystemTheme` 负责上色），原生与网页一起变。
 *
 * 另一层原因：`'system'` 这个选项本身就只能在主进程里解析——渲染层读不到系统外观
 * （见 `useSystemTheme` 上面那段实测）。
 */
export function useThemePreference(source: ThemeSource): void {
  useEffect(() => {
    const api = (window as unknown as { api?: WtApi }).api
    if (!api) return
    void api.setThemeSource(source)
  }, [source])
}
```

**同批改动的文件**（围栏均已就地同步，用 `git show HEAD:<路径>` 的旧内容精确定位）：
`channels.ts`（+2 条通道）、`ipc.ts`（+`getTheme` handler）、`main/index.ts`
（窗口底色跟主题走 + `nativeTheme.on('updated')` 广播）、`preload/index.ts`（+`getTheme`/`onThemeChange`）、
`global.d.ts`、`App.tsx`、`Ribbon.tsx`、`SettingsDialog.tsx`（+复选框）、三份 CSS
（`--wt-titlebar` 从 `--wt-blue` 拆出来：深色下标题条是深灰而强调色要提亮，共用一个变量做不到）、
`tests/setup.ts` 与四个测试文件。


---

## Task 19: 应用身份与图标

**背景**：应用此前没有 `productName`，`app.name` 取的是 npm 包名 `working-title`，
于是 macOS 菜单栏首项与「关于」显示的是 `working-title`。

**改了什么**：
- `package.json` 加 `"productName": "WorkingTitle"`（**`name` 保持 `working-title`**：npm 包名不允许大写）。
  实测之后 `app.name === 'WorkingTitle'`、菜单栏首项与「关于 WorkingTitle」都跟着变。
- **蓝条上那个 `Word` 与窗口标题 `文档1 - Word` 刻意不动**——那是伪装本身。
  这一条是用户明确选的：应用身份用 WorkingTitle，界面继续像 Word。
- 新增 `build/icon.svg`（矢量源）与 `build/icon.png`（2048×2048，`electron-builder.yml` 的
  `directories.buildResources: build` 会取它当应用图标）。

**Logo 的概念**：一页纸，末尾一根光标——这个产品的核心动作就是「打字，文字从光标处长出来」，
所以最后一行的文字条短一截、后面跟一根琥珀色光标。构图比例与理由都写在 SVG 的注释里。

**PNG 是怎么出来的**：Playwright 的 Chromium 没下载（`chromium.launch()` 用不了，
`_electron` 用的是仓库自带的 Electron 所以一直能跑），改用 Electron 的
`webContents.capturePage()` 渲染 `data:image/svg+xml` —— 能得到透明底、且带 2x 缩放（2048）。

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="WorkingTitle">
  <title>WorkingTitle</title>

  <!--
    应用图标。概念：**一页纸，末尾一根光标**——这个产品的核心动作就是「打字，文字从光标处长出来」，
    所以最后一行的文字条短一截、后面跟一根琥珀色光标，读起来就是「正在写」。

    构图要点：
    - 圆角方块四周留 100px 透明边距，方块本体 824×824、圆角 184（≈22.4%，
      这是 Big Sur 之后 macOS 图标的比例）。**不要画满整张画布**——那样在 Dock 里会比邻居大一圈。
    - 纸页是唯一的大面积白色块，在蓝色底上对比最强，缩到 16px 也还认得出。
    - 全文只有三种颜色：蓝底（渐变）、白纸、浅蓝文字条，**加一个琥珀色光标**。
      那一点暖色是整张图标里唯一「在动」的东西，视线自然落上去。
    - 文字条只有四条：再密的话在 16px 下会糊成一团灰。
  -->
  <defs>
    <linearGradient id="wtBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2f7ae5" />
      <stop offset="1" stop-color="#12408f" />
    </linearGradient>
    <filter id="wtPageShadow" x="-30%" y="-20%" width="160%" height="150%">
      <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#06203f" flood-opacity="0.34" />
    </filter>
  </defs>

  <g transform="translate(100 100)">
    <rect width="824" height="824" rx="184" fill="url(#wtBg)" />

    <!-- 纸页。宽高约占蓝底的 48%×63% —— 图标里那个「字形」太小的话，
         在 Dock 里会比邻居瘦一圈；macOS 图标的字形一般占到 55–65%。 -->
    <rect x="212" y="152" width="400" height="520" rx="30" fill="#ffffff" filter="url(#wtPageShadow)" />

    <!-- 已经写完的三行 -->
    <g fill="#b9cde8">
      <rect x="274" y="262" width="276" height="28" rx="14" />
      <rect x="274" y="352" width="276" height="28" rx="14" />
      <rect x="274" y="442" width="276" height="28" rx="14" />
    </g>

    <!-- 正在写的这一行：短一截，后面那根光标比文字条高，才像卡瑞特而不是一个小方块 -->
    <rect x="274" y="532" width="158" height="28" rx="14" fill="#b9cde8" />
    <rect x="452" y="526" width="22" height="40" rx="7" fill="#ffb900" />
  </g>
</svg>
```


---

## Task 20: 设置的手动保存（草稿机制）

> **本节是本计划写完之后补入的。** 原有的 Task 1–19 记录的是最初那一轮实现；后来给设置
> 对话框加「保存」按钮时新增了两个文件（一层可复用的草稿机制 + 它的用例）。按硬约定 1，
> 每个源/测试文件都要在这里有逐字节副本，所以补在文末而不是插回历史里。

**为什么要有这一层**：设置项将来会变多，而「哪些项要手动保存」应该是一张**表**，不是散在
JSX 里的几个 `useState`。加一项的成本是往表里加一行——不用碰「有没有改动」的算法、不用碰
保存按钮的显隐、也不用碰对话框的关闭语义（草稿是对话框的局部状态，一关就丢）。

现阶段表里只有两项（文档名、阅读替换）；外观 / 纸张 / 输入模式刻意不进去，它们的效果是
当场看得见的。

```ts
import { useCallback, useRef, useState } from 'react'

/**
 * 「手动保存」的那一组设置项：草稿留在这里，生效在点「保存」那一刻。
 *
 * 【为什么要单独一个模块】设置项将来会变多，而「哪些项要手动保存」这件事应该是一张表，
 * 不是散在 JSX 里的几个 useState。加一项的成本是往表里加一行：不用碰「有没有改动」的
 * 算法、不用碰保存按钮的显隐、也不用碰对话框的关闭语义（草稿本来就是对话框的局部状态，
 * 一关就丢）。
 *
 * 【为什么草稿统一是字符串】这些项在界面上都是输入框，而输入框里本来就是字符串；
 * 归一化（去空白、夹紧）与解析各自在 `normalize` / `commit` 里做。统一成字符串省掉了
 * 「草稿的类型跟着字段走」那一层泛型，代价只是比例在提交时 `Number(...)` 一下。
 */
export interface DeferredField {
  /** 也是 data-testid 的一部分：输入框就叫 `${id}-input` */
  id: string
  /** 已经生效的值（字符串形式）。「有没有改动」是拿草稿跟它比出来的 */
  committed: string
  /**
   * 失焦时把草稿归一化——**不提交**。归一化只是让框里显示的东西合法
   * （去掉两侧空白、把超出范围的比例夹回区间）。
   *
   * 第二个参数是当前的 `committed`：归一化不出合法值时要退回它，而不是留下一个空的或
   * NaN 的草稿——那种草稿会让「保存」按钮一直亮着，而点下去什么都不提交（用户会以为坏了）。
   */
  normalize: (raw: string, committed: string) => string
  /** 点「保存」时才调用；只对**有改动**的项调 */
  commit: (value: string) => void
}

export interface DeferredSettings {
  /** 各字段的当前草稿，键是 `id` */
  drafts: Record<string, string>
  setDraft: (id: string, raw: string) => void
  /** 失焦：归一化这一项，返回归一化后的值（调用方据此决定要不要给提示） */
  blur: (id: string) => string
  /** 有没有未保存的改动 */
  dirty: boolean
  /** 提交所有有改动的项 */
  save: () => void
  /** 把草稿全部拉回已提交值（打开对话框时用） */
  reset: () => void
}

export function useDeferredSettings(fields: DeferredField[]): DeferredSettings {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.id, f.committed]))
  )

  /**
   * 表挂在一个 ref 上，让 `blur` / `save` / `reset` 的身份不随每次渲染变。
   *
   * 【为什么不能直接用 `fields`】那张表每次渲染都是新数组（它闭包着 `docTitle` / `ratio`），
   * 于是这三个回调每次渲染都换身份；而对话框里 `useEffect(…, [open, reset])` 要靠 `reset`
   * 的稳定身份才只在「打开」那一下跑——身份一变就成了每次渲染都重置草稿，用户打一个字就被
   * 拉回去。渲染期写 ref 是本仓库既有的写法（`App.tsx` 的 `engineRef.current = engine`）。
   */
  const fieldsRef = useRef(fields)
  fieldsRef.current = fields

  const setDraft = useCallback((id: string, raw: string): void => {
    setDrafts((prev) => ({ ...prev, [id]: raw }))
  }, [])

  const blur = useCallback((id: string): string => {
    const field = fieldsRef.current.find((f) => f.id === id)
    if (!field) return ''
    const normalized = field.normalize(drafts[id] ?? field.committed, field.committed)
    setDrafts((prev) => ({ ...prev, [id]: normalized }))
    return normalized
  }, [drafts])

  const dirty = fields.some((f) => (drafts[f.id] ?? f.committed) !== f.committed)

  const save = useCallback((): void => {
    const normalized: Record<string, string> = { ...drafts }
    for (const f of fieldsRef.current) {
      // 【提交前先归一化，不能直接提交草稿】草稿是框里的原文，而失焦不是必经之路：
      // 在框里直接按回车（Enter＝保存）时它根本没被归一化过——两侧空白、空名、超范围的
      // 比例都会原样漏进已提交值里。点保存按钮的情况同理（浏览器会先失焦，但那是巧合，
      // 不是这里能依赖的性质）。
      const value = f.normalize(drafts[f.id] ?? f.committed, f.committed)
      normalized[f.id] = value
      if (value !== f.committed) f.commit(value)
    }
    // 草稿也要跟着归一化：否则框里留着原文、已提交值是归一化后的，两者一比永远算「有改动」，
    // 保存按钮点完还亮着。注意这里写的是**归一化后的值**而不是「拉回 committed」——
    // 后者会在 commit 被拒时把用户刚打的字吃掉，看起来像按钮坏了。
    setDrafts(normalized)
  }, [drafts])

  const reset = useCallback((): void => {
    setDrafts(Object.fromEntries(fieldsRef.current.map((f) => [f.id, f.committed])))
  }, [])

  return { drafts, setDraft, blur, dirty, save, reset }
}
```

```ts
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  useDeferredSettings,
  type DeferredField
} from '../../src/renderer/src/state/deferredSettings'

/**
 * 这一层是「手动保存」的通用机制，具体设置项只是往表里加行——所以它自己要有用例。
 * 这里刻意用两个假字段（一个去空白、一个夹紧），而不是拿文档名 / 比例来测：测的是机制，
 * 混进真实业务规则会让「机制坏了」和「那一项的 normalize 写错了」分不开。
 */
function makeFields(commitA = vi.fn(), commitB = vi.fn()): DeferredField[] {
  return [
    {
      id: 'a',
      committed: 'A',
      // 空 → 退回已提交值（不能留一个空草稿让「保存」永远亮着）
      normalize: (raw, committed) => {
        const trimmed = raw.trim()
        return trimmed === '' ? committed : trimmed
      },
      commit: commitA
    },
    {
      id: 'b',
      committed: '10',
      // 解析不出数字 → 退回已提交值；否则夹到 1–500
      normalize: (raw, committed) => {
        const parsed = Number.parseInt(raw, 10)
        return Number.isFinite(parsed) ? String(Math.min(500, Math.max(1, parsed))) : committed
      },
      commit: commitB
    }
  ]
}

describe('useDeferredSettings', () => {
  it('初始草稿等于已提交值，没有改动', () => {
    const { result } = renderHook(() => useDeferredSettings(makeFields()))
    expect(result.current.drafts).toEqual({ a: 'A', b: '10' })
    expect(result.current.dirty).toBe(false)
  })

  it('改草稿算改动，改回原值就不算了', () => {
    const { result } = renderHook(() => useDeferredSettings(makeFields()))
    act(() => result.current.setDraft('a', 'A2'))
    expect(result.current.dirty).toBe(true)

    act(() => result.current.setDraft('a', 'A'))
    expect(result.current.dirty).toBe(false)
  })

  it('失焦只归一化，不提交', () => {
    const commitA = vi.fn()
    const { result } = renderHook(() => useDeferredSettings(makeFields(commitA)))
    act(() => result.current.setDraft('a', '  A2  '))
    let returned = ''
    act(() => {
      returned = result.current.blur('a')
    })
    expect(returned).toBe('A2')
    expect(result.current.drafts.a).toBe('A2')
    expect(commitA).not.toHaveBeenCalled()
  })

  it('归一化不出合法值时就退回已提交值（不留空草稿 / NaN 草稿）', () => {
    const { result } = renderHook(() => useDeferredSettings(makeFields()))
    act(() => result.current.setDraft('a', '   '))
    act(() => result.current.blur('a'))
    expect(result.current.drafts.a).toBe('A')

    act(() => result.current.setDraft('b', 'abc'))
    act(() => result.current.blur('b'))
    expect(result.current.drafts.b).toBe('10')
    // 两条都退回了原值 ⇒ 一个字的改动都没剩下，按钮不该亮
    expect(result.current.dirty).toBe(false)
  })

  it('save 只提交有改动的项', () => {
    const commitA = vi.fn()
    const commitB = vi.fn()
    const { result } = renderHook(() => useDeferredSettings(makeFields(commitA, commitB)))
    act(() => result.current.setDraft('a', 'A2'))
    act(() => result.current.save())
    expect(commitA).toHaveBeenCalledWith('A2')
    expect(commitB).not.toHaveBeenCalled()
  })

  it('save 提交的是归一化后的值，而不是框里的原文', () => {
    const commitA = vi.fn()
    const commitB = vi.fn()
    const { result } = renderHook(() => useDeferredSettings(makeFields(commitA, commitB)))
    // 【这条是真踩到过的】没失焦直接按回车时草稿是原文，原样提交会把两侧空白带进已提交值
    act(() => result.current.setDraft('a', '  A2  '))
    act(() => result.current.setDraft('b', '9999'))
    act(() => result.current.save())
    expect(commitA).toHaveBeenCalledWith('A2')
    expect(commitB).toHaveBeenCalledWith('500')
  })

  it('save 之后草稿跟着归一化，于是不再算有改动', () => {
    const { result } = renderHook(() => useDeferredSettings(makeFields()))
    act(() => result.current.setDraft('a', '  A2  '))
    expect(result.current.dirty).toBe(true)

    act(() => result.current.save())

    // 草稿是归一化后的值（不是拉回旧值——那会在提交被拒时把用户刚打的字吃掉）
    expect(result.current.drafts.a).toBe('A2')
    // 这里没有会回写 committed 的外层，所以 dirty 仍为真；真正让它转假的是外层更新后的
    // committed。这条只钉「草稿被归一化了」，其余的由 settings.test.tsx 的会回写壳守。
  })

  it('reset 把草稿全部拉回已提交值', () => {
    const { result } = renderHook(() => useDeferredSettings(makeFields()))
    act(() => result.current.setDraft('a', 'A2'))
    act(() => result.current.setDraft('b', '25'))
    expect(result.current.dirty).toBe(true)

    act(() => result.current.reset())

    expect(result.current.drafts).toEqual({ a: 'A', b: '10' })
    expect(result.current.dirty).toBe(false)
  })
})
```
