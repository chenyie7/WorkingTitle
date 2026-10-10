# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

一个**外观伪装成 Microsoft Word 的 Electron 桌面应用**：导入 txt 小说后，用户在文档区打字时**不显示原字符**，而是按顺序抽出小说后续文本显示（默认 1 键 : N 字，N=10，范围 1–500）。

应用自身的身份是 **WorkingTitle**（`package.json` 的 `productName`、macOS 菜单栏、安装包、
`build/icon.svg` 的图标）。但**蓝条上那个 `Word` 与窗口标题 `文档1 - Word` 是刻意的**——
那是伪装本身，别"顺手统一"掉。

仓库里的文档与代码注释**一律用中文**，新写的注释并入这个风格。

## 命令

```bash
pnpm dev          # electron-vite dev（渲染层热更新）
pnpm build        # 构建到 out/ —— 手动跑 _electron 之前必须先跑这个，见下
pnpm typecheck    # 跑【两个】tsconfig，缺一不可（第二个是 core 纯净性的门禁）
pnpm test         # vitest，全部单测
pnpm vitest run tests/unit/engine.test.ts   # 跑单个文件
pnpm vitest run -t '合成中的 input'          # 按用例名筛
pnpm test:e2e     # 先 build 再 playwright（跑真 Electron 进程）
pnpm dist:dir / dist:mac / dist:win         # electron-builder 打包
```

**验收一律看 exit code，别只 grep 摘要行。** 本仓库出现过两类「摘要行看着是绿的」形态：
- unhandled rejection：用例行照旧 `passed`，只有汇总行多一条 `Errors 1 error`，而 exit code 是 1；
- 某个测试文件整体失败（例如缺了环境判断）：汇总行 `Test Files 1 failed | 15 passed`，而 `Tests 195 passed` 那行一个「failed」都没有。

## 架构

**Electron 三进程**，`electron-vite` 构建：

- `src/main/` — 文件 IO、编码检测、会话与缓存落盘、原生菜单、IPC handler
- `src/preload/` — 唯一的桥；`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` 不可放宽
- `src/renderer/` — React 19；持有一份**只读** `Novel` 并驱动引擎
- `src/core/` — 被 main 与 renderer **共享**的纯逻辑

### `src/core/` 的纯净性是被构建配置强制的，不是靠自觉

`tsconfig.node.json` 的 `lib` 是 `["ES2023"]`（**没有 DOM**）且 `include` 了 `src/core`，而 `pnpm typecheck` 会跑两个 tsconfig。所以在 `core` 里写 `document` / `window` 会直接编译失败。

`core` 内部也不是同一类东西：

| 模块 | 依赖 | 谁能用 |
|---|---|---|
| `types.ts` / `chapters.ts` / `engine.ts` | 只 import 相对路径 | main **和** renderer |
| `decode.ts` | `node:util`、`iconv-lite`、`jschardet` | **只有 main** —— 渲染进程引它会拉进 node 依赖 |

### 核心不变量

**阅读区显示的内容恒等于 `flatText.slice(revealStart, cursor)`**，除此之外阅读区不显示任何小说文字。导入的文本**运行期只读、永不修改**；用户感知到的一切「变化」都只是游标整数在动。改 `engine.ts` 前先读这一段与 spec §2。

### 输入是怎么进来的（最容易踩的地方）

所有按键都先落在一个**透明 textarea**（`.wt-input`，`InputCapture.tsx`）上，再被翻译成「抽字」指令。三件事必须同时成立：

1. **绝不能无条件 `preventDefault()` 掉所有 keydown** —— 那会彻底废掉中文输入法。
2. **合成期间不能清空那个 textarea** —— 清空会打断输入法的合成会话（真机现象：候选框闪一下就没、拼音永远上不了屏、正文一个字都不出）。而**单测抓不到**：`fireEvent` 造的合成事件在 jsdom 里清空 value 不会取消任何东西。
3. **那个 textarea 必须摆在与阅读光标重合的位置**，不能铺满整页 —— 它铺满整页时：输入法候选框会跟着它自己的光标跑到页面顶部；且 Chromium 会把「有焦点的可编辑元素的光标」滚进视野，把画布按回页首。

它还在 window 上挂了**抢焦点**（「点哪儿都能继续打字」用的），`focusIfNotTextInput` 里有**三条**豁免，都必要：

1. 点击目标是文字输入类元素（`input` / `textarea` / `select` / `contenteditable`）——不然工具栏里的比例框、设置对话框里的输入框会一点就失焦；
2. 点击目标在 `[role="dialog"]` 里；
3. **当前焦点已经在 `[role="dialog"]` 里**——这条挡的是「点按钮打开对话框那一下」：React 的事件层在 `#root`、监听在 `window`，冒泡到 window 时对话框已挂载、焦点已进输入框，而 `e.target` 还是那个工具栏按钮。少了它，`autoFocus` 会被抢走。

### 持久化

`userData`（可用 `WT_USER_DATA` 环境变量重定向，E2E 与便携模式用）下有 `session.json` 与 `novel-cache.*`。缓存分两个文件，靠 `NovelCacheMeta.textBytes` 当**提交点**自我校验——没有它，进程在两次写之间崩溃会读出「A 书的目录配 B 书的正文」。

### 外观与主题

**渲染层读不到系统外观。** 实测（Electron 44 / macOS 深色系统）：主进程
`nativeTheme.shouldUseDarkColors` 是 `true`，而渲染层 `matchMedia('(prefers-color-scheme: dark)')`
**恒为 false**；把 `themeSource` 手动设成 `'dark'`、甚至**整窗重载**之后仍然是 false。
所以 **`@media (prefers-color-scheme: dark)` 在本应用里永远不会命中**——主题只能由主进程经 IPC
（`wt:get-theme` / `wt:theme-changed` / `wt:set-theme-source`）递过来，渲染层写
`<html data-theme>`，CSS 按属性选择器取。**别把它"简化"回媒体查询。**

设置里的「外观」三选一落到 `nativeTheme.themeSource`，**不是只翻页面的 class**：macOS 的红绿灯
与其它原生部分由它决定，只改网页会出现「网页变浅了、红绿灯还是深色」。两个开关正交：
`data-theme` 管浅色/深色，`data-paper` 管「深色下纸张要不要也变暗」（默认不暗，跟真 Word 一致）。

**滚动条与原生控件（`<input type="checkbox">` 等）由 `color-scheme` 决定，不是 CSS 变量**——
`:root` 写 `light`、`[data-theme='dark']` 写 `dark`。深色下滚动条没跟着变、复选框是一块白，
都是漏了这条。

**macOS 上隐掉了原生标题栏**（`titleBarStyle: 'hiddenInset'`），红绿灯浮在网页上、落在标题条那一行。
于是标题条左侧要留 78px，而且**只在 `darwin` 上留**——平台由 preload 的 `process.platform` 经
`<html data-platform>` 带过来。标题条还需要 `-webkit-app-region: drag`，否则窗口拖不动。

### 图标

用 **`@fluentui/react-icons`**（微软官方图标集，MIT）——它就是 Office / Microsoft 365 在用的那套，
所以「像 Word」和「现代」在这里不冲突。两条规矩：

1. **名字必须带 `Regular` / `Filled` 后缀**（`TextBold` 不存在，只有 `TextBoldRegular` /
   `TextBoldFilled`）。写名字之前**先从包里枚举核对**，别凭记忆——`TextLineSpacing`、
   `TextGrammarCheckmark`、`DocumentMargins`（复数）这些都不是想当然的名字。
2. 每个图标用 `bundleIcon(Filled, Regular)` 包一层，那正是 Word 切换按钮的语义：
   **未按下画线框、按下画实心**。`src/renderer/src/components/icons.tsx` 是唯一的出口。

## 本仓库的硬约定

### 1. 实现计划里的代码围栏 = 源码的逐字节副本

`docs/superpowers/plans/2026-10-06-word-disguised-typing-reader.md`（9600+ 行，18 个 Task）里的 ` ```ts ` 围栏**不是示意，是源文件的副本**。口径：

```
md5(围栏原始内容) == md5(文件)      # 原样相等，含末尾换行；不要 rstrip
```

**改了源码（包括只改注释）就要同步改围栏。** 用 python 抽/写块（块内行整体替换、保留围栏行；多块按块索引**倒序** splice），别手抄。交付前用脚本重抽比对。

注意两个坑：
- 同一份代码在计划里可能出现多次，且**有些块是历史版本**（注定与当前文件不符）。判据是**正向**的：遍历全部源/测试文件，报告「没有任何围栏与它逐字节相等」的集合——那个集合必须是空的。
- 用锚点行定位围栏前**先确认它在计划里唯一命中**（`import type { Novel, PersistedSession }` 这类行会命中多次）。另外别把 `difflib.unified_diff` 喂给两个大字符串，会在 8000 行的计划上跑到超时——先落临时文件再 `diff`。

`docs/superpowers/specs/` 是面向人的设计文档，改行为时一并更新它。

### 2. 提交

- **`git add` 用显式路径，不要 `-A`。** 工作树里可能有别人的在途改动，以及未跟踪的用户素材 `books/`（一本 9MB 的真实小说，是测试语料，**不要入库**）。
- **`git commit -F <消息文件>`，不要内联 `-m`。** 内联消息里的 ASCII 双引号会**静默截断**提交信息，而 diff/stat/测试看起来全对，评审看不出来。

### 3. `out/` 被 gitignore —— 陈旧构建对 `git status` 完全隐形

做变异验证时改源码 + 跑 `pnpm build`（或 `pnpm test:e2e`，它自带构建）会把变异编进 `out/`；之后还原了**源码**、`git status` 干净、单测全绿，而 `out/` 里仍是变异产物。此时手动 `_electron.launch({args:['.']})` 量到的是**变异后的代码**，能得出完全错误的结论（本项目栽过一次，差点把「防抖是死代码」当成 bug 报出去）。

**规矩：手动跑 `_electron` 之前先 `pnpm build`；拿到负结果时先怀疑产物陈旧、重建再测。**

## 测试

- **vitest + jsdom，且没有装 `@testing-library/jest-dom`** —— 没有 `toBeInTheDocument()`，用 `toBeTruthy()` / `toBeNull()` / `getAttribute()` / `textContent`。
- `tests/setup.ts` 装了 `window.api` 替身（jsdom 里 preload 不跑）与 `ResizeObserver`（jsdom 不实现）。`tests/unit/guardA.test.ts` 是 `@vitest-environment node`，那里没有 `window`。
- **jsdom 没有布局**（`clientHeight`/`offsetLeft` 恒为 0），也**没有真实的焦点/命中测试语义**（testing-library 把 React 的 flush 推到事件派发之后，真机上的时序在 jsdom 里根本不存在）。
- **Playwright 的 Chromium 没有下载**，所以 `chromium.launch()` 用不了（报 browser not found）。
  本项目所有真机验证都走 `_electron` —— 它用仓库自带的 Electron，不受影响。需要把 HTML / SVG
  渲染成位图时（例如生成 `build/icon.png`），同样用 Electron 的 `webContents.capturePage()`。
- **凡涉及真实布局、真实焦点、输入法、候选框位置的结论，只有真机能判。** 用 Playwright 的 `_electron` 跑 `out/` 的构建产物：

  ```js
  // playwright 不是直接依赖，要从 .pnpm 路径引；且先 pnpm build
  const { _electron } = require('<repo>/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright')
  const app = await _electron.launch({ args: ['.', '<某本 txt>'], cwd: '<repo>',
    env: { ...process.env, WT_USER_DATA: '<mkdtemp 出来的空目录>' } })
  ```
  传一个**空的 `WT_USER_DATA`**，否则会读到开发时的会话，把「恢复旧会话」误当成「导入成功」。

  这个办法**能截图、能驱动交互、能取计算样式**；截图存 `/tmp` 后用 Read 工具看。但**截不到 macOS 原生标题栏**，也**看不到输入法候选框**（系统绘制、不在 DOM 里）——后者只能用代理指标（例如「textarea 的光标是否落在阅读光标处」），**不要声称验证了候选框位置**。
- 输入法相关的改动，`pnpm build` 之后**请用户用手上的中文输入法试一遍**，那才是验收。
