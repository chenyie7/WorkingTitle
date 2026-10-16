import type { Chapter, InputMode, Novel, PersistedSession } from './types'
import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO } from './types'

export interface EngineState {
  /** 下一个要被抽出来的字符下标；**阅读位置**的唯一指针——注意不是全部状态的唯一指针，
   * chapterPos 是独立的持久化状态，cursor 反推不出它（jumpToChapter 要读它） */
  cursor: number
  /** 当前显示窗口的起点 */
  revealStart: number
  /**
   * 每章「上次离开该章时，光标停在该章内的偏移」（章内相对偏移）。
   *
   * 两点别读错：对**当前章**而言它就是此刻的偏移（不是「上次」）；而被整章越过的章
   * 会被直接写成 `charCount`——那些章从未「停留」过。
   *
   * 刻意是 `readonly`：`getSnapshot()` 直接把内部状态交出去（`useSyncExternalStore`
   * 要求同一状态返回同一引用，不能每次渲染新建副本），于是这个数组同时也是
   * `commit` 要改的那个数组。`readonly` 让 Task 9/10/12 的消费者在**编译期**就
   * 无法把 `snap.chapterPos[i]` 写坏——那是唯一能无声破坏本项目核心不变量
   * （阅读区恒等于 `flatText.slice(revealStart, cursor)`）却既无类型错误、
   * 也无测试发现的路径。运行时由 `Object.freeze` 兜住（见 `freezeState`）。
   */
  chapterPos: readonly number[]
  activeChapter: number
  ratio: number
  mode: InputMode
  startedAt: number | null
}

/**
 * 两条策略，刻意不同，别当成不一致：
 *   · **非有限输入**（NaN / ±Infinity）→ `DEFAULT_RATIO`。这类值不是「太大」而是**不可用**
 *     （多半来自算错或缺失的输入），丢掉它比钳到上限更诚实。
 *   · **有限但越界** → 钳到 `[MIN_RATIO, MAX_RATIO]`。用户拖滑块拖到头是合法意图。
 * 实测：clampRatio(Infinity) === 10 而 clampRatio(9999) === 500；两条都有断言钉住。
 */
export function clampRatio(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RATIO
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, Math.round(n)))
}

/**
 * 冻结状态对象**和**它的 `chapterPos` 数组——两个都要冻，只冻外层等于没冻
 * （`state.chapterPos[0] = x` 照样写得进去）。
 *
 * 就地冻结并返回同一个引用，不复制：调用点全都在构造新对象，没有共享可变数组。
 *
 * 三个必须写下来的注意点：
 * 1. **浅冻结**。只冻这一层；将来若给 `EngineState` 加嵌套对象或数组字段，
 *    那个字段得自己冻，`Object.freeze` 不会替它做。
 * 2. **越界写的表现取决于模式**：渲染进程的打包产物是严格模式，写入抛
 *    `TypeError`；非严格模式下被静默丢弃。两种情况下引擎自身都完好——
 *    这正是要冻结的目的：坏的是调用方，不是状态。
 * 3. **不影响 IPC**。冻结对象的结构化克隆（structured clone）正常，
 *    所以 `toSession()` 的返回值照旧能过进程间通信。
 */
function freezeState(state: EngineState): Readonly<EngineState> {
  Object.freeze(state.chapterPos)
  return Object.freeze(state)
}

export class TypingEngine {
  private readonly _novel: Novel
  private _state: Readonly<EngineState>
  private readonly _listeners = new Set<() => void>()

  constructor(novel: Novel, init?: { ratio?: number; mode?: InputMode }) {
    this._novel = novel
    this._state = freezeState({
      cursor: 0,
      revealStart: 0,
      chapterPos: novel.chapters.map(() => 0),
      activeChapter: 0,
      ratio: clampRatio(init?.ratio ?? DEFAULT_RATIO),
      mode: init?.mode ?? 'ime',
      startedAt: null
    })
  }

  get novel(): Novel {
    return this._novel
  }

  /** 阅读区唯一的内容来源 */
  get visibleText(): string {
    const { revealStart, cursor } = this._state
    return this._novel.flatText.slice(revealStart, cursor)
  }

  /**
   * 返回**同一个引用**直到状态真的变化——`useSyncExternalStore` 每次渲染都调用它，
   * 并用 `Object.is` 比对；每次新建副本会让 React 认为每帧都在变，直接触发
   * 「The result of getSnapshot should be cached to avoid an infinite loop」。
   * 所以这里【不能】用防御性拷贝，只能靠 `freezeState` 保证交出去的状态不可改。
   */
  getSnapshot(): EngineState {
    return this._state
  }

  subscribe(fn: () => void): () => void {
    this._listeners.add(fn)
    return () => {
      this._listeners.delete(fn)
    }
  }

  /**
   * 通知所有订阅者。
   *
   * 【订阅者抛异常会中断整个循环，后面的订阅者收不到这次通知】——这是刻意的，与
   * React 的 store 契约一致（渲染函数的异常应当冒泡，而不是被吞掉）。别把它「加固」
   * 成 try/catch 吞异常：那会把渲染错误变成静默的状态不同步。
   */
  private emit(): void {
    for (const fn of this._listeners) fn()
  }

  /**
   * 二分查找 pos 落在哪一章；pos === 长度时取最后一章。
   *
   * `chapters.length === 0` 那一行经 splitChapters 不可达（空文本也会产出 1 章），
   * 它**正是** commit 里 `if (current)` 存在的唯一理由——两处是一件事，
   * 要删就一起删，别只删一个（只删守卫，空章节目录会让 `chapters[idx]` 变成 undefined 解引用）。
   */
  private chapterIndexOf(pos: number): number {
    const chapters = this._novel.chapters
    if (chapters.length === 0) return 0
    if (pos >= this._novel.flatText.length) return chapters.length - 1
    let lo = 0
    let hi = chapters.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (chapters[mid].start <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /**
   * 统一收尾规则：把中间被整章越过的章节标记为已读完，再把 chapterPos[新章]
   * 同步为章内偏移。
   *
   * 【调用者只有 pump、backspace 与 revealTo——jumpToChapter 刻意不走这里】（见各方法自己的注释）。
   * 「统一收尾规则」这条名字容易读成「任何游标变化之后都执行」，那不是事实，
   * 也不是笔误：跳章要的是「点了哪章就高亮哪章」，与本方法算出来的 activeChapter
   * 在目标章已读完时并不一致。
   */
  private commit(nextCursor: number): void {
    const chapters = this._novel.chapters
    const total = this._novel.flatText.length
    // 下夹 0 是【不可达的防守】，别把它当成 commit 的一般性范围闸：pump 有 k > 0 闸
    // 且 ratio ≥ 1、backspace 以 revealStart(≥ 0) 为下界、revealTo 同样以 revealStart(≥ 0) 为下界、
    // jump 至少是 chapter.start、fromSession 夹到 ≥ 0——差分实测 0/5200 有差异。真正承重的是 Math.min 那半边：
    // 「游标不越过正文末尾」全靠它（去掉它，末尾钳制立刻失守）。
    const cursor = Math.max(0, Math.min(nextCursor, total))
    const idx = this.chapterIndexOf(cursor)
    const chapterPos = this._state.chapterPos.slice()

    const prev = this._state.activeChapter
    if (idx > prev) {
      for (let i = prev; i < idx; i++) chapterPos[i] = chapters[i].charCount
    }
    const current = chapters[idx]
    if (current) chapterPos[idx] = cursor - current.start

    this._state = freezeState({ ...this._state, cursor, activeChapter: idx, chapterPos })
    this.emit()
  }

  /**
   * 输入 k 个字，抽出 k × ratio 个字符。
   *
   * 【这个 `k > 0` 闸是承重的，不要照 backspace 的样子删掉】：它是**唯一**维持
   * `revealStart ≤ cursor` 的东西——`commit` 只把游标夹到 `[0, total]`，
   * **从不夹到 revealStart**。实测：去掉它，一次 `pump(-5)` 就把游标退到窗口起点之前
   * （15 → 10，而 revealStart 是 12），阅读区从此永久空白。
   * 与之相对，backspace 的 `k > 0` 闸只是契约性的（见那里）。两者看着对称，作用不同。
   */
  pump(k: number, now: number = Date.now()): void {
    if (!(k > 0)) return
    const total = this._novel.flatText.length
    if (this._state.cursor >= total) return
    if (this._state.startedAt === null) {
      this._state = freezeState({ ...this._state, startedAt: now })
    }
    this.commit(this._state.cursor + k * this._state.ratio)
  }

  /**
   * 退格 k 次，回吐 k × ratio 个字符；小说内容不变。
   *
   * 这里的 `k > 0` 闸【只守契约、不守不变量】：下面那行 `Math.max(revealStart, …)`
   * 对 k 的任何符号都保得住 `revealStart ≤ cursor`（k 为负时 `cursor - k*ratio` 更大，
   * 仍被 revealStart 托住）。所以这个闸的作用是「负数不当成前进」——若哪天被绕过，
   * `k = -1` 的效果是**向前跳**（`cursor - (-1 × ratio)` 变大），而不是无操作。
   * 与 pump 那个闸不同（那个承重），但也别删：Task 11 只会用 k ≥ 1，这是给调用方的契约。
   */
  backspace(k: number): void {
    if (!(k > 0)) return
    const next = Math.max(this._state.revealStart, this._state.cursor - k * this._state.ratio)
    if (next === this._state.cursor) return
    this.commit(next)
  }

  /**
   * 把阅读光标直接设到 `n`，夹紧到 `[revealStart, total]`。**可增可减。**
   *
   * 老板键的「铺满」用它：切到工作文档时一次把设定好的那些字铺出来；按 +/- 调铺满量时又用它
   * 重铺。**对外的方法里只有它收的是绝对位置**——`pump` / `backspace` 收的是「走多少步」的
   * 相对量（还要乘上可变的 `ratio`），`jumpToChapter` 收的是章号、目标由 `chapterPos[i]` 决定。
   * 「铺到第 N 字」这种说法只能落到它身上。
   *
   * 【为什么走 commit 而不是自己改 `_state.cursor`】`commit` 是「统一收尾规则」的唯一实现：
   * 它会补上被整章越过的那些章，并把 `chapterPos[新章]` 同步成章内偏移。绕开它自己设游标，
   * 跳章后的侧栏高亮与 `chapterPos` 就会与游标脱节——而那种脱节不会抛错，只会表现为
   * 「进度莫名其妙不对」。
   *
   * 【下界为什么是 revealStart 而不是 0】与 `backspace` 同一个理由：阅读区显示的是
   * `flatText.slice(revealStart, cursor)`，游标退到窗口起点之前，阅读区就永久空白了。
   *
   * 【非有限值必须在这里挡掉】`Math.min(NaN, total)` 与 `Math.max(revealStart, NaN)` 都返回
   * NaN，一路传进 commit 之后游标就是 NaN——`visibleText` 变空串、状态栏百分比变 NaN%，
   * 而且**再也恢复不了**（此后每一次 pump 都在 NaN 上算）。这不是理论风险：调用方拿的是
   * 「设置文件里的一个数字」。
   */
  revealTo(n: number): void {
    if (!Number.isFinite(n)) return
    // 游标是字符下标，收成整数再夹——否则 3.7 会透传进 toSession 与 slice
    const target = Math.round(n)
    const next = Math.max(this._state.revealStart, Math.min(target, this._novel.flatText.length))
    if (next === this._state.cursor) return
    this.commit(next)
  }

  /**
   * 跳转到第 i 章，并回填该章上次的阅读进度。
   *
   * 【本方法刻意不走 commit（统一收尾规则）】，而是直接写 activeChapter = i。
   * 理由是「点了哪章就高亮哪章」：用户点第 i 章，左侧列表必须高亮第 i 章。
   * 若改用 commit 的算法（activeChapter = chapterIndexOf(cursor)），当第 i 章
   * 已经整章读完时 chapterPos[i] === charCount，游标正好落在**下一章**的开头，
   * 于是高亮的是下一章——用户点了 A、列表高亮 B。下一键打字会由 commit 自动
   * 纠正回 cursor 所在章，那是打字推进的正常语义，不是这次点击的语义。
   * （变异实测：把这里改成 chapterIndexOf(cursor) 全套用例全绿，
   * 所以两种语义都「没人守」；本注释与 spec §2 是唯一把选择钉下来的地方。）
   */
  jumpToChapter(i: number): void {
    const chapters = this._novel.chapters
    if (!Number.isInteger(i) || i < 0 || i >= chapters.length) return
    const chapter = chapters[i]
    const raw = chapter.start + (this._state.chapterPos[i] ?? 0)
    const cursor = Math.max(chapter.start, Math.min(raw, chapter.end))

    // 这一行【保留，不要为了「让 jumpToChapter 更精简」删掉】：它是本方法内的**本地保证**
    // ——跳转之后 chapterPos[i] 一定与刚算出的 cursor 一致，与 chapterPos 当初从哪来无关。
    // 删掉它，跳章的这份一致性就得依赖三个方法之外的某次夹紧（fromSession 那条），
    // 而那正是本任务里 important-1 的成因形状：把保证挪到看不见的地方，用简洁换掉它。
    const chapterPos = this._state.chapterPos.slice()
    chapterPos[i] = cursor - chapter.start

    this._state = freezeState({
      ...this._state,
      revealStart: chapter.start,
      cursor,
      activeChapter: i,
      chapterPos
    })
    this.emit()
  }

  setRatio(n: number): void {
    const ratio = clampRatio(n)
    if (ratio === this._state.ratio) return
    this._state = freezeState({ ...this._state, ratio })
    this.emit()
  }

  setMode(mode: InputMode): void {
    // 与 fromSession 同一套归一：非法值落到 'ime'。此前只有恢复时会校验，构造器与
    // 这里都不校验，于是 `toSession → fromSession` 对非法 mode 不是恒等
    // （存进去 'garbage'、读回来 'ime'）。加上这一行，往返对 mode 才是恒等的。
    const next = mode === 'key' ? 'key' : 'ime'
    if (next === this._state.mode) return
    this._state = freezeState({ ...this._state, mode: next })
    this.emit()
  }

  toSession(): PersistedSession {
    const s = this._state
    return {
      novelTitle: this._novel.title,
      sourcePath: this._novel.sourcePath,
      ratio: s.ratio,
      mode: s.mode,
      cursor: s.cursor,
      revealStart: s.revealStart,
      chapterPos: s.chapterPos.slice(),
      activeChapter: s.activeChapter,
      startedAt: s.startedAt
    }
  }

  /**
   * 从磁盘上的会话恢复。
   *
   * 最后一步必须自己跑一遍「收尾」——把 `chapterPos[activeChapter]` 对齐成
   * `cursor - chapters[activeChapter].start`——不能指望打字来修。原因有两层：
   *
   * 1. 会话里的 `chapterPos` 与**当前**的章节目录未必同源。Task 12 只按
   *    `sourcePath` 匹配会话，用户在同路径上改了小说就会拿到一份描述着
   *    「已经不存在的章节目录」的 chapterPos；而 Task 5 的缓存闸让这更常见，
   *    因为改过的文件必然 cache miss，而 cache miss 正是重建章节目录、
   *    把陈旧会话套到新目录上的那一刻。
   * 2. 即便不修，`pump` 的末尾闸（`cursor >= total` 即返回）会让它**永远修不好**：
   *    在末尾时 pump 直接返回、根本不 commit，而 commit 恰恰是唯一会重算
   *    `chapterPos[active]` 的地方。实测：cursor=48/48 的会话被恢复后，
   *    chapterPos[3] 停在 0，再 pump 仍是 0。于是「上次读到全书结尾」的用户
   *    看到一个永远是 0% 的进度条，打字也救不回来。
   *
   * 这个写入是**无条件**的：只要 cursor 落在某一章上就写，绝不写成「看起来不一致才修」
   * ——那种条件判断本身会成为第二条需要单独测试的规则，而且恰恰会在它判断失误的输入上
   * 悄悄保留这个 bug。对格式良好的会话它是无操作（chapterPos[activeChapter] 本来
   * 就等于该差值，包括 jumpToChapter 造成的 activeChapter ≠ cursor 所在章那种状态）。
   *
   * 它**不**碰 activeChapter：那一项照旧由 cursor 反推。信任会话里存着的
   * activeChapter 是另一个变异——陈旧或手改的会话会让侧栏高亮与 cursor 完全无关，
   * 那是被现有用例正确抓住的。
   */
  static fromSession(novel: Novel, s: PersistedSession): TypingEngine {
    const engine = new TypingEngine(novel, { ratio: s.ratio, mode: s.mode })
    const total = novel.flatText.length

    const chapterPos = novel.chapters.map((c, i) => {
      const v = s.chapterPos?.[i]
      if (typeof v !== 'number' || !Number.isFinite(v)) return 0
      return Math.max(0, Math.min(v, c.charCount))
    })

    const cursor = Math.max(0, Math.min(Number.isFinite(s.cursor) ? s.cursor : 0, total))
    const revealStart = Math.max(0, Math.min(Number.isFinite(s.revealStart) ? s.revealStart : 0, cursor))

    // 建 → 夹 → 修 → 冻结：写入必须排在冻结之前（见下一条提交加上 Object.freeze 后，
    // 顺序就承重了——冻结之后再写，严格模式下直接抛 TypeError）。
    const activeChapter = engine.chapterIndexOf(cursor)
    const current = novel.chapters[activeChapter]
    if (current) chapterPos[activeChapter] = cursor - current.start

    engine._state = freezeState({
      cursor,
      revealStart,
      chapterPos,
      activeChapter,
      ratio: clampRatio(s.ratio),
      mode: s.mode === 'key' ? 'key' : 'ime',
      // Number.isFinite 挡的是 NaN / Infinity。JSON.parse 产不出这两个值，
      // 所以这条【不算】对「磁盘数据畸形」的防护，只是把类型收窄到 number | null。
      startedAt: typeof s.startedAt === 'number' && Number.isFinite(s.startedAt) ? s.startedAt : null
    })
    return engine
  }
}
