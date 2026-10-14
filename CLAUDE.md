# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

一个**外观伪装成 Microsoft Word 的 Electron 桌面应用**：导入 txt 小说后，用户在文档区打字时**不显示原字符**，而是按顺序抽出小说后续文本显示（默认 1 键 : N 字，N=10，范围 1–500）。

应用自身的身份是 **WorkingTitle**（`package.json` 的 `productName`、macOS 菜单栏、安装包、
`build/icon.svg` 的图标）。但**蓝条上那个 `Word` 与窗口标题 `文档1 - Word` 是刻意的**——
那是伪装本身，别"顺手统一"掉。

仓库里的**代码注释、CLAUDE.md、spec/plan 这类开发文档一律用中文**，新写的并入这个风格。

**但 README 是双语的，改的时候别只改一份**：

| 文件 | 语言 | 谁在看 |
|---|---|---|
| `README.md` | **英文** | GitHub 首页与 Release 页面默认显示的就是它 |
| `README.zh-CN.md` | 中文 | 从英文版顶部那行跳过去 |

两份顶部互相跳转，**结构与标题一一对应**（同样的二级/三级标题、同样的顺序）。改一份就同步另一份——
别看到 `README.md` 是英文就"顺手统一"成中文，那是刻意的布局（Vue / Vite 这些双语项目都是这个排法）。

## 命令

```bash
pnpm install      # 会跑 postinstall 把 Electron 二进制下下来，见下
pnpm dev          # electron-vite dev（渲染层热更新）
pnpm build        # 构建到 out/ —— 手动跑 _electron 之前必须先跑这个，见下
pnpm typecheck    # 跑【两个】tsconfig，缺一不可（第二个是 core 纯净性的门禁）
pnpm test         # vitest，全部单测
pnpm vitest run tests/unit/engine.test.ts   # 跑单个文件
pnpm vitest run -t '合成中的 input'          # 按用例名筛
pnpm test:e2e     # 先 build 再 playwright（跑真 Electron 进程）
pnpm dist:dir / dist:mac / dist:win         # electron-builder 打包
```

**产物名在 `electron-builder.yml` 里显式写死，别删那几行 `artifactName`。** 两个原因：

- 默认模板 `${productName}-${version}-${arch}.${ext}` 里，`expandMacro` 在 arch 为空时会**把
  `-${arch}` 整段删掉**，于是 Intel 那个 dmg 出来是 `WorkingTitle-0.1.0.dmg`，与 arm64 的分不清。
- **`${platform}` 宏展开的是 `process.platform`——构建机的平台**，不是目标平台。在 Mac 上打
  Windows 包会得到 `darwin`。所以平台名只能在 `mac:` / `win:` / `linux:` 段里各写一遍。

产物名里那个 `v`（`WorkingTitle-v0.1.0-mac-arm64.dmg`）是**模板里的字面量**，写在 `${version}`
前面即可。**别去改 `package.json` 的 `version` 加 `v`**：那个值会流进 macOS 包的
`CFBundleShortVersionString` / `CFBundleVersion`（实测打出来的 .app 里就是 `0.1.0`），而 Apple
要求这两个键是**纯数字点分**的，带上 `v` 是无效值。

另外 `dist:mac` 只出 dmg（arm64 + x64 各一个），不出 zip；`dist:win` 出 `.exe` 与免安装 `.zip`。
从 GitHub Releases 拉 Electron 二进制不稳，断了就重跑（已下的那份有缓存），或加镜像
`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`——**注意 `.npmrc` 那条路在 pnpm 下不生效**
（实测 `npm_config_electron_mirror` 不会被传进去），只有环境变量管用。

**Electron 二进制不会被自动下下来，`pnpm dev` 会报 `Error: Electron uninstall`。** electron 44 起
**取消了 `postinstall`**，二进制改由 `electron/index.js` 在**首次 `require('electron')` 时惰性下载**；
而 electron-vite 的 `getElectronPath()` 只做 `require.resolve('electron')` + 直接读 `electron/path.txt`，
**从不 `require` 它**，所以那次下载永远不触发，读不到 `path.txt` 就抛这个错。
本仓库靠根 `postinstall: install-electron` 兜住（`install-electron` 是 electron 自己声明的 bin，幂等，
已装则 `exit 0`）。

这个坑**在装了 node_modules 的机器上完全看不见**（早先某次 e2e 已经把它下下来了），
**只有全新 clone 才炸**——所以别用「我这儿是好的」判断它。两件事别搞混：

- `pnpm-workspace.yaml` 的 `allowBuilds` 与它**无关**（名单里的 `esbuild` / `electron-winstaller` 是
  真有构建脚本的）；electron 本身没有构建脚本，加进去也没用。
- 根 `postinstall` 只在**真正执行安装**时跑。`node_modules` 已就绪时 `pnpm install` 会打印
  `Already up to date` 并**跳过全部生命周期脚本**——想复验得换一个空的目录装。

国内下载慢/失败时设镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

**验收一律看 exit code，别只 grep 摘要行。** 本仓库出现过两类「摘要行看着是绿的」形态：
- unhandled rejection：用例行照旧 `passed`，只有汇总行多一条 `Errors 1 error`，而 exit code 是 1；
- 某个测试文件整体失败（例如缺了环境判断）：汇总行 `Test Files 1 failed | 15 passed`，而 `Tests 195 passed` 那行一个「failed」都没有。

## 架构

**Electron 三进程**，`electron-vite` 构建：

- `src/main/` — 文件 IO、编码检测、会话与缓存落盘、原生菜单（**只有 macOS 建**，见「原生菜单」一节）、IPC handler
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

**小说与 `.txt` 工作文档：阅读区显示的内容恒等于 `flatText.slice(revealStart, cursor)`**，除此之外阅读区不显示任何小说文字。

**`.md` 工作文档：显示出来的文字等于「已揭示那一段去掉语法记号之后」的文字**，此外不显示任何未揭示的字符；只有已经开始（起始偏移 < cursor）的块才画结构骨架，骨架里不含未揭示的字符。也就是说，「按字符揭示」这套机制没有变，变的是**同样的字符在屏幕上长什么样**——`#`、`**`、`|` 是字符但不作为字形出现，表格与图片的框会提前占位。改这一路之前先读 `docs/superpowers/specs/2026-10-14-markdown-rendering-design.md` 的第 3.1 / 3.2 / 5 三节。

导入的文本**运行期只读、永不修改**；用户感知到的一切「变化」都只是游标整数在动。改 `engine.ts` 前先读这一段与 spec 第 2 节。

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

**标题栏也是网页画的，两个平台都是。** `src/main/index.ts` 的 `titleBarOptions(dark)`：
macOS 用 `hiddenInset`（红绿灯浮在网页上），Windows 用 `hidden` + `titleBarOverlay`（系统仍画
右上角那三个按钮、按 `titleBarOverlay.color` 上色，但**不画标题文字**）。Linux 返回空对象、保留
系统标题栏。

为什么非要交出去：默认标题栏的底色跟随系统外观与强调色，**应用改不了**——而网页里的标题条用的是
自己的颜色，两者对不上。交出去之后那一块归我们上色，也顺带没有了「原生标题条 + 网页里再画一条」
的两条标题条。

三个必须知道的连带后果：

- **标题条是窗口唯一的拖动区**（`ribbon.css` 里 `[data-platform]` 那两条的 `-webkit-app-region: drag`），
  不设窗口就拖不动。平台由 preload 的 `process.platform` 经 `<html data-platform>` 带过来。
- **标题居中**，所以两侧**对称**留白：macOS 各 78px（让开三个红绿灯 + 间距约 52px，从 x=14 起）、
  Windows 各 150px（让开约 138px 的按钮区）。只留一侧会把标题顶偏。
- **`TITLEBAR_LIGHT` / `TITLEBAR_DARK`（主进程）与 `--wt-titlebar` / `--wt-titlebar-text`（CSS）
  是两处独立副本**，因为 `titleBarOverlay` 吃的是 JS 字面量、读不到 CSS 变量。改一处必须同步另一处，
  否则按钮那一小块底色会和蓝条差一档。`WINDOW_BG_*` 早就是同样的成对关系。

翻主题时 `nativeTheme.on('updated')` 里要显式 `setTitleBarOverlay`——那三个按钮是**系统**画的，
不会自己跟着变。**`--wt-titlebar` 同时是功能区标签条的底色**（两条合成一整块蓝，真 Word「彩色」
主题的样子），但**深色下标签条不跟它**（固定 `#191919`）：选中页签的底色与功能区同为 `#202024`，
标签条若只差一档，「选中页签连成一片」就看不出来了。

### 功能区（Ribbon）

七个选项卡（文件/开始/插入/布局/引用/审阅/视图）的内容都在
`src/renderer/src/components/Ribbon.tsx` 的 `TABS` 表里，分组与顺序对着真 Word 排。
**全部是占位**——本应用的真实功能只有设置对话框里那几项，功能区的作用是让人一眼看去像 Word。

`ToolbarItem` 有六种 kind（见 `Toolbar.tsx`）：`toggle` / `placeholder` / `settings` 是最初三种；
补密度时加了 `combo`（字体名、字号、行距）、`gallery`（样式库，`AaBbCc` 预览）、`split`
（主按钮 + 展开箭头，下划线 / 项目符号 / 编号）。

**三条不能踩的：**

1. **绝不能用原生 `<select>` 做下拉。** 全应用的按键挂在 `InputCapture` 那个 textarea 的
   `onKeyDown` 上（**不是 window**），而 `focusIfNotTextInput` 的豁免名单里**有 `select`**——
   那是给设置对话框用的。原生 `<select>` 一点下去焦点就留在它身上，之后敲键盘**既不打字也不抽字**，
   应用等于废了。所以 `combo` 是 `<button>` + 一列 `<button>`：按钮类不在豁免名单里，`mousedown`
   时焦点会被自动抢回 textarea。**推论：任何新增的可交互控件，先问它在不在 `TEXT_INPUT_SELECTOR` 里。**
2. **下拉面板必须 portal 到 body。** `.wt-toolbar` 有 `overflow-x: auto`（窄窗口横向滚动）；
   按 CSS 规则，一个轴不是 `visible` 时另一个轴也会变成 `auto`，绝对定位的面板会被**裁掉**。
3. **组内是「两行按列填充」，所以数组顺序必须按对写。** `.wt-group__body` 是
   `grid-auto-flow: column` + `grid-template-rows: repeat(2, auto)`，大按钮 / combo / gallery
   加 `grid-row: span 2` 占满整列。于是**相邻两项自然成上下两格**——顺序按「重要性」乱排会排出
   「清除格式压在加粗上面」这种没道理的配对（第一版就是这么翻车的）。两组的注释里都写了别重排。

### 原生菜单

`buildAppMenu` **只在 macOS 真的建菜单**，非 darwin 直接 `Menu.setApplicationMenu(null)`。
Windows / Linux 的原生菜单栏渲染在**窗口内部**、标题栏正下方那一行，而真 Word 那个位置是功能区——
一条「文件 编辑 视图 帮助」横着就把伪装拆了。macOS 的菜单在**屏幕顶部**，每个 Mac 应用都有，
不构成破绽，而且 ⌘Q / ⌘H / ⌘C 这些系统级快捷键靠它。

没用 `setMenuBarVisibility(false)`：那是「菜单还在、只是藏起来」，藏得干不干净取决于平台行为
（`autoHideMenuBar` 与 Alt 键的交互）。`setApplicationMenu(null)` 是确定没有菜单。

代价（仅 Windows / Linux）：失去 `Ctrl+O`（导入改从设置对话框进）与撤销/重做等 `role`；
**但可编辑元素里的 Ctrl+C/V/X/A/Z 由 Chromium 自己处理，与菜单无关**。

### 图标

用 **`@fluentui/react-icons`**（微软官方图标集，MIT）——它就是 Office / Microsoft 365 在用的那套，
所以「像 Word」和「现代」在这里不冲突。`src/renderer/src/components/icons.tsx` 是唯一的出口，
现在导出约 200 个。三条规矩：

1. **每个图标用 `bundleIcon(Filled, Regular)` 包一层**，那正是 Word 切换按钮的语义：
   **未按下画线框、按下画实心**。
2. **名字必须带 `Regular` / `Filled` 后缀**（`TextBold` 不存在，只有 `TextBoldRegular` /
   `TextBoldFilled`）。
3. **写名字之前先从包里枚举核对，别凭记忆。** 这个包的取名很不直观，两个方向的意外都有：

   - 看着该有、**确实有**：`TextColor`、`TextLineSpacing`、`TextGrammarCheckmark`、
     `DocumentMargins`（复数）、`PositionToFront` / `PositionToBack`、`BoardSplit`
   - 看着更顺、**偏偏没有**：`FontColor`、`Shading`、`MultilevelList`、`CoverPage`、`BlankPage`、
     `Object`、`Endnote`、`Index`、`Hyphen`、`Breaks`、`BringToFront`、`SelectionPane`、
     `CommentDelete`、`CommentPrevious` / `CommentNext`、`DocumentCompare`

   第二类各自换了替代（`DocumentOnePage` / `DocumentOnePageAdd` / `SelectObject` /
   `DocumentEndnote` / `ItemCompare` 等），换的时候都在 `icons.tsx` 里写了注释。

枚举的办法——包有 CJS 构建，在**仓库根目录**下直接 `require` 即可（放进 `/tmp` 会解析不到包）：

```bash
node -e '
const m = require("@fluentui/react-icons");
const all = Object.keys(m).filter(n => n.endsWith("Regular") && !/\d+Regular$/.test(n) && !n.includes("Color"));
for (const k of process.argv.slice(1)) console.log(k, "→", all.filter(n => n.toLowerCase().includes(k.toLowerCase())).slice(0,8).map(s=>s.replace(/Regular$/,"")).join("  "));
' Indent LineSpacing Margins
```

两个过滤条件**各有一个坑，都实测踩过**：

- 滤数字尺寸变体必须写 `!/\d+Regular$/`，**不能写 `!/\d+$/`**——名字是以 `Regular` 结尾的，
  数字在中间，所以 `/\d+$/` 永远匹配不到，`TextLineSpacing16Regular` 之类会全漏出来。
- `!n.includes("Color")` 会把 **`TextColor` 一起滤掉**（`FontColor` 不存在、`TextColor` 存在，
  偏偏后者被滤掉）。搜颜色相关的词时把这个条件去掉。

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

### 2. 发布

发版是「改版本号 → 打标签 → CI 自动出包并挂到 Release」，**不需要本地打包**：

```bash
# 1. 先改 package.json 的 version（产物名里的版本号取自它）
# 2. 提交
git commit -am "chore: 发布 v0.2.0"
# 3. 打标签并推 —— 这一步触发 CI
git tag v0.2.0 && git push origin v0.2.0
```

`.github/workflows/build.yml` 会：校验标签与 `package.json` 的 version 一致 → 在 macOS 与
Windows 上各自原生构建 → 用 `softprops/action-gh-release` 把文件挂到该标签的 Release 上。

三件必须知道的：

- **版本号对不上会直接失败。** 产物名是 `WorkingTitle-v${version}-…`，取自 `package.json`；
  release 名取自标签。不一致就会发出一个叫 `v0.2.0`、文件却叫 `WorkingTitle-v0.1.0-…` 的
  release，且当场没人会发现——所以加了校验步骤，宁可失败。
- **`release` 作业必须显式写 `permissions: contents: write`。** 本仓库 Actions 的默认权限是
  `read`（`gh api repos/chenyie7/WorkingTitle/actions/permissions/workflow` 可查），
  不写这行创建 release 会 403——这是「CI 全绿但 release 没出来」最常见的原因。
- **在网页上「创建 release」也会触发**（它会生成标签），但那样容易踩版本号不一致那条。
  推荐先改 version 再打标签。想先人工审一遍，把工作流里 `draft: false` 改成 `true`。
- **`dist:mac` / `dist:win` 末尾那两句 `--publish never` 不能删。** electron-builder 在 CI 里
  遇到标签构建会**自动启用发布**，于是去找 `GH_TOKEN`；找不到就报错退出——
  ```text
  ⨯ GitHub Personal Access Token is not set, neither programmatically, nor using env "GH_TOKEN"
  ```
  症状很有迷惑性：**安装包其实已经打好了**（日志里能看到 `• building target=DMG …`），
  只是最后一步白跑。发布统一交给 `release` 作业里的 softprops 做——不让两个平台的构建作业
  各自去建 release，那样会有竞态。

没有配自动更新（`electron-builder.yml` 里没有 `publish` 段），所以 Release 只是给人下载用的；
打包时 Electron 那边生成的那个 `latest-mac.yml` 用不上，也没被传上去。

#### 发布说明怎么分组 —— 这步要人做

`generate_release_notes: true` 生成的那段文字由 `.github/release.yml` 按 **PR 的标签**分组。
按标签分组是 GitHub 的功能限制（它读不到提交信息的 `feat:` / `fix:` 前缀），**所以绕不过去**：

**开 PR 时打上标签**，否则该 PR 会全部落进「其它改动」那一类。

| 标签 | 归到哪一类 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修复 |
| `docs` | 文档 |
| `chore` / `style` / `refactor` | 内部改动 |
| `skip-changelog` | **不进发布说明**（纯内部改动、依赖升级用） |

这几个标签**已经建好了**（`gh label list` 可查）；漏建的话配置不报错，只是空转。
标签名刻意与提交前缀一一对应，打标签时照着提交开头抄一下即可。

嫌这一步烦的话，出路是换 release-please 那类**读提交前缀、不需要标签**的工具——但那是另一套
机制（它还会自动开"发布 PR"），换之前先想清楚。

### 3. 提交

- **`git add` 用显式路径，不要 `-A`。** 工作树里可能有别人的在途改动，以及未跟踪的用户素材 `books/`（一本 9MB 的真实小说，是测试语料，**不要入库**）。
  - **提交前先 `git branch --show-current`。** 曾经在「以为还在分支上、其实已经被切到 main」的状态下提交过，`git add` 用的是显式路径却仍被暂存区里已有的东西带进去。光用显式路径不够。
- **`git commit -F <消息文件>`，不要内联 `-m`。** 内联消息里的 ASCII 双引号会**静默截断**提交信息，而 diff/stat/测试看起来全对，评审看不出来。
- **`docs/screenshot.png` 里含 `books/` 那本小说的真实内容**（书名、章节名、约 600 字正文）——它是拿那本书实拍出来的。这与 `books/` 不入库的理由（版权）是冲突的，**作者知情并决定保留**。重新生成截图时要意识到这一点，别在无意中把更多内容带进去。

### 4. `out/` 被 gitignore —— 陈旧构建对 `git status` 完全隐形

做变异验证时改源码 + 跑 `pnpm build`（或 `pnpm test:e2e`，它自带构建）会把变异编进 `out/`；之后还原了**源码**、`git status` 干净、单测全绿，而 `out/` 里仍是变异产物。此时手动 `_electron.launch({args:['.']})` 量到的是**变异后的代码**，能得出完全错误的结论（本项目栽过一次，差点把「防抖是死代码」当成 bug 报出去）。

**规矩：手动跑 `_electron` 之前先 `pnpm build`；拿到负结果时先怀疑产物陈旧、重建再测。**

### 5. 合并方式与分支卫生

合并 PR 用 **squash** 或 **merge commit**；用 **rebase merge** 就必须**合完立刻删分支**。

rebase merge 会把分支的提交**重放**到 main 上、SHA 全变，于是分支上原来那批提交不再是 main 的祖先。
**但 main 本身没有被改写**（新提交是在旧提交之上累加的，旧的那个 tip 仍是祖先）——所以别的机器
`git pull` 一律正常。需要"对齐"的是**分支**，不是 main，别去 reset main。

真正的坑是**「合完还留在原分支上继续提交」**：那样新旧两批提交真的岔开，再开 PR 时 GitHub 按
merge-base 算 diff，**整个项目都会显示成新增**（PR 页面没法看）。本项目已经栽过三次，每次都是这一步。

**规矩：从 main 切新分支，不要在已合并的分支上继续。**

清陈旧分支：`git push origin --delete <b1> <b2>` + `git branch -D <b1> <b2> <b3>`。
判据与 `out/` 那类一样是**正向**的——先确认「分支有、main 没有的文件」为空
（`git diff --diff-filter=D --name-only origin/<branch> origin/main`），再删。

**main 上有一个 ruleset，但它可能"配了但没生效"**——`enforcement` 字段是 `disabled` 的话等于没配：

```bash
gh api repos/chenyie7/WorkingTitle/rulesets --jq '.[] | {name, enforcement}'   # 看状态
gh api repos/chenyie7/WorkingTitle/rulesets/<id> --jq '.rules[].type'          # 看规则
```

配置本身是：禁止删除 main、禁止强推、必须走 PR（`required_approving_review_count: 0`——单人仓库
设成 1 会把自己锁死，GitHub 不允许你批准自己的 PR）、无人豁免。生效之后**直接 `git push origin main`
会被拒**，所有改动都得走 PR。改 `enforcement` 只需在网页上 ruleset 页把 Enforcement status 切成
Active，或 `gh api -X PUT repos/chenyie7/WorkingTitle/rulesets/<id> -f enforcement=active`。

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
