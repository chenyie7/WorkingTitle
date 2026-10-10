import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../../src/renderer/src/App'

describe('Word 外壳骨架', () => {
  it('渲染出应用根节点与五个主要区域', () => {
    const { container } = render(<App />)
    expect(screen.getByTestId('app-root')).toBeTruthy()
    expect(container.querySelector('.wt-ribbon')).not.toBeNull()
    expect(container.querySelector('.wt-tabs')).not.toBeNull()
    expect(container.querySelector('.wt-sidebar')).not.toBeNull()
    expect(container.querySelector('.wt-page')).not.toBeNull()
    expect(container.querySelector('.wt-statusbar')).not.toBeNull()
  })

  it('伪装文案与区域嵌套正确（内容被换掉时必须红）', () => {
    const { container } = render(<App />)

    expect(container.querySelector('.wt-ribbon__title-app')?.textContent).toBe('Word')
    expect(container.querySelector('.wt-ribbon__title-doc')?.textContent).toBe('文档1')

    // 用 toBeTruthy 而非 not.toBeNull：父元素缺失时可选链返回 undefined，
    // not.toBeNull 会静默放行。
    const ribbon = container.querySelector('.wt-ribbon')
    expect(ribbon, '.wt-ribbon 必须存在').toBeTruthy()
    expect(ribbon?.querySelector('.wt-tabs')).toBeTruthy()
    expect(ribbon?.querySelector('.wt-toolbar')).toBeTruthy()

    const body = container.querySelector('.wt-body')
    expect(body, '.wt-body 必须存在').toBeTruthy()
    expect(body?.querySelector('.wt-sidebar')).toBeTruthy()
    expect(body?.querySelector('.wt-canvas')).toBeTruthy()
    expect(body?.querySelector('.wt-page')).toBeTruthy()
  })
})
