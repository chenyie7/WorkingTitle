import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InputCapture } from '../../src/renderer/src/input/InputCapture'
import type { InputMode } from '../../src/core/types'

// 刻意【不】写返回类型注解。Vitest 5 下 ReturnType<typeof vi.fn> 会把 T 冻结成
// 默认的 Mock<Procedure | Constructable>，赋给 (k: number) => void 时报 TS2322，
// 于是 pnpm typecheck 门禁失败——而 Task 11 的步骤只跑 vitest，这个错要到
// Task 12/13/14 和 CI 才炸。让 TS 自行推断即可（得到 Mock<Procedure>，照样带
// .mock / .mock.calls）。也不要为了「显式化」去 import Mock：引擎契约是结构类型
// （见本任务 Interfaces），不该把 Vitest 的类型漏进去。
function makeEngine() {
  return { pump: vi.fn(), backspace: vi.fn() }
}

function setup(mode: InputMode): ReturnType<typeof makeEngine> {
  const engine = makeEngine()
  render(<InputCapture engine={engine} mode={mode} />)
  return engine
}

const input = (): HTMLTextAreaElement => screen.getByTestId('input-capture') as HTMLTextAreaElement

describe('输入法友好模式', () => {
  it('compositionend 时按上屏字数 × 1 抽字（比例由引擎内部负责）', () => {
    const engine = setup('ime')
    fireEvent.compositionStart(input())
    fireEvent.compositionUpdate(input(), { data: 'ni hao' })
    fireEvent.compositionEnd(input(), { data: '你好' })
    expect(engine.pump).toHaveBeenCalledTimes(1)
    expect(engine.pump).toHaveBeenCalledWith(2)
    expect(engine.backspace).not.toHaveBeenCalled()
  })

  it('合成过程中的拼音不产生抽字', () => {
    const engine = setup('ime')
    fireEvent.compositionStart(input())
    fireEvent.compositionUpdate(input(), { data: 'n' })
    fireEvent.compositionUpdate(input(), { data: 'ni' })
    fireEvent.compositionUpdate(input(), { data: 'nihao' })
    expect(engine.pump).not.toHaveBeenCalled()
  })

  it('合成中按退格交给输入法删除拼音：既不拦截也不回退', () => {
    const engine = setup('ime')
    const el = input()
    fireEvent.compositionStart(el)
    // isComposing 由 KeyboardEvent 构造函数透传，实现读的是 e.nativeEvent.isComposing
    const notPrevented = fireEvent.keyDown(el, { key: 'Backspace', isComposing: true })
    expect(notPrevented).toBe(true)
    expect(engine.backspace).not.toHaveBeenCalled()
  })

  it('非合成态按退格照常回退并拦截', () => {
    const engine = setup('ime')
    const notPrevented = fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(notPrevented).toBe(false)
    expect(engine.backspace).toHaveBeenCalledWith(1)
  })

  it('compositionend 后 textarea 被清空', () => {
    setup('ime')
    const el = input()
    el.value = '你好'
    fireEvent.compositionEnd(el, { data: '你好' })
    fireEvent.input(el)
    expect(el.value).toBe('')
  })

  it('keydown 不拦截，保证输入法可用', () => {
    const engine = setup('ime')
    const el = input()
    fireEvent.keyDown(el, { key: 'a' })
    expect(engine.pump).not.toHaveBeenCalled()
  })

  it('非合成态的 input（直接敲英文）也按插入字数抽字', () => {
    const engine = setup('ime')
    const el = input()
    el.value = 'abc'
    fireEvent.input(el)
    expect(engine.pump).toHaveBeenCalledWith(3)
    expect(el.value).toBe('')
  })

  it('合成态的 input 不抽字（交给 compositionend）', () => {
    const engine = setup('ime')
    const el = input()
    fireEvent.compositionStart(el)
    el.value = 'nihao'
    fireEvent.input(el)
    expect(engine.pump).not.toHaveBeenCalled()
  })
})

describe('纯按键模式', () => {
  it('可打印键每次抽 1 个字并阻止默认行为', () => {
    const engine = setup('key')
    const el = input()
    const notPrevented = fireEvent.keyDown(el, { key: 'a' })
    expect(engine.pump).toHaveBeenCalledWith(1)
    expect(notPrevented).toBe(false) // fireEvent 返回 false 表示 preventDefault 被调用
  })

  it('空格也算一次输入', () => {
    const engine = setup('key')
    fireEvent.keyDown(input(), { key: ' ' })
    expect(engine.pump).toHaveBeenCalledWith(1)
  })

  it('带 Ctrl/Meta 的组合键不抽字（保留快捷键）', () => {
    const engine = setup('key')
    fireEvent.keyDown(input(), { key: 'c', ctrlKey: true })
    fireEvent.keyDown(input(), { key: 'v', metaKey: true })
    expect(engine.pump).not.toHaveBeenCalled()
  })

  it('功能键不抽字', () => {
    const engine = setup('key')
    fireEvent.keyDown(input(), { key: 'Shift' })
    fireEvent.keyDown(input(), { key: 'ArrowLeft' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(engine.pump).not.toHaveBeenCalled()
  })
})

describe('两模式共用', () => {
  it('Backspace 触发回退并阻止默认行为', () => {
    const engine = setup('ime')
    const notPrevented = fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(engine.backspace).toHaveBeenCalledWith(1)
    expect(notPrevented).toBe(false)
  })

  it('纯按键模式下 Backspace 同样回退', () => {
    const engine = setup('key')
    fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(engine.backspace).toHaveBeenCalledWith(1)
  })

  it('方向键与翻页键不被拦截，交给页面滚动', () => {
    const engine = setup('ime')
    for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']) {
      expect(fireEvent.keyDown(input(), { key })).toBe(true)
    }
    expect(engine.pump).not.toHaveBeenCalled()
    expect(engine.backspace).not.toHaveBeenCalled()
  })

  it('挂载后自动获得焦点', () => {
    setup('ime')
    expect(document.activeElement).toBe(input())
  })

  it('点击窗口任意位置都会把焦点拉回输入接收器', () => {
    setup('ime')
    const el = input()
    el.blur()
    expect(document.activeElement).not.toBe(el)
    fireEvent.click(document.body)
    expect(document.activeElement).toBe(el)
  })

  it('切换模式后行为随之改变', () => {
    const engine = makeEngine()
    const { rerender } = render(<InputCapture engine={engine} mode="ime" />)
    fireEvent.keyDown(input(), { key: 'a' })
    expect(engine.pump).not.toHaveBeenCalled()

    rerender(<InputCapture engine={engine} mode="key" />)
    fireEvent.keyDown(input(), { key: 'a' })
    expect(engine.pump).toHaveBeenCalledWith(1)
  })
})
