import type { WtApi } from '../../../core/api'

declare global {
  interface Window {
    api: WtApi
  }
}
