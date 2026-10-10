export default function App() {
  return (
    <div className="wt-app" data-testid="app-root">
      <div className="wt-ribbon">
        <div className="wt-ribbon__title">
          <span className="wt-ribbon__title-app">Word</span>
          <span className="wt-ribbon__title-doc">文档1</span>
        </div>
        <div className="wt-tabs">
          <button className="wt-tab wt-tab--active">文件</button>
          <button className="wt-tab">开始</button>
        </div>
        <div className="wt-toolbar" />
      </div>

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
    </div>
  )
}
