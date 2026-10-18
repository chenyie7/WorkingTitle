import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import type { Novel } from '../../../core/types'
import { defaultShortcutText } from '../state/shortcuts'
import { buildTreeRows, chapterPercent, findChapterRow, type TreeRow } from './chapterTree'
import { IconCaretDown, IconClose, IconExpand, IconSearch } from './icons'

export const ROW_HEIGHT = 28
const OVERSCAN = 6

export interface ChapterListProps {
  novel: Novel | null
  activeChapter: number
  chapterPos: readonly number[]
  onJump: (index: number) => void
  sidebarShortcut?: string
  collapsed?: boolean
  onCollapsedChange?: (next: boolean) => void
}

export function ChapterList({
  novel,
  activeChapter,
  chapterPos,
  onJump,
  sidebarShortcut = defaultShortcutText('toggle-sidebar'),
  collapsed: collapsedProp,
  onCollapsedChange
}: ChapterListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(400)
  const [selfCollapsed, setSelfCollapsed] = useState(false)
  const [query, setQuery] = useState('')
  const [bookCollapsed, setBookCollapsed] = useState(false)
  const [collapsedVolumes, setCollapsedVolumes] = useState<ReadonlySet<number>>(() => new Set())
  const controlled = collapsedProp !== undefined
  const collapsed = controlled ? collapsedProp : selfCollapsed

  const setCollapsed = (next: boolean): void => {
    if (controlled) onCollapsedChange?.(next)
    else setSelfCollapsed(next)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => setViewport(el.clientHeight || 400)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [collapsed])

  const chapters = novel?.chapters ?? []
  const chapterByIndex = useMemo(
    () => new Map(chapters.map((chapter) => [chapter.index, chapter])),
    [chapters]
  )
  const rows = useMemo(
    () =>
      buildTreeRows(chapters, {
        bookTitle: novel?.title ?? '',
        query,
        bookCollapsed,
        collapsedVolumes
      }),
    [chapters, novel?.title, query, bookCollapsed, collapsedVolumes]
  )

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = 0
    setScrollTop(0)
  }, [query])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !novel) return
    const rowIndex = findChapterRow(rows, activeChapter)
    if (rowIndex < 0) return
    const top = rowIndex * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    // 搜索与展开会重算 rows；那条路不该把列表拽回当前章，所以 rows 不进依赖。
  }, [activeChapter, novel, collapsed])

  if (collapsed) {
    return (
      <button
        type="button"
        className="wt-sidebar__rail"
        data-testid="sidebar-toggle"
        aria-expanded={false}
        aria-label="显示章节栏"
        title={`显示章节栏（${sidebarShortcut}）`}
        onClick={() => setCollapsed(false)}
      >
        <IconExpand className="wt-sidebar__rail-icon" />
      </button>
    )
  }

  const first = Math.min(
    rows.length,
    Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  )
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
  const visible = rows.slice(first, last)
  const noMatch = query.trim() !== '' && !rows.some((row) => row.kind === 'chapter')

  const toggleRow = (row: TreeRow): void => {
    if (row.kind === 'book') {
      setBookCollapsed((value) => !value)
      return
    }
    if (row.kind !== 'volume') return
    setCollapsedVolumes((prev) => {
      const next = new Set(prev)
      if (next.has(row.chapterIndex)) next.delete(row.chapterIndex)
      else next.add(row.chapterIndex)
      return next
    })
  }

  const handleSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      setQuery('')
      return
    }
    if (e.key !== 'Enter') return
    const hit = rows.find((row) => row.kind === 'chapter')
    if (hit && hit.kind === 'chapter') onJump(hit.chapterIndex)
  }

  const renderRow = (row: TreeRow, index: number): ReactNode => {
    const isCurrent = row.chapterIndex !== null && row.chapterIndex === activeChapter
    const hasChildren =
      row.kind === 'book' || row.kind === 'volume' ? row.hasChildren : false
    const isCollapsed =
      row.kind === 'book'
        ? bookCollapsed
        : row.kind === 'volume'
          ? collapsedVolumes.has(row.chapterIndex)
          : false
    const chapter = row.chapterIndex === null ? undefined : chapterByIndex.get(row.chapterIndex)
    const pct =
      row.kind === 'chapter' && chapter
        ? chapterPercent(chapter.charCount, chapterPos[row.chapterIndex] ?? 0)
        : null
    const showPct =
      row.kind === 'chapter' && pct !== null && (row.chapterIndex === activeChapter || pct > 0)

    const classes = [
      'chapter-item',
      row.kind === 'book' ? 'chapter-item--book' : '',
      row.kind === 'volume' ? 'chapter-item--volume' : '',
      isCurrent ? 'chapter-item--active' : ''
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div
        key={row.key}
        className={classes}
        data-testid={row.kind === 'book' ? 'tree-book' : `chapter-item-${row.chapterIndex}`}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        aria-current={isCurrent ? 'true' : undefined}
        title={row.title}
        style={{
          position: 'absolute',
          top: index * ROW_HEIGHT,
          left: 0,
          right: 0,
          height: ROW_HEIGHT,
          paddingLeft: 10 + row.depth * 14
        }}
        onClick={(e) => {
          const target = e.target
          // 不用 stopPropagation：window 上的抢焦点处理器要收到这一下，否则焦点会留在箭头按钮上。
          if (target instanceof Element && target.closest('.chapter-item__caret')) return
          if (row.kind === 'book') toggleRow(row)
          else onJump(row.chapterIndex)
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={`chapter-item__caret${isCollapsed ? ' chapter-item__caret--collapsed' : ''}`}
            data-testid={
              row.kind === 'book' ? 'tree-book-toggle' : `volume-toggle-${row.chapterIndex}`
            }
            aria-label={isCollapsed ? '展开' : '收起'}
            aria-expanded={!isCollapsed}
            onClick={() => toggleRow(row)}
          >
            <IconCaretDown className="chapter-item__caret-icon" />
          </button>
        ) : (
          <span className="chapter-item__caret-slot" aria-hidden="true" />
        )}
        <span className="chapter-item__title">{row.title}</span>
        {showPct && pct !== null ? (
          <span className="chapter-item__pct" data-testid={`chapter-pct-${row.chapterIndex}`}>
            {pct}%
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <aside className="wt-sidebar">
      <div className="wt-sidebar__header">
        <span className="wt-sidebar__title">导航</span>
        <button
          type="button"
          className="wt-sidebar__toggle"
          data-testid="sidebar-toggle"
          aria-expanded
          aria-label="隐藏章节栏"
          title={`隐藏章节栏（${sidebarShortcut}）`}
          onClick={() => setCollapsed(true)}
        >
          <IconClose className="wt-sidebar__toggle-icon" />
        </button>
      </div>
      {novel ? (
        <>
          <div className="wt-nav__search">
            <IconSearch className="wt-nav__search-icon" />
            <input
              className="wt-nav__search-input"
              data-testid="nav-search"
              aria-label="搜索章节"
              placeholder="搜索章节"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            {query !== '' ? (
              <button
                type="button"
                className="wt-nav__search-clear"
                data-testid="nav-search-clear"
                aria-label="清空搜索"
                onClick={() => setQuery('')}
              >
                <IconClose className="wt-nav__search-clear-icon" />
              </button>
            ) : null}
          </div>
          <div
            className="wt-sidebar__list"
            data-testid="chapter-list"
            role="tree"
            aria-label="章节导航"
            ref={scrollRef}
            onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          >
            <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
              {visible.map((row, offset) => renderRow(row, first + offset))}
            </div>
            {noMatch ? (
              <div className="wt-nav__empty" data-testid="nav-empty">
                没有匹配的章节
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="wt-sidebar__empty">
          <span className="wt-sidebar__empty-title">未导入小说</span>
          <span className="wt-sidebar__empty-hint">文件 → 设置 → 导入小说</span>
        </div>
      )}
    </aside>
  )
}
