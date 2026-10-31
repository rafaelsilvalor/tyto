import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILT_IN_TEMPLATE_NAMES } from '@tyto/templates';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { openPreviewBeside } from './preview-pane.js';

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
  // The preview's strings are counted with the rest, and since TYTO-287 it is a tab a person
  // opens (ADR 0084): open, the window paints every string the catalogue has on screen.
  await openPreviewBeside(page);
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

/**
 * The page sees the scheme the system's buttons are painted from (TYTO-284).
 *
 * Playwright emulates `prefers-color-scheme: light` unless `firstWindow` drops it, and main never
 * sees an emulated scheme: on a dark Windows the page went light while the title bar's system
 * buttons stayed dark. This suite sets no theme, so both sides answer from the system.
 *
 * **Only a dark machine can redden it.** Where the system is light — CI's Linux under xvfb, as
 * far as anybody has looked — the emulated light and the real light agree, and this passes with
 * or without the call. The proof is the local red with the call removed, in the pull request.
 */
describe('the colour scheme', () => {
  it("is the one main paints the window's buttons from", async () => {
    const pageIsDark = await page.evaluate(
      () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    );
    const mainIsDark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);

    expect({ pageIsDark }).toEqual({ pageIsDark: mainIsDark });
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
      // TYTO-495, ADR 0159: a tyto command run in main. Driven by `e2e/cli-runner.desktop.test.ts`.
      'cli:cancel',
      'cli:commands',
      'cli:open-diagnostic',
      'cli:run',
      'credentials:delete',
      // No `credentials:get` since TYTO-187: nothing in the renderer may read a secret back.
      'credentials:set',
      // TYTO-490, ADR 0157 §6: a delivery's export and whether a tab has one. Exercised by
      // `e2e/export-delivery.desktop.test.ts`.
      'delivery:export',
      // TYTO-489, ADR 0157: Delivery: New…, a name and a text, never a path. Exercised by
      // `e2e/workspace.desktop.test.ts`.
      'delivery:new',
      'delivery:of',
      'dialog:confirm',
      'dialog:save-changes',
      // TYTO-333: "Editor: turn vim mode on or off", which writes the `vimMode` setting.
      // Exercised by `e2e/vim-setting.desktop.test.ts`.
      'editor:vim-mode',
      // TYTO-279, ADR 0115: the explorer, by ids main minted.
      // TYTO-352, ADR 0121: new, rename and delete by id and name, and the tabs under an entry.
      'explorer:create',
      'explorer:delete',
      // TYTO-366, ADR 0124: an image for the preview, by id. Exercised by
      // `e2e/explorer-image.desktop.test.ts`.
      'explorer:image',
      'explorer:list',
      'explorer:open',
      'explorer:rename',
      'explorer:tabs-under',
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
      // TYTO-504: the gallery. Exercised by `e2e/gallery.desktop.test.ts`.
      'gallery:install',
      'gallery:list',
      'gallery:update',
      // TYTO-318: Help > Documentation. Opens the system browser, which no suite should do;
      // `src/main/ipc.test.ts` and `src/main/documentation.test.ts` hold what it does.
      'help:open-documentation',
      // TYTO-207: the keybindings tab and the file's text. Exercised by
      // `e2e/keybindings-file.desktop.test.ts`.
      'keybindings:open',
      'keybindings:read',
      'layout:get',
      'layout:set',
      'log:reveal',
      'log:write',
      // TYTO-352, ADR 0121: the explorer's native context menu, the window's labels. Used by
      // the card's second pull request.
      'menu:context',
      // TYTO-283: the File menu items greyed with an app file in front. Exercised by
      // `e2e/brief-commands.desktop.test.ts`.
      'menu:disabled',
      // TYTO-244: the drawn menu row's model and its native lists. Exercised by
      // `e2e/menu-row.desktop.test.ts`.
      'menu:model',
      'menu:popup',
      'on',
      // TYTO-49: a plugin panel's list and its bridge. Exercised by `e2e/panel-plugin.desktop.test.ts`.
      'panel:request',
      // TYTO-433: Plugins: Sync / Update Plugin Files. Exercised by
      // `e2e/plugin-files.desktop.test.ts`.
      'plugin-files:sync',
      // TYTO-207: the plugins' keymaps. Exercised by `e2e/keybindings.desktop.test.ts`.
      'plugins:keymaps',
      'plugins:list',
      'plugins:panels',
      // TYTO-418: the vim contributions, the built-in plugin's first. Applied by the window on
      // load; their keys are measured in `@tyto/editor`'s `vim-comment.test.ts`.
      'plugins:vim',
      // TYTO-45: the local queue panel's six, and TYTO-188's seventh. Each is exercised by
      // `e2e/queue.desktop.test.ts`.
      'queue:list',
      'queue:open-brief',
      'queue:reveal-output',
      'queue:run',
      'queue:set-auto-run',
      'queue:set-folder',
      'queue:set-kinds',
      // TYTO-377, ADR 0148: the recipe notebook's runner in main, which a `.recipe` tab runs
      // (`recipe-tab.desktop.test.ts`); `recipe-runner.test.ts` covers the logic.
      'recipe:run',
      'recipe:verbs',
      // TYTO-113: the tabs kept for the next launch. Exercised by `e2e/session.desktop.test.ts`.
      'session:read',
      'session:write',
      // TYTO-206: the settings tab. Exercised by `e2e/settings.desktop.test.ts`.
      'settings:open',
      // TYTO-304: what the settings tab suggests and explains. Exercised by
      // `e2e/settings-assist.desktop.test.ts`.
      'settings:outline',
      'settings:validate',
      // TYTO-277: the snippets tab and the file's text. Exercised by
      // `e2e/snippets-file.desktop.test.ts`.
      'snippets:open',
      'snippets:read',
      'template:new',
      'template:open',
      'template:preview',
      'template:save',
      'templates:folder',
      'templates:list',
      'templates:set-folder',
      // TYTO-497, ADR 0164: the terminals main owns. Driven by `e2e/terminal.desktop.test.ts`.
      'terminal:input',
      'terminal:kill',
      'terminal:list',
      'terminal:open',
      'terminal:resize',
      // TYTO-208: the colours the window applies, and the theme picker's three. Exercised by
      // `e2e/theme.desktop.test.ts` and `e2e/theme-pick.desktop.test.ts`.
      'theme:choose',
      'theme:current',
      'theme:list',
      'theme:preview',
      // TYTO-131, ADR 0069: the update notice. Exercised by `e2e/update.package.test.ts`.
      'update:act',
      'update:status',
      // TYTO-272: View > Zoom and its keys, which write the `zoom` setting. Exercised by
      // `e2e/typography.desktop.test.ts`.
      'window:zoom',
      // TYTO-278, ADR 0113: the workspace folder, opened only by main's picker. Exercised by
      // `e2e/workspace.desktop.test.ts`.
      'workspace:folder',
      // TYTO-487: the title bar's recent folders, chosen by main's id. Exercised by
      // `e2e/workspace.desktop.test.ts`.
      'workspace:open-recent',
      'workspace:recent',
      'workspace:set-folder',
      // TYTO-278: the banner's and Manage Trust's one channel, on main's open folder only.
      'workspace:trust',
    ]);
  });
});

/**
 * Switches the window to `locale` the only way left since the footer's picker went: the
 * command bar's `shell.toggleLocale` (TYTO-248, ADR 0076).
 */
const setLocale = async (locale: 'en' | 'pt-BR'): Promise<void> => {
  if ((await page.evaluate(() => document.documentElement.lang)) === locale) return;
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type('shell.toggleLocale');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForFunction((wanted) => document.documentElement.lang === wanted, locale);
};

/** *Switching locale changes every visible string.* */
describe('switching the language', () => {
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
   * hear, so their words go on `title` and `aria-label` (E9.2).
   *
   * **The list grows with every component, and that is what ADR 0024 decided.** A component
   * translates inside its own `render`, so its strings never reach the `[data-i18n]` pass
   * this counts. The pass is not going away — three painters still use it — but the
   * invariant it once carried on its own, "every string in the catalogue is on screen", is
   * now shared between it and the elements, and this list is the seam.
   */
  const NOT_ELEMENT_TEXT: readonly CatalogueKey[] = [
    // TYTO-244: the header that painted the app's name went, and the name now reaches the
    // screen inside the drawn title bar's text, which `shell.ts` builds with the file's name
    // (`titleBarText`). It reads the same in both languages, so it never counted as changed.
    'app.name',
    'preview.zoom.out',
    'preview.zoom.in',
    // TYTO-323: the strip toggle is a glyph, so its words — which change with the state — are its
    // `title` and `aria-label`; the strip names itself with `aria-label`. `preview.test.ts`
    // paints all three.
    'preview.strip.hide',
    'preview.strip.show',
    'preview.strip.label',
    // TYTO-366: an image preview's bar line and the stage's three reasons are written by
    // `paintImage` with the size filled in; `preview.test.ts` paints all four.
    'preview.image.scalable',
    'preview.image.tooLarge',
    'preview.image.unsupported',
    'preview.image.gone',
    // E9.3: the problems panel and the template picker build their own rows, so their
    // strings reach the screen through `panel.ts` rather than through the `data-i18n` pass
    // this counts. They are a locale's strings all the same — `panel.test.ts` is what holds
    // them to it.
    'problems.empty',
    'problems.empty.settings',
    'problems.empty.keybindings',
    'problems.empty.snippets',
    'problems.severity.error',
    'problems.severity.warning',
    'problems.severity.info',
    'problems.location',
    'problems.nowhere',
    // TYTO-288: the template picker left the window, and "Template" is the status bar's template
    // item's tooltip, which the bar writes itself (`status-bar.test.ts`).
    'template.label',
    // TYTO-122: three of the five are the picker's and the bar's, and the fourth is minted as
    // a diagnostic rather than painted. The fifth, `templates.folder.label`, was the footer's
    // and is listed below with Help > About since TYTO-248.
    'templates.folder.none',
    'templates.folder.empty',
    'command.templates.chooseFolder',
    'command.templates.clearFolder',
    // TYTO-278: the workspace folder's commands, File menu and command bar only.
    'command.workspace.openFolder',
    'command.workspace.closeFolder',
    // TYTO-487: the recent folders' command, and the popover's words, closed at load. The
    // title bar's "No folder" is on screen, written by `paintTitle` beside the title rather
    // than by the `[data-i18n]` pass; `shell.test.ts` holds it in both languages.
    'command.workspace.openRecent',
    'titleBar.noFolder',
    ...CATALOGUE_KEYS.filter((key) => key.startsWith('recentFolders.')),
    // TYTO-278: the trust banner and the Manage Trust dialog, painted from main's answer.
    'command.workspace.manageTrust',
    // TYTO-433: the plugin files' commands, command bar only, and the native box main shows
    // for a fetched plugin that asks for permissions, which no plugin file names here.
    'command.pluginFiles.sync',
    'command.pluginFiles.update',
    'pluginFiles.approve.message',
    'pluginFiles.approve.load',
    'pluginFiles.approve.skip',
    // TYTO-495: the native box a `tyto` command run in the window asks through (ADR 0159).
    'cli.confirm.yes',
    'cli.confirm.no',
    // TYTO-497, ADR 0164 §6: the box main shows before quitting over a running program.
    'terminal.quit.message',
    'terminal.quit.quit',
    'terminal.quit.stay',
    'workspace.banner.text',
    'workspace.banner.trust',
    'workspace.banner.problems',
    'workspace.trust.heading',
    'workspace.trust.none',
    'workspace.trust.trusted',
    'workspace.trust.restricted',
    'workspace.trust.revoked',
    'workspace.trust.grant',
    'workspace.trust.revoke',
    'workspace.trust.close',
    'workspace.banner.profile',
    'workspace.banner.trustProfile',
    'workspace.trust.profile',
    'workspace.trust.profileByLocation',
    'workspace.trust.profileTrusted',
    'workspace.trust.profileRestricted',
    'workspace.trust.profileRevoked',
    'workspace.trust.revokeProfile',
    // E9.12: the command bar renders its own strings and renders nothing at all while it is
    // closed, which is most of the time — so none of these is in the document on load, and
    // the two that are only reachable *inside* the bar never will be by this route. The
    // element is what holds them to a locale (`src/renderer/command-bar.test.ts`), and
    // `commands.test.ts` is what holds every registered command to having a key here at all.
    'workspace.banner.project',
    'command.workspace.showProject',
    'panel.project',
    ...CATALOGUE_KEYS.filter((key) => key.startsWith('project.')),
    // TYTO-279: the explorer is closed until a folder is opened, so none of its words is on
    // screen at load; `explorer-panel.test.ts` holds them.
    'panel.explorer',
    ...CATALOGUE_KEYS.filter((key) => key.startsWith('explorer.')),
    // TYTO-496: the command panel is closed until Ctrl+` opens it, and it renders its own words;
    // `command-panel.test.ts` holds them.
    'panel.commands',
    // TYTO-496: a command's Problems section says how it ended, only once a command has run.
    'problems.command.exit',
    // TYTO-496: the command panel's two command-bar entries, the bar's text only.
    'command.commandPanel.run',
    'command.commandPanel.renderBrief',
    // ADR 0163: the bottom area's × and its strip's name, an attribute each, written by the
    // panel in front (`panels.ts`); `dock.test.ts` holds them.
    'panel.hideArea',
    'panel.tabs',
    ...CATALOGUE_KEYS.filter((key) => key.startsWith('commandPanel.')),
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
    // TYTO-270: the prefix of an export preset's command, built with the preset's name.
    'command.export.preset',
    'document.untitled',
    'document.unsaved',
    'file.missing',
    // TYTO-124: a save that did not write, minted as a diagnostic the way `file.missing` is
    // and in the document only after a save has failed. `src/renderer/save-failure.test.ts`
    // is what holds it to a locale.
    'file.saveFailed',
    // TYTO-113: a draft not put back over a file that changed, minted like `file.missing`
    // and in the document only after a restore found one. `e2e/session.desktop.test.ts`.
    'session.draftStale',
    // E9.10: the close button's word lives on `title` and `aria-label`, and the rest name
    // panels and commands inside the bar. The panel *headings* are still element text and
    // are still counted — what moved is who renders them, not whether they are painted.
    'panel.close',
    'command.layout.togglePanel',
    'command.layout.restore',
    'panel.editor',
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
    // TYTO-255: the settings tab's detail in the same message box.
    'document.discard.settingsDetail',
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
    // TYTO-264: the other four titles, menu chrome as `menu.file` is. The row draws them
    // without their `&`, so the catalogue's text is never an element's text as written.
    'menu.edit',
    'menu.view',
    'menu.window',
    'menu.help',
    // TYTO-334: the role items inside the native lists, which the window never draws.
    'menu.role.undo',
    'menu.role.redo',
    'menu.role.cut',
    'menu.role.copy',
    'menu.role.paste',
    'menu.role.pasteAndMatchStyle',
    'menu.role.delete',
    'menu.role.selectAll',
    'menu.role.exit',
    'menu.role.quit',
    'menu.role.toggleDevTools',
    'menu.role.togglefullscreen',
    'menu.role.minimize',
    'menu.role.zoom',
    'menu.role.front',
    'menu.role.services',
    'menu.role.hide',
    'menu.role.hideOthers',
    'menu.role.unhide',
    'command.document.new',
    'command.document.close',
    'command.document.next',
    'command.document.previous',
    'command.document.select',
    // TYTO-286: the editor groups' commands, set by script in the bar and the View menu.
    'command.group.splitRight',
    'command.group.splitDown',
    'command.group.focusNext',
    'command.group.focusPrevious',
    'command.group.moveTabToNext',
    'command.group.moveTabLeft',
    'command.group.moveTabRight',
    'command.group.close',
    // TYTO-287: the preview as a tab. Its commands are the bar's and the View menu's, and
    // "Open preview to the side" is also the title of the group's button, set by script; the
    // word a preview tab's name starts with is set by script in the strip and the status bar,
    // and the lock's title is drawn only on a locked preview's tab. `tabs.test.ts` and
    // `e2e/preview-tab.desktop.test.ts` read them on screen.
    'command.preview.openToSide',
    'command.preview.open',
    'command.preview.toggleLock',
    // TYTO-323: the preview's two modes, as commands, are the bar's like the lock; the mode
    // buttons themselves are `[data-i18n]` text and counted.
    'command.preview.showOneSlide',
    'command.preview.showAllSlides',
    'preview.heading',
    'preview.locked',
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
    // TYTO-504: the gallery is closed on load too, for the plugins screen's reason.
    // `src/renderer/gallery-dialog.test.ts` renders its states, and `e2e/gallery.desktop.test.ts`
    // opens the real screen.
    'command.gallery.show',
    ...CATALOGUE_KEYS.filter((key) => key.startsWith('gallery.')),
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
    // TYTO-304: the settings tab's hover labels, written into CodeMirror's tooltip by the
    // editor, never into the shell. `e2e/settings-assist.desktop.test.ts` hovers a key.
    'settings.assist.type',
    'settings.assist.default',
    'settings.assist.accepted',
    // The keybindings tab's hover (TYTO-304), likewise: `e2e/keybindings-assist.desktop.test.ts`.
    'keybindings.assist.defaultKey',
    'keybindings.assist.field.key',
    'keybindings.assist.field.command',
    'keybindings.assist.field.when',
    'keybindings.assist.removes',
    'keybindings.assist.removesWithKey',
    // TYTO-207: the same, for the keybindings file. `e2e/keybindings-file.desktop.test.ts`.
    'command.keybindings.open',
    // TYTO-277: the same, for the snippets file, and the heading over the snippets in the "/"
    // menu, which is CodeMirror's list. `e2e/snippets-file.desktop.test.ts` opens both.
    'command.snippets.open',
    'slash.section.snippets',
    // TYTO-113: View > Reload's label, in the bar and the menu only.
    'command.window.reload',
    // TYTO-272: View > Zoom's three, in the bar and the menu only, and the problems row for a
    // face the machine lacks, which the window builds. `e2e/typography.desktop.test.ts`.
    'command.window.zoomReset',
    'command.window.zoomIn',
    'command.window.zoomOut',
    'typography.familyMissing',
    // TYTO-318: Help > Documentation, in the bar and the menu only.
    'command.help.openDocumentation',
    // TYTO-208: the theme picker's command, placeholder and the two kinds beside each theme,
    // all inside the bar. `e2e/theme-pick.desktop.test.ts` opens it.
    'command.theme.pick',
    'theme.pick.placeholder',
    'theme.kind.light',
    'theme.kind.dark',
    // TYTO-300: beside a theme pack's original or adjusted twin, inside the same bar.
    // `e2e/theme-pack.desktop.test.ts` reads both.
    'theme.variant.original',
    'theme.variant.adjusted',
    // TYTO-275: "New brief from template…", the picker's placeholder and the built-in pack's
    // name beside each template, all inside the bar and the File menu.
    // `e2e/new-from-template.desktop.test.ts` opens it.
    'command.document.newFromTemplate',
    'template.pick.placeholder',
    'template.root.builtIn',
    // TYTO-467: where an alias came from, on hover in the bar and beside a "/" menu row.
    'template.alias.declared',
    // TYTO-276: the "/" menu's command, section heading and the line beside each template, all
    // inside CodeMirror's list or the bar. `e2e/slash-menu.desktop.test.ts` opens it.
    'command.editor.insertMenu',
    // TYTO-296: "Go to Block…", its placeholder and the frontmatter's row, all inside the bar.
    // `e2e/go-to-block.desktop.test.ts` opens it.
    'command.editor.goToBlock',
    'goToBlock.placeholder',
    'goToBlock.header',
    // TYTO-273: the frontmatter's word in a group's breadcrumb, which `main.ts` writes into the
    // header row itself — not the `data-i18n` pass — and only with the caret in a frontmatter.
    // `e2e/breadcrumb.desktop.test.ts` reads it in both languages.
    'breadcrumb.frontmatter',
    // TYTO-297: "Format Brief" in the bar, and the refusal the status bar shows for a few
    // seconds. `e2e/format-brief.desktop.test.ts` runs it.
    'command.editor.formatBrief',
    'formatBrief.refused',
    // TYTO-489: Delivery: New… in the bar, its two questions, and the refusals the status bar
    // shows for a few seconds. `src/renderer/delivery-new.test.ts` drives them, and
    // `e2e/workspace.desktop.test.ts` runs the command.
    'command.delivery.new',
    'delivery.name.placeholder',
    'delivery.template.placeholder',
    'delivery.template.none',
    'delivery.refused',
    'delivery.noFolder',
    // TYTO-490: Delivery: Export, the button's tooltips (a `title`, never element text) and the
    // refusal the status bar shows. `e2e/export-delivery.desktop.test.ts` runs them.
    'command.delivery.export',
    'delivery.export.notInDelivery',
    'delivery.export.refused',
    'slash.section.templates',
    'slash.template.new',
    'slash.template.set',
    'slash.template.current',
    'slash.template.switch',
    // TYTO-248: the status bar is an element and translates inside its own `render`; the
    // area toggles are also command labels. `src/renderer/status-bar.test.ts` renders every
    // one of them in both languages.
    'command.layout.toggleDock.left',
    'command.layout.toggleDock.right',
    'command.layout.toggleDock.bottom',
    'status.commandBar',
    'status.position',
    'status.selected',
    'status.kind.settings',
    'status.kind.keybindings',
    'status.kind.snippets',
    // TYTO-247: a text tab's kind and empty problems line, and the dialogs' filters, which main
    // builds (`openFilters` in `src/main/documents.ts`); `status-bar.test.ts`,
    // `problems-panel.test.ts` and `documents.test.ts` paint them.
    'status.kind.text',
    'status.kind.markdown',
    'problems.empty.text',
    'dialog.files.text',
    'dialog.files.supported',
    // TYTO-377: a recipe tab's kind, its empty problems line, its dialog filter, Run recipe, and
    // the line under each cell, drawn only with a recipe open; `recipe-notebook.test.ts`,
    // `status-bar.test.ts`, `problems-panel.test.ts` and `documents.test.ts` paint them, and
    // `recipe-tab.desktop.test.ts` reads the cell lines in the real window.
    'dialog.files.recipe',
    'status.kind.recipe',
    'problems.empty.recipe',
    'command.recipe.run',
    'recipe.cell.rows',
    'recipe.cell.rows.one',
    'recipe.cell.columns',
    'recipe.cell.columns.one',
    'recipe.cell.plan',
    'recipe.cell.failed',
    'recipe.cell.skipped',
    'recipe.cell.stale',
    'recipe.cell.held.source',
    'recipe.cell.held.restricted',
    // TYTO-377, the notebook's table: drawn only under a recipe's cells and in the command bar
    // with a recipe in front; `recipe-cell-view.test.ts` paints them in both languages, and
    // `recipe-notebook.desktop.test.ts` reads the table and its buttons in the real window.
    'command.recipe.runFromCell',
    'command.recipe.runFresh',
    'recipe.cell.ran',
    'recipe.cell.fetched',
    'recipe.cell.more',
    'recipe.cell.more.one',
    'recipe.cell.runFrom',
    'recipe.cell.fetchAgain',
    'recipe.cell.collapse',
    'recipe.cell.expand',
    'status.problems.new',
    // TYTO-248: what the footer used to say is Help > About now, a box main shows — menu
    // chrome, like `menu.revealLogs`. `src/main/menu.test.ts` holds the five to `aboutText`, and
    // `e2e/status-bar.desktop.test.ts` opens the real item.
    'menu.about',
    'shell.about.version',
    'shell.about.platform',
    'shell.about.templates',
    'templates.folder.label',
  ];

  it('paints every catalogue string on load, with none left blank', async () => {
    const strings = await visibleStrings();

    expect(strings).toHaveLength(CATALOGUE_KEYS.length - NOT_ELEMENT_TEXT.length);
    expect(strings.filter((text) => text.trim() === '')).toEqual([]);
  });

  it('gives the glyph buttons their words where a screen reader can reach them', () =>
    Promise.all(
      [
        ['tyto-preview-pane:not([hidden]) [data-preview-zoom="out"]', 'preview.zoom.out'],
        ['tyto-preview-pane:not([hidden]) [data-preview-zoom="in"]', 'preview.zoom.in'],
      ].map(async ([selector, key]) => {
        const label = await page.getAttribute(selector!, 'aria-label');
        expect(label, selector).toBe(translate('en', key as CatalogueKey));
      }),
    ));

  it('changes every string that differs between the two catalogues', async () => {
    await setLocale('pt-BR');
    const portuguese = await visibleStrings();

    await setLocale('en');
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
    await setLocale('en');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');

    await setLocale('pt-BR');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('pt-BR');
  });
});
