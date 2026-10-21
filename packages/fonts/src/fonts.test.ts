import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  BUNDLED_FONT_FAMILIES,
  bundledFont,
  bundledFontOutlinePath,
  bundledFontSource,
  bundledFontUri,
  bundledFontsDirectory,
} from './index.js';

const REGULAR = { family: 'Source Sans 3', weight: 400, style: 'normal' } as const;
const BOLD = { family: 'Source Sans 3', weight: 700, style: 'normal' } as const;
const ITALIC = { family: 'Source Sans 3', weight: 400, style: 'italic' } as const;
const BOLD_ITALIC = { family: 'Source Sans 3', weight: 700, style: 'italic' } as const;

/** The bytes behind a `data:` URI, so the assertions are about a font and not a string. */
function decode(uri: string): Buffer {
  const comma = uri.indexOf(',');
  return Buffer.from(uri.slice(comma + 1), 'base64');
}

describe('the bundled faces', () => {
  it('come back as woff2, not as a placeholder string', () => {
    const uri = bundledFontUri(REGULAR);
    if (uri === undefined) throw new Error('Source Sans 3 400 normal is not bundled.');

    expect(uri.startsWith('data:font/woff2;base64,')).toBe(true);
    // wOF2 is the whole point: a document that embeds anything else will not load it.
    expect(decode(uri).subarray(0, 4).toString('ascii')).toBe('wOF2');
  });

  it('are different bytes per weight, so a resolver that ignores the weight is visible', () => {
    const regular = bundledFontUri(REGULAR);
    const bold = bundledFontUri(BOLD);

    expect(regular).toBeDefined();
    expect(bold).toBeDefined();
    expect(regular).not.toBe(bold);
  });

  it('point at outlines in the same folder, as a TrueType file', () => {
    const path = bundledFontOutlinePath(REGULAR);
    if (path === undefined) throw new Error('Source Sans 3 400 normal has no outline file.');

    // 0x00010000 is the sfnt version every TrueType file opens with; fontkit reads it in
    // E4.5 and a `.woff2` committed under a `.ttf` name would fail there rather than here.
    expect(readFileSync(path).readUInt32BE(0)).toBe(0x00010000);
  });

  it('include an italic at both weights, from both halves of the port (TYTO-329)', () => {
    // `*text*` is ordinary brief syntax. Without these two faces it compiled and then failed
    // at export with E_EXPORT_FONT_UNRESOLVED; ADR 0110 ships them.
    for (const face of [ITALIC, BOLD_ITALIC]) {
      const uri = bundledFont({ font: { family: face.family, source: 'bundled' }, ...face });
      if (uri === undefined)
        throw new Error(`Source Sans 3 ${String(face.weight)} italic is not bundled.`);
      expect(decode(uri).subarray(0, 4).toString('ascii')).toBe('wOF2');
      expect(bundledFontSource.outlines(face)?.length).toBeGreaterThan(0);
    }
    // Four different files, so a resolver that drops the style is as visible as one that
    // drops the weight.
    const uris = new Set([REGULAR, BOLD, ITALIC, BOLD_ITALIC].map((face) => bundledFontUri(face)));
    expect(uris.size).toBe(4);
  });

  it('are the families a scene is allowed to name', () => {
    expect([...BUNDLED_FONT_FAMILIES]).toEqual(['Source Sans 3']);
  });
});

describe('the folder this package ships', () => {
  /**
   * The one thing `tools/test-fonts` could not promise and this package has to (ADR 0021):
   * that the bytes are found relative to the module rather than to a checkout. `../fonts`
   * is the same depth from `src/index.ts` and from `dist/index.js`, and this is what says
   * so out loud — including the day somebody adds a subfolder to either.
   */
  it('is beside the module, at the path package.json publishes', () => {
    const directory = bundledFontsDirectory();

    expect(directory.replaceAll('\\', '/').endsWith('/packages/fonts/fonts')).toBe(true);
    expect(readFileSync(`${directory}/source-sans-3/LICENSE.md`, 'utf8')).toContain('OFL');
  });

  it('carries the licence of the editor face it ships without registering (TYTO-269)', () => {
    // IBM Plex Mono is the desktop editor's, read through the renderer alias and never by a
    // render, so it is absent from BUNDLED_FONT_FAMILIES (asserted above) and present here.
    const licence = readFileSync(`${bundledFontsDirectory()}/ibm-plex-mono/LICENSE.md`, 'utf8');
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(licence).toContain('@ibm/plex-mono@2.5.0');
  });
});

describe('a face nothing bundles', () => {
  it('is undefined rather than a substitute', () => {
    // A weight nothing ships is the case the visual suite leans on: `undefined` here is what
    // becomes E_EXPORT_FONT_UNRESOLVED downstream, and a substituted face would render wrong
    // glyphs silently.
    expect(bundledFontUri({ ...REGULAR, weight: 300 })).toBeUndefined();
    expect(bundledFontUri({ ...REGULAR, weight: 900 })).toBeUndefined();
    expect(bundledFontUri({ ...REGULAR, family: 'Inter' })).toBeUndefined();
    expect(bundledFontOutlinePath({ ...ITALIC, weight: 300 })).toBeUndefined();
  });
});

describe('the exporters’ font port', () => {
  it('answers a bundled ref with the same bytes the outline half is measured from', () => {
    const uri = bundledFont({ font: { family: BOLD.family, source: 'bundled' }, ...BOLD });

    expect(uri).toBe(bundledFontUri(BOLD));
    // One lookup behind both, so a render and a measurement cannot drift onto two
    // different builds of the same design.
    expect(bundledFontSource.outlines(BOLD)?.length).toBeGreaterThan(0);
  });

  it('refuses a file font rather than answering it with a bundled face of the same name', () => {
    // A brief that says "this family, from this file beside me" must not silently get a
    // different build of the same design. Nothing loads a `file` font yet, and until
    // something does the honest answer is the unresolved diagnostic.
    expect(bundledFont({ font: { family: BOLD.family, source: 'file' }, ...BOLD })).toBeUndefined();
  });

  it('answers a ref that carries no source, which is what a hand-built face is', () => {
    expect(bundledFont({ font: { family: BOLD.family }, ...BOLD })).toBe(bundledFontUri(BOLD));
  });
});
