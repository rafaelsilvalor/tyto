import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QUIET_MS, isInside, watchTarget } from './watch.ts';

import type { PreviewSession, PreviewTarget } from './session.ts';

/**
 * What a save asks the session for, through real `fs.watch` on a throwaway pack (TYTO-181).
 *
 * A pack with the template being previewed, a brand module beside it, another template, and a
 * kit source folder of its own — so the kit this repository ships is never written to.
 */

type Request = { readonly rebuild: boolean; readonly kit?: boolean };

let root: string;
let pack: string;
let kit: string;
let stop: (() => void) | undefined;
let requests: Request[];

const session = { request: (request: Request) => (requests.push(request), Promise.resolve()) };

function target(compiled: boolean): PreviewTarget {
  return {
    template: 'agenda',
    templates: pack,
    brief: join(pack, 'agenda', 'examples', 'agenda.brief'),
    formatsFile: join(pack, 'formats.yaml'),
    types: ['png'],
    compiled,
  };
}

/** Saves a file and waits for the watcher's quiet period, and some, to answer it. */
async function save(path: string): Promise<void> {
  await writeFile(path, `// ${String(Math.random())}\n`);
  const deadline = Date.now() + 3_000;
  const before = requests.length;
  while (requests.length === before && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
  }
  // One more quiet period, so a second event from the same save collapses into the first.
  await new Promise((resolve) => setTimeout(resolve, QUIET_MS * 3));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-preview-watch-'));
  pack = join(root, 'templates');
  kit = join(root, 'kit', 'src');
  for (const folder of ['agenda/examples', '_marca', 'outro'].map((each) => join(pack, each))) {
    await mkdir(folder, { recursive: true });
  }
  await mkdir(kit, { recursive: true });
  await writeFile(join(pack, 'agenda', 'template.ts'), '');
  await writeFile(join(pack, 'agenda', 'examples', 'agenda.brief'), '');
  await writeFile(join(pack, '_marca', 'tokens.ts'), '');
  await writeFile(join(pack, 'outro', 'template.ts'), '');
  await writeFile(join(kit, 'pill-table.ts'), '');
  requests = [];
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  await rm(root, { recursive: true, force: true });
});

describe('watchTarget', () => {
  it('asks for a kit rebuild when a kit function is saved', async () => {
    stop = watchTarget(target(true), session as unknown as PreviewSession, { kitSource: kit });

    await save(join(kit, 'pill-table.ts'));

    expect(requests).toEqual([{ rebuild: false, kit: true }]);
  });

  it('asks for a templates rebuild when the brand module beside the template is saved', async () => {
    stop = watchTarget(target(true), session as unknown as PreviewSession, { kitSource: kit });

    await save(join(pack, '_marca', 'tokens.ts'));

    expect(requests).toEqual([{ rebuild: true, kit: false }]);
  });

  it('still asks for a templates rebuild when the template itself is saved', async () => {
    stop = watchTarget(target(true), session as unknown as PreviewSession, { kitSource: kit });

    await save(join(pack, 'agenda', 'template.ts'));

    expect(requests).toEqual([{ rebuild: true, kit: false }]);
  });

  it('ignores a save to another template of the pack', async () => {
    stop = watchTarget(target(true), session as unknown as PreviewSession, { kitSource: kit });

    await save(join(pack, 'outro', 'template.ts'));

    expect(requests).toEqual([]);
  });

  it('does not watch the kit or a brand module for a template that is not compiled', async () => {
    stop = watchTarget(target(false), session as unknown as PreviewSession, { kitSource: kit });

    await save(join(kit, 'pill-table.ts'));
    await save(join(pack, '_marca', 'tokens.ts'));

    expect(requests).toEqual([]);
  });
});

describe('isInside', () => {
  it('answers yes for a file under the folder and no for one beside it', () => {
    expect(isInside(join(root, 'a'), join(root, 'a', 'examples', 'x.brief'))).toBe(true);
    expect(isInside(join(root, 'a'), join(root, 'b', 'x.brief'))).toBe(false);
  });

  it('does not count the folder as inside itself', () => {
    expect(isInside(join(root, 'a'), join(root, 'a'))).toBe(false);
  });

  // The defect TYTO-181 found: across drives `relative` answers an absolute path, not `..`.
  it.runIf(process.platform === 'win32')('answers no for a file on another drive', () => {
    expect(isInside('D:\\projects\\templates\\agenda', 'C:\\temp\\agenda.brief')).toBe(false);
  });
});
