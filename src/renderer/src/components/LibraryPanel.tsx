import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { IpcResult } from '../../../core/api'
import type { LibraryEntry } from '../../../core/types'
import { getApi } from '../api'
import { useToolbar } from '../state/ToolbarContext'
import { IconBibliography, IconImport } from './icons'

export interface LibraryPanelProps {
  /** 当前页是不是「小说管理」。面板始终挂载，靠这个值判断何时拉数据。 */
  active: boolean
  currentSourcePath: string | null
  onOpenNovel: (sourcePath: string) => Promise<boolean>
  onDeleteNovel: (entry: LibraryEntry) => Promise<IpcResult<void>>
  onClose: () => void
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function progressOf(entry: LibraryEntry): number {
  if (entry.charCount <= 0) return 0
  return Math.min(100, Math.floor((entry.cursor / entry.charCount) * 100))
}

export function LibraryPanel({
  active,
  currentSourcePath,
  onOpenNovel,
  onDeleteNovel,
  onClose
}: LibraryPanelProps): ReactElement {
  const { onImport, notify } = useToolbar()
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  /** 请求代际：只有最后一次 refresh 的结果才准落地，旧响应不许覆盖新列表。 */
  const refreshSeqRef = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++refreshSeqRef.current
    const api = getApi()
    if (!api) {
      setEntries([])
      return
    }
    try {
      const next = await api.listNovels()
      if (seq === refreshSeqRef.current) setEntries(next)
    } catch {
      if (seq === refreshSeqRef.current) setEntries([])
    }
  }, [])

  useEffect(() => {
    if (active) void refresh()
  }, [active, refresh])

  const handleImport = async (): Promise<void> => {
    setPending(true)
    try {
      await onImport()
      await refresh()
    } catch {
      notify('导入失败')
    } finally {
      setPending(false)
    }
  }

  const handleOpen = async (entry: LibraryEntry): Promise<void> => {
    setPending(true)
    try {
      if (await onOpenNovel(entry.sourcePath)) onClose()
    } catch {
      notify('打开失败')
    } finally {
      setPending(false)
    }
  }

  const handleDelete = async (entry: LibraryEntry): Promise<void> => {
    setPending(true)
    try {
      const result = await onDeleteNovel(entry)
      if (!result.ok) notify(`删除失败：${result.reason}`)
    } catch {
      notify('删除失败')
    } finally {
      setConfirmId(null)
      setPending(false)
    }
    await refresh()
  }

  const sorted = [...(entries ?? [])].sort(
    (a, b) => (b.lastReadAt ?? b.importedAt) - (a.lastReadAt ?? a.importedAt)
  )

  return (
    <div className="wt-library">
      <div className="wt-library__head">
        <span className="wt-library__title">
          <IconBibliography className="wt-modal__label-icon" />
          书库
        </span>
        <button
          type="button"
          className="wt-btn wt-btn--primary"
          data-testid="library-import"
          disabled={pending}
          onClick={() => void handleImport()}
        >
          <IconImport className="wt-btn__icon" />
          导入小说
        </button>
      </div>

      {entries === null ? (
        <p className="wt-library__empty">正在读取书库…</p>
      ) : entries.length === 0 ? (
        <p className="wt-library__empty">书库里还没有小说</p>
      ) : (
        <ul className="wt-library__list">
          {sorted.map((entry) => {
            const current = entry.sourcePath === currentSourcePath
            return (
              <li
                key={entry.id}
                data-testid={`library-row-${entry.id}`}
                className={`wt-library__row ${current ? 'wt-library__row--current' : ''}`}
              >
                <div className="wt-library__main">
                  <span className="wt-library__name">{entry.title}</span>
                  <span className="wt-library__meta">
                    {entry.broken ? (
                      <span className="wt-library__broken">文件丢失</span>
                    ) : (
                      <>
                        已读 {progressOf(entry)}% · {formatSize(entry.size)} · 导入于{' '}
                        {formatDate(entry.importedAt)}
                      </>
                    )}
                  </span>
                </div>
                <div className="wt-library__actions">
                  {current && <span className="wt-library__badge">正在阅读</span>}
                  {!entry.broken && !current && (
                    <button
                      type="button"
                      className="wt-btn"
                      disabled={pending}
                      onClick={() => void handleOpen(entry)}
                    >
                      打开
                    </button>
                  )}
                  {confirmId === entry.id ? (
                    <>
                      <span className="wt-library__confirm">
                        将同时删除拷贝文件与阅读进度，不可恢复
                      </span>
                      <button
                        type="button"
                        className="wt-btn wt-library__danger"
                        disabled={pending}
                        onClick={() => void handleDelete(entry)}
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        className="wt-btn"
                        disabled={pending}
                        onClick={() => setConfirmId(null)}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="wt-btn"
                      disabled={pending}
                      onClick={() => setConfirmId(entry.id)}
                    >
                      删除
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
