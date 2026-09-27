import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * A plugin directive in the window (TYTO-49, ADR 0043).
 *
 * `::demo/shout {slot: titulo} Direito` with the plugin installed: the preview resolves it
 * in the plugin's own `utilityProcess`, the gutter stays clean, and `demo/shout` is offered
 * after `::`. Without the plugin the same brief is `E_UNKNOWN_DIRECTIVE`, underlined on
 * `demo/shout`. Two launches, because whether a plugin is installed is read when the window
 * opens (ADR 0044).
 *
 * Each launch has a `TYTO_HOME` and a `--user-data-dir` of its own, so nothing here reads
 * the machine's `~/.tyto` or its saved layout (TYTO-150).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const SHOUTED = ['---', 'template: promo-curso', '---', '::demo/shout {slot: titulo} Direito'].join(
  '\n',
);

/** The card's test plugin, as a third party ships it: plain ESM in `dist/index.js`. */
const SHOUT_SOURCE = `export function activate(host) {
  host.registerDirective({
    id: 'demo',
    names: ['shout'],
    transform: (directive) => {
      const slot = directive.adjustments.find((item) => item.name === 'slot');
      const body = directive.body.map((inline) =>
        inline.kind === 'text' ? { kind: 'text', value: inline.value.toUpperCase() } : { kind: 'break' });
      return { ok: true, value: [{ name: slot.value, body }], diagnostics: [] };
    },
  });
}
`;

function writeHome(home: string, withPlugin: boolean): void {
  mkdirSync(home, { recursive: true });
  if (!withPlugin) return;
  const folder = join(home, 'plugins', 'demo');
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'demo',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['directive'],
      permissions: [],
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'demo', type: 'module' }));
  writeFileSync(join(folder, 'dist', 'index.js'), SHOUT_SOURCE);
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({ plugins: { demo: { enabled: true, permissions: [], source: '.' } } }),
  );
}

interface Launched {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly scratch: string;
}

async function launch(withPlugin: boolean): Promise<Launched> {
  const scratch = mkdtempSync(join(tmpdir(), 'tyto-directives-'));
  const home = join(scratch, 'tyto-home');
  writeHome(home, withPlugin);
  const app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  const page = await app.firstWindow();
  // Something the script builds, never the markup it shipped with (TYTO-154, TYTO-175).
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  return { app, page, scratch };
}

/** Replaces the buffer in one transaction, so no completion popup can take a keystroke. */
async function setBrief(page: Page, text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
}

interface PreviewAnswer {
  readonly frames: readonly { readonly html: string }[];
  readonly diagnostics: readonly { readonly code: string }[];
  readonly completion: { readonly directives: readonly string[] };
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

/** The text under every error squiggle in the editor. */
function underlined(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('#editor .cm-lintRange-error')].map(
      (node) => node.textContent ?? '',
    ),
  );
}

describe('with the demo plugin installed', () => {
  let launched: Launched;

  beforeAll(async () => {
    launched = await launch(true);
  }, 120_000);

  afterAll(async () => {
    await closeApp(launched.app);
    rmSync(launched.scratch, { recursive: true, force: true });
  });

  it('previews ::demo/shout uppercased, resolved in the plugin’s process', async () => {
    const { page } = launched;
    // The plugins start while the window opens and are not awaited (ADR 0044), so the first
    // previews may come before the directive exists.
    const started = Date.now();
    let answer = await preview(page, SHOUTED);
    while (!answer.completion.directives.includes('demo/shout')) {
      if (Date.now() - started > 30_000) throw new Error('the demo plugin never started');
      await new Promise((resolve) => setTimeout(resolve, 100));
      answer = await preview(page, SHOUTED);
    }

    expect(answer.diagnostics.map((item) => item.code)).not.toContain('E_UNKNOWN_DIRECTIVE');
    expect(answer.frames.some((frame) => frame.html.includes('DIREITO'))).toBe(true);
  }, 60_000);

  it('exports it through the run’s own host, with no E_UNKNOWN_DIRECTIVE', async () => {
    const { page, scratch } = launched;
    const bridge = (channel: string, request: unknown): Promise<unknown> =>
      page.evaluate(
        ([name, body]) =>
          (window as unknown as { tyto: Record<string, (request: unknown) => Promise<unknown>> })
            .tyto[name as string]!(body),
        [channel, request] as const,
      );
    const directory = join(scratch, 'export-svg');
    const { exportId } = (await bridge('export:start', {
      documentId: 'e2e',
      brief: SHOUTED,
      directory,
      outputs: [{ kind: 'svg' }],
    })) as { exportId: string };
    const started = Date.now();
    for (;;) {
      const { progress } = (await bridge('export:progress', { exportId })) as {
        progress?: { status: string; diagnostics: { code: string }[] };
      };
      if (progress !== undefined && progress.status !== 'running') {
        expect(progress.diagnostics.map((item) => item.code)).not.toContain('E_UNKNOWN_DIRECTIVE');
        expect(progress.diagnostics.map((item) => item.code)).not.toContain(
          'E_MISSING_REQUIRED_SLOT',
        );
        break;
      }
      if (Date.now() - started > 60_000) throw new Error('the export never finished');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, 90_000);

  it('leaves the gutter clean for the directive and offers it after ::', async () => {
    const { page } = launched;
    await setBrief(page, SHOUTED);
    // The squiggle is fed by the preview answer; wait for one pass over this text.
    await page.waitForFunction(
      () => document.querySelector('#preview-stage iframe') !== null,
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(600);
    expect(await underlined(page)).not.toContain('demo/shout');

    await page.keyboard.press('End');
    await page.keyboard.insertText('\n');
    await page.keyboard.type('::');
    const options = page.locator('.cm-tooltip-autocomplete li');
    await options.first().waitFor({ timeout: 5_000 });
    const labels = await options.allTextContents();
    expect(labels.some((label) => label.startsWith('demo/shout'))).toBe(true);
    // The slots arrive with it: this is the first completion list the window has had.
    expect(labels.some((label) => label.startsWith('titulo'))).toBe(true);

    await page.screenshot({ path: join(launched.scratch, '..', 'tyto-49-completion.png') });
    await page.keyboard.press('Escape');
  }, 60_000);

  it('underlines a slot error within the preview’s pause, measured', async () => {
    const { page } = launched;
    await setBrief(page, ['---', 'template: promo-curso', '---', '::titulo Oi'].join('\n'));
    await page.waitForTimeout(600);
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n::rodape x');
    const typed = Date.now();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('#editor .cm-lintRange-error')].some(
          (node) => node.textContent === 'rodape',
        ),
      undefined,
      // A fixed interval, never Playwright's default `requestAnimationFrame` polling: this
      // window is headless, its frames are throttled, and rAF polling added 900 ms of its
      // own to this number (1,149 ms against 246 ms for the same keystroke).
      { timeout: 5_000, polling: 25 },
    );
    const elapsed = Date.now() - typed;
    // Reported rather than bounded hard: the pause is the preview's 200 ms debounce plus one
    // compile, and a loaded CI machine is slower than this one. A second is the line past
    // which it would feel broken.
    process.stdout.write(`[TYTO-49] underline after the last keystroke: ${String(elapsed)} ms\n`);
    expect(elapsed).toBeLessThan(1_000);
  }, 60_000);
});

describe('without the plugin', () => {
  let launched: Launched;

  beforeAll(async () => {
    launched = await launch(false);
  }, 120_000);

  afterAll(async () => {
    await closeApp(launched.app);
    rmSync(launched.scratch, { recursive: true, force: true });
  });

  it('underlines demo/shout as E_UNKNOWN_DIRECTIVE', async () => {
    const { page } = launched;
    await setBrief(page, SHOUTED);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('#editor .cm-lintRange-error')].some(
          (node) => node.textContent === 'demo/shout',
        ),
      undefined,
      { timeout: 10_000 },
    );

    const answer = await preview(page, SHOUTED);
    expect(answer.diagnostics.map((item) => item.code)).toContain('E_UNKNOWN_DIRECTIVE');
    expect(answer.completion.directives).toEqual([]);
    await page.screenshot({ path: join(launched.scratch, '..', 'tyto-49-unknown.png') });
  }, 60_000);
});
