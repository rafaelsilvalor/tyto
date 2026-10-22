import type { FontFace } from '@tyto/core';
import {
  type FetchedResponse,
  type HostCapabilities,
  type HostFetchInit,
  createPluginHost,
} from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import {
  CATALOGUE_DATE,
  USER_AGENT,
  css2Query,
  googleFamily,
  googleFontWarnings,
  googleFontsPlugin,
  trueTypeUrl,
} from './index.js';

/**
 * The plugin against a network of this file's own: every request it would make is recorded,
 * and Google's answers are the shapes measured on 2026-10-22 (ADR 0120). Nothing here leaves
 * the process.
 */

const TTF = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x42]);
const SHEET = (url: string) =>
  `@font-face {\n  font-family: 'Inter';\n  font-style: normal;\n  font-weight: 700;\n  src: url(${url}) format('truetype');\n}\n`;

interface Asked {
  readonly url: string;
  readonly init: HostFetchInit;
}

function network(answer: (url: string) => { status: number; body: string | Uint8Array }) {
  const asked: Asked[] = [];
  const capabilities: HostCapabilities = {
    fetch: (url, init): Promise<FetchedResponse> => {
      asked.push({ url, init });
      const { status, body } = answer(url);
      return Promise.resolve({
        url,
        status,
        statusText: '',
        headers: {},
        // ASCII by hand: a pure package has no `TextEncoder` in its types.
        body: typeof body === 'string' ? Uint8Array.from(body, (char) => char.charCodeAt(0)) : body,
      });
    },
    credential: () => Promise.resolve(undefined),
    describeCredential: () => 'nowhere',
  };
  return { asked, capabilities };
}

const google = (url: string) =>
  url.startsWith('https://fonts.googleapis.com/css2')
    ? { status: 200, body: SHEET('https://fonts.gstatic.com/s/inter/v20/abc.ttf') }
    : url === 'https://fonts.gstatic.com/s/inter/v20/abc.ttf'
      ? { status: 200, body: TTF }
      : { status: 400, body: '' };

const INTER_700: FontFace = { family: 'Inter', weight: 700, style: 'normal' };

function sourceOf(
  capabilities: HostCapabilities,
  options: Parameters<typeof googleFontsPlugin>[0] = {},
) {
  const host = createPluginHost({ capabilities });
  host.activate(googleFontsPlugin(options));
  const [owned] = host.registry.fontSources();
  if (owned === undefined) throw new Error('the plugin registered no font source');
  return owned;
}

describe('the catalogue', () => {
  it('knows the families Google serves and the styles each has, and not a licensed one', () => {
    expect(CATALOGUE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(googleFamily('inter')?.family).toBe('Inter');
    expect(googleFamily('Inter')?.styles.has('700i')).toBe(true);
    expect(googleFamily('DM Sans')?.licence).toBe('ofl');
    expect(googleFamily('CircularXX')).toBeUndefined();
  });
});

describe('the font source', () => {
  it('asks css2 for the face, then the TrueType file it names, as Tyto', async () => {
    const { asked, capabilities } = network(google);
    const answer = await sourceOf(capabilities).source.fetch(INTER_700, {});

    expect(answer).toEqual({ ok: true, value: TTF, diagnostics: [] });
    expect(asked.map(({ url }) => url)).toEqual([
      'https://fonts.googleapis.com/css2?family=Inter:wght@700',
      'https://fonts.gstatic.com/s/inter/v20/abc.ttf',
    ]);
    expect(asked.every(({ init }) => init.headers?.['user-agent'] === USER_AGENT)).toBe(true);
  });

  it('asks for an italic with the ital axis, and a spaced name with +', () => {
    expect(css2Query('DM Sans', { weight: 700, style: 'italic' })).toBe(
      'family=DM+Sans:ital,wght@1,700',
    );
  });

  it('refuses a weight Google does not have, without asking', async () => {
    const { asked, capabilities } = network(google);
    await expect(
      sourceOf(capabilities).source.fetch({ family: 'Manrope', weight: 900, style: 'normal' }, {}),
    ).rejects.toThrow("Google Fonts has no weight 900 of 'Manrope'");
    expect(asked).toEqual([]);
  });

  it('says so when Google answers with a format the library cannot read', () => {
    const woff2 = trueTypeUrl("src: url(https://fonts.gstatic.com/x.woff2) format('woff2');");
    expect(woff2).toBeInstanceOf(Error);
    expect((woff2 as Error).message).toContain('woff2');
  });

  it('connects where its options say and never where a section says (ADR 0120)', async () => {
    const { asked, capabilities } = network(google);
    await Promise.resolve(
      sourceOf(capabilities).source.fetch(INTER_700, { section: { base: 'http://127.0.0.1:9' } }),
    ).catch(() => undefined);
    expect(asked[0]?.url.startsWith('https://fonts.googleapis.com/')).toBe(true);
  });

  it('with a test base, reaches that host and only that host', async () => {
    const base = 'http://127.0.0.1:4100';
    const { asked, capabilities } = network((url) =>
      url.startsWith(`${base}/css2`)
        ? { status: 200, body: SHEET(`${base}/s/inter/v20/abc.ttf`) }
        : { status: 200, body: TTF },
    );
    const answer = await sourceOf(capabilities, { base }).source.fetch(INTER_700, {});
    expect(answer.ok).toBe(true);
    expect(asked.map(({ url }) => url)).toEqual([
      `${base}/css2?family=Inter:wght@700`,
      `${base}/s/inter/v20/abc.ttf`,
    ]);
    // Google's own hosts are no longer this plugin's to reach.
    const refused = network(() => ({
      status: 200,
      body: SHEET('https://fonts.gstatic.com/s/inter/v20/abc.ttf'),
    }));
    await expect(
      sourceOf(refused.capabilities, { base }).source.fetch(INTER_700, {}),
    ).rejects.toThrow(/fonts\.gstatic\.com/u);
  });
});

describe('a missing face, with Google Fonts on', () => {
  const drawn = { family: 'Source Sans 3', weight: 400, style: 'normal' };
  const missing = (family: string) => ({
    requested: { family, weight: 500, style: 'normal' },
    drawn,
  });

  it('is W_FONT_UNAVAILABLE, naming the substitute and the alternatives, when nobody serves it', () => {
    const [said] = googleFontWarnings([missing('CircularXX')], () => ['Inter', 'Manrope']);
    expect(said?.code).toBe('W_FONT_UNAVAILABLE');
    expect(said?.message).toBe(
      "Font 'CircularXX 500 normal' is not installed on this machine and Tyto cannot download it: it is not on Google Fonts, so it is likely a licensed font. Drawn in 'Source Sans 3 400 normal' instead. Free fonts of the same kind: Inter, Manrope. Install 'CircularXX' to render it as designed.",
    );
  });

  it('leaves the alternatives sentence out when the manifest names none', () => {
    const [said] = googleFontWarnings([missing('CircularXX')]);
    expect(said?.message).not.toContain('Free fonts');
    expect(said?.message).toContain("instead. Install 'CircularXX'");
  });

  it('stays W_FONT_SUBSTITUTED for a family Google or another plugin serves', () => {
    const said = googleFontWarnings(
      [missing('Inter'), missing('Tyto Fixture Mono')],
      () => undefined,
      (family) => family === 'Tyto Fixture Mono',
    );
    expect(said.map(({ code }) => code)).toEqual(['W_FONT_SUBSTITUTED', 'W_FONT_SUBSTITUTED']);
  });
});
