import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import type { SourceRange } from '../source/range.js';
import { isInsidePath, resolvePath } from './paths.js';
import type { ProjectEntry, ProjectLayer, ProjectNode } from './project.js';

/**
 * `exportPresets`: a named delivery — which formats, which file types, which folder — that the
 * window runs with one key (TYTO-270, ADR 0126).
 *
 * A preset is data, never a script (ADR 0079): it runs the built-in export and only when the
 * person asks, so ADR 0111 counts it inert. It is read one entry at a time, tolerant like every
 * other key (ADR 0073 rule 5), and presets merge **by name**, as plugin sections merge by plugin
 * id (ADR 0112): a folder that redefines `entregas` replaces that preset whole and inherits the
 * profile's others.
 *
 * Two rules differ from the place keys, and ADR 0126 is where they are decided:
 *
 * - **`folder` resolves against the open workspace folder, whichever sheet wrote it.** A
 *   profile's `"folder": "entregas"` means the campaign's `entregas/`, not one inside
 *   `~/.tyto/profiles/<name>/`.
 * - **A refused preset is dropped, not fallen through.** A preset that ran with another sheet's
 *   formats or with `output` instead of the folder it names would deliver to the wrong place, so
 *   the name is gone and the diagnostic says why.
 */

export const EXPORT_PRESETS_KEY = 'exportPresets';

/** The file type a preset renders when it names none. */
export const DEFAULT_PRESET_TYPES: readonly string[] = ['png'];

const PRESET_KEYS = new Set(['formats', 'types', 'folder']);

/** One preset as the window runs it. */
export interface ExportPreset {
  /** As written: the command shows it untranslated. */
  readonly name: string;
  /** The formats to render, at least one, in the order written. */
  readonly formats: readonly string[];
  /** The exporter kinds to write, at least one; `png` when the preset names none. */
  readonly types: readonly string[];
  /** Where the files go, absolute: the preset's own `folder`, else the project's `output`. */
  readonly folder: string;
  /** The sheet that defined it. */
  readonly origin: ProjectLayer['kind'];
}

/** A preset one sheet defined, before the merge supplies a missing folder. */
export interface SheetPreset {
  readonly name: string;
  readonly formats: readonly string[];
  readonly types: readonly string[];
  readonly folder: string | undefined;
  /** Where the name was written, so a preset withheld later points at it. */
  readonly nameRange: SourceRange | undefined;
}

export interface PresetReading {
  /** Where the preset's folder must stay, and whether it is confined there. */
  readonly workspaceRoot: string;
  readonly confined: boolean;
  /** The I/O side's link check, asked only for what the lexical one let through. */
  readonly leadsOutside: ((path: string) => boolean) | undefined;
}

/**
 * The presets one sheet defines, by name; `null` is a name the sheet wrote and had refused,
 * which removes the name from what came before.
 */
export function readPresets(
  entry: ProjectEntry,
  reading: PresetReading,
  found: Diagnostic[],
): ReadonlyMap<string, SheetPreset | null> | undefined {
  const value = entry.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    found.push(
      diagnostic(
        'W_PROJECT_KEY_INVALID',
        { key: EXPORT_PRESETS_KEY, problem: 'is not an object of presets by name' },
        at(entry.valueRange ?? entry.keyRange),
      ),
    );
    return undefined;
  }
  const presets = new Map<string, SheetPreset | null>();
  const record = value as Readonly<Record<string, unknown>>;
  for (const name of Object.keys(record)) {
    const member = entry.node?.members?.find((item) => item.key === name);
    const fallback = entry.valueRange ?? entry.keyRange;
    presets.set(name, readPreset(name, record[name], member, fallback, reading, found));
  }
  return presets;
}

function readPreset(
  name: string,
  value: unknown,
  member: { readonly keyRange: SourceRange; readonly value: ProjectNode | undefined } | undefined,
  fallback: SourceRange | undefined,
  reading: PresetReading,
  found: Diagnostic[],
): SheetPreset | null {
  const nameRange = member?.keyRange ?? fallback;
  const key = `${EXPORT_PRESETS_KEY}.${name}`;
  const refuse = (problem: string, range: SourceRange | undefined, field?: string): null => {
    found.push(
      diagnostic(
        'W_PROJECT_KEY_INVALID',
        { key: field === undefined ? key : `${key}.${field}`, problem },
        at(range ?? nameRange),
      ),
    );
    return null;
  };

  if (name.trim() === '') return refuse('has an empty name', nameRange);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return refuse('is not an object with formats', member?.value?.range);
  }
  const fields = value as Readonly<Record<string, unknown>>;
  const fieldNode = (field: string) => member?.value?.members?.find((item) => item.key === field);

  for (const field of Object.keys(fields)) {
    if (PRESET_KEYS.has(field)) continue;
    // Unknown, not fatal: the preset still runs what it does say, as an unknown top-level key
    // costs nothing but itself. `delivery` lands here: the window always delivers (ADR 0057).
    found.push(
      diagnostic(
        'W_PROJECT_KEY_UNKNOWN',
        { key: `${key}.${field}` },
        at(fieldNode(field)?.keyRange ?? nameRange),
      ),
    );
  }

  const formats = namesOf(fields['formats'], fieldNode('formats'), `${key}.formats`, found);
  if (formats === undefined || formats.length === 0) {
    return refuse(
      'needs a list of at least one format',
      fieldNode('formats')?.value?.range ?? nameRange,
      'formats',
    );
  }

  let types = DEFAULT_PRESET_TYPES;
  if ('types' in fields) {
    const written = namesOf(fields['types'], fieldNode('types'), `${key}.types`, found);
    if (written === undefined || written.length === 0) {
      return refuse(
        'needs a list of at least one file type',
        fieldNode('types')?.value?.range ?? nameRange,
        'types',
      );
    }
    types = written;
  }

  let folder: string | undefined;
  if ('folder' in fields) {
    const written = fields['folder'];
    const range = fieldNode('folder')?.value?.range ?? nameRange;
    if (typeof written !== 'string' || written.trim() === '') {
      return refuse('is not a folder path', range, 'folder');
    }
    const path = resolvePath(reading.workspaceRoot, written);
    if (reading.confined) {
      // Lexically first, which needs no disk; then, for what passed, whatever links say. The
      // root is the workspace's for every sheet, because that is where the folder resolves.
      const outside =
        !isInsidePath(reading.workspaceRoot, path) || (reading.leadsOutside?.(path) ?? false);
      if (outside) {
        found.push(
          diagnostic('W_PROJECT_PATH_OUTSIDE', { key: `${key}.folder`, path: written }, at(range)),
        );
        return null;
      }
    }
    folder = path;
  }

  return { name, formats, types, folder, nameRange };
}

/**
 * A list of names, keeping the entries it accepts, one diagnostic per entry it does not.
 * `undefined` when the value is not a list at all.
 */
function namesOf(
  value: unknown,
  member: { readonly value: ProjectNode | undefined } | undefined,
  key: string,
  found: Diagnostic[],
): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept: string[] = [];
  value.forEach((item: unknown, position) => {
    if (typeof item === 'string' && item.trim() !== '') {
      if (!kept.includes(item)) kept.push(item);
      return;
    }
    found.push(
      diagnostic(
        'W_PROJECT_KEY_INVALID',
        { key, problem: 'has an entry that is not a name' },
        at(member?.value?.items?.[position]?.range ?? member?.value?.range),
      ),
    );
  });
  return kept;
}

/** The folders a confined preset names that the lexical check lets through. */
export function presetPaths(entry: ProjectEntry, workspaceRoot: string): readonly string[] {
  const value = entry.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const preset of Object.values(value as Readonly<Record<string, unknown>>)) {
    if (typeof preset !== 'object' || preset === null) continue;
    const folder = (preset as { readonly folder?: unknown }).folder;
    if (typeof folder !== 'string' || folder.trim() === '') continue;
    const path = resolvePath(workspaceRoot, folder);
    if (isInsidePath(workspaceRoot, path)) paths.push(path);
  }
  return paths;
}

function at(range: SourceRange | undefined): { range?: SourceRange } {
  return range === undefined ? {} : { range };
}
