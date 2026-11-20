import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import {
  type TemplateConfigurations,
  type TemplateManifest,
  type TemplateRegistry,
  parseManifest,
} from '@tyto/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type CapturedGuideRun, type GuideServiceOptions, createGuideService } from './guides.js';

/**
 * The window's external-art guide in main (TYTO-741, ADR 0222): the list `guide:candidates`
 * answers, and what `guide:write` does around the `tyto guide` run it captures — the unsaved
 * refusal, the newer-guide box, and how each written guide is opened. The run itself is
 * `@tyto/command-line`'s and tested there; here it is a stand-in that writes the files.
 */

const PAINTED = `
name: pintura
version: 1.0.0
formats: [grid-1x1, story]
slots:
  titulo: { type: rich-text }
  fundo:
    type: image
    external:
      kind: full
      sizes:
        grid-1x1: { width: 1080, height: 1080 }
        story: { width: 1080, height: 1920 }
  imagem:
    type: image
    external:
      kind: inline
      sizes:
        grid-1x1: { width: 920, suggestedHeight: 560 }
        story: { width: 920, suggestedHeight: 1080 }
`;

const PLAIN = `
name: simples
version: 1.0.0
formats: [grid-1x1]
slots:
  titulo: { type: rich-text }
`;

function manifest(text: string): TemplateManifest {
  const parsed = parseManifest(text, 'manifest.yaml');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}

const manifests = [manifest(PAINTED), manifest(PLAIN)];
const registry: TemplateRegistry = {
  list: () => manifests,
  get: (name) => manifests.find((each) => each.name === name),
  formatsOf: (name) => manifests.find((each) => each.name === name)?.formats,
  directoryOf: () => undefined,
  failures: [],
};
const configurations = {
  select: () => undefined,
  aliases: () => [],
} as unknown as TemplateConfigurations;

const BRIEF = '---\ntemplate: pintura\nfundo: grafico.png\n---\n::titulo\n  Capa\n';

let folder: string;
let briefPath: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tyto-guides-'));
  briefPath = join(folder, 'capa.brief');
  writeFileSync(briefPath, BRIEF);
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

interface Recorded {
  readonly runs: (readonly string[])[];
  readonly opened: string[];
  readonly revealed: string[];
  readonly asked: (readonly string[])[];
}

/** A service over the temp folder whose `tyto guide` writes each `--only` name into `assets/`. */
function service(overrides: Partial<GuideServiceOptions> = {}) {
  const recorded: Recorded = { runs: [], opened: [], revealed: [], asked: [] };
  const capture = (argv: readonly string[], cwd: string): Promise<CapturedGuideRun> => {
    recorded.runs.push(argv);
    const at = argv.indexOf('--only');
    const names = argv.slice(at + 1).filter((word) => !word.startsWith('-'));
    mkdirSync(join(folder, 'assets'), { recursive: true });
    const lines = names.map((name) => {
      writeFileSync(join(folder, 'assets', name), 'psd');
      return relative(cwd, join(folder, 'assets', name));
    });
    return Promise.resolve({ code: 0, out: `${lines.join('\n')}\n`, err: '' });
  };
  const guides = createGuideService({
    pathOf: (documentId) => (documentId === 'document-1' ? briefPath : undefined),
    sources: () => ({ registry, configurations }),
    projectAssets: () => [],
    restricted: () => Promise.resolve(false),
    capture,
    opener: {
      open: (path) => {
        recorded.opened.push(path);
        return Promise.resolve('');
      },
      reveal: (path) => {
        recorded.revealed.push(path);
      },
    },
    askOverwrite: (names) => {
      recorded.asked.push(names);
      return Promise.resolve(false);
    },
    ...overrides,
  });
  return { guides, recorded };
}

const request = (only: readonly string[]) => ({
  documentId: 'document-1',
  only: [...only],
  overwrite: false,
  unsaved: false,
});

describe('guide:candidates', () => {
  it('names each guide as tyto guide does, beside the cited file, with the uncited slot apart', async () => {
    const { guides } = service();
    const answer = await guides.candidates({ documentId: 'document-1' });

    expect(answer).toEqual({
      ok: true,
      template: 'pintura',
      formats: ['grid-1x1', 'story'],
      guides: [
        {
          slot: 'fundo',
          kind: 'full',
          cited: 'grafico.png',
          format: 'grid-1x1',
          name: 'grafico.grid-1x1.guide.psd',
          guide: join('assets', 'grafico.grid-1x1.guide.psd'),
          art: join('assets', 'grafico.grid-1x1.png'),
          exists: false,
          newer: false,
          artExists: false,
        },
        {
          slot: 'fundo',
          kind: 'full',
          cited: 'grafico.png',
          format: 'story',
          name: 'grafico.story.guide.psd',
          guide: join('assets', 'grafico.story.guide.psd'),
          art: join('assets', 'grafico.story.png'),
          exists: false,
          newer: false,
          artExists: false,
        },
      ],
      uncited: [{ slot: 'imagem', kind: 'inline', line: 'imagem: imagem.png' }],
      unguided: [],
    });
  });

  it('reads the buffer when the window sends one, and narrows the formats', async () => {
    const { guides } = service();
    const answer = await guides.candidates({
      documentId: 'document-1',
      text: '---\ntemplate: pintura\nfundo: outro.png\n---\n::titulo\n  Capa\n',
      formats: ['story'],
    });

    expect(answer.ok && answer.guides.map((guide) => guide.name)).toEqual(['outro.guide.psd']);
  });

  it('says a template with no external art has none, and a tab with no file has no guide', async () => {
    writeFileSync(briefPath, '---\ntemplate: simples\n---\n::titulo\n  Capa\n');
    const { guides } = service();

    const plain = await guides.candidates({ documentId: 'document-1' });
    expect(plain).toMatchObject({ ok: false, reason: 'no-external-art' });
    expect(!plain.ok && plain.diagnostics.map((item) => item.code)).toEqual([
      'E_GUIDE_NO_EXTERNAL_ART',
    ]);
    expect(await guides.candidates({ documentId: 'untitled' })).toEqual({
      ok: false,
      reason: 'no-file',
      diagnostics: [],
    });
  });
});

describe('guide:write', () => {
  it('refuses a brief with unsaved edits before anything runs (ADR 0222, decision 5)', async () => {
    const { guides, recorded } = service();
    const answer = await guides.write({ ...request(['grafico.story.guide.psd']), unsaved: true });

    expect(answer).toEqual({ outcome: 'refused', reason: 'unsaved' });
    expect(recorded.runs).toEqual([]);
  });

  it('refuses a name the brief has no guide for', async () => {
    const { guides, recorded } = service();
    expect(await guides.write(request(['segredo.guide.psd']))).toEqual({
      outcome: 'refused',
      reason: 'no-guide',
    });
    expect(recorded.runs).toEqual([]);
  });

  it('runs tyto guide for the chosen names and opens each guide it wrote', async () => {
    const { guides, recorded } = service();
    const answer = await guides.write(request(['grafico.story.guide.psd']));

    expect(recorded.runs).toEqual([['guide', briefPath, '--only', 'grafico.story.guide.psd']]);
    expect(answer).toEqual({
      outcome: 'written',
      written: [join('assets', 'grafico.story.guide.psd')],
      report: '',
      open: 'opened',
    });
    expect(recorded.opened).toEqual([join(folder, 'assets', 'grafico.story.guide.psd')]);
    expect(recorded.revealed).toEqual([]);
  });

  it('shows the folder when no program opens a PSD, and says so', async () => {
    const { guides, recorded } = service({
      opener: {
        open: () => Promise.resolve('No application is associated with the specified file'),
        reveal: (path) => {
          revealed.push(path);
        },
      },
    });
    const revealed: string[] = [];
    const answer = await guides.write(request(['grafico.story.guide.psd']));

    expect(answer).toMatchObject({ outcome: 'written', open: 'no-program' });
    expect(revealed).toEqual([join(folder, 'assets', 'grafico.story.guide.psd')]);
    expect(recorded.runs).toHaveLength(1);
  });

  it('writes but never opens a guide in a restricted folder; it shows the folder', async () => {
    const { guides, recorded } = service({ restricted: () => Promise.resolve(true) });
    const answer = await guides.write(
      request(['grafico.grid-1x1.guide.psd', 'grafico.story.guide.psd']),
    );

    expect(answer).toMatchObject({ outcome: 'written', open: 'restricted' });
    expect(recorded.opened).toEqual([]);
    expect(recorded.revealed).toEqual([join(folder, 'assets', 'grafico.grid-1x1.guide.psd')]);
  });

  it('asks before writing over a guide newer than the brief, and a no writes nothing', async () => {
    mkdirSync(join(folder, 'assets'));
    const painted = join(folder, 'assets', 'grafico.story.guide.psd');
    writeFileSync(painted, 'paint');
    const later = new Date(Date.now() + 60_000);
    utimesSync(painted, later, later);
    const { guides, recorded } = service();

    const answer = await guides.write(
      request(['grafico.grid-1x1.guide.psd', 'grafico.story.guide.psd']),
    );

    expect(answer).toEqual({ outcome: 'declined' });
    expect(recorded.asked).toEqual([['grafico.story.guide.psd']]);
    expect(recorded.runs).toEqual([]);
  });

  it('writes over it with --force on a yes, and without asking when the window said overwrite', async () => {
    mkdirSync(join(folder, 'assets'));
    const painted = join(folder, 'assets', 'grafico.story.guide.psd');
    writeFileSync(painted, 'paint');
    const later = new Date(Date.now() + 60_000);
    utimesSync(painted, later, later);

    const yes = service({ askOverwrite: () => Promise.resolve(true) });
    expect(await yes.guides.write(request(['grafico.story.guide.psd']))).toMatchObject({
      outcome: 'written',
    });
    expect(yes.recorded.runs).toEqual([
      ['guide', briefPath, '--only', 'grafico.story.guide.psd', '--force'],
    ]);

    utimesSync(painted, later, later);
    const told = service();
    await told.guides.write({ ...request(['grafico.story.guide.psd']), overwrite: true });
    expect(told.recorded.asked).toEqual([]);
    expect(told.recorded.runs[0]).toContain('--force');
  });

  it('answers failed with what the command said when it wrote nothing', async () => {
    const { guides, recorded } = service({
      capture: () =>
        Promise.resolve({ code: 1, out: '', err: 'error[E_GUIDE_NEWER_THAN_BRIEF]: ...\n' }),
    });
    expect(await guides.write(request(['grafico.story.guide.psd']))).toEqual({
      outcome: 'failed',
      report: 'error[E_GUIDE_NEWER_THAN_BRIEF]: ...\n',
    });
    expect(recorded.opened).toEqual([]);
  });
});
