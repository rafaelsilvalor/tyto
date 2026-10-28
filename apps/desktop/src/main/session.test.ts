import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDocumentService } from './documents.js';
import { type RecentFiles } from './recent-files.js';
import {
  type SessionServiceOptions,
  createSessionService,
  createTemplateFolder,
  savedHashOf,
} from './session.js';
import {
  EMPTY_SESSION,
  NO_GROUPS,
  type SessionStore,
  UNREADABLE_SESSION,
  fileSessionStore,
} from './session-store.js';
import { type OpenedTemplate } from './template-editor.js';

/**
 * The session record and the decisions taken when it is read (TYTO-113, ADR 0080).
 *
 * The document service is the real one over an in-memory disk, so "reopened by the path main
 * stored" is the service's own `openPath` and not a fake that agrees with this file.
 */

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-session-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('the session file', () => {
  it('reads an empty session when there is no file, and when the file is not JSON', async () => {
    const file = join(scratch, 'session.json');
    expect(await fileSessionStore(file).read()).toEqual(EMPTY_SESSION);
    // A file that is there but unreadable is empty too, and not a first launch (TYTO-287).
    writeFileSync(file, '{ not json');
    expect(await fileSessionStore(file).read()).toEqual(UNREADABLE_SESSION);
    writeFileSync(file, JSON.stringify({ version: 2, tabs: 'no' }));
    expect(await fileSessionStore(file).read()).toEqual(UNREADABLE_SESSION);
    const folder = join(scratch, 'folder', 'session.json');
    mkdirSync(folder, { recursive: true });
    expect(await fileSessionStore(folder).read()).toEqual(UNREADABLE_SESSION);
  });

  it('swallows a write the disk refuses, and says it did not write', async () => {
    // A folder where the file should be: the write fails, and nothing is thrown.
    const file = join(scratch, 'session.json');
    mkdirSync(file);
    expect(await fileSessionStore(file).write(EMPTY_SESSION)).toBe(false);
  });

  it('reads back what it wrote', async () => {
    const store = fileSessionStore(join(scratch, 'nested', 'session.json'));
    const session = {
      version: 1 as const,
      tabs: [{ kind: 'settings' as const }, { kind: 'brief' as const, path: '/a.brief' }],
      active: 1,
    };
    expect(await store.write(session)).toBe(true);
    expect(await store.read()).toEqual(session);
  });

  it('reads a version 1 file written before the template mode was kept (TYTO-266)', async () => {
    // The shape TYTO-113 wrote, and the shape an update imports (ADR 0036): no `template`.
    const file = join(scratch, 'session.json');
    const before = { version: 1, tabs: [{ kind: 'brief', path: '/a.brief' }], active: 0 };
    writeFileSync(file, JSON.stringify(before));
    expect(await fileSessionStore(file).read()).toEqual(before);
  });

  it('reads a version 1 file written before the cursor was kept (TYTO-265)', async () => {
    // TYTO-113's and TYTO-266's shape, with no `place`: tabs that open at the top, as before.
    const file = join(scratch, 'session.json');
    const before = {
      version: 1,
      tabs: [{ kind: 'brief', path: '/a.brief' }, { kind: 'settings' }],
      active: 1,
    };
    writeFileSync(file, JSON.stringify(before));
    expect(await fileSessionStore(file).read()).toEqual(before);
  });

  it('reads back where a tab was looking, and drops only a place that does not parse', async () => {
    const file = join(scratch, 'session.json');
    const store = fileSessionStore(file);
    const session = {
      version: 1 as const,
      tabs: [{ kind: 'brief' as const, path: '/a.brief', place: { anchor: 3, head: 9, top: 2 } }],
      active: 0,
    };
    expect(await store.write(session)).toBe(true);
    expect(await store.read()).toEqual(session);

    // A hand edit that broke the cursor costs the cursor, not the tabs and their drafts.
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        tabs: [{ kind: 'brief', path: '/a.brief', place: { anchor: -1, head: 'x' } }],
        active: 0,
      }),
    );
    expect(await store.read()).toEqual({
      version: 1,
      tabs: [{ kind: 'brief', path: '/a.brief' }],
      active: 0,
    });
  });

  it('reads back a template mode, with a draft per buffer', async () => {
    const store = fileSessionStore(join(scratch, 'session.json'));
    const session = {
      version: 1 as const,
      tabs: [],
      active: 0,
      template: {
        directory: '/t/cartaz',
        visible: 'markup' as const,
        drafts: { markup: { text: '<frame/>', savedHash: savedHashOf('') } },
      },
    };
    expect(await store.write(session)).toBe(true);
    expect(await store.read()).toEqual(session);
  });
});

/** A disk in memory, which a test changes between the two launches. */
const memoryDisk = (files: Record<string, string>) => ({
  read: (path: string) => {
    const text = files[path];
    return text === undefined ? Promise.reject(new Error(`ENOENT ${path}`)) : Promise.resolve(text);
  },
  write: (path: string, text: string) => {
    files[path] = text;
    return Promise.resolve();
  },
  exists: (path: string) => Promise.resolve(files[path] !== undefined),
});

const noRecent: RecentFiles = {
  list: () => Promise.resolve([]),
  remember: () => Promise.resolve(),
  knows: () => Promise.resolve(false),
} as unknown as RecentFiles;

const memoryStore = (): SessionStore & { saved: () => unknown } => {
  let held = EMPTY_SESSION;
  return {
    saved: () => held,
    read: () => Promise.resolve(held),
    write: (session) => {
      held = session;
      return Promise.resolve(true);
    },
  };
};

/** `template-editor.ts`'s `open` over the memory disk: a markup folder or a refused one. */
const openTemplate = (
  files: Record<string, string>,
  directory: string,
): Promise<OpenedTemplate> => {
  const manifest = files[`${directory}/manifest.yaml`];
  const markup = files[`${directory}/template.html`];
  return Promise.resolve(
    manifest === undefined || markup === undefined
      ? { kind: 'refused', directory, missing: 'manifest.yaml' }
      : { kind: 'markup', directory, manifest, markup, examples: [] },
  );
};

const SETTINGS = '/data/settings.json';
const KEYS = '/data/keybindings.json';
const SNIPPETS = '/data/snippets.json';

const setup = (
  files: Record<string, string>,
  endSettingsTab: (documentId: string) => Promise<boolean> = () => Promise.resolve(false),
  workspace?: SessionServiceOptions['workspace'],
) => {
  const disk = memoryDisk(files);
  const documents = createDocumentService({
    dialogs: {
      openBrief: () => Promise.resolve(undefined),
      saveBrief: () => Promise.resolve(undefined),
    },
    recent: noRecent,
    disk,
  });
  const store = memoryStore();
  const templateFolder = createTemplateFolder();
  const session = createSessionService({
    store,
    documents,
    appFiles: { settings: SETTINGS, keybindings: KEYS, snippets: SNIPPETS },
    readText: (path) => disk.read(path),
    endSettingsTab,
    templateFolder,
    openTemplate: (directory) => openTemplate(files, directory),
    ...(workspace === undefined ? {} : { workspace }),
  });
  return { documents, store, session, templateFolder };
};

/** TYTO-247, ADR 0132: a text tab is a file main holds by path, as a brief is. */
describe('a text tab in the session', () => {
  it('keeps a .md tab by its path and reopens it as Markdown, its draft over it', async () => {
    const { documents, store, session } = setup({ '/b/notas.md': '# Notas\n' });
    await documents.openPath('document-1', '/b/notas.md');

    await session.write({
      tabs: [
        {
          documentId: 'document-1',
          kind: 'markdown',
          draft: { text: '# Notas editadas\n', savedText: '# Notas\n' },
          place: null,
        },
      ],
      active: 0,
      template: null,
      final: false,
    });
    expect((store.saved() as { tabs: unknown }).tabs).toEqual([
      {
        kind: 'markdown',
        path: '/b/notas.md',
        draft: { text: '# Notas editadas\n', savedHash: savedHashOf('# Notas\n') },
      },
    ]);

    const [tab] = (await session.read()).tabs;
    expect(tab).toMatchObject({
      kind: 'markdown',
      documentId: 'session-1',
      document: { path: '/b/notas.md', name: 'notas.md', format: 'markdown', text: '# Notas\n' },
      draft: '# Notas editadas\n',
      stale: false,
      missing: null,
    });
  });

  it('keeps a .recipe tab by its path and reopens it as a recipe (TYTO-377)', async () => {
    const { documents, store, session } = setup({ '/b/semanal.recipe': 'recipe semanal\n' });
    await documents.openPath('document-1', '/b/semanal.recipe');

    await session.write({
      tabs: [{ documentId: 'document-1', kind: 'recipe', draft: null, place: null }],
      active: 0,
      template: null,
      final: false,
    });
    expect((store.saved() as { tabs: unknown }).tabs).toEqual([
      { kind: 'recipe', path: '/b/semanal.recipe' },
    ]);

    const [tab] = (await session.read()).tabs;
    expect(tab).toMatchObject({
      kind: 'recipe',
      document: { path: '/b/semanal.recipe', format: 'recipe', text: 'recipe semanal\n' },
    });
  });

  it('keeps a .txt tab in no file only while it holds a draft', async () => {
    const { store, session } = setup({});
    await session.write({
      tabs: [
        { documentId: 'document-1', kind: 'text', draft: null, place: null },
        {
          documentId: 'document-2',
          kind: 'text',
          draft: { text: 'a', savedText: '' },
          place: null,
        },
      ],
      active: 1,
      template: null,
      final: false,
    });
    expect((store.saved() as { tabs: unknown }).tabs).toEqual([
      { kind: 'text', draft: { text: 'a', savedHash: savedHashOf('') } },
    ]);
  });

  it('still reads a session.json written before text tabs, with no text kind in it', async () => {
    const file = join(scratch, 'session.json');
    const before = {
      version: 1,
      tabs: [{ kind: 'brief', path: '/a.brief' }, { kind: 'snippets' }],
      active: 0,
    };
    writeFileSync(file, JSON.stringify(before));
    expect(await fileSessionStore(file).read()).toEqual(before);
  });
});

describe('writing the session', () => {
  it('names each brief by the path main holds, never by one the window sent', async () => {
    const { documents, store, session } = setup({ '/b/a.brief': '::titulo A' });
    await documents.openPath('document-1', '/b/a.brief');

    await session.write({
      tabs: [{ documentId: 'document-1', kind: 'brief', draft: null, place: null }],
      active: 0,
      template: null,
      final: false,
    });

    expect(store.saved()).toEqual({
      version: 1,
      tabs: [{ kind: 'brief', path: '/b/a.brief' }],
      active: 0,
      groups: NO_GROUPS,
    });
  });

  it('keeps where each tab was looking, and hands it back as it was written (TYTO-265)', async () => {
    const { documents, store, session } = setup({ '/b/a.brief': '::titulo A' });
    await documents.openPath('document-1', '/b/a.brief');
    const place = { anchor: 4, head: 4, top: 0 };

    await session.write({
      tabs: [{ documentId: 'document-1', kind: 'brief', draft: null, place }],
      active: 0,
      template: null,
      final: false,
    });
    expect(store.saved()).toEqual({
      version: 1,
      tabs: [{ kind: 'brief', path: '/b/a.brief', place }],
      active: 0,
      groups: NO_GROUPS,
    });

    // Unclamped: main does not hold the text the window opens, and the window clamps.
    expect((await session.read()).tabs[0]).toMatchObject({ documentId: 'session-1', place });
  });

  it('keeps a draft as its text and the hash of the text it differs from', async () => {
    const { store, session } = setup({});
    await session.write({
      tabs: [
        {
          documentId: 'document-1',
          kind: 'brief',
          draft: { text: '::novo', savedText: '' },
          place: null,
        },
      ],
      active: 0,
      template: null,
      final: false,
    });
    expect(store.saved()).toEqual({
      version: 1,
      tabs: [{ kind: 'brief', draft: { text: '::novo', savedHash: savedHashOf('') } }],
      active: 0,
      groups: NO_GROUPS,
    });
  });

  it('drops a brief in no file with no draft, and keeps the active tab pointing right', async () => {
    const { documents, store, session } = setup({ '/b/a.brief': '::a' });
    await documents.openPath('document-2', '/b/a.brief');
    await session.write({
      tabs: [
        { documentId: 'document-1', kind: 'brief', draft: null, place: null },
        { documentId: 'document-2', kind: 'brief', draft: null, place: null },
      ],
      active: 1,
      template: null,
      final: false,
    });
    expect(store.saved()).toEqual({
      version: 1,
      tabs: [{ kind: 'brief', path: '/b/a.brief' }],
      active: 0,
      groups: NO_GROUPS,
    });
  });

  it('ends the settings tab on the quit, and keeps its draft against the file it wrote', async () => {
    const files: Record<string, string> = { [SETTINGS]: '{ "queueAutoRun": true }' };
    const ended: string[] = [];
    const { store, session } = setup(files, (documentId) => {
      ended.push(documentId);
      // The screens' change, written as `closed` writes it (ADR 0073 decision 8).
      files[SETTINGS] = '{ "queueAutoRun": true, "theme": "light" }';
      return Promise.resolve(true);
    });
    const draft = { text: '// mine\n{ "queueAutoRun": true, "theme": "light" }', savedText: '{}' };

    await session.write({
      tabs: [{ documentId: 'document-3', kind: 'settings', draft, place: null }],
      active: 0,
      template: null,
      final: false,
    });
    expect(ended).toEqual([]);
    await session.write({
      tabs: [{ documentId: 'document-3', kind: 'settings', draft, place: null }],
      active: 0,
      template: null,
      final: true,
    });

    expect(ended).toEqual(['document-3']);
    expect(store.saved()).toEqual({
      version: 1,
      tabs: [
        {
          kind: 'settings',
          draft: { text: draft.text, savedHash: savedHashOf(files[SETTINGS] ?? '') },
        },
      ],
      active: 0,
      groups: NO_GROUPS,
    });
  });
});

describe('reading the session back', () => {
  const kept = async (files: Record<string, string>, tabs: unknown[]) => {
    const built = setup(files);
    await built.store.write({ version: 1, tabs: tabs as never, active: 0 });
    return built;
  };

  it('reopens a saved brief by its path, under an id of main’s own', async () => {
    const { documents, session } = await kept({ '/b/a.brief': '::a' }, [
      { kind: 'brief', path: '/b/a.brief' },
    ]);
    const answer = await session.read();
    expect(answer.tabs).toEqual([
      {
        kind: 'brief',
        documentId: 'session-1',
        // The folder to show on hover comes back with it (TYTO-288, ADR 0086).
        document: {
          path: '/b/a.brief',
          name: 'a.brief',
          pathLabel: '/b/a.brief',
          text: '::a',
          format: 'brief',
        },
        draft: null,
        stale: false,
        missing: null,
        place: null,
      },
    ]);
    expect(documents.pathOf('session-1')).toBe('/b/a.brief');
  });

  it('offers a draft over a file that still says what it said', async () => {
    const { session } = await kept({ '/b/a.brief': '::a\r\n' }, [
      {
        kind: 'brief',
        path: '/b/a.brief',
        draft: { text: '::a editado', savedHash: savedHashOf('::a\n') },
      },
    ]);
    const [tab] = (await session.read()).tabs;
    // CR LF on disk, LF in the buffer the hash was taken from: the same file (TYTO-64).
    expect(tab).toMatchObject({ draft: '::a editado', stale: false });
  });

  it('never puts a draft over a file that changed on disk: it is stale', async () => {
    const { session } = await kept({ '/b/a.brief': '::mudou lá fora' }, [
      {
        kind: 'brief',
        path: '/b/a.brief',
        draft: { text: '::a editado', savedHash: savedHashOf('::a') },
      },
    ]);
    const [tab] = (await session.read()).tabs;
    expect(tab).toMatchObject({
      document: { text: '::mudou lá fora' },
      draft: '::a editado',
      stale: true,
    });
  });

  it('names a file that is gone, and still hands back its draft', async () => {
    const { session } = await kept({}, [
      {
        kind: 'brief',
        path: '/b/sumiu.brief',
        draft: { text: '::meu texto', savedHash: savedHashOf('::a') },
      },
      { kind: 'brief', path: '/b/sumiu-tambem.brief' },
    ]);
    const tabs = (await session.read()).tabs;
    expect(tabs[0]).toMatchObject({
      document: null,
      documentId: null,
      draft: '::meu texto',
      missing: 'sumiu.brief',
    });
    expect(tabs[1]).toMatchObject({ document: null, draft: null, missing: 'sumiu-tambem.brief' });
  });

  it('hands back an untitled draft as text with no file', async () => {
    const { session } = await kept({}, [
      { kind: 'brief', draft: { text: '::rascunho', savedHash: savedHashOf('') } },
    ]);
    expect((await session.read()).tabs).toEqual([
      {
        kind: 'brief',
        documentId: null,
        document: null,
        draft: '::rascunho',
        stale: false,
        missing: null,
        place: null,
      },
    ]);
  });

  it('compares a draft of the app’s own file against that file', async () => {
    const { session } = await kept({ [SETTINGS]: '{}', [KEYS]: '[1]', [SNIPPETS]: '{}' }, [
      { kind: 'settings', draft: { text: '{ "x": 1 }', savedHash: savedHashOf('{}') } },
      { kind: 'keybindings', draft: { text: '[]', savedHash: savedHashOf('[]') } },
      // TYTO-277: the snippets tab is the third of the app's files, compared the same way.
      { kind: 'snippets', draft: { text: '{ "A": {} }', savedHash: savedHashOf('{}') } },
    ]);
    const tabs = (await session.read()).tabs;
    expect(tabs[0]).toMatchObject({ kind: 'settings', draft: '{ "x": 1 }', stale: false });
    expect(tabs[1]).toMatchObject({ kind: 'keybindings', draft: '[]', stale: true });
    expect(tabs[2]).toMatchObject({ kind: 'snippets', draft: '{ "A": {} }', stale: false });
  });

  it('forgets the tabs of the page before, whose ids the new page reuses', async () => {
    const { documents, session } = await kept({ '/b/a.brief': '::a' }, []);
    await documents.openPath('document-1', '/b/a.brief');
    await session.read();
    expect(documents.pathOf('document-1')).toBeUndefined();
  });
});

describe('the template mode in the session (TYTO-266)', () => {
  const FOLDER = '/t/cartaz';
  const MANIFEST = 'name: cartaz\n';
  const MARKUP = '<frame format="feed" />\n';
  const folder = (): Record<string, string> => ({
    [`${FOLDER}/manifest.yaml`]: MANIFEST,
    [`${FOLDER}/template.html`]: MARKUP,
  });
  const mode = {
    visible: 'markup' as const,
    manifest: null,
    markup: { text: `${MARKUP}<!-- meu -->`, savedText: MARKUP },
  };

  it('keeps the folder main filed, never one the window sent, and each draft as a hash', async () => {
    const { store, session, templateFolder } = setup(folder());
    templateFolder.set(FOLDER);

    await session.write({ tabs: [], active: 0, template: mode, final: true });

    expect(store.saved()).toEqual({
      version: 1,
      tabs: [],
      active: 0,
      template: {
        directory: FOLDER,
        visible: 'markup',
        drafts: { markup: { text: mode.markup.text, savedHash: savedHashOf(MARKUP) } },
      },
      groups: NO_GROUPS,
    });
  });

  it('keeps nothing of the mode when it is closed, or when main filed no folder', async () => {
    const { store, session, templateFolder } = setup(folder());
    templateFolder.set(FOLDER);
    await session.write({ tabs: [], active: 0, template: null, final: false });
    expect(store.saved()).toEqual({ version: 1, tabs: [], active: 0, groups: NO_GROUPS });

    templateFolder.set(undefined);
    await session.write({ tabs: [], active: 0, template: mode, final: false });
    expect(store.saved()).toEqual({ version: 1, tabs: [], active: 0, groups: NO_GROUPS });
  });

  it('reopens the folder as it reads now, with a fresh draft offered over its file', async () => {
    const { session, templateFolder } = setup(folder());
    templateFolder.set(FOLDER);
    await session.write({ tabs: [], active: 0, template: mode, final: true });
    templateFolder.set(undefined);

    const { template } = await session.read();

    expect(template).toEqual({
      opened: {
        kind: 'markup',
        directory: FOLDER,
        manifest: MANIFEST,
        markup: MARKUP,
        examples: [],
      },
      name: 'cartaz',
      visible: 'markup',
      manifest: { draft: null, stale: false },
      markup: { draft: mode.markup.text, stale: false },
    });
    // Filed again for the page that restores it, so its next write names the same folder.
    expect(templateFolder.current()).toBe(FOLDER);
  });

  it('never puts a draft over a template file that changed on disk: it is stale', async () => {
    const files = folder();
    const { session, templateFolder } = setup(files);
    templateFolder.set(FOLDER);
    await session.write({ tabs: [], active: 0, template: mode, final: true });
    files[`${FOLDER}/template.html`] = '<frame format="story" />\n';

    const { template } = await session.read();

    expect(template?.opened?.markup).toBe('<frame format="story" />\n');
    expect(template?.markup).toEqual({ draft: mode.markup.text, stale: true });
    expect(template?.manifest).toEqual({ draft: null, stale: false });
  });

  it('hands back the drafts of a folder that is gone, with nothing to open', async () => {
    const files = folder();
    const { session, templateFolder } = setup(files);
    templateFolder.set(FOLDER);
    await session.write({ tabs: [], active: 0, template: mode, final: true });
    delete files[`${FOLDER}/manifest.yaml`];
    delete files[`${FOLDER}/template.html`];

    const { template } = await session.read();

    expect(template).toMatchObject({
      opened: null,
      name: 'cartaz',
      markup: { draft: mode.markup.text, stale: false },
    });
    expect(templateFolder.current()).toBeUndefined();
  });

  it('answers no template mode for a session that had none', async () => {
    const { session } = setup({});
    expect((await session.read()).template).toBeNull();
  });
});

describe('the editor groups in the session (TYTO-286)', () => {
  const place = (anchor: number) => ({ anchor, head: anchor, top: 0 });
  /** Two briefs: `a` on the left, `a` and `b` on the right, which has the focus. */
  const twoGroups = {
    root: {
      split: 'row' as const,
      sizes: [0.5, 0.5],
      children: [
        { tabs: [{ documentId: 'document-1', place: place(1) }], active: 0 },
        {
          tabs: [
            { documentId: 'document-1', place: place(5) },
            { documentId: 'document-2', place: place(2) },
          ],
          active: 1,
        },
      ],
    },
    focused: 1,
  };
  const kept = {
    root: {
      split: 'row',
      sizes: [0.5, 0.5],
      children: [
        { tabs: [{ tab: 0, place: place(1) }], active: 0 },
        {
          tabs: [
            { tab: 0, place: place(5) },
            { tab: 1, place: place(2) },
          ],
          active: 1,
        },
      ],
    },
    focused: 1,
  };
  const twoBriefs = async () => {
    const built = setup({ '/b/a.brief': '::titulo A', '/b/b.brief': '::titulo B' });
    await built.documents.openPath('document-1', '/b/a.brief');
    await built.documents.openPath('document-2', '/b/b.brief');
    return built;
  };
  const tabs = [
    { documentId: 'document-1', kind: 'brief' as const, draft: null, place: place(1) },
    { documentId: 'document-2', kind: 'brief' as const, draft: null, place: place(2) },
  ];

  it('keeps the tree with each tab as an index of the kept tabs, and a cursor per tab', async () => {
    const { store, session } = await twoBriefs();
    await session.write({ tabs, active: 1, template: null, groups: twoGroups, final: false });
    expect(store.saved()).toMatchObject({ active: 1, groups: kept });
  });

  it('round-trips through the file, and hands the tree back by index', async () => {
    const built = await twoBriefs();
    await built.session.write({ tabs, active: 1, template: null, groups: twoGroups, final: false });
    const store = fileSessionStore(join(scratch, 'session.json'));
    expect(await store.write(built.store.saved() as never)).toBe(true);
    expect(await store.read()).toEqual(built.store.saved());

    expect((await built.session.read()).groups).toEqual(kept);
  });

  it('drops a tab that was not kept, and the group it leaves empty collapses', async () => {
    const { store, session } = await twoBriefs();
    await session.write({
      tabs: [
        ...tabs,
        // An untitled tab nobody typed in: not kept, so its group goes and the split with it.
        { documentId: 'document-9', kind: 'brief', draft: null, place: null },
      ],
      active: 0,
      template: null,
      groups: {
        root: {
          split: 'column',
          sizes: [0.25, 0.75],
          children: [
            {
              tabs: [
                { documentId: 'document-1', place: null },
                { documentId: 'document-2', place: null },
              ],
              active: 0,
            },
            { tabs: [{ documentId: 'document-9', place: null }], active: 0 },
          ],
        },
        focused: 1,
      },
      final: false,
    });

    expect(store.saved()).toMatchObject({
      groups: { root: { tabs: [{ tab: 0 }, { tab: 1 }], active: 0 }, focused: 0 },
    });
  });

  it('keeps one empty group for a window that sent none, and reads it back as none', async () => {
    // Every session from a build that keeps groups carries them (TYTO-287): a session without
    // them is how a launch knows it is the first one.
    const { store, session } = await twoBriefs();
    await session.write({ tabs, active: 0, template: null, final: false });
    expect(store.saved()).toMatchObject({ groups: NO_GROUPS });
    expect(await session.read()).toMatchObject({ groups: null, firstLaunch: false });
  });

  it('reads a version 1 file written before the groups were kept, which is one group', async () => {
    // TYTO-265's shape, the one an update imports byte for byte (ADR 0036): no `groups`.
    const file = join(scratch, 'session.json');
    const before = {
      version: 1,
      tabs: [{ kind: 'brief', path: '/a.brief', place: place(3) }],
      active: 0,
    };
    writeFileSync(file, JSON.stringify(before));
    expect(await fileSessionStore(file).read()).toEqual(before);
  });

  it('drops only the tree when it does not parse: the tabs and their drafts survive', async () => {
    const file = join(scratch, 'session.json');
    const draft = { text: '::rascunho', savedHash: savedHashOf('') };
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        tabs: [{ kind: 'brief', draft }],
        active: 0,
        groups: { root: { split: 'diagonal', children: 'no' }, focused: -1 },
      }),
    );
    expect(await fileSessionStore(file).read()).toEqual({
      version: 1,
      tabs: [{ kind: 'brief', draft }],
      active: 0,
      groups: NO_GROUPS,
    });
  });

  it('drops a tab index the file names but has no tab for', async () => {
    const { store, session } = setup({});
    await store.write({
      version: 1,
      tabs: [{ kind: 'brief', draft: { text: '::a', savedHash: savedHashOf('') } }],
      active: 0,
      groups: {
        root: {
          split: 'row',
          sizes: [0.5, 0.5],
          children: [
            { tabs: [{ tab: 0 }], active: 0 },
            { tabs: [{ tab: 7 }], active: 0 },
          ],
        },
        focused: 1,
      },
    });
    expect((await session.read()).groups).toEqual({
      root: { tabs: [{ tab: 0, place: null }], active: 0 },
      focused: 0,
    });
  });
});

describe('the previews in the session (TYTO-287, ADR 0084)', () => {
  const place = (anchor: number) => ({ anchor, head: anchor, top: 0 });
  const twoBriefs = async () => {
    const built = setup({ '/b/a.brief': '::titulo A', '/b/b.brief': '::titulo B' });
    await built.documents.openPath('document-1', '/b/a.brief');
    await built.documents.openPath('document-2', '/b/b.brief');
    return built;
  };
  const tabs = [
    { documentId: 'document-1', kind: 'brief' as const, draft: null, place: place(1) },
    { documentId: 'document-2', kind: 'brief' as const, draft: null, place: place(2) },
  ];
  /** `a` and `b` on the left; a preview locked on `a` and the following one on the right. */
  const withPreviews = {
    root: {
      split: 'row' as const,
      sizes: [0.5, 0.5],
      children: [
        {
          tabs: [
            { documentId: 'document-1', place: place(1) },
            { documentId: 'document-2', place: place(2) },
          ],
          active: 1,
        },
        {
          tabs: [
            { documentId: 'document-1', view: 'preview' as const, locked: true as const },
            { view: 'preview' as const },
          ],
          active: 1,
        },
      ],
    },
    focused: 0,
  };
  const keptPreviews = [{ tab: 0, view: 'preview', locked: true }, { view: 'preview' }];

  it('keeps a following preview as a view and a locked one by its brief’s index, no path', async () => {
    const { store, session } = await twoBriefs();
    await session.write({ tabs, active: 1, template: null, groups: withPreviews, final: false });
    expect(store.saved()).toMatchObject({
      groups: { root: { children: [{ active: 1 }, { tabs: keptPreviews, active: 1 }] } },
    });
    expect(JSON.stringify((store.saved() as { groups: unknown }).groups)).not.toContain('/b/');
  });

  it('round-trips both previews through the file and hands them back', async () => {
    const built = await twoBriefs();
    await built.session.write({
      tabs,
      active: 1,
      template: null,
      groups: withPreviews,
      final: false,
    });
    const store = fileSessionStore(join(scratch, 'session.json'));
    expect(await store.write(built.store.saved() as never)).toBe(true);
    expect(await store.read()).toEqual(built.store.saved());

    const read = await built.session.read();
    expect(read.firstLaunch).toBe(false);
    expect(read.groups?.root).toMatchObject({ children: [{}, { tabs: keptPreviews }] });
  });

  it('keeps a hidden strip per preview through the file, and reads an old record as shown', async () => {
    // TYTO-323 (ADR 0123): the strip of slide thumbnails is hidden per tab, so each preview
    // carries its own flag; one written before the flag existed shows its strip.
    const built = await twoBriefs();
    const hidden = {
      ...withPreviews,
      root: {
        ...withPreviews.root,
        children: [
          withPreviews.root.children[0]!,
          {
            tabs: [
              {
                documentId: 'document-1',
                view: 'preview' as const,
                locked: true as const,
                stripHidden: true as const,
              },
              { view: 'preview' as const },
            ],
            active: 1,
          },
        ],
      },
    };
    await built.session.write({ tabs, active: 1, template: null, groups: hidden, final: false });
    const kept = [
      { tab: 0, view: 'preview', locked: true, stripHidden: true },
      { view: 'preview' },
    ];
    expect(built.store.saved()).toMatchObject({
      groups: { root: { children: [{}, { tabs: kept }] } },
    });
    const file = fileSessionStore(join(scratch, 'session.json'));
    expect(await file.write(built.store.saved() as never)).toBe(true);
    expect(await file.read()).toEqual(built.store.saved());
    const read = await built.session.read();
    expect(read.groups?.root).toMatchObject({ children: [{}, { tabs: kept }] });
    // A following preview with its strip shown carries no flag at all.
    expect(read.groups?.root).toEqual(
      expect.objectContaining({
        children: [
          expect.anything(),
          expect.objectContaining({ tabs: [kept[0], { view: 'preview' }] }),
        ],
      }),
    );
  });

  it('keeps All slides mode per preview through the file, and reads an old record as one', async () => {
    // TYTO-323 (ADR 0123): the mode is kept as the strip's flag is, next to it, and only `all`
    // is written; a record with no mode, or one this version does not know, reads as One slide.
    const built = await twoBriefs();
    const modes = {
      ...withPreviews,
      root: {
        ...withPreviews.root,
        children: [
          withPreviews.root.children[0]!,
          {
            tabs: [
              {
                documentId: 'document-1',
                view: 'preview' as const,
                locked: true as const,
                stripHidden: true as const,
                mode: 'all' as const,
              },
              { view: 'preview' as const, mode: 'all' as const },
            ],
            active: 1,
          },
        ],
      },
    };
    await built.session.write({ tabs, active: 1, template: null, groups: modes, final: false });
    const kept = [
      { tab: 0, view: 'preview', locked: true, stripHidden: true, mode: 'all' },
      { view: 'preview', mode: 'all' },
    ];
    expect(built.store.saved()).toMatchObject({
      groups: { root: { children: [{}, { tabs: kept }] } },
    });
    const file = fileSessionStore(join(scratch, 'session.json'));
    expect(await file.write(built.store.saved() as never)).toBe(true);
    expect(await file.read()).toEqual(built.store.saved());
    const read = await built.session.read();
    expect(read.groups?.root).toMatchObject({ children: [{}, { tabs: kept }] });

    // A record from before the mode, and one with a mode it does not know, read as One slide.
    const saved = built.store.saved() as { groups: { root: { children: unknown[] } } };
    const old = {
      ...saved,
      groups: {
        ...saved.groups,
        root: {
          ...saved.groups.root,
          children: [
            saved.groups.root.children[0],
            { tabs: [{ view: 'preview' }, { view: 'preview', mode: 'grid' }], active: 0 },
          ],
        },
      },
    };
    writeFileSync(join(scratch, 'session.json'), JSON.stringify(old));
    const back = (await file.read())?.groups?.root;
    expect(back).toMatchObject({
      children: [{}, { tabs: [{ view: 'preview' }, { view: 'preview' }] }],
    });
    expect(JSON.stringify(back)).not.toContain('"mode"');
  });

  it('drops a locked preview whose brief was not kept, and keeps the following one', async () => {
    const { store, session } = await twoBriefs();
    await session.write({
      tabs: [...tabs, { documentId: 'document-9', kind: 'brief', draft: null, place: null }],
      active: 0,
      template: null,
      groups: {
        root: {
          tabs: [
            { documentId: 'document-1', place: null },
            { documentId: 'document-9', view: 'preview', locked: true },
            { view: 'preview' },
          ],
          active: 2,
        },
        focused: 0,
      },
      final: false,
    });
    expect(store.saved()).toMatchObject({
      groups: { root: { tabs: [{ tab: 0 }, { view: 'preview' }], active: 1 } },
    });
  });

  it('drops a locked preview whose brief did not come back, and a group it leaves empty', async () => {
    const { store, session } = setup({ '/b/a.brief': '::titulo A' });
    await store.write({
      version: 1,
      tabs: [
        { kind: 'brief', path: '/b/a.brief' },
        { kind: 'brief', path: '/b/gone.brief' },
      ],
      active: 0,
      groups: {
        root: {
          split: 'row',
          sizes: [0.5, 0.5],
          children: [
            { tabs: [{ tab: 0 }, { tab: 1 }], active: 0 },
            { tabs: [{ tab: 1, view: 'preview', locked: true }], active: 0 },
          ],
        },
        focused: 1,
      },
    });
    expect((await session.read()).groups).toEqual({
      root: {
        tabs: [
          { tab: 0, place: null },
          { tab: 1, place: null },
        ],
        active: 0,
      },
      focused: 0,
    });
  });

  it('is a first launch with no file, and with a version 1 file from before the groups', async () => {
    // The memory store starts where `fileSessionStore` answers for a missing file.
    const { store, session } = setup({ '/b/a.brief': '::titulo A' });
    expect((await session.read()).firstLaunch).toBe(true);

    await store.write({ version: 1, tabs: [{ kind: 'brief', path: '/b/a.brief' }], active: 0 });
    const before = await session.read();
    expect(before).toMatchObject({ firstLaunch: true, groups: null });
    expect(before.tabs).toHaveLength(1);
  });
});

describe('the workspace folder in the session (TYTO-278, ADR 0113)', () => {
  const workspaceHolder = (folder?: string) => {
    let open = folder;
    const reopened: (string | undefined)[] = [];
    return {
      reopened,
      current: () => open,
      reopen: (next: string | undefined) => {
        reopened.push(next);
        open = next;
        return Promise.resolve();
      },
    };
  };

  it('keeps the folder main has open, and nothing when none is', async () => {
    const holder = workspaceHolder('/work/promo');
    const { store, session } = setup({}, undefined, holder);
    await session.write({ tabs: [], active: 0, template: null, final: false });
    expect(store.saved()).toMatchObject({ workspace: { folder: '/work/promo' } });

    await holder.reopen(undefined);
    await session.write({ tabs: [], active: 0, template: null, final: false });
    expect(store.saved()).not.toHaveProperty('workspace');
  });

  it('reopens the kept folder through main before the tabs come back', async () => {
    const holder = workspaceHolder('/work/promo');
    const { session } = setup({}, undefined, holder);
    await session.write({ tabs: [], active: 0, template: null, final: false });

    const next = workspaceHolder();
    const { store, session: later } = setup({}, undefined, next);
    await store.write({ version: 1, tabs: [], active: 0, workspace: { folder: '/work/promo' } });
    await later.read();
    expect(next.reopened).toEqual(['/work/promo']);
    // A session that kept none closes whatever the last page had open.
    await store.write({ version: 1, tabs: [], active: 0 });
    await later.read();
    expect(next.reopened).toEqual(['/work/promo', undefined]);
  });
});
