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
git add -A
git commit -m "chore: 项目脚手架（electron-vite + React 19 + Vitest + Playwright）"
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
  - `decode.ts`: `decodeBuffer(buf: Buffer): DecodeResult`、`normalizeNewlines(s: string): string`、`detectBom(buf: Buffer): { encoding: string; length: number } | null`、`needsGbFallback(detectedUpper: string): boolean`、`CONFIDENT_MULTIBYTE_NAMES: string[]`（后两个只为词汇表测试而导出）
  - `DecodeResult = { text: string; encoding: string; hadBom: boolean }`

- [ ] **Step 1: 写 `src/core/types.ts`**

```ts
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
   * 由「统一收尾规则」维护：任何一次游标变化之后，都重算 cursor 所在章的那一项。
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
```

- [ ] **Step 2: 写失败测试 `tests/unit/decode.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import { decodeBuffer, normalizeNewlines, detectBom } from '../../src/core/decode'

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
  return text.replace(/\r\n?/g, '\n')
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
 * 实测【注意】scoreText 是占比比值、随文本而变，下面的数字只是某一组样本的观测结果，
 * 不是编码的固有属性（换一段文本数字就变）：Shift_JIS 正确 400 / 乱码 1000；
 * EUC-KR 正确 0 / 乱码 737。所以不要在别处引用这些数字当定论。
 *
 * 【本函数的边界，别当成保证】这是一个黑名单：只有列出的多字节 CJK / Unicode 编码才免于兜底。
 * 任何未列出的编码——尤其是 KOI8-R 这类遗留单字节集——仍然会追加 GB18030，而只要
 * 「正确解码里几乎没有 CJK 表意文字」，乱码就可能在占比上胜出（实测 KOI8-R 正确 0 /
 * 乱码 256，一样误选）。根因是 scoreText 在【跨文字系统】之间比较得分，靠增删名单救不干净。
 *
 * 【为什么不改成正向白名单】把 windows-125x / ISO-8859-* 也排除在兜底之外，会破坏
 * 「GBK 被误判成 windows-1252 时把它救回来」这个兜底存在的主要理由。本应用面向中文小说，
 * 黑名单偏向「救中文」是刻意的取舍，代价是非中文的遗留单字节编码仍可能被解错（见 §13）。
 *
 * 【名字必须先规范化再匹配，且必须用前缀】
 * jschardet 4 只给裸名 `utf-16` / `utf-32` 做了 compat 改名；四个带端序的名字
 * （`utf-16-le` / `utf-16-be` / `utf-32-le` / `utf-32-be`）会**原样吐出 WHATWG 标签**
 * （见 jschardet/build/output_names.js 的 _COMPAT_NAMES），别名表里还有 `utf_16_le`
 * 这种下划线拼写。照 compat 表写正则会「看起来对、实际漏配」——这正是本函数最初的 bug：
 * `/i` 只解决大小写、不解决连字符，于是**无 BOM 的 UTF-16 被追加了 GB18030 并被解成乱码**
 * （实测无 BOM 韩文 UTF-16LE：正确解 0.0 / GB18030 乱码 44.8，乱码胜出）。
 * 所以先抹掉 `-` `_` 再匹配。
 * 用前缀而非整串锚定，是为了一并覆盖同族拼写（Big5HKSCS、EUC-JIS-2004、shift_jis_2004）。
 * 前缀匹配在此安全：jschardet 的注册表里没有任何不属于上述家族的编码名以
 * BIG5 / CP93 / CP94 / SHIFT / SJIS / EUC / JOHAB / UTF / UCS 开头（CP9xx 只有 932/949）。
 */
const CONFIDENT_MULTIBYTE =
  /^(?:BIG5|CP932|CP949|SHIFTJIS|SJIS|EUCJP|EUCJIS|EUCKR|JOHAB|UTF16|UTF32|UCS2)/

function needsGbFallback(detectedUpper: string): boolean {
  // 抹掉分隔符：jschardet 会吐出 utf-16-le / utf_16_le / UTF-16LE 三种拼写。
  const normalized = detectedUpper.replace(/[-_]/g, '')
  return normalized === '' || !CONFIDENT_MULTIBYTE.test(normalized)
}

function candidateEncodings(detected: string): string[] {
  const names: string[] = []
  const push = (n: string): void => {
    if (n && iconv.encodingExists(n) && !names.includes(n)) names.push(n)
  }
  const upper = (detected || '').toUpperCase()
  if (upper === 'GB2312' || upper === 'GBK' || upper === 'GB18030') push('GB18030')
  else if (upper === 'ASCII') push('UTF-8')
  else push(detected)

  // 条件性追加兜底。GB* 的情况上面已经 push 过，这里被去重成空操作。
  // 不要为了「保险」无条件追加——那会让日文/韩文被解成乱码（见 needsGbFallback 的注释）。
  // 也不要改成「只按 U+FFFD 数量打分」来回避：GB18030 几乎把所有字节对都映射到某个字符，
  // 乱码里的替换字符数同样≈0，两边打平，救不了。
  if (needsGbFallback(upper)) push('GB18030')
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
Expected: 全部 PASS（13 个用例）。

若 GBK 用例失败，打印 `detectEncoding(buf)`（即 `jschardet` 的具名导出 `detect`）的实际结果，并确认 `candidateEncodings` 里确实包含 `GB18030`。

- [ ] **Step 6: typecheck**

Run: `pnpm typecheck`
Expected: exit 0。若 `jschardet` 报缺少类型声明，确认装的是 `jschardet@4.0.0`（自带 `.d.ts`），而不是去装不存在的 `@types/jschardet`。

- [ ] **Step 6.5: 删除已过时的 `tests/smoke.test.ts`**

Task 1 的 Step 12 建了它，唯一作用是让 `pnpm test` 非空（vitest 在「没找到测试文件」时退出码非 0）。
它断言的是 `1 + 1 === 2`，既不碰本项目行为也不碰 jsdom / `tests/setup.ts`，属于「绿了但什么都没证明」的测试。
本任务的 `decode.test.ts`（9 个真实用例）落地后它已无任何作用，删掉。

Run: `git rm tests/smoke.test.ts`
Expected: 文件被删除；`pnpm test` 仍然通过（此时至少有 13 个用例）。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): 编码检测与解码（BOM + 严格 UTF-8 + jschardet 打分择优）"
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
    '12．转折'
  ])('识别标题行：%s', (line) => {
    expect(isChapterTitle(line)).toBe(true)
  })

  it.each([
    '第三章的内容很有意思，我读了三遍。',
    '前言不搭后语',
    '林昭站在城墙上。',
    '第一章 风起但是这一行其实是一句很长很长的正文句子，明显超过了标题长度上限',
    '',
    '   '
  ])('不把正文当标题：%s', (line) => {
    expect(isChapterTitle(line)).toBe(false)
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
    expect(chapters[0].title).toBe(PREAMBLE_TITLE)
    expect(chapters[0].start).toBe(0)
    expect(flatText.slice(chapters[0].start, chapters[0].end)).toContain('版权声明')
    expect(chapters[1].title).toBe('第一章 风起')
    expectContiguous(flatText, chapters)
  })

  it('标题前只有空白时不产生前言章节', () => {
    const text = '\n\n第一章 风起\n正文。\n'
    const { chapters } = splitChapters(text, 'x')
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('第一章 风起')
  })

  it('相邻标题之间的空章节被丢弃，但留下的区间仍然连续', () => {
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

const TITLE_PATTERNS: RegExp[] = [
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
  if (t.length === 0 || t.length > 40) return false
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
  const kept = bodies.filter((b) => b.body.trim() !== '')

  // 除最后一章外，每章正文末尾补一个 \n 作为章间分隔并计入该章，
  // 这样各章区间才能严格首尾相接（end === 下一章 start）。
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
git add -A
git commit -m "feat(core): 章节切分（标题正则 + 前言伪章节 + 区间连续性保证）"
```

---

## Task 4: 游标状态机 TypingEngine ★核心

**Files:**
- Create: `src/core/engine.ts`
- Test: `tests/unit/engine.test.ts`

**Interfaces:**
- Consumes: `Novel`, `Chapter`, `InputMode`, `PersistedSession`, `DEFAULT_RATIO`, `MIN_RATIO`, `MAX_RATIO` from `types.ts`
- Produces:
  - `EngineState = { cursor: number; revealStart: number; chapterPos: number[]; activeChapter: number; ratio: number; mode: InputMode; startedAt: number | null }`
  - `class TypingEngine`：
    - `constructor(novel: Novel, init?: { ratio?: number; mode?: InputMode })`
    - `getSnapshot(): EngineState`（同一状态返回同一引用，供 `useSyncExternalStore`）
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
import type { Novel } from '../../src/core/types'

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
    e.pump(1)
    e.pump(1)
    expect(e.getSnapshot().cursor).toBe(n.flatText.length)
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
    const e = new TypingEngine(makeNovel(), { ratio: 10 })
    e.pump(1)
    e.backspace(5)
    expect(e.getSnapshot().cursor).toBe(0)
    expect(e.visibleText).toBe('')
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
    const n = makeNovel()
    const e = new TypingEngine(n, { ratio: 500 })
    e.pump(1)
    expect(e.getSnapshot().chapterPos[0]).toBe(n.chapters[0].charCount)
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
    e.jumpToChapter(1)
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
    expect(savedText).toHaveLength(4)

    // 离开去别处
    e.jumpToChapter(0)
    expect(e.visibleText).toBe('')

    // 跳回来：进度被回填
    e.jumpToChapter(1)
    expect(e.getSnapshot().cursor).toBe(savedCursor)
    expect(e.visibleText).toBe(savedText)
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
  })

  it('setMode 切换输入模式', () => {
    const e = new TypingEngine(makeNovel())
    expect(e.getSnapshot().mode).toBe('ime')
    e.setMode('key')
    expect(e.getSnapshot().mode).toBe('key')
  })
})

describe('订阅与快照', () => {
  it('状态变化时通知订阅者，且快照引用只在变化时更换', () => {
    const e = new TypingEngine(makeNovel(), { ratio: 1 })
    const spy = vi.fn()
    const off = e.subscribe(spy)

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
  })

  it('fromSession 会修复越界与畸形数据', () => {
    const n = makeNovel()
    const restored = TypingEngine.fromSession(n, {
      novelTitle: '测试书',
      sourcePath: '/tmp/测试书.txt',
      ratio: 99999,
      mode: 'key',
      cursor: 999999,
      revealStart: 888888,
      chapterPos: [999999],
      activeChapter: 42,
      startedAt: null
    })
    const s = restored.getSnapshot()
    expect(s.ratio).toBe(500)
    expect(s.cursor).toBe(n.flatText.length)
    expect(s.revealStart).toBeLessThanOrEqual(s.cursor)
    expect(s.chapterPos).toHaveLength(n.chapters.length)
    expect(s.chapterPos.every((p) => p >= 0)).toBe(true)
    expect(s.activeChapter).toBeGreaterThanOrEqual(0)
    expect(s.activeChapter).toBeLessThan(n.chapters.length)
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
  /** 下一个要被抽出来的字符下标；唯一进度指针 */
  cursor: number
  /** 当前显示窗口的起点 */
  revealStart: number
  /** 每章「上次停留位置」（章内相对偏移） */
  chapterPos: number[]
  activeChapter: number
  ratio: number
  mode: InputMode
  startedAt: number | null
}

export function clampRatio(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RATIO
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, Math.round(n)))
}

export class TypingEngine {
  private readonly _novel: Novel
  private _state: EngineState
  private readonly _listeners = new Set<() => void>()

  constructor(novel: Novel, init?: { ratio?: number; mode?: InputMode }) {
    this._novel = novel
    this._state = {
      cursor: 0,
      revealStart: 0,
      chapterPos: novel.chapters.map(() => 0),
      activeChapter: 0,
      ratio: clampRatio(init?.ratio ?? DEFAULT_RATIO),
      mode: init?.mode ?? 'ime',
      startedAt: null
    }
  }

  get novel(): Novel {
    return this._novel
  }

  /** 阅读区唯一的内容来源 */
  get visibleText(): string {
    const { revealStart, cursor } = this._state
    return this._novel.flatText.slice(revealStart, cursor)
  }

  getSnapshot(): EngineState {
    return this._state
  }

  subscribe(fn: () => void): () => void {
    this._listeners.add(fn)
    return () => {
      this._listeners.delete(fn)
    }
  }

  private emit(): void {
    for (const fn of this._listeners) fn()
  }

  /** 二分查找 pos 落在哪一章；pos === 长度时取最后一章 */
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
   * 统一收尾规则：任何游标变化之后都执行。
   * 把中间被整章越过的章节标记为已读完，再把 chapterPos[新章] 同步为章内偏移。
   */
  private commit(nextCursor: number): void {
    const chapters = this._novel.chapters
    const total = this._novel.flatText.length
    const cursor = Math.max(0, Math.min(nextCursor, total))
    const idx = this.chapterIndexOf(cursor)
    const chapterPos = this._state.chapterPos.slice()

    const prev = this._state.activeChapter
    if (idx > prev) {
      for (let i = prev; i < idx; i++) chapterPos[i] = chapters[i].charCount
    }
    const current = chapters[idx]
    if (current) chapterPos[idx] = cursor - current.start

    this._state = { ...this._state, cursor, activeChapter: idx, chapterPos }
    this.emit()
  }

  /** 输入 k 个字，抽出 k × ratio 个字符 */
  pump(k: number, now: number = Date.now()): void {
    if (!(k > 0)) return
    const total = this._novel.flatText.length
    if (this._state.cursor >= total) return
    if (this._state.startedAt === null) {
      this._state = { ...this._state, startedAt: now }
    }
    this.commit(this._state.cursor + k * this._state.ratio)
  }

  /** 退格 k 次，回吐 k × ratio 个字符；小说内容不变 */
  backspace(k: number): void {
    if (!(k > 0)) return
    const next = Math.max(this._state.revealStart, this._state.cursor - k * this._state.ratio)
    if (next === this._state.cursor) return
    this.commit(next)
  }

  /** 跳转到第 i 章，并回填该章上次的阅读进度 */
  jumpToChapter(i: number): void {
    const chapters = this._novel.chapters
    if (!Number.isInteger(i) || i < 0 || i >= chapters.length) return
    const chapter = chapters[i]
    const raw = chapter.start + (this._state.chapterPos[i] ?? 0)
    const cursor = Math.max(chapter.start, Math.min(raw, chapter.end))

    const chapterPos = this._state.chapterPos.slice()
    chapterPos[i] = cursor - chapter.start

    this._state = {
      ...this._state,
      revealStart: chapter.start,
      cursor,
      activeChapter: i,
      chapterPos
    }
    this.emit()
  }

  setRatio(n: number): void {
    const ratio = clampRatio(n)
    if (ratio === this._state.ratio) return
    this._state = { ...this._state, ratio }
    this.emit()
  }

  setMode(mode: InputMode): void {
    if (mode === this._state.mode) return
    this._state = { ...this._state, mode }
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

    engine._state = {
      cursor,
      revealStart,
      chapterPos,
      activeChapter: engine.chapterIndexOf(cursor),
      ratio: clampRatio(s.ratio),
      mode: s.mode === 'key' ? 'key' : 'ime',
      startedAt: typeof s.startedAt === 'number' && Number.isFinite(s.startedAt) ? s.startedAt : null
    }
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
git add -A
git commit -m "feat(core): TypingEngine 游标状态机（pump/backspace/jumpToChapter + 回填）"
```

---

## Task 5: 小说加载、会话存储与启动参数

**Files:**
- Create: `src/main/loadNovel.ts`, `src/main/sessionStore.ts`, `src/main/startup.ts`
- Test: `tests/unit/sessionStore.test.ts`, `tests/unit/startup.test.ts`, `tests/unit/loadNovel.test.ts`

**Interfaces:**
- Consumes: `decodeBuffer`（Task 2）、`splitChapters`（Task 3）、`Novel` / `PersistedSession` / `NovelCacheMeta`
- Produces:
  - `loadNovelFromFile(filePath: string): Novel`
  - `createSessionStore(baseDir: string)` → `{ readSession, writeSession, clearAll, writeNovelCache, readNovelCache }`
  - `applyUserDataOverride(app: { setPath(n: string, p: string): void }): boolean`
  - `resolveInitialNovelPath(argv: string[], exists: (p: string) => boolean): string | null`

**关键设计**：`sessionStore.ts` 是**纯函数模块**，接受 `baseDir` 参数，不 import `electron`，因此可以在 Vitest 里用 `mkdtemp` 直接测。Electron 绑定放在 Task 6 的 `session.ts`。

- [ ] **Step 1: 写失败测试 `tests/unit/sessionStore.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore } from '../../src/main/sessionStore'
import type { Novel, PersistedSession } from '../../src/core/types'

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

describe('sessionStore 会话读写', () => {
  it('未写过时 readSession 返回 null', () => {
    const store = createSessionStore(dir)
    expect(store.readSession()).toBeNull()
  })

  it('写入后能读回同样的内容', () => {
    const store = createSessionStore(dir)
    const s = makeSession()
    store.writeSession(s)
    expect(store.readSession()).toEqual(s)
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
  })

  it('session.json 损坏时返回 null 而不抛异常', () => {
    const store = createSessionStore(dir)
    writeFileSync(join(dir, 'session.json'), '{ 这不是 JSON', 'utf8')
    expect(store.readSession()).toBeNull()
  })

  it('clearAll 删除会话与缓存', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession())
    store.clearAll()
    expect(store.readSession()).toBeNull()
    expect(existsSync(join(dir, 'novel-cache.json'))).toBe(false)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(false)
  })

  it('clearAll 在文件不存在时不抛异常', () => {
    const store = createSessionStore(dir)
    expect(() => store.clearAll()).not.toThrow()
  })
})

describe('sessionStore 小说缓存', () => {
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
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: FAIL —— 无法解析 `../../src/main/sessionStore`。

- [ ] **Step 3: 写 `src/main/sessionStore.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Novel, NovelCacheMeta, PersistedSession } from '../core/types'

export interface SessionStore {
  readSession(): PersistedSession | null
  writeSession(s: PersistedSession): void
  clearAll(): void
  writeNovelCache(novel: Novel): void
  readNovelCache(filePath: string): Novel | null
}

export function createSessionStore(baseDir: string): SessionStore {
  const sessionPath = join(baseDir, 'session.json')
  const cacheMetaPath = join(baseDir, 'novel-cache.json')
  const cacheTextPath = join(baseDir, 'novel-cache.txt')

  const ensureDir = (): void => {
    mkdirSync(baseDir, { recursive: true })
  }

  return {
    readSession(): PersistedSession | null {
      try {
        if (!existsSync(sessionPath)) return null
        return JSON.parse(readFileSync(sessionPath, 'utf8')) as PersistedSession
      } catch {
        return null
      }
    },

    writeSession(s: PersistedSession): void {
      try {
        ensureDir()
        writeFileSync(sessionPath, JSON.stringify(s), 'utf8')
      } catch {
        // 持久化失败不应打断阅读
      }
    },

    clearAll(): void {
      for (const p of [sessionPath, cacheMetaPath, cacheTextPath]) {
        try {
          if (existsSync(p)) rmSync(p)
        } catch {
          // 忽略
        }
      }
    },

    writeNovelCache(novel: Novel): void {
      try {
        ensureDir()
        const st = statSync(novel.sourcePath)
        const meta: NovelCacheMeta = {
          sourcePath: novel.sourcePath,
          mtimeMs: st.mtimeMs,
          size: st.size,
          encoding: novel.encoding,
          hadBom: novel.hadBom,
          title: novel.title,
          chapters: novel.chapters
        }
        // 全文单独存纯文本：20MB 小说塞进 JSON 会白白付出转义与解析开销
        writeFileSync(cacheTextPath, novel.flatText, 'utf8')
        writeFileSync(cacheMetaPath, JSON.stringify(meta), 'utf8')
      } catch {
        // 缓存失败不影响本次使用
      }
    },

    readNovelCache(filePath: string): Novel | null {
      try {
        if (!existsSync(cacheMetaPath) || !existsSync(cacheTextPath)) return null
        const meta = JSON.parse(readFileSync(cacheMetaPath, 'utf8')) as NovelCacheMeta
        if (meta.sourcePath !== filePath) return null
        const st = statSync(filePath)
        if (st.mtimeMs !== meta.mtimeMs || st.size !== meta.size) return null
        return {
          title: meta.title,
          sourcePath: meta.sourcePath,
          encoding: meta.encoding,
          hadBom: meta.hadBom,
          flatText: readFileSync(cacheTextPath, 'utf8'),
          chapters: meta.chapters
        }
      } catch {
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
import { applyUserDataOverride, resolveInitialNovelPath } from '../../src/main/startup'

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
  const exists = (p: string): boolean => p === '/books/三国演义.txt' || p === './小说.txt'

  it('从 argv 里挑出存在的 txt 路径', () => {
    expect(resolveInitialNovelPath(['/Applications/WT', '/books/三国演义.txt'], exists)).toBe(
      '/books/三国演义.txt'
    )
  })

  it('dev 模式下跳过 "." 之类的非 txt 参数', () => {
    expect(resolveInitialNovelPath(['/path/electron', '.', './小说.txt'], exists)).toBe('./小说.txt')
  })

  it('忽略不存在的 txt 路径', () => {
    expect(resolveInitialNovelPath(['/Applications/WT', '/books/不存在.txt'], exists)).toBeNull()
  })

  it('忽略开关参数', () => {
    expect(resolveInitialNovelPath(['/Applications/WT', '--inspect', '--flag.txt'], exists)).toBeNull()
  })

  it('没有候选时返回 null', () => {
    expect(resolveInitialNovelPath(['/Applications/WT'], exists)).toBeNull()
  })

  it('多个候选时取最后一个', () => {
    expect(
      resolveInitialNovelPath(['/Applications/WT', '/books/三国演义.txt', './小说.txt'], exists)
    ).toBe('./小说.txt')
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

/** 从命令行参数里找出要自动打开的小说路径。 */
export function resolveInitialNovelPath(
  argv: string[],
  exists: (p: string) => boolean
): string | null {
  for (let i = argv.length - 1; i >= 1; i--) {
    const arg = argv[i]
    if (!arg || arg.startsWith('-')) continue
    if (!arg.toLowerCase().endsWith('.txt')) continue
    if (exists(arg)) return arg
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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
})
```

- [ ] **Step 9: 写 `src/main/loadNovel.ts`**

```ts
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { decodeBuffer } from '../core/decode'
import { splitChapters } from '../core/chapters'
import type { Novel } from '../core/types'

export function loadNovelFromFile(filePath: string): Novel {
  const buf = readFileSync(filePath)
  const { text, encoding, hadBom } = decodeBuffer(buf)
  const title = basename(filePath, extname(filePath)) || '未命名'
  const { flatText, chapters } = splitChapters(text, title)
  return { title, sourcePath: filePath, encoding, hadBom, flatText, chapters }
}
```

- [ ] **Step 10: 跑全量单测**

Run: `pnpm test`
Expected: 全绿。当前应有 decode / chapters / engine / sessionStore / startup / loadNovel / smoke 七组测试通过。

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(main): 小说加载、会话存储（纯函数可测）与启动参数解析"
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
      initialNovelPath: 'wt:initial-novel-path',
      menuCommand: 'wt:menu-command'
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
  if (!store) store = createSessionStore(app.getPath('userData'))
  return store
}

/** 供 E2E / 便携模式在 setPath 之后重置缓存实例。 */
export function resetStore(): void {
  store = null
}
```

- [ ] **Step 5: 写 `src/main/menu.ts`**

```ts
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

注意：preload import 了 `../main/ipc`，而 `ipc.ts` 顶层 import 了 `electron` 的 `dialog` / `ipcMain`。在 sandboxed preload 里 `ipcMain` 不可用，会导致运行时错误。**因此 `CH` 与 `MENU_COMMANDS` 必须放在一个不 import electron 的独立模块里。**

- [ ] **Step 7: 拆出 `src/main/channels.ts`，修正上面的隐患**

`src/main/channels.ts`：
```ts
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
```

`src/main/ipc.ts` 改为从 `./channels` 重新导出，并删掉本地的 `CH` / `MENU_COMMANDS` 定义：
```ts
export { CH, MENU_COMMANDS, type MenuCommand } from './channels'
```

测试 `tests/unit/ipcContract.test.ts` 仍然 import `../../src/main/ipc`，接口不变，无需改动。

`src/preload/index.ts` 的 import 改为：
```ts
import { CH } from '../main/channels'
```

- [ ] **Step 8: 重写 `src/main/index.ts`**

```ts
import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { buildAppMenu } from './menu'
import { resetStore } from './session'
import { applyUserDataOverride, resolveInitialNovelPath } from './startup'

applyUserDataOverride(process.env, (name, path) => app.setPath(name, path))
resetStore()

let win: BrowserWindow | null = null
let initialNovelPath: string | null = null

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

app.whenReady().then(() => {
  initialNovelPath = resolveInitialNovelPath(process.argv, existsSync)

  registerIpc({
    getWindow: () => win,
    getInitialNovelPath: () => initialNovelPath
  })
  buildAppMenu(() => win)
  win = createWindow()

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
git add -A
git commit -m "feat(main): IPC 通道、会话绑定、原生菜单与启动流程"
```

---

## Task 7: Word 视觉外壳（布局与样式）

**Files:**
- Create: `src/renderer/src/styles/word.css`, `src/renderer/src/styles/ribbon.css`, `src/renderer/src/styles/page.css`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: 无（纯样式与布局骨架）
- Produces:
  - CSS 类名契约（后续任务依赖）：`.wt-app` `.wt-ribbon` `.wt-tabs` `.wt-tab` `.wt-tab--active` `.wt-toolbar` `.wt-group` `.wt-group__body` `.wt-group__label` `.wt-btn` `.wt-btn--active` `.wt-body` `.wt-sidebar` `.wt-canvas` `.wt-page` `.wt-statusbar` `.wt-toast`
  - `App.tsx` 渲染出 `.wt-app` 骨架，含 `data-testid="app-root"`

- [ ] **Step 1: 写 `src/renderer/src/styles/word.css`**

```css
:root {
  --wt-blue: #2b579a;
  --wt-blue-dark: #1e3f73;
  --wt-blue-light: #e8eef7;
  --wt-chrome: #f3f3f3;
  --wt-chrome-border: #d4d4d4;
  --wt-text: #333333;
  --wt-statusbar: #2b579a;
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
  font-family: 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  color: var(--wt-text);
  background: var(--wt-chrome);
  overflow: hidden;
  user-select: none;
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
  background: #9e9e9e;
  padding: 24px 0 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}

.wt-sidebar {
  width: 240px;
  flex: 0 0 240px;
  background: #fafafa;
  border-right: 1px solid var(--wt-chrome-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.wt-sidebar__header {
  padding: 10px 12px;
  border-bottom: 1px solid var(--wt-chrome-border);
  font-weight: 600;
}

.wt-sidebar__sub {
  font-weight: 400;
  color: #777;
  font-size: 11px;
}

.wt-sidebar__list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.wt-statusbar {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 24px;
  flex: 0 0 24px;
  padding: 0 12px;
  background: var(--wt-statusbar);
  color: #ffffff;
  font-size: 11px;
  white-space: nowrap;
}

.wt-statusbar__spacer {
  flex: 1;
}

.wt-toast {
  position: fixed;
  left: 50%;
  bottom: 56px;
  transform: translateX(-50%);
  background: rgba(32, 32, 32, 0.92);
  color: #ffffff;
  padding: 9px 18px;
  border-radius: 4px;
  font-size: 12px;
  z-index: 999;
  pointer-events: none;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
}
```

- [ ] **Step 2: 写 `src/renderer/src/styles/ribbon.css`**

```css
.wt-ribbon {
  flex: 0 0 auto;
  background: var(--wt-chrome);
  border-bottom: 1px solid var(--wt-chrome-border);
}

.wt-ribbon__title {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 30px;
  padding: 0 12px;
  background: var(--wt-blue);
  color: #ffffff;
  font-size: 12px;
}

.wt-ribbon__title-app {
  font-weight: 600;
}

.wt-ribbon__title-doc {
  opacity: 0.85;
}

.wt-tabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 0 8px;
  height: 28px;
  border-bottom: 1px solid #c9c9c9;
}

.wt-tab {
  border: none;
  background: transparent;
  padding: 5px 14px;
  font-size: 12px;
  font-family: inherit;
  color: #444444;
  cursor: pointer;
  border-radius: 3px 3px 0 0;
}

.wt-tab:hover {
  background: #e4e4e4;
}

.wt-tab--active {
  background: #ffffff;
  color: var(--wt-blue);
  font-weight: 600;
  box-shadow: 0 -1px 0 #c9c9c9, 1px 0 0 #c9c9c9, -1px 0 0 #c9c9c9;
}

.wt-toolbar {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 6px 8px;
  min-height: 78px;
  background: #ffffff;
  overflow-x: auto;
}

.wt-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 10px;
  border-right: 1px solid #e0e0e0;
}

.wt-group:last-child {
  border-right: none;
}

.wt-group__body {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 1;
}

.wt-group__label {
  font-size: 10px;
  color: #888888;
  margin-top: 4px;
  white-space: nowrap;
}

.wt-btn {
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: #333333;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.wt-btn:hover {
  background: var(--wt-blue-light);
  border-color: #b8cce4;
}

.wt-btn:active {
  background: #d3e0f0;
}

.wt-btn--active {
  background: #cfe0f5;
  border-color: #7ea6d8;
}

.wt-btn--icon {
  font-size: 14px;
  min-width: 26px;
}

.wt-sep {
  width: 1px;
  height: 22px;
  background: #e0e0e0;
  margin: 0 4px;
}

.wt-ratio {
  display: flex;
  align-items: center;
  gap: 4px;
}

.wt-ratio__label {
  font-size: 11px;
  color: #555555;
}

.wt-ratio__input {
  width: 58px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid #b8b8b8;
  border-radius: 3px;
  font-family: inherit;
  font-size: 12px;
  text-align: center;
}

.wt-ratio__input:focus {
  outline: 2px solid #7ea6d8;
  outline-offset: -1px;
}
```

- [ ] **Step 3: 写 `src/renderer/src/styles/page.css`**

```css
.wt-page {
  width: 794px;
  min-height: 1080px;
  background: #ffffff;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
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
  color: #b0b0b0;
  font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  line-height: 1.8;
}

.wt-page__fold {
  font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 12px;
  color: #777777;
  background: #f5f5f5;
  border: 1px dashed #cccccc;
  border-radius: 3px;
  padding: 5px 10px;
  margin-bottom: 14px;
  cursor: pointer;
  user-select: none;
}

.wt-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  border: none;
  resize: none;
  padding: 0;
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
  border-bottom: 1px solid #f0f0f0;
  white-space: nowrap;
  overflow: hidden;
}

.chapter-item:hover {
  background: #eef3fa;
}

.chapter-item--active {
  background: var(--wt-blue-light);
  border-left: 3px solid var(--wt-blue);
  padding-left: 9px;
  font-weight: 600;
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
})
```

- [ ] **Step 8: 跑测试**

Run: `pnpm vitest run tests/unit/layout.test.tsx`
Expected: PASS。若报 `document is not defined`，检查 `vitest.config.ts` 的 `environment` 是否为 `jsdom`。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(renderer): Word 视觉外壳（Ribbon/侧栏/纸张/状态栏样式与布局）"
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
  - `data-testid`：`tab-文件` 等（`tab-${name}`）、`btn-${id}`、`ratio-input`、`mode-button`、`toast`

**行为契约**（spec §5.2）：
- `toggle` 类按钮点击 → 切换按下态（`.wt-btn--active` + `aria-pressed`）
- `placeholder` 类按钮点击 → 弹出 toast「演示占位功能，未实现」
- 比例输入 → 真实改 `ratio`，夹紧 1..500
- 模式按钮 → 真实切换 `ime` / `key`

- [ ] **Step 1: 写 `src/renderer/src/state/ToolbarContext.tsx`**

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO, type InputMode } from '../../../core/types'

export interface ToolbarValue {
  toggles: Record<string, boolean>
  toggle: (id: string) => void
  notify: (message: string) => void
  toast: string | null
  ratio: number
  setRatio: (n: number) => void
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
  mode?: InputMode
  onRatioChange?: (n: number) => void
  onModeChange?: (m: InputMode) => void
  onImport?: () => void
  onClearSession?: () => void
}

export function ToolbarProvider({
  children,
  ratio: ratioProp,
  mode: modeProp,
  onRatioChange,
  onModeChange,
  onImport,
  onClearSession
}: ToolbarProviderProps) {
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [innerRatio, setInnerRatio] = useState(DEFAULT_RATIO)
  const [innerMode, setInnerMode] = useState<InputMode>('ime')

  const ratio = ratioProp ?? innerRatio
  const mode = modeProp ?? innerMode

  const toggle = useCallback((id: string) => {
    setToggles((prev) => ({ ...prev, [id]: !prev[id] }))
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
      notify,
      toast,
      ratio,
      setRatio,
      mode,
      setMode,
      onImport: onImport ?? (() => notify('演示占位功能，未实现')),
      onClearSession: onClearSession ?? (() => notify('演示占位功能，未实现'))
    }),
    [toggles, toggle, notify, toast, ratio, setRatio, mode, setMode, onImport, onClearSession]
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
import { useEffect, useState } from 'react'
import { MAX_RATIO, MIN_RATIO } from '../../../core/types'
import { clampRatioInput, useToolbar } from '../state/ToolbarContext'

export type ToolbarItem =
  | { kind: 'toggle'; id: string; label: string; title: string }
  | { kind: 'placeholder'; id: string; label: string; title: string }
  | { kind: 'ratio' }
  | { kind: 'mode' }
  | { kind: 'import' }
  | { kind: 'clear-session' }

export interface ToolbarGroup {
  label: string
  items: ToolbarItem[]
}

export function Toolbar({ groups }: { groups: ToolbarGroup[] }) {
  const { toggles, toggle, notify, ratio, setRatio, mode, setMode, onImport, onClearSession } =
    useToolbar()
  const [draft, setDraft] = useState(String(ratio))

  useEffect(() => {
    setDraft(String(ratio))
  }, [ratio])

  const commitRatio = (raw: string): void => {
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) {
      setDraft(String(ratio))
      return
    }
    const next = clampRatioInput(parsed)
    setRatio(next)
    setDraft(String(next))
    if (next !== parsed) notify(`比例已夹紧到 ${MIN_RATIO}–${MAX_RATIO} 范围：${next}`)
  }

  return (
    <div className="wt-toolbar" data-testid="toolbar">
      {groups.map((group) => (
        <div className="wt-group" key={group.label}>
          <div className="wt-group__body">
            {group.items.map((item) => {
              switch (item.kind) {
                case 'ratio':
                  return (
                    <div className="wt-ratio" key="ratio">
                      <span className="wt-ratio__label">1 键显示</span>
                      <input
                        className="wt-ratio__input"
                        data-testid="ratio-input"
                        aria-label="比例：输入 1 个字显示小说多少字"
                        inputMode="numeric"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={(e) => commitRatio(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRatio(e.currentTarget.value)
                        }}
                      />
                      <span className="wt-ratio__label">字</span>
                    </div>
                  )

                case 'mode':
                  return (
                    <button
                      key="mode"
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
                  )

                case 'import':
                  return (
                    <button
                      key="import"
                      type="button"
                      className="wt-btn"
                      data-testid="btn-import"
                      title="导入小说 (Ctrl+O)"
                      onClick={() => onImport()}
                    >
                      导入小说
                    </button>
                  )

                case 'clear-session':
                  return (
                    <button
                      key="clear-session"
                      type="button"
                      className="wt-btn"
                      data-testid="btn-clear-session"
                      title="清除阅读记录"
                      onClick={() => onClearSession()}
                    >
                      清除阅读记录
                    </button>
                  )

                default: {
                  const active = Boolean(toggles[item.id])
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`wt-btn ${active ? 'wt-btn--active' : ''}`}
                      data-testid={`btn-${item.id}`}
                      title={item.title}
                      aria-pressed={item.kind === 'toggle' ? active : undefined}
                      onClick={() => {
                        if (item.kind === 'toggle') toggle(item.id)
                        else notify('演示占位功能，未实现')
                      }}
                    >
                      {item.label}
                    </button>
                  )
                }
              }
            })}
          </div>
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
import { useState } from 'react'
import { Toolbar, type ToolbarGroup } from './Toolbar'

export const RIBBON_TABS = ['文件', '开始', '插入', '布局', '引用', '审阅', '视图'] as const
export type RibbonTab = (typeof RIBBON_TABS)[number]

const FONT_GROUP: ToolbarGroup = {
  label: '字体',
  items: [
    { kind: 'toggle', id: 'bold', label: 'B', title: '加粗' },
    { kind: 'toggle', id: 'italic', label: 'I', title: '斜体' },
    { kind: 'toggle', id: 'underline', label: 'U', title: '下划线' },
    { kind: 'toggle', id: 'strike', label: 'S', title: '删除线' },
    { kind: 'placeholder', id: 'font-family', label: '宋体', title: '字体' },
    { kind: 'placeholder', id: 'font-size', label: '五号', title: '字号' },
    { kind: 'placeholder', id: 'brush', label: '格式刷', title: '格式刷' }
  ]
}

const PARAGRAPH_GROUP: ToolbarGroup = {
  label: '段落',
  items: [
    { kind: 'placeholder', id: 'bullets', label: '•≡', title: '项目符号' },
    { kind: 'placeholder', id: 'numbering', label: '1≡', title: '编号' },
    { kind: 'toggle', id: 'align-left', label: '左', title: '左对齐' },
    { kind: 'toggle', id: 'align-center', label: '中', title: '居中' },
    { kind: 'toggle', id: 'align-right', label: '右', title: '右对齐' },
    { kind: 'toggle', id: 'align-justify', label: '两', title: '两端对齐' },
    { kind: 'placeholder', id: 'line-spacing', label: '行距', title: '行距' }
  ]
}

/** 承载真实功能的控件，挂在「开始」和「视图」两个选项卡下，保证随手可及 */
const READING_GROUP: ToolbarGroup = {
  label: '阅读替换',
  items: [{ kind: 'ratio' }, { kind: 'mode' }]
}

const TABS: Record<RibbonTab, ToolbarGroup[]> = {
  文件: [
    { label: '小说', items: [{ kind: 'import' }, { kind: 'clear-session' }] },
    {
      label: '文件',
      items: [
        { kind: 'placeholder', id: 'new', label: '新建', title: '新建' },
        { kind: 'placeholder', id: 'save', label: '保存', title: '保存' },
        { kind: 'placeholder', id: 'export-docx', label: '导出 docx', title: '导出为 docx' },
        { kind: 'placeholder', id: 'print', label: '打印', title: '打印' }
      ]
    }
  ],
  开始: [
    FONT_GROUP,
    PARAGRAPH_GROUP,
    READING_GROUP,
    {
      label: '样式',
      items: [
        { kind: 'placeholder', id: 'style-heading', label: '标题 1', title: '标题 1' },
        { kind: 'placeholder', id: 'style-normal', label: '正文', title: '正文' }
      ]
    },
    {
      label: '编辑',
      items: [
        { kind: 'placeholder', id: 'find', label: '查找替换', title: '查找和替换' },
        { kind: 'placeholder', id: 'undo', label: '撤销', title: '撤销' },
        { kind: 'placeholder', id: 'redo', label: '重做', title: '重做' }
      ]
    }
  ],
  插入: [
    {
      label: '插入',
      items: [
        { kind: 'placeholder', id: 'table', label: '表格', title: '表格' },
        { kind: 'placeholder', id: 'picture', label: '图片', title: '图片' },
        { kind: 'placeholder', id: 'shape', label: '形状', title: '形状' },
        { kind: 'placeholder', id: 'pagebreak', label: '分页', title: '分页符' }
      ]
    }
  ],
  布局: [
    {
      label: '页面设置',
      items: [
        { kind: 'placeholder', id: 'margin', label: '页边距', title: '页边距' },
        { kind: 'placeholder', id: 'orientation', label: '纸张方向', title: '纸张方向' },
        { kind: 'placeholder', id: 'columns', label: '分栏', title: '分栏' }
      ]
    }
  ],
  引用: [
    {
      label: '引用',
      items: [
        { kind: 'placeholder', id: 'toc', label: '目录', title: '目录' },
        { kind: 'placeholder', id: 'footnote', label: '脚注', title: '插入脚注' }
      ]
    }
  ],
  审阅: [
    {
      label: '审阅',
      items: [
        { kind: 'placeholder', id: 'comment', label: '新建批注', title: '新建批注' },
        { kind: 'placeholder', id: 'spellcheck', label: '拼写检查', title: '拼写检查' },
        { kind: 'placeholder', id: 'wordcount', label: '字数统计', title: '字数统计' }
      ]
    }
  ],
  视图: [
    {
      label: '视图',
      items: [
        { kind: 'placeholder', id: 'read-mode', label: '阅读视图', title: '阅读视图' },
        { kind: 'placeholder', id: 'ruler', label: '标尺', title: '标尺' },
        { kind: 'placeholder', id: 'gridlines', label: '网格线', title: '网格线' }
      ]
    },
    READING_GROUP
  ]
}

export function Ribbon({ docTitle }: { docTitle: string }) {
  const [tab, setTab] = useState<RibbonTab>('开始')

  return (
    <div className="wt-ribbon" data-testid="ribbon">
      <div className="wt-ribbon__title">
        <span className="wt-ribbon__title-app">Word</span>
        <span className="wt-ribbon__title-doc">{docTitle}</span>
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
      <Toolbar groups={TABS[tab]} />
    </div>
  )
}
```

- [ ] **Step 5: 写失败测试 `tests/unit/ribbon.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Ribbon, RIBBON_TABS } from '../../src/renderer/src/components/Ribbon'
import { Toast } from '../../src/renderer/src/components/Toast'
import { ToolbarProvider } from '../../src/renderer/src/state/ToolbarContext'
import type { InputMode } from '../../src/core/types'

function setup(overrides: {
  ratio?: number
  mode?: InputMode
  onRatioChange?: (n: number) => void
  onModeChange?: (m: InputMode) => void
  onImport?: () => void
  onClearSession?: () => void
} = {}): void {
  render(
    <ToolbarProvider {...overrides}>
      <Ribbon docTitle="文档1" />
      <Toast />
    </ToolbarProvider>
  )
}

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
    expect(screen.getByTestId('btn-import')).toBeTruthy()
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

describe('真实功能控件', () => {
  it('比例输入回车后回调夹紧后的值', () => {
    const onRatioChange = vi.fn()
    setup({ ratio: 10, onRatioChange })
    const input = screen.getByTestId('ratio-input')
    fireEvent.change(input, { target: { value: '25' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRatioChange).toHaveBeenCalledWith(25)
  })

  it('比例超出上限时夹紧到 500 并提示', () => {
    const onRatioChange = vi.fn()
    setup({ ratio: 10, onRatioChange })
    const input = screen.getByTestId('ratio-input')
    fireEvent.change(input, { target: { value: '9999' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRatioChange).toHaveBeenCalledWith(500)
    expect(screen.getByTestId('toast').textContent).toContain('500')
  })

  it('输入模式按钮真实切换并提示', () => {
    const onModeChange = vi.fn()
    setup({ mode: 'ime', onModeChange })
    expect(screen.getByTestId('mode-button').textContent).toBe('输入法')
    fireEvent.click(screen.getByTestId('mode-button'))
    expect(onModeChange).toHaveBeenCalledWith('key')
    expect(screen.getByTestId('toast').textContent).toContain('纯按键')
  })

  it('「导入小说」按钮触发真实回调而非占位提示', () => {
    const onImport = vi.fn()
    setup({ onImport })
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('「清除阅读记录」按钮触发真实回调', () => {
    const onClearSession = vi.fn()
    setup({ onClearSession })
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-clear-session'))
    expect(onClearSession).toHaveBeenCalledTimes(1)
  })

  it('默认选项卡「开始」下就能看到比例与模式控件', () => {
    setup()
    expect(screen.getByTestId('ratio-input')).toBeTruthy()
    expect(screen.getByTestId('mode-button')).toBeTruthy()
  })
})
```

- [ ] **Step 6: 运行确认失败，然后实现，再确认通过**

Run: `pnpm vitest run tests/unit/ribbon.test.tsx`
先 FAIL（模块不存在），按 Step 1–4 实现后再次运行。
Expected: 全部 PASS。

- [ ] **Step 7: 接进 App 并手动验证**

把 `App.tsx` 的 `.wt-ribbon` 骨架替换为 `<ToolbarProvider><Ribbon docTitle="文档1" /></ToolbarProvider>`，并在 `App` 末尾渲染 `<Toast />`。

Run: `pnpm dev`
Expected: 点「文件」「插入」等选项卡能切换工具组；点「B」会高亮；点「导出 docx」右下弹出提示；比例框能改。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(renderer): Ribbon 选项卡、工具栏按钮与 Toast 反馈"
```

---

## Task 9: 左侧章节列表（虚拟滚动 + 跳转 + 进度）

**Files:**
- Create: `src/renderer/src/components/ChapterList.tsx`
- Test: `tests/unit/chapterList.test.tsx`

**Interfaces:**
- Consumes: `Novel` / `Chapter` 类型；Task 7 的 `.chapter-item` 样式
- Produces: `<ChapterList novel={Novel | null} activeChapter={number} chapterPos={number[]} onJump={(i: number) => void} />`
  - `data-testid="chapter-list"`、`chapter-item-${i}`、`chapter-pct-${i}`
  - 行高常量 `ROW_HEIGHT = 32`

- [ ] **Step 1: 写 `src/renderer/src/components/ChapterList.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Novel } from '../../../core/types'

export const ROW_HEIGHT = 32
const OVERSCAN = 6

export interface ChapterListProps {
  novel: Novel | null
  activeChapter: number
  chapterPos: number[]
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

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => setViewport(el.clientHeight || 400)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 打字推进时，让当前章节滚进可视区域
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !novel) return
    const top = activeChapter * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [activeChapter, novel])

  const chapters = novel?.chapters ?? []
  const total = chapters.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
  const visible = chapters.slice(first, last)

  return (
    <aside className="wt-sidebar">
      <div className="wt-sidebar__header">
        {novel ? novel.title : '未导入小说'}
        <div className="wt-sidebar__sub">
          {novel ? `共 ${total} 章 · ${novel.encoding}` : '文件 → 导入小说'}
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
    expect(screen.getByText('文件 → 导入小说')).toBeTruthy()
  })

  it('显示书名与章节数', () => {
    const novel = makeNovel(5)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByText('大书')).toBeTruthy()
    expect(screen.getByText(/共 5 章/)).toBeTruthy()
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
```

- [ ] **Step 3: 运行测试并修复**

Run: `pnpm vitest run tests/unit/chapterList.test.tsx`
Expected: PASS。若虚拟滚动用例失败，多半是 jsdom 里 `clientHeight` 为 0 —— `viewport` 的默认值 400 已经兜底，确认 `setViewport` 没有被 `measure()` 覆盖成 0。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(renderer): 左侧章节列表（虚拟滚动 + 跳转 + 阅读进度）"
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
          文件 → 导入小说，或按 Ctrl+O
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

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

export interface StatusBarProps {
  novel: Novel | null
  revealedChars: number
  activeChapter: number
  ratio: number
  mode: InputMode
  startedAt: number | null
  now: number
}

export function StatusBar({
  novel,
  revealedChars,
  activeChapter,
  ratio,
  mode,
  startedAt,
  now
}: StatusBarProps) {
  const totalChars = novel?.flatText.length ?? 0
  const totalChapters = novel?.chapters.length ?? 0
  const percent = totalChars === 0 ? 0 : Math.floor((revealedChars / totalChars) * 100)
  const elapsed = startedAt === null ? '00:00:00' : formatElapsed(now - startedAt)

  return (
    <div className="wt-statusbar" data-testid="statusbar">
      <span data-testid="status-chars">
        已显示 {revealedChars.toLocaleString('en-US')} / 全书 {totalChars.toLocaleString('en-US')} 字
      </span>
      <span data-testid="status-chapter">
        {novel ? `第 ${activeChapter + 1} 章 / 共 ${totalChapters} 章` : '未导入'}
      </span>
      <span data-testid="status-ratio">比例 1:{ratio}</span>
      <span data-testid="status-encoding">编码 {novel?.encoding ?? '—'}</span>
      <span data-testid="status-mode">输入模式 {mode === 'ime' ? '输入法' : '纯按键'}</span>
      <span data-testid="status-elapsed">用时 {elapsed}</span>
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
    const text = 'A'.repeat(RENDER_WINDOW_LIMIT + 500)
    render(<Page visibleText={text} expanded={false} onToggleExpand={() => {}} empty={false} />)
    expect(screen.getByTestId('page-fold').textContent).toContain('500')
    expect(screen.getByTestId('page-text').textContent).not.toContain('已折叠')
  })

  it('点击折叠提示会请求展开', () => {
    const onToggleExpand = vi.fn()
    const text = 'A'.repeat(RENDER_WINDOW_LIMIT + 10)
    render(<Page visibleText={text} expanded={false} onToggleExpand={onToggleExpand} empty={false} />)
    fireEvent.click(screen.getByTestId('page-fold'))
    expect(onToggleExpand).toHaveBeenCalledTimes(1)
  })

  it('展开后不再显示折叠提示', () => {
    const text = 'A'.repeat(RENDER_WINDOW_LIMIT + 10)
    render(<Page visibleText={text} expanded onToggleExpand={() => {}} empty={false} />)
    expect(screen.queryByTestId('page-fold')).toBeNull()
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
import { StatusBar, formatElapsed } from '../../src/renderer/src/components/StatusBar'
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

describe('formatElapsed', () => {
  it('格式化为 HH:MM:SS', () => {
    expect(formatElapsed(0)).toBe('00:00:00')
    expect(formatElapsed(1000)).toBe('00:00:01')
    expect(formatElapsed(61_000)).toBe('00:01:01')
    expect(formatElapsed(3_661_000)).toBe('01:01:01')
  })

  it('负数与非法值归零', () => {
    expect(formatElapsed(-100)).toBe('00:00:00')
    expect(formatElapsed(Number.NaN)).toBe('00:00:00')
  })
})

describe('StatusBar', () => {
  it('未导入小说时显示占位', () => {
    render(
      <StatusBar novel={null} revealedChars={0} activeChapter={0} ratio={10} mode="ime" startedAt={null} now={0} />
    )
    expect(screen.getByTestId('status-chars').textContent).toContain('全书 0 字')
    expect(screen.getByTestId('status-chapter').textContent).toBe('未导入')
    expect(screen.getByTestId('status-encoding').textContent).toBe('编码 —')
  })

  it('显示已显示字数、章节、比例、编码与模式', () => {
    render(
      <StatusBar novel={novel} revealedChars={250} activeChapter={1} ratio={25} mode="key" startedAt={0} now={61_000} />
    )
    expect(screen.getByTestId('status-chars').textContent).toContain('已显示 250')
    expect(screen.getByTestId('status-chars').textContent).toContain('全书 1,000 字')
    expect(screen.getByTestId('status-chapter').textContent).toContain('第 2 章 / 共 2 章')
    expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:25')
    expect(screen.getByTestId('status-encoding').textContent).toBe('编码 GB18030')
    expect(screen.getByTestId('status-mode').textContent).toBe('输入模式 纯按键')
    expect(screen.getByTestId('status-elapsed').textContent).toBe('用时 00:01:01')
    expect(screen.getByTestId('status-percent').textContent).toBe('25%')
  })

  it('未开始打字时用时归零', () => {
    render(
      <StatusBar novel={novel} revealedChars={0} activeChapter={0} ratio={10} mode="ime" startedAt={null} now={999_999} />
    )
    expect(screen.getByTestId('status-elapsed').textContent).toBe('用时 00:00:00')
  })
})
```

- [ ] **Step 4: 运行测试**

Run: `pnpm vitest run tests/unit/page.test.tsx tests/unit/statusBar.test.tsx`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(renderer): 阅读页面（折叠护栏 + 光标）与状态栏"
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
import { useEffect, useRef, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { InputMode } from '../../../core/types'

export interface InputEngine {
  pump: (k: number) => void
  backspace: (k: number) => void
}

export interface InputCaptureProps {
  engine: InputEngine
  mode: InputMode
}

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

    const focus = (): void => {
      if (document.activeElement !== el) el.focus({ preventScroll: true })
    }
    focus()

    // 点击阅读区任意位置都要把按键接回接收器
    window.addEventListener('mousedown', focus)
    window.addEventListener('click', focus)
    return () => {
      window.removeEventListener('mousedown', focus)
      window.removeEventListener('click', focus)
    }
  }, [])

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
    // 合成中的输入交给 compositionend 处理，避免重复计数
    if (!composing.current && modeRef.current === 'ime') {
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
git add -A
git commit -m "feat(renderer): InputCapture 双模式输入捕获（输入法友好 + 纯按键）"
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

- [ ] **Step 1: 写 `src/renderer/src/types/global.d.ts`**

```ts
import type { Novel, PersistedSession } from '../../../core/types'

export interface WtApi {
  importNovel: () => Promise<Novel | null>
  openNovelPath: (path: string) => Promise<Novel>
  initialNovelPath: () => Promise<string | null>
  loadSession: () => Promise<PersistedSession | null>
  saveSession: (session: PersistedSession) => Promise<void>
  clearSession: () => Promise<void>
  onMenuCommand: (cb: (cmd: string) => void) => () => void
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
import type { InputMode, Novel } from '../../core/types'
import { ChapterList } from './components/ChapterList'
import { Page } from './components/Page'
import { Ribbon } from './components/Ribbon'
import { StatusBar } from './components/StatusBar'
import { Toast } from './components/Toast'
import { InputCapture } from './input/InputCapture'
import { ToolbarProvider } from './state/ToolbarContext'
import { useTypingEngine } from './state/useTypingEngine'

const SAVE_DEBOUNCE_MS = 600

export default function App() {
  const [novel, setNovel] = useState<Novel | null>(null)
  const [engine, setEngine] = useState<TypingEngine | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const engineRef = useRef<TypingEngine | null>(null)
  engineRef.current = engine

  const state = useTypingEngine(engine)

  const openNovel = useCallback((next: Novel) => {
    const fresh = new TypingEngine(next)
    setNovel(next)
    setEngine(fresh)
    setExpanded(false)
  }, [])

  const handleImport = useCallback(async () => {
    const next = await window.api.importNovel()
    if (!next) return
    openNovel(next)
  }, [openNovel])

  const handleClearSession = useCallback(async () => {
    await window.api.clearSession()
    setNovel(null)
    setEngine(null)
  }, [])

  // 启动：先看命令行有没有指定 txt，再尝试恢复上次会话
  useEffect(() => {
    let cancelled = false

    const boot = async (): Promise<void> => {
      const initialPath = await window.api.initialNovelPath()
      const session = await window.api.loadSession()

      if (initialPath) {
        const loaded = await window.api.openNovelPath(initialPath)
        if (cancelled) return
        if (session && session.sourcePath === loaded.sourcePath) {
          setNovel(loaded)
          setEngine(TypingEngine.fromSession(loaded, session))
        } else {
          openNovel(loaded)
        }
        return
      }

      if (session) {
        try {
          const loaded = await window.api.openNovelPath(session.sourcePath)
          if (cancelled) return
          setNovel(loaded)
          setEngine(TypingEngine.fromSession(loaded, session))
        } catch {
          // 原文件已不可用：停在空状态，等用户重新导入
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
    const off = window.api.onMenuCommand((cmd) => {
      if (cmd === 'import-novel') void handleImport()
      else if (cmd === 'clear-session') void handleClearSession()
    })
    return off
  }, [handleImport, handleClearSession])

  // 会话持久化（防抖）
  useEffect(() => {
    if (!engine) return
    const timer = window.setTimeout(() => {
      void window.api.saveSession(engine.toSession())
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [engine, state])

  // 关闭前强制落盘
  useEffect(() => {
    const flush = (): void => {
      const current = engineRef.current
      if (current) void window.api.saveSession(current.toSession())
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // 状态栏计时
  useEffect(() => {
    if (state?.startedAt == null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [state?.startedAt])

  const visibleText = engine?.visibleText ?? ''
  const revealedChars = state ? state.cursor - state.revealStart : 0

  const toolbarProps = useMemo(
    () => ({
      ratio: state?.ratio,
      mode: state?.mode,
      onRatioChange: (n: number) => engineRef.current?.setRatio(n),
      onModeChange: (m: InputMode) => engineRef.current?.setMode(m),
      onImport: () => void handleImport(),
      onClearSession: () => void handleClearSession()
    }),
    [state?.ratio, state?.mode, handleImport, handleClearSession]
  )

  return (
    <ToolbarProvider {...toolbarProps}>
      <div className="wt-app" data-testid="app-root">
        <Ribbon docTitle={novel ? novel.title : '文档1'} />

        <div className="wt-body">
          <ChapterList
            novel={novel}
            activeChapter={state?.activeChapter ?? 0}
            chapterPos={state?.chapterPos ?? []}
            onJump={(i) => engineRef.current?.jumpToChapter(i)}
          />

          <main className="wt-canvas">
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
          startedAt={state?.startedAt ?? null}
          now={now}
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
import type { Novel, PersistedSession } from '../../src/core/types'

function makeNovel(): Novel {
  const text = '第一章 甲\nAAAAAAAAAA\n第二章 乙\nBBBBBBBBBB\n'
  const { flatText, chapters } = splitChapters(text, '测试书')
  return { title: '测试书', sourcePath: '/tmp/测试书.txt', encoding: 'UTF-8', hadBom: false, flatText, chapters }
}

let saved: PersistedSession | null = null

function installApi(novel: Novel | null, session: PersistedSession | null = null): void {
  saved = null
  ;(window as unknown as { api: unknown }).api = {
    importNovel: vi.fn(async () => novel),
    openNovelPath: vi.fn(async () => novel as Novel),
    initialNovelPath: vi.fn(async () => null),
    loadSession: vi.fn(async () => session),
    saveSession: vi.fn(async (s: PersistedSession) => {
      saved = s
    }),
    clearSession: vi.fn(async () => {}),
    onMenuCommand: vi.fn(() => () => {})
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('App 端到端（单测层）', () => {
  it('未导入时阅读区是空状态', async () => {
    installApi(null)
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('page-empty')).toBeTruthy())
    expect(screen.getByTestId('status-chapter').textContent).toBe('未导入')
  })

  it('导入小说后可打字，阅读区按比例增长', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)

    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    // 默认比例 10，敲 1 个键应显示 10 个字
    fireEvent.input(capture, { target: { value: 'x' } })
    await waitFor(() => expect(screen.getByTestId('status-chars').textContent).toContain('已显示 10'))
    expect(screen.getByTestId('page-text').textContent!.length).toBeGreaterThanOrEqual(10)
  })

  it('退格回吐显示，但小说内容不变', async () => {
    const novel = makeNovel()
    const originalFlat = novel.flatText
    installApi(novel)
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    fireEvent.input(capture, { target: { value: 'x' } })
    await waitFor(() => expect(screen.getByTestId('status-chars').textContent).toContain('已显示 10'))

    fireEvent.keyDown(capture, { key: 'Backspace' })
    await waitFor(() => expect(screen.getByTestId('status-chars').textContent).toContain('已显示 0'))
    expect(novel.flatText).toBe(originalFlat)
  })

  it('点击章节跳转，当前章高亮跟随', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-1')).toBeTruthy())

    fireEvent.click(screen.getByTestId('chapter-item-1'))
    await waitFor(() => expect(screen.getByTestId('status-chapter').textContent).toContain('第 2 章'))
    expect(screen.getByTestId('chapter-item-1').className).toContain('chapter-item--active')
  })

  it('改比例后同样的击键抽出更多字', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const ratioInput = screen.getByTestId('ratio-input')
    fireEvent.change(ratioInput, { target: { value: '2' } })
    fireEvent.keyDown(ratioInput, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:2'))

    const capture = screen.getByTestId('input-capture')
    fireEvent.input(capture, { target: { value: 'x' } })
    await waitFor(() => expect(screen.getByTestId('status-chars').textContent).toContain('已显示 2'))
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
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('status-chars').textContent).toContain('已显示 15'))
    expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:5')
    expect(screen.getByTestId('status-mode').textContent).toBe('输入模式 纯按键')
    expect(screen.getByTestId('page-text').textContent).toContain(novel.flatText.slice(0, 15))
  })

  it('清除阅读记录后回到空状态', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    fireEvent.click(screen.getByTestId('btn-clear-session'))
    await waitFor(() => expect(screen.getByTestId('page-empty')).toBeTruthy())
    expect(window.api.clearSession).toHaveBeenCalled()
  })

  it('打字后会防抖保存会话', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    fireEvent.input(screen.getByTestId('input-capture'), { target: { value: 'x' } })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved!.cursor).toBe(10)
    expect(saved!.sourcePath).toBe('/tmp/测试书.txt')
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
git add -A
git commit -m "feat(renderer): App 接线（引擎 ↔ UI ↔ 会话持久化）"
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

const focusEditor = async (): Promise<void> => {
  // 阅读区被一层透明 textarea（.wt-input）完全覆盖，点 .wt-page 会被它拦截。
  // 直接点这个 textarea —— opacity:0 不影响 Playwright 的可交互判定。
  await win.locator('[data-testid="input-capture"]').click()
}

test('启动即导入命令行传入的小说，并列出章节', async () => {
  await expect(win.locator('[data-testid="chapter-item-0"]')).toBeVisible()
  await expect(win.locator('[data-testid="chapter-item-2"]')).toBeVisible()
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 0')
})

test('打字不显示原字符，而是按比例抽出小说文字', async () => {
  await focusEditor()
  await win.keyboard.type('aaaaa')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 50')

  const text = await win.locator('[data-testid="page-text"]').innerText()
  expect(text).not.toContain('a')
  expect(text.startsWith('第一章 甲')).toBe(true)
})

test('退格只回吐显示，小说内容不受影响', async () => {
  await focusEditor()
  await win.keyboard.type('aaa')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 30')

  await win.keyboard.press('Backspace')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 20')

  await win.keyboard.press('Backspace')
  await win.keyboard.press('Backspace')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 0')

  // 再敲一次，仍然从同一位置重新抽出同样的文字
  await win.keyboard.type('a')
  await expect(win.locator('[data-testid="page-text"]')).toContainText('第一章 甲')
})

test('改比例后同样的击键抽出更多字', async () => {
  const ratio = win.locator('[data-testid="ratio-input"]')
  await ratio.fill('3')
  await ratio.press('Enter')
  await expect(win.locator('[data-testid="status-ratio"]')).toContainText('1:3')

  await focusEditor()
  await win.keyboard.type('aa')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 6')
})

test('点击章节跳到该章，并在读过后回填进度', async () => {
  await win.locator('[data-testid="chapter-item-1"]').click()
  await expect(win.locator('[data-testid="status-chapter"]')).toContainText('第 2 章')

  await focusEditor()
  await win.keyboard.type('a')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 10')
  const afterTyping = await win.locator('[data-testid="page-text"]').innerText()

  // 离开再回来，进度应被回填
  await win.locator('[data-testid="chapter-item-0"]').click()
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 0')
  await win.locator('[data-testid="chapter-item-1"]').click()
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 10')
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
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 40')

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

  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 40')
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
git add -A
git commit -m "test(e2e): Playwright 驱动真实 Electron 的冒烟测试"
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
git add -A
git commit -m "build: electron-builder 双平台打包配置、CI 工作流与 README"
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
