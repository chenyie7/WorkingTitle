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

export function parseMarkdown(text: string): Root | null {
  try {
    return processor.parse(text)
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
