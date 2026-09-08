import type { SourceRange } from '@tyto/core';

/**
 * The markup as meaning, not as syntax (`docs/template-authoring.md`).
 *
 * The Lezer tree says where every character is; this says what the author asked for. The
 * two differ in the places the grammar had to bend for the tokenizer — a function name
 * that carries its own paren, a value that is a flat run of tokens, a close tag that has
 * to be checked against its opener — and in the one place the language is not a tree of
 * text: an attribute value is a string here and a slot reference, a colour or a path by
 * the time `build.ts` is done with it.
 *
 * Nothing in this file is validated. Whether `<frame>` may hold a `<frame>`, whether
 * `x` is an accepted property and whether `slot="titluo"` names anything are questions
 * for a manifest and an accepted-property list, and both arrive later.
 */

export interface TemplateAttribute {
  readonly name: string;
  /** Without the quotes. */
  readonly value: string;
  readonly range: SourceRange;
  readonly nameRange: SourceRange;
  /** Inside the quotes, so a diagnostic underlines the value and not the syntax. */
  readonly valueRange: SourceRange;
}

export interface TemplateElement {
  readonly tag: string;
  readonly attributes: readonly TemplateAttribute[];
  readonly children: readonly TemplateElement[];
  readonly range: SourceRange;
  readonly tagRange: SourceRange;
}

/**
 * One token of a declaration's value.
 *
 * A value is a flat list rather than a parsed structure because what it means depends on
 * the property: `700 72px/1.05 "Inter"` is a font, `0 4 12 #0008` is a shadow, and only
 * the reader for that property knows which is which.
 */
export type ValueToken =
  | {
      readonly kind: 'dimension';
      readonly text: string;
      readonly number: number;
      /** `''` for a plain number. */
      readonly unit: string;
      readonly range: SourceRange;
    }
  | { readonly kind: 'hex'; readonly text: string; readonly range: SourceRange }
  | { readonly kind: 'string'; readonly text: string; readonly range: SourceRange }
  | { readonly kind: 'ident'; readonly text: string; readonly range: SourceRange }
  | {
      readonly kind: 'call';
      readonly name: string;
      readonly args: readonly ValueToken[];
      readonly range: SourceRange;
    }
  | { readonly kind: 'slash'; readonly range: SourceRange }
  | { readonly kind: 'comma'; readonly range: SourceRange };

export type SelectorPart =
  | { readonly kind: 'class'; readonly name: string; readonly range: SourceRange }
  | { readonly kind: 'id'; readonly name: string; readonly range: SourceRange }
  | { readonly kind: 'tag'; readonly name: string; readonly range: SourceRange }
  | { readonly kind: 'root'; readonly range: SourceRange };

export interface Selector {
  readonly parts: readonly SelectorPart[];
  readonly range: SourceRange;
}

export interface StyleDeclaration {
  readonly property: string;
  readonly value: readonly ValueToken[];
  readonly range: SourceRange;
  readonly propertyRange: SourceRange;
  /** Empty-at-the-colon when the author wrote a property and no value. */
  readonly valueRange: SourceRange;
}

export interface StyleRule {
  readonly selectors: readonly Selector[];
  readonly declarations: readonly StyleDeclaration[];
  readonly range: SourceRange;
}

/** `@format story`, `@if slot(imagem) is empty`, `@each slide`. */
export interface AtRule {
  /** Without the `@`. */
  readonly keyword: string;
  readonly prelude: readonly ValueToken[];
  readonly rules: readonly StyleRule[];
  readonly range: SourceRange;
  readonly keywordRange: SourceRange;
  /** Covers the whole prelude; empty at the keyword's end when there is none. */
  readonly preludeRange: SourceRange;
}

export type StyleItem =
  | { readonly kind: 'rule'; readonly rule: StyleRule }
  | { readonly kind: 'at'; readonly at: AtRule };

export interface TemplateDocument {
  /** Top-level elements, in source order. Every one of them should be a `<frame>`. */
  readonly elements: readonly TemplateElement[];
  /** The declarations of every `<style>` block, concatenated in source order. */
  readonly styles: readonly StyleItem[];
  readonly range: SourceRange;
}
