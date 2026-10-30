import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type AssetRef,
  type AssetResolver,
  type Diagnostic,
  type Diagnostics,
  type FontFace,
  diagnostic,
} from '@tyto/core';
import {
  ASSET_SOURCE_MAX_BYTES,
  type AssetSourceContribution,
  FONT_SOURCE_MAX_BYTES,
  type FontSourceContribution,
  type OwnedSource,
  type SourceRequest,
  schemeOf,
} from '@tyto/plugin-api';

import { hashOf } from './hash.js';
import { sizeFieldOf } from './image-size.js';
import { EMBEDDABLE_MIME } from './mime.js';

/**
 * Bytes a plugin's `asset-source` or `font-source` supplied, fetched once and kept on this
 * machine's disk (TYTO-280, ADR 0117).
 *
 * The ports that hand bytes to the exporters and to measurement are synchronous, and a
 * plugin's answer crosses a process and maybe a network. So a source is asked here, in the
 * two places that may await — `resolve` for an image, the job's resource stage for a face —
 * and what it answers is written to `TYTO_HOME/cache/sources/<plugin>/`. From there an image
 * is an `AssetRef` whose `path` is the cached file, read by `fileResources` like any other,
 * and a face is a file in a folder the font library searches last. Neither exporter and no
 * stage learns that a plugin was involved.
 *
 * **Kept until deleted.** A cached entry is never fetched again, so the same brief renders
 * the same bytes offline and online; the price is that a file changed at its source is not
 * seen until its entry is removed. **Named by a hash**, never by the reference: a reference
 * is text from a brief, and text from a brief does not choose a path on this disk.
 *
 * **A restricted source never fetches** (ADR 0111, ADR 0117). A reference in a brief nobody
 * trusted is an instruction to installed code that has the network, so a restricted folder
 * reads what is already cached and asks no plugin for anything else; the miss says to trust
 * the folder.
 */

export interface SourceCacheOptions {
  /** `TYTO_HOME`. The cache is `cache/sources/<plugin>/` inside it. */
  readonly home: string;
  /** Read at every question, so a plugin activated or withdrawn later is seen. */
  readonly assetSources: () => readonly OwnedSource<AssetSourceContribution>[];
  readonly fontSources: () => readonly OwnedSource<FontSourceContribution>[];
  /**
   * The plugin's own section of the resolved project (ADR 0112), or `undefined` when the
   * folder has none or withheld it because it is restricted.
   */
  readonly sectionOf?: (plugin: string) => unknown;
  /** `false` for a restricted source: the cache is read and nothing is fetched. */
  readonly fetches: boolean;
  /**
   * Why nothing is fetched, said at each miss when {@link fetches} is `false`. Defaults to
   * the restricted folder's reason; a caller that never fetches for another reason — `tyto
   * watch` (ADR 0118) — says its own, because "trust the folder" would be wrong advice there.
   */
  readonly notFetchedBecause?: string;
  /**
   * Remember a failed fetch for this cache's life, image or face, and ask for it again only
   * when its reference changes or a new cache is made (ADR 0119). Set by a caller that keeps
   * one cache for a long-lived process — the desktop, where every save would otherwise ask a
   * failing plugin again. `retry` is added to the miss, saying how to ask again. A miss that
   * was never a fetch — {@link fetches} off — is not remembered: it is a rule, not a failure.
   */
  readonly remembersFailures?: { readonly retry: string };
}

/**
 * What one question may change about a long-lived cache's options (ADR 0119): whether this
 * compile may fetch, why not, whose sections and which plugins' sources. A key left out is
 * the cache's own.
 */
export interface SourceCall {
  readonly fetches?: boolean;
  readonly notFetchedBecause?: string;
  readonly sectionOf?: (plugin: string) => unknown;
  readonly assetSources?: () => readonly OwnedSource<AssetSourceContribution>[];
  readonly fontSources?: () => readonly OwnedSource<FontSourceContribution>[];
}

export interface FetchedFaces {
  /** Faces written to the cache by this call — when any, the next compile measures them. */
  readonly fetched: number;
  readonly diagnostics: Diagnostics;
}

export interface SourceCache {
  /**
   * `inner`, with every reference in a scheme a source claims answered from the cache or
   * fetched into it. Any other reference is `inner`'s, untouched.
   */
  assets(inner: AssetResolver, call?: SourceCall): AssetResolver;
  /**
   * The cache folder of each font source's plugin, in registration order. A font library
   * lists them after every local folder, so a local face always wins.
   */
  fontDirectories(call?: SourceCall): readonly string[];
  /**
   * Fetches, into the cache, each face a font source names. `missing` is what the font
   * library could not find locally, so nothing here can shadow an installed face.
   *
   * A face that failed once is not asked for again by this cache, and its diagnostic is
   * answered again — a job that compiles twice is told about it once per pass.
   */
  fetchFaces(missing: readonly FontFace[], call?: SourceCall): Promise<FetchedFaces>;
}

/** The scheme a reference names, or the family a face is, compared without case. */
function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hexOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The extension a cached image is written with: the first `EMBEDDABLE_MIME` gives its type. */
const EXTENSION_OF_MIME: ReadonlyMap<string, string> = new Map(
  Object.entries(EMBEDDABLE_MIME)
    .reverse()
    .map(([extension, mime]) => [mime, extension]),
);
const ASSET_EXTENSIONS = [...new Set(EXTENSION_OF_MIME.values())];
const FONT_EXTENSIONS = ['.ttf', '.otf'];

/** `OTTO` opens a CFF-flavoured OpenType file; anything else is written as TrueType. */
function fontExtensionOf(bytes: Uint8Array): string {
  const otto = bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f;
  return otto ? '.otf' : '.ttf';
}

async function existing(stem: string, extensions: readonly string[]): Promise<string | undefined> {
  for (const extension of extensions) {
    const path = `${stem}${extension}`;
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile() === true) return path;
  }
  return undefined;
}

/** What Windows answers a rename onto a file another call is renaming or holds open. */
const BUSY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Tries before a busy rename is given up: about two seconds, waiting longer each time. */
const BUSY_ATTEMPTS = 20;

/**
 * `rename`, tried again while Windows says the target is busy. Two calls putting one key at
 * once — an export's frames do — rename onto the same name, and Windows refuses the second
 * until the first lets go, a matter of milliseconds (TYTO-371). Elsewhere those codes mean a
 * real refusal and are thrown at once.
 */
async function renameWhenFree(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code ?? '';
      if (process.platform !== 'win32' || !BUSY_CODES.has(code) || attempt >= BUSY_ATTEMPTS) {
        throw cause;
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}

/**
 * Written beside its final name and renamed into place, so a run killed mid-write leaves no
 * truncated entry that every later run would read as the answer.
 */
export async function writeEntry(path: string, bytes: Uint8Array): Promise<void> {
  const partial = `${path}.${randomUUID()}.part`;
  try {
    await writeFile(partial, bytes);
    await renameWhenFree(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
}

function problemOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Why a restricted folder fetched nothing, said where the miss is reported. */
const RESTRICTED =
  'this folder is not trusted, so no plugin fetches for it; trust the folder to fetch';

export function sourceCache(options: SourceCacheOptions): SourceCache {
  const root = join(options.home, 'cache', 'sources');
  const folderOf = (plugin: string): string => join(root, plugin);
  /** The cache's options, with what this one question changes. */
  const settled = (call: SourceCall = {}) => ({
    fetches: call.fetches ?? options.fetches,
    notFetched: call.notFetchedBecause ?? options.notFetchedBecause ?? RESTRICTED,
    assetSources: call.assetSources ?? options.assetSources,
    fontSources: call.fontSources ?? options.fontSources,
    requestOf: (plugin: string): SourceRequest => {
      const section = (call.sectionOf ?? options.sectionOf)?.(plugin);
      return section === undefined ? {} : { section };
    },
  });
  const retry = options.remembersFailures?.retry;
  /** A failed fetch's own reason, and how to ask again when this cache remembers it. */
  const failure = (problem: string): string =>
    retry === undefined ? problem : `${problem}; ${retry}`;
  /** Why the last fetch of a face failed, by the face's key, so it is asked only once. */
  const failedFaces = new Map<string, Diagnostic>();
  /** The same for an image, by plugin and reference, only when the caller asked (ADR 0119). */
  const failedAssets = new Map<string, Diagnostic>();

  async function fetchAsset(
    owned: OwnedSource<AssetSourceContribution>,
    reference: string,
    stem: string,
    request: SourceRequest,
  ): Promise<string> {
    const answer = await owned.source.fetch(reference, request);
    if (!answer.ok) throw new Error(answer.error.map((problem) => problem.message).join('; '));
    const { bytes, mime } = answer.value;
    // Again here, and not only on the wire: an in-process source crosses no wire.
    if (bytes.byteLength > ASSET_SOURCE_MAX_BYTES) {
      throw new Error(
        `it answered ${String(bytes.byteLength)} bytes, over the ${String(ASSET_SOURCE_MAX_BYTES)} an asset may weigh`,
      );
    }
    const extension = EXTENSION_OF_MIME.get(mime);
    if (extension === undefined) {
      throw new Error(`it answered '${mime}', which a document cannot embed`);
    }
    await mkdir(folderOf(owned.plugin), { recursive: true });
    const path = `${stem}${extension}`;
    await writeEntry(path, bytes);
    return path;
  }

  return {
    assets(inner: AssetResolver, call?: SourceCall): AssetResolver {
      const asked = settled(call);
      const failures = new Map<string, Diagnostic>();
      return {
        base: inner.base,
        ...(inner.searched === undefined ? {} : { searched: inner.searched }),

        async resolve(reference: string): Promise<AssetRef | undefined> {
          const scheme = schemeOf(reference);
          const owned =
            scheme === undefined
              ? undefined
              : asked.assetSources().find(({ source }) => source.schemes.includes(scheme));
          if (owned === undefined) return inner.resolve(reference);

          const said = (problem: string): Diagnostic =>
            diagnostic('E_ASSET_SOURCE_FAILED', { path: reference, plugin: owned.plugin, problem });
          const missed = (problem: Diagnostic): undefined => {
            failures.set(reference, problem);
            return undefined;
          };

          const key = `${owned.plugin}|${reference}`;
          const stem = join(folderOf(owned.plugin), hexOf(reference));
          let path = await existing(stem, ASSET_EXTENSIONS);
          if (path === undefined) {
            const before = failedAssets.get(key);
            if (before !== undefined) return missed(before);
            if (!asked.fetches) return missed(said(asked.notFetched));
            try {
              path = await fetchAsset(owned, reference, stem, asked.requestOf(owned.plugin));
            } catch (cause) {
              const problem = said(failure(problemOf(cause)));
              if (retry !== undefined) failedAssets.set(key, problem);
              return missed(problem);
            }
          }

          const bytes = await readFile(path).catch(() => undefined);
          if (bytes === undefined) {
            return missed(said(`its cached copy at ${path} cannot be read`));
          }
          failures.delete(reference);
          return { id: reference, source: 'url', path, hash: hashOf(bytes), ...sizeFieldOf(bytes) };
        },

        explain(reference: string): Diagnostic | undefined {
          return failures.get(reference) ?? inner.explain?.(reference);
        },
      };
    },

    fontDirectories(call?: SourceCall): readonly string[] {
      const sources = settled(call).fontSources();
      const plugins = [...new Set(sources.map(({ plugin }) => plugin))];
      return plugins.map((plugin) => join(folderOf(plugin), 'fonts'));
    },

    async fetchFaces(missing: readonly FontFace[], call?: SourceCall): Promise<FetchedFaces> {
      const asked = settled(call);
      const diagnostics: Diagnostic[] = [];
      let fetched = 0;
      const sources = asked.fontSources();

      for (const face of missing) {
        const family = normalise(face.family);
        const owned = sources.find(({ source }) =>
          source.families.some((name) => normalise(name) === family),
        );
        // A family no plugin serves is an ordinary face this machine lacks, and
        // `W_FONT_SUBSTITUTED` already says everything there is to say about it.
        if (owned === undefined) continue;

        const key = `${owned.plugin}|${face.family}|${String(face.weight)}|${face.style}`;
        const before = failedFaces.get(key);
        if (before !== undefined) {
          diagnostics.push(before);
          continue;
        }

        // The family leads the file's name: the font library opens only files whose name
        // starts with the family it is looking for.
        const folder = join(folderOf(owned.plugin), 'fonts');
        const stem = join(
          folder,
          `${family}-${String(face.weight)}-${face.style}-${hexOf(key).slice(0, 16)}`,
        );
        // Cached and still not found locally means the file names another face inside it;
        // asking again would answer the same bytes.
        if ((await existing(stem, FONT_EXTENSIONS)) !== undefined) continue;

        const said = (problem: string): Diagnostic =>
          diagnostic('W_FONT_SOURCE_FAILED', {
            font: `${face.family} ${String(face.weight)}${face.style === 'italic' ? ' italic' : ''}`,
            plugin: owned.plugin,
            problem,
          });
        const fail = (problem: string): void => {
          const failed = said(failure(problem));
          failedFaces.set(key, failed);
          diagnostics.push(failed);
        };

        // Not remembered: a compile that may not fetch says so, and the next one that may
        // still asks — in the desktop, the save after a restricted keystroke (ADR 0119).
        if (!asked.fetches) {
          diagnostics.push(said(asked.notFetched));
          continue;
        }
        try {
          const answer = await owned.source.fetch(face, asked.requestOf(owned.plugin));
          if (!answer.ok) {
            fail(answer.error.map((problem) => problem.message).join('; '));
            continue;
          }
          const bytes = answer.value;
          if (bytes.byteLength > FONT_SOURCE_MAX_BYTES) {
            fail(
              `it answered ${String(bytes.byteLength)} bytes, over the ${String(FONT_SOURCE_MAX_BYTES)} a face may weigh`,
            );
            continue;
          }
          await mkdir(folder, { recursive: true });
          await writeEntry(`${stem}${fontExtensionOf(bytes)}`, bytes);
          fetched += 1;
        } catch (cause) {
          fail(problemOf(cause));
        }
      }
      return { fetched, diagnostics };
    },
  };
}
