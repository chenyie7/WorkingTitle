import { describe, it, expect } from 'vitest'
import { parseMarkdown, isMarkdownPath, valueStartOf } from '../../src/renderer/src/markdown/parse'

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

  it('空串解析成空 root（remark 对畸形 md 基本不抛）', () => {
    // 【这条用例原来叫「解析不出来的输入返回 null，而不是抛出去」，名不副实】
    // 空串不是「解析不出来」——remark 把它**正常**解析成一个空的 root，返回的是树不是 null。
    // 也就是说这个文件里 `catch` 那条路一次都没走到，对降级契约是零覆盖。
    // 真正守「真有东西抛出来时不许冒到调用方」的是
    // tests/unit/markdownParseFallback.test.ts（它把 unified 换成必抛的替身）。
    // 这里保留两条断言，但只当「空串这个边角输入」的回归用。
    expect(() => parseMarkdown('')).not.toThrow()
    expect(parseMarkdown('')!.type).toBe('root')
  })

  it('按扩展名判定：.md / .markdown 才算，大小写不敏感', () => {
    expect(isMarkdownPath('/Users/某人/周报.md')).toBe(true)
    expect(isMarkdownPath('/Users/某人/周报.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('/Users/某人/周报.txt')).toBe(false)
    // 【这一条是刻意的】内容长得像 md 的 txt 不渲染：导入 txt 的人要的就是原文
    expect(isMarkdownPath('/Users/某人/周报.md.txt')).toBe(false)
    expect(isMarkdownPath('/Users/某人/周报')).toBe(false)
  })
})

/**
 * 代码类节点的 `value` 与源码偏移**不是同一个坐标系**（设计 3.6）。
 *
 * mdast 的 `position` 从**定界符**起算，而 `value` 里不含定界符：
 *
 *     源码 '```\n第一行\n'   position.start.offset = 0   ← 第一个反引号
 *                           value = '第一行'             ← 没有围栏
 *
 * 记下 `value` 的真实起点，`clip.ts` 才不会把内容提前一个定界符的长度切出来。
 */
describe('parseMarkdown —— 代码节点 value 的真实起点（设计 3.6）', () => {
  it('围栏代码块：起点在首行换行之后', () => {
    const src = '```\n第一行\n'
    expect(valueStartOf(parseMarkdown(src)!.children[0])).toBe(src.indexOf('第一行'))
  })

  it('带语言标注的围栏块：标注算在围栏里', () => {
    const src = '```js\n第一行\n```\n'
    expect(valueStartOf(parseMarkdown(src)!.children[0])).toBe(src.indexOf('第一行'))
  })

  it('行内代码：起点在起首反引号之后', () => {
    const src = '前 `甲` 后\n'
    const para = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(para.children[1])).toBe(src.indexOf('甲'))
  })

  it('双反引号的行内代码同样对', () => {
    const src = '前 ``甲`` 后\n'
    const para = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(para.children[1])).toBe(src.indexOf('甲'))
  })

  it('四空格缩进的代码块：起点在首行缩进之后', () => {
    const src = '    甲\n    乙\n'
    expect(valueStartOf(parseMarkdown(src)!.children[0])).toBe(src.indexOf('甲'))
  })

  it('普通文本节点没有这个标注 —— 读出来是 null，调用方退回 position', () => {
    const para = parseMarkdown('甲\n')!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(para.children[0])).toBeNull()
  })
})
