import { useEffect, useState } from 'react'
import { MAX_RATIO, MIN_RATIO } from '../../../core/types'
import { clampRatioInput, useToolbar } from '../state/ToolbarContext'

export type ToolbarItem =
  | { kind: 'toggle'; id: string; label: string; title: string }
  | { kind: 'placeholder'; id: string; label: string; title: string }
  | { kind: 'ratio' }
  | { kind: 'mode' }
  | { kind: 'import' }
  | { kind: 'clear-session' }

export interface ToolbarGroup {
  label: string
  items: ToolbarItem[]
}

export function Toolbar({ groups }: { groups: ToolbarGroup[] }) {
  const { toggles, toggle, notify, ratio, setRatio, mode, setMode, onImport, onClearSession } =
    useToolbar()
  const [draft, setDraft] = useState(String(ratio))

  useEffect(() => {
    setDraft(String(ratio))
  }, [ratio])

  const commitRatio = (raw: string): void => {
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) {
      setDraft(String(ratio))
      return
    }
    const next = clampRatioInput(parsed)
    setRatio(next)
    setDraft(String(next))
    if (next !== parsed) notify(`比例已夹紧到 ${MIN_RATIO}–${MAX_RATIO} 范围：${next}`)
  }

  return (
    <div className="wt-toolbar" data-testid="toolbar">
      {groups.map((group) => (
        <div className="wt-group" key={group.label}>
          <div className="wt-group__body">
            {group.items.map((item) => {
              switch (item.kind) {
                case 'ratio':
                  return (
                    <div className="wt-ratio" key="ratio">
                      <span className="wt-ratio__label">1 键显示</span>
                      <input
                        className="wt-ratio__input"
                        data-testid="ratio-input"
                        aria-label="比例：输入 1 个字显示小说多少字"
                        inputMode="numeric"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={(e) => commitRatio(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRatio(e.currentTarget.value)
                        }}
                      />
                      <span className="wt-ratio__label">字</span>
                    </div>
                  )

                case 'mode':
                  return (
                    <button
                      key="mode"
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
                  )

                case 'import':
                  return (
                    <button
                      key="import"
                      type="button"
                      className="wt-btn"
                      data-testid="btn-import"
                      title="导入小说 (Ctrl+O)"
                      onClick={() => onImport()}
                    >
                      导入小说
                    </button>
                  )

                case 'clear-session':
                  return (
                    <button
                      key="clear-session"
                      type="button"
                      className="wt-btn"
                      data-testid="btn-clear-session"
                      title="清除阅读记录"
                      onClick={() => onClearSession()}
                    >
                      清除阅读记录
                    </button>
                  )

                default: {
                  const active = Boolean(toggles[item.id])
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`wt-btn ${active ? 'wt-btn--active' : ''}`}
                      data-testid={`btn-${item.id}`}
                      title={item.title}
                      aria-pressed={item.kind === 'toggle' ? active : undefined}
                      onClick={() => {
                        if (item.kind === 'toggle') toggle(item.id)
                        else notify('演示占位功能，未实现')
                      }}
                    >
                      {item.label}
                    </button>
                  )
                }
              }
            })}
          </div>
          <div className="wt-group__label">{group.label}</div>
        </div>
      ))}
    </div>
  )
}
