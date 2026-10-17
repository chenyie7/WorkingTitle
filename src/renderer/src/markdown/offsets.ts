/**
 * 逐行偏移的换算（设计 3.6.1）。解析、裁剪、渲染三处**共用这一份**，不要各写一份循环。
 *
 * 【换行归谁】行 k 末尾那个换行属于行 k：源码偏移是 `src + len`，`value` 下标是
 * `base + len`；下一行从两者各 +1 起算。
 */

/** 摊平后的一行：它在 `value` 里的下标、内容长度（不含行尾换行）、源码起点。 */
export interface ValueLine {
  readonly base: number
  readonly len: number
  readonly src: number
}

/**
 * 把 `value` 摊成行。`starts` 是逐行表（可缺省）；缺的行按「上一行源码起点 + 行长 + 换行」推。
 * 行数由 `value` 定，不由表长定——裁剪后 `value` 可能比表多一个空行。
 */
export function linesOf(
  value: string,
  starts: readonly number[] | null,
  origin: number
): ValueLine[] {
  const out: ValueLine[] = []
  let base = 0
  for (;;) {
    const nl = value.indexOf('\n', base)
    const len = (nl < 0 ? value.length : nl) - base
    const prev = out[out.length - 1]
    const src = starts?.[out.length] ?? (prev ? prev.src + prev.len + 1 : origin)
    out.push({ base, len, src })
    if (nl < 0) break
    base = nl + 1
  }
  return out
}

/** 这张逐行表能不能由「起点 + 字符数」直接推出；能推出就不必挂。 */
export function isContiguous(starts: readonly number[], base: number, value: string): boolean {
  const lines = linesOf(value, starts, base)
  return starts.every((s, i) => i < lines.length && s === base + lines[i].base)
}

/** 按行求交的结果：已揭示文字在 `value` 里的起止下标，以及已揭示那几行的行起点。 */
export interface ValueWindow {
  readonly head: number
  readonly tail: number
  readonly starts: number[]
}

/** 行内是 +1 线性的，行与行之间差的是被剥掉的行前缀宽度，所以窗口两侧都要按行求交。 */
export function sliceValueByLines(
  value: string,
  starts: readonly number[],
  from: number,
  to: number
): ValueWindow {
  const lines = linesOf(value, starts, 0)
  let head = -1
  let tail = -1
  const revealed: number[] = []
  for (const line of lines) {
    const hasNewline = line.base + line.len < value.length
    const stop = line.src + line.len + (hasNewline ? 1 : 0)
    const lo = Math.max(from, line.src)
    const hi = Math.min(to, stop)
    if (lo >= hi) continue
    if (head < 0) head = line.base + lo - line.src
    tail = line.base + hi - line.src
    revealed.push(lo)
  }
  return head < 0 ? { head: 0, tail: 0, starts: [] } : { head, tail, starts: revealed }
}
