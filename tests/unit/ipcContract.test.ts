import { describe, it, expect } from 'vitest'
import { CH, MENU_COMMANDS } from '../../src/main/ipc'

describe('IPC 契约', () => {
  it('通道名稳定且带 wt: 前缀', () => {
    expect(CH).toEqual({
      importNovel: 'wt:import-novel',
      importWorkDoc: 'wt:import-work-doc',
      loadWorkDoc: 'wt:load-work-doc',
      loadWorkDocImage: 'wt:load-work-doc-image',
      openNovelPath: 'wt:open-novel-path',
      loadSession: 'wt:load-session',
      saveSession: 'wt:save-session',
      clearSession: 'wt:clear-session',
      loadSettings: 'wt:load-settings',
      saveSettings: 'wt:save-settings',
      initialNovelPath: 'wt:initial-novel-path',
      menuCommand: 'wt:menu-command',
      getTheme: 'wt:get-theme',
      themeChanged: 'wt:theme-changed',
      setThemeSource: 'wt:set-theme-source'
    })
  })

  it('每一条通道名都唯一', () => {
    const values = Object.values(CH)
    expect(new Set(values).size).toBe(values.length)
  })

  it('菜单命令集合稳定', () => {
    expect(MENU_COMMANDS).toEqual(['import-novel', 'clear-session', 'about', 'toggle-devtools'])
  })
})
