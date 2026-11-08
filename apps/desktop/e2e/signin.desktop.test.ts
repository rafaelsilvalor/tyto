import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import {
  FAKE_ACCESS_TOKEN,
  FAKE_EMAIL,
  FAKE_REFRESH_TOKEN,
  type FakeAuthorizationServer,
  startFakeAuthorizationServer,
} from './fake-authorization-server.js';
import { firstWindow } from './first-window.js';

import { type Locale, isLocale, translate } from '../shared/i18n/index.js';

/**
 * Browser sign-in from the plugins screen, against a fake provider (TYTO-374, ADR 0174).
 *
 * **What only a running app can say.** `signin.test.ts` runs the service with a map for a
 * keychain and `plugins-dialog.test.ts` renders the lines in jsdom; neither crosses the
 * preload, the plugin's own process or the real `safeStorage` store. Here a person's click
 * opens the "browser" — `shell.openExternal`, stubbed in main to hand the URL to this suite —
 * which follows the fake provider's redirect to the app's loopback listener; the provider
 * refuses a verifier that does not hash to the challenge, so PKCE is checked by the far end.
 *
 * `TYTO_HOME` and `--user-data-dir` are this suite's own folder, so the keychain entry is a
 * file under it and the machine's real store is never written.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const BRIEF = ['---', 'template: promo-curso', '---', '::titulo Do plugin'].join('\n');
const PLUGIN = 'provedor';
const SIGNIN = 'conta';
const LINE = `.plugins__row[data-plugin="${PLUGIN}"] [data-signin="${SIGNIN}"]`;

let scratch: string;
let home: string;
let provider: FakeAuthorizationServer;
let app: ElectronApplication;
let page: Page;
let locale: Locale;
/** The keychain entry's file, under this suite's user-data folder (`credential-store.ts`). */
let entry: string;

/**
 * One installed plugin that declares a sign-in against the fake provider, and an exporter that
 * writes what `host.signin.accessToken` and `host.credentials('signin:…')` answered.
 */
function writeHome(): void {
  const folder = join(home, 'plugins', PLUGIN);
  mkdirSync(join(folder, 'dist'), { recursive: true });
  const permissions = [`signin:${SIGNIN}`];
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions,
      signin: {
        [SIGNIN]: {
          authorize: `${provider.origin}/authorize`,
          token: `${provider.origin}/token`,
          clientId: 'tyto-e2e',
          scopes: ['files'],
        },
      },
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: PLUGIN, type: 'module' }));
  const said = (call: string): string =>
    `${call}.then((value) => String(value), (cause) => 'refused:' + (cause.code ?? cause.message))`;
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `export function activate(host) {
  host.registerExporter({
    id: 'token', mime: 'text/plain', extension: 'tok', kinds: ['tok'], rasterized: false,
    exportFrame: () => Promise.all([
      ${said(`host.signin.accessToken(${JSON.stringify(SIGNIN)})`)},
      ${said(`host.credentials(${JSON.stringify(`signin:${SIGNIN}`)})`)},
    ]).then((seen) => ({ ok: true, value: seen.join(' '), diagnostics: [] })),
  });
}
`,
  );
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({ plugins: { [PLUGIN]: { enabled: true, permissions, source: '.' } } }),
  );
}

type Bridge = Record<string, (request: unknown) => Promise<unknown>>;

function call<T>(channel: string, request: unknown): Promise<T> {
  return page.evaluate(
    ([name, body]) => (window as unknown as { tyto: Bridge }).tyto[name as string]!(body),
    [channel, request] as const,
  ) as Promise<T>;
}

interface Progress {
  readonly progress?: { readonly status: string; readonly failure?: string };
}

/** Exports the plugin's `tok` and answers what its two calls said, space-separated. */
async function pluginSees(label: string): Promise<string> {
  const directory = join(scratch, 'out', label);
  const { exportId } = await call<{ exportId: string }>('export:start', {
    documentId: 'e2e',
    brief: BRIEF,
    directory,
    outputs: [{ kind: 'tok' }],
  });
  const started = Date.now();
  for (;;) {
    const { progress } = await call<Progress>('export:progress', { exportId });
    if (progress !== undefined && progress.status !== 'running') {
      expect(progress.failure).toBeUndefined();
      break;
    }
    if (Date.now() - started > 20_000) throw new Error('the export never finished');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const [file] = readdirSync(directory).filter((name) => name.endsWith('.tok'));
  return readFileSync(join(directory, file!), 'utf8');
}

/** The URLs main handed the stubbed system browser. */
const opened = (): Promise<string[]> =>
  app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-signin-'));
  home = join(scratch, 'tyto-home');
  entry = join(
    scratch,
    'user-data',
    'credentials',
    `${encodeURIComponent(`signin:${PLUGIN}:${SIGNIN}`)}.bin`,
  );
  // Before the manifest: it names the provider's port, which the system picks.
  provider = await startFakeAuthorizationServer();
  writeHome();

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  const lang = await page.evaluate(() => document.documentElement.lang);
  locale = isLocale(lang) ? lang : 'pt-BR';

  // The system browser, replaced in main: the URL is kept for this suite to follow.
  await app.evaluate(({ shell }) => {
    const state = globalThis as unknown as { opened: string[] };
    state.opened = [];
    shell.openExternal = (url: string) => {
      state.opened.push(url);
      return Promise.resolve();
    };
  });
});

afterAll(async () => {
  await closeApp(app);
  await provider.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe('browser sign-in from the plugins screen', () => {
  it('refuses the plugin before anyone signed in, and its call opens no browser', async () => {
    expect(await pluginSees('before')).toBe('refused:E_SIGNIN_REQUIRED refused:E_PERMISSION');
    expect(await opened()).toEqual([]);
  });

  it('signs in on a click, shows who, and the plugin gets the access token and nothing else', async () => {
    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('plugins.show')?.click();
    });
    await page.waitForSelector(`${LINE}[data-signed-in="false"]`);
    expect(await page.textContent(`${LINE} .plugins__signin-state`)).toBe(
      translate(locale, 'plugins.signin.notSignedIn'),
    );

    await page.click(`${LINE} .plugins__signin-start`);
    await expect.poll(async () => (await opened()).length, { timeout: 10_000 }).toBe(1);
    const [authorize] = await opened();
    expect(authorize!.startsWith(`${provider.origin}/authorize?`)).toBe(true);

    // The browser: the provider redirects to the app's loopback, which answers its page in
    // the window's language and never echoes the code.
    const landed = await fetch(authorize!);
    const landing = await landed.text();
    expect(landed.status).toBe(200);
    expect(new URL(landed.url).hostname).toBe('127.0.0.1');
    expect(landing).toContain(translate(locale, 'plugins.signin.page.signedIn'));
    expect(landing).not.toContain('code-1');

    const keychain = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable());
    process.stdout.write(`[TYTO-374] safeStorage available=${String(keychain)}\n`);
    if (!keychain) {
      // A machine with nothing to encrypt with refuses to store the refresh token in plaintext,
      // and the screen says the sign-in did not finish (`credentials.ts`).
      await page.waitForSelector(`${LINE} .plugins__signin-failed`);
      expect(existsSync(entry)).toBe(false);
      expect(await pluginSees('no-keychain')).toBe(
        'refused:E_SIGNIN_REQUIRED refused:E_PERMISSION',
      );
      return;
    }

    await page.waitForSelector(`${LINE}[data-signed-in="true"]`);
    expect(await page.textContent(`${LINE} .plugins__signin-state`)).toBe(
      translate(locale, 'plugins.signin.as').replace('{label}', FAKE_EMAIL),
    );

    // PKCE, checked by the provider: one code grant, carrying a verifier.
    const codeGrants = provider.grants.filter(
      (grant) => grant.get('grant_type') === 'authorization_code',
    );
    expect(codeGrants).toHaveLength(1);
    expect(codeGrants[0]!.get('code_verifier')?.length).toBeGreaterThanOrEqual(43);

    // The entry is in this suite's store, as ciphertext; the window holds neither token.
    expect(existsSync(entry)).toBe(true);
    expect(readFileSync(entry).toString('utf8')).not.toContain(FAKE_REFRESH_TOKEN);
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    expect(html).not.toContain(FAKE_REFRESH_TOKEN);
    expect(html).not.toContain(FAKE_ACCESS_TOKEN);
    const listed = JSON.stringify(await call<unknown>('signin:list', {}));
    expect(listed).not.toContain(FAKE_REFRESH_TOKEN);
    expect(listed).not.toContain(FAKE_ACCESS_TOKEN);

    // The plugin gets the access token; its own `credentials` on `signin:` stays refused.
    expect(await pluginSees('signed-in')).toBe(`${FAKE_ACCESS_TOKEN} refused:E_PERMISSION`);
  });

  it('signs out: the keychain entry is gone and the plugin is refused again', async () => {
    if (!existsSync(entry)) return;
    await page.click(`${LINE} .plugins__signin-out`);
    await page.waitForSelector(`${LINE}[data-signed-in="false"]`);

    expect(existsSync(entry)).toBe(false);
    expect(await pluginSees('signed-out')).toBe('refused:E_SIGNIN_REQUIRED refused:E_PERMISSION');
    // Signing out opened no browser either: one URL, the sign-in's.
    expect(await opened()).toHaveLength(1);
  });
});
