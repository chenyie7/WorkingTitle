import { bundleIcon } from '@fluentui/react-icons'
import {
  TextBoldFilled,
  TextBoldRegular,
  TextItalicFilled,
  TextItalicRegular,
  TextUnderlineFilled,
  TextUnderlineRegular,
  TextStrikethroughFilled,
  TextStrikethroughRegular,
  TextFontFilled,
  TextFontRegular,
  TextFontSizeFilled,
  TextFontSizeRegular,
  ClipboardBrushFilled,
  ClipboardBrushRegular,
  TextBulletListFilled,
  TextBulletListRegular,
  TextNumberListLtrFilled,
  TextNumberListLtrRegular,
  TextAlignLeftFilled,
  TextAlignLeftRegular,
  TextAlignCenterFilled,
  TextAlignCenterRegular,
  TextAlignRightFilled,
  TextAlignRightRegular,
  TextAlignJustifyFilled,
  TextAlignJustifyRegular,
  TextLineSpacingFilled,
  TextLineSpacingRegular,
  TextParagraphFilled,
  TextParagraphRegular,
  SearchFilled,
  SearchRegular,
  ArrowUndoFilled,
  ArrowUndoRegular,
  ArrowRedoFilled,
  ArrowRedoRegular,
  DocumentAddFilled,
  DocumentAddRegular,
  SaveFilled,
  SaveRegular,
  DocumentArrowDownFilled,
  DocumentArrowDownRegular,
  PrintFilled,
  PrintRegular,
  FolderOpenFilled,
  FolderOpenRegular,
  SettingsFilled,
  SettingsRegular,
  DeleteFilled,
  DeleteRegular,
  TableFilled,
  TableRegular,
  ImageFilled,
  ImageRegular,
  ShapesFilled,
  ShapesRegular,
  DocumentPageBreakFilled,
  DocumentPageBreakRegular,
  DocumentMarginsFilled,
  DocumentMarginsRegular,
  ResizeLargeFilled,
  ResizeLargeRegular,
  LayoutColumnTwoFilled,
  LayoutColumnTwoRegular,
  BookOpenFilled,
  BookOpenRegular,
  CommentFilled,
  CommentRegular,
  TextGrammarCheckmarkFilled,
  TextGrammarCheckmarkRegular,
  TextFootnoteFilled,
  TextFootnoteRegular,
  TextWordCountFilled,
  TextWordCountRegular,
  ReadingModeMobileFilled,
  ReadingModeMobileRegular,
  RulerFilled,
  RulerRegular,
  GridFilled,
  GridRegular,
  ChevronLeftFilled,
  ChevronLeftRegular,
  ChevronRightFilled,
  ChevronRightRegular,
  DismissFilled,
  DismissRegular,
  RenameRegular,
  RenameFilled,
  KeyboardRegular,
  KeyboardFilled,
  DarkThemeRegular,
  DarkThemeFilled,
  DocumentRegular,
  DocumentFilled,
  BookRegular,
  BookFilled,
  DesktopRegular,
  DesktopFilled,
  WeatherSunnyRegular,
  WeatherSunnyFilled,
  WeatherMoonRegular,
  WeatherMoonFilled
} from '@fluentui/react-icons'

/**
 * 图标集用的是**微软官方那一套**（`@fluentui/react-icons`，MIT）——就是 Office / Microsoft 365
 * 自己用的，所以「像 Word」和「现代」这两件事在这里不冲突。
 *
 * 【为什么每个都用 `bundleIcon(Filled, Regular)` 包一层】
 * 这正是 Word 切换按钮的语义：**未按下画线框版，按下画实心版**（加粗、斜体、对齐那一排都是）。
 * 直接用单个变体的话，按下去只能靠换背景色表达，观感就差一截。
 * `bundleIcon` 返回的组件吃一个 `filled?: boolean`，其余 SVG 属性照传。
 *
 * 【图标名是怎么定的】不要凭记忆写。这个包导出几千个名字、且**必须带 `Regular` / `Filled` 后缀**
 * （`TextBold` 不存在，只有 `TextBoldRegular` / `TextBoldFilled`）。下面每个名字都是从包里
 * 实际枚举出来核对过的；其中 `TextLineSpacing`、`TextGrammarCheckmark`、`DocumentMargins`（复数）
 * 这几个是查出来的而非想当然。要换图标请同样先枚举。
 */
export const IconBold = bundleIcon(TextBoldFilled, TextBoldRegular)
export const IconItalic = bundleIcon(TextItalicFilled, TextItalicRegular)
export const IconUnderline = bundleIcon(TextUnderlineFilled, TextUnderlineRegular)
export const IconStrike = bundleIcon(TextStrikethroughFilled, TextStrikethroughRegular)
export const IconFont = bundleIcon(TextFontFilled, TextFontRegular)
export const IconFontSize = bundleIcon(TextFontSizeFilled, TextFontSizeRegular)
export const IconFormatPainter = bundleIcon(ClipboardBrushFilled, ClipboardBrushRegular)
export const IconBullets = bundleIcon(TextBulletListFilled, TextBulletListRegular)
export const IconNumbering = bundleIcon(TextNumberListLtrFilled, TextNumberListLtrRegular)
export const IconAlignLeft = bundleIcon(TextAlignLeftFilled, TextAlignLeftRegular)
export const IconAlignCenter = bundleIcon(TextAlignCenterFilled, TextAlignCenterRegular)
export const IconAlignRight = bundleIcon(TextAlignRightFilled, TextAlignRightRegular)
export const IconAlignJustify = bundleIcon(TextAlignJustifyFilled, TextAlignJustifyRegular)
export const IconLineSpacing = bundleIcon(TextLineSpacingFilled, TextLineSpacingRegular)
export const IconParagraph = bundleIcon(TextParagraphFilled, TextParagraphRegular)
export const IconSearch = bundleIcon(SearchFilled, SearchRegular)
export const IconUndo = bundleIcon(ArrowUndoFilled, ArrowUndoRegular)
export const IconRedo = bundleIcon(ArrowRedoFilled, ArrowRedoRegular)
export const IconNew = bundleIcon(DocumentAddFilled, DocumentAddRegular)
export const IconSave = bundleIcon(SaveFilled, SaveRegular)
export const IconExport = bundleIcon(DocumentArrowDownFilled, DocumentArrowDownRegular)
export const IconPrint = bundleIcon(PrintFilled, PrintRegular)
export const IconImport = bundleIcon(FolderOpenFilled, FolderOpenRegular)
export const IconSettings = bundleIcon(SettingsFilled, SettingsRegular)
export const IconClear = bundleIcon(DeleteFilled, DeleteRegular)
export const IconTable = bundleIcon(TableFilled, TableRegular)
export const IconPicture = bundleIcon(ImageFilled, ImageRegular)
export const IconShape = bundleIcon(ShapesFilled, ShapesRegular)
export const IconPageBreak = bundleIcon(DocumentPageBreakFilled, DocumentPageBreakRegular)
export const IconMargins = bundleIcon(DocumentMarginsFilled, DocumentMarginsRegular)
export const IconOrientation = bundleIcon(ResizeLargeFilled, ResizeLargeRegular)
export const IconColumns = bundleIcon(LayoutColumnTwoFilled, LayoutColumnTwoRegular)
export const IconToc = bundleIcon(BookOpenFilled, BookOpenRegular)
export const IconComment = bundleIcon(CommentFilled, CommentRegular)
export const IconSpellCheck = bundleIcon(TextGrammarCheckmarkFilled, TextGrammarCheckmarkRegular)
export const IconFootnote = bundleIcon(TextFootnoteFilled, TextFootnoteRegular)
export const IconWordCount = bundleIcon(TextWordCountFilled, TextWordCountRegular)
export const IconReadingView = bundleIcon(ReadingModeMobileFilled, ReadingModeMobileRegular)
export const IconRuler = bundleIcon(RulerFilled, RulerRegular)
export const IconGrid = bundleIcon(GridFilled, GridRegular)
export const IconCollapse = bundleIcon(ChevronLeftFilled, ChevronLeftRegular)
export const IconExpand = bundleIcon(ChevronRightFilled, ChevronRightRegular)
export const IconClose = bundleIcon(DismissFilled, DismissRegular)

/* 设置对话框用的一组 */
export const IconRename = bundleIcon(RenameFilled, RenameRegular)
export const IconKeyboard = bundleIcon(KeyboardFilled, KeyboardRegular)
export const IconDarkTheme = bundleIcon(DarkThemeFilled, DarkThemeRegular)
export const IconDocument = bundleIcon(DocumentFilled, DocumentRegular)
export const IconBook = bundleIcon(BookFilled, BookRegular)
export const IconDesktop = bundleIcon(DesktopFilled, DesktopRegular)
export const IconSun = bundleIcon(WeatherSunnyFilled, WeatherSunnyRegular)
export const IconMoon = bundleIcon(WeatherMoonFilled, WeatherMoonRegular)
