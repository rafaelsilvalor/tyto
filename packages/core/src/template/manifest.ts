import { z } from 'zod';

import { parseYamlConfig } from '../config/yaml-source.js';
import { diagnostic } from '../diagnostics/diagnostic.js';
import { type Diagnostics, type Result, err, ok } from '../result/result.js';

/**
 * `manifest.yaml` — what a template declares about itself (`docs/template-authoring.md`).
 *
 * The manifest is the contract between a template and the briefs written against it: it
 * names the slots a brief may set, the adjustments each slot accepts and the formats the
 * template renders. `resolve` (E3.3) checks a `BriefAst` against it, and every
 * `E_UNKNOWN_SLOT`, `E_MISSING_REQUIRED_SLOT` and `E_BAD_ADJUSTMENT` is this file
 * answering a question.
 *
 * It is validated before anything runs, and validating it never runs anything: reading a
 * manifest tells you what a template claims, not what its code does.
 */

/**
 * A name a brief can actually write. The grammar's `identifier` is
 * `$[a-zA-Z_] $[a-zA-Z0-9_-]*` (`packages/brief-lang/src/brief.grammar`), and a slot the
 * brief language cannot spell is a slot no author can ever set — better caught here, with
 * the manifest key in the message, than as a parse error in every brief that tries.
 *
 * The pattern is duplicated rather than imported: `brief-lang` depends on `core`, so the
 * arrow only points one way. If the grammar's identifier changes, this changes with it —
 * and `tools/repo-checks/src/grammar-identifier.test.ts` fails the build when only one of
 * the two moves, from outside both packages, where the coupling is visible.
 */
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_-]*$/u;

/** `major.minor.patch`, with an optional prerelease — the form Changesets produces. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/**
 * A template name reaches a shell as `--template <name>` and may be joined into a path.
 * Blank, whitespace and separators are refused for that reason; nothing about style is.
 */
const TEMPLATE_NAME = /^[^\s/\\]+$/u;

/**
 * A brand is a filter key — a picker lists one brand's templates, a pack groups them — so it
 * is kept to the characters every such key survives: lower case, digits and single hyphens.
 */
export const BRAND_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const slotTypeSchema = z.enum(['rich-text', 'image', 'enum']);
export type SlotType = z.infer<typeof slotTypeSchema>;

export const adjustmentTypeSchema = z.enum(['flag', 'enum']);
export type AdjustmentType = z.infer<typeof adjustmentTypeSchema>;

/**
 * `min` and `max` count occurrences on a repeatable slot and characters on every other
 * one. That is the overload `docs/template-authoring.md` writes — `titulo` is capped at 60
 * characters, `slide` at 10 slides — and the doc is read literally by designers and by
 * agents, so the schema follows it rather than renaming the fields underneath it.
 */
export const slotSchema = z
  .strictObject({
    type: slotTypeSchema,
    required: z.boolean().default(false),
    /** Each occurrence becomes an `Artwork`; at most one slot in a manifest may repeat. */
    repeat: z.boolean().default(false),
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().positive().optional(),
    /** The accepted values of an `enum` slot, and nothing else's. */
    values: z.array(z.string().min(1)).min(1).optional(),
    default: z.string().optional(),
  })
  .superRefine((slot, context) => {
    if (slot.type === 'enum') {
      if (slot.values === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['values'],
          message: 'an enum slot must list its values',
        });
      } else if (slot.default !== undefined && !slot.values.includes(slot.default)) {
        context.addIssue({
          code: 'custom',
          path: ['default'],
          message: `default '${slot.default}' is not one of ${slot.values.join(', ')}`,
        });
      }
    } else if (slot.values !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['values'],
        message: `values are only meaningful on an enum slot, not on '${slot.type}'`,
      });
    }

    // On a non-repeatable slot the pair counts characters, and only `rich-text` has any:
    // an `image` is a path the author never sees rendered and an `enum` is one of a listed
    // set, so `{ type: image, max: 60 }` reads like a rule and enforces nothing. Refused
    // here rather than ignored at `resolve`, where a cap that silently does nothing is the
    // worse of the two.
    if (!slot.repeat && slot.type !== 'rich-text') {
      for (const bound of ['min', 'max'] as const) {
        if (slot[bound] === undefined) continue;
        context.addIssue({
          code: 'custom',
          path: [bound],
          message: `${bound} counts characters on a non-repeatable slot, and a '${slot.type}' slot has none; it is only meaningful on 'rich-text' or with repeat: true`,
        });
      }
    }

    if (slot.min !== undefined && slot.max !== undefined && slot.min > slot.max) {
      context.addIssue({
        code: 'custom',
        path: ['min'],
        message: `min ${slot.min} is greater than max ${slot.max}`,
      });
    }
  });
export type Slot = z.infer<typeof slotSchema>;

export const adjustmentSchema = z
  .strictObject({
    type: adjustmentTypeSchema,
    /** The slots this adjustment may be written on; every one has to be declared. */
    applies: z.array(z.string().min(1)).min(1),
    values: z.array(z.string().min(1)).min(1).optional(),
    default: z.string().optional(),
  })
  .superRefine((adjustment, context) => {
    if (adjustment.type === 'enum') {
      if (adjustment.values === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['values'],
          message: 'an enum adjustment must list its values',
        });
      } else if (
        adjustment.default !== undefined &&
        !adjustment.values.includes(adjustment.default)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['default'],
          message: `default '${adjustment.default}' is not one of ${adjustment.values.join(', ')}`,
        });
      }
    } else if (adjustment.values !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['values'],
        message: 'values are only meaningful on an enum adjustment, not on a flag',
      });
    }
  });
export type Adjustment = z.infer<typeof adjustmentSchema>;

/** A face as `FontSource` is asked for it: family, CSS weight, style. */
export const manifestFaceSchema = z.strictObject({
  family: z.string().min(1),
  weight: z.number().int().min(100).max(900),
  style: z.enum(['normal', 'italic']).default('normal'),
});
export type ManifestFace = z.infer<typeof manifestFaceSchema>;

/** The hex forms `color()` in `values.ts` accepts, so a declared colour is one it can draw. */
export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u;

/**
 * The kinds of value a template may declare configurable (ADR 0151 decision 1, ADR 0153):
 * each changes a value and never the composition. `length` is in px, `number` is unitless
 * (a ratio, an `em` multiple).
 */
export const declaredValueTypeSchema = z.enum(['color', 'length', 'number', 'face', 'image']);
export type DeclaredValueType = z.infer<typeof declaredValueTypeSchema>;

const limits = { min: z.number().optional(), max: z.number().optional() };

/**
 * One configurable value: its kind, its default and, for a length or a number, its limits.
 * The default is what the template draws with when nothing configures it, so a template that
 * declares a value it used to hold as a constant draws the same bytes as before.
 */
export const declaredValueSchema = z
  .discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('color'),
      default: z.string().regex(HEX_COLOR, "must be a hex colour such as '#5900a7'"),
    }),
    z.strictObject({ type: z.literal('length'), default: z.number(), ...limits }),
    z.strictObject({ type: z.literal('number'), default: z.number(), ...limits }),
    z.strictObject({ type: z.literal('face'), default: manifestFaceSchema }),
    // A path inside the template's own folder (ADR 0062). Optional: a template may declare an
    // image it draws only when somebody supplies one.
    z.strictObject({ type: z.literal('image'), default: z.string().min(1).optional() }),
  ])
  .superRefine((value, context) => {
    if (value.type !== 'length' && value.type !== 'number') return;
    const { min, max } = value;
    if (min !== undefined && max !== undefined && min > max) {
      context.addIssue({
        code: 'custom',
        path: ['min'],
        message: `min ${min} is above max ${max}`,
      });
      return;
    }
    if ((min !== undefined && value.default < min) || (max !== undefined && value.default > max)) {
      context.addIssue({
        code: 'custom',
        path: ['default'],
        message: `default ${value.default} is outside its own limits`,
      });
    }
  });
export type DeclaredValue = z.infer<typeof declaredValueSchema>;

export const templateManifestSchema = z
  .strictObject({
    name: z.string().regex(TEMPLATE_NAME, 'must not be blank or contain a space or a slash'),
    version: z.string().regex(VERSION, 'must be major.minor.patch'),
    description: z.string().optional(),
    /**
     * Whose look the template draws, such as `azul` (TYTO-195, ADR 0052). Optional,
     * so a manifest written before it still loads; the built-in pack names one on every
     * template. The template's own name says what the piece is about, and its formats and
     * repeatable slot say what kind of piece it is (ADR 0051), so this is the one fact about a
     * template's identity the rest of the manifest cannot answer.
     */
    brand: z
      .string()
      .regex(BRAND_ID, 'must be lower case letters, digits and single hyphens, like azul')
      .optional(),
    /** Format ids defined in the project's `formats.yaml`; a template renders at least one. */
    formats: z.array(z.string().min(1)).min(1),
    slots: z.record(z.string(), slotSchema),
    adjustments: z.record(z.string(), adjustmentSchema).default({}),
    /**
     * The faces a code template measures, for an installed one that runs in its plugin's
     * process (ADR 0048). Measurement there is synchronous, so the faces have to cross
     * with the call rather than be asked for mid-build; a face left out of this list
     * measures as `undefined` in the plugin. Read as data, like the rest of the manifest:
     * nothing runs to find out what a template measures. A built-in, measured in Tyto's own
     * process, needs none.
     */
    faces: z.array(manifestFaceSchema).optional(),
    /**
     * Per family the template draws, the free families a person can use instead when this
     * machine has none of it and Google Fonts does not serve it either (TYTO-281, ADR 0120):
     * `fonts: { CircularXX: { alternatives: [Inter, Manrope] } }`. The template's author knows
     * the brand, and a licensed face is by definition one no public catalogue can classify.
     * Named in `W_FONT_UNAVAILABLE`; nothing is drawn in them on Tyto's own initiative.
     */
    fonts: z
      .record(
        z.string().min(1),
        z.strictObject({ alternatives: z.array(z.string().min(1)).min(1) }),
      )
      .optional(),
    /**
     * What a configuration may change in this template, by name (ADR 0151, ADR 0153):
     * `title-gap: { type: length, default: 20, min: 0, max: 120 }`. Only what is declared here
     * is configurable, and a value changes a value, never which pieces are drawn or in what
     * order. Optional, so every manifest written before it still loads.
     */
    values: z.record(z.string(), declaredValueSchema).optional(),
  })
  .superRefine((manifest, context) => {
    // Checked here rather than as a key schema on the records: Zod reports a failing
    // record key as "Invalid key in record", and the reason a key is refused is the entire
    // value of refusing it.
    for (const [group, names] of [
      ['slots', Object.keys(manifest.slots)],
      ['adjustments', Object.keys(manifest.adjustments)],
      ['values', Object.keys(manifest.values ?? {})],
    ] as const) {
      for (const name of names) {
        if (!IDENTIFIER.test(name)) {
          context.addIssue({
            code: 'custom',
            path: [group, name],
            message: `'${name}' is not a name a brief can write`,
          });
        }
      }
    }

    for (const [name, adjustment] of Object.entries(manifest.adjustments)) {
      for (const [index, slot] of adjustment.applies.entries()) {
        if (!(slot in manifest.slots)) {
          context.addIssue({
            code: 'custom',
            path: ['adjustments', name, 'applies', index],
            message: `applies to '${slot}', which the manifest does not declare as a slot`,
          });
        }
      }
    }

    // "The manifest declares which slot is `repeat`" (docs/brief-language.md) — singular,
    // and it has to be: each occurrence becomes an Artwork, so two repeatable slots would
    // leave the number of artworks undefined.
    const repeatable = Object.entries(manifest.slots).filter(([, slot]) => slot.repeat);
    if (repeatable.length > 1) {
      for (const [name] of repeatable.slice(1)) {
        context.addIssue({
          code: 'custom',
          path: ['slots', name, 'repeat'],
          message: `only one slot may repeat, and '${repeatable[0]?.[0]}' already does`,
        });
      }
    }
  });
export type TemplateManifest = z.infer<typeof templateManifestSchema>;

/**
 * Parses a `manifest.yaml` and reports every problem in it, each at the key that caused it.
 *
 * `path` is the manifest's own location, and travels into the messages so that a registry
 * reporting six broken templates says which file each line is about. The YAML-to-range
 * machinery is shared with `formats.yaml` (`../config/yaml-source.ts`), because doing it
 * twice would be two chances to do it differently.
 */
export function parseManifest(source: string, path: string): Result<TemplateManifest, Diagnostics> {
  const parsed = parseYamlConfig(source, templateManifestSchema, {
    syntax: (problem, range) => diagnostic('E_MANIFEST_SYNTAX', { path, problem }, { range }),
    shape: (key, problem, range) =>
      diagnostic('E_MANIFEST_SHAPE', { path: key, problem }, range === undefined ? {} : { range }),
  });

  return 'value' in parsed ? ok(parsed.value) : err([...parsed.diagnostics]);
}
