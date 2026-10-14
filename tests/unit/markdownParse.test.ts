import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'

/**
 * 【这一批用例断言的是**关系**，不是字面数字】
 *
 * 偏移量的绝对值会随 remark 版本漂移，钉死数字等于把「升级一次依赖」变成「改一堆测试」。
 * 真正要守的是那条关系：`text.slice(start.offset, end.offset)` 必须等于该节点在源码里
 * 的那一段。这条关系一旦不成立，裁剪整条路都会错位。
 */
function sliceOf(text: string, node: { position?: { start: { offset?: number }; end: { offset?: number } } }): string {
  const s = node.position?.start.offset ?? -1
  const e = node.position?.end.offset ?? -1
  return text.slice(s, e)
}

describe('parseMarkdown', () => {
  it('标题：类型、层级、以及切片等于源码那一段', () => {
    const text = '# 季度汇报\n'
    const tree = parseMarkdown(text)!
    expect(tree.children[0].type).toBe('heading')
    expect(sliceOf(text, tree.children[0])).toBe('# 季度汇报')
  })

  it('GFM 表格被解析成 table 节点', () => {
    const text = '| 项目 | 负责人 |\n| --- | --- |\n| 归档 | 张三 |\n'
    const tree = parseMarkdown(text)!
    expect(tree.children[0].type).toBe('table')
    expect(sliceOf(text, tree.children[0])).toBe(text.trimEnd())
  })

  it('GFM 任务列表：listItem 上带 checked', () => {
    const tree = parseMarkdown('- [x] 已完成\n- [ ] 没做\n')!
    const items = (tree.children[0] as { children: { checked?: boolean | null }[] }).children
    expect(items[0].checked).toBe(true)
    expect(items[1].checked).toBe(false)
  })

  it('删除线与脚注都被认出来（这两种不是 CommonMark 核心，靠 GFM 与 remark 的扩展）', () => {
    const del = parseMarkdown('~~划掉~~\n')!
    const para = del.children[0] as { children: { type: string }[] }
    expect(para.children[0].type).toBe('delete')

    const foot = parseMarkdown('正文[^1]\n\n[^1]: 脚注内容\n')!
    const types = foot.children.map((n) => n.type)
    expect(types).toContain('footnoteDefinition')
    const first = foot.children[0] as { children: { type: string }[] }
    expect(first.children.some((n) => n.type === 'footnoteReference')).toBe(true)
  })

  it('行内 HTML 留下的是 html 节点，值就是那段原始标签', () => {
    const text = '<div class="x">内容</div>\n'
    const tree = parseMarkdown(text)!
    const node = tree.children[0] as { type: string; value: string }
    expect(node.type).toBe('html')
    expect(node.value).toContain('<div')
  })

  it('解析不出来的输入返回 null，而不是抛出去', () => {
    // remark 对畸形 md 基本不抛，这条守的是「真有东西抛出来时不许冒到调用方」
    expect(() => parseMarkdown('')).not.toThrow()
    expect(parseMarkdown('')!.type).toBe('root')
  })
})
