import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Page, type MarkdownSource } from '../../src/renderer/src/components/Page'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'

const DOC = ['# 季度汇报', '', '本季度共归档 3 项。', '', '- 归档流程上线', '- 复核环节压缩到 2 天'].join('\n')

function source(over: Partial<MarkdownSource> = {}): MarkdownSource {
  return { doc: parseMarkdown(DOC)!, revealStart: 0, cursor: DOC.length, measuring: false, ...over }
}

/** 每次渲染都按这几个必填 prop 调一遍 `Page`，省得每个用例重复十行。 */
function page(src: MarkdownSource | null, visibleText = '', props: { expanded?: boolean } = {}) {
  return render(
    <Page
      visibleText={visibleText}
      expanded={props.expanded ?? true}
      onToggleExpand={() => {}}
      empty={false}
      markdown={src}
    />
  )
}

describe('Page —— md 分支', () => {
  it('给了 markdown 就渲染结构，而不是裸文本', () => {
    const c = page(source()).container
    expect(c.querySelector('h1')).not.toBeNull()
    expect(c.querySelector('ul')).not.toBeNull()
    // 记号一个都不该露出来
    expect(c.querySelector('[data-testid="page-text"]')!.textContent).not.toContain('#')
    expect(c.querySelector('[data-testid="page-text"]')!.textContent).not.toContain('-')
  })

  it('光标推进，屏幕上就多一块（clipTree 真的接上了）', () => {
    const c = page(source({ cursor: DOC.indexOf('本季度') })).container
    expect(c.querySelector('h1')).not.toBeNull()
    expect(c.querySelector('p')).toBeNull() // 第二段还没开始
  })

  it('**不给 markdown 时行为完全不变**：渲染的还是那一个字符串', () => {
    const c = page(null, '第一章 甲').container
    expect(c.querySelector('[data-testid="page-text"]')!.textContent).toContain('第一章 甲')
    expect(c.querySelector('h1')).toBeNull()
    expect(c.querySelector('p')).toBeNull()
  })

  it('measuring 为真时多出一份隐藏的整篇副本，为假时没有', () => {
    // 【为什么必须能关掉】那份副本是**整篇**文档的 DOM，每次按键都渲染它
    // 是不可接受的；它只在算铺满的时候开一下
    expect(page(source({ cursor: 5 })).container.querySelector('.wt-md-measure')).toBeNull()
    const withMeasure = page(source({ cursor: 5, measuring: true })).container
    const measure = withMeasure.querySelector('.wt-md-measure')
    expect(measure).not.toBeNull()
    // 隐藏副本里的内容与光标无关，永远是整篇
    expect(measure!.querySelector('ul')).not.toBeNull()
  })

  it('measuring 为真时把容器交给上层', () => {
    const seen: (HTMLElement | null)[] = []
    page(source({ cursor: 5, measuring: true, onMeasureNode: (el) => seen.push(el) }))
    expect(seen.some((el) => el !== null && el.className.includes('wt-md-measure'))).toBe(true)
  })

  it('折叠条：按块边界折，数字是折点之前的字符数', () => {
    // 光标推到很后面，且 expanded 为假 —— 触发折叠
    const long = '# 标题\n\n' + '啊'.repeat(40000) + '\n'
    const doc = parseMarkdown(long)!
    const c = page({ doc, revealStart: 0, cursor: long.length, measuring: false }, '', { expanded: false }).container
    const fold = c.querySelector('[data-testid="page-fold"]')
    expect(fold).not.toBeNull()
    // 数字必须是个正数，而且小于总长——具体值随块边界走，不做字面断言
    const n = Number(fold!.textContent!.replace(/\D+/g, ''))
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(long.length)
  })

  /**
   * 【这条守的是「块的对齐」这件事本身】
   *
   * 量高度那一份副本里，**DOM 的直接子元素个数必须等于语法树的顶层节点个数**。
   * 少了这一条，`definition`（`[a]: url`，真 md 里很常见）与只含注释 / `<script>`
   * 的 HTML 块都会渲染出零个 Element，于是 DOM 比「块」少一个，
   * `measureBlocks` 恒返回 null，**整篇静默退回按字符数铺**——不报错、不白屏。
   *
   * 缺口是 Task 7 的实施者量出来的：他拿真实的 `renderMarkdown(doc)` 跑，
   * 数出来比 `doc.children.length` 少。
   */
  it('量高度那一份：DOM 子元素个数必须等于顶层节点个数（含 definition 与纯注释块）', () => {
    const src = [
      '# 标题',
      '',
      '[a]: https://example.com',
      '',
      '<!-- 一段注释 -->',
      '',
      '正文'
    ].join('\n')
    const doc = parseMarkdown(src)!
    const measure = page({ doc, revealStart: 0, cursor: 0, measuring: true }).container.querySelector(
      '.wt-md-measure'
    )!
    expect(measure.children.length).toBe(doc.children.length)
    // 顺带钉住每个包装都带着自己的结束偏移——`measureBlocks` 靠它配对
    for (const el of Array.from(measure.children)) {
      expect(el.getAttribute('data-block-end')).not.toBeNull()
    }
  })
})
