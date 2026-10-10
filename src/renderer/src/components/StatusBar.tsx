import type { InputMode, Novel } from '../../../core/types'

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

export interface StatusBarProps {
  novel: Novel | null
  revealedChars: number
  activeChapter: number
  ratio: number
  mode: InputMode
  startedAt: number | null
  now: number
}

export function StatusBar({
  novel,
  revealedChars,
  activeChapter,
  ratio,
  mode,
  startedAt,
  now
}: StatusBarProps) {
  const totalChars = novel?.flatText.length ?? 0
  const totalChapters = novel?.chapters.length ?? 0
  const percent = totalChars === 0 ? 0 : Math.floor((revealedChars / totalChars) * 100)
  const elapsed = startedAt === null ? '00:00:00' : formatElapsed(now - startedAt)

  return (
    <div className="wt-statusbar" data-testid="statusbar">
      <span data-testid="status-chars">
        已显示 {revealedChars.toLocaleString('en-US')} / 全书 {totalChars.toLocaleString('en-US')} 字
      </span>
      <span data-testid="status-chapter">
        {novel ? `第 ${activeChapter + 1} 章 / 共 ${totalChapters} 章` : '未导入'}
      </span>
      <span data-testid="status-ratio">比例 1:{ratio}</span>
      <span data-testid="status-encoding">编码 {novel?.encoding ?? '—'}</span>
      <span data-testid="status-mode">输入模式 {mode === 'ime' ? '输入法' : '纯按键'}</span>
      <span data-testid="status-elapsed">用时 {elapsed}</span>
      <span className="wt-statusbar__spacer" />
      <span data-testid="status-percent">{percent}%</span>
      <span>中文(中国)</span>
    </div>
  )
}
