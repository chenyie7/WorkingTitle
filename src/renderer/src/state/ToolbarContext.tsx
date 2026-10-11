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
  onImport: () => void
  onClearSession: () => void
}

const ToolbarContext = createContext<ToolbarValue | null>(null)

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
  onImport?: () => void
  onClearSession?: () => void
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
  onClearSession
}: ToolbarProviderProps) {
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<string | null>(null)
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

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current))
    }, 1800)
  }, [])

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
