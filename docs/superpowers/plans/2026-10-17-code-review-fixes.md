# 代码评审修复（D1–D16）实现计划

- **日期**：2026-10-17
- **分支**：`fix/2026-10-17-code-review`（基于 `feat/reading-font`）
- **来源**：`docs/reviews/2026-10-17-code-design-review.md`
- **范围**：等级 1（D1–D4）、等级 2（D5–D16），以及低风险等级 3 顺手项。

## 任务与落点

| 条目 | 修法 | 主要文件 |
|---|---|---|
| D1 多条快捷键只生效最后一条 | `onShortcutsChange` 改成函数式更新，App 用 `patchSettings` 基于最新表合并 | `SettingsDialog.tsx`、`Ribbon.tsx`、`App.tsx` |
| D2 铺满高度基线 | 目标高度取纸张设计高度（`min-height`）；测量副本包含块改为正文栏；块高缓存加宽度键 | `App.tsx`、`state/useBossFill.ts`、`styles/page.css` |
| D3 长 markdown 折叠后空白 | `pickFoldStart` 吃 `cursor`：从光标往前累加已揭示部分并夹到光标；MarkdownView 再防御一次 | `markdown/fill.ts`、`MarkdownView.tsx`、`Page.tsx` |
| D4 跳章后百分比错误 | 状态栏百分比改 `cursor / flatText.length` | `StatusBar.tsx`、`App.tsx` |
| D5 god component | 设置收敛为「一个对象 + patch」的 store；铺满测量拆成 `useBossFill` | `state/settingsStore.ts`、`state/useBossFill.ts`、`App.tsx` |
| D6 `window.api` 三份副本 | 类型统一到 `core/api.ts`；preload 对象字面量以它为类型；渲染层只走 `getApi()` | `core/api.ts`、`preload/index.ts`、`renderer/src/api.ts` |
| D7 写盘不校验、失败不可见 | 写前用读盘同一套校验器；写通道返回 `IpcResult`；失败弹 toast；临时文件名带 pid+序号 | `sessionStore.ts`、`main/ipc.ts`、`App.tsx` |
| D8 IPC 失败语汇不统一 | 统一 `IpcResult`；取消是 `reason === 'canceled'` | `core/api.ts`、`main/ipc.ts` |
| D9 强制边界只靠文档 | 渲染层 tsconfig 去 node 类型；tests 独立 project；`scripts/check-imports.mjs` 进 typecheck/CI | `tsconfig*.json`、`scripts/check-imports.mjs` |
| D10 围栏无自动校验 | `scripts/check-plan-fences.mjs` + CI；CLAUDE.md 去掉写死计数 | `scripts/check-plan-fences.mjs`、`CLAUDE.md` |
| D11 CI 不在 PR 上跑 | 新增只读 `check` 作业（PR / push main） | `.github/workflows/build.yml` |
| D12 markdown 隐藏字符串元数据 | WeakMap 节点元数据 + 单一偏移换算模块；测量走 layout-only | `markdown/nodeMeta.ts`、`markdown/offsets.ts`、`parse.ts`、`clip.ts`、`toReact.tsx` |
| D13 无单实例锁 / 临时名固定 | `requestSingleInstanceLock` + `second-instance`；temp 名带 pid+序号 | `main/index.ts`、`sessionStore.ts` |
| D14 依赖分类错误 | 运行期依赖只留 `iconv-lite` / `jschardet`，渲染层依赖移 devDependencies | `package.json`、`pnpm-lock.yaml` |
| D15 快捷键 id 第二份清单 | `ShortcutId` / `ResolvedShortcuts` 由 `SHORTCUTS` 表推导 | `core/shortcuts.ts` |
| D16 章节标点闸门 | 标点闸门只作用于「数字 + 顿号」模式；spec §7 同步 | `core/chapters.ts`、spec |

**等级 3 顺手做了**：启动时应用 `themeSource`、设置模态期间快捷键静音、IME 合成中的 Enter/Esc 不触发保存/关闭、`:hover` 不再盖掉 `.btn--active`、图片缓存换文档即清、`Novel`/`Chapter` 字段改 `readonly`、菜单「项目主页」指向真实仓库且从 `channels.ts` 取通道名。

**明确未做**（评审等级 3 里的高成本项）：`App.tsx` 剩余职责的 hook 拆分（boot / 会话 / 老板模式 / 光标跟随 / 快捷键接线）、Combo 面板重算坐标、交互色全量走 token、会话里两个只写字段、`types.ts → bossKey` 反向依赖、`noUncheckedIndexedAccess` / lint、主进程同步文件 IO 改异步。

## 新文件（逐字节围栏）

下列文件在本批新增，围栏按仓库硬约定与工作树逐字节一致。

### `src/core/api.ts`

```ts
import type { AppSettings, Novel, PersistedSession, ThemeSource } from './types'

/**
 * 跨进程调用的统一结果。
 *
 * `reason === 'canceled'` 表示用户取消，不是错误；其余 reason 直接给用户看。
 * 写通道必须返回它：`void` 会把「磁盘满 / 目录只读」变成静默丢数据。
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; reason: string }

/**
 * 渲染层眼里的 `window.api`。preload 的对象字面量以它为目标类型，
 * 多写或漏写方法都会在编译期报错。
 *
 * `platform` 是同步值：主题与标题条留白要在首次渲染前就拿到。
 */
export interface WtApi {
  /** 'darwin' | 'win32' | 'linux' */
  platform: string
  importNovel: () => Promise<IpcResult<Novel>>
  importWorkDoc: () => Promise<IpcResult<Novel>>
  /** 读不出来是正常路径，返回 null，不抛 */
  loadWorkDoc: (path: string) => Promise<Novel | null>
  /** 取一张工作文档里的图片，回来的是 `data:` URL；失败给 `null` */
  loadWorkDocImage: (src: string) => Promise<string | null>
  openNovelPath: (path: string) => Promise<IpcResult<Novel>>
  initialNovelPath: () => Promise<string | null>
  loadSession: (sourcePath: string) => Promise<PersistedSession | null>
  saveSession: (session: PersistedSession) => Promise<IpcResult<void>>
  clearSession: () => Promise<IpcResult<void>>
  loadSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<IpcResult<void>>
  onMenuCommand: (cb: (cmd: string) => void) => () => void
  getTheme: () => Promise<boolean>
  setThemeSource: (source: ThemeSource) => Promise<IpcResult<void>>
  onThemeChange: (cb: (dark: boolean) => void) => () => void
}
```

### `src/renderer/src/api.ts`

```ts
import type { WtApi } from '../../core/api'

/**
 * 渲染层取 preload 注入接口的唯一出口。**它可能不存在**：preload 加载失败时页面照常渲染，
 * 只是 `window.api` 为 undefined（`global.d.ts` 声明成必填，tsc 不会提醒判空）。
 *
 * 每次现取，不要在模块顶层缓存：那会把「preload 一定先于模块求值」写死进加载顺序。
 */
export function getApi(): WtApi | null {
  return (window as unknown as { api?: WtApi }).api ?? null
}
```

### `src/renderer/src/state/settingsStore.ts`

```ts
import { useCallback, useState } from 'react'
import { defaultSettings } from '../../../core/types'
import type { AppSettings } from '../../../core/types'

export type SettingsPatch =
  | Partial<AppSettings>
  | ((prev: AppSettings) => Partial<AppSettings>)

export interface AppSettingsStore {
  settings: AppSettings
  /** 合并式更新。函数形式拿到最新一份，同一个事件里连续 patch 不会互相覆盖。 */
  patchSettings: (update: SettingsPatch) => void
  /** 整份替换，只在读盘完成时用。 */
  replaceSettings: (next: AppSettings) => void
}

export function useAppSettings(): AppSettingsStore {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)

  const patchSettings = useCallback((update: SettingsPatch): void => {
    setSettings((prev) => ({ ...prev, ...(typeof update === 'function' ? update(prev) : update) }))
  }, [])

  const replaceSettings = useCallback((next: AppSettings): void => {
    setSettings(next)
  }, [])

  return { settings, patchSettings, replaceSettings }
}
```

### `src/renderer/src/state/useBossFill.ts`

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { fillCharsFor } from '../../../core/bossKey'
import type { TypingEngine } from '../../../core/engine'
import type { Novel } from '../../../core/types'
import { pickFillCut, type BlockHeight } from '../markdown/fill'
import { measureBlocks } from '../markdown/measure'

export interface BossFillInput {
  workNovel: Novel | null
  workEngine: TypingEngine | null
  /** 铺的是工作文档，所以判它、不是当前显示的那份。 */
  workIsMarkdown: boolean
  /** 量不出高度、退回按字符数铺时用的正文字号。 */
  pageFontSize: number
}

export interface BossFill {
  measuring: boolean
  onMeasureNode: (el: HTMLElement | null) => void
  applyFill: (percent: number) => void
  invalidateHeights: () => void
}

/**
 * 老板键的「铺满一页」：测量工作文档的块高、选切点、把引擎游标移过去。
 *
 * 三条路顺序不能换：有缓存直接算 → 没缓存先量（渲染一次整篇隐藏副本）→
 * 量不出来退回按字符数（`fillCharsFor`）。
 */
export function useBossFill({
  workNovel,
  workEngine,
  workIsMarkdown,
  pageFontSize
}: BossFillInput): BossFill {
  const [measuring, setMeasuring] = useState(false)
  /** 隐藏副本的根元素，`MarkdownView` 挂载时交过来。 */
  const measureElRef = useRef<HTMLElement | null>(null)
  const onMeasureNode = useCallback((el: HTMLElement | null): void => {
    measureElRef.current = el
  }, [])

  /** 块高只跟文档与样式有关；宽度一起存，窗口/栏宽变了旧表不再成立。 */
  const heightsRef = useRef<{ doc: unknown; width: number; heights: BlockHeight[] } | null>(null)
  /** 有一次「开量高度」在等结果。 */
  const pendingFillRef = useRef<number | null>(null)

  const pageTextHeight = useCallback((): number => {
    const el = document.querySelector('.wt-page')
    if (!(el instanceof HTMLElement)) return 0
    const cs = getComputedStyle(el)
    const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    // 用 min-height（纸张设计高度）而不是 clientHeight：纸会被内容撑高。
    const design = parseFloat(cs.minHeight)
    const inner = (Number.isFinite(design) && design > 0 ? design : el.clientHeight) - padding
    return Number.isFinite(inner) && inner > 0 ? inner : 0
  }, [])

  const textAreaWidth = useCallback((): number => {
    const el = document.querySelector('.wt-page__text')
    return el instanceof HTMLElement ? el.clientWidth : 0
  }, [])

  const applyFill = useCallback(
    (percent: number): void => {
      const eng = workEngine
      if (!eng) return
      const cached = heightsRef.current
      if (
        workIsMarkdown &&
        cached &&
        cached.doc === workNovel &&
        cached.width === textAreaWidth()
      ) {
        eng.revealTo(pickFillCut(cached.heights, (pageTextHeight() * percent) / 100))
        return
      }
      if (!workIsMarkdown) {
        eng.revealTo(fillCharsFor(percent, pageFontSize))
        return
      }
      pendingFillRef.current = percent
      setMeasuring(true)
    },
    [workEngine, workNovel, workIsMarkdown, pageFontSize, pageTextHeight, textAreaWidth]
  )

  const invalidateHeights = useCallback((): void => {
    heightsRef.current = null
  }, [])

  useEffect(() => {
    if (!measuring) return
    const el = measureElRef.current
    let heights: BlockHeight[] | null = null
    try {
      heights = measureBlocks(el)
    } catch (err) {
      console.warn('[wt] 量 markdown 块高失败，退回按字符数铺：', err)
    }
    const percent = pendingFillRef.current
    pendingFillRef.current = null
    if (heights && workIsMarkdown) {
      heightsRef.current = { doc: workNovel, width: textAreaWidth(), heights }
    }
    workEngine?.revealTo(
      heights
        ? pickFillCut(heights, (pageTextHeight() * (percent ?? 0)) / 100)
        : fillCharsFor(percent ?? 0, pageFontSize)
    )
    setMeasuring(false)
  }, [measuring, workIsMarkdown, workNovel, workEngine, pageFontSize, pageTextHeight, textAreaWidth])

  return { measuring, onMeasureNode, applyFill, invalidateHeights }
}
```

### `src/renderer/src/markdown/nodeMeta.ts`

```ts
/**
 * mdast 节点的元数据，以**节点对象本身**为键（类型见本文件，不往第三方 AST 上挂字符串字段）。
 *
 * 【裁剪会造新对象】`clip.ts` 克隆节点后要 `copyMeta` 过去，否则元数据静默丢失。
 * 【读口一律走这里的函数】裸读字段会绕过「不是有限数算没有」这一步。
 */
interface NodeMeta {
  valueStart?: number
  lineStarts?: readonly number[]
  blankLines?: number
  blankRows?: number
}

const store = new WeakMap<object, NodeMeta>()

function metaOf(node: object): NodeMeta {
  const hit = store.get(node)
  if (hit) return hit
  const fresh: NodeMeta = {}
  store.set(node, fresh)
  return fresh
}

function readMeta(node: unknown): NodeMeta | null {
  return typeof node === 'object' && node !== null ? (store.get(node) ?? null) : null
}

/** `value` 的第一个字符在源码里的偏移。 */
export function setValueStart(node: object, start: number): void {
  metaOf(node).valueStart = start
}

export function valueStartOf(node: unknown): number | null {
  const raw = readMeta(node)?.valueStart
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/** 每个 `value` 行的首字符在源码里的偏移。传 `null` 摘表。 */
export function setLineStarts(node: object, starts: readonly number[] | null): void {
  const meta = metaOf(node)
  if (starts === null) delete meta.lineStarts
  else meta.lineStarts = [...starts]
}

export function lineStartsOf(node: unknown): readonly number[] | null {
  const raw = readMeta(node)?.lineStarts
  if (!Array.isArray(raw) || !raw.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null
  }
  return raw
}

/** 未揭示的占位：`lines` 是代码块剩余行数，`rows` 是表格剩余行数。 */
export type BlankKind = 'lines' | 'rows'

export function setBlankCount(node: object, kind: BlankKind, count: number): void {
  const meta = metaOf(node)
  if (kind === 'lines') meta.blankLines = count
  else meta.blankRows = count
}

export function blankCountOf(node: unknown, kind: BlankKind): number {
  const meta = readMeta(node)
  const raw = kind === 'lines' ? meta?.blankLines : meta?.blankRows
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

/** 克隆节点时把元数据整份带过去，之后的字段再各自覆盖。 */
export function copyMeta(from: object, to: object): void {
  const meta = store.get(from)
  if (meta) store.set(to, { ...meta })
}
```

### `src/renderer/src/markdown/offsets.ts`

```ts
/**
 * 逐行偏移的换算（设计 3.6.1）。解析、裁剪、渲染三处**共用这一份**，不要各写一份循环。
 *
 * 【换行归谁】行 k 末尾那个换行属于行 k：源码偏移是 `src + len`，`value` 下标是
 * `base + len`；下一行从两者各 +1 起算。
 */

/** 摊平后的一行：它在 `value` 里的下标、内容长度（不含行尾换行）、源码起点。 */
export interface ValueLine {
  readonly base: number
  readonly len: number
  readonly src: number
}

/**
 * 把 `value` 摊成行。`starts` 是逐行表（可缺省）；缺的行按「上一行源码起点 + 行长 + 换行」推。
 * 行数由 `value` 定，不由表长定——裁剪后 `value` 可能比表多一个空行。
 */
export function linesOf(
  value: string,
  starts: readonly number[] | null,
  origin: number
): ValueLine[] {
  const out: ValueLine[] = []
  let base = 0
  for (;;) {
    const nl = value.indexOf('\n', base)
    const len = (nl < 0 ? value.length : nl) - base
    const prev = out[out.length - 1]
    const src = starts?.[out.length] ?? (prev ? prev.src + prev.len + 1 : origin)
    out.push({ base, len, src })
    if (nl < 0) break
    base = nl + 1
  }
  return out
}

/** 这张逐行表能不能由「起点 + 字符数」直接推出；能推出就不必挂。 */
export function isContiguous(starts: readonly number[], base: number, value: string): boolean {
  const lines = linesOf(value, starts, base)
  return starts.every((s, i) => i < lines.length && s === base + lines[i].base)
}

/** 按行求交的结果：已揭示文字在 `value` 里的起止下标，以及已揭示那几行的行起点。 */
export interface ValueWindow {
  readonly head: number
  readonly tail: number
  readonly starts: number[]
}

/** 行内是 +1 线性的，行与行之间差的是被剥掉的行前缀宽度，所以窗口两侧都要按行求交。 */
export function sliceValueByLines(
  value: string,
  starts: readonly number[],
  from: number,
  to: number
): ValueWindow {
  const lines = linesOf(value, starts, 0)
  let head = -1
  let tail = -1
  const revealed: number[] = []
  for (const line of lines) {
    const hasNewline = line.base + line.len < value.length
    const stop = line.src + line.len + (hasNewline ? 1 : 0)
    const lo = Math.max(from, line.src)
    const hi = Math.min(to, stop)
    if (lo >= hi) continue
    if (head < 0) head = line.base + lo - line.src
    tail = line.base + hi - line.src
    revealed.push(lo)
  }
  return head < 0 ? { head: 0, tail: 0, starts: [] } : { head, tail, starts: revealed }
}
```

### `tsconfig.test.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"]
  },
  "include": ["tests", "src"],
  "exclude": []
}
```

### `package.json`

```json
{
  "name": "working-title",
  "version": "0.2.0",
  "description": "伪装成 Word 的打字阅读器",
  "main": "out/main/index.js",
  "license": "MIT",
  "packageManager": "pnpm@11.21.0",
  "engines": {
    "node": ">=22.12.0"
  },
  "scripts": {
    "postinstall": "install-electron",
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "node scripts/check-imports.mjs && tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.test.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "electron-vite build && playwright test",
    "dist:dir": "electron-vite build && electron-builder --dir",
    "dist:mac": "electron-vite build && electron-builder --mac --publish never",
    "dist:win": "electron-vite build && electron-builder --win --publish never"
  },
  "dependencies": {
    "iconv-lite": "0.7.3",
    "jschardet": "4.0.0"
  },
  "devDependencies": {
    "@fluentui/react-icons": "^2.0.344",
    "@playwright/test": "1.63.0",
    "@testing-library/dom": "10.4.2",
    "@testing-library/react": "16.3.3",
    "@types/mdast": "^4.0.4",
    "@types/node": "^22.0.0",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "5.2.0",
    "electron": "44.5.1",
    "electron-builder": "26.15.3",
    "electron-vite": "5.0.0",
    "jsdom": "30.1.2",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "remark-gfm": "^4.0.1",
    "remark-parse": "^11.0.0",
    "typescript": "5.9.3",
    "unified": "^11.0.5",
    "vite": "7.3.7",
    "vitest": "5.0.3"
  },
  "productName": "WorkingTitle"
}
```

### `electron-builder.yml`

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
  # 【产物名为什么要显式写】默认模板是 `${productName}-${version}-${arch}.${ext}`，但
  # `expandMacro` 在 arch 为空时会**把 `-${arch}` 整段删掉**（连同 ` ${arch}` / `_${arch}`
  # / `/${arch}`）。于是 Intel 那个 dmg 出来叫 `WorkingTitle-0.1.0.dmg`——跟 arm64 的
  # 放在一起，根本看不出哪个是哪个。写死之后两个架构都带后缀。
  #
  # 【平台名为什么写死成 `mac` 而不用 `${platform}`】那个宏展开的是 **`process.platform`**,
  # 也就是**构建机**的平台，不是目标平台——在 Mac 上打 Windows 包会得到 `darwin`。
  # 想要正确的平台名只能在各平台的段里各写一遍。
  artifactName: ${productName}-v${version}-mac-${arch}.${ext}
  # 只出 dmg，两个架构各一个，**不出 zip**。
  # dmg 本来就是「挂载一个磁盘映像、把 .app 拖出来」，自身不安装任何东西——
  # zip 那条「不想跑安装器」的理由在 macOS 上由 dmg 本身满足了，多出一份 zip 只是多一个要维护的产物。
  target:
    - target: dmg
      arch:
        - arm64
        - x64

dmg:
  title: ${productName}

win:
  # 覆盖掉 nsis 自己的默认名（`${productName} Setup ${version}.${ext}`），
  # 让安装器与 zip 用同一套命名，一眼能对上。
  artifactName: ${productName}-v${version}-win-${arch}.${ext}
  target:
    - target: nsis
      arch:
        - x64
    # zip 是「解压即用」那条路：解开就是 WorkingTitle.exe 与它的依赖文件，绿色版。
    # **只有 Windows 出它**——nsis 才是真正会写注册表、可能要管理员权限的那个，zip 是它的替代。
    - target: zip
      arch:
        - x64

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  shortcutName: WorkingTitle

linux:
  artifactName: ${productName}-v${version}-linux-${arch}.${ext}
  target:
    - AppImage
  category: Office
```

### `.github/workflows/build.yml`

```yaml
name: Build

on:
  # 手动触发：只构建、把产物放进 Actions 的 Artifacts，**不发 release**。
  workflow_dispatch:
  # 推 v* 标签就构建并发布。在网页上「创建 release」也会生成标签，同样会触发这条。
  push:
    branches:
      - main
    tags:
      - 'v*'
  pull_request:

jobs:
  check:
    # PR 与 main 的每次提交都过一遍，坏代码不会等到发版才暴露。
    if: github.event_name == 'pull_request' || (github.event_name == 'push' && github.ref == 'refs/heads/main')
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      # 版本由 package.json 的 `packageManager` 决定，这里不能再写 `with: version:`
      # （两边都写 pnpm/action-setup@v4 会直接拒绝运行）。
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - run: node scripts/check-plan-fences.mjs

  build:
    # 构建与发版只在手动触发和推标签时跑；main 的普通提交只走上面的 check。
    if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/v')
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            script: dist:mac
            # macOS 只出 dmg（arm64 + x64），不出 zip —— 见 electron-builder.yml
            artifact: release/*.dmg
          - os: windows-latest
            script: dist:win
            artifact: |
              release/*.exe
              release/*.zip
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      # 【这里**不能**再写 `with: version:`】package.json 里有 `packageManager: pnpm@11.21.0`，
      # action 会自己读它。两边都指定的话 pnpm/action-setup@v4 直接报错拒绝运行：
      #   Error: Multiple versions of pnpm specified:
      #     - version 11 in the GitHub Action config with the key "version"
      #     - version pnpm@11.21.0 in the package.json with the key "packageManager"
      # 这个错发生在**第一步**，后面全部跳过，两个平台的作业都在 26 秒内失败。
      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      # 【为什么要有这一步】产物名里的版本号取自 package.json（`WorkingTitle-v${version}-…`），
      # 而 release 的名字取自标签。两者不一致的话，你会得到一个叫 v0.2.0 的 release，
      # 里面的文件却写着 WorkingTitle-v0.1.0-mac-arm64.dmg——而且没人会在当下发现。
      # 直接失败，比发一个自相矛盾的版本强。
      # 放在 setup-node 之后，是为了保证 `node` 一定在 PATH 上。
      - name: 校验 tag 与 package.json 的版本一致
        if: startsWith(github.ref, 'refs/tags/v')
        shell: bash
        run: |
          tag="${GITHUB_REF_NAME#v}"
          pkg=$(node -p "require('./package.json').version")
          if [ "$tag" != "$pkg" ]; then
            echo "::error::标签是 v$tag，package.json 里是 $pkg。先把 version 改成 $tag、提交，再打这个标签。"
            exit 1
          fi
          echo "版本一致：v$tag"

      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm ${{ matrix.script }}
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.os }}-build
          path: ${{ matrix.artifact }}
          # 没产出就失败：否则会发布一个没有任何安装包的 Release。
          if-no-files-found: error

  release:
    # 只有推标签才发；手动触发的运行到上面那个作业为止。
    if: startsWith(github.ref, 'refs/tags/v')
    needs: build
    runs-on: ubuntu-latest
    permissions:
      # 【必须显式声明】本仓库的 Actions 默认权限是 read，不写这一行，创建 release 会 403。
      contents: write
      # 底下那个生成说明的脚本要 `gh pr list`（读 PR）。**这个块里写了的才给，
      # 没写的一律是 none** —— 所以上面那行 contents 不能省。
      pull-requests: read
    steps:
      # 【为什么这里要 checkout】本作业别的步骤都不碰仓库里的文件，而生成发布说明的
      # 脚本正是仓库里的一个文件。少了这一步，下一步会报「脚本不存在」。
      - uses: actions/checkout@v4
      # 把两个平台各自上传的 artifact 合并到一个目录。merge-multiple 是 v4 的关键参数，
      # 不加的话会下成 dist/macos-latest-build/… 和 dist/windows-latest-build/… 两层。
      - uses: actions/download-artifact@v4
        with:
          path: dist
          merge-multiple: true
      - name: 列出将要发布的文件
        run: find dist -type f | sort
      # 【为什么自己生成、不用 generate_release_notes】GitHub 那个的格式写死了三样
      # （`## What's Changed` / `by @用户 in <链接>` / `Full Changelog`），而
      # `.github/release.yml` 只配得了分类标题与标签映射，没有任何格式化开关。
      # 脚本产出的是「只要分类 + 标题 + 编号」，口径见 scripts/release-notes.sh 开头。
      - name: 生成发布说明
        env:
          # 【必须显式喂】`gh` 在 Actions 里不会自动带上凭据，少了这行它会说未登录。
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: bash scripts/release-notes.sh "$GITHUB_REF_NAME" > /tmp/notes.md
      # 按标签找 release：已经存在（你手动建的那个）就往里追加文件，不存在就新建一个。
      - uses: softprops/action-gh-release@v2
        with:
          files: dist/**/*
          # 正文取上面那个脚本产出的文件，不再走 GitHub 的自动生成。
          body_path: /tmp/notes.md
          draft: false
```
