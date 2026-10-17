import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO, type InputMode } from '../../../core/types'

export interface ToolbarValue {
  toggles: Record<string, boolean>
  toggle: (id: string) => void
  /**
   * 下拉框与样式库当前选中的值，键是控件的 `id`。
   *
   * 【为什么与 toggles 分开、而不是塞进同一个 map】两者是**不同的状态种类**：toggle 是
   * 布尔（加粗：开/关），choice 是「从一组里选一个」（字体名、字号、样式）。合成一个
   * `Record<string, boolean | string>` 会让每个读它的地方都要先判类型，而它们读法完全不同。
   *
   * 【默认值不进这里】没选过的控件读出来是 `undefined`，由控件自己退回到第一个选项。
   * 这样切换选项卡再切回来不会丢，也不需要在初始化时把所有控件遍历一遍。
   */
  choices: Record<string, string>
  choose: (id: string, value: string) => void
  notify: (message: string) => void
  toast: string | null
  /** **当前书**的比例：真正生效的那个 */
  ratio: number
  setRatio: (n: number) => void
  /** **全局**比例：只是新导入的书的起点，改了不影响已经打开过的书 */
  globalRatio: number
  setGlobalRatio: (n: number) => void
  mode: InputMode
  setMode: (m: InputMode) => void
  onImport: () => void | Promise<void>
  onClearSession: () => void
}

const ToolbarContext = createContext<ToolbarValue | null>(null)

/**
 * toast 自动消失的时间。**两处共用这一个常量**：provider 未受控时的内部实现用它，
 * `App` 里那份也用——两边各写一个数的话，改了一边不会有任何东西报错。
 */
export const TOAST_MS = 1800

export function clampRatioInput(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RATIO
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, Math.round(n)))
}

export interface ToolbarProviderProps {
  children: ReactNode
  ratio?: number
  globalRatio?: number
  mode?: InputMode
  onRatioChange?: (n: number) => void
  onGlobalRatioChange?: (n: number) => void
  onModeChange?: (m: InputMode) => void
  onImport?: () => void | Promise<void>
  onClearSession?: () => void
  /**
   * toast 的受控入口。**不传就自己持有**——与 `ratio` 那几个同形，让既有测试不必改动。
   *
   * 【为什么这两项要能受控】老板键的提示是从 `App` 那一层的快捷键分发器里弹的，而
   * `notify` 原先住在本 provider 内部、`App` 又在 provider **外面**（它就是渲染
   * `<ToolbarProvider>` 的那个组件），拿不到 `useToolbar()`。
   */
  toast?: string | null
  notify?: (message: string) => void
}

export function ToolbarProvider({
  children,
  ratio: ratioProp,
  globalRatio: globalRatioProp,
  mode: modeProp,
  onRatioChange,
  onGlobalRatioChange,
  onModeChange,
  onImport,
  onClearSession,
  toast: toastProp,
  notify: notifyProp
}: ToolbarProviderProps) {
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [innerToast, setInnerToast] = useState<string | null>(null)
  const [innerRatio, setInnerRatio] = useState(DEFAULT_RATIO)
  const [innerGlobalRatio, setInnerGlobalRatio] = useState(DEFAULT_RATIO)
  const [innerMode, setInnerMode] = useState<InputMode>('ime')

  const ratio = ratioProp ?? innerRatio
  const globalRatio = globalRatioProp ?? innerGlobalRatio
  const mode = modeProp ?? innerMode

  const toggle = useCallback((id: string) => {
    setToggles((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const choose = useCallback((id: string, value: string) => {
    setChoices((prev) => ({ ...prev, [id]: value }))
  }, [])

  const innerNotify = useCallback((message: string) => {
    setInnerToast(message)
    window.setTimeout(() => {
      setInnerToast((current) => (current === message ? null : current))
    }, TOAST_MS)
  }, [])

  /**
   * 【`??` 在这里是错的，必须按 `!== undefined` 判】`toast` 的**有效值包含 `null`**
   * （＝当前没有提示），用 `??` 会把它当成「没传」而回落到内部状态——于是**内部那条旧提示
   * 会在 prop 传 `null` 时再冒出来**。
   *
   * 【症状要说准，别写成「永远不消失」】那两条（「永远不消失」「下一次 notify 也改不动」）
   * 都**不是**这个变异会产生的结果，而且它们描述的 App 那条路根本不可达——`innerToast` 只被
   * `innerNotify` 写，而 `innerNotify` 只在 `notifyProp === undefined` 时用得上，shipped 的
   * `App` 恒传 `notify`。唯一的判别症状就是上面那句，钉它的用例是第三条（先不受控写一次、
   * 再切受控传 `null`）。
   *
   * 【这两项要传就一起传】类型允许只传 `toast` 不传 `notify`，那种组合下 `notify` 落回
   * `innerNotify`，内部定时器会往 `innerToast` 里写——正好就是上面那个残留场景。
   *
   * 【这两行为什么排在 `innerNotify` 之后、而不是与上面 `ratio` 那三行并排】`notifyProp ?? innerNotify`
   * 在 `notifyProp` 为 `undefined` 时会真的去读 `innerNotify`，而 `const` 声明之前是 TDZ：
   * 排到它前面，所有「不传 notify」的地方（既有测试全部如此）当场 `ReferenceError`。
   * 实测：放在 `ratio` 那三行下面，settings.test.tsx 51 条里红 49 条（活下来的 2 条都是显式
   * 传了 `notify` 的——`??` 短路，读不到那个 `const`），报的正是
   * `Cannot access 'innerNotify' before initialization`。
   */
  const toast = toastProp !== undefined ? toastProp : innerToast
  const notify = notifyProp ?? innerNotify

  const setRatio = useCallback(
    (n: number) => {
      const next = clampRatioInput(n)
      setInnerRatio(next)
      onRatioChange?.(next)
    },
    [onRatioChange]
  )

  const setGlobalRatio = useCallback(
    (n: number) => {
      const next = clampRatioInput(n)
      setInnerGlobalRatio(next)
      onGlobalRatioChange?.(next)
    },
    [onGlobalRatioChange]
  )

  const setMode = useCallback(
    (m: InputMode) => {
      setInnerMode(m)
      onModeChange?.(m)
    },
    [onModeChange]
  )

  const value = useMemo<ToolbarValue>(
    () => ({
      toggles,
      toggle,
      choices,
      choose,
      notify,
      toast,
      ratio,
      setRatio,
      globalRatio,
      setGlobalRatio,
      mode,
      setMode,
      onImport: onImport ?? (() => notify('演示占位功能，未实现')),
      onClearSession: onClearSession ?? (() => notify('演示占位功能，未实现'))
    }),
    [
      toggles,
      toggle,
      choices,
      choose,
      notify,
      toast,
      ratio,
      setRatio,
      globalRatio,
      setGlobalRatio,
      mode,
      setMode,
      onImport,
      onClearSession
    ]
  )

  return <ToolbarContext.Provider value={value}>{children}</ToolbarContext.Provider>
}

export function useToolbar(): ToolbarValue {
  const ctx = useContext(ToolbarContext)
  if (!ctx) throw new Error('useToolbar 必须在 ToolbarProvider 内使用')
  return ctx
}
