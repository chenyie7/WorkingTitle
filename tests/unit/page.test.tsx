import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Page } from '../../src/renderer/src/components/Page'
import { RENDER_WINDOW_LIMIT } from '../../src/core/types'

/**
 * 折叠用例的 fixture 必须让「渲染的是哪一段」可判：文本全同质（例如全是 'A'）时，
 * 取开头、取末尾、根本不折叠，三种实现渲染出来的字符串看起来一模一样，断言分辨不出来
 * ——那等于折叠逻辑没有测试。头尾各放一个标记就够了。
 */
const HEAD = 'HEAD-MARKER'
const TAIL = 'TAIL-MARKER'
/** 长 RENDER_WINDOW_LIMIT + HEAD.length + TAIL.length，必然触发折叠。 */
const LONG_TEXT = HEAD + 'A'.repeat(RENDER_WINDOW_LIMIT) + TAIL

describe('Page', () => {
  it('空状态显示引导文案且没有光标', () => {
    render(<Page visibleText="" expanded={false} onToggleExpand={() => {}} empty />)
    expect(screen.getByTestId('page-empty')).toBeTruthy()
    expect(screen.queryByTestId('caret')).toBeNull()
  })

  it('空状态显示的是传进来的那条快捷键，不是写死的 Ctrl+O', () => {
    // 传一个**两条默认值都推不出来**的串：jsdom 里 `window.api.platform` 是 darwin，
    // 若拿 '⌘O'（该平台的默认值）当期望值，一个忽略 prop、自己推默认值的实现同样能过。
    render(
      <Page visibleText="" expanded={false} onToggleExpand={() => {}} empty importShortcut="⌃⇧K" />
    )
    expect(screen.getByTestId('page-empty').textContent).toContain('⌃⇧K')
    expect(screen.getByTestId('page-empty').textContent).not.toContain('Ctrl+O')
  })

  it('把 visibleText 原样渲染进文档区', () => {
    render(<Page visibleText="第一章 风起\n正文。" expanded={false} onToggleExpand={() => {}} empty={false} />)
    expect(screen.getByTestId('page-text').textContent).toContain('第一章 风起')
    expect(screen.getByTestId('page-text').textContent).toContain('正文。')
    expect(screen.getByTestId('caret')).toBeTruthy()
  })

  it('超过上限时折叠前文，只渲染末尾部分', () => {
    // 前提自检：fixture 必须真的越过上限，否则本用例什么都没测。
    expect(LONG_TEXT.length).toBeGreaterThan(RENDER_WINDOW_LIMIT)
    render(<Page visibleText={LONG_TEXT} expanded={false} onToggleExpand={() => {}} empty={false} />)
    // 「折叠」的实质是丢掉开头那一截：末尾标记在、开头标记不在。
    // 末条断言不是 not.toContain('已折叠')——折叠提示是 page-text 的兄弟节点，
    // 那句话恒真，测不出任何东西。
    const shownText = screen.getByTestId('page-text').textContent ?? ''
    expect(shownText).toContain(TAIL)
    expect(shownText).not.toContain(HEAD)
    expect(screen.getByTestId('page-fold').textContent).toContain(
      String(LONG_TEXT.length - RENDER_WINDOW_LIMIT)
    )
  })

  it('点击折叠提示会请求展开', () => {
    const onToggleExpand = vi.fn()
    const text = 'A'.repeat(RENDER_WINDOW_LIMIT + 10)
    render(<Page visibleText={text} expanded={false} onToggleExpand={onToggleExpand} empty={false} />)
    fireEvent.click(screen.getByTestId('page-fold'))
    expect(onToggleExpand).toHaveBeenCalledTimes(1)
  })

  it('展开后显示全文，且不再显示折叠提示', () => {
    render(<Page visibleText={LONG_TEXT} expanded onToggleExpand={() => {}} empty={false} />)
    expect(screen.queryByTestId('page-fold')).toBeNull()
    // 只断言提示消失是不够的：提示没了、正文却仍停在折叠窗口上，同样满足上一条。
    const shownText = screen.getByTestId('page-text').textContent ?? ''
    expect(shownText).toContain(HEAD)
    expect(shownText).toContain(TAIL)
  })

  it('未超过上限时不折叠', () => {
    render(<Page visibleText={'短文本'} expanded={false} onToggleExpand={() => {}} empty={false} />)
    expect(screen.queryByTestId('page-fold')).toBeNull()
  })
})
