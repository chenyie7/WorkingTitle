import type { ReactNode } from 'react'
import { RENDER_WINDOW_LIMIT } from '../../../core/types'
import { defaultShortcutText } from '../state/shortcuts'

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
  children?: ReactNode
}

export function Page({
  visibleText,
  expanded,
  onToggleExpand,
  empty,
  importShortcut = defaultShortcutText('import'),
  children
}: PageProps) {
  const folded = !expanded && visibleText.length > RENDER_WINDOW_LIMIT
  const shown = folded ? visibleText.slice(visibleText.length - RENDER_WINDOW_LIMIT) : visibleText

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
              ……已折叠前文 {visibleText.length - RENDER_WINDOW_LIMIT} 字（点击展开全部）
            </div>
          )}
          <div className="wt-page__text" data-testid="page-text">
            {shown}
            <span className="wt-caret" data-testid="caret" />
          </div>
        </>
      )}
      {children}
    </div>
  )
}
