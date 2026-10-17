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

/** The visible strips that draw a line under themselves, by the pane holding them. */
const linedStrips = async (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.pane__strip')]
      .filter((strip) => strip.getClientRects().length > 0)
      .filter((strip) => getComputedStyle(strip).borderBottomWidth !== '0px')
      .map((strip) => {
        const pane = strip.parentElement;
        const name =
          pane?.dataset['panel'] ?? (pane?.hasAttribute('data-editor-group') ? 'group' : '?');
        return `${name}: ${getComputedStyle(strip).borderBottomWidth}`;
      }),
  );

/**
 * Each visible docked panel's strip as `id: tool CASE`, where `tool` says it is a tool header
 * with a title and no tab in it (`tab` otherwise), and CASE is the title's `text-transform`;
 * and how many editor groups' strips are drawn as a tool header, which must be none.
 */
const toolHeaders = async (): Promise<{ panels: string[]; groups: number }> =>
  page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')]
      .map((panel) => ({ panel, strip: panel.querySelector(':scope > .pane__strip') }))
      .filter(({ strip }) => strip instanceof HTMLElement && strip.getClientRects().length > 0)
      .map(({ panel, strip }) => {
        const title = strip!.querySelector<HTMLElement>(':scope > .tool__title');
        const tool =
          strip!.classList.contains('pane__strip--tool') &&
          title !== null &&
          strip!.querySelector('.pane__tab, .tabs__tab') === null;
        const casing = title === null ? 'none' : getComputedStyle(title).textTransform;
        return `${panel.dataset['panel'] ?? '?'}: ${tool ? 'tool' : 'tab'} ${casing.toUpperCase()}`;
      })
      .sort();
    const groups = document.querySelectorAll(
      '[data-editor-group] > .pane__strip.pane__strip--tool',
    ).length;
    return { panels, groups };
  });

/** A box as `getBoundingClientRect` read it, and what it is. */
interface Box {
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  /** For a group: the split it sits in, by `data-group-split`; the root has none. */
  readonly split?: string | undefined;
}

/** Every visible editor group, split, group line and dock, and the window's real inner size. */
interface Geometry {
  readonly groups: readonly Box[];
  readonly splits: readonly Box[];
  readonly lines: readonly Box[];
  readonly docks: readonly Box[];
  readonly width: number;
  readonly height: number;
}

const geometry = async (): Promise<Geometry> =>
  page.evaluate(() => {
    const box = (name: string, element: Element, split?: string): Box => {
      const rect = element.getBoundingClientRect();
      return {
        name,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        split,
      };
    };
    const shown = (selector: string): HTMLElement[] =>
      [...document.querySelectorAll<HTMLElement>(selector)].filter(
        (element) => element.getClientRects().length > 0 && !element.hidden,
      );
    return {
      groups: shown('[data-editor-group]').map((group, index) =>
        box(
          `group ${String(index + 1)}`,
          group,
          group.parentElement?.closest<HTMLElement>('[data-group-split]')?.dataset['groupSplit'],
        ),
      ),
      splits: shown('[data-group-split]').map((split) =>
        box(`split ${split.dataset['groupSplit'] ?? '?'}`, split),
      ),
      lines: shown('.group-splitter').map((line, index) => box(`line ${String(index + 1)}`, line)),
      docks: shown('[data-dock]').map((dock) => box(`dock ${dock.dataset['dock'] ?? '?'}`, dock)),
      width: window.innerWidth,
      height: window.innerHeight,
    };
  });

const inside = (inner: Box, outer: Box): boolean =>
  inner.left >= outer.left - TOLERANCE &&
  inner.top >= outer.top - TOLERANCE &&
  inner.right <= outer.right + TOLERANCE &&
  inner.bottom <= outer.bottom + TOLERANCE;

/**
 * What is wrong with the groups' room, one sentence per fault; empty when no two groups cover
 * each other by more than half a pixel, no two docks do, each group sits inside its split and is
 * at least its minimum, and every dock ends inside the window (TYTO-299). With `fits`, every
 * group is inside the centre dock too: a window too small for the groups clips the last ones at
 * the dock's edge instead (ADR 0093), so that one is asked only of a window they fit in.
 */
function crowding(
  scene: Geometry,
  minimum: { readonly width: number; readonly height: number },
  fits: boolean,
): string[] {
  const faults: string[] = [];
  const pairs = (list: readonly Box[]): [Box, Box][] =>
    list.flatMap((one, index) => list.slice(index + 1).map((two): [Box, Box] => [one, two]));
  for (const [one, two] of [...pairs(scene.groups), ...pairs(scene.docks)]) {
    const across = Math.min(one.right, two.right) - Math.max(one.left, two.left);
    const down = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
    if (across > TOLERANCE && down > TOLERANCE) {
      faults.push(`${one.name} and ${two.name} overlap by ${across.toFixed(1)}x${down.toFixed(1)}`);
    }
  }
  const centre = scene.docks.find((dock) => dock.name === 'dock centre');
  for (const group of scene.groups) {
    const width = group.right - group.left;
    const height = group.bottom - group.top;
    if (width < minimum.width - TOLERANCE) faults.push(`${group.name} is ${String(width)}px wide`);
    if (height < minimum.height - TOLERANCE) {
      faults.push(`${group.name} is ${String(height)}px tall`);
    }
    const split = scene.splits.find((each) => each.name === `split ${group.split ?? ''}`);
    if (split !== undefined && !inside(group, split)) {
      faults.push(`${group.name} spills out of ${split.name}`);
    }
    if (fits && centre !== undefined && !inside(group, centre)) {
      faults.push(`${group.name} spills out of the centre dock`);
    }
    // Clipped only at the far edges: a group above or left of the centre dock means the clipping
    // box was scrolled — to bring a focused pane into view — and the first tab strip went missing.
    if (
      centre !== undefined &&
      (group.left < centre.left - TOLERANCE || group.top < centre.top - TOLERANCE)
    ) {
      faults.push(
        `${group.name} starts at ${String(group.left)}x${String(group.top)}, before the centre dock`,
      );
    }
  }
  for (const dock of scene.docks) {
    if (dock.right > scene.width + TOLERANCE || dock.bottom > scene.height + TOLERANCE) {
      faults.push(
        `${dock.name} ends at ${String(dock.right)}x${String(dock.bottom)}, past the window`,
      );
    }
  }
  return faults;
}

const groupMinimum = async (): Promise<{ width: number; height: number }> => ({
  width: await tokenPixels('--tyto-group-min-width'),
  height: await tokenPixels('--tyto-group-min-height'),
});

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
    // No line under any strip (Rafael, 2026-10-14): every visible one, groups, the preview's and
    // the docked panels', reads a zero-width bottom border.
    expect(await linedStrips()).toEqual([]);
    // A document is a tab, a tool has a header (TYTO-302, ADR 0090): every docked panel's strip
    // is a tool header with its title in small capitals and no tab in it; no group's strip is.
    expect(await toolHeaders()).toEqual({
      panels: [`${PANEL_ID}: tool UPPERCASE`, 'problems: tool UPPERCASE', 'queue: tool UPPERCASE'],
      groups: 0,
    });
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

/*
 * TYTO-299, ADR 0093: at 900x600 with both side docks open, a split held narrower than its groups
 * let the next group be painted over them (80.4 px at origin/main 1cc9e8e). The docks now give
 * way first, down to their own minimum, and only past that are the groups clipped at the centre
 * dock's edge — never drawn over one another, and never pushing a dock out of the window.
 */
describe('a window too narrow for every pane', () => {
  it('lets the side docks give way so no group is drawn over another at 900x600', async () => {
    await resize(900, 600);
    const scene = await geometry();
    process.stdout.write(`[TYTO-299] fit: ${JSON.stringify(scene)}\n`);
    // Before the verdict, so a red run leaves the picture of what it measured.
    await shoot('narrow-fit-900x600');
    expect(scene.groups).toHaveLength(3);
    expect(crowding(scene, await groupMinimum(), true)).toEqual([]);
    // The panes still meet in one line across the window (TYTO-288's helper).
    expect(misalignments((await measure()).panes)).toEqual([]);
  });

  it('fails the helper when a split may shrink below its groups (the negative control)', async () => {
    // Every floor off: the split's own, and the centre dock's with the docks' give, which is what
    // makes room for it. Any one alone is covered by the others; together they are origin/main.
    const style = await page.addStyleTag({
      content:
        '.editor-split, .dock--centre { min-width: 0 !important; } .dock--left, .dock--right { flex-shrink: 0 !important; }',
    });
    try {
      const faults = crowding(await geometry(), await groupMinimum(), true);
      process.stdout.write(`[TYTO-299] negative control: ${JSON.stringify(faults)}\n`);
      expect(faults.join('\n')).toMatch(/overlap by/);
    } finally {
      await style.evaluate((node) => {
        node.parentNode?.removeChild(node);
      });
    }
    expect(crowding(await geometry(), await groupMinimum(), true)).toEqual([]);
  });

  it('clips the groups at the centre dock when the docks at their minimum still leave too little', async () => {
    const centreOf = (scene: Geometry): Box | undefined =>
      scene.docks.find((dock) => dock.name === 'dock centre');
    // A focused pane asks to be scrolled into view — CodeMirror does it for its caret — and a
    // clipping box that can scroll obeys, sliding the first groups out at the top or left. It
    // happened on the first run of this case (group 1 at y 17.8 under a dock top at 33), only
    // some of the time, so it is asked for here every time.
    const bringLastIntoView = (): Promise<void> =>
      page.evaluate(() => {
        const groups = [...document.querySelectorAll('[data-editor-group]')];
        const far = (group: Element): number => {
          const box = group.getBoundingClientRect();
          return box.right + box.bottom;
        };
        groups
          .sort((one, two) => far(two) - far(one))[0]
          ?.scrollIntoView({ block: 'end', inline: 'end' });
      });
    // Split down five times: six groups stacked on the left, more than 600 px can hold.
    await page.locator('[data-editor-group] .cm-content').first().click();
    for (let split = 0; split < 5; split += 1) {
      await page.keyboard.press('Control+Shift+Backslash');
      await page.waitForTimeout(300);
    }
    await bringLastIntoView();
    let scene = await geometry();
    process.stdout.write(`[TYTO-299] down: ${JSON.stringify(scene)}\n`);
    await shoot('narrow-overflow-down-900x600');
    expect(scene.groups.length).toBeGreaterThanOrEqual(8);
    expect(crowding(scene, await groupMinimum(), false)).toEqual([]);
    expect(Math.max(...scene.groups.map((group) => group.bottom))).toBeGreaterThan(
      (centreOf(scene)?.bottom ?? 0) + TOLERANCE,
    );

    // Then split right until the row cannot fit beside the docks at their minimum.
    await page.locator('[data-editor-group] .cm-content').first().click();
    for (let split = 0; split < 3; split += 1) {
      await page.keyboard.press('Control+Backslash');
      await page.waitForTimeout(300);
    }
    await bringLastIntoView();
    scene = await geometry();
    process.stdout.write(`[TYTO-299] right: ${JSON.stringify(scene)}\n`);
    await shoot('narrow-overflow-right-900x600');
    expect(crowding(scene, await groupMinimum(), false)).toEqual([]);
    expect(Math.max(...scene.groups.map((group) => group.right))).toBeGreaterThan(
      (centreOf(scene)?.right ?? 0) + TOLERANCE,
    );
    // The right dock stays whole on screen, at least its own minimum wide.
    const right = scene.docks.find((dock) => dock.name === 'dock right');
    expect(right?.right ?? Infinity).toBeLessThanOrEqual(scene.width + TOLERANCE);
    expect((right?.right ?? 0) - (right?.left ?? 0)).toBeGreaterThanOrEqual(
      (await tokenPixels('--tyto-dock-min-width')) - TOLERANCE,
    );
    await resize(defaultSize.width, defaultSize.height);
  });
});
