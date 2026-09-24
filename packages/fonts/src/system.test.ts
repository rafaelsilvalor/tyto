import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeFace } from '@tyto/core';
import { afterAll, describe, expect, it } from 'vitest';

import {
  bundledFontOutlinePath,
  bundledFontSource,
  bundledFontUri,
  createFontLibrary,
  systemFontDirectories,
} from './index.js';

/** The bytes behind a `data:` URI, so the assertions are about a font and not a string. */
function decode(uri: string | undefined): Buffer {
  if (uri === undefined) throw new Error('expected a data: URI, got undefined');
  return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
}

const REGULAR = { family: 'Source Sans 3', weight: 400, style: 'normal' } as const;
const BOLD = { family: 'Source Sans 3', weight: 700, style: 'normal' } as const;

const system = (family: string, weight: number) =>
  ({ font: { family, source: 'system' }, weight, style: 'normal' }) as const;

/**
 * A machine with exactly one installed face: a copy of the bundled Regular, in a nested
 * folder the way a Linux distribution lays fonts out. CI has no commercial face, so the
 * machine is built rather than assumed.
 */
const machine = mkdtempSync(join(tmpdir(), 'tyto-system-fonts-'));
const regularOutlines = bundledFontOutlinePath(REGULAR) ?? '';
mkdirSync(join(machine, 'adobe'));
copyFileSync(regularOutlines, join(machine, 'adobe', 'SourceSans3-Regular.ttf'));

afterAll(() => {
  rmSync(machine, { recursive: true, force: true });
});

describe('a face the machine has installed', () => {
  it('is embedded from the installed file, matched by the tables inside it', () => {
    const library = createFontLibrary({ describe: describeFace, directories: [machine] });
    const uri = library.font(system('Source Sans 3', 400));

    expect(uri?.startsWith('data:font/ttf;base64,')).toBe(true);
    expect(decode(uri).equals(readFileSync(regularOutlines))).toBe(true);
    expect(library.substitutions([system('Source Sans 3', 400)])).toEqual([]);
  });

  it('is only the exact weight: a weight the machine lacks is substituted and reported', () => {
    const library = createFontLibrary({ describe: describeFace, directories: [machine] });

    expect(
      decode(library.font(system('Source Sans 3', 700))).equals(decode(bundledFontUri(BOLD))),
    ).toBe(true);
    expect(library.substitutions([system('Source Sans 3', 700)])).toEqual([
      { requested: BOLD, drawn: BOLD },
    ]);
  });
});

describe('a face the machine lacks', () => {
  const library = createFontLibrary({ describe: describeFace, directories: [] });

  it('is drawn in the bundled face nearest its weight, for export and for measurement alike', () => {
    const light = system('CircularXX', 300);
    const black = system('CircularXX', 900);

    expect(decode(library.font(light)).equals(decode(bundledFontUri(REGULAR)))).toBe(true);
    expect(decode(library.font(black)).equals(decode(bundledFontUri(BOLD)))).toBe(true);

    // The measurement must be taken from the face that gets drawn, or the line breaks lie.
    const measured = library.source.outlines({
      family: 'CircularXX',
      weight: 900,
      style: 'normal',
    });
    // `equals` on the bytes rather than `toEqual`: a deep compare of two megabyte arrays is
    // element by element, and it took six seconds on CI and timed the test out.
    expect(
      Buffer.from(measured ?? []).equals(Buffer.from(bundledFontSource.outlines(BOLD) ?? [])),
    ).toBe(true);
  });

  it('is reported once per face, naming what was drawn instead', () => {
    const medium = system('CircularXX', 500);

    expect(library.substitutions([medium, medium, system('CircularXX', 900)])).toEqual([
      { requested: { family: 'CircularXX', weight: 500, style: 'normal' }, drawn: REGULAR },
      { requested: { family: 'CircularXX', weight: 900, style: 'normal' }, drawn: BOLD },
    ]);
  });
});

describe('a bundled face', () => {
  const library = createFontLibrary({ describe: describeFace, directories: [machine] });

  it('behaves exactly as before: never looked for on the machine, never substituted', () => {
    const bundled = {
      font: { family: 'Source Sans 3', source: 'bundled' },
      weight: 400,
      style: 'normal',
    } as const;
    const italic = { ...bundled, style: 'italic' } as const;

    expect(library.font(bundled)).toBe(bundledFontUri(REGULAR));
    // No italic ships, and a bundled face that is absent stays E_EXPORT_FONT_UNRESOLVED.
    expect(library.font(italic)).toBeUndefined();
    expect(library.substitutions([bundled, italic])).toEqual([]);
  });

  it('refuses a file font, as bundledFont does', () => {
    expect(
      library.font({
        font: { family: 'Source Sans 3', source: 'file' },
        weight: 400,
        style: 'normal',
      }),
    ).toBeUndefined();
  });
});

describe('the platform font folders', () => {
  it('put the per-user folder first on Windows, so a user install wins', () => {
    const folders = systemFontDirectories('win32', { LOCALAPPDATA: 'L:', WINDIR: 'W:' }, 'H:');
    expect(folders).toEqual([join('L:', 'Microsoft', 'Windows', 'Fonts'), join('W:', 'Fonts')]);
  });

  it('cover the per-user and machine folders on macOS and Linux', () => {
    expect(systemFontDirectories('darwin', {}, '/h')).toContain(join('/h', 'Library', 'Fonts'));
    expect(systemFontDirectories('linux', {}, '/h')).toContain('/usr/share/fonts');
  });
});

/**
 * The face this card exists for, on a machine that has it. Skipped on CI, which has no
 * CircularXX; on the maintainer's machine it is the proof that the tables are read right.
 */
const circular = createFontLibrary({ describe: describeFace });
const hasCircular = circular.substitutions([system('CircularXX', 500)]).length === 0;

describe.skipIf(!hasCircular)('CircularXX, where it is installed', () => {
  it('finds the three weights agenda-semana draws in, as three different files', () => {
    const uris = [300, 500, 900].map((weight) => circular.font(system('CircularXX', weight)));

    for (const uri of uris) expect(uri?.startsWith('data:font/otf;base64,')).toBe(true);
    expect(new Set(uris).size).toBe(3);
    expect(
      circular.substitutions([300, 500, 900].map((weight) => system('CircularXX', weight))),
    ).toEqual([]);
  });

  it('measures from the installed file, not from the substitute', () => {
    const measured = circular.source.outlines({
      family: 'CircularXX',
      weight: 500,
      style: 'normal',
    });
    expect(measured).toBeDefined();
    expect(
      Buffer.from(measured ?? []).equals(Buffer.from(bundledFontSource.outlines(REGULAR) ?? [])),
    ).toBe(false);
  });
});
