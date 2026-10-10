import { useEffect, useRef, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { InputMode } from '../../../core/types'

export interface InputEngine {
  pump: (k: number) => void
  backspace: (k: number) => void
}

export interface InputCaptureProps {
  engine: InputEngine
  mode: InputMode
}

/** 功能键与修饰键组合不参与抽字 */
const NON_CHAR_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'Tab',
  'Enter',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
  'Delete',
  'Backspace',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12'
])

export function InputCapture({ engine, mode }: InputCaptureProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const engineRef = useRef(engine)
  const modeRef = useRef(mode)

  engineRef.current = engine
  modeRef.current = mode

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const focus = (): void => {
      if (document.activeElement !== el) el.focus({ preventScroll: true })
    }
    focus()

    // 点击阅读区任意位置都要把按键接回接收器
    window.addEventListener('mousedown', focus)
    window.addEventListener('click', focus)
    return () => {
      window.removeEventListener('mousedown', focus)
      window.removeEventListener('click', focus)
    }
  }, [])

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Backspace') {
      // 合成中（拼音还没上屏）绝不能拦截退格：这时退格是输入法用来删除拼音的。
      // 拦截会导致用户删不掉自己打错的拼音，还会让正文莫名回退。
      // React 的合成事件不暴露 isComposing（取到的是 undefined），必须读 nativeEvent。
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      engineRef.current.backspace(1)
      return
    }

    if (modeRef.current !== 'key') return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (NON_CHAR_KEYS.has(e.key)) return

    // 可打印字符：抽字并阻止它真的落进 textarea
    if ([...e.key].length === 1) {
      e.preventDefault()
      engineRef.current.pump(1)
    }
  }

  const handleInput = (e: FormEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget
    // 合成中的输入交给 compositionend 处理，避免重复计数
    if (!composing.current && modeRef.current === 'ime') {
      const inserted = el.value.length
      if (inserted > 0) engineRef.current.pump(inserted)
    }
    el.value = ''
  }

  return (
    <textarea
      ref={ref}
      className="wt-input"
      data-testid="input-capture"
      aria-label="文档输入区"
      autoFocus
      spellCheck={false}
      autoComplete="off"
      onKeyDown={handleKeyDown}
      onInput={handleInput}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={(e) => {
        composing.current = false
        const text = e.data ?? ''
        if (text.length > 0) engineRef.current.pump(text.length)
        if (ref.current) ref.current.value = ''
      }}
    />
  )
}
