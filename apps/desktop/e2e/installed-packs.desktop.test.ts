import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * An installed template pack in the window (TYTO-50, ADR 0046).
 *
 * The example pack from `examples/plugins/` is installed by the real `tyto plugin install`
 * — the built CLI, run against this launch's `TYTO_HOME` — and the window is opened on it.
 * Its template reaches the picker once the plugins have started, and a brief naming it
 * previews. A second plugin whose pack points out of its folder is refused by the rule the
 * CLI applies, and the problems panel says so.
 *
 * The launch has a `TYTO_HOME` and a `--user-data-dir` of its own, so nothing here reads
 * the machine's `~/.tyto` or its saved layout (TYTO-150).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const cli = resolve(here, '..', '..', 'cli', 'dist', 'index.js');
const examplePack = resolve(
  here,
  '..',
  '..',
  '..',
  'examples',
  'plugins',
  'tyto-plugin-example-pack',
);

for (const file of [built, cli]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}

const AVISO = readFileSync(
  join(examplePack, 'templates', 'aviso', 'examples', 'aviso.brief'),
  'utf8',
);

/** `tyto plugin install <folder> --yes` against `home`, exactly as an author runs it. */
function install(home: string, folder: string): void {
  const installed = spawnSync(process.execPath, [cli, 'plugin', 'install', folder, '--yes'], {
    env: { ...process.env, TYTO_HOME: home },
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error(`install failed: ${installed.stderr}`);
}

/** A pack plugin whose folder claim leads out of it, which install accepts and loading refuses. */
function outsidePack(scratch: string): string {
  const folder = join(scratch, 'sources', 'fora');
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'fora',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['template-pack'],
      permissions: [],
    }),
  );
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    // Slow on purpose: its activation holds the plugins' start past the window's first
    // `templates:list`, which is the order a real machine can produce. Without it the plugins
    // started before the first ask here, and a window that never asked again passed.
    "export function activate(host) {\n  const until = Date.now() + 4000;\n  while (Date.now() < until) {}\n  host.registerTemplatePack({ id: 'fora', templates: [], directory: '../outside' });\n}\n",
  );
  return folder;
}

interface PreviewAnswer {
  readonly frames: readonly { readonly html: string }[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

/** The preview asked directly, through the preload — the same door the renderer uses. */
function preview(page: Page, brief: string): Promise<PreviewAnswer> {
  return page.evaluate(
    (text) =>
      (
        window as unknown as {
          tyto: Record<string, (request: unknown) => Promise<PreviewAnswer>>;
        }
      ).tyto['brief:preview']!({ requestId: 1, documentId: 'e2e', brief: text }),
    brief,
  );
}

function pickerOptions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const picker = document.getElementById('template') as HTMLSelectElement | null;
    return picker === null ? [] : [...picker.options].map((option) => option.value);
  });
}

let app: ElectronApplication;
let page: Page;
let scratch: string;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-installed-packs-'));
  const home = join(scratch, 'tyto-home');
  install(home, examplePack);
  install(home, outsidePack(scratch));

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await app.firstWindow();
  // Something the script builds, never the markup it shipped with (TYTO-154, TYTO-175).
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
}, 120_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('an installed template pack', () => {
  it('reaches the picker once the plugins have started, after the built-in templates', async () => {
    // The plugins start while the window opens and are not awaited (ADR 0044): the picker
    // is asked again when they have, with no reload and nothing typed.
    await page.waitForFunction(
      () => {
        const picker = document.getElementById('template') as HTMLSelectElement | null;
        return picker !== null && [...picker.options].some((option) => option.value === 'aviso');
      },
      undefined,
      { timeout: 30_000, polling: 100 },
    );

    const options = await pickerOptions(page);
    expect(options).toContain('promo-curso');
    expect(options).toContain('aviso');
  });

  it("previews a brief that names its template, in both of the template's formats", async () => {
    const answer = await preview(page, AVISO);

    expect(answer.diagnostics.filter((item) => item.code.startsWith('E_'))).toEqual([]);
    expect(answer.frames).toHaveLength(2);
    expect(answer.frames[0]?.html).toContain('Inscrições');
  });

  it('refuses a pack that leads out of its plugin, and the problems panel says which', async () => {
    const answer = await preview(page, AVISO);

    expect(
      answer.diagnostics
        .filter((item) => item.code === 'W_PLUGIN_SKIPPED')
        .map((item) => item.message),
    ).toEqual([
      "Plugin 'fora' was skipped: Plugin 'fora' contributes template pack folder '../outside', and it leads out of the plugin folder.",
    ]);
  });
});
