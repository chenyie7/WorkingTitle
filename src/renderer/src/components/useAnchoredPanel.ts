import { useCallback, useEffect, useRef, useState } from 'react'

export interface PanelPosition {
  left: number
  top: number
  width: number
}

export function useAnchoredPanel<T extends HTMLElement>() {
  const anchorRef = useRef<T>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<PanelPosition | null>(null)

  const place = useCallback((): void => {
    const rect = anchorRef.current?.getBoundingClientRect()
    setPos({ left: rect?.left ?? 0, top: (rect?.bottom ?? 0) + 2, width: rect?.width ?? 0 })
  }, [])

  const toggle = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    place()
    setOpen(true)
  }

  const close = (): void => setOpen(false)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target
      if (!(target instanceof Element)) return
      if (anchorRef.current?.contains(target)) return
      if (target.closest('[data-wt-popup]')) return
      setOpen(false)
    }
    const onMove = (): void => place()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, place])

  return { anchorRef, open, pos, toggle, close }
}
