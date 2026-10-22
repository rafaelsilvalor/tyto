import { type FontFace, ok } from '@tyto/core';
import type { FontSourceContribution, Plugin, PluginHost } from '@tyto/plugin-api';

import manifest from '../tyto-plugin.json';
import { GOOGLE_FAMILIES, googleFamily, styleKey } from './catalogue.js';

/**
 * A built-in `font-source` that asks Google Fonts for a face this machine lacks (TYTO-281,
 * ADR 0120). The cache, the "local face wins" rule and who may fetch are ADR 0117's, 0118's
 * and 0119's: this is only the question and where it is sent.
 *
 * **Two requests per face, through `host.fetch` only**: Google's `css2` stylesheet for the
 * family and weight, then the file it names on `fonts.gstatic.com`. The package imports
 * nothing from Node, so the network is whatever the composing app hands the host, under the
 * manifest's `net:` permissions. What leaves the machine is the family, the weight, the style
 * and the address asking: no brief, no template, nothing from the project.
 *
 * **TrueType, by the client we say we are.** `css2` answers a browser with WOFF2, which the
 * font library does not read, and anything else with TTF — measured on 2026-10-22 with
 * `node`, `undici`, an empty and a made-up `User-Agent`. The window's network may be a
 * browser's, so the plugin names itself on every request rather than inheriting one. A
 * variable family arrives as the static instance of the weight asked for (Inter 700 measured:
 * no `fvar`, weight class 700), which the library reads as is.
 */

/** Sent on every request; anything that is not a browser gets TrueType. */
export const USER_AGENT = 'Tyto (+https://github.com/rafaelsilvalor/tyto)';

const CSS_HOST = 'https://fonts.googleapis.com';

export interface GoogleFontsOptions {
  /**
   * **Tests only**: a server standing in for both of Google's hosts, which then becomes the
   * plugin's one `net:` permission. Read from the environment by the composing app
   * (`TYTO_GOOGLE_FONTS_BASE`) and from nowhere else — not a project file, not a plugin's
   * section — so no brief can point a render at another server.
   */
  readonly base?: string;
}

/** `css2`'s query for one face: `family=DM+Sans:ital,wght@1,700`. */
export function css2Query(family: string, face: Pick<FontFace, 'weight' | 'style'>): string {
  const name = encodeURIComponent(family).replace(/%20/gu, '+');
  return face.style === 'italic'
    ? `family=${name}:ital,wght@1,${String(face.weight)}`
    : `family=${name}:wght@${String(face.weight)}`;
}

/** The first TrueType `src` of a `css2` answer, or why there is none. */
export function trueTypeUrl(css: string): string | Error {
  const match = /src:\s*url\(([^)]+)\)\s*format\('truetype'\)/u.exec(css);
  if (match?.[1] !== undefined) return match[1];
  const other = /format\('([^']+)'\)/u.exec(css)?.[1];
  return new Error(
    other === undefined
      ? 'Google Fonts answered with no font file'
      : `Google Fonts answered with ${other}, which this machine's font library does not read`,
  );
}

async function fetchFace(host: PluginHost, face: FontFace, base: string | undefined) {
  const entry = googleFamily(face.family);
  if (entry === undefined) throw new Error(`'${face.family}' is not on Google Fonts`);
  if (!entry.styles.has(styleKey(face.weight, face.style))) {
    throw new Error(
      `Google Fonts has no ${face.style === 'italic' ? 'italic ' : ''}weight ${String(face.weight)} of '${entry.family}'`,
    );
  }

  const headers = { 'user-agent': USER_AGENT };
  const sheet = await host.fetch(`${base ?? CSS_HOST}/css2?${css2Query(entry.family, face)}`, {
    headers,
  });
  if (!sheet.ok)
    throw new Error(`Google Fonts answered ${String(sheet.status)} for '${entry.family}'`);
  const url = trueTypeUrl(await sheet.text());
  if (url instanceof Error) throw url;

  const file = await host.fetch(url, { headers });
  if (!file.ok) throw new Error(`Google Fonts answered ${String(file.status)} for its file`);
  return ok(new Uint8Array(file.body));
}

/**
 * The manifest as shipped, or with the test server as the one host it may reach. The host is
 * read off the text rather than through `URL`, which a package with no runtime's types has
 * not got; `host.fetch` parses every request properly before the permission is asked.
 */
function manifestFor(base: string | undefined): unknown {
  if (base === undefined) return manifest;
  const host = /^https?:\/\/([^/:?#]+)/iu.exec(base)?.[1];
  if (host === undefined)
    throw new Error(`'${base}' is not an http address to stand in for Google`);
  return { ...manifest, permissions: [`net:${host.toLowerCase()}`] };
}

export function googleFontsPlugin(options: GoogleFontsOptions = {}): Plugin {
  const { base } = options;
  return {
    id: manifest.name,
    manifest: manifestFor(base),
    activate: (host) => {
      const source: FontSourceContribution = {
        id: manifest.name,
        families: GOOGLE_FAMILIES,
        // The request's `section` is ignored on purpose: a project's settings never choose
        // where this plugin connects (ADR 0120).
        fetch: (face) => fetchFace(host, face, base),
      };
      host.registerFontSource(source);
    },
  };
}

/** The plugin's id, which is its manifest's name. */
export const GOOGLE_FONTS_ID: string = manifest.name;

/** The `tyto-plugin.json` as shipped: what `tyto plugin list` validates and prints. */
export const googleFontsManifest: unknown = manifest;
