import { describe, it, expect } from 'vitest'
import {
  BOSS_FILL_MAX,
  BOSS_FILL_MIN,
  BOSS_FILL_STEP,
  CHARS_PER_SHEET,
  clampBossFillPercent,
  fillCharsFor,
  stepBossFill
} from '../../src/core/bossKey'

describe('clampBossFillPercent', () => {
  it('夹紧到 0..100 并取整', () => {
    expect(clampBossFillPercent(-1)).toBe(BOSS_FILL_MIN)
    expect(clampBossFillPercent(0)).toBe(0)
    expect(clampBossFillPercent(45.6)).toBe(46)
    expect(clampBossFillPercent(100)).toBe(BOSS_FILL_MAX)
    expect(clampBossFillPercent(1000)).toBe(BOSS_FILL_MAX)
  })

  it('非有限值落到满屏，而不是 0', () => {
    // 【为什么是 100 而不是 0】NaN 来自「设置文件被改坏 / 字段缺失」。
    // 落到 0 的话老板键切过去是一片空白——那正是这个功能要避免的画面。
    expect(clampBossFillPercent(Number.NaN)).toBe(BOSS_FILL_MAX)
    expect(clampBossFillPercent(Number.POSITIVE_INFINITY)).toBe(BOSS_FILL_MAX)
  })
})

describe('stepBossFill', () => {
  it('按 BOSS_FILL_STEP 步进', () => {
    expect(stepBossFill(40, 1)).toBe(50)
    expect(stepBossFill(40, -1)).toBe(30)
  })

  it('两端夹住，不循环', () => {
    // 「按到头再按就跳回另一端」会让用户以为自己按错了键
    expect(stepBossFill(BOSS_FILL_MAX, 1)).toBe(BOSS_FILL_MAX)
    expect(stepBossFill(BOSS_FILL_MIN, -1)).toBe(BOSS_FILL_MIN)
    expect(stepBossFill(95, 1)).toBe(BOSS_FILL_MAX)
    expect(stepBossFill(5, -1)).toBe(BOSS_FILL_MIN)
  })

  it('步进量就是常量本身', () => {
    expect(stepBossFill(0, 1)).toBe(BOSS_FILL_STEP)
  })
})

describe('fillCharsFor', () => {
  it('100% 是一屏，50% 是一半', () => {
    expect(fillCharsFor(100)).toBe(CHARS_PER_SHEET)
    expect(fillCharsFor(50)).toBe(Math.round(CHARS_PER_SHEET / 2))
  })

  it('0% 是 0 字——「不铺」是一个合法档位', () => {
    expect(fillCharsFor(0)).toBe(0)
  })

  it('同样按 clamp 之后的值算', () => {
    expect(fillCharsFor(1000)).toBe(fillCharsFor(100))
    expect(fillCharsFor(Number.NaN)).toBe(fillCharsFor(BOSS_FILL_MAX))
  })
})
