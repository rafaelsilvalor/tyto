import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { type BrowserWindow, Menu, app, dialog, ipcMain, safeStorage, shell } from 'electron';
import { nodeFileSystem } from '@tyto/io';
import type { Rasterizer } from '@tyto/raster';

import { type Locale, localeFor, translate } from '../../shared/i18n/index.js';
import { fileCredentialStore } from './credential-store.js';
import { createCredentials } from './credentials.js';
import { createDocumentService } from './documents.js';
import { createExportService } from './export.js';
import { fileLayoutStore } from './layout-store.js';
import { crashSummary, fileLog, installCrashHandlers } from './log.js';
import { menuTemplate } from './menu.js';
import { fileRecentFiles } from './recent-files.js';
import { registerIpcHandlers, sendIpcEvent } from './ipc.js';
import { activateBuiltIns, builtInTemplatesDirectory } from './plugins.js';
import { createPreviewService } from './preview.js';
import { createProjectSources } from './project.js';
import { createExitGuard } from './quit.js';
import { fileSettingsStore } from './settings-store.js';
import { createTemplateCatalogue } from './templates.js';
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
try {
  const userData = chooseUserDataPath({
    appData: app.getPath('appData'),
    version: app.getVersion(),
    explicitUserDataDir: app.commandLine.hasSwitch('user-data-dir')
      ? app.commandLine.getSwitchValue('user-data-dir')
      : undefined,
  });
  if (userData !== undefined) app.setPath('userData', userData);
} catch (reason) {
  reportCrash(reason);
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

  // The registry is read before the window opens, not after: the renderer's first question
  // is which templates exist, and answering it with "not yet" would put a loading state in
  // front of every panel for the lifetime of a decision made at startup.
  const fileSystem = nodeFileSystem();
  const host = await activateBuiltIns({ fileSystem, log });

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

  // Built before the window, for the same reason the registry is: the preview's first
  // answer should not wait on a folder read that could have happened during startup. It
  // reads the same pack the host registered, through the same resolver.
  //
  // It is told no folder here. Which folder a compile resolves against is a property of the
  // tab the brief is in, and `ipc.ts` looks it up per request from the id that came with
  // it (E9.11) — a service holding one folder assumed one open document.
  const preview = await createPreviewService({ fileSystem, sources });

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

  // The export, composed here for the reason everything else is (ADR 0010): it needs a
  // `Rasterizer`, and the only place allowed to know which adapter exists is this file. It
  // is read back out of the plugin registry rather than constructed a second time — what
  // exports is what TYTO-133 registered, which is the claim the extension point makes.
  const exports_ = await createExportService({
    fileSystem,
    log,
    sources,
    version: app.getVersion(),
    ...(host.registry.rasterizers<Rasterizer>()[0]?.value === undefined
      ? {}
      : { rasterizer: host.registry.rasterizers<Rasterizer>()[0]!.value }),
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
    preview,
    templates,
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
