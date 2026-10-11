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

**统一收尾规则**：`pump` 与 `backspace` 的每一次游标变化之后，统一执行

```
activeChapter            = cursor 所在章（cursor === flatText.length 时取最后一章）
chapterPos[activeChapter] = cursor - chapters[activeChapter].start
```

**唯一的例外是 `jumpToChapter`**：它只执行第二条，`activeChapter` 直接取被点击的章号 `i`。
理由是点击的语义——「点了哪章就高亮哪章」。若照上式从 `cursor` 反推，当目标章已经整章读完时
`chapterPos[i] === charCount`、游标正好落在**下一章**的开头，左侧列表就会高亮用户没有点的那一章。
下一次打字会由上式自动纠正回 `cursor` 所在章，那是打字推进的语义，不是这次点击的语义。
（把 `jumpToChapter` 改成照上式反推，Task 4 的用例全绿——两种语义都没有被测试钉住，
这条例外只由本段与 `engine.ts` 里 `jumpToChapter` 的注释守着。）

于是 `chapterPos[c]` 恒等于「上次离开第 c 章时，光标停在该章内的偏移」。这条规则同时覆盖了正向打字、退格、以及跨章打字的情况，不需要为每种操作单独规定 `chapterPos` 怎么变。

#### 关键语义澄清

- **`revealStart` 在打字时不变**，因此跨章节打字时阅读区是**连续的**，不会在章节边界清空或跳变。这是刻意的。
- **退格只回吐显示，不改小说内容。** `cursor` 回退，`flatText` 一个字节都不动。
- **点击章节 = 跳转到该章，并回填该章上次的阅读进度。** 跳到已读过的章会立即看到上次读到的内容，跳到没读过的章阅读区为空白。无论哪种，都只是移动游标。
- **当前章节 = `cursor` 所在章**——但**有一条例外**，与 §2「统一收尾规则」那条是同一件事：`jumpToChapter` 之后 `activeChapter` 是**被点击的那一章**，而不是 `cursor` 反推出的那一章。当被点的章已经整章读完时二者会不一致（`cursor` 落在下一章开头），此时侧栏高亮的是**用户点的那一章**——这是点击语义，不是打字推进语义。打字推进时左侧列表高亮自动跟随并滚动到可见区域。
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
  openNovelPath(path: string): Promise<Novel>
  initialNovelPath(): Promise<string | null>
  loadSession(sourcePath: string): Promise<PersistedSession | null>  // 按书取：进度每本书一份
  saveSession(s: PersistedSession): Promise<void>
  clearSession(): Promise<void>              // = 清阅读历史；设置刻意保留，见 §8
  loadSettings(): Promise<AppSettings>       // 文档名 / 外观 / 纸张 / 上次打开的是哪本
  saveSettings(s: AppSettings): Promise<void>
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
- 模式切换按钮在设置对话框里（§5.6），切换时给 toast 提示当前模式

### 输入法兼容性说明

Playwright 无法真实模拟系统 IME 的 `compositionend`，因此 IME 模式通过**派发合成的 CompositionEvent** 做单元级验证，纯按键模式通过 Playwright `keyboard.type()` 做端到端验证。真实的微软拼音 / 搜狗输入法需要在 mac 与 Windows 上各手动验证一次。

## 5. 界面

### 5.1 顶部 Ribbon

七个选项卡：**文件 / 开始 / 插入 / 布局 / 引用 / 审阅 / 视图**，点击可切换，切换时下方工具组内容随之变化。

`文件` 选项卡里只剩占位按钮（新建 / 保存 / 导出 docx / 打印）与一个 **「设置」** 入口。两项真实功能 **"导入小说 Ctrl+O"** 与 **"清除阅读记录"** 连同比例、输入模式、文档名，都收在**设置对话框**里（§5.6）。

### 5.2 工具栏按钮

加粗、斜体、下划线、删除线、字体、字号、格式刷、项目符号、编号、对齐（左/中/右/两端）、行距、查找替换、导出 docx、撤销、重做，外加一个 **「设置」** 按钮。

**每个都必须可点击且有可见反馈**：

- 格式类按钮（B/I/U/对齐/项目符号等）→ 切换按下态（高亮），纯视觉，不影响文本
- 动作类按钮（导出 docx/查找替换/格式刷等）→ 弹出 toast「演示占位功能，未实现」
- 「设置」按钮 → 打开设置对话框（⌘/Ctrl + , 等效）；对话框里的比例与输入模式两个控件真实生效

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

空状态（未导入）显示引导文案：「文件 → 设置 → 导入小说，或按 Ctrl+O」。

### 5.6 设置对话框

应用**真实功能**的唯一去处：文档名、比例（1 键显示 N 字）、输入模式、导入小说、清除阅读记录。
在 Word 里这些位置摆的都是装饰品，真实控件摆在界面上是最容易被一眼看穿的地方，所以收进一个模态：

- 打开：**⌘/Ctrl + ,**（macOS「设置」的惯例键，按 `e.code === 'Comma'` 判定）或 `文件` 选项卡里的
  **「设置」** 按钮；关闭：Esc、点遮罩、右上角 ✕、底部「关闭」
- `role="dialog"` / `aria-modal="true"`，白底居中面板 + 半透明遮罩，打开时焦点落在第一个输入框
- 蓝条上的文档名不再可点：它是一段静态文本，改名在对话框里
- 模态期间阅读区的输入捕获**不抢焦点**（否则在对话框里敲的字会漏进小说，字出在遮罩后面看不见）——
  见 `InputCapture` 里那两条按 `[role="dialog"]` 判定的闸

#### 手动保存的那一组

**文档名与阅读替换改了不立即生效**：打字只改对话框内部的**草稿**，点「保存」才提交。
底部「关闭」旁**只在有未保存改动时**出现「保存」（它一出现就是「你有东西没生效」这个信号，
比一个常驻的灰按钮更说明问题）。保存后给一条「已保存」提示，对话框不关。

- **失焦只归一化，不提交**：去掉两侧空白、把超出 1–500 的比例夹回区间（夹紧仍给一条提示）。
  归一化不出合法值时就退回已提交值，而不是留一个空草稿——那种草稿会让「保存」一直亮着而
  点下去什么都不提交。
- **回车＝保存**。原先回车是直接提交，留这个例外会和「保存」按钮打架。
- **没保存就关**（✕ / Esc / 点遮罩 / 底部「关闭」）＝**丢弃**，重开时重新从当前值起稿。
- **外观 / 纸张 / 输入模式刻意不在这一组**：它们的效果当场看得见（换个颜色、按一下就知道），
  要保存才生效会很别扭。
- **阅读替换是两格**：「全局（新导入的书用它）」与「当前书」，各一个输入框。两格都归这一组，
  点一次保存把两处**各回各的家**（全局进 `settings.json`，当前书进引擎 → 那本书的会话）。
  没打开小说时「当前书」那格禁用（没有书就没有「当前书」），全局那格照旧可用。

**实现形状是一张表**（`state/deferredSettings.ts`）：每项声明「已提交值 / 归一化 / 提交」，
机制负责草稿、算「有没有改动」、按需提交。加一项设置的成本是往表里加一行——不用碰 dirty 的
算法、不用碰按钮的显隐、也不用碰关闭语义。**两项底层走的是两条路**（文档名 → 全局设置 →
`settings.json`；比例 → 引擎 → 那本书的会话），对用户是同一个按钮，这正是把表放在对话框里的
理由：对话框不必知道背后是什么。

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

`chapters.ts` 在归一化后的文本上按行扫描，识别标题行并切分。

**输入必须是已归一化换行（只含 `\n`）——这是一条硬契约，不是可选的美化。** 真正承重的是 **CR-only**（旧 Mac 换行：整份文件只有 `\r`、没有 `\n`）。此时 `split('\n')` 无从下刀，**整份文件变成一行，章节结构塌成单章**——实测一份 2 章的 CR-only 文本直接切得 1 章，归一化后才是 2 章。注意此时 `flatText` 仍严格等于原文，所以坏掉的**不是坐标系，而是章节列表 / 跳章目标 / `chapterPos` 的长度**。归一化由 §6 的 `decodeBuffer` 承担（它的三条返回路径都过 `normalizeNewlines`），所以 `loadNovel` 的顺序必须是 decode → normalize → split。

**`\r\r\n`（双 CR + LF）也必须折叠成单个 `\n`。** 这是「CRLF 被转换了两次」的典型产物，在中文网络小说里很常见，不是畸形个例。旧实现 `text.replace(/\r\n?/g, '\n')` 对它**匹配两次**（先匹配单独的 `\r`，再匹配 `\r\n`），产出 `\n\n`。这是在**用户的真实小说上实测到的**（跑完整 `loadNovelFromFile` 管线，命令输出见仓库探针记录）：行尾被重复转换的书，每行后面都多插一个空行，**整本书在阅读区里呈双倍行距**。折叠 `\r\r\n` 到单个 `\n` 时，**真正的空白行（`\r\n\r\n`）必须原样保留**——两者不能一起被压掉，所以实现用 `/\r+\n/g` 折叠 CR 串再单独处理裸 `\r`，而不是 `[\r\n]+`。

> 曾有一处说法称「原始 CRLF 会让 `flatText !== 源文件`」——**实测不成立**。`split('\n')` 会**保留** `\r`，而拼接时补的那个 `\n` 正好补全 `\r\n`，所以 CRLF 反而逐字还原；真正被 join 丢掉的是分隔用的 `\n`。穷举 36 种 CRLF 形状后，原始 CRLF 与归一化输入的结论**逐例相同**，失真的那些格全部是「文件以空白行开头 → 前言被 `kept` 丢弃」，与换行种类无关。

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
- **全空白的前言会被丢弃**（例如文件以若干空行开头、之后才出现第一个标题）。注意**不存在"相邻标题之间的空章节"这种情况**：每个章节的切片都从它自己的标题行开始，而标题行 `trim()` 后必非空，所以真章节永远不可能为空。`splitChapters` 里那个 `kept` 过滤器实际上**只能丢掉前言**——它不是通用的空章节清理。此前的本文档把它描述成后者，属于**描述了一个不可达的情况**（由 Task 3 的变异测试发现：删掉过滤器后失败的只有前言那条用例；而**当时那条名字里写着「空章节被丢弃」的用例反而没失败**——它此后已改名为「相邻标题之间无正文：区间仍连续，且两个标题都不被丢弃」，因为原名承诺了一个不可达的分支）。
- 若全文一个标题都没匹配到 → **单章节模式**，`title` 用文件名，`flatText` 为全文（含空行）。
- 章节 `start/end` 由正文片段按顺序拼接并累加偏移得出，保证无缝、连续、无重叠。

## 8. 持久化

保存到 `app.getPath('userData')/`（可用 `WT_USER_DATA` 重定向，E2E 与便携模式用）：

- `settings.json`：`{ docTitle, themeSource, darkPaper, lastSourcePath, ratio }` —— **应用级设置，全局一份**。
  文档名、外观（跟随系统 / 浅色 / 深色）、「深色下纸张也变暗」、**上次打开的是哪本书**
  （启动时按它恢复；命令行参数优先于它）、以及**全局的阅读替换比例**。
  `ratio` 是后来才加的字段：旧版写下的这份文件里没有它。**「缺这个字段」按旧版本处理、
  补上默认值**，而不是按必填校验整份退回默认值——后者会让用户改过的文档名 / 外观 / 纸张
  在一次升级里一起消失。写错了（类型不对）仍然整份退回。
  **为什么与阅读进度分开**：两者的生命周期不同——进度是「读到哪」（每本书一份、一直在变），
  设置是「怎么读、长什么样」（全局一份、很少变）。此前这三项只活在渲染进程的内存里，
  关掉应用即丢；而比例与输入模式挤在会话里，换一本书就被打回默认。
- `sessions/<sha256(sourcePath) 前 32 位 hex>.json`：**每本书一份** `PersistedSession`
  `{ novelTitle, sourcePath, ratio, mode, cursor, revealStart, chapterPos, activeChapter, startedAt }`
  （刻意**不含 `encoding`**：编码名由 `novel-cache.json` 里的 `NovelCacheMeta.encoding` 承载，恢复 `Novel` 时从那里取，session 再存一份是冗余。此前的本文档多写了它，实现与计划一直是按不含它做的。）
  文件名取**路径的哈希**而不是路径本身：路径可能很长、含 `/` 与冒号等保留字符，直接拼进去会撞上文件名长度上限。
  代价是文件名不再可读——所以文件**内容**里仍带着 `sourcePath`，读取时比对；对不上按「无记录」处理
  （只可能来自手工改名或哈希撞车，而放行会把 B 书的进度套到 A 书上）。
  读取入口带 `sourcePath`（`loadSession(sourcePath)`）：「读哪一本的进度」必须问得明确。
- **旧版单槽 `session.json`**：升级前的格式。首次取 store 时**迁移**进 `sessions/`，
  并按需把 `lastSourcePath` 补进 `settings.json`；**迁移落地之前绝不删旧文件**（磁盘满、
  `sessions` 被同名文件占住都会让写入失败，而那是用户进度唯一的副本）。结构判不了的一律不删，只报出路径。
- `novel-cache.json`：`{ sourcePath, mtimeMs, size, encoding, hadBom, title, chapters, textBytes }` —— 章节目录与元数据，体积小
  （`title` 用于重建 `Novel.title`；`textBytes` 是缓存两个文件之间的**提交点**，用于防止「旧 meta + 新 text」这类错配——见 Task 5 与 §6。）
- `novel-cache.txt`：解码并归一化后的全文，纯 UTF-8

拆成两个文件是刻意的：20MB 小说的全文若塞进 JSON，`JSON.parse` / `stringify` 会白白付出转义与解析开销。纯文本缓存可以直接 `fs.readFileSync(path, 'utf8')` 读回。重启时命中缓存则无需再读原文件、不再重复检测编码。

**保存时机**：游标变化防抖 **600ms**（`App.tsx` 的 `SAVE_DEBOUNCE_MS`）、窗口关闭前强制 flush；设置走同一个 600ms 防抖，另有一条「读回磁盘上的设置之前一律不写」的闸——少了它，首帧的默认值会把用户存的设置冲掉。

**两个阅读替换比例的分工**：`settings.json` 里那个是**全局**的，它只是**新导入的书的起点**；
真正生效的是每本书自己那个（`PersistedSession.ratio`，引擎只认它）。于是：
打开一本**没有记录**的书 → 取当时的全局值；有记录 → 用它自己的。**改全局不影响已经打开过的
书，只影响之后导入的**——两者之间没有「跟随」状态，界面上两个普通输入框就够了。

**恢复流程**：启动 → 读 `settings.json` → **依次尝试** `命令行参数`、`lastSourcePath`（前者优先，**打不开就回退到后者**，同路径去重）→ 打开那本书 → **按它的 `sourcePath`** 读 `sessions/` 下那一份进度 → 有就接着读、没有就从零开始。缓存命中（`novel-cache.json` 匹配）则无需再读原文件。

**那个回退不是装饰**：旧的两段式启动天然有它（命令行那段失败后落到会话恢复那段），合并成一次之后必须显式写出来，否则用户手滑指了个打不开的路径就会落到空状态，而磁盘上明明有上次读的书。两个目标都打不开才停在空状态。

**「导入一本读过的书」也走同一条判断**：`App.tsx` 的 `openNovel` 是导入与启动恢复共用的入口，它自己会先读这本书的进度再决定。少了这一步，导入一本读过的书＝全新引擎＝600ms 后把 `cursor 0` 落盘覆盖掉那本书的进度。

**失效处理**：进度文件缺失或 `sourcePath` 对不上 → 那一本按「无记录」处理（其余书的进度不受影响）；缓存缺失或校验不过 → 退化成重读源文件。源文件本身不可用 → 显示空状态，提示重新导入。

**清理入口**：`文件 → 设置 → 清除阅读记录`，删除**所有书**的进度（整个 `sessions/` 目录）、两个缓存文件、以及旧版残留的 `session.json`。
**`settings.json` 刻意不在此列**——文档名 / 外观 / 纸张是用户的偏好，与「读到哪」无关；把它们一起清掉等于「改一次设置、按一次清除就白改」。

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
| 伪装破绽：Windows / Linux 上**窗口内**的原生菜单栏 | 原生菜单栏渲染在窗口内部、标题栏正下方那一行，而真 Word 那个位置是功能区（文件/开始/插入…），一条「文件 编辑 视图 帮助」摆在那儿就把意图露了。已改为**只在 macOS 建菜单**：`menu.ts` 里 `process.platform !== 'darwin'` 时直接 `Menu.setApplicationMenu(null)`。macOS 的菜单在**屏幕顶部**，每个 Mac 应用都有、真 Word 也有，不构成破绽，而且 ⌘Q / ⌘H / ⌘C 靠它，去掉会连带废掉。**不用 `setMenuBarVisibility(false)`**：那是「菜单还在、只是藏起来」，藏得干不干净取决于平台行为（`autoHideMenuBar` 与 Alt 键的交互），而本机只有 macOS、验不了；`setApplicationMenu(null)` 是确定没有菜单。代价（仅 Windows/Linux）：失去 `Ctrl+O`（导入改从设置对话框进）与撤销/重做/复制/粘贴等 `role`；但**可编辑元素里的 Ctrl+C/V/X/A/Z 由 Chromium 自己处理，与菜单无关**，设置里的文档名与比例框照常可用。**Windows 侧尚未实机验证** |
| Windows 上「标题栏染蓝」只能把整条标题栏交给网页画，且颜色与 CSS 各存一份 | Electron 里没有「给系统默认标题栏上色」的接口——那条路的底色跟随系统外观与强调色，应用改不了。要蓝的就只有 `titleBarStyle: 'hidden'` + `titleBarOverlay`（见 `src/main/index.ts` 的 `titleBarOptions`）：整条标题栏归网页，**系统仍画右上角那三个按钮**但按 `titleBarOverlay.color` 上色，标题文字由网页画（系统不画）。**代价一**：`TITLEBAR_LIGHT` / `TITLEBAR_DARK` 与 `word.css` 的 `--wt-titlebar` / `--wt-titlebar-text` 是两处独立副本，改一处必须同步另一处，否则按钮那一小块底色会和蓝条差一档——本仓库没有 CSS↔TS 的共享通道，`WINDOW_BG_*` 早就是同样的成对关系。**代价二**：那三个按钮是系统画的，翻主题时不会自己变，`nativeTheme.on('updated')` 里必须显式 `setTitleBarOverlay`，否则深色下会留一条蓝的。**代价三**：`hidden` 之后窗口唯一的拖动区就是那条 32px 的标题条（`ribbon.css` 里 `[data-platform='win32']` 的 `-webkit-app-region: drag`），不设窗口就拖不动。Linux 不支持这套，保留系统标题栏。**Windows 侧尚未实机验证** |
| 标题条与标签条共用 `--wt-titlebar`，但深色下标签条**故意不跟** | 浅色下两条同为 `#185abd`，合成一整块蓝——真 Word「彩色」主题的样子（标题栏与标签条同色，选中的页签是一块从白色功能区升上来的白形状）。深色下标签条固定 `#191919` 而非跟着 token 变 `#1f1f22`：选中页签的底色与功能区同为 `#202024`，标签条若只差一档，「选中页签与下方功能区连成一片」就看不出来了。**改 `--wt-titlebar` 时要记得标签条只在浅色下受它影响。** |
| `.wt-tab--active` 必须各配一条 `:hover` 覆盖，否则选中态被悬停态吃掉 | 特异度：`.wt-tab:hover` 是 (0,2,0)，`.wt-tab--active` 只有 (0,1,0)，**前者盖后者**；深色下同理（(0,3,0) 对 (0,2,0)）。所以 `[data-theme='dark'] .wt-tab--active:hover` 那类是**必需**的而非修饰，且必须排在各自的 `:hover` **之后**——同特异度靠源码顺序决胜，上移就会失效。症状：鼠标划过已选中的页签，白底被换成半透明白、字色又翻成白色，蓝底标签条上就是「一块淡蓝 + 白字看不见」。这个坑在标签条是浅灰时就存在，改成蓝之后才显眼。**同类坑在本仓库出现过不止一次**（设置里分段控件的高光失效是同一族），改页签/按钮的态时先数一遍特异度 |
| 功能区的下拉框**不能**用原生 `<select>` | 全应用的按键挂在 `InputCapture` 那个透明 textarea 的 `onKeyDown` 上（**不是 window**），而 `focusIfNotTextInput` 的豁免名单里**有 `select`**——那是给设置对话框里的输入框用的。于是原生 `<select>` 一点下去焦点就留在它身上，之后敲键盘**既不打字也不抽字**，整个应用等于废了。所以 `combo` 做成 `<button>` + 一列 `<button>`：按钮类不在豁免名单里，`mousedown` 时焦点会被自动抢回 textarea，与工具栏其它按钮走同一条路径。**推论：任何新增的可交互控件，先问它在不在 `TEXT_INPUT_SELECTOR` 里**——在里面就会吃掉后续的所有按键。 |
| 下拉面板必须 portal 到 body | `.wt-toolbar` 有 `overflow-x: auto`（窄窗口横向滚动）。按 CSS 规则，一个轴不是 `visible` 时另一个轴也会变成 `auto`，于是绝对定位的面板会被**裁掉**。portal + `position: fixed` 才跳出那个裁剪上下文。面板坐标由 `getBoundingClientRect()` 算；jsdom 没有布局、rect 全是 0，那不是错误路径，面板照样挂得出来（测试靠这个断言）。 |
| 功能区只做外观，「开始 / 插入 / 布局 / 文件」四页的控件绝大多数是占位 | 补密度时加了三种控件：`combo`（字体名 / 字号 / 行距）、`gallery`（样式库，`AaBbCc` 预览）、`split`（主按钮 + 展开箭头，用于下划线 / 项目符号 / 编号）。三者都只实现**选中态**，点开后的真实功能一律走 `notify` 的占位提示——本应用的真实功能只有设置对话框里那几项。`combo` 选了值之后**不做任何事**（不改字号、不改字体），`gallery` 同理。这是刻意的：它们的存在意义是让这一屏看起来像 Word。 |
| 带 BOM 的 UTF-32 文件会被误判为 UTF-16LE | `FF FE 00 00` 命中 `detectBom` 里 UTF-16LE 的 `FF FE` 前缀，于是解出夹 NUL 的错误文本。这是目前**唯一确定性**的错误（此类文件 100% 解错，不随文本而变），但它走的是 BOM 分支、与候选名单逻辑无关，且本应用域内 UTF-32 小说几乎不存在，故不修。真要修：在 UTF-16 两项之前加 `FF FE 00 00 → UTF-32LE` 与 `00 00 FE FF → UTF-32BE`，并先确认 `iconv-lite` 支持这两个编码名 |
| 凡"每字节都 < 0x80"的内容都会被严格 UTF-8 短路抢先认领 | 这类输入**本身就是合法 UTF-8**，所以短路先于一切编码探测把它们判为 UTF-8。已知两类：① 无 BOM 的**纯 ASCII** UTF-16 → 返回夹 NUL 的文本；② `ISO-2022-JP` / `ISO-2022-KR` / `HZ-GB-2312` 这三种 **7-bit** 的日/韩/中文编码——jschardet 确实会报出它们，但它们永远到不了候选名单。这是短路在病态输入上的正常行为，**不是候选名单的缺口**（黑名单只需覆盖会被真正解码检视的编码）。小说 txt 不会是纯 ASCII，也极少用 7-bit ISO-2022 系列，故不修 |
| 缓存两文件之间的错配窗口没有被完全关掉：`textBytes` 是**字节数**，两段**等长**文本仍能凑成一对 | **权衡后接受，不修。** 实测：为 A 书写好缓存后，把 `novel-cache.txt` 覆写成另一段等长文本而 `meta` 不动，`readNovelCache(A)` 仍返回 A 的章节目录配那段新文本——残余窗口确实存在，不是理论上的。刻意不修的理由：① 关掉它要把 `textBytes` 换成内容哈希，而读路径存在的全部意义就是**便宜**（§8 把正文从 meta 里拆出来正是为了不付 `JSON.parse` 的转义开销），每次命中缓存都哈希一遍正好把这个收益吃回去；② 这个残余还额外要求崩溃恰好落在「写 txt」与「写 meta」这两行之间，是「窄窗口 × 等长巧合」的乘积，而非「窄窗口」本身；③ 相比修复前的状态（完全没有提交点，任意两本书的错配都能通过），这道门已是量级上的改善——把「等长」这一种凑巧留下，好过为了彻底消灭它而在每次缓存命中上收税。（若将来真要关死：让 meta 记正文文件名、每次写入落一个新文件，比内容哈希更省——只是要接受一个目录里堆积旧正文文件，需配清理策略。） |
| `NovelCacheMeta` 没有版本字段 | 未来若要改缓存结构，`sourcePath` + `mtimeMs` + `size`（以及 `textBytes`）这道门**察觉不到结构变化**：旧结构的 meta 照样能通过，字段语义却可能已经不同。当前靠「字段是必填、缺失即 cache miss」这一条兜底（旧版本写的缓存没有 `textBytes` → `undefined !== size` → 自动重读源文件），但那只覆盖「新增字段」，覆盖不了「改语义」。加字段时要连带想清楚怎么让它失败关闭 |
| 缓存有效性判定比 §8 更严：除 `sourcePath` 外还要求 `mtimeMs` 与 `size` 相同 | 刻意。代价是「文件只是被 touch 过、内容没变」也要整本重读（重新解码 + 切章），换来的是「内容变了就必须重读」。§8 只写了 `sourcePath` 匹配，实现更严；这是有意的取舍，不是实现偏离 |
| `writeNovelCache` 在源文件已不存在时**静默什么都不写**（`statSync` 抛进 catch，只留一条 `console.warn`） | 低危且目前不可达：Task 6 的 `openNovel` 总是先 `loadNovelFromFile`（读得到才谈得上缓存），所以走到这里时源文件必然存在。若将来有别的调用方直接喂一个来路不明的 `Novel`，它会「看起来缓存成功、其实没有」——那时应把 `statSync` 的失败提到 `try` 之外或显式返回成功与否 |
| Task 12 的 `initialPath` 分支没有 try/catch（**计划侧已修，待 Task 12 落地**） | `window.api.openNovelPath(initialPath)` 一旦抛错（路径失效、权限、`EISDIR`、编码解不出来）就是启动期的未处理 rejection，连空状态都不显示。Task 5 期间已把该分支包进 try/catch，且 catch 里**不 return**——失败不阻断启动，继续走会话恢复 / 空状态兜底；形状与相邻那条会话恢复的 catch 相同。注意两条 catch 都只写注释、不打日志，这是 Task 12 的既有风格（与 §13 里「持久化错误要 console.warn」那条原则不一致，留给 Task 12 决定是否统一） |
| `resolveInitialNovelPath` 的注入谓词必须是「是不是普通文件」，不是「存不存在」 | 实测 `existsSync(名叫 xxx.txt 的目录)` 为 true、`statSync(...).isFile()` 为 false，而 `readFileSync` 抛 `EISDIR`。Task 6 的 `index.ts` 现计划写的是 `resolveInitialNovelPath(process.argv, existsSync)`；`existsSync` 恰好可赋值给 `(p: string) => boolean`，**不会报类型错**，于是 Task 5 把参数改名成 `isFile` 这个动作**本身不产生任何运行时效果**。必须同步把调用点改成传 `(p) => { try { return statSync(p).isFile() } catch { return false } }`，否则该修复等于没做（函数是纯的，管不到调用方传什么） |
| 「`splitChapters` 必须先归一化」这条契约，**风险场景是 CR-only 而不是 CRLF** | 原判断（「raw CRLF 会让 `flatText !== 源文件`」）实测不成立：36 种 CRLF 形状里 `splitChapters(raw).flatText === raw` 与归一化后的结论**逐例相同**（两边都是 12/36 保真），那 24 例失败与换行种类无关（纯 LF 同样 24 例），失败集合恰好是「文件开头有空白行 → 前言切片被 `kept` 丢掉」，即 §7 已写明并有用例守着的行为；机制上也不是「join 丢掉 `\r`」（实测 `'第一章 甲\r\n正文一。\r\n'.split('\n').slice(0,2).join('\n')` 得 `"第一章 甲\r\n正文一。\r"`，`\r` 被保留，随后补的 `\n` 正好补全 `\r\n`）。**真会坏的是单独 `\r`（旧 Mac 换行）**：文本里一个 `\n` 都没有，`split('\n')` 无从下刀，整份文件变成一行、章节结构塌成单章（实测 2 章的 CR-only 文本直接切只得 1 章，归一化后才是 2 章）；此时 `flatText` 仍严格等于原文，所以坐标系没坏，坏的是章节列表、跳章目标与 `chapterPos` 的长度。Task 5 的端到端用例用 CRLF 与 CR-only 两条分别钉住「输出等于归一化字面量」与「CR-only 也能切出多章」 |
| 缓存形状不合法的记录被**丢弃**（返回 `null` 并重读源文件），而不是尝试迁移 | 正确，而且理由是**无损**而非方便：① 门自己的前置条件就证明了重建无损——每个 `null` 都把调用方送到 `loadNovelFromFile(meta.sourcePath)`，源路径相同，而源若已不在，**现有代码本来就会返回 `null`**，所以这只是把一个「带垃圾的命中」移到一条已被另外四种 miss 走惯的路径上，没有引入新的行为类别；② **缓存里没有任何不可推导的东西**（书名←文件名、编码与 BOM←检测、章节←切分、正文←解码），应用中唯一不可推导的状态是阅读进度，而它在 `session.json` 里——另一个文件、有自己的校验器、不受这条路径影响；③ **没有可迁移的东西**：一条 `chapters: undefined` 的记录无法从 meta 修复，重建章节列表本身就是重建。**这条结论的失效条件**：若将来缓存里存了用户撰写或昂贵且不可推导的东西，就要重新讨论迁移；另外缓存依赖源文件存在，所以「源文件不在了也能续读」会是一个设计变更（缓存→存储），那一天起「丢弃」就不再是正确默认 |
| 零字节的 txt 被当作一份**有效但无内容**的小说接受 | 单章、`flatText` 为空、不报错。这是刻意接受的行为而非缺陷——文件本身就说它是空的，报错反而与用户看到的文件不符。诚实描述其后果：**对这样一份小说打字不会显示任何文字**（`flatText` 为空，`slice` 永远得到空串）。若将来要改为拒绝空文件，那是一个产品决定，不是修复 |
| `writeSession` 没有 `fsync`，因此只保证**进程崩溃**下的原子性，不保证断电 | 这正是声称的范围，也是 temp+rename 能给的：写临时文件、改名，读方永远看到某一份完整文件。**掉电**会让内容停留页缓存里，可能得到零字节文件——而零字节读回来是 `null`（实测空文件与截断到 20 字节的文件都读回 `null`），于是「进度丢失但不崩、不显示坏数据」。加 `fsync` 会把每次保存变成一次磁盘同步（1s 防抖下每秒一次），代价与收益不成比例，故不加 |
| `session.json.tmp` 是**固定名**，不是进程唯一 | 两个实例共用同一个 `userData` 时会互相覆盖同一个临时文件，结果是**后写者赢**，不会产生交错或损坏：`writeFileSync` 是同步整段写，`renameSync` 是原子的，两者的组合只可能让某一次保存被另一次覆盖掉，而每次覆盖的都是一份完整 JSON。真要并发正确需要进程唯一的临时名 + 锁；本应用是单实例桌面程序，不值得为它引入 |
| 设置校验失败是**整份回退**，不是逐字段恢复 | `settingsProblem` 返回第一个不合格字段后，`readSettingsFile` 整体退回 `defaultSettings()`——一份手改过的 `"themeSource": "sepia"` 会连 `docTitle` / `darkPaper` / `lastSourcePath` 一起丢掉。这是刻意与 `sessionProblem` / `cacheMetaProblem` 两个家族保持同一姿势（三份校验器一个形状），不是「只有坏的那个键受影响」；丢掉 `lastSourcePath` 有行为后果：应用不再自动打开上次那本书。要逐字段恢复的话，得把「校验」与「取值」拆开，那会让设置成为三份里唯一的例外 |
| 每本书的进度文件名取的是**原始 `sourcePath` 字符串**的哈希，没有做路径归一化 | 同一个文件经**相对路径**（命令行参数）与**绝对路径**（原生对话框）打开会得到两个不同的键、两份进度，用户会以为「进度丢了」。当前不修的理由：① 命令行那条路只在开发/脚本里用，正常用法都是从对话框导入（`dialog.showOpenDialog` 恒给绝对路径）；② 归一化要决定「相对谁解析」，而 `sourcePath` 同时是缓存有效性判据的一部分（`readNovelCache` 直接比字符串），只归一化会话会两者不一致。真要修：在 `openNovel` 一处统一 `path.resolve` 后再入库，缓存那条腿跟着一起走 |
| 迁移时 `settings.json` 已记着**另一本书**时，本次这本书不会被写进 `lastSourcePath` | 第二条闸写的是「settings 里没有 `lastSourcePath` 才补」，所以用户当前那本书（B）不会被迁移中的旧书（A）顶掉——这是对的。代价是 A 的记录虽然已经落到 `sessions/`，却没有人去自动打开它；由于 `openNovel` 现在会先读会话，用户手动导入 A 仍然能接着读（见 §8），所以后果有界：只是「不会自动打开」 |
