import { isErr, isOk } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { CONTRIBUTION_POINTS, parsePluginManifest, validatePluginManifest } from './manifest.js';

/**
 * The acceptance criterion is *"invalid manifest rejected with field path"*, so every test
 * below asserts the path and not only the rejection. A validator that says "the manifest
 * is invalid" has reported that something is wrong and nothing about what, which for a
 * file somebody hand-wrote is most of the work left undone.
 *
 * Paths come out of Zod's issue paths verbatim — `contributes.1`, `config.$schema` — and
 * `(root)` stands in when the whole document is the wrong kind of thing, because an empty
 * string in an error message reads like a bug in the error message.
 */

const VALID = {
  name: 'tyto-template-pack-juridico',
  version: '0.1.0',
  engine: '>=0.1',
  contributes: ['template-pack'],
  permissions: [],
};

/** The `path` of every diagnostic, which is what the messages are built around. */
function pathsOf(document: unknown): string[] {
  const result = validatePluginManifest(document);
  if (isOk(result)) return [];
  return result.error.map((issue) => /at '([^']*)'/.exec(issue.message)?.[1] ?? issue.message);
}

describe('a manifest that is right', () => {
  it('is accepted, exactly as docs/plugin-api.md writes it', () => {
    const result = validatePluginManifest({
      ...VALID,
      config: { $schema: './config.schema.json' },
    });

    expect(isOk(result)).toBe(true);
    expect(isOk(result) && result.value.contributes).toEqual(['template-pack']);
  });

  it('accepts every extension point the host declares, and nothing else', () => {
    // The two lists are separate declarations of one vocabulary — strings in a JSON file
    // here, TypeScript interfaces in `contributions.ts` — so one of them drifting is the
    // failure this catches.
    for (const point of CONTRIBUTION_POINTS) {
      // A recipe point needs the namespace its names live in (ADR 0135).
      const manifest = { ...VALID, contributes: [point], namespace: 'demo' };
      expect(isOk(validatePluginManifest(manifest)), point).toBe(true);
    }
    expect(pathsOf({ ...VALID, contributes: ['exportor'] })).toEqual(['contributes.0']);
  });
});

describe('a manifest that is wrong', () => {
  it('names the field, not the document, when a value has the wrong shape', () => {
    expect(pathsOf({ ...VALID, version: '0.1' })).toEqual(['version']);
    expect(pathsOf({ ...VALID, engine: 'latest' })).toEqual(['engine']);
    expect(pathsOf({ ...VALID, name: 'Tyto Pack' })).toEqual(['name']);
  });

  it('points at the element, not at the array, inside contributes and permissions', () => {
    expect(pathsOf({ ...VALID, contributes: ['exporter', 'nope'] })).toEqual(['contributes.1']);
    expect(pathsOf({ ...VALID, permissions: ['net:example.com', ''] })).toEqual(['permissions.1']);
  });

  it("refuses 'writes' that repeat or misspell a kind, or that no recipe verb could make", () => {
    const writer = { ...VALID, contributes: ['recipe-verb'], namespace: 'demo' };
    expect(pathsOf({ ...writer, writes: ['mark', 'assign'] })).toEqual([]);
    expect(pathsOf({ ...writer, writes: ['mark', 'mark'] })).toEqual(['writes']);
    expect(pathsOf({ ...writer, writes: ['Mark'] })).toEqual(['writes.0']);
    expect(pathsOf({ ...VALID, writes: ['mark'] })).toEqual(['writes']);
  });

  it('points inside config rather than at it', () => {
    expect(pathsOf({ ...VALID, config: { $schema: '' } })).toEqual(['config.$schema']);
  });

  it('names each unknown key on itself, rather than one complaint on the object above', () => {
    // A `strictObject` reports every stray key of one object in a single issue whose path
    // stops at the object. Split here for the same reason `core`'s YAML bridge splits
    // them: two typos should produce two things to fix, each pointing at itself.
    const paths = pathsOf({ ...VALID, contribute: [], permission: [] });

    expect(paths).toEqual(['contribute', 'permission']);
  });

  it('says (root) when the document is not an object at all', () => {
    expect(pathsOf('tyto-plugin')).toEqual(['(root)']);
    expect(pathsOf(null)).toEqual(['(root)']);
  });

  it('refuses a plugin that contributes nothing, or contributes twice', () => {
    expect(pathsOf({ ...VALID, contributes: [] })).toEqual(['contributes']);
    expect(pathsOf({ ...VALID, contributes: ['exporter', 'exporter'] })).toEqual(['contributes']);
  });

  it('reports every problem at once, not the first one', () => {
    // The same promise the rest of the pipeline makes: one pass, every problem. A caller
    // fixing a hand-written file one error per run is a caller running it six times.
    expect(
      pathsOf({ name: 'Tyto', version: '1', engine: 'x', contributes: [], permissions: [] }).sort(),
    ).toEqual(['contributes', 'engine', 'name', 'version']);
  });
});

describe('parsing the bytes of a file', () => {
  it('accepts the JSON a built-in ships', () => {
    expect(isOk(parsePluginManifest(JSON.stringify(VALID)))).toBe(true);
  });

  it('separates "not JSON" from "not a manifest", and names the file for the first', () => {
    // Two codes because they are two problems for whoever has to fix them, and only the
    // second has a field to point at. The file path is all the syntax error can offer.
    const broken = parsePluginManifest('{ "name": ', 'plugins/promo/tyto-plugin.json');

    expect(isErr(broken) && broken.error.map((issue) => issue.code)).toEqual([
      'E_PLUGIN_MANIFEST_SYNTAX',
    ]);
    expect(isErr(broken) && broken.error[0]?.message).toContain('plugins/promo/tyto-plugin.json');

    const shaped = parsePluginManifest('{ "name": "promo" }');
    expect(
      isErr(shaped) && shaped.error.every((issue) => issue.code === 'E_PLUGIN_MANIFEST_SHAPE'),
    ).toBe(true);
  });
});

describe('a browser sign-in (ADR 0174)', () => {
  const PROVIDER = {
    authorize: 'https://accounts.example.com/o/oauth2/v2/auth',
    token: 'https://oauth2.example.com/token',
    clientId: 'client-id.apps.example.com',
    scopes: ['openid', 'email'],
  };
  const SIGNING = {
    ...VALID,
    permissions: ['signin:provider'],
    signin: { provider: PROVIDER },
  };

  it('is accepted with its signin:<id> permission, with or without a client secret', () => {
    expect(pathsOf(SIGNING)).toEqual([]);
    expect(
      pathsOf({ ...SIGNING, signin: { provider: { ...PROVIDER, clientSecret: 'x' } } }),
    ).toEqual([]);
  });

  it('accepts plain http only on this machine, for a test provider', () => {
    for (const host of ['127.0.0.1:43210', 'localhost:8080']) {
      const local = {
        ...PROVIDER,
        authorize: `http://${host}/auth`,
        token: `http://${host}/token`,
      };
      expect(pathsOf({ ...SIGNING, signin: { provider: local } })).toEqual([]);
    }
  });

  it('refuses http to any other host, and every other scheme, naming the field', () => {
    const refused = validatePluginManifest({
      ...SIGNING,
      signin: {
        provider: {
          ...PROVIDER,
          authorize: 'http://accounts.example.com/auth',
          token: 'ftp://oauth2.example.com/token',
        },
      },
    });
    expect(isErr(refused) && refused.error.map((issue) => issue.message)).toEqual([
      "Plugin manifest is invalid at 'signin.provider.authorize': must be an https URL, or http on 127.0.0.1 or localhost.",
      "Plugin manifest is invalid at 'signin.provider.token': must be an https URL, or http on 127.0.0.1 or localhost.",
    ]);
  });

  it('refuses a loopback lookalike, a relative URL, a user in the URL and a fragment', () => {
    const urls = [
      'http://127.0.0.1.example.com/auth',
      '/auth',
      'https://user:pass@accounts.example.com/auth',
      'https://accounts.example.com/auth#x',
    ];
    for (const authorize of urls) {
      expect(pathsOf({ ...SIGNING, signin: { provider: { ...PROVIDER, authorize } } })).toEqual([
        'signin.provider.authorize',
      ]);
    }
  });

  it('refuses an entry without its permission, and a permission without its entry', () => {
    expect(pathsOf({ ...SIGNING, permissions: [] })).toEqual(['signin.provider']);
    expect(pathsOf({ ...VALID, permissions: ['signin:provider'] })).toEqual(['permissions.0']);
  });

  it('refuses a credentials: permission that names a sign-in, which only the host holds', () => {
    expect(
      pathsOf({ ...SIGNING, permissions: ['signin:provider', 'credentials:signin:provider'] }),
    ).toEqual(['permissions.1']);
    expect(
      pathsOf({
        ...SIGNING,
        permissions: ['signin:provider', 'credentials:signin-client:provider'],
      }),
    ).toEqual(['permissions.1']);
  });

  it("refuses a credentials: permission that names a recipe's credential (ADR 0193)", () => {
    expect(pathsOf({ ...VALID, permissions: ['credentials:recipe:routine'] })).toEqual([
      'permissions.0',
    ]);
    // A key that only contains the word is a plugin's own.
    expect(pathsOf({ ...VALID, permissions: ['credentials:my-recipe:routine'] })).toEqual([]);
  });

  it('accepts an entry without a client id, which the person supplies (ADR 0192)', () => {
    const { clientId: _omitted, ...withoutClient } = PROVIDER;
    const parsed = parsePluginManifest(
      JSON.stringify({ ...SIGNING, signin: { provider: withoutClient } }),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value.signin?.provider?.clientId).toBeUndefined();
  });

  it('refuses a client secret without the client id it belongs to', () => {
    const { clientId: _omitted, ...withoutClient } = PROVIDER;
    expect(
      pathsOf({ ...SIGNING, signin: { provider: { ...withoutClient, clientSecret: 's' } } }),
    ).toEqual(['signin.provider.clientSecret']);
  });

  it('refuses unknown keys, an empty client id and a repeated scope', () => {
    const wrong = { ...PROVIDER, refreshToken: 'r', clientId: '', scopes: ['a', 'a'] };
    expect(pathsOf({ ...SIGNING, signin: { provider: wrong } }).sort()).toEqual([
      'signin.provider.clientId',
      'signin.provider.refreshToken',
      'signin.provider.scopes',
    ]);
  });

  it('refuses an id that is not lowercase letters, digits and hyphens', () => {
    expect(
      pathsOf({ ...SIGNING, permissions: ['signin:Provider'], signin: { Provider: PROVIDER } }),
    ).toContain('signin.Provider');
  });
});
