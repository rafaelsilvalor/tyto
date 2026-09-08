import { styleTags, tags } from '@lezer/highlight';

/**
 * What each node looks like in the editor (E8.4).
 *
 * It lives with the grammar rather than with the editor so that adding a node to the
 * language and forgetting to colour it is one file's problem, not two packages'. The
 * package stays pure: `@lezer/highlight` maps node names to tags and renders nothing.
 *
 * The five identifier-shaped tokens are what makes this worth shipping. A tag, an
 * attribute, a selector, a property and a bare word in a value are the same characters,
 * and the grammar already decided which is which — an editor colouring them from a regex
 * would have to make that decision a second time, and worse.
 */
export const templateHighlighting = styleTags({
  TagName: tags.tagName,
  'CloseTag/TagName': tags.tagName,
  AttributeName: tags.attributeName,
  AttributeValue: tags.attributeValue,

  Comment: tags.blockComment,
  BlockComment: tags.blockComment,

  AtKeyword: tags.definitionKeyword,
  PropertyName: tags.propertyName,
  'ClassSelector/SelectorName': tags.className,
  'IdSelector/SelectorName': tags.labelName,
  'TagSelector/SelectorName': tags.tagName,
  RootSelector: tags.keyword,

  FunctionName: tags.function(tags.variableName),
  Ident: tags.atom,
  Dimension: tags.number,
  HexColor: tags.color,
  StringValue: tags.string,

  'tagStart tagEnd closeStart selfClose styleStart styleEnd': tags.angleBracket,
  'braceOpen braceClose parenClose': tags.brace,
  'colon semi Comma Slash equals': tags.punctuation,
  'dot hash': tags.derefOperator,
});
