import type { AssetRef } from '../scene/primitives.js';

/**
 * Assets, as `resolve` is allowed to see them.
 *
 * `docs/brief-language.md` says paths in a brief are relative to the `.brief` file and
 * that `resolve` "confirms existence and computes a hash". Both are filesystem work, and
 * `core` is pure (ADR 0010) — so `resolve` asks this instead, and the adapter that knows
 * about disks lives in a Node package.
 *
 * `base` is here rather than passed alongside because it is the same knowledge: whatever
 * resolves a relative path already knows what it is relative to. `resolve` only reads it
 * to write `E_ASSET_NOT_FOUND`, which names the base so an author can see which folder was
 * searched.
 */
export interface AssetResolver {
  /** Where relative paths are resolved from, for the diagnostic that reports a miss. */
  readonly base: string;

  /**
   * The asset at `reference`, or `undefined` when nothing is there.
   *
   * Absence is a value, not a rejection: a brief pointing at a file that does not exist is
   * the most ordinary mistake an author makes, and `E_ASSET_NOT_FOUND` is the answer. A
   * rejection is left to mean what the operating system meant by it.
   */
  resolve(reference: string): Promise<AssetRef | undefined>;
}
