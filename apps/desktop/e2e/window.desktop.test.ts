import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CatalogueKey, CATALOGUE_KEYS, translate } from '../shared/i18n/index.js';
import { en } from '../shared/i18n/en.js';
import { ptBR } from '../shared/i18n/pt-BR.js';
import { I18N_ATTRIBUTE } from '../src/renderer/shell.js';

/**
 * The three acceptance criteria of E9.1, through a real window.
 *
 * Everything else about this app is tested without launching anything, on purpose — the
 * contract, the handlers, the catalogue and the repaint all run in `pnpm check`. What is
 * left here is the part no unit can reach: whether the flags in `webPreferences` actually
 * produced a renderer with no Node in it, and whether the preload actually put the bridge
 * on the page. Those are properties of Electron's process model, and only Electron can be
 * asked about them.
 *
 * **Not part of `pnpm check`**, the same arrangement `packages/raster` makes for its visual
 * suite: this downloads a ~246 MB binary on first use and opens a window. `pnpm
 * test:desktop` runs it, after `pnpm --filter @tyto/desktop build`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let app: ElectronApplication;
let page: Page;

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }

  app = await _electron.launch({
    // The **folder**, not the built file. Electron resolves a directory through its
    // `package.json`, which is how a packaged app starts and what `electron-builder` will
    // do — and it is the only form under which `app.getVersion()` reads *this* app's
    // version. Handed a path to a `.js` it loads the file and reports Electron's own
    // version instead, which is what the window used to show.
    args: ['.'],
    cwd: join(here, '..'),
    // `TYTO_HEADLESS` keeps the window off the screen. It is the only thing this suite
    // changes about the app it is testing; every flag it asserts on is the shipped one.
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForFunction(
    ([attribute]) => document.querySelector(`[${attribute}]`)?.textContent !== '',
    [I18N_ATTRIBUTE],
  );
});

afterAll(async () => {
  await app?.close();
});

/** *App opens an empty window; `window.require` is undefined in the renderer.* */
describe('the renderer is a browser, not a shell', () => {
  it('opens exactly one window', async () => {
    expect(app.windows()).toHaveLength(1);
  });

  it('has no require, no process and no module', async () => {
    // The acceptance criterion, as written. All three and not just `require`, because they
    // come back together and a test naming one would pass on a partial regression.
    const globals = await page.evaluate(() => ({
      require: typeof (globalThis as Record<string, unknown>)['require'],
      process: typeof (globalThis as Record<string, unknown>)['process'],
      module: typeof (globalThis as Record<string, unknown>)['module'],
    }));

    expect(globals).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined' });
  });

  /**
   * The flags themselves, read back out of the running window.
   *
   * This exists because the test above does **not** catch a regression on its own, which was
   * measured rather than assumed: flipping `nodeIntegration` back to `true` leaves `require`
   * undefined all the same, because `sandbox: true` removes it independently. The consequence
   * is guaranteed by either flag, so asserting only the consequence would let one of the two
   * be turned off silently and keep the suite green.
   *
   * So the configuration is asserted as well as its effect. `getLastWebPreferences` is what
   * the window actually got, not what `window.ts` passed — a typo in the key name would show
   * here as a missing flag rather than as a value nobody read.
   */
  it('runs under all three flags ADR 0001 names, as the window actually got them', async () => {
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      // `getLastWebPreferences` is real and is not in Electron 44's published types, so the
      // cast is the narrowest one that says why. It fails loudly if a future Electron drops
      // it — calling `undefined` rejects the evaluate and the test goes red — which is the
      // safe direction for an assertion about the app's security posture to be wrong in.
      const read = contents as unknown as {
        getLastWebPreferences?: () => Record<string, unknown>;
      };
      const got = read.getLastWebPreferences?.();
      return {
        contextIsolation: got?.['contextIsolation'],
        nodeIntegration: got?.['nodeIntegration'],
        sandbox: got?.['sandbox'],
      };
    });

    expect(preferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });

  it('sees the bridge as plain data, not as a window into the preload', async () => {
    // `contextIsolation: true`. The object is structured-cloned on the way across, so the
    // page holds a frozen plain object and nothing it could walk back to Electron through.
    // The freezing is `exposeInMainWorld`'s, not ours — measured, by removing an
    // `Object.freeze` from the preload and watching this stay green.
    const shape = await page.evaluate(() => {
      const bridge = (globalThis as Record<string, unknown>)['tyto'];
      return {
        present: bridge !== undefined,
        frozen: Object.isFrozen(bridge),
        prototypeIsObject: Object.getPrototypeOf(bridge) === Object.prototype,
      };
    });

    expect(shape).toEqual({ present: true, frozen: true, prototypeIsObject: true });
  });
});

/** *A round-trip IPC call with an invalid payload is rejected by the Zod contract.* */
describe('the bridge', () => {
  it('answers app:info with what main knows', async () => {
    const info = await page.evaluate(() =>
      (globalThis as never as { tyto: { 'app:info': (r: object) => Promise<unknown> } }).tyto[
        'app:info'
      ]({}),
    );

    expect(info).toMatchObject({
      // The app's own version and not Electron's. `app.getVersion()` falls back to the
      // Electron version when the package has no `version` field, which is what it did
      // until this card added one — the window reported 44.3.0 as if it were Tyto's.
      version: '0.1.0',
      platform: process.platform,
      locale: expect.stringMatching(/^(pt-BR|en)$/u) as unknown as string,
      // The composition root's pack, read off the plugin host and reported through the
      // bridge — which is the end-to-end form of "registers built-in plugins through the
      // PluginHost". An empty list here would mean the extension point wired nothing.
      templates: ['carrossel-lista', 'promo-curso'],
    });
  });

  it('rejects an invalid payload, naming the channel and the field', async () => {
    const refusal = await page.evaluate(async () => {
      const bridge = (
        globalThis as never as {
          tyto: Record<string, (r: unknown) => Promise<unknown>>;
        }
      ).tyto;
      try {
        await bridge['credentials:set']?.({ account: 42, secret: '' });
        return 'accepted';
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(refusal).not.toBe('accepted');
    expect(refusal).toContain('credentials:set');
    expect(refusal).toContain('account');
  });

  it('exposes the channels the contract declares and no others', async () => {
    const channels = await page.evaluate(() =>
      Object.keys((globalThis as never as { tyto: object }).tyto).sort(),
    );

    // Written out rather than compared against `IPC_CHANNEL_NAMES`, which would pass by
    // construction and check nothing: the claim is that the preload built the bridge from
    // the table, and a list this test imports from the same table cannot show that.
    expect(channels).toEqual([
      'app:info',
      'brief:preview',
      'credentials:delete',
      'credentials:get',
      'credentials:set',
      'file:open',
      'file:reopen',
      'file:save',
      'files:recent',
      'layout:get',
      'layout:set',
      'templates:list',
    ]);
  });
});

/** *Switching locale changes every visible string.* */
describe('the language picker', () => {
  const visibleStrings = (): Promise<readonly string[]> =>
    page.evaluate(
      ([attribute]) =>
        [...document.querySelectorAll(`[${attribute}]`)].map(
          (element) => element.textContent ?? '',
        ),
      [I18N_ATTRIBUTE],
    );

  /**
   * Keys that are deliberately *not* an element's text, pinned so the list cannot grow
   * quietly — the same shape as the identical-translation pin in `i18n.test.ts`.
   *
   * The two zoom buttons show a glyph, which is the right thing to see and nothing at all to
   * hear, so their words go on `title` and `aria-label` (E9.2). The two status keys are
   * alternatives: the line says either how many problems there are or that there are none,
   * so neither is on screen unconditionally and counting both would count a string that is
   * not there.
   *
   * **The list grows with every component, and that is what ADR 0024 decided.** A component
   * translates inside its own `render`, so its strings never reach the `[data-i18n]` pass
   * this counts. The pass is not going away — three painters still use it — but the
   * invariant it once carried on its own, "every string in the catalogue is on screen", is
   * now shared between it and the elements, and this list is the seam.
   */
  const NOT_ELEMENT_TEXT: readonly CatalogueKey[] = [
    'preview.zoom.out',
    'preview.zoom.in',
    'preview.problems',
    'preview.ok',
    // E9.3: the problems panel and the template picker build their own rows, so their
    // strings reach the screen through `panel.ts` rather than through the `data-i18n` pass
    // this counts. They are a locale's strings all the same — `panel.test.ts` is what holds
    // them to it.
    'problems.empty',
    'problems.severity.error',
    'problems.severity.warning',
    'problems.severity.info',
    'problems.location',
    'problems.nowhere',
    'template.none',
    // E9.12: the command bar renders its own strings and renders nothing at all while it is
    // closed, which is most of the time — so none of these is in the document on load, and
    // the two that are only reachable *inside* the bar never will be by this route. The
    // element is what holds them to a locale (`src/renderer/command-bar.test.ts`), and
    // `commands.test.ts` is what holds every registered command to having a key here at all.
    'command.bar.placeholder',
    'command.bar.empty',
    'command.undo',
    'command.redo',
    'command.preview.zoomIn',
    'command.preview.zoomOut',
    'command.preview.zoomFit',
    'command.preview.nextFormat',
    'command.preview.previousFormat',
    'command.preview.nextSlide',
    'command.preview.previousSlide',
    'command.shell.toggleLocale',
    'command.editor.toggleVim',
    // E9.8: four more command labels, plus the three strings the title bar and the
    // "this file moved" diagnostic are built from. None of them is an element's text —
    // `windowTitle` writes into `<title>`, and a diagnostic's message is the panel's.
    'command.file.open',
    'command.file.save',
    'command.file.saveAs',
    'command.file.recent',
    'document.untitled',
    'document.unsaved',
    'file.missing',
    // E9.10: the close button's word lives on `title` and `aria-label`, and the rest name
    // panels and commands inside the bar. The panel *headings* are still element text and
    // are still counted — what moved is who renders them, not whether they are painted.
    'panel.close',
    'command.layout.togglePanel',
    'command.layout.restore',
    'panel.editor',
    'panel.preview',
    'panel.problems',
  ];

  it('paints every catalogue string on load, with none left blank', async () => {
    const strings = await visibleStrings();

    expect(strings).toHaveLength(CATALOGUE_KEYS.length - NOT_ELEMENT_TEXT.length);
    expect(strings.filter((text) => text.trim() === '')).toEqual([]);
  });

  it('gives the glyph buttons their words where a screen reader can reach them', () =>
    Promise.all(
      [
        ['#zoom-out', 'preview.zoom.out'],
        ['#zoom-in', 'preview.zoom.in'],
      ].map(async ([selector, key]) => {
        const label = await page.getAttribute(selector!, 'aria-label');
        expect(label, selector).toBe(translate('en', key as CatalogueKey));
      }),
    ));

  it('changes every string that differs between the two catalogues', async () => {
    await page.selectOption('#locale', 'pt-BR');
    const portuguese = await visibleStrings();

    await page.selectOption('#locale', 'en');
    const english = await visibleStrings();

    const translated = CATALOGUE_KEYS.filter(
      (key) => ptBR[key] !== en[key] && !NOT_ELEMENT_TEXT.includes(key),
    ).length;
    const changed = portuguese.filter((text, index) => text !== english[index]).length;

    // Every key that has a translation and is somebody's text. `i18n.test.ts` pins the four
    // that deliberately read the same in both, and `NOT_ELEMENT_TEXT` above pins the four
    // that are not an element's text at all.
    expect(changed).toBe(translated);
    expect(english).toContain(translate('en', 'preview.empty'));
    expect(portuguese).toContain(translate('pt-BR', 'preview.empty'));
  });

  it('changes the document language with it', async () => {
    await page.selectOption('#locale', 'en');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');

    await page.selectOption('#locale', 'pt-BR');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('pt-BR');
  });
});
