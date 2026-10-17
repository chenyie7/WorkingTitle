import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { Page, type MarkdownSource } from '../../src/renderer/src/components/Page'
import { MarkdownView } from '../../src/renderer/src/markdown/MarkdownView'
import { parseMarkdown } from '../../src/renderer/src/markdown/parse'
import type { WtApi } from '../../src/core/api'

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

  it('md 这条路**没有** `.wt-page__novel` 那一层，正文字体与字号够不着它', () => {
    // 【为什么要钉这一条】新正文的字体与字号挂在 `.wt-page__novel` 上（`page.css`）。
    // 这一层若被套到 md 上（或字体被挂回共用的 `.wt-page`），md 就会跟着换字体、
    // 跟着缩字号——而它那一整套 px 是照着 Word 的标题层级写死的，缩了层级就散了。
    const c = page(source()).container
    expect(c.querySelector('.wt-page__novel')).toBeNull()
    // 前提自检：这一份确实渲染出了块，不是因为整棵树空着才没有那一层。
    expect(c.querySelector('h1')).not.toBeNull()
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

/**
 * D3：折点不得越过光标。
 *
 * 折叠切点从**文档末尾**累加时，若光标在中段、后面还有一整段长尾，长尾自己就超过
 * `RENDER_WINDOW_LIMIT`，折点落到光标之后，窗口 `[折点, 光标)` 是空的——页面上只剩折叠条。
 */
describe('Page —— 折叠的上界（D3）', () => {
  it('光标在中段、后面有长尾：折叠后仍显示光标前那一段，不是只剩折叠条', () => {
    const src = '# 标题\n\n' + 'A'.repeat(40000) + '\n\n' + 'B'.repeat(40000) + '\n'
    const doc = parseMarkdown(src)!
    const cursor = src.indexOf('B') - 5 // 揭示超过上限，且光标停在长尾之前
    expect(cursor).toBeGreaterThan(30000)
    const c = page({ doc, revealStart: 0, cursor, measuring: false }, '', { expanded: false }).container

    // 主判据：窗口里还有已揭示的内容。折点越过光标时这里一个字都没有。
    const shown = c.querySelector('[data-testid="page-text"]')!.textContent ?? ''
    expect(shown.length).toBeGreaterThan(0)
    expect(shown).toContain('A')
    expect(shown).not.toContain('B') // 长尾一个字都没揭示

    const fold = c.querySelector('[data-testid="page-fold"]')
    expect(fold).not.toBeNull()
    const folded = Number(fold!.textContent!.replace(/\D+/g, ''))
    expect(folded).toBeGreaterThan(0)
    // 折点 = 第二个块的起始偏移（标题之后），且绝不超过光标
    expect(folded).toBe(doc.children[1].position!.start.offset)
    expect(folded).toBeLessThanOrEqual(cursor)
  })

  it('MarkdownView 自身也防御：折点更大时按光标夹', () => {
    const doc = parseMarkdown('甲乙丙。\n\n丁戊己。\n')!
    const cursor = 3
    const clamped = render(
      <MarkdownView doc={doc} foldStart={cursor} cursor={cursor} measuring={false} />
    ).container.innerHTML
    const over = render(
      <MarkdownView doc={doc} foldStart={1000} cursor={cursor} measuring={false} />
    ).container.innerHTML
    expect(over).toBe(clamped)
  })
})

/**
 * 量高度那一份是 layoutOnly：不挂真实图片，所以未揭示的图不会被提前请求（设计 8.2）。
 */
describe('Page —— 量高度副本不请求图片', () => {
  it('measuring 为真、可见树是空的时候，一个取图 IPC 都不发', () => {
    const spy = vi.fn(async () => null)
    ;(window as unknown as { api: WtApi }).api = {
      ...(window.api as WtApi),
      loadWorkDocImage: spy
    }
    const doc = parseMarkdown('甲 ![图](a.png)\n')!
    const c = page({ doc, revealStart: 0, cursor: 0, measuring: true }).container
    expect(c.querySelector('.wt-md-measure')).not.toBeNull()
    expect(spy).not.toHaveBeenCalled()
    // 副本里只有占位，没有真图——但块包装仍在（量高度的配对靠它）
    const measure = c.querySelector('.wt-md-measure')!
    expect(measure.querySelector('img')).toBeNull()
    expect(measure.querySelectorAll('.wt-md-measure-block')).toHaveLength(doc.children.length)
  })
})

/**
 * 阅读光标（设计 3.5）。
 *
 * 【判据一：不是 `.wt-page__text` 的**最后一个**子元素】光标原来由 `Page` 追加在内容末尾，
 * 落在最后一个块**下方**；`renderMarkdown` 那条末尾兜底是同一个签名。修好之后它落在
 * **块里面**——`<h1>` / `<p>` / `<li>` / `<pre>` / `<td>` 里。
 *
 * 【为什么不用 `closest('p')`】它把正确地待在标题、列表项、单元格、代码框里的落点全判成失败
 * （本文件这份 DOC 上实测 5 格不成立、10 格误伤——评审逐偏移量过）。
 *
 * 【为什么不用「父元素是不是 `.wt-page__text`」】顶层还允许「占位**之前**」这一种落点
 * （设计 3.5，`BlankSpace` 接的那几格），它同样是直接子元素；靠「是不是最后一个」才分得开。
 *
 * 【`cursor = 0` 是唯一的例外】那时树是空的，末尾兜底是唯一能放的位置。
 */
describe('Page —— 阅读光标', () => {
  it('md 那条路：逐偏移扫，光标恰好一个，且不是末尾兜底那一下', () => {
    for (let cursor = 0; cursor <= DOC.length; cursor++) {
      const c = page(source({ cursor })).container
      const text = c.querySelector('[data-testid="page-text"]')!
      const carets = text.querySelectorAll('[data-testid="caret"]')
      expect(carets, `cursor=${cursor} 光标数不对`).toHaveLength(1)
      if (cursor === 0) {
        // 树是空的（每个顶层块都满足「起始偏移 ≥ to」被丢掉），兜底是唯一的位置
        expect(text.firstElementChild, `cursor=0 应当是末尾兜底`).toBe(carets[0])
        continue
      }
      expect(text.lastElementChild === carets[0], `cursor=${cursor} 掉到块下方`).toBe(false)
    }
  })

  it('纯文本那条路照旧：末尾那个光标还在', () => {
    const c = page(null, '第一章 甲').container
    const carets = c.querySelectorAll('[data-testid="caret"]')
    expect(carets).toHaveLength(1)
    expect(carets[0].closest('.wt-page__text')).not.toBeNull()
  })

  it('量高度那份副本里没有光标（找不着光标会让输入框退回纸张角上）', () => {
    const c = page(source({ cursor: 5, measuring: true })).container
    expect(c.querySelector('.wt-md-measure')!.querySelector('[data-testid="caret"]')).toBeNull()
  })
})
