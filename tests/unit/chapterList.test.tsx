import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChapterList, ROW_HEIGHT } from '../../src/renderer/src/components/ChapterList'
import { splitChapters } from '../../src/core/chapters'
import type { Novel } from '../../src/core/types'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
})

function makeNovel(count: number): Novel {
  const text = Array.from({ length: count }, (_, i) => `第${i + 1}章 标题${i + 1}\n正文内容。`).join('\n')
  const { flatText, chapters } = splitChapters(text, '大书')
  return {
    title: '大书',
    sourcePath: '/tmp/大书.txt',
    encoding: 'UTF-8',
    hadBom: false,
    flatText,
    chapters
  }
}

function makeVolumeNovel(): Novel {
  const chapters = [
    { index: 0, title: '前言', start: 0, end: 10, charCount: 10 },
    { index: 1, title: '第一卷 起势', start: 10, end: 20, charCount: 10 },
    { index: 2, title: '第1章 开端', start: 20, end: 40, charCount: 20 },
    { index: 3, title: '第二卷 承接', start: 40, end: 50, charCount: 10 },
    { index: 4, title: '第2章 相遇', start: 50, end: 70, charCount: 20 }
  ]
  return {
    title: '大书',
    sourcePath: '/tmp/大书.txt',
    encoding: 'UTF-8',
    hadBom: false,
    flatText: 'x'.repeat(70),
    chapters
  }
}

describe('ChapterList 导航窗格', () => {
  it('未导入时显示引导文案，不渲染搜索框与树', () => {
    render(<ChapterList novel={null} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByText('未导入小说')).toBeTruthy()
    expect(screen.getByText('文件 → 设置 → 导入小说')).toBeTruthy()
    expect(screen.queryByTestId('nav-search')).toBeNull()
    expect(screen.queryByTestId('chapter-list')).toBeNull()
  })

  it('书名作为树根，顶部是「导航」与搜索框', () => {
    render(<ChapterList novel={makeNovel(5)} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByText('导航')).toBeTruthy()
    expect(screen.getByTestId('tree-book').textContent).toContain('大书')
    expect(screen.getByTestId('nav-search')).toBeTruthy()
  })

  it('卷是第二层、卷下章节第三层，箭头收起后章节消失', () => {
    const onJump = vi.fn()
    render(<ChapterList novel={makeVolumeNovel()} activeChapter={1} chapterPos={[]} onJump={onJump} />)

    expect(screen.getByTestId('chapter-item-0').style.paddingLeft).toBe('24px')
    expect(screen.getByTestId('chapter-item-1').className).toContain('chapter-item--volume')
    expect(screen.getByTestId('chapter-item-1').style.paddingLeft).toBe('24px')
    expect(screen.getByTestId('chapter-item-2').style.paddingLeft).toBe('38px')
    expect(screen.getByTestId('chapter-item-1').className).toContain('chapter-item--active')

    fireEvent.click(screen.getByTestId('volume-toggle-1'))
    expect(screen.queryByTestId('chapter-item-2')).toBeNull()
    expect(onJump).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('volume-toggle-1'))
    expect(screen.getByTestId('chapter-item-2')).toBeTruthy()

    fireEvent.click(screen.getByTestId('chapter-item-1'))
    expect(onJump).toHaveBeenCalledWith(1)
  })

  it('点书名行收起整棵树', () => {
    render(<ChapterList novel={makeNovel(3)} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    fireEvent.click(screen.getByTestId('tree-book'))
    expect(screen.queryByTestId('chapter-item-0')).toBeNull()
    fireEvent.click(screen.getByTestId('tree-book'))
    expect(screen.getByTestId('chapter-item-0')).toBeTruthy()
  })

  it('当前章带高亮类', () => {
    render(<ChapterList novel={makeNovel(10)} activeChapter={2} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByTestId('chapter-item-2').className).toContain('chapter-item--active')
    expect(screen.getByTestId('chapter-item-1').className).not.toContain('chapter-item--active')
  })

  it('百分比只给当前章与已读章', () => {
    const novel = makeNovel(4)
    const c0 = novel.chapters[0]
    render(
      <ChapterList
        novel={novel}
        activeChapter={0}
        chapterPos={[Math.floor(c0.charCount / 2), 0, 0, 0]}
        onJump={() => {}}
      />
    )
    expect(screen.getByTestId('chapter-pct-0').textContent).toBe('50%')
    expect(screen.queryByTestId('chapter-pct-1')).toBeNull()
    expect(screen.queryByTestId('chapter-pct-2')).toBeNull()
  })

  it('当前章即使 0% 也显示', () => {
    render(
      <ChapterList novel={makeNovel(3)} activeChapter={1} chapterPos={[0, 0, 0]} onJump={() => {}} />
    )
    expect(screen.getByTestId('chapter-pct-1').textContent).toBe('0%')
    expect(screen.queryByTestId('chapter-pct-0')).toBeNull()
  })

  it('已读章显示数值，进度封顶 100', () => {
    const novel = makeNovel(3)
    const stale = novel.chapters[0].charCount * 2
    render(
      <ChapterList novel={novel} activeChapter={1} chapterPos={[stale, 0, 0]} onJump={() => {}} />
    )
    expect(screen.getByTestId('chapter-pct-0').textContent).toBe('100%')
  })

  it('chapterPos 缺项按 0 计', () => {
    render(<ChapterList novel={makeNovel(5)} activeChapter={4} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByTestId('chapter-pct-4').textContent).toBe('0%')
  })

  it('搜索只保留命中的章节，并保留它的卷父节点', () => {
    render(
      <ChapterList novel={makeVolumeNovel()} activeChapter={0} chapterPos={[]} onJump={() => {}} />
    )
    fireEvent.change(screen.getByTestId('nav-search'), { target: { value: '开端' } })
    expect(screen.getByTestId('chapter-item-1')).toBeTruthy()
    expect(screen.getByTestId('chapter-item-2')).toBeTruthy()
    expect(screen.queryByTestId('chapter-item-0')).toBeNull()
    expect(screen.queryByTestId('chapter-item-4')).toBeNull()
  })

  it('搜索无结果时给出提示', () => {
    render(<ChapterList novel={makeNovel(3)} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    fireEvent.change(screen.getByTestId('nav-search'), { target: { value: '不存在' } })
    expect(screen.getByTestId('nav-empty').textContent).toBe('没有匹配的章节')
  })

  it('Esc 清空，Enter 跳到第一条命中', () => {
    const onJump = vi.fn()
    render(<ChapterList novel={makeNovel(5)} activeChapter={0} chapterPos={[]} onJump={onJump} />)
    const input = screen.getByTestId('nav-search') as HTMLInputElement
    fireEvent.change(input, { target: { value: '标题4' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onJump).toHaveBeenCalledWith(3)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
    expect(screen.getByTestId('chapter-item-0')).toBeTruthy()
  })

  it('搜索时卷临时展开，清空后恢复收起', () => {
    render(
      <ChapterList novel={makeVolumeNovel()} activeChapter={0} chapterPos={[]} onJump={() => {}} />
    )
    fireEvent.click(screen.getByTestId('volume-toggle-1'))
    expect(screen.queryByTestId('chapter-item-2')).toBeNull()

    const input = screen.getByTestId('nav-search') as HTMLInputElement
    fireEvent.change(input, { target: { value: '开端' } })
    expect(screen.getByTestId('chapter-item-2')).toBeTruthy()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('chapter-item-2')).toBeNull()
  })

  it('点按钮收起整条左栏，章节列表一起消失；再点一次展开', () => {
    render(<ChapterList novel={makeNovel(5)} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByTestId('chapter-list')).toBeTruthy()

    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    expect(screen.queryByTestId('chapter-list')).toBeNull()
    expect(screen.queryByTestId('chapter-item-0')).toBeNull()

    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    expect(screen.getByTestId('chapter-list')).toBeTruthy()
    expect(screen.getByTestId('chapter-item-0')).toBeTruthy()
  })

  it('收起后细缝按钮仍在，且真的能把它调回来', () => {
    render(<ChapterList novel={makeNovel(5)} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    const rail = screen.getByTestId('sidebar-toggle')
    expect(rail.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(rail)
    expect(screen.getByTestId('chapter-list')).toBeTruthy()
  })

  it('title 里显示的是传进来的快捷键', () => {
    render(
      <ChapterList
        novel={makeNovel(5)}
        activeChapter={0}
        chapterPos={[]}
        onJump={() => {}}
        sidebarShortcut="⌃⌥J"
      />
    )
    expect(screen.getByTestId('sidebar-toggle').getAttribute('title')).toContain('⌃⌥J')
    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    expect(screen.getByTestId('sidebar-toggle').getAttribute('title')).toContain('⌃⌥J')
  })

  it('行高常量与样式一致', () => {
    expect(ROW_HEIGHT).toBe(28)
  })
})

describe('ChapterList 虚拟滚动', () => {
  const OVERSCAN = 6
  const VIEWPORT_FALLBACK = 400

  it('滚动后重算可视窗口，换出不同的行', () => {
    const novel = makeNovel(3000)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByTestId('chapter-item-0')).toBeTruthy()
    expect(screen.queryByTestId('chapter-item-2000')).toBeNull()

    const el = screen.getByTestId('chapter-list') as HTMLDivElement
    el.scrollTop = 2000 * ROW_HEIGHT
    fireEvent.scroll(el)

    expect(screen.getByTestId('chapter-item-2000')).toBeTruthy()
    expect(screen.queryByTestId('chapter-item-0')).toBeNull()
  })

  it('窗口在可视区两端各多渲染 OVERSCAN 行', () => {
    const novel = makeNovel(3000)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    const el = screen.getByTestId('chapter-list') as HTMLDivElement
    el.scrollTop = 2000 * ROW_HEIGHT
    fireEvent.scroll(el)

    const firstRow = 2000 - OVERSCAN
    const lastRow = Math.ceil((2000 * ROW_HEIGHT + VIEWPORT_FALLBACK) / ROW_HEIGHT) + OVERSCAN
    expect(screen.getByTestId(`chapter-item-${firstRow - 1}`)).toBeTruthy()
    expect(screen.queryByTestId(`chapter-item-${firstRow - 2}`)).toBeNull()
    expect(screen.getByTestId(`chapter-item-${lastRow - 2}`)).toBeTruthy()
    expect(screen.queryByTestId(`chapter-item-${lastRow - 1}`)).toBeNull()
  })
})

describe('ChapterList 当前章节自动滚进可视区', () => {
  it('当前章节在视口下方时滚到行底对齐，在上方时滚到行顶对齐', () => {
    const novel = makeNovel(200)
    const { rerender } = render(
      <ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />
    )
    const el = screen.getByTestId('chapter-list') as HTMLDivElement
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 400 })
    el.scrollTop = 0

    rerender(<ChapterList novel={novel} activeChapter={30} chapterPos={[]} onJump={() => {}} />)
    expect(el.scrollTop).toBe(31 * ROW_HEIGHT + ROW_HEIGHT - 400)

    rerender(<ChapterList novel={novel} activeChapter={25} chapterPos={[]} onJump={() => {}} />)
    expect(el.scrollTop).toBe(31 * ROW_HEIGHT + ROW_HEIGHT - 400)

    rerender(<ChapterList novel={novel} activeChapter={2} chapterPos={[]} onJump={() => {}} />)
    expect(el.scrollTop).toBe(3 * ROW_HEIGHT)
  })
})
