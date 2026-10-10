# WorkingTitle

一个**伪装成 Microsoft Word 的桌面打字阅读器**：导入 txt 小说，你在文档区打字时不显示你敲的字符，
而是按顺序把小说后续的正文「吐」出来。默认 1 次击键显示 10 个字，可调。

![截图](docs/screenshot.png)

> **关于「伪装」**：界面刻意模仿 Microsoft Word 的外观，目的是在办公环境里不引人注意。
> **这不是微软的产品，与微软无关，也不应当作微软产品分发。** 应用自身的名称、图标与打包标识
> 都用自己的（WorkingTitle），没有使用任何微软的商标或图标资源——界面用的是
> `@fluentui/react-icons`（MIT 许可的公开图标集）。

## 它解决什么问题

想在工作间隙看小说，但屏幕上明晃晃一个阅读器太扎眼。这个应用长得像 Word：蓝色标题条、
功能区、白色 A4 纸、底部状态栏。你敲键盘，纸上就多出字来——看起来就像在写文档。

## 怎么用

1. **导入小说**：`⌘/Ctrl + ,` 打开设置 → 「导入小说」，或者启动时直接把 txt 路径作为命令行参数
2. **开始打字**：在文档区敲任何键，小说正文就会按比例出现
3. **调整比例**：设置里的「1 键显示 N 字」，范围 1–500（默认 10）
4. **切换输入模式**：
   - **输入法友好**（默认）：用中文输入法打拼音，上屏几个字就抽几个字；拼音过程不抽字
   - **纯按键**：敲一个键抽一次，绕过输入法，适合键盘盲打
5. **章节跳转**：左侧章节栏点任意一章；`⌘/Ctrl + Shift + H` 收起整条左栏
6. **外观**：设置里可选「跟随系统 / 浅色 / 深色」；深色下纸张默认仍是白的（跟真 Word 一样），
   想让纸也变暗可以在设置里勾上

阅读进度会自动保存，关掉再开接着上次的位置。

## 开发

```bash
pnpm install
pnpm dev          # electron-vite dev（渲染层热更新）
```

| 命令 | 作用 |
|---|---|
| `pnpm test` | 单元测试（Vitest） |
| `pnpm vitest run tests/unit/engine.test.ts` | 跑单个测试文件 |
| `pnpm typecheck` | 类型检查（**跑两个 tsconfig**，第二个是 `src/core` 纯净性的门禁） |
| `pnpm build` | 构建到 `out/` |
| `pnpm test:e2e` | 端到端测试（先构建，再用 Playwright 驱动真实 Electron 进程） |

**注意**：`out/` 不在 git 里。手动启动 Electron 之前一定要先 `pnpm build`，
否则跑的是上一次构建的产物——`git status` 完全看不出来。

## 打包

```bash
pnpm dist:dir     # 免安装目录
pnpm dist:mac     # macOS .dmg + .zip（arm64 + x64）
pnpm dist:win     # Windows NSIS .exe + .zip —— 在 macOS 上需要 wine
```

**不想跑安装程序就用 `.zip`**：解开即用，不经安装器、不写注册表、不需要管理员权限。

- **Windows**：解开后是 `WorkingTitle.exe` 与它的依赖文件，双击即运行
- **macOS**：解开后是 `WorkingTitle.app`，拖到「应用程序」或就地双击

两个注意点：

- macOS 的 `.app` 里有符号链接，**必须用访达自带的「归档实用工具」解压**（或 `ditto -x -k`）。
  某些第三方解压工具不保留符号链接与权限位，解出来的 `.app` 会启动不了。Windows 上用资源管理器
  自带的解压即可。
- zip 版同样**没有签名**，所以首次打开仍会被 Gatekeeper / SmartScreen 拦（macOS 右键 → 打开，
  Windows 点「更多信息」→「仍要运行」）。

阅读进度按**用户账户**存，不在解压目录旁边（Windows 在 `%APPDATA%\WorkingTitle`，
macOS 在 `~/Library/Application Support/WorkingTitle`）。所以删掉解压目录不会丢进度；
反过来说，想做到「整个应用连数据一起塞进 U 盘」，给它设 `WT_USER_DATA` 环境变量指到 U 盘上。

macOS 上打出的 `.dmg` 实测可用（起打包后的 `.app`、导入真实小说、打字正常）。

`.github/workflows/build.yml` 会在两个平台上各自原生构建，这是打 Windows 包的可靠路径
（不用 wine）。推 tag（`v*`）或手动触发即可，产物在 Actions 的 Artifacts 里。

**当前没有代码签名与公证**，所以：

- macOS 上别的机器打开 dmg 会被 Gatekeeper 拦（右键 → 打开可绕过）
- Windows 上会触发 SmartScreen 警告

要干净分发需要 Apple Developer 账号与一张 Windows 代码签名证书。自己用的话本机 dmg 直接装即可。

## 架构

Electron 三进程 + 一份被主进程与渲染进程共享的纯逻辑：

```
src/core/     零 DOM / 零 Electron 依赖的纯 TypeScript（解码、章节切分、游标状态机）
src/main/     文件 IO、编码检测、会话与缓存落盘、原生菜单、IPC
src/preload/  唯一的桥（contextIsolation / sandbox 全开）
src/renderer/ React 19 —— 只持有一份只读的小说数据，驱动引擎
```

核心不变量：**阅读区显示的内容恒等于 `flatText.slice(revealStart, cursor)`**。
导入的文本运行期只读、永不修改，用户感知到的一切「变化」都只是游标整数在动。

更细的约定（`src/core` 的纯净性是怎么被构建配置强制的、输入捕获那三条坑、
计划与代码的逐字节同步约定）写在 [CLAUDE.md](CLAUDE.md) 里。

## 已知限制

- **输入法相关行为只在真机上验证过一部分**：合成期间不能清空 textarea、候选框要跟着光标走
  这两条已修，但候选框的实际位置只能靠人眼看（它由系统绘制、不在页面里，自动化测不到）
- 应用内除了文档区，其它都是**外观占位**：加粗/导出 docx/查找替换等按钮点了只弹提示
- 设置项（文档名、比例、外观、纸张）**不跨重启保存**
- `pnpm dev` 下没有做深色模式的完整验证

## 技术栈

Electron 44 · electron-vite 5 · Vite 7 · React 19 · TypeScript 5.9 · Vitest 5 ·
Playwright 1.63 · electron-builder 26 · jschardet 4 · iconv-lite 0.7 · @fluentui/react-icons 2
