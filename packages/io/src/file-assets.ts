import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import type { AssetResolver, AssetRef } from '@tyto/core';

import { isInside } from './contain.js';
import { ASSETS_DIR } from './fs-inbox.js';
import { hashOf } from './hash.js';

/**
 * `core`'s `AssetResolver` port, on a real disk.
 *
 * `docs/brief-language.md` says a path in a brief is relative to the `.brief` file and
 * that `resolve` "confirms existence and computes a hash". Both are filesystem work and
 * `core` is pure, so this is where they happen — the second port that has been waiting
 * for its first adapter since E3.3.
 *
 * The hash is what makes ADR 0003's promise checkable: *same brief plus same assets
 * produce the same bytes*. It is content, not path or mtime, because a designer who
 * replaces `logo.png` with a different logo under the same name has changed the artwork,
 * and a cache keyed on the path would not notice.
 */

export interface FileAssetResolverOptions {
  /**
   * The folder relative paths in the brief resolve against — normally the brief's own
   * folder. `resolve` reads it only to write `E_ASSET_NOT_FOUND`, which names it so an
   * author can see which folder was searched.
   */
  readonly base: string;
  /**
   * Folders tried after `base`, in order, when nothing is at the path there.
   *
   * `briefAssetResolver` passes `assets/` beside the brief (ADR 0056). Each folder is its
   * own containment root: a reference that climbs out of `base` is refused outright rather
   * than retried here, because `../secret` read against `assets/` lands back inside the
   * brief's folder and would turn an escape into a quiet success.
   */
  readonly fallbacks?: readonly string[];
  /**
   * Refuse a path that climbs out of `base`.
   *
   * On by default. A brief is often written by something else — Jacurutu drops a task
   * folder (ADR 0011) — and `../../../.ssh/id_rsa` embedded as a data URI inside an
   * exported PNG is a real way to leak a file. A local author rendering their own folder
   * can turn it off.
   */
  readonly confine?: boolean;
}

/** The file at `reference` under `base`, or `undefined` — outside, missing or unreadable. */
async function readUnder(
  base: string,
  reference: string,
  confine: boolean,
): Promise<{ readonly path: string; readonly bytes: Buffer } | 'escaped' | undefined> {
  const full = isAbsolute(reference) ? resolve(reference) : resolve(base, reference);

  // Reported as absence rather than as a throw, so a brief that climbs out gets the
  // same `E_ASSET_NOT_FOUND` as a typo — which is what it is from the author's side,
  // and which does not tell a hostile brief whether the file it guessed at exists.
  if (confine && !isInside(base, full)) return 'escaped';

  try {
    return { path: full, bytes: await readFile(full) };
  } catch {
    // Absence is a value, not a rejection: a brief pointing at a file that is not
    // there is the most ordinary mistake an author makes, and `E_ASSET_NOT_FOUND` is
    // the answer the port's contract asks for. An unreadable file — permissions, a
    // directory where a file was expected — is folded in with it rather than thrown,
    // because either way the author's next move is to look at that path.
    return undefined;
  }
}

export function fileAssetResolver(options: FileAssetResolverOptions): AssetResolver {
  const base = resolve(options.base);
  const fallbacks = (options.fallbacks ?? []).map((folder) => resolve(folder));
  const confine = options.confine ?? true;

  return {
    base,

    async resolve(reference: string): Promise<AssetRef | undefined> {
      // The literal path first, so what the brief says is what it gets when it is there.
      let found = await readUnder(base, reference, confine);
      if (found === 'escaped') return undefined;
      for (const folder of fallbacks) {
        if (found !== undefined) break;
        const next = await readUnder(folder, reference, confine);
        found = next === 'escaped' ? undefined : next;
      }
      if (found === undefined) return undefined;

      return {
        // The reference as written, so a diagnostic and a `Scene.assets` entry both say
        // what the brief said rather than an absolute path from this machine.
        id: reference,
        source: 'file',
        // Where the bytes were found, which differs by folder. The hash does not: it is
        // the bytes' (ADR 0003), so one image renders the same from either place.
        path: found.path,
        hash: hashOf(found.bytes),
      };
    },
  };
}

/**
 * The asset rule every surface uses (ADR 0056): the path as written in the brief, read
 * from the brief's folder first, then from `assets/` beside it.
 *
 * The CLI, `tyto watch`, the queue, the desktop preview, the export box and the template
 * editor's brief preview all build their resolver here, so one folder renders the same in
 * all of them. Before this, the CLI and the inbox read `assets/` only and the desktop read
 * the brief's folder only, and a delivery-shaped folder worked in one and lost its images
 * in the other.
 */
export function briefAssetResolver(options: {
  readonly briefDirectory: string;
  readonly confine?: boolean;
}): AssetResolver {
  return fileAssetResolver({
    base: options.briefDirectory,
    fallbacks: [join(options.briefDirectory, ASSETS_DIR)],
    ...(options.confine === undefined ? {} : { confine: options.confine }),
  });
}
