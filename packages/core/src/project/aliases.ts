import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import type { Trust } from '../ports/trust-store.js';
import type { SourceRange } from '../source/range.js';

/**
 * The project's `aliases` key (TYTO-536, ADR 0112 note of 2026-11-15): command panel aliases a
 * workspace shares, `{ "entrega": "render --delivery" }`.
 *
 * **Only a trusted sheet's aliases count**: a restricted sheet's are withheld, as a plugin's
 * section is (ADR 0111), since a shared folder must not be able to put words in a person's
 * command line. Withheld is said, never silent: the trust strip lists them.
 *
 * Merged one alias at a time, the later sheet winning (ADR 0114): a folder that writes one
 * alias keeps the profile's others. What an alias may be named beyond its shape (a built-in's
 * name is refused) is the panel's rule, since only the panel knows its built-ins.
 */
export const ALIASES_KEY = 'aliases';

/** What an alias may be called: a word a person types first, letters, digits, `_` and `-`. */
export const ALIAS_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/u;

/** The longest body an alias may hold: a line, not a script. */
export const ALIAS_BODY_MAX = 1000;

/** One sheet's alias, with where its name was written. */
export interface SheetAlias {
  readonly body: string;
}

interface AliasesEntry {
  readonly key: string;
  readonly value: unknown;
  readonly keyRange?: SourceRange;
  readonly valueRange?: SourceRange;
  readonly node?: AliasesNode;
}

interface AliasesNode {
  readonly range: SourceRange;
  readonly members?: readonly {
    readonly key: string;
    readonly keyRange: SourceRange;
    readonly value: AliasesNode | undefined;
  }[];
}

/** Why an alias body is refused, or `undefined` for one the panel may expand. */
export function aliasBodyProblem(body: unknown): string | undefined {
  if (typeof body !== 'string' || body.trim() === '') return 'is not a command line';
  if (/[\r\n]/u.test(body)) return 'holds more than one line';
  if (body.length > ALIAS_BODY_MAX) return `is longer than ${String(ALIAS_BODY_MAX)} characters`;
  return undefined;
}

/** One sheet's `aliases`, by name, or nothing with the reason in `found`. Never fails. */
export function readAliases(
  entry: AliasesEntry,
  trust: Trust,
  found: Diagnostic[],
): ReadonlyMap<string, SheetAlias> | undefined {
  const value = entry.value;
  const fallback = entry.valueRange ?? entry.keyRange;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    found.push(invalid(ALIASES_KEY, 'is not an object of command lines by name', fallback));
    return undefined;
  }
  const names = Object.keys(value);
  if (names.length === 0) return undefined;
  if (trust !== 'trusted') {
    found.push(
      diagnostic(
        'W_PROJECT_ALIASES_WITHHELD',
        { aliases: names.join(', ') },
        entry.keyRange === undefined ? {} : { range: entry.keyRange },
      ),
    );
    return undefined;
  }
  const kept = new Map<string, SheetAlias>();
  for (const [name, body] of Object.entries(value as Record<string, unknown>)) {
    const member = entry.node?.members?.find((candidate) => candidate.key === name);
    if (!ALIAS_NAME.test(name)) {
      found.push(
        invalid(
          `${ALIASES_KEY}.${name}`,
          'is not an alias name (letters, digits, _ and -, not starting with a digit or -)',
          member?.keyRange ?? fallback,
        ),
      );
      continue;
    }
    const problem = aliasBodyProblem(body);
    if (problem !== undefined) {
      found.push(
        invalid(
          `${ALIASES_KEY}.${name}`,
          problem,
          member?.value?.range ?? member?.keyRange ?? fallback,
        ),
      );
      continue;
    }
    kept.set(name, { body: body as string });
  }
  return kept;
}

function invalid(key: string, problem: string, range: SourceRange | undefined): Diagnostic {
  return diagnostic(
    'W_PROJECT_KEY_INVALID',
    { key, problem },
    range === undefined ? {} : { range },
  );
}
