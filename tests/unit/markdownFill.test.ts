import { describe, it, expect } from 'vitest'
import { pickFillCut, pickFoldStart } from '../../src/renderer/src/markdown/fill'

/** 三个块，高度分别是 400 / 300 / 300，结束偏移 100 / 200 / 300。 */
const THREE = [
  { end: 100, height: 400 },
  { end: 200, height: 300 },
  { end: 300, height: 300 }
]

describe('pickFillCut', () => {
  it('装得下几个就铺几个，切点落在块边界上', () => {
    // 700 这一条就是「恰好等于时算装得下」那条边界：400 + 300 正好 700，
    // 改成 `>=` 会在这里断掉（返回 100 而不是 200）
    expect(pickFillCut(THREE, 700)).toBe(200)
    expect(pickFillCut(THREE, 699)).toBe(100)
    expect(pickFillCut(THREE, 1000)).toBe(300)
  })

  it('目标高度为 0 或负数：一个字都不铺', () => {
    // 铺满 0% 是一个合法设置（老板键那个旋钮能调到 0），此时就该是空白——
    // 绝不能因为「一个块都没装下」而触发下面那条兜底
    expect(pickFillCut(THREE, 0)).toBe(0)
    expect(pickFillCut(THREE, -10)).toBe(0)
  })

  it('第一个块就超过一页：铺满那一个块', () => {
    // 宁可溢出一页，也不能铺出一张白纸。
    // 目标高度是 0.5 这种「大于 0 却一个块都装不下」的也算这一条——
    // 只有 <= 0 才走「一个字都不铺」那条。
    expect(pickFillCut(THREE, 100)).toBe(100)
    expect(pickFillCut(THREE, 0.5)).toBe(100)
    expect(pickFillCut([{ end: 999, height: 5000 }], 912)).toBe(999)
  })

  it('空文档返回 0', () => {
    expect(pickFillCut([], 912)).toBe(0)
  })

  it('高度为 0 的块照常算装得下（分隔线这类）', () => {
    expect(pickFillCut([{ end: 10, height: 0 }, { end: 20, height: 900 }], 912)).toBe(20)
  })
})

describe('pickFoldStart', () => {
  const SPANS = [
    { start: 0, end: 100 },
    { start: 100, end: 200 },
    { start: 200, end: 400 }
  ]

  it('从末尾往前累加字符数，返回最早那个要保留的块的起始偏移', () => {
    expect(pickFoldStart(SPANS, 200)).toBe(200) // 最后一块正好 200 字
    expect(pickFoldStart(SPANS, 201)).toBe(100) // 再加一块
    expect(pickFoldStart(SPANS, 100)).toBe(200) // 最后一块就超了，只留它
  })

  it('全篇都不够上限：一个字都不折', () => {
    expect(pickFoldStart(SPANS, 99999)).toBe(0)
  })

  it('空文档返回 0', () => {
    expect(pickFoldStart([], 30000)).toBe(0)
  })
})
