/**
 * @tyto/editor — CodeMirror 6 for the brief and template languages.
 *
 * DOM only: no Node imports, because the Electron renderer runs with
 * nodeIntegration: false.
 *
 * E8.1 is the brief language, its colours, folding and the two themes. E8.2 adds the lint
 * markers and the manifest-driven completion, both fed by one `BriefAnalyzer` the host
 * supplies. E8.3 is the command registry, the keymap layer and vim mode. E8.4 is the second
 * language: `template()` beside `brief()`, with its own analyzer, linter and completion.
 */

export { brief, briefLanguage } from './brief-language.js';

export { type MarkedDiagnostic } from './diagnostic-markers.js';

export {
  createEditor,
  type CursorPosition,
  cursorOf,
  type EditorHandle,
  type EditorOptions,
  type EditorPane,
  type EditorState,
  hasBeenEdited,
  type LanguageName,
  type ScrollPosition,
  type SelectionRange,
  selectionOf,
  textOf,
  withDiagnostics,
  withSelection,
} from './editor.js';

export { isFollower } from './mirror.js';

export {
  activeGuide,
  type GuideRun,
  guideRuns,
  indentColumns,
  indentGuides,
  indentLevels,
} from './indent-guides.js';

export {
  BRIEF_COLUMN_STYLES,
  type BriefColumnStyle,
  type Column,
  type ColumnMarks,
  DEFAULT_BRIEF_COLUMNS,
  briefColumns,
  columnMarks,
} from './columns.js';

export { remeasureText } from './remeasure.js';

export { LINE_NUMBERS_STYLES, type LineNumbersStyle, relativeLineNumber } from './line-numbers.js';

export {
  STICKY_MAX_ROWS,
  type StickyBlock,
  type StickyMeasure,
  type StickyRow,
  stickyChain,
  stickyRows,
  stickyScroll,
} from './sticky-scroll.js';

export {
  BLOCK_TEXT_LENGTH,
  type BlockManifest,
  type BriefBlock,
  blockAt,
  blocksOf,
  briefBlocks,
  previewBlock,
} from './brief-blocks.js';

export { type Breadcrumb, breadcrumbAt, breadcrumbOf, directiveLabel } from './breadcrumb.js';

export {
  DEFAULT_TAB_SIZE,
  MAX_TAB_SIZE,
  MIN_TAB_SIZE,
  formatBriefInView,
  indentExtension,
} from './format-brief.js';

export { briefDarkTheme, briefLightTheme, type ThemeName, themes, themeTokens } from './theme.js';

export {
  type BriefAnalysis,
  type EditorDirectives,
  type BriefAnalyzer,
  type BriefAnalyzerOptions,
  briefAnalysisField,
  createBriefAnalyzer,
  setBriefAnalysis,
} from './analysis.js';

export {
  BRIEF_LINT_DELAY,
  type BriefLintOptions,
  briefLint,
  relintBrief,
  suggestionFor,
} from './lint.js';

export { briefCompletion, completeBrief } from './completion.js';

export {
  type AnalysisEndpoint,
  createWorkerAnalyzer,
  serveBriefAnalysis,
} from './worker-analyzer.js';

export {
  type CommandContext,
  type CommandRegistry,
  type CommandStep,
  type EditorCommand,
  EDITOR_REDO,
  EDITOR_UNDO,
  commandRegistryFacet,
  commandRegistryOf,
  createCommandRegistry,
} from './commands.js';

export {
  type CommandBinding,
  type EditorKeymap,
  EDITOR_SPLIT_DOWN,
  EDITOR_SPLIT_RIGHT,
  EDITOR_SAVE,
  defaultKeymapSet,
  keymapExtension,
  keymapSets,
  vimKeymapSet,
} from './keymap.js';

export {
  type KeyStroke,
  type Keybinding,
  type KeybindingContext,
  type KeybindingEntry,
  type KeybindingInput,
  type KeybindingLayer,
  type KeybindingSource,
  type KeybindingTable,
  type ParsedKey,
  type ResolvedKeybindings,
  COMMAND_BAR_KEY,
  COMMAND_BAR_TOGGLE,
  EDITOR_CONTEXTS,
  KEYBINDING_CONTEXTS,
  KEYBINDING_CONTEXT_DESCRIPTIONS,
  bindingsOf,
  concreteKey,
  keyOfStroke,
  keybindingsOf,
  keymapSetFor,
  parseKey,
  resolveKeybindings,
  shownBindingsOf,
  windowBindingsOf,
} from './keybindings.js';

export {
  type SearchPhraseKey,
  type SearchPhrases,
  EDITOR_FIND,
  EDITOR_FIND_NEXT,
  EDITOR_FIND_PREVIOUS,
  EDITOR_GOTO_LINE,
  EDITOR_REPLACE_ALL,
  EDITOR_REPLACE_NEXT,
  SEARCH_PHRASE_KEYS,
} from './search.js';

export {
  type VimExCommand,
  type VimModeOptions,
  type VimStatus,
  defaultExCommands,
  vimMode,
} from './vim-mode.js';

export { template, templateLanguage } from './template-language.js';

export { json, jsonLanguage } from './json-language.js';

export { markdown, markdownLanguage } from './markdown-language.js';

export { escapeHtml, MARKDOWN_TAGS, markdownToHtml } from './markdown-html.js';
export {
  type JsonAssistSource,
  type JsonCompletionAnswer,
  type JsonHoverAnswer,
  type JsonSuggestion,
  jsonAssist,
} from './json-assist.js';

export {
  type TemplateAnalysis,
  type TemplateAnalyzer,
  type TemplateAnalyzerOptions,
  createTemplateAnalyzer,
  setTemplateAnalysis,
  templateAnalysisField,
} from './template-analysis.js';

export { type TemplateLintOptions, templateLint, templateSuggestionFor } from './template-lint.js';

export { completeTemplate, templateCompletion } from './template-completion.js';

export {
  type SkeletonManifest,
  briefSkeleton,
  inSkeleton,
  insertBriefSkeleton,
  skeletonText,
} from './skeleton.js';

export {
  type SlashItem,
  type SlashSource,
  completeSlash,
  openSlashMenu,
  slashCompletion,
  slashRequested,
} from './slash.js';

export {
  type BriefSnippet,
  type SnippetBodyProblem,
  type SnippetTranslation,
  briefSnippets,
  completeSnippets,
  snippetTemplate,
  snippetsFor,
  snippetsSlashSource,
  tabThroughCompletions,
} from './snippets.js';
