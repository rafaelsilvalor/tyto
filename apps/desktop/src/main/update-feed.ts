import { z } from 'zod';

import { compareVersions, parseVersion } from './previous-version.js';

/**
 * Where an update comes from, and which platforms may install one (TYTO-131, ADR 0069).
 *
 * **No Electron import**, for `quit.ts`'s reason: everything that decides anything is here and
 * unit-tested, and `updates.ts` holds the wiring.
 *
 * **The feed is found by this file, not by electron-updater.** Its `github` provider asks
 * GitHub for the repository's _Latest_ release (`/releases/latest`) and reads `latest.yml` out
 * of it. This repository publishes a release per `@tyto/*` package beside the desktop ones —
 * 13 of them next to `desktop-v0.6.0` on 2026-10-06 — and `desktop-v0.6.0` was Latest only
 * because it was published last. The next Version Packages merge would make a package release
 * Latest, and every installed app would then ask `@tyto/core@x/latest.yml` for an update. So
 * the newest `desktop-v*` release is looked up here, by semver, and electron-updater is handed
 * that one release's download folder through its `generic` provider.
 */

export const DESKTOP_TAG_PREFIX = 'desktop-v';

const REPOSITORY = 'rafaelsilvalor/tyto';

/**
 * One page of 100, unauthenticated.
 *
 * The REST list and not the Atom feed: the feed carries the ten newest releases, and one
 * Version Packages merge has created thirteen at once, which would push the desktop release
 * off it. Unauthenticated calls get 60 an hour per address; this is one per launch.
 */
export const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;

/** The folder a release's assets download from; `latest.yml` and the installers sit in it. */
export function releaseDownloads(tag: string): string {
  return `https://github.com/${REPOSITORY}/releases/download/${tag}/`;
}

/** The page a person is sent to on a platform that cannot install by itself. */
export function releasePage(tag: string): string {
  return `https://github.com/${REPOSITORY}/releases/tag/${tag}`;
}

export interface DesktopRelease {
  readonly tag: string;
  readonly version: string;
}

/**
 * Field by field, and loosely: an entry this does not recognise is skipped rather than failing
 * the listing, because the listing holds every release in the repository and only some of them
 * are this app's.
 */
const releaseEntry = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
});

export type Lookup<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/**
 * The newest published `desktop-v*` release in a GitHub release listing, or `undefined`.
 *
 * - **Drafts and prereleases are skipped.** A draft is what `desktop.yml` makes before anybody
 *   has looked at it (`docs/git-workflow.md`), and a prerelease is somebody saying "not for
 *   everyone yet".
 * - **Newest by semver, never by date.** A `0.6.1` published after `0.7.0` is a fix for the
 *   old line and must not move a `0.7.0` back.
 * - **A tag that is not `desktop-v<semver>` is absent, not an error.** The listing is the
 *   whole repository's, and a malformed tag of ours is one release nobody can update to.
 *
 * Only a body that is not a list at all is a failure: that is a feed that broke.
 */
export function newestDesktopRelease(listing: unknown): Lookup<DesktopRelease | undefined> {
  if (!Array.isArray(listing)) {
    return { ok: false, reason: 'the release listing is not a list' };
  }
  let newest:
    { release: DesktopRelease; parsed: NonNullable<ReturnType<typeof parseVersion>> } | undefined;
  for (const entry of listing) {
    const parsedEntry = releaseEntry.safeParse(entry);
    if (!parsedEntry.success) continue;
    const { tag_name: tag, draft, prerelease } = parsedEntry.data;
    if (draft || prerelease || !tag.startsWith(DESKTOP_TAG_PREFIX)) continue;
    const version = tag.slice(DESKTOP_TAG_PREFIX.length);
    const parsed = parseVersion(version);
    if (parsed === undefined) continue;
    if (newest === undefined || compareVersions(parsed, newest.parsed) > 0) {
      newest = { release: { tag, version }, parsed };
    }
  }
  return { ok: true, value: newest?.release };
}

/** Whether `candidate` is a later version than `current`. Unparseable reads as no. */
export function isNewer(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (next === undefined || now === undefined) return false;
  return compareVersions(next, now) > 0;
}

/**
 * Which feed this build reads.
 *
 * `github` is every build `desktop.yml` makes. `local` exists for one suite,
 * `e2e/update.package.test.ts`, which packages two versions and serves the newer one on
 * loopback; it reaches the app as a `tytoUpdateFeed` field electron-builder's `extraMetadata`
 * writes into the packaged `package.json`, so a build that was not given one cannot carry one,
 * and `packaged.package.test.ts` reads the field's absence out of the ordinary package.
 */
export type UpdateFeed =
  { readonly kind: 'github' } | { readonly kind: 'local'; readonly url: string };

/**
 * The feed named in the app's own `package.json`, defaulting to GitHub.
 *
 * **Loopback only.** A `tytoUpdateFeed` that names any other host is ignored, so even a test
 * build that escaped could not be pointed at a server somebody else runs: an unsigned
 * installer from a feed is code that runs as the person (ADR 0069).
 */
export function updateFeedFrom(manifest: unknown): Lookup<UpdateFeed> {
  const field =
    typeof manifest === 'object' && manifest !== null
      ? (manifest as Record<string, unknown>)['tytoUpdateFeed']
      : undefined;
  if (field === undefined) return { ok: true, value: { kind: 'github' } };
  if (typeof field !== 'string') {
    return { ok: false, reason: 'tytoUpdateFeed is not a string' };
  }
  let url: URL;
  try {
    url = new URL(field);
  } catch {
    return { ok: false, reason: `tytoUpdateFeed is not a URL: ${field}` };
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    return { ok: false, reason: `tytoUpdateFeed is not a loopback http URL: ${field}` };
  }
  return { ok: true, value: { kind: 'local', url: field.endsWith('/') ? field : `${field}/` } };
}

/**
 * What this copy of the app can do about a newer version.
 *
 * - `install`: download it in the background and replace this copy when it quits.
 * - `link`: say there is one and send the person to the release page.
 * - `off`: say nothing.
 */
export type UpdateRoute =
  { readonly route: 'install' } | { readonly route: 'link' | 'off'; readonly why: string };

export interface RouteFacts {
  readonly packaged: boolean;
  readonly platform: NodeJS.Platform;
  /** `PORTABLE_EXECUTABLE_DIR`, which electron-builder's portable launcher sets. */
  readonly portableDirectory: string | undefined;
  /** `APPIMAGE`, which the AppImage runtime sets to the file it was started from. */
  readonly appImage: string | undefined;
}

/**
 * The per-platform table ADR 0069 argues, as code.
 *
 * - **Windows, installed**: `install`. Unsigned, so `app-update.yml` has no `publisherName`
 *   and electron-updater's signature check returns early (`NsisUpdater.verifySignature`); what
 *   holds the download to the release is the sha512 in `latest.yml`, fetched over HTTPS.
 * - **Windows, portable**: `link`. The portable is unpacked from the same `win-unpacked` the
 *   installer is, so it carries the same `app-update.yml`, and electron-updater would run the
 *   _Setup_ over it — turning a copy somebody carries on a stick into an installed one.
 * - **Linux, AppImage**: `install`. The file named by `APPIMAGE` is replaced in place.
 *   A Linux build started any other way (the `--dir` folder) has no file to replace.
 * - **macOS**: `link`. Squirrel.Mac installs only into a signed app, and Tyto has no
 *   certificate (`docs/git-workflow.md`).
 * - **Not packaged** (`pnpm dev`, every `test:desktop` launch): `off`.
 */
export function updateRoute(facts: RouteFacts): UpdateRoute {
  if (!facts.packaged) return { route: 'off', why: 'not a packaged build' };
  switch (facts.platform) {
    case 'win32':
      return facts.portableDirectory === undefined
        ? { route: 'install' }
        : { route: 'link', why: 'a portable copy is never replaced by the installer' };
    case 'linux':
      return facts.appImage === undefined
        ? { route: 'link', why: 'not started from an AppImage' }
        : { route: 'install' };
    case 'darwin':
      return { route: 'link', why: 'macOS installs updates only into a signed app' };
    default:
      return { route: 'off', why: `no update route for ${facts.platform}` };
  }
}

export interface CheckFacts {
  readonly feed: UpdateFeed;
  /** `TYTO_HEADLESS=1`: an end-to-end suite with nobody in front of the window. */
  readonly headless: boolean;
  /** `--user-data-dir` was passed: a suite's scratch folder (ADR 0032). */
  readonly explicitUserData: boolean;
}

/**
 * Whether this launch asks a feed at all.
 *
 * A suite never asks GitHub: a packaged suite that downloaded a real release because one
 * happened to be newer would be measuring the network. A build carrying a local feed always
 * asks, because asking is what it was built to be measured doing.
 */
export function shouldCheck(facts: CheckFacts): boolean {
  if (facts.feed.kind === 'local') return true;
  return !facts.headless && !facts.explicitUserData;
}
