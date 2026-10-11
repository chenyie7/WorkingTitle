# WorkingTitle

**把阅读藏进一个长得像 Microsoft Word 的窗口里。**

导入一篇 txt 小说，然后像写文档一样打字——你敲的字符不会显示，取而代之的是小说正文按顺序落到
纸上。屏幕上看起来就是一个 Word 窗口：蓝色标题条、功能区七个选项卡、白色 A4 纸、底部状态栏。

![截图](docs/screenshot.png)

> **关于「伪装」**
>
> 界面刻意模仿 Microsoft Word 的外观，目的是在办公环境里不引人注意。
> **这不是微软的产品，与微软无关，也不应当作微软产品分发。** 应用自己的名称、图标与打包标识
> 都是 WorkingTitle，没有使用任何微软的商标或图标资源——界面用的是
> [`@fluentui/react-icons`](https://github.com/microsoft/fluentui-system-icons)（MIT 许可的公开图标集）。

## 安装

从 [Releases](https://github.com/chenyie7/WorkingTitle/releases) 下载：

| 平台 | 安装器 | 免安装 |
|---|---|---|
| Windows | `WorkingTitle-*-win-x64.exe` | `WorkingTitle-*-win-x64.zip` |
| macOS | `WorkingTitle-*-arm64.dmg`、`-x64.dmg` | `WorkingTitle-*-mac.zip` |

**zip 版解压即用**——不跑安装器、不写注册表、不需要管理员权限。

### 首次打开会被系统拦一下

本应用**没有代码签名**（证书要花钱），所以：

- **Windows**：SmartScreen 警告 →「更多信息」→「仍要运行」
- **macOS**：Gatekeeper 拦下 → 右键点图标选「打开」；或
  `xattr -dr com.apple.quarantine /Applications/WorkingTitle.app`

macOS 的 `.app` 里有符号链接，**zip 版请用访达自带的「归档实用工具」解压**。某些第三方解压工具
不保留符号链接与权限位，解出来的 `.app` 启动不了。

## 使用

1. **导入小说** —— `⌘/Ctrl + ,` 打开设置 →「导入小说」。也可以在启动时直接把 txt 路径当命令行参数。
2. **打字** —— 在文档区敲任何键，正文按比例出现。默认 1 次击键 10 个字，范围 1–500。
3. **跳章** —— 左侧点任意一章；`⌘/Ctrl + Shift + H` 收起整条左栏。
4. **调外观** —— 设置里可选跟随系统 / 浅色 / 深色。深色下纸张默认仍是白的（跟真 Word 一样），
   想让纸也变暗可以勾上。

阅读进度自动保存，关掉再开接着上次的位置。

### 两种输入模式

| 模式 | 行为 | 适合 |
|---|---|---|
| **输入法友好**（默认） | 中文输入法打拼音，上屏几个字就抽几个字；拼音过程不抽字 | 平常用 |
| **纯按键** | 敲一个键抽一次，绕过输入法 | 键盘盲打 |

## 从源码构建

需要 Node ≥ 22.12、pnpm 11。

```bash
pnpm install
pnpm dev
```

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 开发模式（渲染层热更新） |
| `pnpm build` | 构建到 `out/` |
| `pnpm typecheck` | 类型检查（跑两个 tsconfig） |
| `pnpm test` | 单元测试 |
| `pnpm test:e2e` | 端到端测试（起真实 Electron 进程） |
| `pnpm dist:mac` / `pnpm dist:win` | 打包成 `.dmg` / `.exe`，外加免安装 `.zip` |

`out/` 不在 git 里：**手动启动 Electron 之前先 `pnpm build`**，否则跑的是上一次的产物，
而 `git status` 完全看不出来。

打 Windows 包建议走 CI（`.github/workflows/build.yml`）：推一个 `v*` tag 或手动触发，
两个平台各自原生构建，产物在 Actions 的 Artifacts 里——在 macOS 上打 Windows 包需要 wine。

## 已知限制

- **应用内除了文档区，其余都是外观占位**。功能区那七个选项卡里约 150 个按钮，点了只弹一句
  「演示占位功能，未实现」；真正有功能的只有设置对话框里那几项。
- **输入法行为只有真机说了算**。候选框由系统绘制、不在页面里，自动化测不到它的位置。
- **设置项不跨重启保存**（文档名、比例、外观、纸张）。只有阅读进度会保存。

## 技术栈

Electron 44 · electron-vite 5 · Vite 7 · React 19 · TypeScript 5.9 · Vitest 5 ·
Playwright 1.63 · electron-builder 26 · jschardet 4 · iconv-lite 0.7 · @fluentui/react-icons 2

更细的架构与约定——`src/core` 的纯净性是怎么被构建配置强制的、输入捕获那几个坑、
实现计划与源码的逐字节同步口径——见 [CLAUDE.md](CLAUDE.md)。

## 许可

[MIT](LICENSE)
