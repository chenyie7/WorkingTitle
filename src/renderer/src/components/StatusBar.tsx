import type { InputMode, Novel } from '../../../core/types'

export interface StatusBarProps {
  novel: Novel | null
  revealedChars: number
  activeChapter: number
  ratio: number
  mode: InputMode
  /**
   * 为真时不渲染「比例 / 编码 / 输入模式」三格。
   *
   * 【名字刻意不叫 `bossMode`】`App` 里有一个**同名变量**，而 Task 8 之后两者会真的分叉：
   * 移除工作文档时 `workNovel` 置空、`bossMode` 仍为真，那时 `bossActive` 是假而 `bossMode`
   * 是真。这个名字读起来像「老板模式开着吗」，而它实际说的是「藏掉那三格吗」。
   *
   * 【为什么这三格要藏】「编码 UTF-8」与「输入模式 输入法」真 Word 的状态栏里根本没有。
   * 真 Word 确实有一个「显示比例」，但它是**缩放百分比**（`100%`），而这一格写的是 `1:10`
   * ——把「打 1 个字吐 N 个字」这套机制直接摆在了明面上。老板模式下它们对用户也没有任何用处。
   * 默认 false，既有调用方不必改动。
   */
  hideReadingCells?: boolean
}

/**
 * 底部状态栏。
 *
 * 【刻意【不】显示的三样东西，以及为什么】它们曾经都在这里，都是伪装上的破绽：
 *
 * 1. **「已显示 N / 全书 M 字」**——真 Word 的状态栏只报**全文字数**，从不报「已显示多少」。
 *    「已显示」这个词组本身就说明了有人在按进度往外吐字。
 * 2. **「用时 HH:MM:SS」**——真 Word 没有阅读计时器。它同时是 App 里那个每秒一次
 *    `setInterval` 的唯一用途，去掉之后那一层重渲染也一并没了。
 * 3. **「第 N 章 / 共 M 章」**——改写成 `N / M`（见下）。
 *
 * 【章节位置为什么写成 `2 / 1382`】真 Word 状态栏左下角就是页码，形如「第 1 页，共 3 页」
 * 或简写成 `1 / 3`。写成 `2 / 1382` 反而**比中文全称更像 Word**，同时把「章」这个字
 * （小说阅读器最直接的标志）去掉了。配色再压低一档，不让它抢眼。
 */
export function StatusBar({
  novel,
  revealedChars,
  activeChapter,
  ratio,
  mode,
  hideReadingCells = false
}: StatusBarProps) {
  const totalChars = novel?.flatText.length ?? 0
  const totalChapters = novel?.chapters.length ?? 0
  const percent = totalChars === 0 ? 0 : Math.floor((revealedChars / totalChars) * 100)

  return (
    <div className="wt-statusbar" data-testid="statusbar">
      <span className="wt-statusbar__dim" data-testid="status-chapter">
        {novel ? `${activeChapter + 1} / ${totalChapters}` : '—'}
      </span>
      {!hideReadingCells && (
        <>
          <span data-testid="status-ratio">比例 1:{ratio}</span>
          <span data-testid="status-encoding">编码 {novel?.encoding ?? '—'}</span>
          <span data-testid="status-mode">输入模式 {mode === 'ime' ? '输入法' : '纯按键'}</span>
        </>
      )}
      <span className="wt-statusbar__spacer" />
      <span data-testid="status-percent">{percent}%</span>
      <span>中文(中国)</span>
    </div>
  )
}
