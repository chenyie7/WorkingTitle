import { useCallback, useEffect, useRef, useState } from 'react'
import { fillCharsFor } from '../../../core/bossKey'
import type { TypingEngine } from '../../../core/engine'
import type { Novel } from '../../../core/types'
import { pickFillCut, type BlockHeight } from '../markdown/fill'
import { measureBlocks } from '../markdown/measure'

export interface BossFillInput {
  workNovel: Novel | null
  workEngine: TypingEngine | null
  /** 铺的是工作文档，所以判它、不是当前显示的那份。 */
  workIsMarkdown: boolean
  /** 量不出高度、退回按字符数铺时用的正文字号。 */
  pageFontSize: number
}

export interface BossFill {
  measuring: boolean
  onMeasureNode: (el: HTMLElement | null) => void
  applyFill: (percent: number) => void
  invalidateHeights: () => void
}

/**
 * 老板键的「铺满一页」：测量工作文档的块高、选切点、把引擎游标移过去。
 *
 * 三条路顺序不能换：有缓存直接算 → 没缓存先量（渲染一次整篇隐藏副本）→
 * 量不出来退回按字符数（`fillCharsFor`）。
 */
export function useBossFill({
  workNovel,
  workEngine,
  workIsMarkdown,
  pageFontSize
}: BossFillInput): BossFill {
  const [measuring, setMeasuring] = useState(false)
  /** 隐藏副本的根元素，`MarkdownView` 挂载时交过来。 */
  const measureElRef = useRef<HTMLElement | null>(null)
  const onMeasureNode = useCallback((el: HTMLElement | null): void => {
    measureElRef.current = el
  }, [])

  /** 块高只跟文档与样式有关；宽度一起存，窗口/栏宽变了旧表不再成立。 */
  const heightsRef = useRef<{ doc: unknown; width: number; heights: BlockHeight[] } | null>(null)
  /** 有一次「开量高度」在等结果。 */
  const pendingFillRef = useRef<number | null>(null)

  const pageTextHeight = useCallback((): number => {
    const el = document.querySelector('.wt-page')
    if (!(el instanceof HTMLElement)) return 0
    const cs = getComputedStyle(el)
    const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    // 用 min-height（纸张设计高度）而不是 clientHeight：纸会被内容撑高。
    const design = parseFloat(cs.minHeight)
    const inner = (Number.isFinite(design) && design > 0 ? design : el.clientHeight) - padding
    return Number.isFinite(inner) && inner > 0 ? inner : 0
  }, [])

  const textAreaWidth = useCallback((): number => {
    const el = document.querySelector('.wt-page__text')
    return el instanceof HTMLElement ? el.clientWidth : 0
  }, [])

  const applyFill = useCallback(
    (percent: number): void => {
      const eng = workEngine
      if (!eng) return
      const cached = heightsRef.current
      if (
        workIsMarkdown &&
        cached &&
        cached.doc === workNovel &&
        cached.width === textAreaWidth()
      ) {
        eng.revealTo(pickFillCut(cached.heights, (pageTextHeight() * percent) / 100))
        return
      }
      if (!workIsMarkdown) {
        eng.revealTo(fillCharsFor(percent, pageFontSize))
        return
      }
      pendingFillRef.current = percent
      setMeasuring(true)
    },
    [workEngine, workNovel, workIsMarkdown, pageFontSize, pageTextHeight, textAreaWidth]
  )

  const invalidateHeights = useCallback((): void => {
    heightsRef.current = null
  }, [])

  useEffect(() => {
    if (!measuring) return
    const el = measureElRef.current
    let heights: BlockHeight[] | null = null
    try {
      heights = measureBlocks(el)
    } catch (err) {
      console.warn('[wt] 量 markdown 块高失败，退回按字符数铺：', err)
    }
    const percent = pendingFillRef.current
    pendingFillRef.current = null
    if (heights && workIsMarkdown) {
      heightsRef.current = { doc: workNovel, width: textAreaWidth(), heights }
    }
    workEngine?.revealTo(
      heights
        ? pickFillCut(heights, (pageTextHeight() * (percent ?? 0)) / 100)
        : fillCharsFor(percent ?? 0, pageFontSize)
    )
    setMeasuring(false)
  }, [measuring, workIsMarkdown, workNovel, workEngine, pageFontSize, pageTextHeight, textAreaWidth])

  return { measuring, onMeasureNode, applyFill, invalidateHeights }
}
