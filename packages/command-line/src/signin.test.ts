import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { type IncomingMessage, type Server, createServer, get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkedCapabilities, signinAccount, signinClientAccount } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment, CliSigninSecrets } from './environment.js';
import { pluginCapabilities } from './plugins/capabilities.js';
import { run } from './program.js';
import { cliSigninCapabilities } from './signin.js';

/**
 * `tyto signin` and `tyto signout` end to end (ADR 0194): the real command line parser, the
 * shared service, the real loopback listener, and a provider on 127.0.0.1 that checks the PKCE
 * verifier as a real one does. Only the keychain is a map, and the browser is two GETs.
 */

const PLUGIN = 'fake-drive';
const ID = 'drive';

interface Provider {
  readonly origin: string;
  /** Every grant the token endpoint received, by type. */
  readonly grants: string[];
  /** The `client_id` of the last authorize request. */
  authorizedClient: string | null;
  challenge: string | null;
  refreshCount: number;
}

let server: Server;
let provider: Provider;
let home: string;

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (text += chunk));
    request.on('end', () => resolve(text));
  });
}

function idToken(claims: object): string {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tyto-cli-signin-'));
  const state: Omit<Provider, 'origin'> = {
    grants: [],
    authorizedClient: null,
    challenge: null,
    refreshCount: 0,
  };
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/authorize') {
      state.authorizedClient = url.searchParams.get('client_id');
      state.challenge = url.searchParams.get('code_challenge');
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', 'code-1');
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      response.writeHead(302, { location: back.toString() });
      response.end();
      return;
    }
    void body(request).then((text) => {
      const grant = new URLSearchParams(text);
      const type = grant.get('grant_type') ?? '';
      state.grants.push(type);
      const answer = (status: number, json: object): void => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(json));
      };
      if (type === 'authorization_code') {
        const hashed = createHash('sha256')
          .update(grant.get('code_verifier') ?? '')
          .digest('base64url');
        if (grant.get('code') !== 'code-1' || hashed !== state.challenge) {
          answer(400, { error: 'invalid_grant' });
          return;
        }
        answer(200, {
          access_token: 'access-1',
          expires_in: 3600,
          refresh_token: 'refresh-1',
          id_token: idToken({ email: 'person@example.test' }),
        });
        return;
      }
      state.refreshCount += 1;
      answer(200, { access_token: `access-refreshed-${state.refreshCount}`, expires_in: 3600 });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  provider = Object.assign(state, { origin: `http://127.0.0.1:${port}` });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  await rm(home, { recursive: true, force: true });
});

async function install(signin: Record<string, object>): Promise<void> {
  const folder = join(home, 'plugins', PLUGIN);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '0.1.0',
      engine: '>=0.1',
      contributes: ['template-pack'],
      permissions: Object.keys(signin).map((id) => `signin:${id}`),
      signin,
    }),
  );
}

function entry(clientId?: string): object {
  return {
    authorize: `${provider.origin}/authorize`,
    token: `${provider.origin}/token`,
    ...(clientId === undefined ? {} : { clientId }),
    scopes: ['files'],
  };
}

/** A GET through `node:http`, answering the `location` of a redirect. */
function visit(url: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      response.resume();
      response.on('end', () => resolve(response.headers.location));
    }).on('error', reject);
  });
}

function mapSecrets(): CliSigninSecrets & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    get: (account) => Promise.resolve(entries.get(account) ?? null),
    has: (account) => Promise.resolve(entries.has(account)),
    set: (account, secret) => {
      entries.set(account, secret);
      return Promise.resolve();
    },
    delete: (account) => Promise.resolve(entries.delete(account)),
  };
}

interface Terminal {
  readonly environment: CliEnvironment;
  readonly out: () => string;
  readonly err: () => string;
  readonly opened: string[];
}

function terminal(
  secrets: CliSigninSecrets | undefined,
  answers: readonly string[] = [],
): Terminal {
  let out = '';
  let err = '';
  const opened: string[] = [];
  const typed = [...answers];
  const environment: CliEnvironment = {
    console: {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    },
    version: '0.0.0-test',
    cwd: home,
    home,
    rasterizer: () => {
      throw new Error('a sign-in starts no rasterizer');
    },
    ask: () => Promise.resolve(typed.shift() ?? ''),
    ...(secrets === undefined
      ? {}
      : {
          signin: {
            secrets,
            // The person's browser: the provider's page, then its redirect to the loopback port.
            openBrowser: async (url) => {
              opened.push(url);
              const back = await visit(url);
              if (back !== undefined) await visit(back);
            },
          },
        }),
  };
  return { environment, out: () => out, err: () => err, opened };
}

describe('tyto signin', () => {
  it('signs in through the browser and keeps only the refresh token in the keychain', async () => {
    await install({ [ID]: entry('manifest-client') });
    const secrets = mapSecrets();
    const { environment, out, err } = terminal(secrets);

    const code = await run(['signin', PLUGIN], environment);

    expect(code).toBe(0);
    expect(out()).toBe(`Signed in to '${ID}' of ${PLUGIN} as person@example.test.\n`);
    // The address is printed, for a person whose browser did not open.
    expect(err()).toContain(`${provider.origin}/authorize?`);
    expect(provider.authorizedClient).toBe('manifest-client');
    expect(provider.grants).toEqual(['authorization_code']);
    expect([...secrets.entries.keys()]).toEqual([signinAccount(PLUGIN, ID)]);
    expect(JSON.parse(secrets.entries.get(signinAccount(PLUGIN, ID)) ?? '')).toMatchObject({
      refresh: 'refresh-1',
      label: 'person@example.test',
    });
    expect(secrets.entries.get(signinAccount(PLUGIN, ID))).not.toContain('access-1');
  });

  it("gives a later run's plugins an access token through the stored refresh token", async () => {
    await install({ [ID]: entry('manifest-client') });
    const secrets = mapSecrets();
    await run(['signin', PLUGIN], terminal(secrets).environment);

    // A new process: nothing in memory, the keychain entry is all there is.
    const later = terminal(secrets).environment;
    const checked = checkedCapabilities(
      PLUGIN,
      [`signin:${ID}`],
      pluginCapabilities({}, { hostName: 'tyto recipe run', signin: cliSigninCapabilities(later) }),
    );

    expect(await checked.signinAccessToken(ID)).toBe('access-refreshed-1');
    expect(await checked.signinAccessToken(ID)).toBe('access-refreshed-1');
    expect(provider.grants).toEqual(['authorization_code', 'refresh_token']);
  });

  it('tells a plugin to run tyto signin when nobody signed in', async () => {
    await install({ [ID]: entry('manifest-client') });
    const { environment } = terminal(mapSecrets());
    const checked = checkedCapabilities(
      PLUGIN,
      [`signin:${ID}`],
      pluginCapabilities(
        {},
        { hostName: 'tyto recipe run', signin: cliSigninCapabilities(environment) },
      ),
    );

    await expect(checked.signinAccessToken(ID)).rejects.toMatchObject({
      code: 'E_SIGNIN_REQUIRED',
      message: `Plugin '${PLUGIN}' needs sign-in '${ID}', and nobody has signed in to it on tyto recipe run; run tyto signin ${PLUGIN} ${ID}.`,
    });
  });

  it('answers E_SIGNIN_UNAVAILABLE, and refuses the command, without a keychain', async () => {
    await install({ [ID]: entry('manifest-client') });
    const { environment, err } = terminal(undefined);
    const checked = checkedCapabilities(
      PLUGIN,
      [`signin:${ID}`],
      pluginCapabilities(
        {},
        { hostName: 'tyto recipe run', signin: cliSigninCapabilities(environment) },
      ),
    );

    await expect(checked.signinAccessToken(ID)).rejects.toMatchObject({
      code: 'E_SIGNIN_UNAVAILABLE',
    });
    expect(await run(['signin', PLUGIN], environment)).toBe(1);
    expect(err()).toContain('This terminal cannot sign in');
  });

  it('asks for the client a manifest leaves out, and signs in with it', async () => {
    await install({ [ID]: entry() });
    const secrets = mapSecrets();

    const without = terminal(secrets);
    expect(await run(['signin', PLUGIN], without.environment)).toBe(1);
    expect(without.err()).toContain(`run tyto signin ${PLUGIN} ${ID} --client`);
    expect(without.opened).toEqual([]);

    const typing = terminal(secrets, ['typed-client', 'typed-secret']);
    expect(await run(['signin', PLUGIN, ID, '--client'], typing.environment)).toBe(0);
    expect(provider.authorizedClient).toBe('typed-client');
    expect(JSON.parse(secrets.entries.get(signinClientAccount(PLUGIN, ID)) ?? '')).toEqual({
      clientId: 'typed-client',
      clientSecret: 'typed-secret',
    });
  });

  it('refuses --client for a manifest that names its own client', async () => {
    await install({ [ID]: entry('manifest-client') });
    const { environment, err } = terminal(mapSecrets(), ['typed-client', '']);

    expect(await run(['signin', PLUGIN, '--client'], environment)).toBe(1);
    expect(err()).toContain('names the client of its sign-in');
  });

  it('names the sign-ins to choose from when there is more than one, or the one typed is not', async () => {
    await install({ [ID]: entry('manifest-client'), photos: entry('manifest-client') });

    const none = terminal(mapSecrets());
    expect(await run(['signin', PLUGIN], none.environment)).toBe(1);
    expect(none.err()).toContain('declares more than one sign-in; name one: drive, photos.');

    const wrong = terminal(mapSecrets());
    expect(await run(['signin', PLUGIN, 'mail'], wrong.environment)).toBe(1);
    expect(wrong.err()).toContain("declares no sign-in 'mail'");

    const missing = terminal(mapSecrets());
    expect(await run(['signin', 'nobody'], missing.environment)).toBe(1);
    expect(missing.err()).toContain("No installed plugin is named 'nobody'.");
  });
});

describe('tyto signout', () => {
  it('deletes the entry, and with --client the client too', async () => {
    await install({ [ID]: entry() });
    const secrets = mapSecrets();
    await run(['signin', PLUGIN, '--client'], terminal(secrets, ['typed-client', '']).environment);
    expect(secrets.entries.size).toBe(2);

    const first = terminal(secrets);
    expect(await run(['signout', PLUGIN], first.environment)).toBe(0);
    expect(first.out()).toBe(`Signed out of '${ID}' of ${PLUGIN}.\n`);
    expect([...secrets.entries.keys()]).toEqual([signinClientAccount(PLUGIN, ID)]);

    const second = terminal(secrets);
    expect(await run(['signout', PLUGIN, ID, '--client'], second.environment)).toBe(0);
    expect(second.out()).toBe(
      `Nobody was signed in to '${ID}' of ${PLUGIN}.\nOAuth client forgotten.\n`,
    );
    expect(secrets.entries.size).toBe(0);
  });

  it('forgets a sign-in by its id after the plugin was removed', async () => {
    const secrets = mapSecrets();
    secrets.entries.set(
      signinAccount(PLUGIN, ID),
      JSON.stringify({ refresh: 'r', label: 'x', since: '2026-11-12T00:00:00.000Z' }),
    );
    const { environment, out } = terminal(secrets);

    expect(await run(['signout', PLUGIN, ID], environment)).toBe(0);
    expect(out()).toBe(`Signed out of '${ID}' of ${PLUGIN}.\n`);
    expect(secrets.entries.size).toBe(0);
  });
});
