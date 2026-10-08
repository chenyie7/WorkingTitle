import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { loadNovelFromFile } from '../../src/main/loadNovel'

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-load-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const ZH = '第一章 风起\n\n林昭站在城墙上。\n第二章 云涌\n\n城下列阵三日。\n'

describe('loadNovelFromFile', () => {
  it('读取 UTF-8 小说并切出章节，title 取文件名', () => {
    const p = join(dir, '我的小说.txt')
    writeFileSync(p, ZH, 'utf8')
    const novel = loadNovelFromFile(p)
    expect(novel.title).toBe('我的小说')
    expect(novel.sourcePath).toBe(p)
    expect(novel.encoding).toBe('UTF-8')
    expect(novel.chapters).toHaveLength(2)
    expect(novel.chapters[0].start).toBe(0)
    expect(novel.chapters[1].end).toBe(novel.flatText.length)
  })

  it('读取 GBK 小说也能正确还原中文', () => {
    const p = join(dir, 'gbk小说.txt')
    writeFileSync(p, iconv.encode(ZH, 'gbk'))
    const novel = loadNovelFromFile(p)
    expect(novel.flatText).toContain('林昭站在城墙上')
    expect(novel.encoding).not.toBe('UTF-8')
  })

  // 管线级用例（decode → 归一化 → splitChapters）：flatText 是 cursor / revealStart /
  // chapterPos 的坐标系，Task 4 拿它算、Task 5 把它持久化，所以它必须与用户导入的那份
  // 文本逐字一致。期望值在这里手写，不用实现里的 normalizeNewlines——两个操作数同源的话，
  // 实现错了两边会一起错、断言照样打印「相等」。
  it('CRLF 源文件：flatText 与归一化后的原文逐字相等', () => {
    const raw = '第一章 风起\r\n\r\n林昭站在城墙上。\r\n第二章 云涌\r\n\r\n城下列阵三日。\r\n'
    const p = join(dir, 'crlf.txt')
    writeFileSync(p, Buffer.from(raw, 'utf8'))
    // 前提：这份源文件真的是 CRLF，否则本用例在测一个并不存在的场景
    expect(readFileSync(p, 'utf8')).toContain('\r\n')

    const novel = loadNovelFromFile(p)
    expect(novel.chapters).toHaveLength(2)
    expect(novel.flatText).toBe(
      '第一章 风起\n\n林昭站在城墙上。\n第二章 云涌\n\n城下列阵三日。\n'
    )
    expect(novel.flatText).not.toContain('\r')
  })

  // 【钉住「必须先归一化」的是这一条，不是上面那条】单独 \r（旧 Mac 换行）的文本里一个
  // \n 都没有，splitChapters 按 '\n' 切行会得到「整份文件就是一行」，章节结构塌成单章。
  // 实测 2 章的 CR-only 文本直接切只得 1 章。所以去掉 decodeBuffer 的归一化，
  // 这里会红（上面那条 CRLF 用例不会——实测 raw CRLF 与归一化后的切分结论逐例相同）。
  it('CR-only 源文件：先归一化才切得出多章', () => {
    const raw = '第一章 风起\r林昭站在城墙上。\r第二章 云涌\r城下列阵三日。\r'
    const p = join(dir, 'cronly.txt')
    writeFileSync(p, Buffer.from(raw, 'utf8'))
    // 前提：一个 \n 都没有，否则「不归一化就会塌成单章」的前提不成立
    expect(readFileSync(p, 'utf8')).not.toContain('\n')

    const novel = loadNovelFromFile(p)
    expect(novel.chapters).toHaveLength(2)
    expect(novel.flatText).toBe('第一章 风起\n林昭站在城墙上。\n第二章 云涌\n城下列阵三日。\n')
  })
})
