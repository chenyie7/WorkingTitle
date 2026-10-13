import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar } from '../../src/renderer/src/components/StatusBar'
import type { Novel } from '../../src/core/types'

const novel: Novel = {
  title: '大书',
  sourcePath: '/tmp/大书.txt',
  encoding: 'GB18030',
  hadBom: false,
  flatText: 'A'.repeat(1000),
  chapters: [
    { index: 0, title: '第一章', start: 0, end: 500, charCount: 500 },
    { index: 1, title: '第二章', start: 500, end: 1000, charCount: 500 }
  ]
}

describe('StatusBar', () => {
  it('未导入小说时显示占位', () => {
    render(<StatusBar novel={null} revealedChars={0} activeChapter={0} ratio={10} mode="ime" />)
    expect(screen.getByTestId('status-chapter').textContent).toBe('—')
    expect(screen.getByTestId('status-encoding').textContent).toBe('编码 —')
    // 全书 0 字时百分比必须短路成 0，否则是 NaN%（0/0）。
    expect(screen.getByTestId('status-percent').textContent).toBe('0%')
  })

  it('章节位置写成 `2 / 2`，而不是「第 2 章 / 共 2 章」', () => {
    render(<StatusBar novel={novel} revealedChars={250} activeChapter={1} ratio={25} mode="key" />)
    // 写成页码形状（真 Word 状态栏左下角就是页码）。**断言里刻意不含「章」字**——
    // 那个字是小说阅读器最直接的标志，这份用例守的就是「它不出现」。
    const chapter = screen.getByTestId('status-chapter').textContent
    expect(chapter).toBe('2 / 2')
    expect(chapter).not.toContain('章')
  })

  it('显示比例、编码与模式', () => {
    render(<StatusBar novel={novel} revealedChars={250} activeChapter={1} ratio={25} mode="key" />)
    expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:25')
    expect(screen.getByTestId('status-encoding').textContent).toBe('编码 GB18030')
    expect(screen.getByTestId('status-mode').textContent).toBe('输入模式 纯按键')
    expect(screen.getByTestId('status-percent').textContent).toBe('25%')
  })

  it('不再有「已显示字数」与「用时」这两项', () => {
    render(<StatusBar novel={novel} revealedChars={250} activeChapter={1} ratio={25} mode="key" />)
    const text = screen.getByTestId('statusbar').textContent ?? ''
    // 「已显示 N / 全书 M 字」是伪装上的破绽：真 Word 只报全文字数，从不报「已显示多少」。
    expect(text).not.toContain('已显示')
    // 真 Word 没有阅读计时器。
    expect(text).not.toContain('用时')
    expect(screen.queryByTestId('status-chars')).toBeNull()
    expect(screen.queryByTestId('status-elapsed')).toBeNull()
  })

  it('百分比向下取整', () => {
    // 259 / 1000 = 25.9%：floor 得 25，round 得 26，两者可判。
    render(<StatusBar novel={novel} revealedChars={259} activeChapter={0} ratio={10} mode="ime" />)
    expect(screen.getByTestId('status-percent').textContent).toBe('25%')
  })
})

describe('StatusBar 老板模式', () => {
  it('老板模式下不渲染比例 / 编码 / 输入模式三格', () => {
    // 这三样真 Word 的状态栏都没有——「比例 1:10」「编码 UTF-8」「输入模式 输入法」
    // 每一个都在说「这不是 Word，是个读小说的东西」。
    render(
      <StatusBar novel={novel} revealedChars={250} activeChapter={1} ratio={25} mode="key" bossMode />
    )
    expect(screen.queryByTestId('status-ratio')).toBeNull()
    expect(screen.queryByTestId('status-encoding')).toBeNull()
    expect(screen.queryByTestId('status-mode')).toBeNull()
    // 页码形状与百分比留着——真 Word 也有
    expect(screen.getByTestId('status-chapter').textContent).toBe('2 / 2')
    expect(screen.getByTestId('status-percent').textContent).toBe('25%')
  })

  it('不传 bossMode 时三格照旧（向后兼容）', () => {
    render(<StatusBar novel={novel} revealedChars={250} activeChapter={1} ratio={25} mode="key" />)
    expect(screen.getByTestId('status-ratio')).toBeTruthy()
    expect(screen.getByTestId('status-encoding')).toBeTruthy()
    expect(screen.getByTestId('status-mode')).toBeTruthy()
  })

  it('spacer 仍夹在两个可见组之间（别把它一起包进条件里）', () => {
    // jsdom 没有布局，量不了「那块空隙有多大」；能钉的是 **DOM 次序**：它必须在左侧组
    // 之后、右侧组之前。把整块包进 `!bossMode && (…)` 会破坏这个次序——而那是本组件里
    // 唯一一处「靠位置表达布局」的地方，出错了也不会有别的东西报错。
    render(
      <StatusBar novel={novel} revealedChars={250} activeChapter={1} ratio={25} mode="key" bossMode />
    )
    const spacer = document.querySelector('.wt-statusbar__spacer')
    expect(spacer).toBeTruthy()
    expect(spacer!.previousElementSibling?.getAttribute('data-testid')).toBe('status-chapter')
    expect(spacer!.nextElementSibling?.getAttribute('data-testid')).toBe('status-percent')
  })
})
