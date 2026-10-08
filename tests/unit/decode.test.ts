import { describe, it, expect } from 'vitest'
import { VERSION as JSCHARDET_VERSION } from 'jschardet'
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
 * 快照 JSCHARDET_EMITTED_NAMES 测得时安装的 jschardet 版本。
 * 与快照绑在一起、由下面的版本断言守着，两者必须一起更新——分开写就会各自过期。
 */
const JSCHARDET_VERSION_MEASURED = '4.0.0'

/**
 * jschardet@4.0.0 实际会吐出的编码名【实测快照】（86 个）。
 *
 * 为什么用快照而不是运行时去读 jschardet 的词表：它的 exports map 只暴露 "."，也没有
 * 公开的枚举 API，唯一办法是绕过 exports map 去读包内私有的 build 产物——用
 * `createRequire(import.meta.url).resolve('jschardet')` 拿到入口、再 `path.join` 取同目录的
 * registry.js / output_names.js（可移植，不需要写死绝对路径）。但那会让一份「本应稳定」的
 * 测试绑死在包内部的产物布局上，不值得。快照同样能抓住本测试要抓的那类 bug：
 * 词表里的 `utf-16-le` 若前缀匹配不上，这里立刻失败。
 *
 * 【机制】同一个族会以两种拼写并存：`UTF-16` / `UTF-32` 是 compat 改名后的裸名，
 * 而 `utf-16-le` / `utf-16-be` / `utf-32-be` / `utf-32-le` 是原样吐出的 WHATWG 标签。
 * 照 compat 表写正则就会「看起来对、实际漏配」，于是这些编码被误加 GB18030 兜底并被
 * 解成乱码——这是本测试存在的理由。
 *
 * 【这份快照抓不到什么】它看不见「库自己变了」：jschardet 改名或新增名字都不会改动下面的
 * 字面量。改名由本文件的版本断言兜住（升级即失败并要求重新测量）；而「新增了一个前缀匹配
 * 不到的多字节 CJK 名」无人能看见，属 Task 15 的 (b) 覆盖范围。
 */
const JSCHARDET_EMITTED_NAMES = [
  "ascii", "utf-8", "UTF-8-SIG", "UTF-16",
  "utf-16-be", "utf-16-le", "UTF-32", "utf-32-be",
  "utf-32-le", "utf-7", "Big5", "CP932",
  "CP949", "EUC-JP", "EUC-KR", "GB18030",
  "HZ-GB-2312", "ISO-2022-JP", "iso2022_jp_2004", "iso2022_jp_ext",
  "ISO-2022-KR", "SHIFT_JIS", "CP874", "Windows-1250",
  "Windows-1251", "Windows-1252", "Windows-1253", "Windows-1254",
  "Windows-1255", "Windows-1256", "Windows-1257", "cp1258",
  "KOI8-R", "koi8-u", "TIS-620", "ISO-8859-1",
  "ISO-8859-2", "iso8859-3", "iso8859-4", "ISO-8859-5",
  "ISO-8859-6", "ISO-8859-7", "ISO-8859-8", "ISO-8859-9",
  "iso8859-10", "ISO-8859-13", "iso8859-14", "iso8859-15",
  "iso8859-16", "Johab", "MacCyrillic", "MacGreek",
  "MacIceland", "MacLatin2", "MacRoman", "MacTurkish",
  "cp720", "cp1006", "cp1125", "koi8-t",
  "KZ1048", "ptcp154", "hp-roman8", "cp437",
  "cp737", "cp775", "cp850", "cp852",
  "IBM855", "cp856", "cp857", "cp858",
  "cp860", "cp861", "cp862", "cp863",
  "cp864", "cp865", "IBM866", "cp869",
  "cp1140", "cp424", "cp500", "cp875",
  "cp1026", "cp273"
]

/**
 * 快照里属于【多字节 CJK / Unicode】的名字——必须免于 GB18030 兜底。
 * 完整枚举而非抽样：单字节拉丁系不需要豁免（兜底正是为它们准备的）；
 * GB* 家族由 candidateEncodings 另行映射成 GB18030，不走本名单。
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

/**
 * 【文档性例外清单，不是被校验的性质】快照里 6 个「多字节 CJK / 中文体系、但本谓词不豁免」
 * 的名字中，除 GB18030 之外的那 5 个。GB18030 不在此列是因为 candidateEncodings 会主动把
 * GB* 系列映射成 GB18030，本就不该走这个名单。
 *
 * 显式点名列出，而不是靠过滤条件默默排除：它们都是 7-bit 编码（每个字节 < 0x80），会先被
 * 严格 UTF-8 短路接管，根本走不到候选列表，所以豁免与否对它们没有意义。见设计文档 §13。
 * 静默排除正是这类 bug 藏身之处，所以宁可写死在这里。
 *
 * 注意下面那条断言只检查这些名字确实在快照里（防名单打错字），**并不校验这个划分本身**：
 * 划分来自对 86 个名字的实测，而静态快照看不见新增名字，所以这里不做（也不该做）一个
 * 「自动推导例外集」的断言。
 */
const SEVEN_BIT_BEYOND_REACH = [
  'HZ-GB-2312',
  'ISO-2022-JP',
  'iso2022_jp_2004',
  'iso2022_jp_ext',
  'ISO-2022-KR'
]

/**
 * 注意：本组是这些编码名【唯一】的守卫。行为用例的样本经 detect() 后只落到
 * GB18030 / CP932 / CP949 / utf-16-le 四个名字（Shift_JIS 与 EUC-KR 的样本分别被
 * PREFERRED_SUPERSET 重映射为 CP932 / CP949），于是 13 个信念名里有 10 个没有任何
 * 行为用例触达：Big5、EUC-JP、EUC-KR、SHIFT_JIS、Johab、UTF-16、utf-16-be、
 * UTF-32、utf-32-be、utf-32-le。**删掉本组不等于行为测试仍覆盖这些编码。**
 */
describe('词汇表：黑名单必须与 jschardet 的名字表一致', () => {
  const norm = (s: string): string => s.toUpperCase().replace(/[-_]/g, '')

  it('安装的 jschardet 版本与快照测得时一致（升级必须重新测量）', () => {
    // 本快照是【实测】结果，它只能看见「有人把黑名单改错」，看不见「库自己变了」：
    // jschardet 改名/新增名字都不会改动我们的字面量。版本断言正是补这个洞——
    // 任何升级都会在这里大声失败，逼我们重新测量，而不是安静地继续用过期快照。
    expect(
      JSCHARDET_VERSION,
      `快照 JSCHARDET_EMITTED_NAMES 是对 jschardet ${JSCHARDET_VERSION_MEASURED} 实测得到的，`
        + `当前安装的是 ${JSCHARDET_VERSION}。编码名表可能已变：请重新测量快照`
        + `（读 build/registry.js 与 build/output_names.js），并同时更新`
        + ` JSCHARDET_EMITTED_NAMES、MUST_BE_EXEMPT、SEVEN_BIT_BEYOND_REACH 与`
        + ` JSCHARDET_VERSION_MEASURED。`
    ).toBe(JSCHARDET_VERSION_MEASURED)
  })

  it('快照自检：两张名单都确实取自快照', () => {
    // 长度断言是唯一能盖住「快照里被删掉一个【不豁免】名字」的守卫——那种改动不触发
    // 别的任何断言。所以失败信息要给下一步动作，而不只是 expected 86。
    expect(
      JSCHARDET_EMITTED_NAMES,
      `快照是对 jschardet ${JSCHARDET_VERSION_MEASURED} 实测得到的 86 个名字，`
        + `当前有 ${JSCHARDET_EMITTED_NAMES.length} 个。名字表可能被改错或漏抄：`
        + `请重新测量（读 build/registry.js 与 build/output_names.js），并同时更新`
        + ` JSCHARDET_EMITTED_NAMES、MUST_BE_EXEMPT、SEVEN_BIT_BEYOND_REACH 与`
        + ` JSCHARDET_VERSION_MEASURED。`
    ).toHaveLength(86)
    expect(MUST_BE_EXEMPT.filter((n) => !JSCHARDET_EMITTED_NAMES.includes(n))).toEqual([])
    expect(SEVEN_BIT_BEYOND_REACH.filter((n) => !JSCHARDET_EMITTED_NAMES.includes(n))).toEqual([])
  })

  it('谓词自带归一化：大小写与分隔符都由它自己处理', () => {
    // 回归守卫：调用方忘了 .toUpperCase() 时，不能再静默返回 true（= 追加兜底）。
    // 这正是要防的 footgun：调用方漏了归一化，兜底就会静默生效。
    expect(needsGbFallback('utf-16-le')).toBe(false)
    expect(needsGbFallback('utf_16_le')).toBe(false)
    expect(needsGbFallback('shift_jis')).toBe(false)
    expect(needsGbFallback('BIG5')).toBe(false)

    // 反向：该兜底的仍然要兜底，别把归一化写成「一律不兜底」。
    expect(needsGbFallback('windows-1252')).toBe(true)
    expect(needsGbFallback('koi8-r')).toBe(true)
    expect(needsGbFallback('')).toBe(true)
  })

  it('多字节 CJK/Unicode 名全部免于 GB18030 兜底，且豁免集合不多不少', () => {
    // 这条就是当初能抓住 UTF-16LE 那个 bug 的断言：旧正则写 UTF-16LE，
    // 而 jschardet 吐的是 utf-16-le，于是这里会列出 utf-16-be/le、utf-32-be/le。
    // 刻意传【原始名字】不做预处理——归一化是谓词自己的责任（见上一条用例）。
    expect(MUST_BE_EXEMPT.filter((n) => needsGbFallback(n))).toEqual([])

    // 反向：豁免集合必须与上面严格相等——多了（死条款）少了（漏配）都失败。
    const exempt = JSCHARDET_EMITTED_NAMES.filter((n) => !needsGbFallback(n)).sort()
    expect(exempt).toEqual([...MUST_BE_EXEMPT].sort())
  })

  it('黑名单里没有死条款：每个前缀都能对上快照里的真名字', () => {
    const dead = CONFIDENT_MULTIBYTE_NAMES.filter(
      (alt) => !JSCHARDET_EMITTED_NAMES.some((v) => norm(v).startsWith(alt))
    )
    expect(dead).toEqual([])
  })
})
