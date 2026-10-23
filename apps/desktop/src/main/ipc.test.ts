import { type Layout, DEFAULT_LAYOUT } from '../../shared/layout.js';
import { describe, expect, it, vi } from 'vitest';

import {
  IPC_CHANNELS,
  IPC_CHANNEL_NAMES,
  IpcContractError,
  type UpdateStatus,
} from '../../shared/ipc.js';
import { type Credentials } from './credentials.js';
import { type ExplorerService } from './explorer.js';
import { type WindowThemes, createHandlers, guard, registerIpcHandlers } from './ipc.js';
import { createTemplateFolder } from './session.js';
import { BUILT_IN_THEMES, builtInThemeSource, createThemeService } from './themes.js';

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
    has: (account) => Promise.resolve(stored.has(account)),
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
      completion: { directives: ['demo/shout'] },
    });
  },
});

/** A catalogue that read one folder. `templates.test.ts` drives the real one. */
const catalogue = () => ({
  // A promise since TYTO-122: choosing a template folder means new `preview.png` files to
  // read, so the answer is rebuilt rather than held for the life of the app.
  list: () =>
    Promise.resolve({
      templates: [
        {
          name: 'promo',
          version: '1.0.0',
          description: 'A promo',
          formats: [
            { id: 'feed', label: 'Feed' },
            { id: 'story', label: 'Story' },
          ],
          slots: {},
          root: null,
        },
      ],
      failures: [],
    }),
});

/**
 * The template folder, recorded rather than chosen (TYTO-122).
 *
 * The picker and the disk are the composition root's — `index.ts` wraps both — so what a
 * handler test can assert is that the message carries the right thing in and the right thing
 * back, which is what this records.
 */
const projectFolder = () => {
  const asked: boolean[] = [];
  let folder: string | null = null;
  return {
    asked,
    folder: () => ({ folder, found: folder === null ? 0 : 2 }),
    setFolder: (choose: boolean) => {
      asked.push(choose);
      folder = choose ? '/home/rafael/meus-templates' : null;
      return Promise.resolve({ folder, found: folder === null ? 0 : 2 });
    },
  };
};

/** The workspace folder, as main would answer it, recording each question (TYTO-278). */
/** The explorer as the handlers see it: one brief and one picture, each by an id it minted. */
const explorerFiles = () => {
  const asked: (string | null)[] = [];
  return {
    asked,
    list: (entryId: string | null) => {
      asked.push(entryId);
      return Promise.resolve(
        entryId === null
          ? {
              entries: [
                { id: 'e-brief', name: 'promo.brief', kind: 'brief' as const },
                { id: 'e-image', name: 'foto.png', kind: 'file' as const },
              ],
              more: 0,
              gone: false,
            }
          : { entries: [], more: 0, gone: true },
      );
    },
    briefPath: (entryId: string) =>
      Promise.resolve(entryId === 'e-brief' ? '/work/promo/promo.brief' : undefined),
    // TYTO-366: the picture, at one version; that version again is unchanged.
    image: (entryId: string, have: string | undefined): ReturnType<ExplorerService['image']> => {
      asked.push(entryId);
      if (entryId !== 'e-image') return Promise.resolve({ ok: false, reason: 'gone' });
      if (have === '1:4') return Promise.resolve({ unchanged: true });
      return Promise.resolve({
        ok: true,
        name: 'foto.png',
        mime: 'image/png',
        bytes: 4,
        version: '1:4',
        dataUrl: 'data:image/png;base64,iVBORw==',
      });
    },
    // TYTO-352: one name already taken, one folder that renames and trashes, and a trash that
    // refuses everything else.
    create: (
      parentId: string | null,
      name: string,
      kind: 'file' | 'folder',
    ): ReturnType<ExplorerService['create']> => {
      asked.push(parentId);
      if (name === 'taken.brief') return Promise.resolve({ ok: false, reason: 'exists' });
      const entryKind = kind === 'folder' ? 'folder' : name.endsWith('.brief') ? 'brief' : 'file';
      return Promise.resolve({
        ok: true,
        entry: { id: 'e-new', name, kind: entryKind },
        path: `/work/promo/${name}`,
      });
    },
    rename: (entryId: string, name: string): ReturnType<ExplorerService['rename']> => {
      asked.push(entryId);
      return Promise.resolve(
        entryId === 'e-folder'
          ? {
              ok: true,
              entry: { id: 'e-folder', name, kind: 'folder' },
              from: '/work/promo/slides',
              to: `/work/promo/${name}`,
            }
          : { ok: false, reason: 'gone' },
      );
    },
    delete: (entryId: string): ReturnType<ExplorerService['delete']> => {
      asked.push(entryId);
      return Promise.resolve(
        entryId === 'e-folder'
          ? { ok: true, path: '/work/promo/slides' }
          : { ok: false, reason: 'trash-failed' },
      );
    },
    pathOf: (entryId: string) =>
      entryId === 'e-folder'
        ? '/work/promo/slides'
        : entryId === 'e-image'
          ? '/work/promo/foto.png'
          : undefined,
  };
};

const workspaceFolder = () => {
  const asked: unknown[] = [];
  const trustAsked: [boolean, 'folder' | 'profile'][] = [];
  let folder: string | null = null;
  let trust: 'trusted' | 'restricted' | 'revoked' = 'restricted';
  const state = () => ({
    folder,
    name: folder === null ? null : 'promo',
    trust,
    leftOut: trust === 'restricted' && folder !== null ? 1 : 0,
    output: folder === null ? null : '/work/promo/exports',
    profile: null,
    places: [],
    problems: [],
  });
  return {
    asked,
    trustAsked,
    state,
    setFolder: (choose: boolean) => {
      asked.push(choose);
      folder = choose ? '/work/promo' : null;
      return Promise.resolve(state());
    },
    setTrust: (trusted: boolean, source: 'folder' | 'profile') => {
      trustAsked.push([trusted, source]);
      trust = trusted ? 'trusted' : 'revoked';
      return Promise.resolve(state());
    },
  };
};

/**
 * A document service with one file in it and no disk under it (E9.8).
 *
 * `documents.test.ts` drives the real one, dialogs and all. What this file needs is
 * something that answers the four channels, because the registration loop is the subject
 * here and a channel with no handler is the failure it exists to prevent.
 */
const documents = () => {
  const closed: string[] = [];
  const followed: string[][] = [];
  return {
    closed,
    open: (documentId: string) =>
      Promise.resolve({
        document: {
          path: '/briefs/promo.brief',
          name: 'promo.brief',
          pathLabel: '/briefs/promo.brief',
          text: '::a',
        },
        documentId,
      }),
    openPath: (documentId: string, path: string, label?: string) =>
      Promise.resolve({
        document: { path, name: label ?? 'brief.brief', pathLabel: path, text: '::t' },
        documentId,
      }),
    retarget: () => undefined,
    reopen: (documentId: string, path: string) =>
      Promise.resolve(
        path === '/briefs/promo.brief'
          ? {
              document: { path, name: 'promo.brief', pathLabel: path, text: '::a' },
              documentId,
              missing: false,
            }
          : { document: null, documentId: null, missing: true },
      ),
    save: (_documentId: string, text: string) =>
      Promise.resolve({
        document: {
          path: '/briefs/promo.brief',
          name: 'promo.brief',
          pathLabel: '/briefs/promo.brief',
          text,
        },
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
    pathOf: () => undefined,
    reset: () => undefined,
    // TYTO-352: what the explorer's handlers hand on, recorded, with one tab under each.
    followed,
    retargetUnder: (from: string, to: string) => {
      followed.push(['retarget', from, to]);
      return [{ documentId: 'document-9', name: 'capa.brief', pathLabel: to }];
    },
    releaseUnder: (path: string) => {
      followed.push(['release', path]);
      return ['document-9'];
    },
    heldUnder: (path: string) => (path === '/work/promo/slides' ? ['document-9'] : []),
    // TYTO-274: one tab held, labelled again; and a label for any path, marked as this one's.
    relabel: () => [
      { documentId: 'document-9', name: 'capa.brief', pathLabel: 'promo/capa.brief' },
    ],
    labelOf: (path: string) => `label of ${path}`,
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
    run: () =>
      Promise.resolve({
        status: 'finished' as const,
        directory: '/out',
        total: 0,
        done: 0,
        failed: 0,
        diagnostics: [],
      }),
    cancel: (exportId: string) => {
      cancelled.push(exportId);
    },
    kinds: () =>
      Promise.resolve([
        { kind: 'svg', rasterized: false },
        { kind: 'txt', rasterized: false },
      ]),
  };
};

/** The native picker and the file manager, which main owns because Electron owns them. */
/** The local queue, as the handlers see it: one pending task and one that failed (TYTO-45). */
const queueDependency = () => {
  const ran: string[] = [];
  const remembered: unknown[] = [];
  const folders: (string | null)[] = [];
  let autoRun = false;
  let kinds: readonly string[] = ['png'];
  let folder: string | null = '/fila';
  const service = {
    view: () =>
      Promise.resolve({
        folder,
        inbox: folder === null ? null : `${folder}/inbox`,
        autoRun,
        kinds,
        tasks: [
          { id: 'tarefa-1', status: 'pending' as const, diagnostics: [], hasOutput: false },
          {
            id: 'tarefa-2',
            status: 'error' as const,
            diagnostics: [
              {
                severity: 'error' as const,
                code: 'E_UNKNOWN_TEMPLATE',
                message: 'no template',
                range: { start: 0, end: 4 },
              },
            ],
            failure: 'boom',
            hasOutput: true,
          },
        ],
      }),
    setFolder: (next: string | null) => {
      folder = next;
      folders.push(next);
      return Promise.resolve();
    },
    setAutoRun: (on: boolean) => {
      autoRun = on;
    },
    setKinds: (next: readonly string[]) => {
      kinds = next;
      return { '/outra': ['jpeg'], '/fila': next };
    },
    replaceKinds: () => undefined,
    run: (id: string) => {
      ran.push(id);
      return Promise.resolve();
    },
    briefPath: (id: string) => (id === 'tarefa-2' ? '/fila/inbox/tarefa-2/brief.brief' : undefined),
    outDirectory: (id: string) => (id === 'tarefa-2' ? '/fila/outbox/tarefa-2/out' : undefined),
    close: () => undefined,
  };
  let picked: string | undefined = '/escolhida';
  return {
    ran,
    remembered,
    folders,
    dismissPicker: () => {
      picked = undefined;
    },
    service,
    chooseFolder: () => Promise.resolve(picked),
    remember: (changes: unknown) => {
      remembered.push(changes);
      return Promise.resolve();
    },
  };
};

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

/** The guard's two legs of the exit question (ADR 0029, ADR 0031), recorded rather than acted on. */
const exitAnswers = () => {
  const given: { askId: number; allow: boolean }[] = [];
  const acknowledged: number[] = [];
  const heard = { count: 0 };
  return {
    given,
    acknowledged,
    heard,
    acknowledge: (askId: number) => acknowledged.push(askId),
    answer: (askId: number, allow: boolean) => given.push({ askId, allow }),
    listening: () => {
      heard.count += 1;
    },
  };
};

/** A log that records instead of writing, so a test can read what would have reached a file. */
const recordingLog = () => {
  const entries: { level: string; message: string; detail?: unknown }[] = [];
  const at =
    (level: string) =>
    (message: string, detail?: unknown): void => {
      entries.push(detail === undefined ? { level, message } : { level, message, detail });
    };
  return {
    entries,
    directory: '/tmp/tyto-logs',
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
  };
};

/**
 * Records the locales the menu was asked to rebuild in, in order (TYTO-124), and the menus
 * the drawn row asked to open (TYTO-244). The model is a fixed one with a Help menu.
 */
const menuRebuilds = () => {
  const locales: string[] = [];
  const popups: { id: string; at: { x: number; y: number } }[] = [];
  return {
    locales,
    popups,
    setLocale: (locale: string) => {
      locales.push(locale);
    },
    setDisabled: () => undefined,
    model: () => [
      {
        id: 'help',
        label: 'Help',
        role: 'help',
        enabled: true,
        items: [{ id: 'about', label: 'About Tyto', type: 'normal' as const, enabled: true }],
      },
    ],
    popup: (id: string, at: { x: number; y: number }) => {
      popups.push({ id, at });
      return Promise.resolve(
        id === 'help'
          ? { opened: true }
          : id === 'viewmenu'
            ? { opened: true, move: 'next' as const }
            : { opened: false },
      );
    },
  };
};

/**
 * The template mode's service, recording what it was asked (TYTO-44).
 *
 * `template-editor.test.ts` drives the real one against folders. What is asserted here is the
 * handlers' own decisions: which folder a New goes into, what a dismissed picker answers, and
 * that a diagnostic crosses with the contract's fields and no others.
 */
const templateEditor = () => {
  const scaffolded: { parent: string; name: string }[] = [];
  const opened: string[] = [];
  return {
    scaffolded,
    opened,
    open: (directory: string) => {
      opened.push(directory);
      return Promise.resolve({ kind: 'code' as const, directory });
    },
    preview: () =>
      Promise.resolve({
        frames: [],
        diagnostics: [
          {
            severity: 'error' as const,
            code: 'E_UNSUPPORTED_CSS' as const,
            message: 'no',
            file: 'markup' as const,
            range: { start: 1, end: 2 },
            // A field of core's that the contract does not carry.
            fatal: true,
          },
        ],
      }),
    save: () => Promise.resolve({ saved: true, registered: true, name: 'cartaz', diagnostics: [] }),
    scaffold: (parent: string, name: string) => {
      scaffolded.push({ parent, name });
      return Promise.resolve({ ok: true as const, directory: `${parent}/${name}` });
    },
  };
};

/** `null` is a dismissed picker; a default parameter would read `undefined` as "use the default". */
const templateDialogs = (answer: string | null = '/escolhida') => {
  const asked: string[] = [];
  return {
    asked,
    chooseTemplate: () => {
      asked.push('template');
      return Promise.resolve(answer ?? undefined);
    },
    chooseParent: () => {
      asked.push('parent');
      return Promise.resolve(answer ?? undefined);
    },
  };
};

/**
 * The plugins the screen lists, with each declared key's state asked of `keychain.has` —
 * the composition `index.ts` makes with the real `listPlugins`.
 */
const pluginList = (keychain: Credentials) => ({
  folder: '/home/ana/.tyto/plugins',
  list: () =>
    Promise.all(
      [
        { name: 'pdf', permissions: ['net:api.example.com', 'credentials:api-token'] },
        { name: 'texto', permissions: [] },
      ].map(async ({ name, permissions }) => ({
        name,
        version: '1.0.0',
        origin: 'external' as const,
        status: 'disabled' as const,
        contributes: ['exporter'],
        permissions,
        problems: [],
        credentials: await Promise.all(
          permissions
            .filter((permission) => permission.startsWith('credentials:'))
            .map(async (permission) => {
              const key = permission.slice('credentials:'.length);
              return { key, set: await keychain.has(`plugin:${name}:${key}`) };
            }),
        ),
      })),
    ),
});

/** The update notice, recording what clicking it asked for (TYTO-131). */
const updateNotice = (status: UpdateStatus = { state: 'none' }) => {
  const acted = { count: 0 };
  return {
    acted,
    status: () => status,
    act: () => {
      acted.count += 1;
    },
  };
};

/** The built-in two through the real service; a choice is always saved. */
const windowThemes = (): WindowThemes => {
  const service = createThemeService({
    sources: () => Object.values(BUILT_IN_THEMES).map(builtInThemeSource),
    ready: Promise.resolve(),
    setting: () => 'tyto-dark',
    setMode: () => undefined,
    shown: () => 'light',
    report: () => undefined,
  });
  return {
    list: () => service.list(),
    current: () => service.current(),
    preview: (id) => service.preview(id),
    choose: async () => ({ applied: await service.current(), saved: true }),
    iconStrokeWidth: () => 1,
    statusBarItems: () => ['settings', 'problems'],
    statusBarColors: () => ({ background: '#1e3a5f', 'vimMode.normal': '#3b6fd9' }),
    vimModeStyle: () => 'bar',
    indentGuides: () => false,
    stickyScroll: () => false,
    tabSize: () => 4,
    formatBriefOnSave: () => true,
    briefColumns: () => 'perColumn',
    typography: () => ({
      uiFontFamily: 'Segoe UI',
      uiFontSize: 18,
      codeFontFamily: 'IBM Plex Mono',
      codeFontSize: 20,
      fontSizes: { tabs: 18, editor: 22 },
      fontFamilies: { problems: 'Segoe UI' },
    }),
  };
};

const dependencies = () => {
  const keychain = credentials();
  return {
    confirm: () => Promise.resolve(true),
    // The system's menu picks the second item, whatever was offered (TYTO-352).
    contextMenu: (request: { items: readonly { id: string }[] }) =>
      Promise.resolve(request.items[1]?.id ?? null),
    askToSave: () => Promise.resolve('cancel' as const),
    log: recordingLog(),
    credentials: keychain,
    documents: documents(),
    exit: exitAnswers(),
    exports: exportService(),
    folders: folderDialogs(),
    layout: layoutStore(),
    // TYTO-113. Its decisions are `session.test.ts`'s; here it only has to be wired.
    session: {
      write: () => Promise.resolve({ written: true }),
      read: () =>
        Promise.resolve({ tabs: [], active: 0, template: null, groups: null, firstLaunch: false }),
    },
    menu: menuRebuilds(),
    plugins: pluginList(keychain),
    info: () => ({ version: '0.1.0', platform: 'linux', locale: 'pt-BR', templates: ['promo'] }),
    panels: {
      list: () =>
        Promise.resolve([
          {
            id: 'plugin:demo/contagem',
            plugin: 'demo',
            title: 'Contagem',
            src: 'tyto-plugin://demo/panel.html',
          },
        ]),
      request: () => Promise.resolve({ ok: false as const, code: 'E_PERMISSION', message: 'no' }),
    },
    keymaps: () => Promise.resolve([]),
    themes: windowThemes(),
    zoom: (step: string) => Promise.resolve({ zoom: step === 'in' ? 1 : 0, saved: true }),
    openDocumentation: () => {},
    keybindings: {
      open: () => Promise.resolve({ document: null, documentId: null }),
      read: () => Promise.resolve(''),
    },
    snippets: {
      open: () => Promise.resolve({ document: null, documentId: null }),
      read: () => Promise.resolve(''),
    },
    preview: preview(),
    project: projectFolder(),
    workspace: workspaceFolder(),
    explorer: explorerFiles(),
    queue: queueDependency(),
    settings: {
      open: () => Promise.resolve({ document: null, documentId: null }),
      validate: () => [],
      closed: () => Promise.resolve(false),
      outline: () =>
        Promise.resolve([
          {
            key: 'vimModeStyle',
            plugin: 'desktop',
            description: "How the status bar shows vim's mode.",
            type: 'string',
            default: '"badge"',
            options: [{ value: 'bar', description: 'The whole bar.' }],
          },
        ]),
    },
    templates: catalogue(),
    templateEditor: templateEditor(),
    templateDialogs: templateDialogs(),
    templateFolder: createTemplateFolder(),
    updates: updateNotice(),
  };
};

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

    await expect(
      handlers.get('credentials:delete')?.(null, { plugin: '', key: 'api-token' }),
    ).rejects.toBeInstanceOf(IpcContractError);
  });
});

describe('the handlers', () => {
  it('stores a declared key under its plugin account, and forgets it', async () => {
    const deps = dependencies();
    const handlers = createHandlers(deps);

    expect(
      await handlers['credentials:set']({ plugin: 'pdf', key: 'api-token', secret: 'dummy' }),
    ).toEqual({ stored: true });
    expect(await deps.credentials.get('plugin:pdf:api-token')).toBe('dummy');
    expect(await handlers['credentials:delete']({ plugin: 'pdf', key: 'api-token' })).toEqual({
      deleted: true,
    });
    expect(await deps.credentials.has('plugin:pdf:api-token')).toBe(false);
  });

  it('refuses a key no listed plugin declares, and touches nothing (TYTO-187)', async () => {
    const deps = dependencies();
    await deps.credentials.set('plugin:texto:api-token', 'kept');
    await deps.credentials.set('jira', 'kept');
    const handlers = createHandlers(deps);

    for (const [plugin, key] of [
      ['texto', 'api-token'], // a listed plugin that does not declare it
      ['ausente', 'api-token'], // no such plugin
      ['pdf', 'net:api.example.com'], // a permission that is not a credential
      ['pdf ', 'api-token'], // not trimmed into a match
    ] as const) {
      await expect(
        handlers['credentials:set']({ plugin, key, secret: 'overwritten' }),
      ).rejects.toThrow(`No installed plugin '${plugin}' declares credentials:${key}`);
      await expect(handlers['credentials:delete']({ plugin, key })).rejects.toThrow(
        /declares credentials/u,
      );
    }
    expect(await deps.credentials.get('plugin:texto:api-token')).toBe('kept');
    expect(await deps.credentials.get('jira')).toBe('kept');
    expect(await deps.credentials.has('plugin:pdf:api-token')).toBe(false);
  });

  it('never hands the secret back: not in the list, not in a reply to set or delete', async () => {
    const SECRET = 'dummy-secret-7f3a';
    const handlers = createHandlers(dependencies());
    const replies: unknown[] = [];

    replies.push(await handlers['plugins:list']({}));
    replies.push(
      await handlers['credentials:set']({ plugin: 'pdf', key: 'api-token', secret: SECRET }),
    );
    const listed = await handlers['plugins:list']({});
    replies.push(listed);
    replies.push(await handlers['credentials:delete']({ plugin: 'pdf', key: 'api-token' }));
    replies.push(await handlers['plugins:list']({}));

    // The state moved, so the list was asked about this very key …
    expect(listed.plugins.find((row) => row.name === 'pdf')?.credentials).toEqual([
      { key: 'api-token', set: true },
    ]);
    // … and no answer the renderer received carries its value, in any field.
    for (const reply of replies) expect(JSON.stringify(reply)).not.toContain(SECRET);
    expect(Object.keys(handlers)).not.toContain('credentials:get');
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

  it('passes the three-way question through, and answers with a meaning', async () => {
    const asked: unknown[] = [];
    const handlers = createHandlers({
      ...dependencies(),
      askToSave: (question) => {
        asked.push(question);
        return Promise.resolve('save' as const);
      },
    });

    const question = {
      message: 'Deseja salvar o trabalho?',
      detail: '2 abas tem alteracoes que ainda nao foram escritas no disco',
      save: 'Sim',
      discard: 'Nao',
      cancel: 'Cancelar',
    };
    // Never an index (TYTO-153). The button order is built in `src/main/index.ts`, so a
    // renderer reading a number back would be a renderer holding a copy of that order.
    expect(await handlers['dialog:save-changes'](question)).toEqual({ answer: 'save' });
    expect(asked).toEqual([question]);
  });
});

describe('guard', () => {
  it('refuses a request that does not match, before the handler runs', async () => {
    const handler = vi.fn();
    const guarded = guard('credentials:delete', handler as never);

    await expect(guarded({ plugin: 42, key: 'api-token' })).rejects.toBeInstanceOf(
      IpcContractError,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a response that does not match, which is main’s own bug', async () => {
    const guarded = guard('app:info', (() =>
      Promise.resolve({ version: '1', platform: 'linux' })) as never);

    await expect(guarded({})).rejects.toThrow(/response does not match/u);
  });

  it('hands the handler the parsed value, not the raw one', async () => {
    const handler = vi.fn(() => Promise.resolve({ deleted: false }));
    const guarded = guard('credentials:delete', handler as never);

    await guarded({ plugin: 'pdf', key: 'api-token', extra: 'dropped' });

    // Stripped of the key nobody declared: the handler sees the contract's shape, so it
    // never has to defend itself.
    expect(handler).toHaveBeenCalledWith({ plugin: 'pdf', key: 'api-token' });
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
        briefDirectory: '/briefs',
        outputs: [{ kind: 'svg' }],
        // The export box is the one caller that asks for this; the queue does not (ADR 0054).
        removeLeftovers: true,
        // And the one that delivers: artwork, editaveis/ and assets/ (ADR 0057).
        delivery: true,
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

    const [request] = deps.exports.started as { label: string; briefDirectory?: string }[];

    expect(request?.label).toBe('untitled');
    // And no `briefDirectory` at all, rather than one pointing at the output folder: a brief with
    // no folder beside it resolves no relative asset, which is what `preview.ts` already
    // decided for the same state.
    expect(request).not.toHaveProperty('briefDirectory');
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

/**
 * The first return leg: "this window has the question" (TYTO-147, ADR 0031).
 *
 * Same division of labour as the channel below — the table carries the id, and what stopping
 * the clock means lives in `quit.ts`.
 */
/** Stage zero: the page can hear the question (TYTO-44, ADR 0039). */
describe('app:exit-listening', () => {
  it('tells the guard, and nothing else', async () => {
    const exit = exitAnswers();
    const handlers = createHandlers({ ...dependencies(), exit });

    await handlers['app:exit-listening']({});

    expect(exit.heard.count).toBe(1);
    expect(exit.acknowledged).toEqual([]);
    expect(exit.given).toEqual([]);
  });
});

describe('update:status and update:act', () => {
  it('answers with the status the service holds, and passes a click on untouched', async () => {
    const updates = updateNotice({ state: 'ready', version: '0.7.0' });
    const handlers = createHandlers({ ...dependencies(), updates });

    expect(await handlers['update:status']({})).toEqual({ state: 'ready', version: '0.7.0' });
    expect(updates.acted.count).toBe(0);
    await handlers['update:act']({});
    expect(updates.acted.count).toBe(1);
  });
});

describe('app:exit-ack', () => {
  it('hands the id to the guard, verbatim', async () => {
    const exit = exitAnswers();
    const handlers = createHandlers({ ...dependencies(), exit });

    await handlers['app:exit-ack']({ askId: 7 });

    expect(exit.acknowledged).toEqual([7]);
  });

  it('refuses an acknowledgement with no id before the guard is reached', async () => {
    const exit = exitAnswers();
    const guarded = guard(
      'app:exit-ack',
      createHandlers({ ...dependencies(), exit })['app:exit-ack'],
    );

    await expect(guarded({})).rejects.toBeInstanceOf(IpcContractError);
    // The point: `acknowledge` compares the id against the outstanding question, so an
    // `undefined` reaching it would match nothing and silently leave a deadline running that
    // the handler table appears to have disarmed.
    expect(exit.acknowledged).toEqual([]);
  });
});

/**
 * The return leg of the one question main asks (TYTO-123, ADR 0029).
 *
 * What is asserted here is only that the channel carries the answer through untouched — the
 * decision it feeds lives in `quit.ts` and is tested there, without Electron and without this
 * table.
 */
describe('app:exit-answer', () => {
  it('hands the answer to the guard, verbatim', async () => {
    const exit = exitAnswers();
    const handlers = createHandlers({ ...dependencies(), exit });

    await handlers['app:exit-answer']({ askId: 4, allow: false });
    await handlers['app:exit-answer']({ askId: 5, allow: true });

    expect(exit.given).toEqual([
      { askId: 4, allow: false },
      { askId: 5, allow: true },
    ]);
  });

  it('refuses an answer with no verdict before the guard is reached', async () => {
    const exit = exitAnswers();
    const guarded = guard(
      'app:exit-answer',
      createHandlers({ ...dependencies(), exit })['app:exit-answer'],
    );

    await expect(guarded({ askId: 4 })).rejects.toBeInstanceOf(IpcContractError);
    // The point: a missing `allow` must not reach a latch that would read it as `undefined`
    // and quit — the contract refuses it a layer earlier.
    expect(exit.given).toEqual([]);
  });
});

/**
 * The window's failures, reaching main's log (TYTO-132).
 *
 * The interesting assertion is the refusal: "no brief text reaches the log" is a claim about a
 * *mechanism*, and the mechanism is the contract's length caps, not the discipline of the four
 * call sites. So the test drives `guard` rather than the handler.
 */
describe('plugins:list', () => {
  it('answers with the folder and the rows main built, and nothing else', async () => {
    const handlers = createHandlers(dependencies());

    const answer = await handlers['plugins:list']({});

    expect(answer.folder).toBe('/home/ana/.tyto/plugins');
    expect(answer.plugins.map((plugin) => [plugin.name, plugin.status])).toEqual([
      ['pdf', 'disabled'],
      ['texto', 'disabled'],
    ]);
    // What main sends must satisfy the contract the preload validates it against.
    expect(IPC_CHANNELS['plugins:list'].response.safeParse(answer).success).toBe(true);
  });
});

describe('the local queue (TYTO-45)', () => {
  it('answers the view in the shape the preload validates', async () => {
    const handlers = createHandlers(dependencies());

    const answer = await handlers['queue:list']({});

    expect(answer.tasks.map((task) => [task.id, task.status])).toEqual([
      ['tarefa-1', 'pending'],
      ['tarefa-2', 'error'],
    ]);
    expect(answer.tasks[1]?.diagnostics[0]?.code).toBe('E_UNKNOWN_TEMPLATE');
    expect(IPC_CHANNELS['queue:list'].response.safeParse(answer).success).toBe(true);
  });

  it('points the queue at the folder picked, and writes it down', async () => {
    const queue = queueDependency();
    const handlers = createHandlers({ ...dependencies(), queue });

    const answer = await handlers['queue:set-folder']({ choose: true });

    expect(queue.folders).toEqual(['/escolhida']);
    expect(queue.remembered).toEqual([{ queueFolder: '/escolhida' }]);
    expect(answer.folder).toBe('/escolhida');
  });

  it('changes nothing when the picker is dismissed', async () => {
    const queue = queueDependency();
    queue.dismissPicker();
    const handlers = createHandlers({ ...dependencies(), queue });

    const answer = await handlers['queue:set-folder']({ choose: true });

    // A dismissed picker is not a clear: the folder in force stays, and nothing is written.
    expect(queue.folders).toEqual([]);
    expect(queue.remembered).toEqual([]);
    expect(answer.folder).toBe('/fila');
  });

  it('clears the folder when asked to, and remembers the clearing', async () => {
    const queue = queueDependency();
    const handlers = createHandlers({ ...dependencies(), queue });

    await handlers['queue:set-folder']({ choose: false });

    expect(queue.folders).toEqual([null]);
    expect(queue.remembered).toEqual([{ queueFolder: null }]);
  });

  it('turns auto-run on and remembers it', async () => {
    const queue = queueDependency();
    const handlers = createHandlers({ ...dependencies(), queue });

    const answer = await handlers['queue:set-auto-run']({ on: true });

    expect(answer.autoRun).toBe(true);
    expect(queue.remembered).toEqual([{ queueAutoRun: true }]);
  });

  it("chooses the folder's file types and remembers every folder's choice (TYTO-188)", async () => {
    const queue = queueDependency();
    const handlers = createHandlers({ ...dependencies(), queue });

    const answer = await handlers['queue:set-kinds']({ kinds: ['png', 'svg'] });

    expect(answer.kinds).toEqual(['png', 'svg']);
    expect(queue.remembered).toEqual([
      { queueKinds: { '/outra': ['jpeg'], '/fila': ['png', 'svg'] } },
    ]);
  });

  it('runs the task named', async () => {
    const queue = queueDependency();
    const handlers = createHandlers({ ...dependencies(), queue });

    await handlers['queue:run']({ taskId: 'tarefa-2' });

    expect(queue.ran).toEqual(['tarefa-2']);
  });

  it('opens only the brief main listed under that id', async () => {
    const handlers = createHandlers(dependencies());

    const known = await handlers['queue:open-brief']({
      documentId: 'document-3',
      taskId: 'tarefa-2',
    });
    // An id the queue never listed opens nothing, the way `file:reopen` refuses a path it
    // never offered. The renderer cannot turn a task id into a read of anything else.
    const unknown = await handlers['queue:open-brief']({
      documentId: 'document-4',
      taskId: '../../etc/passwd',
    });

    expect(known.document?.path).toBe('/fila/inbox/tarefa-2/brief.brief');
    // Named after the task, so two task briefs open at once are two tabs a person can tell apart.
    expect(known.document?.name).toBe('tarefa-2 · brief.brief');
    expect(known.documentId).toBe('document-3');
    expect(unknown).toEqual({ document: null, documentId: null });
  });

  it('reveals the task output folder, and nothing for a task it does not know', async () => {
    const folders = folderDialogs();
    const handlers = createHandlers({ ...dependencies(), folders });

    await handlers['queue:reveal-output']({ taskId: 'tarefa-2' });
    await handlers['queue:reveal-output']({ taskId: 'tarefa-9' });

    expect(folders.revealed).toEqual(['/fila/outbox/tarefa-2/out']);
  });
});

describe('log:write', () => {
  it('files the failure at the level the window asked for', async () => {
    const log = recordingLog();
    const handlers = createHandlers({ ...dependencies(), log });

    await handlers['log:write']({
      level: 'error',
      message: 'renderer error: boom',
      detail: 'at x',
    });
    await handlers['log:write']({ level: 'warn', message: 'preview was slow' });

    expect(log.entries).toEqual([
      { level: 'error', message: 'renderer error: boom', detail: 'at x' },
      { level: 'warn', message: 'preview was slow' },
    ]);
  });

  it('refuses a message big enough to be a brief, before the log is reached', async () => {
    const log = recordingLog();
    const guarded = guard('log:write', createHandlers({ ...dependencies(), log })['log:write']);

    await expect(guarded({ level: 'error', message: 'x'.repeat(10_000) })).rejects.toBeInstanceOf(
      IpcContractError,
    );
    // This is the card's "no brief text and no file contents" criterion, made mechanical: a
    // renderer cannot push a document across however hard it tries.
    expect(log.entries).toEqual([]);
  });

  it('refuses a level the renderer has no business filing', async () => {
    const log = recordingLog();
    const guarded = guard('log:write', createHandlers({ ...dependencies(), log })['log:write']);

    await expect(guarded({ level: 'debug', message: 'chatter' })).rejects.toBeInstanceOf(
      IpcContractError,
    );
    expect(log.entries).toEqual([]);
  });

  it('opens the folder the log actually lives in, not a path written twice', async () => {
    const log = recordingLog();
    const folders = folderDialogs();
    const handlers = createHandlers({ ...dependencies(), folders, log });

    await handlers['log:reveal']({});

    expect(folders.revealed).toEqual([log.directory]);
  });

  it('opens the manual through the composition root, with nothing from the window (TYTO-318)', async () => {
    const openDocumentation = vi.fn();
    const handlers = createHandlers({ ...dependencies(), openDocumentation });

    await handlers['help:open-documentation']({});

    expect(openDocumentation).toHaveBeenCalledTimes(1);
  });
});

/**
 * The template folder, as a message (TYTO-122).
 *
 * What is *not* here is the precedence — a chosen folder shadowing a built-in template is a
 * property of `loadTemplateRegistry` and is pinned in `project.test.ts` against real folders.
 * This file is about the channels.
 */
describe('the template folder channels', () => {
  it('answers with nothing chosen on a fresh install', async () => {
    const handlers = createHandlers(dependencies());

    expect(await handlers['templates:folder']({})).toEqual({ folder: null, found: 0 });
  });

  it('carries a chosen folder and how many templates it brought', async () => {
    const project = projectFolder();
    const handlers = createHandlers({ ...dependencies(), project });

    const chosen = await handlers['templates:set-folder']({ choose: true });

    expect(project.asked).toEqual([true]);
    expect(chosen).toEqual({ folder: '/home/rafael/meus-templates', found: 2 });
    // And the question that follows agrees with the answer that was just given, which is what
    // makes a reload and a fresh window show the same thing.
    expect(await handlers['templates:folder']({})).toEqual(chosen);
  });

  it('goes back to the built-in pack when the folder is cleared', async () => {
    const project = projectFolder();
    const handlers = createHandlers({ ...dependencies(), project });

    await handlers['templates:set-folder']({ choose: true });
    const cleared = await handlers['templates:set-folder']({ choose: false });

    expect(project.asked).toEqual([true, false]);
    expect(cleared).toEqual({ folder: null, found: 0 });
  });

  it('refuses a request that does not say which of the two it wants', async () => {
    const project = projectFolder();
    const guarded = guard(
      'templates:set-folder',
      createHandlers({ ...dependencies(), project })['templates:set-folder'],
    );

    await expect(guarded({})).rejects.toBeInstanceOf(IpcContractError);
    // The point: a missing `choose` must not reach a handler that would read it as falsy and
    // silently clear somebody's folder.
    expect(project.asked).toEqual([]);
  });
});

describe('the workspace folder channels (TYTO-278)', () => {
  it('opens through main and answers what is open, and closes', async () => {
    const workspace = workspaceFolder();
    const handlers = createHandlers({ ...dependencies(), workspace });

    expect((await handlers['workspace:folder']({})).folder).toBeNull();
    const opened = await handlers['workspace:set-folder']({ choose: true });
    expect(opened).toMatchObject({ folder: '/work/promo', output: '/work/promo/exports' });
    // TYTO-274, ADR 0125: the open tabs labelled again for the folder, beside what is open.
    const { relabelled, ...state } = opened;
    expect(relabelled).toEqual([
      { documentId: 'document-9', name: 'capa.brief', pathLabel: 'promo/capa.brief' },
    ]);
    expect(await handlers['workspace:folder']({})).toEqual(state);
    expect((await handlers['workspace:set-folder']({ choose: false })).folder).toBeNull();
    expect(workspace.asked).toEqual([true, false]);
  });

  it('refuses a request that names a folder, so no window can choose one for main', async () => {
    const workspace = workspaceFolder();
    const guarded = guard(
      'workspace:set-folder',
      createHandlers({ ...dependencies(), workspace })['workspace:set-folder'],
    );

    await expect(
      guarded({ choose: true, folder: 'C:/Users/someone/secrets' }),
    ).rejects.toBeInstanceOf(IpcContractError);
    await expect(guarded({ choose: true, path: '/etc' })).rejects.toBeInstanceOf(IpcContractError);
    expect(workspace.asked).toEqual([]);
  });

  it('trusts the open folder and takes it back, each through main', async () => {
    const workspace = workspaceFolder();
    const handlers = createHandlers({ ...dependencies(), workspace });
    await handlers['workspace:set-folder']({ choose: true });

    expect(await handlers['workspace:trust']({ trusted: true, source: 'folder' })).toMatchObject({
      trust: 'trusted',
      leftOut: 0,
    });
    expect((await handlers['workspace:trust']({ trusted: false, source: 'folder' })).trust).toBe(
      'revoked',
    );
    await handlers['workspace:trust']({ trusted: true, source: 'profile' });
    expect(workspace.trustAsked).toEqual([
      [true, 'folder'],
      [false, 'folder'],
      [true, 'profile'],
    ]);
  });

  it('refuses a trust request that names a folder, so no window can approve one of its choosing', async () => {
    const workspace = workspaceFolder();
    const guarded = guard(
      'workspace:trust',
      createHandlers({ ...dependencies(), workspace })['workspace:trust'],
    );

    await expect(
      guarded({ trusted: true, source: 'folder', folder: '/home/someone' }),
    ).rejects.toBeInstanceOf(IpcContractError);
    // TYTO-347: a source is one of the two main has open, never a path.
    await expect(guarded({ trusted: true, source: '/team/saude.json' })).rejects.toBeInstanceOf(
      IpcContractError,
    );
    await expect(guarded({ trusted: true })).rejects.toBeInstanceOf(IpcContractError);
    expect(workspace.trustAsked).toEqual([]);
  });
});

describe('the template mode channels (TYTO-44)', () => {
  it('opens the folder it is given without asking, and asks when it is given none', async () => {
    const editor = templateEditor();
    const dialogs = templateDialogs();
    const handlers = createHandlers({
      ...dependencies(),
      templateEditor: editor,
      templateDialogs: dialogs,
    });

    await handlers['template:open']({ directory: '/dada' });
    expect(dialogs.asked).toEqual([]);

    await handlers['template:open']({ directory: null });
    expect(dialogs.asked).toEqual(['template']);
    expect(editor.opened).toEqual(['/dada', '/escolhida']);
  });

  it('files the folder of a markup template for the session, and forgets it for the rest', async () => {
    const templateFolder = createTemplateFolder();
    const markup = {
      ...templateEditor(),
      open: (directory: string) =>
        Promise.resolve({
          kind: 'markup' as const,
          directory,
          manifest: '',
          markup: '',
          examples: [],
        }),
    };
    await createHandlers({ ...dependencies(), templateEditor: markup, templateFolder })[
      'template:open'
    ]({ directory: '/t/cartaz' });
    // TYTO-266: the session names this folder, so the window never has to.
    expect(templateFolder.current()).toBe('/t/cartaz');

    // A code template has no buffers to keep.
    await createHandlers({ ...dependencies(), templateFolder })['template:open']({
      directory: '/t/codigo',
    });
    expect(templateFolder.current()).toBeUndefined();
  });

  it('answers a dismissed picker with no template, and opens nothing', async () => {
    const editor = templateEditor();
    const handlers = createHandlers({
      ...dependencies(),
      templateEditor: editor,
      templateDialogs: templateDialogs(null),
    });

    expect(await handlers['template:open']({ directory: null })).toEqual({ template: null });
    expect(editor.opened).toEqual([]);
  });

  it('scaffolds into the chosen template folder, so briefs can name it at once', async () => {
    const editor = templateEditor();
    const dialogs = templateDialogs();
    const project = projectFolder();
    await project.setFolder(true);
    const handlers = createHandlers({
      ...dependencies(),
      project,
      templateEditor: editor,
      templateDialogs: dialogs,
    });

    const answer = await handlers['template:new']({ name: 'novo' });

    expect(dialogs.asked).toEqual([]);
    expect(editor.scaffolded).toEqual([{ parent: '/home/rafael/meus-templates', name: 'novo' }]);
    expect(answer).toEqual({ directory: '/home/rafael/meus-templates/novo' });
  });

  it('asks where when no template folder is chosen, and does nothing when dismissed', async () => {
    const editor = templateEditor();
    const dialogs = templateDialogs(null);
    const handlers = createHandlers({
      ...dependencies(),
      templateEditor: editor,
      templateDialogs: dialogs,
    });

    expect(await handlers['template:new']({ name: 'novo' })).toEqual({ directory: null });
    expect(dialogs.asked).toEqual(['parent']);
    expect(editor.scaffolded).toEqual([]);
  });

  it('sends a diagnostic with its file and the contract fields, and nothing else', async () => {
    const guarded = guard('template:preview', createHandlers(dependencies())['template:preview']);

    const answer = await guarded({
      requestId: 3,
      directory: '/t',
      manifest: '',
      markup: '',
      brief: '',
    });

    expect(answer).toEqual({
      requestId: 3,
      frames: [],
      diagnostics: [
        {
          severity: 'error',
          code: 'E_UNSUPPORTED_CSS',
          message: 'no',
          file: 'markup',
          range: { start: 1, end: 2 },
        },
      ],
    });
  });
});

describe('the theme channels (TYTO-208)', () => {
  it('answers the setting’s themes and mode through the contract', async () => {
    const guarded = guard('theme:current', createHandlers(dependencies())['theme:current']);
    const answer = await guarded({});
    expect([answer.mode, answer.light.id, answer.dark.id]).toEqual([
      'dark',
      'tyto-light',
      'tyto-dark',
    ]);
    expect(answer.diagnostics).toEqual([]);
    // The icons' stroke rides on the same answer (TYTO-288), so a save moves it with the colours.
    expect(answer.iconStrokeWidth).toBe(1);
    // And so do the status bar's items (TYTO-301), for the same reason.
    expect(answer.statusBarItems).toEqual(['settings', 'problems']);
    // And its colours over the theme's.
    expect(answer.statusBarColors).toEqual({ background: '#1e3a5f', 'vimMode.normal': '#3b6fd9' });
    // And how vim's mode is drawn.
    expect(answer.vimModeStyle).toBe('bar');
    // And whether the editor draws indent guides (TYTO-293).
    expect(answer.indentGuides).toBe(false);
    // And whether it pins the head line of the block at the top (TYTO-295).
    expect(answer.stickyScroll).toBe(false);
    // And the indent width and format-on-save (TYTO-297).
    expect(answer.tabSize).toBe(4);
    expect(answer.formatBriefOnSave).toBe(true);
    // And how a brief's `|` columns are drawn (TYTO-298).
    expect(answer.briefColumns).toBe('perColumn');
    // And the faces and sizes (TYTO-272); the zoom is main's and is not on the answer.
    expect(answer.typography).toEqual({
      uiFontFamily: 'Segoe UI',
      uiFontSize: 18,
      codeFontFamily: 'IBM Plex Mono',
      codeFontSize: 20,
      // And the areas over the bases (TYTO-272 PR B), on the same object.
      fontSizes: { tabs: 18, editor: 22 },
      fontFamilies: { problems: 'Segoe UI' },
    });
    expect('zoom' in answer).toBe(false);
  });

  it('steps the zoom through main and answers what is in effect (TYTO-272)', async () => {
    const guarded = guard('window:zoom', createHandlers(dependencies())['window:zoom']);
    expect(await guarded({ step: 'in' })).toEqual({ zoom: 1, saved: true });
    await expect(guarded({ step: 'sideways' } as never)).rejects.toThrow();
  });

  it('lists every theme with its label and kind, and nothing else', async () => {
    const guarded = guard('theme:list', createHandlers(dependencies())['theme:list']);
    expect(await guarded({})).toEqual({
      themes: [
        { id: 'tyto-light', label: 'Tyto Light', kind: 'light' },
        { id: 'tyto-dark', label: 'Tyto Dark', kind: 'dark' },
      ],
    });
  });

  // ADR 0089: a pack theme that ships as a pair says which twin it is; one that ships once and
  // an installed theme say nothing.
  it('says which of a pair a theme pack theme is', async () => {
    const pack = (id: string, label: string) =>
      ({ id, label, kind: 'dark', path: `themes/${id}.json` }) as const;
    const list = [
      pack('nord', 'Nord'),
      pack('nord-adjusted', 'Nord (adjusted)'),
      pack('catppuccin-mocha', 'Catppuccin Mocha'),
      pack('dusk', 'Dusk'),
    ];
    const handlers = createHandlers({
      ...dependencies(),
      themes: { ...windowThemes(), list: () => Promise.resolve(list) },
    });
    expect(await guard('theme:list', handlers['theme:list'])({})).toEqual({
      themes: [
        { id: 'nord', label: 'Nord', kind: 'dark', variant: 'original' },
        { id: 'nord-adjusted', label: 'Nord (adjusted)', kind: 'dark', variant: 'adjusted' },
        { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', kind: 'dark' },
        { id: 'dusk', label: 'Dusk', kind: 'dark' },
      ],
    });
  });

  it('previews a theme and says whether a choice was saved', async () => {
    const handlers = createHandlers(dependencies());
    const previewed = await guard('theme:preview', handlers['theme:preview'])({ id: 'tyto-light' });
    expect(previewed.mode).toBe('light');
    const chosen = await guard('theme:choose', handlers['theme:choose'])({ id: 'tyto-light' });
    expect(chosen.saved).toBe(true);
  });
});

describe('the drawn menu row (TYTO-244)', () => {
  it("answers the installed menu's model through the contract", async () => {
    const handlers = createHandlers(dependencies());
    const answer = await guard('menu:model', handlers['menu:model'])({});
    expect(answer.menus.map((menu) => menu.id)).toEqual(['help']);
  });

  it('opens the menu it was asked for at the point it was given, and says whether it could', async () => {
    const deps = dependencies();
    const handlers = createHandlers(deps);
    const popup = guard('menu:popup', handlers['menu:popup']);
    expect(await popup({ id: 'help', x: 12, y: 32 })).toEqual({ opened: true });
    expect(await popup({ id: 'nothing', x: 0, y: 0 })).toEqual({ opened: false });
    expect(deps.menu.popups).toEqual([
      { id: 'help', at: { x: 12, y: 32 } },
      { id: 'nothing', at: { x: 0, y: 0 } },
    ]);
  });

  it('passes on which way an arrow moved the menu when one closed the list (TYTO-263)', async () => {
    const handlers = createHandlers(dependencies());
    const popup = guard('menu:popup', handlers['menu:popup']);
    expect(await popup({ id: 'viewmenu', x: 0, y: 0 })).toEqual({ opened: true, move: 'next' });
  });

  it('refuses a popup with no id or a point that is not a number', async () => {
    const handlers = createHandlers(dependencies());
    const popup = guard('menu:popup', handlers['menu:popup']);
    await expect(popup({ id: '', x: 0, y: 0 })).rejects.toThrow();
    await expect(popup({ id: 'help', x: Number.NaN, y: 0 })).rejects.toThrow();
  });
});

/** TYTO-279, ADR 0115: the explorer names entries by the ids main minted, never by a path. */
describe('the explorer channels', () => {
  it('lists by id and opens only a brief main listed', async () => {
    const explorer = explorerFiles();
    const handlers = createHandlers({ ...dependencies(), explorer });

    const root = await handlers['explorer:list']({ entryId: null });
    expect(root.entries.map((entry) => entry.name)).toEqual(['promo.brief', 'foto.png']);
    expect(await handlers['explorer:list']({ entryId: 'e-unknown' })).toEqual({
      entries: [],
      more: 0,
      gone: true,
    });

    const brief = await handlers['explorer:open']({ documentId: 'document-5', entryId: 'e-brief' });
    expect(brief.document?.path).toBe('/work/promo/promo.brief');
    expect(brief.documentId).toBe('document-5');
    // A picture is listed and opens nothing: nothing in a folder is handed to the system.
    expect(
      await handlers['explorer:open']({ documentId: 'document-6', entryId: 'e-image' }),
    ).toEqual({ document: null, documentId: null });
  });

  it('refuses a request that names a path, so no window can list or open one of its choosing', async () => {
    const explorer = explorerFiles();
    const handlers = createHandlers({ ...dependencies(), explorer });
    const list = guard('explorer:list', handlers['explorer:list']);
    const open = guard('explorer:open', handlers['explorer:open']);

    await expect(list({ entryId: null, path: 'C:/Users/someone' })).rejects.toBeInstanceOf(
      IpcContractError,
    );
    await expect(
      open({ documentId: 'document-7', entryId: 'e-brief', path: '/etc/passwd' }),
    ).rejects.toBeInstanceOf(IpcContractError);
    expect(explorer.asked).toEqual([]);
  });
});

/** TYTO-366, ADR 0124: an image for the preview, by id, never by a path. */
describe('the explorer image channel', () => {
  it('answers the image by id, unchanged for the version the window has, and gone otherwise', async () => {
    const explorer = explorerFiles();
    const image = guard(
      'explorer:image',
      createHandlers({ ...dependencies(), explorer })['explorer:image'],
    );

    await expect(image({ entryId: 'e-image' })).resolves.toMatchObject({
      ok: true,
      mime: 'image/png',
      version: '1:4',
      // TYTO-274: where it is, as the documents service labels a path (ADR 0125).
      pathLabel: 'label of /work/promo/foto.png',
    });
    await expect(image({ entryId: 'e-image', have: '1:4' })).resolves.toEqual({ unchanged: true });
    await expect(image({ entryId: 'e-brief' })).resolves.toEqual({ ok: false, reason: 'gone' });
  });

  it('refuses a request that names a path, and an answer that is not an image data URI', async () => {
    const explorer = explorerFiles();
    const image = guard(
      'explorer:image',
      createHandlers({ ...dependencies(), explorer })['explorer:image'],
    );
    await expect(image({ entryId: 'e-image', path: 'C:/Users/x.png' })).rejects.toBeInstanceOf(
      IpcContractError,
    );
    expect(explorer.asked).toEqual([]);

    const leaky = guard('explorer:image', (() =>
      Promise.resolve({
        ok: true,
        name: 'x.svg',
        mime: 'image/svg+xml',
        bytes: 1,
        version: '1:1',
        dataUrl: 'javascript:alert(1)',
      })) as never);
    await expect(leaky({ entryId: 'e-image' })).rejects.toThrow(/response does not match/u);
  });
});

/** TYTO-352, ADR 0121: the explorer writes by id and name, and the tabs follow. */
describe('the explorer write channels', () => {
  it('opens a new brief in the tab it was given, and nothing for a folder or a taken name', async () => {
    const handlers = createHandlers(dependencies());
    const create = guard('explorer:create', handlers['explorer:create']);

    const brief = await create({
      documentId: 'document-3',
      parentId: null,
      name: 'novo.brief',
      kind: 'file',
    });
    expect(brief).toMatchObject({
      ok: true,
      entry: { id: 'e-new', kind: 'brief' },
      documentId: 'document-3',
      document: { path: '/work/promo/novo.brief' },
    });
    await expect(
      create({ documentId: 'document-4', parentId: 'e-folder', name: 'anexos', kind: 'folder' }),
    ).resolves.toEqual({
      ok: true,
      entry: { id: 'e-new', name: 'anexos', kind: 'folder' },
      document: null,
      documentId: null,
    });
    await expect(
      create({ documentId: 'document-5', parentId: null, name: 'taken.brief', kind: 'file' }),
    ).resolves.toEqual({ ok: false, reason: 'exists' });
  });

  it('moves the tabs under a renamed entry and answers each one, never a path', async () => {
    const deps = dependencies();
    const handlers = createHandlers(deps);
    const rename = guard('explorer:rename', handlers['explorer:rename']);

    const renamed = await rename({ entryId: 'e-folder', name: 'capitulos' });

    expect(renamed).toEqual({
      ok: true,
      entry: { id: 'e-folder', name: 'capitulos', kind: 'folder' },
      moved: [{ documentId: 'document-9', name: 'capa.brief', pathLabel: '/work/promo/capitulos' }],
    });
    expect(deps.documents.followed).toEqual([
      ['retarget', '/work/promo/slides', '/work/promo/capitulos'],
    ]);
    await expect(rename({ entryId: 'e-other', name: 'x' })).resolves.toEqual({
      ok: false,
      reason: 'gone',
    });
  });

  it('releases the tabs under a trashed entry, and none when the trash refused', async () => {
    const deps = dependencies();
    const handlers = createHandlers(deps);
    const remove = guard('explorer:delete', handlers['explorer:delete']);

    await expect(remove({ entryId: 'e-folder' })).resolves.toEqual({
      ok: true,
      released: ['document-9'],
    });
    expect(deps.documents.followed).toEqual([['release', '/work/promo/slides']]);
    await expect(remove({ entryId: 'e-brief' })).resolves.toEqual({
      ok: false,
      reason: 'trash-failed',
    });
    expect(deps.documents.followed).toHaveLength(1);
  });

  it('names the tabs under an entry, changing nothing, and none for an entry it does not know', async () => {
    const deps = dependencies();
    const handlers = createHandlers(deps);
    const tabsUnder = guard('explorer:tabs-under', handlers['explorer:tabs-under']);

    await expect(tabsUnder({ entryId: 'e-folder' })).resolves.toEqual({
      documentIds: ['document-9'],
    });
    await expect(tabsUnder({ entryId: 'e-unknown' })).resolves.toEqual({ documentIds: [] });
    await expect(tabsUnder({ entryId: 'e-folder', path: '/' })).rejects.toBeInstanceOf(
      IpcContractError,
    );
    expect(deps.documents.followed).toEqual([]);
  });

  it('refuses a request that names a path, so no window can write where it chooses', async () => {
    const explorer = explorerFiles();
    const handlers = createHandlers({ ...dependencies(), explorer });
    const create = guard('explorer:create', handlers['explorer:create']);
    const rename = guard('explorer:rename', handlers['explorer:rename']);
    const remove = guard('explorer:delete', handlers['explorer:delete']);

    await expect(
      create({
        documentId: 'document-1',
        parentId: null,
        name: 'x.brief',
        kind: 'file',
        path: 'C:/Windows',
      }),
    ).rejects.toBeInstanceOf(IpcContractError);
    await expect(
      rename({ entryId: 'e-brief', name: 'x.brief', to: '/etc/passwd' }),
    ).rejects.toBeInstanceOf(IpcContractError);
    await expect(remove({ entryId: 'e-brief', path: '/' })).rejects.toBeInstanceOf(
      IpcContractError,
    );
    // A kind that is neither, and a name past the bound, are refused before main looks.
    await expect(
      create({ documentId: 'document-1', parentId: null, name: 'x', kind: 'brief' }),
    ).rejects.toBeInstanceOf(IpcContractError);
    await expect(rename({ entryId: 'e-brief', name: 'x'.repeat(1001) })).rejects.toBeInstanceOf(
      IpcContractError,
    );
    expect(explorer.asked).toEqual([]);
  });
});

/** TYTO-352, ADR 0121: the native context menu, whose labels are the window's. */
describe('the context menu channel', () => {
  const items = [
    { id: 'new-file', label: 'New File…', enabled: true },
    { id: 'rename', label: 'Rename…', enabled: true },
    { id: 'delete', label: 'Delete', enabled: true },
  ];

  it('answers the id the system menu picked', async () => {
    const handlers = createHandlers(dependencies());
    const context = guard('menu:context', handlers['menu:context']);
    await expect(context({ x: 10, y: 20, items })).resolves.toEqual({ chosen: 'rename' });
  });

  it('answers nothing for an item that was offered disabled, or was not offered', async () => {
    const handlers = createHandlers(dependencies());
    const disabled = guard('menu:context', handlers['menu:context']);
    await expect(
      disabled({ x: 0, y: 0, items: items.map((item) => ({ ...item, enabled: false })) }),
    ).resolves.toEqual({ chosen: null });

    const stray = createHandlers({
      ...dependencies(),
      contextMenu: () => Promise.resolve('format-disk'),
    });
    await expect(
      guard('menu:context', stray['menu:context'])({ x: 0, y: 0, items }),
    ).resolves.toEqual({ chosen: null });
  });

  it('refuses no items, two items with one id, and an item with a key it does not know', async () => {
    const handlers = createHandlers(dependencies());
    const context = guard('menu:context', handlers['menu:context']);
    await expect(context({ x: 0, y: 0, items: [] })).rejects.toBeInstanceOf(IpcContractError);
    await expect(
      context({ x: 0, y: 0, items: [items[0], { ...items[1], id: 'new-file' }] }),
    ).rejects.toBeInstanceOf(IpcContractError);
    await expect(
      context({ x: 0, y: 0, items: [{ ...items[0], role: 'quit' }] }),
    ).rejects.toBeInstanceOf(IpcContractError);
  });
});
