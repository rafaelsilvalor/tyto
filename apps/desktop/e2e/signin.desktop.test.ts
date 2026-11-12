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
 *
 * A second plugin declares its sign-in without a client (ADR 0192): the person types one on
 * the screen, and the fake provider knows only that client and its secret, so a sign-in that
 * did not use what was typed is refused at the far end.
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
/** The plugin whose manifest leaves the client to the person (ADR 0192). */
const OWN_CLIENT = 'provedor-cliente';
const OWN_LINE = `.plugins__row[data-plugin="${OWN_CLIENT}"] [data-signin="${SIGNIN}"]`;
const PERSON_CLIENT_ID = 'person-client-0192';
const PERSON_CLIENT_SECRET = 'person-secret-0192';

let scratch: string;
let home: string;
let provider: FakeAuthorizationServer;
let app: ElectronApplication;
let page: Page;
let locale: Locale;
/** The keychain entry's file, under this suite's user-data folder (`credential-store.ts`). */
let entry: string;
/** Whether this machine's `safeStorage` can encrypt, read once the app is up. */
let keychain: boolean;

/** A keychain entry's file under this suite's user-data folder. */
const entryFile = (account: string): string =>
  join(scratch, 'user-data', 'credentials', `${encodeURIComponent(account)}.bin`);

/**
 * One installed plugin that declares a sign-in against the fake provider, and an exporter of
 * `kind` that writes what `host.signin.accessToken` and `host.credentials(<reserved>)` answered.
 * Without `clientId`, the manifest leaves the client to the person (ADR 0192).
 */
function writePlugin(
  name: string,
  kind: string,
  reserved: string,
  clientId: string | undefined,
): void {
  const folder = join(home, 'plugins', name);
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions: [`signin:${SIGNIN}`],
      signin: {
        [SIGNIN]: {
          authorize: `${provider.origin}/authorize`,
          token: `${provider.origin}/token`,
          ...(clientId === undefined ? {} : { clientId }),
          scopes: ['files'],
        },
      },
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, type: 'module' }));
  const said = (call: string): string =>
    `${call}.then((value) => String(value), (cause) => 'refused:' + (cause.code ?? cause.message))`;
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `export function activate(host) {
  host.registerExporter({
    id: ${JSON.stringify(kind)}, mime: 'text/plain', extension: ${JSON.stringify(kind)},
    kinds: [${JSON.stringify(kind)}], rasterized: false,
    exportFrame: () => Promise.all([
      ${said(`host.signin.accessToken(${JSON.stringify(SIGNIN)})`)},
      ${said(`host.credentials(${JSON.stringify(reserved)})`)},
    ]).then((seen) => ({ ok: true, value: seen.join(' '), diagnostics: [] })),
  });
}
`,
  );
}

function writeHome(): void {
  writePlugin(PLUGIN, 'tok', `signin:${SIGNIN}`, 'tyto-e2e');
  writePlugin(OWN_CLIENT, 'tokc', `signin-client:${SIGNIN}`, undefined);
  const approved = { enabled: true, permissions: [`signin:${SIGNIN}`], source: '.' };
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({ plugins: { [PLUGIN]: approved, [OWN_CLIENT]: approved } }),
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

/** Exports a plugin's `kind` and answers what its two calls said, space-separated. */
async function pluginSees(label: string, kind = 'tok'): Promise<string> {
  const directory = join(scratch, 'out', label);
  const { exportId } = await call<{ exportId: string }>('export:start', {
    documentId: 'e2e',
    brief: BRIEF,
    directory,
    outputs: [{ kind }],
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
  const [file] = readdirSync(directory).filter((name) => name.endsWith(`.${kind}`));
  return readFileSync(join(directory, file!), 'utf8');
}

/** The URLs main handed the stubbed system browser. */
const opened = (): Promise<string[]> =>
  app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-signin-'));
  home = join(scratch, 'tyto-home');
  entry = entryFile(`signin:${PLUGIN}:${SIGNIN}`);
  // Before the manifest: it names the provider's port, which the system picks. It knows the
  // first plugin's client, and the one the person will type for the second.
  provider = await startFakeAuthorizationServer({
    'tyto-e2e': undefined,
    [PERSON_CLIENT_ID]: PERSON_CLIENT_SECRET,
  });
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

    keychain = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable());
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

  it('signs in with a client typed on the screen when the manifest names none (ADR 0192)', async () => {
    const clientEntry = entryFile(`signin-client:${OWN_CLIENT}:${SIGNIN}`);
    const tokenEntry = entryFile(`signin:${OWN_CLIENT}:${SIGNIN}`);
    await page.waitForSelector(`${OWN_LINE}[data-client="missing"]`);
    expect(await page.isDisabled(`${OWN_LINE} .plugins__signin-start`)).toBe(true);
    expect(await page.textContent(`${OWN_LINE} .plugins__signin-hint`)).toBe(
      translate(locale, 'plugins.signin.client.needed'),
    );
    // The plugin's own credentials never reach the client's account, whatever it names.
    expect(await pluginSees('no-client', 'tokc')).toBe(
      'refused:E_SIGNIN_REQUIRED refused:E_PERMISSION',
    );

    await page.fill(`${OWN_LINE} .plugins__signin-client-id`, PERSON_CLIENT_ID);
    await page.fill(`${OWN_LINE} .plugins__signin-client-secret`, PERSON_CLIENT_SECRET);
    await page.click(`${OWN_LINE} .plugins__signin-client-save`);
    if (!keychain) {
      await page.waitForSelector(`${OWN_LINE} .plugins__signin-client-failed`);
      expect(existsSync(clientEntry)).toBe(false);
      return;
    }
    await page.waitForSelector(`${OWN_LINE}[data-client="set"]`);

    // Kept as ciphertext, never shown again, never listed.
    expect(existsSync(clientEntry)).toBe(true);
    expect(readFileSync(clientEntry).toString('utf8')).not.toContain(PERSON_CLIENT_SECRET);
    expect(await page.inputValue(`${OWN_LINE} .plugins__signin-client-id`)).toBe('');
    expect(await page.inputValue(`${OWN_LINE} .plugins__signin-client-secret`)).toBe('');
    const listed = JSON.stringify(await call<unknown>('signin:list', {}));
    expect(listed).not.toContain(PERSON_CLIENT_ID);
    expect(listed).not.toContain(PERSON_CLIENT_SECRET);
    expect(listed).toContain('"client":"set"');
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    expect(html).not.toContain(PERSON_CLIENT_ID);
    expect(html).not.toContain(PERSON_CLIENT_SECRET);

    await page.click(`${OWN_LINE} .plugins__signin-start`);
    await expect.poll(async () => (await opened()).length, { timeout: 10_000 }).toBe(2);
    const authorize = (await opened())[1]!;
    expect(new URL(authorize).searchParams.get('client_id')).toBe(PERSON_CLIENT_ID);
    const landed = await fetch(authorize);
    expect(landed.status).toBe(200);
    await page.waitForSelector(`${OWN_LINE}[data-signed-in="true"]`);

    // The provider accepted the code only for the typed client and secret.
    const last = provider.grants.at(-1)!;
    expect(last.get('grant_type')).toBe('authorization_code');
    expect(last.get('client_id')).toBe(PERSON_CLIENT_ID);
    expect(last.get('client_secret')).toBe(PERSON_CLIENT_SECRET);
    expect(await pluginSees('own-client', 'tokc')).toBe(
      `${FAKE_ACCESS_TOKEN} refused:E_PERMISSION`,
    );

    // Clearing the client ends the sign-in made with it: both entries are gone.
    await page.click(`${OWN_LINE} .plugins__signin-client-clear`);
    await page.waitForSelector(`${OWN_LINE}[data-client="missing"][data-signed-in="false"]`);
    expect(existsSync(clientEntry)).toBe(false);
    expect(existsSync(tokenEntry)).toBe(false);
    expect(await pluginSees('cleared', 'tokc')).toBe(
      'refused:E_SIGNIN_REQUIRED refused:E_PERMISSION',
    );
  });

  it('cancels a sign-in left waiting, and Sign in works again at once (TYTO-646)', async () => {
    await page.waitForSelector(`${LINE}[data-signed-in="false"]`);
    const before = (await opened()).length;

    await page.click(`${LINE} .plugins__signin-start`);
    await expect.poll(async () => (await opened()).length, { timeout: 10_000 }).toBe(before + 1);
    const abandoned = (await opened())[before]!;
    // The person closed the browser tab: nothing comes back, and the line waits.
    await page.waitForSelector(`${LINE} .plugins__signin-cancel`);
    expect(await page.isDisabled(`${LINE} .plugins__signin-start`)).toBe(true);

    await page.click(`${LINE} .plugins__signin-cancel`);
    // No timer: the attempt ends as soon as main closed its listener.
    await page.waitForSelector(`${LINE} .plugins__signin-start:not([disabled])`, {
      timeout: 5_000,
    });
    expect(await page.$(`${LINE} .plugins__signin-waiting`)).toBeNull();
    expect(await page.$(`${LINE} .plugins__signin-failed`)).toBeNull();
    expect(existsSync(entry)).toBe(false);

    // The browser coming back late finds no one listening on the loopback port.
    const late = await fetch(abandoned).then(
      () => 'answered',
      () => 'refused',
    );
    expect(late).toBe('refused');
    expect(existsSync(entry)).toBe(false);

    // A new attempt starts at once and finishes.
    await page.click(`${LINE} .plugins__signin-start`);
    await expect.poll(async () => (await opened()).length, { timeout: 10_000 }).toBe(before + 2);
    const landed = await fetch((await opened())[before + 1]!);
    expect(landed.status).toBe(200);
    if (!keychain) {
      await page.waitForSelector(`${LINE} .plugins__signin-failed`);
      return;
    }
    await page.waitForSelector(`${LINE}[data-signed-in="true"]`);
    expect(existsSync(entry)).toBe(true);
  });
});
