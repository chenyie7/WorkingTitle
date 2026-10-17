# 章节分章规则（重新分章）设计

日期：2026-10-17
状态：已与用户确认，待实现

## 1. 背景与目标

现在导入小说时只有一套写死在 `src/core/chapters.ts` 里的标题识别规则。遇到规则没覆盖的标题格式，
用户没有任何补救手段：章节列表要么少掉若干章，要么整本书塌成一章。

参考开源阅读（Legado）的「TXT 目录规则」：让用户自己选一条识别规则，或写一条正则，对当前这本书
重新解析目录。本设计只取其中与本书相符的那一部分：

- 单选一条规则，不做多规则叠加。
- 不做应用前预览：点「应用」直接换目录，不满意再换回来。
- 规则按书记住，下次打开这本书仍然生效。
- 正文与阅读进度不动，只重算章节边界与每章的百分比。

明确不做的见第 11 节。

## 2. 规则模型

### 2.1 类型

放在 `src/core/types.ts`，与 `Chapter` 同处：

```ts
export type ChapterPresetId = 'cn-chapter' | 'numbered' | 'chapter-en' | 'special'

export type ChapterRule =
  | { kind: 'auto' }
  | { kind: 'preset'; id: ChapterPresetId }
  | { kind: 'custom'; pattern: string }

export const DEFAULT_CHAPTER_RULE: ChapterRule = { kind: 'auto' }
```

会话与缓存里存的就是这条结构。缺字段一律按 `{ kind: 'auto' }` 处理。

### 2.2 预置规则

预置表与判定逻辑放在 `src/core/chapters.ts`，界面文案用中文（该文件已有 `PREAMBLE_TITLE` 这类中文常量）。

| id | 界面名称 | 判定 |
| --- | --- | --- |
| —（auto） | 自动识别（默认） | 现有 `isChapterTitle`：四条模式 + 长度上限 + 句读闸门 |
| `cn-chapter` | 第X章（中文） | `TITLE_PATTERNS[0]`：第X章/节/回/卷/篇，可带副标题 |
| `numbered` | 数字序号 | `NUMBERED_TITLE`，并保留句读闸门 |
| `chapter-en` | Chapter N | `TITLE_PATTERNS[2]`，不区分大小写 |
| `special` | 特殊符号 | 以 ☆★✦✧※ 开头、`【…】` 整行、或单独一行的 简介/文案/前言/序章/楔子/正文/终章/尾声/后记/番外 |

所有规则都作用在 **trim 后的整行** 上；匹配则整行（trim 后）就是章节标题。
预置规则沿用 `MAX_TITLE_LEN`（40 字）上限。

`special` 的正则：

```ts
const SPECIAL_TITLE =
  /^(?:[☆★✦✧※].{0,30}|【[^】]{1,30}】|(?:内容|文章)?简介|文案|前言|序章|楔子|正文|终章|尾声|后记|番外)$/
```

`正文完` 这类不会被匹配，因为要求整行相等。

预置表用 `Record<ChapterPresetId, …>` 声明，漏一个 id 编译报错。判「id 认不认识」用
`Object.hasOwn`，不走原型链——与快捷键白名单同一条理由。

### 2.3 自定义正则

1. 对每个 trim 后的整行做 `RegExp.test`，命中即标题。
2. 原样编译，只额外加 `i`；不由用户提供 flags，因此不会再引入 `/g` / `/y` 的 `lastIndex` 状态问题。
3. 不套 40 字上限，也不套句读闸门——用户手写的规则就是最终规则。
4. 只有空白字符的 pattern 视为不合法（匹配跑在 trim 后的行上，纯空白正则会命中几乎所有正文行）。
5. 编译失败视为规则不合法；匹配 0 行视为应用失败（见第 9 节）。

### 2.4 校验与相等

`chapters.ts` 新增：

```ts
export function chapterRuleProblem(v: unknown): string | null
export function chapterRuleEqual(a: ChapterRule, b: ChapterRule): boolean
```

`chapterRuleProblem` 返回第一个不合格字段的描述（与 `sessionProblem` / `settingsProblem` 同一姿势）：
不是对象、`kind` 不认识、预置 id 不认识、`pattern` 不是非空白字符串、正则编译失败。

`chapterRuleEqual` 逐字段比较；`undefined` 先归一成 auto 再比。

切章函数的入口先用 `chapterRuleProblem` 校验，非法规则直接抛错，不做静默回退。

## 3. 切章逻辑

### 3.1 扩展现有函数

```ts
export function splitChapters(
  text: string,
  fallbackTitle: string,
  rule: ChapterRule = DEFAULT_CHAPTER_RULE
): SplitResult
```

`loadNovelFromFile(filePath, rule = DEFAULT_CHAPTER_RULE)` 把 rule 透传下去。现有调用点不传第三参，
行为不变。

`isChapterTitle(line, rule = DEFAULT_CHAPTER_RULE)` 同样扩展。内部先编译一次匹配器，再逐行复用；
正则不在循环里重复 `new RegExp`。

### 3.2 重新分章必须有独立的入口

`splitChapters` 会重新拼 `flatText`，且在「文件开头到第一个标题全是空白」时把那段空白丢掉。
导入时可以这样，**但重新分章绝对不行**：`flatText` 是游标、`revealStart`、`chapterPos` 的坐标系，
重新分章一旦改了它，阅读位置与已存会话会整体错位，而且不会抛任何错。

所以新增：

```ts
export function resplitChapters(
  text: string,
  fallbackTitle: string,
  rule: ChapterRule
): SplitResult
```

它保证 `result.flatText === text`，只重新计算章节边界：

1. 扫描行起始偏移，用规则找出标题行。
2. 一条都没有：整本作为一章，标题用 `fallbackTitle`。
3. 第一个标题之前的文字非空白：作为「前言」一章 `[0, 首标题偏移)`。
4. 第一个标题之前的文字全是空白：**折进第一章**，第一章从 0 开始、标题仍是首个匹配到的标题。
5. 每章 `[本标题行偏移, 下一标题行偏移或 text.length)`，`charCount = end - start`。

这样 `chapters[0].start === 0`、区间首尾相接、`flatText` 逐字不变的三个既有不变量同时成立。

对「开头不是全空白」的输入，`resplitChapters(text, t, auto)` 算出的章节应与
`splitChapters(text, t, auto)` 完全一致；用一条属性用例钉住。

## 4. 主进程、后台进程与缓存

### 4.1 共享编排模块

新增 `src/main/novelService.ts`，把「按规则打开」与「按规则重切」的编排放在一处，worker 与主进程
兜底路径都调它：

```ts
export function openNovelWithRule(store: SessionStore, filePath: string): Novel
export function resplitNovelWithRule(
  store: SessionStore,
  sourcePath: string,
  rule: ChapterRule
): IpcResult<Chapter[]>
```

`openNovelWithRule`：

1. 读这本书的会话，取 `chapterRule`，缺省 auto。
2. 读缓存条目（正文 + 缓存里记录的规则）。
3. 缓存存在且 `chapterRuleEqual(缓存规则, 会话规则)`：直接返回缓存。
4. 缓存存在但规则不同：用 `resplitChapters(缓存正文, …)` 重切，写回缓存，返回。
5. 没有缓存：`loadNovelFromFile(filePath, rule)`，写缓存，返回。

`resplitNovelWithRule`：

1. 读这本书的缓存条目；**没有缓存就返回失败**（「找不到这本书的缓存，请重新导入」）。
   - 不能退回「重读源文件再切」：源文件与当前 `flatText` 可能差一个被丢掉的空白前言，
     章节偏移会整体错位。宁可让用户重新导入。
2. 用 `resplitChapters` 在缓存正文上重切。
3. 写回缓存（目录 + 规则）。
4. 返回 `chapters`。

缓存条目需要把规则读出来。`SessionStore` 的接口调整为：

```ts
readNovelCacheEntry(filePath: string): { novel: Novel; chapterRule: ChapterRule } | null
writeNovelCache(novel: Novel, chapterRule: ChapterRule): void
```

缓存规则来自 `NovelCacheMeta.chapterRule`，缺失按 auto。

### 4.2 worker 协议

`src/main/novelWorker.ts` 的请求改成联合类型：

```ts
type Request =
  | { type: 'open'; id: number; filePath: string; baseDir: string }
  | { type: 'resplit'; id: number; filePath: string; baseDir: string; rule: ChapterRule }

type Reply =
  | { id: number; ok: true; novel: Novel }
  | { id: number; ok: true; chapters: Chapter[] }
  | { id: number; ok: false; reason: string }
```

- `open`：`openNovelWithRule(store, filePath)`。
- `resplit`：`resplitNovelWithRule(store, filePath, rule)`。

`src/main/novelLoader.ts` 新增 `resplitNovelInBackground(sourcePath, rule): Promise<Chapter[]>`。
它给这条请求挂一个 10 秒看门狗：超时就 `child.kill()`、从待办表里删掉、用一个专门的错误类型
reject。理由见第 10 节。

`openNovelInBackground` 的协议只多一个 `type: 'open'`，其余不变。

### 4.3 IPC

`CH` 增加 `resplitNovel: 'wt:resplit-novel'`。主进程 handler：

1. 校验 `sourcePath` 是字符串、`rule` 过 `chapterRuleProblem`。
2. 走 `resplitNovelInBackground`。
3. 后台进程不可用时，退回主进程同步执行 `resplitNovelWithRule`——与 `openNovel` 现有的兜底
   姿势一致（只在打包异常时才会走到）。
4. 失败时返回 `{ ok: false, reason }`，reason 直接可展示。

`WtApi` 与 preload 增加：

```ts
resplitNovel: (sourcePath: string, rule: ChapterRule) => Promise<IpcResult<Chapter[]>>
```

## 5. 持久化

### 5.1 会话

`PersistedSession` 增加可选字段：

```ts
chapterRule?: ChapterRule
```

- 旧会话没有这个字段：照常有效，按 auto 处理。**不能**把它设成必填，否则升级一次就把所有进度作废。
- 新写入的会话一律带上它。

`sessionProblem` 对待这个字段有一处刻意的不对称：

- **写盘路径**：规则不合法就拒绝整次写入（返回字段名），与其它字段一致。
- **读盘路径**：规则不合法只丢掉这个字段、保留会话其余部分，并 `console.warn`。
  规则是附加信息，不该因为它（可能是手工改坏的）把「读到哪」一起弄丢。

实现上在读盘入口先单独跑 `chapterRuleProblem`，不合格就删掉该字段，再交给 `sessionProblem`。

### 5.2 缓存

`NovelCacheMeta` 增加可选字段：

```ts
chapterRule?: ChapterRule
```

- 缺失按 auto。旧缓存因此可能与 auto 规则匹配，不需要强制重建。
- 存在但不合法：整份缓存判无效、重新切分（缓存重建代价小，失败关闭）。
- 缓存是否可复用由 `chapterRuleEqual(缓存规则, 会话规则)` 判定。

### 5.3 渲染层的写入

`App` 现有的两处 `saveSession(engine.toSession())`（防抖保存与关窗/换书前的 `flushSession`）
改成：

```ts
void api.saveSession({ ...engine.toSession(), chapterRule: chapterRuleRef.current })
```

用 ref 而不是闭包值，避免防抖窗口里拿到旧规则。应用规则时额外**立即**保存一次，不等防抖。

## 6. 渲染层

### 6.1 状态

`App` 增加：

- `chapterRule` state，初值 auto。
- `chapterRuleRef`，与 state 同步。

### 6.2 打开书

`openNovel` 本来就会 `loadSession`。拿到会话后：

- `setChapterRule(session?.chapterRule ?? DEFAULT_CHAPTER_RULE)`。
- 章节已经由后台进程按这条规则切好，渲染层不需要再切。

### 6.3 应用规则

设置页回调 `handleApplyChapterRule(rule)`：

1. `const r = await api.resplitNovel(novel.sourcePath, rule)`
2. 失败：把 reason 交回设置页展示，不改任何状态。
3. 成功：
   - `nextNovel = { ...novel, chapters: r.value }`
   - 用旧引擎快照的 `cursor / revealStart / ratio / mode / startedAt` 构造新会话：
     - `chapterPos = r.value.map(c => clamp(cursor - c.start, 0, c.charCount))`
     - `activeChapter` 传 0 即可：`TypingEngine.fromSession` 不读这个字段，自己按 cursor 二分重算
   - `setNovel(nextNovel)`、`setEngine(TypingEngine.fromSession(nextNovel, 新会话))`
   - `setChapterRule(rule)`、同步 ref
   - 立即 `saveSession({ ...nextEngine.toSession(), chapterRule: rule })`
4. 返回新章数给设置页。

**正文不动**由 `resplitChapters` 的保证与「游标原样带过去」共同成立；`可见文本 =
flatText.slice(revealStart, cursor)` 这条核心不变量不受影响。

### 6.4 章节列表

`ChapterList` 不需要改：它只读 `novel.chapters` 与 `chapterPos`、`activeChapter`。

「清除阅读记录」会删掉 `sessions/`，规则随之遗忘；`App` 在清空状态时同时把 `chapterRule`
重置为 auto，避免界面上仍显示上一本书的规则。

## 7. 设置界面

左栏 `PAGES` 增加一页：

```ts
{ id: 'chapters', label: '分章设置', icon: IconToc }
```

加页签的同时必须加面板（现有注释已警告：只加表里的行会造成空白页而用例全绿）。

「分章设置」面板内容：

1. 顶部：`当前小说：《书名》 · 共 N 章`。没有导入小说时显示提示并禁用全部控件。
2. 单选列表：自动识别（默认）/ 第X章（中文）/ 数字序号 / Chapter N / 特殊符号 / 自定义正则。
3. 选中自定义时出现输入框，提示：
   - 按每个整行匹配，忽略首尾空白，不区分大小写；
   - 建议用 `^` 和 `$` 包住整行。
4. 「应用」按钮：立即动作，不走「草稿 + 保存」。执行中显示「处理中…」并禁用。
5. 结果就地反馈：
   - 成功：`已重新分为 N 章`
   - 失败：显示 IPC 给的 reason（例如「这条规则没有识别出任何章节，目录未改动」）
6. 「恢复」就是选回自动识别再点应用，不另设撤销按钮。

打开对话框时，面板的草稿规则初始化为这本书当前保存的规则。对话框组件在关闭时并不卸载，
所以草稿的重置要沿用现有「`wasOpen` 就地重置」的写法，不能指望 `useState` 初值。

需要的 prop 由 `App` 传入：`novelTitle`、`chapterCount`、`chapterRule`、`onApplyChapterRule`。

## 8. 进度换算

重新分章后：

- `cursor`、`revealStart`、`ratio`、`mode`、`startedAt` 全部原样。
- 新 `chapterPos[i] = clamp(cursor - chapters[i].start, 0, chapters[i].charCount)`。
- 因此光标之前的章显示 100%，当前章按比例，之后是 0。

这条规则只依赖光标，不继承旧目录里跳章留下的历史百分比。用户事先跳来跳去读过的章，在重新分章后
以「光标位置」这一条线重算，行为可预测。

## 9. 异常与失败行为

| 情况 | 行为 |
| --- | --- |
| 自定义正则编译失败 | 输入框下列红，应用按钮禁用，不发 IPC |
| 规则匹配 0 行 | 后台返回失败；提示「没有识别出任何章节，目录未改动」，界面状态不动 |
| 缓存不存在 | 返回失败；提示重新导入这本书（见 4.1 的理由） |
| 后台进程不可用 | 主进程同步执行一次，与现有导入兜底一致 |
| 后台进程卡死 | 10 秒超时后杀掉并重启，提示「规则执行超时，目录未改动」 |
| 缓存写失败 | 只记日志；本次目录照常应用，下次打开重切一次 |
| 会话写失败 | 提示保存失败；规则与进度只在本次有效 |

## 10. 性能与安全

- 切章在 utility process 里跑，不占主进程事件循环，与现有解码路径一致。9MB 样本切章量级约 200ms。
- 用户写的正则可能触发灾难性回溯（例如 `^(a+)+$`）。JS 正则无法中断，因此靠看门狗：
  10 秒无响应就杀掉 worker。杀掉只影响在途请求，下一次请求会重新 fork。
- 自定义正则只会由用户本人在设置里输入，不来自文件或网络；主要风险是手滑，不是恶意输入。

## 11. 不做的事

- 不做应用前预览（用户明确选择「先应用再说」）。
- 不做多规则叠加或规则启用开关。
- 不做手动拆分/合并章节边界。
- 不做超长章节自动按字数拆分。
- 不在导入流程里选规则。
- 不作用于工作文档（txt / md），只作用于小说。
- 不设跨书的全局默认规则。
- 不做规则导入/导出。

## 12. 测试与文档

测试：

- `tests/unit/chapters.test.ts`：每条预置的正例/反例、自定义正则、非法正则、0 匹配、
  `chapterRuleProblem`、`chapterRuleEqual`、`resplitChapters` 的 `flatText` 不变与区间连续。
- `tests/unit/sessionStore.test.ts`：无 `chapterRule` 的旧会话仍有效；规则往返；读盘时坏规则只丢字段；
  缓存的规则字段与复用判定。
- `tests/unit/ipcContract.test.ts`：新通道与 `WtApi` 方法的形状。
- 设置页用例：无小说时禁用、选中自定义出现输入框、应用成功/失败反馈。
- `app.test.tsx`：应用规则后光标与已显示文本不变、`chapterPos` 按新章重算、会话带上了规则。

门禁：`pnpm typecheck`、`pnpm test`、`pnpm build`。接口约定只以退出码为准。

文档：

- `README.md` 与 `README.zh-CN.md` 的 Usage 各加一小节（英文版与中文版结构一一对应）：
  分章不对时去 Settings → Chapter splitting，选规则或写正则，按书记住。
- `CLAUDE.md` 的持久化表补上会话与缓存新增的 `chapterRule` 字段及其缺失时的语义。
