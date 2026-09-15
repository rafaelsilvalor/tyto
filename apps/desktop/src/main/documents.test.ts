import { describe, expect, it } from 'vitest';

import { type FileDialogs, createDocumentService } from './documents.js';
import { type RecentEntry, type RecentFiles } from './recent-files.js';

/**
 * Opening, saving and the recent list, with no disk and no Electron under them (E9.8).
 *
 * The service names neither, which is what this file is proving as much as testing: the
 * dialogs are a port and the disk is injected, so every branch that matters — a dismissed
 * dialog, a file that moved, a path nobody offered — is reachable without a window.
 *
 * `recent-files.test.ts` drives the real store against a real folder. What is here is the
 * service's own decisions, and the load-bearing one is `reopen`: the renderer may name a
 * path, and the only thing standing between that and an arbitrary read is the check below.
 */

const SEP = process.platform === 'win32' ? '\\' : '/';
const at = (...parts: string[]): string => parts.join(SEP);

const BRIEF = at('briefs', 'campanha.brief');
const OTHER = at('outros', 'promo.brief');

/** A recent list in memory, with the same two rules the file one has. */
function recentFiles(initial: readonly RecentEntry[] = []): RecentFiles {
  let entries = [...initial];
  return {
    list: () => Promise.resolve(entries),
    remember: (entry) => {
      entries = [entry, ...entries.filter((item) => item.path !== entry.path)];
      return Promise.resolve(entries);
    },
    knows: (path) => Promise.resolve(entries.some((entry) => entry.path === path)),
  };
}

function disk(files: Record<string, string>) {
  const written: Record<string, string> = { ...files };
  return {
    written,
    read: (path: string) =>
      path in written ? Promise.resolve(written[path] ?? '') : Promise.reject(new Error('ENOENT')),
    write: (path: string, text: string) => {
      written[path] = text;
      return Promise.resolve();
    },
    exists: (path: string) => Promise.resolve(path in written),
  };
}

const dialogs = (answers: { open?: string; save?: string }): FileDialogs => ({
  openBrief: () => Promise.resolve(answers.open),
  saveBrief: () => Promise.resolve(answers.save),
});

describe('opening', () => {
  it('hands back the text and the name, and never the folder', async () => {
    const service = createDocumentService({
      dialogs: dialogs({ open: BRIEF }),
      recent: recentFiles(),
      disk: disk({ [BRIEF]: '::titulo Olá' }),
    });

    const document = await service.open();

    expect(document).toEqual({ path: BRIEF, name: 'campanha.brief', text: '::titulo Olá' });
  });

  it('answers nothing for a dismissed dialog, which is not a failure', async () => {
    const service = createDocumentService({
      dialogs: dialogs({}),
      recent: recentFiles(),
      disk: disk({}),
    });

    await expect(service.open()).resolves.toBeNull();
    // And nothing was adopted: the folder is still unknown, so the preview still says so.
    expect(service.baseDirectory()).toBeUndefined();
  });

  it('gives the preview a folder to resolve assets against', async () => {
    // The half of this card that is not plumbing: until something is open, a brief naming
    // `assets/logo.png` previews with the exporter's missing-asset diagnostic.
    const service = createDocumentService({
      dialogs: dialogs({ open: BRIEF }),
      recent: recentFiles(),
      disk: disk({ [BRIEF]: '' }),
    });

    expect(service.baseDirectory()).toBeUndefined();
    await service.open();
    expect(service.baseDirectory()).toBe('briefs');
  });
});

describe('saving', () => {
  it('asks for a name the first time and not the second', async () => {
    const asked: string[] = [];
    const store = disk({});
    const service = createDocumentService({
      dialogs: {
        openBrief: () => Promise.resolve(undefined),
        saveBrief: (suggested) => {
          asked.push(suggested ?? '(none)');
          return Promise.resolve(BRIEF);
        },
      },
      recent: recentFiles(),
      disk: store,
    });

    await service.save('primeiro', false);
    await service.save('segundo', false);

    expect(asked).toEqual(['(none)']);
    expect(store.written[BRIEF]).toBe('segundo');
  });

  it('asks again when the caller says save-as, and moves to the new file', async () => {
    const store = disk({});
    const service = createDocumentService({
      dialogs: dialogs({ save: OTHER }),
      recent: recentFiles(),
      disk: store,
    });

    const document = await service.save('texto', true);

    expect(document?.name).toBe('promo.brief');
    expect(store.written[OTHER]).toBe('texto');
    expect(service.baseDirectory()).toBe('outros');
  });

  it('writes nothing when the dialog is dismissed', async () => {
    const store = disk({});
    const service = createDocumentService({
      dialogs: dialogs({}),
      recent: recentFiles(),
      disk: store,
    });

    await expect(service.save('texto', false)).resolves.toBeNull();
    expect(Object.keys(store.written)).toEqual([]);
  });
});

describe('reopening from the recent list', () => {
  it('refuses a path this app never offered', async () => {
    // The containment, and the whole reason the renderer is allowed to name a path at all.
    // A renderer asking for a file outside the list gets the same answer as one asking for
    // a deleted file, which also tells a hostile caller nothing about what exists.
    const service = createDocumentService({
      dialogs: dialogs({}),
      recent: recentFiles([{ path: BRIEF, name: 'campanha.brief' }]),
      disk: disk({ [BRIEF]: 'ok', [at('etc', 'passwd')]: 'root:x:0:0' }),
    });

    await expect(service.reopen(at('etc', 'passwd'))).resolves.toEqual({
      document: null,
      missing: false,
    });
  });

  it('opens one it does know', async () => {
    const service = createDocumentService({
      dialogs: dialogs({}),
      recent: recentFiles([{ path: BRIEF, name: 'campanha.brief' }]),
      disk: disk({ [BRIEF]: '::titulo Olá' }),
    });

    const answer = await service.reopen(BRIEF);

    expect(answer.missing).toBe(false);
    expect(answer.document?.text).toBe('::titulo Olá');
  });

  it('reports a file that has moved rather than dropping it', async () => {
    // The acceptance criterion, and the reason it is worded that way: an entry that
    // vanished from the list on the one click that would have explained it is the worst
    // version of this.
    const service = createDocumentService({
      dialogs: dialogs({}),
      recent: recentFiles([{ path: BRIEF, name: 'campanha.brief' }]),
      disk: disk({}),
    });

    await expect(service.reopen(BRIEF)).resolves.toEqual({ document: null, missing: true });
  });
});

describe('the recent list the bar shows', () => {
  it('marks what is gone instead of hiding it', async () => {
    const service = createDocumentService({
      dialogs: dialogs({}),
      recent: recentFiles([
        { path: BRIEF, name: 'campanha.brief' },
        { path: OTHER, name: 'promo.brief' },
      ]),
      disk: disk({ [BRIEF]: 'ok' }),
    });

    await expect(service.recent()).resolves.toEqual({
      files: [
        { path: BRIEF, name: 'campanha.brief', missing: false },
        { path: OTHER, name: 'promo.brief', missing: true },
      ],
    });
  });

  it('puts what was just opened at the front', async () => {
    const service = createDocumentService({
      dialogs: dialogs({ open: OTHER }),
      recent: recentFiles([{ path: BRIEF, name: 'campanha.brief' }]),
      disk: disk({ [BRIEF]: 'a', [OTHER]: 'b' }),
    });

    await service.open();

    const { files } = await service.recent();
    expect(files.map((file) => file.name)).toEqual(['promo.brief', 'campanha.brief']);
  });
});
