import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Ribbon, RIBBON_TABS } from '../../src/renderer/src/components/Ribbon'
import { Toast } from '../../src/renderer/src/components/Toast'
import { ToolbarProvider } from '../../src/renderer/src/state/ToolbarContext'
import type { InputMode } from '../../src/core/types'

function setup(overrides: {
  ratio?: number
  mode?: InputMode
  onRatioChange?: (n: number) => void
  onModeChange?: (m: InputMode) => void
  onImport?: () => void
  onClearSession?: () => void
} = {}): void {
  render(
    <ToolbarProvider {...overrides}>
      <Ribbon docTitle="文档1" />
      <Toast />
    </ToolbarProvider>
  )
}

describe('Ribbon 选项卡', () => {
  it('渲染七个选项卡，默认选中「开始」', () => {
    setup()
    expect(RIBBON_TABS).toHaveLength(7)
    for (const name of RIBBON_TABS) {
      expect(screen.getByTestId(`tab-${name}`)).toBeTruthy()
    }
    expect(screen.getByTestId('tab-开始').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('tab-文件').getAttribute('aria-selected')).toBe('false')
  })

  it('点击选项卡切换选中态并换出对应工具组', () => {
    setup()
    fireEvent.click(screen.getByTestId('tab-文件'))
    expect(screen.getByTestId('tab-文件').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('btn-import')).toBeTruthy()
    expect(screen.queryByTestId('btn-bold')).toBeNull()
  })
})

describe('占位按钮必须可点击且有反馈', () => {
  it('点击「导出 docx」弹出 toast', async () => {
    setup()
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-export-docx'))
    expect(screen.getByTestId('toast').textContent).toBe('演示占位功能，未实现')
    await waitFor(() => expect(screen.queryByTestId('toast')).toBeNull(), { timeout: 3000 })
  })

  it('点击格式按钮切换按下态，再点一次取消', () => {
    setup()
    const bold = screen.getByTestId('btn-bold')
    expect(bold.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(bold)
    expect(screen.getByTestId('btn-bold').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('btn-bold').className).toContain('wt-btn--active')
    fireEvent.click(screen.getByTestId('btn-bold'))
    expect(screen.getByTestId('btn-bold').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('真实功能控件', () => {
  it('比例输入回车后回调夹紧后的值', () => {
    const onRatioChange = vi.fn()
    setup({ ratio: 10, onRatioChange })
    const input = screen.getByTestId('ratio-input')
    fireEvent.change(input, { target: { value: '25' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRatioChange).toHaveBeenCalledWith(25)
  })

  it('比例超出上限时夹紧到 500 并提示', () => {
    const onRatioChange = vi.fn()
    setup({ ratio: 10, onRatioChange })
    const input = screen.getByTestId('ratio-input')
    fireEvent.change(input, { target: { value: '9999' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRatioChange).toHaveBeenCalledWith(500)
    expect(screen.getByTestId('toast').textContent).toContain('500')
  })

  it('输入模式按钮真实切换并提示', () => {
    const onModeChange = vi.fn()
    setup({ mode: 'ime', onModeChange })
    expect(screen.getByTestId('mode-button').textContent).toBe('输入法')
    fireEvent.click(screen.getByTestId('mode-button'))
    expect(onModeChange).toHaveBeenCalledWith('key')
    expect(screen.getByTestId('toast').textContent).toContain('纯按键')
  })

  it('「导入小说」按钮触发真实回调而非占位提示', () => {
    const onImport = vi.fn()
    setup({ onImport })
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('「清除阅读记录」按钮触发真实回调', () => {
    const onClearSession = vi.fn()
    setup({ onClearSession })
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-clear-session'))
    expect(onClearSession).toHaveBeenCalledTimes(1)
  })

  it('默认选项卡「开始」下就能看到比例与模式控件', () => {
    setup()
    expect(screen.getByTestId('ratio-input')).toBeTruthy()
    expect(screen.getByTestId('mode-button')).toBeTruthy()
  })
})
