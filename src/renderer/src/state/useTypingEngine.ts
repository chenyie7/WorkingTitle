import { useCallback, useSyncExternalStore } from 'react'
import type { TypingEngine, EngineState } from '../../../core/engine'

export function useTypingEngine(engine: TypingEngine | null): EngineState | null {
  const subscribe = useCallback(
    (onChange: () => void) => (engine ? engine.subscribe(onChange) : () => {}),
    [engine]
  )
  const getSnapshot = useCallback(() => (engine ? engine.getSnapshot() : null), [engine])
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
