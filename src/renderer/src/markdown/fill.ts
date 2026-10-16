/**
 * 铺满切点与折叠切点。**两个纯函数，没有 DOM、没有副作用。**
 *
 * 【为什么切点要停在块边界】铺满一页时如果切在半句话、半张表、半个引用块上，
 * 屏幕底部就是残缺的东西——而这正是老板键要避免的「看起来不对」。切在块边界上，
 * 屏幕上永远是一整块一整块的（设计第 7 节）。
 *
 * 【为什么不在这里量高度】量高度要真实布局，只有 DOM 里有。这里吃的是**已经量好的
 * 高度表**，所以它是纯的、能单测；量不出来时调用方退回按字符数（见 Task 11）。
 * 这条分界是本功能唯一一处「jsdom 判不了」的地方，拆开就是为了让它别变成零覆盖。
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
 * 选铺满切点：从前往后累加块高，装得下就继续，装不下就停，返回**最后一个装得下的块的
 * 结束偏移**。调用方把它喂给 `engine.revealTo()`。
 *
 * 两条边界都是有意的：
 * - `targetHeight <= 0` 返回 0。铺满 0% 是合法设置，那时就该是空白。
 * - **一个块都装不下时铺满第一个块**。第一个块就超过一页（比如开头就是一张大表），
 *   返回 0 会让画面全白——宁可溢出一页。
 */
export function pickFillCut(blocks: readonly BlockHeight[], targetHeight: number): number {
  if (targetHeight <= 0 || blocks.length === 0) return 0
  let acc = 0
  let cut = 0
  let fitted = false
  for (const b of blocks) {
    if (acc + b.height > targetHeight) break
    acc += b.height
    cut = b.end
    fitted = true
  }
  return fitted ? cut : blocks[0].end
}

/**
 * 选折叠切点：从末尾往前累加各块的**字符数**，到 `limit` 为止，返回那个块的起始偏移。
 * 这个偏移之下（含）的块都是「前文」，折叠起来。
 *
 * 【为什么按字符数而不是按高度】折叠发生在渲染之前，那时没有布局信息，也不该为了折叠
 * 去量一次高度。字符数是现成的。所以这里**不复用 `pickFillCut`**——两个函数吃的
 * 根本不是同一种输入。
 */
export function pickFoldStart(blocks: readonly BlockSpan[], limit: number): number {
  if (blocks.length === 0) return 0
  let acc = 0
  let start = blocks[blocks.length - 1].start
  for (let i = blocks.length - 1; i >= 0; i--) {
    start = blocks[i].start
    acc += blocks[i].end - blocks[i].start
    if (acc >= limit) break
  }
  return start
}
