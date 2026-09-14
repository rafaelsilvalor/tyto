/**
 * @tyto/editor — CodeMirror 6 for the brief and template languages.
 *
 * DOM only: no Node imports, because the Electron renderer runs with
 * nodeIntegration: false.
 *
 * E8.1 is the brief language, its colours, folding and the two themes. E8.2 adds the lint
 * markers and the manifest-driven completion, both fed by one `BriefAnalyzer` the host
 * supplies. The template language (E8.4) becomes a second `LanguageSupport` beside
 * `brief()`.
 */

export { brief, briefLanguage } from './brief-language.js';

export { createEditor, type EditorHandle, type EditorOptions } from './editor.js';

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
