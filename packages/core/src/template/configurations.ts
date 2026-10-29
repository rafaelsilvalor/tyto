import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import { checkValue } from './declared-values.js';

import type { AssetRef } from '../scene/primitives.js';
import type { SourceRange } from '../source/range.js';
import type { SuppliedValue, SuppliedValues } from './declared-values.js';
import type { TemplateManifest } from './manifest.js';
import type { TemplateRegistry } from './registry.js';

/**
 * The configurations and aliases plugin files give templates, resolved (ADR 0151, TYTO-439).
 *
 * A plugin file names a template and gives it named configurations. Each configuration is
 * reached by its alias, which is `<template>-<configuration>` when the file writes none, and
 * the entry's `default` is reached by the template's own name; every other configuration starts
 * from the `default` and changes what it lists. What a brief's `template:` names
 * is looked up here first: an alias renders its template with that configuration's values, and
 * the brief does not know it named a variant.
 *
 * **Pure**: the files arrive read, the registry arrives loaded, and an image path reaches a
 * file through a port the app composes, which also keeps it inside the folder it may read
 * (ADR 0151 decision 2). Nothing here imports a parser, so nothing here can reach the
 * `@tyto/core/template` entry a plugin bundles.
 *
 * **Every value is checked here, once, against what the template declared** (ADR 0153), so a
 * warning points into the plugin file it was written in rather than into whichever brief
 * happens to name the alias first; `compile` then finds nothing left to refuse.
 */

/** Which folder an entry came from. The project's wins a name over the machine's. */
export type ConfigurationScope = 'project' | 'machine';

/** One named configuration of a template, as a plugin file writes it. */
export interface ConfigurationEntry {
  readonly name: string;
  /** As written, or absent for `<template>-<configuration>`. */
  readonly alias?: string;
  readonly aliasRange?: SourceRange;
  /** Where the configuration's name is, for a diagnostic about the whole of it. */
  readonly range?: SourceRange;
  readonly values: Readonly<Record<string, SuppliedValue>>;
}

/** The name a brief reaches a configuration by: its alias, or `<template>-<configuration>`. */
export function configurationAlias(
  template: string,
  configuration: Pick<ConfigurationEntry, 'name' | 'alias'>,
): string {
  return configuration.alias ?? `${template}-${configuration.name}`;
}

/** One template a plugin file configures. */
export interface ConfiguredTemplate {
  readonly template: string;
  /** The file, as messages name it. */
  readonly file: string;
  /** The file's folder: what an image path in it is relative to. */
  readonly directory: string;
  readonly default?: string;
  readonly configurations: readonly ConfigurationEntry[];
}

/** An image a configuration names, read and checked by the app, or why it was not. */
export type ConfigurationImage = { readonly ref: AssetRef } | { readonly problem: string };

/**
 * Reads an image path relative to the folder of the file that wrote it. A project file's
 * image stays inside the workspace and a machine file's inside `TYTO_HOME` (ADR 0151); the
 * app knows both, so the check is its own.
 */
export type ConfigurationImageResolver = (
  path: string,
  from: { readonly directory: string; readonly scope: ConfigurationScope },
) => Promise<ConfigurationImage>;

/** What a name in a brief selects: the template it renders, and the values it renders with. */
export interface TemplateSelection {
  readonly template: string;
  /** Absent for a template's bare name when its entry names no `default`. */
  readonly configuration?: string;
  readonly values: SuppliedValues;
}

/** An alias that loads, for a list or a picker. */
export interface TemplateAlias {
  readonly alias: string;
  readonly template: string;
  readonly configuration: string;
  readonly file: string;
}

export interface TemplateConfigurations {
  /** Undefined when no plugin file configures the name: it is looked up as it is. */
  select(name: string): TemplateSelection | undefined;
  /** Every alias that loads, in name order. */
  aliases(): readonly TemplateAlias[];
}

/** A diagnostic and the plugin file its range points into, when it has one. */
export interface ConfigurationDiagnostic {
  readonly file?: string;
  readonly diagnostic: Diagnostic;
}

export interface ResolvedConfigurations {
  readonly configurations: TemplateConfigurations;
  readonly diagnostics: readonly ConfigurationDiagnostic[];
}

export const NO_TEMPLATE_CONFIGURATIONS: TemplateConfigurations = {
  select: () => undefined,
  aliases: () => [],
};

export interface ResolveConfigurationsInput {
  /** The project's entries, already free of a template two of its files name. */
  readonly project: readonly ConfiguredTemplate[];
  /** The machine's, the same. */
  readonly machine: readonly ConfiguredTemplate[];
  /** The templates that loaded, filtered packs included: what an alias may not be named. */
  readonly registry: TemplateRegistry;
  readonly images: ConfigurationImageResolver;
}

interface Placed {
  readonly entry: ConfiguredTemplate;
  readonly scope: ConfigurationScope;
}

interface Candidate extends Placed {
  readonly alias: string;
  readonly configuration: ConfigurationEntry;
}

export async function resolveTemplateConfigurations(
  input: ResolveConfigurationsInput,
): Promise<ResolvedConfigurations> {
  const diagnostics: ConfigurationDiagnostic[] = [];
  const report = (file: string | undefined, item: Diagnostic): void => {
    diagnostics.push(file === undefined ? { diagnostic: item } : { file, diagnostic: item });
  };

  // A project entry replaces the machine's whole (ADR 0151 decision 2); the sync already
  // said so for the template, so nothing more is reported here.
  const projectTemplates = new Set(input.project.map((entry) => entry.template));
  const placed: Placed[] = [
    ...input.project.map((entry) => ({ entry, scope: 'project' as const })),
    ...input.machine
      .filter((entry) => !projectTemplates.has(entry.template))
      .map((entry) => ({ entry, scope: 'machine' as const })),
  ];

  // A template nobody could load configures nothing: a brief that names its alias gets
  // `E_UNKNOWN_TEMPLATE`, beside the sync's own word on why it is missing.
  const loaded = placed.filter(({ entry }) => input.registry.get(entry.template) !== undefined);

  // Every name a template answers to, whether it loaded or not: an alias that shadows one
  // would render one thing or another depending on a fetch (ADR 0151 decision 7).
  const templateNames = new Set([
    ...input.registry.list().map((manifest) => manifest.name),
    ...placed.map(({ entry }) => entry.template),
  ]);

  const candidates: Candidate[] = [];
  for (const { entry, scope } of loaded) {
    for (const configuration of entry.configurations) {
      const alias = configurationAlias(entry.template, configuration);
      if (templateNames.has(alias)) {
        report(
          entry.file,
          diagnostic(
            'E_TEMPLATE_ALIAS_TAKEN',
            { alias, file: entry.file },
            atRange(configuration.aliasRange ?? configuration.range),
          ),
        );
        continue;
      }
      candidates.push({ entry, scope, alias, configuration });
    }
  }

  const aliases = new Map<string, Candidate>();
  for (const scope of ['project', 'machine'] as const) {
    const inFolder = candidates.filter((candidate) => candidate.scope === scope);
    for (const [alias, named] of groupBy(inFolder, (candidate) => candidate.alias)) {
      const [first, second] = named;
      if (first === undefined) continue;
      if (second !== undefined) {
        // One folder gave the name twice and chose no order, so it supplies it from neither.
        report(
          second.entry.file,
          diagnostic(
            'E_PLUGIN_FILE_DUPLICATE',
            { name: alias, file: first.entry.file, other: second.entry.file },
            atRange(second.configuration.aliasRange ?? second.configuration.range),
          ),
        );
        continue;
      }
      const winner = aliases.get(alias);
      if (winner !== undefined) {
        report(
          first.entry.file,
          diagnostic(
            'W_PLUGIN_FILE_OVERRIDDEN',
            { name: alias, file: winner.entry.file, other: first.entry.file },
            atRange(first.configuration.aliasRange ?? first.configuration.range),
          ),
        );
        continue;
      }
      aliases.set(alias, first);
    }
  }

  // Checked once per configuration a name can reach, however many names reach it.
  const checked = new Map<ConfigurationEntry, SuppliedValues>();
  const valuesOf = async (
    { entry, scope }: Placed,
    configuration: ConfigurationEntry,
  ): Promise<SuppliedValues> => {
    const known = checked.get(configuration);
    if (known !== undefined) return known;
    // Defined: only loaded entries reach here.
    const manifest = input.registry.get(entry.template) as TemplateManifest;
    const own = await checkValues(manifest, entry, scope, configuration, input.images, report);
    // A named configuration starts from the entry's `default` and changes what it lists.
    // The default is checked once, as itself, so a value it refuses is said once.
    const base = entry.configurations.find((item) => item.name === entry.default);
    const values =
      base === undefined || base === configuration
        ? own
        : { ...(await valuesOf({ entry, scope }, base)), ...own };
    checked.set(configuration, values);
    return values;
  };

  const selections = new Map<string, TemplateSelection>();
  for (const [alias, candidate] of aliases) {
    selections.set(alias, {
      template: candidate.entry.template,
      configuration: candidate.configuration.name,
      values: await valuesOf(candidate, candidate.configuration),
    });
  }
  for (const item of loaded) {
    const chosen = item.entry.configurations.find(
      (configuration) => configuration.name === item.entry.default,
    );
    selections.set(
      item.entry.template,
      chosen === undefined
        ? { template: item.entry.template, values: {} }
        : {
            template: item.entry.template,
            configuration: chosen.name,
            values: await valuesOf(item, chosen),
          },
    );
  }

  const listed = [...aliases]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([alias, candidate]) => ({
      alias,
      template: candidate.entry.template,
      configuration: candidate.configuration.name,
      file: candidate.entry.file,
    }));

  return {
    configurations: { select: (name) => selections.get(name), aliases: () => listed },
    diagnostics,
  };
}

/**
 * The values a template can take, each checked as `compile` would: what it did not declare,
 * or what its kind or limits refuse, is a warning at the value and is left out, so the
 * template's default stands. An image path becomes the ref the app read it as.
 */
async function checkValues(
  manifest: TemplateManifest,
  entry: ConfiguredTemplate,
  scope: ConfigurationScope,
  configuration: ConfigurationEntry,
  images: ConfigurationImageResolver,
  report: (file: string, item: Diagnostic) => void,
): Promise<SuppliedValues> {
  const declared = manifest.values ?? {};
  const values: Record<string, SuppliedValue> = {};
  for (const [name, supplied] of Object.entries(configuration.values)) {
    const where = atRange(supplied.range);
    const declaration = declared[name];
    if (declaration === undefined) {
      report(
        entry.file,
        diagnostic('W_TEMPLATE_VALUE_UNKNOWN', { template: manifest.name, name }, where),
      );
      continue;
    }
    let value = supplied.value;
    if (declaration.type === 'image') {
      if (typeof value !== 'string' || value.trim() === '') {
        report(
          entry.file,
          diagnostic(
            'W_TEMPLATE_VALUE_INVALID',
            { template: manifest.name, name, problem: 'is not a path to an image' },
            where,
          ),
        );
        continue;
      }
      const image = await images(value, { directory: entry.directory, scope });
      if ('problem' in image) {
        report(
          entry.file,
          diagnostic(
            'W_TEMPLATE_VALUE_INVALID',
            { template: manifest.name, name, problem: image.problem },
            where,
          ),
        );
        continue;
      }
      value = image.ref;
    }
    const result = checkValue(declaration, value);
    if ('problem' in result) {
      report(
        entry.file,
        diagnostic(
          'W_TEMPLATE_VALUE_INVALID',
          { template: manifest.name, name, problem: result.problem },
          where,
        ),
      );
      continue;
    }
    values[name] = { value: result.value, ...(supplied.range === undefined ? {} : where) };
  }
  return values;
}

function atRange(range: SourceRange | undefined): { range?: SourceRange } {
  return range === undefined ? {} : { range };
}

function groupBy<Item>(items: readonly Item[], key: (item: Item) => string): Map<string, Item[]> {
  const groups = new Map<string, Item[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}
