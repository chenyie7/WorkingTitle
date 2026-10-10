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
import {
  mkdtempSync,
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

// 这两个辅助函数放在模块级而不是第二个 describe 里：clearAll 那条用例也要用它们
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
      expect(existsSync(join(notADir, 'session.json'))).toBe(false)

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][1]).toBeInstanceOf(Error)
    } finally {
      spy.mockRestore()
    }
  })

  it('session.json 损坏时返回 null 而不抛异常', () => {
    const store = createSessionStore(dir)
    writeFileSync(join(dir, 'session.json'), '{ 这不是 JSON', 'utf8')
    expect(store.readSession()).toBeNull()
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
    writeFileSync(join(dir, 'session.json'), JSON.stringify(crippled), 'utf8')
    // 前提一：写下去的确实是合法 JSON——否则本用例只是在重复「损坏时返回 null」那一条
    expect(() => JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'))).not.toThrow()
    // 前提二：这份记录与一份完好的记录确实不同——否则它什么都没坏，用例是空跑
    expect(JSON.stringify(crippled)).not.toBe(JSON.stringify(makeSession()))

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(store.readSession()).toBeNull()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain(token)
    } finally {
      spy.mockRestore()
    }
  })

  it('clearAll 删除会话与缓存', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession())
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src))
    // 前提：缓存确实落盘了。少了这两行，下面那两条 novel-cache 断言测的是「两个从未被创建
    // 过的文件不存在」——无论 clearAll 做什么都会通过，§8 承诺的「删除 session.json 与缓存」
    // 于是完全没有覆盖（实测：把 clearAll 的数组改成只含会话两个路径，全量 103 条仍全绿）。
    //
    // 【这条用例本身说明了这类缺陷怎么活过评审】它的注释一直把 .tmp 的理由解释得很仔细，
    // 读者于是顺理成章地以为旁边那两条缓存断言同样刻意——**细致的注释替空洞的断言打了掩护**。
    // 判据只能是「断言的操作数从哪来」，不是「注释写得多诚恳」。
    expect(existsSync(join(dir, 'novel-cache.json'))).toBe(true)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(true)
    // 模拟崩溃留在磁盘上的临时文件：「清除阅读记录」应当把它一起清掉
    writeFileSync(join(dir, 'session.json.tmp'), '{"novelTitle":"半', 'utf8')
    expect(existsSync(join(dir, 'session.json.tmp'))).toBe(true)
    store.clearAll()
    expect(store.readSession()).toBeNull()
    expect(existsSync(join(dir, 'novel-cache.json'))).toBe(false)
    expect(existsSync(join(dir, 'novel-cache.txt'))).toBe(false)
    expect(existsSync(join(dir, 'session.json.tmp'))).toBe(false)
  })

  it('clearAll 在文件不存在时不抛异常', () => {
    const store = createSessionStore(dir)
    expect(() => store.clearAll()).not.toThrow()
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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`
Expected: FAIL —— 无法解析 `../../src/main/sessionStore`。

- [ ] **Step 3: 写 `src/main/sessionStore.ts`**

```ts
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { Novel, NovelCacheMeta, PersistedSession } from '../core/types'

export interface SessionStore {
  readSession(): PersistedSession | null
  writeSession(s: PersistedSession): void
  clearAll(): void
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
 * 而全应用唯一不可再生的状态是阅读进度，它在 session.json 里（另一个文件、另一套校验），
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

export function createSessionStore(baseDir: string): SessionStore {
  const sessionPath = join(baseDir, 'session.json')
  const sessionTmpPath = join(baseDir, 'session.json.tmp')
  const cacheMetaPath = join(baseDir, 'novel-cache.json')
  const cacheTextPath = join(baseDir, 'novel-cache.txt')

  const ensureDir = (): void => {
    mkdirSync(baseDir, { recursive: true })
  }

  return {
    readSession(): PersistedSession | null {
      try {
        if (!existsSync(sessionPath)) return null
        const parsed: unknown = JSON.parse(readFileSync(sessionPath, 'utf8'))
        if (!isPersistedSession(parsed)) {
          // 结构不合法的记录同样要说出来，并且**点出是哪个字段**——静默丢弃是「进度
          // 莫名其妙没了」的成因，而只报「不合法」把定位工作留给了看日志的人。
          console.warn(
            `[wt] 会话文件结构不合法（${sessionProblem(parsed) ?? '未知'}），按无记录处理：`,
            sessionPath
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
    },

    writeSession(s: PersistedSession): void {
      try {
        ensureDir()
        // 先写临时文件再改名（同一个目录内，rename 是原子的）：读取方要么看到旧的完整
        // 文件、要么看到新的完整文件，不会看到「写了一半的 session.json」。
        // 直接写目标路径的话，进程在写完之前死掉，留下的是截断甚至空的文件，readSession
        // 只能返回 null——游标、chapterPos、activeChapter、ratio、mode、startedAt 全部
        // 静默丢失。实测这种残留的表现：截断成 20 字节与空文件都读回 null。
        // 注意这条保护的是一次写入【之内】的完整性，写入之间的窗口只能靠调用方的防抖收敛。
        writeFileSync(sessionTmpPath, JSON.stringify(s), 'utf8')
        renameSync(sessionTmpPath, sessionPath)
      } catch (err) {
        console.warn('[wt] 保存会话失败，本次进度未落盘：', err)
      }
    },

    clearAll(): void {
      // 临时文件也要删：崩溃可能正好把 .tmp 留在磁盘上，「清除阅读记录」应当清干净。
      for (const p of [sessionPath, sessionTmpPath, cacheMetaPath, cacheTextPath]) {
        try {
          // force: true 而不是先 existsSync 再删——分开写的话，「文件本来就不存在」这条
          // 正常路径会走进 catch 打出一行「删除失败」。一条在成功时也会响的告警，比没有
          // 告警更糟：它教会看日志的人忽略这一行。
          rmSync(p, { force: true })
        } catch (err) {
          console.warn('[wt] 删除持久化文件失败：', p, err)
        }
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
      if (armed && typeof p === 'string' && p.includes('session.json')) {
        mockHits++
        actual.writeFileSync(p, String(data).slice(0, 20), 'utf8')
        throw new Error('模拟进程在写入中途被杀')
      }
      return (actual.writeFileSync as (...a: unknown[]) => void)(p, data, enc)
    }
  }
})

const { createSessionStore } = await import('../../src/main/sessionStore')

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
    expect(store.readSession()).toEqual(good)

    armed = true
    store.writeSession(makeSession({ cursor: 999999 })) // 半途抛错，被 catch 吞掉
    armed = false

    // 前提自检：注入确实生效。少了这行，用例在「注入失效」时会静默退化成空跑。
    expect(mockHits).toBe(1)
    expect(store.readSession()).toEqual(good)
  })
})
```

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore } from '../../src/main/sessionStore'
import type { PersistedSession } from '../../src/core/types'

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
// 它看的是「整份换掉」与「就地截断」留下的差别：renameSync 会给 session.json 换上临时
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
describe('session.json 是「整份换掉」而不是「就地截断」', () => {
  // 柯里化形式是唯一可用的形状：写成 it.skipIf(cond, name, fn) 时 Vitest 5 不报错，
  // 只是**一个用例都没注册**（整份文件报 "No test found in suite"），于是「加了守卫」
  // 会变成「守卫不在」。实测踩过。
  it.skipIf(process.platform === 'win32')(
    '重复写入后 inode 必须更换（换文件 = 读取方只会看到某一份完整文件）',
    (ctx) => {
      const dir = mkdtempSync(join(tmpdir(), 'wt-ino-'))
      try {
        const store = createSessionStore(dir)
        const sessionPath = join(dir, 'session.json')
        const tmpPath = join(dir, 'session.json.tmp')

        store.writeSession(makeSession(1))
        // 一次成功的保存不该留下临时文件：rename 会把 .tmp 消费掉。
        // 这一条就是矩阵 row B 的探测器：copyFileSync 保留了目标的 inode（所以 inode 断言
        // 也看得见它），但它【不消费】临时文件，于是 .tmp 留在磁盘上；「写了临时文件却忘了
        // 改名」同样被它抓住。放在 statSync 与 inode 断言【之前】，是为了让这两种回退红在
        // 这一条说得清原因的断言上——放到后面的话，「忘了改名」会让 session.json 根本不存在，
        // 于是 statSync 先抛 ENOENT，红得看不出所以然（实测踩到过）。
        expect(existsSync(tmpPath)).toBe(false)
        const first = statSync(sessionPath).ino
        store.writeSession(makeSession(2))
        expect(existsSync(tmpPath)).toBe(false)
        const second = statSync(sessionPath).ino

        // 前提自检：这个文件系统确实给出有意义的 inode。报 0 时跳过而不是断言——
        // 在那种文件系统上这条守卫【按构造】无法工作，让它红等于谎报缺陷，
        // 而它声称覆盖的性质仍由 guardA.test.ts 守着。
        if (!(first > 0)) ctx.skip()
        expect(second).not.toBe(first)
        // 前提：第二次写真的发生了（否则 inode 变了也说明不了是这次写入造成的）
        expect(store.readSession()!.cursor).toBe(2)
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

注意：preload import 了 `../main/ipc`，而 `ipc.ts` 会**传递地**拉到 `session.ts` → `sessionStore.ts`（`node:fs`）与 `loadNovel.ts`（`iconv-lite`）。**沙箱化的 preload 可以 `require('electron')`，但加载不了 Node 内建模块。** 实测（Task 6）：`Unable to load preload script` / `Error: module not found: node:fs`，`window.api === undefined`（而页面本身照常渲染）。**因此 `CH` 与 `MENU_COMMANDS` 必须放在一个零依赖的独立模块里**——`channels.ts` 实测 `imports: []`，拆出后 preload 只需 `electron`。

> 此前这里写的是「在 sandboxed preload 里 `ipcMain` 不可用，会导致运行时错误」——**约束对、机制错**。`ipcMain` 只是从 `require('electron')` 上读的一个属性，**读一个 undefined 属性不会抛**；真正在加载期抛的是 Node 内建模块。**照错误的机制去防，人会去防 `ipcMain` 而漏掉 `node:fs`**，所以这条必须按实测写。


**本步之后 `src/main/ipc.ts` 的最终全文**（`fence#2` 去掉本地 `CH` / `MENU_COMMANDS` / `MenuCommand` 三个定义，换成上面那两行，外加一段注释）：

```ts
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { loadNovelFromFile } from './loadNovel'
import { getStore } from './session'
// 必须【既 import 又 re-export】：`export … from` 只把名字交给外部，**不在本模块作用域里
// 绑定 CH**，而下面的 registerIpc 要用 CH.*。实测（Task 6）：只写一行 re-export，typecheck
// 报 TS2304「Cannot find name 'CH'」6 处，全部落在本文件的 ipcMain.handle 调用上。
import { CH } from './channels'
import type { Novel, PersistedSession } from '../core/types'

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

  ipcMain.handle(CH.loadSession, (): PersistedSession | null => getStore().readSession())

  ipcMain.handle(CH.saveSession, (_e, session: PersistedSession): void => {
    getStore().writeSession(session)
  })

  ipcMain.handle(CH.clearSession, (): void => {
    getStore().clearAll()
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

- [ ] **Step 8: 重写 `src/main/index.ts`**

```ts
import { app, BrowserWindow, shell } from 'electron'
import { statSync } from 'node:fs'
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
  - CSS 类名契约（后续任务依赖）：**下面 36 个是三份 CSS 里实际定义的全部 `.wt-*` 选择器**，Task 8–14 用到的每一个都在其中，且后续任务不再新建 CSS 文件——所以这些名字是公共契约，改名会静默打断后面的任务（而渲染层测试多半看不见）。本清单由 Task 7 交付后实测补全（原先是 17 个，漏了后半）：
    `.wt-app` `.wt-body` `.wt-btn` `.wt-btn--active` `.wt-btn--icon` `.wt-canvas` `.wt-caret` `.wt-group` `.wt-group__body` `.wt-group__label` `.wt-input` `.wt-page` `.wt-page__empty` `.wt-page__fold` `.wt-page__text` `.wt-ratio` `.wt-ratio__input` `.wt-ratio__label` `.wt-ribbon` `.wt-ribbon__title` `.wt-ribbon__title-app` `.wt-ribbon__title-doc` `.wt-sep` `.wt-sidebar` `.wt-sidebar__header` `.wt-sidebar__rail` `.wt-sidebar__list` `.wt-sidebar__sub` `.wt-sidebar__toggle` `.wt-statusbar` `.wt-statusbar__spacer` `.wt-tab` `.wt-tab--active` `.wt-tabs` `.wt-toast` `.wt-toolbar`
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
  position: relative;
  /* 右侧留出收起按钮的位置，免得书名长的时候文字压到按钮底下 */
  padding: 10px 28px 10px 12px;
  border-bottom: 1px solid var(--wt-chrome-border);
  font-weight: 600;
}

.wt-sidebar__toggle {
  position: absolute;
  top: 3px;
  right: 5px;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: #888888;
  font-family: inherit;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}

.wt-sidebar__toggle:hover {
  background: #e4e4e4;
  color: #333333;
}

/* 收起后整条侧栏只剩这条 12px 的细缝：颜色很淡、视觉上近乎不存在，但鼠标用户得有入口
   把它调回来——那个快捷键是新用户不会知道的，全无入口等于收起即锁死。 */
.wt-sidebar__rail {
  flex: 0 0 12px;
  width: 12px;
  padding: 0;
  border: none;
  border-right: 1px solid var(--wt-chrome-border);
  background: #fafafa;
  color: #c4c4c4;
  font-family: inherit;
  font-size: 8px;
  line-height: 1;
  cursor: pointer;
}

.wt-sidebar__rail:hover {
  background: #e4e4e4;
  color: #333333;
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
        ▶
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
          ◀
        </button>
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
    // 全书 0 字时百分比必须短路成 0，否则是 NaN%（0/0）。
    expect(screen.getByTestId('status-percent').textContent).toBe('0%')
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

  it('百分比向下取整', () => {
    // 259 / 1000 = 25.9%：floor 得 25，round 得 26，两者可判。
    render(
      <StatusBar novel={novel} revealedChars={259} activeChapter={0} ratio={10} mode="ime" startedAt={null} now={0} />
    )
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
      // textarea，它们当场 blur。Toolbar 的比例输入框就是这样废掉的——blur 触发
      // `commitRatio`，把 draft 重置回当前比例，用户看到的是「点一下就弹回原样、
      // 字根本打不进去」。应用里任何接受文字输入的控件都会中这一枪。
      // 隐藏 textarea 自己也是 `textarea`，但那时 `document.activeElement` 已经是它，
      // 跳不跳过都一样。
      if (e.target instanceof Element && e.target.closest(TEXT_INPUT_SELECTOR)) return
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
 * 两个调用点都在 try/catch 里，异常不会冒出去。
 */
const benignApi: WtApi = {
  importNovel: async () => null,
  openNovelPath: async () => {
    throw new Error('测试桩：没有实现 openNovelPath，用例应自行提供 window.api')
  },
  initialNovelPath: async () => null,
  loadSession: async () => null,
  saveSession: async () => {},
  clearSession: async () => {},
  onMenuCommand: () => () => {}
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
import type { WtApi } from './types/global'

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
  const [now, setNow] = useState(() => Date.now())
  const engineRef = useRef<TypingEngine | null>(null)
  const canvasRef = useRef<HTMLElement | null>(null)
  engineRef.current = engine

  const state = useTypingEngine(engine)

  const openNovel = useCallback((next: Novel) => {
    const fresh = new TypingEngine(next)
    setNovel(next)
    setEngine(fresh)
    setExpanded(false)
  }, [])

  const handleImport = useCallback(async () => {
    const api = getApi()
    if (!api) return
    const next = await api.importNovel()
    if (!next) return
    openNovel(next)
  }, [openNovel])

  const handleClearSession = useCallback(async () => {
    const api = getApi()
    if (!api) return
    await api.clearSession()
    setNovel(null)
    setEngine(null)
  }, [])

  // 启动：先看命令行有没有指定 txt，再尝试恢复上次会话
  useEffect(() => {
    const api = getApi()
    // 没有 api，就没有「命令行参数」和「上次会话」这两件事可做——直接停在空状态。
    // 这【不是】多余的防御：少了它，下面第一个 await 会变成 unhandled rejection，
    // 用例行照旧报 passed、汇总行却是 `Errors 1 error`，vitest 的 exit code 是 1。
    if (!api) return

    let cancelled = false

    const boot = async (): Promise<void> => {
      const initialPath = await api.initialNovelPath()
      const session = await api.loadSession()

      if (initialPath) {
        // 命令行给的文件可能打不开（已删除、权限、EISDIR、解不出编码……）。
        // 没有这个 try 的话错误会以【未处理的 rejection】形式冒到启动期：空状态不显示、
        // 也没有任何提示。catch 里刻意【不 return】：失败就不阻断启动，继续走下面的
        // 会话恢复 / 空状态兜底——用户至少还能看到界面并重新导入。
        // 两条都真机实测过（Task 12，chmod 000 的 txt 当命令行参数 + 同一个 userData 里
        // 留着上次会话）：无 unhandled rejection，且会话照常恢复到「已显示 300 字」。
        // 注意这两条**单测里是零覆盖**——把整个 try/catch 删掉，渲染层用例全绿。
        try {
          const loaded = await api.openNovelPath(initialPath)
          if (cancelled) return
          if (session && session.sourcePath === loaded.sourcePath) {
            setNovel(loaded)
            setEngine(TypingEngine.fromSession(loaded, session))
          } else {
            openNovel(loaded)
          }
          return
        } catch {
          // 与下面会话恢复那条 catch 同形：静默降级，不阻断启动
        }
      }

      if (session) {
        try {
          const loaded = await api.openNovelPath(session.sourcePath)
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

  // 关闭前强制落盘
  useEffect(() => {
    const api = getApi()
    if (!api) return
    const flush = (): void => {
      const current = engineRef.current
      if (current) void api.saveSession(current.toSession())
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

    // 跳章之后阅读区是**空的**：显示窗口从该章开头起算，而这一章还没读过。
    // 少了这一条，「已显示」把 revealStart 漏掉（写成 cursor）也没人发现——
    // 变异实测：把 `state.cursor - state.revealStart` 改成 `state.cursor`，全套用例全绿。
    expect(screen.getByTestId('status-chars').textContent).toContain('已显示 0')
  })

  it('改比例后同样的击键抽出更多字', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 比例输入框挂在「开始」「视图」两个选项卡下，而导入按钮在「文件」选项卡下——
    // Ribbon 只渲染当前选项卡的工具组，切回「开始」它才在 DOM 里。
    fireEvent.click(screen.getByTestId('tab-开始'))

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
    expect(screen.getByTestId('status-chapter').textContent).toBe('未导入')
    expect(screen.getByTestId('status-chars').textContent).toContain('已显示 0')
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
