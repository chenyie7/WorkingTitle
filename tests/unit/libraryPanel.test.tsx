import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { LibraryPanel } from '../../src/renderer/src/components/LibraryPanel'
import { ToolbarProvider } from '../../src/renderer/src/state/ToolbarContext'
import { defaultSettings } from '../../src/core/types'
import type { LibraryEntry } from '../../src/core/types'
import type { WtApi } from '../../src/core/api'

const entries: LibraryEntry[] = [
  {
    id: 'a'.repeat(32),
    title: '甲书',
    sourcePath: '/lib/a/甲书.txt',
    originalPath: '/src/甲书.txt',
    size: 2048,
    importedAt: 100,
    charCount: 1000,
    cursor: 500,
    lastReadAt: 100,
    broken: false
  },
  {
    id: 'b'.repeat(32),
    title: '乙书',
    sourcePath: '/lib/b/乙书.txt',
    originalPath: '/src/乙书.txt',
    size: 1024 * 1024,
    importedAt: 300,
    charCount: 2000,
    cursor: 0,
    lastReadAt: 200,
    broken: false
  },
  {
    id: 'c'.repeat(32),
    title: '坏书',
    sourcePath: '/lib/c/坏书.txt',
    originalPath: '/src/坏书.txt',
    size: 10,
    importedAt: 50,
    charCount: 10,
    cursor: 0,
    lastReadAt: null,
    broken: true
  },
  {
    id: 'd'.repeat(32),
    title: '丁书',
    sourcePath: '/lib/d/丁书.txt',
    originalPath: '/src/丁书.txt',
    size: 512,
    importedAt: 400,
    charCount: 400,
    cursor: 0,
    lastReadAt: null,
    broken: false
  },
  {
    id: 'e'.repeat(32),
    title: '越界书',
    sourcePath: '/lib/e/越界书.txt',
    originalPath: '/src/越界书.txt',
    size: 256,
    importedAt: 10,
    charCount: 100,
    cursor: 250,
    lastReadAt: null,
    broken: false
  }
]

function installApi(overrides: Partial<WtApi> = {}): void {
  ;(window as unknown as { api: WtApi }).api = {
    platform: 'darwin',
    importNovel: async () => ({ ok: false, reason: 'canceled' }),
    importWorkDoc: async () => ({ ok: false, reason: 'canceled' }),
    loadWorkDoc: async () => null,
    loadWorkDocImage: async () => null,
    openNovelPath: async () => ({ ok: false, reason: '测试桩' }),
    resplitNovel: async () => ({ ok: false, reason: '测试桩' }),
    initialNovelPath: async () => null,
    loadSession: async () => null,
    saveSession: async () => ({ ok: true, value: undefined }),
    loadSettings: async () => defaultSettings(),
    saveSettings: async () => ({ ok: true, value: undefined }),
    onMenuCommand: () => () => {},
    getTheme: async () => false,
    setThemeSource: async () => ({ ok: true, value: undefined }),
    onThemeChange: () => () => {},
    listNovels: vi.fn(async () => entries),
    deleteNovel: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides
  }
}

function setup(overrides: Partial<WtApi> = {}, openResult = true) {
  installApi(overrides)
  const onImport = vi.fn(async () => {})
  const onOpenNovel = vi.fn(async () => openResult)
  const onDeleteNovel = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const onClose = vi.fn()
  render(
    <ToolbarProvider onImport={onImport}>
      <LibraryPanel
        active
        currentSourcePath="/lib/b/乙书.txt"
        onOpenNovel={onOpenNovel}
        onDeleteNovel={onDeleteNovel}
        onClose={onClose}
      />
    </ToolbarProvider>
  )
  return { onImport, onOpenNovel, onDeleteNovel, onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LibraryPanel', () => {
  it('按最近阅读排序并显示进度', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('乙书')).toBeTruthy())
    // 从没读过的那本按导入时间排（`lastReadAt ?? importedAt`），而不是被当成 0 掉到最后。
    const rows = screen.getAllByTestId(/^library-row-/)
    expect(within(rows[0]).getByText('丁书')).toBeTruthy()
    expect(within(rows[1]).getByText('乙书')).toBeTruthy()
    expect(within(rows[2]).getByText('甲书')).toBeTruthy()
    expect(screen.getByText(/已读 50%/)).toBeTruthy()
  })

  it('光标超过全书长度时进度封顶 100%', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('越界书')).toBeTruthy())
    const row = screen.getByTestId(`library-row-${'e'.repeat(32)}`)
    expect(within(row).getByText(/已读 100%/)).toBeTruthy()
  })

  it('当前书标「正在阅读」且没有打开按钮', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('正在阅读')).toBeTruthy())
    const row = screen.getByTestId(`library-row-${'b'.repeat(32)}`)
    expect(within(row).queryByText('打开')).toBeNull()
  })

  it('坏条目只显示「文件丢失」，不能打开', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('文件丢失')).toBeTruthy())
    const row = screen.getByTestId(`library-row-${'c'.repeat(32)}`)
    expect(within(row).queryByText('打开')).toBeNull()
  })

  it('打开一本书：调用 onOpenNovel 后关闭对话框', async () => {
    const { onOpenNovel, onClose } = setup()
    await waitFor(() => expect(screen.getByText('甲书')).toBeTruthy())
    const row = screen.getByTestId(`library-row-${'a'.repeat(32)}`)
    fireEvent.click(within(row).getByText('打开'))
    await waitFor(() => expect(onOpenNovel).toHaveBeenCalledWith('/lib/a/甲书.txt'))
    expect(onClose).toHaveBeenCalled()
  })

  it('打开失败时对话框不关（用户要能换一本再试）', async () => {
    const { onOpenNovel, onClose } = setup({}, false)
    await waitFor(() => expect(screen.getByText('甲书')).toBeTruthy())
    const row = screen.getByTestId(`library-row-${'a'.repeat(32)}`)
    fireEvent.click(within(row).getByText('打开'))
    await waitFor(() => expect(onOpenNovel).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('删除要二次确认，确认后调用 onDeleteNovel 并重拉列表', async () => {
    const { onDeleteNovel } = setup()
    await waitFor(() => expect(screen.getByText('甲书')).toBeTruthy())
    const row = screen.getByTestId(`library-row-${'a'.repeat(32)}`)
    fireEvent.click(within(row).getByText('删除'))
    expect(within(row).getByText(/不可恢复/)).toBeTruthy()
    fireEvent.click(within(row).getByText('确认删除'))
    await waitFor(() => expect(onDeleteNovel).toHaveBeenCalled())
    const listNovels = window.api.listNovels as unknown as { mock: { calls: unknown[][] } }
    await waitFor(() => expect(listNovels.mock.calls.length).toBeGreaterThan(1))
  })

  it('导入按钮走 onImport，完成后重拉列表', async () => {
    const { onImport } = setup()
    await waitFor(() => expect(screen.getByText('甲书')).toBeTruthy())
    fireEvent.click(screen.getByTestId('library-import'))
    await waitFor(() => expect(onImport).toHaveBeenCalled())
    const listNovels = window.api.listNovels as unknown as { mock: { calls: unknown[][] } }
    await waitFor(() => expect(listNovels.mock.calls.length).toBeGreaterThan(1))
  })

  it('空书库显示空态', async () => {
    setup({ listNovels: vi.fn(async () => []) })
    await waitFor(() => expect(screen.getByText('书库里还没有小说')).toBeTruthy())
  })
})
