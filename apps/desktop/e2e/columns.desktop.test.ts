import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { THEME_PACK_FILES, THEME_PACK_THEMES } from '@tyto/theme-pack';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The columns of a `|` line through the real window (TYTO-298, ADR 0097): each `|` that splits a
 * line is marked, a `|` inside bold is not, a `\` break restarts the count, and an inline body
 * gets columns too; each of the `briefColumns` looks paints the theme's colours, emphasis keeps
 * its own, and a save of `settings.json` changes the look with no restart. Read from the DOM, by
 * each mark's class, text and computed colour.
 *
 * With `TYTO_COLUMN_SHOTS` set to a folder, the suite leaves pictures of the four looks in Tyto
 * Light and Tyto Dark, and of the new `settings.json` where it lists them.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_COLUMN_SHOTS'];

const BRIEF = [
  '---',
  'template: agenda-semana',
  'formats: [grid]',
  '---',
  '::titulo AGENDA DA SEMANA | 15 a 19/09',
  '',
  '::lamina',
  '  FARMÁCIA',
  '    16/09 - 14:00 | Farmacologia Geral | Profª. Marcela Rocha',
  '    17/09 - 14:00 | **Ensaios | Farmacopeicos** | Profª. Selma Barroso',
  '  SERVIÇO SOCIAL',
  '    15/09 - 19:00 | Serviço Social \\ 18/09 - 19:00 | Ética profissional | Profª. Norma Castilhos',
  '    19/09 - 08:00 | Saúde Coletiva | Prof. Ricardo Lemos | extra',
  '',
  '::lamina',
  '  NUTRIÇÃO',
  '    23/08 - 19:00 | Boas Práticas | Profª. Alice Moreno',
].join('\n');

const LOOKS = ['off', 'separator', 'alternate', 'perColumn'] as const;

type Look = (typeof LOOKS)[number];

/** A theme's colours by token, from the file the app applies. */
const coloursOf = (id: string): Readonly<Record<string, string>> => {
  if (id === 'tyto-light' || id === 'tyto-dark') {
    const file = join(here, '..', 'src', 'main', 'themes', `${id}.json`);
    return (JSON.parse(readFileSync(file, 'utf8')) as { colors: Record<string, string> }).colors;
  }
  const theme = THEME_PACK_THEMES.find((candidate) => candidate.id === id);
  const file = theme === undefined ? undefined : THEME_PACK_FILES[theme.path];
  if (file === undefined) throw new Error(`no theme '${id}'`);
  return file.colors;
};

/** `#rrggbb` as `getComputedStyle` reports it. */
const computed = (hex: string): string => {
  const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
};

let app: ElectronApplication;
let page: Page;
let scratch: string;
let settingsFile: string;

/** Writes `settings.json` on disk, which main applies as any writer's save. */
async function apply(theme: string, look?: Look): Promise<void> {
  const columns = look === undefined ? '' : `,\n  "briefColumns": "${look}"`;
  writeFileSync(settingsFile, `{\n  "theme": "${theme}"${columns}\n}\n`, 'utf8');
  await page.waitForFunction(
    (expected) => getComputedStyle(document.body).backgroundColor === expected,
    computed(coloursOf(theme)['surface']!),
    { polling: 25, timeout: 15_000 },
  );
}

interface Mark {
  /** The class past `cm-brief-column-`: `separator`, `even` or `cycle-<n>`. */
  readonly kind: string;
  readonly text: string;
  readonly colour: string;
}

/** Every mark in the brief's pane, line by line, in document order. */
const marks = (): Promise<readonly (readonly Mark[])[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('#editor .cm-content > .cm-line')]
      .map((line) =>
        [...line.querySelectorAll<HTMLElement>('[class*="cm-brief-column-"]')].map((mark) => ({
          kind: (
            [...mark.classList].find((name) => name.startsWith('cm-brief-column-')) ?? ''
          ).replace('cm-brief-column-', ''),
          text: (mark.textContent ?? '').trim(),
          colour: getComputedStyle(mark).color,
        })),
      )
      .filter((line) => line.length > 0),
  );

/** The marks as `kind:text`, line by line — what each look is asserted against. */
const shape = async (): Promise<readonly string[]> =>
  (await marks()).map((line) => line.map((mark) => `${mark.kind}:${mark.text}`).join(' '));

/** The colour each kind of mark is painted, deduplicated. */
const paint = async (): Promise<Readonly<Record<string, readonly string[]>>> => {
  const result: Record<string, Set<string>> = {};
  for (const line of await marks()) {
    for (const mark of line) (result[mark.kind] ??= new Set()).add(mark.colour);
  }
  return Object.fromEntries(Object.entries(result).map(([kind, set]) => [kind, [...set]]));
};

/** The colour the bold `Ensaios | Farmacopeicos` is drawn in, and whether a column mark holds it. */
const bold = (): Promise<{ colour: string; marked: boolean }> =>
  page.evaluate(() => {
    // The innermost element holding the word: whatever the highlighter wrapped it in.
    const holding = [...document.querySelectorAll<HTMLElement>('#editor .cm-line *')].filter(
      (candidate) => (candidate.textContent ?? '').includes('Ensaios'),
    );
    const span = holding.find(
      (candidate) =>
        ![...candidate.children].some((child) => holding.includes(child as HTMLElement)),
    )!;
    return {
      colour: getComputedStyle(span).color,
      marked: span.closest('[class*="cm-brief-column-"]') !== null,
    };
  });

/** A picture of the brief's pane, when pictures were asked for. */
async function shoot(name: string): Promise<void> {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  const box = await page.evaluate(() => {
    const pane = document.querySelector('#editor .cm-editor')!.getBoundingClientRect();
    const lines = [...document.querySelectorAll('#editor .cm-content > .cm-line')];
    const last = lines[lines.length - 1]!.getBoundingClientRect();
    return {
      x: pane.x,
      y: pane.y,
      width: Math.min(pane.width, 980),
      height: Math.min(pane.height, last.bottom - pane.y + 12),
    };
  });
  await page.screenshot({ path: join(shots, `${name}.png`), clip: box });
}

const SEPARATORS_ONLY = [
  'separator:|',
  'separator:| separator:|',
  'separator:| separator:|',
  'separator:| separator:| separator:|',
  'separator:| separator:| separator:|',
  'separator:| separator:|',
];

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-columns-'));
  settingsFile = join(scratch, 'user-data', 'settings.json');
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(BRIEF);
  await page.waitForSelector('#editor .cm-brief-column-separator', { timeout: 15_000 });
  // The cursor on the frontmatter, so the active line's tint is off the table's lines.
  await page.locator('#editor .cm-content > .cm-line').nth(0).click();
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe("the columns of a brief's | lines", () => {
  it('marks every | that splits a line by default, in the function colour', async () => {
    await apply('tyto-light');
    // Not the `|` inside the bold on the second table line: that line has two, not three.
    await expect.poll(shape, { timeout: 15_000 }).toEqual(SEPARATORS_ONLY);
    expect(await paint()).toEqual({
      separator: [computed(coloursOf('tyto-light')['syntax-function']!)],
    });
  });

  it('mutes the even columns in alternate, restarting at the break, never inside bold', async () => {
    await apply('tyto-dark', 'alternate');
    await expect
      .poll(shape, { timeout: 15_000 })
      .toEqual([
        'separator:| even:15 a 19/09',
        'separator:| even:Farmacologia Geral separator:|',
        'separator:| separator:|',
        'separator:| even:Serviço Social separator:| even:Ética profissional separator:|',
        'separator:| even:Saúde Coletiva separator:| separator:| even:extra',
        'separator:| even:Boas Práticas separator:|',
      ]);
    const colours = coloursOf('tyto-dark');
    expect(await paint()).toEqual({
      separator: [computed(colours['syntax-function']!)],
      even: [computed(colours['text-muted']!)],
    });
    // The bold of column 2 is drawn as bold is anywhere, not in the muted colour.
    const drawn = await bold();
    expect(drawn.marked).toBe(false);
    expect(drawn.colour).not.toBe(computed(colours['text-muted']!));
  });

  it('cycles keyword, constant and warning in perColumn, bold keeping its own colour', async () => {
    await apply('dracula-adjusted', 'perColumn');
    await expect
      .poll(shape, { timeout: 15_000 })
      .toEqual([
        'cycle-1:AGENDA DA SEMANA separator:| cycle-2:15 a 19/09',
        'cycle-1:16/09 - 14:00 separator:| cycle-2:Farmacologia Geral separator:| cycle-3:Profª. Marcela Rocha',
        'cycle-1:17/09 - 14:00 separator:| separator:| cycle-3:Profª. Selma Barroso',
        'cycle-1:15/09 - 19:00 separator:| cycle-2:Serviço Social cycle-1:18/09 - 19:00 separator:| cycle-2:Ética profissional separator:| cycle-3:Profª. Norma Castilhos',
        'cycle-1:19/09 - 08:00 separator:| cycle-2:Saúde Coletiva separator:| cycle-3:Prof. Ricardo Lemos separator:| cycle-1:extra',
        'cycle-1:23/08 - 19:00 separator:| cycle-2:Boas Práticas separator:| cycle-3:Profª. Alice Moreno',
      ]);
    const colours = coloursOf('dracula-adjusted');
    expect(await paint()).toEqual({
      'cycle-1': [computed(colours['syntax-keyword']!)],
      separator: [computed(colours['syntax-function']!)],
      'cycle-2': [computed(colours['syntax-constant']!)],
      'cycle-3': [computed(colours['warning']!)],
    });
    expect((await bold()).marked).toBe(false);
  });

  it('takes every mark away when off, and brings the default back when the key goes', async () => {
    await apply('tyto-light', 'off');
    await expect.poll(shape, { timeout: 15_000 }).toEqual([]);
    await apply('tyto-light');
    await expect.poll(shape, { timeout: 15_000 }).toEqual(SEPARATORS_ONLY);
  });
});

/** Which look a pane's marks are: the kinds of mark each one puts down tell them apart. */
const lookShown = (lines: readonly string[]): Look => {
  const text = lines.join(' ');
  if (text === '') return 'off';
  if (text.includes('cycle-')) return 'perColumn';
  if (text.includes('even:')) return 'alternate';
  return 'separator';
};

/** Pictures only, and only when asked for: the four looks in Tyto Light and Tyto Dark. */
describe.runIf(shots !== undefined)('the pictures of the four looks', () => {
  for (const theme of ['tyto-light', 'tyto-dark']) {
    it(`leaves one per look in ${theme}`, async () => {
      for (const look of LOOKS) {
        await apply(theme, look);
        // The theme may already be the one shown, so wait for the look's own marks.
        await expect.poll(async () => lookShown(await shape()), { timeout: 15_000 }).toBe(look);
        await shoot(`${theme}--${look}`);
      }
    });
  }
});

describe("the new settings.json's example", () => {
  it('lists briefColumns with its four looks, commented out', async () => {
    rmSync(settingsFile, { force: true });
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('settings.open');
    await page.keyboard.press('Enter');
    // The file is written and then filled: wait for its last line, not for it to exist.
    await expect
      .poll(() => (existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : ''), {
        timeout: 15_000,
      })
      .toMatch(/\}\n$/u);
    const text = readFileSync(settingsFile, 'utf8');
    expect(text).toContain('// "briefColumns": "separator",');
    for (const look of LOOKS) expect(text).toContain(`//   "${look}": `);
    if (shots === undefined) return;
    // The example is at the end of the file: the wheel brings it into the pane.
    const pane = await page.locator('#editor .cm-scroller').boundingBox();
    await page.mouse.move(pane!.x + pane!.width / 2, pane!.y + pane!.height / 2);
    await expect
      .poll(
        async () => {
          await page.mouse.wheel(0, 400);
          return page.evaluate(() =>
            [...document.querySelectorAll('#editor .cm-line')].some((line) =>
              (line.textContent ?? '').includes('"briefColumns": "separator"'),
            ),
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.waitForTimeout(200);
    mkdirSync(shots, { recursive: true });
    const box = await page.locator('#editor .cm-editor').boundingBox();
    await page.screenshot({
      path: join(shots, 'settings-json-example.png'),
      clip: { x: box!.x, y: box!.y, width: Math.min(box!.width, 1200), height: box!.height },
    });
  });
});
