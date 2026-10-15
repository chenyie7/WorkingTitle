import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { Root } from 'mdast'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'
import { clipTree, WT_BLANK_LINES, WT_BLANK_ROWS } from '../../src/renderer/src/markdown/clip'
import { renderMarkdown } from '../../src/renderer/src/markdown/toReact'

/** 把 md 渲染进一个容器，返回容器本身——断言一律用 querySelector / textContent。 */
function dom(md: string): HTMLElement {
  const tree = parseMarkdown(md)
  expect(tree).not.toBeNull()
  return render(<div>{renderMarkdown(tree!)}</div>).container
}

/** 与 `dom()` 相同，但先按 `cursor` 裁一次——钉「揭示到一半」时的形态。 */
function domAt(md: string, cursor: number): HTMLElement {
  const tree = parseMarkdown(md)
  expect(tree).not.toBeNull()
  return render(<div>{renderMarkdown(clipTree(tree!, 0, cursor))}</div>).container
}

describe('renderMarkdown —— 块级', () => {
  it('标题：深度映射到 h1–h6，并带一个可用于样式的类名', () => {
    const c = dom('## 二、进展\n')
    const h = c.querySelector('h2')
    expect(h).not.toBeNull()
    expect(h!.className).toContain('wt-md-h2')
    expect(h!.textContent).toBe('二、进展')
  })

  it('代码块是 pre + code，文本原样（不做语法高亮）', () => {
    const c = dom('```\nconst a = 1\n```\n')
    expect(c.querySelector('pre')).not.toBeNull()
    expect(c.querySelector('pre code')!.textContent).toBe('const a = 1')
  })

  it('无序列表与有序列表', () => {
    expect(dom('- a\n- b\n').querySelector('ul')).not.toBeNull()
    const ol = dom('3. a\n4. b\n').querySelector('ol')
    expect(ol).not.toBeNull()
    expect(ol!.getAttribute('start')).toBe('3')
  })

  it('任务列表：方框 + 文字，**没有 input 元素**', () => {
    const c = dom('- [x] 完成\n- [ ] 没做\n')
    expect(c.textContent).toContain('完成')
    // 不可点：文档运行期只读。出现 input 就等于给了「能改文档」的样子
    expect(c.querySelector('input')).toBeNull()
    expect(c.querySelectorAll('.wt-md-check')).toHaveLength(2)
  })

  it('引用块与分隔线', () => {
    expect(dom('> 引用\n').querySelector('blockquote')).not.toBeNull()
    expect(dom('---\n').querySelector('hr')).not.toBeNull()
  })

  it('表格：表头进 thead/th，其余进 tbody/td', () => {
    const c = dom('| 项目 | 负责人 |\n| --- | --- |\n| 归档 | 张三 |\n')
    expect(c.querySelectorAll('thead th')).toHaveLength(2)
    expect(c.querySelectorAll('tbody td')).toHaveLength(2)
    expect(c.querySelector('tbody td')!.textContent).toBe('归档')
  })

  it('脚注引用是上标，定义是一段带标号的文字', () => {
    const c = dom('正文[^1]\n\n[^1]: 脚注内容\n')
    expect(c.querySelector('sup.wt-md-fn')!.textContent).toBe('1')
    expect(c.querySelector('.wt-md-fndef')!.textContent).toContain('脚注内容')
  })
})

describe('renderMarkdown —— 行内', () => {
  it('粗体、斜体、删除线、行内代码', () => {
    const c = dom('**粗** *斜* ~~删~~ `码`\n')
    expect(c.querySelector('strong')!.textContent).toBe('粗')
    expect(c.querySelector('em')!.textContent).toBe('斜')
    expect(c.querySelector('del')!.textContent).toBe('删')
    expect(c.querySelector('code')!.textContent).toBe('码')
  })

  it('链接画成 span 而不是 a —— 点了不做事', () => {
    const c = dom('[内网](http://x)\n')
    expect(c.textContent).toContain('内网')
    expect(c.querySelector('a')).toBeNull()
    expect(c.querySelector('.wt-md-link')!.getAttribute('title')).toBe('http://x')
  })

  it('图片这一版是占位：框 + 替代文字 + data-src', () => {
    const c = dom('![架构图](img/a.png)\n')
    const box = c.querySelector('[data-testid="md-image"]')!
    expect(box.textContent).toBe('架构图')
    expect(box.getAttribute('data-src')).toBe('img/a.png')
    expect(c.querySelector('img')).toBeNull()
  })
})

describe('renderMarkdown —— 内嵌 HTML（安全断言）', () => {
  it('白名单标签变成真元素', () => {
    expect(dom('<div>内容</div>\n').querySelector('div')!.textContent).toBe('内容')
  })

  it('script / iframe 一个元素都建不出来', () => {
    const c = dom('<script>alert(1)</script>\n<iframe src="http://x"></iframe>\n')
    expect(c.querySelector('script')).toBeNull()
    expect(c.querySelector('iframe')).toBeNull()
    // 文字留下（设计第 11 节的口径），但它永远不会被执行
    expect(c.textContent).toContain('alert(1)')
  })

  it('事件属性不会被搬到元素上', () => {
    const c = dom('<div onclick="alert(1)" class="x" style="color:red">t</div>\n')
    // `firstElementChild` 那一跳不能省：`c` 是 RTL 自己造的那个包裹 div，而
    // `c.querySelector('div')` 命中的是**它**（`dom()` 里那一层），markdown 渲出来的
    // 那个 div 在它里面。少了这一跳，下面三条断言查的是一个测试助手造的、永远没有
    // 属性的元素——它们恒真（实测：给 `renderTokens` 建的每个元素都加上 class，全绿）。
    const div = c.firstElementChild!.querySelector('div')!
    expect(div.textContent).toBe('t')
    expect(div.hasAttribute('onclick')).toBe(false)
    expect(div.hasAttribute('class')).toBe(false)
    expect(div.hasAttribute('style')).toBe(false)
  })

  it('不配对的开标签不会把后面的内容吞掉', () => {
    // 没有闭合标签时，收尾那一步会把它合上——后面兄弟节点仍然渲染得出来
    const c = dom('<div>开\n\n后面一段\n')
    expect(c.textContent).toContain('后面一段')
    // 「合上」这件事本身也要单独钉：上面那条断言是**兄弟段落**给的，与收尾那一步
    // 无关（实测：整段删掉收尾那一步，只断言上一句时全绿）。真删掉的话，这个 div
    // 连元素都建不出来，「开」这个**已揭示的字**就上不了屏了——那才是要防的那条。
    expect(c.firstElementChild!.querySelector('div')!.textContent).toBe('开')
  })

  it('HTML 注释一个字都不上屏', () => {
    // 整段是一个 html 节点，注释不是标签——不处置的话它会原样成为屏幕上的字面文字
    const c = dom('前文\n\n<!-- 这是注释 -->\n\n后文\n')
    expect(c.textContent).toContain('前文')
    expect(c.textContent).toContain('后文')
    expect(c.textContent).not.toContain('这是注释')
  })

  it('没关的注释会一直吃到文末（HTML 规范如此，浏览器对同样的字节也是这个行为）', () => {
    // remark 把「`<!--` 到文末」整段做成**一个** html 节点，所以那个注释之后的内容
    // 也跟着不显示。这条把那个后果明写出来——它是刻意的（注释没关就没法知道
    // 作者想表达什么），不是漏掉了「后文」两个字
    const c = dom('前文\n\n<!-- 没关的注释\n\n后文\n')
    expect(c.textContent).toBe('前文')
  })
})

/**
 * 【行内 HTML 为什么要单独一组】行内标签在 mdast 里是**一个标签一个节点**——
 * `前文 <b>加粗</b> 后文` 是 text / html / text / html 四个兄弟节点。上一组用的
 * `<div>内容</div>` 是**块级** HTML（整段一个节点），凭空就对；这一组钉的是行内那一半。
 */
describe('renderMarkdown —— 行内 HTML（合并兄弟节点）', () => {
  it('行内标签包住文字，不是一个空元素', () => {
    const c = dom('前文 <b>加粗</b> 后文\n')
    expect(c.querySelector('b')).not.toBeNull()
    expect(c.querySelector('b')!.textContent).toBe('加粗')
    expect(c.textContent).toBe('前文 加粗 后文')
  })

  it('mark / u 这些行内标签同样包住文字', () => {
    const c = dom('x <mark>高亮</mark> y <u>下划线</u> z\n')
    expect(c.querySelector('mark')!.textContent).toBe('高亮')
    expect(c.querySelector('u')!.textContent).toBe('下划线')
    expect(c.textContent).toBe('x 高亮 y 下划线 z')
  })

  it('嵌套的行内标签各归各的层', () => {
    const c = dom('x <span>a<b>b</b></span> y\n')
    expect(c.querySelector('span')!.textContent).toBe('ab')
    expect(c.querySelector('b')!.textContent).toBe('b')
    expect(c.textContent).toBe('x ab y')
  })

  it('白名单之外的行内标签：标签丢掉、文字留在原处', () => {
    const c = dom('前文 <blink>闪</blink> 后文\n')
    expect(c.querySelector('blink')).toBeNull()
    expect(c.textContent).toBe('前文 闪 后文')
  })

  it('收尾标签还没被揭示时，标签仍然包住已揭示的那几个字', () => {
    // clip 会把「没抽完」的 html 节点丢掉，于是流里只剩 `<b>加粗`
    // ——收尾那一步补上闭标签，这两个字照样是粗的
    const c = domAt('前文 <b>加粗</b> 后文\n', 8)
    expect(c.querySelector('b')!.textContent).toBe('加粗')
    expect(c.textContent).toBe('前文 加粗')
  })
})

/**
 * 未揭示部分的占位（设计 3.2 修订）。
 *
 * 【为什么这一层要测】`clip.ts` 只报「还有几行没到」，**留多少高度是这里的事**。
 * 判据是设计 3.2 那张表的表格行与代码块两行：占位只占高度，什么都不画。
 *
 * 【为什么要手工造树】占位字段是 `clipTree` 在裁剪时挂上去的，直接 `parseMarkdown`
 * 出来的树里没有。这里手工造最小树，把「有占位 / 没占位」两种输入都喂进去——
 * 比串起 clipTree 更小、也更能指名道姓。
 */
describe('renderMarkdown —— 未揭示部分的占位', () => {
  function withBlank(node: Record<string, unknown>, field: string, n: number): Root {
    return {
      type: 'root',
      children: [{ position: { start: { offset: 0 }, end: { offset: 10 } }, ...node, [field]: n }]
    } as unknown as Root
  }

  it('表格有剩余行时：表格之后多出一块空白，且不带任何网格线', () => {
    const doc = withBlank(
      {
        type: 'table',
        children: [
          {
            type: 'tableRow',
            children: [{ type: 'tableCell', children: [{ type: 'text', value: '甲' }] }]
          }
        ]
      },
      WT_BLANK_ROWS,
      2
    )
    const c = render(<>{renderMarkdown(doc)}</>).container
    const blank = c.querySelector('.wt-md-table-blank')
    expect(blank).not.toBeNull()
    // 空白里什么都没有 —— 不画空网格线、不画占位文字
    expect(blank!.textContent).toBe('')
    expect(blank!.querySelector('table')).toBeNull()
    // 行数进了 CSS 变量；换算成像素是 CSS 的事
    expect(blank!.getAttribute('style')).toContain('--wt-md-blank-rows: 2')
  })

  it('表格一行不缺时：一个占位元素都不多出', () => {
    const doc = withBlank(
      {
        type: 'table',
        children: [
          {
            type: 'tableRow',
            children: [{ type: 'tableCell', children: [{ type: 'text', value: '甲' }] }]
          }
        ]
      },
      WT_BLANK_ROWS,
      0
    )
    const c = render(<>{renderMarkdown(doc)}</>).container
    expect(c.querySelector('.wt-md-table-blank')).toBeNull()
  })

  it('代码块有未揭示的行时：代码框之后多出一块空白', () => {
    const doc = withBlank({ type: 'code', value: '第一行' }, WT_BLANK_LINES, 2)
    const c = render(<>{renderMarkdown(doc)}</>).container
    const blank = c.querySelector('.wt-md-pre-blank')
    expect(blank).not.toBeNull()
    expect(blank!.textContent).toBe('')
    expect(blank!.getAttribute('style')).toContain('--wt-md-blank-lines: 2')
    // 框里只有已揭示的那一行
    expect(c.querySelector('.wt-md-pre')!.textContent).toBe('第一行')
  })
})

/**
 * 阅读光标插在树里（设计 3.5）。
 *
 * 【为什么要测这一层】光标原来是 `Page` 追加在内容末尾的，而 md 那条路的内容是块级
 * 元素的树——末尾那个 span 只会落在最后一个块**下方**。而隐形输入框与输入法候选框
 * 都按这个坐标摆，所以这不是观感问题。
 */
describe('renderMarkdown —— 阅读光标', () => {
  /** 造一棵「一个段落、里面一串文字」的最小树，文字起点给在 0。 */
  function para(text: string): Root {
    return {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          position: { start: { offset: 0 }, end: { offset: text.length } },
          children: [
            {
              type: 'text',
              value: text,
              position: { start: { offset: 0 }, end: { offset: text.length } }
            }
          ]
        }
      ]
    } as unknown as Root
  }

  it('光标插在文字中间，而不是段落下方的末尾', () => {
    const c = render(<>{renderMarkdown(para('甲乙丙'), { caretAt: 2 })}</>).container
    const p = c.querySelector('p')!
    expect(p.textContent).toBe('甲乙丙')
    // 段落的子节点顺序必须是 [文字, 光标, 文字] —— 光标在段落**里面**
    const caret = p.querySelector('[data-testid="caret"]')
    expect(caret).not.toBeNull()
    // `caretAt: 2` ⇒ `at = clamp(2 − 0, 0, 3) = 2` ⇒ 切成 ['甲乙', '丙']
    expect(caret!.previousSibling!.textContent).toBe('甲乙')
    expect(caret!.nextSibling!.textContent).toBe('丙')
  })

  it('光标落在空节点上也算命中（列表项刚开头、文字还没出来那一格）', () => {
    const doc = {
      type: 'root',
      children: [
        {
          type: 'list',
          children: [
            {
              type: 'listItem',
              position: { start: { offset: 0 }, end: { offset: 4 } },
              children: [
                {
                  type: 'paragraph',
                  position: { start: { offset: 2 }, end: { offset: 4 } },
                  children: [{ type: 'text', value: '', position: { start: { offset: 2 }, end: { offset: 4 } } }]
                }
              ]
            }
          ]
        }
      ]
    } as unknown as Root
    const c = render(<>{renderMarkdown(doc, { caretAt: 2 })}</>).container
    const li = c.querySelector('li')!
    expect(li.querySelector('[data-testid="caret"]')).not.toBeNull()
  })

  /**
   * 【这条原来是反的，2026-10-15 按实测改（Task 4g）】原先它钉的是「偏移超出全部文字 →
   * 退回追加在末尾」，并在注释里写着「内容本来也到头了，位置看不出差别」。**那句话不成立**：
   * 追加在末尾落在最后一个块**下方一行、左边缘**，而隐形输入框与输入法候选框都按这个坐标
   * 摆（设计 3.5）——用户最初报的就是这条。现在夹到**最后一块已渲染内容**的末尾上，
   * 光标留在块里。判据由「`<p>` 里有没有光标」翻成「光标在不在 `甲乙丙` 之后、`<p>` 之内」。
   */
  it('给的光标偏移超出全部文字时：夹到内容的末尾，仍在块里面', () => {
    const c = render(<>{renderMarkdown(para('甲乙丙'), { caretAt: 99 })}</>).container
    expect(c.querySelectorAll('[data-testid="caret"]')).toHaveLength(1)
    const caret = c.querySelector('p')!.querySelector('[data-testid="caret"]')
    expect(caret).not.toBeNull()
    expect(caret!.previousSibling!.textContent).toBe('甲乙丙')
    expect(caret!.nextSibling).toBeNull()
    // 不是容器末尾那一下（那是缺陷的签名）
    expect(c.previousSibling).toBeNull()
    expect(c.lastElementChild!.tagName).toBe('P')
  })

  it('链尾放不下光标时（文档以分隔线收尾）才真的追加在末尾', () => {
    const doc = {
      type: 'root',
      children: [{ type: 'thematicBreak', position: { start: { offset: 0 }, end: { offset: 4 } } }]
    } as unknown as Root
    // 【揭示偏移要**越过**分隔线的区间】落在它区间里那几格由 `caretBefore` 的
    // 「提前渲染的叶子跨过了揭示偏移」接走（落在分隔线**之前**），走不到这一条
    const c = render(<>{renderMarkdown(doc, { caretAt: 5 })}</>).container
    expect(c.querySelectorAll('[data-testid="caret"]')).toHaveLength(1)
    // 分隔线后面什么都没有，「追加在末尾」与「放在它后面」是同一个位置
    expect(c.lastElementChild!.getAttribute('data-testid')).toBe('caret')
  })

  it('不传光标（量高度那份副本）：一个光标都不该有', () => {
    const c = render(<>{renderMarkdown(para('甲乙丙'))}</>).container
    expect(c.querySelector('[data-testid="caret"]')).toBeNull()
  })

  it('光标插进代码框里，而不是掉到框下面', () => {
    const doc = {
      type: 'root',
      children: [
        {
          type: 'code',
          value: '第一行',
          position: { start: { offset: 0 }, end: { offset: 10 } },
          wtValueStart: 4
        }
      ]
    } as unknown as Root
    const c = render(<>{renderMarkdown(doc, { caretAt: 6 })}</>).container
    const pre = c.querySelector('pre')!
    expect(pre.textContent).toBe('第一行')
    const caret = pre.querySelector('[data-testid="caret"]')
    expect(caret).not.toBeNull()
    // `caretAt: 6`、`wtValueStart: 4` ⇒ `at = clamp(6 − 4, 0, 3) = 2` ⇒ 切成 ['第一', '行']
    // 【这两个字面量差一个字符就整条失效】原计划写的是 `'第'` / `'一行'`，
    // 那与实现自相矛盾——实施者量出来了。这条用例的真正作用是**守住 `origin`**。
    expect(caret!.previousSibling!.textContent).toBe('第一')
    expect(caret!.nextSibling!.textContent).toBe('行')
  })
})

/**
 * 光标的落点必须与「揭示到哪」重合 —— 这三条是量出来的真缺陷，不是假想的。
 *
 * 旧判据（「第一个**结束偏移 ≥ 揭示偏移**的**带文本**节点」）会被「命中节点之后的空文本
 * 节点」接走，而它前面/中间站着**提前渲染的非文本节点**：占位、硬换行、图片。于是光标
 * 落到占位之后、下一行、或图的右边——而**隐形输入框与输入法候选框都按这个坐标摆**。
 *
 * 【为什么必须走真管线】缺陷正出在 `clip` 与 `toReact` 的**接缝**上：手工造树造不出
 * `clip` 写的 `wtValueStart` 与占位计数的真实取值。这是本文件第一次跑完整链路。
 *
 * 【实现者注意】下面每个 `to` 都要**先确认它在旧代码上真的红**（Step 2 那一步），
 * 落点不对就自己找一个能复现的偏移并**在报告里写清实测数**——别为了让用例变绿去改断言。
 */
describe('renderMarkdown —— 光标的落点（真管线）', () => {
  function at(md: string, to: number): HTMLElement {
    const clipped = clipTree(parseMarkdown(md)!, 0, to)
    return render(<>{renderMarkdown(clipped, { caretAt: to })}</>).container
  }

  const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\n末段\n'

  it('表格：光标落在占位**之前**，不是之后', () => {
    // 【这个 `to` 是量出来的，不是推的】实施者逐偏移扫过：坏区是 **8–20 与 28–30**
    // （整段表格行全被丢掉、只剩表头，于是没有任何节点接得住光标）。表头那一行的换行
    // 正好在 9，落在坏区里。原先计划用的 `indexOf('| 1 |') + 5 = 25` 落在**好区**
    // （21–27 都好），所以那条用例红不了。
    const to = TABLE.indexOf('\n')
    const c = at(TABLE, to)
    const caret = c.querySelector('[data-testid="caret"]')
    const blank = c.querySelector('.wt-md-table-blank')
    expect(caret).not.toBeNull()
    expect(blank).not.toBeNull()
    // 光标在占位**前面**：从光标看，占位是 FOLLOWING
    expect(caret!.compareDocumentPosition(blank!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 【恰好一个】占位自己接光标与末尾兜底都写了 `placed` 的判据，而两处判的时机不同
    // （建元素 vs 渲染树）。实测这一格曾经同时冒出两个，见 `case 'code'` 那段注释。
    expect(c.querySelectorAll('[data-testid="caret"]')).toHaveLength(1)
  })

  it('硬换行：光标落在 `<br>` **之前**（还在第一行），不是之后', () => {
    const src = '甲  \n乙\n'
    const c = at(src, src.indexOf('乙') - 1) // 揭示偏移正好落在行尾那个换行上
    const caret = c.querySelector('[data-testid="caret"]')
    const br = c.querySelector('br')
    expect(caret).not.toBeNull()
    expect(br).not.toBeNull()
    expect(caret!.compareDocumentPosition(br!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('图片：光标落在图**之前**，不是图的右边', () => {
    const src = '甲 ![图](a.png) 乙\n'
    const c = at(src, src.indexOf('![') + 1)
    const caret = c.querySelector('[data-testid="caret"]')
    const img = c.querySelector('.wt-md-img')
    expect(caret).not.toBeNull()
    expect(img).not.toBeNull()
    expect(caret!.compareDocumentPosition(img!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('代码块：光标落在占位**之前**，不是之后', () => {
    // 坏区是 **1–3**（光标还在围栏里那几格）：整块只剩一个空框，没有任何文字节点接得住。
    const src = '```\n甲\n乙\n丙\n```\n'
    const c = at(src, 1)
    const caret = c.querySelector('[data-testid="caret"]')
    const blank = c.querySelector('.wt-md-pre-blank')
    expect(caret).not.toBeNull()
    expect(blank).not.toBeNull()
    expect(caret!.compareDocumentPosition(blank!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 【恰好一个】同表格那条
    expect(c.querySelectorAll('[data-testid="caret"]')).toHaveLength(1)
  })

  /**
   * 光标不能是 `<tr>` 的**直接子元素**——那不是合法的表格内容，CSS 会给它套一个匿名
   * 表格盒，**表格于是多出一列**（复审实测：宽 115→172、第二列 x 57→114）。
   *
   * 【这个 `to` 是量出来的，不是推的】实施者逐偏移扫过 `TABLE`：非法父元素出现在
   * `to = 4 / 24 / 34`，正好是**每个非首单元格的起点**（表头第二个格子 `[4..9]`、
   * 正文两行的第二个格子 `[24..29]` 与 `[34..39]`）。那些位置上，区间判据让
   * `caretBefore(cell)` 先于格子里的文本节点开火，把光标挪到了格外。
   */
  it('光标落在单元格里，不是 `<tr>` 的直接子元素', () => {
    const c = at(TABLE, 4)
    const caret = c.querySelector('[data-testid="caret"]')
    expect(caret).not.toBeNull()
    expect(caret!.closest('th, td')).not.toBeNull()
  })

  it('量高度那一份**永远**不带光标（`caret: null` 那条闸）', () => {
    const doc = parseMarkdown('甲乙丙\n')!
    const c = render(<>{renderMarkdown(doc, { withBlockEnds: true, caretAt: 2 })}</>).container
    expect(c.querySelectorAll('[data-testid="caret"]')).toHaveLength(0)
  })

  /**
   * 行内 HTML 的**接受的近似**：连续的 text / html 合成一段 token 流之后，光标放在
   * **这一串的末尾**（设计 3.5 末段、`renderAll` 的 `caretHere`）。
   *
   * 【为什么非要钉它】这个近似原先一条用例都没有——把它从「串尾」挪到「串首」是**零红**
   * 的。而两处不是一回事：串首时，`前 <b>甲</b>后` 在「后」还没揭示的那一刻，光标会跑到
   * 「前」**前面**去，而隐形输入框与候选框都按这个坐标摆。
   */
  it('行内 HTML：光标落在这一串的**末尾**（紧贴 `</b>`），不是跑到串首', () => {
    const c = at('前 <b>甲</b>后\n', 6)
    const p = c.querySelector('p')!
    expect(p.textContent).toBe('前 甲') // 「后」还没揭示出来
    const caret = p.querySelector('[data-testid="caret"]')!
    expect(caret).not.toBeNull()
    // 串的末尾：光标的前一个兄弟就是那个 `<b>`，不是「前 」那个文本节点
    expect(caret.previousSibling).toBe(c.querySelector('b'))
    expect(p.firstChild!.textContent).toBe('前 ')
  })

  /**
   * 容器里**逐行剥前缀**的文字，下标要按行换算（设计 3.6.1）。
   *
   * 【为什么用整棵树、不裁】裁到 `to = 9` 时 `clip` 自己就把 `value` 切到了那一格，光标
   * 靠 `Math.min` 夹到末尾也会落到对的地方——两条路都对，就分不出守的是哪一条。整棵树
   * 才能把 `toReact` 这一段的换算单独逼出来：`value` 是完整的 `'引用甲\n引用乙'`，而下标
   * 必须落在**第二行**里，不能拿 `揭示偏移 − 起点 = 7` 一路减到底。
   */
  it('引用块里的多行文字：下标记在**那一行**上，不做全局减法', () => {
    const c = render(
      <>{renderMarkdown(parseMarkdown('> 引用甲\n> 引用乙\n')!, { caretAt: 9 })}</>
    ).container
    const caret = c.querySelector('[data-testid="caret"]')!
    expect(caret).not.toBeNull()
    expect(caret.closest('blockquote')).not.toBeNull()
    // 源码偏移 9 落在第二行的第二个字上（第二行从 8 起）⇒ 切在 value 下标 5
    expect(caret.previousSibling!.textContent).toBe('引用甲\n引')
    expect(caret.nextSibling!.textContent).toBe('用乙')
  })

  /**
   * 容器里**逐行剥前缀**的多行文字 + 行内 HTML：光标仍落在**这一串的末尾**。
   *
   * 【为什么单独钉一条】`renderAll` 那个「这一串接得住光标吗」的判据，与
   * `splitAtCaret` / `holdsCaret` 是**同一个问题**。算术版「起点 + 长度 ≥ 揭示偏移」在有
   * 逐行表的节点上会**偏小**（那个长度不再等于「揭示偏移 − 起点」），于是光标被判定不在
   * 这一串里、一路掉到整篇末尾——掉出 `<blockquote>` 外面去了。
   *
   * 【夹具为什么长这样】条件有三个，缺一个就测不到那条判据：
   * 1. 那一串里**得有活着的 html 节点**（`clip` 对 html 是「等它整个抽完才留」，
   *    `end > to` 的直接丢掉）——所以 `</b>`（end = 10）必须已经在揭示范围里，
   *    `<b>x</b>` 得排在多行文字**前面**；
   * 2. 多行文字要**挂得上逐行表**（前缀逐行不同）；
   * 3. 揭示偏移要落在算术版够不着、真区间够得着的那一段：`to = 16` 时那个文本节点的
   *    `value` 是 `'甲一\n乙'`（起点 10、长度 4 ⇒ 算术版说「到 14 为止」），而它第二行
   *    的内容一直伸到源码 16。**`to = 14` 及以下两条判据一致，测不出差别**。
   */
  it('引用块里多行文字 + 行内 HTML：光标没掉出容器', () => {
    const SRC = '> <b>x</b>甲一\n> 乙二\n'
    const c = at(SRC, SRC.indexOf('二'))
    const caret = c.querySelector('[data-testid="caret"]')!
    expect(caret).not.toBeNull()
    expect(caret.closest('blockquote')).not.toBeNull()
    // 落在这一串的末尾（`</b>` 之后、'甲一\n乙' 之后），不是掉到整篇末尾
    expect(caret.closest('p')!.textContent).toBe('x甲一\n乙')
  })

  /**
   * 揭示偏移落在**下一行还没开始、而它的行前缀已经揭示**的那几个偏移位上（设计 3.5 第三轮）。
   *
   * 【为什么这几格会掉出去】`clip` 的逐行表只收「起点 < 揭示偏移」的行，而前缀（`> `、续行
   * 缩进）的偏移比它所属那一行的**内容起点**还靠前——于是那几个偏移位不属于表里任何一行。
   * 接受窗口的上界若取「末行内容结束」，它们就一个节点都接不住，光标掉到篇末。
   * （把上界写成「末行内容结束 + 1」也不够：中间还隔着 `> ` 那两个字符。）
   *
   * 【为什么这几格非修不可】隐形输入框与输入法候选框都按这个坐标摆：光标从引用块里跳出去，
   * 候选框跟着跳。它与用户报的「光标不在代码块里面」是同一个缺陷类，只是粒度更细。
   */
  it('引用块：揭示偏移落在第二行的 `> ` 上，光标不出块', () => {
    const SRC = '> 引用甲\n> 引用乙\n'
    for (const to of [6, 7, 8]) {
      const c = at(SRC, to)
      const carets = c.querySelectorAll('[data-testid="caret"]')
      // 【「恰好一个」不是顺手写的】置位闸（`caret.placed`）与 `caretBefore` 的让路判据
      // 共用 `caretIndexIn`；上界一放宽，两条路若不同步就会**各插一个**，而多出来的那个
      // 谁都不报错。本批次已经栽过一次（组件惰性求值 → 81 个偏移位上双光标）。
      expect(carets, `to=${to} 光标数不对`).toHaveLength(1)
      const caret = carets[0] as HTMLElement
      expect(caret.closest('blockquote'), `to=${to} 掉出引用块`).not.toBeNull()
      expect(caret.closest('p'), `to=${to} 掉出段落`).not.toBeNull()
      // 已揭示文字的**末尾**（`'引用甲\n'` 之后）——与「没有逐行表」那条路给同一个数
      expect(caret.previousSibling?.textContent, `to=${to} 落点不是已揭示文字的末尾`).toBe('引用甲\n')
    }
  })

  it('多行列表项：同样的偏移位同样不出列表项', () => {
    const SRC = '- 甲甲甲\n  乙乙乙\n'
    for (const to of [6, 7, 8]) {
      const c = at(SRC, to)
      const carets = c.querySelectorAll('[data-testid="caret"]')
      expect(carets, `to=${to} 光标数不对`).toHaveLength(1)
      expect(carets[0].closest('li'), `to=${to} 掉出列表项`).not.toBeNull()
    }
  })

  it('引用块 + 行内 HTML：前缀上的偏移同样不出容器', () => {
    const SRC = '> <b>x</b>甲一\n> 乙二\n'
    for (const to of [7, 8, 9, 13, 14, 15]) {
      const c = at(SRC, to)
      const carets = c.querySelectorAll('[data-testid="caret"]')
      expect(carets, `to=${to} 光标数不对`).toHaveLength(1)
      expect(carets[0].closest('blockquote'), `to=${to} 掉出引用块`).not.toBeNull()
    }
  })

  /**
   * **保守表的**那几行（回验对不上的行，第四轮）照样要接得住光标——逐偏移扫**全部**偏移位。
   *
   * 【为什么单开一条】上面那三条钉的是**精确表**（`> 引用甲\n> 引用乙\n` 这类行起点回验命中）
   * 与**没有表**这两种形态。第四轮之后多出第三种：那几行的起点是按 `行尾 − 行长` 退的**保守值**，
   * 比真实内容起点**晚**（`&amp;` 晚 4、`\*` 晚 1）。而接受窗口的两端都拿这张表在算
   * （下界 `rows[0].src`、上界 `position.end`），所以保守表与窗口的交互是**新的一格**，
   * 上面那几条一条都碰不到。
   *
   * 【它有没有牙：有，但在**上界**那一侧】实测（把 `upper` 从 `max(position.end, contentEnd)`
   * 改回 `contentEnd`）：这条红，`实体` 夹具在 to=13、14 上掉出引用块。**下界那一侧它拦不住**
   * ——把下界整个去掉（`at > upper` 才拒绝）时这条**照样绿**：夹具上没有一格能触发下界
   * （表存在时 `rows[0].src < to` 恒成立，表被摘掉时 `rows[0].src` 就是 `originOf(node)`）。
   * 所以别把它当成「下界有覆盖」的证据。
   */
  it.each([
    ['实体', '> 甲 &amp; 乙\n> 丙\n'],
    ['反斜杠转义', '> 甲 \\* 乙\n> 丙\n']
  ])('回验失败的那几行（%s）：逐偏移扫，光标不出容器', (_name, SRC) => {
    for (let to = 1; to < SRC.length; to++) {
      const c = at(SRC, to)
      const carets = c.querySelectorAll('[data-testid="caret"]')
      expect(carets, `to=${to} 光标数不对`).toHaveLength(1)
      expect(carets[0].closest('blockquote'), `to=${to} 掉出引用块`).not.toBeNull()
    }
  })
})

/**
 * 光标**不许掉到块下方**（设计 3.5；Task 5 的评审逐格扫出来的四种形态）。
 *
 * 【判据一：末尾兜底的签名】它把光标 `push` 进顶层数组，于是光标成为容器的**最后一个**
 * 子元素，落点是「最后一个已渲染块下面一行、左边缘」——正是用户最初报的那条。
 *
 * 【判据二：顶层还允许一种落点，它必须紧挨占位】占位代表「还没到的东西」，设计 3.5 让光标
 * 落在它**前面**（`BlankSpace` 那一格，是 Step 5 点名要回归的老账，实测连续 13 个偏移位）。
 * 那个谱上的光标**也是**容器的直接子元素——所以「父元素是不是容器」这条判据会把它一起
 * 判红，不能用（实测：表格夹具的 8–20 全是这种合法落点）。真正的区别是它后面**跟着**占位元素。
 *
 * 【为什么不写成「父元素的 class 里有没有 `wt-page__text`」】那是计划 Step 1 稿子里的写法，
 * 在本文件的 `at()` 下**恒为绿**（这里的容器是 testing-library 造的那个无类名 div，
 * 实测缺陷代码上 0 格变红——判据空转，测不出任何东西）。真实的 `.wt-page__text` 那一层
 * 由 `markdownView.test.tsx` 逐偏移扫。
 *
 * 【为什么不能用 `closest('p')`】`<h1>` / `<li>` / `<td>` / `<pre>` 里的正确落点会被它误伤。
 *
 * 【`to = 0` 是唯一的例外】那时每个顶层块都满足「起始偏移 ≥ to」被 `clip` 丢掉，树是空的，
 * 末尾兜底是**唯一**能放的位置（下面单列一条钉住它）。
 *
 * 【夹具为什么是这六份】前四份是计划 Step 1 给的，第六份是评审那张表里「表格尾部 32–35」
 * 对应的夹具（那份表的数字只有它对得上）；第五份（**单行**的那种容器里的围栏）是补的：
 * 计划那张表把「容器里的代码 3–7」列为坏格，而**多行**围栏（计划 Step 1 用的那份）实测
 * 一格都不坏——`wtBlankLines > 0`，占位自己接住了光标（那是 Step 5 要回归的口径）。
 * 坏格的机制是「`code` 的 `value` 为空、内容起点在揭示偏移之后、**围栏里没有第二行可留白**」，
 * 所以复现它要用单行的那种。
 */
describe('光标不出块（真管线，逐偏移）', () => {
  function at(md: string, to: number): HTMLElement {
    const clipped = clipTree(parseMarkdown(md)!, 0, to)
    return render(<>{renderMarkdown(clipped, { caretAt: to })}</>).container
  }

  const FIXTURES = [
    '- 甲\n- 乙\n- 丙\n',
    '> ```\n> 甲\n> 乙\n> ```\n',
    '> ```\n> 甲\n> ```\n',
    '| 甲 | 乙 |\n| - | - |\n| 1 | 2 |\n',
    '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n末段\n',
    '# 季度汇报\n\n正文一行。\n\n又一段。\n'
  ]

  it.each(FIXTURES)('逐偏移：光标都在内容里（%s）', (src) => {
    for (let to = 1; to <= src.length; to++) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]') as HTMLElement | null
      expect(caret, `to=${to} 没有光标`).not.toBeNull()
      expect(c.lastElementChild === caret, `to=${to} 掉到块下方（末尾兜底开火处）`).toBe(false)
      if (caret!.parentElement === c) {
        // 顶层只剩「占位之前」这一种合法落点（判据二）
        expect(
          caret!.nextElementSibling?.className ?? '',
          `to=${to} 顶层的光标后面不是占位`
        ).toMatch(/wt-md-(table|pre)-blank/)
      }
    }
  })

  it.each(FIXTURES)('to = 0：树是空的，末尾兜底是唯一的位置（唯一的例外）', (src) => {
    const c = at(src, 0)
    const carets = c.querySelectorAll('[data-testid="caret"]')
    expect(carets).toHaveLength(1)
    expect(carets[0].parentElement).toBe(c)
  })
})

/**
 * 打着围栏时光标要**在框里**（设计 3.5；Task 4i）。
 *
 * 【这一条修的是用户最初报的那句】原话是「代码块的问题是光标不在代码块里面而是在代码块
 * 下面」。Task 4g 之后剩下的就是这一批：**代码块里还有没揭示的行**（占位存在）时，4g 按
 * 「占位之前」那条把光标留在**框外、紧挨占位**——两条位置都在设计 3.5 之内（框本来就在
 * 占位前面），区别只是「框内第一格」还是「框外紧挨着」。
 *
 * 【判据：光标在不在 `CODE` 元素内】`closest('code')` 同时管住行内代码（`wt-md-code-inline`）
 * 与围栏里的 `<pre><code>`，正是「在框里」这句话的字面意思。
 *
 * 【期望值为什么逐格写死】这张表是 Task 4g 的实施者在加厚语料上量出来的三状态表里的
 * 「目标」列，它等于「4g + 窄修法」的行为；**错的不是那些仍在框外的格**——`0` 那一格树是
 * 空的、`1` 那几格围栏自身还没开始（`code.position.start > at`），按设计 3.5 规则二光标
 * 就该插在它**前面**。所以这里断言的是**整个集合相等**，多一格少一格都要红。
 */
describe('围栏里的光标（真管线，逐偏移）', () => {
  function at(md: string, to: number): HTMLElement {
    const clipped = clipTree(parseMarkdown(md)!, 0, to)
    return render(<>{renderMarkdown(clipped, { caretAt: to })}</>).container
  }

  /** [名字, 源码, 「光标不在 CODE 内」的那些偏移] */
  const CASES: [string, string, number[]][] = [
    ['单行围栏', '```\n甲\n```\n', [0]],
    ['两行围栏', '```\n甲\n乙\n```\n', [0]],
    ['引用块里的围栏', '> ```\n> 甲\n> ```\n', [0, 1]],
    ['引用块里的多行围栏 + 尾段', '> ```\n> 甲\n> 乙\n> ```\n\n尾段\n', [0, 1, 22, 23, 24]],
    ['列表项里的围栏', '- ```\n  甲\n  ```\n', [0, 1]],
    ['空围栏', '```\n```\n', [0]],
    ['缩进代码块', '    甲\n    乙\n', [0]],
    ['只有行内代码', '`乙`\n', [0]]
  ]

  it.each(CASES)('%s：光标不在框里的格只有那几个', (_name, src, expected) => {
    const outside: number[] = []
    for (let to = 0; to <= src.length; to++) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]') as HTMLElement | null
      expect(caret, `to=${to} 没有光标`).not.toBeNull()
      expect(
        c.querySelectorAll('[data-testid="caret"]'),
        `to=${to} 光标数不对`
      ).toHaveLength(1)
      if (caret!.closest('code') === null) outside.push(to)
    }
    expect(outside, '「光标不在框里」的偏移集合').toEqual(expected)
  })
})

/**
 * 兜底那三支路各自的守卫（Task 4j）。
 *
 * 【为什么补这三条】4g 的评审逐条单独变异发现**三条支路零覆盖**（关掉它们、全仓 608 条照旧
 * 全绿）：`renderMarkdown` 里 `hasPlaceholder` 那条让路、`tailTarget` 里 `?? node`（容器收留）、
 * `tailTarget` 里 `definition` 跳过。三条都属「4g 自己写的、没人守着的」——零覆盖的支路等于
 * 下一批人随手改掉它也不会有任何信号。
 *
 * 【三条的判据都取「可观察的后果」，不取实现细节】占位那支守的是设计 3.5 记的**连续 13 格**
 * 老账（关掉它，光标从「`</table>` 之后、占位之前」被挪进表头单元格，20 行表上差出十几行）；
 * 另两条守的是「链尾退回容器之后光标**仍在那个块里**」（关掉它，光标掉到最后一个块下方）。
 *
 * 【夹具与窗口都是量出来的】不是推的：四行表的顶层窗口 = 8–20 ∪ {28,29,30}（8–20 正是设计里
 * 那 13 格），20 行表 = 每行三格、从 8–20 起共 67 格；三份「以叶子收尾」的夹具上，**除 to=0
 * 之外没有一格**是顶层的。
 */
describe('兜底三支路的守卫', () => {
  function at(md: string, to: number): HTMLElement {
    const clipped = clipTree(parseMarkdown(md)!, 0, to)
    return render(<>{renderMarkdown(clipped, { caretAt: to })}</>).container
  }

  const TABLE_ROWS_4 = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\n末段\n'
  const TABLE_ROWS_20 =
    '| a | b |\n| - | - |\n' + Array.from({ length: 19 }, (_, i) => `| ${i} | x |`).join('\n') + '\n'

  it('占位在场：光标紧挨 `</table>` 之后的占位，不在任何格子里（关掉让路那支就红）', () => {
    const WINDOWS: [string, number[]][] = [
      [TABLE_ROWS_4, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 28, 29, 30]],
      [
        TABLE_ROWS_20,
        // 表头那一窗 + 之后每行三格（量出来的，不是推的）
        [
          8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 28, 29, 30, 38, 39, 40, 48, 49, 50, 58,
          59, 60, 68, 69, 70, 78, 79, 80, 88, 89, 90, 98, 99, 100, 108, 109, 110, 118, 119, 120,
          129, 130, 131, 140, 141, 142, 151, 152, 153, 162, 163, 164, 173, 174, 175, 184, 185, 186,
          195, 196, 197, 206, 207, 208
        ]
      ]
    ]
    for (const [src, window] of WINDOWS) {
      for (const to of window) {
        const c = at(src, to)
        const caret = c.querySelector('[data-testid="caret"]') as HTMLElement
        expect(caret, `to=${to} 没有光标`).not.toBeNull()
        // 关掉让路那支之后：光标进了 `<th>` / `<td>`，这一条当场红
        expect(caret.closest('th, td'), `to=${to} 光标进了格子`).toBeNull()
        // 也不许掉到表格**下面**去：它必须紧挨着占位那块的**前面**
        expect(caret.parentElement, `to=${to} 不是顶层`).toBe(c)
        expect(
          caret.nextElementSibling?.className ?? '',
          `to=${to} 后面不是占位`
        ).toContain('wt-md-table-blank')
      }
    }
  })

  it.each([
    ['图片收尾', '甲 ![图](a.png)\n', 'p'],
    /*
      【脚注那份的容器选择器要带上 `.wt-md-fndef`】它渲染成
      `<div class="wt-md-fndef"><span>标号</span><p>…</p></div>`，而 to=8–13 那几格光标
      合法地待在**那个 div 里、`<p>` 前面**（`caretBefore` 的「插在它前面」）——只认 `p`
      会把正确的落点判成失败（实测踩到过）。
    */
    ['脚注引用收尾', '甲[^1]\n\n[^1]: 脚注\n', 'p, .wt-md-fndef'],
    ['硬换行收尾', '甲  \n', 'p']
  ])('段落以叶子收尾（%s）：链尾退回容器，光标仍在块里（关掉 `?? node` 就红）', (_n, src, sel) => {
    for (let to = 1; to <= src.length; to++) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]') as HTMLElement
      expect(caret, `to=${to} 没有光标`).not.toBeNull()
      expect(caret.parentElement, `to=${to} 掉到块下方`).not.toBe(c)
      expect(caret.closest(sel), `to=${to} 不在 ${sel} 里`).not.toBeNull()
    }
  })

  it('文档以 `[ref]:` 定义收尾：跳过它看前一个兄弟（关掉 definition 跳过那支就红）', () => {
    const src = '甲\n\n[a]: https://example.com\n'
    for (let to = 1; to <= src.length; to++) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]') as HTMLElement
      expect(caret, `to=${to} 没有光标`).not.toBeNull()
      expect(caret.parentElement, `to=${to} 掉到块下方`).not.toBe(c)
      expect(caret.closest('p'), `to=${to} 不在段落里`).not.toBeNull()
    }
  })
})

/**
 * 合并 text / html 那条串上的链尾（Task 4j）。
 *
 * 【缺陷】`renderAll` 里 `hasHtml` 那条路**只调 `renderTokens(tokens)`、从不 `renderNode`**，
 * 于是 `splitAtCaret` 不被调用、`caret.tail` 没人消费——光标一路落到 `renderMarkdown` 末尾
 * 那条兜底，落在**块外**。实测：`'> <b>x</b>甲一\n> 乙二\n\n末段\n'` 的 **18、19** 与
 * `'甲 <b>乙</b>\n\n末段\n'` 的 **7、8、9**（老代码 871 格里这类 110 格，4g 修好 108，剩这 2 处）。
 *
 * 【成因不是「链尾是 html 叶子」】那几格 `tailTarget` 返回的是**文本节点**（line 里那个
 * 「非值叶子返回 null」的分支只在这两份夹具的 `to = 0` 附近开火，而那时光标本来也在块内）。
 * 所以修法是让这条串**也认 `caret.tail`**：串尾命中 tail 时把光标放在这一串的末尾
 * （tail 恒是这一串的最后一个节点，所以「串尾」就是「那个节点的末尾」）。
 */
describe('合并串上的链尾（真管线，逐偏移）', () => {
  function at(md: string, to: number): HTMLElement {
    const clipped = clipTree(parseMarkdown(md)!, 0, to)
    return render(<>{renderMarkdown(clipped, { caretAt: to })}</>).container
  }

  it.each([
    ['引用块里的行内 HTML', '> <b>x</b>甲一\n> 乙二\n\n末段\n', 'blockquote', [18, 19]],
    ['段落里的行内 HTML', '甲 <b>乙</b>\n\n末段\n', 'p', [7, 8, 9]]
  ])('%s：光标在块内（%s）', (_n, src, sel, named) => {
    for (const to of named) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]') as HTMLElement
      expect(caret, `to=${to} 没有光标`).not.toBeNull()
      expect(caret.closest(sel), `to=${to} 掉出 ${sel}`).not.toBeNull()
    }
    // 整段逐偏移一起守：除 to=0（树是空的）之外，一格都不许落在顶层
    for (let to = 1; to <= src.length; to++) {
      const c = at(src, to)
      const caret = c.querySelector('[data-testid="caret"]') as HTMLElement
      expect(caret.parentElement, `to=${to} 掉到块下方`).not.toBe(c)
    }
  })
})
