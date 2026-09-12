import { describe, expect, it } from 'vitest';

import { type FormatCatalogue, loadFormats, parseFormats, undefinedFormats } from './formats.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { DirectoryEntry, FileSystem } from '../ports/file-system.js';
import { sliceRange } from '../source/range.js';

/**
 * `formats.yaml` is the one place a number like 1080×1920 is written, so a broken one has
 * to say where it is broken: the YAML path of the offending key and a range over the value
 * it names. The machinery is shared with `manifest.yaml`, and these tests exist to say it
 * still behaves the same after being shared.
 */

const PATH = 'formats.yaml';

const SOURCE = `feed: { w: 1080, h: 1080 }
story: { w: 1080, h: 1920, label: Story }
banner-wide: { w: 1600, h: 400 }
`;

function accepted(source: string): FormatCatalogue {
  const result = parseFormats(source, PATH);
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

function rejected(source: string): readonly Diagnostic[] {
  const result = parseFormats(source, PATH);
  if (result.ok) throw new Error('should not parse');
  return result.error;
}

function pathsOf(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((item) => /at '([^']*)'/u.exec(item.message)?.[1] ?? '(none)');
}

describe('what the catalogue answers', () => {
  it('lists every format in the order the file declares them', () => {
    expect(accepted(SOURCE).list()).toEqual([
      { id: 'feed', w: 1080, h: 1080 },
      { id: 'story', w: 1080, h: 1920, label: 'Story' },
      { id: 'banner-wide', w: 1600, h: 400 },
    ]);
  });

  it('gives a size without the label, because a frame has no use for one', () => {
    expect(accepted(SOURCE).sizeOf('story')).toEqual({ w: 1080, h: 1920 });
    expect(accepted(SOURCE).labelOf('story')).toBe('Story');
  });

  it('answers undefined for an id it does not have, rather than throwing', () => {
    const catalogue = accepted(SOURCE);
    expect(catalogue.has('quadrado')).toBe(false);
    expect(catalogue.sizeOf('quadrado')).toBeUndefined();
    expect(catalogue.labelOf('feed')).toBeUndefined();
  });
});

describe('where a broken formats file is blamed', () => {
  it('names the YAML path of the offending key', () => {
    expect(pathsOf(rejected('feed: { w: 1080, h: alto }\n'))).toEqual(['feed.h']);
  });

  it('puts a range on the value the path names', () => {
    const source = 'feed: { w: 1080, h: alto }\n';
    const [problem] = rejected(source);
    expect(problem?.range && sliceRange(source, problem.range)).toBe('alto');
  });

  it('refuses a size that is zero or negative, which draws nothing', () => {
    expect(pathsOf(rejected('feed: { w: 0, h: 1080 }\n'))).toEqual(['feed.w']);
  });

  it('gives every unknown key its own squiggle', () => {
    expect(pathsOf(rejected('feed: { w: 10, h: 10, dpi: 300, bleed: 3 }\n'))).toEqual([
      'feed.dpi',
      'feed.bleed',
    ]);
  });

  it('refuses an id that could not survive a command line', () => {
    expect(rejected('a b: { w: 10, h: 10 }\n')[0]?.message).toContain('must not be blank');
  });

  it('refuses a file with no formats in it', () => {
    expect(rejected('{}\n')[0]?.message).toContain('at least one format');
  });

  it('says a file is not YAML rather than that it is the wrong shape', () => {
    const problems = rejected('feed: [unclosed\n');
    expect(problems[0]?.code).toBe('E_FORMATS_SYNTAX');
    expect(problems[0]?.message).toContain(PATH);
  });

  it('reports every problem in one pass', () => {
    expect(pathsOf(rejected('feed: { w: -1, h: 0 }\n')).sort()).toEqual(['feed.h', 'feed.w']);
  });
});

describe('a manifest measured against the catalogue', () => {
  it('names the formats the project does not define, and the ones it does', () => {
    const problems = undefinedFormats(
      accepted(SOURCE),
      ['feed', 'quadrado', 'story'],
      'promo-curso',
    );

    expect(problems.map((item) => item.code)).toEqual(['E_FORMAT_NOT_DEFINED']);
    expect(problems[0]?.message).toBe(
      "Template 'promo-curso' renders format 'quadrado', which the project does not define. " +
        'Defined: feed, story, banner-wide.',
    );
  });

  it('says nothing when every format is defined', () => {
    expect(undefinedFormats(accepted(SOURCE), ['feed', 'story'], 'promo-curso')).toEqual([]);
  });
});

describe('reading the file', () => {
  const fileSystem = (tree: Readonly<Record<string, string>>): FileSystem => ({
    join: (...segments) => segments.join('/'),
    readDirectory: (): Promise<readonly DirectoryEntry[]> => Promise.resolve([]),
    readFile: (path) => {
      const contents = tree[path];
      return contents === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(contents);
    },
  });

  it('reads one file and parses it', async () => {
    const result = await loadFormats(fileSystem({ 'formats.yaml': SOURCE }), 'formats.yaml');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sizeOf('feed')).toEqual({ w: 1080, h: 1080 });
  });

  it('turns a missing file into a diagnostic, not an exception', async () => {
    const result = await loadFormats(fileSystem({}), 'formats.yaml');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.code).toBe('E_FORMATS_READ');
      expect(result.error[0]?.message).toContain('formats.yaml');
    }
  });
});
