import type { ReactNode } from 'react'

export interface MarkdownImageProps {
  url: string
  alt: string
}

/**
 * 图片。**本任务的版本是占位**：不取图，只画一个虚线框，里面是替代文字。
 *
 * 【为什么要分两步】取图要走 IPC（渲染层是沙箱，读不到磁盘也拿不到网络），
 * 而那条通道属于 Task 9。先给一个不依赖任何东西的占位版，本任务才能自己绿。
 * Task 9 会把这里改成真的取图 + 缓存，并保留 `data-testid` 与 `data-src` 这两个钩子。
 *
 * 【为什么框里放替代文字而不是空的】抽字是逐字来的，图片那一段语法被揭示之前
 * 这个节点根本不在树里（`clip.ts` 管这个）。一旦在树里，它就该占住位置——
 * 一个空框会让人以为渲染坏了。
 */
export function MarkdownImage({ url, alt }: MarkdownImageProps): ReactNode {
  return (
    <span className="wt-md-img" data-src={url} data-testid="md-image">
      {alt}
    </span>
  )
}
