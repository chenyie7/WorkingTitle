import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Ribbon } from '../../src/renderer/src/components/Ribbon'
import { Toast } from '../../src/renderer/src/components/Toast'
import { InputCapture } from '../../src/renderer/src/input/InputCapture'
import { ToolbarProvider } from '../../src/renderer/src/state/ToolbarContext'
import type { InputMode } from '../../src/core/types'
import type { ThemeSource } from '../../src/renderer/src/types/global'

interface SetupOptions {
  ratio?: number
  globalRatio?: number
  mode?: InputMode
  onRatioChange?: (n: number) => void
  onGlobalRatioChange?: (n: number) => void
  /** 「当前书」那格据此禁用；不传＝当作已经打开了小说 */
  novelOpen?: boolean
  onModeChange?: (m: InputMode) => void
  onImport?: () => void
  onClearSession?: () => void
  /** 额外挂一个 InputCapture：焦点那几条用例需要它来当「被抢的对象」 */
  capture?: boolean
  docTitle?: string
  darkPaper?: boolean
  themeSource?: ThemeSource
}

function setup(opts: SetupOptions = {}): {
  onDocTitleChange: ReturnType<typeof vi.fn>
  onDarkPaperChange: ReturnType<typeof vi.fn>
  onThemeSourceChange: ReturnType<typeof vi.fn>
} {
  const onDocTitleChange = vi.fn()
  const onDarkPaperChange = vi.fn()
  const onThemeSourceChange = vi.fn()
  const {
    capture,
    docTitle = '文档1',
    darkPaper = false,
    themeSource = 'system',
    novelOpen = true,
    ...provider
  } = opts
  render(
    <ToolbarProvider {...provider}>
      <Ribbon
        docTitle={docTitle}
        onDocTitleChange={onDocTitleChange}
        darkPaper={darkPaper}
        onDarkPaperChange={onDarkPaperChange}
        themeSource={themeSource}
        onThemeSourceChange={onThemeSourceChange}
        novelOpen={novelOpen}
      />
      {capture ? <InputCapture engine={{ pump: vi.fn(), backspace: vi.fn() }} mode="key" /> : null}
      <Toast />
    </ToolbarProvider>
  )
  return { onDocTitleChange, onDarkPaperChange, onThemeSourceChange }
}

const settings = (): HTMLElement => screen.getByTestId('settings')

/**
 * 会**回写**的壳：保存之后文档名 / 比例真的变了，`Ribbon` 收到的 props 跟着变。
 *
 * 【为什么不能复用上面的 `setup`】那个壳把 `docTitle` / `ratio` 写死成固定 prop，
 * 于是提交之后「已提交值」永远不会变——草稿与它一比就永远算「有改动」，保存按钮不会消失。
 * 拿它断言「保存后按钮消失」会假红。这条只有会回写的壳测得了。
 */
function setupLive(init: { docTitle?: string; ratio?: number } = {}): {
  onDocTitleChange: ReturnType<typeof vi.fn>
  onRatioChange: ReturnType<typeof vi.fn>
} {
  const onDocTitleChange = vi.fn()
  const onRatioChange = vi.fn()
  function Harness() {
    const [title, setTitle] = useState(init.docTitle ?? '文档1')
    const [ratio, setRatio] = useState(init.ratio ?? 10)
    return (
      <ToolbarProvider
        ratio={ratio}
        onRatioChange={(n) => {
          onRatioChange(n)
          setRatio(n)
        }}
      >
        <Ribbon
          docTitle={title}
          onDocTitleChange={(v) => {
            onDocTitleChange(v)
            setTitle(v)
          }}
          darkPaper={false}
          onDarkPaperChange={vi.fn()}
          themeSource="system"
          onThemeSourceChange={vi.fn()}
          novelOpen
        />
        <Toast />
      </ToolbarProvider>
    )
  }
  render(<Harness />)
  return { onDocTitleChange, onRatioChange }
}

/** 走「文件」选项卡那个按钮——与快捷键是两条独立的路，两边都得能开 */
function openViaButton(): void {
  fireEvent.click(screen.getByTestId('tab-文件'))
  fireEvent.click(screen.getByTestId('btn-settings'))
}

describe('设置对话框的打开方式', () => {
  it('「文件」选项卡里的「设置」按钮能打开，且带模态语义', () => {
    setup()
    expect(screen.queryByTestId('settings')).toBeNull()

    openViaButton()

    expect(settings().getAttribute('role')).toBe('dialog')
    expect(settings().getAttribute('aria-modal')).toBe('true')
  })

  it('⌘/Ctrl + , 都能打开（按物理键位 Comma 判定）', () => {
    setup()
    fireEvent.keyDown(window, { key: ',', code: 'Comma', metaKey: true })
    expect(screen.getByTestId('settings')).toBeTruthy()
  })

  it('Ctrl + ,（非 mac）同样打开', () => {
    setup()
    fireEvent.keyDown(window, { key: ',', code: 'Comma', ctrlKey: true })
    expect(screen.getByTestId('settings')).toBeTruthy()
  })

  it('不带修饰键的逗号不打开（那是正文里的标点，不该被吃掉）', () => {
    setup()
    fireEvent.keyDown(window, { key: ',', code: 'Comma' })
    expect(screen.queryByTestId('settings')).toBeNull()
  })
})

describe('设置对话框的关闭方式', () => {
  it('Esc 关闭', () => {
    setup()
    openViaButton()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('settings')).toBeNull()
  })

  it('点遮罩关闭', () => {
    setup()
    openViaButton()
    // 遮罩就是对话框根元素本身：面板盖在它上面，所以要点根元素才算「点在外面」
    fireEvent.click(settings())
    expect(screen.queryByTestId('settings')).toBeNull()
  })

  it('点面板里面不关闭', () => {
    setup()
    openViaButton()
    fireEvent.click(screen.getByText('选项'))
    expect(screen.getByTestId('settings')).toBeTruthy()
  })

  it('标题栏的 ✕ 与底部的「关闭」都能关', () => {
    setup()
    openViaButton()
    fireEvent.click(screen.getByTestId('settings-close'))
    expect(screen.queryByTestId('settings')).toBeNull()

    openViaButton()
    fireEvent.click(screen.getByTestId('settings-close-footer'))
    expect(screen.queryByTestId('settings')).toBeNull()
  })
})

describe('真实功能收在对话框里', () => {
  it('五个控件的 testid 原样搬了进来，工具栏里一个都没有', () => {
    setup()
    openViaButton()
    for (const id of [
      'doc-title-input',
      'ratio-input',
      'mode-button',
      'btn-import',
      'btn-clear-session'
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy()
      // 「在原处」而不是「在别处」：五个都必须落在对话框里
      expect(settings().contains(screen.getByTestId(id))).toBe(true)
    }

    // 关掉之后它们跟着消失（说明只在对话框里存在，不是复制了一份）
    fireEvent.click(screen.getByTestId('settings-close'))
    expect(screen.queryByTestId('ratio-input')).toBeNull()
    expect(screen.queryByTestId('mode-button')).toBeNull()
    expect(screen.queryByTestId('btn-import')).toBeNull()
    expect(screen.queryByTestId('btn-clear-session')).toBeNull()
    expect(screen.queryByTestId('doc-title-input')).toBeNull()
  })

  it('比例输入回车后回调夹紧后的值（改动本身不生效，回车＝保存）', () => {
    const onRatioChange = vi.fn()
    setup({ ratio: 10, onRatioChange })
    openViaButton()
    const input = screen.getByTestId('ratio-input')
    fireEvent.change(input, { target: { value: '25' } })
    // 先有改动、出保存按钮，但**还没有**生效
    expect(screen.getByTestId('settings-save')).toBeTruthy()
    expect(onRatioChange).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRatioChange).toHaveBeenCalledWith(25)
  })

  it('比例超出上限：失焦就夹紧并提示，回车保存夹紧后的值', () => {
    const onRatioChange = vi.fn()
    setup({ ratio: 10, onRatioChange })
    openViaButton()
    const input = screen.getByTestId('ratio-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '9999' } })
    fireEvent.blur(input)
    // 失焦只归一化：框里显示夹紧后的值、给一条提示，但**还没生效**
    // （提示压在遮罩之上，见 .wt-modal 的 z-index）
    expect(input.value).toBe('500')
    expect(screen.getByTestId('toast').textContent).toContain('500')
    expect(onRatioChange).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRatioChange).toHaveBeenCalledWith(500)
  })

  it('输入模式按钮真实切换并提示', () => {
    const onModeChange = vi.fn()
    setup({ mode: 'ime', onModeChange })
    openViaButton()
    expect(screen.getByTestId('mode-button').textContent).toBe('输入法')
    fireEvent.click(screen.getByTestId('mode-button'))
    expect(onModeChange).toHaveBeenCalledWith('key')
    expect(screen.getByTestId('toast').textContent).toContain('纯按键')
  })

  it('「导入小说」按钮触发真实回调而非占位提示', () => {
    const onImport = vi.fn()
    setup({ onImport })
    openViaButton()
    fireEvent.click(screen.getByTestId('btn-import'))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('「清除阅读记录」按钮触发真实回调', () => {
    const onClearSession = vi.fn()
    setup({ onClearSession })
    openViaButton()
    fireEvent.click(screen.getByTestId('btn-clear-session'))
    expect(onClearSession).toHaveBeenCalledTimes(1)
  })
})

describe('对话框里改文档名', () => {
  it('文档名：回车＝保存，两侧空白去掉', () => {
    const { onDocTitleChange: onChange } = setup({ docTitle: '文档1' })
    openViaButton()
    const input = screen.getByTestId('doc-title-input') as HTMLInputElement
    expect(input.value).toBe('文档1')

    fireEvent.change(input, { target: { value: '  第 3 季度汇报  ' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('第 3 季度汇报')
  })

  it('失焦只归一化，不提交——生效要等「保存」', () => {
    const { onDocTitleChange: onChange } = setup({ docTitle: '文档1' })
    openViaButton()
    const input = screen.getByTestId('doc-title-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  会议纪要  ' } })
    fireEvent.blur(input)
    // 归一化只体现在框里；没有提交，但已经算「有改动」
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('会议纪要')
    expect(screen.getByTestId('settings-save')).toBeTruthy()
  })

  it('空名不提交（蓝条不能变成一片空白）', () => {
    const { onDocTitleChange: onChange } = setup({ docTitle: '文档1' })
    openViaButton()
    const input = screen.getByTestId('doc-title-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('文档1')
  })

  it('外观三选一：默认跟随系统，点「深色」回调 dark', () => {
    const { onThemeSourceChange } = setup()
    openViaButton()
    expect(screen.getByTestId('theme-system').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('theme-dark').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByTestId('theme-dark'))
    expect(onThemeSourceChange).toHaveBeenCalledWith('dark')
  })

  it('「纸张也变暗」是个复选框，勾选时回调 true', () => {
    const { onDarkPaperChange } = setup()
    openViaButton()
    const box = screen.getByTestId('dark-paper') as HTMLInputElement
    expect(box.type).toBe('checkbox')
    // 默认关：真 Word 的深色模式里纸张仍然是白的，保持这一点伪装才完整
    expect(box.checked).toBe(false)

    fireEvent.click(box)
    expect(onDarkPaperChange).toHaveBeenCalledWith(true)
  })

  it('Esc 关掉对话框不算提交：草稿丢掉，名字不变', () => {
    const { onDocTitleChange: onChange } = setup({ docTitle: '文档1' })
    openViaButton()
    fireEvent.change(screen.getByTestId('doc-title-input'), { target: { value: '不该生效' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()

    openViaButton()
    expect((screen.getByTestId('doc-title-input') as HTMLInputElement).value).toBe('文档1')
  })
})

/**
 * 「手动保存」这一组：文档名与阅读替换改了不立即生效，点保存才生效。
 *
 * 外观 / 纸张 / 输入模式刻意**不**在这一组里——它们的效果当场看得见（换个颜色、按一下就知道），
 * 要保存才生效会很别扭。所以这里也顺带守住那条边界。
 */
describe('手动保存', () => {
  it('没有改动时不出现保存按钮', () => {
    setup({ ratio: 10, docTitle: '文档1' })
    openViaButton()
    expect(screen.queryByTestId('settings-save')).toBeNull()
  })

  it('改回原值之后保存按钮消失', () => {
    setup({ docTitle: '文档1' })
    openViaButton()
    const input = screen.getByTestId('doc-title-input')
    fireEvent.change(input, { target: { value: '会议纪要' } })
    expect(screen.getByTestId('settings-save')).toBeTruthy()

    fireEvent.change(input, { target: { value: '文档1' } })
    expect(screen.queryByTestId('settings-save')).toBeNull()
  })

  it('点保存才生效，给一条提示，并且按钮随之消失', () => {
    const { onDocTitleChange: onChange } = setupLive({ docTitle: '文档1' })
    openViaButton()
    fireEvent.change(screen.getByTestId('doc-title-input'), { target: { value: '会议纪要' } })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onChange).toHaveBeenCalledWith('会议纪要')
    expect(screen.getByTestId('toast').textContent).toContain('已保存')
    // 保存之后没有未提交的改动了（这一条靠会回写的壳才测得出来，见 setupLive）
    expect(screen.queryByTestId('settings-save')).toBeNull()
  })

  it('两项各有改动时，一次保存把它们一起提交', () => {
    const { onDocTitleChange, onRatioChange } = setupLive({ docTitle: '文档1', ratio: 10 })
    openViaButton()
    fireEvent.change(screen.getByTestId('doc-title-input'), { target: { value: '会议纪要' } })
    fireEvent.change(screen.getByTestId('ratio-input'), { target: { value: '25' } })
    expect(onDocTitleChange).not.toHaveBeenCalled()
    expect(onRatioChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onDocTitleChange).toHaveBeenCalledWith('会议纪要')
    expect(onRatioChange).toHaveBeenCalledWith(25)
  })

  it('外观与纸张不在这组里：点一下就生效，不经过保存', () => {
    const { onThemeSourceChange, onDarkPaperChange } = setup({
      themeSource: 'system',
      darkPaper: false
    })
    openViaButton()
    expect(screen.queryByTestId('settings-save')).toBeNull()

    fireEvent.click(screen.getByTestId('theme-dark'))
    fireEvent.click(screen.getByTestId('dark-paper'))

    // 两项都是即时回调（不经过保存）……
    expect(onThemeSourceChange).toHaveBeenCalledWith('dark')
    expect(onDarkPaperChange).toHaveBeenCalledWith(true)
    // ……所以它们不会让「有未保存的改动」为真，保存按钮不该被它们点亮
    expect(screen.queryByTestId('settings-save')).toBeNull()
  })

  it('全局比例与当前书比例：两格各有一个输入框，都归手动保存', () => {
    const onRatioChange = vi.fn()
    const onGlobalRatioChange = vi.fn()
    setup({ ratio: 10, globalRatio: 10, onRatioChange, onGlobalRatioChange })
    openViaButton()

    expect((screen.getByTestId('global-ratio-input') as HTMLInputElement).value).toBe('10')
    expect((screen.getByTestId('ratio-input') as HTMLInputElement).value).toBe('10')

    fireEvent.change(screen.getByTestId('global-ratio-input'), { target: { value: '4' } })
    fireEvent.change(screen.getByTestId('ratio-input'), { target: { value: '7' } })
    // 改了不生效——两格都在手动保存那一组里
    expect(onGlobalRatioChange).not.toHaveBeenCalled()
    expect(onRatioChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('settings-save'))

    // 点保存之后各回各的家：全局进设置，当前书进引擎
    expect(onGlobalRatioChange).toHaveBeenCalledWith(4)
    expect(onRatioChange).toHaveBeenCalledWith(7)
  })

  it('没打开小说时「当前书」那格禁用，而全局那格照旧可用', () => {
    setup({ novelOpen: false })
    openViaButton()
    // 没有书就没有「当前书」
    expect((screen.getByTestId('ratio-input') as HTMLInputElement).disabled).toBe(true)
    // 全局那格与「有没有书」无关：它管的是以后导入的书
    expect((screen.getByTestId('global-ratio-input') as HTMLInputElement).disabled).toBe(false)
  })

  it('未保存就关掉＝丢弃，重开时从当前值起稿且按钮不亮', () => {
    const { onDocTitleChange: onChange } = setup({ docTitle: '文档1' })
    openViaButton()
    fireEvent.change(screen.getByTestId('doc-title-input'), { target: { value: '不该生效' } })
    expect(screen.getByTestId('settings-save')).toBeTruthy()

    fireEvent.click(screen.getByTestId('settings-close-footer'))
    expect(onChange).not.toHaveBeenCalled()

    openViaButton()
    expect((screen.getByTestId('doc-title-input') as HTMLInputElement).value).toBe('文档1')
    expect(screen.queryByTestId('settings-save')).toBeNull()
  })
})

/**
 * 模态与「点哪儿都能继续打字」的冲突。
 *
 * 【这些用例守到哪一层，说清楚】它们守的是 InputCapture 里那两条闸的**机制**（点击目标
 * 在对话框里 / 焦点已经在对话框里 → 不抢）。「抢回去之后用户的字真的会抽进小说」这个
 * **后果**在 jsdom 里求证不了：jsdom 没有命中测试，也没有「点不可聚焦元素 → 焦点交给
 * body」这条浏览器行为（下面第二条用例是手工把它摆出来的）。那条只能由
 * tests/e2e/app.spec.ts 里驱动真实 Electron 的用例判。
 */
describe('对话框开着时，键盘焦点不会被抢回阅读区', () => {
  it('打开时焦点就落在对话框里（autoFocus），不在隐形输入框上', () => {
    setup({ capture: true })
    const capture = screen.getByTestId('input-capture')
    // 前提自检：InputCapture 挂载时真的抢了焦点。少了这行，下面那个断言在「它压根没抢过」
    // 的世界里也照样绿。
    expect(document.activeElement).toBe(capture)

    openViaButton()
    expect(document.activeElement).toBe(screen.getByTestId('doc-title-input'))
  })

  it('点对话框里不可聚焦的空白处，焦点不会被抢走', () => {
    setup({ capture: true })
    openViaButton()
    const capture = screen.getByTestId('input-capture')
    const input = screen.getByTestId('doc-title-input')
    // 浏览器里点不可聚焦的空白处会把焦点交给 body（jsdom 不会，这里手工摆出来）。
    // 这正是「点击目标」那条闸要拦的形态：target 在对话框里、而焦点已经不在。
    input.blur()
    expect(document.activeElement).not.toBe(capture)

    const panel = settings().querySelector('.wt-modal__panel') as HTMLElement
    fireEvent.mouseDown(panel)
    fireEvent.click(panel)

    expect(document.activeElement).not.toBe(capture)
  })

  it('对话框开着、焦点在对话框里时，点对话框【外】的东西也不抢焦点', () => {
    // 这条守的是**第二条**闸（`document.activeElement` 在对话框里 → 不抢）。
    //
    // 它对应的真实时序是「用『设置』按钮打开对话框」那一下：本监听挂在 window 上，而
    // React 的事件层挂在容器（#root）上——容器在 window 的【里面】，所以真机上冒泡到
    // window 时 React 的 onClick 已经跑完：对话框挂载、autoFocus 已经把焦点送进文档名
    // 输入框，而 `e.target` 仍是工具栏上那个按钮（不在对话框里）。少了第二条闸，正好在
    // 这一下把焦点抢回隐藏 textarea。
    //
    // 【为什么不直接断言「点一次按钮就够了」】jsdom 侧 testing-library 把 React 的 flush
    // 推到 act 结束，也就是整个事件派发（含 window 上那个监听）之后——于是那一下派发时
    // 对话框还没挂载、焦点还没进对话框，两条闸都拦不住也都不需要拦，**用例在两条闸都在
    // 和都不在的世界里一样绿**（实测：把第二条闸删掉，41 条用例全过）。所以这里按真机的
    // 形态把状态摆出来：对话框已开、焦点已在里面，再派发一次「点击」——此时 window 上那个
    // 监听看到的与真机上完全一致。
    setup({ capture: true })
    openViaButton()
    const titleInput = screen.getByTestId('doc-title-input')
    expect(document.activeElement).toBe(titleInput)

    const settingsButton = screen.getByTestId('btn-settings')
    fireEvent.mouseDown(settingsButton)
    fireEvent.click(settingsButton)

    expect(document.activeElement).toBe(titleInput)
  })

  it('关掉对话框后，焦点交还给隐形输入框（否则用户不打字就再也敲不进正文）', () => {
    setup({ capture: true })
    const capture = screen.getByTestId('input-capture')
    openViaButton()
    expect(document.activeElement).not.toBe(capture)

    fireEvent.click(screen.getByTestId('settings-close'))

    expect(screen.queryByTestId('settings')).toBeNull()
    expect(document.activeElement).toBe(capture)
  })
})
