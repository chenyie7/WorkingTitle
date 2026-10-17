import { useEffect, useState, type ReactNode } from 'react'
import { getApi } from '../api'

export interface MarkdownImageProps {
  url: string
  alt: string
}

/**
 * 取过的图片按地址缓存。**存的是那次请求本身（Promise），不是它的结果。**
 *
 * 【为什么必须有这一层】阅读区每次按键都重渲染，而图片节点在树里是稳定的；
 * 没有缓存的话，节点每重建一次就重发一次 IPC——大图的 base64 会一次次地搬。
 *
 * 【为什么存 Promise 而不是结果】同一个地址在一份文档里出现两次是常事，而两个
 * `MarkdownImage` 是在**同一次提交里挂载**的：那会儿第一次请求还没回来，
 * 「结果缓存」两次都落空，于是发两次 IPC。存 Promise 才是真的「同一个地址只请求一次」。
 * （写成本文件最初那一版时实测过：两个同地址节点 `toHaveBeenCalledTimes(2)`。）
 *
 * 【为什么必带 catch】这个 Promise 会一直躺在缓存里，一旦是 rejected 的，之后每次
 * 挂载都会拿到同一个拒绝——不但永远画不出图，还会变成一个 unhandled rejection
 * （本仓库实测过：那会让整轮 vitest 的 exit code 变 1，而用例行照旧 passed）。
 *
 * 【为什么不做淘汰】地址来自工作文档，一个文档里的图片地址个数天然有限；
 * 换文档时整棵子树都会被重建，而模块级的这份缓存会留下来。留下的是 base64，
 * 有界但不清——真出现「换了很多文档、内存涨上去」再考虑，现在加淘汰是过度设计。
 */
const cache = new Map<string, Promise<string | null>>()

/** 按地址取一次图。同一个地址并发调用只发一次 IPC。 */
function fetchOnce(url: string): Promise<string | null> {
  const hit = cache.get(url)
  if (hit) return hit
  const p = (getApi()?.loadWorkDocImage(url) ?? Promise.resolve(null)).catch(() => null)
  cache.set(url, p)
  return p
}

/**
 * 换工作文档时清一次。缓存键只有原始地址，两份文档出现同一相对路径时会串图；
 * 文档一换，旧地址的解析基准也不再成立。
 */
export function clearMarkdownImageCache(): void {
  cache.clear()
}

/**
 * markdown 图片。
 *
 * 【两种形态】拿不到图（还没回来 / 失败 / 空地址）时是**占位框 + 替代文字**，
 * 拿到了才是 `<img>`。占位框那一态是有用的：抽字是逐字来的，图片那一小段语法
 * 刚被揭示时请求还没回来，屏幕上得有个东西占住位置，否则会看到文字跳一下。
 *
 * 【为什么地址交给主进程解析】相对路径的基准目录只有主进程知道（它从设置里读
 * 工作文档自己的路径）。渲染层传的只是一个原样的 `src`。
 */
export function MarkdownImage({ url, alt }: MarkdownImageProps): ReactNode {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!url) return
    let alive = true
    void fetchOnce(url).then((v) => {
      if (alive) setDataUrl(v)
    })
    return () => {
      alive = false
    }
  }, [url])

  if (!url || !dataUrl) {
    return (
      <span className="wt-md-img" data-src={url} data-testid="md-image">
        {alt}
      </span>
    )
  }
  return <img className="wt-md-img-real" src={dataUrl} alt={alt} data-testid="md-image-real" />
}
