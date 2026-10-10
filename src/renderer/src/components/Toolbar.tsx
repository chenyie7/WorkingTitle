import type { FluentIcon } from '@fluentui/react-icons'
import { useToolbar } from '../state/ToolbarContext'
import { IconSettings } from './icons'

/**
 * 工具栏里能出现的三种东西。
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
 */
export type ToolbarItem =
  | { kind: 'toggle'; id: string; label: string; title: string; icon?: FluentIcon; large?: boolean }
  | { kind: 'placeholder'; id: string; label: string; title: string; icon?: FluentIcon; large?: boolean }
  | { kind: 'settings'; large?: boolean }

export interface ToolbarGroup {
  label: string
  items: ToolbarItem[]
}

export function Toolbar({
  groups,
  onOpenSettings
}: {
  groups: ToolbarGroup[]
  onOpenSettings: () => void
}) {
  const { toggles, toggle, notify } = useToolbar()

  return (
    <div className="wt-toolbar" data-testid="toolbar">
      {groups.map((group) => (
        <div className="wt-group" key={group.label}>
          <div className="wt-group__body">
            {group.items.map((item) => {
              if (item.kind === 'settings') {
                return (
                  <button
                    key="settings"
                    type="button"
                    className={`wt-btn${item.large ? ' wt-btn--large' : ''}`}
                    data-testid="btn-settings"
                    title="设置 (⌘/Ctrl + ,)"
                    onClick={onOpenSettings}
                  >
                    <IconSettings className="wt-btn__icon" />
                    <span className="wt-btn__label">设置</span>
                  </button>
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
            })}
          </div>
          <div className="wt-group__label">{group.label}</div>
        </div>
      ))}
    </div>
  )
}
