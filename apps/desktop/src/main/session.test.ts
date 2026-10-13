import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDocumentService } from './documents.js';
import { type RecentFiles } from './recent-files.js';
import { createSessionService, createTemplateFolder, savedHashOf } from './session.js';
import { EMPTY_SESSION, type SessionStore, fileSessionStore } from './session-store.js';
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
    writeFileSync(file, '{ not json');
    expect(await fileSessionStore(file).read()).toEqual(EMPTY_SESSION);
    writeFileSync(file, JSON.stringify({ version: 2, tabs: 'no' }));
    expect(await fileSessionStore(file).read()).toEqual(EMPTY_SESSION);
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
  });
  return { documents, store, session, templateFolder };
};

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
        document: { path: '/b/a.brief', name: 'a.brief', text: '::a' },
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
    });
  });

  it('keeps nothing of the mode when it is closed, or when main filed no folder', async () => {
    const { store, session, templateFolder } = setup(folder());
    templateFolder.set(FOLDER);
    await session.write({ tabs: [], active: 0, template: null, final: false });
    expect(store.saved()).toEqual({ version: 1, tabs: [], active: 0 });

    templateFolder.set(undefined);
    await session.write({ tabs: [], active: 0, template: mode, final: false });
    expect(store.saved()).toEqual({ version: 1, tabs: [], active: 0 });
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
