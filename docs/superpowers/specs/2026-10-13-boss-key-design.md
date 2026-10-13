# 老板键 —— 设计文档

日期：2026-10-13
状态：待用户审阅

## 1. 目标

在设置里导入一份「工作文档」，之后按一条快捷键就能把阅读区从小说切到那份文档，再按一下切回来。

要解决的问题是具体的：这个应用把小说伪装成 Word，但**伪装在最不该失效的时候失效**——老板走过来时，屏幕上正摊着你一路打出来的几百字小说正文。老板键要做的是把这屏字换掉。

三个已经拍板的口径：

- **工作文档是 txt / md 纯文本**，不做 docx 保真渲染（理由见第 3 节）。
- **工作文档就是第二本 `Novel`**，走同一个引擎。老板模式下打字照样抽字。
- **切换是应用内快捷键，按一下切过去、再按一下切回来**；不做全局热键，不做按住式。

## 2. 现状 —— 这次要加的是什么

现在应用里只有「一本书」这个概念：`App` 持有 `novel: Novel | null` 与 `engine: TypingEngine | null`，两者由 `openNovel()` 一起提交，渲染树读的就是这一对。

老板键要的是**同一个窗口里有两份内容，显示哪一份由用户按一下决定**。所以本次改动的实质是：把「一对」变成「两对 + 一个布尔」，其余一切（引擎、抽字、比例、输入法）全部复用。

## 3. 核心决策：工作文档 = 第二本 `Novel`

这是整个设计的地基，也是本次唯一一处「选了这条，别的都跟着变」的决定。

**为什么不引入 docx 解析。**

- 真正「保真」渲染 docx 需要 `docx-preview` 那一类重型渲染器：它要解析 `document.xml` / `styles.xml` / 编号定义，再把结果渲染成 DOM，之后还得跟本应用的纸张宽度、主题变量、深色模式逐一对齐。那是独立一个功能的体量。
- 常用的那个 `mammoth` **不解决这个问题**：它的设计目标就是「用语义信息生成干净的 HTML，忽略其余样式」——字号、颜色、缩进、页边距一概丢。用它得到的是「结构对、版式全无」的东西。
- 反过来，**Word 自己就能「另存为纯文本」**，三步。为省这三步引入一个解析器不划算。
- 最要紧的是：**表格和图片进不了 `flatText`**。一旦要保真版式，工作文档就不再是一本 `Novel`，第 4 节那套「两份引擎、白送抽字」的架构整个作废。

**为什么「第二本 `Novel`」这个形状值得要。**

现在的核心不变量是「阅读区显示的内容恒等于 `flatText.slice(revealStart, cursor)`」，而 `TypingEngine` 本来就是「一份内容 + 一个游标」。工作文档走 `loadNovelFromFile` 进来就是一本 `Novel`，于是：

- 老板模式下**打字照样抽字**，不需要写任何额外逻辑；
- 两份进度天然独立（游标、`chapterPos`、`activeChapter` 都在各自的引擎里）；
- 比例、输入模式、纸张渲染、`RENDER_WINDOW_LIMIT` 折叠——全部照旧。

**代价**：老板模式下屏幕上的确实是「按比例逐字抽出来」的，不是文档原样铺开。这是访谈里明确选定的行为——老板盯着你的时候你能继续打字，字继续出来。

## 4. 数据模型

### 4.1 设置新增两个字段

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `workDocPath` | `string \| null` | `null` | 工作文档源文件路径。`null` = 没配 |
| `bossFillPercent` | `number` | `100` | 老板键「铺满一页」的百分比，0–100 |

`bossFillPercent` 的**结构校验只判「是不是有限数字」**，与 `ratio` 同一姿态；值域夹紧交给 core（见 5.3）。理由是 `sessionStore` 那一层的职责是「这份 JSON 能不能信」，不是业务规则。**所以「夹紧」这件事必须在消费点上真的做掉**：启动读回这个值时就要过一遍 `clampBossFillPercent`（见第 6 节），否则一个有限的越界值（手改出来的 `500`）会直接进 React 状态、再照原样写回磁盘——`fillCharsFor` 内部虽然也夹，但设置里显示的和存盘的会是 500。

### 4.2 快捷键新增三条

| id | 标签 | macOS 默认 | 其它平台默认 |
|---|---|---|---|
| `boss-key` | 老板键 | `⌘⇧B` | `Ctrl+Shift+B` |
| `boss-fill-up` | 老板键铺满 + | `⌘⇧↑` | `Ctrl+Shift+↑` |
| `boss-fill-down` | 老板键铺满 − | `⌘⇧↓` | `Ctrl+Shift+↓` |

三条**都不进 `RESERVED` 清单**——那张清单拦的是 macOS 原生菜单 role 与系统约定占掉的键（⌘Q / ⌘W / ⌘C…），这三条不是。`ArrowUp` / `ArrowDown` / `KeyB` 都已经在 `KEY_CODES` 白名单里。

`ShortcutActions` 的类型是 `Record<ShortcutId, () => void>`（穷尽的），所以加了 id 之后分发器不补三条动作**直接编译不过**——这正是那条类型存在的意义。

### 4.3 向后兼容：本次最容易毁数据的地方

`sessionStore.ts` 的 `FILLED_DEFAULTS` 表**必须补上 `workDocPath` 与 `bossFillPercent` 两个条目**。

漏了的话：旧版写下的 `settings.json` 里没有这两个键 → `settingsProblem` 按「**一个字段不合格就整份退回默认值**」判非法 → 用户改过的**文档名、外观、纸张、录过的快捷键一次性全丢**，而且没有任何报错，只有一行 `console.warn`。

- **「键不存在」= 旧版本写的** → 补默认值
- **「值不合法」= 坏文件** → 整份退回（既有姿态不变）

第 12 节为这条坑专门留了一个用例。

## 5. 铺满的语义

### 5.1 进入老板模式时是「重铺」，不是「接着上次」

**每次进入老板模式，工作文档的光标一次性推到铺满量；工作文档不持久化任何进度。**

- 若持久化进度，老板在你旁边站久了，工作文档会被抽到末尾。**下次一进来就是末尾，你打字屏幕上不出字**——比什么都不做更露馅。
- 「铺满量」这个旋钮会被「进度」盖住：把 100% 调到 20% 再按老板键，屏幕上还是那一大片，旋钮等于废了。

代价：老板模式下多抽的字，切走再回来就没了。工作文档的「读到哪」本来就没有意义，这个代价是零。

### 5.2 core 新增：`TypingEngine.revealTo(n)`

```ts
/** 把阅读光标设到 n，夹紧到 [revealStart, total]。可增可减。 */
revealTo(n: number): void
```

内部走 `commit`，所以 `chapterPos` / `activeChapter` 的**统一收尾规则**与 `pump` / `backspace` 完全一致——不新增第二条维护路径。

### 5.3 core 新增：`src/core/bossKey.ts`

一个只干这件事的小模块，纯函数、无 DOM（守住 core 纯净性门禁）：

```ts
export const BOSS_FILL_MIN = 0
export const BOSS_FILL_MAX = 100
export const BOSS_FILL_STEP = 10
/** 一页约多少字。约数，用户按 +/− 校准。 */
export const CHARS_PER_SHEET = 1330

export function clampBossFillPercent(n: number): number
export function stepBossFill(current: number, dir: 1 | -1): number   // 两端夹住，不循环
export function fillCharsFor(percent: number): number               // → 给 revealTo 用
```

`CHARS_PER_SHEET` 的推导写进注释：

> 纸张宽 794px，左右 padding 各 84px → 正文宽 626px；字号 15px → 约 41.7 字/行。
> `min-height` 1080px，上下 padding 72 / 96px → 正文区 912px；行高 1.9 × 15px = 28.5px → 32 行。
> 32 × 41.7 ≈ 1334，取 1330 —— 恰好铺满一整张纸（72 + 912 + 96 = 1080，纸不会长高）。

它的性质与 `RENDER_WINDOW_LIMIT` 同类：**一个写在 core 里的经验常量**。字号、纸张尺寸、行高任何一个改了它都会失准，所以要可调——这正是 `+/−` 那两条键存在的理由。

**量的是「一页」，不是「一屏」——这两个数差得不小，别混。** 可见区比一页矮得多：`.wt-canvas` 的可见高度实测 667px，而一页正文要 912px。所以 100% 时纸的上边沿落在视野之外，画面是一整窗连续的字——那正是老板键要的样子（像「你正在一份文档中间」，而不是「光标正好停在页首」）。想让纸的上边沿露出来，往 60% 以下调（不滚动的条件是光标底边离画布下沿还留着 `CARET_MARGIN` 24px，算下来约 59.7%）。

由此还有一条：**60% 以上，按键带来的画面变化只是「字往上滑」**——所以 5.4 那条 toast 不是装饰，它是唯一能告诉用户「这一下按到了」的反馈。

### 5.4 `+` / `−` 的行为

- 改设置：`stepBossFill(current, ±1)`，步进 10，**两端夹住**（到 0 或 100 就停，不循环）。
- **若此刻正在老板模式**，立刻把当前画面重铺一次——即 `revealTo(fillCharsFor(新百分比))`，让用户直接看到效果（这条与下面的「进入老板模式」都会让光标往回退——`revealTo` 不是只能前进）。
- 无论哪种情况都弹一条 toast 报当前档位：「铺满 40% ≈ 532 字」。
- 非老板模式下按只改设置、不动画面。

## 6. 渲染层状态结构

`App` 从一对变成两对，外加一个布尔：

```
novel, engine            // 小说（现有语义不变）
workNovel, workEngine    // 工作文档（新）
bossMode: boolean        // 显示哪一份（新，纯内存）
```

显示层只认一个「当前」：

```
// bossActive 而不是裸的 bossMode：工作文档可能读不出来（文件被移走）或还没导入，
// 那时若只看 bossMode，页面会变成一片空白。多这一层，「想切过去」与「切得过去」就分开了。
const bossActive   = bossMode && workNovel !== null && workEngine !== null
const shownNovel   = bossActive ? workNovel  : novel
const shownEngine  = bossActive ? workEngine : engine
```

`useTypingEngine(shownEngine)`、`InputCapture` 的目标、`Page` / `ChapterList` / `StatusBar` 的 props 全部改读这一对。**「老板模式下打字照样抽字」就是靠这一行落地的**，不需要额外逻辑。

三条边界规则：

1. **工作文档不参与会话持久化。** `sessions/<hash>.json` 只属于小说，`lastSourcePath` 也永远指向小说。「清除阅读记录」因此天然不碰工作文档——它是配置，与文档名同类。
2. **工作文档不写 `novel-cache`。** 缓存是**单槽**的（`novel-cache.json` + `novel-cache.txt` 共用一份），让它占了，小说每次启动都要重解码（9MB 那本是秒级）。工作文档是小文本，每次启动直接读，几十毫秒。
3. **`bossMode` 不落盘。** 启动永远显示小说——应用崩了重启不该自动进老板模式，少一个需要校验的磁盘状态。

### 6.1 一个必须拆开的引用：`engineRef`

`App` 现在的 `engineRef` 同时承担两件事：

- **「当前显示的引擎」**——`InputCapture` 的目标、跳章、改比例改模式；
- **「要落盘的引擎」**——`flushSession()` 读它，`beforeunload` 也读它。

放进老板模式之后这两个含义就分家了：老板模式下 `engineRef.current` 是**工作文档**的引擎，而 `flushSession` 会把它 `toSession()` 之后写进 `sessions/<工作文档的 hash>.json`——**恰好违反了第 6 节第 1 条**，而且是在关窗那一下静默发生。

所以必须拆成两个：

- `shownEngine`（渲染树用，跟着 `bossMode` 走）
- `novelEngineRef`（只给持久化用，**永远指向小说那本**）

第 12 节为这条留了用例。

### 6.2 toast 状态要提到 `App`

老板键的两类提示（「还没导入工作文档」、铺满档位）必须弹 toast，但 **`notify` 现在住在 `ToolbarProvider` 里，而 `App` 在 provider 外面**（`App` 就是渲染 `<ToolbarProvider>` 的那个组件），拿不到 `useToolbar()`。

所以把 toast 的 `useState` 与 `notify` **上提到 `App`**，`ToolbarProvider` 改成受控接收 `toast` / `notify` 两个 prop。provider 内部那两处兜底（`onImport ?? …notify(…)`）改用传进来的 `notify`，行为不变。

## 7. 老板模式下的界面跟随

| 位置 | 老板模式下 |
|---|---|
| 标题条文档名 | 显示工作文档的文件名，切回小说恢复 |
| 左侧章节栏 | 按**折叠态**渲染 |
| 状态栏「比例 1:N」 | 不渲染 |
| 状态栏「编码 X」 | 不渲染 |
| 状态栏「输入模式 X」 | 不渲染 |

后三格的破绽性质相同：**真 Word 的状态栏没有这三样**。而它们在老板模式下对用户也没有任何用处。

两条实现上的注意：

- **标题条与设置里的「文档名」要拆成两个 prop。** `Ribbon` 现在把同一个 `docTitle` 既用于标题条（`Ribbon.tsx:1284`）又转手给 `SettingsDialog`（`Ribbon.tsx:1315`）。老板模式下若只覆盖前者，设置对话框里的文档名字段就会串味。所以加一个 `displayTitle`：**标题条读它，`docTitle` 保持原义**。
- **章节栏用显示层覆盖，不动用户偏好。** 传 `collapsed={sidebarCollapsed || bossMode}`——`sidebarCollapsed` 本身不变，切回小说原样恢复。`⌘⇧H` 在老板模式下仍然改偏好，但当前显示不跟着变（老板站在旁边时按这条键的概率极低，不值得为它加一套「按键为什么没反应」的提示）。

**既有的不一致，本次不扩大也不顺手修**：原生窗口标题（`main/index.ts` 里写死的 `文档1 - Word`）**从来没跟着 `docTitle` 走过**，Mission Control 与窗口菜单里一直是它。

## 8. 导入与移除

入口在设置对话框里新开一组「工作文档」：

- **状态行**：未导入 / 文件名（悬停显示完整路径）/ ⚠ 源文件读不出来
- **「导入工作文档…」** → 新 IPC `wt:import-work-doc` → 文件对话框（txt 优先，也列 md 与所有文件）→ 主进程 `loadNovelFromFile` → 返回 `Novel`
- **「移除」** → `workDocPath` 置 `null`，两份工作文档状态一起清掉

两个取舍：

1. **导入 / 移除是立即动作，不走「草稿 + 保存」。** 直接对齐设置里现有的「导入小说」与「清除阅读记录」——它们也是立即动作。文件选择框是外部动作，做成「选了文件还得再点保存」很别扭。`workDocPath` 本身仍是设置字段，因此照旧走那条 600ms 防抖写盘。
2. **启动时读不到工作文档，不弹打扰提示**（只 `console.warn`），改在设置对话框那一行标红。理由是启动弹 toast 会在你早就忘了这回事的时候吓你一下；真正需要知道的时候是你去按老板键、或者去设置里看。

工作文档的引擎用**全局比例**构造，与「新导入一本书」走同一条路。

**新 IPC 单开一条通道，不复用 `openNovelPath`**：主进程那个 `openNovel()` 会顺手写小说缓存（第 6 节第 2 条说好不写），而且它在文件读不出来时是**抛异常**——工作文档这条路要的是「读不到就返回 `null`」，不是把渲染层那次 invoke 打成 rejection。所以：

| 通道 | 入参 | 返回 | 用途 |
|---|---|---|---|
| `wt:import-work-doc` | — | `Novel \| null` | 弹文件框、选中则解析，取消返回 `null` |
| `wt:load-work-doc` | `path: string` | `Novel \| null` | 启动时按 `workDocPath` 读一次，读不到返回 `null` |

`openNovel()` 里加一行 `setBossMode(false)`——「打开一本小说」就是「你要看小说」。启动路径上 `bossMode` 本来就是 `false`，这行只对老板模式下按 `⌘O` 的情形生效。

## 9. 错误处理与边界

| 情形 | 行为 |
|---|---|
| 没导入工作文档就按老板键 | 不切换，toast：「还没导入工作文档（文件 → 设置 → 导入工作文档）」 |
| 工作文档源文件被移走 / 删掉 / 读不出 | 同上不切换，文案换成「工作文档读不出来了，请在设置里重新导入」。**`workDocPath` 不清**——文件可能只是临时不在 |
| 导入了一个空文件 | 当场拒绝 + toast，设置不变。放进来的话老板键就等于没有 |
| 老板模式下把文档抽到末尾 | 不特殊处理，沿用 `pump` 原有的 `cursor >= total` 闸——与小说抽到末尾的行为一致 |
| 工作文档与小说是同一个文件 | 允许，不做检查 |
| 老板模式下按 `⌘O` | 照常导入，`openNovel` 里那行让它**自动退出老板模式** |

## 10. 明确不做

- **原生窗口标题跟着变**（既有问题，见第 7 节）
- **纸张分页**（真 Word 是分页的，这里是连续长纸）——既有特性
- **docx 保真渲染**（见第 3 节）
- **全局热键**（`globalShortcut` 不碰）：老板键是「你正对着窗口打字、老板走过来」时按的，应用必然有焦点
- **按住式切换**：按住期间要防按键重复，且老板不走你就不能松手

## 11. 影响面

| 文件 | 改动 |
|---|---|
| `src/core/bossKey.ts` | **新增**：常量 + `clampBossFillPercent` / `stepBossFill` / `fillCharsFor` |
| `src/core/engine.ts` | 新增 `revealTo(n)` |
| `src/core/shortcuts.ts` | `ShortcutId` 加三条；`SHORTCUTS` 加三行 |
| `src/core/types.ts` | `AppSettings` 加 `workDocPath` / `bossFillPercent`；`defaultSettings()` 带上 |
| `src/main/sessionStore.ts` | **`FILLED_DEFAULTS` 加两个键**；`settingsProblem` 加两项校验 |
| `src/main/channels.ts` | 加 `importWorkDoc` / `loadWorkDoc` 两条 |
| `src/main/ipc.ts` | 两个 handler（均返回 `Novel \| null`） |
| `src/preload/index.ts` | 暴露 `importWorkDoc()` / `loadWorkDoc(path)` |
| `src/renderer/src/App.tsx` | 大头：两份状态 + `bossMode` + toast 上提 + `engineRef` 拆分 + 渲染选择 + 三条动作 |
| `src/renderer/src/state/ToolbarContext.tsx` | toast 受控化（接收 `toast` / `notify`） |
| `src/renderer/src/components/StatusBar.tsx` | 老板模式下不渲染比例 / 编码 / 输入模式三格 |
| `src/renderer/src/components/Ribbon.tsx` | 加 `displayTitle` prop，标题条读它 |
| `src/renderer/src/components/SettingsDialog.tsx` | 新增「工作文档」一组（状态行 + 导入 + 移除） |
| `src/renderer/src/styles/` | 设置里那一组的样式；状态栏少三格后的间距 |

按仓库硬约定，**每个被改动的源文件都要同步实现计划里对应的代码围栏**（`docs/superpowers/plans/2026-10-06-…md` 是正本），交付前用脚本重抽比对。

## 12. 测试策略

- **`core/bossKey.ts`**：步进两端夹住、`fillCharsFor` 的取整、越界输入的夹紧——纯函数，好测。
- **`core/engine.ts`**：`revealTo` 夹紧到 `[revealStart, total]`、可增可减、走完 `commit` 后 `chapterPos` 与 `activeChapter` 正确。
- **`core/shortcuts.ts`**：三条新 id 的平台默认值与 `resolveShortcuts` 解析。
- **`sessionStore`**：
  - 两个新字段的结构校验（坏值 → 整份退回）；
  - **拿一份缺这两个键的旧 `settings.json` 读一遍，断言用户原有的文档名与快捷键没丢**——第 4.3 节那条坑的守卫。
- **渲染层**：
  - 老板键切换的三项界面跟随（标题条名字、章节栏折叠、状态栏少三格）；
  - 未导入时按老板键只提示、不切换；
  - `+` / `−` 改设置并在老板模式下重铺；
  - **老板模式下打字抽的是工作文档**；
  - **老板模式下 `flushSession` 写的是小说的 session**（第 6.1 节那条坑的守卫）。
- **真机验收**（`_electron` + 真按 `⌘⇧B`、中文输入法）按本仓库惯例**由用户跑**。
