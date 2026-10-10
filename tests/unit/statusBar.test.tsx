import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar, formatElapsed } from '../../src/renderer/src/components/StatusBar'
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

describe('formatElapsed', () => {
  it('格式化为 HH:MM:SS', () => {
    expect(formatElapsed(0)).toBe('00:00:00')
    expect(formatElapsed(1000)).toBe('00:00:01')
    expect(formatElapsed(61_000)).toBe('00:01:01')
    expect(formatElapsed(3_661_000)).toBe('01:01:01')
  })

  it('负数与非法值归零', () => {
    expect(formatElapsed(-100)).toBe('00:00:00')
    expect(formatElapsed(Number.NaN)).toBe('00:00:00')
  })
})

describe('StatusBar', () => {
  it('未导入小说时显示占位', () => {
    render(
      <StatusBar novel={null} revealedChars={0} activeChapter={0} ratio={10} mode="ime" startedAt={null} now={0} />
    )
    expect(screen.getByTestId('status-chars').textContent).toContain('全书 0 字')
    expect(screen.getByTestId('status-chapter').textContent).toBe('未导入')
    expect(screen.getByTestId('status-encoding').textContent).toBe('编码 —')
    // 全书 0 字时百分比必须短路成 0，否则是 NaN%（0/0）。
    expect(screen.getByTestId('status-percent').textContent).toBe('0%')
  })

  it('显示已显示字数、章节、比例、编码与模式', () => {
    render(
      <StatusBar novel={novel} revealedChars={250} activeChapter={1} ratio={25} mode="key" startedAt={0} now={61_000} />
    )
    expect(screen.getByTestId('status-chars').textContent).toContain('已显示 250')
    expect(screen.getByTestId('status-chars').textContent).toContain('全书 1,000 字')
    expect(screen.getByTestId('status-chapter').textContent).toContain('第 2 章 / 共 2 章')
    expect(screen.getByTestId('status-ratio').textContent).toBe('比例 1:25')
    expect(screen.getByTestId('status-encoding').textContent).toBe('编码 GB18030')
    expect(screen.getByTestId('status-mode').textContent).toBe('输入模式 纯按键')
    expect(screen.getByTestId('status-elapsed').textContent).toBe('用时 00:01:01')
    expect(screen.getByTestId('status-percent').textContent).toBe('25%')
  })

  it('未开始打字时用时归零', () => {
    render(
      <StatusBar novel={novel} revealedChars={0} activeChapter={0} ratio={10} mode="ime" startedAt={null} now={999_999} />
    )
    expect(screen.getByTestId('status-elapsed').textContent).toBe('用时 00:00:00')
  })

  it('百分比向下取整', () => {
    // 259 / 1000 = 25.9%：floor 得 25，round 得 26，两者可判。
    render(
      <StatusBar novel={novel} revealedChars={259} activeChapter={0} ratio={10} mode="ime" startedAt={null} now={0} />
    )
    expect(screen.getByTestId('status-percent').textContent).toBe('25%')
  })
})
