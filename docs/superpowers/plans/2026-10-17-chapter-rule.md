# 章节分章规则（重新分章）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置里新增「分章设置」页，让用户为每本书选一条章节识别规则（自动 / 预置 / 自定义正则），在后台进程里重新切章；正文与阅读进度不动，规则按书记住。

**Architecture:** 规则模型与切章算法放在 `src/core/chapters.ts`（main 与 renderer 共享）；重新分章走 utility process，结果写回小说缓存；规则存进这本书的 `sessions/<hash>.json`，打开书时后台进程先按会话里的规则切好再交给渲染层。

**Tech Stack:** Electron 44 + electron-vite、React 19、TypeScript、vitest + jsdom、Playwright `_electron`（真机验收由用户执行）。

**前置：** 当前分支应为 `feat/chapter-rules`（设计文档已在该分支上）。实现过程中不要切到 main。

**设计文档：** `docs/superpowers/specs/2026-10-17-chapter-rule-design.md`

---

## 文件结构

| 文件 | 责任 |
| --- | --- |
| `src/core/types.ts` | 新增 `ChapterPresetId`、`ChapterRule`、`DEFAULT_CHAPTER_RULE`；会话与缓存 meta 各加 `chapterRule?` |
| `src/core/chapters.ts` | 预置表、规则校验/相等、可配置匹配器、`splitChapters` 规则参数、`resplitChapters`、`hasChapterTitles` |
| `src/main/loadNovel.ts` | `loadNovelFromFile` 增加规则参数 |
| `src/main/novelService.ts`（新建） | 按规则打开、按规则重切、缓存回写的唯一编排 |
| `src/main/sessionStore.ts` | 会话/缓存里的规则字段、读盘容错、`readNovelCacheEntry` |
| `src/main/novelWorker.ts` | worker 请求改成 open / resplit 联合类型 |
| `src/main/novelLoader.ts` | 客户端协议、`resplitNovelInBackground`、10 秒看门狗 |
| `src/main/ipc.ts`、`src/main/channels.ts` | 新 IPC 通道与兜底路径 |
| `src/preload/index.ts`、`src/core/api.ts` | 桥接 `resplitNovel` |
| `src/renderer/src/App.tsx` | 规则状态、打开书时读回、应用规则、会话携带规则 |
| `src/renderer/src/components/Ribbon.tsx` | 把四个分章 prop 透传给设置对话框 |
| `src/renderer/src/components/SettingsDialog.tsx` | 「分章设置」页签与面板 |
| `src/renderer/src/styles/ribbon.css` | 新面板的纵向排列与错误色 |
| `tests/unit/*` | 见各任务 |

---

### Task 1: 规则类型、预置规则与校验

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/chapters.ts`
- Test: `tests/unit/chapters.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/chapters.test.ts` 顶部的 import 里补上新名字：

```ts
import {
  CHAPTER_PRESETS,
  chapterRuleEqual,
  chapterRuleProblem,
  isChapterTitle,
  splitChapters,
  PREAMBLE_TITLE
} from '../../src/core/chapters'
import { DEFAULT_CHAPTER_RULE } from '../../src/core/types'
```

在文件末尾追加：

```ts
describe('可配置的分章规则', () => {
  it('cn-chapter 只认中文章节标题', () => {
    const rule = { kind: 'preset', id: 'cn-chapter' } as const
    expect(isChapterTitle('第一百零八回 聚义', rule)).toBe(true)
    expect(isChapterTitle('第3节 起手', rule)).toBe(true)
    expect(isChapterTitle('序章', rule)).toBe(false)
    expect(isChapterTitle('Chapter 3 The Beginning', rule)).toBe(false)
    expect(isChapterTitle('1、开端', rule)).toBe(false)
  })

  it('numbered 只认数字序号，句读闸门仍在', () => {
    const rule = { kind: 'preset', id: 'numbered' } as const
    expect(isChapterTitle('1、开端', rule)).toBe(true)
    expect(isChapterTitle('12．转折', rule)).toBe(true)
    expect(isChapterTitle('1、开端，转折', rule)).toBe(false)
    expect(isChapterTitle('第一章 风起', rule)).toBe(false)
  })

  it('chapter-en 只认英文 Chapter N，不区分大小写', () => {
    const rule = { kind: 'preset', id: 'chapter-en' } as const
    expect(isChapterTitle('chapter 3 the beginning', rule)).toBe(true)
    expect(isChapterTitle('Chapter 3 The Beginning', rule)).toBe(true)
    expect(isChapterTitle('第一章 风起', rule)).toBe(false)
  })

  it('special 认特殊符号与单独一行的关键词', () => {
    const rule = { kind: 'preset', id: 'special' } as const
    expect(isChapterTitle('☆、晋江标题', rule)).toBe(true)
    expect(isChapterTitle('【第一章】', rule)).toBe(true)
    expect(isChapterTitle('简介', rule)).toBe(true)
    expect(isChapterTitle('前言不搭后语', rule)).toBe(false)
    expect(isChapterTitle('正文完', rule)).toBe(false)
  })

  it('自定义正则按 trim 后的整行匹配，且不区分大小写', () => {
    const rule = { kind: 'custom', pattern: '^chapter\\s+\\d+.*$' } as const
    expect(isChapterTitle('  CHAPTER 3 The Beginning  ', rule)).toBe(true)
    expect(isChapterTitle('正文里提到 chapter 3 不算', rule)).toBe(false)
  })

  it('自定义正则不受 40 字上限约束', () => {
    const rule = { kind: 'custom', pattern: '^.+$' } as const
    const long = '字'.repeat(80)
    expect(isChapterTitle(long, rule)).toBe(true)
    expect(isChapterTitle(long, DEFAULT_CHAPTER_RULE)).toBe(false)
  })

  it('自定义正则也不把空行 / 纯空白行当标题', () => {
    expect(isChapterTitle('', { kind: 'custom', pattern: '^$' })).toBe(false)
    expect(isChapterTitle('   ', { kind: 'custom', pattern: '^.*$' })).toBe(false)
  })

  it('chapterRuleProblem 逐项校验', () => {
    expect(chapterRuleProblem({ kind: 'auto' })).toBeNull()
    expect(chapterRuleProblem({ kind: 'preset', id: 'numbered' })).toBeNull()
    expect(chapterRuleProblem({ kind: 'preset', id: 'nope' })).toContain('id')
    expect(chapterRuleProblem({ kind: 'custom', pattern: '^第.+章$' })).toBeNull()
    expect(chapterRuleProblem({ kind: 'custom', pattern: '(' })).toContain('正则')
    expect(chapterRuleProblem({ kind: 'custom', pattern: '' })).toContain('pattern')
    expect(chapterRuleProblem({ kind: 'nope' })).toContain('kind')
    expect(chapterRuleProblem(null)).toContain('不是对象')
    // 原型链上的名字不能当 preset id
    expect(chapterRuleProblem({ kind: 'preset', id: 'toString' })).toContain('id')
  })

  it('chapterRuleEqual 只认完全相同的规则', () => {
    expect(chapterRuleEqual({ kind: 'auto' }, { kind: 'auto' })).toBe(true)
    expect(
      chapterRuleEqual({ kind: 'preset', id: 'numbered' }, { kind: 'preset', id: 'numbered' })
    ).toBe(true)
    expect(
      chapterRuleEqual({ kind: 'preset', id: 'numbered' }, { kind: 'preset', id: 'special' })
    ).toBe(false)
    expect(chapterRuleEqual({ kind: 'custom', pattern: '^a' }, { kind: 'custom', pattern: '^a' })).toBe(true)
    expect(chapterRuleEqual({ kind: 'custom', pattern: '^a' }, { kind: 'custom', pattern: '^b' })).toBe(false)
    expect(chapterRuleEqual({ kind: 'auto' }, { kind: 'custom', pattern: '^a' })).toBe(false)
  })

  it('CHAPTER_PRESETS 覆盖四个 id 且文案非空', () => {
    expect(Object.keys(CHAPTER_PRESETS).sort()).toEqual([
      'chapter-en',
      'cn-chapter',
      'numbered',
      'special'
    ])
    for (const label of Object.values(CHAPTER_PRESETS)) expect(label.length).toBeGreaterThan(0)
  })

  it('splitChapters 接受规则参数', () => {
    const text = 'Chapter 1 A\n正文\nChapter 2 B\n正文'
    const { flatText, chapters } = splitChapters(text, 'x', { kind: 'preset', id: 'chapter-en' })
    expect(chapters.map((c) => c.title)).toEqual(['Chapter 1 A', 'Chapter 2 B'])
    expect(flatText).toBe(text)
  })
})
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm vitest run tests/unit/chapters.test.ts`

Expected: FAIL —— `CHAPTER_PRESETS` / `chapterRuleProblem` / `chapterRuleEqual` 没有导出，TypeScript/Vite 报「is not a function / no export」一类错误。

- [ ] **Step 3: 在 `src/core/types.ts` 里加类型**

在 `Chapter` 接口之后插入：

```ts
export type ChapterPresetId = 'cn-chapter' | 'numbered' | 'chapter-en' | 'special'

export type ChapterRule =
  | { kind: 'auto' }
  | { kind: 'preset'; id: ChapterPresetId }
  | { kind: 'custom'; pattern: string }

/** 默认规则＝现有那套多模式识别。冻结一份，避免被消费方就地改掉。 */
export const DEFAULT_CHAPTER_RULE: ChapterRule = Object.freeze({ kind: 'auto' })
```

- [ ] **Step 4: 改 `src/core/chapters.ts`**

把 import 改成：

```ts
import {
  DEFAULT_CHAPTER_RULE,
  type Chapter,
  type ChapterPresetId,
  type ChapterRule
} from './types'
```

在 `NUMBERED_TITLE` 之后加特殊符号规则与预置表：

```ts
const SPECIAL_TITLE =
  /^(?:[☆★✦✧※].{0,30}|【[^】]{1,30}】|(?:内容|文章)?简介|文案|前言|序章|楔子|正文|终章|尾声|后记|番外)$/

/** 预置表用 Record 声明：漏掉一个 id 编译期就报错。 */
export const CHAPTER_PRESETS: Readonly<Record<ChapterPresetId, string>> = {
  'cn-chapter': '第X章（中文）',
  numbered: '数字序号',
  'chapter-en': 'Chapter N',
  special: '特殊符号'
}
```

把原来的 `isChapterTitle` 函数体改名为模块私有的 `isAutoTitle`，并在其后加匹配器、校验与比较：

```ts
function isAutoTitle(line: string): boolean {
  const t = line.trim()
  if (t.length === 0 || t.length > MAX_TITLE_LEN) return false
  // 句读闸门只作用于数字 + 顿号那条：前三条的强前缀足够与正文区分，副标题允许带标点。
  if (SENTENCE_PUNCT.test(t) && NUMBERED_TITLE.test(t)) return false
  return TITLE_PATTERNS.some((re) => re.test(t))
}

function presetMatches(id: ChapterPresetId, line: string): boolean {
  const t = line.trim()
  if (t.length === 0 || t.length > MAX_TITLE_LEN) return false
  switch (id) {
    case 'cn-chapter':
      return TITLE_PATTERNS[0].test(t)
    case 'numbered':
      return !SENTENCE_PUNCT.test(t) && NUMBERED_TITLE.test(t)
    case 'chapter-en':
      return TITLE_PATTERNS[2].test(t)
    case 'special':
      return SPECIAL_TITLE.test(t)
  }
}

/**
 * 规则 → 行判定器。自定义正则只编译一次；非法正则直接抛，调用方先用
 * chapterRuleProblem 校验。这里不带 /g 或 /y，避免 lastIndex 让判定变成有状态的。
 */
function makeMatcher(rule: ChapterRule): (line: string) => boolean {
  if (rule.kind === 'auto') return isAutoTitle
  if (rule.kind === 'preset') return (line) => presetMatches(rule.id, line)
  const re = new RegExp(rule.pattern, 'i')
  return (line) => {
    const t = line.trim()
    // 空行永远不是标题：文件末尾那个空行 + 用户写的 ^.*$ 会凭空造出一章。
    return t !== '' && re.test(t)
  }
}

export function isChapterTitle(line: string, rule: ChapterRule = DEFAULT_CHAPTER_RULE): boolean {
  return makeMatcher(rule)(line)
}

/** 返回第一个不合格字段的描述；合格返回 null。 */
export function chapterRuleProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'chapterRule 不是对象'
  const r = v as Record<string, unknown>
  if (r.kind === 'auto') return null
  if (r.kind === 'preset') {
    if (typeof r.id !== 'string') return 'chapterRule.id 不是字符串'
    // Object.hasOwn 而不是 in：手改过的 JSON 能把 toString 这类原型链名字塞进来。
    if (!Object.hasOwn(CHAPTER_PRESETS, r.id)) return `chapterRule.id 不认识：${r.id}`
    return null
  }
  if (r.kind === 'custom') {
    if (typeof r.pattern !== 'string' || r.pattern === '') {
      return 'chapterRule.pattern 不是非空字符串'
    }
    try {
      new RegExp(r.pattern, 'i')
    } catch {
      return 'chapterRule.pattern 不是合法正则'
    }
    return null
  }
  return 'chapterRule.kind 不认识'
}

export function chapterRuleEqual(a: ChapterRule, b: ChapterRule): boolean {
  if (a.kind === 'auto' || b.kind === 'auto') return a.kind === b.kind
  if (a.kind === 'preset' && b.kind === 'preset') return a.id === b.id
  if (a.kind === 'custom' && b.kind === 'custom') return a.pattern === b.pattern
  return false
}
```

把 `splitChapters` 的标题扫描换成「编译一次的匹配器」：

```ts
export function splitChapters(
  text: string,
  fallbackTitle: string,
  rule: ChapterRule = DEFAULT_CHAPTER_RULE
): SplitResult {
  const lines = text.split('\n')
  const matcher = makeMatcher(rule)

  const titleIdx: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (matcher(lines[i])) titleIdx.push(i)
  }
```

（其余函数体不变。）

- [ ] **Step 5: 跑测试，确认通过**

Run: `pnpm vitest run tests/unit/chapters.test.ts`

Expected: PASS，全部用例绿。

- [ ] **Step 6: 提交**

```bash
git add src/core/types.ts src/core/chapters.ts tests/unit/chapters.test.ts
git commit -F - <<'EOF'
feat: 章节识别规则模型与预置规则

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
```

---

### Task 2: 重新分章（保持正文坐标）与标题探测

**Files:**
- Modify: `src/core/chapters.ts`
- Test: `tests/unit/chapters.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/chapters.test.ts` 的 import 里补上 `hasChapterTitles`、`resplitChapters`：

```ts
import {
  CHAPTER_PRESETS,
  chapterRuleEqual,
  chapterRuleProblem,
  hasChapterTitles,
  isChapterTitle,
  resplitChapters,
  splitChapters,
  PREAMBLE_TITLE
} from '../../src/core/chapters'
```

在文件末尾追加：

```ts
describe('resplitChapters', () => {
  const text = '第一章 甲\n正文一。\n第二章 乙\n正文二。\n'

  it('flatText 永远等于输入，章节按新规则重切', () => {
    const result = resplitChapters(text, 'x', { kind: 'preset', id: 'cn-chapter' })
    expect(result.flatText).toBe(text)
    expect(result.chapters.map((c) => c.title)).toEqual(['第一章 甲', '第二章 乙'])
    expectContiguous(result.flatText, result.chapters)
  })

  it('开头有非空白前言时单列前言一章', () => {
    const withPreamble = '作者的话\n' + text
    const result = resplitChapters(withPreamble, 'x', { kind: 'preset', id: 'cn-chapter' })
    expect(result.chapters.map((c) => c.title)).toEqual([PREAMBLE_TITLE, '第一章 甲', '第二章 乙'])
    expect(result.flatText).toBe(withPreamble)
    expectContiguous(result.flatText, result.chapters)
  })

  it('开头只有空白时折进第一章，不丢字符', () => {
    const withBlank = '\n\n' + text
    const result = resplitChapters(withBlank, 'x', { kind: 'preset', id: 'cn-chapter' })
    expect(result.flatText).toBe(withBlank)
    expect(result.chapters[0].title).toBe('第一章 甲')
    expect(result.chapters[0].start).toBe(0)
    expectContiguous(result.flatText, result.chapters)
  })

  it('一条标题都没有时整本一章，flatText 仍是输入', () => {
    const plain = '没有标题的正文。\n第二行。'
    const result = resplitChapters(plain, '我的小说', { kind: 'preset', id: 'cn-chapter' })
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0]).toMatchObject({
      index: 0,
      title: '我的小说',
      start: 0,
      end: plain.length
    })
    expect(result.flatText).toBe(plain)
  })

  it('输入开头没有空白前言时，结果与 splitChapters 一致', () => {
    const a = splitChapters(text, 'x', { kind: 'preset', id: 'cn-chapter' })
    const b = resplitChapters(text, 'x', { kind: 'preset', id: 'cn-chapter' })
    expect(b.chapters).toEqual(a.chapters)
  })

  it('hasChapterTitles：有标题为真，无标题为假', () => {
    expect(hasChapterTitles(text, { kind: 'preset', id: 'cn-chapter' })).toBe(true)
    expect(hasChapterTitles('纯正文。', { kind: 'preset', id: 'cn-chapter' })).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm vitest run tests/unit/chapters.test.ts`

Expected: FAIL —— `resplitChapters` / `hasChapterTitles` 没有导出。

- [ ] **Step 3: 在 `src/core/chapters.ts` 里实现**

在 `splitChapters` 之后追加：

```ts
/**
 * 重新分章专用：只重算章节边界，**保证 flatText 逐字等于输入**。
 *
 * splitChapters 会重新拼正文、并丢掉文件开头的全空白前言；那套语义在导入时成立，
 * 但重新分章时 flatText 是游标与 chapterPos 的坐标系，动它会让阅读位置整体错位。
 * 这里不拼正文，只把行号换成偏移：
 * - 第一个标题前的内容非空白 → 单列「前言」一章；
 * - 全是空白 → 折进第一章，第一章仍从 0 开始。
 */
export function resplitChapters(
  text: string,
  fallbackTitle: string,
  rule: ChapterRule = DEFAULT_CHAPTER_RULE
): SplitResult {
  const matcher = makeMatcher(rule)
  const lines = text.split('\n')

  const lineStart: number[] = new Array(lines.length)
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    lineStart[i] = offset
    offset += lines[i].length + 1
  }

  const titleIdx: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (matcher(lines[i])) titleIdx.push(i)
  }

  if (titleIdx.length === 0) {
    return {
      flatText: text,
      chapters: [
        { index: 0, title: fallbackTitle, start: 0, end: text.length, charCount: text.length }
      ]
    }
  }

  const firstTitleOffset = lineStart[titleIdx[0]]
  const slices: Array<{ title: string; start: number }> = []
  if (firstTitleOffset > 0 && text.slice(0, firstTitleOffset).trim() !== '') {
    slices.push({ title: PREAMBLE_TITLE, start: 0 })
  }
  for (let i = 0; i < titleIdx.length; i++) {
    const start = i === 0 && slices.length === 0 ? 0 : lineStart[titleIdx[i]]
    slices.push({ title: lines[titleIdx[i]].trim(), start })
  }

  const chapters: Chapter[] = slices.map((s, i) => {
    const end = i + 1 < slices.length ? slices[i + 1].start : text.length
    return { index: i, title: s.title, start: s.start, end, charCount: end - s.start }
  })

  return { flatText: text, chapters }
}

/** 这条规则能不能在这段正文里认出至少一个标题。some 短路，正例通常只看几行。 */
export function hasChapterTitles(text: string, rule: ChapterRule = DEFAULT_CHAPTER_RULE): boolean {
  const matcher = makeMatcher(rule)
  return text.split('\n').some((line) => matcher(line))
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm vitest run tests/unit/chapters.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/chapters.ts tests/unit/chapters.test.ts
git commit -F - <<'EOF'
feat: 重新分章函数保持正文坐标不变

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
```

---

### Task 3: 会话与缓存里的分章规则

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/main/sessionStore.ts`
- Test: `tests/unit/sessionStore.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/sessionStore.test.ts` 顶部 import 里补上：

```ts
import { DEFAULT_CHAPTER_RULE } from '../../src/core/types'
import type { ChapterRule } from '../../src/core/types'
```

在 `describe('sessionStore 会话读写')` 里追加：

```ts
  it('chapterRule 写入后能原样读回', () => {
    const store = createSessionStore(dir)
    const s = makeSession({ chapterRule: { kind: 'preset', id: 'numbered' } })
    store.writeSession(s)
    expect(store.readSession(SRC)?.chapterRule).toEqual({ kind: 'preset', id: 'numbered' })
  })

  it('旧会话没有 chapterRule 时照常有效', () => {
    const store = createSessionStore(dir)
    store.writeSession(makeSession())
    const got = store.readSession(SRC)
    expect(got).not.toBeNull()
    expect(got?.chapterRule).toBeUndefined()
  })

  it('读盘时 chapterRule 坏了只丢字段，进度仍然读得回来', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const store = createSessionStore(dir)
      mkdirSync(join(dir, 'sessions'), { recursive: true })
      writeFileSync(
        sessionFile(dir, SRC),
        JSON.stringify({ ...makeSession(), chapterRule: { kind: 'custom', pattern: '(' } }),
        'utf8'
      )
      const got = store.readSession(SRC)
      expect(got).not.toBeNull()
      expect(got!.cursor).toBe(120)
      expect(got!.chapterRule).toBeUndefined()
      expect(spy.mock.calls[0][0]).toContain('chapterRule')
    } finally {
      spy.mockRestore()
    }
  })

  it('写盘时 chapterRule 不合法就拒绝整次写入', () => {
    const store = createSessionStore(dir)
    const r = store.writeSession(
      makeSession({ chapterRule: { kind: 'custom', pattern: '(' } })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('chapterRule')
    expect(store.readSession(SRC)).toBeNull()
  })
```

在 `describe('sessionStore 小说缓存')` 里追加：

```ts
  it('缓存条目带着写入时记录的规则', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    const rule: ChapterRule = { kind: 'preset', id: 'numbered' }
    store.writeNovelCache(makeNovel(src), rule)
    const entry = store.readNovelCacheEntry(src)
    expect(entry?.chapterRule).toEqual(rule)
    expect(store.readNovelCache(src)?.flatText).toBe(makeNovel(src).flatText)
  })

  it('缓存 meta 没有 chapterRule 时按自动识别', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src))
    const metaPath = join(dir, 'novel-cache.json')
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    delete meta.chapterRule
    writeFileSync(metaPath, JSON.stringify(meta), 'utf8')
    expect(store.readNovelCacheEntry(src)?.chapterRule).toEqual(DEFAULT_CHAPTER_RULE)
  })

  it('缓存 meta 里的 chapterRule 不合法时整份缓存按未命中', () => {
    const store = createSessionStore(dir)
    const src = writeSource('第一章 甲\n正文。\n')
    store.writeNovelCache(makeNovel(src))
    const metaPath = join(dir, 'novel-cache.json')
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    meta.chapterRule = { kind: 'custom', pattern: '(' }
    writeFileSync(metaPath, JSON.stringify(meta), 'utf8')
    expect(store.readNovelCacheEntry(src)).toBeNull()
  })
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`

Expected: FAIL —— `readNovelCacheEntry` 不存在、`makeSession` 的 `chapterRule` 不被认。

- [ ] **Step 3: 在 `src/core/types.ts` 加字段**

`PersistedSession` 末尾（`startedAt` 之后）加：

```ts
  /** 这本书的章节识别规则。缺字段＝自动识别（旧会话因此照常有效）。 */
  chapterRule?: ChapterRule
```

`NovelCacheMeta` 的 `textBytes` 之前加：

```ts
  /** 这份目录是按哪条规则切的。缺字段＝自动识别。 */
  chapterRule?: ChapterRule
```

- [ ] **Step 4: 改 `src/main/sessionStore.ts`**

顶部 import 补上：

```ts
import { chapterRuleProblem, DEFAULT_CHAPTER_RULE } from '../core/chapters'
import type { AppSettings, ChapterRule, Novel, NovelCacheMeta, PersistedSession } from '../core/types'
```

`SessionStore` 接口改成：

```ts
export interface SessionStore {
  readSettings(): AppSettings
  writeSettings(s: unknown): IpcResult<void>
  readSession(sourcePath: string): PersistedSession | null
  writeSession(s: unknown): IpcResult<void>
  clearReadingHistory(): IpcResult<void>
  migrateLegacySession(): void
  writeNovelCache(novel: Novel, chapterRule?: ChapterRule): void
  readNovelCacheEntry(filePath: string): { novel: Novel; chapterRule: ChapterRule } | null
  readNovelCache(filePath: string): Novel | null
}
```

`sessionProblem` 末尾（`return null` 之前）加：

```ts
  if (s.chapterRule !== undefined) {
    const problem = chapterRuleProblem(s.chapterRule)
    if (problem !== null) return problem
  }
```

`readSessionFile` 里 `JSON.parse` 之后、`isPersistedSession` 之前加：

```ts
    // 规则是附加信息：读盘时坏了只丢它，别把整份进度作废。
    // 写盘仍然整份拒绝（sessionProblem），两处刻意不对称。
    if (typeof parsed === 'object' && parsed !== null) {
      const raw = parsed as Record<string, unknown>
      if (raw.chapterRule !== undefined && chapterRuleProblem(raw.chapterRule) !== null) {
        console.warn('[wt] 会话里的 chapterRule 不可用，按自动识别处理：', file)
        delete raw.chapterRule
      }
    }
```

`cacheMetaProblem` 末尾（`return null` 之前）加：

```ts
  if (m.chapterRule !== undefined) {
    const problem = chapterRuleProblem(m.chapterRule)
    if (problem !== null) return `chapterRule 不合法（${problem}）`
  }
```

`writeNovelCache` 的签名与 meta 改为：

```ts
    writeNovelCache(novel: Novel, chapterRule: ChapterRule = DEFAULT_CHAPTER_RULE): void {
      try {
        ensureDir()
        const st = statSync(novel.sourcePath)
        const text = novel.flatText
        const meta: NovelCacheMeta = {
          sourcePath: novel.sourcePath,
          mtimeMs: st.mtimeMs,
          size: st.size,
          encoding: novel.encoding,
          hadBom: novel.hadBom,
          title: novel.title,
          chapters: novel.chapters,
          chapterRule,
          textBytes: Buffer.byteLength(text, 'utf8')
        }
```

`readNovelCache` 方法整体替换成一个闭包 + 两个方法。先在 `createSessionStore` 的 `return {` 之前加：

```ts
  const readNovelCacheEntry = (
    filePath: string
  ): { novel: Novel; chapterRule: ChapterRule } | null => {
    try {
      if (!existsSync(cacheMetaPath) || !existsSync(cacheTextPath)) return null
      const parsed: unknown = JSON.parse(readFileSync(cacheMetaPath, 'utf8'))
      if (!isNovelCacheMeta(parsed)) {
        console.warn(
          `[wt] 缓存元数据结构不合法（${cacheMetaProblem(parsed) ?? '未知'}），按未命中处理：`,
          cacheMetaPath
        )
        return null
      }
      const meta = parsed
      if (meta.sourcePath !== filePath) return null
      const st = statSync(filePath)
      if (st.mtimeMs !== meta.mtimeMs || st.size !== meta.size) return null
      if (statSync(cacheTextPath).size !== meta.textBytes) return null
      return {
        novel: {
          title: meta.title,
          sourcePath: meta.sourcePath,
          encoding: meta.encoding,
          hadBom: meta.hadBom,
          flatText: readFileSync(cacheTextPath, 'utf8'),
          chapters: meta.chapters
        },
        chapterRule: meta.chapterRule ?? DEFAULT_CHAPTER_RULE
      }
    } catch (err) {
      console.warn('[wt] 读取小说缓存失败，将重新读取源文件：', err)
      return null
    }
  }
```

把对象字面量里原来的 `readNovelCache(filePath: string): Novel | null { ... }` 整个方法换成：

```ts
    readNovelCacheEntry,

    readNovelCache(filePath: string): Novel | null {
      return readNovelCacheEntry(filePath)?.novel ?? null
    }
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `pnpm vitest run tests/unit/sessionStore.test.ts`

Expected: PASS（原有 60 多条用例也必须全绿）。

- [ ] **Step 6: 提交**

```bash
git add src/core/types.ts src/main/sessionStore.ts tests/unit/sessionStore.test.ts
git commit -F - <<'EOF'
feat: 会话与小说缓存记录分章规则

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
```

---

### Task 4: 按规则打开与重切的服务层

**Files:**
- Modify: `src/main/loadNovel.ts`
- Create: `src/main/novelService.ts`
- Test: `tests/unit/novelService.test.ts`

- [ ] **Step 1: 写失败的测试**

新建 `tests/unit/novelService.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore } from '../../src/main/sessionStore'
import { openNovelWithRule, resplitNovelWithRule } from '../../src/main/novelService'
import { DEFAULT_CHAPTER_RULE } from '../../src/core/types'
import type { ChapterRule, PersistedSession } from '../../src/core/types'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-service-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 自动识别只认「第一章」，特殊符号规则只认「☆、开端」——两条规则结果不同。 */
const TEXT = '☆、开端\n正文。\n第一章 甲\n正文一。\n'

function writeBook(): string {
  const p = join(dir, 'book.txt')
  writeFileSync(p, TEXT, 'utf8')
  return p
}

function writeSessionRule(
  store: ReturnType<typeof createSessionStore>,
  sourcePath: string,
  chapterRule: ChapterRule
): void {
  const s: PersistedSession = {
    novelTitle: 'book',
    sourcePath,
    ratio: 10,
    mode: 'ime',
    cursor: 0,
    revealStart: 0,
    chapterPos: [0],
    activeChapter: 0,
    startedAt: null,
    chapterRule
  }
  expect(store.writeSession(s).ok).toBe(true)
}

describe('novelService', () => {
  it('打开时按会话里记的规则切章', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    writeSessionRule(store, src, { kind: 'preset', id: 'special' })
    const novel = openNovelWithRule(store, src)
    expect(novel.chapters.map((c) => c.title)).toEqual(['☆、开端'])
    expect(novel.flatText).toBe(TEXT)
  })

  it('缓存里的规则与会话规则不一致时重切并回写', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    const auto = openNovelWithRule(store, src)
    expect(auto.chapters.map((c) => c.title)).toEqual(['前言', '第一章 甲'])

    writeSessionRule(store, src, { kind: 'preset', id: 'special' })
    const re = openNovelWithRule(store, src)
    expect(re.chapters.map((c) => c.title)).toEqual(['☆、开端'])
    expect(store.readNovelCacheEntry(src)?.chapterRule).toEqual({
      kind: 'preset',
      id: 'special'
    })
  })

  it('重分章返回新章节目录、写回缓存，正文一字不动', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    openNovelWithRule(store, src)

    const r = resplitNovelWithRule(store, src, { kind: 'preset', id: 'special' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.map((c) => c.title)).toEqual(['☆、开端'])
    expect(store.readNovelCacheEntry(src)?.novel.flatText).toBe(TEXT)
  })

  it('0 章匹配时拒绝，缓存里的规则不变', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    openNovelWithRule(store, src)

    const r = resplitNovelWithRule(store, src, { kind: 'custom', pattern: '^不存在$' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('没有识别出任何章节')
    expect(store.readNovelCacheEntry(src)?.chapterRule).toEqual(DEFAULT_CHAPTER_RULE)
  })

  it('缓存不存在时拒绝重分章，不重读源文件', () => {
    const store = createSessionStore(dir)
    const src = writeBook()
    const r = resplitNovelWithRule(store, src, { kind: 'preset', id: 'special' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('缓存')
  })
})
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm vitest run tests/unit/novelService.test.ts`

Expected: FAIL —— `Cannot find module '../../src/main/novelService'`。

- [ ] **Step 3: 给 `loadNovelFromFile` 加规则参数**

`src/main/loadNovel.ts` 顶部 import 改为：

```ts
import { DEFAULT_CHAPTER_RULE, type ChapterRule, type Novel } from '../core/types'
```

（原来那行 `import type { Novel } from '../core/types'` 删掉。）

函数签名与调用改为：

```ts
export function loadNovelFromFile(
  filePath: string,
  rule: ChapterRule = DEFAULT_CHAPTER_RULE
): Novel {
  const buf = readFileSync(filePath)
  const { text, encoding, hadBom } = decodeBuffer(buf)
  const title = basename(filePath, extname(filePath)) || '未命名'
  const { flatText, chapters } = splitChapters(text, title, rule)
  return { title, sourcePath: filePath, encoding, hadBom, flatText, chapters }
}
```

（中间那段长注释原样保留。）

- [ ] **Step 4: 新建 `src/main/novelService.ts`**

```ts
import type { IpcResult } from '../core/api'
import { chapterRuleEqual, DEFAULT_CHAPTER_RULE, hasChapterTitles, resplitChapters } from '../core/chapters'
import type { Chapter, ChapterRule, Novel } from '../core/types'
import { loadNovelFromFile } from './loadNovel'
import type { SessionStore } from './sessionStore'

/**
 * 按这本书会话里记的规则打开。
 *
 * 缓存能不能复用，判据是「缓存是按同一条规则切的」，不是「缓存存在」：
 * 只按 sourcePath/mtime/size 命中会让换过规则的书读到旧目录。
 */
export function openNovelWithRule(store: SessionStore, filePath: string): Novel {
  const rule = store.readSession(filePath)?.chapterRule ?? DEFAULT_CHAPTER_RULE
  const entry = store.readNovelCacheEntry(filePath)
  if (entry && chapterRuleEqual(entry.chapterRule, rule)) return entry.novel

  if (entry) {
    const { chapters } = resplitChapters(entry.novel.flatText, entry.novel.title, rule)
    const novel: Novel = { ...entry.novel, chapters }
    store.writeNovelCache(novel, rule)
    return novel
  }

  const novel = loadNovelFromFile(filePath, rule)
  store.writeNovelCache(novel, rule)
  return novel
}

/**
 * 按新规则重切一本已经打开过的书。
 *
 * 【缓存不存在时拒绝，而不是重读源文件】源文件与当前 flatText 可能差一个被丢掉的空白
 * 前言；重读会让章节偏移整体错位，而那种错位不会抛错。宁可让用户重新导入。
 */
export function resplitNovelWithRule(
  store: SessionStore,
  sourcePath: string,
  rule: ChapterRule
): IpcResult<Chapter[]> {
  const entry = store.readNovelCacheEntry(sourcePath)
  if (!entry) {
    return { ok: false, reason: '找不到这本书的缓存，请重新导入' }
  }
  if (!hasChapterTitles(entry.novel.flatText, rule)) {
    return { ok: false, reason: '这条规则没有识别出任何章节，目录未改动' }
  }

  const { chapters } = resplitChapters(entry.novel.flatText, entry.novel.title, rule)
  store.writeNovelCache({ ...entry.novel, chapters }, rule)
  return { ok: true, value: chapters }
}
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `pnpm vitest run tests/unit/novelService.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/main/loadNovel.ts src/main/novelService.ts tests/unit/novelService.test.ts
git commit -F - <<'EOF'
feat: 按规则打开与重切小说的服务层

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
```

---

### Task 5: 后台进程协议、IPC 与 preload

**Files:**
- Modify: `src/main/novelWorker.ts`
- Modify: `src/main/novelLoader.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/channels.ts`
- Modify: `src/core/api.ts`
- Modify: `src/preload/index.ts`
- Modify: `tests/setup.ts`
- Modify: `tests/unit/app.test.tsx`
- Test: `tests/unit/ipcContract.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/unit/ipcContract.test.ts` 的期望对象里，在 `openNovelPath` 之后加一行：

```ts
      resplitNovel: 'wt:resplit-novel',
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm vitest run tests/unit/ipcContract.test.ts`

Expected: FAIL —— 实际 `CH` 里没有 `resplitNovel`。

- [ ] **Step 3: 改 `src/main/channels.ts`**

在 `openNovelPath` 之后加：

```ts
  resplitNovel: 'wt:resplit-novel',
```

- [ ] **Step 4: 改 `src/core/api.ts`**

顶部 import 增加 `ChapterRule`：

```ts
import type { AppSettings, Chapter, ChapterRule, Novel, PersistedSession, ThemeSource } from './types'
```

在 `openNovelPath` 之后加：

```ts
  /** 按新规则重切已打开的书，返回新的章节目录；正文与进度由调用方原样保留。 */
  resplitNovel: (sourcePath: string, rule: ChapterRule) => Promise<IpcResult<Chapter[]>>
```

- [ ] **Step 5: 改 `src/preload/index.ts`**

在 `openNovelPath` 之后加：

```ts
  resplitNovel: (sourcePath: string, rule) => call<Chapter[]>(CH.resplitNovel, sourcePath, rule),
```

顶部 import 补上 `Chapter`：

```ts
import type { Chapter, Novel } from '../core/types'
```

- [ ] **Step 6: 改 `src/main/novelWorker.ts`**

整个文件替换为：

```ts
import { createSessionStore } from './sessionStore'
import { openNovelWithRule, resplitNovelWithRule } from './novelService'
import type { Chapter, ChapterRule, Novel } from '../core/types'

/**
 * 小说导入与重新分章的后台进程入口。读、解码、切章、缓存读写都在这里跑：
 * 占时间的是解码与切章，放在主进程会让其它 IPC 一起排队。
 */

type Request =
  | { type: 'open'; id: number; filePath: string; baseDir: string }
  | { type: 'resplit'; id: number; filePath: string; baseDir: string; rule: ChapterRule }

type Reply =
  | { id: number; ok: true; novel: Novel }
  | { id: number; ok: true; chapters: Chapter[] }
  | { id: number; ok: false; reason: string }

const parentPort = process.parentPort

parentPort.on('message', (event) => {
  const req = event.data as Request
  try {
    const store = createSessionStore(req.baseDir)
    if (req.type === 'resplit') {
      const result = resplitNovelWithRule(store, req.filePath, req.rule)
      const reply: Reply = result.ok
        ? { id: req.id, ok: true, chapters: result.value }
        : { id: req.id, ok: false, reason: result.reason }
      parentPort.postMessage(reply)
      return
    }
    const reply: Reply = { id: req.id, ok: true, novel: openNovelWithRule(store, req.filePath) }
    parentPort.postMessage(reply)
  } catch (err) {
    const reply: Reply = {
      id: req.id,
      ok: false,
      reason: err instanceof Error ? err.message : String(err)
    }
    parentPort.postMessage(reply)
  }
})
```

- [ ] **Step 7: 整个替换 `src/main/novelLoader.ts`**

```ts
import { app, utilityProcess } from 'electron'
import { join } from 'node:path'
import type { Chapter, ChapterRule, Novel } from '../core/types'

/**
 * 小说解码的后台进程客户端。用 utilityProcess 而不是 worker_threads：打包后
 * worker_threads 里的 require 读不到 app.asar 内的 node_modules（iconv-lite / jschardet）。
 */

/** 后台进程本身不可用（退出、启动失败）。文件读不出来的错误不走这个类型。 */
export class NovelWorkerUnavailableError extends Error {}

/** 重新分章超时：自定义正则灾难性回溯时后台进程卡死，只能杀掉重来。 */
export class NovelWorkerTimeoutError extends Error {}

type Request =
  | { type: 'open'; id: number; filePath: string; baseDir: string }
  | { type: 'resplit'; id: number; filePath: string; baseDir: string; rule: ChapterRule }

type Reply =
  | { id: number; ok: true; novel: Novel }
  | { id: number; ok: true; chapters: Chapter[] }
  | { id: number; ok: false; reason: string }

/** 9MB 样本切章约 200ms；10 秒只用来兜住正则回溯，不是性能预算。 */
const RESPLIT_TIMEOUT_MS = 10_000

interface Pending {
  resolve: (reply: Reply) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

let child: Electron.UtilityProcess | null = null
let nextId = 1
const pending = new Map<number, Pending>()

/** 常驻一个进程，不按次 fork：fork 本身要几十毫秒，常驻后每次导入只剩消息往返。 */
function ensureChild(): Electron.UtilityProcess {
  if (child) return child
  const proc = utilityProcess.fork(join(__dirname, 'novelWorker.js'), [], {
    serviceName: 'WorkingTitle 小说解码',
    stdio: 'inherit'
  })
  proc.on('message', (msg: Reply) => {
    const waiter = pending.get(msg.id)
    if (!waiter) return
    pending.delete(msg.id)
    if (waiter.timer) clearTimeout(waiter.timer)
    waiter.resolve(msg)
  })
  proc.on('exit', (code) => {
    const err = new NovelWorkerUnavailableError(`小说解码进程退出（${code}）`)
    for (const waiter of pending.values()) {
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.reject(err)
    }
    pending.clear()
    child = null
  })
  child = proc
  return proc
}

type RequestPayload =
  | { type: 'open'; filePath: string }
  | { type: 'resplit'; filePath: string; rule: ChapterRule }

function request(payload: RequestPayload, timeoutMs?: number): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer =
      timeoutMs === undefined
        ? null
        : setTimeout(() => {
            pending.delete(id)
            child?.kill()
            reject(new NovelWorkerTimeoutError(`小说后台进程超时（${timeoutMs}ms）`))
          }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    try {
      ensureChild().postMessage({ id, ...payload, baseDir: app.getPath('userData') })
    } catch (err) {
      if (timer) clearTimeout(timer)
      pending.delete(id)
      reject(new NovelWorkerUnavailableError(err instanceof Error ? err.message : String(err)))
    }
  })
}

export function openNovelInBackground(filePath: string): Promise<Novel> {
  return request({ type: 'open', filePath }).then((reply) => {
    if (reply.ok && 'novel' in reply) return reply.novel
    throw new Error(reply.ok ? '后台进程没有返回小说' : reply.reason)
  })
}

export function resplitNovelInBackground(
  sourcePath: string,
  rule: ChapterRule
): Promise<Chapter[]> {
  return request({ type: 'resplit', filePath: sourcePath, rule }, RESPLIT_TIMEOUT_MS).then(
    (reply) => {
      if (reply.ok && 'chapters' in reply) return reply.chapters
      throw new Error(reply.ok ? '后台进程没有返回章节' : reply.reason)
    }
  )
}
```

- [ ] **Step 8: 改 `src/main/ipc.ts`**

顶部 import 改为：

```ts
import { chapterRuleProblem } from '../core/chapters'
import {
  NovelWorkerTimeoutError,
  NovelWorkerUnavailableError,
  openNovelInBackground,
  resplitNovelInBackground
} from './novelLoader'
import { openNovelWithRule, resplitNovelWithRule } from './novelService'
```

并把本文件原有的 `import type { AppSettings, Novel, PersistedSession } from '../core/types'` 改成：

```ts
import type { AppSettings, Chapter, ChapterRule, Novel, PersistedSession } from '../core/types'
```

把 `openNovel` 的兜底路径改成：

```ts
  const store = getStore()
  return openNovelWithRule(store, filePath)
```

（删掉原来的 `readNovelCache` / `loadNovelFromFile` 两行。）

在 `ipcMain.handle(CH.openNovelPath, …)` 之后加：

```ts
  ipcMain.handle(
    CH.resplitNovel,
    async (_e, sourcePath: unknown, rule: unknown): Promise<IpcResult<Chapter[]>> => {
      if (typeof sourcePath !== 'string') return { ok: false, reason: '路径不是字符串' }
      const problem = chapterRuleProblem(rule)
      if (problem !== null) return { ok: false, reason: `分章规则不合法：${problem}` }
      const chapterRule = rule as ChapterRule
      try {
        return { ok: true, value: await resplitNovelInBackground(sourcePath, chapterRule) }
      } catch (err) {
        if (err instanceof NovelWorkerTimeoutError) {
          return { ok: false, reason: '规则执行超时，目录未改动' }
        }
        if (!(err instanceof NovelWorkerUnavailableError)) {
          // 预期内的失败（例如 0 章匹配）原样交给界面，不加前缀。
          return { ok: false, reason: err instanceof Error ? err.message : String(err) }
        }
        console.warn('[wt] 后台进程不可用，回退到主进程重新分章：', err)
        return resplitNovelWithRule(getStore(), sourcePath, chapterRule)
      }
    }
  )
```

`ipc.ts` 原来的 import `loadNovelFromFile` 还要留给 `loadWorkDoc`，别删。

- [ ] **Step 9: 补两个测试替身**

`tests/setup.ts` 的 `benignApi` 里加：

```ts
  resplitNovel: async () => ({ ok: false, reason: '测试桩：没有实现 resplitNovel' }),
```

`tests/unit/app.test.tsx` 的 `installApi` 对象里加：

```ts
    resplitNovel: vi.fn(async () => ({ ok: true as const, value: [] })),
```

- [ ] **Step 10: 跑测试与类型检查**

Run: `pnpm vitest run tests/unit/ipcContract.test.ts`

Expected: PASS。

Run: `pnpm typecheck`

Expected: exit 0。

- [ ] **Step 11: 提交**

```bash
git add src/main/novelWorker.ts src/main/novelLoader.ts src/main/ipc.ts src/main/channels.ts src/core/api.ts src/preload/index.ts tests/setup.ts tests/unit/app.test.tsx tests/unit/ipcContract.test.ts
git commit -F - <<'EOF'
feat: 重新分章的后台进程与 IPC 通道

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
```

---

### Task 6: App 接线：读回规则、应用规则、会话携带规则

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Ribbon.tsx`
- Modify: `src/renderer/src/components/SettingsDialog.tsx`（只加 prop 声明与解构，界面在 Task 7）
- Test: `tests/unit/app.test.tsx`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/app.test.tsx` 的 `describe('导入一本读过的书')` 之后追加：

```ts
describe('分章规则随书保存', () => {
  it('打开书时读回会话里的规则，打字后落盘的会话带着它', async () => {
    const novel = makeNovel()
    const session: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: novel.sourcePath,
      ratio: 10,
      mode: 'ime',
      cursor: 0,
      revealStart: 0,
      chapterPos: [0, 0],
      activeChapter: 0,
      startedAt: null,
      chapterRule: { kind: 'preset', id: 'numbered' }
    }
    installApi(novel, session)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    const capture = screen.getByTestId('input-capture')
    fireEvent.input(capture, { target: { value: 'x' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved!.chapterRule).toEqual({ kind: 'preset', id: 'numbered' })
  })
})
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm vitest run tests/unit/app.test.tsx -t '分章规则随书保存'`

Expected: FAIL —— `saved.chapterRule` 为 undefined。

- [ ] **Step 3: 改 `src/renderer/src/App.tsx`**

顶部 import 补上：

```ts
import { DEFAULT_CHAPTER_RULE, type ChapterRule } from '../../core/types'
import type { IpcResult } from '../../core/api'
```

（原来 `import { clampPageFontSize } from '../../core/types'` 与 `import type { InputMode, Novel } from '../../core/types'` 可以合并，也可以各留一行。）

状态区（`const [novel, setNovel] = useState...` 附近）加：

```ts
  const [chapterRule, setChapterRule] = useState<ChapterRule>(DEFAULT_CHAPTER_RULE)
  const chapterRuleRef = useRef<ChapterRule>(DEFAULT_CHAPTER_RULE)
  chapterRuleRef.current = chapterRule
```

`flushSession` 里那一句改成：

```ts
    void api.saveSession({ ...current.toSession(), chapterRule: chapterRuleRef.current }).then((r) => {
```

`openNovel` 里拿到 session 之后加：

```ts
      setChapterRule(session?.chapterRule ?? DEFAULT_CHAPTER_RULE)
```

会话防抖保存那一句改成：

```ts
      void api.saveSession({ ...engine.toSession(), chapterRule: chapterRuleRef.current }).then((r) => {
```

`handleClearSession` 里 `setEngine(null)` 之后加：

```ts
    setChapterRule(DEFAULT_CHAPTER_RULE)
    chapterRuleRef.current = DEFAULT_CHAPTER_RULE
```

在 `handleClearSession` 之后加应用规则的处理器：

```ts
  const handleApplyChapterRule = useCallback(
    async (rule: ChapterRule): Promise<IpcResult<number>> => {
      const api = getApi()
      const currentNovel = novel
      const currentEngine = engine
      if (!api || !currentNovel || !currentEngine) {
        return { ok: false, reason: '还没有导入小说' }
      }

      const result = await api.resplitNovel(currentNovel.sourcePath, rule)
      if (!result.ok) return result
      // 等待期间换了书：这次结果不能套到新书上（章节目录与书对不上）。
      if (novelEngineRef.current !== currentEngine) {
        return { ok: false, reason: '书已更换，本次分章未应用' }
      }

      const chapters = result.value
      const snap = currentEngine.toSession()
      // 光标之前的章算读完、当前章按比例、之后为 0——只由光标一条线决定。
      const chapterPos = chapters.map((c) =>
        Math.max(0, Math.min(snap.cursor - c.start, c.charCount))
      )
      const nextNovel: Novel = { ...currentNovel, chapters }
      const nextEngine = TypingEngine.fromSession(nextNovel, {
        ...snap,
        chapterPos,
        activeChapter: 0,
        chapterRule: rule
      })

      setNovel(nextNovel)
      setEngine(nextEngine)
      setChapterRule(rule)
      chapterRuleRef.current = rule

      const savedSession = await api.saveSession({
        ...nextEngine.toSession(),
        chapterRule: rule
      })
      if (!savedSession.ok) notify(`保存分章规则失败：${savedSession.reason}`)
      return { ok: true, value: chapters.length }
    },
    [novel, engine, notify]
  )
```

`Ribbon` 的调用处加四个 prop：

```tsx
          novelTitle={novel?.title ?? null}
          chapterCount={novel?.chapters.length ?? 0}
          chapterRule={chapterRule}
          onApplyChapterRule={handleApplyChapterRule}
```

- [ ] **Step 4: 改 `src/renderer/src/components/Ribbon.tsx`**

顶部 import 补上：

```ts
import { DEFAULT_CHAPTER_RULE, type ChapterRule } from '../../../core/types'
import type { IpcResult } from '../../../core/api'
```

在 `ignoreNumberChange` 之后加：

```ts
const ignoreApplyChapterRule = async (): Promise<IpcResult<number>> => ({
  ok: false,
  reason: '没有可用的分章功能'
})
```

参数表（`onRemoveWorkDoc = ignoreAction` 之后）加：

```ts
  novelTitle = null,
  chapterCount = 0,
  chapterRule = DEFAULT_CHAPTER_RULE,
  onApplyChapterRule = ignoreApplyChapterRule,
```

类型声明（`onRemoveWorkDoc?: () => void` 之后）加：

```ts
  /** 当前小说名；null＝没导入小说（分章页据此禁用）。 */
  novelTitle?: string | null
  chapterCount?: number
  chapterRule?: ChapterRule
  onApplyChapterRule?: (rule: ChapterRule) => Promise<IpcResult<number>>
```

`<SettingsDialog …>` 里加：

```tsx
        novelTitle={novelTitle}
        chapterCount={chapterCount}
        chapterRule={chapterRule}
        onApplyChapterRule={onApplyChapterRule}
```

- [ ] **Step 5: 改 `src/renderer/src/components/SettingsDialog.tsx` 的 prop 声明**

顶部 import 补上两个类型：

```ts
import type { ChapterRule } from '../../../core/types'
import type { IpcResult } from '../../../core/api'
```

（`CHAPTER_PRESETS` / `chapterRuleProblem` 与 `ChapterPresetId` 到 Task 7 做界面时再加。）

`SettingsDialogProps` 末尾加：

```ts
  /** 当前小说名；null＝没导入小说。 */
  novelTitle: string | null
  chapterCount: number
  chapterRule: ChapterRule
  onApplyChapterRule: (rule: ChapterRule) => Promise<IpcResult<number>>
```

函数参数解构末尾加：

```ts
  novelTitle,
  chapterCount,
  chapterRule,
  onApplyChapterRule
```

- [ ] **Step 6: 跑测试，确认通过**

Run: `pnpm vitest run tests/unit/app.test.tsx -t '分章规则随书保存'`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/Ribbon.tsx src/renderer/src/components/SettingsDialog.tsx tests/unit/app.test.tsx
git commit -F - <<'EOF'
feat: 分章规则的渲染层状态与会话持久化

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
```

---

### Task 7: 设置里的「分章设置」页

**Files:**
- Modify: `src/renderer/src/components/SettingsDialog.tsx`
- Modify: `src/renderer/src/styles/ribbon.css`
- Test: `tests/unit/settings.test.tsx`
- Test: `tests/unit/app.test.tsx`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/settings.test.tsx` 顶部 import 补上 `waitFor` 与类型：

```ts
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import type { ChapterRule } from '../../src/core/types'
```

在 `SetupOptions` 里补：

```ts
  novelTitle?: string | null
  chapterCount?: number
  chapterRule?: ChapterRule
  onApplyChapterRule?: (rule: ChapterRule) => Promise<
    { ok: true; value: number } | { ok: false; reason: string }
  >
```

在 `setup()` 的解构里补（**必须解构，否则会被 `...provider` 悄悄带进 ToolbarProvider**）：

```ts
    novelTitle = '测试书',
    chapterCount = 12,
    chapterRule = { kind: 'auto' },
    onApplyChapterRule = vi.fn(async () => ({ ok: true as const, value: 12 })),
```

在 `<Ribbon …>` 上补：

```tsx
          novelTitle={novelTitle}
          chapterCount={chapterCount}
          chapterRule={chapterRule}
          onApplyChapterRule={onApplyChapterRule}
```

在文件末尾追加：

```ts
describe('设置里的分章规则', () => {
  function openChapters(): void {
    openViaButton()
    fireEvent.click(screen.getByTestId('settings-tab-chapters'))
  }

  it('新增「分章设置」页，没有小说时禁用并提示', () => {
    setup({ novelTitle: null })
    openChapters()
    expect((screen.getByTestId('settings-tabpanel-chapters') as HTMLElement).hidden).toBe(false)
    expect((screen.getByTestId('chapter-rule-apply') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('chapter-current').textContent).toContain('未导入')
  })

  it('顶部显示当前小说与章数', () => {
    setup({ novelTitle: '测试书', chapterCount: 12 })
    openChapters()
    expect(screen.getByTestId('chapter-current').textContent).toContain('测试书')
    expect(screen.getByTestId('chapter-current').textContent).toContain('12')
  })

  it('打开时选中这本书当前保存的规则', () => {
    setup({ chapterRule: { kind: 'preset', id: 'numbered' } })
    openChapters()
    expect((screen.getByTestId('chapter-rule-preset-numbered') as HTMLInputElement).checked).toBe(true)
  })

  it('选中自定义正则后出现输入框；非法正则时应用按钮禁用', () => {
    setup()
    openChapters()
    fireEvent.click(screen.getByTestId('chapter-rule-custom'))
    const input = screen.getByTestId('chapter-rule-pattern') as HTMLInputElement
    fireEvent.change(input, { target: { value: '(' } })
    expect(screen.getByTestId('chapter-rule-error')).toBeTruthy()
    expect((screen.getByTestId('chapter-rule-apply') as HTMLButtonElement).disabled).toBe(true)
  })

  it('应用预置规则：回调收到规则并显示新章数', async () => {
    const onApplyChapterRule = vi.fn(async () => ({ ok: true as const, value: 42 }))
    setup({ onApplyChapterRule })
    openChapters()
    fireEvent.click(screen.getByTestId('chapter-rule-preset-numbered'))
    fireEvent.click(screen.getByTestId('chapter-rule-apply'))
    await waitFor(() =>
      expect(screen.getByTestId('chapter-rule-result').textContent).toContain('42')
    )
    expect(onApplyChapterRule).toHaveBeenCalledWith({ kind: 'preset', id: 'numbered' })
  })

  it('应用失败时显示失败原因', async () => {
    const onApplyChapterRule = vi.fn(async () => ({
      ok: false as const,
      reason: '没有识别出任何章节，目录未改动'
    }))
    setup({ onApplyChapterRule })
    openChapters()
    fireEvent.click(screen.getByTestId('chapter-rule-apply'))
    await waitFor(() =>
      expect(screen.getByTestId('chapter-rule-result').textContent).toContain('没有识别出任何章节')
    )
  })
})
```

在 `tests/unit/app.test.tsx` 的 `describe('分章规则随书保存')` 里补上清除那条用例（Task 6 删掉的那条），再追加应用规则那条：

```ts
  it('清除阅读记录后规则回到自动识别', async () => {
    const novel = makeNovel()
    const session: PersistedSession = {
      novelTitle: '测试书',
      sourcePath: novel.sourcePath,
      ratio: 10,
      mode: 'ime',
      cursor: 0,
      revealStart: 0,
      chapterPos: [0, 0],
      activeChapter: 0,
      startedAt: null,
      chapterRule: { kind: 'preset', id: 'numbered' }
    }
    installApi(novel, session)
    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    openSettings()
    fireEvent.click(screen.getByTestId('btn-clear-session'))
    await waitFor(() => expect(screen.getByTestId('page-empty')).toBeTruthy())
    openSettings()
    fireEvent.click(screen.getByTestId('settings-tab-chapters'))
    expect((screen.getByTestId('chapter-rule-auto') as HTMLInputElement).checked).toBe(true)
  })

  it('在设置里应用规则：光标与已显示正文不动，章节目录换成新的', async () => {
    const novel = makeNovel()
    installApi(novel)
    const chapters = [
      { index: 0, title: 'A', start: 0, end: 10, charCount: 10 },
      { index: 1, title: 'B', start: 10, end: 20, charCount: 10 },
      { index: 2, title: 'C', start: 20, end: novel.flatText.length, charCount: novel.flatText.length - 20 }
    ]
    ;(window.api as unknown as { resplitNovel: unknown }).resplitNovel = vi.fn(async () => ({
      ok: true as const,
      value: chapters
    }))

    render(<App />)
    importViaSettings()
    await waitFor(() => expect(screen.getByTestId('chapter-item-0')).toBeTruthy())

    // 先打一个字：光标 10，阅读区显示前 10 个字
    fireEvent.input(screen.getByTestId('input-capture'), { target: { value: 'x' } })
    await waitFor(() => expect(revealedChars()).toBe(10))

    openSettings()
    fireEvent.click(screen.getByTestId('settings-tab-chapters'))
    fireEvent.click(screen.getByTestId('chapter-rule-preset-numbered'))
    fireEvent.click(screen.getByTestId('chapter-rule-apply'))

    await waitFor(() => expect(screen.getByTestId('chapter-item-2')).toBeTruthy())
    expect(revealedChars()).toBe(10)
    expect((window.api.resplitNovel as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe(
      novel.sourcePath
    )
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved!.chapterRule).toEqual({ kind: 'preset', id: 'numbered' })
    expect(saved!.chapterPos).toHaveLength(3)
  })
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm vitest run tests/unit/settings.test.tsx -t '分章规则'`

Expected: FAIL —— `settings-tab-chapters` 不存在。

- [ ] **Step 3: 在 `SettingsDialog.tsx` 里加页签与面板**

import 补上：

```ts
import {
  CHAPTER_PRESETS,
  chapterRuleProblem
} from '../../../core/chapters'
import type { ChapterPresetId, ChapterRule } from '../../../core/types'
import type { IpcResult } from '../../../core/api'
import { IconToc } from './icons'
```

`PAGES` 加一行：

```ts
  { id: 'chapters', label: '分章设置', icon: IconToc },
```

页面状态（`const [page, setPage] = useState...` 附近）加：

```ts
  const [chapterDraft, setChapterDraft] = useState<ChapterRule>(chapterRule)
  const [customPattern, setCustomPattern] = useState(
    chapterRule.kind === 'custom' ? chapterRule.pattern : ''
  )
  const [applying, setApplying] = useState(false)
  const [chapterResult, setChapterResult] = useState<string | null>(null)
```

打开时重置（扩展现有的 `if (open !== wasOpen)` 块）：

```ts
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setPage('reading')
      setChapterDraft(chapterRule)
      setCustomPattern(chapterRule.kind === 'custom' ? chapterRule.pattern : '')
      setApplying(false)
      setChapterResult(null)
    }
  }
```

在 `handleNavKeyDown` 之后加应用逻辑：

```ts
  const chapterChoice: 'auto' | ChapterPresetId | 'custom' =
    chapterDraft.kind === 'auto'
      ? 'auto'
      : chapterDraft.kind === 'preset'
        ? chapterDraft.id
        : 'custom'
  const customProblem = chapterDraft.kind === 'custom' ? chapterRuleProblem(chapterDraft) : null
  const canApplyChapter = novelTitle !== null && !applying && customProblem === null

  const handleApplyChapter = async (): Promise<void> => {
    setApplying(true)
    setChapterResult(null)
    const result = await onApplyChapterRule(chapterDraft)
    setApplying(false)
    setChapterResult(result.ok ? `已重新分为 ${result.value} 章` : result.reason)
  }
```

在三个面板之后（`shortcuts` 面板的 `</div>` 之后）加新面板：

```tsx
            <div
              className="wt-tabpanel"
              role="tabpanel"
              id="wt-tabpanel-chapters"
              aria-labelledby="wt-tab-chapters"
              data-testid="settings-tabpanel-chapters"
              hidden={page !== 'chapters'}
            >
              <div className="wt-modal__row">
                <span className="wt-modal__label">
                  <IconToc className="wt-modal__label-icon" />
                  当前小说
                </span>
                <span data-testid="chapter-current">
                  {novelTitle === null
                    ? '未导入小说（先到「阅读设置」导入）'
                    : `${novelTitle} · 共 ${chapterCount} 章`}
                </span>
              </div>

              <div className="wt-modal__row">
                <span className="wt-modal__label">识别规则</span>
                <div className="wt-chapter-rules" role="radiogroup" aria-label="章节识别规则">
                  <label className="wt-modal__check">
                    <input
                      type="radio"
                      name="chapter-rule"
                      data-testid="chapter-rule-auto"
                      checked={chapterChoice === 'auto'}
                      disabled={novelTitle === null}
                      onChange={() => setChapterDraft({ kind: 'auto' })}
                    />
                    自动识别（默认）
                  </label>
                  {(Object.keys(CHAPTER_PRESETS) as ChapterPresetId[]).map((id) => (
                    <label className="wt-modal__check" key={id}>
                      <input
                        type="radio"
                        name="chapter-rule"
                        data-testid={`chapter-rule-preset-${id}`}
                        checked={chapterChoice === id}
                        disabled={novelTitle === null}
                        onChange={() => setChapterDraft({ kind: 'preset', id })}
                      />
                      {CHAPTER_PRESETS[id]}
                    </label>
                  ))}
                  <label className="wt-modal__check">
                    <input
                      type="radio"
                      name="chapter-rule"
                      data-testid="chapter-rule-custom"
                      checked={chapterChoice === 'custom'}
                      disabled={novelTitle === null}
                      onChange={() => setChapterDraft({ kind: 'custom', pattern: customPattern })}
                    />
                    自定义正则
                  </label>

                  {chapterChoice === 'custom' && (
                    <>
                      <input
                        className="wt-modal__text"
                        data-testid="chapter-rule-pattern"
                        aria-label="自定义章节标题正则"
                        placeholder="^第.+章.*$"
                        value={customPattern}
                        disabled={novelTitle === null}
                        onChange={(e) => {
                          setCustomPattern(e.target.value)
                          setChapterDraft({ kind: 'custom', pattern: e.target.value })
                        }}
                      />
                      <span className="wt-ratio__note">
                        按每个整行匹配（忽略首尾空白），不区分大小写；建议用 ^ 和 $ 包住整行。
                      </span>
                      {customPattern !== '' && customProblem !== null && (
                        <span className="wt-chapter-rules__error" data-testid="chapter-rule-error">
                          这条正则不合法
                        </span>
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    className="wt-btn wt-btn--primary"
                    data-testid="chapter-rule-apply"
                    disabled={!canApplyChapter}
                    onClick={() => void handleApplyChapter()}
                  >
                    {applying ? '处理中…' : '应用'}
                  </button>

                  {chapterResult !== null && (
                    <span className="wt-ratio__note" data-testid="chapter-rule-result" role="status">
                      {chapterResult}
                    </span>
                  )}
                </div>
              </div>
            </div>
```

- [ ] **Step 4: 加 CSS**

在 `src/renderer/src/styles/ribbon.css` 的 `.wt-modal__check input` 规则之后加：

```css
.wt-chapter-rules {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.wt-chapter-rules__error {
  font-size: 11px;
  color: var(--wt-danger);
}
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `pnpm vitest run tests/unit/settings.test.tsx -t '分章规则'`

Expected: PASS。

Run: `pnpm vitest run tests/unit/app.test.tsx -t '分章规则随书保存'`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/SettingsDialog.tsx src/renderer/src/styles/ribbon.css tests/unit/settings.test.tsx tests/unit/app.test.tsx
git commit -F - <<'EOF'
feat: 设置里新增分章设置页

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
```

---

### Task 8: 文档与总门禁

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 英文 README 的 Usage 加一条**

在 `README.md` 的 Usage 第 4 条之后、`Settings persist across restarts…` 之前加：

```markdown
5. **Fix chapter splitting** — if a novel's chapters are detected wrong, open Settings →
   **Chapter splitting**, pick a built-in rule or write your own regular expression, and press
   **Apply**. The rule is remembered per book, and your reading position and the text itself do
   not change.
```

- [ ] **Step 2: 中文 README 同步加一条**

在 `README.zh-CN.md` 的 Usage 第 4 条之后加：

```markdown
5. **分章不对时** —— 打开设置 →「分章设置」，选一条预置规则或自己写正则，点「应用」。
   规则按书记住；正文与阅读进度都不动。
```

- [ ] **Step 3: `CLAUDE.md` 的持久化表补字段**

只改表格该行**第二格**（「是什么」那一列），第三格（「关键点」）与表格其余行原样保留。

`sessions/<sha256 前 32 hex>.json` 那行的第二格替换为：

```markdown
**每本书一份**的进度与**分章规则** `chapterRule`（缺字段＝自动识别，旧会话照常有效）
```

`novel-cache.json` + `novel-cache.txt` 那行的第二格替换为：

```markdown
解码后的目录与正文，目录上记着是按哪条规则切的
```

- [ ] **Step 4: 跑完整门禁**

Run: `pnpm typecheck`

Expected: exit 0。

Run: `pnpm test`

Expected: exit 0（**看退出码，不只看摘要行**）。

Run: `pnpm build`

Expected: exit 0。

- [ ] **Step 5: 提交**

```bash
git add README.md README.zh-CN.md CLAUDE.md
git commit -F - <<'EOF'
docs: 补充分章设置的使用说明

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
```

---

## 完成后的验收（由用户执行）

1. `pnpm dev`，导入一本章节识别不对的 txt。
2. 设置 →「分章设置」→ 选一条预置规则或写正则 →「应用」。
3. 确认：左侧章节目录当场变化；当前读到的位置与正文没有任何跳动；重启应用后仍是新目录。
4. 选回「自动识别」再应用，目录回到最初导入时的样子。
5. 故意写一条 0 匹配的正则：应提示「没有识别出任何章节，目录未改动」，原目录不动。
