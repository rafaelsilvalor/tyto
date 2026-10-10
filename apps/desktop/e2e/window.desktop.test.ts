import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILT_IN_TEMPLATE_NAMES } from '@tyto/templates';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

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

/**
 * What `apps/desktop/package.json` declares, read rather than written down.
 *
 * This was the literal `'0.1.0'` until TYTO-135, and it was safe only while the number could
 * not move. Changesets v3 had stopped versioning private packages, so the field was set by
 * hand once (TYTO-40) and sat through eleven version PRs; TYTO-94 turned versioning back on
 * and the first release after it bumped the app to `0.2.0` and reddened `main` on a line that
 * was never about which number it is.
 */
const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
  version: string;
  devDependencies: Record<string, string>;
};

let app: ElectronApplication;
let scratch: string;
let page: Page;

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }

  // Its own data folders, never the machine's (TYTO-139): the real `layout.json` and an older
  // version folder beside the current one both used to reach this suite through them.
  scratch = mkdtempSync(join(tmpdir(), 'tyto-window-e2e-'));
  app = await _electron.launch({
    // The **folder**, not the built file. Electron resolves a directory through its
    // `package.json`, which is how a packaged app starts and what `electron-builder` will
    // do — and it is the only form under which `app.getVersion()` reads *this* app's
    // version. Handed a path to a `.js` it loads the file and reports Electron's own
    // version instead, which is what the window used to show.
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    // `TYTO_HEADLESS` keeps the window off the screen. It is the only thing this suite
    // changes about the app it is testing; every flag it asserts on is the shipped one.
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForFunction(
    ([attribute]) => document.querySelector(`[${attribute}]`)?.textContent !== '',
    [I18N_ATTRIBUTE],
  );
  // The first translated string is not the window (TYTO-175). The static elements are painted
  // before `applyLayout` has made a single panel, so a count taken then sees the shell's
  // strings and none of the panels': 7 of 15, measured on CI with the renderer slowed by 2.5 s.
  // The editor mounts after the layout, which makes it the wait TYTO-154 asks for.
  await page.waitForSelector('#editor .cm-content');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
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
      // until TYTO-40 added one — the window reported 44.3.0 as if it were Tyto's.
      version: manifest.version,
      platform: process.platform,
      locale: expect.stringMatching(/^(pt-BR|en)$/u) as unknown as string,
      // The composition root's pack, read off the plugin host and reported through the
      // bridge — which is the end-to-end form of "registers built-in plugins through the
      // PluginHost". An empty list here would mean the extension point wired nothing. The
      // expected list is the pack's own constant rather than a copy of it, so shipping a
      // template does not redden this file (TYTO-171); the comparison stays whole-list.
      templates: [...BUILT_IN_TEMPLATE_NAMES],
    });

    // **Reading the manifest keeps the comparison true and drops the claim**, so the claim is
    // asserted separately: a bridge answering with the Electron fallback would match
    // `manifest.version` the day somebody deletes the field, because both sides would then be
    // `undefined`. This is the shape of the bug TYTO-40 found, held directly.
    expect(manifest.version, 'apps/desktop declares no version').toMatch(/^\d+\.\d+\.\d+$/u);
    const electronMajor = /(\d+)\./.exec(manifest.devDependencies.electron ?? '')?.[1];
    expect(electronMajor, 'apps/desktop no longer declares an electron dependency').toBeDefined();
    expect(
      (info as { version: string }).version.startsWith(`${electronMajor!}.`),
      `the window reports ${(info as { version: string }).version}, which is Electron ${electronMajor!}'s major and not Tyto's`,
    ).toBe(false);
  });

  it('rejects an invalid payload, naming the channel and the field', async () => {
    const refusal = await page.evaluate(async () => {
      const bridge = (
        globalThis as never as {
          tyto: Record<string, (r: unknown) => Promise<unknown>>;
        }
      ).tyto;
      try {
        await bridge['credentials:set']?.({ plugin: 42, key: 'k', secret: '' });
        return 'accepted';
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(refusal).not.toBe('accepted');
    expect(refusal).toContain('credentials:set');
    expect(refusal).toContain('plugin');
  });

  it('exposes the channels the contract declares and no others', async () => {
    const channels = await page.evaluate(() =>
      Object.keys((globalThis as never as { tyto: object }).tyto).sort(),
    );

    // Written out rather than compared against `IPC_CHANNEL_NAMES`, which would pass by
    // construction and check nothing: the claim is that the preload built the bridge from
    // the table, and a list this test imports from the same table cannot show that.
    //
    // `on` sorts in among them and is the one member that is not a channel: it is the receive
    // direction (ADR 0029), built from `IPC_EVENTS` rather than from the channel table.
    expect(channels).toEqual([
      'app:exit-ack',
      'app:exit-answer',
      'app:exit-listening',
      'app:info',
      'app:locale',
      'brief:preview',
      'credentials:delete',
      // No `credentials:get` since TYTO-187: nothing in the renderer may read a secret back.
      'credentials:set',
      'dialog:confirm',
      'dialog:save-changes',
      'export:cancel',
      'export:choose-directory',
      // TYTO-48, ADR 0044: which kinds an export can produce, installed exporters' included.
      // Exercised by `e2e/installed-plugins.desktop.test.ts`.
      'export:kinds',
      'export:progress',
      'export:reveal',
      'export:start',
      'file:close',
      'file:open',
      'file:reopen',
      'file:save',
      'files:recent',
      // TYTO-207: the keybindings tab and the file's text. Exercised by
      // `e2e/keybindings-file.desktop.test.ts`.
      'keybindings:open',
      'keybindings:read',
      'layout:get',
      'layout:set',
      'log:reveal',
      'log:write',
      'on',
      // TYTO-49: a plugin panel's list and its bridge. Exercised by `e2e/panel-plugin.desktop.test.ts`.
      'panel:request',
      // TYTO-207: the plugins' keymaps. Exercised by `e2e/keybindings.desktop.test.ts`.
      'plugins:keymaps',
      'plugins:list',
      'plugins:panels',
      // TYTO-45: the local queue panel's six, and TYTO-188's seventh. Each is exercised by
      // `e2e/queue.desktop.test.ts`.
      'queue:list',
      'queue:open-brief',
      'queue:reveal-output',
      'queue:run',
      'queue:set-auto-run',
      'queue:set-folder',
      'queue:set-kinds',
      // TYTO-206: the settings tab. Exercised by `e2e/settings.desktop.test.ts`.
      'settings:open',
      'settings:validate',
      'template:new',
      'template:open',
      'template:preview',
      'template:save',
      'templates:folder',
      'templates:list',
      'templates:set-folder',
      // TYTO-131, ADR 0069: the update notice. Exercised by `e2e/update.package.test.ts`.
      'update:act',
      'update:status',
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
    // TYTO-122: three of the five are the picker's and the bar's, and the fourth is minted as
    // a diagnostic rather than painted. `templates.folder.label` is the one that *is* element
    // text and is deliberately not here — `src/renderer/shell.test.ts` pins what it says.
    'templates.folder.none',
    'templates.folder.empty',
    'command.templates.chooseFolder',
    'command.templates.clearFolder',
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
    // TYTO-124: a save that did not write, minted as a diagnostic the way `file.missing` is
    // and in the document only after a save has failed. `src/renderer/save-failure.test.ts`
    // is what holds it to a locale.
    'file.saveFailed',
    // E9.10: the close button's word lives on `title` and `aria-label`, and the rest name
    // panels and commands inside the bar. The panel *headings* are still element text and
    // are still counted — what moved is who renders them, not whether they are painted.
    'panel.close',
    'command.layout.togglePanel',
    'command.layout.restore',
    'panel.editor',
    'panel.preview',
    'panel.problems',
    // TYTO-45: a panel name, like the three above, read by the bar's toggle entry.
    'panel.queue',
    // E9.11: the tab strip is an element and translates inside its own `render`, so the word
    // on a tab's close button is never in this pass; the four `document.discard.*` are read
    // out by the OS in a message box, which is not the document at all; and the rest are
    // command labels the bar builds. `src/renderer/tabs.test.ts` is what holds the strip to
    // a locale.
    'document.close',
    'document.discard.message',
    'document.discard.detail',
    'document.discard.confirm',
    'document.discard.cancel',
    // TYTO-123, TYTO-153: the same for the whole window, read out by the OS on the way out —
    // six since the box gained a third button. A message box is not the document either, and
    // `{n}` in two of them is a placeholder the renderer substitutes —
    // `e2e/quit.desktop.test.ts` is what holds these to a locale and to the count.
    'exit.save.message',
    'exit.save.detail.one',
    'exit.save.detail.many',
    'exit.save.confirm',
    'exit.save.discard',
    'exit.save.cancel',
    // TYTO-132: the one string this app writes into the application menu. A menu is the
    // browser process's chrome, not the document, so it can never be in this pass —
    // `src/main/menu.test.ts` is what holds the item to carrying the catalogue's word.
    'menu.revealLogs',
    // TYTO-124: the File submenu's own title, and the label of the command it added. The
    // title is menu chrome for the reason above; the label is the command bar's, like every
    // other `command.*` here, and the bar is closed. `src/main/menu.test.ts` holds the item
    // to the key and `e2e/menu.desktop.test.ts` holds it to the running app.
    // TYTO-140: what a crash in main puts in a native error box. Not the document by the same
    // argument as the menu, and not reachable from a window that is working.
    'crash.title',
    'crash.detail',
    'crash.noLog',
    // TYTO-144: the crash box's second button; `e2e/crash.desktop.test.ts` holds it to the box.
    'crash.close',
    // TYTO-151: the first-run question about the previous version's settings, a native box
    // main shows before the window exists — and never to a folder named with `--user-data-dir`
    // or under `TYTO_HEADLESS`, and this suite has both.
    'import.message',
    'import.detail',
    'import.credentials',
    'import.confirm',
    'import.decline',
    // TYTO-131: the footer's update notice. Hidden until a newer version exists, which it never
    // does here — a suite never checks the real feed — and only one of the three at a time.
    // `src/renderer/update-notice.test.ts` holds them to a locale.
    'update.available',
    'update.downloading',
    'update.ready',
    'menu.file',
    'command.document.new',
    'command.document.close',
    'command.document.next',
    'command.document.previous',
    'command.document.select',
    // E8.5: the find-and-replace panel is `@codemirror/search`'s own DOM, reached through
    // `EditorState.phrases` rather than through this app's markup, and it is not in the
    // document at all until somebody presses `Ctrl+F`. So none of its seventeen strings can
    // ever be in this pass, and the six command labels are the bar's like the rest.
    //
    // **This is the largest single growth this list has had, and the seam it gives up is
    // covered twice.** `src/renderer/search-phrases.test.ts` holds every one of the
    // seventeen to having a catalogue entry that differs between the two languages, and
    // `packages/editor/src/search.test.ts` mounts the real panel and reads the words back
    // off it. Adding a key here without one of those is how a string goes quietly English.
    'search.find',
    'search.replace',
    'search.next',
    'search.previous',
    'search.all',
    'search.matchCase',
    'search.regexp',
    'search.byWord',
    'search.replaceOne',
    'search.replaceAll',
    'search.close',
    'search.gotoLine',
    'search.go',
    'search.currentMatch',
    'search.onLine',
    'search.replacedOnLine',
    'search.replacedCount',
    'command.editor.find',
    'command.editor.findNext',
    'command.editor.findPrevious',
    'command.editor.replaceNext',
    'command.editor.replaceAll',
    'command.editor.gotoLine',
    // E9.4: the export dialog renders its own strings and renders nothing at all while it
    // is closed — the command bar's case exactly, one card later. None of these is in the
    // document on load, and most of them are only reachable *inside* the dialog.
    //
    // **The seam is covered twice, the way the search panel's is.**
    // `src/renderer/export-dialog.test.ts` drives the element and reads its buttons back,
    // and `e2e/export.desktop.test.ts` opens the real dialog in the real window and
    // measures that it is on screen and big enough to use. A key added here without one of
    // those is how a string goes quietly English.
    'export.heading',
    'export.destination',
    'export.destination.choose',
    'export.destination.none',
    'export.fileTypes',
    'export.formats',
    'export.formats.all',
    'export.quality',
    'export.scale',
    'export.start',
    'export.cancel',
    'export.close',
    'export.openFolder',
    'export.progress',
    'export.done',
    'export.cancelled',
    'export.failed',
    'export.problems',
    // TYTO-127: shown only after an export that found leftovers. `export-dialog.test.ts` reads
    // it back and `e2e/leftovers.desktop.test.ts` measures the list on screen.
    'export.leftovers',
    'command.file.export',
    // TYTO-44: the template mode renders its own strings, the export dialog's way, and the two
    // commands that open it are the bar's and the menu's. `template-mode.test.ts` renders the
    // element; `i18n.test.ts` holds every key to both locales.
    'command.template.edit',
    'command.template.new',
    ...CATALOGUE_KEYS.filter((key) => key.startsWith('templateMode.')),
    // TYTO-47: the plugins screen is closed on load and renders nothing while closed — the
    // export dialog's case. Excluded because they are not on screen yet, not to loosen the
    // count: `src/renderer/plugins-dialog.test.ts` renders every one of them, and
    // `e2e/plugins.desktop.test.ts` opens the real screen and measures it is drawn.
    'command.plugins.show',
    ...CATALOGUE_KEYS.filter((key) => key.startsWith('plugins.')),
    // TYTO-45: the queue panel is closed in the default layout, and a closed panel's element is
    // never created — so none of its strings is in the document on load. Excluded because they
    // are not on screen yet, not to loosen the count: `src/renderer/queue-panel.test.ts`
    // renders every state, and `e2e/queue.desktop.test.ts` opens the real panel and measures
    // it is drawn inside the window.
    'command.queue.show',
    ...CATALOGUE_KEYS.filter((key) => key.startsWith('queue.')),
    // TYTO-206: a command's label, shown only in the bar and the menu, like the two above.
    // `e2e/settings.desktop.test.ts` runs it from the bar.
    'command.settings.open',
    // TYTO-207: the same, for the keybindings file. `e2e/keybindings-file.desktop.test.ts`.
    'command.keybindings.open',
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
