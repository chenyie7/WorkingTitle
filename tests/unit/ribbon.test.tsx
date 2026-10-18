import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Ribbon, RIBBON_TABS } from '../../src/renderer/src/components/Ribbon'
import { Toast } from '../../src/renderer/src/components/Toast'
import { ToolbarProvider } from '../../src/renderer/src/state/ToolbarContext'

function setup(): void {
  /**
   * 壳自己持 `settingsOpen`：`Ribbon` 从 Task 6 起是**受控**的（原先这个状态住在它里面，
   * 而「按 ⌘/Ctrl + , 打开设置」那条监听已经删掉、归全局分发器了），而下面那条
   * 「点设置按钮对话框才出现」的用例断言的正是受控行为——状态得有人拿着。
   *
   * 四个快捷键 prop 这里**不用传**（它们是可选带默认值的）；`settingsShortcut` 也不用
   * （它的默认值从注册表推）。
   */
  function Harness() {
    const [settingsOpen, setSettingsOpen] = useState(false)
    return (
      <Ribbon
        docTitle="文档1"
        onDocTitleChange={() => {}}
        darkPaper={false}
        onDarkPaperChange={() => {}}
        themeSource="system"
        onThemeSourceChange={() => {}}
        novelOpen={false}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
      />
    )
  }
  render(
    <ToolbarProvider>
      <Harness />
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

describe('样式库', () => {
  it('默认只露四项，其余从展开面板里选', () => {
    setup()
    expect(screen.getByTestId('gallery-style').querySelectorAll('.wt-gallery__item')).toHaveLength(4)
    expect(screen.getByTestId('gallery-style-正文')).toBeTruthy()
    expect(screen.getByTestId('gallery-style-标题 1')).toBeTruthy()
    expect(screen.getByTestId('gallery-style-标题 2')).toBeTruthy()
    expect(screen.getByTestId('gallery-style-标题 3')).toBeTruthy()
    expect(screen.queryByTestId('gallery-style-引用')).toBeNull()

    fireEvent.click(screen.getByTestId('gallery-style-more'))
    expect(screen.getByTestId('gallery-style-panel')).toBeTruthy()
    fireEvent.click(screen.getByTestId('gallery-style-option-引用'))

    expect(screen.getByTestId('gallery-style-引用').className).toContain('wt-gallery__item--active')
    expect(screen.getByTestId('gallery-style-more').className).toContain('wt-gallery__more--active')
    expect(screen.queryByTestId('gallery-style-标题 3')).toBeNull()
    expect(screen.queryByTestId('gallery-style-panel')).toBeNull()
  })
})

describe('锚点弹层', () => {
  it('点面板外面关闭面板', () => {
    setup()
    fireEvent.click(screen.getByTestId('gallery-style-more'))
    expect(screen.getByTestId('gallery-style-panel')).toBeTruthy()

    fireEvent.mouseDown(document.body)

    expect(screen.queryByTestId('gallery-style-panel')).toBeNull()
  })

  it('点面板内部不关闭面板', () => {
    setup()
    fireEvent.click(screen.getByTestId('gallery-style-more'))

    fireEvent.mouseDown(screen.getByTestId('gallery-style-panel'))

    expect(screen.getByTestId('gallery-style-panel')).toBeTruthy()
  })

  it('再点一次锚点按钮关闭面板', () => {
    setup()
    const more = screen.getByTestId('gallery-style-more')
    fireEvent.click(more)
    expect(screen.getByTestId('gallery-style-panel')).toBeTruthy()

    fireEvent.click(more)

    expect(screen.queryByTestId('gallery-style-panel')).toBeNull()
  })

  it('窗口缩放时重新定位面板', () => {
    setup()
    const more = screen.getByTestId('gallery-style-more')
    const rect = (bottom: number): DOMRect =>
      ({
        left: 10,
        top: 20,
        bottom,
        right: 32,
        width: 22,
        height: 10,
        x: 10,
        y: 20,
        toJSON: () => ({})
      }) as DOMRect
    const spy = vi.spyOn(more, 'getBoundingClientRect').mockReturnValue(rect(30))

    fireEvent.click(more)
    const panel = screen.getByTestId('gallery-style-panel')
    expect(panel.style.left).toBe('10px')
    expect(panel.style.top).toBe('32px')

    spy.mockReturnValue(rect(50))
    fireEvent(window, new Event('resize'))
    expect(screen.getByTestId('gallery-style-panel').style.top).toBe('52px')

    spy.mockRestore()
  })
})

describe('插入页收组', () => {
  it('被收掉的占位项不再渲染', () => {
    setup()
    fireEvent.click(screen.getByTestId('tab-插入'))
    expect(screen.getByTestId('btn-table')).toBeTruthy()
    expect(screen.getByTestId('btn-picture')).toBeTruthy()
    expect(screen.getByTestId('btn-formula')).toBeTruthy()
    expect(screen.queryByTestId('btn-model3d')).toBeNull()
    expect(screen.queryByTestId('btn-smartart')).toBeNull()
    expect(screen.queryByTestId('btn-screenshot')).toBeNull()
    expect(screen.queryByTestId('btn-bookmark')).toBeNull()
    expect(screen.queryByTestId('btn-crossref')).toBeNull()
    expect(screen.queryByTestId('btn-signature')).toBeNull()
    expect(screen.queryByTestId('btn-object')).toBeNull()
    expect(screen.queryByTestId('btn-addin')).toBeNull()
    expect(screen.queryByTestId('btn-video')).toBeNull()
    expect(screen.queryByTestId('btn-audio')).toBeNull()
  })
})
