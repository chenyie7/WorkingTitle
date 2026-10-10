import { useEffect, useState } from 'react'
import { MAX_RATIO, MIN_RATIO } from '../../../core/types'
import { clampRatioInput, useToolbar } from '../state/ToolbarContext'
import type { ThemeSource } from '../types/global'

export interface SettingsDialogProps {
  /** 对话框归 Ribbon 所有：打开它的那个按钮就在「文件」选项卡的工具组里 */
  open: boolean
  onClose: () => void
  docTitle: string
  onDocTitleChange: (next: string) => void
  /** 「深色模式下纸张也变暗」。默认关（真 Word 深色模式下纸张仍是白的）。 */
  darkPaper: boolean
  onDarkPaperChange: (next: boolean) => void
  /** 外观偏好：跟随系统 / 浅色 / 深色 */
  themeSource: ThemeSource
  onThemeSourceChange: (next: ThemeSource) => void
}

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeSource; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

/**
 * 设置对话框：应用**真实功能**的唯一去处（文档名 / 比例 / 输入模式 / 导入 / 清除阅读记录）。
 *
 * 【为什么要有一个对话框，而不是像原来那样把控件摆在工具栏里】那些控件是伪装的一部分里
 * 最扎眼的一处：「1 键显示 N 字」「导入小说」摆在假 Word 的工具栏和「文件」页上，任何一个
 * 瞥见屏幕的人都看得出这不是 Word。收进一个模态之后，界面上只剩一个「设置」按钮和一个
 * 快捷键——它们本身就是 Word 也有的东西（Word 的「选项」同样是模态框）。
 *
 * 【testid 一个都没改】`ratio-input` / `mode-button` / `btn-import` / `btn-clear-session` /
 * `doc-title-input` 原样搬进来，只是不再同时存在于工具栏里。
 */
export function SettingsDialog({
  open,
  onClose,
  docTitle,
  onDocTitleChange,
  darkPaper,
  onDarkPaperChange,
  themeSource,
  onThemeSourceChange
}: SettingsDialogProps) {
  const { ratio, setRatio, mode, setMode, onImport, onClearSession, notify } = useToolbar()
  const [ratioDraft, setRatioDraft] = useState(String(ratio))
  const [titleDraft, setTitleDraft] = useState(docTitle)

  // 比例在别处变了（会话恢复、其它入口）时把草稿跟回去
  useEffect(() => {
    setRatioDraft(String(ratio))
  }, [ratio])

  // 每次打开都从当前文档名起稿：上次关掉时没提交的草稿不该留到下一次
  useEffect(() => {
    if (open) setTitleDraft(docTitle)
  }, [open, docTitle])

  /**
   * Esc 关闭。
   *
   * 【挂在 window 上收得到】InputCapture 在「纯按键」模式下对 `NON_CHAR_KEYS` 里的键
   * （Escape 在列）直接放行，输入法模式下更是完全不拦 keydown，所以这个键不会被抽字
   * 逻辑吃掉。反过来，对话框开着时焦点在对话框里（见下面的 `autoFocus`），隐藏 textarea
   * 根本收不到这些按键。
   */
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  /**
   * 关掉时把键盘焦点还给阅读区的隐形输入框。
   *
   * 【少了这一步，关掉对话框之后用户打不出字——而单测一字不差地全绿】：模态期间焦点在
   * 对话框里，关闭后浏览器把它交还给 `body`，而 InputCapture 只在「挂载时」和「点击
   * 页面其它地方时」抢焦点（它现在还会跳过整个对话框）——于是用户敲键盘什么都不会发生，
   * 得先拿鼠标在阅读区点一下。jsdom 没有真实的焦点移交，这条分支在 vitest 里是空转。
   *
   * 【用 preventScroll 与 InputCapture 自己一致】：不这样的话浏览器会把光标所在处滚进
   * 视野，等于关个设置就把用户的阅读位置跳一下。
   *
   * 查询用 `[data-testid]` 而不是给 InputCapture 加一个 ref 参数：与 App 里那段跟随
   * 滚动同样的取舍——不改别人的公开接口。空状态下（没有小说）根本没有这个元素，
   * 可选链吞掉。
   */
  useEffect(() => {
    if (open) return
    document.querySelector<HTMLElement>('[data-testid="input-capture"]')?.focus({ preventScroll: true })
  }, [open])

  const commitRatio = (raw: string): void => {
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) {
      setRatioDraft(String(ratio))
      return
    }
    const next = clampRatioInput(parsed)
    setRatio(next)
    setRatioDraft(String(next))
    if (next !== parsed) notify(`比例已夹紧到 ${MIN_RATIO}–${MAX_RATIO} 范围：${next}`)
  }

  const commitTitle = (): void => {
    const next = titleDraft.trim()
    // 空名不提交：蓝条上留一片空白比留着上一个名字更扎眼
    if (next && next !== docTitle) onDocTitleChange(next)
    else setTitleDraft(docTitle)
  }

  if (!open) return null

  return (
    <div
      className="wt-modal"
      data-testid="settings"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wt-settings-title"
      // 只有点在遮罩自己身上才关：点在面板（及面板里的空白）上时 target 是面板，不是这里。
      // 用 click 而不是 mousedown：从面板里按下、拖出遮罩再松开不该算作「点了遮罩」。
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="wt-modal__panel">
        <div className="wt-modal__header">
          <span className="wt-modal__title" id="wt-settings-title">
            选项
          </span>
          <button
            type="button"
            className="wt-modal__close"
            data-testid="settings-close"
            aria-label="关闭"
            title="关闭 (Esc)"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="wt-modal__body">
          <div className="wt-modal__row">
            <span className="wt-modal__label">文档名</span>
            <input
              className="wt-modal__text"
              data-testid="doc-title-input"
              aria-label="文档名"
              // 打开即聚焦：焦点留在对话框里，用户随手敲的键就不会漏进小说（见 InputCapture
              // 里那条 role="dialog" 的闸）。它同时是「第一个输入框」，Tab 顺序从这里开始。
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle()
              }}
            />
          </div>

          <div className="wt-modal__row">
            <span className="wt-modal__label">阅读替换</span>
            <div className="wt-ratio">
              <span className="wt-ratio__label">1 键显示</span>
              <input
                className="wt-ratio__input"
                data-testid="ratio-input"
                aria-label="比例：输入 1 个字显示小说多少字"
                inputMode="numeric"
                value={ratioDraft}
                onChange={(e) => setRatioDraft(e.target.value)}
                onBlur={(e) => commitRatio(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRatio(e.currentTarget.value)
                }}
              />
              <span className="wt-ratio__label">字</span>
            </div>
          </div>

          <div className="wt-modal__row">
            <span className="wt-modal__label">输入模式</span>
            <button
              type="button"
              className={`wt-btn ${mode === 'ime' ? 'wt-btn--active' : ''}`}
              data-testid="mode-button"
              title="切换输入模式：输入法友好 / 纯按键"
              aria-pressed={mode === 'ime'}
              onClick={() => {
                const next = mode === 'ime' ? 'key' : 'ime'
                setMode(next)
                notify(next === 'ime' ? '已切换：输入法友好模式' : '已切换：纯按键模式')
              }}
            >
              {mode === 'ime' ? '输入法' : '纯按键'}
            </button>
          </div>

          <div className="wt-modal__row">
            {/*
              外观的三选一。**必须走主进程**（见 ipc.ts 里的说明）：只翻页面的 class 的话，
              macOS 的红绿灯不会跟着变，又会回到「两块颜色对不上」。
            */}
            <span className="wt-modal__label">外观</span>
            <div className="wt-seg" role="group" aria-label="外观">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`wt-btn${themeSource === opt.value ? ' wt-btn--active' : ''}`}
                  data-testid={`theme-${opt.value}`}
                  aria-pressed={themeSource === opt.value}
                  onClick={() => onThemeSourceChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="wt-modal__row">
            {/*
              默认【关】：真 Word 的深色模式里纸张仍是白的，保持这一点伪装才完整。
              勾上之后阅读区整块也跟着暗下来——夜里看书不刺眼，代价是不再像 Word。
              只在系统是深色外观下才有意义；浅色外观下勾了也不动（CSS 按组合选择器处理）。
            */}
            <span className="wt-modal__label">纸张</span>
            <label className="wt-modal__check">
              <input
                type="checkbox"
                data-testid="dark-paper"
                checked={darkPaper}
                onChange={(e) => onDarkPaperChange(e.target.checked)}
              />
              深色模式下也变暗
            </label>
          </div>

          <div className="wt-modal__row">
            <span className="wt-modal__label">小说</span>
            <button
              type="button"
              className="wt-btn"
              data-testid="btn-import"
              title="导入小说 (Ctrl+O)"
              onClick={() => onImport()}
            >
              导入小说
            </button>
            <button
              type="button"
              className="wt-btn"
              data-testid="btn-clear-session"
              title="清除阅读记录"
              onClick={() => onClearSession()}
            >
              清除阅读记录
            </button>
          </div>
        </div>

        <div className="wt-modal__footer">
          {/* 第二个关闭入口：标题栏那个 ✕ 是给「找关闭」的眼睛用的，这个是给读完设置的人用的 */}
          <button
            type="button"
            className="wt-btn"
            data-testid="settings-close-footer"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
