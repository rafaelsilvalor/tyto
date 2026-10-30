/**
 * The three outcomes ADR 0011 fixes, re-exported from where the contract lives.
 *
 * They moved to `@tyto/io` when `docs/render-contract.md` was published (TYTO-46): the
 * generator that writes that document cannot import an app, and two copies of "1 means
 * error diagnostics" is two places for it to stop being true. This module stays so that
 * every command still reads them from one import, and so the move is one file rather than
 * a rename across nine.
 */
export { EXIT_CODES, EXIT_DIAGNOSTICS, EXIT_INTERNAL, EXIT_OK, type ExitCode } from '@tyto/io';
