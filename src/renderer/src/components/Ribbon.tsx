import { useEffect, useState } from 'react'
import { SettingsDialog } from './SettingsDialog'
import type { ThemeSource } from '../types/global'
import { Toolbar, type ToolbarGroup } from './Toolbar'
import {
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconBullets,
  IconColumns,
  IconComment,
  IconExport,
  IconFootnote,
  IconFormatPainter,
  IconGrid,
  IconItalic,
  IconLineSpacing,
  IconMargins,
  IconNew,
  IconNumbering,
  IconOrientation,
  IconPageBreak,
  IconPicture,
  IconPrint,
  IconReadingView,
  IconRedo,
  IconRuler,
  IconSave,
  IconSearch,
  IconShape,
  IconSpellCheck,
  IconStrike,
  IconTable,
  IconToc,
  IconUnderline,
  IconUndo,
  IconWordCount
} from './icons'

export const RIBBON_TABS = ['文件', '开始', '插入', '布局', '引用', '审阅', '视图'] as const
export type RibbonTab = (typeof RIBBON_TABS)[number]

const FONT_GROUP: ToolbarGroup = {
  label: '字体',
  items: [
    // 字体名与字号在真 Word 里是下拉框，这里是文字按钮——**刻意不给它们图标**：
    // 有图标的非大按钮会把标签藏起来（见 Toolbar 的 `--icon-only`），而这两项的
    // 可读文字本身就是它的样子。
    { kind: 'placeholder', id: 'font-family', label: '宋体', title: '字体' },
    { kind: 'placeholder', id: 'font-size', label: '五号', title: '字号' },
    { kind: 'toggle', id: 'bold', label: '加粗', title: '加粗', icon: IconBold },
    { kind: 'toggle', id: 'italic', label: '斜体', title: '斜体', icon: IconItalic },
    { kind: 'toggle', id: 'underline', label: '下划线', title: '下划线', icon: IconUnderline },
    { kind: 'toggle', id: 'strike', label: '删除线', title: '删除线', icon: IconStrike },
    { kind: 'placeholder', id: 'brush', label: '格式刷', title: '格式刷', icon: IconFormatPainter, large: true }
  ]
}

const PARAGRAPH_GROUP: ToolbarGroup = {
  label: '段落',
  items: [
    { kind: 'placeholder', id: 'bullets', label: '项目符号', title: '项目符号', icon: IconBullets },
    { kind: 'placeholder', id: 'numbering', label: '编号', title: '编号', icon: IconNumbering },
    { kind: 'toggle', id: 'align-left', label: '左对齐', title: '左对齐', icon: IconAlignLeft },
    { kind: 'toggle', id: 'align-center', label: '居中', title: '居中', icon: IconAlignCenter },
    { kind: 'toggle', id: 'align-right', label: '右对齐', title: '右对齐', icon: IconAlignRight },
    { kind: 'toggle', id: 'align-justify', label: '两端对齐', title: '两端对齐', icon: IconAlignJustify },
    { kind: 'placeholder', id: 'line-spacing', label: '行距', title: '行距', icon: IconLineSpacing }
  ]
}

/**
 * 【原先这里挂着一个 `READING_GROUP`（比例 + 输入模式），摆在「开始」和「视图」两个选项卡下】
 * 那是全应用最容易被一眼看穿的地方：假 Word 的工具栏里放着「1 键显示 N 字」。整组连同
 * 「文件」选项卡里的「小说」组一起搬进了 `SettingsDialog`，工具栏只留一个「设置」按钮。
 *
 * 【`large` 的用法照抄真 Word 的取舍】文件/插入/布局这些页里的项基本都是大按钮（图标在上、
 * 标签在下），因为它们数量少、辨识靠图标；「开始」页里的格式与对齐是一排小按钮，
 * 因为只有并排才看得出对比。
 */
const TABS: Record<RibbonTab, ToolbarGroup[]> = {
  文件: [
    {
      label: '文件',
      items: [
        { kind: 'placeholder', id: 'new', label: '新建', title: '新建', icon: IconNew, large: true },
        { kind: 'placeholder', id: 'save', label: '保存', title: '保存', icon: IconSave, large: true },
        {
          kind: 'placeholder',
          id: 'export-docx',
          label: '导出 docx',
          title: '导出为 docx',
          icon: IconExport,
          large: true
        },
        { kind: 'placeholder', id: 'print', label: '打印', title: '打印', icon: IconPrint, large: true }
      ]
    },
    // 真实功能的唯一入口。排在占位组【后面】——它是整个界面上唯一「有用」的按钮，
    // 摆在最左边反而显眼。
    { label: '设置', items: [{ kind: 'settings', large: true }] }
  ],
  开始: [
    FONT_GROUP,
    PARAGRAPH_GROUP,
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
        { kind: 'placeholder', id: 'find', label: '查找替换', title: '查找和替换', icon: IconSearch, large: true },
        { kind: 'placeholder', id: 'undo', label: '撤销', title: '撤销', icon: IconUndo },
        { kind: 'placeholder', id: 'redo', label: '重做', title: '重做', icon: IconRedo }
      ]
    }
  ],
  插入: [
    {
      label: '插入',
      items: [
        { kind: 'placeholder', id: 'table', label: '表格', title: '表格', icon: IconTable, large: true },
        { kind: 'placeholder', id: 'picture', label: '图片', title: '图片', icon: IconPicture, large: true },
        { kind: 'placeholder', id: 'shape', label: '形状', title: '形状', icon: IconShape, large: true },
        {
          kind: 'placeholder',
          id: 'pagebreak',
          label: '分页',
          title: '分页符',
          icon: IconPageBreak,
          large: true
        }
      ]
    }
  ],
  布局: [
    {
      label: '页面设置',
      items: [
        { kind: 'placeholder', id: 'margin', label: '页边距', title: '页边距', icon: IconMargins, large: true },
        {
          kind: 'placeholder',
          id: 'orientation',
          label: '纸张方向',
          title: '纸张方向',
          icon: IconOrientation,
          large: true
        },
        { kind: 'placeholder', id: 'columns', label: '分栏', title: '分栏', icon: IconColumns, large: true }
      ]
    }
  ],
  引用: [
    {
      label: '引用',
      items: [
        { kind: 'placeholder', id: 'toc', label: '目录', title: '目录', icon: IconToc, large: true },
        { kind: 'placeholder', id: 'footnote', label: '脚注', title: '插入脚注', icon: IconFootnote, large: true }
      ]
    }
  ],
  审阅: [
    {
      label: '审阅',
      items: [
        { kind: 'placeholder', id: 'comment', label: '新建批注', title: '新建批注', icon: IconComment, large: true },
        {
          kind: 'placeholder',
          id: 'spellcheck',
          label: '拼写检查',
          title: '拼写检查',
          icon: IconSpellCheck,
          large: true
        },
        { kind: 'placeholder', id: 'wordcount', label: '字数统计', title: '字数统计', icon: IconWordCount, large: true }
      ]
    }
  ],
  视图: [
    {
      label: '视图',
      items: [
        {
          kind: 'placeholder',
          id: 'read-mode',
          label: '阅读视图',
          title: '阅读视图',
          icon: IconReadingView,
          large: true
        },
        { kind: 'placeholder', id: 'ruler', label: '标尺', title: '标尺', icon: IconRuler, large: true },
        { kind: 'placeholder', id: 'gridlines', label: '网格线', title: '网格线', icon: IconGrid, large: true }
      ]
    }
  ]
}

export function Ribbon({
  docTitle,
  onDocTitleChange,
  darkPaper,
  onDarkPaperChange,
  themeSource,
  onThemeSourceChange
}: {
  docTitle: string
  onDocTitleChange: (next: string) => void
  darkPaper: boolean
  onDarkPaperChange: (next: boolean) => void
  themeSource: ThemeSource
  onThemeSourceChange: (next: ThemeSource) => void
}) {
  const [tab, setTab] = useState<RibbonTab>('开始')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 设置对话框的快捷键：⌘/Ctrl + ,（macOS 上「设置」的惯例键）
  //
  // 【为什么用 e.code 而不是 e.key】与左侧栏的 ⌘/Ctrl+Shift+H 同理：`e.key` 会随修饰键
  // 与键盘布局变（按住 Shift 时 ',', 在非 QWERTY 布局下还可能是别的字符），而
  // `e.code === 'Comma'` 按物理按键位置判定，不受这两件事影响。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.code !== 'Comma') return
      e.preventDefault()
      setSettingsOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="wt-ribbon" data-testid="ribbon">
      <div className="wt-ribbon__title">
        <span className="wt-ribbon__title-app">Word</span>
        {/* 这里显示的是用户可改的文档名，**不是小说文件名**——那是导入时唯一的泄露点。
            它现在是一段静态文本：改名挪进了设置对话框，蓝条上不再有可点的东西。 */}
        <span className="wt-ribbon__title-doc" data-testid="doc-title">
          {docTitle}
        </span>
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
      <Toolbar groups={TABS[tab]} onOpenSettings={() => setSettingsOpen(true)} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        docTitle={docTitle}
        onDocTitleChange={onDocTitleChange}
        darkPaper={darkPaper}
        onDarkPaperChange={onDarkPaperChange}
        themeSource={themeSource}
        onThemeSourceChange={onThemeSourceChange}
      />
    </div>
  )
}
