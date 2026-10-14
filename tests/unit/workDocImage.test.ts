import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadWorkDocImage, IMAGE_MAX_BYTES } from '../../src/main/workDocImage'

/** 一张最小的合法 PNG（1×1 透明）。用真字节，别用字符串假装。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

let dir: string | null = null
async function scratch(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'wt-img-'))
  return dir
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = null
  vi.unstubAllGlobals()
})

describe('loadWorkDocImage —— 本地', () => {
  it('相对路径按基准目录解析，产出 data: URL', async () => {
    const base = await scratch()
    await writeFile(join(base, 'a.png'), PNG)
    const out = await loadWorkDocImage('a.png', base)
    expect(out).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
  })

  it('绝对路径直接用', async () => {
    const base = await scratch()
    const full = join(base, 'b.png')
    await writeFile(full, PNG)
    expect(await loadWorkDocImage(full, '/完全无关的目录')).toBe(
      `data:image/png;base64,${PNG.toString('base64')}`
    )
  })

  it('文件不存在返回 null', async () => {
    expect(await loadWorkDocImage('没有这个.png', await scratch())).toBeNull()
  })

  it('不是图片扩展名一律不读', async () => {
    const base = await scratch()
    await writeFile(join(base, 'x.txt'), '内容')
    await writeFile(join(base, 'noext'), PNG)
    expect(await loadWorkDocImage('x.txt', base)).toBeNull()
    expect(await loadWorkDocImage('noext', base)).toBeNull()
  })

  it('超过大小上限返回 null', async () => {
    const base = await scratch()
    await writeFile(join(base, 'big.png'), Buffer.alloc(IMAGE_MAX_BYTES + 1))
    expect(await loadWorkDocImage('big.png', base)).toBeNull()
  })

  it('本来就是 data: URL 的原样交回', async () => {
    const inline = `data:image/png;base64,${PNG.toString('base64')}`
    expect(await loadWorkDocImage(inline, '/x')).toBe(inline)
  })
})

describe('loadWorkDocImage —— 网络', () => {
  function stubFetch(impl: () => Promise<Response> | Response): void {
    vi.stubGlobal('fetch', vi.fn(impl))
  }

  it('取回来转成 data: URL', async () => {
    stubFetch(
      () =>
        new Response(PNG, { headers: { 'content-type': 'image/png', 'content-length': String(PNG.length) } })
    )
    expect(await loadWorkDocImage('https://example.com/a.png', '/x')).toBe(
      `data:image/png;base64,${PNG.toString('base64')}`
    )
  })

  it('content-type 不是 image/* 的拒掉', async () => {
    stubFetch(() => new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }))
    expect(await loadWorkDocImage('https://example.com/a.json', '/x')).toBeNull()
  })

  it('HTTP 状态不是 2xx 的拒掉', async () => {
    stubFetch(() => new Response('', { status: 404 }))
    expect(await loadWorkDocImage('https://example.com/a.png', '/x')).toBeNull()
  })

  it('抛异常（超时、DNS 失败）时返回 null，不冒出去', async () => {
    stubFetch(() => Promise.reject(new Error('timeout')))
    expect(await loadWorkDocImage('https://example.com/a.png', '/x')).toBeNull()
  })

  it('声明的大小超上限就不读了', async () => {
    stubFetch(
      () =>
        new Response(PNG, {
          headers: { 'content-type': 'image/png', 'content-length': String(IMAGE_MAX_BYTES + 1) }
        })
    )
    expect(await loadWorkDocImage('https://example.com/big.png', '/x')).toBeNull()
  })
})
