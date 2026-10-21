import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { Result } from '../result/result.js';

/**
 * Whether the person trusts a source, asked of whoever keeps the answer (ADR 0111, ADR 0112).
 *
 * A source is a workspace folder, a work profile outside `TYTO_HOME`, or anything added later
 * on the same terms. It starts restricted. The approvals live in `TYTO_HOME/trust.json`, and
 * reading that is I/O, so `core` holds only this port: the project resolver receives the
 * answer, never the store, and stays a function a test calls with either one.
 */

/** What a source may do: everything, or what ADR 0111 leaves a restricted one. */
export type Trust = 'trusted' | 'restricted';

export interface TrustAnswer {
  readonly trust: Trust;
  /**
   * Why the answer is less than the store would normally give, if it is: a `trust.json` that
   * cannot be read makes every source restricted and says so with `E_TRUST_FILE`, rather than
   * refusing to open anything.
   */
  readonly diagnostics: readonly Diagnostic[];
}

export interface TrustStore {
  /**
   * The answer for the source at `source`.
   *
   * The adapter compares real paths, so a link to a trusted folder is not that folder, and on
   * Windows it compares without case, as the file system does.
   */
  trustOf(source: string): Promise<TrustAnswer>;
  /** Records an approval. `ok(false)` when the source was already trusted. */
  grant(source: string): Promise<Result<boolean>>;
  /** Takes an approval back. `ok(false)` when the source was not trusted to begin with. */
  revoke(source: string): Promise<Result<boolean>>;
}
