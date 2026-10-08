import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyUserDataOverride, resolveInitialNovelPath } from '../../src/main/startup'

/** 调用方应当注入的谓词形状：区分「是普通文件」与「存在」。 */
function realIsFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

describe('applyUserDataOverride', () => {
  it('设置 WT_USER_DATA 时覆盖 userData 路径', () => {
    const setPath = vi.fn()
    const applied = applyUserDataOverride({ WT_USER_DATA: '/tmp/wt-profile' }, setPath)
    expect(applied).toBe(true)
    expect(setPath).toHaveBeenCalledWith('userData', '/tmp/wt-profile')
  })

  it('未设置时不覆盖', () => {
    const setPath = vi.fn()
    expect(applyUserDataOverride({}, setPath)).toBe(false)
    expect(setPath).not.toHaveBeenCalled()
  })
})

describe('resolveInitialNovelPath', () => {
  // 名字是 isFile 而不是 exists：这两个问题在「名叫 xxx.txt 的目录」上分道扬镳，
  // 而本函数依赖的是后者（见下一条用例）。
  const isFile = (p: string): boolean => p === '/books/三国演义.txt' || p === './小说.txt'

  it('从 argv 里挑出存在的 txt 路径', () => {
    expect(resolveInitialNovelPath(['/Applications/WT', '/books/三国演义.txt'], isFile)).toBe(
      '/books/三国演义.txt'
    )
  })

  it('dev 模式下跳过 "." 之类的非 txt 参数', () => {
    expect(resolveInitialNovelPath(['/path/electron', '.', './小说.txt'], isFile)).toBe('./小说.txt')
  })

  it('忽略不存在的 txt 路径', () => {
    expect(resolveInitialNovelPath(['/Applications/WT', '/books/不存在.txt'], isFile)).toBeNull()
  })

  it('忽略开关参数', () => {
    expect(resolveInitialNovelPath(['/Applications/WT', '--inspect', '--flag.txt'], isFile)).toBeNull()
  })

  it('没有候选时返回 null', () => {
    expect(resolveInitialNovelPath(['/Applications/WT'], isFile)).toBeNull()
  })

  it('多个候选时取最后一个', () => {
    expect(
      resolveInitialNovelPath(['/Applications/WT', '/books/三国演义.txt', './小说.txt'], isFile)
    ).toBe('./小说.txt')
  })

  // 名叫 xxx.txt 的目录：existsSync 说 true，statSync(...).isFile() 说 false，
  // 而 readFileSync 会抛 EISDIR。传 existsSync 的话这样一个目录会被选中 →
  // loadNovelFromFile 当场抛错 → Task 12 的 initialPath 分支没有 try/catch →
  // 启动期未处理 rejection。用真实的 statSync 谓词把这条契约钉住。
  it('名叫 xxx.txt 的目录不会被选中', () => {
    const root = mkdtempSync(join(tmpdir(), 'wt-startup-'))
    const dirAsTxt = join(root, '其实是个目录.txt')
    const realFile = join(root, '真文件.txt')
    mkdirSync(dirAsTxt)
    writeFileSync(realFile, '正文', 'utf8')

    // 前提：它确实是个目录、而且确实以 .txt 结尾（否则这条用例测不到那个分支）
    expect(statSync(dirAsTxt).isDirectory()).toBe(true)
    expect(dirAsTxt.endsWith('.txt')).toBe(true)

    expect(resolveInitialNovelPath(['/Applications/WT', dirAsTxt], realIsFile)).toBeNull()
    expect(resolveInitialNovelPath(['/Applications/WT', dirAsTxt, realFile], realIsFile)).toBe(
      realFile
    )
    rmSync(root, { recursive: true, force: true })
  })
})
