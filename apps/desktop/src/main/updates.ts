import type { UpdateStatus } from '../../shared/ipc.js';
import {
  RELEASES_URL,
  type UpdateFeed,
  type UpdateRoute,
  isNewer,
  newestDesktopRelease,
  releaseDownloads,
  releasePage,
} from './update-feed.js';

/**
 * Checking for, downloading and installing a newer version (TYTO-131, ADR 0069).
 *
 * **No Electron import.** `electron-updater` arrives through {@link UpdateServiceOptions.updater}
 * and the app's own quit through `quit`, so the order of events that matters — nothing is
 * installed until the quit guard has let the app go — is tested here without a window.
 *
 * **The install happens on Electron's `quit` event and nowhere else.** `quit` fires only after
 * `before-quit` was not prevented, which is to say after ADR 0039's guard asked the window about
 * unsaved tabs and was told yes. electron-updater's own `quitAndInstall` starts the installer
 * _first_ and quits after (`BaseUpdater.quitAndInstall`), which would run a Setup underneath a
 * person still choosing whether to save; so "Restart to update" only asks the app to quit, the
 * same request Cmd+Q makes, and {@link UpdateService.quitting} installs once that went through.
 * Its own install-on-quit is switched off for the same reason: one place decides.
 */

/** The part of electron-updater's `AppUpdater` this file drives. */
export interface InstallingUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL: (options: { provider: 'generic'; url: string }) => void;
  checkForUpdates: () => Promise<{ downloadPromise?: Promise<unknown> | null } | null>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  on: {
    (event: 'update-available', listener: (info: { version: string }) => void): unknown;
    (event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
    (event: 'error', listener: (error: Error) => void): unknown;
  };
}

export interface UpdateServiceOptions {
  readonly route: UpdateRoute;
  readonly feed: UpdateFeed;
  /** `shouldCheck`'s answer: false for a suite pointed at the real feed. */
  readonly check: boolean;
  readonly currentVersion: string;
  /** GETs a URL and parses the body as JSON. Rejects on a network or HTTP failure. */
  readonly fetchJson: (url: string) => Promise<unknown>;
  /** Loaded only when the route is `install`, so a dev build never loads the library. */
  readonly updater: () => Promise<InstallingUpdater>;
  readonly log: {
    readonly info: (message: string) => void;
    readonly warn: (message: string) => void;
  };
  /** Something in {@link UpdateService.status} changed; the window asks again. */
  readonly changed: () => void;
  /** `app.quit()`: the request Cmd+Q makes, guarded the same way. */
  readonly quit: () => void;
  readonly openExternal: (url: string) => void;
}

export interface UpdateService {
  /** Looks for a newer version. Never throws: a failure is one log line and no notice. */
  start: () => Promise<void>;
  status: () => UpdateStatus;
  /** The notice was clicked: restart into a downloaded update, or open the release page. */
  act: () => void;
  /** Wired to Electron's `quit`, which fires only once the quit guard let the app go. */
  quitting: (exitCode: number) => void;
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message.split('\n')[0]! : String(cause);

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const { route, feed, log } = options;
  let status: UpdateStatus = { state: 'none' };
  let updater: InstallingUpdater | undefined;
  let relaunch = false;
  let failed = false;

  const set = (next: UpdateStatus): void => {
    status = next;
    options.changed();
  };

  /** One line per launch, whatever broke and however many times electron-updater says so. */
  const fail = (cause: unknown): void => {
    if (failed) return;
    failed = true;
    log.warn(`Update check failed: ${messageOf(cause)}`);
    if (status.state === 'downloading') set({ state: 'none' });
  };

  /** The release a GitHub feed points at, or `undefined` when there is nothing newer. */
  const newerRelease = async (): Promise<{ tag: string; version: string } | undefined> => {
    const lookup = newestDesktopRelease(await options.fetchJson(RELEASES_URL));
    if (!lookup.ok) throw new Error(lookup.reason);
    const newest = lookup.value;
    if (newest === undefined || !isNewer(newest.version, options.currentVersion)) {
      log.info(
        `Up to date: ${options.currentVersion}` +
          (newest === undefined ? ', no desktop release found' : `, newest is ${newest.version}`),
      );
      return undefined;
    }
    return newest;
  };

  const install = async (folder: string): Promise<void> => {
    const loaded = await options.updater();
    updater = loaded;
    loaded.autoDownload = true;
    loaded.autoInstallOnAppQuit = false;
    loaded.on('error', fail);
    loaded.on('update-available', (info) => {
      log.info(`Downloading update ${info.version}`);
      set({ state: 'downloading', version: info.version });
    });
    loaded.on('update-downloaded', (info) => {
      log.info(`Update ${info.version} downloaded; it installs when the app quits`);
      set({ state: 'ready', version: info.version });
    });
    loaded.setFeedURL({ provider: 'generic', url: folder });
    const result = await loaded.checkForUpdates();
    // The download runs on after the check resolves; its failure is also an `error` event,
    // which is the one that is logged.
    result?.downloadPromise?.catch(() => undefined);
  };

  return {
    start: async () => {
      if (!options.check) return;
      if (route.route === 'off') {
        log.info(`Update check off: ${route.why}`);
        return;
      }
      try {
        if (feed.kind === 'local') {
          // A suite's build: there is no listing, the folder is the release.
          if (route.route === 'install') await install(feed.url);
          else log.info(`Update check off: a local feed on a link-only copy (${route.why})`);
          return;
        }
        const newer = await newerRelease();
        if (newer === undefined) return;
        if (route.route === 'link') {
          log.info(`Version ${newer.version} is available (${route.why})`);
          set({ state: 'available', version: newer.version, url: releasePage(newer.tag) });
          return;
        }
        await install(releaseDownloads(newer.tag));
      } catch (cause) {
        fail(cause);
      }
    },

    status: () => status,

    act: () => {
      if (status.state === 'ready') {
        relaunch = true;
        options.quit();
      } else if (status.state === 'available') {
        options.openExternal(status.url);
      }
    },

    quitting: (exitCode) => {
      if (status.state !== 'ready' || updater === undefined) return;
      // electron-updater's own rule, kept: a crash on the way out is not the moment to replace
      // the program that crashed.
      if (exitCode !== 0) {
        log.warn(
          `Update ${status.version} not installed: the app quit with code ${String(exitCode)}`,
        );
        return;
      }
      log.info(`Installing update ${status.version}${relaunch ? ' and restarting' : ''}`);
      updater.quitAndInstall(true, relaunch);
    },
  };
}
