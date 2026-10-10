import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const NOVEL = resolve(__dirname, '..', 'fixtures', 'e2e-novel.txt')

let app: ElectronApplication
let win: Page
let profileDir: string

test.beforeEach(async () => {
  profileDir = mkdtempSync(join(tmpdir(), 'wt-e2e-'))
  app = await electron.launch({
    args: ['.', NOVEL],
    cwd: resolve(__dirname, '..', '..'),
    env: { ...process.env, WT_USER_DATA: profileDir }
  })
  win = await app.firstWindow()
  await win.waitForSelector('[data-testid="app-root"]')
})

test.afterEach(async () => {
  // 「重启恢复」用例已经自己关过一次，这里必须容错
  try {
    await app.close()
  } catch {
    // 已关闭
  }
  rmSync(profileDir, { recursive: true, force: true })
})

const focusEditor = async (): Promise<void> => {
  // 阅读区被一层透明 textarea（.wt-input）完全覆盖，点 .wt-page 会被它拦截。
  // 直接点这个 textarea —— opacity:0 不影响 Playwright 的可交互判定。
  await win.locator('[data-testid="input-capture"]').click()
}

test('启动即导入命令行传入的小说，并列出章节', async () => {
  await expect(win.locator('[data-testid="chapter-item-0"]')).toBeVisible()
  await expect(win.locator('[data-testid="chapter-item-2"]')).toBeVisible()
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 0')
})

test('打字不显示原字符，而是按比例抽出小说文字', async () => {
  await focusEditor()
  await win.keyboard.type('aaaaa')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 50')

  const text = await win.locator('[data-testid="page-text"]').innerText()
  expect(text).not.toContain('a')
  expect(text.startsWith('第一章 甲')).toBe(true)
})

test('退格只回吐显示，小说内容不受影响', async () => {
  await focusEditor()
  await win.keyboard.type('aaa')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 30')

  await win.keyboard.press('Backspace')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 20')

  await win.keyboard.press('Backspace')
  await win.keyboard.press('Backspace')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 0')

  // 再敲一次，仍然从同一位置重新抽出同样的文字
  await win.keyboard.type('a')
  await expect(win.locator('[data-testid="page-text"]')).toContainText('第一章 甲')
})

test('改比例后同样的击键抽出更多字', async () => {
  const ratio = win.locator('[data-testid="ratio-input"]')
  await ratio.fill('3')
  await ratio.press('Enter')
  await expect(win.locator('[data-testid="status-ratio"]')).toContainText('1:3')

  await focusEditor()
  await win.keyboard.type('aa')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 6')
})

test('点击章节跳到该章，并在读过后回填进度', async () => {
  await win.locator('[data-testid="chapter-item-1"]').click()
  await expect(win.locator('[data-testid="status-chapter"]')).toContainText('第 2 章')

  await focusEditor()
  await win.keyboard.type('a')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 10')
  const afterTyping = await win.locator('[data-testid="page-text"]').innerText()

  // 离开再回来，进度应被回填
  await win.locator('[data-testid="chapter-item-0"]').click()
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 0')
  await win.locator('[data-testid="chapter-item-1"]').click()
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 10')
  expect(await win.locator('[data-testid="page-text"]').innerText()).toBe(afterTyping)
})

test('占位按钮点击有可见反馈', async () => {
  await win.locator('[data-testid="tab-文件"]').click()
  await win.locator('[data-testid="btn-export-docx"]').click()
  await expect(win.locator('[data-testid="toast"]')).toContainText('演示占位功能')
})

test('重启后恢复到上次阅读位置，无需重新输入', async () => {
  await focusEditor()
  await win.keyboard.type('aaaa')
  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 40')

  // 等防抖保存落盘
  await win.waitForTimeout(1200)
  await app.close()

  app = await electron.launch({
    args: ['.', NOVEL],
    cwd: resolve(__dirname, '..', '..'),
    env: { ...process.env, WT_USER_DATA: profileDir }
  })
  win = await app.firstWindow()
  await win.waitForSelector('[data-testid="app-root"]')

  await expect(win.locator('[data-testid="status-chars"]')).toContainText('已显示 40')
})
