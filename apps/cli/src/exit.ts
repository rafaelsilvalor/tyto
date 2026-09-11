/**
 * The three outcomes ADR 0011 fixes, and nothing else.
 *
 * `docs/integrations.md`: *exit 0 = ok, 1 = error diagnostics, 2 = internal failure*. The
 * distinction is the whole point of having two non-zero codes — Jacurutu retries an
 * internal failure and does not retry a brief that will not compile, and a CLI that
 * exited 1 for both would make it retry forever or never.
 */
export const EXIT_OK = 0;
/** The run produced error diagnostics: a brief, a template or a frame the author owns. */
export const EXIT_DIAGNOSTICS = 1;
/** Something threw that nobody turned into a diagnostic. Not the author's fault. */
export const EXIT_INTERNAL = 2;

export type ExitCode = typeof EXIT_OK | typeof EXIT_DIAGNOSTICS | typeof EXIT_INTERNAL;
