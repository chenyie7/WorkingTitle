import { describe, it, expect } from 'vitest'
import {
  BOSS_FILL_MAX,
  BOSS_FILL_MIN,
  BOSS_FILL_STEP,
  CHARS_PER_SHEET,
  charsPerSheet,
  clampBossFillPercent,
  fillCharsFor,
  stepBossFill
} from '../../src/core/bossKey'
import {
  PAGE_FONT_SIZE_DEFAULT,
  PAGE_FONT_SIZE_MAX,
  PAGE_FONT_SIZE_MIN,
  clampPageFontSize
} from '../../src/core/types'

describe('clampBossFillPercent', () => {
  it('夹紧到 0..100 并取整', () => {
    expect(clampBossFillPercent(-1)).toBe(BOSS_FILL_MIN)
    expect(clampBossFillPercent(0)).toBe(0)
    expect(clampBossFillPercent(45.6)).toBe(46)
    expect(clampBossFillPercent(100)).toBe(BOSS_FILL_MAX)
    expect(clampBossFillPercent(1000)).toBe(BOSS_FILL_MAX)
  })

  it('非有限值落到满页，而不是 0', () => {
    // 【为什么是 100 而不是 0】NaN 来自「设置文件被改坏 / 字段缺失」。
    // 落到 0 的话老板键切过去是一片空白——那正是这个功能要避免的画面。
    expect(clampBossFillPercent(Number.NaN)).toBe(BOSS_FILL_MAX)
    expect(clampBossFillPercent(Number.POSITIVE_INFINITY)).toBe(BOSS_FILL_MAX)
    expect(clampBossFillPercent(Number.NEGATIVE_INFINITY)).toBe(BOSS_FILL_MAX)
  })

  it('常量本身被钉住', () => {
    // 【为什么需要这一条】其余断言全是相对量：把 CHARS_PER_SHEET 改成 7，整套用例照样全过
    // （变异实测）。而它是个对着 page.css 算出来的经验常量，改它必须是件有意识的事
    // ——`engine.ts` 钉 10 / 500 用的也是这个写法。
    expect(CHARS_PER_SHEET).toBe(1330)
  })
})

describe('stepBossFill', () => {
  it('按 BOSS_FILL_STEP 步进', () => {
    expect(stepBossFill(40, 1)).toBe(50)
    expect(stepBossFill(40, -1)).toBe(30)
    expect(stepBossFill(45, 1)).toBe(55)
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
  it('100% 是一页，50% 是半页', () => {
    expect(fillCharsFor(100)).toBe(CHARS_PER_SHEET)
    expect(fillCharsFor(50)).toBe(Math.round(CHARS_PER_SHEET / 2))
  })

  it('0% 是 0 字——「不铺」是一个合法档位', () => {
    expect(fillCharsFor(0)).toBe(0)
  })

  it('33%（非整百分比）取整方向', () => {
    expect(fillCharsFor(33)).toBe(439)
  })

  it('同样按 clamp 之后的值算', () => {
    expect(fillCharsFor(1000)).toBe(fillCharsFor(100))
    expect(fillCharsFor(Number.NaN)).toBe(fillCharsFor(BOSS_FILL_MAX))
  })
})

describe('clampPageFontSize', () => {
  it('夹紧到 [MIN, MAX] 并取整', () => {
    expect(clampPageFontSize(PAGE_FONT_SIZE_MIN - 1)).toBe(PAGE_FONT_SIZE_MIN)
    expect(clampPageFontSize(PAGE_FONT_SIZE_MIN)).toBe(PAGE_FONT_SIZE_MIN)
    expect(clampPageFontSize(15.4)).toBe(15)
    expect(clampPageFontSize(PAGE_FONT_SIZE_MAX)).toBe(PAGE_FONT_SIZE_MAX)
    expect(clampPageFontSize(1e9)).toBe(PAGE_FONT_SIZE_MAX)
  })

  it('非有限值落到默认值，与 clampRatio 同一姿态', () => {
    // 【为什么是默认值而不是某一端】非有限值来自「设置文件被改坏 / 字段缺失」，
    // 那是**不可用**而不是「太大 / 太小」。`clampRatio` 对 Infinity 也是给默认值
    // （实测 10），不是 MAX_RATIO。
    expect(clampPageFontSize(Number.NaN)).toBe(PAGE_FONT_SIZE_DEFAULT)
    expect(clampPageFontSize(Number.POSITIVE_INFINITY)).toBe(PAGE_FONT_SIZE_DEFAULT)
    expect(clampPageFontSize(Number.NEGATIVE_INFINITY)).toBe(PAGE_FONT_SIZE_DEFAULT)
  })

  it('默认字号就是 15——改它就是改「默认档」的行为', () => {
    // 15 是这次改动之前写死在 page.css 上的那个值。它一变，默认档的版面就跟着变。
    expect(PAGE_FONT_SIZE_DEFAULT).toBe(15)
  })
})

describe('charsPerSheet', () => {
  it('默认字号下逐位等于常量本身', () => {
    // 【为什么必须逐位相等】其余断言全是相对量。而 `CHARS_PER_SHEET` 是被 1330 钉住的
    // 经验值，2013 行那条「常量本身被钉住」守的就是它——这里是同一个数的另一条边：
    // 不相等的话，默认档的行为就不是「一个像素都没变」，而是悄悄变了。
    expect(charsPerSheet(PAGE_FONT_SIZE_DEFAULT)).toBe(CHARS_PER_SHEET)
  })

  it('字号翻倍，一页装得下的字降到四分之一', () => {
    // 【为什么是二次方】每行字数按 1/F 缩，行数也按 1/F 缩。
    expect(charsPerSheet(30)).toBe(Math.round(CHARS_PER_SHEET / 4))
    expect(charsPerSheet(7.5)).toBe(Math.round(CHARS_PER_SHEET * 4))
  })

  it('字号越大，一页装得越少——整段单调', () => {
    let prev = Number.POSITIVE_INFINITY
    for (let f = PAGE_FONT_SIZE_MIN; f <= PAGE_FONT_SIZE_MAX; f += 0.5) {
      const n = charsPerSheet(f)
      expect(n).toBeLessThan(prev)
      prev = n
    }
  })

  it('不可用的入参退回参考字号，不会算出 Infinity 或 0', () => {
    // 【这里为什么不是「夹到 MIN」】`charsPerSheet` 不算用户值域，只兜「算不出来」。
    // 0 会算出 Infinity，NaN 会算出 NaN——两者都退回参考字号。
    // 用户值域的夹紧是 `clampPageFontSize` 的事，在消费点上做（与 `clampRatio` 同一分层）。
    expect(charsPerSheet(0)).toBe(CHARS_PER_SHEET)
    expect(charsPerSheet(-3)).toBe(CHARS_PER_SHEET)
    expect(charsPerSheet(Number.NaN)).toBe(CHARS_PER_SHEET)
    expect(charsPerSheet(Number.POSITIVE_INFINITY)).toBe(CHARS_PER_SHEET)
  })
})

describe('fillCharsFor 带字号', () => {
  it('不传字号时与只有百分比时逐位相同', () => {
    // 既有调用点（App.tsx 三处、几条集成用例）都只传一个参数，这条把它们钉住。
    expect(fillCharsFor(100, PAGE_FONT_SIZE_DEFAULT)).toBe(fillCharsFor(100))
    expect(fillCharsFor(33, PAGE_FONT_SIZE_DEFAULT)).toBe(fillCharsFor(33))
  })

  it('字号变大，同样百分比铺得少', () => {
    expect(fillCharsFor(100, 20)).toBe(charsPerSheet(20))
    expect(fillCharsFor(100, 20)).toBeLessThan(fillCharsFor(100, 15))
  })

  it('值域夹紧不在这里做——`charsPerSheet` 只兜「算不出来」的入参', () => {
    // 1e9 在数学上仍然算得出一个数（很小），照算；NaN 退回参考字号。
    expect(fillCharsFor(100, 1e9)).toBe(charsPerSheet(1e9))
    expect(fillCharsFor(100, Number.NaN)).toBe(CHARS_PER_SHEET)
  })
})
