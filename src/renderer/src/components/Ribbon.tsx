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
  IconBorders,
  IconBullets,
  IconClearFormat,
  IconColumns,
  IconComment,
  IconCopy,
  IconCut,
  IconExport,
  IconFontColor,
  IconFontGrow,
  IconFontShrink,
  IconFootnote,
  IconFormatPainter,
  IconGrid,
  IconHighlight,
  IconIndentDecrease,
  IconIndentIncrease,
  IconItalic,
  IconLineSpacing,
  IconMargins,
  IconMultiLevelList,
  IconNew,
  IconNumbering,
  IconOrientation,
  IconPageBreak,
  IconPaste,
  IconPicture,
  IconPrint,
  IconReadingView,
  IconRedo,
  IconReplace,
  IconRuler,
  IconSave,
  IconSearch,
  IconSelect,
  IconShading,
  IconShape,
  IconShowMarks,
  IconSort,
  IconSpellCheck,
  IconStrike,
  IconSubscript,
  IconSuperscript,
  IconTable,
  IconTextEffects,
  IconToc,
  IconUnderline,
  IconUndo,
  IconWordCount
} from './icons'

export const RIBBON_TABS = ['文件', '开始', '插入', '布局', '引用', '审阅', '视图'] as const
export type RibbonTab = (typeof RIBBON_TABS)[number]

/**
 * 「开始」页那几个下拉框与样式库里的候选。都是真 Word 里装的东西，顺序也照它排——
 * 这类列表的可信度全在「里面装的东西像不像」上，随便编几个名字反而更假。
 */
const FONT_FAMILIES = [
  '宋体',
  '黑体',
  '楷体',
  '仿宋',
  '微软雅黑',
  '等线',
  'Times New Roman',
  'Arial'
] as const

const FONT_SIZES = [
  '初号',
  '小初',
  '一号',
  '小一',
  '二号',
  '小二',
  '三号',
  '小三',
  '四号',
  '小四',
  '五号',
  '小五'
] as const

const LINE_SPACINGS = ['1.0', '1.15', '1.5', '2.0', '2.5', '3.0'] as const

const STYLE_ENTRIES = ['正文', '标题 1', '标题 2', '标题 3', '无间隔', '引用', '强调'] as const

const CLIPBOARD_GROUP: ToolbarGroup = {
  label: '剪贴板',
  items: [
    // 真 Word 的「粘贴」是带展开箭头的大按钮；这里没给 `split` 做大按钮尺寸（那要另写一套
    // 箭头定位的样式），所以粘贴先用大按钮，箭头在下面几个真正需要它的地方用。
    { kind: 'placeholder', id: 'paste', label: '粘贴', title: '粘贴', icon: IconPaste, large: true },
    { kind: 'placeholder', id: 'cut', label: '剪切', title: '剪切', icon: IconCut },
    { kind: 'placeholder', id: 'copy', label: '复制', title: '复制', icon: IconCopy },
    { kind: 'placeholder', id: 'brush', label: '格式刷', title: '格式刷', icon: IconFormatPainter }
  ]
}

const FONT_GROUP: ToolbarGroup = {
  label: '字体',
  items: [
    // 字体名与字号在真 Word 里就是**下拉框**（combo），不再是文字按钮。
    // 宽度照真 Word 那两栏的观感给：字体名宽、字号窄。
    { kind: 'combo', id: 'font-family', title: '字体', options: FONT_FAMILIES, width: 118 },
    { kind: 'combo', id: 'font-size', title: '字号', options: FONT_SIZES, width: 58 },
    { kind: 'placeholder', id: 'font-grow', label: '增大字号', title: '增大字号', icon: IconFontGrow },
    {
      kind: 'placeholder',
      id: 'font-shrink',
      label: '减小字号',
      title: '减小字号',
      icon: IconFontShrink
    },
    {
      kind: 'placeholder',
      id: 'clear-format',
      label: '清除格式',
      title: '清除所有格式',
      icon: IconClearFormat
    },
    { kind: 'toggle', id: 'bold', label: '加粗', title: '加粗', icon: IconBold },
    { kind: 'toggle', id: 'italic', label: '斜体', title: '斜体', icon: IconItalic },
    // 下划线在真 Word 里是「主按钮 + 展开箭头」，箭头里是双下划线、波浪线那些。
    { kind: 'split', id: 'underline', label: '下划线', title: '下划线', icon: IconUnderline },
    { kind: 'toggle', id: 'strike', label: '删除线', title: '删除线', icon: IconStrike },
    { kind: 'toggle', id: 'subscript', label: '下标', title: '下标', icon: IconSubscript },
    { kind: 'toggle', id: 'superscript', label: '上标', title: '上标', icon: IconSuperscript },
    {
      kind: 'toggle',
      id: 'text-effects',
      label: '文本效果',
      title: '文本效果',
      icon: IconTextEffects
    },
    { kind: 'toggle', id: 'highlight', label: '突出显示', title: '突出显示', icon: IconHighlight },
    {
      kind: 'placeholder',
      id: 'font-color',
      label: '字体颜色',
      title: '字体颜色',
      icon: IconFontColor
    }
  ]
}

const PARAGRAPH_GROUP: ToolbarGroup = {
  label: '段落',
  items: [
    // 项目符号与编号在真 Word 里同样是分割按钮（箭头里是各种符号 / 编号样式）。
    { kind: 'split', id: 'bullets', label: '项目符号', title: '项目符号', icon: IconBullets },
    { kind: 'split', id: 'numbering', label: '编号', title: '编号', icon: IconNumbering },
    {
      kind: 'placeholder',
      id: 'multilevel',
      label: '多级列表',
      title: '多级列表',
      icon: IconMultiLevelList
    },
    {
      kind: 'placeholder',
      id: 'indent-decrease',
      label: '减少缩进',
      title: '减少缩进量',
      icon: IconIndentDecrease
    },
    {
      kind: 'placeholder',
      id: 'indent-increase',
      label: '增加缩进',
      title: '增加缩进量',
      icon: IconIndentIncrease
    },
    { kind: 'placeholder', id: 'sort', label: '排序', title: '排序', icon: IconSort },
    {
      kind: 'toggle',
      id: 'show-marks',
      label: '编辑标记',
      title: '显示/隐藏编辑标记',
      icon: IconShowMarks
    },
    { kind: 'toggle', id: 'align-left', label: '左对齐', title: '左对齐', icon: IconAlignLeft },
    { kind: 'toggle', id: 'align-center', label: '居中', title: '居中', icon: IconAlignCenter },
    { kind: 'toggle', id: 'align-right', label: '右对齐', title: '右对齐', icon: IconAlignRight },
    {
      kind: 'toggle',
      id: 'align-justify',
      label: '两端对齐',
      title: '两端对齐',
      icon: IconAlignJustify
    },
    { kind: 'combo', id: 'line-spacing', title: '行距', options: LINE_SPACINGS, width: 58 },
    { kind: 'placeholder', id: 'shading', label: '底纹', title: '底纹', icon: IconShading },
    { kind: 'placeholder', id: 'borders', label: '边框', title: '边框', icon: IconBorders }
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
    CLIPBOARD_GROUP,
    FONT_GROUP,
    PARAGRAPH_GROUP,
    {
      // 样式在真 Word 里是一排带 `AaBbCc` 预览的小方块，不是按钮——所以用 gallery。
      label: '样式',
      items: [{ kind: 'gallery', id: 'style', title: '样式', entries: STYLE_ENTRIES }]
    },
    {
      label: '编辑',
      items: [
        {
          kind: 'placeholder',
          id: 'find',
          label: '查找',
          title: '查找',
          icon: IconSearch,
          large: true
        },
        { kind: 'placeholder', id: 'replace', label: '替换', title: '替换', icon: IconReplace },
        { kind: 'placeholder', id: 'select', label: '选择', title: '选择', icon: IconSelect }
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
        {/* 这里显示的是用户可改的文档名，**不是小说文件名**——那是导入时唯一的泄露点。
            它现在是一段静态文本：改名挪进了设置对话框，蓝条上不再有可点的东西。 */}
        <span className="wt-ribbon__title-doc" data-testid="doc-title">
          {docTitle}
        </span>
        {/* 分隔符**单独成一个元素**，不并进上面那个 span：`doc-title` 的 textContent 必须
            ***正好*** 是文档名（设置对话框与多条测试都按这个口径断言），并进去就变成
            「文档1 - Word」了。顺序按 Windows 的惯例写成「文档名 - 应用名」。 */}
        <span className="wt-ribbon__title-sep">-</span>
        <span className="wt-ribbon__title-app">Word</span>
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
