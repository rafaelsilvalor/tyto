import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  type BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  net,
  safeStorage,
  protocol,
  shell,
} from 'electron';
import {
  PLUGINS_DIR,
  fsInbox,
  fsPluginStore,
  installedPacks,
  nodeFileSystem,
  withoutRefused,
} from '@tyto/io';
import { NO_PLUGINS, createPluginHost } from '@tyto/plugin-api';
import type { Rasterizer } from '@tyto/raster';

import { type Locale, localeFor, translate } from '../../shared/i18n/index.js';
import { fileCredentialStore } from './credential-store.js';
import { createCredentials } from './credentials.js';
import { createDocumentService } from './documents.js';
import { createExportService } from './export.js';
import { desktopCapabilities, startDesktopPlugins } from './installed-plugins.js';
import { fileLayoutStore } from './layout-store.js';
import { crashSummary, fileLog, installCrashHandlers } from './log.js';
import { menuTemplate } from './menu.js';
import { fileRecentFiles } from './recent-files.js';
import { registerIpcHandlers, sendIpcEvent } from './ipc.js';
import { exporterBuiltIns, listPlugins, tytoHome } from './plugin-list.js';
import { activateBuiltIns, builtInTemplatesDirectory } from './plugins.js';
import { bundledNodeLauncher, bundledNodePaths } from './plugin-process.js';
import { offerPreviousVersion } from './previous-version.js';
import { createQueueService } from './queue.js';
import { createPanelService } from './panels.js';
import { PLUGIN_SCHEME, confinedPath, contentTypeOf, panelPolicy } from './plugin-protocol.js';
import { type WindowPlugins, windowPlugins } from './window-plugins.js';
import { createPreviewService } from './preview.js';
import { createProjectSources } from './project.js';
import { createTemplateEditor } from './template-editor.js';
import { createExitGuard } from './quit.js';
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

  // The language everything main draws is in: the menu, and the crash box below. It starts as
  // the system's, because that is the only one main has before the window has said anything,
  // and `app:locale` replaces it when the footer picker moves (TYTO-124).
  let uiLocale: Locale = localeFor(app.getLocale());

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
          onRevealLogs: () => {
            void shell.openPath(log.directory);
          },
          // The id and nothing else. Main does not know what `editor.save` does, and the whole
          // point of the table in `shared/commands.ts` is that it never needs to.
          onCommand: (id) => {
            const contents = mainWindow?.webContents;
            if (contents === undefined || contents.isDestroyed()) return;
            sendIpcEvent(contents, 'command:run', { id });
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
  // over the module-level fallback as soon as there is a folder worth naming.
  reportCrash = (reason) => {
    dialog.showErrorBox(
      translate(uiLocale, 'crash.title'),
      `${crashSummary(reason)}\n\n${translate(uiLocale, 'crash.detail')}\n${log.directory}`,
    );
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
  const host = await activateBuiltIns({ fileSystem, log });
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
  const settings = fileSettingsStore(join(app.getPath('userData'), 'settings.json'));
  const saved = await settings.read();
  const sources = await createProjectSources({
    fileSystem,
    builtIn: builtInTemplatesDirectory(),
    // Spread rather than `?? undefined`, because `exactOptionalPropertyTypes` tells an absent
    // key and an explicit `undefined` apart and the option wants the first.
    ...(saved.templatesFolder === null ? {} : { folder: saved.templatesFolder }),
  });

  // Opening and saving, and the only object in this app that knows where the open brief
  // is. The dialogs are wrapped here rather than inside the service for the usual reason —
  // `dialog` is an Electron API, and a service that named one could not be tested without
  // launching one (E9.8).
  const documents = createDocumentService({
    recent: fileRecentFiles(join(app.getPath('userData'), 'recent-files.json')),
    dialogs: {
      openBrief: async () => {
        const answer = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Brief', extensions: ['brief'] }],
        });
        return answer.canceled ? undefined : answer.filePaths[0];
      },
      saveBrief: async (suggested) => {
        const answer = await dialog.showSaveDialog({
          ...(suggested === undefined ? {} : { defaultPath: suggested }),
          filters: [{ name: 'Brief', extensions: ['brief'] }],
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
  const capabilities = desktopCapabilities(credentials, (url, init) => net.fetch(url, init));

  // The export, composed here for the reason everything else is (ADR 0010): it needs a
  // `Rasterizer`, and the only place allowed to know which adapter exists is this file. It
  // is read back out of the plugin registry rather than constructed a second time — what
  // exports is what TYTO-133 registered, which is the claim the extension point makes.
  // Installed plugins, started once for the app's life, each in a process of its own on the
  // Node bundled with the app, under its permission model (ADR 0049, ADR 0050) — never in main.
  // What they can reach is behind their declared permissions: `net.fetch` for the network,
  // and `safeStorage`, through the same `credentials`, for secrets (ADR 0042).
  // Not awaited: the window opens while they start, and the export waits for them.
  const plugins = startDesktopPlugins({
    store: pluginStore,
    launch: bundledNodeLauncher({
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
    }),
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
  const preview = await createPreviewService({
    fileSystem,
    sources,
    directives: contributed,
    brandKits: contributed,
  });

  // The template mode (TYTO-44). The same `sources` as the preview, so a save that reads the
  // folders again is seen by the preview, the export and the picker with nothing rebuilt.
  const templateEditor = createTemplateEditor({ sources, directives: contributed.resolver });

  const panels = createPanelService(contributed, capabilities);
  servePluginPages(contributed, (name) => pluginStore.directoryOf(name));

  const exports_ = await createExportService({
    fileSystem,
    log,
    sources,
    plugins: checked,
    version: app.getVersion(),
    ...(host.registry.rasterizers<Rasterizer>()[0]?.value === undefined
      ? {}
      : { rasterizer: host.registry.rasterizers<Rasterizer>()[0]!.value }),
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
      const contents = mainWindow?.webContents;
      if (contents === undefined || contents.isDestroyed()) return;
      sendIpcEvent(contents, 'queue:changed', {});
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

  // The one question main asks. `send` is deliberately the whole of what this file lends it:
  // `quit.ts` holds the latch and the ids and knows nothing about Electron, which is what
  // lets the decision be tested without launching one (ADR 0010).
  const exit = createExitGuard({
    send: (askId) => {
      const contents = mainWindow?.webContents;
      if (contents === undefined || contents.isDestroyed()) return false;
      sendIpcEvent(contents, 'app:exit-requested', { askId });
      return true;
    },
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
      const contents = mainWindow?.webContents;
      if (contents === undefined || contents.isDestroyed()) return;
      sendIpcEvent(contents, 'update:changed', {});
    },
    quit: () => {
      app.quit();
    },
    openExternal: (url) => {
      void shell.openExternal(url);
    },
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
    credentials,
    documents,
    exit,
    exports: exports_,
    // `dialog` and `shell` are Electron main-process APIs, so they are wrapped here and the
    // handlers take functions — the same arrangement the brief dialogs above already have.
    folders: {
      choose: async () => {
        const answer = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
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
    log,
    // `localeFor` and not a cast: the window sends a string and this is the one place that
    // decides what an unrecognised one means, which is the same fallback `app:info` uses.
    menu: {
      setLocale: (locale) => {
        installMenu(localeFor(locale));
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
        await settings.write({ templatesFolder: chosen ?? null });
        await sources.reload(chosen);
        return inForce();
      },
    },
    queue: {
      service: queue,
      // `createDirectory`, for the export's reason: a queue folder may not exist yet.
      chooseFolder: async () => {
        const answer = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
        });
        return answer.canceled ? undefined : answer.filePaths[0];
      },
      remember: (changes) => settings.write(changes),
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
    preview,
    templates,
    templateEditor,
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
  });

  // **Two doors, one latch** (TYTO-123). They are not redundant and dropping either one is a
  // silent regression:
  //
  // `close` is the X button and `Mod-W`. On win32 and linux it destroys the renderer first
  // and only *then* runs `window-all-closed` → `app.quit()` → `before-quit`, so a guard that
  // waited for `before-quit` would be asking a window that no longer exists — which is
  // precisely the door this card is named after.
  //
  // `before-quit` is Cmd+Q, the macOS dock's Quit, and a shutdown. On macOS closing the last
  // window quits nothing, so `close` alone would leave that platform unguarded.
  //
  // The guard is shared, so whichever fires second finds the permission the first one already
  // got instead of putting a second dialog in front of one click.
  mainWindow.on('close', (event) => {
    if (!exit.mayExit(() => mainWindow?.close())) event.preventDefault();
  });

  app.on('before-quit', (event) => {
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
