export const CH = {
  importNovel: 'wt:import-novel',
  importWorkDoc: 'wt:import-work-doc',
  loadWorkDoc: 'wt:load-work-doc',
  loadWorkDocImage: 'wt:load-work-doc-image',
  openNovelPath: 'wt:open-novel-path',
  listNovels: 'wt:list-novels',
  deleteNovel: 'wt:delete-novel',
  resplitNovel: 'wt:resplit-novel',
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
} as const

export const MENU_COMMANDS = [
  'import-novel',
  'clear-session',
  'about',
  'toggle-devtools'
] as const

export type MenuCommand = (typeof MENU_COMMANDS)[number]
