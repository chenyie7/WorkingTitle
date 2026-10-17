# WorkingTitle 代码设计评审

- **日期**：2026-10-17
- **分支**：`feat/reading-font`
- **范围**：`src/main`、`src/preload`、`src/core`、`src/renderer`、构建与测试配置、文档体系。
- **方法**：只读静态评审。6 个并行任务分段检查，主评审复核关键结论。未修改源码。未运行 `build` / `test`。
- **写法**：按 ASD-STE100 的规则。句子短。一句话说一件事。先事实，后影响，再建议。术语只用一个写法。

## 结论

- **核心层可靠。** `TypingEngine` 的不变量清楚。[guardA.test.ts](../../tests/unit/guardA.test.ts#L60) 与 [guardB.test.ts](../../tests/unit/guardB.test.ts#L59) 正确保护原子写。安全基线正确。
- **外围有 4 个用户可见缺陷。** 必须修。
- **架构有 12 个结构问题。** 多数源于同一件事：**同一事实有多份副本**。
- **强约束大多靠文档。** CI 不在 PR 上运行。计划文档是源码的第二份副本。

| 等级 | 定义 | 数量 |
|---|---|---|
| 1 | 用户可见的错误，或数据丢失 | 4 |
| 2 | 结构性风险，或可维护性问题 | 12 |
| 3 | 局部改进 | 12 |

---

## 等级 1：必须修

### D1 一次保存多条快捷键时，只有最后一条生效

**位置**：[SettingsDialog.tsx:345](../../src/renderer/src/components/SettingsDialog.tsx#L345)、[deferredSettings.ts:76](../../src/renderer/src/state/deferredSettings.ts#L76)、[App.tsx:936](../../src/renderer/src/App.tsx#L936)。

**事实**：每条快捷键的 `commit` 都执行 `const next = { ...shortcuts }`。`save()` 在同一个事件里依次调用这些 `commit`。React 在事件结束后才更新 `shortcuts` prop。所以后一次提交覆盖前一次。

**复现**：把两条快捷键改成新值。点一次「保存」。只有第二条生效。第一条回到旧值。保存按钮继续亮。

**影响**：用户的设置静默丢失。这是「字段级 commit」与「表级共享状态」不匹配。

**建议**：让 `onShortcutsChange` 接收函数式更新。`App` 的 `setShortcuts` 原生支持这种写法。补一条用例：改两条，保存一次，断言两条都生效。

### D2 markdown 铺满的高度基线错了两处

**位置**：[App.tsx:321](../../src/renderer/src/App.tsx#L321)（`pageTextHeight`）、[App.tsx:351](../../src/renderer/src/App.tsx#L351)（`applyFill`）、[markdown.css:284](../../src/renderer/src/styles/markdown.css#L284)、[page.css:30](../../src/renderer/src/styles/page.css#L30)。

**事实一**：隐藏的测量副本 `.wt-md-measure` 是 `position: absolute; width: 100%`。它最近的定位祖先是 `.wt-page`，不是 `.wt-page__text`。所以它按 794px 排版。可见正文只有 626px。副本的折行更少。量出的块高系统性偏小。

**事实二**：第二次进入老板模式时，`heightsRef` 已有缓存。`applyFill` 在 `setBossMode` 之前同步执行。此时 `.wt-page` 还在显示小说。纸会随内容长高（`min-height: 1080px`，不是固定高度）。所以目标高度取到的是小说页高，常达数千像素。

**影响**：铺满超过一页。第二次进入时整篇工作文档一次铺出。`⌘⇧↑/↓` 旋钮失效。这正是 boss-key spec 第 5 节要避免的症状。

**建议**：量一个与内容无关的固定纸高。只在页面确实显示工作文档时量。把目标高度作为显式参数传入。`heightsRef` 加窗口宽度版本号。**像素后果需真机确认。代码路径确定。**

### D3 长 markdown 文档折叠后，页面可能变成空白

**位置**：[Page.tsx:64](../../src/renderer/src/components/Page.tsx#L64)、[fill.ts:58](../../src/renderer/src/markdown/fill.ts#L58)、[MarkdownView.tsx:46](../../src/renderer/src/markdown/MarkdownView.tsx#L46)。

**事实**：`pickFoldStart(spans, limit)` 收到的是**整篇**的块跨度。它从文档末尾往前累加。函数没有 `cursor` 上界。`foldStart` 因此可能大于 `cursor`。

**影响**：md 文档已揭示超过 30000 字且光标在中段时，`foldStart > cursor`。`clipTree` 丢掉几乎全部块。页面只剩折叠条。折叠条上的字数也是错的。用 md 当小说读也会触发。

**建议**：`pickFoldStart` 增加 `cursor` 参数。返回前取 `Math.min(start, cursor)`。`MarkdownView` 增加防御。补一条「光标在中段 + 长尾」用例。

### D4 阅读进度百分比在跳章后错误

**位置**：[App.tsx:830](../../src/renderer/src/App.tsx#L830)、[StatusBar.tsx:50](../../src/renderer/src/components/StatusBar.tsx#L50)、[engine.ts:263](../../src/core/engine.ts#L263)。

**事实**：`revealedChars = cursor - revealStart`。进度 = `revealedChars / flatText.length`。`jumpToChapter` 会把 `revealStart` 抬到章首。于是进度变成「章内偏移 ÷ 全书长度」。

**影响**：跳到第 1200 章、该章无进度时，状态栏同时显示 `1201 / 1382` 和 `0%`。两格互相矛盾。这个状态还会写进会话，重启后继续错。

**建议**：进度改用 `cursor / flatText.length`。现字段改名 `windowChars`，只留给折叠逻辑。

---

## 等级 2：应修

### D5 App.tsx 是 god component，设置状态没有单一来源

**位置**：[App.tsx](../../src/renderer/src/App.tsx#L47)。

**事实**：998 行。22 个 `useState`、10 个 `useRef`、7 个 `useEffect`、12 个 `useCallback`、4 个 `useMemo`。9 个设置字段写在四处：state（77–148）、boot（635–648）、`settings` memo（228–251）、依赖数组（240–250）。另有 5 个 ref 镜像同一批值。

**影响**：加一个设置项要改 6 处以上。漏一处不报错，只静默失效。D1 就是这种结构的产物。注释自己记录了两种漏法。

**建议**：先搬设置。用一个对象 + `patch` 的 store 管全部设置。再按六类职责拆 hook：boot、会话、老板模式、铺满测量、光标跟随、快捷键接线。

### D6 `window.api` 契约有三份手写副本，五处各自读取

**位置**：[preload/index.ts:55](../../src/preload/index.ts#L55)、[global.d.ts:16](../../src/renderer/src/types/global.d.ts#L16)、[tests/setup.ts:44](../../tests/setup.ts#L44)。

**事实**：preload 导出的 `WtApi = typeof api` 零引用。渲染层手写同一接口。测试再有同等副本。五个模块各自写 `window as unknown as { api? ... }`：[App.tsx:44](../../src/renderer/src/App.tsx#L44)、[theme.ts:11](../../src/renderer/src/state/theme.ts#L11)、[shortcuts.ts:51](../../src/renderer/src/state/shortcuts.ts#L51)、[Ribbon.tsx:1225](../../src/renderer/src/components/Ribbon.tsx#L1225)、[MarkdownImage.tsx:34](../../src/renderer/src/markdown/MarkdownImage.tsx#L34)。

**影响**：给 preload 加方法或改签名，`pnpm typecheck` 仍通过。缺口只会在真机上出现。这是全仓唯一没有编译期闸的进程边界。

**建议**：把接口提到 `src/core/api.ts`，只放类型。preload 写 `const api: WtApi = { ... }`，对象字面量赋值会同时抓多写和少写。渲染层只用一个 `getApi()` 出口。e2e 补一条 `Object.keys(window.api)` 的断言。

### D7 写盘路径不校验，写失败对用户不可见

**位置**：[sessionStore.ts:383](../../src/main/sessionStore.ts#L383)、[sessionStore.ts:401](../../src/main/sessionStore.ts#L401)、[ipc.ts:130](../../src/main/ipc.ts#L130)、[App.tsx:799](../../src/renderer/src/App.tsx#L799)。

**事实**：读路径逐字段校验。写路径几乎不校验。`writeSettings` 直接写。`writeSession` 只查 `sourcePath`。IPC 参数只是类型断言。渲染层用 `void` 丢弃 Promise。失败只写一行 `console.warn`。

**影响**：坏载荷先落盘，下次读取才判废。例如 `cursor: NaN` 序列化成 `null`，整份会话作废。磁盘满或目录只读时，用户以为已保存。进度静默丢失。

**建议**：写前跑同一套校验。写通道返回 `{ ok }`。失败时用 toast 告知用户。

### D8 IPC 失败语汇不统一

**位置**：[ipc.ts:96](../../src/main/ipc.ts#L96)、[ipc.ts:122](../../src/main/ipc.ts#L122)、[ipc.ts:130](../../src/main/ipc.ts#L130)。

**事实**：`null` 同时表示取消、空文件、读不出来、没配图。「导入小说」失败走 rejection。「保存」返回 `void`。

**影响**：渲染层无法区分「用户取消」与「出错」。无法给出正确提示。

**建议**：统一结果类型 `{ ok: true, value } | { ok: false, reason }`。至少让写通道返回结果。

### D9 强制边界只靠文档

**位置**：[tsconfig.json:16](../../tsconfig.json#L16)、[decode.ts:1](../../src/core/decode.ts#L1)、[toReact.tsx:93](../../src/renderer/src/markdown/toReact.tsx#L93)、[measure.ts:18](../../src/renderer/src/markdown/measure.ts#L18)。

**事实**：渲染层 tsconfig 带 `types: ["node"]`，并 include `src/core`。所以渲染层 import `node:fs` 或 `core/decode` 都能通过类型检查。core 的纯净性只挡住 DOM 一半。`BLOCK_END_ATTR` 号称「渲染与测量共用」，但渲染侧硬编码 `data-block-end`。

**影响**：越界只会在 Vite 构建或运行时失败。改常量名不会报错，只会静默退回按字符数铺。

**建议**：渲染层去掉 node 类型，测试单独一份 tsconfig。或加 `check-imports` 脚本进 CI。`toReact.tsx` 直接 import 那个常量。

### D10 计划文档是源码的逐字节副本，没有自动校验

**位置**：[2026-10-06 计划](../superpowers/plans/2026-10-06-word-disguised-typing-reader.md#L66)、[CLAUDE.md:295](../../CLAUDE.md#L295)。

**事实**：8 份计划，504 个围栏，正本 17,859 行，文档总量 38,443 行。校验脚本只写在 CLAUDE.md 里，没有进 `scripts/`，也没进 CI。计划里的 `package.json` 已漂移：仍是 `0.1.0`，没有 `postinstall`，`dist:*` 没有 `--publish never`。CLAUDE.md 仍写「三份计划」「56 个源/测试文件」，实际是 8 份、41 + 32 个文件。

**影响**：按计划执行会重新引入两个已记录的事故。每改一行源码都要同步近两万行文档。评审时这份 diff 不可读。

**建议**：把校验脚本落到 `scripts/check-plan-fences.mjs`，在 PR 上运行。或让围栏由源码生成。至少把根配置纳入范围，并更新 CLAUDE.md 的计数。

### D11 CI 不在 PR 上运行，e2e 与打包不在 CI

**位置**：[.github/workflows/build.yml:3](../../.github/workflows/build.yml#L3)。

**事实**：工作流只在推 `v*` 标签或手动触发时运行。`typecheck` 与 `test` 在发版作业里。PR 和 main 的普通提交不触发。e2e 不在 CI。`dist:*` 只构建，不启动产物。`upload-artifact` 没有设 `if-no-files-found: error`。

**影响**：坏代码可以进 main，直到发版才暴露。绿色构建可能产出空 Release。打包层（asar、依赖收集、路径）没有任何自动化验证。

**建议**：加一个轻量 `check` 作业，跑 `pull_request` 与 `main`：install → typecheck → test → build。发版作业保持现状。再补一个打包冒烟。

### D12 markdown 管线用隐藏字符串字段传元数据

**位置**：[parse.ts:42](../../src/renderer/src/markdown/parse.ts#L42)、[clip.ts:75](../../src/renderer/src/markdown/clip.ts#L75)、[toReact.tsx:88](../../src/renderer/src/markdown/toReact.tsx#L88)。

**事实**：五处隐藏元数据：`wtValueStart`、`wtLineStarts`、`wtBlankLines`、`wtBlankRows`、`data-block-end`。全部用字符串键挂在第三方 AST 节点上。四处 `as unknown as`。三段「沿 value 的行循环」各写一份，换行归属三种口径。量高度时复用交互渲染器，整篇图片都会挂载并发 IPC。

**影响**：阶段之间的契约靠注释。注释自己列举了多次静默偏移 bug。未揭示的图片会被提前请求，违反设计 8.2。

**建议**：建一个类型化的节点元数据模块。量高度用一条 layout-only 渲染路径，不挂图片、不算光标。把偏移换算从 929 行的视图文件抽出去。

### D13 没有单实例锁，临时文件名固定

**位置**：[main/index.ts:148](../../src/main/index.ts#L148)、[sessionStore.ts:270](../../src/main/sessionStore.ts#L270)。

**事实**：全仓没有 `requestSingleInstanceLock`。两处原子写都用固定的 `${path}.tmp`。

**影响**：Windows 上双击两次会起两个进程。两个进程写同一本书的会话，互相覆盖。同名临时文件还会竞争。

**建议**：`whenReady` 前加单实例锁，并处理 `second-instance`。或不加锁，但改成进程唯一临时名。

### D14 依赖分类错误，安装包 183MB

**位置**：[package.json:23](../../package.json#L23)。

**事实**：`dependencies` 同时放了 main 运行期依赖与渲染层依赖。`react`、`react-dom`、`remark-*`、`unified`、`@fluentui/react-icons` 都只被渲染层使用。electron-builder 把 `dependencies` 全部打进 asar。实测 `app.asar` 183MB，`node_modules` 172.8MB，`@fluentui` 155.9MB，dmg 170MB。

**影响**：安装包白白变大。运行期依赖边界变模糊。

**建议**：只把 `iconv-lite`、`jschardet` 留在 `dependencies`。渲染层依赖移到 `devDependencies`。Vite 仍会打包它们。

### D15 快捷键 id 是第二份手工清单

**位置**：[shortcuts.ts:24](../../src/core/shortcuts.ts#L24)、[shortcuts.ts:272](../../src/core/shortcuts.ts#L272)。

**事实**：`ShortcutId` 是手写联合。`SHORTCUTS` 是另一张表。`resolveShortcuts` 用 `{} as ResolvedShortcuts` 断言完整。

**影响**：加 id 但忘加表行，`tsc` 不报错。该快捷键既不显示也不触发。

**建议**：先定义 `SHORTCUTS`，再由它推导 `ShortcutId` 与 `ResolvedShortcuts`。

### D16 章节识别有未登记的标点闸门

**位置**：[chapters.ts:6](../../src/core/chapters.ts#L6)、设计文档 §7。

**事实**：实现先拒绝含 `。！？；，` 的行。spec §7 的四个标题正则允许副标题带标点。所以「第一章 风起，云涌」不会被识别为标题。没有反向用例。

**影响**：一本书的标题普遍带标点时，整本退化成单章节。章节列表、跳章、按章进度全部失效。

**建议**：把标点闸门只作用于「数字 + 顿号」那条模式。或补 spec 与一条带标点标题的用例。

---

## 等级 3：局部改进

| 问题 | 位置 | 影响 |
|---|---|---|
| 启动时主进程不读 `themeSource` | [main/index.ts:76](../../src/main/index.ts#L76) | 用户选的外观与系统不同时，启动闪一下 |
| 设置模态开着时快捷键仍生效 | [App.tsx:774](../../src/renderer/src/App.tsx#L774) | `⌘⇧B` 会切书，对话框里的比例成旧值 |
| 输入法合成态按 Enter 会触发保存 | [SettingsDialog.tsx:616](../../src/renderer/src/components/SettingsDialog.tsx#L616) | 半成品文档名被提交，共四处 |
| Combo 面板坐标只算一次 | [Toolbar.tsx:85](../../src/renderer/src/components/Toolbar.tsx#L85) | 滚动或改窗口后面板与按钮脱节 |
| `:hover` 盖住 `.wt-btn--active` | [ribbon.css:172](../../src/renderer/src/styles/ribbon.css#L172) | 选中的按钮在鼠标悬停时变浅 |
| 交互色绕过 token | ribbon.css | 深色要逐条镜像，漏一条就两主题不一致 |
| `Novel` 不是只读、未冻结 | [types.ts:14](../../src/core/types.ts#L14) | 外部可改源数据，破坏游标坐标系 |
| 会话有两个只写字段 | [types.ts:29](../../src/core/types.ts#L29) | `novelTitle`、`activeChapter` 只写不读 |
| `types.ts` 反向依赖 `bossKey` | [types.ts:1](../../src/core/types.ts#L1) | 底座为一个渲染层旋钮的默认值依赖功能模块 |
| 图片缓存按原始 url 做键 | [MarkdownImage.tsx:27](../../src/renderer/src/markdown/MarkdownImage.tsx#L27) | 两份文档同相对路径时显示错图 |
| 跨行 `inlineCode` 没有逐行表 | [parse.ts:114](../../src/renderer/src/markdown/parse.ts#L114) | 容器里可能提前显示未揭示字符 |
| 0 高的前导块绕过铺满兜底 | [fill.ts:42](../../src/renderer/src/markdown/fill.ts#L42) | 文档以定义块开头时可能铺出空白 |
| 无 lint / 无 `noUncheckedIndexedAccess` | [tsconfig.json:1](../../tsconfig.json#L1) | 数组下标假设没有编译期保护 |
| 同步文件 IO 在主进程 | [loadNovel.ts:36](../../src/main/loadNovel.ts#L36) | 导入大文件时阻塞其它 IPC |
| 菜单「项目主页」是占位链接 | [menu.ts:112](../../src/main/menu.ts#L112) | 指向 `https://github.com/` |
| `menu.ts` 从 `ipc` 取通道名 | [menu.ts:2](../../src/main/menu.ts#L2) | 绕开 `channels.ts` 的唯一出口 |

---

## 确认不是问题的刻意设计

以下做法有实测依据或 spec 记录。**不要改。**

1. **core 不碰 DOM。** `tsconfig.node.json` 没有 DOM lib。写 `document` / `window` 会编译失败。这一半的门禁有效。
2. **主题必须走 IPC。** 渲染层 `matchMedia` 在本应用恒为 false。这是实测结论。
3. **禁用原生 `<select>`、下拉 panel 到 body、组内两行按列填充。** 三条都是为了焦点安全与伪装。
4. **temp + rename、`textBytes` 提交点、guardA/guardB。** 设计正确，覆盖到位。
5. **快捷键一张表 + macOS 保留清单 + 读盘再校验。** 三层各有职责。问题只在 id 穷尽性（D15）。
6. **不使用 `dangerouslySetInnerHTML`。** 内嵌 HTML 走白名单 tokenizer，注入面已关闭。
7. **无 `React.memo`、每次按键整树重渲染。** 当前规模可接受，spec 有说明。
8. **单槽缓存、cache text 不 temp+rename、非 darwin 不建菜单、jsdom 不测布局。** 都是文档化的取舍，不是缺陷。

## 建议顺序

**第 1 步：修用户可见缺陷（1–2 天）。** D1 → D4。每条配一条回归用例。D2 先补纯函数测试，再用 `_electron` 真机确认。

**第 2 步：补结构（约 1 周）。** D5 先做设置 store。再做 D6 API 契约、D7/D8 结果类型、D9 边界检查、D10 围栏脚本、D11 CI 作业。

**第 3 步：还债（按需）。** D12 markdown 元数据、D13 单实例、D14 依赖分类、D15/D16，以及等级 3 的条目。

**不要做**：不改伪装相关的字符串与配色。不改已实测的主题 IPC 通道。不引入重型依赖来替代现有纯函数。

## 验证方式

```bash
pnpm typecheck          # 两个 tsconfig
pnpm test               # 574 个用例
```

围栏校验（只读，本次已跑）：494 个围栏，0 个文件未覆盖。规则当前成立。缺的是自动化，见 D10。

---

**本次未修改任何源码。** D1、D3、D4 由代码路径直接推出。D2 的像素后果需真机确认。
