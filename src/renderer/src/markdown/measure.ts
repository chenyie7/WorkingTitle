import type { BlockHeight } from './fill'

/**
 * 从一个装着「整篇文档」的隐藏容器里，量出每个顶层块的高度。
 *
 * 【为什么返回 `BlockHeight[] | null` 而不是空数组】`null` 的语义是**量不出来**，
 * 与「量到了，只是没有块」是两件事。上层拿到 null 要退回按字符数铺（设计第 7 节
 * 兜底 2），拿到空数组则会算出切点 0、铺出一张白纸。jsdom 里 `offsetHeight` 恒为 0，
 * 所以这条路径在单测里是**常态**而不是异常——`tests/` 跑的就是 jsdom。
 *
 * 【为什么要求个数一一对应】容器的直接子元素就是渲染出来的顶层块，顺序与
 * `ends` 一致。对不上说明 DOM 与语法树不同步（渲染出错、或者有人往容器里塞了别的东西），
 * 此时硬凑出来的偏移是错的，宁可退回兜底路径。
 *
 * 【为什么是「全是 0 才算量不出来」而不是「有一个是 0 就算」】高度真的可以为 0
 * （分隔线、空段落）。判据取严的那一侧：只要有一个块量到了非零高度，就说明这台
 * 环境是有布局的，那就照实返回。
 */
export function measureBlocks(
  container: HTMLElement | null,
  ends: readonly number[]
): BlockHeight[] | null {
  if (!container) return null
  const kids = Array.from(container.children) as HTMLElement[]
  if (kids.length === 0 || kids.length !== ends.length) return null
  const heights = kids.map((el) => el.offsetHeight)
  if (heights.every((h) => h === 0)) return null
  return heights.map((height, i) => ({ end: ends[i], height }))
}
