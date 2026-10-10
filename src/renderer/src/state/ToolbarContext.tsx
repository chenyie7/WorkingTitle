import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO, type InputMode } from '../../../core/types'

export interface ToolbarValue {
  toggles: Record<string, boolean>
  toggle: (id: string) => void
  notify: (message: string) => void
  toast: string | null
  ratio: number
  setRatio: (n: number) => void
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
  mode?: InputMode
  onRatioChange?: (n: number) => void
  onModeChange?: (m: InputMode) => void
  onImport?: () => void
  onClearSession?: () => void
}

export function ToolbarProvider({
  children,
  ratio: ratioProp,
  mode: modeProp,
  onRatioChange,
  onModeChange,
  onImport,
  onClearSession
}: ToolbarProviderProps) {
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [innerRatio, setInnerRatio] = useState(DEFAULT_RATIO)
  const [innerMode, setInnerMode] = useState<InputMode>('ime')

  const ratio = ratioProp ?? innerRatio
  const mode = modeProp ?? innerMode

  const toggle = useCallback((id: string) => {
    setToggles((prev) => ({ ...prev, [id]: !prev[id] }))
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
      notify,
      toast,
      ratio,
      setRatio,
      mode,
      setMode,
      onImport: onImport ?? (() => notify('演示占位功能，未实现')),
      onClearSession: onClearSession ?? (() => notify('演示占位功能，未实现'))
    }),
    [toggles, toggle, notify, toast, ratio, setRatio, mode, setMode, onImport, onClearSession]
  )

  return <ToolbarContext.Provider value={value}>{children}</ToolbarContext.Provider>
}

export function useToolbar(): ToolbarValue {
  const ctx = useContext(ToolbarContext)
  if (!ctx) throw new Error('useToolbar 必须在 ToolbarProvider 内使用')
  return ctx
}
