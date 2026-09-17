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

export {
  createEditor,
  type EditorHandle,
  type EditorOptions,
  type EditorState,
  type LanguageName,
  type ScrollPosition,
  textOf,
} from './editor.js';

export { briefDarkTheme, briefLightTheme, type ThemeName, themes } from './theme.js';

export {
  type BriefAnalysis,
  type BriefAnalyzer,
  type BriefAnalyzerOptions,
  briefAnalysisField,
  createBriefAnalyzer,
  setBriefAnalysis,
} from './analysis.js';

export { BRIEF_LINT_DELAY, type BriefLintOptions, briefLint, suggestionFor } from './lint.js';

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
  EDITOR_RENDER,
  EDITOR_SAVE,
  defaultKeymapSet,
  keymapExtension,
  keymapSets,
  vimKeymapSet,
} from './keymap.js';

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

export { type VimExCommand, type VimModeOptions, defaultExCommands, vimMode } from './vim-mode.js';

export { template, templateLanguage } from './template-language.js';

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
