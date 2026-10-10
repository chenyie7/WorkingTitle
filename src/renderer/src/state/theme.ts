import { useEffect } from 'react'
import type { WtApi } from '../types/global'

/**
 * 平台在**模块加载时**就写进 `<html data-platform>`。
 *
 * 【为什么不做成 effect】它是静态信息，而 effect 要等首次渲染之后才跑——那一帧里
 * 标题条的文字会先跳到红绿灯底下、再弹回来。模块级副作用的代价是这一个文件不再"纯"，
 * 但 `App` 会 import 它，所以它的求值仍早于首次渲染。
 */
const hostApi = (window as unknown as { api?: WtApi }).api
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
    const api = (window as unknown as { api?: WtApi }).api
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
