import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  TEST_FONT_FAMILIES,
  htmlTestFont,
  svgTestFont,
  testFontDataUri,
  testFontOutlinePath,
} from './index.js';

const REGULAR = { family: 'Source Sans 3', weight: 400, style: 'normal' } as const;
const BOLD = { family: 'Source Sans 3', weight: 700, style: 'normal' } as const;

/** The bytes behind a `data:` URI, so the assertions are about a font and not a string. */
function decode(uri: string): Buffer {
  const comma = uri.indexOf(',');
  return Buffer.from(uri.slice(comma + 1), 'base64');
}

describe('the bundled faces', () => {
  it('come back as woff2, not as a placeholder string', () => {
    const uri = testFontDataUri(REGULAR);
    if (uri === undefined) throw new Error('Source Sans 3 400 normal is not bundled.');

    expect(uri.startsWith('data:font/woff2;base64,')).toBe(true);
    // wOF2 is the whole point: a document that embeds anything else will not load it.
    expect(decode(uri).subarray(0, 4).toString('ascii')).toBe('wOF2');
  });

  it('are different bytes per weight, so a resolver that ignores the weight is visible', () => {
    const regular = testFontDataUri(REGULAR);
    const bold = testFontDataUri(BOLD);

    expect(regular).toBeDefined();
    expect(bold).toBeDefined();
    expect(regular).not.toBe(bold);
  });

  it('point at outlines in the same folder, as a TrueType file', () => {
    const path = testFontOutlinePath(REGULAR);
    if (path === undefined) throw new Error('Source Sans 3 400 normal has no outline file.');

    // 0x00010000 is the sfnt version every TrueType file opens with; fontkit reads it in
    // E4.5 and a `.woff2` committed under a `.ttf` name would fail there rather than here.
    expect(readFileSync(path).readUInt32BE(0)).toBe(0x00010000);
  });

  it('are the families a scene is allowed to name', () => {
    expect([...TEST_FONT_FAMILIES]).toEqual(['Source Sans 3']);
  });
});

describe('a face nothing bundles', () => {
  it('is undefined rather than a substitute', () => {
    // The italic is the case the visual suite leans on: `undefined` here is what becomes
    // E_EXPORT_FONT_UNRESOLVED downstream, and a substituted face would render wrong
    // glyphs silently.
    expect(testFontDataUri({ ...REGULAR, style: 'italic' })).toBeUndefined();
    expect(testFontDataUri({ ...REGULAR, weight: 900 })).toBeUndefined();
    expect(testFontDataUri({ ...REGULAR, family: 'Inter' })).toBeUndefined();
    expect(testFontOutlinePath({ ...REGULAR, style: 'italic' })).toBeUndefined();
  });
});

describe('the two exporter shapes', () => {
  it('reach the same face from their own vocabulary', () => {
    const fromHtml = htmlTestFont({
      font: { family: 'Source Sans 3' },
      weight: 700,
      style: 'normal',
    });
    const fromSvg = svgTestFont(BOLD);

    expect(fromHtml).toBeDefined();
    expect(fromHtml).toBe(fromSvg);
  });
});
