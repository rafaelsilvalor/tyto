import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeFileSystem } from '@tyto/io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createProjectSources } from './project.js';

/**
 * Which folders are searched, and in which order (TYTO-122).
 *
 * Driven against real folders built here rather than against a fake filesystem, for the
 * reason `templates.test.ts` already gives: the claim is about precedence between two roots,
 * and precedence is `loadTemplateRegistry`'s. A fake would assert the fake.
 *
 * Two packs are written: a stand-in for the built-in one holding `promo-curso` and `aviso`,
 * and a "user" one holding its own `promo-curso` plus a `campanha` that exists nowhere else.
 * That is exactly the shape the card's first criterion describes — the user's `promo-curso`
 * shadows the built-in one, matching what the CLI already does (ADR 0020).
 */

const manifest = (name: string, description: string): string =>
  [
    `name: ${name}`,
    'version: 1.0.0',
    `description: ${description}`,
    'formats: [feed]',
    'slots:',
    '  titulo: { type: rich-text, required: true }',
  ].join('\n');

const pack = (root: string, templates: readonly (readonly [string, string])[]): void => {
  for (const [name, description] of templates) {
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'manifest.yaml'), manifest(name, description), 'utf8');
  }
};

let scratch: string;
let builtIn: string;
let mine: string;
let empty: string;

const sourcesOver = (folder?: string) =>
  createProjectSources({
    fileSystem: nodeFileSystem(),
    builtIn,
    ...(folder === undefined ? {} : { folder }),
  });

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-project-'));

  builtIn = join(scratch, 'built-in');
  pack(builtIn, [
    ['promo-curso', 'the built-in one'],
    ['aviso', 'only in the pack'],
  ]);
  // The formats the built-in pack declares, which is what the app falls back to. The shape is
  // the real one — a top-level map of name to size, as `packages/templates/formats.yaml` has
  // it — because a fixture in a shape the loader does not read proves nothing about the loader.
  writeFileSync(join(builtIn, 'formats.yaml'), 'feed: { w: 1080, h: 1080 }\n', 'utf8');

  mine = join(scratch, 'mine');
  pack(mine, [
    ['promo-curso', 'mine, and it wins'],
    ['campanha', 'only in my folder'],
  ]);

  empty = join(scratch, 'empty');
  mkdirSync(empty, { recursive: true });
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('the folders this app searches', () => {
  it('reads the built-in pack alone when no folder was chosen', async () => {
    const sources = await sourcesOver();
    const snapshot = sources.current();

    expect(snapshot.roots).toEqual([builtIn]);
    expect(
      snapshot.registry
        ?.list()
        .map((item) => item.name)
        .sort(),
    ).toEqual(['aviso', 'promo-curso']);
    expect(snapshot.folder).toBeUndefined();
  });

  it('searches the chosen folder first, so its template shadows the built-in one', async () => {
    const sources = await sourcesOver(mine);
    const snapshot = sources.current();

    // The card's first criterion, and the one thing that would be silently wrong if the roots
    // were passed in the other order: the answer would still have two templates with the right
    // names and the *wrong* files behind them.
    expect(snapshot.roots).toEqual([mine, builtIn]);
    expect(snapshot.registry?.get('promo-curso')?.description).toBe('mine, and it wins');
    expect(snapshot.registry?.directoryOf('promo-curso')).toBe(join(mine, 'promo-curso'));
  });

  it('keeps the built-in templates the chosen folder does not replace', async () => {
    const sources = await sourcesOver(mine);

    // A chosen folder adds and overrides; it does not take over. `aviso` is only in the pack
    // and has to survive, or "point at a folder" would mean "lose everything else".
    expect(
      sources
        .current()
        .registry?.list()
        .map((item) => item.name)
        .sort(),
    ).toEqual(['aviso', 'campanha', 'promo-curso']);
  });

  it('says how many templates the chosen folder brought', async () => {
    const sources = await sourcesOver(mine);

    // Counted from the folder read **on its own**. Merged, this number cannot be recovered:
    // three templates from two roots says nothing about which root gave what.
    expect(sources.current().folder).toEqual({ path: mine, found: 2 });
  });

  it('reports a folder with no templates as zero, and keeps the built-in pack', async () => {
    const sources = await sourcesOver(empty);
    const snapshot = sources.current();

    // The card's fourth criterion. `found: 0` is what the window turns into a row in the
    // problems panel; the built-in templates are still all there, which is the half that
    // would have been easy to ship broken.
    expect(snapshot.folder).toEqual({ path: empty, found: 0 });
    expect(
      snapshot.registry
        ?.list()
        .map((item) => item.name)
        .sort(),
    ).toEqual(['aviso', 'promo-curso']);
  });

  it('reports an unreadable folder without taking the built-in pack down with it', async () => {
    const sources = await sourcesOver(join(scratch, 'not-there'));
    const snapshot = sources.current();

    expect(snapshot.diagnostics.some((item) => item.code === 'E_TEMPLATE_READ')).toBe(true);
    // Still a working app. A folder somebody deleted between two launches must not be the
    // thing that empties the picker.
    expect(snapshot.registry?.list().length).toBe(2);
  });

  it('goes back to the built-in pack when the folder is cleared, with no restart', async () => {
    const sources = await sourcesOver(mine);
    expect(sources.current().registry?.get('campanha')).toBeDefined();

    await sources.reload(undefined);

    // The card's fifth criterion. The same object answers differently, which is the whole
    // reason it is a holder rather than three services rebuilt.
    expect(sources.current().roots).toEqual([builtIn]);
    expect(sources.current().registry?.get('campanha')).toBeUndefined();
    expect(sources.current().folder).toBeUndefined();
  });

  it('hands out a new snapshot object per reload, which is what the picker caches on', async () => {
    const sources = await sourcesOver();
    const before = sources.current();

    await sources.reload(mine);

    // `templates.ts` memoises on this identity. If a reload mutated the snapshot in place
    // instead, the picker would keep answering with the old list for the life of the window.
    expect(sources.current()).not.toBe(before);
  });

  it('falls back to the built-in formats when the chosen folder has none', async () => {
    const sources = await sourcesOver(mine);

    // The decision the card raised in one sentence and did not settle. `loadFormats` errs on a
    // file that is not there, and a service with no catalogue renders **zero frames for every
    // brief** — so an unconditional `<chosen>/formats.yaml` would mean that picking any
    // ordinary folder breaks the app. Absent is silent.
    expect(sources.current().formats).toBeDefined();
    expect(sources.current().diagnostics.some((item) => item.code === 'E_FORMATS_READ')).toBe(
      false,
    );
  });

  it("uses the chosen folder's formats.yaml when it has one", async () => {
    const withFormats = join(scratch, 'with-formats');
    pack(withFormats, [['quadrado', 'mine']]);
    writeFileSync(join(withFormats, 'formats.yaml'), 'vitrine: { w: 1200, h: 628 }\n', 'utf8');

    const sources = await sourcesOver(withFormats);

    // Replaces rather than merges, because `--formats-file` replaces in the CLI and two
    // semantics for one file is how two people end up disagreeing about what a format is.
    expect(sources.current().formats?.has('vitrine')).toBe(true);
    expect(sources.current().formats?.has('feed')).toBe(false);
  });

  it('keeps rendering when the chosen formats.yaml is broken, and says so', async () => {
    const broken = join(scratch, 'broken-formats');
    pack(broken, [['algo', 'mine']]);
    writeFileSync(join(broken, 'formats.yaml'), 'vitrine: { w: "not a number" }\n', 'utf8');

    const sources = await sourcesOver(broken);
    const snapshot = sources.current();

    // A file the person wrote and got wrong is worth a line. A file they never wrote is not —
    // which is the case above. Both keep the app rendering.
    expect(snapshot.formats).toBeDefined();
    expect(snapshot.diagnostics.some((item) => item.code.startsWith('E_FORMATS'))).toBe(true);
  });
});
