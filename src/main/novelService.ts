import type { IpcResult } from '../core/api'
import { chapterRuleEqual, hasChapterTitles, resplitChapters } from '../core/chapters'
import { DEFAULT_CHAPTER_RULE } from '../core/types'
import type { Chapter, ChapterRule, Novel } from '../core/types'
import { loadNovelFromFile } from './loadNovel'
import type { SessionStore } from './sessionStore'

/**
 * 按这本书会话里记的规则打开。
 *
 * 缓存能不能复用，判据是「缓存是按同一条规则切的」，不是「缓存存在」：
 * 只按 sourcePath/mtime/size 命中会让换过规则的书读到旧目录。
 */
export function openNovelWithRule(store: SessionStore, filePath: string): Novel {
  const rule = store.readSession(filePath)?.chapterRule ?? DEFAULT_CHAPTER_RULE
  const entry = store.readNovelCacheEntry(filePath)
  if (entry && chapterRuleEqual(entry.chapterRule, rule)) return entry.novel

  if (entry) {
    const { chapters } = resplitChapters(entry.novel.flatText, entry.novel.title, rule)
    const novel: Novel = { ...entry.novel, chapters }
    store.writeNovelCache(novel, rule)
    return novel
  }

  const novel = loadNovelFromFile(filePath, rule)
  store.writeNovelCache(novel, rule)
  return novel
}

/**
 * 按新规则重切一本已经打开过的书。
 *
 * 【缓存不存在时拒绝，而不是重读源文件】源文件与当前 flatText 可能差一个被丢掉的空白
 * 前言；重读会让章节偏移整体错位，而那种错位不会抛错。宁可让用户重新导入。
 */
export function resplitNovelWithRule(
  store: SessionStore,
  sourcePath: string,
  rule: ChapterRule
): IpcResult<Chapter[]> {
  const entry = store.readNovelCacheEntry(sourcePath)
  if (!entry) {
    return { ok: false, reason: '找不到这本书的缓存，请重新导入' }
  }
  // auto 的 0 匹配就是单章目录，是用户选回自动识别时要回到的状态
  if (rule.kind !== 'auto' && !hasChapterTitles(entry.novel.flatText, rule)) {
    return { ok: false, reason: '这条规则没有识别出任何章节，目录未改动' }
  }

  const { chapters } = resplitChapters(entry.novel.flatText, entry.novel.title, rule)
  store.writeNovelCache({ ...entry.novel, chapters }, rule)
  return { ok: true, value: chapters }
}
