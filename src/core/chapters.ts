import {
  DEFAULT_CHAPTER_RULE,
  type Chapter,
  type ChapterPresetId,
  type ChapterRule
} from './types'

export const PREAMBLE_TITLE = '前言'

/** 正文里常见的句读符号。编号正文与编号标题只靠它区分，见 isChapterTitle。 */
const SENTENCE_PUNCT = /[。！？；，]/

/**
 * 标题行的长度上限（量的是 trim 后的串）。
 *
 * 这是 TITLE_PATTERNS[2]（`chapter\s+\d+.*$`）唯一的界：那条正则的 `.*$` 本身无界，
 * 没有这个上限，一整段以 "Chapter 3" 开头的英文正文会被整行当成标题。
 * 上限量的是 trim 后的串，所以缩进与补白不占额度。
 */
const MAX_TITLE_LEN = 40

/** 「数字 + 顿号」没有强前缀，只能靠句读与编号正文区分；单独取出，闸门只对它生效。 */
const NUMBERED_TITLE = /^\s*[0-9]{1,4}\s*[、.．]\s*\S.{0,30}$/

const SPECIAL_TITLE =
  /^(?:[☆★✦✧※].{0,30}|【[^】]{1,30}】|(?:内容|文章)?简介|文案|前言|序章|楔子|正文|终章|尾声|后记|番外)$/

/** 预置表用 Record 声明：漏掉一个 id 编译期就报错。 */
export const CHAPTER_PRESETS: Readonly<Record<ChapterPresetId, string>> = {
  'cn-chapter': '第X章（中文）',
  numbered: '数字序号',
  'chapter-en': 'Chapter N',
  special: '特殊符号'
}

/**
 * 【每个模式都不得带 /g 或 /y】——这条靠注释与评审守，类型系统守不住。
 *
 * `RegExp.prototype.test` 在带 /g 或 /y 的正则上会读写自身的 lastIndex，于是同一行的判定
 * 会取决于「它前面刚测过什么」：isChapterTitle 就变成有状态的函数，第 n 行是不是标题
 * 要看第 n-1 行。导入一部二十多万行的小说时，这种错误既不可复现、也几乎不可见。
 *
 * 下面的 readonly 挡不住这件事：它只能阻止往表里 push、或对元素重新赋值，管不到
 * 「有人在某个模式字面量末尾写了个 /g」。所以真正的防线是这条注释加评审时的留意；
 * readonly 守的是另一件小事（别往这张表里塞模式）。表外的 NUMBERED_TITLE、CN_CHAPTER_TITLE、CHAPTER_EN_TITLE 同样受这条约束。
 */
const CN_CHAPTER_TITLE =
  /^\s*第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节回卷篇](?:\s+\S.{0,30})?\s*$/
const CHAPTER_EN_TITLE = /^\s*chapter\s+\d+.*$/i

const TITLE_PATTERNS: readonly RegExp[] = [
  CN_CHAPTER_TITLE,
  // 序章 / 楔子 雪夜 / 番外一 —— 后面必须跟空白才能带副标题，
  // 所以「前言不搭后语」不会被误判。
  /^\s*(?:序章|楔子|尾声|后记|前言|引子|番外)(?:[0-9零一二三四五六七八九十]+|[\s　]+\S.{0,30})?\s*$/,
  CHAPTER_EN_TITLE,
  NUMBERED_TITLE
]

function isAutoTitle(line: string): boolean {
  const t = line.trim()
  if (t.length === 0 || t.length > MAX_TITLE_LEN) return false
  // 句读闸门只作用于数字 + 顿号那条：前三条的强前缀足够与正文区分，副标题允许带标点。
  if (SENTENCE_PUNCT.test(t) && NUMBERED_TITLE.test(t)) return false
  return TITLE_PATTERNS.some((re) => re.test(t))
}

function presetMatches(id: ChapterPresetId, line: string): boolean {
  const t = line.trim()
  if (t.length === 0 || t.length > MAX_TITLE_LEN) return false
  switch (id) {
    case 'cn-chapter':
      return CN_CHAPTER_TITLE.test(t)
    case 'numbered':
      return !SENTENCE_PUNCT.test(t) && NUMBERED_TITLE.test(t)
    case 'chapter-en':
      return CHAPTER_EN_TITLE.test(t)
    case 'special':
      return SPECIAL_TITLE.test(t)
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
  if (rule.kind === 'auto') return isAutoTitle
  if (rule.kind === 'preset') return (line) => presetMatches(rule.id, line)
  const re = new RegExp(rule.pattern, 'i')
  return (line) => {
    const t = line.trim()
    // 空行永远不是标题：文件末尾那个空行 + 用户写的 ^.*$ 会凭空造出一章。
    return t !== '' && re.test(t)
  }
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
  const matcher = makeMatcher(rule)

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
  const matcher = makeMatcher(rule)
  const lines = text.split('\n')

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

/** 这条规则能不能在这段正文里认出至少一个标题。some 短路，正例通常只看几行。 */
export function hasChapterTitles(text: string, rule: ChapterRule = DEFAULT_CHAPTER_RULE): boolean {
  const matcher = makeMatcher(rule)
  return text.split('\n').some((line) => matcher(line))
}
