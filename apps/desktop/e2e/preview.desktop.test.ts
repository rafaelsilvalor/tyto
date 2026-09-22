import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * *Open an example brief → preview visible → edit the title → preview changes* — E9.2's
 * third acceptance criterion, through a real window.
 *
 * The other two are in `src/renderer/preview.test.ts`, deliberately: *switching a tab does
 * not re-render* and *a stale answer is discarded* are claims about something **not**
 * happening, and a real window can only ever show that it did not happen this time.
 *
 * What is left is what no unit can reach. The preview is an `<iframe srcdoc>` inside a
 * `sandbox=""` frame, which means a second document, a second origin and the page's own
 * Content-Security-Policy inherited into it — three things that exist only once Chromium is
 * really running. The round trip through main is real too: brief text out over IPC, compiled
 * against the pack the app ships, HTML back.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

const packDirectory = join(
  dirname(createRequire(import.meta.url).resolve('@tyto/templates/package.json')),
  'templates',
);

const EXAMPLE = join(packDirectory, 'promo-curso', 'examples', 'promo.brief');

/**
 * Its own user-data folder, like `dock.desktop.test.ts`.
 *
 * The suites share one `app.getPath('userData')` otherwise, and `layout.json` lives in it
 * (ADR 0009) — so a suite that closes a panel closes it for whichever suite Vitest runs
 * next. That is not hypothetical: the panel suite reads `.problems__row`, the preview suite
 * closes the problems panel on purpose, and Vitest's default sequencer orders files by
 * **size**. Growing one test file by thirty lines swapped the two and left four panel tests
 * measuring a panel that was not on screen, with nothing in either diff to point at.
 */
let scratch: string;
let app: ElectronApplication;
let page: Page;

/** The document the preview is showing, or `''` before it shows one. */
const shown = async (): Promise<string> =>
  page.evaluate(() => document.getElementById('preview-frame')?.getAttribute('srcdoc') ?? '');

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm build\` before \`pnpm --filter @tyto/desktop test:desktop\``,
    );
  }

  scratch = mkdtempSync(join(tmpdir(), 'tyto-preview-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => document.querySelector('#editor .cm-content') !== null);
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the main screen', () => {
  it('shows nothing until there is a brief, and says so', async () => {
    // The state the window opens in. A blank panel would be indistinguishable from a
    // preview that failed, which is the one thing an empty state is for.
    const empty = page.locator('#preview-empty');

    await expect.poll(() => empty.isVisible()).toBe(true);
    await expect.poll(() => page.locator('#preview-paper').isVisible()).toBe(false);
    expect(await empty.textContent()).not.toBe('');
  });

  it('previews an example brief, with its fonts and its text', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.insertText(readFileSync(EXAMPLE, 'utf8'));

    await expect.poll(() => shown(), { timeout: 10_000 }).not.toBe('');

    const html = await shown();
    // The brief's own words, so the document is this brief's and not a placeholder.
    expect(html).toContain('Direito');
    // Embedded faces. If the page's CSP refused `data:` fonts the document would still say
    // this and the frame would draw in a fallback — which is why the paint is checked below
    // rather than only the markup.
    expect(html).toContain('@font-face');
  });

  it('draws the frame inside the sandboxed document, not just the markup', async () => {
    // The iframe is `sandbox=""` — unique origin, no scripts — and a `srcdoc` document
    // inherits the page's Content-Security-Policy. Both are real only in a real window, and
    // both are things that fail silently: a refused font is a frame that renders in the
    // wrong typeface and says nothing about it.
    const frame = page.frameLocator('#preview-frame');

    // `document.fonts.check` and not a computed `font-family`, which was the first thing
    // this asked and measured nothing: the family is declared on the spans and reads back
    // whatever the CSS says, loaded or not — `.tyto-frame` itself answered
    // `"Times New Roman"` while the document underneath was perfectly correct. `check`
    // answers the question that matters, which is whether the face is *available to draw*.
    // If the CSP refused the `data:` font this is the assertion that goes red.
    const loaded = await frame
      .locator('.tyto-frame')
      .evaluate(() => document.fonts.check('700 96px "Source Sans 3"'));

    expect(loaded).toBe(true);

    // And that the frame has something in it, so a blank document cannot pass the above.
    const nodes = await frame.locator('.tyto-frame .tyto-node').count();
    expect(nodes).toBeGreaterThan(0);
  });

  it('offers one tab per format and a slide picker only when there are slides', async () => {
    const tabs = await page.locator('.preview__tab').allTextContents();

    expect(tabs.length).toBeGreaterThan(0);
    expect(await page.locator('.preview__tab--on').count()).toBe(1);
    // `promo-curso` is a single artwork, so the picker is furniture and stays hidden.
    expect(await page.locator('#slide').isVisible()).toBe(false);
  });

  it('changes the preview when the title changes', async () => {
    // The criterion as written: edit the title, watch the document that comes back carry the
    // new words — through the debounce, the bridge, a compile against the real pack, and
    // into a second document.
    //
    // The marker is one nonsense **word**, and all three of those properties were learned
    // the hard way rather than chosen:
    //
    // - *Nonsense*, because the first version polled for "OAB", which `promo.brief` already
    //   contains — the poll passed on the unchanged document and measured nothing.
    // - *One word*, because text is wrapped into lines in the IR (ADR 0019) and the exporter
    //   emits a `<span>` per line. "Matricula Zephyr 4242" set in 96px bold wraps, so the
    //   phrase never appears contiguously in the markup however correct the render is.
    // - And the edit replaces the title's text rather than adding a second `::titulo`, which
    //   is what it did at first: a duplicate directive is an *error*, so the preview
    //   correctly showed no frames and "changed" by disappearing. A different test.
    const marker = 'Zephyr4242';
    const before = await shown();
    expect(before).not.toContain(marker);

    const edited = readFileSync(EXAMPLE, 'utf8').replace(/^(::titulo\s*\n\s+).*$/mu, `$1${marker}`);
    expect(edited).toContain(marker);

    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(edited);

    await expect.poll(() => shown(), { timeout: 10_000 }).toContain(marker);

    expect(await shown()).not.toBe(before);
    expect(await page.locator('#preview-paper').isVisible()).toBe(true);
  });

  it('reports a broken brief without losing the window', async () => {
    // A half-typed brief is the normal state of this channel. The status line says how many
    // problems there are; the editor keeps working, which is the part that matters.
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('---\ntemplate: nao-existe\n---\n');

    await expect
      .poll(() => page.locator('#preview-status').textContent(), { timeout: 10_000 })
      .toMatch(/\d/u);

    expect(await page.locator('#editor .cm-content').isVisible()).toBe(true);
  });
});

/**
 * E9.13's four acceptance criteria, in the order it lists them.
 *
 * **This is the only place the mechanism is reachable.** `request` in `main.ts` is what
 * decides to keep the frames, and `main.ts` has no unit test — measured, not assumed:
 * replacing its `failed` condition with `false` leaves all 145 renderer unit tests green.
 * `preview.test.ts` proves the pane draws the marker when told to and `documents.test.ts`
 * proves `isStale` computes it; what neither can see is the round trip that connects them.
 */
describe('a brief that stops compiling', () => {
  const GOOD = readFileSync(EXAMPLE, 'utf8');

  const paper = () => page.locator('#preview-paper');
  const stale = () => page.locator('#preview-stale');

  const type = async (text: string): Promise<void> => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(text);
  };

  it('renders, unmarked, while the brief is good', async () => {
    await type(GOOD);

    // Polled on the **marker** and not on the paper, which is the first thing this feature
    // breaks about testing it: the pane above left a broken brief, so the paper is already
    // visible — showing the artwork that brief replaced. `stale` going false is the only
    // signal that the answer for *this* text has landed.
    await expect.poll(() => stale().isVisible(), { timeout: 10_000 }).toBe(false);
    expect(await paper().isVisible()).toBe(true);
  });

  it('keeps the artwork on screen when the text breaks fatally, and marks it', async () => {
    const before = await shown();
    expect(before).not.toBe('');

    // A stray character, which is what this card is about — not a brief rewritten into
    // something else. The character is a `[` in the frontmatter, and it has to be there
    // rather than in the body: since ADR 0025 a broken body line costs that directive and
    // the preview re-renders without it, so the marker would never appear. A frontmatter
    // that will not parse is fatal, and fatal is what this feature is now for.
    await type(GOOD.replace('template: promo-curso', 'template: [promo-curso'));

    await expect.poll(() => stale().isVisible(), { timeout: 10_000 }).toBe(true);

    // The artwork is the *same* artwork, not a re-render: this is the assertion that fails
    // if the frames were thrown away and something else filled the pane.
    expect(await paper().isVisible()).toBe(true);
    expect(await shown()).toBe(before);
    expect(await page.locator('#preview-empty').isVisible()).toBe(false);
  });

  it('shows the marker with the problems panel closed, which is where it has to work', async () => {
    // The panel is the first thing people close, and it is where the errors are listed. A
    // marker only that panel could show would be a marker for the case that does not need it.
    const close = page.locator('tyto-problems-panel .panel__close');
    if (await close.count()) await close.click();

    await expect.poll(() => page.locator('#problems-list').isVisible()).toBe(false);
    expect(await stale().isVisible()).toBe(true);
    expect(await paper().isVisible()).toBe(true);
  });

  it('clears the marker on the next good answer, with no extra keystroke', async () => {
    await type(GOOD);

    await expect.poll(() => stale().isVisible(), { timeout: 10_000 }).toBe(false);
    expect(await paper().isVisible()).toBe(true);
  });

  it('redraws rather than going stale when the break costs only one directive', async () => {
    // TYTO-107, through the same round trip: an unclosed `**` is an error the author has to
    // fix and it is not fatal, so what comes back is the artwork **as it now stands** — not
    // the one before the keystroke with a marker over it. The stale pane is the fatal case
    // and this is the other one, which is why they are asserted against each other.
    const before = await shown();
    expect(before).not.toBe('');
    expect(before).not.toContain('Zephyr4242');

    // The word is nonsense and the `**` is unclosed: one edit carrying both a change to
    // see and the error that used to hide it. A word rather than a phrase, because text is
    // wrapped into lines in the IR (ADR 0019) and a phrase never appears contiguously.
    await type(GOOD.replace('Turma de setembro', 'Turma de **Zephyr4242'));

    // Polled on the new word, which is what "it redrew" means here — a marker that never
    // appeared would prove nothing on its own, and an unclosed `**` leaves the recovered
    // text identical, so comparing documents would pass on a pane that never moved.
    await expect.poll(() => shown(), { timeout: 10_000 }).toContain('Zephyr4242');

    expect(await stale().isVisible()).toBe(false);
    expect(await paper().isVisible()).toBe(true);
    expect(await page.locator('#preview-empty').isVisible()).toBe(false);
    // And the problem is still reported, on the surface that lists them.
    expect(await page.locator('#preview-status').textContent()).toMatch(/\d/u);
  });
});

/**
 * A template whose body is **code**, previewed in the window (TYTO-167).
 *
 * Everything above this point previews `promo-curso`, which is markup. The desktop composes
 * `bundledTemplateSource` in `preview.ts` exactly as the CLI does, and until now nothing at
 * window level had ever asked it to serve a build function — so "the preview draws a code
 * template" was a claim resting on two composition roots being spelled the same way.
 *
 * `agenda-semana` is also the first built-in with more than one artwork, which is what makes
 * the slide picker appear: the assertion above says it stays hidden for a single-artwork
 * brief, and this is the other half of that pair.
 */
describe('a template whose body is code', () => {
  const AGENDA = join(packDirectory, 'agenda-semana', 'examples', 'agenda.brief');

  beforeAll(async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(readFileSync(AGENDA, 'utf8'));

    // Spelled out rather than `expect.poll`, which Vitest only allows inside a test. The
    // wait is still on the condition and never on a duration: the round trip goes through
    // a debounce, an IPC hop and a compile, and a fixed pause would be a flake with a
    // number on it.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !(await shown()).includes('Clínica')) {
      await page.waitForTimeout(200);
    }
  }, 60_000);

  it('draws the brief it was given, through the bundled build function', async () => {
    const html = await shown();

    // The brief's own words, and the handle the *template* supplies — the second is what
    // says a build function ran, since no directive in the brief writes it.
    expect(html).toContain('Clínica');
    expect(html).toContain('@estrategia.saude');
  });

  it('offers the slide picker, because the brief made more than one artwork', async () => {
    await expect.poll(() => page.locator('#slide').isVisible()).toBe(true);
  });

  it('paints the frame, and not only the markup of it', async () => {
    const frame = page.frameLocator('#preview-frame');

    expect(await frame.locator('.tyto-frame .tyto-node').count()).toBeGreaterThan(0);
    expect(
      await frame
        .locator('.tyto-frame')
        .evaluate(() => document.fonts.check('700 48px "Source Sans 3"')),
    ).toBe(true);
  });
});
