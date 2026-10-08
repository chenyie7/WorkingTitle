import type { Chapter } from './types'

export const PREAMBLE_TITLE = '前言'

/** 正文里常见的句读符号：标题行不会包含它们 */
const SENTENCE_PUNCT = /[。！？；，]/

const TITLE_PATTERNS: RegExp[] = [
  // 第一章 / 第 12 章 / 第十二章 / 第一百零八回 / 第3节
  /^\s*第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节回卷篇](?:\s+\S.{0,30})?\s*$/,
  // 序章 / 楔子 雪夜 / 番外一 —— 后面必须跟空白才能带副标题，
  // 所以「前言不搭后语」不会被误判。
  /^\s*(?:序章|楔子|尾声|后记|前言|引子|番外)(?:[0-9零一二三四五六七八九十]+|[\s　]+\S.{0,30})?\s*$/,
  // Chapter 3 The Beginning
  /^\s*chapter\s+\d+.*$/i,
  // 1、开端 / 12．转折
  /^\s*[0-9]{1,4}\s*[、.．]\s*\S.{0,30}$/
]

export function isChapterTitle(line: string): boolean {
  const t = line.trim()
  if (t.length === 0 || t.length > 40) return false
  if (SENTENCE_PUNCT.test(t)) return false
  return TITLE_PATTERNS.some((re) => re.test(t))
}

export interface SplitResult {
  flatText: string
  chapters: Chapter[]
}

/**
 * 在**已归一化换行**（只含 \n）的文本上切分章节。
 * 保证 chapters[0].start === 0 且各章节 [start, end) 首尾相接、无缝、无重叠。
 */
export function splitChapters(text: string, fallbackTitle: string): SplitResult {
  const lines = text.split('\n')

  const titleIdx: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (isChapterTitle(lines[i])) titleIdx.push(i)
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
  const kept = bodies.filter((b) => b.body.trim() !== '')

  // 除最后一章外，每章正文末尾补一个 \n 作为章间分隔并计入该章，
  // 这样各章区间才能严格首尾相接（end === 下一章 start）。
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
