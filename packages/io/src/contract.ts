/**
 * The ADR 0011 contract, as values something can derive a document from.
 *
 * `result.json`'s schema lives in `result.ts`; this is the other half — the exit codes a
 * caller reads and the policy that says when either may change. They moved here from
 * `apps/cli` when `docs/render-contract.md` was published (TYTO-46): a document generated
 * from the code cannot import an app, and two copies of "1 means error diagnostics" is two
 * places for it to stop being true.
 */

/** Nothing went wrong. Artifacts may still be fewer than planned if the run was cancelled. */
export const EXIT_OK = 0;
/**
 * The run produced error diagnostics, or the command line was refused.
 *
 * One code for both because they are one answer to the reader's only question: **the same
 * invocation will fail again unless something changes.** A brief that does not compile and
 * a flag that does not exist are both that.
 */
export const EXIT_DIAGNOSTICS = 1;
/**
 * Something threw that nobody turned into a diagnostic.
 *
 * A browser that will not launch, an unwritable output folder, a `result.json` that does
 * not match its own schema. **This is the only code worth retrying**, and that is the whole
 * reason ADR 0011 fixes two non-zero codes instead of one.
 */
export const EXIT_INTERNAL = 2;

export type ExitCode = typeof EXIT_OK | typeof EXIT_DIAGNOSTICS | typeof EXIT_INTERNAL;

/** One entry per code, for a document that has to list them without hardcoding them. */
export const EXIT_CODES: readonly {
  readonly code: ExitCode;
  readonly name: string;
  readonly meaning: string;
  readonly retry: boolean;
}[] = [
  {
    code: EXIT_OK,
    name: 'ok',
    meaning: 'Nothing went wrong. `result.json` has `status: "ok"`.',
    retry: false,
  },
  {
    code: EXIT_DIAGNOSTICS,
    name: 'error diagnostics',
    meaning:
      'The brief, the template or a frame produced an error — or the command line was ' +
      'refused. `result.json` has `status: "error"` and lists what went wrong, except ' +
      'when the command line was refused, in which case no run started and no ' +
      '`result.json` was written.',
    retry: false,
  },
  {
    code: EXIT_INTERNAL,
    name: 'internal failure',
    meaning:
      'Something threw that is not about this brief: a browser that will not launch, an ' +
      'unwritable output folder. `result.json` may be absent.',
    retry: true,
  },
];

/**
 * The names the folder contract fixes. Changing one breaks Jacurutu, not just a test.
 *
 * `BRIEF_FILE`, `ASSETS_DIR`, `OUT_DIR` and `RESULT_FILE` are declared beside the adapters
 * that use them; they are re-exported through the package index, and this list is what a
 * document walks so the two cannot drift.
 */
export interface ContractPath {
  readonly path: string;
  readonly written: 'caller' | 'tyto';
  readonly meaning: string;
}
