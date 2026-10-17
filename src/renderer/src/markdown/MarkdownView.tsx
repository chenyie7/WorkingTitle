import { useMemo, type ReactNode } from 'react'
import type { Root } from 'mdast'
import { clipTree } from './clip'
import { renderMarkdown } from './toReact'

export interface MarkdownViewProps {
  /** 整篇的语法树（解析一次，由上层缓存） */
  doc: Root
  /** 折叠起点：`revealStart` 或折点。它以下的内容不显示 */
  foldStart: number
  /** 阅读光标 */
  cursor: number
  /**
   * 为真时**额外**渲染一份整篇的隐藏副本，供量高度用。
   *
   * 【为什么不做成常开】那份副本是整篇文档的 DOM，而且每次按键都会重建。
   * 它只在「算铺满切点」那一下需要（进老板模式、按 ⌘⇧↑/↓），
   * 所以由上层开一下、量完就关。
   */
  measuring: boolean
  /** 隐藏副本挂载后把它交给上层——上层要拿它的直接子元素去量高度 */
  onMeasureNode?: (el: HTMLElement | null) => void
}

/**
 * 阅读区里那一段 markdown。
 *
 * 【它自己不做任何「该不该显示」的判断】裁剪全部在 `clipTree` 里（那份模块的注释
 * 是这条口径的正本）。这里只负责把裁剪后的树画出来，外加那份隐藏的整篇副本。
 *
 * 【隐藏副本为什么排在可见内容之后】它在 CSS 上是绝对定位、不参与流，位置在哪都不影响
 * 布局；但 `markdown.css` 有一条 `.wt-page__text > :first-child { margin-top: 0 }`，
 * 那条规则是给**第一个内容块**写的。副本排在前面就会把它顶掉。
 *
 * 【阅读光标由 `renderMarkdown` 插进树里，`Page` 不再追加】光标画在「揭示到哪」那个字
 * 后面，而不是内容的末尾（设计 3.5）：这条路的内容是块级元素的树，追加在末尾的 span
 * 只落得到最后一个块**下方**，而隐形输入框与输入法候选框都按这个坐标摆。
 */
export function MarkdownView({
  doc,
  foldStart,
  cursor,
  measuring,
  onMeasureNode
}: MarkdownViewProps): ReactNode {
  // 折点不得越过光标：越过时窗口是空的，页面只剩折叠条。
  const visible = useMemo(
    () => clipTree(doc, Math.min(foldStart, cursor), cursor),
    [doc, foldStart, cursor]
  )
  return (
    <>
      {/*
        【`caretAt` 只给可见那一份】它是「揭示到哪个偏移」，光标据此插进树里
        （设计 3.5）。下面那份整篇副本永远不传——它只是拿来量高度的，多一个光标
        不但没用，还会让 `[data-testid="caret"]` 在文档里出现两次，
        而 `InputCapture` 取的是**第一个**。
      */}
      {renderMarkdown(visible, { caretAt: cursor })}
      {measuring && (
        <div className="wt-md-measure" ref={onMeasureNode} aria-hidden="true">
          {/*
            【layoutOnly】量高度不挂真实图片：一挂就触发取图 IPC，未揭示的图也会被提前请求
            （设计 8.2）。【withBlockEnds】每个顶层块一个带 `data-block-end` 的包装，
            「有几个块」只由渲染这一处决定，`measureBlocks` 的 offsetTop 差分才成立。
          */}
          {renderMarkdown(doc, { withBlockEnds: true, layoutOnly: true })}
        </div>
      )}
    </>
  )
}
