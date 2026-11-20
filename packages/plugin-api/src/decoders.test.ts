import { err, diagnostic, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { type HostCapabilities, PLUGIN_FILE_LIMIT_BYTES } from './capabilities.js';
import {
  type DecodeFile,
  type DecodeSubject,
  type ImageDecoderContribution,
  decodeGrants,
  decoderFor,
  extensionOf,
} from './decoders.js';
import { type PluginHost, createPluginHost } from './host.js';

/**
 * `image-decoder` on the host's side (TYTO-742, ADR 0223): the point, the token table and the
 * checked `host.decoding`. The same calls across the isolation boundary are in
 * `isolation/isolated-plugin.test.ts`.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A file in memory, read in parts as the host's adapter reads one from disk. */
function subjectOf(name: string, bytes: Uint8Array): DecodeSubject {
  return {
    name,
    size: bytes.length,
    readPart: (offset, length) => Promise.resolve(bytes.slice(offset, offset + length)),
  };
}

function hostWith(
  activate: (plugin: PluginHost) => void,
  options: { readonly id?: string; readonly capabilities?: HostCapabilities } = {},
) {
  const id = options.id ?? 'psd';
  const host = createPluginHost(
    options.capabilities === undefined ? {} : { capabilities: options.capabilities },
  );
  const activated = host.tryActivate({
    id,
    manifest: {
      name: id,
      version: '0.1.0',
      engine: '>=0.1',
      contributes: ['image-decoder'],
      permissions: [],
    },
    activate,
  });
  return { host, activated };
}

const NO_NETWORK = {
  fetch: () => Promise.reject(new Error('no network here')),
  credential: () => Promise.resolve(undefined),
  describeCredential: () => 'nowhere',
} satisfies HostCapabilities;

describe('the image-decoder point (ADR 0223)', () => {
  it('lists each decoder with its plugin, and the first to claim an extension wins it', () => {
    const decoder = (id: string, extensions: string[]): ImageDecoderContribution => ({
      id,
      extensions,
      decode: () => ok({ bytes: PNG }),
    });
    const { host } = hostWith((plugin) => {
      plugin.registerImageDecoder(decoder('layers', ['.psd', '.psb']));
      plugin.registerImageDecoder(decoder('late', ['.psd', '.kra']));
    });
    const decoders = host.registry.imageDecoders();
    expect(decoders.map(({ plugin, source }) => [plugin, source.id])).toEqual([
      ['psd', 'layers'],
      ['psd', 'late'],
    ]);
    expect(decoderFor(decoders, 'art/capa.PSD')?.source.id).toBe('layers');
    expect(decoderFor(decoders, 'C:\\art\\capa.kra')?.source.id).toBe('late');
    expect(decoderFor(decoders, 'capa.png')).toBeUndefined();
    expect(decoderFor(decoders, '.psd')).toBeUndefined();
  });

  it('reads an extension as the last dot of the file name, lowercased', () => {
    expect(extensionOf('capa.guide.PSD')).toBe('.psd');
    expect(extensionOf('folder.v2/capa')).toBeUndefined();
    expect(extensionOf('.hidden')).toBeUndefined();
  });

  it.each([[[]], [['psd']], [['.PSD']], [['.ps d']], [['.']]])(
    'refuses a decoder whose extensions are %j',
    (extensions) => {
      const { activated } = hostWith((plugin) => {
        plugin.registerImageDecoder({ id: 'd', extensions, decode: () => ok({ bytes: PNG }) });
      });
      expect(activated.ok ? [] : activated.error.map((problem) => problem.code)).toEqual([
        'E_PLUGIN_ACTIVATE',
      ]);
    },
  );
});

describe('decode tokens (ADR 0223)', () => {
  it('hands a token good for the one call, and spends it when the call answers', async () => {
    const grants = decodeGrants();
    const handed: DecodeFile[] = [];
    const { host } = hostWith((plugin) => {
      plugin.registerImageDecoder({
        id: 'layers',
        extensions: ['.psd'],
        decode: async (file, request) => {
          handed.push(file);
          const head = await grants.readPart('psd', file.token, 0, 4);
          const tail = await grants.readPart('psd', file.token, 4, 100);
          return ok({ bytes: new Uint8Array([...head, ...tail, request.layer?.length ?? 0]) });
        },
      });
    });
    const decoder = host.registry.imageDecoders()[0]!;

    const answer = await grants.decode(decoder, subjectOf('capa.psd', PNG), { layer: 'arte' });
    expect(answer).toEqual(ok({ bytes: new Uint8Array([...PNG, 4]) }));
    expect(handed).toEqual([{ token: handed[0]!.token, name: 'capa.psd', size: 8 }]);
    expect(grants.live()).toBe(0);

    // Spent: the same token, asked again after its call answered.
    await expect(grants.readPart('psd', handed[0]!.token, 0, 4)).rejects.toMatchObject({
      code: 'E_PERMISSION',
    });
  });

  it("refuses another plugin's token and one never minted, with one message", async () => {
    const grants = decodeGrants();
    const refusals: string[] = [];
    const { host } = hostWith((plugin) => {
      plugin.registerImageDecoder({
        id: 'layers',
        extensions: ['.psd'],
        decode: async (file) => {
          for (const [asker, token] of [
            ['other', file.token],
            ['psd', 'never-minted'],
          ] as const) {
            await grants.readPart(asker, token, 0, 1).catch((cause: Error) => {
              refusals.push(cause.message.replace(`'${asker}'`, '<plugin>'));
            });
          }
          return ok({ bytes: PNG });
        },
      });
    });
    await grants.decode(host.registry.imageDecoders()[0]!, subjectOf('capa.psd', PNG), {});
    expect(refusals).toHaveLength(2);
    expect(refusals[0]).toBe(refusals[1]);
    expect(refusals[0]).toContain('host.decoding.read with a token no decode call');
  });

  it('spends the token when the decoder throws, and passes its error through', async () => {
    const grants = decodeGrants();
    const failing = (): never => {
      throw new Error('not a PSD');
    };
    const refusing = () =>
      err([diagnostic('E_PERMISSION', { plugin: 'psd', capability: 'a stand-in error' })]);
    for (const decode of [failing, refusing]) {
      const { host } = hostWith((plugin) => {
        plugin.registerImageDecoder({ id: 'layers', extensions: ['.psd'], decode });
      });
      const call = grants.decode(host.registry.imageDecoders()[0]!, subjectOf('a.psd', PNG), {});
      if (decode === failing) await expect(call).rejects.toThrow('not a PSD');
      else expect((await call).ok).toBe(false);
      expect(grants.live()).toBe(0);
    }
  });
});

describe('host.decoding in process (ADR 0223)', () => {
  it('reads through the checked capability, needing no permission', async () => {
    const grants = decodeGrants();
    const capabilities: HostCapabilities = {
      ...NO_NETWORK,
      decodeReadPart: (plugin, token, offset, length) =>
        grants.readPart(plugin, token, offset, length),
    };
    let read: number[] = [];
    let over = '';
    const { host } = hostWith(
      (plugin) => {
        plugin.registerImageDecoder({
          id: 'layers',
          extensions: ['.psd'],
          decode: async (file) => {
            read = [...(await plugin.decoding.read(file.token, { offset: 2, length: 3 }))];
            over = await plugin.decoding
              .read(file.token, { offset: 0, length: PLUGIN_FILE_LIMIT_BYTES + 1 })
              .then(
                () => 'ok',
                (cause: { code: string }) => cause.code,
              );
            return ok({ bytes: PNG });
          },
        });
      },
      { capabilities },
    );
    await grants.decode(host.registry.imageDecoders()[0]!, subjectOf('capa.psd', PNG), {});
    expect(read).toEqual([0x4e, 0x47, 0x0d]);
    expect(over).toBe('E_PERMISSION');
  });

  it('refuses every token on a host that decodes nothing, and an adapter that answers more', async () => {
    const codes: string[] = [];
    const generous: HostCapabilities = {
      ...NO_NETWORK,
      decodeReadPart: () => Promise.resolve(new Uint8Array(10)),
    };
    for (const capabilities of [NO_NETWORK, generous]) {
      let plugin: PluginHost | undefined;
      hostWith(
        (given) => {
          plugin = given;
        },
        { capabilities, id: 'reader' },
      );
      await plugin!.decoding
        .read('any', { offset: 0, length: 4 })
        .catch((cause: { code: string }) => {
          codes.push(cause.code);
        });
    }
    expect(codes).toEqual(['E_PERMISSION', 'E_PERMISSION']);
  });
});
