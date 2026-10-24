import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { PluginCapabilityError, checkedCapabilities } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { credentialVariable, pluginCapabilities } from './capabilities.js';

/**
 * The CLI's network and secrets, behind the checks `@tyto/plugin-api` makes (TYTO-48).
 */

describe('credentials from the environment', () => {
  it.each([
    ['texto', 'api-token', 'TYTO_PLUGIN_TEXTO_API_TOKEN'],
    ['meu-pdf', 'api.token', 'TYTO_PLUGIN_MEU_PDF_API_TOKEN'],
    ['pdf2', 'Key', 'TYTO_PLUGIN_PDF2_KEY'],
  ])('reads %s/%s from %s', (plugin, key, variable) => {
    expect(credentialVariable(plugin, key)).toBe(variable);
  });

  it('answers the value, and nothing for an unset or empty variable', async () => {
    const capabilities = pluginCapabilities({
      TYTO_PLUGIN_MEU_PDF_API_TOKEN: 's3cret',
      TYTO_PLUGIN_MEU_PDF_EMPTY: '',
    });
    expect(await capabilities.credential('meu-pdf', 'api-token')).toBe('s3cret');
    expect(await capabilities.credential('meu-pdf', 'empty')).toBeUndefined();
    expect(await capabilities.credential('meu-pdf', 'unset')).toBeUndefined();
    expect(capabilities.describeCredential('meu-pdf', 'api-token')).toBe(
      'the environment variable TYTO_PLUGIN_MEU_PDF_API_TOKEN',
    );
  });
});

describe('writing a credential from the CLI', () => {
  // The environment is the person's to set; a plugin that could write it would be writing
  // a variable that disappears with the process (ADR 0134).
  it('refuses set and delete as read-only, naming the variable', async () => {
    const checked = checkedCapabilities(
      'meu-pdf',
      ['credentials:api-token'],
      pluginCapabilities({ TYTO_PLUGIN_MEU_PDF_API_TOKEN: 's3cret' }),
    );
    for (const attempt of [
      checked.storeCredential('api-token', 'novo'),
      checked.deleteCredential('api-token'),
    ]) {
      const refusal = await attempt.catch((cause: unknown) => cause);
      expect(refusal).toBeInstanceOf(PluginCapabilityError);
      expect((refusal as PluginCapabilityError).code).toBe('E_CREDENTIAL_READ_ONLY');
      expect((refusal as Error).message).toBe(
        "Plugin 'meu-pdf' tried to change credential 'api-token', and the environment " +
          'variable TYTO_PLUGIN_MEU_PDF_API_TOKEN is read-only here.',
      );
    }
    expect(await checked.credentials('api-token')).toBe('s3cret');
  });
});

describe('fetch', () => {
  let server: Server;
  let base: string;
  let followed = 0;

  beforeEach(async () => {
    followed = 0;
    server = createServer((request, response) => {
      if (request.url === '/moved') {
        response.writeHead(302, { location: '/elsewhere' }).end();
        return;
      }
      followed += 1;
      response.writeHead(200, { 'x-tyto': 'yes' }).end('here');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('answers the whole response as data', async () => {
    const fetched = await pluginCapabilities().fetch(`${base}/`, {});
    expect(fetched.status).toBe(200);
    expect(fetched.headers['x-tyto']).toBe('yes');
    expect(new TextDecoder().decode(fetched.body)).toBe('here');
  });

  it('hands a redirect back rather than following it past the permission check', async () => {
    const fetched = await pluginCapabilities().fetch(`${base}/moved`, {});
    expect(fetched.status).toBe(302);
    expect(fetched.headers['location']).toBe('/elsewhere');
    expect(followed).toBe(0);
  });
});
