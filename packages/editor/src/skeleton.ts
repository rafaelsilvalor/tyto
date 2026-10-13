import { snippet } from '@codemirror/autocomplete';
import { type EditorView } from '@codemirror/view';
import { type Slot, type TemplateManifest } from '@tyto/core';

/**
 * A new brief for a template, built from its manifest (TYTO-275).
 *
 * Every template already says what a brief must set: `manifest.yaml` names the slots, which are
 * required, which repeat and what an enum accepts. So the skeleton is computed rather than
 * written per template — a third-party pack gets one the day it is installed, and a manifest
 * that changes changes its skeleton with it.
 *
 * The answer is a CodeMirror snippet template (`@codemirror/autocomplete`'s `snippet()`): each
 * value is a numbered field, Tab walks them in order and `${0}` is where the cursor ends. It is a
 * string and not a transaction so the command bar's "New brief from template…", the template
 * picker on an empty brief and a completion (`snippetCompletion`) can all hand the same text to
 * CodeMirror.
 */

/** The parts of a manifest the skeleton reads; a whole `TemplateManifest` is one. */
export type SkeletonManifest = Pick<TemplateManifest, 'name' | 'formats' | 'slots'>;

/**
 * Whether a slot goes in the skeleton.
 *
 * **Required, or repeated with a minimum of at least one.** `required` alone is not enough:
 * `lamina` on the agenda is `repeat: true, min: 1` with no `required`, and a brief without one
 * stops at `resolve` with `E_BAD_SLOT_VALUE` — a skeleton of required slots only would not
 * compile 6 of the 9 built-in templates. Optional slots stay out (the maintainer's decision):
 * the skeleton is what a brief cannot do without, and completion offers the rest.
 */
export const inSkeleton = (slot: Slot): boolean =>
  slot.required || (slot.repeat && (slot.min ?? 0) >= 1);

/** How many times a repeated slot is written: its minimum, and never fewer than one. */
const occurrencesOf = (slot: Slot): number => (slot.repeat ? Math.max(slot.min ?? 0, 1) : 1);

/**
 * Text written as it is, with the braces escaped.
 *
 * `snippet()` reads `${` and `#{` as a field anywhere in the template, so a brace in a template
 * name or a format would start one; `\{` and `\}` are its escapes, and the only ones.
 */
const literal = (text: string): string => text.replace(/[{}]/gu, (brace) => `\\${brace}`);

/**
 * One numbered field holding `text`.
 *
 * A numbered field's default may not contain a brace at all — `snippet()` has no escape inside
 * one — so a value with a brace is written as escaped text with an empty field after it. No
 * built-in value has one; an enum value is any non-empty string, so a third-party one might.
 */
const field = (number: number, text: string): string =>
  /[{}]/u.test(text) ? `${literal(text)}\${${String(number)}}` : `\${${String(number)}:${text}}`;

/**
 * The words a rich-text placeholder shows: the slot's own name, which is what the person is
 * about to replace. On a slot that is not repeated `min` and `max` count characters, so the
 * name is repeated up to the minimum and cut to the maximum — a placeholder left as it is must
 * still compile.
 */
const placeholderOf = (name: string, slot: Slot): string => {
  if (slot.repeat) return name;
  let text = name;
  while (slot.min !== undefined && text.length < slot.min) text = `${text} ${name}`;
  return slot.max === undefined ? text : text.slice(0, slot.max);
};

/** An enum's placeholder: its default, or its first value. An image's: a file beside the brief. */
const scalarOf = (name: string, slot: Slot): string =>
  slot.type === 'enum' ? (slot.default ?? slot.values?.[0] ?? name) : `./${name}.png`;

/**
 * The snippet template for a new brief against `manifest`.
 *
 * The frontmatter names the template and **always** writes `formats`, so the person sees which
 * ones exist and deletes the ones they do not want. A required enum or image is a frontmatter
 * scalar; a required rich-text slot is an inline `::slot value`; a repeated slot is an indented
 * block, once per occurrence its minimum asks for.
 */
export function briefSkeleton(manifest: SkeletonManifest): string {
  let next = 1;
  const take = (): number => {
    const number = next;
    next += 1;
    return number;
  };

  const scalars: string[] = [];
  const directives: string[] = [];

  for (const [name, slot] of Object.entries(manifest.slots)) {
    if (!inSkeleton(slot)) continue;

    if (slot.repeat) {
      for (let occurrence = 0; occurrence < occurrencesOf(slot); occurrence += 1) {
        // `\t` at the start of a snippet line is one indent unit, so the block takes the
        // editor's indentation rather than a width written here.
        directives.push(
          slot.type === 'rich-text'
            ? `::${name}\n\t${field(take(), name)}`
            : `::${name} ${field(take(), scalarOf(name, slot))}`,
        );
      }
    } else if (slot.type === 'rich-text') {
      directives.push(`::${name} ${field(take(), placeholderOf(name, slot))}`);
    } else {
      scalars.push(`${name}: ${field(take(), scalarOf(name, slot))}`);
    }
  }

  const frontmatter = [
    '---',
    `template: ${literal(manifest.name)}`,
    `formats: [${manifest.formats.map(literal).join(', ')}]`,
    ...scalars,
    '---',
  ].join('\n');

  // A blank line between directives, because a blank line is what ends an indented block.
  return `${frontmatter}\n\n${[...directives, '${0}'].join('\n\n')}`;
}

/**
 * The text a snippet inserts, with every field's default written in place.
 *
 * The same reading `snippet()` makes — a numbered field becomes its default, `\{` and `\}`
 * become braces — for a caller that wants the brief and not the editing session: a test that
 * compiles the skeleton, or a host with no editor.
 */
export function skeletonText(template: string): string {
  return template
    .replace(/[#$]\{\d+(?::([^{}]*))?\}/gu, (_whole, text: string | undefined) => text ?? '')
    .replace(/\\([{}])/gu, '$1');
}

/**
 * Puts the skeleton into `view` between `from` and `to` — the whole document by default — and
 * selects its first field. Tab and Shift-Tab then move between fields, through the keymap
 * `snippet()` installs at `Prec.highest`, which is above vim's too.
 */
export function insertBriefSkeleton(
  view: EditorView,
  manifest: SkeletonManifest,
  from = 0,
  to: number = view.state.doc.length,
): void {
  snippet(briefSkeleton(manifest))(view, null, from, to);
}
