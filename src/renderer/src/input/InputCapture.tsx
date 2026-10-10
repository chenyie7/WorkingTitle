import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import type { InputMode } from '../../../core/types'

export interface InputEngine {
  pump: (k: number) => void
  backspace: (k: number) => void
}

export interface InputCaptureProps {
  engine: InputEngine
  mode: InputMode
}

/**
 * 「本身就要接收文字」的控件。焦点抢回必须跳过它们——见挂载 effect 里的 `focusIfNotTextInput`。
 *
 * 【`button` 刻意不在列】：工具栏按钮点完，焦点要回到阅读区，否则接下来的击键进不去
 * 输入接收器。只有真正吃文字的元素才跳过。
 */
const TEXT_INPUT_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

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

    const focusIfNotTextInput = (e: Event): void => {
      // 点在这些控件上时不抢焦点：否则 mousedown 一冒泡到 window 就把焦点抢回隐藏
      // textarea，它们当场 blur。设置对话框里的比例输入框就是这样废掉的——blur 触发
      // `commitRatio`，把 draft 重置回当前比例，用户看到的是「点一下就弹回原样、
      // 字根本打不进去」。应用里任何接受文字输入的控件都会中这一枪。
      // 隐藏 textarea 自己也是 `textarea`，但那时 `document.activeElement` 已经是它，
      // 跳不跳过都一样。
      if (e.target instanceof Element && e.target.closest(TEXT_INPUT_SELECTOR)) return
      // 设置对话框开着时**整块**都不抢：焦点待在对话框里是模态的应有之义，抢回来会让用户
      // 在对话框里敲的键漏进小说——而字出在遮罩后面，用户看不见。上面那条只挡住文字输入
      // 控件，点对话框的空白处或按钮时仍会中枪。
      //
      // 【用 role="dialog" 而不是给这个对话框造一个专用属性】这是 ARIA 的标准语义，以后
      // 再加进来的模态自动被覆盖；专用属性则每个新对话框都得记得挂一次，漏挂的表现是
      // 「打字抽到小说里」，与本次这个 bug 一模一样。
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return
      // 上面那条只看**点击目标**，还不够——「用『设置』按钮打开对话框」这一下会从另一条
      // 路漏进来：本监听挂在 window 上，而 React 的事件层挂在容器（#root）上，容器在
      // window 的【里面】，所以冒泡到 window 时 React 的 onClick 已经跑完——对话框挂载、
      // autoFocus 已经把焦点送进文档名输入框了。此刻 e.target 还是工具栏上那个按钮
      // （不在对话框里），于是这一下把刚送进去的焦点又抢回隐藏 textarea：对话框开着，
      // 用户敲的字全抽进小说。
      // 所以再判一次**当前焦点**：焦点已经在某个对话框里时，同样不抢。
      // 【两条都要，缺一不可】这条管「焦点还在对话框里」（刚打开的那一下），上一条管
      // 「焦点已经离开对话框」（点对话框里不可聚焦的空白处时，浏览器会把焦点交给 body）。
      if (
        document.activeElement instanceof Element &&
        document.activeElement.closest('[role="dialog"]')
      )
        return
      if (document.activeElement !== el) el.focus({ preventScroll: true })
    }

    // 挂载时先聚焦一次。不走上面那条闸（`e.target` 是隐藏 textarea 自己）。
    if (document.activeElement !== el) el.focus({ preventScroll: true })

    // 点击阅读区任意位置都要把按键接回接收器
    window.addEventListener('mousedown', focusIfNotTextInput)
    window.addEventListener('click', focusIfNotTextInput)
    return () => {
      window.removeEventListener('mousedown', focusIfNotTextInput)
      window.removeEventListener('click', focusIfNotTextInput)
    }
  }, [])

  /**
   * 把隐形输入框摆到阅读光标（`.wt-caret`）所在处——见 `page.css` 里 `.wt-input` 的注释，
   * 那是为什么必须这么做（候选框跑到页面顶部 + 小说被顶回页首，两个用户实测现象）。
   *
   * 【用 `offsetLeft` / `offsetTop`，不用 `getBoundingClientRect`】：`.wt-caret` 是
   * `display: inline-block`，`.wt-page__text` 是 static，所以它的 `offsetParent` 就是
   * `position: relative` 的 `.wt-page`；而绝对定位的 `left` / `top` 也是相对包含块（同一个
   * `.wt-page`）的。两者同一坐标系，于是【滚动 `.wt-canvas` 不影响相对位置，不需要在滚动时
   * 重算】。实测校验过两者确实可换：`caret.rect.x - page.rect.x == caret.offsetLeft`
   * （800 − 356 = 444）、y 同理（2233 − 132 = 2101）——`.wt-page` 没有 border，它的
   * border box 与 padding box 同原点。
   *
   * 【从自己的父节点往下找，不查 `document`】：`Page` 先渲染 `.wt-page__text`、后渲染
   * children，所以 `.wt-caret` 与本 textarea 同属一个 `.wt-page`。锚点用 `[data-testid]`
   * 而不是 `.wt-caret` 类名，跟单测/端到端用的是同一个。
   */
  const placeAtCaret = useCallback((): void => {
    const el = ref.current
    if (!el) return
    const caret = el.parentElement?.querySelector<HTMLElement>('[data-testid="caret"]') ?? null
    if (!caret) {
      // 空状态：`Page` 渲染的是 `.wt-page__empty`，没有阅读光标。退回纸张左上角——输入框
      // 仍在纸内、仍可聚焦，用户点一下照样能开始打字。【不能让输入框消失或抛错。】
      el.style.left = '0px'
      el.style.top = '0px'
      return
    }
    el.style.left = `${caret.offsetLeft}px`
    el.style.top = `${caret.offsetTop}px`
    el.style.height = `${caret.offsetHeight}px`
  }, [])

  /**
   * 【刻意不写依赖数组，每次渲染后都跑】：本组件只拿得到 `engine`（稳定引用）与 `mode`，
   * 没有任何 prop 会在阅读光标移动时变化——光标动不动是 `App` 那边 `visibleText` 的事。
   * 好在 `App` 每次引擎状态变化都会重渲染，而本组件没有 `memo`，所以「本组件重渲染」恰好
   * 就是「阅读光标可能移动了」的时刻。写了依赖数组反而会漏掉真正该跑的那些渲染。
   *
   * 用 `useLayoutEffect` 而不是 `useEffect`：它在 React 提交完 DOM、浏览器绘制之前同步跑，
   * 所以不会先画一帧停在旧位置的输入框。读 `offsetLeft` 会强制同步重排，量到的一定是提交
   * 之后的布局。
   */
  useLayoutEffect(placeAtCaret)

  // 窗口尺寸变化会让文字重排 → 阅读光标换位置 → 输入框得跟着挪。这条不靠重渲染
  // （resize 不会让 `App` 重渲染），所以单独立一个监听，并在卸载时摘掉。
  useEffect(() => {
    window.addEventListener('resize', placeAtCaret)
    return () => window.removeEventListener('resize', placeAtCaret)
  }, [placeAtCaret])

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
    // 合成中的输入交给 compositionend 处理，避免重复计数。
    //
    // 【这里必须直接 return，绝不能只是跳过 pump 然后照常清空】——清空 textarea 会
    // 打断输入法的合成会话。真机现象（用户实测）：候选框闪一下就消失、拼音永远上不了屏、
    // 正文一个字都不出（`compositionend` 再也不会带着内容触发）。
    // 单测抓不到：`fireEvent` 造的合成事件在 jsdom 里清空 value 不会取消任何东西，
    // 所以「合成态的 input 不抽字」这条用例在修复前后都是绿的。
    //
    // 【两种浏览器顺序都对，别改成只认 `e.nativeEvent.isComposing`】：若上屏时浏览器先发
    // `input` 再发 `compositionend`，那一刻 `composing.current` 仍为真 → 这里跳过（不计入、
    // 不清空），随后由 `compositionend` 计数并清空；若顺序相反，`compositionend` 先计数并
    // 清空，这里看到空串、`inserted` 为 0，也不会重复计。
    if (composing.current) return
    if (modeRef.current === 'ime') {
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
