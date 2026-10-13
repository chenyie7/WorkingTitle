/**
 * 老板键的「铺满量」：把「一页」折算成多少字，以及那个百分比的夹紧与步进。
 *
 * 【为什么单开一个模块】它是纯计算，与引擎、设置、界面都无关。塞进 `types.ts` 会让那个
 * 文件继续长下去，塞进 `engine.ts` 会把「怎么显示」混进「抽字的规则」——而 `engine.ts`
 * 是全项目唯一那条核心不变量的所在地，那里每多一个概念都要多想一次。
 */

/** 铺满百分比的取值范围，单位是「一页的百分之几」。 */
export const BOSS_FILL_MIN = 0
export const BOSS_FILL_MAX = 100
/** 两条增减快捷键每按一次的步进。 */
export const BOSS_FILL_STEP = 10

/**
 * 一页约多少字。
 *
 * 推导（对着 `src/renderer/src/styles/page.css` 的 `.wt-page` 算）：
 *   纸张宽 794px，左右 padding 各 84px → 正文宽 626px；
 *   字号 15px → 每行约 626 / 15 ≈ 41.7 字；
 *   纸张 min-height 1080px，上下 padding 72 / 96px → 正文区 912px；
 *   行高 1.9 × 15px = 28.5px → 32 行；
 *   32 × 41.7 ≈ 1334，取 1330 —— 恰好铺满一整张纸（72 + 912 + 96 = 1080，纸不会长高）。
 *
 * 【它量的是「一页」，不是「一屏」——这两个数差得不小】可见区比一页矮：`.wt-canvas`
 * 的可见高度实测 667px，减掉它自己的上下 padding（28 / 56）只剩约 583px ≈ 20.5 行 ≈ 855 字。
 * 所以 100% 时纸的上边沿在视野之外，画面是一整窗连续的字——那正是老板键要的样子，像
 * 「你正在一份文档中间」，而不是「光标正好停在页首」。想让纸的上边沿露出来，往 60% 以下调。
 *
 * 【它是约数，不是测量值】字号、纸张尺寸、行高任何一个改了它都会失准；中英混排时的实际
 * 行宽也与 41.7 有出入。校准它的手段是老板键铺满那两条 +/- 快捷键，**不是改这个常量**。
 *
 * 性质与 `RENDER_WINDOW_LIMIT` 同类：一个写在 core 里的经验常量。
 */
export const CHARS_PER_SHEET = 1330

export function clampBossFillPercent(n: number): number {
  // 【非有限值落到满页，而不是 0】它来自「设置文件被改坏 / 字段缺失」。落到 0 那个退化
  // 边界的话，老板键切过去是一片空白——那正是这个功能要避免的画面。与 `clampRatio` 对
  // NaN 的处理同一姿态：不可用的输入给一个「能用」的默认值。
  if (!Number.isFinite(n)) return BOSS_FILL_MAX
  return Math.max(BOSS_FILL_MIN, Math.min(BOSS_FILL_MAX, Math.round(n)))
}

/** 步进一档。**两端夹住、不循环**——按到头再按没有反应，而不是跳回另一端。 */
export function stepBossFill(current: number, dir: 1 | -1): number {
  return clampBossFillPercent(current + dir * BOSS_FILL_STEP)
}

/** 百分比 → 该铺多少字，喂给 `TypingEngine.revealTo`。 */
export function fillCharsFor(percent: number): number {
  return Math.round((CHARS_PER_SHEET * clampBossFillPercent(percent)) / 100)
}
