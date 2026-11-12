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
import { firstWindow } from './first-window.js';

/**
 * A multi-line credential from the plugins screen (TYTO-649): a service account's JSON key,
 * imported from a file and pasted into the field, read back and parsed by a plugin in its own
 * process.
 *
 * **The key is a fake with the real one's shape**: pretty-printed over 14 lines with CRLF, as a
 * file saved on Windows is, and a `private_key` whose line breaks are `\n` escapes inside the
 * JSON string. It signs nothing; what is measured is that the text arrives whole.
 *
 * The picker is main's `dialog.showOpenDialog`, stubbed from main as the other suites do, so the
 * path is handed to main and never to the page. `TYTO_HOME` and `--user-data-dir` are this
 * suite's own folders.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm --filter @tyto/desktop build\` first`);
}

const BRIEF = ['---', 'template: promo-curso', '---', '::titulo Chave'].join('\n');
const EMAIL = 'fake-649@fake-project-649.example';
const KEY_TEXT = `${JSON.stringify(
  {
    type: 'service_account',
    project_id: 'fake-project-649',
    private_key_id: '0123456789abcdef0123456789abcdef01234567',
    private_key: `-----BEGIN PRIVATE KEY-----\n${Array.from({ length: 26 }, (_, line) =>
      `ZmFrZS1ub3QtYS1yZWFsLWtleS02NDk${String(line)}`.padEnd(64, 'A'),
    ).join('\n')}\n-----END PRIVATE KEY-----\n`,
    client_email: EMAIL,
    client_id: '000000000000000000649',
    auth_uri: 'https://accounts.example/o/oauth2/auth',
    token_uri: 'https://oauth2.example/token',
    auth_provider_x509_cert_url: 'https://certs.example/oauth2/v1/certs',
    client_x509_cert_url: 'https://certs.example/robot/v1/metadata/x509/fake-649',
    universe_domain: 'example.com',
  },
  null,
  2,
).replaceAll('\n', '\r\n')}\r\n`;
const CR_COUNT = KEY_TEXT.split('\r').length - 1;

const LINE = '[data-plugin="chave"] .plugins__credential[data-key="service-account"]';

let scratch: string;
let app: ElectronApplication;
let page: Page;
let keyFile: string;
let bigFile: string;

/**
 * `chave`: its exporter reads `service-account`, parses it, and writes
 * `<client_email>|<length>|<CR count>|<LF count>`, or what refused it.
 */
function installPlugin(home: string): void {
  const folder = join(home, 'plugins', 'chave');
  mkdirSync(join(folder, 'dist'), { recursive: true });
  const permissions = ['credentials:service-account'];
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'chave',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions,
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'chave', type: 'module' }));
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `const count = (text, character) => text.split(character).length - 1;
export function activate(host) {
  host.registerExporter({
    id: 'chave', mime: 'text/plain', extension: 'key', kinds: ['key'], rasterized: false,
    exportFrame: () => host.credentials('service-account').then(
      (text) => {
        let email;
        try { email = JSON.parse(text).client_email; } catch { email = 'not-json'; }
        return [email, text.length, count(text, '\\r'), count(text, '\\n')].join('|');
      },
      (cause) => 'refused:' + (cause.code ?? cause.message),
    ).then((value) => ({ ok: true, value, diagnostics: [] })),
  });
}
`,
  );
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({ plugins: { chave: { enabled: true, permissions, source: '.' } } }),
  );
}

type Bridge = Record<string, (request: unknown) => Promise<unknown>>;

function call<T>(channel: string, request: unknown): Promise<T> {
  return page.evaluate(
    ([name, body]) => (window as unknown as { tyto: Bridge }).tyto[name as string]!(body),
    [channel, request] as const,
  ) as Promise<T>;
}

/** What the plugin's exporter wrote when asked for a frame now. */
async function pluginRead(name: string): Promise<string> {
  const out = join(scratch, name);
  const { exportId } = await call<{ exportId: string }>('export:start', {
    documentId: 'e2e',
    brief: BRIEF,
    directory: out,
    outputs: [{ kind: 'key' }],
  });
  const started = Date.now();
  for (;;) {
    const { progress } = await call<{ progress?: { status: string; failure?: string } }>(
      'export:progress',
      { exportId },
    );
    if (progress !== undefined && progress.status !== 'running') {
      expect(progress.failure).toBeUndefined();
      break;
    }
    if (Date.now() - started > 20_000) throw new Error('the export never finished');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const [file] = readdirSync(out).filter((entry) => entry.endsWith('.key'));
  return readFileSync(join(out, file!), 'utf8');
}

/** Makes main's file picker answer `path` the next time it opens. */
async function pickerAnswers(path: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, path);
}

/** The page's whole markup, where a stored value or a picked path must never appear. */
const markup = (): Promise<string> => page.evaluate(() => document.documentElement.outerHTML);

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-credential-file-'));
  const home = join(scratch, 'tyto-home');
  installPlugin(home);
  keyFile = join(scratch, 'keys', 'fake-project-649-key.json');
  mkdirSync(dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, KEY_TEXT, 'utf8');
  bigFile = join(scratch, 'keys', 'too-large-649.json');
  writeFileSync(bigFile, 'a'.repeat(16 * 1024 + 1), 'utf8');

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('.tabs__tab');
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('plugins.show')?.click();
  });
  await page.waitForSelector(`${LINE}[data-set="false"]`);
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a multi-line credential from the plugins screen (TYTO-649)', () => {
  it('is imported from a file whole, parsed by the plugin, and never shown', async () => {
    // A machine with no keychain refuses to store anything (`credentials.ts`); there the line
    // says so and nothing is stored, which is the other half of the same contract.
    const available = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable());
    process.stdout.write(`[TYTO-649] safeStorage available=${String(available)}\n`);

    await pickerAnswers(bigFile);
    await page.click(`${LINE} .plugins__credential-import`);
    await page.waitForSelector(`${LINE} .plugins__credential-failed`);
    expect(await page.textContent(`${LINE} .plugins__credential-failed`)).toContain('16 KiB');
    expect(await page.getAttribute(LINE, 'data-set')).toBe('false');

    await pickerAnswers(keyFile);
    await page.click(`${LINE} .plugins__credential-import`);
    if (!available) {
      await page.waitForFunction(
        (line) =>
          !document
            .querySelector(`${line} .plugins__credential-failed`)
            ?.textContent?.includes('16 KiB'),
        LINE,
      );
      expect(await page.getAttribute(LINE, 'data-set')).toBe('false');
      return;
    }
    await page.waitForSelector(`${LINE}[data-set="true"]`);
    expect(await page.$(`${LINE} .plugins__credential-failed`)).toBeNull();

    const read = await pluginRead('imported');
    process.stdout.write(`[TYTO-649] imported: plugin read ${read}\n`);
    // The exact text: its length, and every CR of the file's CRLF line ends.
    expect(read).toBe(
      `${EMAIL}|${String(KEY_TEXT.length)}|${String(CR_COUNT)}|${String(CR_COUNT)}`,
    );
    const html = await markup();
    expect(html).not.toContain(EMAIL);
    expect(html).not.toContain('fake-project-649-key');
  });

  it('is pasted over several lines, kept whole, parsed by the plugin, and never shown', async () => {
    const field = `${LINE} .plugins__credential-field`;
    // Masked as a password field is, though it is a textarea.
    expect(
      await page.$eval(field, (element) => ({
        tag: element.tagName,
        mask: getComputedStyle(element).getPropertyValue('-webkit-text-security'),
      })),
    ).toEqual({ tag: 'TEXTAREA', mask: 'disc' });

    await page.click(field);
    // What a paste inserts, through the browser's own editing path; the OS clipboard is not
    // touched.
    await page.keyboard.insertText(KEY_TEXT);
    const typed = await page.inputValue(field);
    process.stdout.write(
      `[TYTO-649] pasted: field holds ${String(typed.length)} chars, ` +
        `${String(typed.split('\n').length - 1)} LF, ${String(typed.split('\r').length - 1)} CR\n`,
    );
    await page.click(`${LINE} .plugins__credential-save`);
    // Emptied once stored; with no keychain (a Linux runner) the line says it failed instead.
    await page.waitForFunction(
      ([selector, line]) =>
        document.querySelector<HTMLTextAreaElement>(selector)?.value === '' ||
        document.querySelector(`${line} .plugins__credential-failed`) !== null,
      [field, LINE] as const,
    );
    if (await page.$(`${LINE} .plugins__credential-failed`)) {
      expect(await markup()).not.toContain(EMAIL);
      return;
    }

    const read = await pluginRead('pasted');
    process.stdout.write(`[TYTO-649] pasted: plugin read ${read}\n`);
    // A textarea's value turns CRLF into LF and keeps every line break.
    expect(read).toBe(`${EMAIL}|${String(KEY_TEXT.length - CR_COUNT)}|0|${String(CR_COUNT)}`);
    expect(await markup()).not.toContain(EMAIL);
  });

  it('imports a recipe credential from a file too, listed by name only', async () => {
    const section = '.plugins__recipe-credentials';
    await pickerAnswers(keyFile);
    await page.fill(`${section} .plugins__recipe-credential-name`, 'key-file');
    await page.click(`${section} .plugins__recipe-credential-import`);
    await page.waitForFunction(
      (selector) =>
        document.querySelector(`${selector} [data-name="key-file"]`) !== null ||
        document.querySelector(`${selector} .plugins__recipe-credential-failed`) !== null,
      section,
    );
    if (await page.$(`${section} .plugins__recipe-credential-failed`)) return; // no keychain
    const stored = join(
      scratch,
      'user-data',
      'credentials',
      `${encodeURIComponent('recipe:key-file')}.bin`,
    );
    expect(existsSync(stored)).toBe(true);
    expect(readFileSync(stored).toString('utf8')).not.toContain(EMAIL);
    expect(await markup()).not.toContain(EMAIL);
  });
});
