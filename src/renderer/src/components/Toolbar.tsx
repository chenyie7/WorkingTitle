import { useToolbar } from '../state/ToolbarContext'

/**
 * 工具栏里能出现的三种东西。
 *
 * 【`ratio` / `mode` / `import` / `clear-session` 四种 kind 已经不在这里了】它们渲染的是
 * 应用的真实功能，现在统一由 `SettingsDialog` 渲染（那四种控件连同各自的 testid 一起搬了
 * 过去）。工具栏只留一个 `settings` kind：一个打开对话框的按钮。
 */
export type ToolbarItem =
  | { kind: 'toggle'; id: string; label: string; title: string }
  | { kind: 'placeholder'; id: string; label: string; title: string }
  | { kind: 'settings' }

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
                    className="wt-btn"
                    data-testid="btn-settings"
                    title="设置 (⌘/Ctrl + ,)"
                    onClick={onOpenSettings}
                  >
                    设置
                  </button>
                )
              }

              const active = Boolean(toggles[item.id])
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`wt-btn ${active ? 'wt-btn--active' : ''}`}
                  data-testid={`btn-${item.id}`}
                  title={item.title}
                  aria-pressed={item.kind === 'toggle' ? active : undefined}
                  onClick={() => {
                    if (item.kind === 'toggle') toggle(item.id)
                    else notify('演示占位功能，未实现')
                  }}
                >
                  {item.label}
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
