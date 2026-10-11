import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  useDeferredSettings,
  type DeferredField
} from '../../src/renderer/src/state/deferredSettings'

/**
 * 这一层是「手动保存」的通用机制，具体设置项只是往表里加行——所以它自己要有用例。
 * 这里刻意用两个假字段（一个去空白、一个夹紧），而不是拿文档名 / 比例来测：测的是机制，
 * 混进真实业务规则会让「机制坏了」和「那一项的 normalize 写错了」分不开。
 */
function makeFields(commitA = vi.fn(), commitB = vi.fn()): DeferredField[] {
  return [
    {
      id: 'a',
      committed: 'A',
      // 空 → 退回已提交值（不能留一个空草稿让「保存」永远亮着）
      normalize: (raw, committed) => {
        const trimmed = raw.trim()
        return trimmed === '' ? committed : trimmed
      },
      commit: commitA
    },
    {
      id: 'b',
      committed: '10',
      // 解析不出数字 → 退回已提交值；否则夹到 1–500
      normalize: (raw, committed) => {
        const parsed = Number.parseInt(raw, 10)
        return Number.isFinite(parsed) ? String(Math.min(500, Math.max(1, parsed))) : committed
      },
      commit: commitB
    }
  ]
}

describe('useDeferredSettings', () => {
  it('初始草稿等于已提交值，没有改动', () => {
    const { result } = renderHook(() => useDeferredSettings(makeFields()))
    expect(result.current.drafts).toEqual({ a: 'A', b: '10' })
    expect(result.current.dirty).toBe(false)
  })

  it('改草稿算改动，改回原值就不算了', () => {
    const { result } = renderHook(() => useDeferredSettings(makeFields()))
    act(() => result.current.setDraft('a', 'A2'))
    expect(result.current.dirty).toBe(true)

    act(() => result.current.setDraft('a', 'A'))
    expect(result.current.dirty).toBe(false)
  })

  it('失焦只归一化，不提交', () => {
    const commitA = vi.fn()
    const { result } = renderHook(() => useDeferredSettings(makeFields(commitA)))
    act(() => result.current.setDraft('a', '  A2  '))
    let returned = ''
    act(() => {
      returned = result.current.blur('a')
    })
    expect(returned).toBe('A2')
    expect(result.current.drafts.a).toBe('A2')
    expect(commitA).not.toHaveBeenCalled()
  })

  it('归一化不出合法值时就退回已提交值（不留空草稿 / NaN 草稿）', () => {
    const { result } = renderHook(() => useDeferredSettings(makeFields()))
    act(() => result.current.setDraft('a', '   '))
    act(() => result.current.blur('a'))
    expect(result.current.drafts.a).toBe('A')

    act(() => result.current.setDraft('b', 'abc'))
    act(() => result.current.blur('b'))
    expect(result.current.drafts.b).toBe('10')
    // 两条都退回了原值 ⇒ 一个字的改动都没剩下，按钮不该亮
    expect(result.current.dirty).toBe(false)
  })

  it('save 只提交有改动的项', () => {
    const commitA = vi.fn()
    const commitB = vi.fn()
    const { result } = renderHook(() => useDeferredSettings(makeFields(commitA, commitB)))
    act(() => result.current.setDraft('a', 'A2'))
    act(() => result.current.save())
    expect(commitA).toHaveBeenCalledWith('A2')
    expect(commitB).not.toHaveBeenCalled()
  })

  it('save 提交的是归一化后的值，而不是框里的原文', () => {
    const commitA = vi.fn()
    const commitB = vi.fn()
    const { result } = renderHook(() => useDeferredSettings(makeFields(commitA, commitB)))
    // 【这条是真踩到过的】没失焦直接按回车时草稿是原文，原样提交会把两侧空白带进已提交值
    act(() => result.current.setDraft('a', '  A2  '))
    act(() => result.current.setDraft('b', '9999'))
    act(() => result.current.save())
    expect(commitA).toHaveBeenCalledWith('A2')
    expect(commitB).toHaveBeenCalledWith('500')
  })

  it('save 之后草稿跟着归一化，于是不再算有改动', () => {
    const { result } = renderHook(() => useDeferredSettings(makeFields()))
    act(() => result.current.setDraft('a', '  A2  '))
    expect(result.current.dirty).toBe(true)

    act(() => result.current.save())

    // 草稿是归一化后的值（不是拉回旧值——那会在提交被拒时把用户刚打的字吃掉）
    expect(result.current.drafts.a).toBe('A2')
    // 这里没有会回写 committed 的外层，所以 dirty 仍为真；真正让它转假的是外层更新后的
    // committed。这条只钉「草稿被归一化了」，其余的由 settings.test.tsx 的会回写壳守。
  })

  it('reset 把草稿全部拉回已提交值', () => {
    const { result } = renderHook(() => useDeferredSettings(makeFields()))
    act(() => result.current.setDraft('a', 'A2'))
    act(() => result.current.setDraft('b', '25'))
    expect(result.current.dirty).toBe(true)

    act(() => result.current.reset())

    expect(result.current.drafts).toEqual({ a: 'A', b: '10' })
    expect(result.current.dirty).toBe(false)
  })
})
