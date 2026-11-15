import { describe, expect, it } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';
import {
  type BuiltinContext,
  type BuiltinOutcome,
  type PanelFiles,
  type PanelWrites,
  PANEL_BUILTINS,
} from './command-builtins.js';

/**
 * The command panel's file commands that write (TYTO-537, ADR 0201 decision 5), over a
 * workspace whose ids are its steps joined with `/` and the Explorer's writes recorded.
 */

type Kind = 'folder' | 'brief' | 'file';

const TREE: Record<string, readonly { name: string; kind: Kind }[]> = {
  '': [
    { name: 'entregas', kind: 'folder' },
    { name: 'capa.brief', kind: 'brief' },
    { name: 'foto.png', kind: 'file' },
  ],
  entregas: [{ name: 'novembro', kind: 'folder' }],
  'entregas/novembro': [{ name: 'story.brief', kind: 'brief' }],
};

interface Recorded {
  readonly calls: unknown[][];
  answer: { ok: false; reason: 'exists' | 'link' | 'invalid' | 'trash-failed' } | undefined;
  unsaved: number;
  confirmed: boolean;
}

function workspace(working: readonly string[] = []): { files: PanelFiles; recorded: Recorded } {
  const recorded: Recorded = { calls: [], answer: undefined, unsaved: 0, confirmed: true };
  const write = <Answer>(name: string, made: Answer) =>
    ((...args: unknown[]) => {
      recorded.calls.push([name, ...args]);
      return Promise.resolve(recorded.answer ?? made);
    }) as never;
  const entry = { id: 'new', name: 'x', kind: 'file' as const };
  const writes: PanelWrites = {
    create: write<IpcResponse<'explorer:create'>>('create', {
      ok: true,
      entry,
      document: null,
      documentId: null,
    }),
    move: write<IpcResponse<'explorer:rename'>>('move', { ok: true, entry, moved: [] }),
    copy: write<IpcResponse<'explorer:copy'>>('copy', { ok: true, entry }),
    unsavedUnder: () => Promise.resolve(recorded.unsaved),
    confirmRemove: (asked, unsaved) => {
      recorded.calls.push(['confirm', asked.name, unsaved]);
      return Promise.resolve(recorded.confirmed);
    },
    remove: write<IpcResponse<'explorer:delete'>>('remove', { ok: true, released: [] }),
    open: (entryId) => {
      recorded.calls.push(['open', entryId]);
      return Promise.resolve(entryId.endsWith('.brief'));
    },
    reveal: (ids) => {
      recorded.calls.push(['reveal', ids]);
    },
    skeletonOf: (template) => (template === 'story' ? '---\ntemplate: story\n---\n' : undefined),
    bin: 'Recycle Bin',
  };
  return {
    recorded,
    files: {
      folder: 'C:\\work\\promo',
      workingFolder: working,
      changeFolder: () => undefined,
      list: (entryId) => {
        const key = entryId ?? '';
        return Promise.resolve({
          entries: (TREE[key] ?? []).map((each) => ({
            ...each,
            id: key === '' ? each.name : `${key}/${each.name}`,
          })),
          more: 0,
        });
      },
      read: () => Promise.resolve({ ok: false, reason: 'gone' }),
      caseless: true,
      writes,
    },
  };
}

const run = (
  name: string,
  args: readonly string[],
  files: PanelFiles | undefined,
): Promise<BuiltinOutcome> => {
  const context: BuiltinContext = {
    args: args.map((text) => ({ text, quoted: false })),
    history: () => [],
    runTyto: () => Promise.resolve(true),
    clear: () => undefined,
    exit: () => undefined,
    commands: () => Promise.resolve([]),
    say: (key) => translate('en', key),
    registry: PANEL_BUILTINS,
    files,
  };
  return Promise.resolve(PANEL_BUILTINS.find({ text: name, quoted: false })!.run(context));
};

const said = (outcome: BuiltinOutcome): string =>
  outcome.kind === 'printed' ? outcome.lines.join('\n') : '';

describe('new and mkdir', () => {
  it('make an entry in the folder the path names, by its id', async () => {
    const { files, recorded } = workspace(['entregas']);
    expect(await run('new', ['novembro/notas.txt'], files)).toEqual({ kind: 'printed', lines: [] });
    await run('mkdir', ['../saida'], files);
    expect(recorded.calls).toEqual([
      ['create', 'entregas/novembro', 'notas.txt', 'file', undefined],
      ['create', null, 'saida', 'folder', undefined],
    ]);
  });

  it("write a template's skeleton into a new brief, and only into a brief", async () => {
    const { files, recorded } = workspace();
    await run('new', ['cartaz.brief', '--template', 'story'], files);
    expect(recorded.calls).toEqual([
      ['create', null, 'cartaz.brief', 'file', '---\ntemplate: story\n---\n'],
    ]);
    expect(said(await run('new', ['cartaz.txt', '-t', 'story'], files))).toContain(
      'ends in .brief',
    );
    expect(said(await run('new', ['x.brief', '--template', 'nada'], files))).toBe(
      'No template is called nada.',
    );
    expect(recorded.calls).toHaveLength(1);
  });

  it('say what main refused, and never write outside or in a folder that is not there', async () => {
    const { files, recorded } = workspace();
    recorded.answer = { ok: false, reason: 'exists' };
    expect(said(await run('mkdir', ['entregas'], files))).toBe(
      'entregas already exists: nothing was replaced.',
    );
    recorded.answer = undefined;
    expect(said(await run('new', ['../fora.txt'], files))).toContain('leads outside');
    expect(said(await run('new', ['C:\\fora.txt'], files))).toContain('leads outside');
    expect(said(await run('new', ['nada/x.txt'], files))).toContain('nada: no such file');
    expect(recorded.calls).toHaveLength(1);
  });
});

describe('mv and cp', () => {
  it('move into an existing folder under the same name, or to a new name', async () => {
    const { files, recorded } = workspace();
    await run('mv', ['capa.brief', 'entregas/novembro'], files);
    await run('mv', ['capa.brief', 'entregas/capa-2.brief'], files);
    await run('cp', ['entregas/novembro', 'copia'], files);
    expect(recorded.calls).toEqual([
      ['move', 'capa.brief', 'entregas/novembro', 'capa.brief'],
      ['move', 'capa.brief', 'entregas', 'capa-2.brief'],
      ['copy', 'entregas/novembro', null, 'copia'],
    ]);
  });

  it('never land on a file that is there', async () => {
    const { files, recorded } = workspace();
    expect(said(await run('cp', ['capa.brief', 'foto.png'], files))).toBe(
      'foto.png already exists: nothing was replaced.',
    );
    expect(recorded.calls).toEqual([]);
  });

  it('refuse a folder into itself before main is asked', async () => {
    const { files, recorded } = workspace();
    expect(said(await run('mv', ['entregas', 'entregas/novembro'], files))).toBe(
      'entregas cannot go into itself.',
    );
    expect(said(await run('cp', ['entregas', 'entregas'], files))).toBe(
      'entregas cannot go into itself.',
    );
    expect(recorded.calls).toEqual([]);
  });

  it("say main's refusals: a link inside, a name refused", async () => {
    const { files, recorded } = workspace();
    recorded.answer = { ok: false, reason: 'link' };
    expect(said(await run('cp', ['entregas', 'copia'], files))).toContain(
      'holds a link or junction',
    );
    recorded.answer = { ok: false, reason: 'invalid' };
    expect(said(await run('mv', ['capa.brief', 'CON'], files))).toContain('cannot be used');
  });

  it.each([
    [['capa.brief'], 'takes a source and a target'],
    [['.', 'x'], 'is the workspace folder itself'],
    [['..', 'x'], 'leads outside'],
    [['capa.brief', '../x'], 'leads outside'],
    [['nada', 'x'], 'no such file or folder'],
  ])('refuse mv %j', async (args, words) => {
    const { files, recorded } = workspace();
    expect(said(await run('mv', args, files))).toContain(words);
    expect(recorded.calls).toEqual([]);
  });
});

describe('rm', () => {
  it('sends each to the bin, asking only when a tab under it holds unsaved text', async () => {
    const { files, recorded } = workspace();
    await run('rm', ['capa.brief'], files);
    recorded.unsaved = 2;
    await run('rm', ['entregas'], files);
    expect(recorded.calls).toEqual([
      ['remove', 'capa.brief'],
      ['confirm', 'entregas', 2],
      ['remove', 'entregas'],
    ]);
  });

  it('removes nothing when the answer is no', async () => {
    const { files, recorded } = workspace();
    recorded.unsaved = 1;
    recorded.confirmed = false;
    expect(said(await run('rm', ['capa.brief'], files))).toBe('Nothing more was moved to the bin.');
    expect(recorded.calls).toEqual([['confirm', 'capa.brief', 1]]);
  });

  it('finds every path before anything goes', async () => {
    const { files, recorded } = workspace();
    expect(said(await run('rm', ['capa.brief', 'nada'], files))).toContain('nada: no such file');
    expect(recorded.calls).toEqual([]);
  });

  it('never removes the workspace folder itself', async () => {
    const { files, recorded } = workspace(['entregas']);
    expect(said(await run('rm', ['..'], files))).toContain('is the workspace folder itself');
    expect(said(await run('rm', ['.'], workspace().files))).toContain(
      'is the workspace folder itself',
    );
    expect(recorded.calls).toEqual([]);
  });

  it('says the bin refused, and that nothing was deleted', async () => {
    const { files, recorded } = workspace();
    recorded.answer = { ok: false, reason: 'trash-failed' };
    expect(said(await run('rm', ['capa.brief'], files))).toBe(
      'capa.brief could not go to the Recycle Bin. Nothing was deleted.',
    );
  });
});

describe('open and reveal', () => {
  it('open a file a tab opens, and say so for one it does not', async () => {
    const { files, recorded } = workspace();
    expect(await run('open', ['entregas/novembro/story.brief'], files)).toEqual({
      kind: 'printed',
      lines: [],
    });
    expect(said(await run('open', ['foto.png'], files))).toContain('does not open in a tab');
    expect(said(await run('open', ['entregas'], files))).toContain('does not open in a tab');
    expect(recorded.calls).toEqual([
      ['open', 'entregas/novembro/story.brief'],
      ['open', 'foto.png'],
    ]);
  });

  it('reveal hands the Explorer every id down to the entry', async () => {
    const { files, recorded } = workspace(['entregas']);
    await run('reveal', ['novembro/story.brief'], files);
    expect(recorded.calls).toEqual([
      ['reveal', ['entregas', 'entregas/novembro', 'entregas/novembro/story.brief']],
    ]);
  });
});

describe('in a restricted folder', () => {
  it('none of the seven runs: the panel refuses each before it starts (ADR 0201 decision 4)', () => {
    for (const name of ['new', 'mkdir', 'mv', 'cp', 'rm', 'open', 'reveal']) {
      expect(PANEL_BUILTINS.find({ text: name, quoted: false })?.runsInRestrictedFolder).toBe(
        false,
      );
    }
  });
});
