import { useState } from 'react'
import { defaultShortcut, formatShortcut, platformKind } from '../../../core/shortcuts'
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
  IconWordCount,
  /* 「插入 / 布局 / 文件」三页补密度时新增的。上面那批是按名字排的，这批按用途聚在一起，
     不再跟着排——它们只在这三页用，混进去反而更难读。 */
  Icon3DModel,
  IconAddin,
  IconAlignObjects,
  IconAudio,
  IconBlankPage,
  IconBookmark,
  IconBringForward,
  IconChart,
  IconClose,
  IconCoverPage,
  IconCrossRef,
  IconDateTime,
  IconDropCap,
  IconFooter,
  IconFormula,
  IconGroupObjects,
  IconHeader,
  IconHyperlink,
  IconHyphenation,
  IconIcons,
  IconImport,
  IconLineNumbers,
  IconObject,
  IconPageNumber,
  IconPaperSize,
  IconPosition,
  IconRotate,
  IconSaveAs,
  IconScreenshot,
  IconSelectionPane,
  IconSendBackward,
  IconShare,
  IconSignature,
  IconSmartArt,
  IconSpaceAfter,
  IconSpaceBefore,
  IconSymbols,
  IconTextbox,
  IconVideo,
  IconWrapText,
  /* 「引用 / 审阅 / 视图」三页补密度时新增的。 */
  IconAccessibility,
  IconAccept,
  IconAddText,
  IconBibliography,
  IconCaption,
  IconCitation,
  IconCompare,
  IconDeleteComment,
  IconDraftView,
  IconEndnote,
  IconInsertIndex,
  IconLanguage,
  IconMacro,
  IconMarkEntry,
  IconMergeDocs,
  IconMultiPage,
  IconNewWindow,
  IconNextItem,
  IconOutlineView,
  IconPageView,
  IconPageWidth,
  IconPrevItem,
  IconReject,
  IconRestrictEditing,
  IconReviewPane,
  IconShowComments,
  IconSideBySide,
  IconSources,
  IconSplitWindow,
  IconSwitchWindow,
  IconSyncScroll,
  IconThesaurus,
  IconTrackChanges,
  IconTranslate,
  IconUpdateField,
  IconUpdateTable,
  IconWebLayout,
  IconZoom
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
    // 数组顺序就是排布顺序。组内按【两行、按列填充】排（见 ribbon.css 的 `.wt-group__body`），
    // 大按钮占满整列，于是这四项落成「格式刷(大) | 粘贴(大) | 剪切 / 复制」。
    // 格式刷摆在粘贴左边是明确要求的；剪切/复制留在粘贴右侧（它们本来就是粘贴的下级动作）。
    {
      kind: 'placeholder',
      id: 'brush',
      label: '格式刷',
      title: '格式刷',
      icon: IconFormatPainter,
      large: true
    },
    { kind: 'placeholder', id: 'paste', label: '粘贴', title: '粘贴', icon: IconPaste, large: true },
    { kind: 'placeholder', id: 'cut', label: '剪切', title: '剪切', icon: IconCut },
    { kind: 'placeholder', id: 'copy', label: '复制', title: '复制', icon: IconCopy }
  ]
}

const FONT_GROUP: ToolbarGroup = {
  label: '字体',
  items: [
    // 字体名与字号在真 Word 里就是**下拉框**（combo），不再是文字按钮。
    // 宽度照真 Word 那两栏的观感给：字体名宽、字号窄。
    { kind: 'combo', id: 'font-family', title: '字体', options: FONT_FAMILIES, width: 118 },
    { kind: 'combo', id: 'font-size', title: '字号', options: FONT_SIZES, width: 58 },
    // 【下面的顺序是被排布方式决定的，别按“重要性”重排】组内是两行按列填充，
    // **相邻两项自然成上下两格**。所以要成对地写：增大/减小、加粗/斜体、下划线/删除线…
    // 乱序的话会排出「清除格式 压在 加粗 上面」这种没道理的配对。
    { kind: 'placeholder', id: 'font-grow', label: '增大字号', title: '增大字号', icon: IconFontGrow },
    {
      kind: 'placeholder',
      id: 'font-shrink',
      label: '减小字号',
      title: '减小字号',
      icon: IconFontShrink
    },
    { kind: 'toggle', id: 'bold', label: '加粗', title: '加粗', icon: IconBold },
    { kind: 'toggle', id: 'italic', label: '斜体', title: '斜体', icon: IconItalic },
    // 下划线在真 Word 里是「主按钮 + 展开箭头」，箭头里是双下划线、波浪线那些。
    { kind: 'split', id: 'underline', label: '下划线', title: '下划线', icon: IconUnderline },
    { kind: 'toggle', id: 'strike', label: '删除线', title: '删除线', icon: IconStrike },
    { kind: 'toggle', id: 'subscript', label: '下标', title: '下标', icon: IconSubscript },
    { kind: 'toggle', id: 'superscript', label: '上标', title: '上标', icon: IconSuperscript },
    { kind: 'toggle', id: 'highlight', label: '突出显示', title: '突出显示', icon: IconHighlight },
    {
      kind: 'placeholder',
      id: 'font-color',
      label: '字体颜色',
      title: '字体颜色',
      icon: IconFontColor
    },
    {
      kind: 'placeholder',
      id: 'clear-format',
      label: '清除格式',
      title: '清除所有格式',
      icon: IconClearFormat
    },
    {
      kind: 'toggle',
      id: 'text-effects',
      label: '文本效果',
      title: '文本效果',
      icon: IconTextEffects
    }
  ]
}

const PARAGRAPH_GROUP: ToolbarGroup = {
  label: '段落',
  items: [
    // 顺序同样被「相邻两项成上下两格」决定，见 FONT_GROUP 上面那段说明。
    // 这一组正好 14 个小控件 = 7 列排满，行距（combo，占满整列）落在最右。
    // 14 这个数是**凑出来的**：底纹/边框本来就该成对，段落间距是补的那一项。
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
    { kind: 'placeholder', id: 'sort', label: '排序', title: '排序', icon: IconSort },
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
    {
      kind: 'toggle',
      id: 'show-marks',
      label: '编辑标记',
      title: '显示/隐藏编辑标记',
      icon: IconShowMarks
    },
    {
      kind: 'placeholder',
      id: 'para-spacing',
      label: '段落间距',
      title: '段前段后间距',
      icon: IconLineSpacing
    },
    { kind: 'placeholder', id: 'shading', label: '底纹', title: '底纹', icon: IconShading },
    { kind: 'placeholder', id: 'borders', label: '边框', title: '边框', icon: IconBorders },
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
    { kind: 'combo', id: 'line-spacing', title: '行距', options: LINE_SPACINGS, width: 58 }
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
      // 真 Word 里「文件」不是选项卡，是整页的 backstage（新建/打开/信息/打印…竖排）。
      // 这里刻意**没做**那一层：backstage 会整页盖住正文，而本应用的正事就是那块正文，
      // 点错一下就把阅读区盖了。所以它保持成一个普通选项卡，只把内容补丰富。
      label: '文件',
      items: [
        { kind: 'placeholder', id: 'new', label: '新建', title: '新建', icon: IconNew, large: true },
        { kind: 'placeholder', id: 'open', label: '打开', title: '打开', icon: IconImport, large: true },
        { kind: 'placeholder', id: 'save', label: '保存', title: '保存', icon: IconSave, large: true },
        {
          kind: 'placeholder',
          id: 'save-as',
          label: '另存为',
          title: '另存为',
          icon: IconSaveAs,
          large: true
        },
        { kind: 'placeholder', id: 'print', label: '打印', title: '打印', icon: IconPrint, large: true },
        { kind: 'placeholder', id: 'share', label: '共享', title: '共享', icon: IconShare, large: true },
        {
          kind: 'placeholder',
          id: 'export-docx',
          label: '导出 docx',
          title: '导出为 docx',
          icon: IconExport,
          large: true
        },
        { kind: 'placeholder', id: 'close-doc', label: '关闭', title: '关闭', icon: IconClose, large: true }
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
      label: '页面',
      items: [
        {
          kind: 'placeholder',
          id: 'cover-page',
          label: '封面',
          title: '封面',
          icon: IconCoverPage,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'blank-page',
          label: '空白页',
          title: '空白页',
          icon: IconBlankPage,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'pagebreak',
          label: '分页',
          title: '分页符',
          icon: IconPageBreak,
          large: true
        }
      ]
    },
    {
      label: '表格',
      items: [
        { kind: 'placeholder', id: 'table', label: '表格', title: '表格', icon: IconTable, large: true }
      ]
    },
    {
      label: '插图',
      items: [
        { kind: 'placeholder', id: 'picture', label: '图片', title: '图片', icon: IconPicture, large: true },
        { kind: 'placeholder', id: 'shape', label: '形状', title: '形状', icon: IconShape, large: true },
        { kind: 'placeholder', id: 'icons', label: '图标', title: '图标', icon: IconIcons, large: true },
        { kind: 'placeholder', id: 'model3d', label: '3D 模型', title: '3D 模型', icon: Icon3DModel, large: true },
        { kind: 'placeholder', id: 'smartart', label: 'SmartArt', title: 'SmartArt', icon: IconSmartArt, large: true },
        { kind: 'placeholder', id: 'chart', label: '图表', title: '图表', icon: IconChart, large: true },
        {
          kind: 'placeholder',
          id: 'screenshot',
          label: '屏幕截图',
          title: '屏幕截图',
          icon: IconScreenshot,
          large: true
        }
      ]
    },
    {
      label: '加载项',
      items: [
        { kind: 'placeholder', id: 'addin', label: '加载项', title: '加载项', icon: IconAddin, large: true }
      ]
    },
    {
      label: '媒体',
      items: [
        { kind: 'placeholder', id: 'video', label: '视频', title: '视频', icon: IconVideo, large: true },
        { kind: 'placeholder', id: 'audio', label: '音频', title: '音频', icon: IconAudio, large: true }
      ]
    },
    {
      label: '链接',
      items: [
        {
          kind: 'placeholder',
          id: 'link',
          label: '链接',
          title: '链接',
          icon: IconHyperlink,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'bookmark',
          label: '书签',
          title: '书签',
          icon: IconBookmark,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'crossref',
          label: '交叉引用',
          title: '交叉引用',
          icon: IconCrossRef,
          large: true
        }
      ]
    },
    {
      label: '批注',
      items: [
        { kind: 'placeholder', id: 'comment', label: '批注', title: '批注', icon: IconComment, large: true }
      ]
    },
    {
      label: '页眉和页脚',
      items: [
        { kind: 'placeholder', id: 'header', label: '页眉', title: '页眉', icon: IconHeader, large: true },
        { kind: 'placeholder', id: 'footer', label: '页脚', title: '页脚', icon: IconFooter, large: true },
        {
          kind: 'placeholder',
          id: 'page-number',
          label: '页码',
          title: '页码',
          icon: IconPageNumber,
          large: true
        }
      ]
    },
    {
      label: '文本',
      items: [
        {
          kind: 'placeholder',
          id: 'textbox',
          label: '文本框',
          title: '文本框',
          icon: IconTextbox,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'wordart',
          label: '艺术字',
          title: '艺术字',
          icon: IconTextEffects,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'dropcap',
          label: '首字下沉',
          title: '首字下沉',
          icon: IconDropCap,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'signature',
          label: '签名行',
          title: '签名行',
          icon: IconSignature,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'datetime',
          label: '日期和时间',
          title: '日期和时间',
          icon: IconDateTime,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'object',
          label: '对象',
          title: '对象',
          icon: IconObject,
          large: true
        }
      ]
    },
    {
      label: '符号',
      items: [
        {
          kind: 'placeholder',
          id: 'equation',
          label: '公式',
          title: '公式',
          icon: IconFormula,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'symbol',
          label: '符号',
          title: '符号',
          icon: IconSymbols,
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
        {
          kind: 'placeholder',
          id: 'paper-size',
          label: '纸张大小',
          title: '纸张大小',
          icon: IconPaperSize,
          large: true
        },
        { kind: 'placeholder', id: 'columns', label: '分栏', title: '分栏', icon: IconColumns, large: true },
        {
          kind: 'placeholder',
          id: 'breaks',
          label: '分隔符',
          title: '分隔符',
          icon: IconPageBreak,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'line-numbers',
          label: '行号',
          title: '行号',
          icon: IconLineNumbers,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'hyphenation',
          label: '断字',
          title: '断字',
          icon: IconHyphenation,
          large: true
        }
      ]
    },
    {
      label: '段落',
      items: [
        {
          kind: 'placeholder',
          id: 'indent-decrease',
          label: '减少缩进',
          title: '减少缩进量',
          icon: IconIndentDecrease,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'indent-increase',
          label: '增加缩进',
          title: '增加缩进量',
          icon: IconIndentIncrease,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'space-before',
          label: '段前间距',
          title: '段前间距',
          icon: IconSpaceBefore,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'space-after',
          label: '段后间距',
          title: '段后间距',
          icon: IconSpaceAfter,
          large: true
        },
        {
          // 与「开始」页那个行距是同一个命令，所以共用 `line-spacing` 这个 id——
          // 那边的 combo 选了值，这边的按钮读的是同一份状态（按钮本身不读，见 Toolbar）。
          kind: 'placeholder',
          id: 'line-spacing',
          label: '行距',
          title: '行距',
          icon: IconLineSpacing,
          large: true
        }
      ]
    },
    {
      label: '排列',
      items: [
        {
          kind: 'placeholder',
          id: 'position',
          label: '位置',
          title: '位置',
          icon: IconPosition,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'wrap-text',
          label: '环绕文字',
          title: '环绕文字',
          icon: IconWrapText,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'bring-forward',
          label: '上移一层',
          title: '上移一层',
          icon: IconBringForward,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'send-backward',
          label: '下移一层',
          title: '下移一层',
          icon: IconSendBackward,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'selection-pane',
          label: '选择窗格',
          title: '选择窗格',
          icon: IconSelectionPane,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'align-objects',
          label: '对齐',
          title: '对齐',
          icon: IconAlignObjects,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'group-objects',
          label: '组合',
          title: '组合',
          icon: IconGroupObjects,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'rotate',
          label: '旋转',
          title: '旋转',
          icon: IconRotate,
          large: true
        }
      ]
    }
  ],
  引用: [
    {
      label: '目录',
      items: [
        { kind: 'placeholder', id: 'toc', label: '目录', title: '目录', icon: IconToc, large: true },
        {
          kind: 'placeholder',
          id: 'add-text',
          label: '添加文字',
          title: '添加文字',
          icon: IconAddText,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'update-toc',
          label: '更新目录',
          title: '更新目录',
          icon: IconUpdateField,
          large: true
        }
      ]
    },
    {
      label: '脚注',
      items: [
        {
          kind: 'placeholder',
          id: 'footnote',
          label: '插入脚注',
          title: '插入脚注',
          icon: IconFootnote,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'endnote',
          label: '插入尾注',
          title: '插入尾注',
          icon: IconEndnote,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'next-footnote',
          label: '下一条脚注',
          title: '下一条脚注',
          icon: IconNextItem,
          large: true
        }
      ]
    },
    {
      label: '引文与书目',
      items: [
        {
          kind: 'placeholder',
          id: 'citation',
          label: '插入引文',
          title: '插入引文',
          icon: IconCitation,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'sources',
          label: '管理源',
          title: '管理源',
          icon: IconSources,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'bibliography',
          label: '书目',
          title: '书目',
          icon: IconBibliography,
          large: true
        }
      ]
    },
    {
      label: '题注',
      items: [
        {
          kind: 'placeholder',
          id: 'caption',
          label: '插入题注',
          title: '插入题注',
          icon: IconCaption,
          large: true
        },
        {
          // 与「插入」页那个交叉引用是同一个命令，共用 id。
          kind: 'placeholder',
          id: 'crossref',
          label: '交叉引用',
          title: '交叉引用',
          icon: IconCrossRef,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'update-table',
          label: '更新表',
          title: '更新表',
          icon: IconUpdateTable,
          large: true
        }
      ]
    },
    {
      label: '索引',
      items: [
        {
          kind: 'placeholder',
          id: 'mark-entry',
          label: '标记条目',
          title: '标记条目',
          icon: IconMarkEntry,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'insert-index',
          label: '插入索引',
          title: '插入索引',
          icon: IconInsertIndex,
          large: true
        }
      ]
    }
  ],
  审阅: [
    {
      label: '校对',
      items: [
        {
          kind: 'placeholder',
          id: 'spellcheck',
          label: '拼写和语法',
          title: '拼写和语法',
          icon: IconSpellCheck,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'thesaurus',
          label: '同义词库',
          title: '同义词库',
          icon: IconThesaurus,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'wordcount',
          label: '字数统计',
          title: '字数统计',
          icon: IconWordCount,
          large: true
        }
      ]
    },
    {
      label: '辅助功能',
      items: [
        {
          kind: 'placeholder',
          id: 'accessibility',
          label: '检查辅助功能',
          title: '检查辅助功能',
          icon: IconAccessibility,
          large: true
        }
      ]
    },
    {
      label: '语言',
      items: [
        {
          kind: 'placeholder',
          id: 'translate',
          label: '翻译',
          title: '翻译',
          icon: IconTranslate,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'language',
          label: '语言',
          title: '语言',
          icon: IconLanguage,
          large: true
        }
      ]
    },
    {
      label: '批注',
      items: [
        {
          kind: 'placeholder',
          id: 'comment',
          label: '新建批注',
          title: '新建批注',
          icon: IconComment,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'delete-comment',
          label: '删除',
          title: '删除批注',
          icon: IconDeleteComment,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'prev-comment',
          label: '上一条',
          title: '上一条批注',
          icon: IconPrevItem,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'next-comment',
          label: '下一条',
          title: '下一条批注',
          icon: IconNextItem,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'show-comments',
          label: '显示批注',
          title: '显示批注',
          icon: IconShowComments,
          large: true
        }
      ]
    },
    {
      label: '修订',
      items: [
        {
          kind: 'placeholder',
          id: 'track-changes',
          label: '修订',
          title: '修订',
          icon: IconTrackChanges,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'markup',
          label: '显示标记',
          title: '显示标记',
          icon: IconShowMarks,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'review-pane',
          label: '审阅窗格',
          title: '审阅窗格',
          icon: IconReviewPane,
          large: true
        }
      ]
    },
    {
      label: '更改',
      items: [
        { kind: 'placeholder', id: 'accept', label: '接受', title: '接受', icon: IconAccept, large: true },
        { kind: 'placeholder', id: 'reject', label: '拒绝', title: '拒绝', icon: IconReject, large: true }
      ]
    },
    {
      label: '比较',
      items: [
        {
          kind: 'placeholder',
          id: 'compare',
          label: '比较',
          title: '比较',
          icon: IconCompare,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'merge-docs',
          label: '合并',
          title: '合并',
          icon: IconMergeDocs,
          large: true
        }
      ]
    },
    {
      label: '保护',
      items: [
        {
          kind: 'placeholder',
          id: 'restrict',
          label: '限制编辑',
          title: '限制编辑',
          icon: IconRestrictEditing,
          large: true
        }
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
        {
          kind: 'placeholder',
          id: 'page-view',
          label: '页面视图',
          title: '页面视图',
          icon: IconPageView,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'web-view',
          label: 'Web 版式视图',
          title: 'Web 版式视图',
          icon: IconWebLayout,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'outline-view',
          label: '大纲视图',
          title: '大纲视图',
          icon: IconOutlineView,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'draft-view',
          label: '草稿视图',
          title: '草稿视图',
          icon: IconDraftView,
          large: true
        }
      ]
    },
    {
      label: '显示',
      items: [
        { kind: 'placeholder', id: 'ruler', label: '标尺', title: '标尺', icon: IconRuler, large: true },
        { kind: 'placeholder', id: 'gridlines', label: '网格线', title: '网格线', icon: IconGrid, large: true },
        {
          // 与「布局」页那个选择窗格是同一类东西，共用图标出口。
          kind: 'placeholder',
          id: 'nav-pane',
          label: '导航窗格',
          title: '导航窗格',
          icon: IconSelectionPane,
          large: true
        }
      ]
    },
    {
      label: '显示比例',
      items: [
        {
          kind: 'placeholder',
          id: 'one-page',
          label: '单页',
          title: '单页',
          icon: IconPageView,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'multi-page',
          label: '多页',
          title: '多页',
          icon: IconMultiPage,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'page-width',
          label: '页宽',
          title: '页宽',
          icon: IconPageWidth,
          large: true
        },
        { kind: 'placeholder', id: 'zoom', label: '缩放', title: '缩放', icon: IconZoom, large: true }
      ]
    },
    {
      label: '窗口',
      items: [
        {
          kind: 'placeholder',
          id: 'new-window',
          label: '新建窗口',
          title: '新建窗口',
          icon: IconNewWindow,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'split',
          label: '拆分',
          title: '拆分',
          icon: IconSplitWindow,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'side-by-side',
          label: '并排查看',
          title: '并排查看',
          icon: IconSideBySide,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'sync-scroll',
          label: '同步滚动',
          title: '同步滚动',
          icon: IconSyncScroll,
          large: true
        },
        {
          kind: 'placeholder',
          id: 'switch-window',
          label: '切换窗口',
          title: '切换窗口',
          icon: IconSwitchWindow,
          large: true
        }
      ]
    },
    {
      label: '宏',
      items: [
        { kind: 'placeholder', id: 'macro', label: '宏', title: '宏', icon: IconMacro, large: true }
      ]
    }
  ]
}

/**
 * 四个可选 prop 的默认值。
 *
 * 【为什么放在模块顶层而不是写成内联箭头函数】`onRecordingChange` 的**身份必须稳定**：
 * 对话框里那个 effect 拿它当依赖，每次渲染都换一个新函数的话，effect 会跟着每次渲染重跑
 * ——「有没有在录制」这个状态就会被反复上报。空函数放在这里，一次创建、终身复用。
 */
const ignoreShortcutsChange = (): void => {}
const ignoreRecordingChange = (): void => {}

/**
 * 空稀疏表＝一条都没改过。**不要在这里先 `resolveShortcuts` 补齐**：真接上之后 App 传下来
 * 的就是那张稀疏表（缺条目＝用该平台的默认值），而补齐这一步在设置对话框里按当前平台做。
 */
const DEFAULT_SHORTCUTS: Record<string, string | undefined> = {}

/**
 * 宿主平台。**现取而不是在模块顶层缓存**：与 App.tsx 的 getApi 同一个理由——缓存等于把
 * 「preload 一定在模块加载前注入」写死进加载顺序，一旦不成立就是永久错的。缺桥时按
 * `'other'` 走：宁可显示成 Windows 的那一套，也不要因为一个读不到的值把界面炸掉。
 */
function hostPlatform(): string {
  const host = (window as unknown as { api?: { platform?: string } }).api
  return host?.platform ?? 'other'
}

export function Ribbon({
  docTitle,
  displayTitle,
  onDocTitleChange,
  darkPaper,
  onDarkPaperChange,
  themeSource,
  onThemeSourceChange,
  novelOpen,
  settingsOpen,
  onSettingsOpenChange,
  shortcuts = DEFAULT_SHORTCUTS,
  platform = hostPlatform(),
  onShortcutsChange = ignoreShortcutsChange,
  onRecordingChange = ignoreRecordingChange,
  settingsShortcut = formatShortcut(defaultShortcut('open-settings', platformKind(platform)), platformKind(platform))
}: {
  docTitle: string
  /**
   * 标题条上显示的文档名。**不传时等于 `docTitle`**。
   *
   * 【为什么要与 `docTitle` 拆开】本组件把 `docTitle` 既用于标题条、又原样转手给
   * `SettingsDialog` 的「文档名」输入框。老板模式下只覆盖前者——两者共用一个 prop 的话，
   * 设置里那个输入框会跟着变成工作文档的文件名，而用户存的其实是「文档1」。
   */
  displayTitle?: string
  onDocTitleChange: (next: string) => void
  darkPaper: boolean
  onDarkPaperChange: (next: boolean) => void
  themeSource: ThemeSource
  onThemeSourceChange: (next: ThemeSource) => void
  /** 有没有打开小说。设置里「当前书」的比例框据此禁用——没有书就没有「当前书」。 */
  novelOpen: boolean
  /**
   * 设置对话框开不开。**从 Task 6 起由调用方持有**：原先这个状态住在本组件内部，而
   * 「按 ⌘/Ctrl + , 打开设置」那条监听已经删掉了（它归全局分发器），分发器长在调用方
   * 那一层、碰不到组件内部的状态——所以这个状态必须提上去。
   */
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  /**
   * 下面这四个**暂时是可选**的：真值住在 `App` 里（稀疏表、平台原值、录制态），而 App 的
   * 接线还没做。给默认值是为了让还没接上这一层的调用方（`App` 与既有测试）不必为此改动，
   * 同时设置里的快捷键那一组仍然显示成该平台的默认值而不是一片空白。
   */
  shortcuts?: Record<string, string | undefined>
  platform?: string
  onShortcutsChange?: (next: Record<string, string | undefined>) => void
  onRecordingChange?: (recording: boolean) => void
  /**
   * 「设置」那个按钮的 title 里显示的快捷键。**默认值从注册表推**（注册表里那一条的默认
   * 键，按上面那个 `platform` 格式化）——所以调用方不传也是对的，而用户改过键之后要由
   * 调用方把那一份喂进来。默认值里引用的 `platform` 是本参数表**前面**那个形参，顺序别调。
   */
  settingsShortcut?: string
}) {
  const [tab, setTab] = useState<RibbonTab>('开始')

  // 设置对话框的快捷键（⌘/Ctrl + ,）**不在这里监听**：它收进了全局分发器，见
  // `renderer/src/state/shortcuts.ts`。分发器命中之后把「打开设置」这个动作派给调用方，
  // 再由调用方翻 `settingsOpen`——所以这个状态已经不在本组件里了。

  return (
    <div className="wt-ribbon" data-testid="ribbon">
      <div className="wt-ribbon__title">
        {/* 这里显示的是用户可改的文档名，**不是小说文件名**——那是导入时唯一的泄露点。
            它现在是一段静态文本：改名挪进了设置对话框，蓝条上不再有可点的东西。 */}
        <span className="wt-ribbon__title-doc" data-testid="doc-title">
          {displayTitle ?? docTitle}
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
      <Toolbar
        groups={TABS[tab]}
        onOpenSettings={() => onSettingsOpenChange(true)}
        settingsShortcut={settingsShortcut}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => onSettingsOpenChange(false)}
        docTitle={docTitle}
        onDocTitleChange={onDocTitleChange}
        darkPaper={darkPaper}
        onDarkPaperChange={onDarkPaperChange}
        themeSource={themeSource}
        onThemeSourceChange={onThemeSourceChange}
        novelOpen={novelOpen}
        shortcuts={shortcuts}
        platform={platform}
        onShortcutsChange={onShortcutsChange}
        onRecordingChange={onRecordingChange}
      />
    </div>
  )
}
