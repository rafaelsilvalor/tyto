import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import { sourceRange } from '../source/range.js';

import type { SlotValue } from '../brief/resolve.js';
import type { AssetRef } from '../scene/primitives.js';
import type { SourceRange } from '../source/range.js';
import type { SuppliedValue } from './declared-values.js';
import type { Slot, TemplateManifest } from './manifest.js';

/**
 * The brief side of a configuration (ADR 0151, TYTO-440): what a brief that reaches the
 * configuration starts from, and how tight the editor holds it.
 *
 * Four things, as the plugin file writes them under `brief:`:
 *
 * - `slots`: a slot's content when the brief leaves it unset. Only a slot that does not
 *   repeat: an occurrence of a repeated slot is an artwork, and which artworks a brief has is
 *   the brief's to say.
 * - `formats`: which formats render when the brief names none.
 * - `skeleton`: the text "new from template" and the "/" menu write, whole.
 * - `editor`: a `max` per slot, tighter than the manifest's and never looser. Past it is a
 *   warning in the brief; the manifest's own `max` stays the error that stops a value.
 *
 * **The brief wins every one of them**: a slot it sets, a `formats` it lists. Each is checked
 * here once against the manifest, so a warning points into the plugin file it was written in.
 */

/** A configuration's `brief:` block as the plugin file wrote it, each part with its range. */
export interface ConfigurationBrief {
  readonly slots?: Readonly<Record<string, SuppliedValue>>;
  readonly formats?: SuppliedValue;
  readonly skeleton?: SuppliedValue;
  readonly editor?: Readonly<Record<string, ConfigurationEditorRule>>;
}

/** One slot's editor rule. Kept as a record so a later rule is a sibling of `max`. */
export interface ConfigurationEditorRule {
  readonly max?: SuppliedValue;
}

/** The brief side, checked against the manifest: what `resolve` and the editor read. */
export interface BriefDefaults {
  /** By slot name. A rich-text default is one run of plain text, as a frontmatter scalar is. */
  readonly slots: Readonly<Record<string, SlotValue>>;
  readonly formats?: readonly string[];
  readonly skeleton?: string;
  readonly editor: Readonly<Record<string, BriefLimit>>;
}

export interface BriefLimit {
  /** Characters on a text slot, occurrences on a repeated one, as the manifest's `max` counts. */
  readonly max: number;
}

export const NO_BRIEF_DEFAULTS: BriefDefaults = { slots: {}, editor: {} };

/** A configured default holds no place in the brief, so its run has none either. */
const NOWHERE = sourceRange(0, 0);

export interface BriefCheck {
  readonly manifest: TemplateManifest;
  readonly configuration: string;
  readonly brief: ConfigurationBrief | undefined;
  /** An image path, read relative to the plugin file, as a configuration's image value is. */
  readonly image: (path: string) => Promise<{ ref: AssetRef } | { problem: string }>;
  readonly report: (item: Diagnostic) => void;
}

export async function checkBrief(check: BriefCheck): Promise<BriefDefaults> {
  const { manifest, configuration, brief } = check;
  if (brief === undefined) return NO_BRIEF_DEFAULTS;
  const refuse = (key: string, problem: string, range: SourceRange | undefined): undefined => {
    check.report(
      diagnostic(
        'W_CONFIGURATION_BRIEF_INVALID',
        { template: manifest.name, configuration, key, problem },
        range === undefined ? {} : { range },
      ),
    );
    return undefined;
  };

  const slots: Record<string, SlotValue> = {};
  for (const [name, supplied] of Object.entries(brief.slots ?? {})) {
    const value = await slotDefault(manifest, name, supplied, check.image, (problem) =>
      refuse(`slots.${name}`, problem, supplied.range),
    );
    if (value !== undefined) slots[name] = value;
  }

  const formats = formatsOf(manifest, brief.formats, (problem) =>
    refuse('formats', problem, brief.formats?.range),
  );

  let skeleton: string | undefined;
  if (brief.skeleton !== undefined) {
    const text = brief.skeleton.value;
    if (typeof text === 'string' && text.trim() !== '') skeleton = text;
    else refuse('skeleton', 'is not the text of a brief', brief.skeleton.range);
  }

  const editor: Record<string, BriefLimit> = {};
  for (const [name, rule] of Object.entries(brief.editor ?? {})) {
    if (rule.max === undefined) continue;
    const max = limitOf(manifest, configuration, name, rule.max, check.report, (problem) =>
      refuse(`editor.${name}.max`, problem, rule.max?.range),
    );
    if (max !== undefined) editor[name] = { max };
  }

  return {
    slots,
    ...(formats === undefined ? {} : { formats }),
    ...(skeleton === undefined ? {} : { skeleton }),
    editor,
  };
}

/**
 * A named configuration starts from the entry's `default` and changes what it lists, its
 * brief side as its values do: slots and rules by name, formats and skeleton whole.
 */
export function overlayBrief(base: BriefDefaults, own: BriefDefaults): BriefDefaults {
  const formats = own.formats ?? base.formats;
  const skeleton = own.skeleton ?? base.skeleton;
  return {
    slots: { ...base.slots, ...own.slots },
    ...(formats === undefined ? {} : { formats }),
    ...(skeleton === undefined ? {} : { skeleton }),
    editor: { ...base.editor, ...own.editor },
  };
}

async function slotDefault(
  manifest: TemplateManifest,
  name: string,
  supplied: SuppliedValue,
  image: BriefCheck['image'],
  refuse: (problem: string) => undefined,
): Promise<SlotValue | undefined> {
  const slot = manifest.slots[name];
  if (slot === undefined) return refuse('names no slot of the template');
  if (slot.repeat) return refuse('is a repeated slot, whose occurrences the brief writes');
  const written = supplied.value;
  const text = typeof written === 'number' ? String(written) : written;
  if (typeof text !== 'string' || text.trim() === '') return refuse('is not text');
  const plain = text.trim();

  switch (slot.type) {
    case 'rich-text': {
      if (slot.min !== undefined && plain.length < slot.min) {
        return refuse(`is ${plain.length} characters and the manifest needs ${slot.min}`);
      }
      if (slot.max !== undefined && plain.length > slot.max) {
        return refuse(`is ${plain.length} characters and the manifest allows ${slot.max}`);
      }
      return { kind: 'rich-text', text: [{ kind: 'text', value: plain, range: NOWHERE }] };
    }
    case 'enum': {
      if (slot.values !== undefined && !slot.values.includes(plain)) {
        return refuse(`'${plain}' is not one of ${slot.values.join(', ')}`);
      }
      return { kind: 'enum', value: plain };
    }
    case 'image': {
      const read = await image(plain);
      return 'problem' in read ? refuse(read.problem) : { kind: 'image', asset: read.ref };
    }
  }
}

function formatsOf(
  manifest: TemplateManifest,
  supplied: SuppliedValue | undefined,
  refuse: (problem: string) => undefined,
): readonly string[] | undefined {
  if (supplied === undefined) return undefined;
  // `formats: story` is a list of one, as it is in a brief's frontmatter.
  const written = typeof supplied.value === 'string' ? [supplied.value] : supplied.value;
  if (!Array.isArray(written) || !written.every((item) => typeof item === 'string')) {
    return refuse('is not a list of formats');
  }
  const unknown = written.filter((format) => !manifest.formats.includes(format));
  if (unknown.length > 0) {
    return refuse(
      `names ${unknown.map((format) => `'${format}'`).join(', ')}, which the template does not render (it renders ${manifest.formats.join(', ')})`,
    );
  }
  return written.length === 0 ? refuse('is empty') : written;
}

/** What a `max` counts on this slot, or why a `max` means nothing there. */
function counts(slot: Slot): string | undefined {
  if (slot.repeat) return 'occurrences';
  return slot.type === 'rich-text' ? 'characters' : undefined;
}

function limitOf(
  manifest: TemplateManifest,
  configuration: string,
  name: string,
  supplied: SuppliedValue,
  report: (item: Diagnostic) => void,
  refuse: (problem: string) => undefined,
): number | undefined {
  const slot = manifest.slots[name];
  if (slot === undefined) return refuse('names no slot of the template');
  if (counts(slot) === undefined) {
    return refuse("counts a text slot's characters or a repeated slot's occurrences");
  }
  const max = supplied.value;
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1) {
    return refuse('is not a whole number above zero');
  }
  // Looser than the manifest is not a rule the configuration may make: the template was
  // drawn for its own limit, so that one stands.
  if (slot.max !== undefined && max > slot.max) {
    report(
      diagnostic(
        'W_EDITOR_RULE_LOOSER',
        { template: manifest.name, configuration, slot: name, max, allowed: slot.max },
        supplied.range === undefined ? {} : { range: supplied.range },
      ),
    );
    return undefined;
  }
  if (slot.min !== undefined && max < slot.min) {
    return refuse(`is below the manifest's minimum of ${slot.min}, so no brief could meet both`);
  }
  return max;
}

/** What a brief-set value counts against a limit, said as a message reads it. */
export function measured(slot: Slot, count: number): string {
  return slot.repeat ? `appears ${count} times` : `is ${count} characters`;
}
