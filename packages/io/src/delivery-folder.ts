import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { type DeliveryPlan, type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';

import { isInside } from './contain.js';
import { isMissing, realOfNearest, realOrResolved } from './real-paths.js';

/**
 * Makes a new delivery on disk: its folder, the folders its layout lists and its brief
 * (TYTO-489, ADR 0157 decision 5). `planDelivery` in `core` decided the paths; this is the
 * half that needs the disk.
 *
 * - **An existing delivery folder is reused**, and the folders it lacks are made: a person who
 *   made the folder by hand, or dropped images into it first, keeps all of it.
 * - **An existing brief is refused** with `E_DELIVERY_BRIEF_EXISTS`. A delivery's brief is never
 *   overwritten.
 * - **A refusal writes nothing.** Every check runs before the first folder is made, so a run
 *   that refuses leaves the disk as it found it, not half a delivery.
 *
 * Confinement is ADR 0112's second half: `core` kept `parent` inside the workspace lexically,
 * and here each path is followed through `realpath`, so a junction inside the workspace that
 * lands outside is refused like a `..` (ADR 0157 §3).
 */

export interface CreateDeliveryOptions {
  /** The folder the delivery must stay inside: the workspace's, or the current one outside any. */
  readonly root: string;
  /** The new brief's text: a template's skeleton, or empty. */
  readonly brief: string;
  /** How a path is printed in a diagnostic; the path itself when left out. */
  readonly shown?: (path: string) => string;
}

export interface CreatedDelivery {
  /** True when the delivery's folder was already there. */
  readonly reused: boolean;
  /** The folders this run made, the delivery's own first when it was new. */
  readonly made: readonly string[];
}

export async function createDelivery(
  plan: DeliveryPlan,
  options: CreateDeliveryOptions,
): Promise<Result<CreatedDelivery, Diagnostics>> {
  const shown = options.shown ?? ((path: string) => path);
  const folders = [plan.folder, ...plan.folders, dirname(plan.brief)];

  const root = await realOrResolved(options.root);
  for (const path of [...folders, plan.brief]) {
    if (!isInside(root, await realOfNearest(path))) {
      return err([diagnostic('E_DELIVERY_PATH_OUTSIDE', { path: shown(path) })]);
    }
  }

  const missing: string[] = [];
  for (const folder of folders) {
    const kind = await kindOf(folder);
    if (kind === 'blocked' || kind === 'file') {
      return err([diagnostic('E_DELIVERY_FOLDER_BLOCKED', { path: shown(folder) })]);
    }
    if (kind === 'missing' && !missing.includes(folder)) missing.push(folder);
  }
  if ((await kindOf(plan.brief)) !== 'missing') {
    return err([diagnostic('E_DELIVERY_BRIEF_EXISTS', { path: shown(plan.brief) })]);
  }

  for (const folder of missing) await mkdir(folder, { recursive: true });
  try {
    // `wx` as well as the check above: a brief another process wrote in between still wins.
    await writeFile(plan.brief, options.brief, { encoding: 'utf8', flag: 'wx' });
  } catch (cause) {
    if (isAlreadyThere(cause)) {
      return err([diagnostic('E_DELIVERY_BRIEF_EXISTS', { path: shown(plan.brief) })]);
    }
    throw cause;
  }
  return ok({ reused: !missing.includes(plan.folder), made: missing });
}

/** What is at `path`: a folder, a file, nothing, or a file where one of its ancestors should be. */
async function kindOf(path: string): Promise<'folder' | 'file' | 'missing' | 'blocked'> {
  try {
    return (await stat(path)).isDirectory() ? 'folder' : 'file';
  } catch (cause) {
    if (isMissing(cause)) {
      // ENOTDIR: a file holds a name on the way, which `mkdir -p` would fail on.
      return (cause as { readonly code?: unknown }).code === 'ENOTDIR' ? 'blocked' : 'missing';
    }
    throw cause;
  }
}

function isAlreadyThere(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'EEXIST';
}
