import { type Layout, DEFAULT_LAYOUT } from '../../shared/layout.js';
import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNEL_NAMES, IpcContractError } from '../../shared/ipc.js';
import { type Credentials } from './credentials.js';
import { createHandlers, guard, registerIpcHandlers } from './ipc.js';

/**
 * The wiring, without Electron.
 *
 * `ipc.ts` names no Electron value — only the `IpcMain` type, which is erased — so the
 * whole of what a message goes through can be driven here: the contract on the way in, the
 * handler, and the contract on the way out. What is left for the end-to-end suite is the
 * transport and the window flags, which are the only parts a real launch can tell you about.
 */

const credentials = (): Credentials => {
  const stored = new Map<string, string>();
  return {
    set: (account, secret) => {
      stored.set(account, secret);
      return Promise.resolve();
    },
    get: (account) => Promise.resolve(stored.get(account) ?? null),
    delete: (account) => Promise.resolve(stored.delete(account)),
  };
};

/**
 * A preview that compiles nothing.
 *
 * `preview.test.ts` drives the real one against the real pack; what this file is about is
 * the registration and the contract, and those are the same whichever service answers.
 */
const preview = () => ({
  folders: [] as (string | undefined)[],
  preview(brief: string, baseDirectory?: string) {
    this.folders.push(baseDirectory);
    return Promise.resolve({
      frames:
        brief.trim() === ''
          ? []
          : [{ artwork: 'a1', format: 'feed', width: 1080, height: 1080, html: '<!doctype html>' }],
      artworks: brief.trim() === '' ? [] : [{ id: 'a1', index: 0, range: { start: 4, end: 9 } }],
      diagnostics: [],
    });
  },
});

/** A catalogue that read one folder. `templates.test.ts` drives the real one. */
const catalogue = () => ({
  list: () => ({
    templates: [
      { name: 'promo', version: '1.0.0', description: 'A promo', formats: ['feed', 'story'] },
    ],
    failures: [],
  }),
});

/**
 * A document service with one file in it and no disk under it (E9.8).
 *
 * `documents.test.ts` drives the real one, dialogs and all. What this file needs is
 * something that answers the four channels, because the registration loop is the subject
 * here and a channel with no handler is the failure it exists to prevent.
 */
const documents = () => {
  const closed: string[] = [];
  return {
    closed,
    open: (documentId: string) =>
      Promise.resolve({
        document: { path: '/briefs/promo.brief', name: 'promo.brief', text: '::a' },
        documentId,
      }),
    reopen: (documentId: string, path: string) =>
      Promise.resolve(
        path === '/briefs/promo.brief'
          ? { document: { path, name: 'promo.brief', text: '::a' }, documentId, missing: false }
          : { document: null, documentId: null, missing: true },
      ),
    save: (_documentId: string, text: string) =>
      Promise.resolve({
        document: { path: '/briefs/promo.brief', name: 'promo.brief', text },
        released: null,
      }),
    close: (documentId: string) => {
      closed.push(documentId);
    },
    recent: () =>
      Promise.resolve({
        files: [{ path: '/briefs/promo.brief', name: 'promo.brief', missing: false }],
      }),
    // One folder per tab, which is what `brief:preview` looks up from the id it is given.
    folderOf: (documentId: string) => (documentId === 'document-1' ? '/briefs' : undefined),
    nameOf: (documentId: string) => (documentId === 'document-1' ? 'promo' : undefined),
  };
};

/**
 * An export service that records what it was asked for and finishes immediately.
 *
 * The real one runs a job; what these tests are about is the handler in front of it — that
 * the brief comes from the request, the label from the document, and an unknown id answers
 * with nothing rather than with an empty progress.
 */
const exportService = () => {
  const started: unknown[] = [];
  const cancelled: string[] = [];
  return {
    started,
    cancelled,
    start: (request: unknown) => {
      started.push(request);
      return Promise.resolve({ exportId: 'export-1' });
    },
    progress: (exportId: string) =>
      exportId === 'export-1'
        ? {
            status: 'finished' as const,
            directory: '/out',
            total: 2,
            done: 2,
            failed: 0,
            diagnostics: [],
          }
        : undefined,
    cancel: (exportId: string) => {
      cancelled.push(exportId);
    },
  };
};

/** The native picker and the file manager, which main owns because Electron owns them. */
const folderDialogs = () => {
  const revealed: string[] = [];
  return {
    revealed,
    choose: () => Promise.resolve('/chosen'),
    reveal: (directory: string) => {
      revealed.push(directory);
      return Promise.resolve();
    },
  };
};

/** A layout store in memory, so the registration loop has one to bind (E9.10). */
const layoutStore = () => {
  let held = DEFAULT_LAYOUT;
  return {
    read: () => Promise.resolve(held),
    write: (next: Layout) => {
      held = next;
      return Promise.resolve();
    },
  };
};

const dependencies = () => ({
  confirm: () => Promise.resolve(true),
  credentials: credentials(),
  documents: documents(),
  exports: exportService(),
  folders: folderDialogs(),
  layout: layoutStore(),
  info: () => ({ version: '0.1.0', platform: 'linux', locale: 'pt-BR', templates: ['promo'] }),
  preview: preview(),
  templates: catalogue(),
});

describe('registerIpcHandlers', () => {
  it('binds every channel the contract declares, and nothing else', () => {
    const handle = vi.fn();
    registerIpcHandlers({ handle } as never, dependencies());

    const bound = handle.mock.calls.map((call) => call[0] as string);

    // A channel in the table with no handler here is already a type error; this is the
    // other direction — that registration actually walked the whole table.
    expect(bound.sort()).toEqual([...IPC_CHANNEL_NAMES].sort());
  });

  it('uses handle, so a rejection reaches the caller', async () => {
    // `on` would be fire-and-forget: a refused request would leave the renderer waiting
    // forever instead of catching. The contract only helps if the refusal travels.
    const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();
    registerIpcHandlers(
      { handle: (name: string, handler: never) => handlers.set(name, handler) } as never,
      dependencies(),
    );

    await expect(handlers.get('credentials:get')?.(null, { account: '' })).rejects.toBeInstanceOf(
      IpcContractError,
    );
  });
});

describe('the handlers', () => {
  it('round-trips a credential through the channels that own it', async () => {
    const handlers = createHandlers(dependencies());

    expect(await handlers['credentials:set']({ account: 'jira', secret: 'token' })).toEqual({
      stored: true,
    });
    expect(await handlers['credentials:get']({ account: 'jira' })).toEqual({ secret: 'token' });
    expect(await handlers['credentials:delete']({ account: 'jira' })).toEqual({ deleted: true });
    expect(await handlers['credentials:get']({ account: 'jira' })).toEqual({ secret: null });
  });

  it('answers app:info from what the composition root injected', async () => {
    const handlers = createHandlers(dependencies());

    expect(await handlers['app:info']({})).toEqual({
      version: '0.1.0',
      platform: 'linux',
      locale: 'pt-BR',
      templates: ['promo'],
    });
  });
});

describe('the tab a message is about (E9.11)', () => {
  it('resolves the preview against the folder of the tab the request names', async () => {
    const injected = dependencies();
    const handlers = createHandlers(injected);

    await handlers['brief:preview']({ requestId: 1, documentId: 'document-1', brief: '::a' });
    await handlers['brief:preview']({ requestId: 2, documentId: 'document-2', brief: '::a' });

    // The whole reason the id travels on this channel: two tabs, two folders, and the
    // answer must not depend on which one happens to be in front when the compile lands.
    expect(injected.preview.folders).toEqual(['/briefs', undefined]);
  });

  it('tells the service when a tab is gone', async () => {
    const injected = dependencies();
    const handlers = createHandlers(injected);

    expect(await handlers['file:close']({ documentId: 'document-7' })).toEqual({});
    expect(injected.documents.closed).toEqual(['document-7']);
  });

  it('passes a confirmation straight through, strings and all', async () => {
    const asked: unknown[] = [];
    const handlers = createHandlers({
      ...dependencies(),
      confirm: (question) => {
        asked.push(question);
        return Promise.resolve(false);
      },
    });

    const question = {
      message: 'Fechar sem salvar?',
      detail: 'promo.brief',
      confirm: 'Fechar sem salvar',
      cancel: 'Cancelar',
    };
    expect(await handlers['dialog:confirm'](question)).toEqual({ confirmed: false });
    // Main writes none of these: the window owns every string a person reads.
    expect(asked).toEqual([question]);
  });
});

describe('guard', () => {
  it('refuses a request that does not match, before the handler runs', async () => {
    const handler = vi.fn();
    const guarded = guard('credentials:get', handler as never);

    await expect(guarded({ account: 42 })).rejects.toBeInstanceOf(IpcContractError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a response that does not match, which is main’s own bug', async () => {
    const guarded = guard('app:info', (() =>
      Promise.resolve({ version: '1', platform: 'linux' })) as never);

    await expect(guarded({})).rejects.toThrow(/response does not match/u);
  });

  it('hands the handler the parsed value, not the raw one', async () => {
    const handler = vi.fn(() => Promise.resolve({ secret: null }));
    const guarded = guard('credentials:get', handler as never);

    await guarded({ account: '  jira  ', extra: 'dropped' });

    // Trimmed by the schema and stripped of the key nobody declared: the handler sees the
    // contract's shape, so it never has to defend itself.
    expect(handler).toHaveBeenCalledWith({ account: 'jira' });
  });
});

describe('the export handlers (E9.4)', () => {
  it('takes the brief from the request and the name from the document', async () => {
    // The split `brief:preview` already makes, and the reason is unsaved text: main holds
    // paths, so the only place a brief that has never been saved exists is the editor's
    // buffer. A handler that read the file would quietly export the last save.
    const deps = dependencies();
    const handlers = createHandlers(deps);

    const answer = await handlers['export:start']({
      documentId: 'document-1',
      brief: 'title: edited but not saved',
      directory: '/out',
      outputs: [{ kind: 'svg' }],
    });

    expect(answer).toEqual({ exportId: 'export-1' });
    expect(deps.exports.started).toEqual([
      {
        brief: 'title: edited but not saved',
        directory: '/out',
        label: 'promo',
        assetBase: '/briefs',
        outputs: [{ kind: 'svg' }],
      },
    ]);
  });

  it('calls an unsaved tab untitled rather than filing a run under nothing', async () => {
    const deps = dependencies();
    const handlers = createHandlers(deps);

    await handlers['export:start']({
      documentId: 'document-2',
      brief: 'x',
      directory: '/out',
      outputs: [{ kind: 'svg' }],
    });

    const [request] = deps.exports.started as { label: string; assetBase?: string }[];

    expect(request?.label).toBe('untitled');
    // And no `assetBase` at all, rather than one pointing at the output folder: a brief with
    // no folder beside it resolves no relative asset, which is what `preview.ts` already
    // decided for the same state.
    expect(request).not.toHaveProperty('assetBase');
  });

  it('answers nothing for a run it never started', async () => {
    const handlers = createHandlers(dependencies());

    // `{}` and not a zeroed progress: a dialog polling a stale id should find out, rather
    // than watch a bar that will never move.
    await expect(handlers['export:progress']({ exportId: 'export-gone' })).resolves.toEqual({});
  });

  it('cancels by id, and reveals the folder it is given', async () => {
    const deps = dependencies();
    const handlers = createHandlers(deps);

    await handlers['export:cancel']({ exportId: 'export-1' });
    await handlers['export:reveal']({ directory: '/out/promo' });

    expect(deps.exports.cancelled).toEqual(['export-1']);
    expect(deps.folders.revealed).toEqual(['/out/promo']);
  });
});
