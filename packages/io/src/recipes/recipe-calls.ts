import { type Diagnostic, type Result, diagnostic, err, ok } from '@tyto/core';
import type { CallPorts, CallRequest, CallResponse } from '@tyto/plugin-api';

/**
 * `call`'s host side (TYTO-671, ADR 0193 decisions 4 to 6): the {@link CallPorts} the desktop
 * and the CLI lend the pure verb, one adapter for both (ADR 0188).
 *
 * The verb names a credential and an address it read by hand; this is where the request leaves
 * the machine, so it checks again what the verb cannot: the address parsed by the platform's
 * `URL`, its host against the workspace's list once more, `https:` only. It reads the
 * credential and sets `Authorization` itself (ADR 0191 decision 1), so the value never enters
 * `@tyto/recipe`. It follows no redirect, gives up at the request's deadline, answers the status
 * alone without reading the response's body, and says every failure with the credential's value
 * replaced by `[credential]`.
 */

/** Where the host keeps recipe credentials: the keychain on the desktop, the environment in the CLI. */
export interface RecipeCredentials {
  /** The value stored under that name, or `undefined` when none is. */
  read(name: string): Promise<string | undefined>;
}

/** What the adapter hands `fetch`: a POST with the header set and no redirect followed. */
export interface RecipeFetchInit {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly redirect: 'manual';
  readonly signal: AbortSignal;
}

/**
 * The part of an answer the adapter looks at: its status, and its body only to let it go
 * unread. No `text()` or `json()` is asked for, so none can reach an outcome.
 */
export interface RecipeFetchAnswer {
  readonly status: number;
  readonly body?: { cancel(): Promise<void> } | null;
}

/** The platform's `fetch`, narrowed to what the adapter uses; a test injects its own. */
export type RecipeFetch = (url: string, init: RecipeFetchInit) => Promise<RecipeFetchAnswer>;

export interface RecipeCallOptions {
  /**
   * The hosts the recipe's workspace allows, lower case; `undefined` in no workspace or a
   * restricted one. Asked on every check, so a list edited since is the list that counts.
   */
  readonly hosts: () => readonly string[] | undefined;
  readonly credentials: RecipeCredentials;
  /** Whether this host sends at all. `tyto mcp` does not (ADR 0185, ADR 0193 decision 8). */
  readonly sends: boolean;
  /** The platform's by default. */
  readonly fetch?: RecipeFetch;
  readonly now?: () => string;
}

export function recipeCallPorts(options: RecipeCallOptions): CallPorts {
  const fetchOf: RecipeFetch =
    options.fetch ?? ((url, init) => globalThis.fetch(url, init) as Promise<RecipeFetchAnswer>);
  const ports: CallPorts = {
    hosts: () => options.hosts(),
    async hasCredential(name) {
      const value = await options.credentials.read(name);
      return value !== undefined && value !== '';
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  };
  if (!options.sends) return ports;
  return {
    ...ports,
    send: (request) => sendCall(request, options, fetchOf),
  };
}

async function sendCall(
  request: CallRequest,
  options: RecipeCallOptions,
  fetchOf: RecipeFetch,
): Promise<Result<CallResponse, readonly Diagnostic[]>> {
  const refuse = (problem: string): Result<CallResponse, readonly Diagnostic[]> =>
    err([diagnostic('E_RECIPE_CALL', { problem: `sent nothing: ${problem}` })]);

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return refuse('the address does not parse');
  }
  if (url.protocol !== 'https:') return refuse('the address is not https');
  if (url.username !== '' || url.password !== '' || url.hash !== '') {
    return refuse('the address carries a user, a password or a fragment');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  // The verb read the address with a pattern; the platform's parser is the one that decides
  // where the request goes, so the list is checked against what it found.
  const allowed = options.hosts();
  if (allowed === undefined) return refuse('the recipe is not in a trusted workspace');
  if (!allowed.includes(host)) {
    return refuse(`${host} is not in the workspace's recipes.call.hosts`);
  }

  const secret = await options.credentials.read(request.credential);
  if (secret === undefined || secret === '') {
    return refuse(`no credential named '${request.credential}' is stored on this machine`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, request.deadlineMs);
  try {
    const answer = await fetchOf(url.href, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: request.body,
      // A 3xx is answered as its status: the header never reaches a host the list did not name.
      redirect: 'manual',
      signal: controller.signal,
    });
    // Let the body go unread, so the connection is released and nothing of it is kept.
    await answer.body?.cancel().catch(() => undefined);
    return ok({ status: answer.status });
  } catch (cause) {
    if (controller.signal.aborted) {
      return refuse(`${host} did not answer within ${String(request.deadlineMs)} ms`);
    }
    return refuse(scrubbed(reasonOf(cause), secret));
  } finally {
    clearTimeout(timer);
  }
}

/** The error's message and its causes', which is where Node says what failed (`ENOTFOUND`). */
function reasonOf(cause: unknown): string {
  const parts: string[] = [];
  let current: unknown = cause;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth += 1) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.filter((part) => part !== '').join(': ') || 'no reason given';
}

/** Every occurrence of the secret replaced, as ADR 0191 does for a plugin's error. */
function scrubbed(text: string, secret: string): string {
  return text.split(secret).join('[credential]');
}
