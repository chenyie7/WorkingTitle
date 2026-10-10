import { useEffect, useRef, useState } from 'react'
import type { Novel } from '../../../core/types'

export const ROW_HEIGHT = 32
const OVERSCAN = 6

export interface ChapterListProps {
  novel: Novel | null
  activeChapter: number
  // 与 EngineState.chapterPos 同型：快照是冻结的只读数组，这里照抄类型，
  // 别在组件里写回它（写了在严格模式下抛 TypeError，非严格模式下被静默丢弃）。
  chapterPos: readonly number[]
  onJump: (index: number) => void
}

export function ChapterList({
  novel,
  activeChapter,
  chapterPos,
  onJump
}: ChapterListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(400)
  /** 书名信息（小说名 + 章节数/编码）是否收起。刻意只放在内存里，见下面 effect 的注释。 */
  const [headerHidden, setHeaderHidden] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => setViewport(el.clientHeight || 400)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 打字推进时，让当前章节滚进可视区域
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !novel) return
    const top = activeChapter * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [activeChapter, novel])

  // 书名信息的显示/隐藏快捷键：⌘/Ctrl + Shift + H
  //
  // 【为什么挂在 window 上还能收到】InputCapture 在「纯按键」模式下对**带修饰键的组合键**
  // 是直接放行的（它的 handleKeyDown 里 `if (e.ctrlKey || e.metaKey || e.altKey) return`），
  // 输入法模式下更是完全不拦截 keydown——所以这个组合不会被抽字逻辑吃掉。
  //
  // 【为什么用 e.code 而不是 e.key】按住 Shift 时 `e.key` 是大写 'H'，而输入法或非 QWERTY
  // 布局还可能给出别的字符；`e.code === 'KeyH'` 是按物理按键位置判定的，不受这两件事影响。
  //
  // 【为什么状态只在内存里】用户没要求持久化，而且它现在不属于 PersistedSession 的字段——
  // 那个结构由引擎产出、还有一条必填字段的校验器，加 UI 状态进去要连带动 schema 与校验。
  // 要「重启后仍保持隐藏」的话，单独给这个开关做持久化即可，不必塞进会话。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return
      if (e.code !== 'KeyH') return
      e.preventDefault()
      setHeaderHidden((v) => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const chapters = novel?.chapters ?? []
  const total = chapters.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
  const visible = chapters.slice(first, last)

  return (
    <aside className="wt-sidebar">
      <div
        className={`wt-sidebar__header${headerHidden ? ' wt-sidebar__header--collapsed' : ''}`}
        data-testid="sidebar-header"
      >
        {!headerHidden && (
          <>
            {novel ? novel.title : '未导入小说'}
            <div className="wt-sidebar__sub">
              {novel ? `共 ${total} 章 · ${novel.encoding}` : '文件 → 导入小说'}
            </div>
          </>
        )}
        <button
          type="button"
          className="wt-sidebar__toggle"
          data-testid="sidebar-header-toggle"
          aria-pressed={!headerHidden}
          aria-label={headerHidden ? '显示书名信息' : '隐藏书名信息'}
          title={`${headerHidden ? '显示' : '隐藏'}书名信息（⌘/Ctrl + Shift + H）`}
          onClick={() => setHeaderHidden((v) => !v)}
        >
          {headerHidden ? '▸' : '▴'}
        </button>
      </div>
      <div
        className="wt-sidebar__list"
        data-testid="chapter-list"
        ref={scrollRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
          {visible.map((chapter, offset) => {
            const index = first + offset
            const pos = chapterPos[index] ?? 0
            const pct = chapter.charCount === 0 ? 100 : Math.min(100, Math.round((pos / chapter.charCount) * 100))
            return (
              <div
                key={chapter.index}
                className={`chapter-item ${index === activeChapter ? 'chapter-item--active' : ''}`}
                data-testid={`chapter-item-${index}`}
                style={{
                  position: 'absolute',
                  top: index * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT
                }}
                title={chapter.title}
                onClick={() => onJump(index)}
              >
                <span className="chapter-item__title">{chapter.title}</span>
                <span className="chapter-item__pct" data-testid={`chapter-pct-${index}`}>
                  {pct}%
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
