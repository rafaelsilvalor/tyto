import type { Diagnostics, Result } from '@tyto/core';

import { PluginCapabilityError, unknownToken } from './capabilities.js';
import type { Contribution } from './contributions.js';
import { ASSET_SOURCE_MAX_BYTES, type OwnedSource } from './sources.js';

/**
 * `image-decoder`: a plugin that turns a file of a kind no browser draws into a picture, so a
 * brief may cite a `.psd` (TYTO-742, ADR 0223).
 *
 * Modelled on `asset-source` (ADR 0117): data plus one function, so an installed plugin
 * registers it from its own process, the function stays there and the PNG crosses back. What
 * differs is how the plugin reaches the file. It is handed no path and needs no
 * `workspace:read`: the host mints a token that names one file for the length of one `decode`
 * call, and the plugin reads that file in parts through `host.decoding.read(token, part)`. The
 * file may sit outside any workspace, and `tyto watch`, which has none, decodes the same way.
 */

/**
 * The file a decode call is about. `token` is what `host.decoding.read` takes, and is spent
 * when the call answers; `name` is the file's own name with its extension (never a path), and
 * `size` its length in bytes, so a reader knows when it has read it all.
 */
export interface DecodeFile {
  readonly token: string;
  readonly name: string;
  readonly size: number;
}

/**
 * What the brief asked of the file besides itself: `layer`, from `file.psd#layer`, names one
 * layer by its exact name, a layer inside a group as `group/layer`. Absent, the whole file.
 */
export interface DecodeRequest {
  readonly layer?: string;
}

/** A decoder's answer: a PNG's bytes, at most {@link IMAGE_DECODER_MAX_BYTES}. */
export interface DecodedImage {
  readonly bytes: Uint8Array;
}

/**
 * The most one decoded picture may weigh: an asset source's ceiling (ADR 0117), which is a
 * file beside a brief's. Checked on the wire, and again by whatever caches the answer, because
 * an in-process decoder crosses no wire.
 */
export const IMAGE_DECODER_MAX_BYTES = ASSET_SOURCE_MAX_BYTES;

/**
 * An extension as a decoder declares it: a dot, then lowercase letters and digits. `.psd`, not
 * `psd` and not `.PSD`; a file's extension is compared lowercased, so `logo.PSD` still matches.
 */
export const DECODER_EXTENSION = /^\.[a-z0-9]+$/;

/**
 * `image-decoder` — pictures out of files of the kinds it names.
 *
 * `extensions` says which files it is asked about; an extension two decoders claim goes to the
 * one registered first, as a scheme does. The host asks a decoder only about a file whose
 * extension is not a picture it embeds itself (`.png`, `.jpg` and the rest), so a decoder that
 * claims one is never asked about it.
 */
export interface ImageDecoderContribution extends Contribution {
  readonly extensions: readonly string[];
  /**
   * The file as a PNG, or the layer `request` names. An error is the plugin's own explanation
   * and reaches the author as `E_ASSET_DECODE_FAILED`; a decoder that cannot draw the file
   * answers an error, never a blank picture.
   */
  decode(
    file: DecodeFile,
    request: DecodeRequest,
  ): Result<DecodedImage, Diagnostics> | Promise<Result<DecodedImage, Diagnostics>>;
}

/** A decoder and the plugin that registered it: a token is good for that plugin only. */
export type OwnedImageDecoder = OwnedSource<ImageDecoderContribution>;

/** The extension a file name ends in, lowercased with its dot, or `undefined` when none. */
export function extensionOf(name: string): string | undefined {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return base.slice(dot).toLowerCase();
}

/** The decoder for a file, by its extension: the first registered that claims it. */
export function decoderFor(
  decoders: readonly OwnedImageDecoder[],
  name: string,
): OwnedImageDecoder | undefined {
  const extension = extensionOf(name);
  if (extension === undefined) return undefined;
  return decoders.find(({ source }) => source.extensions.includes(extension));
}

/**
 * The file a host hands a decoder, as the host holds it: its name and size, and a way to read
 * a part of it. The host's adapter reads from disk; a test reads from memory.
 */
export interface DecodeSubject {
  readonly name: string;
  readonly size: number;
  /** At most `length` bytes from `offset`: short at the end of the file, empty past it. */
  readPart(offset: number, length: number): Promise<Uint8Array>;
}

/**
 * The tokens a host has handed out, and the one port that reads through them.
 *
 * One per host: `decode` mints a token, calls the decoder with it, and spends it when the call
 * answers or throws; `readPart` is what the host's `HostCapabilities.decodeReadPart` is, and
 * answers only a token that is live and was minted for the plugin asking.
 */
export interface DecodeGrants {
  decode(
    decoder: OwnedImageDecoder,
    subject: DecodeSubject,
    request: DecodeRequest,
  ): Promise<Result<DecodedImage, Diagnostics>>;
  readPart(plugin: string, token: string, offset: number, length: number): Promise<Uint8Array>;
  /** How many tokens are live: a call in flight holds one. */
  live(): number;
}

/**
 * The runtime's own random UUID, read off `globalThis`: this package compiles against no
 * platform's types (ADR 0010), and Node, a worker and a browser each have it.
 */
const { crypto } = globalThis as unknown as { crypto: { randomUUID(): string } };

/**
 * A fresh token table. A token is a random UUID, so one plugin cannot guess another call's;
 * and each is bound to the plugin it was minted for, so a guess would buy nothing anyway.
 */
export function decodeGrants(): DecodeGrants {
  const granted = new Map<string, { readonly plugin: string; readonly subject: DecodeSubject }>();
  return {
    async decode(decoder, subject, request) {
      const token = crypto.randomUUID();
      granted.set(token, { plugin: decoder.plugin, subject });
      try {
        return await decoder.source.decode(
          { token, name: subject.name, size: subject.size },
          request,
        );
      } finally {
        granted.delete(token);
      }
    },
    readPart(plugin, token, offset, length) {
      const grant = granted.get(token);
      if (grant === undefined || grant.plugin !== plugin) {
        return Promise.reject(new PluginCapabilityError(unknownToken(plugin)));
      }
      return grant.subject.readPart(offset, length);
    },
    live: () => granted.size,
  };
}
