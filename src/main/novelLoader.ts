import { app, utilityProcess } from 'electron'
import { join } from 'node:path'
import type { Novel } from '../core/types'

/**
 * 小说解码的后台进程客户端。用 utilityProcess 而不是 worker_threads：打包后
 * worker_threads 里的 require 读不到 app.asar 内的 node_modules（iconv-lite / jschardet）。
 */

/** 后台进程本身不可用（退出、启动失败）。文件读不出来的错误不走这个类型。 */
export class NovelWorkerUnavailableError extends Error {}

interface Reply {
  id: number
  ok: boolean
  novel?: Novel
  reason?: string
}

let child: Electron.UtilityProcess | null = null
let nextId = 1
const pending = new Map<number, { resolve: (novel: Novel) => void; reject: (err: Error) => void }>()

/** 常驻一个进程，不按次 fork：fork 本身要几十毫秒，常驻后每次导入只剩消息往返。 */
function ensureChild(): Electron.UtilityProcess {
  if (child) return child
  const proc = utilityProcess.fork(join(__dirname, 'novelWorker.js'), [], {
    serviceName: 'WorkingTitle 小说解码',
    stdio: 'inherit'
  })
  proc.on('message', (msg: Reply) => {
    const waiter = pending.get(msg.id)
    if (!waiter) return
    pending.delete(msg.id)
    if (msg.ok && msg.novel) waiter.resolve(msg.novel)
    else waiter.reject(new Error(msg.reason ?? '解码失败'))
  })
  proc.on('exit', (code) => {
    const err = new NovelWorkerUnavailableError(`小说解码进程退出（${code}）`)
    for (const waiter of pending.values()) waiter.reject(err)
    pending.clear()
    child = null
  })
  child = proc
  return proc
}

export function openNovelInBackground(filePath: string): Promise<Novel> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    try {
      ensureChild().postMessage({ id, filePath, baseDir: app.getPath('userData') })
    } catch (err) {
      pending.delete(id)
      reject(new NovelWorkerUnavailableError(err instanceof Error ? err.message : String(err)))
    }
  })
}
