import { useRef, useState } from 'react'
import { Toolbar, type ToolbarGroup } from './Toolbar'

export const RIBBON_TABS = ['文件', '开始', '插入', '布局', '引用', '审阅', '视图'] as const
export type RibbonTab = (typeof RIBBON_TABS)[number]

const FONT_GROUP: ToolbarGroup = {
  label: '字体',
  items: [
    { kind: 'toggle', id: 'bold', label: 'B', title: '加粗' },
    { kind: 'toggle', id: 'italic', label: 'I', title: '斜体' },
    { kind: 'toggle', id: 'underline', label: 'U', title: '下划线' },
    { kind: 'toggle', id: 'strike', label: 'S', title: '删除线' },
    { kind: 'placeholder', id: 'font-family', label: '宋体', title: '字体' },
    { kind: 'placeholder', id: 'font-size', label: '五号', title: '字号' },
    { kind: 'placeholder', id: 'brush', label: '格式刷', title: '格式刷' }
  ]
}

const PARAGRAPH_GROUP: ToolbarGroup = {
  label: '段落',
  items: [
    { kind: 'placeholder', id: 'bullets', label: '•≡', title: '项目符号' },
    { kind: 'placeholder', id: 'numbering', label: '1≡', title: '编号' },
    { kind: 'toggle', id: 'align-left', label: '左', title: '左对齐' },
    { kind: 'toggle', id: 'align-center', label: '中', title: '居中' },
    { kind: 'toggle', id: 'align-right', label: '右', title: '右对齐' },
    { kind: 'toggle', id: 'align-justify', label: '两', title: '两端对齐' },
    { kind: 'placeholder', id: 'line-spacing', label: '行距', title: '行距' }
  ]
}

/** 承载真实功能的控件，挂在「开始」和「视图」两个选项卡下，保证随手可及 */
const READING_GROUP: ToolbarGroup = {
  label: '阅读替换',
  items: [{ kind: 'ratio' }, { kind: 'mode' }]
}

const TABS: Record<RibbonTab, ToolbarGroup[]> = {
  文件: [
    { label: '小说', items: [{ kind: 'import' }, { kind: 'clear-session' }] },
    {
      label: '文件',
      items: [
        { kind: 'placeholder', id: 'new', label: '新建', title: '新建' },
        { kind: 'placeholder', id: 'save', label: '保存', title: '保存' },
        { kind: 'placeholder', id: 'export-docx', label: '导出 docx', title: '导出为 docx' },
        { kind: 'placeholder', id: 'print', label: '打印', title: '打印' }
      ]
    }
  ],
  开始: [
    FONT_GROUP,
    PARAGRAPH_GROUP,
    READING_GROUP,
    {
      label: '样式',
      items: [
        { kind: 'placeholder', id: 'style-heading', label: '标题 1', title: '标题 1' },
        { kind: 'placeholder', id: 'style-normal', label: '正文', title: '正文' }
      ]
    },
    {
      label: '编辑',
      items: [
        { kind: 'placeholder', id: 'find', label: '查找替换', title: '查找和替换' },
        { kind: 'placeholder', id: 'undo', label: '撤销', title: '撤销' },
        { kind: 'placeholder', id: 'redo', label: '重做', title: '重做' }
      ]
    }
  ],
  插入: [
    {
      label: '插入',
      items: [
        { kind: 'placeholder', id: 'table', label: '表格', title: '表格' },
        { kind: 'placeholder', id: 'picture', label: '图片', title: '图片' },
        { kind: 'placeholder', id: 'shape', label: '形状', title: '形状' },
        { kind: 'placeholder', id: 'pagebreak', label: '分页', title: '分页符' }
      ]
    }
  ],
  布局: [
    {
      label: '页面设置',
      items: [
        { kind: 'placeholder', id: 'margin', label: '页边距', title: '页边距' },
        { kind: 'placeholder', id: 'orientation', label: '纸张方向', title: '纸张方向' },
        { kind: 'placeholder', id: 'columns', label: '分栏', title: '分栏' }
      ]
    }
  ],
  引用: [
    {
      label: '引用',
      items: [
        { kind: 'placeholder', id: 'toc', label: '目录', title: '目录' },
        { kind: 'placeholder', id: 'footnote', label: '脚注', title: '插入脚注' }
      ]
    }
  ],
  审阅: [
    {
      label: '审阅',
      items: [
        { kind: 'placeholder', id: 'comment', label: '新建批注', title: '新建批注' },
        { kind: 'placeholder', id: 'spellcheck', label: '拼写检查', title: '拼写检查' },
        { kind: 'placeholder', id: 'wordcount', label: '字数统计', title: '字数统计' }
      ]
    }
  ],
  视图: [
    {
      label: '视图',
      items: [
        { kind: 'placeholder', id: 'read-mode', label: '阅读视图', title: '阅读视图' },
        { kind: 'placeholder', id: 'ruler', label: '标尺', title: '标尺' },
        { kind: 'placeholder', id: 'gridlines', label: '网格线', title: '网格线' }
      ]
    },
    READING_GROUP
  ]
}

export function Ribbon({
  docTitle,
  onDocTitleChange
}: {
  docTitle: string
  onDocTitleChange: (next: string) => void
}) {
  const [tab, setTab] = useState<RibbonTab>('开始')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(docTitle)
  // Esc 取消时 input 会卸载、进而触发 blur；没有这个标记的话 blur 会把草稿提交上去，
  // 「按 Esc 取消」就成了「按 Esc 提交」。
  const cancelTitleRef = useRef(false)

  const startEditingTitle = (): void => {
    setTitleDraft(docTitle)
    cancelTitleRef.current = false
    setEditingTitle(true)
  }

  const commitTitle = (): void => {
    if (cancelTitleRef.current) {
      cancelTitleRef.current = false
      setEditingTitle(false)
      return
    }
    const next = titleDraft.trim()
    // 空名不提交：蓝条上留一片空白比留着上一个名字更扎眼
    if (next) onDocTitleChange(next)
    setEditingTitle(false)
  }

  return (
    <div className="wt-ribbon" data-testid="ribbon">
      <div className="wt-ribbon__title">
        <span className="wt-ribbon__title-app">Word</span>
        {/* 这里显示的是用户可改的文档名，**不是小说文件名**——那是导入时唯一的泄露点 */}
        {editingTitle ? (
          <input
            className="wt-ribbon__title-input"
            data-testid="doc-title-input"
            aria-label="文档名"
            value={titleDraft}
            autoFocus
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle()
              else if (e.key === 'Escape') {
                cancelTitleRef.current = true
                setEditingTitle(false)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="wt-ribbon__title-doc"
            data-testid="doc-title"
            title="点击重命名"
            onClick={startEditingTitle}
          >
            {docTitle}
          </button>
        )}
      </div>
      <div className="wt-tabs" role="tablist">
        {RIBBON_TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`wt-tab ${tab === name ? 'wt-tab--active' : ''}`}
            data-testid={`tab-${name}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <Toolbar groups={TABS[tab]} />
    </div>
  )
}
