import { useCallback, useState } from 'react'
import { defaultSettings } from '../../../core/types'
import type { AppSettings } from '../../../core/types'

export type SettingsPatch =
  | Partial<AppSettings>
  | ((prev: AppSettings) => Partial<AppSettings>)

export interface AppSettingsStore {
  settings: AppSettings
  /** 合并式更新。函数形式拿到最新一份，同一个事件里连续 patch 不会互相覆盖。 */
  patchSettings: (update: SettingsPatch) => void
  /** 整份替换，只在读盘完成时用。 */
  replaceSettings: (next: AppSettings) => void
}

export function useAppSettings(): AppSettingsStore {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)

  const patchSettings = useCallback((update: SettingsPatch): void => {
    setSettings((prev) => ({ ...prev, ...(typeof update === 'function' ? update(prev) : update) }))
  }, [])

  const replaceSettings = useCallback((next: AppSettings): void => {
    setSettings(next)
  }, [])

  return { settings, patchSettings, replaceSettings }
}
