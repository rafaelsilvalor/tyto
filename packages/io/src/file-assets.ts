import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type { AssetResolver, AssetRef } from '@tyto/core';

import { isInside } from './contain.js';

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
   * Refuse a path that climbs out of `base`.
   *
   * On by default. A brief is often written by something else — Jacurutu drops a task
   * folder (ADR 0011) — and `../../../.ssh/id_rsa` embedded as a data URI inside an
   * exported PNG is a real way to leak a file. A local author rendering their own folder
   * can turn it off.
   */
  readonly confine?: boolean;
}

/** `sha256-<hex>`, the form `AssetRef.hash` carries elsewhere in the codebase. */
function hashOf(bytes: Buffer): string {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

export function fileAssetResolver(options: FileAssetResolverOptions): AssetResolver {
  const base = resolve(options.base);
  const confine = options.confine ?? true;

  return {
    base,

    async resolve(reference: string): Promise<AssetRef | undefined> {
      const full = isAbsolute(reference) ? resolve(reference) : resolve(base, reference);

      // Reported as absence rather than as a throw, so a brief that climbs out gets the
      // same `E_ASSET_NOT_FOUND` as a typo — which is what it is from the author's side,
      // and which does not tell a hostile brief whether the file it guessed at exists.
      if (confine && !isInside(base, full)) return undefined;

      let bytes: Buffer;
      try {
        bytes = await readFile(full);
      } catch {
        // Absence is a value, not a rejection: a brief pointing at a file that is not
        // there is the most ordinary mistake an author makes, and `E_ASSET_NOT_FOUND` is
        // the answer the port's contract asks for. An unreadable file — permissions, a
        // directory where a file was expected — is folded in with it rather than thrown,
        // because either way the author's next move is to look at that path.
        return undefined;
      }

      return {
        // The reference as written, so a diagnostic and a `Scene.assets` entry both say
        // what the brief said rather than an absolute path from this machine.
        id: reference,
        source: 'file',
        path: full,
        hash: hashOf(bytes),
      };
    },
  };
}
