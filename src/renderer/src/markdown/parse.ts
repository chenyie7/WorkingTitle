import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root } from 'mdast'

/**
 * 工作文档的 md 解析。**全仓唯一 import remark 的地方。**
 *
 * 【为什么只解析、不渲染】裁剪与映射成 React 都在别的模块里，这里只负责
 * 「文本 → 带 position.offset 的语法树」。分开的理由是解析**只做一次**
 * （调用方按文档缓存），而后面几步每次渲染都要重跑——200KB 的 md 解析是几十毫秒
 * 量级，每次按键重解析不可接受。
 *
 * 【为什么返回 `Root | null` 而不是抛】调用方拿到 null 就退回纯文本那条路
 * （设计第 12 节：解析失败不许白屏）。remark 对畸形 md 基本不抛，这是兜底。
 *
 * 【position.offset 是整条路的坐标系地基】mdast 每个节点自带 `position.start.offset`
 * / `end.offset`，是**相对 flatText 的字符下标**——和 `cursor`、`revealStart` 同一个
 * 坐标系，所以裁剪时不需要任何换算（设计 3.1）。
 *
 * 【为什么 `unified` 实例提到模块级】`.use()` 会重建 processor，每次调用都建一遍
 * 是白扔的。processor 本身无可变状态，`.parse()` 也是纯的。
 *
 * 【ESM-only，别把它挪出渲染层】remark 全族是 `"type": "module"`。挪进 `src/core`
 * 会让 main 那份 tsconfig 也去解析它。Task 1 的用例守不住这条（类型检查才守得住），
 * 所以它是靠 `pnpm typecheck` 与这条注释一起守的。
 */
const processor = unified().use(remarkParse).use(remarkGfm)

/** 挂在 `code` / `inlineCode` 上的字段：`value` 的第一个字符在源码里的偏移。 */
export const WT_VALUE_START = 'wtValueStart'

/**
 * 读 `value` 的真实源码起点。没标注、标注不是有限数一律给 `null`——调用方据此退回
 * `position.start.offset`（普通 `text` 节点就是那一类，它们的两套坐标本来就重合）。
 */
export function valueStartOf(node: unknown): number | null {
  const raw = (node as Record<string, unknown> | null | undefined)?.[WT_VALUE_START]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

export function parseMarkdown(text: string): Root | null {
  try {
    const tree = processor.parse(text)
    annotateValueStarts(tree, text)
    return tree
  } catch (err) {
    console.warn('[wt] 解析 markdown 失败，退回纯文本：', err)
    return null
  }
}

/**
 * 这份工作文档要不要渲染。
 *
 * 【为什么按扩展名而不是按内容嗅探】「内容长得像 md」判不准，而且判错的代价是
 * 双向的：把一份纯文本当 md 渲染会吃掉里面的 `*` 和 `#`，把一份 md 当纯文本
 * 又会露出记号。扩展名是用户的意图，也是他后来能自己改回来的东西。
 *
 * 【`.md.txt` 判 false 是有意的】`extname` 只看最后一段。用户的意图是 txt。
 */
const MARKDOWN_EXT = /\.(md|markdown)$/i

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_EXT.test(filePath)
}

/**
 * 给 `code` / `inlineCode` 记下 `value` 的真实源码起点（设计 3.6）。
 *
 * 【为什么需要它】mdast 的 `position` 从**定界符**起算，而 `value` 里不含定界符——
 * 按 `position.start.offset` 当原点去切 `value`，内容会**恒定领先光标一个定界符的
 * 长度**（围栏块 4、带语言标注 6、行内代码是反引号的个数）。实测：光标走完 ` ``` `
 * 那一刻、正文一个字都没揭示，第一行已经整行上屏。
 *
 * 【为什么在这里算】本模块是全仓唯一手上有源码的地方，而这是**解析的产物**——
 * remark 怎么从源码得到 `value`，只有它知道。算一次挂在节点上，`clip.ts` 与
 * `toReact.tsx` 各自取用。
 *
 * 【一处已知残留，别当成没修干净】四空格缩进的代码块，remark 是**逐行**剥缩进的，
 * 不是常量偏移；这里只修首部，那种块内部仍有小偏差（设计 3.6 记着这条，是接受的）。
 */
function annotateValueStarts(node: unknown, source: string): void {
  const n = node as {
    type?: string
    children?: unknown[]
    position?: { start: { offset?: number }; end: { offset?: number } }
  }
  if (n.type === 'code' || n.type === 'inlineCode') {
    const start = n.position?.start.offset
    const end = n.position?.end.offset
    if (start !== undefined && end !== undefined) {
      ;(n as Record<string, unknown>)[WT_VALUE_START] = contentStartOf(n.type, source, start, end)
    }
  }
  for (const child of n.children ?? []) annotateValueStarts(child, source)
}

/**
 * `value` 的第一个字符在源码里的偏移。
 *
 * - 行内代码：起首那串反引号之后；
 * - 围栏代码块：围栏那一行（首行）的换行之后；
 * - 缩进代码块：首行的缩进之后。
 *
 * 【怎么区分围栏与缩进】看首行：行首最多三个空格之后以三个及以上 `` ` `` 或 `~`
 * 开头就是围栏——remark 只认这两种围栏，所以这个判据与它一致。
 */
function contentStartOf(kind: string, source: string, start: number, end: number): number {
  if (kind === 'inlineCode') {
    let i = start
    while (i < end && source[i] === '`') i++
    return i
  }
  const nl = source.indexOf('\n', start)
  const firstLineEnd = nl >= 0 && nl < end ? nl : end
  if (/^ {0,3}(`{3,}|~{3,})/.test(source.slice(start, firstLineEnd))) {
    // 围栏块：内容在围栏那一行之后
    return firstLineEnd < end ? firstLineEnd + 1 : firstLineEnd
  }
  // 缩进块：内容在首行的缩进之后
  let i = start
  while (i < end && (source[i] === ' ' || source[i] === '\t')) i++
  return i
}
