export const CH = {
  importNovel: 'wt:import-novel',
  openNovelPath: 'wt:open-novel-path',
  loadSession: 'wt:load-session',
  saveSession: 'wt:save-session',
  clearSession: 'wt:clear-session',
  initialNovelPath: 'wt:initial-novel-path',
  menuCommand: 'wt:menu-command',
  getTheme: 'wt:get-theme',
  themeChanged: 'wt:theme-changed'
} as const

export const MENU_COMMANDS = [
  'import-novel',
  'clear-session',
  'about',
  'toggle-devtools'
] as const

export type MenuCommand = (typeof MENU_COMMANDS)[number]
