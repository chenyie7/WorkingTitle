import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChapterList, ROW_HEIGHT } from '../../src/renderer/src/components/ChapterList'
import { splitChapters } from '../../src/core/chapters'
import type { Novel } from '../../src/core/types'

beforeAll(() => {
  // jsdom 不实现 ResizeObserver
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

describe('ChapterList', () => {
  it('未导入时显示引导文案', () => {
    render(<ChapterList novel={null} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByText('未导入小说')).toBeTruthy()
    // 导入按钮搬进设置对话框之后，这条引导文案跟着改了（旧的指向一个已经不存在的按钮）
    expect(screen.getByText('文件 → 设置 → 导入小说')).toBeTruthy()
  })

  it('显示书名与章节数', () => {
    const novel = makeNovel(5)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByText('大书')).toBeTruthy()
    expect(screen.getByText(/共 5 章/)).toBeTruthy()
  })

  it('点按钮收起整条左栏，章节列表一起消失；再点一次展开', () => {
    const novel = makeNovel(5)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByText('大书')).toBeTruthy()
    expect(screen.getByTestId('chapter-list')).toBeTruthy()

    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    // 书名、【章节列表本身】、以及里面的行，都要没
    expect(screen.queryByText('大书')).toBeNull()
    expect(screen.queryByText(/共 5 章/)).toBeNull()
    expect(screen.queryByTestId('chapter-list')).toBeNull()
    expect(screen.queryByTestId('chapter-item-0')).toBeNull()
    expect(screen.queryByTestId('chapter-pct-0')).toBeNull()

    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    expect(screen.getByText('大书')).toBeTruthy()
    expect(screen.getByTestId('chapter-list')).toBeTruthy()
    expect(screen.getByTestId('chapter-item-0')).toBeTruthy()
  })

  it('收起后细缝按钮仍在，且真的能把它调回来', () => {
    const novel = makeNovel(5)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    // 只断言「按钮还在」不够——一个点不动的残留按钮也能过。要断言它真的切回来了。
    const rail = screen.getByTestId('sidebar-toggle')
    expect(rail.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(rail)
    expect(screen.getByText('大书')).toBeTruthy()
    expect(screen.getByTestId('chapter-list')).toBeTruthy()
  })

  // 【原来的「⌘/Ctrl + Shift + H 与按钮等效」与「少了 Shift 或修饰键时不触发」两条删掉了】
  // 它们断言的是本组件自己那个 window keydown 监听，而那条监听已经归全局分发器
  // （见 ChapterList.tsx 里那段注释）。留在原处会全红；而按组件改写成「空转的绿」更糟——
  // 树里没有分发器，无论那条监听在不在，`collapsed` 都不会翻。
  //
  // 覆盖去哪了，逐条说清楚（别以为这两件事没人测）：
  //
  //  - **「按 ⌘⇧H 等效于点按钮」拆成了两半**。前半（按键 → `toggle-sidebar` 这个 action）由
  //    `tests/unit/shortcutDispatch.test.ts` 覆盖：它断言 darwin 上按 ⌘⇧H 会调到那个 action。
  //    后半（action → `App` 里那个状态 → 侧栏真的切换）由 `tests/unit/app.test.tsx` 的
  //    「按章节栏快捷键真的收起、又展开」与「点章节栏那个按钮也真的收起、又展开」一起覆盖
  //    ——一条走分发器那条路，一条走受控回调那条路。**这两条要渲染整棵 `App`**，本文件是
  //    直接渲染 `ChapterList` 的，树里没有分发器，接不上那两段。
  //  - **「少了 Shift 或修饰键时不触发」也在分发器里**：裸键由那句
  //    `if (!e.ctrlKey && !e.metaKey && !e.altKey) return` 提前放行，修饰键少一个则落在
  //    表查找不中。`shortcutDispatch.test.ts` 的「裸按键一律放行」与「没配上的组合不触发」
  //    覆盖的是这两条路，而**这几个具体形态（裸 H / 只按 Shift+H / 只按 ⌘+H）没有专门用例**。

  it('title 里显示的是传进来的快捷键，不是写死的 ⌘/Ctrl + Shift + H', () => {
    // 传一个**两条默认值都推不出来**的串：jsdom 里 `window.api.platform` 是 darwin，
    // 若拿 '⌘⇧H'（该平台的默认值）当期望值，一个忽略 prop、自己推默认值的实现同样能过。
    const novel = makeNovel(5)
    render(
      <ChapterList
        novel={novel}
        activeChapter={0}
        chapterPos={[]}
        onJump={() => {}}
        sidebarShortcut="⌃⌥J"
      />
    )
    expect(screen.getByTestId('sidebar-toggle').getAttribute('title')).toContain('⌃⌥J')

    // 收起之后换成细缝那个按钮——它的 title 同样得跟着 prop 走（两处原本各写死了一份）
    fireEvent.click(screen.getByTestId('sidebar-toggle'))
    expect(screen.getByTestId('sidebar-toggle').getAttribute('title')).toContain('⌃⌥J')
  })

  it('章节很多时只渲染可视区附近的行（虚拟滚动）', () => {
    const novel = makeNovel(2000)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    const rendered = screen.getAllByTestId(/^chapter-item-\d+$/)
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(100)
    expect(screen.getByTestId('chapter-item-0')).toBeTruthy()
    expect(screen.queryByTestId('chapter-item-1500')).toBeNull()
  })

  it('点击章节回调索引', () => {
    const novel = makeNovel(10)
    const onJump = vi.fn()
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={onJump} />)
    fireEvent.click(screen.getByTestId('chapter-item-3'))
    expect(onJump).toHaveBeenCalledWith(3)
  })

  it('当前章节带高亮类', () => {
    const novel = makeNovel(10)
    render(<ChapterList novel={novel} activeChapter={2} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByTestId('chapter-item-2').className).toContain('chapter-item--active')
    expect(screen.getByTestId('chapter-item-1').className).not.toContain('chapter-item--active')
  })

  it('按 chapterPos 显示阅读百分比', () => {
    const novel = makeNovel(3)
    const c0 = novel.chapters[0]
    const chapterPos = [Math.floor(c0.charCount / 2), 0, 0]
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={chapterPos} onJump={() => {}} />)
    const pct = Number.parseInt(screen.getByTestId('chapter-pct-0').textContent ?? '0', 10)
    expect(pct).toBeGreaterThanOrEqual(49)
    expect(pct).toBeLessThanOrEqual(51)
    expect(screen.getByTestId('chapter-pct-1').textContent).toBe('0%')
  })

  it('行高常量与样式一致', () => {
    expect(ROW_HEIGHT).toBe(32)
  })
})

// —— 以下为 Task 9 实现者补的用例：计划里那 7 条从未触发过 scroll ——
// 也就是说「滚动 → 重算可视窗口 → 换出不同的行」这条组件的核心机制零覆盖，
// 把 onScroll 回调改成空函数，上面 7 条全绿。

// 组件内部的 overscan 行数（ChapterList.tsx 的 OVERSCAN）与 jsdom 下的视口兜底值：
// jsdom 没有布局，clientHeight 恒为 0，mount 时的 measure() 会退回 400px。
// 两个数字都与组件实现保持一致，改组件时必须同步改这里。
const OVERSCAN = 6
const VIEWPORT_FALLBACK = 400

describe('ChapterList 虚拟滚动', () => {
  it('滚动后重算可视窗口，换出不同的行', () => {
    const novel = makeNovel(3000)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    expect(screen.getByTestId('chapter-item-0')).toBeTruthy()
    expect(screen.queryByTestId('chapter-item-2000')).toBeNull()

    const el = screen.getByTestId('chapter-list') as HTMLDivElement
    el.scrollTop = 2000 * ROW_HEIGHT
    fireEvent.scroll(el)

    // 2000 行进了可视区，0 行被换出去 —— 这两条只有在 onScroll 真的把 scrollTop
    // 写进 state、组件因此重算窗口时才会同时成立。
    expect(screen.getByTestId('chapter-item-2000')).toBeTruthy()
    expect(screen.queryByTestId('chapter-item-0')).toBeNull()
  })

  it('窗口在可视区两端各多渲染 OVERSCAN 行（滚动时不闪白）', () => {
    const novel = makeNovel(3000)
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />)
    const el = screen.getByTestId('chapter-list') as HTMLDivElement
    el.scrollTop = 2000 * ROW_HEIGHT
    fireEvent.scroll(el)

    // 可视区从第 2000 行开始，高度 400px ≈ 12.5 行，所以可视区末端（不含）是第 2013 行；
    // 窗口再向两端各扩 OVERSCAN 行 —— 实际渲染 1994..2018。
    // 少了这个 overscan，快速滚动时刚进视口的那几行会来不及渲染（闪白）。
    const topRow = 2000
    const bottomRow = topRow + Math.ceil(VIEWPORT_FALLBACK / ROW_HEIGHT)
    expect(screen.getByTestId(`chapter-item-${topRow - OVERSCAN}`)).toBeTruthy()
    expect(screen.queryByTestId(`chapter-item-${topRow - OVERSCAN - 1}`)).toBeNull()
    expect(screen.getByTestId(`chapter-item-${bottomRow + OVERSCAN - 1}`)).toBeTruthy()
    expect(screen.queryByTestId(`chapter-item-${bottomRow + OVERSCAN}`)).toBeNull()
  })

  it('chapterPos 比章节数短时，缺项按 0 计（不显示 NaN%）', () => {
    const novel = makeNovel(5)
    // 快照里的 chapterPos 长度恒等于 chapters.length，但只有第 0 章有进度
    render(
      <ChapterList
        novel={novel}
        activeChapter={0}
        chapterPos={[novel.chapters[0].charCount]}
        onJump={() => {}}
      />
    )
    expect(screen.getByTestId('chapter-pct-0').textContent).toBe('100%')
    expect(screen.getByTestId('chapter-pct-4').textContent).toBe('0%')
  })

  it('进度超过该章长度时百分比封顶 100', () => {
    const novel = makeNovel(3)
    // 存档是旧正文、当前是重新导入的新正文时，pos 可以超过 charCount
    const stale = novel.chapters[0].charCount * 2
    render(<ChapterList novel={novel} activeChapter={0} chapterPos={[stale, 0, 0]} onJump={() => {}} />)
    expect(screen.getByTestId('chapter-pct-0').textContent).toBe('100%')
  })
})

describe('ChapterList 当前章节自动滚进可视区', () => {
  it('当前章节在视口下方时滚到行底对齐，在上方时滚到行顶对齐', () => {
    const novel = makeNovel(200)
    const { rerender } = render(
      <ChapterList novel={novel} activeChapter={0} chapterPos={[]} onJump={() => {}} />
    )
    const el = screen.getByTestId('chapter-list') as HTMLDivElement
    // jsdom 没有布局，clientHeight 恒为 0。不补一个真实视口高度，「目标行是否已在
    // 可视区内」这个判断就只剩 clientHeight === 0 的退化分支（挂载时会把 scrollTop
    // 顶到目标行底边），所以这里在实例上覆盖掉它，测的是带视口高度时真正会跑的那条式子。
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 400 })
    el.scrollTop = 0

    // 第 30 行（top=960, bottom=992）在视口 0..400 之外 → 滚到行底贴着视口下沿
    rerender(<ChapterList novel={novel} activeChapter={30} chapterPos={[]} onJump={() => {}} />)
    expect(el.scrollTop).toBe(30 * ROW_HEIGHT + ROW_HEIGHT - 400)

    // 第 25 行（top=800, bottom=832）已落在 592..992 里 → 不该动列表
    rerender(<ChapterList novel={novel} activeChapter={25} chapterPos={[]} onJump={() => {}} />)
    expect(el.scrollTop).toBe(30 * ROW_HEIGHT + ROW_HEIGHT - 400)

    // 第 2 行（top=64）在视口上方 → 滚到行顶对齐
    rerender(<ChapterList novel={novel} activeChapter={2} chapterPos={[]} onJump={() => {}} />)
    expect(el.scrollTop).toBe(2 * ROW_HEIGHT)
  })
})
