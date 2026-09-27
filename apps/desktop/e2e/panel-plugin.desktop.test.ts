import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Frame, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * A plugin's panel in the running window (TYTO-49, ADR 0045).
 *
 * The claims only a real window can check: the iframe's sandbox is `allow-scripts` and
 * nothing else; inside it `window.parent.document` and `localStorage` throw, and no
 * `window.tyto` exists because Electron runs no preload in a subframe; the frame cannot be
 * sent to `https://example.com`, and can move within its own plugin, which is the control;
 * a bridge request its plugin has no permission for is `E_PERMISSION`; the page hears the
 * open brief.
 *
 * `TYTO_HOME` and `--user-data-dir` are this suite's own (TYTO-150).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const PANEL_ID = 'plugin:painel/contagem';

/** The page's own script: counts the directives of every brief it hears. No inline script. */
const PANEL_SCRIPT = `window.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.tyto === 'panel' && data.type === 'event' && data.event === 'document') {
    document.getElementById('count').textContent =
      String((data.text.match(/^::/gmu) || []).length) + ' diretivas';
    window.__lastDocument = data.text;
  }
});
`;

function writeHome(home: string): void {
  const folder = join(home, 'plugins', 'painel');
  mkdirSync(join(folder, 'dist'), { recursive: true });
  mkdirSync(join(folder, 'panel'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'painel',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['panel'],
      permissions: [],
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'painel', type: 'module' }));
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `export function activate(host) {
  host.registerPanel({ id: 'contagem', title: 'Contagem', location: 'bottom', entry: 'panel/index.html' });
}
`,
  );
  writeFileSync(
    join(folder, 'panel', 'index.html'),
    '<!doctype html><meta charset="utf-8"><h1>Contagem</h1><p id="count">—</p><script src="panel.js"></script>',
  );
  writeFileSync(join(folder, 'panel', 'panel.js'), PANEL_SCRIPT);
  writeFileSync(join(folder, 'panel', 'other.html'), '<!doctype html><p id="other">outra</p>');
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({ plugins: { painel: { enabled: true, permissions: [], source: '.' } } }),
  );
}

let scratch: string;
let app: ElectronApplication;
let page: Page;

/** Runs a command from the bar, filtered by id the way `dock.desktop.test.ts` does. */
async function runFromBar(id: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

/** The panel's frame, once its page has loaded. */
async function panelFrame(): Promise<Frame> {
  const started = Date.now();
  for (;;) {
    const frame = page
      .frames()
      .find((candidate) => candidate.url().startsWith('tyto-plugin://painel/'));
    if (frame !== undefined) {
      await frame.waitForSelector('h1, #other', { timeout: 10_000 });
      return frame;
    }
    if (Date.now() - started > 20_000) throw new Error('the panel frame never loaded');
    await page.waitForTimeout(100);
  }
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-panel-plugin-'));
  const home = join(scratch, 'tyto-home');
  writeHome(home);
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await app.firstWindow();
  // Something the script builds, never the markup it shipped with (TYTO-154, TYTO-175).
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  // The app's own storage holds something, so "cannot read it" is about a value that exists.
  await page.evaluate(() => {
    localStorage.setItem('tyto-e2e-secret', 'do app');
  });
}, 120_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a plugin panel in the window', () => {
  it('is offered closed, and opens from the command bar', async () => {
    await page.waitForFunction(() => document.querySelector('tyto-plugin-panel') === null);
    // The panels arrive once the plugins have started; the command appears with them.
    await page.waitForTimeout(1_500);
    await runFromBar(`layout.togglePanel:${PANEL_ID}`);
    await page.waitForSelector(`[data-panel="${PANEL_ID}"] iframe`, { timeout: 10_000 });
    expect(await page.textContent(`[data-panel="${PANEL_ID}"] .work__title`)).toBe('Contagem');
  }, 60_000);

  it('frames it with sandbox="allow-scripts" and nothing else', async () => {
    const sandbox = await page.getAttribute(`[data-panel="${PANEL_ID}"] iframe`, 'sandbox');
    expect(sandbox).toBe('allow-scripts');
  });

  it('cannot reach the window’s DOM, the app’s localStorage or the preload', async () => {
    const frame = await panelFrame();
    const reached = await frame.evaluate(() => {
      const attempt = (probe: () => unknown): string => {
        try {
          return `reached: ${String(probe())}`;
        } catch (error) {
          return `threw ${(error as Error).name}`;
        }
      };
      return {
        parentDocument: attempt(() => window.parent.document.title),
        parentStorage: attempt(() => window.parent.localStorage.getItem('tyto-e2e-secret')),
        ownStorage: attempt(() => localStorage.getItem('tyto-e2e-secret')),
        preload: typeof (window as unknown as { tyto?: unknown }).tyto,
        origin: window.origin,
      };
    });
    expect(reached).toEqual({
      parentDocument: 'threw SecurityError',
      parentStorage: 'threw SecurityError',
      ownStorage: 'threw SecurityError',
      preload: 'undefined',
      origin: 'null',
    });
  });

  it('hears the open brief when it changes', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(
      '---\ntemplate: promo-curso\n---\n::titulo Um\n::subtitulo Dois',
    );
    const frame = await panelFrame();
    await frame.waitForFunction(
      () => document.getElementById('count')?.textContent === '2 diretivas',
      undefined,
      { timeout: 10_000, polling: 25 },
    );
    await page.screenshot({ path: join(tmpdir(), 'tyto-49-panel.png') });
  }, 30_000);

  it('gets E_PERMISSION for a fetch its plugin never declared', async () => {
    const frame = await panelFrame();
    const answer = await frame.evaluate(
      () =>
        new Promise((resolve) => {
          window.addEventListener('message', (event) => {
            const data = event.data as { type?: string; id?: number };
            if (data.type === 'response' && data.id === 1) resolve(data);
          });
          window.parent.postMessage(
            {
              tyto: 'panel',
              type: 'request',
              id: 1,
              capability: 'fetch',
              args: ['https://api.example.com/'],
            },
            '*',
          );
        }),
    );
    expect(answer).toMatchObject({
      tyto: 'panel',
      type: 'response',
      id: 1,
      ok: false,
      code: 'E_PERMISSION',
    });
  });

  it('is kept inside its plugin by main’s guard, and may move within it', async () => {
    // Another plugin's page is a URL the window's CSP allows (`frame-src tyto-plugin:`), so
    // what refuses it is `will-frame-navigate` in main (`frameNavigationAllowed`).
    let frame = await panelFrame();
    await frame.evaluate(() => {
      window.location.href = 'tyto-plugin://outro/panel.html';
    });
    await page.waitForTimeout(1_500);
    frame = await panelFrame();
    expect(frame.url()).toBe('tyto-plugin://painel/panel/index.html');

    // The control: the same guard lets the page move within its own plugin.
    await frame.evaluate(() => {
      window.location.href = 'other.html';
    });
    const started = Date.now();
    while (
      !page
        .frames()
        .some((candidate) => candidate.url() === 'tyto-plugin://painel/panel/other.html')
    ) {
      if (Date.now() - started > 10_000) throw new Error('the in-plugin navigation never happened');
      await page.waitForTimeout(100);
    }
  }, 30_000);

  it('never loads https://example.com', async () => {
    // Refused one layer earlier than the guard: the window's CSP has no `https:` in
    // `frame-src`, so Chromium stops the navigation before main is asked and draws its own
    // error page in the frame. Last, because the panel is gone afterwards.
    const frame = page
      .frames()
      .find((candidate) => candidate.url().startsWith('tyto-plugin://painel/'));
    if (frame === undefined) throw new Error('no panel frame');
    await frame.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    await page.waitForTimeout(2_000);
    const urls = page.frames().map((candidate) => candidate.url());
    expect(urls.some((url) => url.startsWith('https://example.com'))).toBe(false);
    expect(urls).toContain('chrome-error://chromewebdata/');
  }, 30_000);
});
