/**
 * The lines run in the command panel, newest last, kept per workspace folder (TYTO-496).
 *
 * **Kept in the window's own storage and not by main**, because nothing but this panel reads
 * it and no path crosses to main for it (ADR 0113): the key is the folder the window was told
 * is open, and the value is what the person typed. A storage that throws — a sandboxed
 * profile, a full disk — leaves the panel with a history for this session only, never an
 * error. No ADR decides this; the pull request that added it says so.
 */

/** The most lines kept per folder: a shell's default, and a few kilobytes of storage. */
export const HISTORY_LIMIT = 500;

const STORAGE_PREFIX = 'tyto.commandPanel.history:';

/** The history after running `line`: the line moves to the end, never stored twice. */
export function withHistoryLine(history: readonly string[], line: string): readonly string[] {
  const trimmed = line.trim();
  if (trimmed === '') return history;
  return [...history.filter((entry) => entry !== trimmed), trimmed].slice(-HISTORY_LIMIT);
}

/**
 * Walking the history with ↑ and ↓, the way a shell does: ↑ from the line being typed goes to
 * the newest entry, ↓ past the newest gives back what was being typed.
 */
export class HistoryCursor {
  /** `history.length` is "the line being typed", which no entry is. */
  private at: number;
  private draft = '';

  constructor(private readonly history: readonly string[]) {
    this.at = history.length;
  }

  /** The line to show after ↑, or `undefined` at the oldest entry. */
  older(current: string): string | undefined {
    if (this.at === 0) return undefined;
    if (this.at === this.history.length) this.draft = current;
    this.at -= 1;
    return this.history[this.at];
  }

  /** The line to show after ↓, or `undefined` while already on the line being typed. */
  newer(): string | undefined {
    if (this.at >= this.history.length) return undefined;
    this.at += 1;
    return this.at === this.history.length ? this.draft : this.history[this.at];
  }
}

/**
 * Ctrl+R's search: the newest entry at or before `before` that contains `query`, ignoring
 * case. `before` lets Ctrl+R pressed again step to the next older match.
 */
export function searchHistory(
  history: readonly string[],
  query: string,
  before: number = history.length,
): { readonly line: string; readonly index: number } | undefined {
  const wanted = query.toLowerCase();
  for (let index = Math.min(before, history.length) - 1; index >= 0; index -= 1) {
    const line = history[index] ?? '';
    if (line.toLowerCase().includes(wanted)) return { line, index };
  }
  return undefined;
}

/** What the history is read from and written to; `localStorage` in the window. */
export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const keyOf = (folder: string | null): string => `${STORAGE_PREFIX}${folder ?? ''}`;

/** The history kept for `folder` (`null`, no folder open), or none when it cannot be read. */
export function loadHistory(storage: HistoryStorage | undefined, folder: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(keyOf(folder)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string').slice(-HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function saveHistory(
  storage: HistoryStorage | undefined,
  folder: string | null,
  history: readonly string[],
): void {
  try {
    storage?.setItem(keyOf(folder), JSON.stringify(history));
  } catch {
    // A storage that refuses keeps this session's history in memory only; see the header.
  }
}
