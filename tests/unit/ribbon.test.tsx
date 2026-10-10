import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Ribbon, RIBBON_TABS } from '../../src/renderer/src/components/Ribbon'
import { Toast } from '../../src/renderer/src/components/Toast'
import { ToolbarProvider } from '../../src/renderer/src/state/ToolbarContext'

function setup(): void {
  render(
    <ToolbarProvider>
      <Ribbon
        docTitle="文档1"
        onDocTitleChange={() => {}}
        darkPaper={false}
        onDarkPaperChange={() => {}}
        themeSource="system"
        onThemeSourceChange={() => {}}
      />
      <Toast />
    </ToolbarProvider>
  )
}

describe('蓝条上的文档名', () => {
  it('是一段静态文本：点它不再变成输入框（改名挪进了设置对话框）', () => {
    setup()
    expect(screen.getByTestId('doc-title').textContent).toBe('文档1')

    fireEvent.click(screen.getByTestId('doc-title'))

    expect(screen.queryByTestId('doc-title-input')).toBeNull()
    expect(screen.getByTestId('doc-title').textContent).toBe('文档1')
  })
})

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
    expect(screen.getByTestId('btn-settings')).toBeTruthy()
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

describe('真实功能不再摆在工具栏里', () => {
  it('七个选项卡下都找不到比例/模式/导入/清除（它们整组搬进了设置对话框）', () => {
    setup()
    for (const name of RIBBON_TABS) {
      fireEvent.click(screen.getByTestId(`tab-${name}`))
      expect(screen.queryByTestId('ratio-input')).toBeNull()
      expect(screen.queryByTestId('mode-button')).toBeNull()
      expect(screen.queryByTestId('btn-import')).toBeNull()
      expect(screen.queryByTestId('btn-clear-session')).toBeNull()
    }
  })

  it('工具栏里唯一的真实功能入口是「文件」选项卡下的「设置」按钮', () => {
    setup()
    // 默认的「开始」选项卡下没有它
    expect(screen.queryByTestId('btn-settings')).toBeNull()

    fireEvent.click(screen.getByTestId('tab-文件'))
    expect(screen.getByTestId('btn-settings')).toBeTruthy()

    // 点了它，对话框才出现（这两个控件才算「在界面上」）
    fireEvent.click(screen.getByTestId('btn-settings'))
    expect(screen.getByTestId('settings')).toBeTruthy()
    expect(screen.getByTestId('ratio-input')).toBeTruthy()
  })
})
