import { TextDecoder } from 'node:util'
import iconv from 'iconv-lite'
// 具名导入而非默认导入：jschardet@4 是 dual ESM/CJS 包（package.json 里
// "type": "module" + exports 同时给 import/require），默认导入要依赖打包器的
// CJS interop 才能拿到 _default，具名导入在两种模块格式下都稳定。
// iconv-lite 则相反，声明文件是 `export = iconv`，必须用默认导入。
import { detect as detectEncoding } from 'jschardet'

export interface DecodeResult {
  text: string
  encoding: string
  hadBom: boolean
}

const BOMS: Array<{ bytes: number[]; encoding: string }> = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'UTF-8' },
  { bytes: [0xff, 0xfe], encoding: 'UTF-16LE' },
  { bytes: [0xfe, 0xff], encoding: 'UTF-16BE' }
]

export function detectBom(buf: Buffer): { encoding: string; length: number } | null {
  for (const bom of BOMS) {
    if (buf.length < bom.bytes.length) continue
    if (bom.bytes.every((b, i) => buf[i] === b)) {
      return { encoding: bom.encoding, length: bom.bytes.length }
    }
  }
  return null
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** 用严格模式试解 UTF-8：非法字节序列会抛错，返回 null。 */
function tryStrictUtf8(buf: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return null
  }
}

/** 解码质量打分：替换字符扣分，CJK 表意文字占比加分。 */
function scoreText(text: string): number {
  let replacement = 0
  let cjk = 0
  let total = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x0a) continue
    total++
    if (cp === 0xfffd) replacement++
    else if (cp >= 0x4e00 && cp <= 0x9fff) cjk++
  }
  if (total === 0) return 0
  return (cjk / total) * 1000 - replacement * 100
}

/**
 * 判断是否需要用 GB18030 兜底。
 *
 * jschardet 对中文的常见误判是给出单字节拉丁系（windows-125x / ISO-8859-*）或干脆给不出编码
 * ——这些情况才需要 GB18030 兜底。但如果它已经明确指出一个多字节 CJK / Unicode 编码，
 * 就【不能】再追加 GB18030：scoreText 奖励的是 CJK 表意文字占比，而 GB18030 会把
 * 任意字节对映射进该区，于是日文/韩文的正确解码（假名、谚文都不在该区）反而得分更低。
 * 实测得分：Shift_JIS 正确 529 / GB18030 乱码 971；EUC-KR 正确 0 / 乱码 706。
 */
const CONFIDENT_MULTIBYTE =
  /^(?:BIG5|CP932|SHIFT_JIS|SJIS|EUC-JP|EUC-KR|CP949|JOHAB|UTF-16|UTF-16LE|UTF-16BE|UTF-32|UCS-2)$/i

function needsGbFallback(detectedUpper: string): boolean {
  return detectedUpper === '' || !CONFIDENT_MULTIBYTE.test(detectedUpper)
}

function candidateEncodings(detected: string): string[] {
  const names: string[] = []
  const push = (n: string): void => {
    if (n && iconv.encodingExists(n) && !names.includes(n)) names.push(n)
  }
  const upper = (detected || '').toUpperCase()
  if (upper === 'GB2312' || upper === 'GBK' || upper === 'GB18030') push('GB18030')
  else if (upper === 'ASCII') push('UTF-8')
  else push(detected)

  // 条件性追加兜底。GB* 的情况上面已经 push 过，这里被去重成空操作。
  // 不要为了「保险」无条件追加——那会让日文/韩文被解成乱码（见 needsGbFallback 的注释）。
  // 也不要改成「只按 U+FFFD 数量打分」来回避：GB18030 几乎把所有字节对都映射到某个字符，
  // 乱码里的替换字符数同样≈0，两边打平，救不了。
  if (needsGbFallback(upper)) push('GB18030')
  return names
}

export function decodeBuffer(buf: Buffer): DecodeResult {
  if (buf.length === 0) return { text: '', encoding: 'UTF-8', hadBom: false }

  const bom = detectBom(buf)
  if (bom) {
    const text = iconv.decode(buf.subarray(bom.length), bom.encoding)
    return { text: normalizeNewlines(text), encoding: bom.encoding, hadBom: true }
  }

  // 合法 UTF-8 是极强的信号：GBK 中文几乎不可能碰巧构成合法 UTF-8 序列。
  const strict = tryStrictUtf8(buf)
  if (strict !== null) {
    return { text: normalizeNewlines(strict), encoding: 'UTF-8', hadBom: false }
  }

  const detected = detectEncoding(buf)?.encoding ?? ''
  const candidates = candidateEncodings(detected)

  let bestEncoding = candidates[0] ?? 'GB18030'
  let bestText = iconv.decode(buf, bestEncoding)
  let bestScore = scoreText(bestText)

  for (const enc of candidates.slice(1)) {
    const text = iconv.decode(buf, enc)
    const score = scoreText(text)
    if (score > bestScore) {
      bestScore = score
      bestText = text
      bestEncoding = enc
    }
  }

  return { text: normalizeNewlines(bestText), encoding: bestEncoding, hadBom: false }
}
