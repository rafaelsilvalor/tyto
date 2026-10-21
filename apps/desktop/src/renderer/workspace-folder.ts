/**
 * The workspace folder as the window shows it (TYTO-278, ADR 0113): its problems in the
 * problems panel, and its output folder as the export dialog's destination.
 *
 * Main opens the folder and reads it; the window only paints the answer. Kept apart from
 * `main.ts` so the two rules below are pinned by a test that needs no window.
 */

/**
 * Every code the project file and the trust store raise. The rows of a workspace answer
 * replace these, and nothing else, so opening or closing a folder never drops a save failure.
 */
export const WORKSPACE_CODES: ReadonlySet<string> = new Set([
  'E_PROJECT_SYNTAX',
  'W_PROJECT_KEY_UNKNOWN',
  'W_PROJECT_KEY_INVALID',
  'W_PROJECT_PATH_OUTSIDE',
  'W_PROJECT_SECTIONS_WITHHELD',
  'W_PROJECT_PROFILE_INVALID',
  'W_PROJECT_PROFILE_MISSING',
  'W_PROFILE_NESTED',
  'E_TRUST_FILE',
]);

/** The installation rows with the workspace's replaced by what this answer said. */
export function withWorkspaceRows<Row extends { readonly code: string }>(
  installation: readonly Row[],
  workspaceRows: readonly Row[],
): readonly Row[] {
  return [...installation.filter((row) => !WORKSPACE_CODES.has(row.code)), ...workspaceRows];
}

/**
 * Where the export dialog points: the folder the person picked in this window, else the open
 * workspace's output folder, else nothing — the dialog then asks, as it always did.
 */
export function exportDestination(
  picked: string | undefined,
  workspaceOutput: string | null,
): string | undefined {
  return picked ?? workspaceOutput ?? undefined;
}
