import { type Diagnostic, type SourceRange, diagnostic, didYouMean } from '@tyto/core';

/**
 * What the template language accepts, and what to say when it does not.
 *
 * `docs/template-authoring.md` lists the tags, the attributes and the CSS properties; this
 * is that list as code, and the only place any of the three is enumerated. A refusal here
 * always carries a suggestion, because the whole reason the subset is small is that an
 * author can be told what to write instead — "not supported" on its own would make the
 * restriction a guessing game.
 *
 * The aliases are the other half of that. Nobody arrives at this language without CSS in
 * their fingers, and `width`, `background` and `border-radius` are not typos of anything:
 * edit distance will never find `w`, `fill` or `radius` from them, so they are mapped by
 * hand.
 */

export const TAGS = ['frame', 'group', 'rect', 'text', 'image', 'vector'] as const;
export type TagName = (typeof TAGS)[number];

/**
 * Tags that are written and never drawn.
 *
 * `<define>` and `<use>` are resolved away by `components.ts` before anything asks `isTag`
 * a question, so they are not `TagName`s — no node is ever built from one. They are here
 * because a misspelled `<usse>` has to be answered with `use` and not with the drawable
 * six, and this is the only place any tag name is enumerated.
 */
export const STRUCTURAL_TAGS = ['define', 'use'] as const;

export function isTag(name: string): name is TagName {
  return (TAGS as readonly string[]).includes(name);
}

/** Attributes every drawable node takes; a frame is not a node and takes its own set. */
const NODE_ATTRIBUTES = ['id', 'class', 'name', 'opacity', 'blend', 'mask', 'clip'] as const;

export const ATTRIBUTES: Readonly<Record<TagName, readonly string[]>> = {
  // `format` and `bg` were missing from the list in `docs/template-authoring.md` while its
  // own example used both; TYTO-24 settled it by adding them here and to the doc.
  frame: ['format', 'extends', 'bg', 'id', 'class'],
  group: NODE_ATTRIBUTES,
  rect: NODE_ATTRIBUTES,
  text: [...NODE_ATTRIBUTES, 'slot'],
  image: [...NODE_ATTRIBUTES, 'slot', 'src', 'fit'],
  vector: [...NODE_ATTRIBUTES, 'src'],
};

export const PROPERTIES = [
  'x',
  'y',
  'w',
  'h',
  'rotation',
  'anchor',
  'font',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'color',
  'text-align',
  'vertical-align',
  'overflow',
  'fill',
  'stroke',
  'radius',
  'opacity',
  'mix-blend-mode',
  'shadow',
  'blur',
  'visible',
] as const;
export type PropertyName = (typeof PROPERTIES)[number];

export function isProperty(name: string): name is PropertyName {
  return (PROPERTIES as readonly string[]).includes(name);
}

/** A custom property. They are variables, not fields of a node, and only `:root` sets them. */
export function isCustomProperty(name: string): boolean {
  return name.startsWith('--');
}

/**
 * The CSS an author already knows, mapped to what this language calls it.
 *
 * Only for properties no edit distance could reach. `font-family` is deliberately absent
 * in the other direction: it maps to `font`, which is the shorthand that carries it.
 */
const PROPERTY_ALIASES: Readonly<Record<string, string>> = {
  width: 'w',
  height: 'h',
  left: 'x',
  top: 'y',
  transform: 'x, y and rotation',
  'transform-origin': 'anchor',
  background: 'fill',
  'background-color': 'fill',
  'font-family': 'font',
  'font-style': 'the brief’s *italic*',
  'border-radius': 'radius',
  'box-shadow': 'shadow',
  'text-shadow': 'shadow',
  filter: 'blur',
  'backdrop-filter': 'blur',
  display: 'visible',
  visibility: 'visible',
  'text-overflow': 'overflow',
  'align-items': 'vertical-align',
  'stroke-width': 'stroke',
  content: 'the slot="…" attribute',
  position: 'x and y',
  margin: 'x and y',
  padding: 'x, y, w and h',
  'z-index': 'the order of the tags',
};

const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  style: 'class',
  href: 'src',
  'object-fit': 'fit',
  width: 'the w property in <style>',
  height: 'the h property in <style>',
  x: 'the x property in <style>',
  y: 'the y property in <style>',
};

const TAG_ALIASES: Readonly<Record<string, string>> = {
  div: 'group',
  span: 'text',
  p: 'text',
  h1: 'text',
  h2: 'text',
  h3: 'text',
  img: 'image',
  svg: 'vector',
  section: 'group',
  body: 'frame',
  canvas: 'frame',
};

/**
 * The nearest accepted name, and the whole list when nothing is near.
 *
 * A wrong suggestion is worse than none, so `didYouMean` stays strict; what replaces it is
 * the complete set rather than silence, because an author who wrote something unrelated
 * needs the vocabulary and not a hedge.
 */
function suggestionFor(
  written: string,
  accepted: readonly string[],
  aliases: Readonly<Record<string, string>>,
): string {
  return aliases[written.toLowerCase()] ?? didYouMean(written, accepted) ?? accepted.join(' ');
}

export function unsupportedTag(tag: string, range: SourceRange): Diagnostic {
  return diagnostic(
    'E_UNSUPPORTED_TAG',
    { tag, suggestion: suggestionFor(tag, [...TAGS, ...STRUCTURAL_TAGS], TAG_ALIASES) },
    { range },
  );
}

export function unsupportedAttribute(
  attribute: string,
  tag: TagName,
  range: SourceRange,
): Diagnostic {
  return diagnostic(
    'E_UNSUPPORTED_ATTRIBUTE',
    { attribute, tag, suggestion: suggestionFor(attribute, ATTRIBUTES[tag], ATTRIBUTE_ALIASES) },
    { range },
  );
}

export function unsupportedProperty(property: string, range: SourceRange): Diagnostic {
  return diagnostic(
    'E_UNSUPPORTED_CSS',
    { property, suggestion: suggestionFor(property, PROPERTIES, PROPERTY_ALIASES) },
    { range },
  );
}

export function markupProblem(problem: string, range?: SourceRange): Diagnostic {
  return diagnostic('E_TEMPLATE_MARKUP', { problem }, range === undefined ? {} : { range });
}

export function badValue(field: string, problem: string, range?: SourceRange): Diagnostic {
  return diagnostic('E_TEMPLATE_VALUE', { field, problem }, range === undefined ? {} : { range });
}

/**
 * The alias for a written name, but only when the alias is itself a name the language
 * accepts.
 *
 * The tables above serve two readers with one entry each. A *message* can say anything —
 * `transform` maps to "x, y and rotation" and `content` to "the slot=… attribute", and both
 * are the right thing to tell an author. A *quick fix* has to be one word it can put in the
 * document, so it gets the entries that are one word and nothing else.
 *
 * Filtered here rather than in the editor, because what counts as an accepted name is this
 * file's question and answering it anywhere else would be a second copy of the vocabulary
 * (TYTO-92).
 */
export function propertyAlias(written: string): PropertyName | undefined {
  const alias = PROPERTY_ALIASES[written.toLowerCase()];
  return alias !== undefined && isProperty(alias) ? alias : undefined;
}

export function tagAlias(written: string): string | undefined {
  const alias = TAG_ALIASES[written.toLowerCase()];
  if (alias === undefined) return undefined;
  return isTag(alias) || (STRUCTURAL_TAGS as readonly string[]).includes(alias) ? alias : undefined;
}

/** An attribute alias is accepted only where the tag in question actually takes it. */
export function attributeAlias(written: string, tag: TagName): string | undefined {
  const alias = ATTRIBUTE_ALIASES[written.toLowerCase()];
  return alias !== undefined && ATTRIBUTES[tag].includes(alias) ? alias : undefined;
}
