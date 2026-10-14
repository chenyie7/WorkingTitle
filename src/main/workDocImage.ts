import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, resolve } from 'node:path'

/**
 * 取一张工作文档里引用的图片，产出 `data:` URL 交给渲染层。
 *
 * 【为什么必须经主进程】渲染层是沙箱（`sandbox: true`），读不到磁盘；而
 * `index.html` 里那条 CSP 是 `img-src 'self' data:`——**网络图片也进不来**。
 * 两条路都收在这一处：本地读文件、网络去取，出去的都是 `data:`，
 * 于是一个字节的 CSP 都不用改（设计 8.1）。
 *
 * 【为什么不做成 IPC handler 里的几行】`registerIpc` 全仓零测试覆盖。
 * 逻辑放在这个不碰 electron 的模块里，才能用真文件、真 fetch 桩去单测。
 *
 * 【大小与超时是硬闸】工作文档里的一个外链不该让应用卡住或吃光内存：
 * 单张 8MB、网络 10 秒。超了就当失败处理（渲染层显示占位框）。
 *
 * 【只认图片扩展名】本地这一路按扩展名判，判不过的直接不读——不靠「读出来再看
 * magic bytes」，那样等于先把任意文件读进内存。
 */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const IMAGE_TIMEOUT_MS = 10_000

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  // SVG 也收：它经 `<img>` 加载时**不会执行脚本**，是浏览器层面的保证
  '.svg': 'image/svg+xml'
}

export async function loadWorkDocImage(src: string, baseDir: string): Promise<string | null> {
  if (typeof src !== 'string' || src.length === 0) return null
  if (src.startsWith('data:image/')) return src
  if (/^https?:\/\//i.test(src)) return fetchRemote(src)
  return readLocal(src, baseDir)
}

async function readLocal(src: string, baseDir: string): Promise<string | null> {
  const mime = MIME[extname(src).toLowerCase()]
  if (!mime) return null
  const full = isAbsolute(src) ? src : resolve(baseDir, src)
  try {
    const buf = await readFile(full)
    if (buf.byteLength === 0 || buf.byteLength > IMAGE_MAX_BYTES) return null
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (err) {
    console.warn('[wt] 读工作文档图片失败：', full, err)
    return null
  }
}

async function fetchRemote(url: string): Promise<string | null> {
  try {
    // `AbortSignal.timeout` 与 `fetch` 都来自 `@types/node`：`tsconfig.node.json`
    // 的 lib 里没有 DOM，这两个名字是靠 `types: ["node"]` 拿到的
    const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
    if (!res.ok) return null
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!mime.startsWith('image/')) return null
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > IMAGE_MAX_BYTES) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > IMAGE_MAX_BYTES) return null
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (err) {
    console.warn('[wt] 取工作文档图片失败：', url, err)
    return null
  }
}
