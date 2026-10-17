import { createSessionStore } from './sessionStore'
import { openNovelWithRule, resplitNovelWithRule } from './novelService'
import type { Chapter, ChapterRule, Novel } from '../core/types'

/**
 * 小说导入与重新分章的后台进程入口。读、解码、切章、缓存读写都在这里跑：
 * 占时间的是解码与切章，放在主进程会让其它 IPC 一起排队。
 */

type Request =
  | { type: 'open'; id: number; filePath: string; baseDir: string }
  | { type: 'resplit'; id: number; filePath: string; baseDir: string; rule: ChapterRule }

type Reply =
  | { id: number; ok: true; novel: Novel }
  | { id: number; ok: true; chapters: Chapter[] }
  | { id: number; ok: false; reason: string }

const parentPort = process.parentPort

parentPort.on('message', (event) => {
  const req = event.data as Request
  try {
    const store = createSessionStore(req.baseDir)
    if (req.type === 'resplit') {
      const result = resplitNovelWithRule(store, req.filePath, req.rule)
      const reply: Reply = result.ok
        ? { id: req.id, ok: true, chapters: result.value }
        : { id: req.id, ok: false, reason: result.reason }
      parentPort.postMessage(reply)
      return
    }
    const reply: Reply = { id: req.id, ok: true, novel: openNovelWithRule(store, req.filePath) }
    parentPort.postMessage(reply)
  } catch (err) {
    const reply: Reply = {
      id: req.id,
      ok: false,
      reason: err instanceof Error ? err.message : String(err)
    }
    parentPort.postMessage(reply)
  }
})
