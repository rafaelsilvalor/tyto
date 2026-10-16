import { type ZodType, z } from 'zod';

import type { DeclaredSetting, SettingOption } from './configuration.js';

/**
 * What a settings editor needs to know about each declared setting, as plain data
 * (TYTO-304, ADR 0092): its description, a type a person can read, its default as JSON, and
 * the values it, one of its list entries or one of its object members may take.
 *
 * **Derived, not declared.** A Zod schema does not cross a process boundary, and the window that
 * suggests keys and values is a process away from the registry that holds the schemas; so the
 * registry's side reads each schema once and sends what it found. Nothing here is a rule: the
 * schema in the registry still decides what is accepted, and an outline that says less than the
 * schema costs a suggestion, never a value.
 */
export interface SettingOutline {
  /** The key as the file writes it: `queueAutoRun`, or `demo.fontSize`. */
  readonly key: string;
  readonly plugin: string;
  readonly description: string;
  /** The type in words: `boolean`, `string | null`, `list of string`, `number from 0.75 to 2`. */
  readonly type: string;
  /** The default as JSON text, which is what completing the key writes after the colon. */
  readonly default: string;
  /** The values the setting may take, with what each does; empty when it has no closed set. */
  readonly options: readonly SettingOption[];
  /** For a list setting that checks its entries one at a time, the values an entry may take. */
  readonly entries?: { readonly options: readonly SettingOption[] } | undefined;
  /** For an object setting that checks its members one at a time, the names a member may take. */
  readonly members?: { readonly options: readonly SettingOption[] } | undefined;
}

/** The slice of a JSON Schema this reads. */
interface JsonSchema {
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
  readonly items?: JsonSchema;
  readonly minimum?: number;
  readonly maximum?: number;
}

/**
 * Zod 4's own reader, with anything it cannot write as JSON Schema answered as "anything" rather
 * than thrown: a schema with a transform or a custom type still gets an outline, only a vaguer one.
 */
function jsonSchemaOf(schema: ZodType<unknown>): JsonSchema {
  try {
    return z.toJSONSchema(schema, { unrepresentable: 'any' }) as JsonSchema;
  } catch {
    return {};
  }
}

const isOptionValue = (value: unknown): value is SettingOption['value'] =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

/** An enum's values and a boolean's two, found in the schema, with no sentence. */
function optionsIn(schema: JsonSchema): SettingOption[] {
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches !== undefined) return branches.flatMap(optionsIn);
  if (schema.enum !== undefined) {
    return schema.enum.filter(isOptionValue).map((value) => ({ value, description: '' }));
  }
  if (schema.const !== undefined && isOptionValue(schema.const)) {
    return [{ value: schema.const, description: '' }];
  }
  if (schema.type === 'boolean') {
    return [
      { value: true, description: '' },
      { value: false, description: '' },
    ];
  }
  return [];
}

/** The schema's type in words, for a hover and a suggestion's detail. */
function typeLabel(schema: JsonSchema): string {
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches !== undefined) return [...new Set(branches.map(typeLabel))].join(' | ');
  if (schema.enum !== undefined) {
    return [...new Set(schema.enum.map((value) => (value === null ? 'null' : typeof value)))].join(
      ' | ',
    );
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const type = Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type;
  switch (type) {
    case undefined:
      return 'any';
    case 'array':
      return schema.items === undefined ? 'list' : `list of ${typeLabel(schema.items)}`;
    case 'number':
    case 'integer':
      if (schema.minimum !== undefined && schema.maximum !== undefined) {
        return `${type} from ${String(schema.minimum)} to ${String(schema.maximum)}`;
      }
      return type;
    default:
      return String(type);
  }
}

/**
 * The declared options where the plugin wrote them, else what the schema's own enum says. A
 * declared option missing from the enum is not added; the declaration already threw for those.
 */
const optionsOf = (
  declared: readonly SettingOption[] | undefined,
  schema: ZodType<unknown>,
): readonly SettingOption[] => declared ?? optionsIn(jsonSchemaOf(schema));

/** The outline of every declared setting, in the registry's order. */
export function outlineOf(declared: readonly DeclaredSetting[]): readonly SettingOutline[] {
  return declared.map(({ key, plugin, contribution }) => {
    const { entries, members } = contribution;
    return {
      key,
      plugin,
      description: contribution.description,
      type: typeLabel(jsonSchemaOf(contribution.schema)),
      default: JSON.stringify(contribution.default) ?? 'null',
      options: optionsOf(contribution.options, contribution.schema),
      ...(entries === undefined
        ? {}
        : { entries: { options: optionsOf(entries.options, entries.schema) } }),
      ...(members === undefined
        ? {}
        : { members: { options: optionsOf(members.options, members.key) } }),
    };
  });
}
