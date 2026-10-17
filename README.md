**English** | [简体中文](README.zh-CN.md)

# WorkingTitle

**Read a novel at your desk, inside a window that looks like Microsoft Word.**

Import a `.txt` novel and then type as if you were writing a document. The characters you press are
never shown — instead, the novel's text appears on the page, one keystroke at a time. What's on
screen is a Word window: blue title bar, a seven-tab ribbon, a white page, a status bar.

![Screenshot](docs/screenshot.png)

> **About the disguise**
>
> The interface deliberately imitates the look of Microsoft Word, so that reading doesn't stand out
> in an office. **This is not a Microsoft product, is not affiliated with Microsoft, and should not
> be distributed as one.** The app's own name, icon and packaging identifiers are WorkingTitle; no
> Microsoft trademarks or icon assets are used — the interface is built on
> [`@fluentui/react-icons`](https://github.com/microsoft/fluentui-system-icons), a public icon set
> released under MIT.

## Install

Download from [Releases](https://github.com/chenyie7/WorkingTitle/releases):

| Platform | Download |
|---|---|
| Windows | `WorkingTitle-v<version>-win-x64.exe` (installer) or `WorkingTitle-v<version>-win-x64.zip` (portable) |
| macOS | `WorkingTitle-v<version>-mac-arm64.dmg` (Apple silicon) or `WorkingTitle-v<version>-mac-x64.dmg` (Intel) |

The **Windows zip is portable** — no installer, no registry entries, no administrator rights.

On macOS the `.dmg` is all you need: mount it and drag `WorkingTitle.app` into Applications. **A dmg
installs nothing by itself**, so it already covers the "I'd rather not run an installer" case.

### The first launch is blocked by the OS

This app is **not code-signed** (certificates cost money), so:

- **Windows**: SmartScreen warning → "More info" → "Run anyway"
- **macOS**: Gatekeeper blocks it → right-click the icon and choose "Open", or run
  `xattr -dr com.apple.quarantine /Applications/WorkingTitle.app`

## Usage

1. **Import a novel** — press `⌘/Ctrl + ,` to open Settings → "Import novel". The file is copied
   into the app's data directory, so deleting the original does not affect reading. The
   "Novel Library" page in Settings lets you browse, switch, and delete books. You can also pass the path to a
   `.txt` file as a command-line argument at launch.
2. **Type** — any keypress in the document area reveals the next chunk of text. The default is
   10 characters per keystroke, configurable from 1 to 500.
3. **Jump chapters** — click any chapter in the left sidebar. `⌘/Ctrl + Shift + H` collapses the
   whole sidebar. Both shortcuts are rebindable — see [Shortcuts](#shortcuts).
4. **Adjust the look** — Settings offers Follow system / Light / Dark. In dark mode the page stays
   white by default (just like real Word); enable "dark paper" if you'd rather it didn't.
5. **Fix chapter splitting** — if a novel's chapters are detected wrong, open Settings →
   **Chapter splitting**, pick a built-in rule or write your own regular expression, and press
   **Apply**. The rule is remembered per book, and your reading position and the text itself do
   not change.

Settings persist across restarts, and **reading progress is kept per book** — importing a second
novel doesn't lose your place in the first.

Each book can be deleted on its own; deleting removes both the copied file and that book's progress.
"Clear reading history" only resets the currently open book; the book stays in the library.

### Two input modes

| Mode | Behaviour | Best for |
|---|---|---|
| **IME-friendly** (default) | Type pinyin with a Chinese IME; text is revealed as characters are committed. Nothing is revealed while a composition is in progress. | Everyday use |
| **Raw keystrokes** | One keystroke, one reveal. Bypasses the IME entirely. | Touch typing |

### Shortcuts

Three shortcuts are rebindable, and each has its own default per platform:

| Action | macOS | Windows / Linux |
|---|---|---|
| Import a novel | `⌘O` | `Ctrl+O` |
| Show/hide the chapter sidebar | `⇧⌘H` | `Ctrl+Shift+H` |
| Open Settings | `⌘,` | `Ctrl+,` |

Open Settings → **Shortcuts**, click a field and press the combination you want. `Esc` cancels the
recording without changing anything; `↺` restores that platform's default. The new binding takes
effect when you press **Save**, and on macOS the matching menu-bar item updates to show it.

Bindings must include at least one modifier — a bare key would be swallowed instead of reaching the
page. On macOS a short list of combinations is refused because the system or the app's own menus
already own them (`⌘Q`, `⌘W`, `⌘C`…).

## Build from source

Requires Node ≥ 22.12 and pnpm 11.

```bash
pnpm install
pnpm dev
```

| Command | What it does |
|---|---|
| `pnpm dev` | Development mode (renderer hot-reload) |
| `pnpm build` | Build to `out/` |
| `pnpm typecheck` | Type check (runs two tsconfigs) |
| `pnpm test` | Unit tests |
| `pnpm test:e2e` | End-to-end tests (launches a real Electron process) |
| `pnpm dist:mac` | Package two `.dmg` files (arm64 + x64) |
| `pnpm dist:win` | Package an `.exe` installer and a portable `.zip` |

`out/` is not tracked by git: **run `pnpm build` before launching Electron by hand**, otherwise
you're running the previous build and `git status` will not tell you.

For Windows packages, prefer CI (`.github/workflows/build.yml`) — building a Windows package on
macOS requires wine. Push a `v*` tag and CI builds natively on both platforms and attaches the
installers to the matching GitHub Release; a manually triggered run only builds, leaving the
artifacts under Actions.

## Known limitations

- **Everything outside the document area is cosmetic.** The ribbon's seven tabs hold around 150
  buttons; clicking one just shows a "not implemented" toast. The only real functionality lives in
  the Settings dialog.
- **IME behaviour can only be verified on real hardware.** The candidate window is drawn by the
  system rather than by the page, so automation cannot observe its position.
- **While you are recording a shortcut, macOS menu accelerators still fire.** The recording box
  mutes the app's own shortcut handler, but not the native menu bar — pressing `⌘O` mid-recording
  opens the file picker. Cancel it and record again.
- **Document name and the two reading ratios only take effect when you press Save**, not as you
  type them. Appearance, paper and input mode apply immediately.

## Tech stack

Electron 44 · electron-vite 5 · Vite 7 · React 19 · TypeScript 5.9 · Vitest 5 ·
Playwright 1.63 · electron-builder 26 · jschardet 4 · iconv-lite 0.7 · @fluentui/react-icons 2

Architecture notes and conventions — how `src/core` purity is enforced by the build config, the
input-capture pitfalls, and the byte-exact plan/source lockstep — live in [CLAUDE.md](CLAUDE.md)
*(written in Chinese)*.

## License

[MIT](LICENSE)
