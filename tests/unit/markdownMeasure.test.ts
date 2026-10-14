import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { measureBlocks, BLOCK_END_ATTR } from '../../src/renderer/src/markdown/measure'
import { renderMarkdown } from '../../src/renderer/src/markdown/toReact'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'

/**
 * 【怎么在 jsdom 里造出布局】jsdom 没有布局，`offsetTop` / `offsetHeight` 恒为 0。
 * 但它们是可写的，`Object.defineProperty` 能给某个元素钉一个假值——
 * 这样「映射逻辑」就能单测，只有「浏览器真的这么算」那一半留给真机。
 */
function block(end: string | null, top: number, height = 0): HTMLElement {
  const el = document.createElement('div')
  if (end !== null) el.setAttribute(BLOCK_END_ATTR, end)
  Object.defineProperty(el, 'offsetTop', { value: top, configurable: true })
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true })
  return el
}

function container(...els: HTMLElement[]): HTMLElement {
  const c = document.createElement('div')
  for (const el of els) c.appendChild(el)
  return c
}

describe('measureBlocks', () => {
  it('把每个块的结束偏移与高度配起来，高度取「下一个块的 offsetTop − 这个块的 offsetTop」', () => {
    // 末块后面没有下一个块，用它自己的 offsetHeight。若改成一律用 offsetHeight，
    // 前两块量出来会是 0 而不是 400 / 300 —— 中间那段外边距就丢了
    expect(measureBlocks(container(block('100', 0), block('200', 400), block('300', 700, 300)))).toEqual([
      { end: 100, height: 400 },
      { end: 200, height: 300 },
      { end: 300, height: 300 }
    ])
  })

  it('元素一个都没有：返回 null，不是空数组', () => {
    // 空数组会被上层当成「量到了，只是没有块」，于是切点变成 0、屏幕全白
    expect(measureBlocks(container())).toBeNull()
    expect(measureBlocks(null)).toBeNull()
  })

  it('高度全是 0：这是 jsdom 的常态，返回 null 让上层走兜底', () => {
    expect(measureBlocks(container(block('100', 0), block('200', 0)))).toBeNull()
  })

  it('读不到 data-block-end：返回 null', () => {
    // 读不到说明这一份不是在渲染时套出来的，硬凑的偏移是错的
    expect(measureBlocks(container(block(null, 0), block('200', 400)))).toBeNull()
    expect(measureBlocks(container(block('100', 0), block(null, 400)))).toBeNull()
  })

  it('偏移不是有限数：返回 null（空串也算——Number("") 是 0，不显式挡就会被当成偏移 0 收下）', () => {
    expect(measureBlocks(container(block('abc', 0), block('200', 400)))).toBeNull()
    expect(measureBlocks(container(block('', 0), block('200', 400)))).toBeNull()
  })

  it('只要有一个块真的量到了高度，就算量到了', () => {
    expect(measureBlocks(container(block('100', 0), block('200', 0, 300)))).toEqual([
      { end: 100, height: 0 },
      { end: 200, height: 300 }
    ])
  })
})

describe('量高度那一份的块数', () => {
  it('witness：含 definition 与 HTML 注释的文档，包装个数仍等于顶层节点数', () => {
    const md = '前一段。\n\n[a]: https://example.com\n\n<!-- 注释 -->\n\n后一段。\n'
    const doc = parseMarkdown(md)
    expect(doc).not.toBeNull()
    // 前提自检：这份文档确实含有那两个「渲染不出 Element」的类型，否则这条用例是空转
    expect(doc!.children.map((n) => n.type)).toEqual(['paragraph', 'definition', 'html', 'paragraph'])

    // 反面对照：可见那一份（不套包装）的直接子元素**比顶层节点少**——`definition` 渲染成
    // null、注释那段只剩文本子节点，而 `children` 只数 Element。这正是「偏移另算一份」
    // 会踩的坑：measureBlocks 判「对不上」，整篇静默退回按字符数铺
    const visible = render(createElement('div', null, renderMarkdown(doc!))).container
      .firstElementChild as HTMLElement
    expect(visible.children.length).toBeLessThan(doc!.children.length)

    const { container } = render(
      createElement('div', { className: 'wt-md-measure' }, renderMarkdown(doc!, { withBlockEnds: true }))
    )
    const el = container.querySelector('.wt-md-measure') as HTMLElement
    expect(el).not.toBeNull()
    expect(el.children).toHaveLength(doc!.children.length)

    // 每个包装自己带着偏移，正好是那个节点的结束偏移；顺带钉上假布局（definition 那个块
    // 渲染成空 div，所以它高度为 0，其余三块各 100）
    const ends = doc!.children.map((n) => n.position?.end.offset ?? '')
    const tops = [0, 100, 100, 200]
    Array.from(el.children).forEach((c, i) => {
      expect(c.getAttribute(BLOCK_END_ATTR)).toBe(String(ends[i]))
      Object.defineProperty(c, 'offsetTop', { value: tops[i], configurable: true })
      Object.defineProperty(c, 'offsetHeight', { value: 100, configurable: true })
    })

    // 四条都读得回来——包括渲染成空的 definition 那条（高度 0，但它在表里，不是被丢掉
    // 一个 → 对不上 → null）
    expect(measureBlocks(el)).toEqual([
      { end: ends[0], height: 100 },
      { end: ends[1], height: 0 },
      { end: ends[2], height: 100 },
      { end: ends[3], height: 100 }
    ])
  })

  it('不带 withBlockEnds 时输出不变：可见那一份一个包装都不加', () => {
    const doc = parseMarkdown('## 标题\n\n段落\n')
    const holder = render(createElement('div', null, renderMarkdown(doc!))).container
      .firstElementChild as HTMLElement
    expect(holder.querySelector('.wt-md-measure-block')).toBeNull()
    expect(holder.children).toHaveLength(2)
    expect(holder.children[0].tagName).toBe('H2')
    expect(holder.children[1].tagName).toBe('P')
  })
})
