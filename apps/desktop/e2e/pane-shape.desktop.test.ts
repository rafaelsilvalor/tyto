import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Every pane has a tab strip and the strips meet across the window; every editor group has a
 * discreet header row under its strip and those meet among themselves (TYTO-288, ADR 0085, after
 * Rafael's VS Code reference of 2026-10-14). A docked panel has a strip and no header row.
 *
 * The card's acceptance is a measurement, not a look. jsdom does no layout, so only a real window
 * can say it. The scene is the busiest the window draws today — a row split whose right group
 * has a locked preview in front, whose left group has a dirty tab and is split down again, the
 * queue in the left dock, a plugin's panel in the right one and Problems at the bottom — and
 * every visible `.pane__strip` and `.pane__header` is read with `getBoundingClientRect`. The
 * helper that judges them is proved able to fail, in the test, by making one panel's strip a
 * pixel taller; and it is read again at 900x600, where nothing may wrap onto a second line.
 *
 * Keys go through Playwright's page, never through the operating system. With
 * `TYTO_PANE_SHAPE_SHOTS` set to a folder, the suite leaves screenshots of the plain window and
 * of the scene there, light and dark, at the default size and at 900x600.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_PANE_SHAPE_SHOTS'];

const PANEL_ID = 'plugin:painel/contagem';
/** Half a pixel: a box at 125 % scaling lands on a device pixel, never between two. */
const TOLERANCE = 0.5;

let app: ElectronApplication;
let page: Page;
let scratch: string;

/** A plugin with one panel, asked for in the right dock. */
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
  host.registerPanel({ id: 'contagem', title: 'Contagem', location: 'right', entry: 'panel/index.html' });
}
`,
  );
  writeFileSync(
    join(folder, 'panel', 'index.html'),
    '<!doctype html><meta charset="utf-8"><h1>Contagem</h1>',
  );
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({ plugins: { painel: { enabled: true, permissions: [], source: '.' } } }),
  );
}

/** One line of a pane, as the window laid it out. */
interface Line {
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
}

/** A pane on screen: what it is, its strip, and the header row an editor group has. */
interface PaneBox {
  readonly name: string;
  readonly kind: 'group' | 'panel';
  readonly strip: Line;
  readonly header: Line | undefined;
}

/**
 * What is wrong with the panes' shape, one sentence per fault; empty when every strip is the
 * same height and panes whose strips start at the same y end them at the same y; when every
 * editor group has a header row right under its strip, all of one height, the groups sharing a
 * strip top ending it at the same y; and when no docked panel has a header row.
 */
function misalignments(panes: readonly PaneBox[]): string[] {
  const faults: string[] = [];
  const near = (one: number, two: number): boolean => Math.abs(one - two) <= TOLERANCE;
  const [first] = panes;
  if (first === undefined) return ['no pane on screen'];
  const firstGroup = panes.find((pane) => pane.kind === 'group');
  for (const pane of panes) {
    if (!near(pane.strip.height, first.strip.height)) {
      faults.push(
        `${pane.name}'s strip is ${pane.strip.height}px, ${first.name}'s ${first.strip.height}px`,
      );
    }
    if (pane.kind === 'panel') {
      if (pane.header !== undefined) faults.push(`${pane.name} has a header row`);
      continue;
    }
    if (pane.header === undefined) {
      faults.push(`${pane.name} has no header row on screen`);
      continue;
    }
    const reference = firstGroup?.header;
    if (reference !== undefined && !near(pane.header.height, reference.height)) {
      faults.push(
        `${pane.name}'s header is ${pane.header.height}px, the first group's ${reference.height}px`,
      );
    }
    if (!near(pane.header.top, pane.strip.bottom)) {
      faults.push(
        `${pane.name}'s header starts at ${pane.header.top}, its strip ends at ${pane.strip.bottom}`,
      );
    }
  }
  for (const pane of panes) {
    for (const other of panes) {
      if (pane === other || !near(pane.strip.top, other.strip.top)) continue;
      if (!near(pane.strip.bottom, other.strip.bottom)) {
        faults.push(`${pane.name} and ${other.name} share a strip top but not its bottom`);
      }
      if (pane.header !== undefined && other.header !== undefined) {
        if (!near(pane.header.bottom, other.header.bottom)) {
          faults.push(`${pane.name} and ${other.name} share a strip top but not a header bottom`);
        }
      }
    }
  }
  return faults;
}

/**
 * Every pane on screen with its two lines: each editor group — its header row, or the shown
 * preview's bar when a preview is in front — and each docked panel. Also how many strips are
 * visible at all, so a pane that lost its shape cannot be left out by the reading.
 */
const measure = async (): Promise<{ panes: PaneBox[]; strips: number }> =>
  page.evaluate(() => {
    const shown = (element: Element | null): element is HTMLElement =>
      element instanceof HTMLElement && element.getClientRects().length > 0;
    const line = (element: HTMLElement): Line => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    };
    const panes: PaneBox[] = [];
    const add = (
      name: string,
      kind: 'group' | 'panel',
      root: Element,
      headers: Element[],
    ): void => {
      const strip = root.querySelector(':scope > .pane__strip');
      if (!shown(strip)) return;
      const header = headers.find(shown);
      panes.push({
        name,
        kind,
        strip: line(strip),
        header: header === undefined ? undefined : line(header),
      });
    };
    document.querySelectorAll('[data-editor-group]').forEach((group, index) => {
      add(`group ${String(index + 1)}`, 'group', group, [
        ...group.querySelectorAll(
          ':scope > .pane__header, :scope > tyto-preview-pane > .pane__header',
        ),
      ]);
    });
    document.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => {
      add(`panel ${panel.dataset['panel'] ?? '?'}`, 'panel', panel, [
        ...panel.querySelectorAll(':scope > .pane__header'),
      ]);
    });
    const strips = [...document.querySelectorAll('.pane__strip')].filter(shown).length;
    return { panes, strips };
  });

/**
 * The lines with something inside reaching above or below them: a wrap onto a second line, or a
 * control taller than the line. Measured by boxes and not by `scrollHeight`, which a header row
 * squeezed narrower than its actions reported two pixels over with nothing outside it.
 */
const overflowing = async (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.pane__strip, .pane__header')]
      .filter((line) => line.getClientRects().length > 0)
      .flatMap((line) => {
        const outer = line.getBoundingClientRect();
        return [...line.querySelectorAll<HTMLElement>('*')]
          .filter((inner) => inner.getClientRects().length > 0)
          .filter((inner) => {
            const box = inner.getBoundingClientRect();
            return box.top < outer.top - 0.5 || box.bottom > outer.bottom + 0.5;
          })
          .map((inner) => `${line.className} > ${inner.tagName.toLowerCase()}.${inner.className}`);
      }),
  );

const tokenPixels = async (name: string): Promise<number> =>
  page.evaluate(
    (token) =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)),
    name,
  );

const runFromBar = async (id: string): Promise<void> => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
};

/** Waits until the bar offers `id` — a plugin's panel command comes when its plugin starts. */
async function waitForCommand(id: string): Promise<void> {
  const started = Date.now();
  for (;;) {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type(id);
    await page.waitForTimeout(100);
    const offered = (await page.locator('.command-bar__option').count()) > 0;
    await page.keyboard.press('Escape');
    if (offered) return;
    if (Date.now() - started > 60_000) throw new Error(`the command bar never offered ${id}`);
    await page.waitForTimeout(250);
  }
}

const resize = async (width: number, height: number): Promise<void> => {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  // Within two pixels, for `status-bar.desktop.test.ts`'s reason: Windows rounds at 125 %.
  await page.waitForFunction((wanted) => Math.abs(window.innerWidth - wanted) <= 2, width);
  await page.waitForTimeout(300);
};

/** Screenshots in both schemes, when asked for; the window is left light. */
const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await app.evaluate(({ nativeTheme }, source) => {
      nativeTheme.themeSource = source;
    }, scheme);
    // scheme: the screenshot in each theme Rafael approves by looking; main is told too.
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(shots, `${name}-${scheme}.png`) });
  }
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'light';
  });
  // scheme: back to the light window every other test in this file measured.
  await page.emulateMedia({ colorScheme: 'light' });
};

let defaultSize: { width: number; height: number };

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-pane-shape-'));
  const home = join(scratch, 'tyto-home');
  writeHome(home);
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  defaultSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('one group and the problems panel', () => {
  it('draw the same strip, the group a discreet header row under it, at the token heights', async () => {
    const { panes } = await measure();
    expect(panes.map((pane) => pane.name)).toEqual(['group 1', 'panel problems']);
    expect(misalignments(panes)).toEqual([]);
    expect(panes[0]?.strip.height).toBeCloseTo(await tokenPixels('--tyto-pane-strip-height'), 1);
    expect(panes[0]?.header?.height).toBeCloseTo(await tokenPixels('--tyto-pane-header-height'), 1);
    // Discreet, as VS Code's breadcrumb row is: the editor's background and no line of its own.
    const look = await page.evaluate(() => {
      const header = document.querySelector('[data-editor-group] > .pane__header');
      const editor = document.querySelector('#editor .cm-editor');
      if (header === null || editor === null) throw new Error('no header row or no editor');
      const style = getComputedStyle(header);
      return {
        background: style.backgroundColor === getComputedStyle(editor).backgroundColor,
        borders: [style.borderTopWidth, style.borderBottomWidth],
      };
    });
    expect(look).toEqual({ background: true, borders: ['0px', '0px'] });
    await shoot('plain');
    await resize(900, 600);
    expect(await overflowing()).toEqual([]);
    await shoot('plain-900x600');
    await resize(defaultSize.width, defaultSize.height);
  });
});

describe('the busiest window', () => {
  it('builds the scene: splits, a locked preview, a dirty tab, three docked panels', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.type('---\ntemplate: promo-curso\n---\n::titulo Inverno');
    // The preview beside the brief, in a new group to the right; the focus stays in the brief.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if ((await page.$('[data-tab-kind="preview"]')) !== null) break;
      await page.focus('#editor .cm-content');
      await page.keyboard.press('Control+Shift+V');
      await page.waitForTimeout(500);
    }
    await runFromBar('preview.toggleLock');
    await page.waitForSelector('[data-tab-kind="preview"] .tabs__lock');
    // The brief's group split down, so the left side is a column of two.
    await page.locator('[data-editor-group] .cm-content').first().click();
    await page.keyboard.press('Control+Shift+Backslash');
    await page.waitForSelector('.editor-split--column');
    await runFromBar('layout.togglePanel:queue');
    await page.waitForSelector('[data-panel="queue"]');
    await waitForCommand(`layout.togglePanel:${PANEL_ID}`);
    await runFromBar(`layout.togglePanel:${PANEL_ID}`);
    await page.waitForSelector(`[data-panel="${PANEL_ID}"] iframe`, { timeout: 20_000 });

    const { panes } = await measure();
    expect(panes.map((pane) => pane.name).sort()).toEqual([
      'group 1',
      'group 2',
      'group 3',
      `panel ${PANEL_ID}`,
      'panel problems',
      'panel queue',
    ]);
    expect(await page.locator('.tabs__dirty').count()).toBeGreaterThan(0);
  }, 180_000);

  it('ends every strip at the same y across the panes, and the groups’ header rows too', async () => {
    const { panes, strips } = await measure();
    expect(strips).toBe(panes.length);
    expect(misalignments(panes)).toEqual([]);
    // Four panes start at the top of the docks — two groups and the two side panels — and their
    // strips are the line a person sees continue across the window.
    const top = Math.min(...panes.map((pane) => pane.strip.top));
    expect(panes.filter((pane) => Math.abs(pane.strip.top - top) <= TOLERANCE)).toHaveLength(4);
    process.stdout.write(`[TYTO-288] panes: ${JSON.stringify(panes)}\n`);
    await shoot('scene');
  });

  it('fails the helper when one pane is a pixel off (the negative control)', async () => {
    const style = await page.addStyleTag({
      content:
        '[data-panel="queue"] > .pane__strip { height: calc(var(--tyto-pane-strip-height) + 1px) !important; }',
    });
    try {
      const faults = misalignments((await measure()).panes);
      expect(faults.length).toBeGreaterThan(0);
      expect(faults.join('\n')).toContain('panel queue');
    } finally {
      await style.evaluate((node) => {
        node.parentNode?.removeChild(node);
      });
    }
    expect(misalignments((await measure()).panes)).toEqual([]);
  });

  it('keeps every line one line at 900x600, still aligned', async () => {
    await resize(900, 600);
    expect(await overflowing()).toEqual([]);
    expect(misalignments((await measure()).panes)).toEqual([]);
    await shoot('scene-900x600');
    await resize(defaultSize.width, defaultSize.height);
  });
});
