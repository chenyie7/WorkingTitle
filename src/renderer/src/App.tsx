import { Ribbon } from './components/Ribbon'
import { Toast } from './components/Toast'
import { ToolbarProvider } from './state/ToolbarContext'

export default function App() {
  return (
    <ToolbarProvider>
      <div className="wt-app" data-testid="app-root">
        <Ribbon docTitle="文档1" />

        <div className="wt-body">
          <aside className="wt-sidebar">
            <div className="wt-sidebar__header">章节</div>
            <div className="wt-sidebar__list" />
          </aside>
          <main className="wt-canvas">
            <div className="wt-page">
              <div className="wt-page__empty">
                文件 → 导入小说，或按 Ctrl+O
                <br />
                导入后在文档区打字，字会按比例从小说里取出来。
              </div>
            </div>
          </main>
        </div>

        <div className="wt-statusbar">
          <span>就绪</span>
        </div>
        <Toast />
      </div>
    </ToolbarProvider>
  )
}
