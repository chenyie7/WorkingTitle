/**
 * 纯逻辑启动辅助，不 import electron，便于单测。
 */

/** WT_USER_DATA 允许把配置目录重定向（E2E 测试与便携模式使用）。 */
export function applyUserDataOverride(
  env: Record<string, string | undefined>,
  setPath: (name: string, path: string) => void
): boolean {
  const dir = env.WT_USER_DATA
  if (!dir) return false
  setPath('userData', dir)
  return true
}

/**
 * 从命令行参数里找出要自动打开的小说路径。
 *
 * 【注入的谓词要回答的是「是不是普通文件」，不是「存在不存在」】这两个问题在
 * 「名叫 `xxx.txt` 的目录」上分道扬镳：实测 `existsSync(目录)` 为 true，
 * `statSync(目录).isFile()` 为 false，而 `readFileSync(目录)` 抛 `EISDIR`。
 * 于是传 `existsSync` 的话，这样一个目录会被选中，`loadNovelFromFile` 当场抛错；
 * Task 12 的 `initialPath` 分支没有 try/catch，一次启动期的未处理 rejection。
 * 调用方应传 `(p) => { try { return statSync(p).isFile() } catch { return false } }`。
 *
 * 本函数是纯的，管不到调用方传什么：Task 6 的 `index.ts` 若仍传 `existsSync`
 * （它是合法的 `(p: string) => boolean`，不会报类型错），这条修复等于没落地。
 * 已记入设计文档 §13。
 */
export function resolveInitialNovelPath(
  argv: string[],
  isFile: (p: string) => boolean
): string | null {
  for (let i = argv.length - 1; i >= 1; i--) {
    const arg = argv[i]
    if (!arg || arg.startsWith('-')) continue
    if (!arg.toLowerCase().endsWith('.txt')) continue
    if (isFile(arg)) return arg
  }
  return null
}
