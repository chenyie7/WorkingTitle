import { describe, it, expect } from 'vitest'
import { measureBlocks } from '../../src/renderer/src/markdown/measure'

/**
 * 【怎么在 jsdom 里造出非零高度】jsdom 没有布局，`offsetHeight` 恒为 0。
 * 但它是可写的，`Object.defineProperty` 能给某个元素钉一个假高度——
 * 这样「映射逻辑」就能单测，只有「浏览器真的这么算」那一半留给真机。
 */
function box(height: number): HTMLElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true })
  return el
}

function container(...heights: number[]): HTMLElement {
  const c = document.createElement('div')
  for (const h of heights) c.appendChild(box(h))
  return c
}

describe('measureBlocks', () => {
  it('把每个直接子元素的高度与对应的结束偏移配起来', () => {
    expect(measureBlocks(container(400, 300, 300), [100, 200, 300])).toEqual([
      { end: 100, height: 400 },
      { end: 200, height: 300 },
      { end: 300, height: 300 }
    ])
  })

  it('元素一个都没有：返回 null，不是空数组', () => {
    // 空数组会被上层当成「量到了，只是没有块」，于是切点变成 0、屏幕全白
    expect(measureBlocks(container(), [])).toBeNull()
    expect(measureBlocks(null, [100])).toBeNull()
  })

  it('高度全是 0：这是 jsdom 的常态，返回 null 让上层走兜底', () => {
    expect(measureBlocks(container(0, 0), [100, 200])).toBeNull()
  })

  it('元素个数与结束偏移个数对不上：返回 null', () => {
    // 对不上说明树与 DOM 不同步了，此时硬凑出来的切点是错的，不如退回去按字符数铺
    expect(measureBlocks(container(400, 300), [100])).toBeNull()
  })

  it('只要有一个块真的量到了高度，就算量到了', () => {
    expect(measureBlocks(container(0, 300), [100, 200])).toEqual([
      { end: 100, height: 0 },
      { end: 200, height: 300 }
    ])
  })
})
