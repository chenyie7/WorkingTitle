import { app } from 'electron'
import { createSessionStore, type SessionStore } from './sessionStore'

let store: SessionStore | null = null

/** 必须在 app ready 之后、且 setPath('userData') 之后调用。 */
export function getStore(): SessionStore {
  if (!store) store = createSessionStore(app.getPath('userData'))
  return store
}

/** 供 E2E / 便携模式在 setPath 之后重置缓存实例。 */
export function resetStore(): void {
  store = null
}
