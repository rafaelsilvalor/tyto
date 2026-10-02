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

/**
 * The file types a queue folder produces, in a running app (TYTO-188, ADR 0061).
 *
 * **What the unit suites cannot say.** `queue.test.ts` checks which kinds the queue asks for
 * with a fake render, `export.test.ts` that a kind with no exporter is dropped, and
 * `queue-panel.test.ts` which boxes are drawn in jsdom. None of them clicks a box in the real
 * panel, crosses the preload with `queue:set-kinds`, renders through the real export into
 * `outbox/`, or asks a plugin in its own process for a frame.
 *
 * Its own `--user-data-dir` and its own `TYTO_HOME`, which holds one installed exporter, so
 * the settings and the plugins are this suite's and not the machine's.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

/** An official template, one format, two slides: small enough to render quickly. */
const BRIEF = [
  '---',
  'template: agenda-semana',
  'formats: [grid]',
  '---',
  '::titulo',
  '  AGENDA DA SEMANA',
  '::lamina',
  '  FARMÁCIA',
  '  01/10 - 14:00 | Aula 1 | Profª. Teste',
  '::lamina',
  '  FARMÁCIA',
  '  02/10 - 14:00 | Aula 2 | Profª. Teste',
].join('\n');

let scratch: string;
let home: string;
let queueFolder: string;
let app: ElectronApplication;
let page: Page;

/** One installed, enabled exporter of `txt`, the shape `installed-plugins` uses. */
function writeHome(): void {
  const folder = join(home, 'plugins', 'texto');
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'texto',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions: [],
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'texto', type: 'module' }));
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `export function activate(host) {
  host.registerExporter({
    id: 'texto', mime: 'text/plain', extension: 'txt', kinds: ['txt'], rasterized: false,
    exportFrame: (scene, artwork, frame) => ({ ok: true, value: artwork.id + ' ' + frame.format, diagnostics: [] }),
  });
}
`,
  );
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({ plugins: { texto: { enabled: true, permissions: [], source: '.' } } }),
  );
}

/** Drops a task folder the way a person or Jacurutu would. */
function drop(id: string): void {
  mkdirSync(join(queueFolder, 'inbox', id), { recursive: true });
  writeFileSync(join(queueFolder, 'inbox', id, 'brief.brief'), BRIEF, 'utf8');
}

type Bridge = Record<string, (request: unknown) => Promise<unknown>>;

/** A channel, called from the page through the preload — the renderer's own door. */
function call<T>(channel: string, request: unknown): Promise<T> {
  return page.evaluate(
    ([name, body]) => (window as unknown as { tyto: Bridge }).tyto[name as string]!(body),
    [channel, request] as const,
  ) as Promise<T>;
}

const box = (kind: string) => page.locator(`tyto-queue-panel .queue__kind[data-kind="${kind}"]`);

/**
 * Ticks or unticks one box and waits for main's answer to reach the panel: the next click
 * reads the choice the panel was last told, so two clicks inside one round trip would lose one.
 */
async function tick(kind: string, on: boolean): Promise<void> {
  await (on ? box(kind).check() : box(kind).uncheck());
  await page.waitForFunction(
    ([wanted, ticked]) => {
      const panel = document.querySelector('tyto-queue-panel') as {
        view?: { kinds?: string[] };
      } | null;
      return (panel?.view?.kinds?.includes(wanted as string) ?? false) === ticked;
    },
    [kind, on] as const,
  );
}

interface Result {
  readonly status: string;
  readonly artifacts: readonly { readonly name: string; readonly kind: string }[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

/** Runs a task from its row's button and answers with its `result.json` once it is done. */
async function rendered(id: string): Promise<{ result: Result; files: string[] }> {
  await page.waitForSelector(`.queue__task[data-task="${id}"][data-status="pending"]`, {
    timeout: 10_000,
  });
  await page.click(`.queue__task[data-task="${id}"] .queue__run`);
  await page.waitForSelector(`.queue__task[data-task="${id}"][data-status="done"]`, {
    timeout: 90_000,
  });
  const out = join(queueFolder, 'outbox', id, 'out');
  return {
    result: JSON.parse(readFileSync(join(out, 'result.json'), 'utf8')) as Result,
    files: readdirSync(out),
  };
}

const kindsIn = (result: Result): string[] =>
  [...new Set(result.artifacts.map((artifact) => artifact.kind))].sort();

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-queue-kinds-e2e-'));
  home = join(scratch, 'tyto-home');
  queueFolder = join(scratch, 'fila');
  mkdirSync(queueFolder);
  writeHome();

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await app.firstWindow();
  // Something the script builds, never the markup it shipped with (TYTO-154, TYTO-175).
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');

  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('queue.show')?.click();
  });
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, queueFolder);
  await page.click('tyto-queue-panel .queue__choose');
  await page.waitForSelector('tyto-queue-panel .queue__path');
}, 120_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe("a queue folder's file types", () => {
  it("offers Tyto's kinds and the installed exporter's, with PNG alone ticked", async () => {
    await box('txt').waitFor({ timeout: 30_000 });

    const offered = await page.$$eval('tyto-queue-panel .queue__kind', (found) =>
      found.map((item) => item.getAttribute('data-kind')),
    );
    expect(offered).toEqual(['png', 'jpeg', 'webp', 'svg', 'txt']);
    expect(await box('png').isChecked()).toBe(true);
    // The last ticked box cannot be unticked: a folder always produces something.
    expect(await box('png').isDisabled()).toBe(true);
    expect(await box('svg').isChecked()).toBe(false);
  });

  it('produces PNG and SVG once both are ticked, and result.json lists both', async () => {
    await tick('svg', true);
    drop('dois-tipos');

    const { result, files } = await rendered('dois-tipos');

    expect(result.status).toBe('ok');
    expect(kindsIn(result)).toEqual(['png', 'svg']);
    expect(files.some((name) => name.endsWith('.png'))).toBe(true);
    expect(files.some((name) => name.endsWith('.svg'))).toBe(true);
    // Remembered for this folder, so the next launch produces the same.
    const settings = JSON.parse(
      readFileSync(join(scratch, 'user-data', 'settings.json'), 'utf8'),
    ) as { queueKinds: Record<string, string[]> };
    expect(settings.queueKinds[queueFolder]).toEqual(['png', 'svg']);
  }, 120_000);

  it("produces the installed exporter's kind, drawn in the plugin's process", async () => {
    // Ticked first, so the box being unticked is never the last one.
    await tick('txt', true);
    await tick('png', false);
    await tick('svg', false);
    drop('do-plugin');

    const { result, files } = await rendered('do-plugin');

    expect(kindsIn(result)).toEqual(['txt']);
    const text = files.find((name) => name.endsWith('.txt'));
    expect(text).toBeDefined();
    expect(readFileSync(join(queueFolder, 'outbox', 'do-plugin', 'out', text!), 'utf8')).toMatch(
      /^\S+ grid$/u,
    );
  }, 120_000);

  it('leaves out a kind no exporter produces with a warning, and renders the rest', async () => {
    // What a folder's saved choice looks like after its plugin was removed: a kind no
    // exporter in this run's host produces. Sent through the panel's own channel.
    await call('queue:set-kinds', { kinds: ['svg', 'pdf'] });
    await box('pdf').waitFor();
    drop('sem-plugin');

    const { result } = await rendered('sem-plugin');

    expect(result.status).toBe('ok');
    expect(kindsIn(result)).toEqual(['svg']);
    expect(result.diagnostics.filter((item) => item.code === 'W_QUEUE_KIND_UNAVAILABLE')).toEqual([
      expect.objectContaining({ message: expect.stringContaining("'pdf'") as unknown }),
    ]);
    // Still listed, so a person can see it and untick it.
    expect(await box('pdf').isChecked()).toBe(true);
  }, 120_000);

  it('shows the row in the panel, inside the window', async () => {
    const row = page.locator('tyto-queue-panel .queue__kinds');
    const bounds = await row.boundingBox();
    const panel = await page.locator('tyto-queue-panel').boundingBox();

    expect(bounds).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(panel!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1);
    if (process.env.TYTO_E2E_SHOT !== undefined) {
      await page.locator('tyto-queue-panel').screenshot({ path: process.env.TYTO_E2E_SHOT });
    }
  });
});
