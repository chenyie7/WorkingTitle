import { useEffect, useRef, useState } from 'react'
import type { Novel } from '../../../core/types'
import { defaultShortcutText } from '../state/shortcuts'
import { IconCollapse, IconExpand } from './icons'

export const ROW_HEIGHT = 32
const OVERSCAN = 6

export interface ChapterListProps {
  novel: Novel | null
  activeChapter: number
  // 与 EngineState.chapterPos 同型：快照是冻结的只读数组，这里照抄类型，
  // 别在组件里写回它（写了在严格模式下抛 TypeError，非严格模式下被静默丢弃）。
  chapterPos: readonly number[]
  onJump: (index: number) => void
  /**
   * 章节栏快捷键的**显示文本**（已按平台格式化）。两个按钮的 title 用它。
   *
   * 【为什么是可选带默认值】真值住在 `App` 里（只有它手里有按平台补齐过的快捷键表），
   * 不传也得显示成**该平台的默认值**，而不是写死一句「⌘/Ctrl + Shift + H」。
   */
  sidebarShortcut?: string
  /**
   * 整条左栏（书名信息 + 章节列表）是否收起。
   *
   * 【为什么是可选带默认值】真值住在 `App` 里——收起/展开的快捷键归**全局分发器**，而分发器
   * 长在那一层，它翻不动本组件内部的 state，所以那边必须受控。但本组件单独渲染时（组件级
   * 用例、以及任何不关心全局快捷键的场景）没人替它持这个状态，两个 prop 都不给就退回组件
   * 内部——与上面那个 `sidebarShortcut` 是同一套取舍。
   *
   * 【受控不受控只看 `collapsed` 给没给值】给了就是受控（切换走 `onCollapsedChange`），
   * 没给就自己管。**别写成「两个都给才受控」**：只给值不给回调时受控是坏的（点不动），
   * 那时退回内部状态反而能用。
   *
   * 【无论哪种，状态都只在内存里】用户没要求持久化，而且它不属于 `PersistedSession` 的
   * 字段——那个结构由引擎产出、还有一条必填字段的校验器，加 UI 状态进去要连带动 schema 与
   * 校验。要「重启后仍保持隐藏」的话，单独给这个开关做持久化即可，不必塞进会话。
   */
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
  /** 不受控时的落点。受控时它永远是初值，没人读它。 */
  const [selfCollapsed, setSelfCollapsed] = useState(false)
  const controlled = collapsedProp !== undefined
  const collapsed = controlled ? collapsedProp : selfCollapsed

  /** 收起/展开的**唯一**出口：受控时交给外面，不受控时落到自己这段 state。 */
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
    // 依赖 collapsed 而不是 []：收起时整条 aside 不渲染、scrollRef.current 是 null，
    // 这个 effect 会直接返回；重新展开后必须【再跑一次】去量真实高度，否则 viewport
    // 会一直停在默认的 400，虚拟滚动按错误的视口高度算窗口。
  }, [collapsed])

  // 打字推进时，让当前章节滚进可视区域
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !novel) return
    const top = activeChapter * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    // 带上 collapsed：重新展开时列表是刚挂载的，需要把当前章节滚回可视区
  }, [activeChapter, novel, collapsed])

  // 左侧栏的显示/隐藏快捷键：⌘/Ctrl + Shift + H
  //
  // 【本组件为什么不再自己监听】那条 keydown 收进了**全局分发器**
  // （`renderer/src/state/shortcuts.ts` 的 `useShortcutDispatcher`）：它按注册表 + 当前设置
  // 建出「规范串 → 动作」表，命中就把动作派给调用方。
  //
  // 组件自己监听有一条硬伤：**键位现在是可配置的**，改了键之后组件手里那套常量就过期了
  // （而且两边都监听会各执行一次——`preventDefault` 拦不住同一事件上的其它监听器）。
  // 分发器那侧的细节（为什么挂在 window 上还收得到、为什么读 e.code 而不是 e.key）都写在
  // 那个模块里，不在这里重一份。

  const chapters = novel?.chapters ?? []
  const total = chapters.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
  const visible = chapters.slice(first, last)

  // 收起时整条 aside 都不渲染，只留一条细缝（下面那个按钮）。
  //
  // 【为什么还留一条缝，而不是干脆什么都不留】那个快捷键是新用户不会知道的；全无入口的话，
  // 鼠标用户一旦收起就再也调不回来（只能重启）。细缝只有 12px、颜色很淡，视觉上近乎不存在，
  // 但鼠标总能找回来。
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

  return (
    <aside className="wt-sidebar">
      <div className="wt-sidebar__header">
        <button
          type="button"
          className="wt-sidebar__toggle"
          data-testid="sidebar-toggle"
          aria-expanded
          aria-label="隐藏章节栏"
          title={`隐藏章节栏（${sidebarShortcut}）`}
          onClick={() => setCollapsed(true)}
        >
          <IconCollapse className="wt-sidebar__toggle-icon" />
        </button>
        {novel ? novel.title : '未导入小说'}
        <div className="wt-sidebar__sub">
          {novel ? `共 ${total} 章 · ${novel.encoding}` : '文件 → 设置 → 导入小说'}
        </div>
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
