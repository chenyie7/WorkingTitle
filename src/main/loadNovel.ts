import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { decodeBuffer } from '../core/decode'
import { splitChapters } from '../core/chapters'
import type { Novel } from '../core/types'

/**
 * 读文件 → 解码 → 切章，顺序是契约而不是风格。
 *
 * 【归一化必须排在切章之前】splitChapters 按 '\n' 切行，它假定输入只含 \n。
 *   - CRLF 不是问题：实测 36 种 CRLF 形状，`splitChapters(raw).flatText === raw` 与
 *     `splitChapters(normalized).flatText === normalized` **结论逐例相同**（两边都是
 *     12/36 保真）。那 24 例不保真的换行种类无关——纯 LF 也 24 例——失败集合恰好是
 *     「文件开头有空白行 → 前言切片被 kept 过滤器丢掉」，那是 chapters.ts 已写明并有
 *     用例守着的行为。机制上也不是「join 丢掉 \r」：实测
 *     `'第一章 甲\r\n正文一。\r\n'.split('\n').slice(0, 2).join('\n')` 得
 *     `"第一章 甲\r\n正文一。\r"`，\r 被保留，随后补的那个 \n 正好补全 \r\n。
 *   - 【单独 \r（旧 Mac 换行）才是真会坏的】这类文本里一个 \n 都没有，split('\n')
 *     无从下刀，整份文件变成一行，章节结构塌成单章：实测 2 章的 CR-only 文本直接切
 *     只得 1 章，归一化后才是 2 章。此时 flatText 仍严格等于原文（坐标系没坏），
 *     坏的是章节列表、跳章目标与 chapterPos 的长度。
 * 归一化由 decodeBuffer 承担（它的三条返回路径都经过 normalizeNewlines），所以这里只需
 * 保证 decode 的结果直接喂给 splitChapters，中间不要再插入别的处理。
 *
 * 【去掉归一化时，两条端到端用例都会红，但红的理由不同】CRLF 那条红在字符串比较上——
 * 它断言 flatText 等于【归一化后】的字面量（Task 2 的 'CRLF 被归一为 LF' 用例守着同一契约
 * 的单元层）；CR-only 那条红的更早，章节数就从 2 变成 1。别把上面「CRLF 保真」读成
 * 「CRLF 可以不用归一化」：保真说的是 splitChapters 喂进原文时的输出等于原文，
 * 而归一化是 decode 对外的契约（设计文档 §8 也写明缓存的是「解码并归一化后的全文」）。
 * tests/unit/loadNovel.test.ts 里的这两条用例锁住本函数这一段管线。
 */
export function loadNovelFromFile(filePath: string): Novel {
  const buf = readFileSync(filePath)
  const { text, encoding, hadBom } = decodeBuffer(buf)
  const title = basename(filePath, extname(filePath)) || '未命名'
  const { flatText, chapters } = splitChapters(text, title)
  return { title, sourcePath: filePath, encoding, hadBom, flatText, chapters }
}
