import {
  DEFAULT_CHAPTER_RULE,
  type Chapter,
  type ChapterPresetId,
  type ChapterRule
} from './types'

export const PREAMBLE_TITLE = '前言'

/** 自动识别算法变了就加一：旧缓存里的目录不再可信，打开时用缓存正文重切一次。 */
export const CHAPTER_SPLIT_VERSION = 2

/** 正文里常见的句读符号。编号正文与编号标题只靠它区分，见 AUTO_TESTS 里的数字规则。 */
const SENTENCE_PUNCT = /[。！？；，]/

/**
 * 标题行的长度上限（量的是 trim 后的串）。
 *
 * Chapter N 那条的 `.{0,30}` 本身无界，没有这个上限，一整段以 "Chapter 3" 开头的
 * 英文正文会被整行当成标题。上限量的是 trim 后的串，所以缩进与补白不占额度。
 */
const MAX_TITLE_LEN = 40

/** 标题编号里可能出现的数字：半角/全角阿拉伯数字与中文数字。 */
const NUM = '0-9０-９〇零一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟'
const CN_NUM = '〇零一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟'

/**
 * 第X章/节/回/卷/篇/部/集。有分隔符（空格、冒号…）时副标题可带句读；直接黏着写的
 * 副标题不许含句读——否则「第三章的内容很有意思，我读了三遍。」会变成一章。
 */
const CN_CHAPTER_TITLE = new RegExp(
  `^第\\s*[${NUM}]{1,12}\\s*(?:章|节(?!课)|回|卷|篇|部(?!分)|集(?![合和]))` +
    `(?:[\\s　:：、.．,，\\-—_]+\\s*\\S.{0,30}|[^。！？；，!?;]{0,30})?$`
)

const CHAPTER_EN_TITLE =
  /^(?:chapter|section|part|episode|no\.?)\s*\d{1,4}(?:[\s.:：、,，\-—_].{0,30})?$/i

/** 「数字 + 分隔符」没有强前缀，只能靠句读与编号正文区分；闸门只对它生效。 */
const NUMBERED_TITLE = /^[0-9０-９]{1,5}\s*[、.．,，:：\-—_ ]\s*\S.{0,30}$/
const CHINESE_NUMBERED_TITLE = new RegExp(
  `^[${CN_NUM}]{1,8}章?[、.．,，:：\\-—_ ]\\s*\\S.{0,30}$`
)

const SPECIAL_KEYWORD =
  /^(?:内容简介|文章简介|简介|文案|前言|序言|引子|序章|楔子|正文(?!完|结)|终章|尾声|后记|番外)(?:[0-9零一二三四五六七八九十]+|[\s　:：、.．,，\-—_]+\S.{0,30})?$/

const SPECIAL_SYMBOL =
  /^(?:[☆★✦✧※]\s*[^☆★✦✧※\s].{0,29}|【[^】]{1,30}】|〔[^〕]{1,30}〕|〖[^〗]{1,30}〗)$/

/** 章/卷 在前、序号在后：章12 标题 / 卷五 开源盛世。 */
const MARKER_NUMBER_TITLE = new RegExp(
  `^[卷章]\\s*[${NUM}]{1,8}(?:[\\s　:：、.．,，\\-—_].{0,30})?$`
)

const PART_TITLE = /^[上中下]\s*[部篇卷](?:[\s　:：、.．,，\-—_].{0,30})?$/

const BRACKETED_CHAPTER = new RegExp(
  `^[【〔〖\\[「『(（]\\s*第\\s*[${NUM}]{1,12}\\s*[章节回卷篇部集][^。！？；，!?;]{0,20}$`
)

/** 预置表用 Record 声明：漏掉一个 id 编译期就报错。 */
export const CHAPTER_PRESETS: Readonly<Record<ChapterPresetId, string>> = {
  'cn-chapter': '第X章（中文）',
  numbered: '数字序号',
  'chapter-en': 'Chapter N',
  special: '特殊符号'
}

type LineTest = (t: string) => boolean

/**
 * 自动识别的候选规则。一本小说通常只用一种标题写法，混用会把松规则套到正文上——
 * 所以按命中数选一条，而不是把全部规则取并集。取样与间距沿用 Legado 的做法：只看
 * 前 512KB、两条标题至少隔 1000 字才算一章，避开卷首那串目录。
 */
const AUTO_TESTS: readonly LineTest[] = [
  (t) => CN_CHAPTER_TITLE.test(t),
  (t) => SPECIAL_KEYWORD.test(t),
  (t) => MARKER_NUMBER_TITLE.test(t),
  (t) => PART_TITLE.test(t),
  (t) => BRACKETED_CHAPTER.test(t),
  (t) => CHAPTER_EN_TITLE.test(t),
  (t) => !SENTENCE_PUNCT.test(t) && NUMBERED_TITLE.test(t),
  (t) => !SENTENCE_PUNCT.test(t) && CHINESE_NUMBERED_TITLE.test(t),
  (t) => SPECIAL_SYMBOL.test(t)
]

const AUTO_SAMPLE_CHARS = 512 * 1024
const AUTO_TITLE_GAP = 1000

/**
 * 【每个模式都不得带 /g 或 /y】——这条靠注释与评审守，类型系统守不住。
 *
 * `RegExp.prototype.test` 在带 /g 或 /y 的正则上会读写自身的 lastIndex，于是同一行的判定
 * 会取决于「它前面刚测过什么」：isChapterTitle 就变成有状态的函数，第 n 行是不是标题
 * 要看第 n-1 行。导入一部二十多万行的小说时，这种错误既不可复现、也几乎不可见。
 */
function autoLine(test: LineTest, line: string): boolean {
  const t = line.trim()
  return t !== '' && t.length <= MAX_TITLE_LEN && test(t)
}

/** 单行问「像不像标题」：任一候选命中即可。切章不用它，走 pickAutoTest。 */
function anyAutoTitle(line: string): boolean {
  return AUTO_TESTS.some((test) => autoLine(test, line))
}

function pickAutoTest(lines: readonly string[]): LineTest | null {
  let best: LineTest | null = null
  let bestCount = 0
  for (const test of AUTO_TESTS) {
    let count = 0
    let lastStart = Number.NEGATIVE_INFINITY
    let offset = 0
    for (const line of lines) {
      if (offset >= AUTO_SAMPLE_CHARS) break
      if (autoLine(test, line) && offset - lastStart > AUTO_TITLE_GAP) {
        count++
        lastStart = offset
      }
      offset += line.length + 1
    }
    // 并列时保留靠前的那条：表的顺序就是从具体到宽松
    if (count > bestCount) {
      bestCount = count
      best = test
    }
  }
  return best
}

function presetMatches(id: ChapterPresetId, line: string): boolean {
  const t = line.trim()
  if (t.length === 0 || t.length > MAX_TITLE_LEN) return false
  switch (id) {
    case 'cn-chapter':
      return CN_CHAPTER_TITLE.test(t)
    case 'numbered':
      return (
        !SENTENCE_PUNCT.test(t) && (NUMBERED_TITLE.test(t) || CHINESE_NUMBERED_TITLE.test(t))
      )
    case 'chapter-en':
      return CHAPTER_EN_TITLE.test(t)
    case 'special':
      return SPECIAL_KEYWORD.test(t) || SPECIAL_SYMBOL.test(t)
    default: {
      const _exhaustive: never = id
      return false
    }
  }
}

/**
 * 规则 → 行判定器。自定义正则只编译一次；非法规则在这里直接抛错。这里不带 /g 或 /y，
 * 避免 lastIndex 让判定变成有状态的。
 */
function makeMatcher(rule: ChapterRule): (line: string) => boolean {
  const problem = chapterRuleProblem(rule)
  if (problem !== null) throw new Error(problem)
  if (rule.kind === 'auto') return anyAutoTitle
  if (rule.kind === 'preset') return (line) => presetMatches(rule.id, line)
  const re = new RegExp(rule.pattern, 'i')
  return (line) => {
    const t = line.trim()
    // 空行永远不是标题：文件末尾那个空行 + 用户写的 ^.*$ 会凭空造出一章。
    return t !== '' && re.test(t)
  }
}

/** 切章用：自动识别先按整本书选一条候选规则，其余规则就是它自己。 */
function makeTextMatcher(
  rule: ChapterRule,
  lines: readonly string[]
): (line: string) => boolean {
  if (rule.kind !== 'auto') return makeMatcher(rule)
  const test = pickAutoTest(lines)
  return test ? (line) => autoLine(test, line) : () => false
}

export function isChapterTitle(line: string, rule: ChapterRule = DEFAULT_CHAPTER_RULE): boolean {
  return makeMatcher(rule)(line)
}

/** 返回第一个不合格字段的描述；合格返回 null。 */
export function chapterRuleProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'chapterRule 不是对象'
  const r = v as Record<string, unknown>
  if (r.kind === 'auto') return null
  if (r.kind === 'preset') {
    if (typeof r.id !== 'string') return 'chapterRule.id 不是字符串'
    // Object.hasOwn 而不是 in：手改过的 JSON 能把 toString 这类原型链名字塞进来。
    if (!Object.hasOwn(CHAPTER_PRESETS, r.id)) return `chapterRule.id 不认识：${r.id}`
    return null
  }
  if (r.kind === 'custom') {
    if (typeof r.pattern !== 'string' || r.pattern.trim() === '') {
      return 'chapterRule.pattern 不是非空白字符串'
    }
    try {
      new RegExp(r.pattern, 'i')
    } catch {
      return 'chapterRule.pattern 不是合法正则'
    }
    return null
  }
  return 'chapterRule.kind 不认识'
}

export function chapterRuleEqual(
  a: ChapterRule | undefined,
  b: ChapterRule | undefined
): boolean {
  const ra = a ?? DEFAULT_CHAPTER_RULE
  const rb = b ?? DEFAULT_CHAPTER_RULE
  if (ra.kind === 'auto' || rb.kind === 'auto') return ra.kind === rb.kind
  if (ra.kind === 'preset' && rb.kind === 'preset') return ra.id === rb.id
  if (ra.kind === 'custom' && rb.kind === 'custom') return ra.pattern === rb.pattern
  return false
}

export interface SplitResult {
  flatText: string
  chapters: Chapter[]
}

/**
 * 在**已归一化换行**（只含 \n）的文本上切分章节。
 * 保证 chapters[0].start === 0 且各章节 [start, end) 首尾相接、无缝、无重叠。
 */
export function splitChapters(
  text: string,
  fallbackTitle: string,
  rule: ChapterRule = DEFAULT_CHAPTER_RULE
): SplitResult {
  const lines = text.split('\n')
  const matcher = makeTextMatcher(rule, lines)

  const titleIdx: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (matcher(lines[i])) titleIdx.push(i)
  }

  // 一个标题都没有 → 单章节模式，flatText 严格等于原文
  if (titleIdx.length === 0) {
    return {
      flatText: text,
      chapters: [
        { index: 0, title: fallbackTitle, start: 0, end: text.length, charCount: text.length }
      ]
    }
  }

  // 单位不一样，是刻意保留的：slices 里的 from/to 是【行号】（lines 的下标），
  // 而下面 Chapter 的 start/end 是【flatText 的字符偏移】。本函数的全部工作就是在这两种量
  // 之间换算，两个名字看着像却量不同的东西——统一命名反而会把两种单位伪装成同一种。
  const slices: Array<{ title: string; from: number; to: number }> = []
  if (titleIdx[0] > 0) {
    slices.push({ title: PREAMBLE_TITLE, from: 0, to: titleIdx[0] })
  }
  for (let i = 0; i < titleIdx.length; i++) {
    slices.push({
      title: lines[titleIdx[i]].trim(),
      from: titleIdx[i],
      to: i + 1 < titleIdx.length ? titleIdx[i + 1] : lines.length
    })
  }

  const bodies = slices.map((s) => ({
    title: s.title,
    body: lines.slice(s.from, s.to).join('\n')
  }))
  // 【这个过滤器只能丢掉「全空白的前言」，它不是通用的空章节清理】
  // 每个章节切片都从它自己的标题行开始（from = titleIdx[i]），而 isChapterTitle 要求
  // 该行 trim() 后非空，所以真章节的 body 必然包含自己的标题行，body.trim() 永不为 ''。
  // 也就是说「相邻标题之间的空章节」根本不可能存在——没有可丢的空章节。
  // 唯一会被丢掉的，是文件开头到第一个标题之间那段全空白区域（例如文件以若干空行开头）。
  const kept = bodies.filter((b) => b.body.trim() !== '')

  // 除最后一章外，每章正文末尾补一个 \n，计入该章。
  //
  // 【这个 \n 不负责区间连续】end === 下一章 start 是【构造性】成立的：start 取自
  // 追加前的 flatText.length，追加之后再取一次作为 end。把这段 \n 去掉，各章区间
  // 照样首尾相接——连续性只来自 start/end 的取值方式，与这里补不补字符无关。
  //
  // 【它唯一的用途是还原原文】lines.slice(from, to).join('\n') 丢掉了第 to-1 行之后
  // 本应存在的那个换行；补回来，flatText 才与源文件逐字相等。末章之后原文没有换行，
  // 故末章不补——这正是下面那个三元判断存在的原因。
  //
  // 逐字相等是刚需而非洁癖：Task 4 的 cursor / revealStart / chapterPos 全是 flatText
  // 的下标，Task 5 又会把它们持久化。只有 flatText === 原文，这些偏移才对得上用户
  // 真正导入的那个文件。
  let flatText = ''
  const chapters: Chapter[] = []
  kept.forEach((b, i) => {
    const chunk = i === kept.length - 1 ? b.body : `${b.body}\n`
    const start = flatText.length
    flatText += chunk
    chapters.push({
      index: i,
      title: b.title,
      start,
      end: flatText.length,
      charCount: chunk.length
    })
  })

  return { flatText, chapters }
}

/** 重新分章：只重算边界，保证 flatText 逐字等于输入；空白前缀折进第一章。理由见设计文档 3.2。 */
export function resplitChapters(
  text: string,
  fallbackTitle: string,
  rule: ChapterRule = DEFAULT_CHAPTER_RULE
): SplitResult {
  const lines = text.split('\n')
  const matcher = makeTextMatcher(rule, lines)

  const lineStart: number[] = new Array(lines.length)
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    lineStart[i] = offset
    offset += lines[i].length + 1
  }

  const titleIdx: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (matcher(lines[i])) titleIdx.push(i)
  }

  if (titleIdx.length === 0) {
    return {
      flatText: text,
      chapters: [
        { index: 0, title: fallbackTitle, start: 0, end: text.length, charCount: text.length }
      ]
    }
  }

  const firstTitleOffset = lineStart[titleIdx[0]]
  const slices: Array<{ title: string; start: number }> = []
  if (firstTitleOffset > 0 && text.slice(0, firstTitleOffset).trim() !== '') {
    slices.push({ title: PREAMBLE_TITLE, start: 0 })
  }
  for (let i = 0; i < titleIdx.length; i++) {
    const start = i === 0 && slices.length === 0 ? 0 : lineStart[titleIdx[i]]
    slices.push({ title: lines[titleIdx[i]].trim(), start })
  }

  const chapters: Chapter[] = slices.map((s, i) => {
    const end = i + 1 < slices.length ? slices[i + 1].start : text.length
    return { index: i, title: s.title, start: s.start, end, charCount: end - s.start }
  })

  return { flatText: text, chapters }
}

/** 这条规则能不能在这段正文里认出至少一个标题。 */
export function hasChapterTitles(text: string, rule: ChapterRule = DEFAULT_CHAPTER_RULE): boolean {
  const lines = text.split('\n')
  const matcher = makeTextMatcher(rule, lines)
  return lines.some((line) => matcher(line))
}
