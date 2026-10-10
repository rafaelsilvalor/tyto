import { type Diagnostic, type SourceRange, diagnostic } from '@tyto/core';
import type { ZodType } from 'zod';

import type { Contribution } from './contributions.js';

/**
 * The `configuration` extension point: a setting a plugin declares, and the one pure rule
 * that turns what a person wrote into values (TYTO-206, ADR 0073).
 *
 * **Declared in code, with a Zod schema**, because the settings it has to describe already
 * are Zod schemas — a templates folder is a non-empty string or `null`, a queue's file types
 * are a record of non-empty lists — and a second, JSON-shaped vocabulary for the same rules
 * would be two declarations waiting to drift. The cost is that a schema does not cross a
 * process boundary, so an isolated plugin cannot declare one yet (`NOT_YET_ISOLATED`).
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
  contribution: ConfigurationContribution,
): DeclaredSetting {
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
  return {
    key: prefixed ? `${plugin}.${contribution.id}` : contribution.id,
    plugin,
    prefixed,
    contribution,
  };
}

/** One key of a settings file, with where it was written when the reader knows. */
export interface SettingEntry {
  readonly key: string;
  readonly value: unknown;
  readonly keyRange?: SourceRange;
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
 * `W_SETTING_UNPREFIXED`, and is not accepted under the short name.
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
      const parsed = setting.contribution.schema.safeParse(entry.value);
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
