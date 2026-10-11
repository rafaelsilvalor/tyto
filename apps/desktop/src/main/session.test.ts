import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDocumentService } from './documents.js';
import { type RecentFiles } from './recent-files.js';
import { createSessionService, savedHashOf } from './session.js';
import { EMPTY_SESSION, type SessionStore, fileSessionStore } from './session-store.js';

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

const SETTINGS = '/data/settings.json';
const KEYS = '/data/keybindings.json';

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
  const session = createSessionService({
    store,
    documents,
    appFiles: { settings: SETTINGS, keybindings: KEYS },
    readText: (path) => disk.read(path),
    endSettingsTab,
  });
  return { documents, store, session };
};

describe('writing the session', () => {
  it('names each brief by the path main holds, never by one the window sent', async () => {
    const { documents, store, session } = setup({ '/b/a.brief': '::titulo A' });
    await documents.openPath('document-1', '/b/a.brief');

    await session.write({
      tabs: [{ documentId: 'document-1', kind: 'brief', draft: null }],
      active: 0,
      final: false,
    });

    expect(store.saved()).toEqual({
      version: 1,
      tabs: [{ kind: 'brief', path: '/b/a.brief' }],
      active: 0,
    });
  });

  it('keeps a draft as its text and the hash of the text it differs from', async () => {
    const { store, session } = setup({});
    await session.write({
      tabs: [{ documentId: 'document-1', kind: 'brief', draft: { text: '::novo', savedText: '' } }],
      active: 0,
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
        { documentId: 'document-1', kind: 'brief', draft: null },
        { documentId: 'document-2', kind: 'brief', draft: null },
      ],
      active: 1,
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
      tabs: [{ documentId: 'document-3', kind: 'settings', draft }],
      active: 0,
      final: false,
    });
    expect(ended).toEqual([]);
    await session.write({
      tabs: [{ documentId: 'document-3', kind: 'settings', draft }],
      active: 0,
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
      },
    ]);
  });

  it('compares a draft of the app’s own file against that file', async () => {
    const { session } = await kept({ [SETTINGS]: '{}', [KEYS]: '[1]' }, [
      { kind: 'settings', draft: { text: '{ "x": 1 }', savedHash: savedHashOf('{}') } },
      { kind: 'keybindings', draft: { text: '[]', savedHash: savedHashOf('[]') } },
    ]);
    const tabs = (await session.read()).tabs;
    expect(tabs[0]).toMatchObject({ kind: 'settings', draft: '{ "x": 1 }', stale: false });
    expect(tabs[1]).toMatchObject({ kind: 'keybindings', draft: '[]', stale: true });
  });

  it('forgets the tabs of the page before, whose ids the new page reuses', async () => {
    const { documents, session } = await kept({ '/b/a.brief': '::a' }, []);
    await documents.openPath('document-1', '/b/a.brief');
    await session.read();
    expect(documents.pathOf('document-1')).toBeUndefined();
  });
});
