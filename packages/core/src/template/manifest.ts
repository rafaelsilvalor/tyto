import { parseDocument } from 'yaml';
import { z } from 'zod';

import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import { type Diagnostics, type Result, err, ok } from '../result/result.js';
import { type SourceRange, sourceRange } from '../source/range.js';

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
 * arrow only points one way. If the grammar's identifier changes, this changes with it.
 */
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_-]*$/u;

/** `major.minor.patch`, with an optional prerelease — the form Changesets produces. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/**
 * A template name reaches a shell as `--template <name>` and may be joined into a path.
 * Blank, whitespace and separators are refused for that reason; nothing about style is.
 */
const TEMPLATE_NAME = /^[^\s/\\]+$/u;

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

export const templateManifestSchema = z
  .strictObject({
    name: z.string().regex(TEMPLATE_NAME, 'must not be blank or contain a space or a slash'),
    version: z.string().regex(VERSION, 'must be major.minor.patch'),
    description: z.string().optional(),
    /** Format ids defined in the project's `formats.yaml`; a template renders at least one. */
    formats: z.array(z.string().min(1)).min(1),
    slots: z.record(z.string(), slotSchema),
    adjustments: z.record(z.string(), adjustmentSchema).default({}),
  })
  .superRefine((manifest, context) => {
    // Checked here rather than as a key schema on the records: Zod reports a failing
    // record key as "Invalid key in record", and the reason a key is refused is the entire
    // value of refusing it.
    for (const [group, names] of [
      ['slots', Object.keys(manifest.slots)],
      ['adjustments', Object.keys(manifest.adjustments)],
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

/** `slots.titulo.max` — the same path Zod reports, joined the way a YAML reader scans. */
function issuePath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '(root)' : path.map(String).join('.');
}

/**
 * The span of the value a Zod path points at.
 *
 * A path may name a key the document does not have — that is what a missing required field
 * is — so it climbs towards the root until something resolves. Blaming the enclosing
 * mapping is the closest true answer to "where should I add this", and it beats blaming
 * the first character of the file.
 */
function rangeAt(
  document: ReturnType<typeof parseDocument>,
  path: readonly PropertyKey[],
): SourceRange | undefined {
  for (let depth = path.length; depth >= 0; depth -= 1) {
    const node: unknown =
      depth === 0 ? document.contents : document.getIn(path.slice(0, depth), true);
    const range = (node as { range?: [number, number, number] } | null | undefined)?.range;
    if (range) return sourceRange(range[0], range[1]);
  }
  return undefined;
}

/**
 * Parses a `manifest.yaml` and reports every problem in it, each at the key that caused it.
 *
 * `path` is the manifest's own location, and travels into the messages so that a registry
 * reporting six broken templates says which file each line is about.
 */
export function parseManifest(source: string, path: string): Result<TemplateManifest, Diagnostics> {
  const document = parseDocument(source);

  if (document.errors.length > 0) {
    return err(
      document.errors.map((error) =>
        diagnostic(
          'E_MANIFEST_SYNTAX',
          { path, problem: error.message.split('\n')[0] ?? error.message },
          { range: sourceRange(error.pos[0], Math.min(error.pos[1], source.length)) },
        ),
      ),
    );
  }

  const parsed = templateManifestSchema.safeParse(document.toJS());
  if (!parsed.success) {
    return err(parsed.error.issues.flatMap((issue) => shapeDiagnostics(document, issue)));
  }

  return ok(parsed.data);
}

/**
 * A `strictObject` reports every unknown key of one object in a single issue whose path
 * stops at the object. Split it, so each stray key gets its own squiggle on itself rather
 * than one shared complaint on the mapping above them.
 */
function shapeDiagnostics(
  document: ReturnType<typeof parseDocument>,
  issue: z.core.$ZodIssue,
): Diagnostic[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => {
      const path = [...issue.path, key];
      return diagnostic(
        'E_MANIFEST_SHAPE',
        { path: issuePath(path), problem: 'unknown key' },
        withRange(rangeAt(document, path)),
      );
    });
  }

  return [
    diagnostic(
      'E_MANIFEST_SHAPE',
      { path: issuePath(issue.path), problem: issue.message },
      withRange(rangeAt(document, issue.path)),
    ),
  ];
}

/** exactOptionalPropertyTypes tells an absent key from an undefined one. */
function withRange(range: SourceRange | undefined): { range?: SourceRange } {
  return range === undefined ? {} : { range };
}
