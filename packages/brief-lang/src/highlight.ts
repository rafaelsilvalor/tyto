import { styleTags, tags } from '@lezer/highlight';

/**
 * What each node looks like in the editor (E8.1).
 *
 * It lives with the grammar rather than with the editor so that adding a node to the
 * language and forgetting to colour it is one file's problem, not two packages'. The
 * package stays pure: `@lezer/highlight` maps node names to tags and renders nothing.
 */
export const briefHighlighting = styleTags({
  Frontmatter: tags.meta,
  Comment: tags.lineComment,

  Name: tags.definitionKeyword,
  Namespace: tags.namespace,
  'Directive/directiveMark': tags.punctuation,

  AdjustmentName: tags.attributeName,
  AdjustmentValue: tags.attributeValue,

  MarkName: tags.attributeName,
  MarkValue: tags.attributeValue,

  Bold: tags.strong,
  Italic: tags.emphasis,
  Break: tags.escape,
  EscapedDirective: tags.escape,

  'braceOpen braceClose markClose boldMark italicMark': tags.processingInstruction,
  'adjustmentSep valueSep': tags.separator,
});
