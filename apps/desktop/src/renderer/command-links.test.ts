import { describe, expect, it } from 'vitest';

import { type LinkContext, type ListFolder, linksIn, resolveEntry } from './command-links.js';
import type { CommandProblemRow } from './problems-panel.js';

/**
 * Which places in a command's output open a file (TYTO-496), without the window naming a path
 * (ADR 0113): a diagnostic's place by its row, a file in the open folder by its explorer id.
 */

const row = (over: Partial<CommandProblemRow> = {}): CommandProblemRow => ({
  index: 0,
  severity: 'error',
  code: 'E_IMAGE',
  message: 'missing image',
  where: 'C:\\work\\Meus briefs\\cartaz.brief',
  line: 3,
  column: 5,
  openable: true,
  ...over,
});

const context = (over: Partial<LinkContext> = {}): LinkContext => ({
  diagnostics: [],
  folder: 'C:\\work',
  caseless: true,
  ...over,
});

const linked = (text: string, at: LinkContext) =>
  linksIn(text, at).map((span) => ({ text: text.slice(span.start, span.end), link: span.link }));

describe('finding the links in a line', () => {
  it('links a diagnostic’s whole place, spaces and all, to its row', () => {
    const diagnostic = row();
    const text = 'error E_IMAGE C:\\work\\Meus briefs\\cartaz.brief:3:5 missing image';
    expect(linked(text, context({ diagnostics: [diagnostic] }))).toEqual([
      {
        text: 'C:\\work\\Meus briefs\\cartaz.brief:3:5',
        link: { kind: 'diagnostic', row: diagnostic },
      },
    ]);
  });

  it('does not link a row no tab opens', () => {
    const where = 'C:\\work\\cartaz\\template.html';
    const text = `error ${where}:3:5`;
    expect(linksIn(text, context({ diagnostics: [row({ where, openable: false })] }))).toEqual([]);
  });

  it('links a file inside the open folder, relative or absolute, with its line', () => {
    expect(linked('wrote briefs/a.brief and C:\\WORK\\b\\c.md:12', context())).toEqual([
      { text: 'briefs/a.brief', link: { kind: 'path', segments: ['briefs', 'a.brief'] } },
      { text: 'C:\\WORK\\b\\c.md:12', link: { kind: 'path', segments: ['b', 'c.md'], line: 12 } },
    ]);
  });

  it('leaves a path outside the folder, with `..`, or of a file no tab opens as text', () => {
    const text = 'D:\\other\\x.brief ../up.brief out/cartaz.png formats.yaml';
    expect(linksIn(text, context())).toEqual([]);
  });

  it('links no plain path while no folder is open', () => {
    expect(linksIn('briefs/a.brief', context({ folder: null }))).toEqual([]);
  });

  it('compares the folder with case only where paths do', () => {
    expect(linksIn('C:\\WORK\\a.brief', context({ caseless: false }))).toEqual([]);
    expect(
      linksIn('/home/Ana/work/a.brief', context({ folder: '/home/ana/work', caseless: false })),
    ).toEqual([]);
  });

  it('reads a folder named with accents as part of the path', () => {
    expect(linked('Ação/b.brief', context())[0]?.text).toBe('Ação/b.brief');
  });
});

describe('finding the explorer entry a path names', () => {
  const tree: Record<string, { id: string; name: string; kind: string }[]> = {
    root: [
      { id: 'f1', name: 'Briefs', kind: 'folder' },
      { id: 'x', name: 'a.brief', kind: 'brief' },
    ],
    f1: [{ id: 'b1', name: 'Cartaz.brief', kind: 'brief' }],
  };
  const asked: (string | null)[] = [];
  const list: ListFolder = (entryId) => {
    asked.push(entryId);
    return Promise.resolve({ entries: tree[entryId ?? 'root'] ?? [] });
  };

  it('walks down one listing per folder and answers the file’s id', async () => {
    asked.length = 0;
    expect(await resolveEntry(['briefs', 'cartaz.brief'], list, true)).toBe('b1');
    expect(asked).toEqual([null, 'f1']);
  });

  it('answers nothing for a missing step, a folder as the file, or a case mismatch', async () => {
    expect(await resolveEntry(['Briefs', 'nope.brief'], list, true)).toBeUndefined();
    expect(await resolveEntry(['Briefs'], list, true)).toBeUndefined();
    expect(await resolveEntry(['briefs', 'Cartaz.brief'], list, false)).toBeUndefined();
  });
});
