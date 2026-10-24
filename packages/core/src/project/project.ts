import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import type { Trust } from '../ports/trust-store.js';
import type { SourceRange } from '../source/range.js';
import { isInsidePath, resolvePath } from './paths.js';
import {
  EXPORT_PRESETS_KEY,
  type ExportPreset,
  type SheetPreset,
  presetPaths,
  readPresets,
} from './presets.js';

/**
 * A workspace's `.tyto/project.json`: the places a project keeps its things (TYTO-278,
 * ADR 0112).
 *
 * The file names folders and nothing else — assets, templates, fonts, where exports go — plus
 * one opaque section per plugin that plugins interpret (ADR 0011: Tyto never learns what a
 * Drive folder is). Reading the text is I/O and lives in `@tyto/io`; this is the pure rule
 * that turns what was written into folders, one key at a time like the settings (ADR 0073).
 *
 * **Layers** (ADR 0112, ADR 0114). A project is a list of sheets read in order — a work
 * profile, then the folder's own — each with the folder its relative paths resolve against and
 * its own trust answer (ADR 0111). Which profile a folder names is read by
 * {@link profileReferenceOf}; loading it is I/O.
 * Settings are not one of the layers: the file names places, and ADR 0073's per-folder
 * settings layer stays out.
 */

export const PROJECT_DIRECTORY = '.tyto';
export const PROJECT_FILE_NAME = 'project.json';

/** One top-level key of a project sheet, with where it was written. */
export interface ProjectEntry {
  readonly key: string;
  readonly value: unknown;
  readonly keyRange?: SourceRange;
  readonly valueRange?: SourceRange;
  /** Where each entry of a list value was written, in order. */
  readonly entryRanges?: readonly SourceRange[];
  /**
   * The value's syntax tree, for a key whose value nests (`exportPresets`, TYTO-270), so a
   * diagnostic can point at one field of one preset. Absent, nested ones point at the value.
   */
  readonly node?: ProjectNode;
}

/** One value of a project text with where it was written, down to every nested member. */
export interface ProjectNode {
  readonly range: SourceRange;
  /** An object's members, in order. */
  readonly members?: readonly ProjectMember[];
  /** An array's items, in order. */
  readonly items?: readonly ProjectNode[];
}

export interface ProjectMember {
  readonly key: string;
  readonly keyRange: SourceRange;
  readonly value: ProjectNode | undefined;
}

/** One sheet of a project: a workspace's own file, or (TYTO-347) a work profile. */
export interface ProjectLayer {
  readonly kind: 'folder' | 'profile';
  /**
   * The folder this sheet's relative paths resolve against, absolute: the workspace for its
   * own file, the profile's own folder for a profile. A restricted sheet is confined to it.
   */
  readonly root: string;
  readonly entries: readonly ProjectEntry[];
  readonly trust: Trust;
}

export interface ProjectResolveOptions {
  /**
   * Whether `path`, which the lexical check found inside layer `layer`'s root, leads outside
   * it once links are followed.
   *
   * The I/O side answers it after `realpath` on both ends (ADR 0111); asked only for the
   * paths {@link projectPaths} lists, each with the `root` it must stay inside: the layer's
   * own, or the workspace folder for a preset's folder (ADR 0126). Left out, the lexical check
   * is the only one, which is what a test of the rule itself wants and what no composition root
   * may ship.
   */
  readonly leadsOutside?: (layer: number, path: string, root: string) => boolean;
}

export interface ResolvedProject {
  /** Asset folders, searched after the brief's own folder and its `assets/` (ADR 0056). */
  readonly assets: readonly string[];
  /** Template folders, searched after a folder typed on the command line. */
  readonly templates: readonly string[];
  /** Font folders, searched before this machine's. */
  readonly fonts: readonly string[];
  /** Where exports go, when a sheet says. */
  readonly output: string | undefined;
  /**
   * Each plugin's section by plugin id, from trusted sheets only: a restricted sheet's are
   * withheld, as if it had none (ADR 0111).
   */
  readonly sections: Readonly<Record<string, unknown>>;
  /**
   * The export presets, merged by name, in the order first written (TYTO-270, ADR 0126). A
   * preset that names no folder has the project's `output`; one with neither is left out.
   */
  readonly exportPresets: readonly ExportPreset[];
  /**
   * Which kind of sheet each value came from, so the window can say "from the profile" or
   * "from this folder" (TYTO-347). A key no sheet set has no origin.
   */
  readonly origins: ProjectOrigins;
  /** What each sheet had to say, by layer index, so each is printed against its own text. */
  readonly diagnostics: readonly (readonly Diagnostic[])[];
}

export interface ProjectOrigins {
  readonly assets?: ProjectLayer['kind'];
  readonly templates?: ProjectLayer['kind'];
  readonly fonts?: ProjectLayer['kind'];
  readonly output?: ProjectLayer['kind'];
  /** By plugin id, as sections merge. */
  readonly sections: Readonly<Record<string, ProjectLayer['kind']>>;
}

type ListKey = 'assets' | 'templates' | 'fonts';
const LIST_KEYS: readonly ListKey[] = ['assets', 'templates', 'fonts'];
const KNOWN_KEYS = new Set<string>([
  ...LIST_KEYS,
  'output',
  'profile',
  'plugins',
  EXPORT_PRESETS_KEY,
]);

/** What one sheet sets; a key it does not set, or sets to nothing usable, is absent. */
interface LayerValues {
  assets?: readonly string[];
  templates?: readonly string[];
  fonts?: readonly string[];
  output?: string;
  sections?: Readonly<Record<string, unknown>>;
  presets?: ReadonlyMap<string, SheetPreset | null>;
}

/**
 * Every sheet, merged **key by key, the later sheet winning** (ADR 0112).
 *
 * A list key is replaced whole, never concatenated: a folder that writes `fonts` means those
 * fonts, and one that writes only `output` keeps the profile's lists. Plugin sections merge
 * per plugin, because each plugin's section is its own key. Never fails: a value that is
 * refused costs that key alone (ADR 0073 rule 5), and the key falls through to the sheet
 * before, or to nothing.
 */
export function resolveProject(
  layers: readonly ProjectLayer[],
  options: ProjectResolveOptions = {},
): ResolvedProject {
  const merged: LayerValues = {};
  let sections: Record<string, unknown> = {};
  const origins: { -readonly [Key in ListKey | 'output']?: ProjectLayer['kind'] } = {};
  const sectionOrigins: Record<string, ProjectLayer['kind']> = {};
  const presets = new Map<string, { preset: SheetPreset; layer: number }>();
  const workspace = workspaceOf(layers);
  const diagnostics = layers.map((layer, index) => {
    const found: Diagnostic[] = [];
    const values = readLayer(layer, index, workspace, options, found);
    for (const key of LIST_KEYS) {
      const value = values[key];
      if (value === undefined) continue;
      merged[key] = value;
      origins[key] = layer.kind;
    }
    if (values.output !== undefined) {
      merged.output = values.output;
      origins.output = layer.kind;
    }
    if (values.sections !== undefined) {
      sections = { ...sections, ...values.sections };
      for (const id of Object.keys(values.sections)) sectionOrigins[id] = layer.kind;
    }
    // By name, the later sheet's replacing the earlier's whole; a refused one removes the name.
    for (const [name, preset] of values.presets ?? []) {
      if (preset === null) presets.delete(name);
      else presets.set(name, { preset, layer: index });
    }
    return found;
  });
  const exportPresets: ExportPreset[] = [];
  for (const { preset, layer } of presets.values()) {
    const folder = preset.folder ?? merged.output;
    if (folder === undefined) {
      // No silent default: a delivery with nowhere to go is not run (ADR 0126).
      diagnostics[layer]?.push(
        diagnostic('W_PROJECT_PRESET_NO_FOLDER', { preset: preset.name }, at(preset.nameRange)),
      );
      continue;
    }
    exportPresets.push({
      name: preset.name,
      formats: preset.formats,
      types: preset.types,
      folder,
      origin: layers[layer]?.kind ?? 'folder',
    });
  }
  return {
    assets: merged.assets ?? [],
    templates: merged.templates ?? [],
    fonts: merged.fonts ?? [],
    output: merged.output,
    sections,
    exportPresets,
    origins: { ...origins, sections: sectionOrigins },
    diagnostics,
  };
}

/**
 * The paths the link check must look at: every folder a restricted sheet names that the
 * lexical check lets through. A trusted sheet's paths are not confined, so none of its own.
 */
export function projectPaths(
  layers: readonly ProjectLayer[],
): readonly { readonly layer: number; readonly path: string; readonly root: string }[] {
  const paths: { layer: number; path: string; root: string }[] = [];
  const workspace = workspaceOf(layers);
  layers.forEach((layer, index) => {
    // A preset's folder is confined to the workspace folder when either sheet is restricted.
    if (layer.trust === 'restricted' || workspace.trust === 'restricted') {
      for (const entry of layer.entries) {
        if (entry.key !== EXPORT_PRESETS_KEY) continue;
        for (const path of presetPaths(entry, workspace.root)) {
          paths.push({ layer: index, path, root: workspace.root });
        }
      }
    }
    if (layer.trust === 'trusted') return;
    for (const entry of layer.entries) {
      const written = LIST_KEYS.includes(entry.key as ListKey)
        ? Array.isArray(entry.value)
          ? entry.value
          : []
        : entry.key === 'output'
          ? [entry.value]
          : [];
      for (const value of written) {
        if (!isFolderValue(value)) continue;
        const path = resolvePath(layer.root, value);
        if (isInsidePath(layer.root, path)) paths.push({ layer: index, path, root: layer.root });
      }
    }
  });
  return paths;
}

/**
 * The workspace folder's sheet, the last `folder` one, which a preset's folder resolves
 * against whichever sheet wrote it (ADR 0126). A list with none (a test of a profile alone)
 * answers the last sheet.
 */
function workspaceOf(layers: readonly ProjectLayer[]): Pick<ProjectLayer, 'root' | 'trust'> {
  let found: ProjectLayer | undefined;
  for (const layer of layers) if (layer.kind === 'folder') found = layer;
  return found ?? layers[layers.length - 1] ?? { root: '/', trust: 'restricted' };
}

function readLayer(
  layer: ProjectLayer,
  index: number,
  workspace: Pick<ProjectLayer, 'root' | 'trust'>,
  options: ProjectResolveOptions,
  found: Diagnostic[],
): LayerValues {
  const written = new Map<string, ProjectEntry>();
  // Later wins, which is what `JSON.parse` does with a repeated key.
  for (const entry of layer.entries) written.set(entry.key, entry);

  const values: LayerValues = {};
  for (const entry of written.values()) {
    if (!KNOWN_KEYS.has(entry.key)) {
      found.push(diagnostic('W_PROJECT_KEY_UNKNOWN', { key: entry.key }, at(entry.keyRange)));
      continue;
    }
    if (entry.key === 'output') {
      const output = folderOf(layer, index, options, entry, entry.value, entry.valueRange, found);
      if (output !== undefined) values.output = output;
    } else if (entry.key === 'profile') {
      // A folder's is read by `profileReferenceOf`, because following it is I/O. A profile's
      // is ignored: one level only (ADR 0114), so no chain of sheets has to be walked,
      // cycle-checked and explained.
      if (layer.kind === 'profile') {
        found.push(
          diagnostic(
            'W_PROFILE_NESTED',
            {
              profile: typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
            },
            at(entry.valueRange ?? entry.keyRange),
          ),
        );
      }
    } else if (entry.key === EXPORT_PRESETS_KEY) {
      const leadsOutside = options.leadsOutside;
      const presets = readPresets(
        entry,
        {
          workspaceRoot: workspace.root,
          confined: layer.trust === 'restricted' || workspace.trust === 'restricted',
          leadsOutside:
            leadsOutside === undefined
              ? undefined
              : (path) => leadsOutside(index, path, workspace.root),
        },
        found,
      );
      if (presets !== undefined) values.presets = presets;
    } else if (entry.key === 'plugins') {
      const sections = sectionsOf(layer, entry, found);
      if (sections !== undefined) values.sections = sections;
    } else {
      const list = listOf(layer, index, options, entry, found);
      if (list !== undefined) values[entry.key as ListKey] = list;
    }
  }
  return values;
}

function listOf(
  layer: ProjectLayer,
  index: number,
  options: ProjectResolveOptions,
  entry: ProjectEntry,
  found: Diagnostic[],
): readonly string[] | undefined {
  if (!Array.isArray(entry.value)) {
    found.push(
      diagnostic(
        'W_PROJECT_KEY_INVALID',
        { key: entry.key, problem: 'is not a list of folders' },
        at(entry.valueRange ?? entry.keyRange),
      ),
    );
    return undefined;
  }
  const kept: string[] = [];
  entry.value.forEach((item: unknown, position) => {
    const range = entry.entryRanges?.[position] ?? entry.valueRange ?? entry.keyRange;
    const folder = folderOf(layer, index, options, entry, item, range, found);
    if (folder !== undefined && !kept.includes(folder)) kept.push(folder);
  });
  // A list whose every entry was refused is a key this sheet did not manage to set, so the
  // sheet before keeps its say, as a refused `output` does.
  return kept.length === 0 && entry.value.length > 0 ? undefined : kept;
}

/** One folder value, resolved against the sheet's root, or `undefined` with the reason. */
function folderOf(
  layer: ProjectLayer,
  index: number,
  options: ProjectResolveOptions,
  entry: ProjectEntry,
  value: unknown,
  range: SourceRange | undefined,
  found: Diagnostic[],
): string | undefined {
  if (!isFolderValue(value)) {
    found.push(
      diagnostic(
        'W_PROJECT_KEY_INVALID',
        { key: entry.key, problem: 'is not a folder path' },
        at(range ?? entry.keyRange),
      ),
    );
    return undefined;
  }
  const path = resolvePath(layer.root, value);
  if (layer.trust === 'trusted') return path;
  // Lexically first, which needs no disk; then, for what passed, whatever links say.
  const outside =
    !isInsidePath(layer.root, path) || (options.leadsOutside?.(index, path, layer.root) ?? false);
  if (!outside) return path;
  found.push(
    diagnostic(
      'W_PROJECT_PATH_OUTSIDE',
      { key: entry.key, path: value },
      at(range ?? entry.keyRange),
    ),
  );
  return undefined;
}

function sectionsOf(
  layer: ProjectLayer,
  entry: ProjectEntry,
  found: Diagnostic[],
): Readonly<Record<string, unknown>> | undefined {
  const value = entry.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    found.push(
      diagnostic(
        'W_PROJECT_KEY_INVALID',
        { key: entry.key, problem: 'is not an object of sections by plugin id' },
        at(entry.valueRange ?? entry.keyRange),
      ),
    );
    return undefined;
  }
  const names = Object.keys(value);
  if (names.length === 0) return undefined;
  if (layer.trust === 'restricted') {
    // Withheld, not dropped silently: the plugin that would read a section is already
    // installed and may reach the network, so the person is told what did not reach it.
    found.push(
      diagnostic('W_PROJECT_SECTIONS_WITHHELD', { plugins: names.join(', ') }, at(entry.keyRange)),
    );
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

function isFolderValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function at(range: SourceRange | undefined): { range?: SourceRange } {
  return range === undefined ? {} : { range };
}
