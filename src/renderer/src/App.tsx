import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TypingEngine } from '../../core/engine'
import type { InputMode, Novel } from '../../core/types'
import { ChapterList } from './components/ChapterList'
import { Page } from './components/Page'
import { Ribbon } from './components/Ribbon'
import { StatusBar } from './components/StatusBar'
import { Toast } from './components/Toast'
import { InputCapture } from './input/InputCapture'
import { useDarkPaper, useSystemTheme, useThemePreference } from './state/theme'
import { ToolbarProvider } from './state/ToolbarContext'
import { useTypingEngine } from './state/useTypingEngine'
import type { ThemeSource, WtApi } from './types/global'

const SAVE_DEBOUNCE_MS = 600
/** 光标与画布上下沿之间保留的空隙：.wt-canvas 上下各有 padding，贴着边等于贴到灰底上 */
const CARET_MARGIN = 24

/**
 * 取 preload 注入的接口；**它可能不存在**。
 *
 * sandboxed preload 加载失败时（Task 6 实测的形态：`Error: module not found: node:fs`），
 * 页面照常渲染而 `window.api === undefined`——用户看到的就是一个「伪装成 Word 的空窗口」。
 * `global.d.ts` 把它声明成必填（`api: WtApi`），所以 `tsc` 认为它恒存在、**不会提醒你判空**，
 * 这里必须自己转一道。
 *
 * 每次用的时候现取，【不要在模块顶层缓存成常量】：那等于把「preload 一定在模块加载前注入」
 * 写死进加载顺序，一旦不成立，拿到的就是永久为 null 的缓存。
 */
function getApi(): WtApi | null {
  return (window as unknown as { api?: WtApi }).api ?? null
}

export default function App() {
  const [novel, setNovel] = useState<Novel | null>(null)
  const [engine, setEngine] = useState<TypingEngine | null>(null)
  const [expanded, setExpanded] = useState(false)
  /**
   * 蓝条上的文档名。**刻意与 `novel.title` 无关**——那个是文件名（`诡秘之主（整理版）`），
   * 显示出来等于把「在看小说」写在了窗口最显眼的位置。这里永远是用户自己定的名字，
   * 默认取一个中性的 `文档1`。
   */
  const [docTitle, setDocTitle] = useState('文档1')
  /** 「深色模式下纸张也变暗」。默认关——真 Word 的深色模式里纸张仍是白的。 */
  const [darkPaper, setDarkPaper] = useState(false)
  /** 外观偏好，默认跟随系统。它决定原生部分（红绿灯）与网页部分一起怎么显示。 */
  const [themeSource, setThemeSource] = useState<ThemeSource>('system')

  useSystemTheme()
  useDarkPaper(darkPaper)
  useThemePreference(themeSource)
  const [now, setNow] = useState(() => Date.now())
  const engineRef = useRef<TypingEngine | null>(null)
  const canvasRef = useRef<HTMLElement | null>(null)
  engineRef.current = engine

  const state = useTypingEngine(engine)

  const openNovel = useCallback((next: Novel) => {
    const fresh = new TypingEngine(next)
    setNovel(next)
    setEngine(fresh)
    setExpanded(false)
  }, [])

  const handleImport = useCallback(async () => {
    const api = getApi()
    if (!api) return
    const next = await api.importNovel()
    if (!next) return
    openNovel(next)
  }, [openNovel])

  const handleClearSession = useCallback(async () => {
    const api = getApi()
    if (!api) return
    await api.clearSession()
    setNovel(null)
    setEngine(null)
  }, [])

  // 启动：先看命令行有没有指定 txt，再尝试恢复上次会话
  useEffect(() => {
    const api = getApi()
    // 没有 api，就没有「命令行参数」和「上次会话」这两件事可做——直接停在空状态。
    // 这【不是】多余的防御：少了它，下面第一个 await 会变成 unhandled rejection，
    // 用例行照旧报 passed、汇总行却是 `Errors 1 error`，vitest 的 exit code 是 1。
    if (!api) return

    let cancelled = false

    const boot = async (): Promise<void> => {
      const initialPath = await api.initialNovelPath()
      const session = await api.loadSession()

      if (initialPath) {
        // 命令行给的文件可能打不开（已删除、权限、EISDIR、解不出编码……）。
        // 没有这个 try 的话错误会以【未处理的 rejection】形式冒到启动期：空状态不显示、
        // 也没有任何提示。catch 里刻意【不 return】：失败就不阻断启动，继续走下面的
        // 会话恢复 / 空状态兜底——用户至少还能看到界面并重新导入。
        // 两条都真机实测过（Task 12，chmod 000 的 txt 当命令行参数 + 同一个 userData 里
        // 留着上次会话）：无 unhandled rejection，且会话照常恢复到「已显示 300 字」。
        // 注意这两条**单测里是零覆盖**——把整个 try/catch 删掉，渲染层用例全绿。
        try {
          const loaded = await api.openNovelPath(initialPath)
          if (cancelled) return
          if (session && session.sourcePath === loaded.sourcePath) {
            setNovel(loaded)
            setEngine(TypingEngine.fromSession(loaded, session))
          } else {
            openNovel(loaded)
          }
          return
        } catch {
          // 与下面会话恢复那条 catch 同形：静默降级，不阻断启动
        }
      }

      if (session) {
        try {
          const loaded = await api.openNovelPath(session.sourcePath)
          if (cancelled) return
          setNovel(loaded)
          setEngine(TypingEngine.fromSession(loaded, session))
        } catch {
          // 原文件已不可用：停在空状态，等用户重新导入
        }
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [openNovel])

  // 菜单命令 → 渲染进程动作
  useEffect(() => {
    const api = getApi()
    if (!api) return
    const off = api.onMenuCommand((cmd) => {
      if (cmd === 'import-novel') void handleImport()
      else if (cmd === 'clear-session') void handleClearSession()
    })
    return off
  }, [handleImport, handleClearSession])

  // 会话持久化（防抖）
  useEffect(() => {
    const api = getApi()
    if (!engine || !api) return
    const timer = window.setTimeout(() => {
      void api.saveSession(engine.toSession())
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [engine, state])

  // 关闭前强制落盘
  useEffect(() => {
    const api = getApi()
    if (!api) return
    const flush = (): void => {
      const current = engineRef.current
      if (current) void api.saveSession(current.toSession())
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // 状态栏计时
  useEffect(() => {
    if (state?.startedAt == null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [state?.startedAt])

  const visibleText = engine?.visibleText ?? ''
  const revealedChars = state ? state.cursor - state.revealStart : 0

  /**
   * 让阅读区跟着光标滚。
   *
   * 问题（真机实测，不是推测）：`.wt-canvas` 的可见高度是 667px，
   * **第 900 个字光标就掉出可见区**，而 `.wt-canvas.scrollTop` 全程是 0——
   * 全项目没有一处会滚动它。按默认比例算，约 90 次击键之后用户就看不见自己打的字了，
   * 而手在键盘上连续输入的人不会去拖滚动条。真 Word 是跟着滚的。
   *
   * 滚的是 `.wt-canvas`（`overflow: auto` 的是它，不是 `.wt-page`），所以这段在 `App`
   * 而不是 `Page`：画布归 App 所有。用 `querySelector` 找 `.wt-caret` 而不是给 `Page`
   * 加一个 ref 参数，是为了不动 `Page` 的公开接口（Task 10 交付的形状）。
   *
   * 【最后那一帧补滚不是多余的，删掉它真机上等于没修】：真实按键之后 Chromium 会把
   * 「焦点里那个 textarea 的光标」滚进视野——那是个盖满整张纸的隐形输入框，它自己的
   * 光标在纸的左上角，于是浏览器每次都把画布按回页首。实测（140 键）：effect 里同步
   * 设成 1414，同一个 effect 里再量已经是 30；去掉补滚那版连敲 120 键后末尾 scrollTop
   * 是 30、光标在 1976px 处（画布只有 667px 高）。这就是「合成事件测不出来」的原因：
   * 用 dispatchEvent 派发 input 时浏览器不做这次回滚，滚动完全正常。
   *
   * 补滚放在 rAF 里，且【刻意不 cancel】：回滚发生在 rAF 之前（实测 sync 时 1243，
   * 1~5ms 后的 rAF 已经是 30），所以 rAF 里这次修正在回滚之后、在这一帧画出来之前。
   * 不 cancel 是因为它幂等（每次都重新量当前布局），而 cancel 会让**快速连打**时上一键
   * 排的那一帧被下一键的 effect 清掉——实测那样会在 k70 之后全程停在页首。
   * 人速（10 键/秒）实测 120/120 次采样光标都在可见区内。
   * 不 cancel 也不会在卸载后乱动：那时 canvas 已脱离文档，量到的高度是 0，被下面那条闸挡住。
   *
   * 【画布高度为 0 就直接返回】：jsdom 没有布局，`getBoundingClientRect()` 全返回 0，
   * 据此算出来的「光标在可见区外」是假的。这条闸让单测里这段是空操作，而真机里画布
   * 高度恒不为 0。**滚动这条的判据只能在真机里量**，别在 vitest 里假装测了。
   *
   * `expanded` 也在依赖里：点折叠条展开前文时 `visibleText` 一字不变，但光标位置大变。
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !visibleText) return
    const caret = canvas.querySelector('.wt-caret')
    if (!caret) return

    // 幂等：已经滚到位时两次测量都落在空隙之内，位移是 0。
    const keepCaretVisible = (): void => {
      const canvasBox = canvas.getBoundingClientRect()
      if (canvasBox.height === 0) return
      const caretBox = caret.getBoundingClientRect()
      if (caretBox.bottom > canvasBox.bottom - CARET_MARGIN) {
        canvas.scrollTop += caretBox.bottom - (canvasBox.bottom - CARET_MARGIN)
      } else if (caretBox.top < canvasBox.top + CARET_MARGIN) {
        canvas.scrollTop -= canvasBox.top + CARET_MARGIN - caretBox.top
      }
    }

    keepCaretVisible()
    window.requestAnimationFrame(keepCaretVisible)
  }, [visibleText, expanded])

  const toolbarProps = useMemo(
    () => ({
      ratio: state?.ratio,
      mode: state?.mode,
      onRatioChange: (n: number) => engineRef.current?.setRatio(n),
      onModeChange: (m: InputMode) => engineRef.current?.setMode(m),
      onImport: () => void handleImport(),
      onClearSession: () => void handleClearSession()
    }),
    [state?.ratio, state?.mode, handleImport, handleClearSession]
  )

  return (
    <ToolbarProvider {...toolbarProps}>
      <div className="wt-app" data-testid="app-root">
        <Ribbon
          docTitle={docTitle}
          onDocTitleChange={setDocTitle}
          darkPaper={darkPaper}
          onDarkPaperChange={setDarkPaper}
          themeSource={themeSource}
          onThemeSourceChange={setThemeSource}
        />

        <div className="wt-body">
          <ChapterList
            novel={novel}
            activeChapter={state?.activeChapter ?? 0}
            chapterPos={state?.chapterPos ?? []}
            onJump={(i) => engineRef.current?.jumpToChapter(i)}
          />

          <main className="wt-canvas" ref={canvasRef}>
            <Page
              visibleText={visibleText}
              expanded={expanded}
              onToggleExpand={() => setExpanded(true)}
              empty={!novel}
            >
              {engine && state && (
                <InputCapture engine={engine} mode={state.mode} />
              )}
            </Page>
          </main>
        </div>

        <StatusBar
          novel={novel}
          revealedChars={revealedChars}
          activeChapter={state?.activeChapter ?? 0}
          ratio={state?.ratio ?? 10}
          mode={state?.mode ?? 'ime'}
          startedAt={state?.startedAt ?? null}
          now={now}
        />

        <Toast />
      </div>
    </ToolbarProvider>
  )
}
