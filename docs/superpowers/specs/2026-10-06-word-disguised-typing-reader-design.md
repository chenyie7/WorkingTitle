# 伪装成 Word 的打字阅读器 —— 设计文档

日期：2026-10-06
状态：待用户审阅

## 1. 目标

做一个外观与 Microsoft Word 高度相似的桌面应用。用户导入 txt 小说后，在文档编辑区打字时**不显示自己输入的原字符**，而是从小说中按顺序取出后续文本显示出来，造成"我在写这本书"的视觉效果（摸鱼场景）。

可设置比例：**输入 1 个字，显示小说 N 个字**（默认 10，范围 1–500）。

### 唯一必须真实可用的功能

1. 导入 txt 小说（含编码自动检测）
2. 打字替换显示小说内容
3. 比例设置

### 明确不做的功能

加粗/斜体/下划线等格式、导出 docx、撤销重做、查找替换、拼写检查、真实排版。这些按钮**必须存在且可点击、点击有可见反馈**，但不实现真实功能。

## 2. 核心数据模型

这是整个项目最容易做错的地方，先定死。

**导入的小说文本是只读的，运行期永不修改。** 应用只维护游标整数。

```ts
interface Chapter {
  index: number
  title: string
  start: number      // 在 flatText 中的起始偏移（含）
  end: number        // 结束偏移（不含）
  charCount: number
}

interface Novel {
  title: string            // 文件名（去扩展名）
  sourcePath: string
  encoding: string         // 检测到的编码名，如 'UTF-8' / 'GBK'
  hadBom: boolean
  flatText: string         // 所有章节首尾相接（含标题行本身），保留原始换行
  chapters: Chapter[]
}
```

`flatText` 是唯一的字符来源。章节的 `start/end` 把 `flatText` 划成互不重叠、连续无缝的区间：

- `chapters[0].start === 0`
- `chapters[i].end === chapters[i + 1].start`
- `chapters[last].end === flatText.length`

### 引擎状态

```ts
interface EngineState {
  cursor: number            // 下一个要被抽出来的字符下标；唯一进度指针
  revealStart: number       // 当前显示窗口的起点
  chapterPos: number[]      // 每章"上次停留位置"（章内相对偏移），长度 === chapters.length
  activeChapter: number     // cursor 所在章
  ratio: number             // N
  mode: 'ime' | 'key'       // 输入模式
  startedAt: number | null  // 首次打字时间戳，用于状态栏计时
}
```

**显示内容恒等于** `flatText.slice(revealStart, cursor)`。除它以外阅读区不显示任何小说文字。

### 状态迁移

| 操作 | 迁移 |
|---|---|
| `pump(k)`（输入 k 个字） | `cursor = min(cursor + k * ratio, flatText.length)`；`revealStart` **不变** |
| `backspace(k)` | `cursor = max(revealStart, cursor - k * ratio)`；`revealStart` **不变** |
| `jumpToChapter(i)` | `cursor = chapters[i].start + chapterPos[i]`；`revealStart = chapters[i].start` |
| `setRatio(n)` | 只改 `ratio`，不动游标 |

**统一收尾规则**：任何一次游标变化之后，统一执行

```
activeChapter            = cursor 所在章（cursor === flatText.length 时取最后一章）
chapterPos[activeChapter] = cursor - chapters[activeChapter].start
```

于是 `chapterPos[c]` 恒等于「上次离开第 c 章时，光标停在该章内的偏移」。这条规则同时覆盖了正向打字、退格、以及跨章打字的情况，不需要为每种操作单独规定 `chapterPos` 怎么变。

#### 关键语义澄清

- **`revealStart` 在打字时不变**，因此跨章节打字时阅读区是**连续的**，不会在章节边界清空或跳变。这是刻意的。
- **退格只回吐显示，不改小说内容。** `cursor` 回退，`flatText` 一个字节都不动。
- **点击章节 = 跳转到该章，并回填该章上次的阅读进度。** 跳到已读过的章会立即看到上次读到的内容，跳到没读过的章阅读区为空白。无论哪种，都只是移动游标。
- **当前章节 = `cursor` 所在章**，打字推进时左侧列表高亮自动跟随并滚动到可见区域。
- **永不批量吐出整章。** 阅读区出现多少字完全由 `cursor - revealStart` 决定。

### 边界情况

- 游标抵达 `flatText.length` 时 `pump` 为无操作，状态栏提示"已读完全书"；此时 `activeChapter` 取最后一章。
- `backspace` 在 `cursor === revealStart` 时为无操作。
- 已知边界：若一路退格退到 `revealStart`，且该位置正好是一章的开头，则该章的 `chapterPos` 被记为 0，之后跳回该章会显示空白。这是"统一收尾规则"的必然结果，语义上自洽（你的位置确实就是窗口起点），不做特殊处理。
- 章节之间无缝拼接，`chapterPos` 与 `cursor` 始终按上述规则同步，不存在"章内偏移"越界的情况。
- `ratio` 改动后立即生效，只影响后续输入，不回改已经显示出来的内容。
- 输入模式的切换同样只影响后续输入，不影响已显示内容。

## 3. 架构

Electron 三进程，解析逻辑与显示逻辑严格分离。

```
electron/
  main.ts          Electron 主进程：窗口、原生菜单、文件对话框、IPC、会话持久化
  preload.ts       contextBridge 暴露极窄 API
  ipc.ts           IPC 通道定义与处理函数注册
src/
  core/            ★ 纯 TypeScript，零 DOM、零 Electron、零 React，100% 单测覆盖
    decode.ts      编码检测与解码
    chapters.ts    章节切分
    engine.ts      TypingEngine（游标状态机）
    types.ts       共享类型
  renderer/
    App.tsx
    components/    Ribbon / Toolbar / ChapterList / Page / StatusBar / Toast
    input/         InputCapture（隐藏 textarea + IME 处理）
    state/         React 绑定（useSyncExternalStore）
```

**关键决策：`src/core/` 不 import 任何 Electron / React / DOM API。** 解码、切分、游标推进是这个项目里唯一有 bug 风险的逻辑，做成纯模块后可以在 Node 下用 Vitest 直接跑，不必启动 GUI。

**进程职责划分**：主进程负责读文件、检测编码、解码、切分章节，然后把 `{ chapters, flatText, encoding }` 通过 IPC 发给渲染进程（几 MB 字符串的 structured clone 开销可接受）。渲染进程只持有一份 `Novel` 并驱动 `TypingEngine`。若实测量到超大 txt（>20MB）在这一步卡顿，再改为分片传输（见 §13）。

**安全基线**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。渲染进程拿不到 `fs`，只能调 preload 暴露的白名单方法。

### IPC 契约

```ts
// preload 暴露为 window.api
interface Api {
  importNovel(): Promise<Novel | null>       // null = 用户取消
  loadSession(): Promise<PersistedSession | null>
  saveSession(s: PersistedSession): Promise<void>
  clearSession(): Promise<void>
  onMenuCommand(cb: (cmd: MenuCommand) => void): () => void
}
```

`MenuCommand` 覆盖原生菜单项（`import-novel` / `about` / `toggle-devtools` 等），供主进程菜单与渲染进程 Ribbon 联动。

## 4. 输入模型

输入捕获用一个**覆盖在页面上的透明 `<textarea>`**，始终持有焦点。用户点击阅读区任何位置都重定向焦点回它。

**绝不对 `keydown` 无差别 `preventDefault()`** —— 那会把中文输入法整个禁掉。分模式处理：

### 模式 A：中文输入法友好（默认）

- 监听 `compositionend`，`e.data.length` 即本次上屏字数 → `pump(e.data.length)`
- 拼音候选字母留在系统 IME 候选框里，**不进入正文**
- `input` 事件里立即清空 textarea（`value = ''`），保证它始终是空的按键接收器
- `compositionstart` / `compositionupdate` 不产生任何抽字

### 模式 B：纯按键

- `keydown` 命中可打印键（`key.length === 1` 且无 `ctrl/meta/alt`）→ `pump(1)` + `preventDefault()`
- 适合英文输入、乱敲、自动化测试

### 两模式共用

- `Backspace` → `backspace(1)` + `preventDefault()`，**但合成中必须放行**：判断条件是 `e.nativeEvent.isComposing === true`（React 的合成事件不暴露 `isComposing`，取到的是 `undefined`，必须读 `nativeEvent`）。合成期间退格是输入法用来删除未上屏拼音的，拦截会让用户删不掉自己打错的拼音，同时正文莫名回退——这与 §4 开头「绝不对 keydown 无差别 preventDefault」是同一条原则，此前本节漏了
- 方向键、Home/End、PageUp/PageDown 交给页面滚动
- 光标是一个**在文字层里闪烁的 `<span>`**（因为真正的 textarea 是透明的），位置紧随 `cursor` 之后
- 模式切换按钮在工具栏，切换时给 toast 提示当前模式

### 输入法兼容性说明

Playwright 无法真实模拟系统 IME 的 `compositionend`，因此 IME 模式通过**派发合成的 CompositionEvent** 做单元级验证，纯按键模式通过 Playwright `keyboard.type()` 做端到端验证。真实的微软拼音 / 搜狗输入法需要在 mac 与 Windows 上各手动验证一次。

## 5. 界面

### 5.1 顶部 Ribbon

七个选项卡：**文件 / 开始 / 插入 / 布局 / 引用 / 审阅 / 视图**，点击可切换，切换时下方工具组内容随之变化。

`文件` 选项卡内含 **"导入小说 Ctrl+O"**、**"清除阅读记录"**、**"关于"**、**"退出"**。其中"导入小说"与"清除阅读记录"有真实功能，其余为占位。

### 5.2 工具栏按钮

加粗、斜体、下划线、删除线、字体、字号、格式刷、项目符号、编号、对齐（左/中/右/两端）、行距、查找替换、导出 docx、撤销、重做、比例设置、输入模式切换。

**每个都必须可点击且有可见反馈**：

- 格式类按钮（B/I/U/对齐/项目符号等）→ 切换按下态（高亮），纯视觉，不影响文本
- 动作类按钮（导出 docx/查找替换/格式刷等）→ 弹出 toast「演示占位功能，未实现」
- 比例设置、输入模式切换 → 真实生效

按钮统一由 `ToolbarContext` 驱动；按钮定义收敛成一个数组，新增按钮只改数据不改结构。

### 5.3 左侧章节列表

- 显示 `chapters[]` 的标题；小说可能上千章，使用虚拟滚动
- 当前章（`activeChapter`）高亮，打字推进时自动滚动到可见区域
- 点击 → `jumpToChapter(i)`
- 顶部显示书名、总章数
- 每章右侧显示该章读到的百分比（由 `chapterPos[i] / charCount` 得出），作为进度提示

### 5.4 中间白色页面

A4 纸样式：白底、圆角、投影、衬线字体（`Georgia` / `宋体` 回退）、舒适行高与页边距、垂直可滚动。

**性能护栏**：阅读区文本窗口可能持续增长。当 `cursor - revealStart > 30,000` 字时，只渲染窗口末尾 30,000 字，并在顶部显示「……已折叠前文 N 字（点击展开）」。默认折叠，点击可展开全部。

### 5.5 底部状态栏

`已显示 12,340 / 全书 328,000 字` · `第 12 章 / 共 87 章` · `比例 1:10` · `编码 UTF-8` · `输入模式 输入法` · `用时 00:42:13` · 右侧页码样式的百分比。

空状态（未导入）显示引导文案：「文件 → 导入小说，或按 Ctrl+O」。

## 6. 编码检测

`decode.ts` 流程：

1. 空 `Buffer` 直接返回空文本
2. 检查 BOM：UTF-8 BOM / UTF-16 LE / UTF-16 BE → 剥离 BOM 后按该编码解码
3. 无 BOM → 用**严格模式**试解 UTF-8（`TextDecoder('utf-8', { fatal: true })`）：成功即认定为 UTF-8 并返回。合法 UTF-8 是极强的信号，GBK 中文几乎不可能碰巧通过续字节校验
4. 否则 `jschardet.detect(buf)` 取编码名，构造候选列表：GB* 系列统一换成 `GB18030`，`ASCII` 换成 `UTF-8`，其余用原名
5. **GB18030 兜底的条件性追加**：仅当 jschardet 给不出编码，或给的是单字节拉丁系（`windows-125x` / `ISO-8859-*` 这类对中文的常见误判）时，才把 `GB18030` 追加进候选。若 jschardet 已明确指出一个多字节 CJK / Unicode 编码（`Big5` / `CP932` / `Shift_JIS` / `EUC-JP` / `EUC-KR` / `CP949` / `JOHAB` / `UTF-16` / `UTF-32`），**不追加**
6. 候选逐个解码，按打分择优：`(CJK 表意文字 U+4E00–U+9FFF 占比 × 1000) − (U+FFFD 替换字符数 × 100)`。同分时保留先出现的候选（即优先采信 jschardet 的判断）。**候选列表为空时按 `GB18030` 解码**——当 jschardet 给出的编码名 `iconv-lite` 不认识时会出现（例如 `Johab`），此时 GB18030 恰好是救命的那个
7. 归一化换行 `\r\n` / `\r` → `\n`

**为什么第 5 步必须带条件**：`scoreText` 奖励的是 CJK 表意文字占比，而 GB18030 会把**任意字节对**映射进该区。于是对日文/韩文，正确解码（大量平假名/片假名/谚文，不在该区）几乎拿不到分，而 GB18030 乱码反而拿高分，被误选。

实测得分——**注意 `scoreText` 是占比比值、随文本而变，下列数字只是某一组样本的观测结果，不是编码的固有属性**，换一段文本数字就变，不要在别处当定论引用：Shift_JIS 正确 400 / 乱码 1000；EUC-KR 正确 0 / 乱码 737。

**反面：不要试图靠"只按 U+FFFD 数量打分"来修**。GB18030 几乎把所有字节对都映射到某个字符，乱码里的替换字符数同样≈0，两边打平，救不了；也不能"只在 GB 家族内比较"，那会让目前正确的 Big5 / KOI8-R / Windows-1251 全部变成错选。

（本节此前描述的"仅当 GB* 或 confidence < 0.8 时才纠偏"与实现不符，且实测该条件对上述日韩场景同样成立——CP932 的 confidence 是 0.766，一样低于 0.8——所以原描述既没反映实现、也解决不了这个问题。另：原第 4 步称"jschardet 结果不在 iconv-lite 支持列表里时回退 UTF-8"，与实现相反——实际回退到 `GB18030`，这也正是上面 `Johab` 那个场景能被救回来的原因。）

**第 5 步这个条件只收窄了失效面，并没有消除这一类缺陷——不要把它当成保证。** 根因是 `scoreText` 在**跨文字系统**之间比较得分，所以凡是"整段几乎没有汉字"的输入都可能误选，靠增删候选名单救不了。实测仍会误选的两个场景：

- **GBK 编码的纯符号串**（如 `①②③④⑤⑥⑦⑧⑨⑩`）：jschardet 报 `Windows-1251`（单字节 → 仍会追加 GB18030 兜底），但该串解出来是 U+2460 系列、不在 CJK 表意文字区，得分≈0；Windows-1251 解出的西里尔字母同样≈0，打平后按候选顺序取了 Windows-1251。
- **GB18030 编码的非 BMP 字符**（如 `𠀀𠀁𠀂`）：jschardet 报 `cp720`，同理会选错。
- **遗留单字节集**（KOI8-R、以及希腊/希伯来/阿拉伯等）：第 5 步用的是**黑名单**，只排除多字节 CJK/Unicode，这些编码不在名单内，仍会追加 GB18030 兜底；只要正确解码里几乎没有 CJK 表意文字，就可能被乱码挤掉（实测 KOI8-R 正确 0 / 乱码 256，仍误选）。**不改成正向白名单是刻意的**：把 `windows-125x` / `ISO-8859-*` 也排除在兜底之外，会破坏"GBK 被误判成 windows-1252 时救回来"这个兜底存在的主要用途——本应用面向中文小说，黑名单偏向救中文是取舍。

真实的中文小说会得到 `GB*` 判定、不会走进这条路径，因此本期不修，只登记在 §13。要彻底解决得把 `scoreText` 改成**文字系统感知**的打分（例如先判断这段文本属于哪种文字系统，再在同系统内比较），对本期收益不值。

主进程把命中的编码名回传，显示在状态栏。

## 7. 章节切分

`chapters.ts` 在归一化后的文本上按行扫描，识别标题行并切分：

**标题正则**（命中即视为章节标题）：

```
/^\s*第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节回卷篇]\s*.{0,40}$/
/^\s*(?:序章|楔子|尾声|后记|前言|引子|番外)\s*.{0,40}$/
/^\s*Chapter\s+\d+.*$/i
/^\s*[0-9]{1,4}\s*[、.．]\s*.{0,40}$/
```

**切分规则**：

- **标题行计入该章正文范围的起始部分**（即 `chapters[i].start` 指向标题行首字符）。这样连续打字跨章时，章节标题会自然地出现在阅读流里，与真实小说一致；侧栏同时也把它作为 `title` 显示。
- 标题行之后紧跟的空行也属于该章，保证章节开头有正常留白。
- 标题行之前的所有内容（若存在）归入一个"前言"伪章节：`title = '前言'`，正文即该段原文（不额外插入标题行）。
- 相邻标题之间没有正文的**空章节会被丢弃**。
- 若全文一个标题都没匹配到 → **单章节模式**，`title` 用文件名，`flatText` 为全文（含空行）。
- 章节 `start/end` 由正文片段按顺序拼接并累加偏移得出，保证无缝、连续、无重叠。

## 8. 持久化

保存到 `app.getPath('userData')/`：

- `session.json`：`{ novelTitle, sourcePath, ratio, mode, cursor, revealStart, chapterPos, activeChapter, startedAt }`
  （刻意**不含 `encoding`**：编码名由 `novel-cache.json` 里的 `NovelCacheMeta.encoding` 承载，恢复 `Novel` 时从那里取，session 再存一份是冗余。此前的本文档多写了它，实现与计划一直是按不含它做的。）
- `novel-cache.json`：`{ sourcePath, mtimeMs, size, encoding, hadBom, title, chapters, textBytes }` —— 章节目录与元数据，体积小
  （`title` 用于重建 `Novel.title`；`textBytes` 是缓存两个文件之间的**提交点**，用于防止「旧 meta + 新 text」这类错配——见 Task 5 与 §6。）
- `novel-cache.txt`：解码并归一化后的全文，纯 UTF-8

拆成两个文件是刻意的：20MB 小说的全文若塞进 JSON，`JSON.parse` / `stringify` 会白白付出转义与解析开销。纯文本缓存可以直接 `fs.readFileSync(path, 'utf8')` 读回。重启时命中缓存则无需再读原文件、不再重复检测编码。

**保存时机**：游标变化防抖 1s、比例/模式变化立即、窗口关闭前强制 flush。

**恢复流程**：启动 → 读 `session.json` → 若存在且 `novel-cache.json` 的 `sourcePath` 匹配 → 直接恢复 `Novel` 与全部游标状态，**用户无需重新输入**，打开就在上次读到的位置。

**失效处理**：缓存缺失或 `sourcePath` 对不上 → 显示空状态，提示重新导入。导入同一路径的文件时优先复用缓存。

**清理入口**：`文件 → 清除阅读记录`，删除 `session.json` 与缓存。

## 9. 打包

`electron-builder`：

- `pnpm dist:mac` → `.dmg`（arm64 + x64）
- `pnpm dist:win` → NSIS `.exe`（x64）
- `pnpm dist:dir` → 免安装目录，用于本地快速验证

**诚实说明**：macOS 产物在本机真实构建并验证。Windows 目标配置会写全，但 macOS 上交叉构建 NSIS 有时依赖 wine，可能失败。会实际尝试一次——失败则提供 GitHub Actions 工作流（`windows-latest` runner）产出 `.exe`，并在文档里写清构建步骤。

## 10. 测试策略

| 层 | 工具 | 覆盖内容 |
|---|---|---|
| `decode.ts` | Vitest | UTF-8 / UTF-8 BOM / GBK / GB18030 / UTF-16LE 样本；无 BOM 的 GBK 与 UTF-8 辨析；CRLF 与 CR 归一化 |
| `chapters.ts` | Vitest | `第X章` 各种写法、中文数字、`Chapter N`、无标题单章模式、标题前有前言、连续标题产生空章、CRLF、超大章节数 |
| `engine.ts` | Vitest | 比例 1 / 10 / 500；跨界 pump 保持 `revealStart` 不变；`backspace` 夹紧在 `revealStart`；末尾夹紧；`jumpToChapter` 回填已读章；`chapterPos` 更新与回退；空小说；单章小说 |
| 输入链路 | Playwright `_electron` | 真实启动应用 → 导入 fixture txt → `keyboard.type()` 打字 → 断言页面文字按 N 倍增长 → 退格回吐 → 点章节跳转并回填 |
| IME 模式 | Vitest（jsdom 环境）+ @testing-library/react | 对 `InputCapture` 组件派发合成 `compositionstart` / `compositionupdate` / `compositionend`，断言上屏字数 × N，且未上屏的拼音不产生抽字 |
| 打包 | 手动 | `pnpm dist:dir` 后启动产物，跑一遍导入 + 打字 |

**验证纪律**：任何"完成"声明前必须贴出实际命令与输出。核心模块未通过单测不算完成。

## 11. 技术栈

| 项 | 选择 | 理由 |
|---|---|---|
| 桌面框架 | Electron | `jschardet` / `iconv-lite` 是 Node 库，主进程可直接用；`electron-builder` 一条命令出双平台包 |
| 构建 | Vite + `vite-plugin-electron` | 渲染进程 HMR，主进程自动重启 |
| UI | React 18 + TypeScript | — |
| 样式 | 纯 CSS / CSS Modules | Word 外观是高度定制的，引入 UI 库反而要不停覆盖样式 |
| 状态 | `TypingEngine` 类 + `useSyncExternalStore` | 引擎是纯模块，可脱离 React 单测 |
| 单测 | Vitest | 与 Vite 同源，零额外配置 |
| E2E | Playwright（`_electron`） | 唯一能真实验证 DOM 打字链路的方式 |
| 打包 | electron-builder | — |

### 11.1 锁定版本（2026-10-06 实测 npm registry）

**「全部取最新」在本项目不可行**，实测到的冲突：`electron-vite@5.0.0` 的 peer 是 `vite: ^5 || ^6 || ^7`，**不支持 Vite 8**；而 `@vitejs/plugin-react@6.1.2` 的 peer 是 `vite: ^8`。两者最新版无法共存。

因此锁定下面这套**互相兼容**的版本（Vite 固定在 7.x）：

| 包 | 版本 | 版本约束依据 |
|---|---|---|
| electron | 44.5.1 | engines `node >= 22.12.0`，本机 Node 22.23.2 ✓ |
| electron-vite | 5.0.0 | peer `vite ^5\|\|^6\|\|^7` → 必须配 Vite 7 |
| vite | 7.3.7 | 满足 electron-vite 5 与 vitest 5 的 peer |
| @vitejs/plugin-react | 5.2.0 | peer 覆盖 `^7`；6.x 只支持 Vite 8，不可用 |
| vitest | 5.0.3 | peer `vite ^6.4\|\|^7\|\|^8` ✓ |
| react / react-dom | 19.3.0 | — |
| @testing-library/react | 16.3.3 | peer 支持 React 19 |
| @testing-library/dom | 10.4.2 | RTL 16 的 peer |
| jsdom | 30.1.2 | — |
| @playwright/test | 1.63.0 | — |
| electron-builder | 26.15.3 | — |
| jschardet | 4.0.0 | **自带 `build/index.d.ts`**，不需要 `@types/jschardet`（该包在 registry 上不存在） |
| iconv-lite | 0.7.3 | — |
| typescript | 5.9.3 | 刻意不用 7.0.2（Go 移植版）：TS 在本项目只做 `tsc --noEmit` 类型检查，转译由 esbuild/oxc 负责，选生态验证最充分的 5.x 更稳 |
| @types/node | ^22 | 与运行时 Node 22.23.2 对齐，不用 26.x |
| @types/react / @types/react-dom | 19.3.0 | — |

升级路径：等 electron-vite 支持 Vite 8 后，可整体升到 Vite 8 + plugin-react 6。

### 11.2 依赖归属

- `dependencies`：`iconv-lite`、`jschardet`、`react`、`react-dom`
- `devDependencies`：其余全部

主进程/preload 构建启用 electron-vite 的 `externalizeDepsPlugin()`，把 `iconv-lite` / `jschardet` 保留为运行时 `require`，由 electron-builder 打进 asar。渲染进程的 `react` / `react-dom` 由 Vite 正常打包。

## 12. 目标文件结构

采用 **electron-vite 的约定式布局**（`src/main` / `src/preload` / `src/renderer`），而不是自造目录再改配置——约定式布局的配置面最小，出错机会最少。`src/core/` 作为三端共享的纯模块保留。

```
WorkingTitle/
  package.json
  tsconfig.json / tsconfig.node.json / tsconfig.web.json
  electron.vite.config.ts
  vitest.config.ts
  playwright.config.ts
  electron-builder.yml
  src/
    core/            ★ 纯 TypeScript，零 DOM / 零 Electron / 零 React
      types.ts
      decode.ts
      chapters.ts
      engine.ts
    main/            主进程
      index.ts       窗口、启动流程、命令行参数
      ipc.ts         IPC 通道注册
      menu.ts        原生菜单
      session.ts     会话与缓存读写
      loadNovel.ts   读文件 → 解码 → 切分（可单测）
    preload/
      index.ts       contextBridge 白名单
    renderer/
      index.html
      src/
        main.tsx
        App.tsx
        styles/      word.css, ribbon.css, page.css
        components/  Ribbon.tsx, Toolbar.tsx, ChapterList.tsx,
                     Page.tsx, StatusBar.tsx, Toast.tsx
        input/       InputCapture.tsx
        state/       ToolbarContext.tsx, useTypingEngine.ts
  tests/
    unit/            decode.test.ts, chapters.test.ts, engine.test.ts, ime.test.tsx
    e2e/             app.spec.ts
    fixtures/        sample-utf8.txt, sample-gbk.txt, sample-nochapters.txt
  docs/superpowers/
```

## 13. 未决 / 风险

| 风险 | 应对 |
|---|---|
| Windows 交叉打包失败 | 提供 GitHub Actions 工作流；已在上文标注为诚实风险 |
| 真实 IME 行为差异 | mac 与 Windows 各手动验证一次；已准备降级到纯按键模式 |
| 超大 txt（>20MB）IPC 与渲染卡顿 | 先按一次性 IPC 实现并用大文件实测；确认卡顿后再改为分片传输 + §5.4 折叠前文护栏 |
| 章节正则误判 | 提供"单章节模式"兜底；后续可加手动调整入口（本期不做） |
| 编码检测对"几乎无汉字"的输入仍会误选。已知例：GBK 纯符号串（`①②③…⑩`）→ 被解成 Windows-1251；GB18030 非 BMP 字符（`𠀀𠀁𠀂`）→ 被解成 cp720；KOI8-R 等遗留单字节集 → 被 GB18030 乱码挤掉 | 已修日文/韩文（可视为本应用最可能遇到的非中文输入）：把 GB18030 兜底收窄为黑名单之外才追加。其余各例因 `scoreText` 在**跨文字系统**之间比较得分，属结构性限制，靠增删候选名单救不干净；真实中文小说会得到 `GB*` 判定、不走这条路（详见 §6）。彻底解决需改成文字系统感知的打分，本期不做。**关键性质：误选是「文本相关」而非「编码相关」的**——`scoreText` 是占比比值，同一编码换一段文本结论就可能翻转。Windows-1251 在样本上恰好安全（其乱码要么命中替换字符每个 −100、要么几乎不落在 U+4E00–U+9FFF，实测得 −26，输给正确解码的 0），KOI8-R 在同一批样本上乱码得 +256 胜出。**因此「某编码实测正常」不构成保证**，黑名单之外一律应视为可能被解错 |
| 伪装破绽：应用图标与菜单栏应用名 | 目前用 Electron 默认图标、无 `productName`/`app.setName`（开发时显示 `Electron`、打包后显示 `working-title`）。对"伪装成 Word"这一目标而言，任务栏/菜单栏是比正文更容易露馅的地方。纳入 Task 14 与打包一起定 |
| 带 BOM 的 UTF-32 文件会被误判为 UTF-16LE | `FF FE 00 00` 命中 `detectBom` 里 UTF-16LE 的 `FF FE` 前缀，于是解出夹 NUL 的错误文本。这是目前**唯一确定性**的错误（此类文件 100% 解错，不随文本而变），但它走的是 BOM 分支、与候选名单逻辑无关，且本应用域内 UTF-32 小说几乎不存在，故不修。真要修：在 UTF-16 两项之前加 `FF FE 00 00 → UTF-32LE` 与 `00 00 FE FF → UTF-32BE`，并先确认 `iconv-lite` 支持这两个编码名 |
| 凡"每字节都 < 0x80"的内容都会被严格 UTF-8 短路抢先认领 | 这类输入**本身就是合法 UTF-8**，所以短路先于一切编码探测把它们判为 UTF-8。已知两类：① 无 BOM 的**纯 ASCII** UTF-16 → 返回夹 NUL 的文本；② `ISO-2022-JP` / `ISO-2022-KR` / `HZ-GB-2312` 这三种 **7-bit** 的日/韩/中文编码——jschardet 确实会报出它们，但它们永远到不了候选名单。这是短路在病态输入上的正常行为，**不是候选名单的缺口**（黑名单只需覆盖会被真正解码检视的编码）。小说 txt 不会是纯 ASCII，也极少用 7-bit ISO-2022 系列，故不修 |
