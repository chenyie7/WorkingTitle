import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import iconv from 'iconv-lite'
import {
  decodeBuffer,
  normalizeNewlines,
  detectBom,
  needsGbFallback,
  CONFIDENT_MULTIBYTE_NAMES
} from '../../src/core/decode'

const ZH = '第一章 风起\n\n林昭站在城墙上，望着远方的烽火。\n他想起十年前的那个雪夜。\n'

describe('detectBom', () => {
  it('识别 UTF-8 BOM', () => {
    expect(detectBom(Buffer.from([0xef, 0xbb, 0xbf, 0x41]))).toEqual({ encoding: 'UTF-8', length: 3 })
  })
  it('识别 UTF-16LE BOM', () => {
    expect(detectBom(Buffer.from([0xff, 0xfe, 0x41, 0x00]))).toEqual({ encoding: 'UTF-16LE', length: 2 })
  })
  it('无 BOM 返回 null', () => {
    expect(detectBom(Buffer.from('abc'))).toBeNull()
  })
})

describe('normalizeNewlines', () => {
  it('CRLF 与 CR 都归一为 LF', () => {
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })
})

describe('decodeBuffer', () => {
  it('无 BOM 的 UTF-8 中文识别为 UTF-8', () => {
    const r = decodeBuffer(Buffer.from(ZH, 'utf8'))
    expect(r.encoding).toBe('UTF-8')
    expect(r.hadBom).toBe(false)
    expect(r.text).toBe(ZH)
  })

  it('UTF-8 BOM 被剥离且 hadBom 为 true', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ZH, 'utf8')])
    const r = decodeBuffer(buf)
    expect(r.encoding).toBe('UTF-8')
    expect(r.hadBom).toBe(true)
    expect(r.text).toBe(ZH)
    expect(r.text.charCodeAt(0)).toBe('第'.charCodeAt(0))
  })

  it('GBK 中文能正确还原（不会走 UTF-8 分支）', () => {
    const buf = iconv.encode(ZH, 'gbk')
    const r = decodeBuffer(buf)
    expect(r.encoding).not.toBe('UTF-8')
    expect(r.text).toBe(ZH)
    expect(r.text).not.toContain('\uFFFD')
  })

  it('UTF-16LE（带 BOM）能正确还原', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(ZH, 'utf16le')])
    const r = decodeBuffer(buf)
    expect(r.encoding).toBe('UTF-16LE')
    expect(r.text).toBe(ZH)
  })

  it('CRLF 被归一为 LF', () => {
    const r = decodeBuffer(Buffer.from('a\r\nb', 'utf8'))
    expect(r.text).toBe('a\nb')
  })

  it('空 buffer 不抛异常', () => {
    const r = decodeBuffer(Buffer.alloc(0))
    expect(r.text).toBe('')
    expect(r.hadBom).toBe(false)
  })

  it('Shift_JIS 日文不被 GB18030 兜底误选', () => {
    // scoreText 奖励 CJK 表意文字占比，而 GB18030 会把任意字节对映射进该区：
    // 日文正确解码（假名不在该区）几乎不得分，GB18030 乱码反而得高分。
    // 本样本实测：正确 400.0 / 乱码 1000.0（同样注意这数字随文本而变，不是固有属性）。
    // 若兜底追加不设条件，这里就会被解成乱码。
    const ja = '風が吹く\n彼は城壁に立っていた。\n'
    const buf = iconv.encode(ja, 'shift_jis')
    const r = decodeBuffer(buf)
    expect(r.text).toBe(ja)
  })

  it('EUC-KR 韩文不被 GB18030 兜底误选', () => {
    const ko = '바람이 분다\n그는 성벽에 서 있었다.\n'
    const buf = iconv.encode(ko, 'euc-kr')
    const r = decodeBuffer(buf)
    expect(r.text).toBe(ko)
  })

  it('无 BOM 的 UTF-16LE 不被 GB18030 兜底误选', () => {
    // 为什么必须用【无 BOM】的样本：带 BOM 的 UTF-16 在第一步就被 BOM 检查短路由掉，
    // 根本走不到 needsGbFallback，所以那个用例覆盖不到这条路径。
    // jschardet 对无 BOM 的 UTF-16 返回 `utf-16-le`（带连字符的 WHATWG 标签），
    // 照 compat 表写的正则（UTF-16LE）会漏配 → 追加 GB18030 → 乱码胜出。
    const ko = '바람이 분다\n그는 성벽에 서 있었다.\n'
    const buf = iconv.encode(ko, 'utf16le') // iconv-lite 的 utf16le 不加 BOM
    const r = decodeBuffer(buf)
    expect(r.text).toBe(ko)
    expect(r.encoding).not.toBe('GB18030')
  })
})

/**
 * 从 jschardet 自己的词表里读出它「实际会吐出的编码名」全集。
 *
 * 刻意在测试期现读、而不是抄一份快照：本测试的全部意义就是拿我们的假设去对库的真实词表，
 * jschardet 升级导致这里失败是【特性】而非毛病——它会强制我们重新测量。
 * 注意它的 exports map 只暴露 "."，所以深路径 import 必须走绝对路径
 * （createRequire 解析出入口文件后取同目录的兄弟文件），否则报 ERR_PACKAGE_PATH_NOT_EXPORTED。
 */
async function jschardetVocabulary(): Promise<string[]> {
  const buildDir = dirname(createRequire(import.meta.url).resolve('jschardet'))
  const [registryModule, outputNamesModule] = await Promise.all([
    import(pathToFileURL(join(buildDir, 'registry.js')).href) as Promise<{
      REGISTRY: Record<string, unknown>
    }>,
    import(pathToFileURL(join(buildDir, 'output_names.js')).href) as Promise<{
      _COMPAT_NAMES: Record<string, string>
    }>
  ])
  // 词表里是内部名，真正吐给调用方的是经 _COMPAT_NAMES 改名后的名字
  return [...new Set(Object.keys(registryModule.REGISTRY).map((n) => outputNamesModule._COMPAT_NAMES[n] ?? n))]
}

describe('词汇表：黑名单是对 jschardet 名字表的断言', () => {
  /**
   * 需要豁免 GB18030 兜底的全部名字——这是【完整枚举】，不是抽样。
   * 单字节拉丁系不需要豁免（兜底就是为它们准备的）；GB* 家族由 candidateEncodings
   * 另行映射成 GB18030，不走本名单。
   */
  const MUST_BE_EXEMPT = [
    'Big5',
    'CP932',
    'CP949',
    'EUC-JP',
    'EUC-KR',
    'SHIFT_JIS',
    'Johab',
    'UTF-16',
    'utf-16-be',
    'utf-16-le',
    'UTF-32',
    'utf-32-be',
    'utf-32-le'
  ]
  const norm = (s: string): string => s.toUpperCase().replace(/[-_]/g, '')

  it('这些名字确实还在 jschardet 的词表里（信念没过期）', async () => {
    const vocab = await jschardetVocabulary()
    expect(MUST_BE_EXEMPT.filter((n) => !vocab.includes(n))).toEqual([])
  })

  it('词表里每个多字节 CJK/Unicode 名都免于 GB18030 兜底', () => {
    // 这条就是当初能抓住 UTF-16LE 那个 bug 的断言：旧正则写 UTF-16LE，
    // 而 jschardet 吐的是 utf-16-le，于是这里会列出 utf-16-le / utf-16-be / utf-32-*。
    expect(MUST_BE_EXEMPT.filter((n) => needsGbFallback(n.toUpperCase()))).toEqual([])
  })

  it('豁免集合与词表严格一致——不多（死条款）也不少（漏配）', async () => {
    const vocab = await jschardetVocabulary()
    const exempt = vocab.filter((n) => !needsGbFallback(n.toUpperCase())).sort()
    expect(exempt).toEqual([...MUST_BE_EXEMPT].sort())
  })

  it('黑名单里没有死条款：每个前缀都能对上词表里的真名字', async () => {
    const vocab = await jschardetVocabulary()
    const dead = CONFIDENT_MULTIBYTE_NAMES.filter((alt) => !vocab.some((v) => norm(v).startsWith(alt)))
    expect(dead).toEqual([])
  })
})
