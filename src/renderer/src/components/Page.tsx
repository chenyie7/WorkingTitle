import type { ReactNode } from 'react'
import type { Root } from 'mdast'
import { RENDER_WINDOW_LIMIT } from '../../../core/types'
import { defaultShortcutText } from '../state/shortcuts'
import { pickFoldStart, type BlockSpan } from '../markdown/fill'
import { MarkdownView } from '../markdown/MarkdownView'

/** 当前显示的是 md 工作文档时，`Page` 需要知道的全部东西。 */
export interface MarkdownSource {
  /** 整篇的语法树。解析一次、由 `App` 缓存（见 `markdown/parse.ts` 的说明） */
  doc: Root
  /** 引擎的 `revealStart` */
  revealStart: number
  /** 引擎的 `cursor` */
  cursor: number
  /** 为真时额外渲染一份隐藏的整篇副本，供量高度用。见 `MarkdownView` */
  measuring: boolean
  onMeasureNode?: (el: HTMLElement | null) => void
}

export interface PageProps {
  visibleText: string
  expanded: boolean
  onToggleExpand: () => void
  empty: boolean
  /**
   * 导入快捷键的**显示文本**（已按平台格式化）。空状态那句提示用它。
   *
   * 【为什么是可选带默认值】真值住在 `App` 里（只有它手里有按平台补齐过的快捷键表），
   * 把真值喂下来是它的事；在那之前不传也得显示成**该平台的默认值**——写死一句
   * 「Ctrl+O」正是这次要消灭的东西（见 `defaultShortcutText` 的说明）。
   */
  importShortcut?: string
  /**
   * 给了它就走 markdown 分支，**不看 `visibleText`**；不给就是今天那条纯文本路。
   *
   * 【为什么是一个对象而不是几个平铺的 prop】这些值同生同灭（都只在「当前显示的是
   * md 工作文档」时才有意义）。平铺成五个可选 prop 会出现「给了 doc 却没给 cursor」
   * 这类半截状态，而那种状态没法在类型上排除。
   */
  markdown?: MarkdownSource | null
  children?: ReactNode
}

export function Page({
  visibleText,
  expanded,
  onToggleExpand,
  empty,
  importShortcut = defaultShortcutText('import'),
  markdown = null,
  children
}: PageProps) {
  const md = markdown ?? null
  /** md 这一路的「长度」是字符数，与纯文本那一路同一个量纲。 */
  const shownLength = md ? md.cursor - md.revealStart : visibleText.length
  const folded = !expanded && shownLength > RENDER_WINDOW_LIMIT
  /**
   * 【md 的折叠为什么按块边界】按字符硬切会把一段话、一张表切成两半，屏幕上就是残缺的
   * 东西（设计第 12 节最后一行）。块的字符跨度从语法树上直接读得到，不需要布局信息，
   * 所以折叠这一步**不**去量高度——它吃的是 `BlockSpan`，与铺满吃的 `BlockHeight`
   * 不是一回事。
   */
  const spans: BlockSpan[] = md
    ? md.doc.children.map((n) => ({
        start: n.position?.start.offset ?? 0,
        end: n.position?.end.offset ?? 0
      }))
    : []
  const foldStart = md ? (folded ? pickFoldStart(spans, RENDER_WINDOW_LIMIT) : md.revealStart) : 0
  const foldedChars = md ? foldStart - md.revealStart : visibleText.length - RENDER_WINDOW_LIMIT
  const shown = !md && folded ? visibleText.slice(visibleText.length - RENDER_WINDOW_LIMIT) : visibleText

  return (
    <div className="wt-page" data-testid="page">
      {empty ? (
        <div className="wt-page__empty" data-testid="page-empty">
          {`文件 → 设置 → 导入小说，或按 ${importShortcut}`}
          <br />
          导入后在文档区打字，字会按比例从小说里取出来。
        </div>
      ) : (
        <>
          {folded && (
            <div
              className="wt-page__fold"
              data-testid="page-fold"
              onClick={onToggleExpand}
              role="button"
            >
              ……已折叠前文 {foldedChars} 字（点击展开全部）
            </div>
          )}
          <div className="wt-page__text" data-testid="page-text">
            {md ? (
              <MarkdownView
                doc={md.doc}
                foldStart={foldStart}
                cursor={md.cursor}
                measuring={md.measuring}
                onMeasureNode={md.onMeasureNode}
              />
            ) : (
              <>
                {shown}
                {/*
                  【这个光标只属于纯文本那条路】md 那条路的光标由 `MarkdownView`
                  里的 `renderMarkdown` 插进语法树（设计 3.5）——内容是块级元素的树，
                  追加在末尾只会落在最后一个块**下方**，而隐形输入框与输入法候选框
                  都按这个坐标摆。
                */}
                <span className="wt-caret" data-testid="caret" />
              </>
            )}
          </div>
        </>
      )}
      {children}
    </div>
  )
}
