import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  type Diagnostic,
  type Result,
  type TrustAnswer,
  type TrustStore,
  diagnostic,
  err,
  ok,
} from '@tyto/core';
import { applyEdits, modify, parse, type ParseError, printParseErrorCode } from 'jsonc-parser';

/**
 * `TYTO_HOME/trust.json`: the person's approvals, one per trusted source (ADR 0111).
 *
 * One file per user, never inside a source and never in the per-version data folder, so the
 * CLI and the window read the same answers and an update forgets none. Keyed by the source's
 * real path, written in the path's own spelling and compared without case on Windows, as the
 * file system compares. JSONC like the settings, and edited in place, so a comment the person
 * wrote beside an entry survives a grant or a revoke.
 *
 * ```jsonc
 * { "trusted": [{ "path": "D:\\work\\promo", "since": "2026-10-21" }] }
 * ```
 */

export const TRUST_FILE = 'trust.json';

export interface FsTrustStoreOptions {
  /** `TYTO_HOME`. */
  readonly home: string;
  /** For the `since` of a new approval; a test fixes it. */
  readonly now?: () => Date;
  /** Whether paths compare without case; the platform's answer unless a test says. */
  readonly ignoreCase?: boolean;
}

/** One approval as `trust.json` holds it, for `tyto trust list` (TYTO-349). */
export interface TrustedEntry {
  /** The source's real path, as it was granted. */
  readonly path: string;
  /** The day it was granted, `YYYY-MM-DD`; absent for an entry written by hand without one. */
  readonly since?: string;
}

/**
 * The port, plus the listing only a command line needs. Kept off `TrustStore` because the
 * resolver never lists: it asks about one source at a time (ADR 0111).
 */
export interface FsTrustStore extends TrustStore {
  /** Every approval in file order; `E_TRUST_FILE` when the file cannot be read. */
  list(): Promise<Result<readonly TrustedEntry[]>>;
}

interface TrustFile {
  readonly text: string;
  readonly entries: readonly TrustedEntry[];
  /** Non-empty means the file must not be written: an edit to a tree the parser guessed at. */
  readonly problems: readonly Diagnostic[];
}

const OPTIONS = { allowTrailingComma: true, disallowComments: false } as const;
const EMPTY = '{\n  "trusted": []\n}\n';

export function fsTrustStore(options: FsTrustStoreOptions): FsTrustStore {
  const file = join(options.home, TRUST_FILE);
  const ignoreCase = options.ignoreCase ?? process.platform === 'win32';
  const now = options.now ?? (() => new Date());
  const same = (a: string, b: string): boolean =>
    ignoreCase ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);

  async function read(): Promise<TrustFile> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (cause) {
      if (isMissing(cause)) return { text: '', entries: [], problems: [] };
      return { text: '', entries: [], problems: [trustProblem(describeError(cause))] };
    }
    return parseTrust(text);
  }

  async function write(text: string): Promise<Result<true>> {
    try {
      await mkdir(options.home, { recursive: true });
      await writeFile(file, text, 'utf8');
      return ok(true);
    } catch (cause) {
      return err([trustProblem(describeError(cause))]);
    }
  }

  return {
    async list(): Promise<Result<readonly TrustedEntry[]>> {
      const current = await read();
      return current.problems.length > 0 ? err(current.problems) : ok(current.entries);
    },

    async trustOf(source): Promise<TrustAnswer> {
      const current = await read();
      const real = await realOrResolved(source);
      const trusted = current.entries.some((entry) => same(entry.path, real));
      return { trust: trusted ? 'trusted' : 'restricted', diagnostics: current.problems };
    },

    async grant(source): Promise<Result<boolean>> {
      const current = await read();
      if (current.problems.length > 0) return err(current.problems);
      const real = await realOrResolved(source);
      if (current.entries.some((entry) => same(entry.path, real))) return ok(false);
      const base = current.text.trim() === '' ? EMPTY : current.text;
      const since = now().toISOString().slice(0, 10);
      const written = await write(edit(base, ['trusted', -1], { path: real, since }));
      return written.ok ? ok(true) : written;
    },

    async revoke(source): Promise<Result<boolean>> {
      const current = await read();
      if (current.problems.length > 0) return err(current.problems);
      // Compared as typed and as real, so a folder that is gone can still be taken back.
      const real = await realOrResolved(source);
      const index = current.entries.findIndex(
        (entry) => same(entry.path, real) || same(entry.path, source),
      );
      if (index === -1) return ok(false);
      const written = await write(edit(current.text, ['trusted', index], undefined));
      return written.ok ? ok(true) : written;
    },
  };
}

function parseTrust(text: string): TrustFile {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, OPTIONS);
  if (errors.length > 0) {
    const first = errors[0];
    const problem =
      first === undefined ? 'it is not valid JSON' : describe(printParseErrorCode(first.error));
    return { text, entries: [], problems: [trustProblem(problem)] };
  }
  if (text.trim() === '') return { text, entries: [], problems: [] };
  const trusted =
    typeof value === 'object' && value !== null
      ? (value as { trusted?: unknown }).trusted
      : undefined;
  if (trusted === undefined) return { text, entries: [], problems: [] };
  if (!Array.isArray(trusted)) {
    return { text, entries: [], problems: [trustProblem("'trusted' is not a list")] };
  }
  const entries: TrustedEntry[] = [];
  for (const item of trusted) {
    const fields =
      typeof item === 'object' && item !== null
        ? (item as { path?: unknown; since?: unknown })
        : {};
    const path = fields.path;
    if (typeof path !== 'string' || path === '') {
      return { text, entries: [], problems: [trustProblem("an entry of 'trusted' has no path")] };
    }
    // A `since` that is not a string is the person's own note, not a date to show.
    entries.push(typeof fields.since === 'string' ? { path, since: fields.since } : { path });
  }
  return { text, entries, problems: [] };
}

function edit(text: string, path: (string | number)[], value: unknown): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return applyEdits(
    text,
    modify(text, path, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol },
      ...(path.at(-1) === -1 ? { isArrayInsertion: true } : {}),
    }),
  );
}

function trustProblem(problem: string): Diagnostic {
  return diagnostic('E_TRUST_FILE', { problem });
}

async function realOrResolved(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function isMissing(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT';
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** `InvalidSymbol` → `invalid symbol`, for a sentence. */
function describe(code: string): string {
  return code.replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase();
}
