import { useEffect } from 'react'
import { getApi } from '../api'
import type { ThemeSource } from '../../../core/types'

/**
 * 平台在**模块加载时**就写进 `<html data-platform>`。
 *
 * 【为什么不做成 effect】它是静态信息，而 effect 要等首次渲染之后才跑——那一帧里
 * 标题条的文字会先跳到红绿灯底下、再弹回来。模块级副作用的代价是这一个文件不再"纯"，
 * 但 `App` 会 import 它，所以它的求值仍早于首次渲染。
 */
const hostApi = getApi()
if (hostApi?.platform) document.documentElement.dataset.platform = hostApi.platform

/**
 * 把系统外观写到 `<html data-theme>`，并在它变化时跟着更新。
 *
 * 【为什么不用 `@media (prefers-color-scheme: dark)`】实测（Electron 44 / macOS 深色系统）：
 * 这个应用里那条 media query **恒不命中**——主进程 `nativeTheme.shouldUseDarkColors` 是 true、
 * `themeSource` 手动设成 'dark' 之后**重载整窗**也仍然是 false。所以主题只能由主进程经 IPC 递过来
 * （见 `src/preload/index.ts` 里的说明）。别把这里"简化"回 CSS 媒体查询。
 */
export function useSystemTheme(): void {
  useEffect(() => {
    const el = document.documentElement
    const apply = (dark: boolean): void => {
      el.dataset.theme = dark ? 'dark' : 'light'
    }
    const api = getApi()
    if (!api) return

    void api.getTheme().then(apply)
    return api.onThemeChange(apply)
  }, [])
}

/**
 * 「深色模式下纸张也变暗」这个开关。
 *
 * 默认【关】：真 Word 的深色模式里纸张仍然是白的，保持这一点伪装才完整。
 * 打开之后阅读区整块也跟着暗下来——那是为了夜里看书不刺眼，代价是不再像 Word。
 *
 * 单独写一个 data 属性而不是塞进 data-theme：两者是正交的，
 * 深色纸只在深色外观下才有意义，浅色外观下开了也没用（CSS 里按组合选择器处理）。
 */
export function useDarkPaper(enabled: boolean): void {
  useEffect(() => {
    document.documentElement.dataset.paper = enabled ? 'dark' : 'light'
  }, [enabled])
}

/**
 * 阅读区正文字号（px）。**只作用于小说与 `.txt` 工作文档那一路**。
 *
 * 【为什么是一个 CSS 变量而不是 data 属性】前面两个开关是「开/关」这类枚举，落到
 * `data-*` 上让 CSS 用属性选择器取；字号是一个连续量，只能是变量。写的地方与它们相同
 * （`documentElement`）——内联样式比 `:root` 那条规则优先级高，所以会盖住 `page.css` 里
 * 那个等于默认值的初值。
 *
 * 【为什么不做成 `data-` + 几档选择器】档位表要在 CSS 里手写一遍、core 里再写一遍，
 * 加一档要改两处；而它本来就是「12–24 里选一个数」。
 *
 * 【它为什么不作用于 md】md 工作文档不算这条路——它的一整套字号是照着 Word 的标题层级
 * 写死的 px（`h1` 26px、`--wt-md-code-line` 20.8px…），跟着缩会把层级弄散。
 * `page.css` 里 `.wt-page__novel` 那段是这条口径的正本。
 */
export function usePageFontSize(px: number): void {
  useEffect(() => {
    document.documentElement.style.setProperty('--wt-page-font-size', `${px}px`)
  }, [px])
}

/**
 * 把用户选的外观推给主进程。
 *
 * 【为什么不能只在页面里翻 class】macOS 的**红绿灯与其它原生部分**由主进程的
 * `nativeTheme.themeSource` 决定。只改网页的话会出现「网页变暗了、红绿灯还是系统色」——
 * 那正是刚修好的那种不一致。推给主进程之后，它会经 `themeChanged` 把**解析后的**结果
 * 广播回来（`useSystemTheme` 负责上色），原生与网页一起变。
 *
 * 另一层原因：`'system'` 这个选项本身就只能在主进程里解析——渲染层读不到系统外观
 * （见 `useSystemTheme` 上面那段实测）。
 */
export function useThemePreference(source: ThemeSource): void {
  useEffect(() => {
    const api = getApi()
    if (!api) return
    void api.setThemeSource(source)
  }, [source])
}
