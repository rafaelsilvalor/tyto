import { PATTERN_DIALECT, PATTERN_LIMITS, compilePattern } from '@tyto/recipe';
import { type ZodType, z } from 'zod';

/**
 * A setting's rules as data, which an installed plugin can send across its process boundary
 * (TYTO-254, ADR 0145).
 *
 * A Zod schema is code and does not cross, so an isolated plugin declares a setting with one of
 * these instead, and the host turns it into the Zod schema the in-process path already uses
 * (`settingSchemaOf`). From there the setting is like any other: the same per-key tolerance and
 * the same ranged `W_SETTING_INVALID` (ADR 0073).
 *
 * **A small slice of JSON Schema's words, and nothing else.** A scalar of one type — optionally
 * nullable, optionally one of a closed list — with the bounds JSON Schema names; or a list of
 * one such scalar. No object, no secret: a setting is plain text in `settings.json`, and a secret
 * is a declared credential (ADR 0134). `pattern` is Tyto's one pattern dialect, guarded the way a
 * recipe's is (ADR 0136), so a setting cannot bring a pattern whose matching time has no bound.
 */

export type SettingScalarType = 'string' | 'number' | 'integer' | 'boolean';

/** One value of an `enum`, as the file writes it. */
export type SettingFormValue = string | number | boolean | null;

export interface SettingScalarForm {
  readonly type: SettingScalarType;
  /** Whether `null` is accepted too. */
  readonly nullable?: boolean;
  /** The only values accepted. Alone: the list already says everything the bounds would. */
  readonly enum?: readonly SettingFormValue[];
  /** For a number or an integer, inclusive. */
  readonly minimum?: number;
  readonly maximum?: number;
  /** For a string, in UTF-16 code units, as JavaScript counts them. */
  readonly minLength?: number;
  readonly maxLength?: number;
  /** For a string: `tyto-pattern/1`, found anywhere in the value (ADR 0136). */
  readonly pattern?: string;
  /** For a string: an absolute URI, such as `https://example.atlassian.net`. */
  readonly format?: 'uri';
}

export interface SettingListForm {
  readonly type: 'array';
  /** What each entry is. An entry the form refuses costs itself alone (ADR 0091). */
  readonly items: SettingScalarForm;
  /** Whether an entry may not repeat an earlier one. */
  readonly uniqueItems?: boolean;
}

export type SettingForm = SettingScalarForm | SettingListForm;

/** The ceilings a form is held to, so one plugin's declaration stays a declaration. */
export const SETTING_FORM_LIMITS = {
  /** Values an `enum` may list. */
  enumValues: 200,
  /** Characters of one string value in an `enum`. */
  enumValueLength: 1000,
  /** Characters of a `pattern`: the recipe dialect's own ceiling. */
  patternLength: PATTERN_LIMITS.patternLength,
} as const;

const formValueSchema = z.union([
  z.string().max(SETTING_FORM_LIMITS.enumValueLength),
  z.number(),
  z.boolean(),
  z.null(),
]);

const lengthSchema = z.number().int().nonnegative();

const scalarFormSchema = z.strictObject({
  type: z.enum(['string', 'number', 'integer', 'boolean']),
  nullable: z.boolean().optional(),
  enum: z.array(formValueSchema).min(1).max(SETTING_FORM_LIMITS.enumValues).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: lengthSchema.optional(),
  maxLength: lengthSchema.optional(),
  pattern: z.string().min(1).max(SETTING_FORM_LIMITS.patternLength).optional(),
  format: z.literal('uri').optional(),
});

const listFormSchema = z.strictObject({
  type: z.literal('array'),
  items: scalarFormSchema,
  uniqueItems: z.boolean().optional(),
});

/**
 * A form's shape, strictly: what the host checks a crossing declaration against. What a shape
 * cannot say — a keyword that does not fit the type, a pattern that does not compile — is
 * `settingSchemaOf`'s to refuse, by name.
 */
export const settingFormSchema: z.ZodType<SettingForm> = z.discriminatedUnion('type', [
  scalarFormSchema,
  listFormSchema,
]) as unknown as z.ZodType<SettingForm>;

/**
 * The Zod schema a form describes. Throws a `TypeError` naming the problem when the form is not
 * one Tyto can read; the declaration that carried it is the plugin's bug, so the loader's door
 * turns the throw into `E_PLUGIN_ACTIVATE`, as it does for a default the schema refuses.
 */
export function settingSchemaOf(form: SettingForm): ZodType<unknown> {
  const checked = settingFormSchema.safeParse(form);
  if (!checked.success) {
    const type = (form as { readonly type?: unknown } | null)?.type;
    throw new TypeError(
      type === 'object'
        ? 'a setting form cannot be an object; declare one setting per value'
        : `the form is not one a setting can have: ${checked.error.issues
            .map((issue) => `${issue.path.map(String).join('.') || '(root)'} ${issue.message}`)
            .join('; ')}`,
    );
  }
  const read = checked.data;
  if (read.type !== 'array') return scalarSchemaOf(read, '');

  const items = scalarSchemaOf(read.items, 'items.');
  const list = z.array(items);
  if (read.uniqueItems !== true) return list;
  return list.refine(
    (values) => new Set(values.map((value) => JSON.stringify(value))).size === values.length,
    'must not repeat an entry',
  );
}

/** For a list form, how each entry is checked on its own (ADR 0091); `undefined` otherwise. */
export function settingEntriesOf(
  form: SettingForm,
): { readonly schema: ZodType<unknown>; readonly unique: boolean } | undefined {
  if (form.type !== 'array') return undefined;
  return { schema: settingSchemaOf(form.items), unique: form.uniqueItems === true };
}

const KEYWORDS_BY_TYPE: Readonly<Record<SettingScalarType, readonly string[]>> = {
  string: ['minLength', 'maxLength', 'pattern', 'format'],
  number: ['minimum', 'maximum'],
  integer: ['minimum', 'maximum'],
  boolean: [],
};

const BOUNDS = ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'format'] as const;

function scalarSchemaOf(form: SettingScalarForm, at: string): ZodType<unknown> {
  for (const keyword of BOUNDS) {
    if (form[keyword] === undefined) continue;
    if (!KEYWORDS_BY_TYPE[form.type].includes(keyword)) {
      throw new TypeError(`${at}${keyword} does not apply to a ${form.type}`);
    }
    if (form.enum !== undefined) {
      throw new TypeError(`${at}${keyword} cannot stand beside enum, which lists every value`);
    }
  }
  const base = form.enum === undefined ? boundedSchemaOf(form, at) : enumSchemaOf(form, at);
  return form.nullable === true ? base.nullable() : base;
}

function enumSchemaOf(form: SettingScalarForm, at: string): ZodType<unknown> {
  const values = form.enum ?? [];
  values.forEach((value, index) => {
    const fits =
      (value === null && form.nullable === true) ||
      (form.type === 'integer' ? Number.isInteger(value) : typeof value === form.type);
    if (!fits) {
      throw new TypeError(
        `${at}enum.${String(index)} is ${JSON.stringify(value)}, which is not a ${form.type}`,
      );
    }
  });
  const [first, ...rest] = values.filter((value) => value !== null);
  // Every value was a `null` the `nullable` already accepts: a list of nothing else.
  if (first === undefined) return z.never();
  return z.literal([first, ...rest]);
}

function boundedSchemaOf(form: SettingScalarForm, at: string): ZodType<unknown> {
  checkOrder(form.minimum, form.maximum, `${at}minimum`, `${at}maximum`);
  checkOrder(form.minLength, form.maxLength, `${at}minLength`, `${at}maxLength`);
  switch (form.type) {
    case 'boolean':
      return z.boolean();
    case 'number':
    case 'integer': {
      let number = form.type === 'integer' ? z.number().int() : z.number();
      if (form.minimum !== undefined) number = number.min(form.minimum);
      if (form.maximum !== undefined) number = number.max(form.maximum);
      return number;
    }
    case 'string':
      return stringSchemaOf(form, at);
  }
}

function stringSchemaOf(form: SettingScalarForm, at: string): ZodType<unknown> {
  let text = z.string();
  if (form.minLength !== undefined) text = text.min(form.minLength);
  if (form.maxLength !== undefined) text = text.max(form.maxLength);
  let schema: ZodType<string> = text;
  if (form.pattern !== undefined) {
    const compiled = compilePattern(form.pattern);
    if (!compiled.ok) {
      throw new TypeError(
        `${at}pattern is not one ${PATTERN_DIALECT} accepts: ` +
          compiled.error.map((problem) => problem.message).join('; '),
      );
    }
    const { test } = compiled.value;
    schema = schema.refine(test, `must match the pattern ${form.pattern}`);
  }
  if (form.format === 'uri') schema = schema.refine(isAbsoluteUri, 'must be an absolute URI');
  return schema;
}

function checkOrder(
  low: number | undefined,
  high: number | undefined,
  lowName: string,
  highName: string,
): void {
  if (low !== undefined && high !== undefined && low > high) {
    throw new TypeError(`${lowName} ${String(low)} is above ${highName} ${String(high)}`);
  }
}

/** The runtime's own, read off `globalThis`: this package compiles against no platform (ADR 0010). */
const { URL } = globalThis as unknown as {
  URL: new (input: string) => { readonly protocol: string };
};

/** A scheme, a colon and something after it — what `URL` parses with no base to lean on. */
function isAbsoluteUri(value: string): boolean {
  try {
    return new URL(value).protocol !== '';
  } catch {
    return false;
  }
}
