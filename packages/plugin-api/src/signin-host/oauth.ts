import { z } from 'zod';

import type { ResolvedSigninDeclaration } from '../manifest.js';

/**
 * OAuth 2.0 with PKCE as a protocol, for a browser sign-in the host runs (ADR 0174).
 *
 * **No provider is named here** (ADR 0127): every endpoint, client id and scope comes from the
 * plugin's manifest. What this module knows is RFC 6749 and RFC 7636 — how to make a verifier
 * and its challenge, how to spell the authorize URL, how to trade a code and a refresh token at
 * a token endpoint — and nothing about who answers.
 *
 * The network is an argument, never imported: the desktop binds it to `net.fetch`, so the
 * system's proxy applies, and a test binds it to a function that answers what the test needs.
 *
 * It moved here from the desktop's main (TYTO-683) so a second host can run the same flow, and
 * this package compiles against no platform's types (ADR 0010): what it needs of the runtime is
 * read off `globalThis` below, and base64url is spelled out instead of borrowed from `Buffer`.
 */

const { URL, URLSearchParams, TextEncoder, TextDecoder, crypto } = globalThis as unknown as {
  URL: new (input: string) => {
    readonly searchParams: {
      set(name: string, value: string): void;
      delete(name: string): void;
    };
    toString(): string;
  };
  URLSearchParams: new (init: Record<string, string>) => {
    set(name: string, value: string): void;
    toString(): string;
  };
  TextEncoder: new () => { encode(text: string): Uint8Array };
  TextDecoder: new (
    label: string,
    options: { fatal: boolean },
  ) => {
    decode(bytes: Uint8Array): string;
  };
  crypto: {
    getRandomValues(bytes: Uint8Array): Uint8Array;
    readonly subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
  };
};

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Random bytes, from WebCrypto unless a test hands over its own. */
export type RandomBytes = (length: number) => Uint8Array;

const webCryptoRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/** Base64url without padding (RFC 7636 appendix A), what both the verifier and state use. */
export function base64Url(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const triple = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    text += BASE64URL_ALPHABET.charAt((triple >> 18) & 63);
    text += BASE64URL_ALPHABET.charAt((triple >> 12) & 63);
    if (second !== undefined) text += BASE64URL_ALPHABET.charAt((triple >> 6) & 63);
    if (third !== undefined) text += BASE64URL_ALPHABET.charAt(triple & 63);
  }
  return text;
}

/**
 * The text a base64url segment holds, as UTF-8, read the way `Buffer.from(…, 'base64url')`
 * read it before the move: padding tolerated, trailing bits that make no byte dropped, and a
 * sequence that is not UTF-8 decoded as U+FFFD. A character outside the alphabet is
 * `undefined`, which the one caller already answered for anything it could not parse.
 */
function fromBase64Url(segment: string): string | undefined {
  const unpadded = segment.replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of unpadded) {
    const value = BASE64URL_ALPHABET.indexOf(character);
    if (value === -1) return undefined;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
}

/** The challenge for a verifier, `S256`: base64url of its SHA-256 (RFC 7636 section 4.2). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

/**
 * A fresh verifier and its challenge. Thirty-two random bytes make a 43-character verifier,
 * the shortest RFC 7636 allows and the length its own example uses.
 */
export async function createPkce(random: RandomBytes = webCryptoRandom): Promise<PkcePair> {
  const verifier = base64Url(random(32));
  return { verifier, challenge: await pkceChallenge(verifier) };
}

/** The `state` that ties a callback to the attempt that opened the browser. */
export function createState(random: RandomBytes = webCryptoRandom): string {
  return base64Url(random(16));
}

export interface AuthorizeRequest {
  readonly declaration: ResolvedSigninDeclaration;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly state: string;
}

/**
 * The URL the system browser opens. The declared `authorize` is kept whole, with its own query
 * parameters, and the protocol's are set over it: a provider that needs `access_type=offline`
 * declares it in the URL (ADR 0174, Consequences), and a declared parameter of the same name
 * as one of ours loses, because ours are what the callback is checked against.
 */
export function authorizeUrl(request: AuthorizeRequest): string {
  const url = new URL(request.declaration.authorize);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', request.declaration.clientId);
  url.searchParams.set('redirect_uri', request.redirectUri);
  url.searchParams.set('code_challenge', request.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', request.state);
  if (request.declaration.scopes.length > 0) {
    url.searchParams.set('scope', request.declaration.scopes.join(' '));
  } else {
    url.searchParams.delete('scope');
  }
  return url.toString();
}

/** `net.fetch` or the global `fetch`, as far as a token request calls it. */
export type TokenFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly redirect: 'manual';
  },
) => Promise<{ readonly status: number; text(): Promise<string> }>;

/**
 * A token endpoint's success (RFC 6749 section 5.1). Unknown members are dropped: the host
 * keeps what it uses and nothing a provider adds.
 */
const tokenAnswerSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
});

/** A token endpoint's refusal (RFC 6749 section 5.2). */
const tokenErrorSchema = z.object({
  error: z.string().min(1),
  error_description: z.string().optional(),
});

export interface TokenSet {
  readonly accessToken: string;
  /** Seconds the access token lives, when the provider said. */
  readonly expiresIn: number | undefined;
  readonly refreshToken: string | undefined;
  readonly idToken: string | undefined;
}

export type TokenResult =
  | { readonly ok: true; readonly tokens: TokenSet }
  /**
   * `error` is the endpoint's own code when it sent one (`invalid_grant`), else `http` for an
   * answer that was not JSON the protocol describes. `message` is for a person.
   */
  | { readonly ok: false; readonly error: string; readonly message: string };

/** Reads a token endpoint's answer. Exported for its tests: the parse is the contract. */
export function parseTokenAnswer(status: number, text: string): TokenResult {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return { ok: false, error: 'http', message: `the token endpoint answered ${status}, not JSON` };
  }
  if (status >= 200 && status < 300) {
    const parsed = tokenAnswerSchema.safeParse(document);
    if (parsed.success) {
      return {
        ok: true,
        tokens: {
          accessToken: parsed.data.access_token,
          expiresIn: parsed.data.expires_in,
          refreshToken: parsed.data.refresh_token,
          idToken: parsed.data.id_token,
        },
      };
    }
    return {
      ok: false,
      error: 'http',
      message: 'the token endpoint answered without an access token',
    };
  }
  const refused = tokenErrorSchema.safeParse(document);
  if (refused.success) {
    const { error, error_description: description } = refused.data;
    return {
      ok: false,
      error,
      message: description === undefined ? error : `${error}: ${description}`,
    };
  }
  return { ok: false, error: 'http', message: `the token endpoint answered ${status}` };
}

async function requestToken(
  declaration: ResolvedSigninDeclaration,
  fields: Record<string, string>,
  fetch: TokenFetch,
): Promise<TokenResult> {
  const body = new URLSearchParams({ ...fields, client_id: declaration.clientId });
  // Sent only when declared, and never a secret (ADR 0174, decision 4).
  if (declaration.clientSecret !== undefined) body.set('client_secret', declaration.clientSecret);
  let response: Awaited<ReturnType<TokenFetch>>;
  try {
    response = await fetch(declaration.token, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
      // A token endpoint that redirects is not followed: the code and the verifier go to the
      // declared URL and nowhere else.
      redirect: 'manual',
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      error: 'network',
      message: `the token endpoint could not be reached: ${reason}`,
    };
  }
  return parseTokenAnswer(response.status, await response.text());
}

export interface CodeExchange {
  readonly declaration: ResolvedSigninDeclaration;
  readonly code: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly fetch: TokenFetch;
}

/** Trades the callback's code for tokens, proving the verifier (RFC 7636 section 4.5). */
export function exchangeCode(exchange: CodeExchange): Promise<TokenResult> {
  return requestToken(
    exchange.declaration,
    {
      grant_type: 'authorization_code',
      code: exchange.code,
      redirect_uri: exchange.redirectUri,
      code_verifier: exchange.verifier,
    },
    exchange.fetch,
  );
}

/** A new access token for a stored refresh token (RFC 6749 section 6). */
export function refreshTokens(
  declaration: ResolvedSigninDeclaration,
  refreshToken: string,
  fetch: TokenFetch,
): Promise<TokenResult> {
  return requestToken(
    declaration,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    fetch,
  );
}

const idTokenClaimsSchema = z.object({
  email: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});

/**
 * Who signed in, for the window to say: the `email` claim of the `id_token`, else `name`.
 *
 * **Read, never verified, and used for nothing but display** (ADR 0174): the token came over
 * TLS from the declared endpoint in answer to our own code, and a forged claim here could only
 * mislabel a sign-in the person started themselves. Anything unreadable is `undefined`.
 */
export function labelFromIdToken(idToken: string | undefined): string | undefined {
  if (idToken === undefined) return undefined;
  const payload = idToken.split('.')[1];
  if (payload === undefined) return undefined;
  const json = fromBase64Url(payload);
  if (json === undefined) return undefined;
  try {
    const claims = idTokenClaimsSchema.safeParse(JSON.parse(json));
    if (!claims.success) return undefined;
    return claims.data.email ?? claims.data.name;
  } catch {
    return undefined;
  }
}
