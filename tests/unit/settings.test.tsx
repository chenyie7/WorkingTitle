import { describe, it, expect, vi } from 'vitest'
import { useCallback, useRef, useState, type ReactElement } from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { Ribbon } from '../../src/renderer/src/components/Ribbon'
import { Toast } from '../../src/renderer/src/components/Toast'
import { InputCapture } from '../../src/renderer/src/input/InputCapture'
import { ToolbarProvider, useToolbar } from '../../src/renderer/src/state/ToolbarContext'
import { useShortcutDispatcher } from '../../src/renderer/src/state/shortcuts'
import { SHORTCUTS, platformKind, resolveShortcuts } from '../../src/core/shortcuts'
import { PAGE_FONT_SIZE_DEFAULT, PAGE_FONT_SIZE_MAX, PAGE_FONT_SIZE_MIN } from '../../src/core/types'
import type { InputMode } from '../../src/core/types'
import type { ThemeSource } from '../../src/core/types'
import type { ChapterRule } from '../../src/core/types'

interface SetupOptions {
  ratio?: number
  globalRatio?: number
  mode?: InputMode
  onRatioChange?: (n: number) => void
  onGlobalRatioChange?: (n: number) => void
  /** 「当前书」那格据此禁用；不传＝当作已经打开了小说 */
  novelOpen?: boolean
  onModeChange?: (m: InputMode) => void
  onImport?: () => void | Promise<void>
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
  onShortcutsChange?: (
    update: (prev: Record<string, string | undefined>) => Record<string, string | undefined>
  ) => void
  /** 观察录制态的上报（壳里同时把它接进分发器的 enabled） */
  onRecordingChange?: (recording: boolean) => void
  /** 阅读区正文字号。不传＝默认值（`PAGE_FONT_SIZE_DEFAULT`） */
  pageFontSize?: number
  onPageFontSizeChange?: (next: number) => void
  /** 工作文档的文件名（去扩展名）。不传＝没导入 */
  workDocTitle?: string | null
  /** 完整路径，只用于那行的悬停提示。不传＝没有 */
  workDocPath?: string | null
  /** 配了路径但读不出来（文件被移走 / 删掉 / 权限）——设置里据此标红 */
  workDocBroken?: boolean
  onImportWorkDoc?: () => void
  onRemoveWorkDoc?: () => void
  novelTitle?: string | null
  chapterCount?: number
  chapterRule?: ChapterRule
  onApplyChapterRule?: (rule: ChapterRule) => Promise<
    { ok: true; value: number } | { ok: false; reason: string }
  >
}

function setup(opts: SetupOptions = {}): {
  onDocTitleChange: ReturnType<typeof vi.fn>
  onDarkPaperChange: ReturnType<typeof vi.fn>
  onThemeSourceChange: ReturnType<typeof vi.fn>
  onPageFontSizeChange: ReturnType<typeof vi.fn>
  unmount: () => void
} {
  const onDocTitleChange = vi.fn()
  const onDarkPaperChange = vi.fn()
  const onThemeSourceChange = vi.fn()
  const onPageFontSizeChange = vi.fn()
  const {
    capture,
    docTitle = '文档1',
    darkPaper = false,
    themeSource = 'system',
    pageFontSize = PAGE_FONT_SIZE_DEFAULT,
    novelOpen = true,
    // 默认走 Windows 那一套：macOS 上 import 归原生菜单管，分发器会**跳过**它，
    // 于是「录制期间静音」那条用例在 darwin 下根本走不到分发器。
    shortcuts = resolveShortcuts({}, 'other'),
    platform = 'win32',
    onShortcutsChange = vi.fn(),
    // 工作文档那四个：默认「没导入、也没坏」。**必须在这里解构出来**，否则它们会被下面
    // 那个 `...provider` 带进 `ToolbarProvider`。
    //
    // 【那不是类型错——实测过：它是**静默**的】被 spread 的变量不触发多余属性检查：
    // 多一个不解构的字段、`tsc --noEmit -p tsconfig.json` 照样 exit 0（跑过）。
    // 失败形态是那个 prop 悄悄传进 provider 然后被忽略，没有任何东西会报。
    workDocTitle = null,
    workDocPath = null,
    workDocBroken = false,
    onImportWorkDoc = vi.fn(),
    onRemoveWorkDoc = vi.fn(),
    novelTitle = '测试书',
    chapterCount = 12,
    chapterRule = { kind: 'auto' },
    onApplyChapterRule = vi.fn(async () => ({ ok: true as const, value: 12 })),
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
          pageFontSize={pageFontSize}
          onPageFontSizeChange={onPageFontSizeChange}
          novelOpen={novelOpen}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          shortcuts={shortcuts}
          platform={platform}
          onShortcutsChange={onShortcutsChange}
          onRecordingChange={reportRecording}
          workDocTitle={workDocTitle}
          workDocPath={workDocPath}
          workDocBroken={workDocBroken}
          onImportWorkDoc={onImportWorkDoc}
          onRemoveWorkDoc={onRemoveWorkDoc}
          novelTitle={novelTitle}
          chapterCount={chapterCount}
          chapterRule={chapterRule}
          onApplyChapterRule={onApplyChapterRule}
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
  return {
    onDocTitleChange,
    onDarkPaperChange,
    onThemeSourceChange,
    onPageFontSizeChange,
    unmount
  }
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
          workDocTitle={null}
          workDocBroken={false}
          onImportWorkDoc={() => {}}
          onRemoveWorkDoc={() => {}}
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
 * 正文字号。
 *
 * 【它归「手动保存」那一组】改完点保存才生效——与文档名、阅读替换同一套。
 * 所以下面每一条都要连着断言「**还没点保存时不许提交**」，否则把 `commit` 挪回
 * onChange 上（立即生效）整组照样绿。
 */
describe('设置里的正文字号', () => {
  it('改了不立即生效，出保存按钮；点保存才提交', () => {
    const { onPageFontSizeChange } = setup({ pageFontSize: 15 })
    openViaButton()
    const input = screen.getByTestId('page-font-size-input') as HTMLInputElement
    expect(input.value).toBe('15')

    fireEvent.change(input, { target: { value: '18' } })
    expect(onPageFontSizeChange).not.toHaveBeenCalled()
    // 有改动 → 保存按钮出现（与「手动保存」那一组同一套显隐）
    expect(screen.getByTestId('settings-save')).toBeTruthy()

    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onPageFontSizeChange).toHaveBeenCalledWith(18)
  })

  it('失焦只归一化、不提交', () => {
    const { onPageFontSizeChange } = setup({ pageFontSize: 15 })
    openViaButton()
    const input = screen.getByTestId('page-font-size-input')
    fireEvent.change(input, { target: { value: '20' } })
    fireEvent.blur(input)
    expect(onPageFontSizeChange).not.toHaveBeenCalled()
    // 没有越界，所以也不该弹夹紧提示
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('回车＝保存', () => {
    const { onPageFontSizeChange } = setup({ pageFontSize: 15 })
    openViaButton()
    const input = screen.getByTestId('page-font-size-input')
    fireEvent.change(input, { target: { value: '20' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPageFontSizeChange).toHaveBeenCalledWith(20)
  })

  it('越界：失焦就夹紧并提示，但**还没生效**；回车保存夹紧后的值', () => {
    const { onPageFontSizeChange } = setup({ pageFontSize: 15 })
    openViaButton()
    const input = screen.getByTestId('page-font-size-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.blur(input)
    // 框里显示夹紧后的值、给一条提示，但回调还没发生
    expect(input.value).toBe(String(PAGE_FONT_SIZE_MAX))
    expect(screen.getByTestId('toast').textContent).toContain(String(PAGE_FONT_SIZE_MAX))
    expect(onPageFontSizeChange).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPageFontSizeChange).toHaveBeenCalledWith(PAGE_FONT_SIZE_MAX)
  })

  it('比下限还小同样夹到下限', () => {
    const { onPageFontSizeChange } = setup({ pageFontSize: 15 })
    openViaButton()
    const input = screen.getByTestId('page-font-size-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.blur(input)
    expect(input.value).toBe(String(PAGE_FONT_SIZE_MIN))
    expect(onPageFontSizeChange).not.toHaveBeenCalled()
  })

  it('解析不出的输入退回当前值（不留一个空草稿）', () => {
    // 留空草稿的话「保存」会一直亮着，而点下去什么都不提交——用户会以为按钮坏了。
    const { onPageFontSizeChange } = setup({ pageFontSize: 17 })
    openViaButton()
    const input = screen.getByTestId('page-font-size-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(input.value).toBe('17')
    // 草稿被拉回已提交值 → 算「没有改动」→ 保存按钮不出现
    expect(screen.queryByTestId('settings-save')).toBeNull()
    expect(onPageFontSizeChange).not.toHaveBeenCalled()
  })

  it('重开对话框时草稿不残留（关闭＝丢弃）', () => {
    const { onPageFontSizeChange } = setup({ pageFontSize: 15 })
    openViaButton()
    fireEvent.change(screen.getByTestId('page-font-size-input'), { target: { value: '22' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onPageFontSizeChange).not.toHaveBeenCalled()

    openViaButton()
    expect((screen.getByTestId('page-font-size-input') as HTMLInputElement).value).toBe('15')
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

  it('「当前书」比例框在没打开文档时给出的提示是文档中性的', () => {
    // 【为什么单独钉】那句话是用户可见文案，而且它描述的对象已经从「小说」变成了
    // 「当前显示的那一份」。实测：把它改回「未打开小说」，整套用例照样绿。
    setup({ novelOpen: false })
    openViaButton()
    expect(screen.getByText('未打开文档')).toBeTruthy()
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
    const update = onShortcutsChange.mock.calls.at(-1)![0] as (
      prev: Record<string, string | undefined>
    ) => Record<string, string | undefined>
    expect(update({})).toEqual(expect.objectContaining({ import: 'Ctrl+KeyI' }))
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
    // ……而且「和默认一样」时不该写进稀疏表：`{}` ＝ 全默认。
    const update = onShortcutsChange.mock.calls.at(-1)![0] as (
      prev: Record<string, string | undefined>
    ) => Record<string, string | undefined>
    expect(update({ import: 'Ctrl+KeyI' })).toEqual({})
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

describe('设置里的工作文档', () => {
  it('没导入时显示「未导入」，且没有「移除」按钮', () => {
    setup({})
    openViaButton()
    expect(screen.getByTestId('work-doc-status').textContent).toContain('未导入')
    expect(screen.queryByTestId('btn-remove-work-doc')).toBeNull()
    // 没有路径就**不给** title：`title=""` 会渲染一个空的小气泡
    expect(screen.getByTestId('work-doc-status').getAttribute('title')).toBeNull()
  })

  it('导入后显示文件名，并出现「移除」按钮', () => {
    setup({ workDocTitle: '季度汇报' })
    openViaButton()
    expect(screen.getByTestId('work-doc-status').textContent).toContain('季度汇报')
    expect(screen.getByTestId('btn-remove-work-doc')).toBeTruthy()
  })

  it('状态行的 title 是完整路径（那行会按 CSS 截断，长路径看不全）', () => {
    setup({ workDocTitle: '季度汇报', workDocPath: '/Users/某人/文档/2026Q3/季度汇报.txt' })
    openViaButton()
    expect(screen.getByTestId('work-doc-status').getAttribute('title')).toBe(
      '/Users/某人/文档/2026Q3/季度汇报.txt'
    )
  })

  /**
   * 【夹具为什么是「无名字 + 坏掉」这组】`workDocBroken` 唯一的置位点是 boot 里
   * `loadWorkDoc` 读不出来，而**同一条路上 `workNovel` 必然是 null**——于是 `workDocTitle`
   * 也恒为 null。「有名字 + 坏掉」是 `App` **产生不出来的**组合，用它当夹具正好好把下面
   * 那个洞盖住：既然永远有名字，「移除」按钮按名字 gate 也永远渲染得出来。
   */
  it('源文件读不出来时标红，并且「移除」按钮仍在（否则那个悬空路径没有入口清掉）', () => {
    setup({ workDocTitle: null, workDocPath: '/tmp/被移走的.txt', workDocBroken: true })
    openViaButton()
    const status = screen.getByTestId('work-doc-status')
    expect(status.textContent).toContain('读不出来')
    // 文案里不留一个永远填不上的名字位（曾经渲染成「⚠  读不出来了」，双空格）
    expect(status.textContent).not.toContain('  ')
    expect(screen.getByTestId('btn-remove-work-doc')).toBeTruthy()
    // 坏掉那一路**路径仍在**（刻意保留：文件可能只是临时不在），所以悬停提示照样给得出
    expect(status.getAttribute('title')).toBe('/tmp/被移走的.txt')
  })

  it('点导入/移除会调到对应的回调——它们是立即动作，不走「保存」', () => {
    const onImportWorkDoc = vi.fn()
    const onRemoveWorkDoc = vi.fn()
    setup({ workDocTitle: '季度汇报', onImportWorkDoc, onRemoveWorkDoc })
    openViaButton()

    fireEvent.click(screen.getByTestId('btn-import-work-doc'))
    expect(onImportWorkDoc).toHaveBeenCalledTimes(1)
    // 【这条钉的是「立即」】导入/移除刻意与「导入小说」「清除阅读记录」同类，
    // 不是草稿字段——文件选择框是外部动作，做成「选了文件还得再点保存」很别扭
    expect(screen.queryByTestId('settings-save')).toBeNull()

    fireEvent.click(screen.getByTestId('btn-remove-work-doc'))
    expect(onRemoveWorkDoc).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('settings-save')).toBeNull()
  })
})

/**
 * 左栏分页。
 *
 * 【为什么断言的是 `hidden` 属性而不是「看得见」】jsdom 没有布局，也没有真实的可见性
 * 语义，而本仓库没装 `@testing-library/jest-dom`——`toBeVisible()` 根本不存在。
 * 而 `hidden` 是 **DOM 属性**，正是这次用来藏非当前页的机制：断言它等于断言机制本身。
 *
 * 【为什么用 `hasAttribute` 而不是 `getAttribute() === ''`】React 对 `hidden` 走的是布尔
 * 属性，**实测过**（react-dom 19.3.0，`renderToStaticMarkup`）：`hidden={true}` 渲染成
 * `hidden=""`、`hidden={false}` 是**整条属性不出现**。但别把这个细节写进断言——
 * `hasAttribute` 对「有/没有」这个我们真正关心的问题成立，而 React 哪天改成
 * `hidden="true"` 这类形态，`hasAttribute` 仍然是对的。
 */
describe('设置对话框的左栏分页', () => {
  /** 五个面板是不是 hidden 的，按左栏从上到下的顺序 */
  const hiddenPages = (): boolean[] =>
    ['reading', 'library', 'appearance', 'shortcuts', 'chapters'].map((id) =>
      screen.getByTestId(`settings-tabpanel-${id}`).hasAttribute('hidden')
    )

  it('左栏五项的顺序是「阅读设置 / 小说管理 / 外观设置 / 快捷键设置 / 分章设置」', () => {
    setup()
    openViaButton()

    // 【必须按 DOM 顺序取，不能逐个 getByTestId】按 testid 取的话，结果数组的顺序来自左边
    // 那个字面量数组、**不是 DOM 顺序**——把 `PAGES` 排成「外观 / 阅读 / 快捷键」（左栏真的
    // 会变成那个顺序、真的违反设计第 1 节拍板的顺序），那一版**照样全绿**：它守的是「每个
    // 页签各自的文案」，守不住名字里的「顺序」。
    //
    // 【还得限定在左栏那个 tablist 里】裸的 `getAllByRole('tab')` 会把功能区那七个页签
    // （文件/开始/…/视图）一并捞出来——本用例渲染的是整个 App，`Ribbon.tsx` 的 `.wt-tabs`
    // 同样是 `role="tablist"` + `role="tab"`（实测拿到 10 个）。
    // 按 `aria-label="设置分类"` 限定到左栏之后，`within` 依旧**按 DOM 顺序**返回，
    // 一次同时验文案与顺序。
    expect(
      within(screen.getByRole('tablist', { name: '设置分类' }))
        .getAllByRole('tab')
        .map((el) => el.textContent)
    ).toEqual(['阅读设置', '小说管理', '外观设置', '快捷键设置', '分章设置'])
  })

  it('打开时停在「阅读设置」，其余页都是 hidden 的', () => {
    setup()
    openViaButton()

    expect(hiddenPages()).toEqual([false, true, true, true, true])
  })

  it('点「外观设置」：两页的 hidden 互换，aria-selected 跟着走', () => {
    setup()
    openViaButton()

    fireEvent.click(screen.getByTestId('settings-tab-appearance'))

    expect(hiddenPages()).toEqual([true, true, false, true, true])
    expect(screen.getByTestId('settings-tab-appearance').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('settings-tab-reading').getAttribute('aria-selected')).toBe('false')
  })

  it('点「快捷键设置」：那一页才显示', () => {
    setup()
    openViaButton()

    fireEvent.click(screen.getByTestId('settings-tab-shortcuts'))

    expect(hiddenPages()).toEqual([true, true, true, false, true])
  })

  it('行归属：阅读设置收文档名 / 阅读替换 / 输入模式 / 正文字号 / 小说 / 工作文档', () => {
    setup()
    openViaButton()
    const reading = screen.getByTestId('settings-tabpanel-reading')

    for (const id of [
      'doc-title-input',
      'global-ratio-input',
      'ratio-input',
      'mode-button',
      'page-font-size-input',
      'btn-import',
      'btn-clear-session',
      'work-doc-status',
      'btn-import-work-doc'
    ]) {
      expect(reading.contains(screen.getByTestId(id))).toBe(true)
    }

    // 外观与快捷键那几块**不**在这一页
    expect(reading.contains(screen.getByTestId('theme-dark'))).toBe(false)
    expect(reading.contains(screen.getByTestId('dark-paper'))).toBe(false)
    expect(reading.contains(screen.getByTestId('shortcut-import-input'))).toBe(false)
  })

  it('行归属：外观设置收主题与纸张，快捷键设置收六条快捷键', () => {
    setup()
    openViaButton()

    const appearance = screen.getByTestId('settings-tabpanel-appearance')
    expect(appearance.contains(screen.getByTestId('theme-system'))).toBe(true)
    expect(appearance.contains(screen.getByTestId('theme-light'))).toBe(true)
    expect(appearance.contains(screen.getByTestId('theme-dark'))).toBe(true)
    expect(appearance.contains(screen.getByTestId('dark-paper'))).toBe(true)

    const shortcuts = screen.getByTestId('settings-tabpanel-shortcuts')
    for (const def of SHORTCUTS) {
      expect(shortcuts.contains(screen.getByTestId(`shortcut-${def.id}-input`))).toBe(true)
      expect(shortcuts.contains(screen.getByTestId(`shortcut-${def.id}-reset`))).toBe(true)
    }
  })

  it('切页不丢草稿：在阅读设置改字号，切到外观设置后「保存」仍在、点下去照样提交', () => {
    const { onPageFontSizeChange } = setup()
    openViaButton()

    fireEvent.change(screen.getByTestId('page-font-size-input'), { target: { value: '20' } })
    fireEvent.click(screen.getByTestId('settings-tab-appearance'))

    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onPageFontSizeChange).toHaveBeenCalledWith(20)
  })

  it('关掉再打开，回到「阅读设置」（不记住上次那一页）', () => {
    setup()
    openViaButton()
    fireEvent.click(screen.getByTestId('settings-tab-shortcuts'))
    expect(hiddenPages()).toEqual([true, true, true, false, true])

    fireEvent.click(screen.getByTestId('settings-close'))
    openViaButton()

    expect(hiddenPages()).toEqual([false, true, true, true, true])
  })

  it('关掉再打开，焦点仍在文档名上（回到第一页还不够）', () => {
    // 【这条守的不是「焦点在对话框里」那件老事，而是它的一个**新**破口】`page` 是持久状态、
    // 组件在 open 为假时不卸载，所以重开的那一次提交里 page 可能还是旧值——非当前页带着
    // `hidden`，而**对 hidden（display:none）子树里的元素调 focus() 是 no-op**，于是
    // `autoFocus` 静默失效。
    //
    // 【焦点落在哪儿：隐形 textarea，不是 body】**实测**出来的（这条用例第一次跑、
    // 修还没上时，红灯里 `document.activeElement` 就是 `<textarea data-testid="input-capture">`）：
    // `SettingsDialog` 自己那条 effect 在**关闭**时把焦点交给了它，重开时 `autoFocus` 失效，
    // 焦点就原地留在那个 textarea 上。这比「落在 body 上」更糟——落在 body 上还要用户再点
    // 一下才会被抢回去，而隐形 textarea **本来就是抽字那条路的入口**：`InputCapture` 里那道
    // `role="dialog"` 闸**只存在于抢焦点的 `focusIfNotTextInput` 里**，`handleKeyDown` 与
    // `handleInput` 上**一条都没有**。所以焦点一落在那儿，按键**立刻**开始抽字。
    //
    // 光把 page 拉回 'reading' **不够**：`autoFocus` 只在挂载那一次跑，input 不会重新挂载。
    // 所以修法是让「打开」的那一次提交本身就是对的（见 `SettingsDialog` 里那段渲染期重置）。
    setup({ capture: true })
    openViaButton()
    fireEvent.click(screen.getByTestId('settings-tab-shortcuts'))
    fireEvent.click(screen.getByTestId('settings-close'))
    openViaButton()

    expect(document.activeElement).toBe(screen.getByTestId('doc-title-input'))
  })
})

/**
 * 左栏的键盘与录制。
 *
 * 【这一组里几条为什么单测判得了】
 * - `hidden` 是 DOM 属性，判得了（上面那一组同理）。
 * - 方向键换页之后焦点跟不跟过去，判的是 `document.activeElement`——**jsdom 里判得了**，
 *   因为那是我们自己在 keydown 处理里显式 `focus()` 的，不依赖浏览器的命中测试。
 * - 「切页取消录制」判的是报给外面的布尔值，与真机行为无关。
 *
 * 判不了的（只能真机）：面板实际画出来多宽、滚动条出没出来、深色下页签的底色。
 * 那几条在文末的验收清单里。
 */
describe('设置对话框左栏的键盘与录制', () => {
  const hiddenPages = (): boolean[] =>
    ['reading', 'library', 'appearance', 'shortcuts', 'chapters'].map((id) =>
      screen.getByTestId(`settings-tabpanel-${id}`).hasAttribute('hidden')
    )

  it('切页会取消正在进行的录制（否则分发器一直哑着，而用户看不出为什么）', () => {
    const onRecordingChange = vi.fn()
    setup({ onRecordingChange })
    openViaButton()

    fireEvent.click(screen.getByTestId('settings-tab-shortcuts'))
    fireEvent.click(screen.getByTestId('shortcut-import-input'))
    expect(onRecordingChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByTestId('settings-tab-appearance'))

    expect(onRecordingChange).toHaveBeenLastCalledWith(false)
  })

  it('↓ / ↑ 在左栏里移动、当场切页，焦点跟着落到新页签上', () => {
    setup()
    openViaButton()
    const reading = screen.getByTestId('settings-tab-reading')

    fireEvent.keyDown(reading, { key: 'ArrowDown' })

    expect(hiddenPages()).toEqual([true, false, true, true, true])
    expect(document.activeElement).toBe(screen.getByTestId('settings-tab-library'))

    fireEvent.keyDown(screen.getByTestId('settings-tab-library'), { key: 'ArrowUp' })

    expect(hiddenPages()).toEqual([false, true, true, true, true])
    expect(document.activeElement).toBe(reading)
  })

  it('↑ 从第一项绕到最后一项，↓ 从最后一项绕回第一项', () => {
    setup()
    openViaButton()

    fireEvent.keyDown(screen.getByTestId('settings-tab-reading'), { key: 'ArrowUp' })
    expect(hiddenPages()).toEqual([true, true, true, true, false])

    fireEvent.keyDown(screen.getByTestId('settings-tab-chapters'), { key: 'ArrowDown' })
    expect(hiddenPages()).toEqual([false, true, true, true, true])
  })

  it('Home / End 跳到第一页 / 最后一页，焦点也跟着落过去', () => {
    // 【「焦点也跟着」这半句不能省】设计第 8.1 节第 8 条要求的是 ↑/↓/Home/End **都**把焦点
    // 带过去，而只断言 `hiddenPages` 是不够的——变异实测过：把 `focus()` 限制成只对
    // ArrowUp / ArrowDown 调，只断言 `hiddenPages` 的那一版**全绿**。也就是说那半句此前
    // 无人看住。
    setup()
    openViaButton()

    fireEvent.keyDown(screen.getByTestId('settings-tab-reading'), { key: 'End' })
    expect(hiddenPages()).toEqual([true, true, true, true, false])
    expect(document.activeElement).toBe(screen.getByTestId('settings-tab-chapters'))

    fireEvent.keyDown(screen.getByTestId('settings-tab-chapters'), { key: 'Home' })
    expect(hiddenPages()).toEqual([false, true, true, true, true])
    expect(document.activeElement).toBe(screen.getByTestId('settings-tab-reading'))
  })

  it('方向键之外的键不动页签（左栏不该吃掉别的按键）', () => {
    setup()
    openViaButton()
    const reading = screen.getByTestId('settings-tab-reading')

    // 【逐键断言，绝不能只断言末态】五页下每键各前进一页时，三个键会把页面推到快捷键设置；
    // 而「哪一个键被误认」在场次之间可能落到同一页，末态看不出是哪一下动的。
    // 这正是「用例声称自身输入时要自检前提」那种形态。
    for (const key of ['ArrowLeft', 'a', 'Enter']) {
      fireEvent.keyDown(reading, { key })
      expect(hiddenPages()).toEqual([false, true, true, true, true])
    }
  })
})

describe('设置里的分章规则', () => {
  function openChapters(): void {
    openViaButton()
    fireEvent.click(screen.getByTestId('settings-tab-chapters'))
  }

  it('新增「分章设置」页，没有小说时禁用并提示', () => {
    setup({ novelTitle: null })
    openChapters()
    expect((screen.getByTestId('settings-tabpanel-chapters') as HTMLElement).hidden).toBe(false)
    expect((screen.getByTestId('chapter-rule-apply') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('chapter-current').textContent).toContain('未导入')
  })

  it('顶部显示当前小说与章数', () => {
    setup({ novelTitle: '测试书', chapterCount: 12 })
    openChapters()
    expect(screen.getByTestId('chapter-current').textContent).toContain('测试书')
    expect(screen.getByTestId('chapter-current').textContent).toContain('12')
  })

  it('打开时选中这本书当前保存的规则', () => {
    setup({ chapterRule: { kind: 'preset', id: 'numbered' } })
    openChapters()
    expect((screen.getByTestId('chapter-rule-preset-numbered') as HTMLInputElement).checked).toBe(true)
  })

  it('选中自定义正则后出现输入框；非法正则时应用按钮禁用', () => {
    setup()
    openChapters()
    fireEvent.click(screen.getByTestId('chapter-rule-custom'))
    const input = screen.getByTestId('chapter-rule-pattern') as HTMLInputElement
    fireEvent.change(input, { target: { value: '(' } })
    expect(screen.getByTestId('chapter-rule-error')).toBeTruthy()
    expect((screen.getByTestId('chapter-rule-apply') as HTMLButtonElement).disabled).toBe(true)
  })

  it('应用预置规则：回调收到规则并显示新章数', async () => {
    const onApplyChapterRule = vi.fn(async () => ({ ok: true as const, value: 42 }))
    setup({ onApplyChapterRule })
    openChapters()
    fireEvent.click(screen.getByTestId('chapter-rule-preset-numbered'))
    fireEvent.click(screen.getByTestId('chapter-rule-apply'))
    await waitFor(() =>
      expect(screen.getByTestId('chapter-rule-result').textContent).toContain('42')
    )
    expect(onApplyChapterRule).toHaveBeenCalledWith({ kind: 'preset', id: 'numbered' })
  })

  it('应用失败时显示失败原因', async () => {
    const onApplyChapterRule = vi.fn(async () => ({
      ok: false as const,
      reason: '没有识别出任何章节，目录未改动'
    }))
    setup({ onApplyChapterRule })
    openChapters()
    fireEvent.click(screen.getByTestId('chapter-rule-apply'))
    await waitFor(() =>
      expect(screen.getByTestId('chapter-rule-result').textContent).toContain('没有识别出任何章节')
    )
  })

  it('选中自定义但未输入时提示先写一条正则', () => {
    setup()
    openChapters()
    fireEvent.click(screen.getByTestId('chapter-rule-custom'))
    expect(screen.getByTestId('chapter-rule-empty').textContent).toContain('先写一条正则')
  })

  it('应用执行中按钮显示处理中并禁用', async () => {
    let resolveApply!: (r: { ok: true; value: number }) => void
    const onApplyChapterRule = vi.fn(
      () =>
        new Promise<{ ok: true; value: number }>((resolve) => {
          resolveApply = resolve
        })
    )
    setup({ onApplyChapterRule })
    openChapters()
    fireEvent.click(screen.getByTestId('chapter-rule-apply'))
    const button = screen.getByTestId('chapter-rule-apply') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('处理中')
    resolveApply({ ok: true, value: 3 })
    await waitFor(() =>
      expect(screen.getByTestId('chapter-rule-result').textContent).toContain('3')
    )
    expect(button.disabled).toBe(false)
    expect(button.textContent).toContain('应用')
  })

  it('应用抛错时显示失败提示并恢复按钮', async () => {
    const onApplyChapterRule = vi.fn(async () => {
      throw new Error('boom')
    })
    setup({ onApplyChapterRule })
    openChapters()
    fireEvent.click(screen.getByTestId('chapter-rule-apply'))
    await waitFor(() =>
      expect(screen.getByTestId('chapter-rule-result').textContent).toContain('分章失败')
    )
    const button = screen.getByTestId('chapter-rule-apply') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.textContent).toContain('应用')
  })

  it('改了草稿后旧的「已重新分为」提示消失', async () => {
    setup({ onApplyChapterRule: vi.fn(async () => ({ ok: true as const, value: 3 })) })
    openChapters()
    fireEvent.click(screen.getByTestId('chapter-rule-apply'))
    await waitFor(() =>
      expect(screen.getByTestId('chapter-rule-result').textContent).toContain('3')
    )
    fireEvent.click(screen.getByTestId('chapter-rule-preset-numbered'))
    expect(screen.queryByTestId('chapter-rule-result')).toBeNull()
  })

  it('radiogroup 里只有 radio，应用按钮不在组内', () => {
    setup()
    openChapters()
    const group = screen.getByRole('radiogroup', { name: '章节识别规则' })
    expect(within(group).getAllByRole('radio')).toHaveLength(6)
    expect(within(group).queryByTestId('chapter-rule-apply')).toBeNull()
  })

  it('自定义正则合法时回调收到 custom 规则', async () => {
    const onApplyChapterRule = vi.fn(async () => ({ ok: true as const, value: 5 }))
    setup({ onApplyChapterRule })
    openChapters()
    fireEvent.click(screen.getByTestId('chapter-rule-custom'))
    fireEvent.change(screen.getByTestId('chapter-rule-pattern'), {
      target: { value: '^第.+章.*$' }
    })
    fireEvent.click(screen.getByTestId('chapter-rule-apply'))
    await waitFor(() =>
      expect(onApplyChapterRule).toHaveBeenCalledWith({ kind: 'custom', pattern: '^第.+章.*$' })
    )
  })

  it('自定义只有空白时提示先写一条正则，而不是报不合法', () => {
    setup()
    openChapters()
    fireEvent.click(screen.getByTestId('chapter-rule-custom'))
    fireEvent.change(screen.getByTestId('chapter-rule-pattern'), { target: { value: '   ' } })
    expect(screen.getByTestId('chapter-rule-empty')).toBeTruthy()
    expect(screen.queryByTestId('chapter-rule-error')).toBeNull()
    expect((screen.getByTestId('chapter-rule-apply') as HTMLButtonElement).disabled).toBe(true)
  })
})
