import { createSessionStore } from './sessionStore'
import { loadNovelFromFile } from './loadNovel'

/**
 * 小说导入的 utility process 入口。整条管线（读、解码、切章、缓存读写）都在这里跑：
 * 占时间的不是 readFileSync（几毫秒），而是解码（9MB 样本约 180ms）与切章——
 * 只把读文件改成异步解决不了主进程阻塞，所以别把它们挪回 main。
 */

interface Request {
  id: number
  filePath: string
  baseDir: string
}

const parentPort = process.parentPort

parentPort.on('message', (event) => {
  const { id, filePath, baseDir } = event.data as Request
  try {
    const store = createSessionStore(baseDir)
    const cached = store.readNovelCache(filePath)
    const novel = cached ?? loadNovelFromFile(filePath)
    if (!cached) store.writeNovelCache(novel)
    parentPort.postMessage({ id, ok: true, novel })
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      reason: err instanceof Error ? err.message : String(err)
    })
  }
})
