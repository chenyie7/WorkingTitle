/**
 * 铺满切点与折叠切点。**两个纯函数，没有 DOM、没有副作用。**
 *
 * 量高度只有 DOM 里有：这里吃的是已经量好的高度表 / 语法树上现成的字符跨度，
 * 所以能单测；量不出来时调用方退回按字符数铺（`bossKey.ts` 那套）。
 */

/** 一个顶层块的结束偏移与它的渲染高度。 */
export interface BlockHeight {
  /** 这个块在 `flatText` 里的结束偏移 */
  readonly end: number
  /** 它的渲染高度（px） */
  readonly height: number
}

/** 一个顶层块的字符跨度。折叠时只关心字符数，不关心高度。 */
export interface BlockSpan {
  readonly start: number
  readonly end: number
}

/**
 * 选铺满切点：从前往后累加块高，装得下就继续，返回**最后一个装得下的块的结束偏移**。
 *
 * 【0 高的块不算装下】`definition` / 空段落这类块量出来是 0 高，装得下也画不出东西；
 * 前导全是 0 高块时按「第一个块超高」兜底，铺满第一个**有高度**的块，否则是一张白纸。
 * 【`targetHeight <= 0` 返回 0】铺满 0% 是合法设置，那时就该空白。
 */
export function pickFillCut(blocks: readonly BlockHeight[], targetHeight: number): number {
  if (targetHeight <= 0 || blocks.length === 0) return 0
  let acc = 0
  let cut = 0
  let fitted = false
  let firstVisibleEnd = 0
  let sawVisible = false
  for (const block of blocks) {
    if (block.height > 0) {
      if (!sawVisible) {
        sawVisible = true
        firstVisibleEnd = block.end
      }
      if (acc + block.height > targetHeight) break
      acc += block.height
      fitted = true
    }
    cut = block.end
  }
  if (fitted) return cut
  return sawVisible ? firstVisibleEnd : cut
}

/**
 * 选折叠切点：从**光标往前**累加各块的已揭示字符数，到 `limit` 为止，返回那个块的起始偏移。
 *
 * 【只数光标之前的块】光标之后的块还没上屏，把它们算进窗口会让折点越过光标、页面只剩折叠条。
 * 返回前再夹到 `cursor`，是给「块起点算错」留的最后一道闸。
 * 【为什么按字符数】折叠发生在渲染之前，那时没有布局信息，也不该为了折叠去量一次高度。
 */
export function pickFoldStart(blocks: readonly BlockSpan[], limit: number, cursor: number): number {
  if (blocks.length === 0) return 0
  let acc = 0
  let start = cursor
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block.start >= cursor) continue
    start = block.start
    acc += Math.min(block.end, cursor) - block.start
    if (acc >= limit) break
  }
  return Math.min(start, cursor)
}
