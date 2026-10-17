import type { WtApi } from '../../core/api'

/**
 * 渲染层取 preload 注入接口的唯一出口。**它可能不存在**：preload 加载失败时页面照常渲染，
 * 只是 `window.api` 为 undefined（`global.d.ts` 声明成必填，tsc 不会提醒判空）。
 *
 * 每次现取，不要在模块顶层缓存：那会把「preload 一定先于模块求值」写死进加载顺序。
 */
export function getApi(): WtApi | null {
  return (window as unknown as { api?: WtApi }).api ?? null
}
