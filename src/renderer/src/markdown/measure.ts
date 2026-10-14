import type { BlockHeight } from './fill'

/**
 * 每个顶层块在「量高度用的那一份隐藏副本」里带的结束偏移属性。
 *
 * 【为什么偏移写在 DOM 上，而不是另外算一份数组传进来】「有几个块」如果由两处各自决定，
 * 就永远能对不上——而这里的判据是「对不上就整篇退回按字符数铺」，于是对不上是**静默**的。
 * 实测能触发它的两种节点：
 * - `definition`（`[a]: https://example.com`，真 md 里很常见）走 `renderMarkdown` 的
 *   `default` 分支渲染成 `null`，**零个 Element**；
 * - 只含注释 / `<script>` 的 HTML 块，`tokenizeHtml` 白名单过滤之后产物只剩文本子节点，
 *   而 `container.children` **只数 Element、不数文本**。
 *
 * 两种都让 DOM 的直接子元素比「块」少一个。现在每个顶层块由
 * `renderMarkdown(root, { withBlockEnds: true })` 套一层带偏移的包装，一一对应由构造保证。
 * **渲染与测量共用这一个常量，改名要同步 `toReact.tsx`。**
 */
export const BLOCK_END_ATTR = 'data-block-end'

/**
 * 从一个装着「整篇文档」的隐藏容器里，量出每个顶层块的高度。
 *
 * 【为什么返回 `BlockHeight[] | null` 而不是空数组】`null` 的语义是**量不出来**，
 * 与「量到了，只是没有块」是两件事。上层拿到 null 要退回按字符数铺（设计第 7 节
 * 兜底 2），拿到空数组则会算出切点 0、铺出一张白纸。jsdom 里 `offsetHeight` 恒为 0，
 * 所以这条路径在单测里是**常态**而不是异常——`tests/` 跑的就是 jsdom。
 *
 * 【高度为什么取「下一个块的 offsetTop − 这个块的 offsetTop」，而不是 `offsetHeight`】
 * 相邻块之间的**外边距是折叠到包装元素之外的**，`offsetHeight` 量不到那一段。按
 * `offsetHeight` 累加，一页几十个块会少算几百像素——铺满就成了永远铺不满。末块后面
 * 没有下一个块，用它自己的 `offsetHeight`。
 * （前提是所有块共享同一个 `offsetParent`：`.wt-md-measure` 是 `position: absolute`，
 * 静态子元素的 offsetParent 就是它。换掉那条样式会让这里量出垃圾。）
 *
 * 【为什么要求每个块都读得到偏移】读不到说明这一份不是渲染时套出来的（有人往容器里
 * 塞了别的东西，或者包装被去掉了）。此时硬凑出来的偏移是错的，宁可退回兜底路径。
 *
 * 【为什么是「全是 0 才算量不出来」而不是「有一个是 0 就算」】高度真的可以为 0
 * （分隔线、空段落、`[a]: url` 那种渲染成空的块）。判据取严的那一侧：只要有一个块
 * 量到了非零高度，就说明这台环境是有布局的，那就照实返回。
 */
export function measureBlocks(container: HTMLElement | null): BlockHeight[] | null {
  if (!container) return null
  const kids = Array.from(container.children) as HTMLElement[]
  if (kids.length === 0) return null

  const ends: number[] = []
  for (const el of kids) {
    const raw = el.getAttribute(BLOCK_END_ATTR)
    // 空串要单独挡：`Number('')` 是 0，只判 `Number.isFinite` 会把「没写偏移」当成偏移 0 收下
    if (raw === null || raw.trim() === '') return null
    const end = Number(raw)
    if (!Number.isFinite(end)) return null
    ends.push(end)
  }

  const heights = kids.map((el, i) =>
    i + 1 < kids.length ? kids[i + 1].offsetTop - el.offsetTop : el.offsetHeight
  )
  if (heights.every((h) => h === 0)) return null

  return heights.map((height, i) => ({ end: ends[i], height }))
}
