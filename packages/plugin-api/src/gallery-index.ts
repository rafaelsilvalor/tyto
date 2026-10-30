import {
  type Diagnostic,
  type Diagnostics,
  type SourceRange,
  diagnostic,
  sourceRange,
} from '@tyto/core';
import { type Document, isMap, isNode, isScalar, isSeq, parseDocument } from 'yaml';
import { z } from 'zod';

import { satisfiesEngine } from './engine.js';
import type { PluginFile, PluginFilesLock } from './plugin-files.js';

/**
 * The gallery index (ADR 0162): a maintained list of templates and plugins, read from strings.
 *
 * The list lives in a repository somebody curates, as `index.yaml` at its root; fetching it is
 * `@tyto/io`'s, through the person's `git`. What the index says, and how each entry stands
 * against this machine's plugin files and lock, is decided here so the CLI and the window
 * cannot answer it differently.
 *
 * **Tolerant per entry, as a plugin file is** (ADR 0151): a refused entry costs itself alone,
 * at its range; an unknown key is a warning; an index that does not parse lists nothing.
 */

export const GALLERY_INDEX_FILE = 'index.yaml';

export type GalleryKind = 'template' | 'plugin';

export interface GalleryEntry {
  /** What `tyto gallery install <id>` takes, and a plugin's file name in `plugin-files/`. */
  readonly id: string;
  readonly kind: GalleryKind;
  readonly name: string;
  readonly description: string;
  /** Where the entry's repository is, as the person's `git` reads it. */
  readonly git: string;
  /** The tag install pins and update moves to. */
  readonly latest: string;
  /** The names the template's manifest declares; empty for a plugin. */
  readonly templates: readonly string[];
  /** The configurations the entry offers, by name, for the gallery to show. */
  readonly configurations: readonly string[];
  /** A picture, relative to the index repository's root. */
  readonly preview?: string;
  /** The plugin API range the entry needs, written as a `tyto-plugin.json` `engine` is. */
  readonly engine: string;
  /** What `latest` changes, in the curator's words: the text an update shows. */
  readonly changes?: string;
  readonly range?: SourceRange;
}

export interface GalleryIndex {
  readonly entries: readonly GalleryEntry[];
}

export interface GalleryIndexRead {
  /** Absent when the index lists nothing. */
  readonly value?: GalleryIndex;
  readonly diagnostics: Diagnostics;
}

/** An id is a file name in `plugin-files/` too, so it carries no separator and no dot first. */
const ID = /^[a-z0-9][a-z0-9_-]*$/u;
/** The manifest's `TEMPLATE_NAME` rule. */
const TEMPLATE_NAME = /^[^\s/\\]+$/u;

/** A value `git` receives as an argument; a leading dash would be read as an option of its own. */
const gitArgument = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.startsWith('-'), 'it may not start with -');

const entrySchema = z
  .object({
    id: z.string().regex(ID, 'lowercase letters, digits, - and _, starting with a letter or digit'),
    kind: z.enum(['template', 'plugin']),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    source: z.object({ git: gitArgument }),
    latest: gitArgument,
    templates: z.array(z.string().regex(TEMPLATE_NAME, 'a template name')).optional(),
    configurations: z.array(z.string().trim().min(1)).optional(),
    preview: z.string().trim().min(1).optional(),
    engine: z.string().trim().min(1),
    changes: z.string().trim().min(1).optional(),
  })
  .superRefine((entry, context) => {
    const templates = entry.templates ?? [];
    if (entry.kind === 'template' && templates.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['templates'],
        message: 'a template entry names the templates its manifest declares',
      });
    }
    if (entry.kind === 'plugin' && templates.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['templates'],
        message: 'a plugin entry names no templates; a plugin file holds one plugin',
      });
    }
  });

const ENTRY_KEYS = [
  'id',
  'kind',
  'name',
  'description',
  'source',
  'latest',
  'templates',
  'configurations',
  'preview',
  'engine',
  'changes',
] as const;

function rangeOf(node: unknown): SourceRange | undefined {
  const range = (node as { range?: [number, number, number] } | null | undefined)?.range;
  return range === undefined ? undefined : sourceRange(range[0], range[1]);
}

function at(node: unknown): { range?: SourceRange } {
  const range = rangeOf(node);
  return range === undefined ? {} : { range };
}

function syntaxError(index: string, problem: string, range?: SourceRange): GalleryIndexRead {
  return {
    diagnostics: [
      diagnostic(
        'E_GALLERY_INDEX_SYNTAX',
        { index, problem },
        range === undefined ? {} : { range },
      ),
    ],
  };
}

/** The node an issue's path points at inside `entry`, so the diagnostic sits where it is wrong. */
function nodeAt(entry: unknown, path: readonly PropertyKey[]): unknown {
  if (!isMap(entry) && !isSeq(entry)) return entry;
  const found = entry.getIn(
    path.map((key) => (typeof key === 'symbol' ? String(key) : key)),
    true,
  );
  return isNode(found) ? found : entry;
}

/** The index somebody curates, read and checked. `index` is the name its messages carry. */
export function parseGalleryIndex(source: string, index: string): GalleryIndexRead {
  let document: Document.Parsed;
  try {
    document = parseDocument(source);
  } catch (cause) {
    return syntaxError(index, cause instanceof Error ? cause.message : String(cause));
  }
  const [first] = document.errors;
  if (first !== undefined) {
    return syntaxError(
      index,
      first.message.split('\n')[0] ?? first.message,
      sourceRange(first.pos[0], Math.min(first.pos[1], source.length)),
    );
  }
  const root = document.contents;
  if (!isMap(root)) return syntaxError(index, 'it must be a mapping with version: 1');
  const version: unknown = root.get('version', true);
  if (!isScalar(version) || version.value !== 1) {
    return syntaxError(index, 'version must be 1', rangeOf(version) ?? rangeOf(root));
  }
  const diagnostics: Diagnostic[] = [];
  for (const pair of root.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    if (key !== 'version' && key !== 'entries') {
      diagnostics.push(
        diagnostic('W_GALLERY_INDEX_KEY_UNKNOWN', { index, path: key }, at(pair.key)),
      );
    }
  }
  const list = root.get('entries', true);
  if (!isSeq(list))
    return syntaxError(index, 'entries must be a list', rangeOf(list) ?? rangeOf(root));

  const entries: GalleryEntry[] = [];
  const seen = new Set<string>();
  list.items.forEach((node, position) => {
    const data: unknown = isNode(node) ? node.toJSON() : node;
    const label =
      (isMap(node) && isScalar(node.get('id', true)) ? String(node.get('id')) : undefined) ??
      `#${position + 1}`;
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
        if (!(ENTRY_KEYS as readonly string[]).includes(key)) {
          diagnostics.push(
            diagnostic(
              'W_GALLERY_INDEX_KEY_UNKNOWN',
              { index, path: `${label}.${key}` },
              at(pair.key),
            ),
          );
        }
      }
    }
    const parsed = entrySchema.safeParse(data);
    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      const path = issue?.path ?? [];
      const where = path.length === 0 ? '' : `${path.join('.')}: `;
      diagnostics.push(
        diagnostic(
          'E_GALLERY_INDEX_ENTRY',
          { index, entry: label, problem: `${where}${issue?.message ?? 'invalid'}` },
          at(nodeAt(node, path)),
        ),
      );
      return;
    }
    const entry = parsed.data;
    if (seen.has(entry.id)) {
      diagnostics.push(
        diagnostic(
          'E_GALLERY_INDEX_ENTRY',
          { index, entry: label, problem: 'an earlier entry has this id' },
          at(nodeAt(node, ['id'])),
        ),
      );
      return;
    }
    seen.add(entry.id);
    entries.push({
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      description: entry.description,
      git: entry.source.git,
      latest: entry.latest,
      templates: entry.templates ?? [],
      configurations: entry.configurations ?? [],
      ...(entry.preview === undefined ? {} : { preview: entry.preview }),
      engine: entry.engine,
      ...(entry.changes === undefined ? {} : { changes: entry.changes }),
      ...at(node),
    });
  });
  return { value: { entries }, diagnostics };
}

/* -------------------------------------------------------------------------- status -- */

/**
 * Two ways of writing one repository count as one: a trailing `/` or `.git` is how people
 * copy a URL, and an entry written by hand before the gallery existed must still be found.
 */
export function sameRepository(left: string, right: string): boolean {
  const plain = (git: string): string =>
    git
      .trim()
      .replace(/\/+$/u, '')
      .replace(/\.git$/u, '');
  return plain(left) === plain(right);
}

/** Where a machine plugin file already holds an entry, one place per template or plugin. */
export interface GalleryPlacement {
  /** The plugin file, as `PluginFile.file` names it. */
  readonly file: string;
  /** The template's name in the file; absent for a file that holds a plugin. */
  readonly template?: string;
  readonly git: string;
  readonly ref: string;
  /** Whether the file's lock pins this exact source, so a sync has fetched it. */
  readonly synced: boolean;
}

export type GalleryState = 'not installed' | 'installed' | 'update available';

export interface GalleryStatus {
  readonly entry: GalleryEntry;
  readonly state: GalleryState;
  readonly placements: readonly GalleryPlacement[];
  /** False when this Tyto's plugin API is outside the entry's `engine`: listed, never installed. */
  readonly compatible: boolean;
}

/** The files of one folder and the lock beside them. */
export interface GalleryFolder {
  readonly files: readonly PluginFile[];
  readonly lock: PluginFilesLock;
}

function placementsOf(entry: GalleryEntry, folder: GalleryFolder): GalleryPlacement[] {
  const synced = (git: string, ref: string): boolean =>
    folder.lock.sources.some((locked) => locked.git === git && locked.ref === ref);
  const placements: GalleryPlacement[] = [];
  for (const file of folder.files) {
    if (entry.kind === 'plugin') {
      const source = file.plugin?.source;
      if (source !== undefined && sameRepository(source.git, entry.git)) {
        placements.push({ file: file.file, ...source, synced: synced(source.git, source.ref) });
      }
      continue;
    }
    for (const template of file.templates) {
      if (
        entry.templates.includes(template.name) &&
        sameRepository(template.source.git, entry.git)
      ) {
        placements.push({
          file: file.file,
          template: template.name,
          ...template.source,
          synced: synced(template.source.git, template.source.ref),
        });
      }
    }
  }
  return placements;
}

/**
 * Each entry against the machine's plugin files and lock (ADR 0162).
 *
 * Installed means some file holds the entry's repository under a name it declares, whichever
 * file that is: a person who wrote the entry by hand has it installed. An update is
 * available when any place pins a ref other than `latest`; it is shown and waits, and only
 * `tyto gallery update` moves it.
 */
export function galleryStatus(
  index: GalleryIndex,
  folder: GalleryFolder,
  engineVersion: string,
): GalleryStatus[] {
  return index.entries.map((entry) => {
    const placements = placementsOf(entry, folder);
    const state: GalleryState =
      placements.length === 0
        ? 'not installed'
        : placements.every((placement) => placement.ref === entry.latest)
          ? 'installed'
          : 'update available';
    return {
      entry,
      state,
      placements,
      compatible: satisfiesEngine(entry.engine, engineVersion),
    };
  });
}
