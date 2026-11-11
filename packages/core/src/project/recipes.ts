import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import type { Trust } from '../ports/trust-store.js';
import type { SourceRange } from '../source/range.js';

/**
 * The project's `recipes` key (TYTO-671, ADR 0193): `{ "call": { "hosts": [...] } }`, the hosts a
 * recipe's `call` may send to from this workspace.
 *
 * **Only a trusted sheet's list counts**: a restricted sheet's is withheld, as a plugin's section
 * is (ADR 0111), since a shared folder must not be able to name where a person's rows go. A host
 * is compared in lower case, without a port, and named whole: no scheme, path or wildcard.
 */
export const RECIPES_KEY = 'recipes';

/** What one sheet's `recipes` key sets: the list, when it managed to set one. */
export interface SheetRecipes {
  readonly callHosts?: readonly string[];
}

/** The written value with where it was written, as `ProjectEntry` carries it. */
interface RecipesEntry {
  readonly key: string;
  readonly value: unknown;
  readonly keyRange?: SourceRange;
  readonly valueRange?: SourceRange;
  readonly node?: RecipesNode;
}

interface RecipesNode {
  readonly range: SourceRange;
  readonly members?: readonly {
    readonly key: string;
    readonly keyRange: SourceRange;
    readonly value: RecipesNode | undefined;
  }[];
  readonly items?: readonly RecipesNode[];
}

/** A host name as `call` compares it: letters, digits, dots and hyphens, no port. */
const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/u;

const HOSTS_KEY = 'recipes.call.hosts';

/** One sheet's `recipes`, or nothing with the reason in `found`. Never fails. */
export function readRecipes(
  entry: RecipesEntry,
  trust: Trust,
  found: Diagnostic[],
): SheetRecipes | undefined {
  const value = entry.value;
  const fallback = entry.valueRange ?? entry.keyRange;
  if (!isObject(value)) {
    found.push(invalid(RECIPES_KEY, 'is not an object', fallback));
    return undefined;
  }
  let callHosts: readonly string[] | undefined;
  for (const [key, member] of Object.entries(value)) {
    const memberNode = memberOf(entry.node, key);
    if (key !== 'call') {
      found.push(unknown(`${RECIPES_KEY}.${key}`, memberNode?.keyRange ?? fallback));
      continue;
    }
    if (!isObject(member)) {
      found.push(
        invalid(`${RECIPES_KEY}.call`, 'is not an object', memberNode?.value?.range ?? fallback),
      );
      continue;
    }
    for (const [subkey, hosts] of Object.entries(member)) {
      const hostsNode = memberOf(memberNode?.value, subkey);
      if (subkey !== 'hosts') {
        found.push(unknown(`${RECIPES_KEY}.call.${subkey}`, hostsNode?.keyRange ?? fallback));
        continue;
      }
      if (trust !== 'trusted') {
        // Withheld, and said: the person learns why `call` refuses a host they see written.
        found.push(
          invalid(HOSTS_KEY, 'is read only from a trusted folder', hostsNode?.keyRange ?? fallback),
        );
        continue;
      }
      callHosts = hostsOf(hosts, hostsNode?.value, fallback, found);
    }
  }
  return callHosts === undefined ? undefined : { callHosts };
}

function hostsOf(
  value: unknown,
  node: RecipesNode | undefined,
  fallback: SourceRange | undefined,
  found: Diagnostic[],
): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    found.push(invalid(HOSTS_KEY, 'is not a list of host names', node?.range ?? fallback));
    return undefined;
  }
  const kept: string[] = [];
  value.forEach((item: unknown, position) => {
    const range = node?.items?.[position]?.range ?? node?.range ?? fallback;
    const host = typeof item === 'string' ? item.toLowerCase().replace(/\.$/u, '') : undefined;
    if (host === undefined || !HOST_NAME.test(host)) {
      const written = typeof item === 'string' ? item : JSON.stringify(item);
      found.push(
        invalid(
          HOSTS_KEY,
          `names '${written}', which is not a host name (no scheme, port, path or wildcard)`,
          range,
        ),
      );
      return;
    }
    if (!kept.includes(host)) kept.push(host);
  });
  // A list whose every entry was refused is a key this sheet did not manage to set, as a list
  // of folders is (ADR 0112): the sheet before keeps its say.
  return kept.length === 0 && value.length > 0 ? undefined : kept;
}

function memberOf(
  node: RecipesNode | undefined,
  key: string,
): { readonly keyRange: SourceRange; readonly value: RecipesNode | undefined } | undefined {
  return node?.members?.find((member) => member.key === key);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(key: string, problem: string, range: SourceRange | undefined): Diagnostic {
  return diagnostic(
    'W_PROJECT_KEY_INVALID',
    { key, problem },
    range === undefined ? {} : { range },
  );
}

function unknown(key: string, range: SourceRange | undefined): Diagnostic {
  return diagnostic('W_PROJECT_KEY_UNKNOWN', { key }, range === undefined ? {} : { range });
}
