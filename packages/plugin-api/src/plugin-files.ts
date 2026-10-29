import {
  type ConfiguredTemplate,
  type Diagnostic,
  type Diagnostics,
  type Result,
  type SourceRange,
  type SuppliedValue,
  diagnostic,
  err,
  ok,
  sourceRange,
} from '@tyto/core';
import { type Document, isMap, isNode, isScalar, parseDocument } from 'yaml';
import { z } from 'zod';

/**
 * Plugin files: what to fetch and how to configure it (ADR 0151), read from strings.
 *
 * Two folders hold them, `TYTO_HOME/plugin-files/` for the machine and
 * `.tyto/plugin-files/` for a workspace, and every `*.yaml` in either is one file. Reading a
 * folder, running `git` and writing the lock are the apps' (`@tyto/io`); what a file says,
 * what the lock says and which folder wins a name are decided here, so the CLI and the
 * desktop cannot answer them differently.
 *
 * **Tolerant per key and per entry, as `project.json` is** (ADR 0112): a refused entry costs
 * that entry alone, at its range; an unknown key is a warning; a file that does not parse
 * loads nothing and says so. Configurations, `default` and aliases are kept as written here,
 * which checks their shape only; `@tyto/core` resolves them against the templates that loaded.
 */

export const PLUGIN_FILES_DIRECTORY = 'plugin-files';
export const PLUGIN_FILES_LOCK_FILE = 'plugin-files.lock.json';
export const PLUGIN_FILE_EXTENSION = '.yaml';

/** Where a source is, as the person's `git` reads it, and which ref of it. */
export interface PluginFileSource {
  readonly git: string;
  readonly ref: string;
}

/**
 * One named configuration, kept as written: `resolveTemplateConfigurations` in `@tyto/core`
 * resolves it (TYTO-439), and TYTO-440 its brief side. Each value keeps where it was written,
 * so a value the template refuses is a warning at that value.
 */
export interface PluginFileConfiguration {
  readonly alias?: string;
  readonly aliasRange?: SourceRange;
  /** The configuration's name in the file. */
  readonly range?: SourceRange;
  readonly values: Readonly<Record<string, SuppliedValue>>;
  readonly brief: Readonly<Record<string, unknown>>;
}

export interface PluginFileTemplate {
  /** The name the template's manifest declares. */
  readonly name: string;
  readonly source: PluginFileSource;
  readonly default?: string;
  readonly configurations: Readonly<Record<string, PluginFileConfiguration>>;
}

export interface PluginFile {
  /** The file as messages name it. */
  readonly file: string;
  /** Set when the file holds one plugin (`plugin:`). */
  readonly plugin?: { readonly source: PluginFileSource };
  /** The entries that were not refused, when the file holds templates. */
  readonly templates: readonly PluginFileTemplate[];
}

export interface PluginFileRead {
  /** Absent when the file loads nothing. */
  readonly value?: PluginFile;
  readonly diagnostics: Diagnostics;
}

/** The manifest's `TEMPLATE_NAME` rule, which an alias follows too. */
const TEMPLATE_NAME = /^[^\s/\\]+$/u;

type Node = unknown;

function rangeOf(node: Node): SourceRange | undefined {
  const range = (node as { range?: [number, number, number] } | null | undefined)?.range;
  return range === undefined ? undefined : sourceRange(range[0], range[1]);
}

function at(node: Node): { range?: SourceRange } {
  const range = rangeOf(node);
  return range === undefined ? {} : { range };
}

/** A mapping's entries as `[key, value node, key node]`, or `undefined` when it is not one. */
function entriesOf(node: Node): [string, Node, Node][] | undefined {
  if (!isMap(node)) return undefined;
  return node.items.map((pair) => {
    const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    return [key, pair.value, pair.key];
  });
}

function textOf(node: Node): string | undefined {
  return isScalar(node) && typeof node.value === 'string' && node.value.trim() !== ''
    ? node.value
    : undefined;
}

class FileReader {
  readonly diagnostics: Diagnostic[] = [];

  constructor(readonly file: string) {}

  unknown(path: string, node: Node): void {
    this.diagnostics.push(
      diagnostic('W_PLUGIN_FILE_KEY_UNKNOWN', { file: this.file, path }, at(node)),
    );
  }

  refuse(path: string, problem: string, node: Node): undefined {
    this.diagnostics.push(
      diagnostic('E_PLUGIN_FILE_ENTRY', { file: this.file, path, problem }, at(node)),
    );
    return undefined;
  }

  /** Warns on every key of `node` outside `known`, and answers the mapping's entries. */
  keys(path: string, node: Node, known: readonly string[]): Map<string, Node> | undefined {
    const entries = entriesOf(node);
    if (entries === undefined) return undefined;
    const found = new Map<string, Node>();
    for (const [key, value, keyNode] of entries) {
      if (known.includes(key)) found.set(key, value);
      else this.unknown(`${path}.${key}`, keyNode);
    }
    return found;
  }

  source(path: string, node: Node): PluginFileSource | undefined {
    const keys = this.keys(path, node, ['git', 'ref']);
    if (keys === undefined) return this.refuse(path, 'a source is a mapping of git and ref', node);
    const git = textOf(keys.get('git'));
    const ref = textOf(keys.get('ref'));
    if (git === undefined) return this.refuse(`${path}.git`, 'git is required', node);
    if (ref === undefined) {
      return this.refuse(`${path}.ref`, 'ref is required: a tag, a branch or a commit', node);
    }
    // Both reach `git` as arguments. A leading dash would be read as an option of git's own.
    if (git.startsWith('-')) return this.refuse(`${path}.git`, 'it may not start with -', node);
    if (ref.startsWith('-')) return this.refuse(`${path}.ref`, 'it may not start with -', node);
    return { git, ref };
  }

  mapping(path: string, node: Node): Record<string, unknown> | undefined {
    if (node === undefined || node === null) return {};
    if (!isMap(node)) return this.refuse(path, 'it must be a mapping', node);
    return (node.toJSON() ?? {}) as Record<string, unknown>;
  }

  /** A mapping's entries, each value as plain data with the range it was written at. */
  values(path: string, node: Node): Record<string, SuppliedValue> | undefined {
    if (node === undefined || node === null) return {};
    const entries = entriesOf(node);
    if (entries === undefined) return this.refuse(path, 'it must be a mapping', node);
    const values: Record<string, SuppliedValue> = {};
    for (const [name, value] of entries) {
      const data: unknown = isNode(value) ? value.toJSON() : value;
      values[name] = { value: data, ...at(value) };
    }
    return values;
  }

  configuration(path: string, node: Node, nameNode: Node): PluginFileConfiguration | undefined {
    const keys = this.keys(path, node, ['alias', 'values', 'brief']);
    if (keys === undefined) return this.refuse(path, 'a configuration is a mapping', node);
    const aliasNode = keys.get('alias');
    let alias: string | undefined;
    if (aliasNode !== undefined) {
      alias = textOf(aliasNode);
      if (alias === undefined || !TEMPLATE_NAME.test(alias)) {
        return this.refuse(
          `${path}.alias`,
          'an alias must not be blank or contain a space or a slash',
          aliasNode,
        );
      }
    }
    const values = this.values(`${path}.values`, keys.get('values'));
    const brief = this.mapping(`${path}.brief`, keys.get('brief'));
    if (values === undefined || brief === undefined) return undefined;
    const aliasRange = rangeOf(aliasNode);
    const range = rangeOf(nameNode);
    return {
      ...(alias === undefined ? {} : { alias }),
      ...(alias === undefined || aliasRange === undefined ? {} : { aliasRange }),
      ...(range === undefined ? {} : { range }),
      values,
      brief,
    };
  }

  template(name: string, node: Node, nameNode: Node): PluginFileTemplate | undefined {
    const path = `templates.${name}`;
    if (!TEMPLATE_NAME.test(name)) {
      return this.refuse(path, 'a template name must not contain a space or a slash', nameNode);
    }
    const keys = this.keys(path, node, ['source', 'default', 'configurations']);
    if (keys === undefined) return this.refuse(path, 'a template entry is a mapping', node);
    if (!keys.has('source')) return this.refuse(`${path}.source`, 'source is required', node);
    const source = this.source(`${path}.source`, keys.get('source'));
    if (source === undefined) return undefined;

    const configurations: Record<string, PluginFileConfiguration> = {};
    const configurationsNode = keys.get('configurations');
    if (configurationsNode !== undefined && configurationsNode !== null) {
      const entries = entriesOf(configurationsNode);
      if (entries === undefined) {
        return this.refuse(`${path}.configurations`, 'it must be a mapping', configurationsNode);
      }
      for (const [configurationName, value, configurationNode] of entries) {
        const configuration = this.configuration(
          `${path}.configurations.${configurationName}`,
          value,
          configurationNode,
        );
        if (configuration === undefined) return undefined;
        configurations[configurationName] = configuration;
      }
    }

    const defaultNode = keys.get('default');
    let chosen: string | undefined;
    if (defaultNode !== undefined) {
      chosen = textOf(defaultNode);
      if (chosen === undefined || configurations[chosen] === undefined) {
        return this.refuse(
          `${path}.default`,
          'default must name one of the entry’s configurations',
          defaultNode,
        );
      }
    }
    return { name, source, ...(chosen === undefined ? {} : { default: chosen }), configurations };
  }
}

function syntaxError(file: string, problem: string, range?: SourceRange): PluginFileRead {
  return {
    diagnostics: [
      diagnostic('E_PLUGIN_FILE_SYNTAX', { file, problem }, range === undefined ? {} : { range }),
    ],
  };
}

/** One plugin file, read and checked. `file` is the name its messages carry. */
export function parsePluginFile(source: string, file: string): PluginFileRead {
  let document: Document.Parsed;
  try {
    document = parseDocument(source);
  } catch (cause) {
    return syntaxError(file, cause instanceof Error ? cause.message : String(cause));
  }
  const [first] = document.errors;
  if (first !== undefined) {
    const problem = first.message.split('\n')[0] ?? first.message;
    return syntaxError(
      file,
      problem,
      sourceRange(first.pos[0], Math.min(first.pos[1], source.length)),
    );
  }

  const reader = new FileReader(file);
  const root = reader.keys('(root)', document.contents, ['version', 'plugin', 'templates']);
  if (root === undefined) return syntaxError(file, 'it must be a mapping with version: 1');
  const version = root.get('version');
  if (!isScalar(version) || version.value !== 1) {
    return syntaxError(file, 'version must be 1', rangeOf(version) ?? rangeOf(document.contents));
  }
  const pluginNode = root.get('plugin');
  const templatesNode = root.get('templates');
  if ((pluginNode === undefined) === (templatesNode === undefined)) {
    return syntaxError(file, 'it must hold exactly one of plugin and templates');
  }

  if (pluginNode !== undefined) {
    const keys = reader.keys('plugin', pluginNode, ['source']);
    const source =
      keys === undefined
        ? reader.refuse('plugin', 'plugin is a mapping with a source', pluginNode)
        : keys.has('source')
          ? reader.source('plugin.source', keys.get('source'))
          : reader.refuse('plugin.source', 'source is required', pluginNode);
    return {
      value: { file, templates: [], ...(source === undefined ? {} : { plugin: { source } }) },
      diagnostics: reader.diagnostics,
    };
  }

  const entries = entriesOf(templatesNode);
  if (entries === undefined)
    return syntaxError(file, 'templates must be a mapping', rangeOf(templatesNode));
  const templates: PluginFileTemplate[] = [];
  for (const [name, node, nameNode] of entries) {
    const template = reader.template(name, node, nameNode);
    if (template !== undefined) templates.push(template);
  }
  return { value: { file, templates }, diagnostics: reader.diagnostics };
}

/* ---------------------------------------------------------------------------- lock -- */

/** One source as the lock pins it: the ref the file names and the commit it resolved to. */
export interface PluginFilesLockEntry {
  readonly git: string;
  readonly ref: string;
  /** The full commit hash. */
  readonly commit: string;
  /** The name the fetched copy's `tyto-plugin.json` declares. */
  readonly plugin: string;
}

export interface PluginFilesLock {
  readonly sources: readonly PluginFilesLockEntry[];
}

export const EMPTY_PLUGIN_FILES_LOCK: PluginFilesLock = { sources: [] };

const lockSchema = z.object({
  version: z.literal(1),
  sources: z.array(
    z.object({
      git: z.string().min(1),
      ref: z.string().min(1),
      commit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u, 'a full commit hash'),
      plugin: z.string().min(1),
    }),
  ),
});

/** The lock the tool wrote. Unreadable is an error: guessing would move what was pinned. */
export function parsePluginFilesLock(
  source: string,
  file: string,
): Result<PluginFilesLock, Diagnostics> {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch (cause) {
    const problem = cause instanceof Error ? cause.message : String(cause);
    return err([diagnostic('E_PLUGIN_FILE_SYNTAX', { file, problem })]);
  }
  const parsed = lockSchema.safeParse(data);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const problem = `${issue?.path.join('.') ?? '(root)'}: ${issue?.message ?? 'invalid'}`;
    return err([diagnostic('E_PLUGIN_FILE_SYNTAX', { file, problem })]);
  }
  return ok({ sources: parsed.data.sources });
}

/** Sorted, so a lock that pins the same commits is the same bytes in version control. */
export function serializePluginFilesLock(lock: PluginFilesLock): string {
  const sources = [...lock.sources]
    .sort((left, right) => left.git.localeCompare(right.git) || left.ref.localeCompare(right.ref))
    .map(({ git, ref, commit, plugin }) => ({ git, ref, commit, plugin }));
  return `${JSON.stringify({ version: 1, sources }, null, 2)}\n`;
}

export function sameSource(left: PluginFileSource, right: PluginFileSource): boolean {
  return left.git === right.git && left.ref === right.ref;
}

/* ------------------------------------------------------------------------- folders -- */

/** One source a folder's files name, once however many entries name it. */
export interface PluginFolderSource extends PluginFileSource {
  /** The first file that names it, for messages. */
  readonly file: string;
  /** The templates the files name from it. Empty for a `plugin:` entry alone. */
  readonly templates: readonly string[];
  /** A `plugin:` entry names it, so it loads whatever templates it holds. */
  readonly wholePlugin: boolean;
}

export interface PluginFolderSources {
  readonly sources: readonly PluginFolderSource[];
  readonly diagnostics: Diagnostics;
}

/**
 * The sources one folder's files name, in file order.
 *
 * A template named by two files of one folder is supplied by neither: nothing in the folder
 * chose between them (ADR 0151 decision 7). Templates whose sources are equal share one entry,
 * so one fetch serves them all.
 */
export function folderSources(files: readonly PluginFile[]): PluginFolderSources {
  const diagnostics: Diagnostic[] = [];
  const namedIn = new Map<string, string[]>();
  for (const file of files) {
    for (const template of file.templates) {
      namedIn.set(template.name, [...(namedIn.get(template.name) ?? []), file.file]);
    }
  }
  for (const [name, named] of namedIn) {
    if (named.length > 1) {
      diagnostics.push(
        diagnostic('E_PLUGIN_FILE_DUPLICATE', {
          name,
          file: named[0] ?? '',
          other: named[1] ?? '',
        }),
      );
    }
  }

  const sources: { -readonly [Key in keyof PluginFolderSource]: PluginFolderSource[Key] }[] = [];
  const sourceOf = (file: string, source: PluginFileSource): (typeof sources)[number] => {
    const found = sources.find((item) => sameSource(item, source));
    if (found !== undefined) return found;
    const added = { ...source, file, templates: [] as string[], wholePlugin: false };
    sources.push(added);
    return added;
  };
  for (const file of files) {
    if (file.plugin !== undefined) sourceOf(file.file, file.plugin.source).wholePlugin = true;
    for (const template of file.templates) {
      if ((namedIn.get(template.name)?.length ?? 0) > 1) continue;
      const entry = sourceOf(file.file, template.source);
      entry.templates = [...entry.templates, template.name];
    }
  }
  return { sources, diagnostics };
}

/**
 * One folder's template entries as `resolveTemplateConfigurations` in `@tyto/core` takes them.
 *
 * A template two files of the folder name is left out, as {@link folderSources} leaves its
 * source out and already said why. `directory` is the folder the files are in, which an image
 * path in them is relative to.
 */
export function configuredTemplates(
  files: readonly PluginFile[],
  directory: string,
): ConfiguredTemplate[] {
  const entries = files.flatMap((file) =>
    file.templates.map((template) => ({ file: file.file, template })),
  );
  const counted = new Map<string, number>();
  for (const { template } of entries) {
    counted.set(template.name, (counted.get(template.name) ?? 0) + 1);
  }
  return entries
    .filter(({ template }) => counted.get(template.name) === 1)
    .map(({ file, template }) => ({
      template: template.name,
      file,
      directory,
      ...(template.default === undefined ? {} : { default: template.default }),
      configurations: Object.entries(template.configurations).map(([name, configuration]) => ({
        name,
        ...(configuration.alias === undefined ? {} : { alias: configuration.alias }),
        ...(configuration.aliasRange === undefined ? {} : { aliasRange: configuration.aliasRange }),
        ...(configuration.range === undefined ? {} : { range: configuration.range }),
        values: configuration.values,
      })),
    }));
}

/** What a sync does with one source. */
export interface PluginSyncStep {
  readonly source: PluginFolderSource;
  /** The lock's entry for it, when there is one. */
  readonly locked?: PluginFilesLockEntry;
  /**
   * Ask `git` where the ref is now. True for a source the lock lacks and, on the explicit
   * update, for every source; a start never moves a pinned ref (ADR 0151 decision 3).
   */
  readonly resolve: boolean;
}

export function planPluginSync(
  sources: readonly PluginFolderSource[],
  lock: PluginFilesLock,
  update: boolean,
): PluginSyncStep[] {
  return sources.map((source) => {
    const locked = lock.sources.find((entry) => sameSource(entry, source));
    return {
      source,
      ...(locked === undefined ? {} : { locked }),
      resolve: update || locked === undefined,
    };
  });
}

/** A fetched copy a folder supplies, ready to load. */
export interface PluginFilesCopy {
  readonly plugin: string;
  readonly file: string;
  readonly git: string;
  readonly ref: string;
  readonly commit: string;
  readonly templates: readonly string[];
  readonly wholePlugin: boolean;
}

/**
 * The copies that load, project before machine (ADR 0151 decision 7).
 *
 * In one folder, two sources that turn out to be one plugin supply it from neither. Across
 * folders the project's wins a plugin name, and a template the project names is dropped from
 * the machine's copies whole; a machine copy left naming nothing does not load.
 */
export function chooseCopies<Copy extends PluginFilesCopy>(
  project: readonly Copy[],
  machine: readonly Copy[],
): { readonly copies: Copy[]; readonly diagnostics: Diagnostics } {
  const diagnostics: Diagnostic[] = [];

  const withoutDuplicates = (copies: readonly Copy[]): Copy[] => {
    const merged: Copy[] = [];
    const refused = new Set<string>();
    for (const copy of copies) {
      const other = merged.find((item) => item.plugin === copy.plugin);
      if (other === undefined) {
        merged.push(copy);
      } else if (other.git === copy.git && other.commit === copy.commit) {
        merged[merged.indexOf(other)] = {
          ...other,
          templates: [...other.templates, ...copy.templates],
          wholePlugin: other.wholePlugin || copy.wholePlugin,
        };
      } else if (!refused.has(copy.plugin)) {
        refused.add(copy.plugin);
        diagnostics.push(
          diagnostic('E_PLUGIN_FILE_DUPLICATE', {
            name: copy.plugin,
            file: other.file,
            other: copy.file,
          }),
        );
      }
    }
    return merged.filter((copy) => !refused.has(copy.plugin));
  };

  const projectCopies = withoutDuplicates(project);
  const projectTemplates = new Map(
    projectCopies.flatMap((copy) => copy.templates.map((name) => [name, copy.file] as const)),
  );
  const machineCopies: Copy[] = [];
  for (const copy of withoutDuplicates(machine)) {
    const winner = projectCopies.find((item) => item.plugin === copy.plugin);
    if (winner !== undefined) {
      diagnostics.push(
        diagnostic('W_PLUGIN_FILE_OVERRIDDEN', {
          name: copy.plugin,
          file: winner.file,
          other: copy.file,
        }),
      );
      continue;
    }
    const templates = copy.templates.filter((name) => {
      const file = projectTemplates.get(name);
      if (file === undefined) return true;
      diagnostics.push(diagnostic('W_PLUGIN_FILE_OVERRIDDEN', { name, file, other: copy.file }));
      return false;
    });
    if (templates.length > 0 || copy.wholePlugin) machineCopies.push({ ...copy, templates });
  }
  return { copies: [...projectCopies, ...machineCopies], diagnostics };
}
