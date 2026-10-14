import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'
import { clipTree } from '../../src/renderer/src/markdown/clip'
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
    const div = c.querySelector('div')!
    expect(div.hasAttribute('onclick')).toBe(false)
    expect(div.hasAttribute('class')).toBe(false)
    expect(div.hasAttribute('style')).toBe(false)
  })

  it('不配对的开标签不会把后面的内容吞掉', () => {
    // 没有闭合标签时，收尾那一步会把它合上——后面兄弟节点仍然渲染得出来
    const c = dom('<div>开\n\n后面一段\n')
    expect(c.textContent).toContain('后面一段')
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
