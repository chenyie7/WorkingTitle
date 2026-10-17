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

/**
 * 「已经抽了多少字」的观测点。
 *
 * 【为什么不用状态栏】状态栏那条「已显示 N / 全书 M 字」已经删掉了——真 Word 只报全文字数、
 * 从不报「已显示多少」，那个词组本身就是伪装破绽。改读**正文长度**：那才是用户真正看到的，
 * 也是「抽了多少字」唯一的真相来源。`expect.poll` 负责重试（内容上屏不是同步的）。
 */
const revealed = async (): Promise<number> =>
  (await win.locator('[data-testid="page-text"]').textContent())?.length ?? 0

const focusEditor = async (): Promise<void> => {
  // 阅读区被一层透明 textarea（.wt-input）完全覆盖，点 .wt-page 会被它拦截。
  // 直接点这个 textarea —— opacity:0 不影响 Playwright 的可交互判定。
  await win.locator('[data-testid="input-capture"]').click()
}

test('启动即导入命令行传入的小说，并列出章节', async () => {
  await expect(win.locator('[data-testid="chapter-item-0"]')).toBeVisible()
  await expect(win.locator('[data-testid="chapter-item-2"]')).toBeVisible()
  await expect.poll(revealed).toBe(0)
})

test('打字不显示原字符，而是按比例抽出小说文字', async () => {
  await focusEditor()
  await win.keyboard.type('aaaaa')
  await expect.poll(revealed).toBe(50)

  const text = await win.locator('[data-testid="page-text"]').innerText()
  expect(text).not.toContain('a')
  expect(text.startsWith('第一章 甲')).toBe(true)
})

test('退格只回吐显示，小说内容不受影响', async () => {
  await focusEditor()
  await win.keyboard.type('aaa')
  await expect.poll(revealed).toBe(30)

  await win.keyboard.press('Backspace')
  await expect.poll(revealed).toBe(20)

  await win.keyboard.press('Backspace')
  await win.keyboard.press('Backspace')
  await expect.poll(revealed).toBe(0)

  // 再敲一次，仍然从同一位置重新抽出同样的文字
  await win.keyboard.type('a')
  await expect(win.locator('[data-testid="page-text"]')).toContainText('第一章 甲')
})

test('改比例后同样的击键抽出更多字', async () => {
  // 比例框现在在设置对话框里（原先挂在「开始」/「视图」两个选项卡的工具栏上）
  await win.locator('[data-testid="tab-文件"]').click()
  await win.locator('[data-testid="btn-settings"]').click()
  const ratio = win.locator('[data-testid="ratio-input"]')
  await ratio.fill('3')
  await ratio.press('Enter')
  await expect(win.locator('[data-testid="status-ratio"]')).toContainText('1:3')
  await win.locator('[data-testid="settings-close"]').click()
  await expect(win.locator('[data-testid="settings"]')).toBeHidden()

  await focusEditor()
  await win.keyboard.type('aa')
  await expect.poll(revealed).toBe(6)
})

/**
 * 【这条是本次唯一能在真机（真实 Chromium 的焦点语义 + 命中测试）里判的用例】
 *
 * jsdom 里测不到的是**后果**：对话框开着时用户敲的键会漏进小说，而字出在遮罩后面，
 * 用户看不见。单测里那两条守的是 InputCapture 里两条闸的机制，不是这个后果
 * ——尤其「点对话框里不可聚焦的空白处」这一下：浏览器会把焦点交给 body，而 jsdom 不会，
 * 单测是手工把那个状态摆出来的。
 */
test('设置对话框：按钮与 ⌘, 都能开，开着时敲键盘不抽字，Esc 关', async () => {
  await win.locator('[data-testid="tab-文件"]').click()
  await win.locator('[data-testid="btn-settings"]').click()
  await expect(win.locator('[data-testid="settings"]')).toBeVisible()

  // 打开那一瞬间焦点就得在对话框里：浏览器的 click 会先经过 React（对话框挂载 + autoFocus）、
  // 再冒泡到 window 上那个「点哪儿都把焦点抢回隐形输入框」的监听。少了那条闸，这一下就会
  // 把焦点抢走，下面的断言当场红。
  await expect(win.locator('[data-testid="doc-title-input"]')).toBeFocused()

  // 在文档名输入框里敲的字母进输入框，不许抽走小说
  await win.keyboard.type('aaa')
  await expect.poll(revealed).toBe(0)

  // 点对话框里不可聚焦的空白处：浏览器会把焦点交给 body，此后键盘没有焦点宿主，
  // 更不该被抢回阅读区。
  //
  // 【坐标为什么从面板挪到 footer】原先点的是 `.wt-modal__panel` 的 (4, 60)，那句话写的
  // 是「面板左边缘、行标号左侧」。加了 152px 宽的左栏之后，评审用 elementFromPoint 在面板
  // 坐标系下量过：**(4, 60) 精确命中第一个页签按钮**（`wt-nav__item--active`）。下面那两条
  // 断言在两个世界里都会绿——也就是说这条用例已经**静默地**不再验它声称要验的东西了。
  //
  // 【为什么是 footer 而不是「左栏下方的空白」】面板坐标系下那两个候选（(4,200) 左栏空白、
  // (156,200) body 空白）在 250% 缩放时会落到 `.wt-modal` 遮罩上——而遮罩的 onClick 正是
  // 「点它自己就关闭」，那一下会把对话框关掉、用例硬红；300% 时干脆出了视口。footer 的
  // (4,10) 是**元素相对坐标**、与缩放无关，六档实测全部命中 `.wt-modal__footer`：它高度
  // 48px 由内容（30px 按钮 + 18px 下内边距）撑住，两个按钮 `justify-content: flex-end`
  // 靠右排，所以左内边距那一片永远是空的。
  const panel = win.locator('[data-testid="settings"] .wt-modal__panel')
  await win.locator('[data-testid="settings"] .wt-modal__footer').click({ position: { x: 4, y: 10 } })
  // 【这一条是新加的，它让坐标自证】点到不可聚焦的空白处时，浏览器把焦点交给 body。
  // 少了它，上面那个坐标哪天又落回某个按钮上，这条用例照样绿——而它是本次唯一能在真机里
  // 判「焦点宿主」的用例。
  await expect.poll(() => win.evaluate(() => document.activeElement?.tagName ?? '')).toBe('BODY')
  await expect(win.locator('[data-testid="input-capture"]')).not.toBeFocused()
  await win.keyboard.type('bbb')
  await expect.poll(revealed).toBe(0)
  await expect(panel).toBeVisible()

  await win.keyboard.press('Escape')
  await expect(win.locator('[data-testid="settings"]')).toBeHidden()

  // 快捷键⌘/Ctrl + , 同样能开
  await win.keyboard.press('Meta+Comma')
  await expect(win.locator('[data-testid="settings"]')).toBeVisible()

  // 重开之后焦点必须仍在对话框里——**这一条只有真机判得了**。
  //
  // 【为什么要它】Task 1 修过一条 Critical：`page` 是持久状态、组件在 open 为假时不卸载，
  // 而 `autoFocus` 落在 `hidden`（display:none）子树里的元素上是 no-op，且只在挂载那一次跑。
  // 修之前，**每一次「切到非首页 → 关闭 → 重开」**都会让焦点原地留在关闭时被交还的那个
  // 隐形 textarea 上，而 `InputCapture` 里那道 `role="dialog"` 闸只长在抢焦点的那条路上
  // ——抽字路径上一条都没有。所以敲的键会在遮罩后面抽进小说，屏幕上完全看不出来。
  //
  // 单测已经判到了「jsdom 对 [hidden] 子树的 focus() 是 no-op」与「渲染期重置与 effect 重置
  // 的差别」，但**「Chromium 会不会同样如此」jsdom 判不了**——就是这一条。
  await win.locator('[data-testid="settings-tab-shortcuts"]').click()
  await win.locator('[data-testid="settings-close"]').click()
  await expect(win.locator('[data-testid="settings"]')).toBeHidden()
  await win.locator('[data-testid="btn-settings"]').click()
  await expect(win.locator('[data-testid="settings"]')).toBeVisible()
  await expect(win.locator('[data-testid="doc-title-input"]')).toBeFocused()

  // 【只断言「焦点在文档名上」不够，还要断言**后果】**——这才是修好的真机判据。
  // 焦点没回来的话，下面这几个字母会在遮罩后面抽进小说，`revealed` 就从 0 变成 3。
  await win.keyboard.type('xxx')
  await expect.poll(revealed).toBe(0)
})

/**
 * 三页的面板必须一样大。
 *
 * 【为什么只有这条判得了】jsdom 没有布局，`getBoundingClientRect()` 恒为 0——这个不变量
 * 在单测里根本不存在。它只能由真机判。
 *
 * 【改动前为什么是红的】面板高度由内容撑（`height: auto` + `max-height`），三页的行数是
 * 6 / 2 / 6，实测 410 / 198 / 386——而遮罩是垂直居中的，所以换页时面板既变高矮、又上下跳。
 */
test('设置面板三页大小一致', async () => {
  await win.locator('[data-testid="tab-文件"]').click()
  await win.locator('[data-testid="btn-settings"]').click()
  await expect(win.locator('[data-testid="settings"]')).toBeVisible()

  const heights: number[] = []
  const overflows: number[] = []
  for (const id of ['reading', 'appearance', 'shortcuts']) {
    await win.locator(`[data-testid="settings-tab-${id}"]`).click()
    // 【为什么等它可见再量】`click()` 只保证「点到了」，不保证「切过去了」。少了这一行，
    // 点击处理器坏掉时三次都会量到同一页的高度——下面那条 `Set.size === 1` 会**假绿**。
    // 等的是「被点那一页真的可见」，等价于断言切换确实生效。
    await expect(win.locator(`[data-testid="settings-tabpanel-${id}"]`)).toBeVisible()
    // 【另两页必须藏着】少了这一条还有一个假绿口子：若有人删掉
    // `.wt-tabpanel[hidden] { display: none }`，三页会叠在一起、面板每次都是同一个值，
    // `Set.size === 1` 照样绿（而被点的那块本来就可见，上面那个 settle 点也不会失败）。
    // 那条 CSS 自己的注释就写着「单测只看属性，照样全绿」——这条 e2e 正好补上。
    for (const other of ['reading', 'appearance', 'shortcuts'].filter((x) => x !== id)) {
      await expect(win.locator(`[data-testid="settings-tabpanel-${other}"]`)).toBeHidden()
    }
    heights.push(
      await win
        .locator('[data-testid="settings"] .wt-modal__panel')
        .evaluate((el) => el.getBoundingClientRect().height)
    )
    overflows.push(
      await win.evaluate(() => {
        const body = document.querySelector('.wt-modal__body') as HTMLElement
        return body.scrollHeight - body.clientHeight
      })
    )
  }

  // 【三者必须**严格**相等，不是「差不多」】三页的行数差得远，高度只要还由内容撑，
  // 这条当场红。
  expect(new Set(heights).size).toBe(1)

  // 【三页一致还不够：还要确认内容没被裁】少了这一条，把固定高度改小之后三页仍然相等，
  // 而阅读设置那页的内容被切掉——上面那条照样绿。
  //
  // 判的是 `scrollHeight <= clientHeight`，**不是某个绝对像素值**：它不依赖字体度量，
  // 直接回答「有没有东西被切掉」。反方向它也管——将来阅读设置页加了一行、自然高度超过
  // 固定值时，这里会红。
  //
  // 【但它**不是**窗口无关的，别把这条红当成回归】面板被 `min()` 夹到低于阅读页的自然高度时，
  // 内容区必然要滚，这一条就会红——而那是**对的**，内容确实被裁了。当前 e2e 每次都是
  // 1280×860、100% 缩放的新窗口（`calc(100vh - 48px)` = 812 > 410），所以它绿。
  // **别在带缩放或更小的窗口上跑 e2e，再把这条红当成回归。**
  expect(Math.max(...overflows)).toBe(0)
})

test('点击章节跳到该章，并在读过后回填进度', async () => {
  await win.locator('[data-testid="chapter-item-1"]').click()
  // 状态栏现在写的是页码形状的 `2 / 3`（真 Word 左下角就是页码），不再是「第 2 章 / 共 3 章」
  await expect(win.locator('[data-testid="status-chapter"]')).toHaveText('2 / 3')

  await focusEditor()
  await win.keyboard.type('a')
  await expect.poll(revealed).toBe(10)
  const afterTyping = await win.locator('[data-testid="page-text"]').innerText()

  // 离开再回来，进度应被回填
  await win.locator('[data-testid="chapter-item-0"]').click()
  await expect.poll(revealed).toBe(0)
  await win.locator('[data-testid="chapter-item-1"]').click()
  await expect.poll(revealed).toBe(10)
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
  await expect.poll(revealed).toBe(40)

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

  await expect.poll(revealed).toBe(40)
})

test('preload 暴露的接口与渲染层契约一致（进程边界的运行期闸）', async () => {
  // 类型闸（preload 的对象字面量 : WtApi）只在编译期；这里钉住真机上确实挂出了同一组方法。
  const surface = await win.evaluate(() => {
    const raw = (window as unknown as { api?: Record<string, unknown> }).api
    if (!raw) return null
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v]))
  })
  expect(surface).not.toBeNull()
  const expected: Record<string, string> = {
    platform: 'string',
    importNovel: 'function',
    importWorkDoc: 'function',
    loadWorkDoc: 'function',
    loadWorkDocImage: 'function',
    openNovelPath: 'function',
    initialNovelPath: 'function',
    loadSession: 'function',
    saveSession: 'function',
    clearSession: 'function',
    loadSettings: 'function',
    saveSettings: 'function',
    onMenuCommand: 'function',
    getTheme: 'function',
    setThemeSource: 'function',
    onThemeChange: 'function'
  }
  expect(Object.keys(surface!).sort()).toEqual(Object.keys(expected).sort())
  for (const [key, kind] of Object.entries(expected)) {
    expect(surface![key]).toBe(kind)
  }
})
