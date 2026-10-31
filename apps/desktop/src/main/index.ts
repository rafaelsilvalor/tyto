import { spawn, spawnSync } from 'node:child_process';
import { existsSync, realpathSync, watch } from 'node:fs';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';

import {
  type BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  safeStorage,
  protocol,
  shell,
} from 'electron';
import {
  PLUGINS_DIR,
  fsInbox,
  fsPluginStore,
  fsTrustStore,
  installedPacks,
  nodeFileSystem,
  syncPluginFiles as syncPluginFolders,
  withoutRefused,
} from '@tyto/io';
import { NO_PLUGINS, type ThemeKind, createPluginHost } from '@tyto/plugin-api';

import { type Locale, localeFor, translate } from '../../shared/i18n/index.js';
import {
  formatBriefOnSaveExample,
  googleFontsExample,
  indentGuidesExample,
  type Settings,
  stickyScrollExample,
  tabSizeExample,
  vimModeExample,
} from '../../shared/settings.js';
import {
  type ThemeInForce,
  statusBarColorsContrast,
  statusBarColorsExample,
} from '../../shared/status-bar-colors.js';
import { statusBarItemsExample } from '../../shared/status-bar-items.js';
import { DEFAULT_THEME_SETTING, type ThemeSetting, modeOf } from '../../shared/theme-setting.js';
import { vimModeStyleExample } from '../../shared/vim-mode-style.js';
import { briefColumnsExample } from '../../shared/brief-columns.js';
import { lineNumbersExample } from '../../shared/line-numbers.js';
import { commandRunsExample } from '../../shared/command-runs.js';
import { vimPluginsExample } from '../../shared/vim-plugins.js';
import {
  type Typography,
  type ZoomStep,
  ZOOM,
  steppedZoom,
  typographyExample,
} from '../../shared/typography.js';
import { confirmInABox, createCliRunner, registeredRasterizer } from './cli-runner.js';
import { SHELL_REFUSED, windowRefusals } from './cli-refusals.js';
import { fileCredentialStore } from './credential-store.js';
import { createCredentials } from './credentials.js';
import { openDocumentation } from './documentation.js';
import { createDocumentService, openFilters, saveFilters } from './documents.js';
import { createExportService } from './export.js';
import { desktopCapabilities, startDesktopPlugins } from './installed-plugins.js';
import { approveInABox, createDesktopPluginFiles } from './plugin-files.js';
import { createDesktopGallery } from './gallery.js';
import { fileLayoutStore } from './layout-store.js';
import { createSessionService, createTemplateFolder } from './session.js';
import { fileSessionStore } from './session-store.js';
import { crashSummary, fileLog, installCrashHandlers } from './log.js';
import { type AboutFacts, aboutText, menuTemplate } from './menu.js';
import { LeakedArrow, popupWithArrows } from './menu-arrows.js';
import { findTopLevel, projectMenu } from './menu-model.js';
import { newKeybindingsFile, newSnippetsFile } from './seed-files.js';
import { fileRecentFiles, fileRecentFolders } from './recent-files.js';
import { createRecentFoldersService, folderKeyFor } from './recent-folders.js';
import { registerIpcHandlers } from './ipc.js';
import { exporterBuiltIns, listPlugins, tytoHome } from './plugin-list.js';
import desktopManifest from './desktop.tyto-plugin.json';
import { activateBuiltIns, builtInTemplatesDirectory } from './plugins.js';
import { bundledNodeLauncher, bundledNodePaths } from './plugin-process.js';
import { offerPreviousVersion } from './previous-version.js';
import { createQueueService } from './queue.js';
import { createPanelService } from './panels.js';
import { PLUGIN_SCHEME, confinedPath, contentTypeOf, panelPolicy } from './plugin-protocol.js';
import {
  type AppliedThemes,
  BASE_COLORS,
  BUILT_IN_THEMES,
  type ThemeSource,
  builtInThemeSource,
  createThemeService,
  folderThemeReader,
} from './themes.js';
import { drawsTitleBar, frameOptions, overlayFor } from './title-bar.js';
import { type WindowPlugins, windowPlugins } from './window-plugins.js';
import { desktopSources } from './plugin-sources.js';
import { googleFontsOptionsFor, windowGoogleFonts } from './google-fonts.js';
import { createPreviewService } from './preview.js';
import { recipeClock } from './recipe-clock.js';
import { createRecipeRunner } from './recipe-runner.js';
import { createProjectSources } from './project.js';
import { createTemplateEditor } from './template-editor.js';
import { createWorkspaceService } from './workspace.js';
import { createDeliveryService } from './delivery.js';
import { createExplorerService } from './explorer.js';
import { createExitGuard, mayUnload } from './quit.js';
import { windowEvents } from './window-events.js';
import {
  type PseudoTerminal,
  type SpawnOptions,
  createTerminals,
  killTree,
  terminalQuitGuard,
} from './terminal.js';
import { chooseShell, terminalEnvironment } from './terminal-shell.js';
import { createLiveTextFile } from './live-text-file.js';
import { type LiveSettings, createLiveSettings } from './settings-live.js';
import { settingsOutline } from './settings-outline.js';
import { fileSettingsStore } from './settings-store.js';
import { createTemplateCatalogue } from './templates.js';
import { shouldCheck, updateFeedFrom, updateRoute } from './update-feed.js';
import { type InstallingUpdater, createUpdateService } from './updates.js';
import { chooseUserDataPath } from './user-data.js';
import { bundledRenderer, createMainWindow } from './window.js';

/**
 * The composition root (ADR 0010).
 *
 * Everything this app can do is wired here and nowhere else: which filesystem the template
 * registry reads through, where ciphertext is written, which plugins are activated, and
 * which channels the renderer may call. No module below this one names an adapter, which is
 * what keeps the same pure core running here, in the CLI, and later in a cloud worker.
 *
 * It is also the only file that knows the app is Electron at all in a way that matters:
 * `window.ts` takes flags, `ipc.ts` takes an `IpcMain`, `credentials.ts` takes a
 * `SafeStorage`. That is what lets `pnpm check` test the wiring without launching a
 * browser, and it leaves exactly one thing that needs a real launch to prove — the flags.
 */

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The dev server electron-vite starts, when it started one.
 *
 * Set by `electron-vite dev` and absent in a packaged app, which is the whole of how this
 * file tells the two apart. A built app reads `index.html` off its own folder.
 */
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

/** How long a burst of watcher events on `settings.json` has to go quiet (TYTO-206). */
const SETTINGS_SETTLE_MS = 100;

/**
 * How long after a context menu closes its pick is read (TYTO-352). An item's `click` may come
 * after the close on Windows; a person cannot open another menu in this time.
 */
const CONTEXT_MENU_CLICK_GRACE_MS = 50;

/**
 * `settings.json` as "Open Settings (JSON)" creates it when there is none (TYTO-206). It
 * carries `statusBarItems` commented out with every id, and `statusBarColors` with every key
 * and an example colour, and `vimModeStyle` with its three values (TYTO-301), so the bar's
 * options are in the file the person is looking at; and `vimMode` (TYTO-333), `vimPlugins` with
 * every plugin id (TYTO-418), `indentGuides`
 * (TYTO-293), `stickyScroll` (TYTO-295), `formatBriefOnSave` and `tabSize` (TYTO-297),
 * `briefColumns` with its four looks (TYTO-298), `lineNumbers` with its three (TYTO-415), and
 * `googleFonts` (TYTO-281).
 */
const NEW_SETTINGS_FILE =
  '// Tyto settings: JSON with comments. Saving this file applies it, with no restart.\n{\n' +
  `${statusBarItemsExample()}\n${statusBarColorsExample()}\n${vimModeExample()}\n` +
  `${vimPluginsExample()}\n${vimModeStyleExample()}\n` +
  `${indentGuidesExample()}\n${stickyScrollExample()}\n` +
  `${formatBriefOnSaveExample()}\n${tabSizeExample()}\n${briefColumnsExample()}\n` +
  `${lineNumbersExample()}\n${commandRunsExample()}\n` +
  `${typographyExample()}\n${googleFontsExample()}\n}\n`;

/**
 * Puts a crash on screen (TYTO-140).
 *
 * Module-level, and replaced inside {@link start} the moment the log exists, because the two
 * callers below cannot both be inside it. `installCrashHandlers` is inside; the `.catch` on
 * `whenReady().then(start)` is not — and that catch is the one that matters, because a throw
 * during startup is a *rejection*, which Electron's own box never covered: it runs with
 * `--unhandled-rejections` in `warn` mode, so that path was silent before TYTO-132 and after
 * it. A packaged app failing there opens no window at all, which is a double-click that did
 * nothing.
 *
 * This first version is the one used while there is no log yet — `fileLog` itself can fail on
 * a `userData` the machine will not let this app write to, and a crash reporter that needed
 * the log to exist would be silent in exactly that case. It says there is no file rather than
 * naming one that was never written.
 */
let reportCrash = (reason: unknown): void => {
  const locale = localeFor(app.getLocale());
  dialog.showErrorBox(
    translate(locale, 'crash.title'),
    `${crashSummary(reason)}\n\n${translate(locale, 'crash.noLog')}`,
  );
};

// **Where this app's data lives, moved before Electron has opened anything** (TYTO-150,
// ADR 0032). Every version gets its own folder under one product root, so a 0.4.0 a tester
// downloads cannot open with the layout, the recent files or the settings 0.3.0 left behind.
//
// **At module scope, and not at the top of `start`, and that is the measured part.** `start`
// runs on `whenReady`, and by then Chromium has already opened the folder it was handed.
// Measured with a probe app on win32: setting the path after `ready` leaves a `Local State`
// file behind in the old folder and creates it; setting it here leaves that folder uncreated.
// The app's own five paths — logs, settings, recent files, credentials, layout — are all
// composed inside `start` from `getPath('userData')`, so those follow either way. Chromium's
// do not, and the one that does not follow is the one nobody would go looking for.
//
// Wrapped, because a throw at module scope is a main script that failed to evaluate: no
// window, no box, a double-click that did nothing — which is the failure TYTO-140 exists to
// have taken away. Reporting and carrying on leaves the app in the shared folder, which is
// the old behaviour and still a running app. `reportCrash` works here: before `ready`,
// `app.getLocale()` answers with the empty string rather than throwing, and `localeFor` maps
// that to the default locale.
//
// Kept, because `start` needs to know whether this folder was *chosen* or *given*: only a
// chosen one has sibling versions to offer an import from (TYTO-151). A folder named with
// `--user-data-dir` is a suite's scratch folder, and a question on its first run would be a
// native box nobody is there to answer.
let chosenUserData: string | undefined;
try {
  const userData = chooseUserDataPath({
    appData: app.getPath('appData'),
    version: app.getVersion(),
    explicitUserDataDir: app.commandLine.hasSwitch('user-data-dir')
      ? app.commandLine.getSwitchValue('user-data-dir')
      : undefined,
  });
  if (userData !== undefined) {
    app.setPath('userData', userData);
    chosenUserData = userData;
  }
} catch (reason) {
  reportCrash(reason);
}

// Before ready, which is the only time Electron accepts it. `standard` so a panel's relative
// `<script src="panel.js">` resolves against its own folder, and `secure` so the page is not
// treated as mixed content. The page still has an opaque origin: the iframe's sandbox has no
// `allow-same-origin` (ADR 0045).
protocol.registerSchemesAsPrivileged([
  { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true } },
]);

/**
 * Serves `tyto-plugin://<plugin>/<path>` out of that plugin's folder, and nothing else.
 *
 * Only for a plugin that is active and contributes a panel, and only a file `confinedPath`
 * places inside its folder once links are resolved. Every page carries `panelPolicy`, which
 * gives it no network of its own.
 */
function servePluginPages(
  contributed: WindowPlugins,
  directoryOf: (plugin: string) => string,
): void {
  const missing = (): Response => new Response('Not found', { status: 404 });
  protocol.handle(PLUGIN_SCHEME, async (request) => {
    const url = new URL(request.url);
    const plugin = url.hostname;
    if (!contributed.panels().some((offered) => offered.plugin === plugin)) return missing();
    const file = await confinedPath(directoryOf(plugin), url.pathname);
    if (file === undefined) return missing();
    return new Response(await readFile(file), {
      headers: {
        'content-type': contentTypeOf(file),
        'content-security-policy': panelPolicy(plugin),
        'x-content-type-options': 'nosniff',
      },
    });
  });
}

async function start(): Promise<void> {
  // **First, before anything that can fail.** A registry that will not read and a built-in
  // that will not activate both happen here, before a window exists to say so in — so a log
  // built after them is a log that cannot explain the one failure a person sees as "it did
  // not start". `src/main/log.ts` says why it goes in its own folder and why it writes
  // synchronously (TYTO-132).
  const log = fileLog({
    directory: join(app.getPath('userData'), 'logs'),
    version: app.getVersion(),
    platform: process.platform,
  });

  // **One line, so the folder exists before anything has gone wrong** (TYTO-149). `fileLog`
  // creates its folder on the first write and not before, which is right — an app whose log
  // needed somebody to make its folder would write nothing on the machine it matters most on.
  // But the whole beta support story is *send me the log folder*, and until this line there
  // was nothing to send after the one failure that needs it most: an app that started cleanly
  // and then **hung** has logged nothing, so the folder does not exist, so Help ▸ open the log
  // folder opens nothing and the release body names a folder that is not there. A hang is the
  // failure least likely to write a line and the most likely to need one.
  //
  // **This does not reopen the synchronous-write trade.** `log.ts` defends `appendFileSync` on
  // the grounds that the log takes failures and nothing else, and warns that the first caller
  // logging per keystroke makes it wrong. This is one write per process launch, before a window
  // exists — the version and the platform are already on every line, so what it adds is a
  // timestamp, which dates the session a report is about.
  log.info('app started');

  // The window, held rather than discarded, because main now has something to say to it
  // (ADR 0029). A `let` and not a `const`: the handler table is registered before the window
  // is built — it has to be, or the renderer's first question could arrive with nothing to
  // answer it — and both halves of the exit need the same guard.
  // Initialised explicitly rather than left bare, because a `let` assigned exactly once reads
  // to `prefer-const` as a `const` written the long way round. It is genuinely reassigned —
  // below, after the window exists.
  let mainWindow: BrowserWindow | undefined = undefined;
  // Every push to the window, asked of the window first (`window-events.ts`).
  const toWindow = windowEvents(() => mainWindow);
  // The arrow press that moved an open menu list, swallowed once it reaches the page (TYTO-263).
  const leakedArrow = new LeakedArrow();

  // The language everything main draws is in: the menu, and the crash box below. It starts as
  // the system's, because that is the only one main has before the window has said anything,
  // and `app:locale` replaces it when the footer picker moves (TYTO-124).
  let uiLocale: Locale = localeFor(app.getLocale());
  // The File items the window last said do nothing with its tab in front (TYTO-283). Kept here
  // so a menu rebuilt for a new language greys the same ones.
  let menuDisabled: ReadonlySet<string> = new Set();

  // What Help > About says (TYTO-248). Reassigned once the template sources exist; until then
  // the panel says no templates rather than waiting for them.
  let aboutFacts = (): AboutFacts => ({
    version: app.getVersion(),
    platform: process.platform,
    templates: 0,
    templatesFolder: null,
  });

  /**
   * Builds the application menu in one language, and is called again when that changes.
   *
   * A function rather than a statement, because the File submenu is this app's own words
   * (TYTO-124) and the footer picker can change which language those words are in. Declared
   * before the handler table below so `app:locale` can reach it without a forward reference,
   * and closing over `mainWindow` the way the exit guard does — the window does not exist yet
   * and the menu does not need it to.
   */
  const installMenu = (locale: Locale): void => {
    uiLocale = locale;
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        menuTemplate(process.platform, {
          t: (key) => translate(locale, key),
          disabled: menuDisabled,
          onRevealLogs: () => {
            void shell.openPath(log.directory);
          },
          // The id and nothing else. Main does not know what `editor.save` does, and the whole
          // point of the table in `shared/commands.ts` is that it never needs to.
          onCommand: (id) => {
            toWindow('command:run', { id });
          },
          // macOS's own about panel shows the credits; on Windows `showAboutPanel` draws a box
          // with the app name alone (measured, TYTO-248), so there it is a message box.
          onAbout: () => {
            const t = (key: Parameters<typeof translate>[1]): string => translate(locale, key);
            const detail = aboutText(t, aboutFacts());
            if (process.platform === 'darwin') {
              app.setAboutPanelOptions({
                applicationName: t('app.name'),
                applicationVersion: app.getVersion(),
                credits: detail,
              });
              app.showAboutPanel();
              return;
            }
            const box = {
              type: 'info' as const,
              title: t('menu.about'),
              message: t('app.name'),
              detail,
            };
            void (mainWindow === undefined
              ? dialog.showMessageBox(box)
              : dialog.showMessageBox(mainWindow, box));
          },
        }),
      ),
    );
  };

  // **Here, and not after the services, which is the whole of TYTO-140's third part.** The
  // menu used to be built last, after settings, sources, preview, catalogue and export — so a
  // startup that threw left the app with no window *and* no Help ▸ open the log folder, which
  // is the one door to the line that had just been written. The menu needs none of what comes
  // below it; it needed only to be asked earlier.
  //
  // It is also still before the window, because the menu is the browser process's and a key
  // pressed while it is still the default one would be handled by the default one.
  installMenu(uiLocale);

  // What a crash looks like, now that the log line alone is not enough (TYTO-140). Assigned
  // over the module-level fallback as soon as there is a folder worth naming — and since
  // TYTO-144 it opens that folder instead of only naming it.
  //
  // **Synchronous on purpose.** `onCrash` runs inside an `uncaughtException` listener, where
  // a process that is about to die may never resolve the promise `showMessageBox` returns, so
  // the button would be drawn and its answer lost. `showMessageBoxSync` blocks main the way
  // `showErrorBox` always did, which is the trade TYTO-140 already accepted: nothing else in
  // main runs while a person reads about a crash. The path stays in the detail as well, so the
  // box still says where the file is if opening the folder fails.
  reportCrash = (reason) => {
    const response = dialog.showMessageBoxSync({
      type: 'error',
      message: translate(uiLocale, 'crash.title'),
      detail: `${crashSummary(reason)}\n\n${translate(uiLocale, 'crash.detail')}\n${log.directory}`,
      buttons: [translate(uiLocale, 'menu.revealLogs'), translate(uiLocale, 'crash.close')],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) void shell.openPath(log.directory);
  };

  installCrashHandlers(process, log, (reason) => {
    reportCrash(reason);
  });

  // **The previous version's settings, offered before anything reads its own** (TYTO-151,
  // ADR 0036). Before `settings.read()` below, because the templates folder that read returns
  // decides which templates the registry is built from; after the log and the crash box,
  // because `offerPreviousVersion` logs what it could not bring and never throws.
  //
  // A native box and not a page in the window, for the same reason: the answer has to exist
  // before the window's first question does. The two buttons and the checkbox are the whole
  // decision, and the checkbox is unticked — secrets travel only when somebody says so.
  //
  // **Not under `TYTO_HEADLESS`, and that was measured.** Four end-to-end suites used to launch
  // without `--user-data-dir` and ran in the real `<appData>/Tyto/<version>`; on a machine
  // that has an older version beside it, the box opened with no window and no person, and all
  // four timed out waiting for `firstWindow`. Since TYTO-139 every suite names its own folder,
  // which already skips the box through `chosenUserData`, and `e2e/launch-isolation.test.ts`
  // keeps it that way. The `TYTO_HEADLESS` half stays because ADR 0036 decides it by name and
  // it still covers a hidden launch somebody starts by hand: a question nobody is there to
  // answer is not asked, and nothing is recorded, so the next real launch still asks.
  if (chosenUserData !== undefined && process.env['TYTO_HEADLESS'] !== '1') {
    await offerPreviousVersion({
      userData: chosenUserData,
      productRoot: dirname(chosenUserData),
      version: app.getVersion(),
      log,
      ask: async (offer) => {
        const fill = (text: string): string => text.replaceAll('{version}', offer.version);
        const answer = await dialog.showMessageBox({
          type: 'question',
          message: fill(translate(uiLocale, 'import.message')),
          detail: fill(translate(uiLocale, 'import.detail')),
          buttons: [translate(uiLocale, 'import.confirm'), translate(uiLocale, 'import.decline')],
          defaultId: 0,
          cancelId: 1,
          ...(offer.hasCredentials
            ? { checkboxLabel: translate(uiLocale, 'import.credentials'), checkboxChecked: false }
            : {}),
        });
        return { accept: answer.response === 0, includeCredentials: answer.checkboxChecked };
      },
    });
  }

  // The registry is read before the window opens, not after: the renderer's first question
  // is which templates exist, and answering it with "not yet" would put a loading state in
  // front of every panel for the lifetime of a decision made at startup.
  const fileSystem = nodeFileSystem();
  // **The colour themes** (TYTO-208, ADR 0077), composed before the host because the `theme`
  // setting the host registers checks its ids against them. The built-in two come from the
  // host and the installed plugins' from `contributed` below, once each exists; until the
  // installed plugins have started, an id that may be theirs is waited for, not refused.
  const themeSources: {
    builtIn?: () => readonly ThemeSource[];
    installed?: () => readonly ThemeSource[];
  } = {};
  let themesReady: () => void = () => undefined;
  let themeSetting: ThemeSetting = DEFAULT_THEME_SETTING;
  const themes = createThemeService({
    sources: () => [
      ...(themeSources.builtIn?.() ?? Object.values(BUILT_IN_THEMES).map(builtInThemeSource)),
      ...(themeSources.installed?.() ?? []),
    ],
    ready: new Promise<void>((resolve) => {
      themesReady = resolve;
    }),
    setting: () => themeSetting,
    // What Electron answers `prefers-color-scheme` from: the window's colours, the editor's
    // dark flag and the native dialogs, scrollbars and menus all follow this one value.
    setMode: (mode) => {
      if (nativeTheme.themeSource !== mode) nativeTheme.themeSource = mode;
    },
    shown: () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
    report: (problem) => {
      log.warn(problem.message);
    },
  });
  // **The title bar's buttons follow the theme** (TYTO-244, ADR 0078). The minimise, maximise
  // and close buttons are the system's, drawn over the page's own bar, and the page cannot
  // colour them: main paints them from the applied theme every time one is answered — at the
  // window's first question, on a choice, a preview, a save of the `theme` setting — and when
  // the system flips between light and dark. Until the window first asks, the base theme of the
  // kind on show, which is what `tokens.css` paints first too.
  let appliedThemes: Pick<AppliedThemes, ThemeKind> = {
    light: {
      id: BUILT_IN_THEMES.light.id,
      kind: 'light',
      colors: BASE_COLORS.light,
      diagnostics: [],
    },
    dark: { id: BUILT_IN_THEMES.dark.id, kind: 'dark', colors: BASE_COLORS.dark, diagnostics: [] },
  };
  const shownKind = (): ThemeKind => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  // The page's zoom (TYTO-272, ADR 0099): the `zoom` setting, read below with the others. The
  // system's buttons are sized in the window's pixels, so they grow with it.
  let windowZoom: number = ZOOM.default;
  const titleBarColours = () => overlayFor(appliedThemes, BASE_COLORS, shownKind(), windowZoom);
  const paintTitleBar = (): void => {
    if (!drawsTitleBar(process.platform)) return;
    if (mainWindow === undefined || mainWindow.isDestroyed()) return;
    mainWindow.setTitleBarOverlay(titleBarColours());
  };
  const applying = async (answer: Promise<AppliedThemes>): Promise<AppliedThemes> => {
    const applied = await answer;
    appliedThemes = applied;
    paintTitleBar();
    return applied;
  };
  nativeTheme.on('updated', paintTitleBar);
  const host = await activateBuiltIns({ fileSystem, log, themes: themes.lookup });
  themeSources.builtIn = () => host.registry.themes().map(builtInThemeSource);
  // Composed here and nowhere else (ADR 0010): the store is `@tyto/io`'s adapter and the
  // renderer reaches it only through `plugins:list`.
  const pluginsHome = tytoHome();
  const pluginStore = fsPluginStore(pluginsHome);

  // Which folders this app searches for templates, and the only thing below that is rebuilt
  // when a person picks one (TYTO-122). The built-in pack is always the last root, so
  // clearing the setting is a reload with no folder rather than a different code path.
  //
  // `activateBuiltIns` above deliberately stays out of it: it registers the *built-in pack*
  // through the plugin extension point, and a folder somebody points at is not a plugin —
  // that is the whole of why this card is not TYTO-47.
  //
  // The file is read against what the plugins declared (ADR 0073). Its problems go to the log
  // at launch, and to the problems panel once the settings tab is open (TYTO-206).
  const settingsFile = join(app.getPath('userData'), 'settings.json');
  // Beside it, per version for the same reason (ADR 0032). Read by the window (TYTO-207).
  const keybindingsFile = join(app.getPath('userData'), 'keybindings.json');
  // And the snippets, read by the window for the same reason (TYTO-277, ADR 0082).
  const snippetsFile = join(app.getPath('userData'), 'snippets.json');
  // Bound below, once the queue it applies to exists; the store tells it every write it makes.
  // `installed` too: the window's plugins start after the window opens (TYTO-254).
  const late: { live?: LiveSettings; installed?: WindowPlugins } = {};
  // What the settings file is checked against: the built-ins' settings and, once they have
  // started, the installed plugins' (TYTO-254, ADR 0145). One list for the store, the tab's
  // validation and its outline, so a plugin's key is the same key everywhere.
  const declared = () => [
    ...host.registry.configurations(),
    ...(late.installed?.configurations() ?? []),
  ];
  // The installed plugins that are not running — disabled, failed or refused — whose keys the
  // file may still hold: named in the warning rather than called unknown (TYTO-254).
  let installedFolders: readonly string[] = [];
  const stopped = (): readonly string[] => {
    const running = new Set(late.installed?.running() ?? []);
    return installedFolders.filter((name) => !running.has(name));
  };
  // The settings in force by plugin id, which each export's host is configured with (TYTO-254).
  let configuration: Readonly<Record<string, unknown>> = {};
  // Every host that runs plugins gets the same reading: the built-ins' here, the installed
  // plugins' processes through the window's host, and each export's host from `configuration`.
  const configureAll = (config: Readonly<Record<string, unknown>>): void => {
    configuration = config;
    host.configure(config);
    late.installed?.configure(config);
  };
  const settings = fileSettingsStore(
    settingsFile,
    declared,
    (text) => late.live?.wrote(text),
    stopped,
  );
  // The problems are logged once the installed plugins have started (`redeclared` below): read
  // now, a plugin's key would be logged as unknown on every launch.
  const reading = await settings.load();
  configureAll(reading.config);
  const saved = reading.settings;
  // Before the window exists, so a window told to be dark is never painted light first.
  themeSetting = saved.theme;
  nativeTheme.themeSource = modeOf(saved.theme, themes.lookup);
  // The icons' stroke (TYTO-288): read with the colours by the window, so it moves with them.
  let iconStrokeWidth = saved.iconStrokeWidth;
  // The status bar's items (TYTO-301), on the same answer and for the same reason.
  let statusBarItems = saved.statusBarItems;
  // And its colours over the theme's (TYTO-301), on the same answer.
  let statusBarColors = saved.statusBarColors;
  // And whether the editor takes vim's keys (TYTO-333), on the same answer: what the window
  // opens in, and what "Editor: turn vim mode on or off" writes.
  let vimMode = saved.vimMode;
  // And which vim plugins are switched off (TYTO-418), on the same answer.
  let vimPlugins = saved.vimPlugins;
  // And how vim's mode is shown (TYTO-301), on the same answer.
  let vimModeStyle = saved.vimModeStyle;
  // And whether the editor draws indent guides (TYTO-293), on the same answer.
  let indentGuides = saved.indentGuides;
  // And whether it pins the head line of the block at the top (TYTO-295), on the same answer.
  let stickyScroll = saved.stickyScroll;
  // And the indent width and format-on-save (TYTO-297), on the same answer.
  let tabSize = saved.tabSize;
  let formatBriefOnSave = saved.formatBriefOnSave;
  // And whether a missing face is asked of Google Fonts (TYTO-281), read on every compile.
  let googleFonts = saved.googleFonts;
  // And the gallery's index (TYTO-504, ADR 0162), read whenever the gallery is asked.
  let galleryIndex = saved.galleryIndex;
  // And the zone a recipe reads written times in (TYTO-377, ADR 0148), read at every run.
  let recipeTimeZone = saved.recipeTimeZone;
  // And how the columns of a `|` line are drawn (TYTO-298), on the same answer.
  let briefColumns = saved.briefColumns;
  // And how the editor numbers its lines (TYTO-415), on the same answer.
  let lineNumbers = saved.lineNumbers;
  // And how the command panel lays out its runs (TYTO-496), on the same answer.
  let commandsOrder = saved.commandsOrder;
  let commandsFoldOlderRuns = saved.commandsFoldOlderRuns;
  let terminalShell = { shell: saved.terminalShell, args: saved.terminalArgs };
  // And the faces and sizes (TYTO-272), on the same answer. The zoom is applied here, in main.
  let typography: Typography = {
    uiFontFamily: saved.uiFontFamily,
    uiFontSize: saved.uiFontSize,
    codeFontFamily: saved.codeFontFamily,
    codeFontSize: saved.codeFontSize,
    fontSizes: saved.fontSizes,
    fontFamilies: saved.fontFamilies,
  };
  windowZoom = saved.zoom;
  // Electron's zoom on the window's page, and the system's buttons sized to match. Applied at
  // every load too, because a reload is a new page.
  const applyZoom = (level: number): void => {
    windowZoom = level;
    // The window before its contents, for `window-events.ts`'s reason: a destroyed window throws.
    if (mainWindow === undefined || mainWindow.isDestroyed()) return;
    const contents = mainWindow.webContents;
    if (contents.isDestroyed()) return;
    contents.setZoomLevel(level);
    paintTitleBar();
  };
  // The themes a vim badge colour is measured in: the one the mode shows, or both when the
  // system chooses, since either may be in front.
  const themesInForce = (): readonly ThemeInForce[] => {
    const source = nativeTheme.themeSource;
    const kinds: readonly ThemeKind[] =
      source === 'light' ? ['light'] : source === 'dark' ? ['dark'] : ['light', 'dark'];
    return kinds.map((kind) => ({
      id: appliedThemes[kind].id,
      colors: appliedThemes[kind].colors,
    }));
  };
  // A screen's change: `false` when it was refused because the file does not parse.
  const remember = (changes: Partial<Settings>): Promise<boolean> =>
    late.live === undefined ? Promise.resolve(false) : late.live.remember(changes);
  const sources = await createProjectSources({
    fileSystem,
    builtIn: builtInTemplatesDirectory(),
    // Spread rather than `?? undefined`, because `exactOptionalPropertyTypes` tells an absent
    // key and an explicit `undefined` apart and the option wants the first.
    ...(saved.templatesFolder === null ? {} : { folder: saved.templatesFolder }),
  });

  // **The workspace folder** (TYTO-278, ADR 0113): its trust answer from the same `TYTO_HOME` the
  // plugins live in, and its template folders handed to the same `sources` the folder above is.
  // **The explorer** (TYTO-279, ADR 0115): the open folder's files by id, watched while it is
  // open. A notice and not a question, as the queue's: the panel lists again when it hears it.
  const explorer = createExplorerService({
    onChange: () => {
      toWindow('explorer:changed', {});
    },
    onError: (message, cause) => {
      log.error(message, cause);
    },
    // The system's trash and nothing else (ADR 0121). Looked up at every call rather than
    // bound once, so an end-to-end suite can stand a folder in for it through `app.evaluate`.
    trash: (path) => shell.trashItem(path),
  });
  app.on('will-quit', () => {
    explorer.close();
  });

  // The plugin files' sync (TYTO-433), bound once the plugin launcher below exists. Asked when a
  // folder opens; until it is bound, the first sync after binding reads the folder anyway.
  let syncPluginFiles: (update: boolean) => Promise<void> = () => Promise.resolve();
  const pluginFilesSoon = (update: boolean): void => {
    syncPluginFiles(update).catch((cause: unknown) => {
      log.error('The plugin files could not be synced.', cause);
    });
  };
  // TYTO-487: every folder that opens is remembered, whichever door it came through — the
  // picker, the popover, the session brought back at launch.
  const recentFolders = createRecentFoldersService({
    list: fileRecentFolders(join(app.getPath('userData'), 'recent-folders.json')),
    exists: (folder) =>
      stat(folder).then(
        (found) => found.isDirectory(),
        () => false,
      ),
    home: () => app.getPath('home'),
  });
  // Stops every `tyto` command running in main (ADR 0159 decision 3): a `watch` ends when the
  // window opens another folder. Bound once the runner exists, below the queue.
  let stopCommands = (): void => {};
  const workspace = createWorkspaceService({
    trustStore: fsTrustStore({ home: pluginsHome }),
    home: pluginsHome,
    setTemplateFolders: async (folders) => {
      await sources.setWorkspaceFolders(folders);
    },
    onFolder: async (folder, places) => {
      stopCommands();
      await explorer.setRoot(folder, places);
      if (folder !== undefined) await recentFolders.remember(folder);
      // Not awaited: a fetch may take a while, and the folder is open meanwhile. The templates
      // it brings arrive with `templates:changed` (ADR 0151 decision 3).
      pluginFilesSoon(false);
    },
  });

  aboutFacts = () => ({
    version: app.getVersion(),
    platform: process.platform,
    templates: host.registry.templatePacks().flatMap((pack) => pack.templates).length,
    templatesFolder: sources.current().folder?.path ?? null,
  });

  // Opening and saving, and the only object in this app that knows where the open brief
  // is. The dialogs are wrapped here rather than inside the service for the usual reason —
  // `dialog` is an Electron API, and a service that named one could not be tested without
  // launching one (E9.8).
  const documents = createDocumentService({
    recent: fileRecentFiles(join(app.getPath('userData'), 'recent-files.json')),
    unlisted: [settingsFile, keybindingsFile, snippetsFile],
    // What a tab's folder is shortened against on hover (ADR 0086), asked at each open.
    home: () => app.getPath('home'),
    // Inside the open folder a label is relative to it (ADR 0125): the explorer's, asked at each.
    root: () => explorer.folder(),
    // TYTO-247, ADR 0132: Open offers briefs, then text files, then both; Save As offers the
    // tab's own format first. The filters are built at each call, in the window's language.
    dialogs: {
      openBrief: async () => {
        const answer = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: openFilters(uiLocale),
        });
        return answer.canceled ? undefined : answer.filePaths[0];
      },
      saveBrief: async (suggested, format) => {
        const answer = await dialog.showSaveDialog({
          ...(suggested === undefined ? {} : { defaultPath: suggested }),
          filters: saveFilters(uiLocale, format),
        });
        return answer.canceled ? undefined : answer.filePath;
      },
    },
  });

  // The picker's list, read once alongside the other two. Its own read rather than the
  // preview service's registry: compiling a brief and listing what is installed are two
  // reasons for one object to change, and `src/main/templates.ts` says why that matters.
  const templates = await createTemplateCatalogue({ sources });

  // The one place `safeStorage` is named. Everything below takes it as an argument, which
  // is what lets the credential module be tested without a keychain and without Electron.
  const credentials = createCredentials({
    encryption: safeStorage,
    store: fileCredentialStore(join(app.getPath('userData'), 'credentials')),
  });
  // One composition of what a plugin may reach, shared by its process and its panel, so the
  // two can never be granted different things (ADR 0042, ADR 0045).
  // A plugin's cache beside the sources' in `TYTO_HOME`, and the files of the folder open in the
  // window, asked of `workspace` at every call because a plugin outlives an Open Folder (ADR 0138).
  const capabilities = desktopCapabilities(credentials, (url, init) => net.fetch(url, init), {
    home: pluginsHome,
    workspace: () => workspace.state(),
  });

  // The export, composed here for the reason everything else is (ADR 0010): it needs a
  // `Rasterizer`, and the only place allowed to know which adapter exists is this file. It
  // is read back out of the plugin registry rather than constructed a second time — what
  // exports is what TYTO-133 registered, which is the claim the extension point makes.
  // Installed plugins, started once for the app's life, each in a process of its own on the
  // Node bundled with the app, under its permission model (ADR 0049, ADR 0050) — never in main.
  // What they can reach is behind their declared permissions: `net.fetch` for the network,
  // and `safeStorage`, through the same `credentials`, for secrets (ADR 0042).
  // Not awaited: the window opens while they start, and the export waits for them.
  const launch = bundledNodeLauncher({
    spawn: (command, args, options) => spawn(command, args, options),
    realpath: (path) => realpathSync(path),
    ...bundledNodePaths({
      packaged: app.isPackaged,
      mainDirectory: dirname(fileURLToPath(import.meta.url)),
      mainFile: fileURLToPath(import.meta.url),
      resourcesPath: process.resourcesPath,
      platform: process.platform,
      join,
    }),
  });
  const plugins = startDesktopPlugins({
    store: pluginStore,
    launch,
    capabilities,
  }).catch((cause: unknown) => {
    // A disk that refused the folder: the app opens without installed plugins, and says so.
    log.error('The installed plugins could not be started.', cause);
    return NO_PLUGINS;
  });
  void plugins.then((loaded) => {
    for (const warning of loaded.warnings) log.warn(warning.message);
  });
  app.on('will-quit', () => {
    void plugins.then((loaded) => loaded.close());
  });

  // The installed plugins' template packs, checked by the CLI's own rule (ADR 0046) and
  // searched after the built-in pack once they are. A plugin refused over its pack is
  // refused everywhere below — preview, panels and export — because the problems panel
  // says it was skipped. `windowPlugins` settles after this, which is what tells the
  // renderer to ask for the template list again.
  const checked = plugins.then(async (loaded) => {
    try {
      // Code templates too: each runs in its plugin's process, reached through the
      // proxy the loader registered, and the preview and the export draw it from there
      // (ADR 0048, `template-source.ts`).
      const packs = await installedPacks(
        createPluginHost(),
        loaded,
        (name) => pluginStore.directoryOf(name),
        { allowCode: true },
      );
      for (const warning of packs.warnings) log.warn(warning.message);
      await sources.setInstalled(packs);
      return withoutRefused(loaded, packs.refused);
    } catch (cause) {
      log.error("The installed plugins' templates could not be read.", cause);
      return loaded;
    }
  });

  // **The plugin files** (TYTO-433, ADR 0151): the sync `tyto render` runs, here in main, with
  // the copies in a plugin set of their own that starts again when what loads changes. Synced
  // at start, when a folder opens (above) and on the two commands; never in the renderer.
  const pluginFiles = createDesktopPluginFiles({
    home: pluginsHome,
    builtInNames: new Set(
      [...host.registry.plugins(), ...exporterBuiltIns()].map((plugin) => plugin.manifest.name),
    ),
    sync: syncPluginFolders,
    approve: approveInABox(
      (box) => {
        const options = { ...box, buttons: [...box.buttons] };
        return mainWindow === undefined
          ? dialog.showMessageBox(options)
          : dialog.showMessageBox(mainWindow, options);
      },
      (key) => translate(uiLocale, key),
    ),
    start: (store) => startDesktopPlugins({ store, launch, capabilities }),
    packs: (loaded, folderOf) =>
      installedPacks(createPluginHost(), loaded, folderOf, { allowCode: true }),
    apply: async (fetched) => {
      for (const problem of fetched.problems) log.warn(problem.message);
      await sources.setFetched(fetched);
      toWindow('templates:changed', {});
    },
  });
  syncPluginFiles = (update) => {
    const open = workspace.state();
    return pluginFiles.sync({
      update,
      ...(open.folder === null
        ? {}
        : // A trust taken back while the folder is open holds until it reopens (ADR 0111).
          { workspace: { folder: open.folder, trusted: open.trust !== 'restricted' } }),
    });
  };
  pluginFilesSoon(false);
  app.on('will-quit', () => {
    void pluginFiles.close();
  });

  // Built before the window, for the same reason the registry is: the preview's first
  // answer should not wait on a folder read that could have happened during startup. It
  // reads the same pack the host registered, through the same resolver, and the installed
  // plugins' directives once they have started (TYTO-49).
  //
  // It is told no folder here. Which folder a compile resolves against is a property of the
  // tab the brief is in, and `ipc.ts` looks it up per request from the id that came with
  // it (E9.11) — a service holding one folder assumed one open document.
  // What the installed plugins contribute to the window itself: the directives the preview
  // and the template mode resolve, and the panels (ADR 0043, ADR 0045).
  const contributed = windowPlugins(checked);
  late.installed = contributed;
  // Which installed plugins exist at all, read once they have started, so a key of one that is
  // not running is named (TYTO-254). Never rejects: an unreadable folder names none.
  const pluginsSettled = contributed.ready
    .then(() => pluginStore.list())
    .then(
      (folders) => {
        installedFolders = folders.map((stored) => stored.folder);
      },
      () => undefined,
    );
  // Held until the installed plugins have been handed their settings, so an export started in
  // the first second is not drawn with a plugin's defaults (TYTO-254).
  let markConfigured: () => void = () => undefined;
  const pluginsConfigured = new Promise<void>((resolve) => {
    markConfigured = resolve;
  });
  // An installed plugin's theme file is read from its own folder, never outside it (ADR 0077).
  themeSources.installed = () =>
    contributed.themes().map(({ plugin, theme }) => ({
      plugin,
      theme,
      read: folderThemeReader(pluginStore.directoryOf(plugin)),
    }));
  void contributed.ready.then(themesReady);
  // The brands the started plugins' kits offer, the kits the preview draws with, so a plugin
  // file's configuration naming another is a problem row at its `brand:` (TYTO-471, ADR 0155).
  // Kept by `sources` for every read after, so a sync or an install says it again.
  void contributed.ready.then(async () => {
    await sources.setKitBrands(new Set(contributed.brandKits().kits.keys()));
    toWindow('templates:changed', {});
  });
  // The recipe notebook's runner (TYTO-377, ADR 0148): the plugins' verbs, each with its own
  // section of the folder a recipe is in, read per call (ADR 0147); the folder's trust and data
  // files; the recipe's state in the same `TYTO_HOME`; and the clock in the setting's zone.
  const recipes = createRecipeRunner({
    contributions: contributed.recipeContributions(),
    placeOf: async (directory) => {
      const answer = await workspace.sourceTrustFor(directory);
      if (answer === undefined || answer.trust === 'none') return { trust: 'none' };
      return { trust: answer.trust, folder: answer.folder };
    },
    sectionFor: (directory, plugin) => workspace.sectionFor(directory, plugin),
    home: pluginsHome,
    clock: () => recipeClock(recipeTimeZone),
  });
  // The images and faces installed plugins supply, in one cache for the process, which the
  // preview and the export share (ADR 0117, ADR 0119).
  const pluginSources = desktopSources({
    home: pluginsHome,
    assetSources: () => contributed.assetSources(),
    fontSources: () => contributed.fontSources(),
    trustFor: (directory) => workspace.sourceTrustFor(directory),
    ready: contributed.ready,
    // The built-in Google Fonts source (ADR 0120), behind the same cache and rule, on the
    // window's own network. Where it connects is the environment's alone: a test server.
    googleFonts: windowGoogleFonts({
      options: googleFontsOptionsFor(process.env),
      capabilities,
      enabled: () => googleFonts,
    }),
  });
  const preview = await createPreviewService({
    fileSystem,
    sources,
    directives: contributed,
    brandKits: contributed,
    places: (directory) => workspace.placesFor(directory),
    pluginSources,
  });

  // The template mode (TYTO-44). The same `sources` as the preview, so a save that reads the
  // folders again is seen by the preview, the export and the picker with nothing rebuilt.
  const templateEditor = createTemplateEditor({ sources, directives: contributed.resolver });
  // The folder it has open, which `template:open` files and the session keeps (TYTO-266).
  const templateFolder = createTemplateFolder();

  const panels = createPanelService(contributed, capabilities);
  servePluginPages(contributed, (name) => pluginStore.directoryOf(name));

  // The one rasterizer the export and a `tyto` command share (ADR 0159 decision 3), so their
  // captures queue on one adapter under its deadline (ADR 0030).
  const windowRasterizer = registeredRasterizer(host.registry);
  const exports_ = await createExportService({
    fileSystem,
    log,
    sources,
    plugins: checked.then(async (loaded) => {
      await pluginsConfigured;
      return loaded;
    }),
    configuration: () => configuration,
    places: (directory) => workspace.placesFor(directory),
    pluginSources,
    version: app.getVersion(),
    ...(windowRasterizer === undefined ? {} : { rasterizer: windowRasterizer }),
  });

  // The local queue (TYTO-45), composed here for the reason the export is: the inbox is
  // `@tyto/io`'s `fsInbox` adapter, reached through its `BriefSource` port, and this file is
  // the only one allowed to name it (ADR 0010). `done/` is read through a second one, because
  // `done/<id>/brief.brief` is an inbox's shape. The same layout `tyto watch <folder>` uses.
  const queue = createQueueService({
    sources: (folder) => ({
      inbox: fsInbox({ root: join(folder, 'inbox'), done: join(folder, 'done') }),
      done: fsInbox({ root: join(folder, 'done') }),
    }),
    render: (request) => exports_.run(request),
    folder: saved.queueFolder,
    autoRun: saved.queueAutoRun,
    kinds: saved.queueKinds,
    // A notice and not a question (ADR 0029): the panel asks `queue:list` when it hears it.
    // Dropped while there is no window, which costs nothing — a window that opens later asks
    // once on its own.
    onChange: () => {
      toWindow('queue:changed', {});
    },
    // Main moved the file, so main tells the document service: a tab holding the brief a
    // person just fixed follows it to `done/`, and their next save lands there.
    onMoved: (from, to) => {
      documents.retarget(from, to);
    },
    onError: (message, cause) => {
      log.error(message, cause);
    },
  });
  app.on('will-quit', () => {
    queue.close();
  });

  // **`tyto` commands in main** (TYTO-495, ADR 0159): the CLI's own command tree, run with the
  // window's instances — the rasterizer the export uses, the bundled-Node launcher, this
  // `TYTO_HOME` and the open folder — so a command and the window share one of each.
  const cli = createCliRunner({
    environment: () => ({
      version: app.getVersion(),
      cwd: workspace.state().folder ?? pluginsHome,
      home: pluginsHome,
      variables: process.env,
      shellRefusal: SHELL_REFUSED,
      launch,
      rasterizer: () => {
        if (windowRasterizer === undefined) throw new Error('This window has no rasterizer.');
        return windowRasterizer;
      },
    }),
    refuse: windowRefusals({ platform: process.platform, queue: () => queue.view() }),
    confirm: confirmInABox(
      (box) => {
        const options = { ...box, buttons: [...box.buttons] };
        return mainWindow === undefined
          ? dialog.showMessageBox(options)
          : dialog.showMessageBox(mainWindow, options);
      },
      (key) => translate(uiLocale, key),
    ),
    output: (output) => {
      toWindow('cli:output', output);
    },
    state: (change) => {
      toWindow('cli:state', change);
    },
    diagnostics: (rows) => {
      toWindow('cli:diagnostics', { ...rows, diagnostics: [...rows.diagnostics] });
    },
    // The commands with a window twin leave the window as its own twin would (decision 3).
    afterRun: async ([command, subcommand], code) => {
      if (code !== 0) return;
      if (command === 'plugin' && subcommand === 'sync') await syncPluginFiles(false);
      if (command === 'delivery' && subcommand === 'new') toWindow('explorer:changed', {});
      // A revoke applies the next time the folder opens (ADR 0111), so only a grant re-reads.
      const open = workspace.state().folder;
      if (command === 'trust' && subcommand === 'add' && open !== null) await workspace.open(open);
    },
  });
  stopCommands = () => {
    cli.cancelAll();
  };
  app.on('will-quit', () => {
    cli.cancelAll();
  });

  // **The terminals** (TYTO-497, ADR 0164): the person's shell in a pseudo-terminal main owns.
  // node-pty is loaded at the first open, so a window that never opens a terminal never loads a
  // native module. A workspace change does not touch them: each keeps the folder it started in.
  const terminals = createTerminals({
    spawn: (file, args, options) => {
      const pty = createRequire(import.meta.url)('node-pty') as {
        spawn: (
          file: string,
          args: string[],
          options: SpawnOptions & { name: string },
        ) => PseudoTerminal;
      };
      return pty.spawn(file, [...args], { name: 'xterm-256color', ...options });
    },
    shell: () =>
      chooseShell({
        platform: process.platform,
        environment: process.env,
        setting: terminalShell,
        exists: existsSync,
      }),
    folder: () => workspace.state().folder,
    home: () => app.getPath('home'),
    // With no folder open the state still reads `restricted` (nothing is trusted), and ADR 0164
    // opens a terminal then: only an open, untrusted folder refuses.
    restricted: () => {
      const state = workspace.state();
      return state.folder !== null && state.trust === 'restricted';
    },
    environment: () => terminalEnvironment(process.env),
    // A shell outlives the window it printed to, so the window is asked whether it is gone
    // before its `webContents` is read, which throws on a destroyed window.
    output: (terminalId, data) => {
      toWindow('terminal:output', { terminalId, data });
    },
    exit: (terminalId, code) => {
      toWindow('terminal:exit', { terminalId, code });
    },
    killTree: killTree(
      process.platform,
      (pid) => process.kill(pid, 'SIGHUP'),
      // Synchronous, so a quit does not end before the tree has.
      (pid) => spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }),
    ),
    foregroundKnown: process.platform !== 'win32',
  });
  app.on('will-quit', () => {
    terminals.killAll();
  });
  // Quitting over a program still running in a terminal asks first, in a box main owns.
  const terminalsMayQuit = terminalQuitGuard(terminals.busy, (titles) => {
    const options = {
      type: 'warning' as const,
      message: translate(uiLocale, 'terminal.quit.message').replaceAll(
        '{terminals}',
        titles.join(', '),
      ),
      buttons: [
        translate(uiLocale, 'terminal.quit.quit'),
        translate(uiLocale, 'terminal.quit.stay'),
      ],
      defaultId: 1,
      cancelId: 1,
    };
    const answer =
      mainWindow === undefined
        ? dialog.showMessageBoxSync(options)
        : dialog.showMessageBoxSync(mainWindow, options);
    return answer === 0;
  });

  // **Live settings** (TYTO-206): a save of `settings.json` from the tab or any editor applies
  // with no restart. Bound here, after the queue, because applying a key means reaching it.
  const liveSettings = createLiveSettings({
    store: settings,
    declared,
    stopped,
    ready: pluginsSettled,
    // A vim badge colour no text of the theme reads on is said at the value (TYTO-301).
    advise: (entries) => statusBarColorsContrast(entries, themesInForce()),
    initial: saved,
    readText: () =>
      readFile(settingsFile, 'utf8').catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw error;
      }),
    apply: async (next, keys) => {
      if (keys.includes('templatesFolder')) await sources.reload(next.templatesFolder ?? undefined);
      if (keys.includes('queueFolder')) await queue.setFolder(next.queueFolder);
      if (keys.includes('queueAutoRun')) queue.setAutoRun(next.queueAutoRun);
      if (keys.includes('queueKinds')) queue.replaceKinds(next.queueKinds);
      if (keys.includes('theme')) {
        // Electron's mode now; the window asks for the colours when it hears the change.
        themeSetting = next.theme;
        void applying(themes.current());
      }
      // The window asks `theme:current` on every change it hears, which carries the stroke.
      if (keys.includes('iconStrokeWidth')) iconStrokeWidth = next.iconStrokeWidth;
      if (keys.includes('statusBarItems')) statusBarItems = next.statusBarItems;
      if (keys.includes('statusBarColors')) statusBarColors = next.statusBarColors;
      if (keys.includes('vimMode')) vimMode = next.vimMode;
      if (keys.includes('vimPlugins')) vimPlugins = next.vimPlugins;
      if (keys.includes('vimModeStyle')) vimModeStyle = next.vimModeStyle;
      if (keys.includes('indentGuides')) indentGuides = next.indentGuides;
      if (keys.includes('stickyScroll')) stickyScroll = next.stickyScroll;
      if (keys.includes('tabSize')) tabSize = next.tabSize;
      if (keys.includes('formatBriefOnSave')) formatBriefOnSave = next.formatBriefOnSave;
      if (keys.includes('googleFonts')) googleFonts = next.googleFonts;
      if (keys.includes('galleryIndex')) galleryIndex = next.galleryIndex;
      if (keys.includes('recipeTimeZone')) recipeTimeZone = next.recipeTimeZone;
      if (keys.includes('briefColumns')) briefColumns = next.briefColumns;
      if (keys.includes('lineNumbers')) lineNumbers = next.lineNumbers;
      if (keys.includes('commandsOrder')) commandsOrder = next.commandsOrder;
      if (keys.includes('commandsFoldOlderRuns')) {
        commandsFoldOlderRuns = next.commandsFoldOlderRuns;
      }
      if (keys.includes('terminalShell') || keys.includes('terminalArgs')) {
        terminalShell = { shell: next.terminalShell, args: next.terminalArgs };
      }
      if (keys.includes('zoom')) applyZoom(next.zoom);
      if (
        keys.includes('uiFontFamily') ||
        keys.includes('uiFontSize') ||
        keys.includes('codeFontFamily') ||
        keys.includes('codeFontSize') ||
        keys.includes('fontSizes') ||
        keys.includes('fontFamilies')
      ) {
        typography = {
          uiFontFamily: next.uiFontFamily,
          uiFontSize: next.uiFontSize,
          codeFontFamily: next.codeFontFamily,
          codeFontSize: next.codeFontSize,
          fontSizes: next.fontSizes,
          fontFamilies: next.fontFamilies,
        };
      }
    },
    configure: configureAll,
    send: (payload) => {
      toWindow('settings:changed', payload);
    },
    log,
  });
  late.live = liveSettings;
  // The installed plugins have started and declared their settings: the file is read again
  // against them, every plugin is handed its values, and the file's problems are logged once.
  void pluginsSettled.then(() => liveSettings.redeclared()).then(markConfigured);
  // **The tabs, kept for the next launch** (TYTO-113, ADR 0080), beside `layout.json`.
  const session = createSessionService({
    store: fileSessionStore(join(app.getPath('userData'), 'session.json')),
    documents,
    appFiles: { settings: settingsFile, keybindings: keybindingsFile, snippets: snippetsFile },
    readText: (path) => readFile(path, 'utf8'),
    endSettingsTab: (documentId) => liveSettings.closed(documentId),
    templateFolder,
    openTemplate: (directory) => templateEditor.open(directory),
    workspace: {
      current: () => workspace.state().folder ?? undefined,
      reopen: async (folder) => {
        if (folder === undefined) await workspace.close();
        else await workspace.open(folder);
      },
    },
    folderKey: folderKeyFor(process.platform),
  });
  const sameFolder = (left: string | null, right: string | null): boolean => {
    const key = folderKeyFor(process.platform);
    return left === null || right === null ? left === right : key(left) === key(right);
  };
  /**
   * Opens or closes a folder for the window, and when the folder is another one, files the
   * tabs the window wrote under the folder it left and hands it the new folder's (TYTO-513, ADR
   * 0165). The window wrote its session before asking, and reloads on an answer naming another
   * folder, so the page that reads next is the one that shows them.
   */
  const switchingFolder = async (change: () => Promise<unknown>) => {
    const before = workspace.state().folder;
    await change();
    const after = workspace.state();
    if (!sameFolder(before, after.folder)) {
      await session.switchFolder(before ?? undefined, after.folder ?? undefined);
    }
    return after;
  };
  // **Live keybindings** (TYTO-207) and **live snippets** (TYTO-277): main only watches; the
  // window parses them, against its command registry and its templates.
  const textOrNothing = (path: string) => () =>
    readFile(path, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    });
  const pushTo =
    (event: 'keybindings:changed' | 'snippets:changed') =>
    (payload: { readonly text: string }): void => {
      toWindow(event, { text: payload.text });
    };
  const liveKeybindings = createLiveTextFile('keybindings.json', {
    readText: textOrNothing(keybindingsFile),
    send: pushTo('keybindings:changed'),
    log,
  });
  const liveSnippets = createLiveTextFile('snippets.json', {
    readText: textOrNothing(snippetsFile),
    send: pushTo('snippets:changed'),
    log,
  });
  // The folder and not the file: an editor that saves by replacing the file would leave a
  // watch on the old one listening to nothing. Events come in bursts, so they settle first.
  // One watch for the three files, each with its own settle timer.
  let settle: ReturnType<typeof setTimeout> | undefined;
  let settleKeybindings: ReturnType<typeof setTimeout> | undefined;
  let settleSnippets: ReturnType<typeof setTimeout> | undefined;
  try {
    const watcher = watch(dirname(settingsFile), (_event, name) => {
      if (name === basename(keybindingsFile)) {
        clearTimeout(settleKeybindings);
        settleKeybindings = setTimeout(() => void liveKeybindings.changed(), SETTINGS_SETTLE_MS);
        return;
      }
      if (name === basename(snippetsFile)) {
        clearTimeout(settleSnippets);
        settleSnippets = setTimeout(() => void liveSnippets.changed(), SETTINGS_SETTLE_MS);
        return;
      }
      if (name !== basename(settingsFile)) return;
      clearTimeout(settle);
      settle = setTimeout(() => void liveSettings.changed(), SETTINGS_SETTLE_MS);
    });
    app.on('will-quit', () => {
      watcher.close();
    });
  } catch (cause) {
    log.error(
      'The app files in userData cannot be watched; a save applies at the next launch.',
      cause,
    );
  }

  // The one question main asks. `send` is deliberately the whole of what this file lends it:
  // `quit.ts` holds the latch and the ids and knows nothing about Electron, which is what
  // lets the decision be tested without launching one (ADR 0010).
  const exit = createExitGuard({
    send: (askId) => toWindow('app:exit-requested', { askId }),
  });

  // **A newer version** (TYTO-131, ADR 0069). Composed before the handlers, so the window can
  // ask for the status the moment it loads; started after the window exists, so a check that
  // answers fast has somebody to tell.
  const feed = updateFeedFrom(
    await readFile(join(app.getAppPath(), 'package.json'), 'utf8')
      .then((text): unknown => JSON.parse(text))
      .catch(() => undefined),
  );
  // A feed this build names and cannot use is not a reason to fall back to GitHub: the build
  // that names one is a suite's, and a suite must not reach the real releases.
  if (!feed.ok) log.warn(`Update feed ignored: ${feed.reason}`);
  // The one way this app hands the system browser a page: a release page from the update notice,
  // or the manual from Help (TYTO-318). Neither is a request Tyto makes (ADR 0011).
  const openExternal = (url: string): void => {
    void shell.openExternal(url);
  };
  const updates = createUpdateService({
    route: updateRoute({
      packaged: app.isPackaged,
      platform: process.platform,
      portableDirectory: process.env['PORTABLE_EXECUTABLE_DIR'],
      appImage: process.env['APPIMAGE'],
    }),
    feed: feed.ok ? feed.value : { kind: 'github' },
    check:
      feed.ok &&
      shouldCheck({
        feed: feed.value,
        headless: process.env['TYTO_HEADLESS'] === '1',
        explicitUserData: app.commandLine.hasSwitch('user-data-dir'),
      }),
    currentVersion: app.getVersion(),
    fetchJson: async (url) => {
      const response = await net.fetch(url, {
        headers: { accept: 'application/vnd.github+json' },
      });
      if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);
      return (await response.json()) as unknown;
    },
    updater: async () => {
      // Loaded here and only here, so a build that never installs never loads the library.
      // `default` first: electron-updater is CommonJS, and what an ESM import of it exposes by
      // name depends on what the bundler could see.
      const module = (await import('electron-updater')) as unknown as {
        default?: { autoUpdater: unknown };
        autoUpdater?: unknown;
      };
      const loaded = (module.default?.autoUpdater ?? module.autoUpdater) as InstallingUpdater & {
        logger: unknown;
      };
      // Its own logger writes to the console, which a packaged app has nobody reading; what
      // matters reaches this app's log through the service, one line per event.
      loaded.logger = null;
      return loaded;
    },
    log,
    changed: () => {
      toWindow('update:changed', {});
    },
    quit: () => {
      app.quit();
    },
    openExternal,
  });
  // `quit` and not `before-quit`: it fires only once the guard above let the app go, so a
  // person who chose to stay for an unsaved tab keeps the version they are typing in.
  app.on('quit', (_event, exitCode) => {
    updates.quitting(exitCode);
  });

  registerIpcHandlers(ipcMain, {
    // The only question this app asks a person that is not a file picker: closing a tab
    // with unsaved text. `cancelId` and `defaultId` both point at the safe button, so
    // Escape and Enter each leave the text alone (E9.11). The quit question reuses this
    // untouched, which is how it inherits the safe default rather than copying it.
    confirm: async ({ message, detail, confirm: yes, cancel: no }) => {
      const answer = await dialog.showMessageBox({
        type: 'warning',
        message,
        ...(detail === undefined ? {} : { detail }),
        buttons: [no, yes],
        defaultId: 0,
        cancelId: 0,
      });
      return answer.response === 1;
    },
    // The way out, and the one box in this app with three answers (TYTO-153). The order is
    // the one every editor draws — save, do not save, stay — and it is **here** rather than
    // on the wire, which is why the handler answers with a meaning and the renderer never
    // sees an index.
    //
    // **`defaultId` and `cancelId` point at different buttons, and that is deliberate**:
    // `confirm` above puts both on the safe one because its two answers are *lose the text*
    // and *keep it*. Here Enter saves and Escape stays, so neither key can cost anybody a
    // word — which is the property that lets the default be the one that acts.
    askToSave: async ({ message, detail, save, discard, cancel }) => {
      const answer = await dialog.showMessageBox({
        type: 'warning',
        message,
        ...(detail === undefined ? {} : { detail }),
        buttons: [save, discard, cancel],
        defaultId: 0,
        cancelId: 2,
      });
      // Anything that is not one of the three is read as *stay*. A message box cannot
      // answer outside its own button list, so this is unreachable rather than defensive —
      // and if it ever were reached, staying is the answer that cannot lose a document.
      if (answer.response === 0) return 'save';
      if (answer.response === 1) return 'discard';
      return 'cancel';
    },
    // The explorer's context menu (TYTO-352, ADR 0121): the window's items, drawn natively at
    // the point, scaled by the page's zoom as the menu row's lists are. **The pick is read only
    // after the list has closed and the event loop has turned**: on Windows an item's `click`
    // can arrive after the `popup` callback, and settling in the callback would lose it.
    contextMenu: ({ x, y, items }) => {
      const window = mainWindow;
      if (window === undefined || window.isDestroyed()) return Promise.resolve(null);
      return new Promise((resolveChoice) => {
        let chosen: string | null = null;
        const zoom = window.webContents.getZoomFactor();
        Menu.buildFromTemplate(
          items.map((item) => ({
            label: item.label,
            enabled: item.enabled,
            click: () => {
              chosen = item.id;
            },
          })),
        ).popup({
          window,
          x: Math.round(x * zoom),
          y: Math.round(y * zoom),
          callback: () => {
            setTimeout(() => {
              resolveChoice(chosen);
            }, CONTEXT_MENU_CLICK_GRACE_MS);
          },
        });
      });
    },
    credentials,
    documents,
    exit,
    exports: exports_,
    // `dialog` and `shell` are Electron main-process APIs, so they are wrapped here and the
    // handlers take functions — the same arrangement the brief dialogs above already have.
    folders: {
      choose: async () => {
        // Opened at the workspace's output folder when it declares one (ADR 0113).
        const output = workspace.state().output;
        const answer = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          ...(output === null ? {} : { defaultPath: output }),
        });
        return answer.canceled ? undefined : answer.filePaths[0];
      },
      // `openPath` and not `showItemInFolder`: the export produced a folder, and what a
      // person asked for is that folder open, not its parent with the folder selected.
      reveal: async (directory) => {
        await shell.openPath(directory);
      },
    },
    // Beside the credential store and the recent list, for the third time and on the same
    // argument: a file a person can read, edit and delete (ADR 0009).
    layout: fileLayoutStore(join(app.getPath('userData'), 'layout.json')),
    session,
    log,
    // `localeFor` and not a cast: the window sends a string and this is the one place that
    // decides what an unrecognised one means, which is the same fallback `app:info` uses.
    menu: {
      setLocale: (locale) => {
        installMenu(localeFor(locale));
      },
      setDisabled: (ids) => {
        menuDisabled = new Set(ids);
        installMenu(uiLocale);
      },
      // The drawn menu row (TYTO-244, ADR 0078): read off the menu that is installed, so the
      // row names exactly what the native lists hold, in the language they were built in.
      model: () => projectMenu(Menu.getApplicationMenu(), process.platform),
      // The native list of one top-level menu, under its name in the row. The point arrives
      // in CSS pixels and `popup` takes the window's, so it is scaled by the page's zoom —
      // View > Zoom In would otherwise open the list away from the name. Settles when the
      // list closes, picked from or dismissed — or, on Windows, closed by Left or Right,
      // which the answer carries so the window opens the neighbour (TYTO-263).
      popup: (id, at) => {
        const submenu = findTopLevel(Menu.getApplicationMenu(), id)?.submenu;
        const window = mainWindow;
        if (!(submenu instanceof Menu) || window === undefined || window.isDestroyed()) {
          return Promise.resolve({ opened: false });
        }
        const zoom = window.webContents.getZoomFactor();
        return popupWithArrows<BrowserWindow>({
          menu: submenu,
          window,
          at: { x: Math.round(at.x * zoom), y: Math.round(at.y * zoom) },
          platform: process.platform,
          leaked: leakedArrow,
        });
      },
    },
    project: {
      folder: () => {
        const chosen = sources.current().folder;
        return { folder: chosen?.path ?? null, found: chosen?.found ?? 0 };
      },
      setFolder: async (choose) => {
        const inForce = (): { folder: string | null; found: number } => {
          const chosen = sources.current().folder;
          return { folder: chosen?.path ?? null, found: chosen?.found ?? 0 };
        };

        let chosen: string | undefined;
        if (choose) {
          // No `createDirectory`, unlike the export's picker above: an export chooses a
          // destination that may not exist yet, and a template folder that does not exist has
          // nothing in it to find.
          const answer = await dialog.showOpenDialog({ properties: ['openDirectory'] });
          // A dismissed picker is not a clear. Whatever was in force stays in force.
          if (answer.canceled) return inForce();
          chosen = answer.filePaths[0];
        }

        // Written before the reload, so a disk that refuses the file still leaves this session
        // searching the folder the person just picked — they lose the memory, not the choice.
        // A refused write leaves the folder in force as it was (TYTO-206).
        if (await remember({ templatesFolder: chosen ?? null })) await sources.reload(chosen);
        return inForce();
      },
    },
    workspace: {
      state: () => workspace.state(),
      setFolder: async (choose) => {
        if (!choose) {
          return switchingFolder(() => workspace.close());
        }
        // Main's picker, never a path from the window (ADR 0113). Dismissed, nothing changes.
        const answer = await dialog.showOpenDialog({ properties: ['openDirectory'] });
        const chosen = answer.canceled ? undefined : answer.filePaths[0];
        if (chosen === undefined) return workspace.state();
        return switchingFolder(() => workspace.open(chosen));
      },
      recent: async () => ({ folders: await recentFolders.listing(workspace.state().folder) }),
      openRecent: async (id) => {
        // Main finds the folder in the list it wrote; then the picker's own door (ADR 0113).
        const chosen = await recentFolders.chosen(id, workspace.state().folder);
        if (chosen === undefined) return workspace.state();
        return switchingFolder(() => workspace.open(chosen));
      },
      setTrust: async (trusted, source) => {
        const done = trusted ? await workspace.grant(source) : await workspace.revoke(source);
        const state = workspace.state();
        if (done.ok) return state;
        // A trust.json that cannot be written: said in the problems panel, nothing changed.
        const failures = done.error.map(({ range: _range, ...row }) => row);
        return { ...state, problems: [...state.problems, ...failures] };
      },
    },
    pluginFiles: { sync: (update) => syncPluginFiles(update) },
    // TYTO-504: the gallery writes the machine's plugin files, then syncs them as the command
    // does, never moving a ref the person did not click.
    gallery: createDesktopGallery({
      home: pluginsHome,
      index: () => galleryIndex,
      sync: () => syncPluginFiles(false),
    }),
    cli,
    terminals,
    explorer,
    delivery: createDeliveryService({ layout: () => workspace.deliveryLayout() }),
    queue: {
      service: queue,
      // `createDirectory`, for the export's reason: a queue folder may not exist yet.
      chooseFolder: async () => {
        const answer = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
        });
        return answer.canceled ? undefined : answer.filePaths[0];
      },
      remember,
    },
    settings: {
      open: async (documentId) => {
        // Created on first open, with a line saying what it is: an empty file in an editor
        // tab says nothing about what may go in it.
        const missing = await access(settingsFile).then(
          () => false,
          () => true,
        );
        if (missing) {
          liveSettings.wrote(NEW_SETTINGS_FILE);
          await writeFile(settingsFile, NEW_SETTINGS_FILE, 'utf8').catch(() => undefined);
        }
        return documents.openPath(documentId, settingsFile, 'settings.json');
      },
      validate: ({ documentId, text, dirty }) => liveSettings.validate(documentId, text, dirty),
      closed: (documentId) => liveSettings.closed(documentId),
      // Read off the registry's schemas once the installed plugins have started, with the
      // themes they registered as the `theme` setting's values (TYTO-304, ADR 0092).
      outline: async () => {
        await pluginsSettled;
        return settingsOutline(declared(), await themes.list());
      },
    },
    keybindings: {
      open: async (documentId) => {
        // Created on first open, as settings.json is; the only write the app makes to it.
        const missing = await access(keybindingsFile).then(
          () => false,
          () => true,
        );
        if (missing) {
          // In the window's language when it is created (TYTO-334); never rewritten after.
          const seed = newKeybindingsFile(uiLocale);
          liveKeybindings.wrote(seed);
          await writeFile(keybindingsFile, seed, 'utf8').catch(() => undefined);
        }
        return documents.openPath(documentId, keybindingsFile, 'keybindings.json');
      },
      read: () => liveKeybindings.read().catch(() => ''),
    },
    snippets: {
      open: async (documentId) => {
        // Created on first open with a comment saying what goes in it, as the other two are.
        const missing = await access(snippetsFile).then(
          () => false,
          () => true,
        );
        if (missing) {
          const seed = newSnippetsFile(uiLocale);
          liveSnippets.wrote(seed);
          await writeFile(snippetsFile, seed, 'utf8').catch(() => undefined);
        }
        return documents.openPath(documentId, snippetsFile, 'snippets.json');
      },
      read: () => liveSnippets.read().catch(() => ''),
    },
    // Read on every ask, not held: `tyto plugin install` in a terminal beside the window is
    // the ordinary way a plugin arrives, and a list cached at startup would never show it.
    plugins: {
      folder: join(pluginsHome, PLUGINS_DIR),
      // `has`, never `get`: the screen learns whether a key is set and nothing else (TYTO-187).
      list: () =>
        listPlugins(
          [...exporterBuiltIns(), ...host.registry.plugins()],
          pluginStore,
          credentials.has,
        ),
    },
    panels,
    // The themes the `theme` setting chooses, and the picker (TYTO-208). A choice is written
    // through the settings store like any screen's, so it lands in an open settings tab with
    // unsaved typing instead of under it (ADR 0073, decision 8); a refused write puts the
    // setting back through `apply`, and the answer is what applies after either.
    themes: {
      list: () => themes.list(),
      current: () => applying(themes.current()),
      preview: (id) => applying(themes.preview(id)),
      choose: async (id) => {
        const next = await themes.choose(id, themeSetting);
        let persisted = true;
        if (next !== undefined) {
          themeSetting = next;
          persisted = await remember({ theme: next });
        }
        return { applied: await applying(themes.current()), saved: persisted };
      },
      iconStrokeWidth: () => iconStrokeWidth,
      statusBarItems: () => statusBarItems,
      statusBarColors: () => statusBarColors,
      vimMode: () => vimMode,
      vimPlugins: () => vimPlugins,
      vimModeStyle: () => vimModeStyle,
      indentGuides: () => indentGuides,
      stickyScroll: () => stickyScroll,
      tabSize: () => tabSize,
      formatBriefOnSave: () => formatBriefOnSave,
      briefColumns: () => briefColumns,
      lineNumbers: () => lineNumbers,
      commandsOrder: () => commandsOrder,
      commandsFoldOlderRuns: () => commandsFoldOlderRuns,
      typography: () => typography,
    },
    // View > Zoom and its keys (TYTO-272): applied at once and written as a screen's change, so
    // a refused write (a file that does not parse) puts the zoom before back through `apply`.
    zoom: async (step: ZoomStep) => {
      const before = windowZoom;
      const next = steppedZoom(before, step);
      if (next === before) return { zoom: before, saved: true };
      applyZoom(next);
      const written = await remember({ zoom: next });
      return { zoom: written ? next : before, saved: written };
    },
    // "Editor: turn vim mode on or off" (TYTO-333): written as a screen's change, so the choice
    // survives a restart. A refused write (a file that does not parse) keeps the setting before,
    // and the answer says which is in force, so the window goes back to it.
    vimMode: async (on: boolean) => {
      if (on === vimMode) return { vimMode, saved: true };
      const written = await remember({ vimMode: on });
      if (written) vimMode = on;
      return { vimMode, saved: written };
    },
    // Help > Documentation (TYTO-318): the edition of the language the menu is in, which is the
    // one `app:locale` last set. A locale with no edition opens nothing, and the log says so.
    openDocumentation: () => {
      if (!openDocumentation(uiLocale, openExternal)) {
        log.warn(`No manual edition for locale ${uiLocale}`);
      }
    },
    // After `ready`, as the panels are, so the window's first answer is the whole list.
    keymaps: async () => {
      await contributed.ready;
      return contributed.keymaps().map(({ plugin, keymap }) => ({
        plugin,
        id: keymap.id,
        bindings: { ...keymap.bindings },
        ...(keymap.mode === undefined ? {} : { mode: keymap.mode }),
        ...(keymap.when === undefined ? {} : { when: keymap.when }),
      }));
    },
    // The built-in plugin's vim contributions first, then the installed plugins' (TYTO-418), so
    // a key two of them map stays the built-in's: the window refuses the second (ADR 0141).
    vim: async () => {
      await contributed.ready;
      const builtIn = host.registry.vim().map((contribution) => ({
        plugin: desktopManifest.name,
        contribution,
      }));
      return [...builtIn, ...contributed.vim()].map(({ plugin, contribution }) => ({
        plugin,
        id: contribution.id,
        ...(contribution.title === undefined ? {} : { title: contribution.title }),
        mappings: contribution.mappings.map((mapping) => ({
          keys: mapping.keys,
          operation: mapping.operation,
          ...(mapping.context === undefined ? {} : { context: mapping.context }),
          ...(mapping.args === undefined ? {} : { args: { ...mapping.args } }),
        })),
        ...(contribution.ex === undefined
          ? {}
          : { ex: contribution.ex.map((entry) => ({ ...entry })) }),
      }));
    },
    preview,
    recipes,
    templates,
    templateEditor,
    templateFolder,
    updates,
    templateDialogs: {
      // No `createDirectory`: a template to edit is a folder that already has one in it.
      chooseTemplate: async () => {
        const answer = await dialog.showOpenDialog({ properties: ['openDirectory'] });
        return answer.canceled ? undefined : answer.filePaths[0];
      },
      // `createDirectory`, for the export's reason: this is a destination.
      chooseParent: async () => {
        const answer = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
        });
        return answer.canceled ? undefined : answer.filePaths[0];
      },
    },
    info: () => ({
      version: app.getVersion(),
      platform: process.platform,
      // The system's locale, resolved to one this app has. `pt-BR` is where an unknown one
      // lands, which is a default rather than a hardcoded choice: a machine set to English
      // opens in English without anybody editing a file.
      locale: localeFor(app.getLocale()),
      // Read off the host rather than off the pack, which is the point of registering it
      // there: what the window reports is what the extension point actually holds, so a
      // built-in that failed to activate shows as an empty list instead of showing nothing.
      templates: host.registry
        .templatePacks()
        .flatMap((pack) => pack.templates.map((template) => template.name))
        .sort(),
    }),
  });

  mainWindow = createMainWindow({
    preload: join(here, '..', 'preload', 'index.cjs'),
    renderer: devServerUrl === undefined ? { file: bundledRenderer(here) } : { url: devServerUrl },
    // `TYTO_HEADLESS` is the end-to-end suite's: it drives the window through Playwright
    // and has no screen to show one on. The only thing a test changes about the shipped app.
    show: process.env['TYTO_HEADLESS'] !== '1',
    frame: frameOptions(process.platform, titleBarColours()),
  });

  // **Three doors, one latch** (TYTO-123, TYTO-250). They are not redundant and dropping any
  // one of them is a silent regression:
  //
  // `close` is the X button and `Mod-W`. On win32 and linux it destroys the renderer first
  // and only *then* runs `window-all-closed` → `app.quit()` → `before-quit`, so a guard that
  // waited for `before-quit` would be asking a window that no longer exists — which is
  // precisely the door this card is named after.
  //
  // `before-quit` is Cmd+Q, the macOS dock's Quit, and a shutdown. On macOS closing the last
  // window quits nothing, so `close` alone would leave that platform unguarded.
  //
  // `will-prevent-unload` is the page's own `window.close()`, which fires neither of the other
  // two before the window is gone — measured: `closed → before-quit → will-quit`, the session's
  // final write never sent. The page vetoes the unload (`holdPageClose`), and `mayUnload` sends
  // the veto to this latch, overrules it once the latch is granted — `BrowserWindow.close()`
  // runs `beforeunload` too, so the X button needs that — and lets a reload main started
  // through untouched.
  //
  // The guard is shared, so whichever fires second finds the permission the first one already
  // got instead of putting a second dialog in front of one click.
  mainWindow.on('close', (event) => {
    // On macOS closing the window quits nothing and the terminals keep running, so only the
    // platforms where the last window's close is the quit ask about them here.
    if (process.platform !== 'darwin' && !terminalsMayQuit()) {
      event.preventDefault();
      return;
    }
    if (!exit.mayExit(() => mainWindow?.close())) event.preventDefault();
  });

  // The `zoom` setting on every page the window loads (TYTO-272): set once here and again at
  // each load, since a reload is a new page and nothing promises Electron keeps the level.
  applyZoom(windowZoom);
  mainWindow.webContents.on('did-finish-load', () => {
    applyZoom(windowZoom);
  });

  // The arrow that moved an open menu to its neighbour reaches the page once the list is
  // gone, where the row and the editor would act on it a second time (TYTO-263).
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (leakedArrow.take(input)) event.preventDefault();
  });

  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const contents = mainWindow?.webContents;
    const navigating = contents?.isWaitingForResponse() ?? false;
    if (mayUnload(exit, navigating, () => mainWindow?.close())) event.preventDefault();
  });

  app.on('before-quit', (event) => {
    if (!terminalsMayQuit()) {
      event.preventDefault();
      return;
    }
    if (
      !exit.mayExit(() => {
        app.quit();
      })
    )
      event.preventDefault();
  });

  // **The other end of the no-deadline wait** (TYTO-147, ADR 0031). Once the window has
  // acknowledged, main waits for the person with no clock of its own, so something has to say
  // when there is no longer a person to wait for. These events are that something, and they are
  // the only liveness signal main has that is not taken at send time.
  //
  // Three, because they are different deaths and no two of them cover the third:
  // `render-process-gone` is the renderer crashing or being killed while the box is still up;
  // `closed` is the window going away by any other route; and a **navigation** is the page that
  // had the question being replaced while its process lives on. On the ordinary quit they fire
  // and do nothing, because `release` cleared the outstanding question before the window went —
  // which is exactly why `windowGone` delegates to `release` instead of setting the latch itself.
  mainWindow.webContents.on('render-process-gone', () => {
    exit.windowGone();
  });

  mainWindow.on('closed', () => {
    exit.windowGone();
  });

  // **Measured, against the built app, and it is why this third hook exists.** A reload keeps the
  // renderer *process* and throws its JS context away, so neither event above fires and nothing
  // was left to end the unbounded wait: with a box on screen, one `page.reload()` left `pending`
  // set forever, every later quit refused by `mayExit`, the X button refused with it — an app
  // that could never be closed again. Reload is reachable in the shipped build through
  // DevTools (`menu.ts` keeps `toggleDevTools`), which is the whole premise of TYTO-104.
  //
  // The outgoing page is the one that had the question, and it takes every unsaved document with
  // it (TYTO-104) — so there is nothing left to protect here either, which is `windowGone`'s own
  // argument. `isSameDocument` is excluded because a fragment or `pushState` navigation keeps the
  // context, the listener and the person; on the first load nothing is outstanding and `release`
  // returns early, exactly as it does for the other two.
  mainWindow.webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) exit.windowGone();
  });

  void updates.start();

  app.on('window-all-closed', () => {
    // macOS keeps an app alive with no windows; every other platform does not.
    // Nothing is disposed on the way out: the host's registrations are in-process and the
    // process is ending. `disposePlugin` is for a plugin being uninstalled while the app
    // runs, which is E11's, not for shutdown.
    if (process.platform !== 'darwin') app.quit();
  });
}

// **The `.catch` is the card, not a tidy-up** (TYTO-140). `start` is `async`, so anything it
// throws — `builtInTemplatesDirectory()` is a bare `createRequire(...).resolve(...)` with no
// `Result`, and it is the one that has actually failed in a packaged app — comes back as a
// rejected promise. Without this the process stays alive with no window, having written a log
// line nobody can reach, and the person who double-clicked watches nothing happen.
void app
  .whenReady()
  .then(start)
  .catch((reason: unknown) => {
    reportCrash(reason);
  });
