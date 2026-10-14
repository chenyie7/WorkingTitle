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
 */
export function MarkdownView({
  doc,
  foldStart,
  cursor,
  measuring,
  onMeasureNode
}: MarkdownViewProps): ReactNode {
  const visible = useMemo(() => clipTree(doc, foldStart, cursor), [doc, foldStart, cursor])
  return (
    <>
      {renderMarkdown(visible)}
      {measuring && (
        <div className="wt-md-measure" ref={onMeasureNode} aria-hidden="true">
          {/*
            【`withBlockEnds` 是这一份副本独有的】它给每个顶层块套一层带
            `data-block-end` 的包装。这样「有几个块」就只由渲染这一处决定——
            渲染出 null 的节点（`definition`，即 `[a]: url` 那种链接引用定义，
            真 md 里很常见）照样有一个包装、高度 0。少了这一层，「DOM 子元素个数」
            与「外部数组长度」是两处各自决定的，永远能对不上，而对不上的后果是
            **整篇静默退回按字符数铺**：不报错、不白屏，只有真机上铺不满才看得出来。
          */}
          {renderMarkdown(doc, { withBlockEnds: true })}
        </div>
      )}
    </>
  )
}
