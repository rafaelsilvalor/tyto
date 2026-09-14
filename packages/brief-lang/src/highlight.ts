import { styleTags, tags } from '@lezer/highlight';

/**
 * What each node looks like in the editor (E8.1).
 *
 * It lives with the grammar rather than with the editor so that adding a node to the
 * language and forgetting to colour it is one file's problem, not two packages'. The
 * package stays pure: `@lezer/highlight` maps node names to tags and renders nothing.
 *
 * Two rules of Lezer shape every line below, and both are silent when broken — which is
 * why `highlight.test.ts` reads the output rather than this table.
 *
 * **Only a capitalised rule produces a node.** `directiveMark`, `braceOpen`, `valueSep`
 * and the rest are lowercase tokens: they are real characters in the document and no name
 * in the tree, so a rule spelled after them matches nothing and colours nothing. The
 * punctuation of a construct is therefore styled through the construct — a tag on
 * `Adjustments` paints whatever inside it no child node covers, which is exactly the
 * braces, the commas and the colons.
 *
 * **A tag stops at the first child unless it says `/...`.** `Bold: tags.strong` bolds the
 * two `**` and leaves the `Text` between them at normal weight, because `Text` is a node
 * of its own. `Bold/...` reaches the whole run, and a nested `Italic` still adds its own
 * tag on top.
 */
export const briefHighlighting = styleTags({
  Frontmatter: tags.meta,
  Comment: tags.lineComment,

  Name: tags.definitionKeyword,
  Namespace: tags.namespace,
  // The `::`, and the line break that ends the directive — the two parts of it no child
  // node covers. The break has no glyph, so styling it changes nothing on screen.
  Directive: tags.punctuation,

  // `{`, `,` and `}` belong to the list; the `:` is one level down, inside a pair. Two
  // rules rather than `Adjustments/...`, because an inherited tag *adds* to the child's
  // own — `cor` would come out `punctuation attributeName` and which colour won would be
  // a question about stylesheet order.
  Adjustments: tags.punctuation,
  Adjustment: tags.punctuation,
  AdjustmentName: tags.attributeName,
  AdjustmentValue: tags.attributeValue,

  // A mark is the same pair of braces around the same pair of names, but its body is
  // ordinary text — so this one must *not* reach its descendants, or `{cor:azul}oi{/}`
  // would paint `oi` as punctuation.
  Mark: tags.punctuation,
  MarkName: tags.attributeName,
  MarkValue: tags.attributeValue,

  'Bold/...': tags.strong,
  'Italic/...': tags.emphasis,
  Break: tags.escape,
  EscapedDirective: tags.escape,
});
