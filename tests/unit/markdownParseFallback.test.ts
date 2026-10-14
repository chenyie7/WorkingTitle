import { describe, it, expect, vi } from 'vitest'

/**
 * 【为什么单独一份文件】`vi.mock` 是按文件提升的，塞不进 markdownParse.test.ts。
 *
 * 这条守的是设计第 12 节那条降级契约：解析失败返回 null、不许把异常冒到调用方，
 * 调用方据此退回纯文本（不许白屏）。markdownParse.test.ts 里那条用例名字叫
 * 「解析不出来的输入返回 null」，但它喂的是空串——remark 把空串**正常**解析成
 * 空 root，`catch` 那条路一次都没走到。也就是说那边对 catch 是零覆盖，
 * 这条才是真正会红的那面 witness。
 *
 * 做法：把 `unified` 换成一个 parse 必抛的替身。`vi.mock` 的工厂会被提升到
 * import 之前，所以它只能自包含（要引用外层变量得用 `vi.hoisted`）——
 * 这里不需要外部变量，正好。
 */
vi.mock('unified', () => {
  const chain: { use: () => unknown; parse: () => never } = {
    use: () => chain,
    parse: () => {
      throw new Error('boom')
    }
  }
  return { unified: () => chain }
})

import { parseMarkdown } from '../../src/renderer/src/markdown/parse'

describe('parseMarkdown 的降级路径', () => {
  it('解析器抛异常时不冒到调用方：返回 null，并 warn 一行', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let result: ReturnType<typeof parseMarkdown> | undefined = undefined
    expect(() => {
      result = parseMarkdown('随便什么')
    }).not.toThrow()

    expect(result).toBeNull()
    // 别把错误吞得只剩一个 null——原始错误要一起交出来，否则线上无从查起
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('markdown')
    expect(warn.mock.calls[0][1]).toBeInstanceOf(Error)

    warn.mockRestore()
  })
})
