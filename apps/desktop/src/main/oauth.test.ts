import type { ResolvedSigninDeclaration } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import {
  type TokenFetch,
  authorizeUrl,
  createPkce,
  exchangeCode,
  labelFromIdToken,
  parseTokenAnswer,
  pkceChallenge,
  refreshTokens,
} from '@tyto/plugin-api';

/** RFC 7636 appendix B: the 32 octets, the verifier they make, and its S256 challenge. */
const RFC_OCTETS = [
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105,
  214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
];
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const declaration: ResolvedSigninDeclaration = {
  authorize: 'https://auth.example.test/authorize?access_type=offline',
  token: 'https://auth.example.test/token',
  clientId: 'client-1',
  scopes: ['files', 'profile'],
};

/** A token endpoint that records what it was sent and answers what the test says. */
function endpoint(
  status: number,
  answer: unknown,
): TokenFetch & { readonly sent: URLSearchParams[] } {
  const sent: URLSearchParams[] = [];
  const fetch: TokenFetch = (_url, init) => {
    sent.push(new URLSearchParams(init.body));
    return Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(answer)) });
  };
  return Object.assign(fetch, { sent });
}

const unsignedJwt = (claims: object): string =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

describe('PKCE', () => {
  it('makes the verifier and challenge of RFC 7636 appendix B from its octets', async () => {
    const pair = await createPkce(() => Uint8Array.from(RFC_OCTETS));

    expect(pair.verifier).toBe(RFC_VERIFIER);
    expect(pair.challenge).toBe(RFC_CHALLENGE);
    expect(await pkceChallenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it('draws a fresh 43-character verifier from WebCrypto by default', async () => {
    const first = await createPkce();
    const second = await createPkce();

    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first.verifier).not.toBe(second.verifier);
  });
});

describe('authorizeUrl', () => {
  it('keeps the declared query and sets the protocol parameters over it', () => {
    const url = new URL(
      authorizeUrl({
        declaration: { ...declaration, authorize: `${declaration.authorize}&state=forged` },
        redirectUri: 'http://127.0.0.1:5123/callback',
        challenge: RFC_CHALLENGE,
        state: 'state-1',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://auth.example.test/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      access_type: 'offline',
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'http://127.0.0.1:5123/callback',
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
      state: 'state-1',
      scope: 'files profile',
    });
  });

  it('sends no scope when the declaration lists none', () => {
    const url = new URL(
      authorizeUrl({
        declaration: { ...declaration, scopes: [] },
        redirectUri: 'http://127.0.0.1:1/callback',
        challenge: 'c',
        state: 's',
      }),
    );

    expect(url.searchParams.has('scope')).toBe(false);
  });
});

describe('token requests', () => {
  it('proves the verifier when it trades the code', async () => {
    const fetch = endpoint(200, { access_token: 'access-1', refresh_token: 'refresh-1' });

    const answered = await exchangeCode({
      declaration,
      code: 'code-1',
      verifier: RFC_VERIFIER,
      redirectUri: 'http://127.0.0.1:5123/callback',
      fetch,
    });

    expect(answered.ok).toBe(true);
    expect(Object.fromEntries(fetch.sent[0] ?? [])).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: 'http://127.0.0.1:5123/callback',
      code_verifier: RFC_VERIFIER,
      client_id: 'client-1',
    });
  });

  it('sends the declared client secret, and none when none is declared', async () => {
    const withSecret = endpoint(200, { access_token: 'a' });
    const without = endpoint(200, { access_token: 'a' });

    await refreshTokens({ ...declaration, clientSecret: 'not-secret' }, 'r', withSecret);
    await refreshTokens(declaration, 'r', without);

    expect(withSecret.sent[0]?.get('client_secret')).toBe('not-secret');
    expect(without.sent[0]?.has('client_secret')).toBe(false);
    expect(without.sent[0]?.get('grant_type')).toBe('refresh_token');
  });

  it('reports an endpoint that could not be reached rather than throwing', async () => {
    const answered = await refreshTokens(declaration, 'r', () =>
      Promise.reject(new Error('offline')),
    );

    expect(answered).toEqual({
      ok: false,
      error: 'network',
      message: 'the token endpoint could not be reached: offline',
    });
  });
});

describe('parseTokenAnswer', () => {
  it('keeps what the host uses and drops what the provider adds', () => {
    expect(
      parseTokenAnswer(
        200,
        JSON.stringify({
          access_token: 'a',
          expires_in: 3599,
          refresh_token: 'r',
          id_token: 'i',
          token_type: 'Bearer',
          extra: true,
        }),
      ),
    ).toEqual({
      ok: true,
      tokens: { accessToken: 'a', expiresIn: 3599, refreshToken: 'r', idToken: 'i' },
    });
  });

  it('refuses a success without an access token', () => {
    expect(parseTokenAnswer(200, JSON.stringify({ refresh_token: 'r' }))).toMatchObject({
      ok: false,
      error: 'http',
    });
  });

  it("names the endpoint's own error code", () => {
    expect(
      parseTokenAnswer(
        400,
        JSON.stringify({ error: 'invalid_grant', error_description: 'revoked' }),
      ),
    ).toEqual({ ok: false, error: 'invalid_grant', message: 'invalid_grant: revoked' });
  });

  it('refuses an answer that is not JSON', () => {
    expect(parseTokenAnswer(502, '<html>bad gateway</html>')).toEqual({
      ok: false,
      error: 'http',
      message: 'the token endpoint answered 502, not JSON',
    });
  });
});

describe('labelFromIdToken', () => {
  it('reads the email claim, else the name claim', () => {
    expect(labelFromIdToken(unsignedJwt({ email: 'person@example.test', name: 'P' }))).toBe(
      'person@example.test',
    );
    expect(labelFromIdToken(unsignedJwt({ name: 'Person' }))).toBe('Person');
  });

  it('answers nothing for a missing or unreadable token', () => {
    expect(labelFromIdToken(undefined)).toBeUndefined();
    expect(labelFromIdToken('not-a-jwt')).toBeUndefined();
    expect(labelFromIdToken('a.%%%.c')).toBeUndefined();
    expect(labelFromIdToken(unsignedJwt({ sub: '1' }))).toBeUndefined();
  });
});
