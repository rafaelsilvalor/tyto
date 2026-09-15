import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

  app = await _electron.launch({
    args: ['.'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => document.querySelector('#editor .cm-content') !== null);
});

afterAll(async () => {
  await app?.close();
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
