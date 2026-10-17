/**
 * mdast 节点的元数据，以**节点对象本身**为键（类型见本文件，不往第三方 AST 上挂字符串字段）。
 *
 * 【裁剪会造新对象】`clip.ts` 克隆节点后要 `copyMeta` 过去，否则元数据静默丢失。
 * 【读口一律走这里的函数】裸读字段会绕过「不是有限数算没有」这一步。
 */
interface NodeMeta {
  valueStart?: number
  lineStarts?: readonly number[]
  blankLines?: number
  blankRows?: number
}

const store = new WeakMap<object, NodeMeta>()

function metaOf(node: object): NodeMeta {
  const hit = store.get(node)
  if (hit) return hit
  const fresh: NodeMeta = {}
  store.set(node, fresh)
  return fresh
}

function readMeta(node: unknown): NodeMeta | null {
  return typeof node === 'object' && node !== null ? (store.get(node) ?? null) : null
}

/** `value` 的第一个字符在源码里的偏移。 */
export function setValueStart(node: object, start: number): void {
  metaOf(node).valueStart = start
}

export function valueStartOf(node: unknown): number | null {
  const raw = readMeta(node)?.valueStart
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/** 每个 `value` 行的首字符在源码里的偏移。传 `null` 摘表。 */
export function setLineStarts(node: object, starts: readonly number[] | null): void {
  const meta = metaOf(node)
  if (starts === null) delete meta.lineStarts
  else meta.lineStarts = [...starts]
}

export function lineStartsOf(node: unknown): readonly number[] | null {
  const raw = readMeta(node)?.lineStarts
  if (!Array.isArray(raw) || !raw.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null
  }
  return raw
}

/** 未揭示的占位：`lines` 是代码块剩余行数，`rows` 是表格剩余行数。 */
export type BlankKind = 'lines' | 'rows'

export function setBlankCount(node: object, kind: BlankKind, count: number): void {
  const meta = metaOf(node)
  if (kind === 'lines') meta.blankLines = count
  else meta.blankRows = count
}

export function blankCountOf(node: unknown, kind: BlankKind): number {
  const meta = readMeta(node)
  const raw = kind === 'lines' ? meta?.blankLines : meta?.blankRows
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

/** 克隆节点时把元数据整份带过去，之后的字段再各自覆盖。 */
export function copyMeta(from: object, to: object): void {
  const meta = store.get(from)
  if (meta) store.set(to, { ...meta })
}
