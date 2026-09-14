import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  autocompletion,
} from '@codemirror/autocomplete';
import { type EditorState, type Extension } from '@codemirror/state';
import { type TemplateManifest } from '@tyto/core';

import { type BriefAnalysis, briefAnalysisField } from './analysis.js';
import { briefLanguage } from './brief-language.js';

/**
 * Completion driven by the active template's manifest.
 *
 * Slot names and enum values are the template author's vocabulary and may be in any
 * language (`docs/brief-language.md`), so there is no list to hard-code here: everything
 * offered comes out of the `TemplateManifest` the frontmatter named, which is why changing
 * `template:` swaps every list in the file. The manifest arrives through the analysis field
 * that `briefLint` publishes — the same pass that produced the squiggles — so the two can
 * never disagree about which template is active.
 */

/** What the author has typed so far of the thing being completed. */
interface Written {
  readonly text: string;
}

/** Everything after the last `,` in an adjustment list is the item being written. */
const lastListItem = (inside: string): string => inside.split(',').at(-1) ?? '';

/**
 * The closing `---` of the frontmatter, by line number.
 *
 * `undefined` when there is none, which follows the language rather than guessing at it:
 * "Without a closing fence there is no frontmatter, and every line of the block is
 * reported" (`docs/brief-language.md`). A brief being typed from scratch therefore gets no
 * frontmatter completion until the fence is closed — the alternative is a second reader of
 * the syntax that disagrees with the parser about where the block ends, which is the thing
 * this package exists not to do.
 */
const frontmatterEnd = (state: EditorState): number | undefined => {
  if (state.doc.lines < 2) return undefined;
  if (state.doc.line(1).text.trim() !== '---') return undefined;
  for (let line = 2; line <= state.doc.lines; line += 1) {
    if (state.doc.line(line).text.trim() === '---') return line;
  }
  return undefined;
};

const slotOption = (name: string, manifest: TemplateManifest): Completion => {
  const slot = manifest.slots[name];
  const notes = [
    slot?.type,
    slot?.required === true ? 'required' : undefined,
    slot?.repeat === true ? 'repeat' : undefined,
  ].filter((note): note is string => note !== undefined);
  return { label: name, type: 'property', detail: notes.join(' · ') };
};

const adjustmentOption = (name: string, manifest: TemplateManifest): Completion => {
  const type = manifest.adjustments[name]?.type;
  // Spread rather than assign: `exactOptionalPropertyTypes` reads an explicit `undefined`
  // as a different thing from an absent key, and `Completion.detail` is optional.
  return { label: name, type: 'property', ...(type === undefined ? {} : { detail: type }) };
};

const valueOption = (value: string): Completion => ({ label: value, type: 'enum' });

const result = (
  context: CompletionContext,
  written: Written,
  options: readonly Completion[],
): CompletionResult | null => {
  if (options.length === 0) return null;
  return {
    from: context.pos - written.text.length,
    options: [...options],
    // Every name the brief language can write is this shape, so CodeMirror keeps filtering
    // the list as the author types instead of asking for it again on each keystroke.
    validFor: /^[a-zA-Z0-9_-]*$/u,
  };
};

/**
 * Inside the frontmatter: `template`, `formats`, and any enum slot set as a scalar.
 *
 * The frontmatter and a `::directive` set the same slots — "they differ in where the value
 * came from and in nothing else" (`docs/brief-language.md`) — so an enum slot completes
 * here exactly as it would in an adjustment.
 */
const completeFrontmatter = (
  context: CompletionContext,
  before: string,
  analysis: BriefAnalysis,
): CompletionResult | null => {
  const manifest = analysis.manifest;

  const template = /^\s*template\s*:\s*([a-zA-Z0-9_-]*)$/u.exec(before);
  if (template) {
    return result(
      context,
      { text: template[1] ?? '' },
      analysis.templates.map((name) => ({ label: name, type: 'class' })),
    );
  }

  if (manifest === undefined) return null;

  // `formats: [feed, st` — a YAML flow sequence, completed item by item. The optional `[`
  // is what tells this apart from the generic `key: value` below, which would otherwise
  // match the same line.
  const formats = /^\s*formats\s*:\s*(?:\[)?(?:[^[\]]*,)?\s*([a-zA-Z0-9_-]*)$/u.exec(before);
  if (formats) {
    return result(context, { text: formats[1] ?? '' }, manifest.formats.map(valueOption));
  }

  const scalar = /^\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*([a-zA-Z0-9_-]*)$/u.exec(before);
  if (scalar) {
    const slot = manifest.slots[scalar[1] ?? ''];
    if (slot?.type === 'enum' && slot.values !== undefined) {
      return result(context, { text: scalar[2] ?? '' }, slot.values.map(valueOption));
    }
  }

  return null;
};

/**
 * In the body: a directive name after `::`, then whatever the adjustment list wants.
 *
 * `::` is anchored at column zero and not after any indent, because an indented line is a
 * directive's body and `::` in one is text.
 */
const completeBody = (
  context: CompletionContext,
  before: string,
  analysis: BriefAnalysis,
): CompletionResult | null => {
  const manifest = analysis.manifest;
  if (manifest === undefined) return null;

  const directive = /^::([a-zA-Z0-9_-]*)$/u.exec(before);
  if (directive) {
    return result(
      context,
      { text: directive[1] ?? '' },
      Object.keys(manifest.slots).map((name) => slotOption(name, manifest)),
    );
  }

  // `::item {destaque, tom: cl` — the slot the list is attached to decides which
  // adjustments are legal, because `applies` names the slots each one may be written on.
  const adjustments = /^::([a-zA-Z_][a-zA-Z0-9_-]*)[^{}]*\{([^{}]*)$/u.exec(before);
  if (!adjustments) return null;

  const slot = adjustments[1] ?? '';
  const item = lastListItem(adjustments[2] ?? '');
  const colon = item.indexOf(':');

  if (colon === -1) {
    const declared = Object.entries(manifest.adjustments)
      .filter(([, adjustment]) => adjustment.applies.includes(slot))
      .map(([name]) => adjustmentOption(name, manifest));
    return result(context, { text: item.trimStart() }, declared);
  }

  const adjustment = manifest.adjustments[item.slice(0, colon).trim()];
  if (adjustment?.type !== 'enum' || adjustment.values === undefined) return null;
  return result(
    context,
    { text: item.slice(colon + 1).trimStart() },
    adjustment.values.map(valueOption),
  );
};

/**
 * The completion source, exported so a test can drive it without mounting an editor.
 *
 * Answers `null` whenever there is no analysis yet or nothing sensible to offer, which is
 * CodeMirror's way of saying "not my turn" — a host that adds other sources keeps them.
 */
export function completeBrief(context: CompletionContext): CompletionResult | null {
  const analysis = context.state.field(briefAnalysisField, false);
  if (analysis === undefined) return null;

  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const end = frontmatterEnd(context.state);

  return end !== undefined && line.number > 1 && line.number < end
    ? completeFrontmatter(context, before, analysis)
    : completeBody(context, before, analysis);
}

/**
 * Manifest-driven completion, scoped to the brief language.
 *
 * Registered through the language's own data facet rather than as a global source, so the
 * second language this package gains (E8.4, template-lang) does not inherit a completion
 * list built out of brief slots.
 */
export function briefCompletion(): Extension {
  return [autocompletion(), briefLanguage.data.of({ autocomplete: completeBrief })];
}
