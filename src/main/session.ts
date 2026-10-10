import { app } from 'electron'
import { createSessionStore, type SessionStore } from './sessionStore'

let store: SessionStore | null = null

/** 必须在 app ready 之后、且 setPath('userData') 之后调用。 */
export function getStore(): SessionStore {
  if (!store) store = createSessionStore(app.getPath('userData'))
  return store
}

/**
 * 供 E2E / 便携模式在 setPath 之后重置缓存实例。
 *
 * 注意它生效的**前提**：只有在「store 已经被建出来之后」调用才有意义。
 * 在 `index.ts` 的调用位置（模块顶层、紧跟 applyUserDataOverride）它是**惰性的**——
 * store 是懒创建的，那时还没有人调用过 getStore()，所以那行是「把 null 置成 null」。
 * 不要把它的存在读成「启动时一定会按新的 userData 重新解析」。
 */
export function resetStore(): void {
  store = null
}
