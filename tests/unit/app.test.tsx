import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import App from '../../src/renderer/src/App'
import { splitChapters } from '../../src/core/chapters'
import type { Novel, PersistedSession } from '../../src/core/types'

function makeNovel(): Novel {
  const text = '第一章 甲\nAAAAAAAAAA\n第二章 乙\nBBBBBBBBBB\n'
  const { flatText, chapters } = splitChapters(text, '测试书')
  return { title: '测试书', sourcePath: '/tmp/测试书.txt', encoding: 'UTF-8', hadBom: false, flatText, chapters }
}

let saved: PersistedSession | null = null

function installApi(novel: Novel | null, session: PersistedSession | null = null): void {
  saved = null
  ;(window as unknown as { api: unknown }).api = {
    importNovel: vi.fn(async () => novel),
    openNovelPath: vi.fn(async () => novel as Novel),
    initialNovelPath: vi.fn(async () => null),
    loadSession: vi.fn(async () => session),
    saveSession: vi.fn(async (s: PersistedSession) => {
      saved = s
    }),
    clearSession: vi.fn(async () => {}),
    onMenuCommand: vi.fn(() => () => {})
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('App 端到端（单测层）', () => {
  it('未导入时阅读区是空状态', async () => {
    installApi(null)
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('page-empty')).toBeTruthy())
    expect(screen.getByTestId('status-chapter').textContent).toBe('未导入')
  })

  it('导入后蓝条上不出现小说文件名（那是导入唯一的泄露点）', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)

    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 修复前这里是 `novel.title`（= 文件名「测试书」），等于把「在看小说」写在窗口最显眼处
    expect(screen.getByTestId('doc-title').textContent).toBe('文档1')
    expect(screen.getByTestId('ribbon').textContent).not.toContain('测试书')
  })

  it('导入小说后可打字，阅读区按比例增长', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)

    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    // 默认比例 10，敲 1 个键应显示 10 个字
    fireEvent.input(capture, { target: { value: 'x' } })
    await waitFor(() => expect(screen.getByTestId('status-chars').textContent).toContain('已显示 10'))
    expect(screen.getByTestId('page-text').textContent!.length).toBeGreaterThanOrEqual(10)
  })

  it('退格回吐显示，但小说内容不变', async () => {
    const novel = makeNovel()
    const originalFlat = novel.flatText
    installApi(novel)
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    fireEvent.input(capture, { target: { value: 'x' } })
    await waitFor(() => expect(screen.getByTestId('status-chars').textContent).toContain('已显示 10'))

    fireEvent.keyDown(capture, { key: 'Backspace' })
    await waitFor(() => expect(screen.getByTestId('status-chars').textContent).toContain('已显示 0'))
    expect(novel.flatText).toBe(originalFlat)
  })

  it('点击章节跳转，当前章高亮跟随', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-1')).toBeTruthy())

    fireEvent.click(screen.getByTestId('chapter-item-1'))
    await waitFor(() => expect(screen.getByTestId('status-chapter').textContent).toContain('第 2 章'))
    expect(screen.getByTestId('chapter-item-1').className).toContain('chapter-item--active')

    // 跳章之后阅读区是**空的**：显示窗口从该章开头起算，而这一章还没读过。
    // 少了这一条，「已显示」把 revealStart 漏掉（写成 cursor）也没人发现——
    // 变异实测：把 `state.cursor - state.revealStart` 改成 `state.cursor`，全套用例全绿。
    expect(screen.getByTestId('status-chars').textContent).toContain('已显示 0')
  })

  it('改比例后同样的击键抽出更多字', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 比例输入框挂在「开始」「视图」两个选项卡下，而导入按钮在「文件」选项卡下——
    // Ribbon 只渲染当前选项卡的工具组，切回「开始」它才在 DOM 里。
    fireEvent.click(screen.getByTestId('tab-开始'))

    const ratioInput = screen.getByTestId('ratio-input')
    fireEvent.change(ratioInput, { target: { value: '2' } })
    fireEvent.keyDown(ratioInput, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:2'))

    const capture = screen.getByTestId('input-capture')
    fireEvent.input(capture, { target: { value: 'x' } })
    await waitFor(() => expect(screen.getByTestId('status-chars').textContent).toContain('已显示 2'))
  })

  it('有会话时启动即恢复到上次位置，无需重新输入', async () => {
    const novel = makeNovel()
    const session: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: '/tmp/测试书.txt',
      ratio: 5,
      mode: 'key',
      cursor: 15,
      revealStart: 0,
      chapterPos: [15, 0],
      activeChapter: 0,
      startedAt: null
    }
    installApi(novel, session)
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('status-chars').textContent).toContain('已显示 15'))
    expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:5')
    expect(screen.getByTestId('status-mode').textContent).toBe('输入模式 纯按键')
    expect(screen.getByTestId('page-text').textContent).toContain(novel.flatText.slice(0, 15))
  })

  it('清除阅读记录后回到空状态', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    fireEvent.click(screen.getByTestId('btn-clear-session'))
    await waitFor(() => expect(screen.getByTestId('page-empty')).toBeTruthy())
    expect(window.api.clearSession).toHaveBeenCalled()
  })

  it('打字后会防抖保存会话', async () => {
    const novel = makeNovel()
    installApi(novel)
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-文件'))
    fireEvent.click(screen.getByTestId('btn-import'))
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    const saveSession = window.api.saveSession as unknown as { mock: { calls: unknown[] } }
    const before = saveSession.mock.calls.length

    // 连着敲 3 下（每次都是状态变化），但都发生在防抖窗口之内
    fireEvent.input(capture, { target: { value: 'x' } })
    fireEvent.input(capture, { target: { value: 'x' } })
    fireEvent.input(capture, { target: { value: 'x' } })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved!.cursor).toBe(30)
    expect(saved!.sourcePath).toBe('/tmp/测试书.txt')

    // 【防抖本身也要断言】：只断言「最终写了一次」的话，把防抖整个删掉
    //（每次状态变化都立刻写）用例照样全绿——变异实测确认过。3 次击键 + 推进一次
    // 防抖窗口，应当**恰好写一次**（写的是最后那个状态）。
    expect(saveSession.mock.calls.length - before).toBe(1)
  })

  it('没有 window.api 时也渲染出外壳，不抛（sandboxed preload 加载失败）', async () => {
    // 把 setup.ts 那份良性桩摘掉，模拟 Task 6 实测过的形态：preload 加载失败时
    // 页面照常渲染，而 window.api === undefined。global.d.ts 把它声明成必填，
    // 所以类型层面不会提醒任何人——这条用例是 App 里那几处 api 判空的唯一守卫。
    // 两种失败形态都会被抓到：effect 里同步抛（render 直接红），以及 void boot() 里
    // 的 unhandled rejection（用例行照旧 passed，但汇总行多一条 Errors、exit code 是 1）。
    delete (window as unknown as { api?: unknown }).api

    expect(() => render(<App />)).not.toThrow()
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId('app-root')).toBeTruthy()
    expect(screen.getByTestId('page-empty')).toBeTruthy()
    expect(screen.getByTestId('status-chapter').textContent).toBe('未导入')
    expect(screen.getByTestId('status-chars').textContent).toContain('已显示 0')
  })
})
