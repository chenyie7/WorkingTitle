import { isVolumeTitle } from '../../../core/chapters'
import type { Chapter } from '../../../core/types'

export type TreeRow =
  | { kind: 'book'; key: string; depth: 0; title: string; chapterIndex: null }
  | { kind: 'volume'; key: string; depth: 1; title: string; chapterIndex: number }
  | { kind: 'chapter'; key: string; depth: 1 | 2; title: string; chapterIndex: number }

export interface TreeOptions {
  bookTitle: string
  query: string
  bookCollapsed: boolean
  collapsedVolumes: ReadonlySet<number>
}

interface ChapterGroup {
  volume: Chapter | null
  chapters: Chapter[]
}

function groupChapters(chapters: readonly Chapter[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [{ volume: null, chapters: [] }]
  for (const chapter of chapters) {
    if (isVolumeTitle(chapter.title)) {
      groups.push({ volume: chapter, chapters: [] })
    } else {
      groups[groups.length - 1].chapters.push(chapter)
    }
  }
  return groups
}

export function buildTreeRows(
  chapters: readonly Chapter[],
  options: TreeOptions
): TreeRow[] {
  const book: TreeRow = {
    kind: 'book',
    key: 'book',
    depth: 0,
    title: options.bookTitle,
    chapterIndex: null
  }
  const query = options.query.trim().toLowerCase()
  const searching = query !== ''

  if (options.bookCollapsed && !searching) return [book]

  const rows: TreeRow[] = [book]
  for (const group of groupChapters(chapters)) {
    const visible = searching
      ? group.chapters.filter((chapter) => chapter.title.toLowerCase().includes(query))
      : group.chapters

    if (group.volume === null) {
      for (const chapter of visible) {
        rows.push({
          kind: 'chapter',
          key: `c-${chapter.index}`,
          depth: 1,
          title: chapter.title,
          chapterIndex: chapter.index
        })
      }
      continue
    }

    if (searching && visible.length === 0) continue

    rows.push({
      kind: 'volume',
      key: `v-${group.volume.index}`,
      depth: 1,
      title: group.volume.title,
      chapterIndex: group.volume.index
    })

    if (!searching && options.collapsedVolumes.has(group.volume.index)) continue

    for (const chapter of visible) {
      rows.push({
        kind: 'chapter',
        key: `c-${chapter.index}`,
        depth: 2,
        title: chapter.title,
        chapterIndex: chapter.index
      })
    }
  }
  return rows
}

export function findChapterRow(rows: readonly TreeRow[], chapterIndex: number): number {
  return rows.findIndex((row) => row.chapterIndex === chapterIndex)
}

export function chapterPercent(charCount: number, pos: number): number {
  if (charCount === 0) return 100
  return Math.min(100, Math.round((pos / charCount) * 100))
}
