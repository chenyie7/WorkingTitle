import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useShortcutDispatcher,
  toChord,
  type ShortcutActions
} from '../../src/renderer/src/state/shortcuts'
import { resolveShortcuts } from '../../src/core/shortcuts'

function actions(): ShortcutActions {
  return {
    import: vi.fn(),
    'toggle-sidebar': vi.fn(),
    'open-settings': vi.fn()
  }
}

/** 造一个 keydown。只填 toChord 真正读的那几个字段。 */
function press(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
}

function mount(opts: {
  platform?: string
  table?: Partial<Record<'import' | 'toggle-sidebar' | 'open-settings', string>>
  enabled?: boolean
}) {
  const a = actions()
  const table = resolveShortcuts(opts.table ?? {}, opts.platform === 'darwin' ? 'darwin' : 'other')
  renderHook(() =>
    useShortcutDispatcher({
      platform: opts.platform ?? 'win32',
      table,
      actions: a,
      enabled: opts.enabled ?? true
    })
  )
  return a
}

describe('toChord', () => {
  it('从 KeyboardEvent 里挑出 core 要的那五个字段', () => {
    const e = press({ code: 'KeyO', metaKey: true, shiftKey: true })
    expect(toChord(e)).toEqual({ code: 'KeyO', meta: true, ctrl: false, alt: false, shift: true })
  })

  it('组合期间返回 null——那一下属于输入法，不属于快捷键', () => {
    const e = press({ code: 'KeyO', metaKey: true })
    Object.defineProperty(e, 'isComposing', { value: true })
    expect(toChord(e)).toBeNull()
  })
})

describe('分发器', () => {
  it('Windows 上按 Ctrl+O 触发导入——这条以前是死的', () => {
    const a = mount({ platform: 'win32' })
    window.dispatchEvent(press({ code: 'KeyO', ctrlKey: true }))
    expect(a.import).toHaveBeenCalledTimes(1)
  })

  it('macOS 上不接管 import——它归原生菜单，两边都管就会导入两次', () => {
    const a = mount({ platform: 'darwin' })
    window.dispatchEvent(press({ code: 'KeyO', metaKey: true }))
    expect(a.import).not.toHaveBeenCalled()
  })

  it('macOS 上仍然接管章节栏与设置——它们没有菜单项', () => {
    const a = mount({ platform: 'darwin' })
    window.dispatchEvent(press({ code: 'KeyH', metaKey: true, shiftKey: true }))
    window.dispatchEvent(press({ code: 'Comma', metaKey: true }))
    expect(a['toggle-sidebar']).toHaveBeenCalledTimes(1)
    expect(a['open-settings']).toHaveBeenCalledTimes(1)
  })

  it('裸按键一律放行——它们要去抽字', () => {
    const a = mount({ platform: 'win32' })
    window.dispatchEvent(press({ code: 'KeyO' }))
    expect(a.import).not.toHaveBeenCalled()
  })

  it('没配上的组合不触发', () => {
    const a = mount({ platform: 'win32' })
    window.dispatchEvent(press({ code: 'KeyI', ctrlKey: true }))
    expect(a.import).not.toHaveBeenCalled()
  })

  it('命中时 preventDefault，免得裸字符漏进隐藏 textarea', () => {
    mount({ platform: 'win32' })
    const e = press({ code: 'KeyO', ctrlKey: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })

  it('enabled 为 false 时整个静音——录制期间用它', () => {
    const a = mount({ platform: 'win32', enabled: false })
    window.dispatchEvent(press({ code: 'KeyO', ctrlKey: true }))
    expect(a.import).not.toHaveBeenCalled()
  })

  it('用户改过的键生效，旧键失效', () => {
    const a = mount({ platform: 'win32', table: { import: 'Ctrl+KeyI' } })
    window.dispatchEvent(press({ code: 'KeyO', ctrlKey: true }))
    window.dispatchEvent(press({ code: 'KeyI', ctrlKey: true }))
    expect(a.import).toHaveBeenCalledTimes(1)
  })
})
