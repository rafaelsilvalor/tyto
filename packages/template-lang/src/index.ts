/**
 * @tyto/template-lang — the HTML-like template markup (ADR 0005).
 *
 * `compileTemplate` is the whole surface most callers want: markup plus a manifest in, a
 * `Template` out, of exactly the shape `compile` already takes from a `template.ts`. The
 * parser and the AST are exported beside it because the editor (E8.4) needs the tree and
 * the diagnostics without ever building a scene.
 *
 * Pure: no Node, no DOM (ADR 0010). A template folder is read by whoever owns a
 * filesystem; this package is handed the text.
 */

export type {
  AtRule,
  Selector,
  SelectorPart,
  StyleDeclaration,
  StyleItem,
  StyleRule,
  TemplateAttribute,
  TemplateDocument,
  TemplateElement,
  ValueToken,
} from './ast.js';

export {
  type CompileTemplateOptions,
  type HtmlTemplate,
  type TemplateAssets,
  compileTemplate,
} from './compile-template.js';

export { parseAttributeValue, parseTemplate } from './parse-template.js';

export { parser } from './template.parser.js';

export { templateHighlighting } from './highlight.js';

export {
  ATTRIBUTES,
  PROPERTIES,
  TAGS,
  type PropertyName,
  type TagName,
  isProperty,
  isTag,
} from './vocabulary.js';
