import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { FluentIcon } from '@fluentui/react-icons'
import { useToolbar } from '../state/ToolbarContext'
import { useAnchoredPanel } from './useAnchoredPanel'
import { IconSettings, IconCaretDown } from './icons'

/**
 * 工具栏里能出现的东西。
 *
 * 【`ratio` / `mode` / `import` / `clear-session` 四种 kind 已经不在这里了】它们渲染的是
 * 应用的真实功能，现在统一由 `SettingsDialog` 渲染（那四种控件连同各自的 testid 一起搬了
 * 过去）。工具栏只留一个 `settings` kind：一个打开对话框的按钮。
 *
 * 【`icon` 可选是有意的】功能区里不是每样东西都有合适的图标——Word 自己的「样式」库就是
 * 一组文字预览（`AaBbCc` + 样式名），不是图标。没有 `icon` 的项退回去渲染 `label` 文字。
 *
 * 【`large` 对应 Word 功能区的两种尺寸】大按钮是「图标在上、标签在下」（新建/保存/导入这类），
 * 小按钮是纯图标（加粗/对齐那一排）。真 Word 就是这么混着排的，全用小按钮会显得空、全用大的
 * 又放不下。
 *
 * 【六种 kind 的来源】`toggle` / `placeholder` / `settings` 是最初三种。补「开始/插入/布局」
 * 三页时发现光靠按钮做不像 Word：字体名、字号、行距在真 Word 里是**下拉框**，「样式」是
 * 带预览的**库**，「下划线」右侧还有一个**展开箭头**。于是加了 `combo` / `gallery` / `split`。
 * 三者都只做外观与「选中态」，点开后的真实功能一律走 `notify` 的占位提示——它们不是真功能。
 */
export type ToolbarItem =
  | { kind: 'toggle'; id: string; label: string; title: string; icon?: FluentIcon; large?: boolean }
  | {
      kind: 'placeholder'
      id: string
      label: string
      title: string
      icon?: FluentIcon
      large?: boolean
    }
  | { kind: 'settings'; large?: boolean }
  /** 下拉框（字体名 / 字号 / 行距）。`width` 用来对齐真 Word 里那几栏宽窄不一的观感。 */
  | { kind: 'combo'; id: string; title: string; options: readonly string[]; width?: number }
  /** 带预览的样式库。每一项都画成 `AaBbCc` + 样式名。 */
  | { kind: 'gallery'; id: string; title: string; entries: readonly string[] }
  /** 主按钮 + 右侧展开箭头（下划线 / 项目符号 / 编号）。主按钮是 toggle，箭头只弹提示。 */
  | { kind: 'split'; id: string; label: string; title: string; icon: FluentIcon }

export interface ToolbarGroup {
  label: string
  items: ToolbarItem[]
}

/**
 * 下拉框。
 *
 * 【为什么不用原生 `<select>` —— 这是本组件最要紧的一条】全应用的按键都落在
 * `InputCapture` 那个透明 textarea 上（按键处理挂在**它**的 onKeyDown 上，不是 window）。
 * 而 `focusIfNotTextInput` 的豁免名单里**有 `select`**——那是给设置对话框里的输入框用的。
 * 于是原生 `<select>` 一点下去焦点就留在它身上，之后敲键盘**既不打字也不抽字**，
 * 整个应用等于废了。做成 `<button>` + 一列 `<button>` 就不在豁免名单里：`mousedown` 时
 * 焦点会被自动抢回 textarea，与工具栏里其它按钮走的是同一条路径。
 *
 * 【为什么面板要 portal 到 body】`.wt-toolbar` 有 `overflow-x: auto`（窄窗口时横向滚动）。
 * 按 CSS 规则，一个轴不是 visible 时另一个轴也会变成 auto，于是绝对定位的面板会被**裁掉**。
 * portal 到 body 再用 `position: fixed` 就完全跳出了那个裁剪上下文。
 *
 * 【面板里不接键盘】不做输入过滤、不接 Esc。按键要继续去抽字，面板只认鼠标：
 * 选中一项、或点到面板外面，就关。真 Word 的字体框能打字过滤，这里刻意不做。
 */
function Combo({
  id,
  title,
  options,
  width
}: {
  id: string
  title: string
  options: readonly string[]
  width?: number
}) {
  const { choices, choose } = useToolbar()
  const { anchorRef, open, pos, toggle, close } = useAnchoredPanel<HTMLButtonElement>()
  const value = choices[id] ?? options[0]

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="wt-combo"
        data-testid={`combo-${id}`}
        title={title}
        aria-label={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={width === undefined ? undefined : { width }}
        onClick={toggle}
      >
        <span className="wt-combo__value">{value}</span>
        <IconCaretDown className="wt-combo__caret" />
      </button>
      {open && pos
        ? createPortal(
            <div
              className="wt-combo__panel"
              data-wt-popup
              role="listbox"
              aria-label={title}
              data-testid={`combo-${id}-panel`}
              style={{ left: pos.left, top: pos.top, minWidth: Math.max(pos.width, 96) }}
            >
              {options.map((o) => (
                <button
                  key={o}
                  type="button"
                  role="option"
                  aria-selected={o === value}
                  className={`wt-combo__option${o === value ? ' wt-combo__option--active' : ''}`}
                  onClick={() => {
                    choose(id, o)
                    close()
                  }}
                >
                  {o}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

const VISIBLE_COUNT = 4

/**
 * 样式库。真 Word 的「样式」组就是几个白色小方块，每块里是 `AaBbCc` 加样式名。
 *
 * 【只露四项 + 展开面板】1280px 下排不下七项，面板里给全量。选中项落在后端时，
 * 把最后一项替成选中项，否则「当前用的是哪个样式」在界面上看不见。
 */
function Gallery({
  id,
  title,
  entries
}: {
  id: string
  title: string
  entries: readonly string[]
}) {
  const { choices, choose } = useToolbar()
  const { anchorRef, open, pos, toggle, close } = useAnchoredPanel<HTMLButtonElement>()
  const value = choices[id] ?? entries[0]
  const activeIndex = entries.indexOf(value)
  const visibleEntries =
    activeIndex >= VISIBLE_COUNT
      ? [...entries.slice(0, VISIBLE_COUNT - 1), entries[activeIndex]]
      : entries.slice(0, VISIBLE_COUNT)
  const hiddenActive = activeIndex >= VISIBLE_COUNT

  return (
    <div className="wt-gallery" role="group" aria-label={title} data-testid={`gallery-${id}`}>
      {visibleEntries.map((name) => {
        const active = name === value
        return (
          <button
            key={name}
            type="button"
            className={`wt-gallery__item${active ? ' wt-gallery__item--active' : ''}`}
            data-testid={`gallery-${id}-${name}`}
            aria-pressed={active}
            title={`${title}：${name}`}
            onClick={() => choose(id, name)}
          >
            <span className="wt-gallery__preview" aria-hidden="true">
              AaBbCc
            </span>
            <span className="wt-gallery__name">{name}</span>
          </button>
        )
      })}
      <button
        ref={anchorRef}
        type="button"
        className={`wt-gallery__more${hiddenActive ? ' wt-gallery__more--active' : ''}`}
        data-testid={`gallery-${id}-more`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${title}（更多）`}
        title={`${title}（更多）`}
        onClick={toggle}
      >
        <IconCaretDown className="wt-gallery__more-icon" />
      </button>
      {open && pos
        ? createPortal(
            <div
              className="wt-combo__panel wt-gallery__panel"
              data-wt-popup
              role="listbox"
              aria-label={title}
              data-testid={`gallery-${id}-panel`}
              style={{ left: pos.left, top: pos.top }}
            >
              {entries.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={name === value}
                  className={`wt-combo__option${name === value ? ' wt-combo__option--active' : ''}`}
                  data-testid={`gallery-${id}-option-${name}`}
                  onClick={() => {
                    choose(id, name)
                    close()
                  }}
                >
                  {name}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

/**
 * 主按钮 + 右侧展开箭头。真 Word 的「下划线」「项目符号」「编号」都是这个形状：
 * 点主体是直接应用，点箭头是展开更多选择。
 *
 * 箭头只弹占位提示——本应用没有「更多选择」那套东西，为它造一个空菜单反而更像没做完。
 */
function SplitButton({
  id,
  label,
  title,
  icon: Icon
}: {
  id: string
  label: string
  title: string
  icon: FluentIcon
}) {
  const { toggles, toggle, notify } = useToolbar()
  const active = Boolean(toggles[id])

  return (
    <div className="wt-split" data-testid={`split-${id}`}>
      <button
        type="button"
        className={`wt-btn wt-btn--icon-only wt-split__main${active ? ' wt-btn--active' : ''}`}
        data-testid={`btn-${id}`}
        title={title}
        aria-label={title}
        aria-pressed={active}
        onClick={() => toggle(id)}
      >
        <Icon filled={active} className="wt-btn__icon" />
        <span className="wt-btn__label">{label}</span>
      </button>
      <button
        type="button"
        className="wt-split__arrow"
        data-testid={`split-${id}-more`}
        title={`${title}（更多）`}
        aria-label={`${title}（更多）`}
        onClick={() => notify('演示占位功能，未实现')}
      >
        <IconCaretDown className="wt-split__caret" />
      </button>
    </div>
  )
}

export function Toolbar({
  groups,
  onOpenSettings,
  settingsShortcut
}: {
  groups: ToolbarGroup[]
  onOpenSettings: () => void
  /**
   * 「设置」按钮的 title 里显示的快捷键。**已按平台格式化**（`formatShortcut` 的成品），
   * 因为「打开设置」那条快捷键可配置，写死一句「⌘/Ctrl + ,」在用户改过键之后就是错的。
   */
  settingsShortcut: string
}) {
  const { toggles, toggle, notify } = useToolbar()

  /**
   * 渲染一个控件。抽成函数只是因为它在两处被调用（组内、以及下面那份兜底）——
   * 组内的两行排布是 CSS 的事，与这里无关，见 `ribbon.css` 的 `.wt-group__body`。
   */
  const renderItem = (item: ToolbarItem): ReactNode => {
    if (item.kind === 'settings') {
      return (
        <button
          key="settings"
          type="button"
          className={`wt-btn${item.large ? ' wt-btn--large' : ''}`}
          data-testid="btn-settings"
          title={`设置 (${settingsShortcut})`}
          onClick={onOpenSettings}
        >
          <IconSettings className="wt-btn__icon" />
          <span className="wt-btn__label">设置</span>
        </button>
      )
    }

    if (item.kind === 'combo') {
      return (
        <Combo
          key={item.id}
          id={item.id}
          title={item.title}
          options={item.options}
          width={item.width}
        />
      )
    }

    if (item.kind === 'gallery') {
      return <Gallery key={item.id} id={item.id} title={item.title} entries={item.entries} />
    }

    if (item.kind === 'split') {
      return (
        <SplitButton
          key={item.id}
          id={item.id}
          label={item.label}
          title={item.title}
          icon={item.icon}
        />
      )
    }

    const active = Boolean(toggles[item.id])
    const Icon = item.icon
    // 有图标、又不是大按钮 → 只显示图标（Word 的 B/I/U 那一排就没有可见文字）。
    // 标签仍渲染在 DOM 里但被 CSS 藏起来，`aria-label` 保证读屏拿得到名字。
    const iconOnly = Boolean(Icon) && !item.large
    return (
      <button
        key={item.id}
        type="button"
        className={`wt-btn${item.large ? ' wt-btn--large' : ''}${iconOnly ? ' wt-btn--icon-only' : ''}${active ? ' wt-btn--active' : ''}`}
        data-testid={`btn-${item.id}`}
        title={item.title}
        aria-label={iconOnly ? item.title : undefined}
        aria-pressed={item.kind === 'toggle' ? active : undefined}
        onClick={() => {
          if (item.kind === 'toggle') toggle(item.id)
          else notify('演示占位功能，未实现')
        }}
      >
        {/* filled 切换线框/实心，就是 Word 切换按钮的语义（见 icons.tsx 的说明） */}
        {Icon ? <Icon filled={active} className="wt-btn__icon" /> : null}
        <span className="wt-btn__label">{item.label}</span>
      </button>
    )
  }

  return (
    <div className="wt-toolbar" data-testid="toolbar">
      {groups.map((group) => (
        <div className="wt-group" key={group.label}>
          <div className="wt-group__body">{group.items.map(renderItem)}</div>
          <div className="wt-group__label">{group.label}</div>
        </div>
      ))}
    </div>
  )
}
