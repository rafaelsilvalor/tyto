import { describe, expect, it } from 'vitest';

import {
  isNewer,
  newestDesktopRelease,
  releaseDownloads,
  shouldCheck,
  updateFeedFrom,
  updateRoute,
} from './update-feed.js';

const release = (tag: string, overrides: { draft?: boolean; prerelease?: boolean } = {}) => ({
  tag_name: tag,
  draft: overrides.draft ?? false,
  prerelease: overrides.prerelease ?? false,
});

/**
 * The listing is the whole repository's (TYTO-131, ADR 0069): thirteen `@tyto/*` releases sat
 * beside one desktop release on 2026-10-06, and `/releases/latest` named whichever was published
 * last. These pin what the lookup reads out of that mix.
 */
describe('newestDesktopRelease', () => {
  it('finds the desktop release among the package releases, whatever order they are in', () => {
    const listing = [
      release('@tyto/core@0.28.0'),
      release('desktop-v0.6.0'),
      release('@tyto/templates@1.0.0'),
    ];
    expect(newestDesktopRelease(listing)).toEqual({
      ok: true,
      value: { tag: 'desktop-v0.6.0', version: '0.6.0' },
    });
  });

  it('skips a draft', () => {
    const listing = [release('desktop-v0.7.0', { draft: true }), release('desktop-v0.6.0')];
    expect(newestDesktopRelease(listing)).toEqual({
      ok: true,
      value: { tag: 'desktop-v0.6.0', version: '0.6.0' },
    });
  });

  it('skips a prerelease', () => {
    const listing = [release('desktop-v0.7.0', { prerelease: true }), release('desktop-v0.6.0')];
    expect(newestDesktopRelease(listing)).toEqual({
      ok: true,
      value: { tag: 'desktop-v0.6.0', version: '0.6.0' },
    });
  });

  it('compares by semver, not by position or by string', () => {
    // Newest-created first, the order GitHub lists: a 0.6.1 fix published after 0.10.0 must
    // not move anybody back, and "0.10.0" sorts before "0.9.0" as a string.
    const listing = [
      release('desktop-v0.6.1'),
      release('desktop-v0.10.0'),
      release('desktop-v0.9.0'),
    ];
    expect(newestDesktopRelease(listing)).toEqual({
      ok: true,
      value: { tag: 'desktop-v0.10.0', version: '0.10.0' },
    });
  });

  it('treats a malformed tag or entry as absent, not as an error', () => {
    const listing = [
      release('desktop-vnext'),
      release('desktop-v1.0'),
      { tag_name: 'desktop-v9.9.9' },
      'not an object',
      null,
      release('desktop-v0.6.0'),
    ];
    expect(newestDesktopRelease(listing)).toEqual({
      ok: true,
      value: { tag: 'desktop-v0.6.0', version: '0.6.0' },
    });
  });

  it('answers with nothing when there is no desktop release', () => {
    expect(newestDesktopRelease([release('@tyto/core@0.27.0')])).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('fails only when the body is not a list at all', () => {
    // What GitHub sends when the unauthenticated rate limit is spent.
    const limited = { message: 'API rate limit exceeded', documentation_url: '…' };
    expect(newestDesktopRelease(limited)).toEqual({
      ok: false,
      reason: 'the release listing is not a list',
    });
  });
});

describe('isNewer', () => {
  it('says yes only for a later version', () => {
    expect(isNewer('0.7.0', '0.6.0')).toBe(true);
    expect(isNewer('0.6.0', '0.6.0')).toBe(false);
    expect(isNewer('0.5.9', '0.6.0')).toBe(false);
    expect(isNewer('0.7.0', '0.7.0-beta.1')).toBe(true);
  });

  it('says no when either side is not a version', () => {
    expect(isNewer('next', '0.6.0')).toBe(false);
    expect(isNewer('0.7.0', 'dev')).toBe(false);
  });
});

describe('releaseDownloads', () => {
  it('is the folder electron-updater reads latest.yml from', () => {
    expect(releaseDownloads('desktop-v0.7.0')).toBe(
      'https://github.com/rafaelsilvalor/tyto/releases/download/desktop-v0.7.0/',
    );
  });
});

describe('updateFeedFrom', () => {
  it('is GitHub when the manifest names no feed, which is every desktop.yml build', () => {
    expect(updateFeedFrom({ name: '@tyto/desktop', version: '0.6.0' })).toEqual({
      ok: true,
      value: { kind: 'github' },
    });
    expect(updateFeedFrom(undefined)).toEqual({ ok: true, value: { kind: 'github' } });
  });

  it('takes a loopback feed, with the trailing slash a folder URL needs', () => {
    expect(updateFeedFrom({ tytoUpdateFeed: 'http://127.0.0.1:47131' })).toEqual({
      ok: true,
      value: { kind: 'local', url: 'http://127.0.0.1:47131/' },
    });
  });

  it('refuses any other host, so a test build cannot be pointed at somebody else', () => {
    for (const feed of [
      'https://example.com/',
      'http://10.0.0.5/',
      'file:///tmp/feed',
      'nonsense',
    ]) {
      expect(updateFeedFrom({ tytoUpdateFeed: feed }).ok, feed).toBe(false);
    }
  });
});

describe('updateRoute', () => {
  const facts = {
    packaged: true,
    platform: 'win32' as NodeJS.Platform,
    portableDirectory: undefined,
    appImage: undefined,
  };

  it('installs on an installed Windows copy', () => {
    expect(updateRoute(facts)).toEqual({ route: 'install' });
  });

  it('only links on a portable Windows copy, which the Setup must not replace', () => {
    expect(updateRoute({ ...facts, portableDirectory: 'D:\\stick' }).route).toBe('link');
  });

  it('installs on a Linux AppImage and links on anything else Linux runs', () => {
    expect(updateRoute({ ...facts, platform: 'linux', appImage: '/home/a/Tyto.AppImage' })).toEqual(
      {
        route: 'install',
      },
    );
    expect(updateRoute({ ...facts, platform: 'linux' }).route).toBe('link');
  });

  it('only links on macOS, which installs only into a signed app', () => {
    expect(updateRoute({ ...facts, platform: 'darwin' }).route).toBe('link');
  });

  it('is off when the app is not packaged', () => {
    expect(updateRoute({ ...facts, packaged: false }).route).toBe('off');
  });
});

describe('shouldCheck', () => {
  const github = { kind: 'github' } as const;
  const local = { kind: 'local', url: 'http://127.0.0.1:1/' } as const;

  it('checks GitHub on a person’s launch', () => {
    expect(shouldCheck({ feed: github, headless: false, explicitUserData: false })).toBe(true);
  });

  it('never lets a suite reach GitHub', () => {
    expect(shouldCheck({ feed: github, headless: true, explicitUserData: false })).toBe(false);
    expect(shouldCheck({ feed: github, headless: false, explicitUserData: true })).toBe(false);
  });

  it('always checks a local feed, which is what that build exists to measure', () => {
    expect(shouldCheck({ feed: local, headless: true, explicitUserData: true })).toBe(true);
  });
});
