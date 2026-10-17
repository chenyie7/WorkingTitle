import { app, utilityProcess } from 'electron'
import { join } from 'node:path'
import type { Chapter, ChapterRule, Novel } from '../core/types'

/**
 * 小说后台进程的客户端。用 utilityProcess 而不是 worker_threads：打包后
 * worker_threads 里的 require 读不到 app.asar 内的 node_modules（iconv-lite / jschardet）。
 */

/** 后台进程起不来（启动失败）。请求中途退出用 NovelWorkerExitedError。 */
export class NovelWorkerUnavailableError extends Error {}

/** 后台进程在请求进行中退出。不能退回主进程重跑，否则自定义正则可能卡死主进程。 */
export class NovelWorkerExitedError extends NovelWorkerUnavailableError {}

/** 重新分章超时：自定义正则灾难性回溯时后台进程卡死，只能杀掉重来。 */
export class NovelWorkerTimeoutError extends Error {}

type Reply =
  | { id: number; ok: true; novel: Novel }
  | { id: number; ok: true; chapters: Chapter[] }
  | { id: number; ok: false; reason: string }

/** 9MB 样本切章约 200ms；10 秒只用来兜住正则回溯，不是性能预算。 */
const RESPLIT_TIMEOUT_MS = 10_000

interface Pending {
  resolve: (reply: Reply) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

let child: Electron.UtilityProcess | null = null
let nextId = 1
const pending = new Map<number, Pending>()

/** 常驻一个进程，不按次 fork：fork 本身要几十毫秒，常驻后每次导入只剩消息往返。 */
function ensureChild(): Electron.UtilityProcess {
  if (child) return child
  const proc = utilityProcess.fork(join(__dirname, 'novelWorker.js'), [], {
    serviceName: 'WorkingTitle 小说后台进程',
    stdio: 'inherit'
  })
  proc.on('message', (msg: Reply) => {
    const waiter = pending.get(msg.id)
    if (!waiter) return
    pending.delete(msg.id)
    if (waiter.timer) clearTimeout(waiter.timer)
    waiter.resolve(msg)
  })
  proc.on('exit', (code) => {
    const err = new NovelWorkerExitedError(`小说解码进程退出（${code}）`)
    for (const waiter of pending.values()) {
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.reject(err)
    }
    pending.clear()
    child = null
  })
  child = proc
  return proc
}

type RequestPayload =
  | { type: 'open'; filePath: string }
  | { type: 'resplit'; filePath: string; rule: ChapterRule }

function request(payload: RequestPayload, timeoutMs?: number): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer =
      timeoutMs === undefined
        ? null
        : setTimeout(() => {
            pending.delete(id)
            child?.kill()
            reject(new NovelWorkerTimeoutError(`小说后台进程超时（${timeoutMs}ms）`))
          }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    try {
      ensureChild().postMessage({ id, ...payload, baseDir: app.getPath('userData') })
    } catch (err) {
      if (timer) clearTimeout(timer)
      pending.delete(id)
      reject(new NovelWorkerUnavailableError(err instanceof Error ? err.message : String(err)))
    }
  })
}

export function openNovelInBackground(filePath: string): Promise<Novel> {
  return request({ type: 'open', filePath }).then((reply) => {
    if (reply.ok && 'novel' in reply) return reply.novel
    throw new Error(reply.ok ? '后台进程没有返回小说' : reply.reason)
  })
}

export function resplitNovelInBackground(
  sourcePath: string,
  rule: ChapterRule
): Promise<Chapter[]> {
  return request({ type: 'resplit', filePath: sourcePath, rule }, RESPLIT_TIMEOUT_MS).then(
    (reply) => {
      if (reply.ok && 'chapters' in reply) return reply.chapters
      throw new Error(reply.ok ? '后台进程没有返回章节' : reply.reason)
    }
  )
}
