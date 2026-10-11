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
  ChevronDownFilled,
  ChevronDownRegular,
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
  WeatherMoonFilled,
  ClipboardPasteFilled,
  ClipboardPasteRegular,
  CutFilled,
  CutRegular,
  CopyFilled,
  CopyRegular,
  FontIncreaseFilled,
  FontIncreaseRegular,
  FontDecreaseFilled,
  FontDecreaseRegular,
  TextClearFormattingFilled,
  TextClearFormattingRegular,
  TextSubscriptFilled,
  TextSubscriptRegular,
  TextSuperscriptFilled,
  TextSuperscriptRegular,
  TextEffectsFilled,
  TextEffectsRegular,
  HighlightFilled,
  HighlightRegular,
  TextColorFilled,
  TextColorRegular,
  TextListAbcUppercaseLtrFilled,
  TextListAbcUppercaseLtrRegular,
  TextIndentDecreaseFilled,
  TextIndentDecreaseRegular,
  TextIndentIncreaseFilled,
  TextIndentIncreaseRegular,
  ArrowSortFilled,
  ArrowSortRegular,
  TextGrammarWandFilled,
  TextGrammarWandRegular,
  PaintBucketFilled,
  PaintBucketRegular,
  BorderAllFilled,
  BorderAllRegular,
  ArrowSwapFilled,
  ArrowSwapRegular,
  CursorFilled,
  CursorRegular,
  LinkFilled,
  LinkRegular,
  BookmarkFilled,
  BookmarkRegular,
  BookmarkMultipleFilled,
  BookmarkMultipleRegular,
  EmojiFilled,
  EmojiRegular,
  CubeFilled,
  CubeRegular,
  ChartMultipleFilled,
  ChartMultipleRegular,
  FlowchartFilled,
  FlowchartRegular,
  ScreenshotFilled,
  ScreenshotRegular,
  PuzzlePieceFilled,
  PuzzlePieceRegular,
  VideoFilled,
  VideoRegular,
  MusicNote2Filled,
  MusicNote2Regular,
  DocumentOnePageFilled,
  DocumentOnePageRegular,
  DocumentOnePageAddFilled,
  DocumentOnePageAddRegular,
  DocumentHeaderFilled,
  DocumentHeaderRegular,
  DocumentFooterFilled,
  DocumentFooterRegular,
  DocumentPageNumberFilled,
  DocumentPageNumberRegular,
  TextboxFilled,
  TextboxRegular,
  DropFilled,
  DropRegular,
  SignatureFilled,
  SignatureRegular,
  CalendarFilled,
  CalendarRegular,
  SelectObjectFilled,
  SelectObjectRegular,
  MathFormulaFilled,
  MathFormulaRegular,
  SymbolsFilled,
  SymbolsRegular,
  ResizeFilled,
  ResizeRegular,
  NumberSymbolSquareFilled,
  NumberSymbolSquareRegular,
  AlignStraightenFilled,
  AlignStraightenRegular,
  GroupFilled,
  GroupRegular,
  ArrowRotateClockwiseFilled,
  ArrowRotateClockwiseRegular,
  PositionToFrontFilled,
  PositionToFrontRegular,
  PositionToBackFilled,
  PositionToBackRegular,
  TextPositionSquareFilled,
  TextPositionSquareRegular,
  PanelLeftFilled,
  PanelLeftRegular,
  PaddingTopFilled,
  PaddingTopRegular,
  PaddingDownFilled,
  PaddingDownRegular,
  TextWrapFilled,
  TextWrapRegular,
  SaveCopyFilled,
  SaveCopyRegular,
  SendFilled,
  SendRegular,
  TextProofingToolsFilled,
  TextProofingToolsRegular
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

/* 下拉框与分割按钮右侧那个小箭头。用 Chevron（细）而不是 Caret/Triangle（实心块）：
   真 Word 功能区里那两种箭头都是细线，实心三角看起来像十几年前的控件。 */
export const IconCaretDown = bundleIcon(ChevronDownFilled, ChevronDownRegular)
export const IconClose = bundleIcon(DismissFilled, DismissRegular)

/* 「开始」页补密度用到的一组（剪贴板 / 字体 / 段落 / 编辑）。
   名字同样是从包里枚举核对过的，不是想当然——`TextColor` 这类看着该有的名字确实有，
   而 `FontColor`、`Shading`、`MultilevelList` 这些看着更顺的名字反而没有。 */
export const IconPaste = bundleIcon(ClipboardPasteFilled, ClipboardPasteRegular)
export const IconCut = bundleIcon(CutFilled, CutRegular)
export const IconCopy = bundleIcon(CopyFilled, CopyRegular)
export const IconFontGrow = bundleIcon(FontIncreaseFilled, FontIncreaseRegular)
export const IconFontShrink = bundleIcon(FontDecreaseFilled, FontDecreaseRegular)
export const IconClearFormat = bundleIcon(TextClearFormattingFilled, TextClearFormattingRegular)
export const IconSubscript = bundleIcon(TextSubscriptFilled, TextSubscriptRegular)
export const IconSuperscript = bundleIcon(TextSuperscriptFilled, TextSuperscriptRegular)
export const IconTextEffects = bundleIcon(TextEffectsFilled, TextEffectsRegular)
export const IconHighlight = bundleIcon(HighlightFilled, HighlightRegular)
export const IconFontColor = bundleIcon(TextColorFilled, TextColorRegular)
export const IconMultiLevelList = bundleIcon(
  TextListAbcUppercaseLtrFilled,
  TextListAbcUppercaseLtrRegular
)
export const IconIndentDecrease = bundleIcon(TextIndentDecreaseFilled, TextIndentDecreaseRegular)
export const IconIndentIncrease = bundleIcon(TextIndentIncreaseFilled, TextIndentIncreaseRegular)
export const IconSort = bundleIcon(ArrowSortFilled, ArrowSortRegular)
export const IconShowMarks = bundleIcon(TextGrammarWandFilled, TextGrammarWandRegular)
export const IconShading = bundleIcon(PaintBucketFilled, PaintBucketRegular)
export const IconBorders = bundleIcon(BorderAllFilled, BorderAllRegular)
export const IconReplace = bundleIcon(ArrowSwapFilled, ArrowSwapRegular)
export const IconSelect = bundleIcon(CursorFilled, CursorRegular)

/* 「插入」页用到的一组。
   名字同样逐个枚举核对过。几个换过名的：查不到 `CoverPage`，封面用的是 `DocumentOnePage`；
   查不到 `BlankPage`，空白页用 `DocumentOnePageAdd`；查不到 `Object`，对象用 `SelectObject`。 */
export const IconCoverPage = bundleIcon(DocumentOnePageFilled, DocumentOnePageRegular)
export const IconBlankPage = bundleIcon(DocumentOnePageAddFilled, DocumentOnePageAddRegular)
export const IconIcons = bundleIcon(EmojiFilled, EmojiRegular)
export const Icon3DModel = bundleIcon(CubeFilled, CubeRegular)
export const IconChart = bundleIcon(ChartMultipleFilled, ChartMultipleRegular)
export const IconSmartArt = bundleIcon(FlowchartFilled, FlowchartRegular)
export const IconScreenshot = bundleIcon(ScreenshotFilled, ScreenshotRegular)
export const IconAddin = bundleIcon(PuzzlePieceFilled, PuzzlePieceRegular)
export const IconVideo = bundleIcon(VideoFilled, VideoRegular)
export const IconAudio = bundleIcon(MusicNote2Filled, MusicNote2Regular)
export const IconHyperlink = bundleIcon(LinkFilled, LinkRegular)
export const IconBookmark = bundleIcon(BookmarkFilled, BookmarkRegular)
export const IconCrossRef = bundleIcon(BookmarkMultipleFilled, BookmarkMultipleRegular)
export const IconHeader = bundleIcon(DocumentHeaderFilled, DocumentHeaderRegular)
export const IconFooter = bundleIcon(DocumentFooterFilled, DocumentFooterRegular)
export const IconPageNumber = bundleIcon(DocumentPageNumberFilled, DocumentPageNumberRegular)
export const IconTextbox = bundleIcon(TextboxFilled, TextboxRegular)
export const IconDropCap = bundleIcon(DropFilled, DropRegular)
export const IconSignature = bundleIcon(SignatureFilled, SignatureRegular)
export const IconDateTime = bundleIcon(CalendarFilled, CalendarRegular)
export const IconObject = bundleIcon(SelectObjectFilled, SelectObjectRegular)
export const IconFormula = bundleIcon(MathFormulaFilled, MathFormulaRegular)
export const IconSymbols = bundleIcon(SymbolsFilled, SymbolsRegular)

/* 「布局」页用到的一组。 */
export const IconPaperSize = bundleIcon(ResizeFilled, ResizeRegular)
export const IconLineNumbers = bundleIcon(NumberSymbolSquareFilled, NumberSymbolSquareRegular)
export const IconHyphenation = bundleIcon(TextProofingToolsFilled, TextProofingToolsRegular)
export const IconSpaceBefore = bundleIcon(PaddingTopFilled, PaddingTopRegular)
export const IconSpaceAfter = bundleIcon(PaddingDownFilled, PaddingDownRegular)
export const IconPosition = bundleIcon(TextPositionSquareFilled, TextPositionSquareRegular)
export const IconWrapText = bundleIcon(TextWrapFilled, TextWrapRegular)
export const IconBringForward = bundleIcon(PositionToFrontFilled, PositionToFrontRegular)
export const IconSendBackward = bundleIcon(PositionToBackFilled, PositionToBackRegular)
export const IconSelectionPane = bundleIcon(PanelLeftFilled, PanelLeftRegular)
export const IconAlignObjects = bundleIcon(AlignStraightenFilled, AlignStraightenRegular)
export const IconGroupObjects = bundleIcon(GroupFilled, GroupRegular)
export const IconRotate = bundleIcon(ArrowRotateClockwiseFilled, ArrowRotateClockwiseRegular)

/* 「文件」页补充的几个。 */
export const IconSaveAs = bundleIcon(SaveCopyFilled, SaveCopyRegular)
export const IconShare = bundleIcon(SendFilled, SendRegular)

/* 设置对话框用的一组 */
export const IconRename = bundleIcon(RenameFilled, RenameRegular)
export const IconKeyboard = bundleIcon(KeyboardFilled, KeyboardRegular)
export const IconDarkTheme = bundleIcon(DarkThemeFilled, DarkThemeRegular)
export const IconDocument = bundleIcon(DocumentFilled, DocumentRegular)
export const IconBook = bundleIcon(BookFilled, BookRegular)
export const IconDesktop = bundleIcon(DesktopFilled, DesktopRegular)
export const IconSun = bundleIcon(WeatherSunnyFilled, WeatherSunnyRegular)
export const IconMoon = bundleIcon(WeatherMoonFilled, WeatherMoonRegular)
