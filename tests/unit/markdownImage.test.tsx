import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MarkdownImage, clearMarkdownImageCache } from '../../src/renderer/src/markdown/MarkdownImage'
import type { WtApi } from '../../src/core/api'

function install(load: (src: string) => Promise<string | null>): ReturnType<typeof vi.fn> {
  const spy = vi.fn(load)
  ;(window as unknown as { api: Partial<WtApi> }).api = { loadWorkDocImage: spy }
  return spy
}

beforeEach(() => {
  vi.restoreAllMocks()
  clearMarkdownImageCache()
})

// 【每个用例用自己的地址，别复用】缓存是**模块级、跨用例存活**的（设计 8.4 要求它
// 不淘汰），而 `afterEach` 也清不掉它。两个用例用同一个地址就会互相污染：先跑的那个
// 把它定住（先挂起的那个永不 resolve，后跑的就永远停在占位框上）。实测过：三个用例
// 都用 `a.png` 时，「取不到就停在占位框上」红在「上一个用例缓存了 AAA」上。
describe('MarkdownImage', () => {
  it('还没取到时显示占位框与替代文字', () => {
    install(() => new Promise(() => {})) // 永不 resolve
    const c = render(<MarkdownImage url="还没回来.png" alt="架构图" />).container
    expect(c.querySelector('[data-testid="md-image"]')!.textContent).toBe('架构图')
    expect(c.querySelector('img')).toBeNull()
  })

  it('取到之后换成真的 img，src 是拿回来的 data URL', async () => {
    install(async () => 'data:image/png;base64,AAA')
    const c = render(<MarkdownImage url="a.png" alt="架构图" />).container
    await waitFor(() => expect(c.querySelector('img')).not.toBeNull())
    expect(c.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAA')
  })

  it('取不到（null）就停在占位框上，不抛', async () => {
    install(async () => null)
    const c = render(<MarkdownImage url="取不到.png" alt="架构图" />).container
    await waitFor(() => expect(c.querySelector('[data-testid="md-image"]')).not.toBeNull())
    expect(c.querySelector('img')).toBeNull()
  })

  it('同一个地址只请求一次（模块级缓存）', async () => {
    const spy = install(async () => 'data:image/png;base64,BBB')
    render(<MarkdownImage url="同一条.png" alt="a" />)
    render(<MarkdownImage url="同一条.png" alt="b" />)
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('空地址不请求，直接是占位框', () => {
    const spy = install(async () => 'x')
    render(<MarkdownImage url="" alt="没地址" />)
    expect(spy).not.toHaveBeenCalled()
  })
})
