import { type Diagnostic, type SourceRange, diagnostic } from '@tyto/core';
import type { ZodType } from 'zod';

import type { Contribution } from './contributions.js';
import { type SettingForm, settingEntriesOf, settingSchemaOf } from './setting-form.js';

/**
 * The `configuration` extension point: a setting a plugin declares, and the one pure rule
 * that turns what a person wrote into values (TYTO-206, ADR 0073).
 *
 * **Declared in code, with a Zod schema**, because the settings it has to describe already
 * are Zod schemas — a templates folder is a non-empty string or `null`, a queue's file types
 * are a record of non-empty lists — and a second, JSON-shaped vocabulary for the same rules
 * would be two declarations waiting to drift. A schema does not cross a process boundary, so an
 * isolated plugin declares its setting with a `form` instead — data the host turns into the same
 * Zod schema (TYTO-254, ADR 0145).
 */

export interface ConfigurationContribution<T = unknown> extends Contribution {
  /**
   * The key as the plugin names it: letters and digits, starting with a letter, no dot. The
   * host puts the plugin id in front of it for every plugin but a built-in (ADR 0073).
   */
  readonly id: string;
  readonly schema: ZodType<T>;
  /** What applies when the file says nothing, or says something the schema refuses. */
  readonly default: T;
  /** One sentence for the person reading the settings, in English like the rest of the API. */
  readonly description: string;
  /**
   * The values a person may write, each with one sentence on what it does (TYTO-304, ADR 0092).
   *
   * Help and not a rule: the settings tab suggests them and its hover lists them, and the
   * `schema` is still what decides. Left out, an enum's values and a boolean's two are found in
   * the schema itself (`outlineOf`), with no sentence. Every value must be one the schema
   * accepts, or the declaration throws.
   */
  readonly options?: readonly SettingOption[];
  /**
   * For a list setting, how each entry is checked **on its own** (TYTO-301, ADR 0091).
   *
   * Without it a list is one value: a single bad entry fails the schema and the whole list
   * takes its default. With it, an entry `schema` refuses — or, with `unique`, one that repeats
   * an earlier entry — is `W_SETTING_ENTRY_INVALID` at that entry and is left out, and the
   * entries that remain are checked against the setting's `schema` as the value. A value that
   * is not a list at all is still `W_SETTING_INVALID`.
   */
  readonly entries?: {
    readonly schema: ZodType<unknown>;
    readonly unique: boolean;
    /** The values one entry may take, for suggestions and hover (TYTO-304), as `options`. */
    readonly options?: readonly SettingOption[];
  };
  /**
   * For an object setting, how each member is checked **on its own** (TYTO-301, ADR 0091).
   *
   * Without it an object is one value: a single bad member fails the schema and the whole
   * object takes its default. With it, a member whose name `key` refuses is
   * `W_SETTING_ENTRY_INVALID` at that name, and one whose value `schema` refuses is
   * `W_SETTING_INVALID` at that value under the dotted key (`statusBarColors.background`);
   * either is left out, and the members that remain are checked against the setting's
   * `schema` as the value. A value that is not an object at all is still `W_SETTING_INVALID`.
   */
  readonly members?: {
    readonly key: ZodType<string>;
    readonly schema: ZodType<unknown>;
    /**
     * A schema per member name, used instead of `schema` for that name (TYTO-272): one object
     * whose members take different values, such as a size per area with an area's own bounds.
     */
    readonly schemaByName?: Readonly<Record<string, ZodType<unknown>>>;
    /** The member names the object may hold, for suggestions and hover (TYTO-304). */
    readonly options?: readonly SettingOption[];
  };
}

/**
 * A setting declared with a data form of its rules instead of a Zod schema (TYTO-254, ADR 0145):
 * the one way an isolated plugin can declare one, and open to any plugin. A list form checks its
 * entries one at a time, as `entries` does.
 */
export interface FormConfigurationContribution extends Contribution {
  readonly id: string;
  readonly form: SettingForm;
  /** What applies when the file says nothing, or says something the form refuses. */
  readonly default: unknown;
  readonly description: string;
  readonly options?: readonly SettingOption[];
}

/** What `registerConfiguration` takes: a schema or a form, exactly one of the two. */
export type SettingDeclaration<T = unknown> =
  ConfigurationContribution<T> | FormConfigurationContribution;

/** One value a setting, a list entry or an object member may take, and what it does. */
export interface SettingOption {
  /** A JSON value as the file writes it: a string, a number, `true`/`false` or `null`. */
  readonly value: string | number | boolean | null;
  readonly description: string;
}

/** A setting as the registry hands it back: the key a file uses, and who declared it. */
export interface DeclaredSetting {
  /** The key as written in the settings file: `queueAutoRun`, or `demo.fontSize`. */
  readonly key: string;
  readonly plugin: string;
  /** Whether {@link key} carries the plugin id, which is every plugin but a built-in. */
  readonly prefixed: boolean;
  readonly contribution: ConfigurationContribution;
}

const LOCAL_KEY = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * Builds the declared setting, and throws on a declaration that is a bug in the plugin.
 *
 * A key with a dot would be ambiguous with the prefix, and a default the plugin's own schema
 * refuses would mean the fallback for a bad value is itself a bad value. Both are the
 * plugin's mistake, so they throw; the loader's door turns a throw into `E_PLUGIN_ACTIVATE`.
 */
export function declaredSetting(
  plugin: string,
  prefixed: boolean,
  declaration: SettingDeclaration,
): DeclaredSetting {
  const contribution = schemaDeclarationOf(plugin, declaration);
  if (!LOCAL_KEY.test(contribution.id)) {
    throw new TypeError(
      `Plugin '${plugin}' declares the setting '${contribution.id}'. A setting key is letters ` +
        `and digits starting with a letter; the host adds the plugin id and its dot itself.`,
    );
  }
  const checked = contribution.schema.safeParse(contribution.default);
  if (!checked.success) {
    throw new TypeError(
      `Plugin '${plugin}' declares the setting '${contribution.id}' with a default its own ` +
        `schema refuses: ${issuesOf(checked.error.issues)}.`,
    );
  }
  checkOptions(plugin, contribution.id, 'value', contribution.options, contribution.schema);
  checkOptions(
    plugin,
    contribution.id,
    'entry',
    contribution.entries?.options,
    contribution.entries?.schema,
  );
  checkOptions(
    plugin,
    contribution.id,
    'member name',
    contribution.members?.options,
    contribution.members?.key,
  );
  return {
    key: prefixed ? `${plugin}.${contribution.id}` : contribution.id,
    plugin,
    prefixed,
    contribution,
  };
}

/**
 * The declaration with a Zod schema, converting a form into one. Both or neither is the
 * plugin's mistake, and so is a form Tyto cannot read; each throws, naming the setting.
 */
function schemaDeclarationOf(
  plugin: string,
  declaration: SettingDeclaration,
): ConfigurationContribution {
  const { schema, form } = declaration as {
    readonly schema?: ZodType<unknown>;
    readonly form?: SettingForm;
  };
  if ((schema === undefined) === (form === undefined)) {
    throw new TypeError(
      `Plugin '${plugin}' declares the setting '${declaration.id}' with ` +
        `${schema === undefined ? 'neither a schema nor a form' : 'both a schema and a form'}; ` +
        `a setting has exactly one of the two.`,
    );
  }
  if (form === undefined) return declaration as ConfigurationContribution;
  const { id, description, options } = declaration as FormConfigurationContribution;
  try {
    const entries = settingEntriesOf(form);
    return {
      id,
      description,
      default: declaration.default,
      schema: settingSchemaOf(form),
      ...(options === undefined ? {} : { options }),
      ...(entries === undefined ? {} : { entries }),
    };
  } catch (cause) {
    throw new TypeError(
      `Plugin '${plugin}' declares the setting '${id}' with a form Tyto cannot read: ` +
        `${cause instanceof Error ? cause.message : String(cause)}.`,
      { cause },
    );
  }
}

/**
 * An option the schema it documents refuses would be a suggestion that writes a warning, which is
 * the plugin's mistake like a bad default, so it throws too.
 */
function checkOptions(
  plugin: string,
  id: string,
  what: string,
  options: readonly SettingOption[] | undefined,
  schema: ZodType<unknown> | undefined,
): void {
  if (options === undefined || schema === undefined) return;
  for (const option of options) {
    const checked = schema.safeParse(option.value);
    if (checked.success) continue;
    throw new TypeError(
      `Plugin '${plugin}' offers ${JSON.stringify(option.value)} as a ${what} of the setting ` +
        `'${id}', which its own schema refuses: ${issuesOf(checked.error.issues)}.`,
    );
  }
}

/** One key of a settings file, with where it was written when the reader knows. */
export interface SettingEntry {
  readonly key: string;
  readonly value: unknown;
  readonly keyRange?: SourceRange;
  readonly valueRange?: SourceRange;
  /** Where each entry of a list value was written, in order, when the value is a list. */
  readonly entryRanges?: readonly SourceRange[];
  /**
   * Where each member of an object value was written, by member name, when the value is an
   * object (TYTO-301): the name's range and the value's.
   */
  readonly memberRanges?: Readonly<Record<string, SettingMemberRange>>;
}

/** Where one member of an object value was written. */
export interface SettingMemberRange {
  readonly keyRange: SourceRange;
  readonly valueRange?: SourceRange;
}

export interface ResolvedSettings {
  /** Every declared key, by the key the file uses: the written value, or the default. */
  readonly values: Readonly<Record<string, unknown>>;
  /**
   * The same values by plugin id and then by the plugin's own key — the record
   * `PluginHost.config(schema)` reads a slice of, handed to `InProcessHost.configure`.
   */
  readonly config: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Defaults, then whatever the file says, **one key at a time** (ADR 0073).
 *
 * Never fails. A value the schema refuses costs that key alone — its default applies and a
 * `W_SETTING_INVALID` points at the value — so a typo in one setting cannot take the others
 * with it, which is exactly what validating the whole record as one object used to do. A key
 * no plugin declares is a `W_SETTING_UNKNOWN`; a plugin's key written without its prefix is a
 * `W_SETTING_UNPREFIXED`, and is not accepted under the short name. A list setting that
 * declares `entries` is tolerant one entry further down: a bad entry costs itself alone.
 */
export function resolveSettings(
  declared: readonly DeclaredSetting[],
  entries: readonly SettingEntry[],
): ResolvedSettings {
  const written = new Map<string, SettingEntry>();
  // Later wins, which is what `JSON.parse` does with a repeated key.
  for (const entry of entries) written.set(entry.key, entry);

  const values: Record<string, unknown> = {};
  const config: Record<string, Record<string, unknown>> = {};
  const diagnostics: Diagnostic[] = [];
  const known = new Set<string>();

  for (const setting of declared) {
    known.add(setting.key);
    const entry = written.get(setting.key);
    let value: unknown = setting.contribution.default;
    if (entry !== undefined) {
      const writtenValue = keptEntries(setting, entry, diagnostics);
      const parsed = setting.contribution.schema.safeParse(writtenValue);
      if (parsed.success) value = parsed.data;
      else
        diagnostics.push(
          diagnostic(
            'W_SETTING_INVALID',
            { key: setting.key, problem: `is not accepted (${issuesOf(parsed.error.issues)})` },
            rangeOption(entry.valueRange ?? entry.keyRange),
          ),
        );
    }
    values[setting.key] = value;
    (config[setting.plugin] ??= {})[setting.contribution.id] = value;
  }

  for (const entry of written.values()) {
    if (known.has(entry.key)) continue;
    const owner = declared.find(
      (setting) => setting.prefixed && setting.contribution.id === entry.key,
    );
    diagnostics.push(
      owner === undefined
        ? diagnostic('W_SETTING_UNKNOWN', { key: entry.key }, rangeOption(entry.keyRange))
        : diagnostic(
            'W_SETTING_UNPREFIXED',
            { key: entry.key, plugin: owner.plugin, expected: owner.key },
            rangeOption(entry.keyRange),
          ),
    );
  }

  return { values, config, diagnostics };
}

/**
 * The value to validate: the written one, or — for a list setting that checks its entries one
 * at a time — the list without the entries it refuses, each refused one reported where it was
 * written. Anything that is not a list is handed on as it is, for the schema to refuse whole.
 */
function keptEntries(
  setting: DeclaredSetting,
  entry: SettingEntry,
  diagnostics: Diagnostic[],
): unknown {
  if (setting.contribution.members !== undefined) return keptMembers(setting, entry, diagnostics);
  const rule = setting.contribution.entries;
  if (rule === undefined || !Array.isArray(entry.value)) return entry.value;
  const kept: unknown[] = [];
  const seen = new Set<string>();
  entry.value.forEach((item: unknown, index) => {
    const parsed = rule.schema.safeParse(item);
    const repeated = rule.unique && parsed.success && seen.has(JSON.stringify(parsed.data));
    if (parsed.success && !repeated) {
      seen.add(JSON.stringify(parsed.data));
      kept.push(parsed.data);
      return;
    }
    diagnostics.push(
      diagnostic(
        'W_SETTING_ENTRY_INVALID',
        {
          key: setting.key,
          position: String(index + 1),
          problem: parsed.success
            ? 'repeats an earlier entry'
            : `is not accepted (${issuesOf(parsed.error.issues)})`,
        },
        rangeOption(entry.entryRanges?.[index] ?? entry.valueRange ?? entry.keyRange),
      ),
    );
  });
  return kept;
}

/**
 * An object setting's value without the members it refuses, each refused one reported where it
 * was written: a name at the name, a value at the value. Anything that is not a plain object is
 * handed on as it is, for the schema to refuse whole.
 */
function keptMembers(
  setting: DeclaredSetting,
  entry: SettingEntry,
  diagnostics: Diagnostic[],
): unknown {
  const rule = setting.contribution.members;
  const value = entry.value;
  if (rule === undefined || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const kept: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(value as Record<string, unknown>)) {
    const where = entry.memberRanges?.[name];
    const key = rule.key.safeParse(name);
    if (!key.success) {
      diagnostics.push(
        diagnostic(
          'W_SETTING_ENTRY_INVALID',
          {
            key: setting.key,
            position: `'${name}'`,
            problem: `is not accepted (${issuesOf(key.error.issues)})`,
          },
          rangeOption(where?.keyRange ?? entry.valueRange ?? entry.keyRange),
        ),
      );
      continue;
    }
    const parsed = (rule.schemaByName?.[key.data] ?? rule.schema).safeParse(member);
    if (!parsed.success) {
      diagnostics.push(
        diagnostic(
          'W_SETTING_INVALID',
          {
            key: `${setting.key}.${name}`,
            problem: `is not accepted (${issuesOf(parsed.error.issues)})`,
          },
          rangeOption(where?.valueRange ?? where?.keyRange ?? entry.valueRange ?? entry.keyRange),
        ),
      );
      continue;
    }
    kept[name] = parsed.data;
  }
  return kept;
}

function rangeOption(range: SourceRange | undefined): { range?: SourceRange } {
  return range === undefined ? {} : { range };
}

function issuesOf(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): string {
  return issues
    .map((issue) =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.map(String).join('.')}: ${issue.message}`,
    )
    .join('; ');
}
