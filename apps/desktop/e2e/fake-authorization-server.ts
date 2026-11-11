import { createHash } from 'node:crypto';
import { type IncomingMessage, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A fake OAuth 2.0 authorization server for the sign-in e2e (TYTO-374, ADR 0174), on this
 * machine's loopback, which a manifest may name over plain `http`.
 *
 * **It enforces what a provider enforces**, so a host that stopped doing PKCE or sent the wrong
 * redirect fails here rather than at the first real provider: `/authorize` remembers the
 * challenge and the redirect for the code it issues, and `/token` refuses a code whose
 * verifier does not hash to that challenge (RFC 7636 section 4.6), a redirect that differs, or
 * a code already spent. There is no consent screen: `/authorize` redirects straight back.
 *
 * **It knows its clients** (ADR 0192): `/authorize` refuses a `client_id` it was not started
 * with, and `/token` refuses a grant whose client is unknown or whose `client_secret` is not the
 * one registered for it, so a client the app did not take from where it should fails here.
 */

export const FAKE_ACCESS_TOKEN = 'fake-access-374';
export const FAKE_REFRESH_TOKEN = 'fake-refresh-374';
export const FAKE_EMAIL = 'pessoa@example.test';

interface Issued {
  readonly challenge: string;
  readonly redirectUri: string;
  readonly clientId: string;
}

export interface FakeAuthorizationServer {
  readonly origin: string;
  /** Every grant `/token` was sent, as the host sent it. */
  readonly grants: URLSearchParams[];
  /** Every `/authorize` query, as the browser followed it. */
  readonly authorizations: URLSearchParams[];
  close(): Promise<void>;
}

/** An unsigned `id_token`: the host reads its claims for the label and never trusts it. */
const idToken = (claims: object): string =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;

const body = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (text += chunk));
    request.on('end', () => resolve(text));
    request.on('error', reject);
  });

/** The clients the server issued: each id with its secret, or `undefined` for none. */
export type FakeClients = Readonly<Record<string, string | undefined>>;

export function startFakeAuthorizationServer(
  clients: FakeClients,
): Promise<FakeAuthorizationServer> {
  const known = (id: string | null): id is string =>
    id !== null && Object.prototype.hasOwnProperty.call(clients, id);
  /** The grant names a known client and carries exactly its secret, or none when it has none. */
  const authenticated = (grant: URLSearchParams): boolean => {
    const id = grant.get('client_id');
    if (!known(id)) return false;
    return (grant.get('client_secret') ?? undefined) === clients[id];
  };
  const issued = new Map<string, Issued>();
  const grants: URLSearchParams[] = [];
  const authorizations: URLSearchParams[] = [];
  let next = 0;

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const json = (status: number, value: object): void => {
      response.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
      response.end(JSON.stringify(value));
    };

    if (request.method === 'GET' && url.pathname === '/authorize') {
      const query = url.searchParams;
      authorizations.push(query);
      const redirectUri = query.get('redirect_uri') ?? '';
      const challenge = query.get('code_challenge');
      if (!known(query.get('client_id'))) {
        json(400, { error: 'unauthorized_client', error_description: 'unknown client_id' });
        return;
      }
      if (query.get('code_challenge_method') !== 'S256' || challenge === null) {
        json(400, { error: 'invalid_request', error_description: 'PKCE S256 is required' });
        return;
      }
      next += 1;
      const code = `code-${next}`;
      issued.set(code, { challenge, redirectUri, clientId: query.get('client_id') ?? '' });
      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', query.get('state') ?? '');
      response.writeHead(302, { location: back.toString(), connection: 'close' });
      response.end();
      return;
    }

    if (request.method === 'POST' && url.pathname === '/token') {
      void body(request).then((text) => {
        const grant = new URLSearchParams(text);
        grants.push(grant);
        if (!authenticated(grant)) {
          json(401, { error: 'invalid_client', error_description: 'client id or secret' });
          return;
        }
        if (grant.get('grant_type') === 'refresh_token') {
          if (grant.get('refresh_token') !== FAKE_REFRESH_TOKEN) {
            json(400, { error: 'invalid_grant' });
            return;
          }
          json(200, { access_token: FAKE_ACCESS_TOKEN, token_type: 'Bearer', expires_in: 3600 });
          return;
        }
        const code = grant.get('code') ?? '';
        const record = issued.get(code);
        issued.delete(code);
        const verifier = grant.get('code_verifier') ?? '';
        const hashed = createHash('sha256').update(verifier).digest('base64url');
        if (
          grant.get('grant_type') !== 'authorization_code' ||
          record === undefined ||
          hashed !== record.challenge ||
          grant.get('redirect_uri') !== record.redirectUri ||
          grant.get('client_id') !== record.clientId
        ) {
          json(400, { error: 'invalid_grant', error_description: 'code, verifier or redirect' });
          return;
        }
        json(200, {
          access_token: FAKE_ACCESS_TOKEN,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: FAKE_REFRESH_TOKEN,
          id_token: idToken({ email: FAKE_EMAIL }),
        });
      });
      return;
    }

    json(404, { error: 'not_found' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        grants,
        authorizations,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
