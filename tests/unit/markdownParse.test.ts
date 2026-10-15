import { describe, it, expect } from 'vitest'
import {
  parseMarkdown,
  isMarkdownPath,
  valueStartOf,
  lineStartsOf
} from '../../src/renderer/src/markdown/parse'

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

/**
 * 取树里第一个带 `value` 的文本节点（深度优先）。逐行表那几条夹具的内容都落在一个
 * 节点里（容器层是 blockquote / list / listItem，都会被走穿），取第一个就够。
 */
function textOf(tree: { children?: unknown[] }): Record<string, unknown> {
  let found: Record<string, unknown> | null = null
  const walk = (nodes: unknown[]): void => {
    for (const node of nodes) {
      if (found) return
      const n = node as { type?: string; value?: unknown; children?: unknown[] }
      if (n.type === 'text' && typeof n.value === 'string') {
        found = n as Record<string, unknown>
        return
      }
      walk(n.children ?? [])
    }
  }
  walk(tree.children ?? [])
  if (!found) throw new Error('夹具里没有 text 节点')
  return found
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

  it('引用块里的围栏块：前缀不算在起点里，首行照样精确', () => {
    const src = '> ```\n> 甲\n> ```\n'
    const quote = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(quote.children[0])).toBe(src.indexOf('甲'))
  })

  it('列表项里的围栏块：同样精确（前缀是列表项的缩进）', () => {
    const src = '- ```\n  甲\n  ```\n'
    const list = parseMarkdown(src)!.children[0] as unknown as {
      children: { children: unknown[] }[]
    }
    expect(valueStartOf(list.children[0].children[0])).toBe(src.indexOf('甲'))
  })

  it('超过四格的缩进块：多出来的空格算内容，不能被当成缩进一起跳掉', () => {
    const src = '     甲\n     乙\n'
    const node = parseMarkdown(src)!.children[0] as unknown as { value: string }
    const origin = valueStartOf(node)!
    const firstLine = node.value.split('\n')[0]
    // 起点算对了的话，从它切出的首行恰好等于 value 的首行，而且正好收在行尾
    expect(src.slice(origin, origin + firstLine.length)).toBe(firstLine)
    expect(src[origin + firstLine.length]).toBe('\n')
    // 被剥掉的只有固定那四格
    expect(src.slice(0, origin)).toBe('    ')
  })

  it('八格缩进同样只剥四格（「跳过所有前导空白」会差 4）', () => {
    const src = '        甲\n'
    const node = parseMarkdown(src)!.children[0] as unknown as { value: string }
    const origin = valueStartOf(node)!
    expect(node.value).toBe('    甲')
    expect(src.slice(0, origin)).toBe('    ')
  })

  it('空代码块：起点兜回内容行首，不是 end —— 设计 3.5 的光标用的是同一个数', () => {
    const src = '```\n```\n'
    const node = parseMarkdown(src)!.children[0] as unknown as {
      value: string
      position: { end: { offset: number } }
    }
    expect(node.value).toBe('')
    const origin = valueStartOf(node)!
    expect(origin).not.toBe(node.position.end.offset)
    expect(origin).toBe(src.lastIndexOf('```'))
  })

  it('行内代码两侧各有一个空格时，起点在空格之后（CommonMark 会剥掉那一对）', () => {
    const src = '前 `` 甲 `` 后\n'
    const para = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(para.children[1])).toBe(src.indexOf('甲'))
  })

  it('反引号当字面量：`` ` `` 的起点是中间那个反引号，不是开头那串', () => {
    const src = '`` ` ``\n'
    const para = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(para.children[0])).toBe(src.indexOf('`', 2))
  })

  /**
   * 【这条用例钉的是**已知偏差**，不是在守正确行为】
   *
   * 带前缀的块，remark 逐行剥前缀；而 `valueStartOf` 只给一个常量原点，所以首行精确、
   * **第二行起仍差一个前缀宽度**。设计 3.6 记着这条、判定为可接受——但「可接受」也得
   * 有机器可读的记录，否则将来谁无意改了 `contentStartOf`，不会有任何东西出声。
   * 这条红了不等于回归：先读 3.6 再决定是改代码还是改这条用例。
   */
  it('已知偏差：带前缀的块，第二行首字符仍差一个前缀宽度（设计 3.6 接受的残留）', () => {
    const src = '> ```\n> 甲\n> 乙\n> ```\n'
    const quote = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    const code = quote.children[0] as unknown as { value: string }
    const origin = valueStartOf(code)!
    // 首行是精确的
    const firstLine = code.value.split('\n')[0]
    expect(src.slice(origin, origin + firstLine.length)).toBe(firstLine)
    // 前缀宽度从源码里量：第二行行首到「乙」之间那一段
    const prefix = src.slice(src.lastIndexOf('\n', src.indexOf('乙')) + 1, src.indexOf('乙'))
    expect(prefix).toBe('> ')
    // 第二行不是：按「起点 + value 内下标」线性推出来的位置，比真值小一个前缀宽度
    expect(src.indexOf('乙') - (origin + code.value.indexOf('乙'))).toBe(prefix.length)
  })

  it('普通文本节点没有这个标注 —— 读出来是 null，调用方退回 position', () => {
    const para = parseMarkdown('甲\n')!.children[0] as unknown as { children: unknown[] }
    expect(valueStartOf(para.children[0])).toBeNull()
  })
})

/**
 * 逐行偏移表（设计 3.6.1）。行起点要用**回验**得到——「每一行的 `value` 都贴在该行源码的
 * 尾部」这条依据**不成立**（remark 还会剥行尾空白，见本块最后那条 `it.each`）。
 */
describe('parseMarkdown —— 逐行偏移表', () => {
  it('多行引用块：第二行的起点是那一行自己的位置，不是第一行加字符数', () => {
    const src = '> 引用甲\n> 引用乙\n'
    const text = (parseMarkdown(src)!.children[0] as never as { children: { children: unknown[] }[] })
      .children[0].children[0]
    expect(lineStartsOf(text)).toEqual([src.indexOf('引用甲'), src.indexOf('引用乙')])
    // `'引用甲\n引用乙'` 里第 4 个字符是第二行的「引」——它的源码位置是 8，不是 2+4=6
    expect(src.indexOf('引用乙')).toBe(8)
  })

  it('普通的单行文本：不挂表（用 `position` 就够，挂了也只是重复信息）', () => {
    const para = parseMarkdown('甲\n')!.children[0] as unknown as { children: unknown[] }
    expect(lineStartsOf(para.children[0])).toBeNull()
  })

  /**
   * 【夹具为什么是**容器里的**围栏块，不是顶格那个】顶格的围栏块逐行是**连续**的
   * （三行前缀一样长），`isContiguous` 判定「按 `valueStartOf` + 字符数就能推」于是
   * **不挂表**——挂了只是重复信息。挂表的是前缀**逐行不同**的那些：容器里的围栏块每行
   * 多一个 `> `。所以这条用容器里的，下面一条钉顶格那个形态。
   */
  it('围栏代码块（在引用块里）：挂表，第一行起点在围栏之后', () => {
    const src = '> ```\n> 甲\n> 乙\n> ```\n'
    const quote = parseMarkdown(src)!.children[0] as unknown as { children: unknown[] }
    expect(lineStartsOf(quote.children[0])).toEqual([src.indexOf('甲'), src.indexOf('乙')])
  })

  it('顶格的围栏代码块：逐行连续，不挂表；首行起点仍然在围栏之后', () => {
    const src = '```\n第一行\n第二行\n```\n'
    const code = parseMarkdown(src)!.children[0]
    expect(lineStartsOf(code)).toBeNull()
    // 不挂表不等于没坐标：首行起点由 `valueStartOf` 给，退回按字符数切是精确的
    expect(src.slice(valueStartOf(code)!, valueStartOf(code)! + '第一行'.length)).toBe('第一行')
  })

  /**
   * 行尾空白被 remark 剥掉时，行起点要用**回验**得到，不能「行尾 − 行长」（设计 3.6.1）。
   *
   * 【真值怎么来的】在源码里找该行文字**最后一个**位置——行尾空白是它后面唯一允许多出来的
   * 东西。这样写是为了让断言**不依赖实现**：哪怕换一种回验算法，真值也是这一串。
   */
  it.each([
    ['顶层段落', '甲 \n乙\n'],
    ['引用块', '> 甲 \n> 乙\n'],
    ['列表项', '- 甲 \n  乙\n'],
    ['行尾是制表符', '> 甲 \t\n> 乙\n']
  ])('%s：行尾空白被剥时表不右移', (_name, src) => {
    const text = textOf(parseMarkdown(src)!)
    const value = text.value as string
    expect(lineStartsOf(text)).toEqual(
      value.split('\n').map((line) => src.lastIndexOf(line, src.length))
    )
  })

  /**
   * 空 `value` 的代码节点**不挂表**（计划 Step 3b）：两条路对空 `value` 要给同一个原点。
   *
   * 【为什么】`contentStartOf` 对 `value === ''` 给的是**围栏之后**那个位置，而「行尾 − 行长」
   * 里的那个「行尾」是**收尾围栏那一行**的换行——于是同一个节点在同一棵树上有**两个原点**
   * （实测 `'```\n```\n'`：`wtValueStart` 是 4 而表是 `[7]`）。空 `value` 没有下标可言，
   * 表让位，`contentStartOf` 那个数成为唯一的原点。
   *
   * 【只断言解析期】`to=8` 那一格上的跳变是「解析期挂上了表」的后果，表不挂它就不存在。
   */
  it.each([
    ['无语言标注', '```\n```\n'],
    ['带语言标注', '```md\n```\n']
  ])('空代码块（%s）：不挂表，起点是围栏之后那个位置', (_name, src) => {
    const code = parseMarkdown(src)!.children[0]
    expect(lineStartsOf(code)).toBeNull()
    expect(valueStartOf(code)).toBe(src.indexOf('\n') + 1)
  })
})
