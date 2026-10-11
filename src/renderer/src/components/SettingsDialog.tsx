import { useEffect, useMemo, type FocusEvent } from 'react'
import type { FluentIcon } from '@fluentui/react-icons'
import { MAX_RATIO, MIN_RATIO } from '../../../core/types'
import { useDeferredSettings, type DeferredField } from '../state/deferredSettings'
import { clampRatioInput, useToolbar } from '../state/ToolbarContext'
import type { ThemeSource } from '../types/global'
import {
  IconBook,
  IconClear,
  IconClose,
  IconDarkTheme,
  IconDesktop,
  IconDocument,
  IconFontSize,
  IconImport,
  IconKeyboard,
  IconMoon,
  IconRename,
  IconSettings,
  IconSun
} from './icons'

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
  /** 有没有打开小说：「当前书」的比例框据此禁用——没有书就没有「当前书」 */
  novelOpen: boolean
}

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统', icon: IconDesktop },
  { value: 'light', label: '浅色', icon: IconSun },
  { value: 'dark', label: '深色', icon: IconMoon }
] as const satisfies ReadonlyArray<{ value: ThemeSource; label: string; icon: FluentIcon }>

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
  onThemeSourceChange,
  novelOpen
}: SettingsDialogProps) {
  const { ratio, setRatio, globalRatio, setGlobalRatio, mode, setMode, onImport, onClearSession, notify } =
    useToolbar()

  /**
   * 「手动保存」的那一组设置项——**加一项就是往这张表里加一行**。
   *
   * 表里只有这两项：文档名与阅读替换。外观、纸张、输入模式刻意**不**进来，它们的效果是
   * 当场看得见的（换个颜色、按一下就知道），要保存才生效会很别扭。
   *
   * 【两项底层是两条路】文档名是全局设置（App 状态 → 防抖写 `settings.json`），而比例跟着
   * 书走（`engine.setRatio`，存在那本书的会话里）。对用户是同一个「保存」按钮，这正是把表
   * 放在这里的理由：对话框不必知道背后是什么，它只调 `commit`。
   */
  const fields: DeferredField[] = useMemo(
    () => [
      {
        id: 'doc-title',
        committed: docTitle,
        // 空名退回当前值：蓝条上留一片空白比留着上一个名字更扎眼
        normalize: (raw, committed) => {
          const trimmed = raw.trim()
          return trimmed === '' ? committed : trimmed
        },
        commit: (value) => {
          if (value !== docTitle) onDocTitleChange(value)
        }
      },
      {
        id: 'ratio',
        committed: String(ratio),
        // 解析不出数字就退回当前值，而不是留一个 NaN 草稿——那种草稿会让「保存」一直亮着
        // 而点下去什么都不提交（用户会以为按钮坏了）
        normalize: (raw, committed) => {
          const parsed = Number.parseInt(raw, 10)
          return Number.isFinite(parsed) ? String(clampRatioInput(parsed)) : committed
        },
        commit: (value) => setRatio(Number(value))
      },
      {
        // 全局比例与当前书比例**用的是同一套解析与夹紧**，区别只在提交到哪儿：
        // 一个进 settings.json（新导入的书取它当起点），一个进那本书的会话（真正生效的那个）。
        id: 'global-ratio',
        committed: String(globalRatio),
        normalize: (raw, committed) => {
          const parsed = Number.parseInt(raw, 10)
          return Number.isFinite(parsed) ? String(clampRatioInput(parsed)) : committed
        },
        commit: (value) => setGlobalRatio(Number(value))
      }
    ],
    [docTitle, ratio, globalRatio, onDocTitleChange, setRatio, setGlobalRatio]
  )
  const { drafts, setDraft, blur, dirty, save, reset } = useDeferredSettings(fields)

  // 每次打开都从当前值起稿：上次关掉时没保存的草稿不该留到下一次（关闭＝丢弃，是刻意的）
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  /**
   * 比例那两格的失焦处理：只归一化、不提交；**被夹紧了才提示**（普通改个数字不该弹东西）。
   * 两格逻辑一模一样，只有 id 不同，所以抽出来——复制一份的话，夹紧提示的文案或边界一改就容易漏一处。
   */
  const blurRatio =
    (id: 'ratio' | 'global-ratio') =>
    (e: FocusEvent<HTMLInputElement>): void => {
      const raw = e.currentTarget.value
      const after = blur(id)
      const parsed = Number.parseInt(raw, 10)
      if (Number.isFinite(parsed) && String(clampRatioInput(parsed)) !== String(parsed)) {
        notify(`比例已夹紧到 ${MIN_RATIO}–${MAX_RATIO} 范围：${after}`)
      }
    }

  /** 保存：提交所有有改动的项，并给一条提示（不然点完没有任何反馈） */
  const handleSave = (): void => {
    if (!dirty) return
    save()
    notify('已保存')
  }

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
            <IconSettings className="wt-modal__title-icon" />
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
            <IconClose className="wt-modal__close-icon" />
          </button>
        </div>

        <div className="wt-modal__body">
          <div className="wt-modal__row">
            <span className="wt-modal__label">
              <IconRename className="wt-modal__label-icon" />
              文档名
            </span>
            <input
              className="wt-modal__text"
              data-testid="doc-title-input"
              aria-label="文档名"
              // 打开即聚焦：焦点留在对话框里，用户随手敲的键就不会漏进小说（见 InputCapture
              // 里那条 role="dialog" 的闸）。它同时是「第一个输入框」，Tab 顺序从这里开始。
              autoFocus
              value={drafts['doc-title'] ?? docTitle}
              onChange={(e) => setDraft('doc-title', e.target.value)}
              // 失焦只归一化（去两侧空白），**不提交**——生效要等「保存」
              onBlur={() => blur('doc-title')}
              // 回车＝保存：原先它触发提交，现在留着这个例外会和「保存」按钮打架
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
            />
          </div>

          <div className="wt-modal__row">
            <span className="wt-modal__label">
              <IconFontSize className="wt-modal__label-icon" />
              阅读替换
            </span>
            {/*
              两格：**全局**（新导入的书取它当起点）与**当前书**（真正生效的那个）。
              顺序刻意是全局在前——它是兜底，当前书才是引擎在用的。两格都归「手动保存」，
              点保存才生效。
            */}
            <div className="wt-ratio-pair">
              <div className="wt-ratio-line">
                <span className="wt-ratio__caption">全局</span>
                <span className="wt-ratio__label">1 键显示</span>
                <input
                  className="wt-ratio__input"
                  data-testid="global-ratio-input"
                  aria-label="全局比例：新导入的书，输入 1 个字显示小说多少字"
                  inputMode="numeric"
                  value={drafts['global-ratio'] ?? String(globalRatio)}
                  onChange={(e) => setDraft('global-ratio', e.target.value)}
                  onBlur={blurRatio('global-ratio')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave()
                  }}
                />
                <span className="wt-ratio__label">字</span>
                <span className="wt-ratio__note">新导入的书用它</span>
              </div>
              <div className="wt-ratio-line">
                <span className="wt-ratio__caption">当前书</span>
                <span className="wt-ratio__label">1 键显示</span>
                <input
                  className="wt-ratio__input"
                  data-testid="ratio-input"
                  aria-label="当前书比例：输入 1 个字显示小说多少字"
                  inputMode="numeric"
                  // 没有书就没有「当前书」——禁用而不是藏起来，免得两格一隐一现地跳
                  disabled={!novelOpen}
                  value={drafts['ratio'] ?? String(ratio)}
                  onChange={(e) => setDraft('ratio', e.target.value)}
                  onBlur={blurRatio('ratio')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave()
                  }}
                />
                <span className="wt-ratio__label">字</span>
                {!novelOpen && <span className="wt-ratio__note">未打开小说</span>}
              </div>
            </div>
          </div>

          <div className="wt-modal__row">
            <span className="wt-modal__label">
              <IconKeyboard className="wt-modal__label-icon" />
              输入模式
            </span>
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
            <span className="wt-modal__label">
              <IconDarkTheme className="wt-modal__label-icon" />
              外观
            </span>
            <div className="wt-seg" role="group" aria-label="外观">
              {THEME_OPTIONS.map((opt) => {
                const active = themeSource === opt.value
                const OptIcon = opt.icon
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={`wt-btn${active ? ' wt-btn--active' : ''}`}
                    data-testid={`theme-${opt.value}`}
                    aria-pressed={active}
                    onClick={() => onThemeSourceChange(opt.value)}
                  >
                    {/* 选中时图标也换成实心——与功能区那些切换按钮同一套语义 */}
                    <OptIcon filled={active} className="wt-btn__icon" />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="wt-modal__row">
            {/*
              默认【关】：真 Word 的深色模式里纸张仍是白的，保持这一点伪装才完整。
              勾上之后阅读区整块也跟着暗下来——夜里看书不刺眼，代价是不再像 Word。
              只在系统是深色外观下才有意义；浅色外观下勾了也不动（CSS 按组合选择器处理）。
            */}
            <span className="wt-modal__label">
              <IconDocument className="wt-modal__label-icon" />
              纸张
            </span>
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
            <span className="wt-modal__label">
              <IconBook className="wt-modal__label-icon" />
              小说
            </span>
            <button
              type="button"
              className="wt-btn"
              data-testid="btn-import"
              title="导入小说 (Ctrl+O)"
              onClick={() => onImport()}
            >
              <IconImport className="wt-btn__icon" />
              导入小说
            </button>
            <button
              type="button"
              className="wt-btn"
              data-testid="btn-clear-session"
              title="清除阅读记录"
              onClick={() => onClearSession()}
            >
              <IconClear className="wt-btn__icon" />
              清除阅读记录
            </button>
          </div>
        </div>

        <div className="wt-modal__footer">
          {/*
            保存按钮**只在有未保存改动时出现**：它一出现就是「你有东西没生效」这个信号，
            比一个常驻的灰按钮更说明问题。没改动时点它也没有任何事可做。
          */}
          {dirty && (
            <button
              type="button"
              className="wt-btn wt-btn--primary"
              data-testid="settings-save"
              onClick={handleSave}
            >
              保存
            </button>
          )}
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
