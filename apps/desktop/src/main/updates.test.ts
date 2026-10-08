import { describe, expect, it } from 'vitest';

import { RELEASES_URL } from './update-feed.js';
import {
  type InstallingUpdater,
  type UpdateServiceOptions,
  createUpdateService,
} from './updates.js';

type Listener = (payload: never) => void;

/** electron-updater, reduced to what the service drives, with the events fired by hand. */
const fakeUpdater = (check: () => Promise<unknown> = () => Promise.resolve(null)) => {
  const listeners = new Map<string, Listener[]>();
  const calls = {
    feed: [] as string[],
    installs: [] as { silent: boolean | undefined; relaunch: boolean | undefined }[],
  };
  const updater: InstallingUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    setFeedURL: ({ url }) => {
      calls.feed.push(url);
    },
    checkForUpdates: () => check() as never,
    quitAndInstall: (silent, relaunch) => {
      calls.installs.push({ silent, relaunch });
    },
    on: ((event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    }) as never,
  };
  const emit = (event: string, payload: unknown): void => {
    for (const listener of listeners.get(event) ?? []) listener(payload as never);
  };
  return { updater, calls, emit };
};

const harness = (overrides: Partial<UpdateServiceOptions> = {}) => {
  const fake = fakeUpdater();
  const seen = {
    info: [] as string[],
    warn: [] as string[],
    changed: 0,
    quits: 0,
    opened: [] as string[],
    fetched: [] as string[],
  };
  const service = createUpdateService({
    route: { route: 'install' },
    feed: { kind: 'github' },
    check: true,
    currentVersion: '0.6.0',
    fetchJson: (url) => {
      seen.fetched.push(url);
      return Promise.resolve([
        { tag_name: '@tyto/core@0.28.0', draft: false, prerelease: false },
        { tag_name: 'desktop-v0.7.0', draft: false, prerelease: false },
      ]);
    },
    updater: () => Promise.resolve(fake.updater),
    log: {
      info: (message) => seen.info.push(message),
      warn: (message) => seen.warn.push(message),
    },
    changed: () => {
      seen.changed += 1;
    },
    quit: () => {
      seen.quits += 1;
    },
    openExternal: (url) => seen.opened.push(url),
    ...overrides,
  });
  return { service, seen, fake };
};

describe('createUpdateService', () => {
  it('points electron-updater at the newest desktop release, never at /releases/latest', async () => {
    const { service, seen, fake } = harness();
    await service.start();

    expect(seen.fetched).toEqual([RELEASES_URL]);
    expect(fake.calls.feed).toEqual([
      'https://github.com/rafaelsilvalor/tyto/releases/download/desktop-v0.7.0/',
    ]);
    expect(fake.updater.autoDownload).toBe(true);
    // One place decides when to install, and it is `quitting`.
    expect(fake.updater.autoInstallOnAppQuit).toBe(false);
  });

  it('moves from downloading to ready as electron-updater reports, telling the window each time', async () => {
    const { service, seen, fake } = harness();
    await service.start();

    fake.emit('update-available', { version: '0.7.0' });
    expect(service.status()).toEqual({ state: 'downloading', version: '0.7.0' });
    fake.emit('update-downloaded', { version: '0.7.0' });
    expect(service.status()).toEqual({ state: 'ready', version: '0.7.0' });
    expect(seen.changed).toBe(2);
  });

  it('does not load the updater when nothing is newer', async () => {
    let loaded = 0;
    const { service, seen } = harness({
      currentVersion: '0.7.0',
      updater: () => {
        loaded += 1;
        return Promise.resolve(fakeUpdater().updater);
      },
    });
    await service.start();

    expect(loaded).toBe(0);
    expect(service.status()).toEqual({ state: 'none' });
    expect(seen.info).toEqual(['Up to date: 0.7.0, newest is 0.7.0']);
  });

  it('only offers the release page on a link-only copy', async () => {
    const { service, seen, fake } = harness({ route: { route: 'link', why: 'portable' } });
    await service.start();

    expect(fake.calls.feed).toEqual([]);
    expect(service.status()).toEqual({
      state: 'available',
      version: '0.7.0',
      url: 'https://github.com/rafaelsilvalor/tyto/releases/tag/desktop-v0.7.0',
    });
    service.act();
    expect(seen.opened).toEqual([
      'https://github.com/rafaelsilvalor/tyto/releases/tag/desktop-v0.7.0',
    ]);
    expect(seen.quits).toBe(0);
  });

  it('asks nothing of the network when told not to check', async () => {
    const { service, seen } = harness({ check: false });
    await service.start();
    expect(seen.fetched).toEqual([]);
    expect(seen.info).toEqual([]);
  });

  it('goes straight to a local feed, with no listing to read', async () => {
    const { service, seen, fake } = harness({
      feed: { kind: 'local', url: 'http://127.0.0.1:9/' },
    });
    await service.start();
    expect(seen.fetched).toEqual([]);
    expect(fake.calls.feed).toEqual(['http://127.0.0.1:9/']);
  });

  describe('with no network or a broken feed', () => {
    it('logs one line and leaves the window with nothing to show', async () => {
      const { service, seen } = harness({
        fetchJson: () => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED')),
      });
      await expect(service.start()).resolves.toBeUndefined();

      expect(seen.warn).toEqual(['Update check failed: net::ERR_INTERNET_DISCONNECTED']);
      expect(service.status()).toEqual({ state: 'none' });
      expect(seen.changed).toBe(0);
    });

    it('logs one line for a body that is not a release list', async () => {
      const { service, seen } = harness({
        fetchJson: () => Promise.resolve({ message: 'API rate limit exceeded' }),
      });
      await service.start();
      expect(seen.warn).toEqual(['Update check failed: the release listing is not a list']);
    });

    it('logs one line when electron-updater both rejects and emits an error', async () => {
      const failing = fakeUpdater(() => {
        failing.emit('error', new Error('404 latest.yml\nstack…'));
        return Promise.reject(new Error('404 latest.yml'));
      });
      const { service, seen } = harness({ updater: () => Promise.resolve(failing.updater) });
      await service.start();
      expect(seen.warn).toEqual(['Update check failed: 404 latest.yml']);
    });

    it('drops a half-done download back to nothing', async () => {
      const { service, fake } = harness();
      await service.start();
      fake.emit('update-available', { version: '0.7.0' });
      fake.emit('error', new Error('socket hang up'));
      expect(service.status()).toEqual({ state: 'none' });
    });
  });

  /**
   * The unsaved-work path (TYTO-123, ADR 0039). `quit` is Electron's `quit` event, which fires
   * only after the guard let the app go; nothing installs before it.
   */
  describe('installing', () => {
    const ready = async () => {
      const made = harness();
      await made.service.start();
      made.fake.emit('update-downloaded', { version: '0.7.0' });
      return made;
    };

    it('restart asks the app to quit and installs nothing until the quit happens', async () => {
      const { service, seen, fake } = await ready();
      service.act();

      expect(seen.quits).toBe(1);
      // The guard may still say no: a tab is unsaved, the person stays, nothing was installed.
      expect(fake.calls.installs).toEqual([]);

      service.quitting(0);
      expect(fake.calls.installs).toEqual([{ silent: true, relaunch: true }]);
    });

    it('installs without restarting when the person quits on their own', async () => {
      const { service, fake } = await ready();
      service.quitting(0);
      expect(fake.calls.installs).toEqual([{ silent: true, relaunch: false }]);
    });

    it('installs nothing on a quit with a failure code', async () => {
      const { service, fake, seen } = await ready();
      service.quitting(1);
      expect(fake.calls.installs).toEqual([]);
      expect(seen.warn).toEqual(['Update 0.7.0 not installed: the app quit with code 1']);
    });

    it('installs nothing when no update was downloaded', async () => {
      const { service, fake } = harness();
      await service.start();
      fake.emit('update-available', { version: '0.7.0' });
      service.act();
      service.quitting(0);
      expect(fake.calls.installs).toEqual([]);
    });
  });
});
