import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import { type Result, err, ok } from '../result/result.js';
import type { SourceRange } from '../source/range.js';
import { isAbsolutePath, isInsidePath, resolvePath } from './paths.js';
import { problemWithFolderName } from './profile.js';
import type { ProjectEntry, ProjectLayer, ProjectNode } from './project.js';

/**
 * `delivery`: where a piece of work's folder is made and what goes inside it (TYTO-489,
 * ADR 0157).
 *
 * A delivery is one folder per piece of work, named after its ticket, holding the brief, its
 * images and the final artwork. The key says where those folders are made (`parent`), which
 * folders every new one gets (`folders`), where its brief is kept (`brief`) and where its
 * artwork is written (`exports`), plus what it exports (`formats`, `types`, read by TYTO-490).
 *
 * Every subkey is optional and **merged one at a time**, the later sheet winning (ADR 0112), so
 * a folder that writes only `exports` keeps its profile's `folders`. Unlike a preset (ADR 0126),
 * a refused subkey **falls through** to the sheet before or to the built-in value: each names a
 * place inside a folder the person sees, and the default puts it somewhere predictable.
 *
 * Two rules of where things resolve, from ADR 0157 decision 3:
 *
 * - **`parent` resolves against the workspace folder, whichever sheet wrote it**, and stays
 *   inside it whether the sheet is trusted or not: a delivery is part of the project by
 *   definition. Lexically here; the I/O side follows links (`projectPaths`).
 * - **`folders`, `brief` and `exports` are relative to the delivery's own folder** and stay
 *   inside it. `"."` is the delivery's root, valid for `brief` and `exports` but not as a folder
 *   to make.
 */

export const DELIVERY_KEY = 'delivery';

/** Where a brief is kept, after the delivery's own name: `editaveis/<name>.brief` (ADR 0057). */
export const DELIVERY_BRIEF_EXTENSION = '.brief';

/** A delivery name's longest, in UTF-16 code units: a ticket key and a title (ADR 0157). */
export const MAXIMUM_DELIVERY_NAME_LENGTH = 100;

/** The built-in layout, which a workspace with no `delivery` anywhere makes. */
export const BUILT_IN_DELIVERY = {
  parent: '.',
  folders: ['assets', 'editaveis'],
  brief: 'editaveis',
  exports: '.',
} as const;

const DELIVERY_KEYS = new Set(['parent', 'folders', 'brief', 'exports', 'formats', 'types']);

type Subkey = 'parent' | 'folders' | 'brief' | 'exports' | 'formats' | 'types';

/** The delivery layout in force, every subkey answered. */
export interface ResolvedDelivery {
  /** Where deliveries are made, absolute. */
  readonly parent: string;
  /** The folders made inside every new delivery, relative to it, in the order written. */
  readonly folders: readonly string[];
  /** The folder the brief is kept in, relative to the delivery; `.` is its root. */
  readonly brief: string;
  /** The folder the delivery's artwork is written to, relative to the delivery; `.` is its root. */
  readonly exports: string;
  /** What the delivery exports, when a sheet says; otherwise the brief decides (ADR 0157 §6). */
  readonly formats?: readonly string[];
  /** Which exporters, when a sheet says; otherwise `png`, as for a preset. */
  readonly types?: readonly string[];
  /** Which kind of sheet set each subkey; a subkey only the built-in answers has none. */
  readonly origins: Readonly<Partial<Record<Subkey, ProjectLayer['kind']>>>;
}

/** What one sheet's `delivery` sets; a subkey it does not set, or had refused, is absent. */
export interface SheetDelivery {
  parent?: string;
  folders?: readonly string[];
  brief?: string;
  exports?: string;
  formats?: readonly string[];
  types?: readonly string[];
}

export interface DeliveryReading {
  /** The workspace folder `parent` resolves against and stays inside. */
  readonly workspaceRoot: string;
  /** The I/O side's link check, asked only for a `parent` the lexical one let through. */
  readonly leadsOutside: ((path: string) => boolean) | undefined;
}

/** The built-in layout, with `root` as the parent: for a run in no workspace at all. */
export function builtInDelivery(root: string): ResolvedDelivery {
  return {
    parent: resolvePath(root, BUILT_IN_DELIVERY.parent),
    folders: BUILT_IN_DELIVERY.folders,
    brief: BUILT_IN_DELIVERY.brief,
    exports: BUILT_IN_DELIVERY.exports,
    origins: {},
  };
}

/** Every sheet's `delivery`, in order, merged one subkey at a time: the later sheet winning. */
export function mergeDelivery(
  workspaceRoot: string,
  sheets: readonly { readonly delivery: SheetDelivery; readonly kind: ProjectLayer['kind'] }[],
): ResolvedDelivery {
  const merged: SheetDelivery = {};
  const origins: Partial<Record<Subkey, ProjectLayer['kind']>> = {};
  for (const { delivery, kind } of sheets) {
    for (const key of Object.keys(delivery) as Subkey[]) {
      if (delivery[key] === undefined) continue;
      Object.assign(merged, { [key]: delivery[key] });
      origins[key] = kind;
    }
  }
  const builtIn = builtInDelivery(workspaceRoot);
  return {
    parent: merged.parent ?? builtIn.parent,
    folders: merged.folders ?? builtIn.folders,
    brief: merged.brief ?? builtIn.brief,
    exports: merged.exports ?? builtIn.exports,
    ...(merged.formats === undefined ? {} : { formats: merged.formats }),
    ...(merged.types === undefined ? {} : { types: merged.types }),
    origins,
  };
}

/** One sheet's `delivery`, read one subkey at a time; never fails. */
export function readDelivery(
  entry: ProjectEntry,
  reading: DeliveryReading,
  found: Diagnostic[],
): SheetDelivery {
  const value = entry.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    found.push(
      diagnostic(
        'W_PROJECT_KEY_INVALID',
        { key: DELIVERY_KEY, problem: 'is not an object of delivery settings' },
        at(entry.valueRange ?? entry.keyRange),
      ),
    );
    return {};
  }
  const fields = value as Readonly<Record<string, unknown>>;
  const member = (field: string) => entry.node?.members?.find((item) => item.key === field);
  const fallback = entry.valueRange ?? entry.keyRange;
  const valueRange = (field: string) => member(field)?.value?.range ?? fallback;
  const refuse = (field: string, problem: string, range = valueRange(field)): undefined => {
    found.push(
      diagnostic('W_PROJECT_KEY_INVALID', { key: `${DELIVERY_KEY}.${field}`, problem }, at(range)),
    );
    return undefined;
  };

  const read: SheetDelivery = {};
  for (const field of Object.keys(fields)) {
    if (DELIVERY_KEYS.has(field)) continue;
    found.push(
      diagnostic(
        'W_PROJECT_KEY_UNKNOWN',
        { key: `${DELIVERY_KEY}.${field}` },
        at(member(field)?.keyRange ?? fallback),
      ),
    );
  }

  if ('parent' in fields) {
    const written = fields['parent'];
    if (typeof written !== 'string' || written.trim() === '') {
      refuse('parent', 'is not a folder path');
    } else {
      const path = resolvePath(reading.workspaceRoot, written);
      // Confined for every sheet, trusted or not (ADR 0157 §3): lexically first, then links.
      const outside =
        !isInsidePath(reading.workspaceRoot, path) || (reading.leadsOutside?.(path) ?? false);
      if (outside) {
        found.push(
          diagnostic(
            'W_PROJECT_PATH_OUTSIDE',
            { key: `${DELIVERY_KEY}.parent`, path: written },
            at(valueRange('parent')),
          ),
        );
      } else {
        read.parent = path;
      }
    }
  }

  for (const field of ['brief', 'exports'] as const) {
    if (!(field in fields)) continue;
    const written = fields[field];
    const inside = typeof written === 'string' ? insideDelivery(written) : undefined;
    if (inside === undefined) refuse(field, 'is not a folder inside the delivery');
    else read[field] = inside;
  }

  if ('folders' in fields) {
    const folders = listOf(fields['folders'], member('folders')?.value, 'folders', (item) => {
      const inside = typeof item === 'string' ? insideDelivery(item) : undefined;
      // The delivery's own root is made anyway; listing it is a mistake, not a folder.
      return inside === '.' ? undefined : inside;
    });
    if (folders === 'not a list') refuse('folders', 'is not a list of folders');
    else if (folders !== undefined) read.folders = folders;
  }

  for (const field of ['formats', 'types'] as const) {
    if (!(field in fields)) continue;
    const names = listOf(fields[field], member(field)?.value, field, (item) =>
      typeof item === 'string' && item.trim() !== '' ? item : undefined,
    );
    if (names === 'not a list' || names?.length === 0) {
      refuse(field, 'needs a list of at least one name');
    } else if (names !== undefined) {
      read[field] = names;
    }
  }
  return read;

  /**
   * A list, keeping what `accept` accepts with one diagnostic per entry it refuses;
   * `undefined` when every entry was refused, which counts as not written (ADR 0157 §2).
   */
  function listOf(
    written: unknown,
    node: ProjectNode | undefined,
    field: string,
    accept: (item: unknown) => string | undefined,
  ): readonly string[] | 'not a list' | undefined {
    if (!Array.isArray(written)) return 'not a list';
    const kept: string[] = [];
    written.forEach((item: unknown, position) => {
      const accepted = accept(item);
      if (accepted === undefined) {
        refuse(field, 'has an entry that is not accepted', node?.items?.[position]?.range);
      } else if (!kept.includes(accepted)) {
        kept.push(accepted);
      }
    });
    return kept.length === 0 && written.length > 0 ? undefined : kept;
  }
}

/**
 * `written` as a path relative to the delivery, with `/` and no `.` segments, or `undefined`
 * when it is not one that stays inside: absolute, empty, or climbing out with `..`. The
 * delivery's root is `.`.
 */
function insideDelivery(written: string): string | undefined {
  if (written.trim() === '' || isAbsolutePath(written)) return undefined;
  const root = '/delivery';
  const path = resolvePath(root, written);
  if (!isInsidePath(root, path)) return undefined;
  const relative = path.slice(root.length).replace(/^\/+/u, '');
  return relative === '' ? '.' : relative;
}

/** The `parent` a sheet wrote, resolved, for the I/O side's link check; none if refused. */
export function deliveryParentPath(entry: ProjectEntry, workspaceRoot: string): string | undefined {
  const value = entry.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const parent = (value as { readonly parent?: unknown }).parent;
  if (typeof parent !== 'string' || parent.trim() === '') return undefined;
  const path = resolvePath(workspaceRoot, parent);
  return isInsidePath(workspaceRoot, path) ? path : undefined;
}

/**
 * A delivery's name as typed, normalised to NFC, or why it cannot be one folder's name.
 *
 * NFC so that an `ã` typed as one code point or as two names one folder, and the brief inside
 * carries the same spelling (ADR 0157 §4). Case is not folded: the file system decides.
 */
export function deliveryNameOf(written: string): Result<string, Diagnostic[]> {
  const name = written.normalize('NFC');
  const problem =
    name === ''
      ? 'is empty'
      : problemWithFolderName(name, {
          noun: 'a delivery name',
          maximum: MAXIMUM_DELIVERY_NAME_LENGTH,
        });
  if (problem === undefined) return ok(name);
  return err([diagnostic('W_DELIVERY_NAME_INVALID', { name: written, problem })]);
}

/** What `tyto delivery new` makes, every path absolute. */
export interface DeliveryPlan {
  /** The name, normalised. */
  readonly name: string;
  /** The delivery's own folder. */
  readonly folder: string;
  /** The folders made inside it: the layout's `folders`, then the brief's when not listed. */
  readonly folders: readonly string[];
  /** The brief's file: `<brief>/<name>.brief`. */
  readonly brief: string;
}

/**
 * The folders and the brief a new delivery called `written` needs, from the layout in force;
 * `W_DELIVERY_NAME_INVALID` when the name cannot be a folder's. Nothing here reads a disk:
 * whether the folder exists, and what to do about it, is the I/O side's.
 */
export function planDelivery(
  delivery: ResolvedDelivery,
  written: string,
): Result<DeliveryPlan, Diagnostic[]> {
  const named = deliveryNameOf(written);
  if (!named.ok) return named;
  const name = named.value;
  const folder = resolvePath(delivery.parent, name);
  const relative = [...delivery.folders];
  // The brief's folder is made when it is needed, listed or not (ADR 0157 §3).
  if (delivery.brief !== '.' && !relative.includes(delivery.brief)) relative.push(delivery.brief);
  return ok({
    name,
    folder,
    folders: relative.map((item) => resolvePath(folder, item)),
    brief: resolvePath(folder, `${delivery.brief}/${name}${DELIVERY_BRIEF_EXTENSION}`),
  });
}

function at(range: SourceRange | undefined): { range?: SourceRange } {
  return range === undefined ? {} : { range };
}
