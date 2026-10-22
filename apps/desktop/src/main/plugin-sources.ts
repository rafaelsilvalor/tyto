import { type SourceCache, type SourceCall, sourceCache } from '@tyto/io';
import type {
  AssetSourceContribution,
  FontSourceContribution,
  OwnedSource,
} from '@tyto/plugin-api';

import type { SourceTrust } from './workspace.js';

/**
 * The window's images and faces from installed plugins: one source cache for the life of the
 * main process, and the rule for when a compile may fetch into it (ADR 0117, ADR 0118,
 * ADR 0119).
 *
 * **One cache, not one per compile.** The preview compiles on every pause in typing; a cache
 * per compile would forget, between two saves, that a plugin already failed a reference, and
 * ask it again — up to the plugin's 30 s deadline (ADR 0042) — on every save. So a failure is
 * remembered for the process, and the miss says how to ask again.
 *
 * **A compile fetches only when a person did something that settles the text** (ADR 0119):
 * saving the brief, opening it from disk, or exporting it. A preview while typing reads the
 * cache and asks nothing, so `test:lo` on the way to `test:logo` is never a request. The queue
 * never fetches, as `tyto watch` does not (ADR 0118). A restricted folder never fetches, and
 * its miss names the command that trusts it.
 */

/** Why a compile asks for what it asks: the four ways a brief reaches a compile here. */
export type SourceIntent = 'typing' | 'save' | 'export' | 'queue';

/** What a miss says, for each reason a compile did not fetch. Exported for the tests. */
export const NOT_FETCHED = {
  typing: 'not fetched yet: the preview asks a plugin when the brief is saved; save it to fetch',
  // Not the banner: it shows only when the folder left something out, and a folder whose
  // project file names nothing outside it has none — seen in the real window (TYTO-280).
  restricted:
    'this folder is not trusted, so no plugin fetches for it; trust it with Workspace: Manage Trust to fetch',
  restrictedElsewhere:
    "this brief's folder is not trusted, so no plugin fetches for it; open that folder and trust it with Workspace: Manage Trust to fetch",
  queue:
    'the queue never fetches from a plugin; open the brief and save it once to fetch it, and the queue reads it from then on',
  unsaved: 'not fetched: a brief fetches from a plugin once it is saved in a folder',
} as const;

/** Added to a failed fetch's own reason, because the cache will not ask again by itself. */
export const ASK_AGAIN = 'Tyto asks again after a restart, or for a different reference';

export interface DesktopSourcesOptions {
  /** `TYTO_HOME`; the cache is `cache/sources/` inside it. */
  readonly home: string;
  /** The window plugins' sources: what the preview asks. An export passes its run's own. */
  readonly assetSources: () => readonly OwnedSource<AssetSourceContribution>[];
  readonly fontSources: () => readonly OwnedSource<FontSourceContribution>[];
  /** The trust a brief's folder answers to (`workspace.ts`). */
  readonly trustFor: (briefDirectory: string | undefined) => Promise<SourceTrust | undefined>;
  /**
   * Settles when the window's plugins have started (ADR 0044), never rejecting. A compile that
   * may fetch waits for it: the tabs a session restores and a file opened in the first second
   * compile before any plugin has registered a source, and would find nobody to ask. Absent:
   * already started.
   */
  readonly ready?: Promise<void>;
}

export interface DesktopSources {
  readonly cache: SourceCache;
  /** The rule for one compile of a brief in `briefDirectory`, asked for `intent`. */
  callFor(briefDirectory: string | undefined, intent: SourceIntent): Promise<SourceCall>;
}

export function desktopSources(options: DesktopSourcesOptions): DesktopSources {
  const cache = sourceCache({
    home: options.home,
    assetSources: options.assetSources,
    fontSources: options.fontSources,
    // The cache's own default is never used: every call here says whether it fetches.
    fetches: false,
    remembersFailures: { retry: ASK_AGAIN },
  });

  return {
    cache,
    async callFor(briefDirectory, intent) {
      const refused = (because: string): SourceCall => ({
        fetches: false,
        notFetchedBecause: because,
      });
      // Before the folder is asked anything: the queue's answer does not depend on it.
      if (intent === 'queue') return refused(NOT_FETCHED.queue);
      const trust = await options.trustFor(briefDirectory);
      if (trust === undefined) return refused(NOT_FETCHED.unsaved);
      const sections = trust.sections;
      const sectionOf =
        sections === undefined ? {} : { sectionOf: (plugin: string) => sections[plugin] };
      if (trust.trust === 'restricted') {
        const because =
          trust.open === true ? NOT_FETCHED.restricted : NOT_FETCHED.restrictedElsewhere;
        return { ...refused(because), ...sectionOf };
      }
      if (intent === 'typing') return { ...refused(NOT_FETCHED.typing), ...sectionOf };
      // Only here: typing never waits, and a compile that may fetch is worth the wait — the
      // restore of a session is the one that otherwise asks before anybody is listening.
      await options.ready;
      return { fetches: true, ...sectionOf };
    },
  };
}
