# 小说书库（拷贝入库、管理、切换、删除）设计

日期：2026-10-18
状态：设计已确认，待实现

## 1. 背景与目标

现在导入小说走的是「记住原文件路径、每次直接读原文件」：

- `settings.json` 的 `lastSourcePath` 指向原文件；
- `Novel.sourcePath` 是原文件路径，`sessions/<hash>.json` 与单槽小说缓存都按它命名；
- 用户把原文件删掉、移走，这本书就打不开了，进度还在但无从恢复。

本次要做的：

1. 导入时把原文件**拷贝一份到应用自己的目录**，之后一律读拷贝件。原文件删了也不影响。
2. 设置对话框里加「小说管理」页：查看书库、切换当前书、删除。
3. 删除一本书＝删拷贝件 + 删这本书的阅读记录。
4. 「清除阅读记录」改为**只清当前打开的那本**，书仍开着、书库里的条目仍在。

明确不做的见第 13 节。

## 2. 决策记录

以下是在设计问答里定下来的口径，实现时不要自行改动：

| 问题 | 决定 |
| --- | --- |
| 升级前已经导入的书 | 只迁移「上次打开的那本」：启动时发现不在书库就拷贝入库、迁移进度；其它旧书不处理 |
| 重复导入判据 | 按**原文件路径**。同一路径再次导入＝已导入，不再建第二条；不同路径即使内容相同也允许并存 |
| 打开同一路径且拷贝件丢失 | 用这次的源文件补拷（修复），进度保留 |
| 删除当前正在读的书 | 清空阅读区，回到「还没导入」的空状态 |
| 清除阅读记录 | 只作用当前书，位置清零、书仍打开；不清书库、不删拷贝件 |
| 没有打开书时按清除 | 只提示「还没有打开小说」，不做任何事 |
| 命令行传 `.txt` | 当作一次导入：库外路径先拷贝入库再打开；打不开照旧回退到「上次打开的那本」 |
| 书库列表 | 书名、进度百分比、大小、导入时间、当前书高亮；按最近阅读倒序，没读过的按导入时间倒序 |
| 空文件 | 拒绝导入（0 字节） |
| 存储形态 | 每本书一个目录 + `meta.json`，不做全局索引文件 |

## 3. 磁盘布局与数据模型

### 3.1 目录

```
userData/library/
  <id>/
    <原文件名>          ← 原文件按字节原样拷贝，扩展名保持不变
    meta.json          ← 小元数据
```

- `userData` 落在 `app.getPath('userData')`，`WT_USER_DATA` 重定向照常生效。
- `<id>`：原文件**绝对路径**（`path.resolve` 之后）的 sha256 前 32 个 hex 字符，与
  `sessionFileName` 同一套定长命名。同一路径落到同一个目录，这就是重复导入的判据。
- 拷贝件**保留原文件名（含扩展名）**。书名仍由 `loadNovelFromFile` 从文件名推出，
  标题不必存进元数据，解码管线一行不用改。
- 拷贝的是**原始字节**，不是解码后的文本。编码检测、换行归一化、切章继续作用在拷贝件上；
  小说缓存按拷贝件的 `mtime` / `size` 校验。

### 3.2 元数据

`meta.json`：

```ts
export interface LibraryMeta {
  version: 1
  /** 原文件绝对路径（resolve 之后）。只用于说明与排查，重复判定靠目录名。 */
  originalPath: string
  /** 拷贝件的文件名。必须是 basename：不含路径分隔符，不是 . 或 ..。 */
  fileName: string
  importedAt: number
  /** 拷贝件的字节数。 */
  size: number
  /** 解码后的全文长度，进度百分比的分母。 */
  charCount: number
}
```

校验沿用仓库现有姿势（`sessionProblem` / `cacheMetaProblem` / `settingsProblem`）：
`libraryMetaProblem(v)` 逐字段问、**返回第一个不合格字段的描述**，不返回 true/false。
不合格的条目不丢弃，而是标记为坏条目（见第 5 节），让用户能删掉它。

### 3.3 书与身份的对应

- `Novel.sourcePath` 是**拷贝路径**。`sessions/<hash(拷贝路径)>.json`、单槽缓存、
  `lastSourcePath` 都跟着它走，现有机制不变。
- 进度 = 会话里的 `cursor / meta.charCount`，超过 100% 时按 100% 显示。
- 最近阅读 = 该书会话文件的 mtime；没有会话文件＝从没读过。

### 3.4 写入的完整性

- 新书的拷贝先写进 `library/.tmp-<pid>-<seq>/`（目录名不以 32 位 hex 开头，列表天然忽略），
  再整目录 rename 到 `library/<id>`。`meta.json` 要等解码后才知道 `charCount`，所以它在
  打开之后才写（见 4.1）。
- 所有 `meta.json` 写入走 temp + rename，与设置 / 会话 / 缓存同一姿势。
- 崩溃可能留下 `.tmp-*` 目录；列表忽略，不做自动清理。

## 4. 导入流程

### 4.1 一次导入

入口：设置里的「导入小说」（阅读设置页与小说管理页各一个）、命令行 `.txt`、
启动时恢复 `lastSourcePath`。三者最终都走同一个函数。

1. `resolve` 源路径，算 `id`。
2. `stat` 源文件：0 字节直接拒绝，提示「这个文件是空的，换一个」；读不了则报错。
3. 看 `library/<id>` 是否存在：
   - **不存在**：新建临时目录 → 拷贝原文件 → rename 成正式目录 → 迁移旧会话（4.2）→
     打开 → 写 `meta.json`（`charCount` 取打开后 `flatText.length`）→ 成功后才删旧会话。
     meta 写盘失败时删掉这次新建的目录与会话副本、返回失败；旧会话因为还没删，原样保留。
   - **存在且 meta 合法、拷贝件在**：不拷贝，直接打开已有拷贝，状态 `already-imported`。
   - **存在且 meta 合法、拷贝件丢失**：把源文件补拷进该目录、rename 到位，再打开，
     状态 `repaired`；打开后按新正文重写 `charCount` 与 `size`。
   - **存在但 meta 不合法**：按全新导入重建该目录（先拷到临时目录、成功后再删旧目录再
     rename）。会话文件按拷贝路径命名，天然保留，进度不丢。

`meta.json` 写在目录 rename 之后。极端情况下进程死在 rename 与写 meta 之间，会留下一个
「有拷贝、没 meta」的坏条目；用户对同一路径再导入一次即可重建（4.1 的第四条）。

### 4.2 旧会话迁移

导入一本**新入库**的书时，若 `sessions/<hash(原路径)>.json` 存在（旧版读过这本书）：

1. 读出旧会话，把 `sourcePath` 改成拷贝路径，写到新会话路径；
2. **读回**确认新会话可读；
3. 以上都在导入成功之前完成，但**旧会话先不删**；
4. 整个导入（含 meta 写盘）成功之后，才删旧会话。

顺序对应 `migrateLegacySession` 的「先确认新位置读得出来、再删旧文件」；把删除推到最后
是为了失败可回滚：导入失败时删掉新目录即可，旧进度原样还在。迁移必须先于打开，
因为 `openNovelWithRule` 要从会话里读分章规则。

### 4.3 打开

拷贝入库后调用现有 `openNovel(copyPath)`：后台进程解码、写单槽缓存、按会话恢复进度。
导入函数对外返回：

```ts
export interface ImportNovelResult {
  novel: Novel
  status: 'imported' | 'already-imported' | 'repaired'
}
```

渲染层的提示：

- `imported`：不提示，直接打开（现有行为）。
- `already-imported`：提示「这本书已经导入过了」，然后打开已有那本。
- `repaired`：提示「这本书已经在书库里，拷贝文件已修复」，然后打开。

### 4.4 启动与命令行

- `openNovelPath(path)` 的语义扩展：路径在 `library/` 之内 → 原样打开；在库外 → 先走
  4.1 的导入，再打开拷贝件。
- 启动时 `lastSourcePath` 若仍是原路径，就走这条路自动迁移；`openNovel` 会把
  `lastSourcePath` 改写为拷贝路径。
- 命令行命中的 `.txt` 同样走导入。打不开时照旧回退到「上次打开的那本」。
- 原路径已经在书库里（同一路径重复导入）时直接打开已有拷贝，不会产生第二条。

## 5. 书库列表

新增 IPC `listNovels()`，主进程：

1. 遍历 `library/` 下名字匹配 `^[0-9a-f]{32}$` 的目录；
2. 读 `meta.json` 并校验；`stat` 拷贝件；读该书会话文件；
3. 每本返回：

```ts
export interface LibraryEntry {
  id: string
  /** 展示名。meta 合法时取自拷贝件文件名（去扩展名），否则是兜底文案。 */
  title: string
  /** 拷贝路径；坏条目可能是空串。渲染层只用它判断「是不是当前书」。 */
  sourcePath: string
  originalPath: string
  size: number
  importedAt: number
  charCount: number
  /** 会话里的 cursor；没有会话为 0。 */
  cursor: number
  /** 会话文件 mtime；从没读过为 null。 */
  lastReadAt: number | null
  broken: boolean
}
```

- 坏条目（meta 不合法、拷贝件丢失）照样返回：`broken: true`。标题按这个顺序取：meta 里的
  `fileName` → 目录里唯一那个非 `meta.json` 文件的名字 → 「无法读取的条目」。界面只允许删除。
- 单条坏数据不能拖垮整个列表：逐条 try/catch，失败的那条降级为坏条目并打一行 warn。
- `library/` 不存在＝空数组，不报错。

排序与百分比归渲染层：

- 排序键 `lastReadAt ?? importedAt`，倒序。
- 百分比 `Math.min(100, Math.floor(cursor / charCount * 100))`；`charCount` 为 0 时显示 0%。

## 6. 删除小说

新增 IPC `deleteNovel(id)`：

1. `id` 必须匹配 `^[0-9a-f]{32}$`，否则返回失败。这是路径穿越的唯一闸门：
   `path.join(libraryDir, id)` 之前必须过它。
2. 删 `library/<id>` 整目录。
   - 失败：整体返回失败，会话与缓存都不动（拷贝件还在，书没丢）。
3. 删除该书会话 `sessions/<hash(拷贝路径)>.json`。
   - 失败：保留孤儿记录，返回失败并带上路径；孤儿记录不可见、不影响功能。
4. 若单槽缓存的 `sourcePath` 正好是这本书，一并删 `novel-cache.json` 与 `novel-cache.txt`。

第 3、4 步都要先算出拷贝路径：meta 合法时由 `fileName` 得出；meta 不合法时在目录里找
唯一那个非 `meta.json` 的文件；两者都做不到（目录里没有书）就跳过，只删目录。

删的是**当前正在读**的那本时，渲染层必须先做三件事再调删除，顺序与现有「清除阅读记录」
的防复活一致：

1. `openSeqRef.current++`（作废在飞的打开）；
2. `setNovel(null)`、`setEngine(null)`；
3. `patchSettings({ lastSourcePath: null })`。

这些都排在 `await deleteNovel` **之前**，否则待发的防抖写会在删除之后把会话又写回来。
删除成功后界面停在空状态；删除失败则 toast 原因，书仍在书库里，可以重新打开。

## 7. 「清除阅读记录」的语义变更

现在是「删掉所有书的会话 + 缓存 + 旧版单槽会话，并把 `lastSourcePath` 清空」。改为：

- 只作用**当前打开的书**：位置类字段清零
  （`cursor` / `revealStart` / `chapterPos` / `activeChapter` / `startedAt`），
  保留 `ratio`、输入模式、分章规则这些「怎么读」的偏好。
- 书仍开着，书库里那本仍在，`lastSourcePath` 不变。
- 实现：用当前快照构造一份零进度会话，经 `TypingEngine.fromSession` 得到新引擎，
  设回状态后**立即** `saveSession` 写回。不删会话文件——删掉的话，关掉再开时
  分章规则会跟着丢；立刻写回零进度则既清了位置又保住了规则。
- 没有打开书时：提示「还没有打开小说」，不做任何事。
- `clearReadingHistory` 不再有入口，从 `SessionStore`、IPC、preload、`WtApi` 中移除。
  `sessions/` 里其它书的旧记录保留（不可见、无害）；旧版单槽 `session.json`
  仍由 `migrateLegacySession` 处理。

## 8. 界面

### 8.1 页签

设置对话框左栏新增「小说管理」，图标用 `IconBibliography`（Library 图标）。
页序：阅读设置 / 小说管理 / 外观设置 / 快捷键设置 / 分章设置。

按现有约定，加一页＝`PAGES` 加一行 **加** 一个 `role="tabpanel"` 面板块，两者 id 手写对齐。

### 8.2 内容

新建 `src/renderer/src/components/LibraryPanel.tsx`，`SettingsDialog.tsx` 只负责挂载。

- 顶部：「导入小说」按钮，与阅读设置页那个走同一个动作。
- 列表行：书名、进度百分比、「2.3 MB · 导入于 2026-10-18」、行尾「打开」/「删除」。
- 当前正在读的那本高亮，标「正在阅读」，「打开」置灰。
- 坏条目：书名 + 标红的「文件丢失」，只能删除。
- 空书库：「书库里还没有小说」+ 导入按钮。
- 读取失败（目录不存在等）：按空态显示，不弹错。

### 8.3 打开

点「打开」→ `api.openNovelPath(entry.sourcePath)` → 走现有 `openNovel`（先落盘上一本、
恢复这本进度、更新 `lastSourcePath`）→ 关闭设置对话框。失败时 toast，对话框不关。

### 8.4 删除

行内二次确认：点「删除」后该行变成「确认删除 / 取消」，并说明
「将同时删除拷贝文件与阅读进度，不可恢复」。确认后按第 6 节执行，完成后重拉列表。

### 8.5 数据刷新

`LibraryPanel` 自己负责拉数据与重拉。注意它与其它页一样**始终挂载**、只是带 `hidden`，
所以不能用「挂载」当触发点：

- 面板收到 `active`（当前页是不是小说管理），`active` 由 false 变 true 时拉一次；
  设置对话框每次打开都会把页拉回阅读设置，因此每次切到小说管理都是一次新的 false → true；
- 导入完成、删除完成后各重拉一次。

为此 `ToolbarContext` 的 `onImport` 返回 `Promise<void>`，面板可以等导入结束再刷新。
从 App 经 Ribbon 传一条 `onOpenNovel(sourcePath): Promise<void>`，与
`onApplyChapterRule` 走同一条 prop 链。

## 9. IPC、类型与文件分工

### 9.1 通道

`src/main/channels.ts` 新增：

```ts
listNovels: 'wt:list-novels',
deleteNovel: 'wt:delete-novel'
```

`CH.clearSession` 删除。

### 9.2 接口

`src/core/api.ts`：

```ts
importNovel: () => Promise<IpcResult<ImportNovelResult>>
openNovelPath: (path: string) => Promise<IpcResult<Novel>>
listNovels: () => Promise<LibraryEntry[]>
deleteNovel: (id: string) => Promise<IpcResult<void>>
```

`loadSession` / `saveSession` / `loadSettings` / `saveSettings` / 主题相关不变。
`clearSession` 删除。

### 9.3 文件

- `src/main/libraryStore.ts`（新）：书库目录、`libraryMetaProblem`、导入计划与拷贝、
  meta 读写、列表遍历、删除。接收 `baseDir`，可用临时目录单测。
- `src/main/sessionStore.ts`：加 `deleteSession(sourcePath)`、
  `copySession(fromSourcePath, toSourcePath)`（写新 + 读回确认，不删旧）、
  `deleteCacheFor(sourcePath)`；移除 `clearReadingHistory`。
- `src/main/ipc.ts`：`importNovel` 改为返回 `ImportNovelResult`；`openNovelPath`
  增加「库外先入库」；新增 `listNovels` / `deleteNovel` handler；删除 `clearSession`。
- `src/core/types.ts`：`LibraryMeta`、`LibraryEntry`、`ImportNovelResult`。
- `src/preload/index.ts`：两个新方法，删除 `clearSession`。
- `src/renderer/src/components/LibraryPanel.tsx`（新）：面板。
- `src/renderer/src/components/SettingsDialog.tsx`：加一页与挂载。
- `src/renderer/src/App.tsx`：导入结果三态处理、从书库打开的入口、清除语义、
  删除当前书时的状态清空顺序。
- `src/renderer/src/state/ToolbarContext.tsx`：`onImport` 返回 Promise。

## 10. 错误处理与边界

- 拷贝失败（磁盘满 / 权限 / 源文件读不了）：临时目录整棵删掉，返回失败，不建条目。
- 源文件 0 字节：拒绝导入。
- meta 不合法或拷贝件丢失：坏条目，只能删；删掉后可重新导入。
- 删除顺序：拷贝目录失败 → 整体报错、会话不动；目录成功、会话失败 → 孤儿记录 + 报错。
- `deleteNovel` 的 `id` 与 meta 的 `fileName` 都做路径穿越校验。
- 符号链接、大小写不同的同一文件会被当成两本书：判据是路径字符串，不是 inode。
  这是刻意的取舍（`resolve` 不做 `realpath`，避免不同卷上行为不一），写进已知限制。
- 同一路径重复导入不做内容比对：拷贝件在就直接打开。原文件后来变了也不会自动更新。
- 单槽缓存仍然只缓存最后打开的一本；在书库间来回切会触发重新解码，与现在换书行为一致。
- 坏条目导致 `listNovels` 单条失败时，逐条降级，不让整个列表失败。

## 11. 测试

- 新增 `tests/unit/libraryStore.test.ts`（临时目录）：
  - 首次导入生成拷贝与 meta；
  - 同路径重复导入不产生第二个目录，状态 `already-imported`；
  - 不同路径同内容产生两条；
  - 拷贝件丢失后同路径导入会修复；
  - meta 不合法时重建目录；
  - 列表的进度、`lastReadAt`、broken 判定；
  - 删除带走整个书目录；
  - 非法 id（`../x`、非 hex、大写）被拒；
  - `libraryMetaProblem` 返回字段名。
- `tests/unit/sessionStore.test.ts`：
  - `deleteSession` 只删指定书；
  - `copySession` 先写新、读回确认，不删旧；
  - `deleteCacheFor` 只在缓存属于这本书时删；
  - 移除 `clearReadingHistory` 的用例。
- IPC handler 本身沿用仓库现状不做单测；删除的编排（先目录、后会话、最后缓存）写在
  `ipc.ts` 里，由上面两个 store 层的用例分别守住每一步。
- `tests/unit/ipcContract.test.ts`：通道清单加两条、删一条。
- `tests/unit/libraryPanel.test.tsx`（新，jsdom）：列表渲染、当前书高亮、空态、
  坏条目禁用打开、删除二次确认、打开调用 `openNovelPath`。
- `tests/unit/app.test.tsx`：导入三态提示、从书库打开、清除只重置当前书并立即写回、
  没开书时只提示；删除当前书时先清状态再调删除。
- `tests/e2e/app.spec.ts`：`window.api` 形状断言同步。

门禁：`pnpm typecheck`、`pnpm test`（看 exit code，不看摘要行）、`pnpm build`。
不做探针脚本与变异矩阵；真机验收由用户执行。

## 12. 文档

- 本文件。
- `CLAUDE.md`：持久化表加 `library/<id>/meta.json`；「清除阅读记录」的语义改为只清当前书；
  `lastSourcePath` 指向拷贝路径；架构一节补 `libraryStore.ts` 的职责。
- README 若有用户可见的功能列表，中英两份一起改。

## 13. 明确不做

- 不做书库全局索引文件。
- 不做同一路径的内容变更检测与「更新这本书」。
- 不做自动清理 `.tmp-*` 残留目录。
- 不做书签、标签、搜索、排序切换。
- 不改原文件；导入只读。
- 不迁移「上次打开的那本」以外的旧书。
- 不做「清空整个书库」的批量操作。
