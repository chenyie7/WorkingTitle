import { useToolbar } from '../state/ToolbarContext'

export function Toast() {
  const { toast } = useToolbar()
  if (!toast) return null
  return (
    <div className="wt-toast" data-testid="toast" role="status">
      {toast}
    </div>
  )
}
