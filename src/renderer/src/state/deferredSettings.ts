import { useCallback, useRef, useState } from 'react'

/**
 * 「手动保存」的那一组设置项：草稿留在这里，生效在点「保存」那一刻。
 *
 * 【为什么要单独一个模块】设置项将来会变多，而「哪些项要手动保存」这件事应该是一张表，
 * 不是散在 JSX 里的几个 useState。加一项的成本是往表里加一行：不用碰「有没有改动」的
 * 算法、不用碰保存按钮的显隐、也不用碰对话框的关闭语义（草稿本来就是对话框的局部状态，
 * 一关就丢）。
 *
 * 【为什么草稿统一是字符串】这些项在界面上都是输入框，而输入框里本来就是字符串；
 * 归一化（去空白、夹紧）与解析各自在 `normalize` / `commit` 里做。统一成字符串省掉了
 * 「草稿的类型跟着字段走」那一层泛型，代价只是比例在提交时 `Number(...)` 一下。
 */
export interface DeferredField {
  /** 也是 data-testid 的一部分：输入框就叫 `${id}-input` */
  id: string
  /** 已经生效的值（字符串形式）。「有没有改动」是拿草稿跟它比出来的 */
  committed: string
  /**
   * 失焦时把草稿归一化——**不提交**。归一化只是让框里显示的东西合法
   * （去掉两侧空白、把超出范围的比例夹回区间）。
   *
   * 第二个参数是当前的 `committed`：归一化不出合法值时要退回它，而不是留下一个空的或
   * NaN 的草稿——那种草稿会让「保存」按钮一直亮着，而点下去什么都不提交（用户会以为坏了）。
   */
  normalize: (raw: string, committed: string) => string
  /** 点「保存」时才调用；只对**有改动**的项调 */
  commit: (value: string) => void
}

export interface DeferredSettings {
  /** 各字段的当前草稿，键是 `id` */
  drafts: Record<string, string>
  setDraft: (id: string, raw: string) => void
  /** 失焦：归一化这一项，返回归一化后的值（调用方据此决定要不要给提示） */
  blur: (id: string) => string
  /** 有没有未保存的改动 */
  dirty: boolean
  /** 提交所有有改动的项 */
  save: () => void
  /** 把草稿全部拉回已提交值（打开对话框时用） */
  reset: () => void
}

export function useDeferredSettings(fields: DeferredField[]): DeferredSettings {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.id, f.committed]))
  )

  /**
   * 表挂在一个 ref 上，让 `blur` / `save` / `reset` 的身份不随每次渲染变。
   *
   * 【为什么不能直接用 `fields`】那张表每次渲染都是新数组（它闭包着 `docTitle` / `ratio`），
   * 于是这三个回调每次渲染都换身份；而对话框里 `useEffect(…, [open, reset])` 要靠 `reset`
   * 的稳定身份才只在「打开」那一下跑——身份一变就成了每次渲染都重置草稿，用户打一个字就被
   * 拉回去。渲染期写 ref 是本仓库既有的写法（`App.tsx` 的 `novelEngineRef.current = engine`）。
   */
  const fieldsRef = useRef(fields)
  fieldsRef.current = fields

  const setDraft = useCallback((id: string, raw: string): void => {
    setDrafts((prev) => ({ ...prev, [id]: raw }))
  }, [])

  const blur = useCallback((id: string): string => {
    const field = fieldsRef.current.find((f) => f.id === id)
    if (!field) return ''
    const normalized = field.normalize(drafts[id] ?? field.committed, field.committed)
    setDrafts((prev) => ({ ...prev, [id]: normalized }))
    return normalized
  }, [drafts])

  const dirty = fields.some((f) => (drafts[f.id] ?? f.committed) !== f.committed)

  const save = useCallback((): void => {
    const normalized: Record<string, string> = { ...drafts }
    for (const f of fieldsRef.current) {
      // 【提交前先归一化，不能直接提交草稿】草稿是框里的原文，而失焦不是必经之路：
      // 在框里直接按回车（Enter＝保存）时它根本没被归一化过——两侧空白、空名、超范围的
      // 比例都会原样漏进已提交值里。点保存按钮的情况同理（浏览器会先失焦，但那是巧合，
      // 不是这里能依赖的性质）。
      const value = f.normalize(drafts[f.id] ?? f.committed, f.committed)
      normalized[f.id] = value
      if (value !== f.committed) f.commit(value)
    }
    // 草稿也要跟着归一化：否则框里留着原文、已提交值是归一化后的，两者一比永远算「有改动」，
    // 保存按钮点完还亮着。注意这里写的是**归一化后的值**而不是「拉回 committed」——
    // 后者会在 commit 被拒时把用户刚打的字吃掉，看起来像按钮坏了。
    setDrafts(normalized)
  }, [drafts])

  const reset = useCallback((): void => {
    setDrafts(Object.fromEntries(fieldsRef.current.map((f) => [f.id, f.committed])))
  }, [])

  return { drafts, setDraft, blur, dirty, save, reset }
}
