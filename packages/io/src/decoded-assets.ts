import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  type AssetLayer,
  type AssetRef,
  type AssetResolver,
  type Diagnostic,
  type Diagnostics,
  type Result,
  diagnostic,
} from '@tyto/core';
import {
  type DecodeRequest,
  type DecodeSubject,
  DECODER_EXTENSION,
  type DecodedImage,
  IMAGE_DECODER_MAX_BYTES,
  type OwnedImageDecoder,
  decoderFor,
  extensionOf,
} from '@tyto/plugin-api';

import type { LocatingAssetResolver } from './file-assets.js';
import { hashOf } from './hash.js';
import { sizeFieldOf } from './image-size.js';
import { EMBEDDABLE_MIME } from './mime.js';
import { writeEntry } from './source-cache.js';

/**
 * A file of a kind no browser draws, turned into a PNG by a plugin's `image-decoder` and kept
 * on this machine's disk (TYTO-742, ADR 0223).
 *
 * Composed beside the source cache, around the file resolver: a reference whose extension is
 * not one `EMBEDDABLE_MIME` names, and that a decoder claims, is located through the same
 * folders as any other file **without being read**, its content hashed as a stream, and the
 * decoder's answer written to `TYTO_HOME/cache/decoded/<plugin>/`. From there it is an
 * `AssetRef` whose `path` is the cached PNG, which `fileResources` reads like any other; no
 * stage and no exporter learns that a plugin was involved.
 *
 * **Keyed by content** (ADR 0223, decision 5): the cached name is a hash of the source's hash,
 * the layer and the plugin's version, so a changed file or an updated plugin is asked again
 * and the same file never twice. **The source's hash is remembered** by real path, size and
 * modified time: hashing a 300 MB PSD on every keystroke would be felt, and a file that kept
 * all three kept its bytes as far as this cache can afford to ask.
 *
 * **A restricted folder decodes nothing new** (ADR 0223, decision 8, as ADR 0111 for a
 * source): it is served what is cached and no plugin is asked; the miss says why.
 */

/** The decode call and the token it mints: `decodeGrants().decode`, which the app's host owns. */
export type DecodePort = (
  decoder: OwnedImageDecoder,
  subject: DecodeSubject,
  request: DecodeRequest,
) => Promise<Result<DecodedImage, Diagnostics>>;

/** What the cache asks of the disk about a source file; a test counts it. */
export interface DecodedSourceFiles {
  /** The file's real path, size and modified time, or `undefined` when it is not a file. */
  stat(path: string): Promise<{ real: string; size: number; modified: number } | undefined>;
  /** `sha256-<hex>` of the file's bytes, read as a stream, never whole. */
  hash(path: string): Promise<string>;
  /** At most `length` bytes from `offset`: short at the end, empty past it. */
  readPart(path: string, offset: number, length: number): Promise<Uint8Array>;
}

export interface DecodedAssetsOptions {
  /** `TYTO_HOME`. The cache is `cache/decoded/<plugin>/` inside it. */
  readonly home: string;
  /** Read at every question, so a plugin activated or withdrawn later is seen. */
  readonly decoders: () => readonly OwnedImageDecoder[];
  readonly decode: DecodePort;
  /** The plugin's version, in the cache key: an update that draws differently is asked again. */
  readonly versionOf?: (plugin: string) => string | undefined;
  /** `false` for a restricted folder: the cache is read and no plugin is asked. */
  readonly decodes: boolean;
  /** Why nothing is decoded when {@link decodes} is `false`; the restricted folder's reason by default. */
  readonly notDecodedBecause?: string;
  /** The disk; Node's by default. */
  readonly files?: DecodedSourceFiles;
}

/** What one question may change about a long-lived cache's options, as `SourceCall` does. */
export interface DecodeCall {
  readonly decodes?: boolean;
  readonly notDecodedBecause?: string;
  readonly decoders?: () => readonly OwnedImageDecoder[];
}

export interface DecodedAssets {
  /**
   * `inner`, with every reference a decoder claims answered from the cache or decoded into
   * it. Any other reference is `inner`'s, untouched.
   */
  assets(inner: LocatingAssetResolver, call?: DecodeCall): AssetResolver;
}

/** Why a restricted folder decoded nothing, said where the miss is reported. */
const RESTRICTED =
  'this folder is not trusted, so no plugin decodes for it; trust the folder to decode';

/** The eight bytes every PNG opens with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function problemOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Node's disk, read in parts through an open handle so a large file is never whole in memory. */
export const nodeDecodedSourceFiles: DecodedSourceFiles = {
  async stat(path) {
    const found = await stat(path).catch(() => undefined);
    if (found?.isFile() !== true) return undefined;
    return { real: await realpath(path), size: found.size, modified: found.mtimeMs };
  },
  hash(path) {
    return new Promise((resolve, reject) => {
      const digest = createHash('sha256');
      createReadStream(path)
        .on('data', (chunk) => digest.update(chunk))
        .on('error', reject)
        .on('end', () => resolve(`sha256-${digest.digest('hex')}`));
    });
  },
  async readPart(path, offset, length) {
    const handle = await open(path, 'r');
    try {
      const { size } = await handle.stat();
      // Sized by what the file holds from the offset, so a short read costs no large buffer.
      const wanted = Math.max(0, Math.min(length, size - offset));
      if (wanted === 0) return new Uint8Array(0);
      const buffer = new Uint8Array(wanted);
      const { bytesRead } = await handle.read(buffer, 0, wanted, offset);
      return bytesRead === wanted ? buffer : buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
};

/** What a reference asks a decoder for: the file's reference, its layer, and who decodes it. */
interface DecodePlan {
  readonly file: string;
  readonly layer?: string;
  readonly decoder: OwnedImageDecoder;
}

const embeddable = (name: string): boolean =>
  EMBEDDABLE_MIME[extensionOf(name) ?? ''] !== undefined;

export function decodedAssets(options: DecodedAssetsOptions): DecodedAssets {
  const root = join(options.home, 'cache', 'decoded');
  const files = options.files ?? nodeDecodedSourceFiles;
  /** A source's hash by real path, size and modified time, for this cache's life. */
  const hashes = new Map<string, string>();

  async function sourceHash(path: string): Promise<{ hash: string; size: number } | undefined> {
    const found = await files.stat(path);
    if (found === undefined) return undefined;
    const key = `${found.real}\n${String(found.size)}\n${String(found.modified)}`;
    let hash = hashes.get(key);
    if (hash === undefined) {
      hash = await files.hash(path);
      hashes.set(key, hash);
    }
    return { hash, size: found.size };
  }

  return {
    assets(inner: LocatingAssetResolver, call: DecodeCall = {}): AssetResolver {
      const decodes = call.decodes ?? options.decodes;
      const notDecoded = call.notDecodedBecause ?? options.notDecodedBecause ?? RESTRICTED;
      const decoders = call.decoders ?? options.decoders;
      const failures = new Map<string, Diagnostic>();
      const layers = new Map<string, AssetLayer>();

      /**
       * How `reference` is read (ADR 0223, decision 6): a file a decoder claims, whole; else,
       * at its last `#`, a layer of such a file, only when no file has the literal name; else
       * `undefined`, a reference for `inner`.
       */
      async function planOf(reference: string): Promise<DecodePlan | undefined> {
        if (embeddable(reference)) return undefined;
        const owned = decoders();
        const whole = decoderFor(owned, reference);
        if (whole !== undefined) return { file: reference, decoder: whole };
        const mark = reference.lastIndexOf('#');
        if (mark <= 0 || mark === reference.length - 1) return undefined;
        const file = reference.slice(0, mark);
        const decoder = embeddable(file) ? undefined : decoderFor(owned, file);
        if (decoder === undefined) return undefined;
        if ((await inner.locate(reference)) !== undefined) return undefined;
        return { file, layer: reference.slice(mark + 1), decoder };
      }

      /** A file no picture is drawn from and no decoder claims, when it is there. */
      async function undecodable(reference: string): Promise<Diagnostic | undefined> {
        if (embeddable(reference)) return undefined;
        // Only an extension a decoder could declare: `.psd#arte` as a literal name is a file
        // with a `#` in it, answered by `inner` as written.
        const missing = (extension: string): Diagnostic | undefined =>
          DECODER_EXTENSION.test(extension)
            ? diagnostic('E_ASSET_DECODER_MISSING', { path: reference, extension })
            : undefined;
        const extension = extensionOf(reference);
        const literal = await inner.locate(reference);
        if (literal !== undefined) return extension === undefined ? undefined : missing(extension);
        // `capa.psd#arte` with no decoder installed: no file has that name, `capa.psd` is one,
        // and "a plugin is needed" is the useful answer where "not found" would mislead.
        const mark = reference.lastIndexOf('#');
        if (mark <= 0) return undefined;
        const file = reference.slice(0, mark);
        const fileExtension = extensionOf(file);
        if (fileExtension === undefined || embeddable(file)) return undefined;
        return (await inner.locate(file)) === undefined ? undefined : missing(fileExtension);
      }

      async function decodeInto(
        plan: DecodePlan,
        path: string,
        size: number,
        target: string,
      ): Promise<Buffer> {
        const subject: DecodeSubject = {
          name: basename(path),
          size,
          readPart: (offset, length) => files.readPart(path, offset, length),
        };
        const request: DecodeRequest = plan.layer === undefined ? {} : { layer: plan.layer };
        const answer = await options.decode(plan.decoder, subject, request);
        if (!answer.ok) throw new Error(answer.error.map((problem) => problem.message).join('; '));
        const { bytes } = answer.value;
        // Again here, and not only on the wire: an in-process decoder crosses no wire.
        if (bytes.byteLength > IMAGE_DECODER_MAX_BYTES) {
          throw new Error(
            `it answered ${String(bytes.byteLength)} bytes, over the ${String(IMAGE_DECODER_MAX_BYTES)} a picture may weigh`,
          );
        }
        if (!isPng(bytes)) throw new Error('it answered bytes that are not a PNG');
        await mkdir(join(root, plan.decoder.plugin), { recursive: true });
        await writeEntry(target, bytes);
        return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      }

      return {
        base: inner.base,
        ...(inner.searched === undefined ? {} : { searched: inner.searched }),

        async resolve(reference: string): Promise<AssetRef | undefined> {
          failures.delete(reference);
          layers.delete(reference);
          const plan = await planOf(reference);
          if (plan === undefined) {
            const missing = await undecodable(reference);
            if (missing !== undefined) {
              failures.set(reference, missing);
              return undefined;
            }
            return inner.resolve(reference);
          }
          if (plan.layer !== undefined)
            layers.set(reference, { file: plan.file, layer: plan.layer });

          // Not there is not found, as any picture: `E_ASSET_NOT_FOUND`, or a box for external art.
          const path = await inner.locate(plan.file);
          if (path === undefined) return undefined;
          const source = await sourceHash(path);
          if (source === undefined) return undefined;

          const { plugin } = plan.decoder;
          const said = (problem: string): undefined => {
            failures.set(
              reference,
              diagnostic('E_ASSET_DECODE_FAILED', { path: reference, plugin, problem }),
            );
            return undefined;
          };
          const version = options.versionOf?.(plugin) ?? '';
          const key = createHash('sha256')
            .update(`${source.hash}\n${plan.layer ?? ''}\n${plugin}@${version}`)
            .digest('hex');
          const target = join(root, plugin, `${key}.png`);

          let bytes: Buffer | undefined = await readFile(target).catch(() => undefined);
          if (bytes === undefined) {
            if (!decodes) return said(notDecoded);
            try {
              bytes = await decodeInto(plan, path, source.size, target);
            } catch (cause) {
              return said(problemOf(cause));
            }
          }
          return {
            id: reference,
            // Named by a hash, as a fetched picture is: a delivery names its copy after the
            // reference (ADR 0223, decision 9).
            source: 'url',
            path: target,
            hash: hashOf(bytes),
            ...sizeFieldOf(bytes),
          };
        },

        explain(reference: string): Diagnostic | undefined {
          return failures.get(reference) ?? inner.explain?.(reference);
        },

        layerOf(reference: string): AssetLayer | undefined {
          return layers.get(reference) ?? inner.layerOf?.(reference);
        },
      };
    },
  };
}
