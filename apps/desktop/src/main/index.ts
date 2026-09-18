import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { type BrowserWindow, Menu, app, dialog, ipcMain, safeStorage, shell } from 'electron';
import { nodeFileSystem } from '@tyto/io';
import type { Rasterizer } from '@tyto/raster';

import { localeFor, translate } from '../../shared/i18n/index.js';
import { fileCredentialStore } from './credential-store.js';
import { createCredentials } from './credentials.js';
import { createDocumentService } from './documents.js';
import { createExportService } from './export.js';
import { fileLayoutStore } from './layout-store.js';
import { fileLog, installCrashHandlers } from './log.js';
import { menuTemplate } from './menu.js';
import { fileRecentFiles } from './recent-files.js';
import { registerIpcHandlers, sendIpcEvent } from './ipc.js';
import { activateBuiltIns, builtInTemplatesDirectory } from './plugins.js';
import { createPreviewService } from './preview.js';
import { createExitGuard } from './quit.js';
import { createTemplateCatalogue } from './templates.js';
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
  installCrashHandlers(process, log);

  // The registry is read before the window opens, not after: the renderer's first question
  // is which templates exist, and answering it with "not yet" would put a loading state in
  // front of every panel for the lifetime of a decision made at startup.
  const fileSystem = nodeFileSystem();
  const host = await activateBuiltIns({ fileSystem, log });

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
  const preview = await createPreviewService({ fileSystem });

  // The picker's list, read once alongside the other two. Its own read rather than the
  // preview service's registry: compiling a brief and listing what is installed are two
  // reasons for one object to change, and `src/main/templates.ts` says why that matters.
  const templates = await createTemplateCatalogue({
    fileSystem,
    directory: builtInTemplatesDirectory(),
  });

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
    version: app.getVersion(),
    ...(host.registry.rasterizers<Rasterizer>()[0]?.value === undefined
      ? {}
      : { rasterizer: host.registry.rasterizers<Rasterizer>()[0]!.value }),
  });

  // The window, held rather than discarded, because main now has something to say to it
  // (ADR 0029). A `let` and not a `const`: the handler table is registered before the window
  // is built — it has to be, or the renderer's first question could arrive with nothing to
  // answer it — and both halves of the exit need the same guard.
  // Initialised explicitly rather than left bare, because a `let` assigned exactly once reads
  // to `prefer-const` as a `const` written the long way round. It is genuinely reassigned —
  // below, after the window exists.
  let mainWindow: BrowserWindow | undefined = undefined;

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

  // Before the window, because the menu is the browser process's and a key pressed while it
  // is still the default one would be handled by the default one. `menu.ts` says why this
  // app installs a menu at all.
  //
  // The menu carries exactly one string of this app's own (TYTO-132), and it is resolved here
  // against the **system's** locale rather than the window's: the picker in the footer changes
  // the renderer's locale and main is never told, so this is the only locale main has.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate(process.platform, {
        t: (key) => translate(localeFor(app.getLocale()), key),
        onRevealLogs: () => {
          void shell.openPath(log.directory);
        },
      }),
    ),
  );

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

  app.on('window-all-closed', () => {
    // macOS keeps an app alive with no windows; every other platform does not.
    // Nothing is disposed on the way out: the host's registrations are in-process and the
    // process is ending. `disposePlugin` is for a plugin being uninstalled while the app
    // runs, which is E11's, not for shutdown.
    if (process.platform !== 'darwin') app.quit();
  });
}

void app.whenReady().then(start);
