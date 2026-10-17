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
    // 700 这一条是「恰好等于时算装得下」那条边界：400 + 300 正好 700
    expect(pickFillCut(THREE, 700)).toBe(200)
    expect(pickFillCut(THREE, 699)).toBe(100)
    expect(pickFillCut(THREE, 1000)).toBe(300)
  })

  it('目标高度为 0 或负数：一个字都不铺', () => {
    // 铺满 0% 是合法设置，此时就该空白，不能因「一个块都没装下」触发兜底
    expect(pickFillCut(THREE, 0)).toBe(0)
    expect(pickFillCut(THREE, -10)).toBe(0)
  })

  it('第一个块就超过一页：铺满那一个块', () => {
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

  it('前导 0 高块不占名额：切点铺满第一个**有高度**的块，而不是铺出一张白纸', () => {
    // 文档以 `[a]: url`（量出来 0 高）开头时，0 + 0 不大于目标，旧判据会认为「装下了」，
    // 切点落在那个渲染成空的块上——页面上一个字都没有。
    const blocks = [
      { end: 20, height: 0 },
      { end: 120, height: 500 }
    ]
    expect(pickFillCut(blocks, 300)).toBe(120)
  })

  it('前导 0 高块之后的第一个可见块装得下时：切点照常往前走', () => {
    const blocks = [
      { end: 20, height: 0 },
      { end: 120, height: 100 },
      { end: 220, height: 100 }
    ]
    expect(pickFillCut(blocks, 150)).toBe(120)
    expect(pickFillCut(blocks, 250)).toBe(220)
  })
})

describe('pickFoldStart', () => {
  const SPANS = [
    { start: 0, end: 100 },
    { start: 100, end: 200 },
    { start: 200, end: 400 }
  ]

  it('从末尾往前累加字符数，返回最早那个要保留的块的起始偏移', () => {
    expect(pickFoldStart(SPANS, 200, 400)).toBe(200) // 最后一块正好 200 字
    expect(pickFoldStart(SPANS, 201, 400)).toBe(100) // 再加一块
    expect(pickFoldStart(SPANS, 100, 400)).toBe(200) // 最后一块就超了，只留它
  })

  it('全篇都不够上限：一个字都不折', () => {
    expect(pickFoldStart(SPANS, 99999, 400)).toBe(0)
  })

  it('空文档返回 0', () => {
    expect(pickFoldStart([], 30000, 400)).toBe(0)
  })

  it('光标在中段、后面还有长尾：折点不得超过光标，也不许把光标之前的块全折掉', () => {
    // 光标在 40005（第一段里），后面一整段 40010..80010 还没揭示。从**文档末尾**累加时
    // 长尾自己就超过 30000，折点落到 40010——比光标还靠后，窗口 [40010, 40005) 是空的。
    const spans = [
      { start: 0, end: 8 },
      { start: 8, end: 40010 },
      { start: 40010, end: 80010 }
    ]
    const start = pickFoldStart(spans, 30000, 40005)
    expect(start).toBe(8)
    expect(start).toBeLessThanOrEqual(40005)
  })

  it('光标之前的已揭示内容不够上限：夹到光标，绝不越过', () => {
    // 只揭示了 100 字（但调用方判定要折叠——这里只钉纯函数的上界）
    expect(pickFoldStart(SPANS, 99999, 150)).toBe(0)
    // 折点算出来比光标大时夹回光标
    expect(pickFoldStart([{ start: 300, end: 400 }], 1, 150)).toBe(150)
  })
})
