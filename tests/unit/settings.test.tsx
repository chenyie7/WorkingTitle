import { describe, it, expect, vi } from 'vitest'
import { useCallback, useRef, useState, type ReactElement } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Ribbon } from '../../src/renderer/src/components/Ribbon'
import { Toast } from '../../src/renderer/src/components/Toast'
import { InputCapture } from '../../src/renderer/src/input/InputCapture'
import { ToolbarProvider, useToolbar } from '../../src/renderer/src/state/ToolbarContext'
import { useShortcutDispatcher } from '../../src/renderer/src/state/shortcuts'
import { platformKind, resolveShortcuts } from '../../src/core/shortcuts'
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
  /**
   * 用户改过的那些快捷键——**稀疏表**（缺条目＝该平台的默认值，与 `AppSettings.shortcuts`
   * 同一个形状）。不传＝一条都没改过（那张表是按 `platform` 补齐过的默认表）。
   *
   * 【别把它当「已按平台补齐的那份」】↺ 那条用例传的就是稀疏表 `{ import: 'Ctrl+KeyI' }`。
   */
  shortcuts?: Record<string, string>
  platform?: string
  onShortcutsChange?: (next: Record<string, string | undefined>) => void
  /** 观察录制态的上报（壳里同时把它接进分发器的 enabled） */
  onRecordingChange?: (recording: boolean) => void
}

function setup(opts: SetupOptions = {}): {
  onDocTitleChange: ReturnType<typeof vi.fn>
  onDarkPaperChange: ReturnType<typeof vi.fn>
  onThemeSourceChange: ReturnType<typeof vi.fn>
  unmount: () => void
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
    // 默认走 Windows 那一套：macOS 上 import 归原生菜单管，分发器会**跳过**它，
    // 于是「录制期间静音」那条用例在 darwin 下根本走不到分发器。
    shortcuts = resolveShortcuts({}, 'other'),
    platform = 'win32',
    onShortcutsChange = vi.fn(),
    ...provider
  } = opts

  /**
   * 站在 `App` 的位置上：把 Ribbon 报出来的录制态接到全局分发器上（App 里就是 `enabled: !recording`）。
   *
   * 【为什么非要有这一层】少了它，「录制期间分发器必须静音」是一条**空转**用例：树里根本没有
   * 分发器，无论录制态有没有报出去，`onImport` 都不会被调用——它在「通知在」与「通知不在」
   * 两个世界里一样绿。jsdom 里没有真机行为可依赖，只能把 App 那两行接线在这里摆出来。
   */
  function Harness() {
    const [recording, setRecording] = useState(false)
    /**
     * 对话框开不开。`Ribbon` 从 Task 6 起是**受控**的（原先这个状态住在它里面），
     * 所以壳得拿着它——「按 ⌘/Ctrl + , 打开设置」那几条用例现在只能走分发器那条路。
     */
    const [settingsOpen, setSettingsOpen] = useState(false)
    const reportRef = useRef(opts.onRecordingChange)
    reportRef.current = opts.onRecordingChange
    /**
     * 上报录制态：既通知用例里的 spy，也把它接进分发器的 `enabled`。
     *
     * 【身份必须稳定】它是对话框里那个 effect 的依赖——每次渲染换一个新函数的话，effect 会
     * 跟着每次渲染重跑，上报次数就变成「渲染了几次」而不是「录制态变了几次」。
     */
    const reportRecording = useCallback((value: boolean): void => {
      reportRef.current?.(value)
      setRecording(value)
    }, [])
    const dispatchImport = provider.onImport ?? ((): void => {})
    useShortcutDispatcher({
      platform,
      table: resolveShortcuts(shortcuts, platformKind(platform)),
      enabled: !recording,
      actions: {
        // 与 `ToolbarProvider` 收到的是**同一个** spy：App 里两边也都指向同一个 handleImport
        import: dispatchImport,
        // 章节栏那条在 App 里是「提升上去的状态」（Task 7 才提），单测里没有那一层，占位即可
        'toggle-sidebar': () => {},
        // 【这一条必须真的打开对话框】Ribbon 不再自己监听 ⌘,，「按 ⌘/Ctrl + , 对话框出现」
        // 那几条既有用例现在只剩分发器这一条路——占位空函数会让它们全红。
        'open-settings': () => setSettingsOpen(true),
        // 老板键那三条不属于本文件的范围（这个壳没有小说/工作文档那两对状态），占位即可
        'boss-key': () => {},
        'boss-fill-up': () => {},
        'boss-fill-down': () => {}
      }
    })
    return (
      <>
        <Ribbon
          docTitle={docTitle}
          onDocTitleChange={onDocTitleChange}
          darkPaper={darkPaper}
          onDarkPaperChange={onDarkPaperChange}
          themeSource={themeSource}
          onThemeSourceChange={onThemeSourceChange}
          novelOpen={novelOpen}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          shortcuts={shortcuts}
          platform={platform}
          onShortcutsChange={onShortcutsChange}
          onRecordingChange={reportRecording}
        />
        {capture ? <InputCapture engine={{ pump: vi.fn(), backspace: vi.fn() }} mode="key" /> : null}
        <Toast />
      </>
    )
  }

  const { unmount } = render(
    <ToolbarProvider {...provider}>
      <Harness />
    </ToolbarProvider>
  )
  return { onDocTitleChange, onDarkPaperChange, onThemeSourceChange, unmount }
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
    // 受控的 `settingsOpen`：这个壳只关心「保存之后文档名/比例真的回写」，开合本身用不上，
    // 但它是 Ribbon 的必填 prop，得给一个。
    const [settingsOpen, setSettingsOpen] = useState(false)
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
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
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

  // 【这一条原先叫「⌘/Ctrl + , 都能打开」】改动前 Ribbon 自己那个监听是 `e.metaKey || e.ctrlKey`，
  // 与平台无关，所以两套修饰键都开。现在键位来自注册表、按平台各有一套：macOS 那条是 ⌘,，
  // Windows 那条是 Ctrl+,——拿 win32 的壳去按 ⌘, 本来就不该开。断言跟着平台分开写，
  // 覆盖的是同一件事（各自平台上的那一个组合真的打得开），不是把断言删掉。
  it('macOS 上 ⌘ + , 打开（按物理键位 Comma 判定）', () => {
    // `shortcuts` 得一起换成 darwin 的那一份：这个壳收的是「**当前生效**的快捷键」
    // （真机上就是 `resolveShortcuts(稀疏表, 平台)` 的结果），默认值是按 other 补齐的。
    // 只换 platform、不换 shortcuts，壳里就是一张自相矛盾的表（平台是 mac、键位是 Win 的）。
    setup({ platform: 'darwin', shortcuts: resolveShortcuts({}, 'darwin') })
    fireEvent.keyDown(window, { key: ',', code: 'Comma', metaKey: true })
    expect(screen.getByTestId('settings')).toBeTruthy()
  })

  it('Ctrl + ,（非 mac）同样打开', () => {
    setup()
    fireEvent.keyDown(window, { key: ',', code: 'Comma', ctrlKey: true })
    expect(screen.getByTestId('settings')).toBeTruthy()
  })

  it('另一个平台的修饰键不打开（键位是按平台配的，不是「随便哪个修饰键都行」）', () => {
    // 这是本任务删掉 Ribbon 那个平台无关监听之后**新出现**的语义：win32 的壳里按 ⌘,
    // 既不是配上的那条、也不在任何一张表里，不该开。少了这一条，上面两条换成
    // 「metaKey || ctrlKey 一律放行」的实现照样绿。
    setup()
    fireEvent.keyDown(window, { key: ',', code: 'Comma', metaKey: true })
    expect(screen.queryByTestId('settings')).toBeNull()
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

/**
 * 设置里的快捷键录制。
 *
 * 【录制框为什么是 button 而不是 input】这个应用的「抢焦点豁免名单」（InputCapture 的
 * `TEXT_INPUT_SELECTOR`）里有 `input`，而录制要自己接管 keydown——做成 input 的话那一下
 * 会同时被当作「在输入框里打字」。
 */
describe('设置里的快捷键录制', () => {
  it('三行都在，显示的是当前键', () => {
    setup({})
    openViaButton()
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+O')
    expect(screen.getByTestId('shortcut-toggle-sidebar-input').textContent).toContain(
      'Ctrl+Shift+H'
    )
    expect(screen.getByTestId('shortcut-open-settings-input').textContent).toContain('Ctrl+,')
  })

  it('「导入小说」按钮的 title 跟着当前快捷键走（不是写死的 Ctrl+O）', () => {
    // 用一个**默认值推不出来**的键：写死的 'Ctrl+O'、或「忽略 shortcuts 直接推默认值」的
    // 实现都会显示 Ctrl+O，本条即红。
    setup({ shortcuts: { import: 'Ctrl+KeyI' } })
    openViaButton()
    expect(screen.getByTestId('btn-import').getAttribute('title')).toContain('Ctrl+I')
  })

  it('点一下进录制态，显示提示', () => {
    setup({})
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('请按下组合键')
  })

  it('按下合法组合就记下来，并退出录制态', () => {
    setup({})
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      code: 'KeyI',
      ctrlKey: true
    })
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+I')
  })

  it('录不了裸键，停在录制态并提示', () => {
    setup({})
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), { code: 'KeyI' })
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('请按下组合键')
    expect(screen.getByTestId('toast').textContent).toContain('修饰键')
  })

  it('录不了和应用内另一条撞车的组合，提示里点名是哪一条', () => {
    setup({})
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      code: 'KeyH',
      ctrlKey: true,
      shiftKey: true
    })
    expect(screen.getByTestId('toast').textContent).toContain('显示/隐藏章节栏')
  })

  it('同一次对话框里把两条改成同一个键：第二次当场拦住（比的是草稿，不是已提交值）', () => {
    setup({})
    openViaButton()
    // 先把「显示/隐藏章节栏」改成 Ctrl+I（只是草稿，还没保存）
    fireEvent.click(screen.getByTestId('shortcut-toggle-sidebar-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-toggle-sidebar-input'), {
      code: 'KeyI',
      ctrlKey: true
    })
    expect(screen.getByTestId('shortcut-toggle-sidebar-input').textContent).toContain('Ctrl+I')

    // 再把「导入小说」也改成 Ctrl+I。此刻**已提交值**里 import 仍是 Ctrl+O，拿已提交值比
    // 是看不出撞车的——而这两条保存之后会同时生效，引擎里只会有一条真的能用。
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      code: 'KeyI',
      ctrlKey: true
    })

    expect(screen.getByTestId('toast').textContent).toContain('显示/隐藏章节栏')
    // 被拦住＝没记下来，还停在录制态
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('请按下组合键')
  })

  it('按 Esc 取消录制：值是**原来那个**，不会被顺手写回默认值', () => {
    // 【为什么先录成一个非默认值】草稿本来就等于默认值时，「什么都不做」与「写回平台默认值」
    // 返回的是同一个串——这样的断言分不开这两种实现，用例是**空转**的（实测：让 Esc 分支去
    // `setDraft(默认值)`，整组照样全绿）。先把它改成 Ctrl+I，两种实现才分得开。
    setup({ shortcuts: { import: 'Ctrl+KeyI' } })
    openViaButton()
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+I')

    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    // `key` 与 `code` 都给：真机上按 Esc 两个都有，而对话框自己的关闭键判的是 `key`
    // （少了它，用例连「Esc 会关对话框」这半边都验不到）
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      key: 'Escape',
      code: 'Escape'
    })

    const shown = screen.getByTestId('shortcut-import-input').textContent
    expect(shown).toContain('Ctrl+I')
    expect(shown).not.toContain('Ctrl+O')
  })

  it('macOS 上录不了被系统菜单占用的组合：停在录制态、说明原因、草稿不动', () => {
    // 【为什么必须显式给 darwin】`shortcutProblem` 只在 darwin 上会返回 'reserved'（other
    // 平台没有保留清单），而壳默认是 win32——不换平台，这一整条分支**零覆盖**（实测：把那个
    // `if` 删掉，整组照样全绿）。
    setup({ platform: 'darwin', shortcuts: resolveShortcuts({}, 'darwin') })
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    // ⌘Q 是 macOS 的「退出」，在 RESERVED 清单里
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      code: 'KeyQ',
      metaKey: true
    })

    // 停在这一条上：既没记下来，也没退出录制态
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('请按下组合键')
    expect(screen.getByTestId('toast').textContent).toContain('系统菜单')

    // 草稿也没被动过：退出录制态（Esc）之后看，还是原来那个键
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      key: 'Escape',
      code: 'Escape'
    })
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('⌘O')
  })

  it('按 Esc 只是取消录制，不会顺手把整个对话框关掉（草稿全丢）', () => {
    setup({})
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    // `key` 与 `code` 都给：真机上按 Esc 两个都有，而对话框自己的关闭键判的是 `key`
    // （少了它，用例连「Esc 会关对话框」这半边都验不到）
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), {
      key: 'Escape',
      code: 'Escape'
    })
    // Esc 也是对话框自己的关闭键：录制那一下必须 stopPropagation，否则用户想取消录制
    // 会把整个对话框关掉，那一瞬间的草稿（包括刚录的别的键）全丢
    expect(screen.getByTestId('settings')).toBeTruthy()
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+O')
  })

  it('改完要点保存才生效——并进「手动保存」那一组', () => {
    const onShortcutsChange = vi.fn()
    setup({ onShortcutsChange })
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), { code: 'KeyI', ctrlKey: true })
    expect(onShortcutsChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onShortcutsChange).toHaveBeenCalledWith(
      expect.objectContaining({ import: 'Ctrl+KeyI' })
    )
  })

  it('↺ 恢复该平台默认值，并且这一条从稀疏表里消失', () => {
    const onShortcutsChange = vi.fn()
    setup({ shortcuts: { import: 'Ctrl+KeyI' }, onShortcutsChange })
    openViaButton()
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+I')

    fireEvent.click(screen.getByTestId('shortcut-import-reset'))
    // 恢复默认后 import 变回 Ctrl+O ……
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+O')

    fireEvent.click(screen.getByTestId('settings-save'))
    // ……而且「和默认一样」时不该写进稀疏表：`{}` ＝ 全默认。稀疏表里「显式写回默认值」
    // 与「从未改过」对读取方完全没区别，没有理由把表撑大。
    expect(onShortcutsChange).toHaveBeenCalledWith({})
  })

  it('录制期间分发器必须静音——否则录 ⌘O 会当场触发一次真导入', () => {
    const onImport = vi.fn()
    setup({ onImport })
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    fireEvent.keyDown(screen.getByTestId('shortcut-import-input'), { code: 'KeyO', ctrlKey: true })
    expect(onImport).not.toHaveBeenCalled()
  })

  it('录制中关掉对话框：录制态要清掉（分发器解除静音，重开时不还停在录制态）', () => {
    const onRecordingChange = vi.fn()
    setup({ onRecordingChange })
    openViaButton()
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    expect(onRecordingChange).toHaveBeenLastCalledWith(true)

    // 【「关掉对话框」不是「卸载」】`open` 为假时组件只是 `return null`，它本身还在树里——
    // 所以「整树卸载时上报 false」那条 effect 管不到这里，得由 `open` 变假这一条来兜。
    fireEvent.click(screen.getByTestId('settings-close'))
    expect(onRecordingChange).toHaveBeenLastCalledWith(false)

    // 重开时那个按钮不该还停在「请按下组合键…」
    openViaButton()
    expect(screen.getByTestId('shortcut-import-input').textContent).toContain('Ctrl+O')
  })

  it('整棵界面被卸载时（应用退出）也要报一次 false——否则分发器会一直哑着', () => {
    const onRecordingChange = vi.fn()
    const { unmount } = setup({ onRecordingChange })
    openViaButton()
    expect(onRecordingChange).toHaveBeenLastCalledWith(false)

    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    expect(onRecordingChange).toHaveBeenLastCalledWith(true)

    unmount()
    expect(onRecordingChange).toHaveBeenLastCalledWith(false)
  })
})

describe('ToolbarProvider 的 toast 可以受控', () => {
  /** 一个只读 toast、只按 notify 的探针，用来从外面观察 provider 用的是哪一份 */
  function Probe(): ReactElement {
    const { toast, notify } = useToolbar()
    return (
      <button type="button" data-testid="probe" onClick={() => notify('来自里面')}>
        {toast ?? '（无）'}
      </button>
    )
  }

  it('传了 toast / notify 就用外面那一份', () => {
    // 【为什么这条重要】老板键的提示（「还没导入工作文档」、铺满档位）是从 App 那一层的
    // 分发器里弹的，而 notify 原先住在 provider 内部——App 拿不到，那两条提示就没地方去。
    const notify = vi.fn()
    render(
      <ToolbarProvider toast="外面给的" notify={notify}>
        <Probe />
      </ToolbarProvider>
    )
    expect(screen.getByTestId('probe').textContent).toBe('外面给的')
    fireEvent.click(screen.getByTestId('probe'))
    expect(notify).toHaveBeenCalledWith('来自里面')
  })

  it('受控 toast 跟着 prop 走（含传 null）', () => {
    const { rerender } = render(
      <ToolbarProvider toast="有提示" notify={() => {}}>
        <Probe />
      </ToolbarProvider>
    )
    expect(screen.getByTestId('probe').textContent).toBe('有提示')
    rerender(
      <ToolbarProvider toast={null} notify={() => {}}>
        <Probe />
      </ToolbarProvider>
    )
    expect(screen.getByTestId('probe').textContent).toBe('（无）')
  })

  it('不受控写过一次之后再切受控传 null，内部那条不许顶上来', () => {
    // 【为什么非要这一条：上面那条钉不住这个判断】`innerToast` 的初值本来就是 `null`，
    // `null ?? null` 与 `null` 分不出来。实测：把 `!== undefined` 换成 `??`，本文件 50 条
    // 与整个仓库 376 条**全绿**——那个变异在仓库里存活。
    //
    // 判别场景要先把**不受控**的 provider 往内部状态里写一次，再切到受控。
    const { rerender } = render(
      <ToolbarProvider>
        <Probe />
      </ToolbarProvider>
    )
    // 不受控 → notify 落回 innerNotify → 这一下写进了 innerToast
    fireEvent.click(screen.getByTestId('probe'))
    rerender(
      <ToolbarProvider toast={null} notify={() => {}}>
        <Probe />
      </ToolbarProvider>
    )
    // `??` 版这里显示残留的「来自里面」；`!== undefined` 版显示「（无）」
    expect(screen.getByTestId('probe').textContent).toBe('（无）')
  })
})
