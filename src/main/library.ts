import { app } from 'electron'
import { createLibraryStore, type LibraryStore } from './libraryStore'

let store: LibraryStore | null = null

/** 必须在 app ready 之后、且 setPath('userData') 之后调用。 */
export function getLibraryStore(): LibraryStore {
  if (!store) store = createLibraryStore(app.getPath('userData'))
  return store
}
