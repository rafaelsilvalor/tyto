import { describe, expect, it } from 'vitest';

import {
  type IpcChannelName,
  IPC_CHANNELS,
  IPC_CHANNEL_NAMES,
  IPC_EVENTS,
  IPC_EVENT_NAMES,
  IpcContractError,
  isIpcChannelName,
  isIpcEventName,
  parseIpc,
  parseIpcEvent,
} from './ipc.js';

describe('the IPC contract', () => {
  it('names every channel exactly once, and nothing else', () => {
    expect([...IPC_CHANNEL_NAMES].sort()).toEqual([
      'app:exit-ack',
      'app:exit-answer',
      'app:exit-listening',
      'app:info',
      'app:locale',
      'brief:preview',
      // TYTO-495, ADR 0159: a tyto command run in main, stopped, and the tree for help.
      'cli:cancel',
      'cli:commands',
      'cli:open-diagnostic',
      'cli:run',
      'credentials:delete',
      'credentials:set',
      // TYTO-490, ADR 0157 §6: a delivery's export; the window sends a text, main the folders.
      'delivery:export',
      // TYTO-489, ADR 0157: Delivery: New…, a name and a text, never a path.
      'delivery:new',
      // TYTO-490: whether the tab in front is a delivery's brief, for its button.
      'delivery:of',
      'dialog:confirm',
      'dialog:save-changes',
      'editor:vim-mode',
      'explorer:create',
      'explorer:delete',
      'explorer:image',
      'explorer:list',
      'explorer:open',
      'explorer:rename',
      'explorer:tabs-under',
      'export:cancel',
      'export:choose-directory',
      'export:kinds',
      'export:progress',
      'export:reveal',
      'export:start',
      'file:close',
      'file:open',
      'file:reopen',
      'file:save',
      'files:recent',
      'help:open-documentation',
      'keybindings:open',
      'keybindings:read',
      'layout:get',
      'layout:set',
      'log:reveal',
      'log:write',
      'menu:context',
      'menu:disabled',
      'menu:model',
      'menu:popup',
      'panel:request',
      // TYTO-433: Plugins: Sync / Update Plugin Files.
      'plugin-files:sync',
      'plugins:keymaps',
      'plugins:list',
      'plugins:panels',
      'plugins:vim',
      'queue:list',
      'queue:open-brief',
      'queue:reveal-output',
      'queue:run',
      'queue:set-auto-run',
      'queue:set-folder',
      'queue:set-kinds',
      'recipe:run',
      'recipe:verbs',
      'session:read',
      'session:write',
      'settings:open',
      'settings:outline',
      'settings:validate',
      'snippets:open',
      'snippets:read',
      'template:new',
      'template:open',
      'template:preview',
      'template:save',
      'templates:folder',
      'templates:list',
      'templates:set-folder',
      // TYTO-497, ADR 0164: a terminal main owns; a size, typed text and an id, never a path.
      'terminal:input',
      'terminal:kill',
      'terminal:list',
      'terminal:open',
      'terminal:resize',
      'theme:choose',
      'theme:current',
      'theme:list',
      'theme:preview',
      'update:act',
      'update:status',
      'window:zoom',
      'workspace:folder',
      'workspace:open-recent',
      'workspace:recent',
      'workspace:set-folder',
      'workspace:trust',
    ]);
    expect(new Set(IPC_CHANNEL_NAMES).size).toBe(IPC_CHANNEL_NAMES.length);
  });

  it('declares both directions for every channel', () => {
    // The table is what `registerIpcHandlers` and the preload both walk, so a channel with
    // half a contract would be a runtime `undefined.safeParse` on one side or the other.
    for (const name of IPC_CHANNEL_NAMES) {
      expect(IPC_CHANNELS[name].request, name).toBeDefined();
      expect(IPC_CHANNELS[name].response, name).toBeDefined();
    }
  });

  it('recognises its own channel names and refuses a made-up one', () => {
    expect(isIpcChannelName('app:info')).toBe(true);
    expect(isIpcChannelName('app:quit')).toBe(false);
    // Not a channel either, and the one a plain `in` check would have got wrong.
    expect(isIpcChannelName('toString')).toBe(false);
  });
});

/**
 * The second table (ADR 0029), asserted separately because it is a separate direction.
 *
 * The property worth pinning is that the two tables do not leak into each other: an event
 * name is not a channel name and cannot be invoked, which is what keeps "a push carries no
 * reply" a rule of the contract rather than a habit of the callers.
 */
/**
 * ADR 0164 decision 3: the window draws a terminal and types into it, and main chooses the
 * program, the folder and the environment. Strict schemas make that a refusal at the preload,
 * not a key main happens to ignore.
 */
describe('the terminal channels', () => {
  const terminalChannels = IPC_CHANNEL_NAMES.filter((name) => name.startsWith('terminal:'));

  it('take no path, no program and no environment', () => {
    expect(terminalChannels).toHaveLength(5);
    const valid: Record<string, object> = {
      'terminal:open': { cols: 80, rows: 24 },
      'terminal:input': { terminalId: 'terminal-1', data: 'echo hi\r' },
      'terminal:resize': { terminalId: 'terminal-1', cols: 80, rows: 24 },
      'terminal:kill': { terminalId: 'terminal-1' },
      'terminal:list': {},
    };
    for (const name of terminalChannels) {
      const request = valid[name];
      expect(request, name).toBeDefined();
      expect(IPC_CHANNELS[name].request.safeParse(request).success, name).toBe(true);
      for (const smuggled of [
        { cwd: '/etc' },
        { shell: '/bin/sh' },
        { file: 'calc.exe' },
        { args: ['-c', 'id'] },
        { env: { PATH: '/tmp' } },
      ]) {
        const parsed = IPC_CHANNELS[name].request.safeParse({ ...request, ...smuggled });
        expect(parsed.success, `${name} with ${Object.keys(smuggled)[0] ?? ''}`).toBe(false);
      }
    }
  });
});

describe('the event table', () => {
  it('names every event exactly once, and nothing else', () => {
    expect([...IPC_EVENT_NAMES].sort()).toEqual([
      'app:exit-requested',
      // TYTO-495, ADR 0159: what a command prints, and where its run stands.
      'cli:diagnostics',
      'cli:output',
      'cli:state',
      'command:run',
      // TYTO-279. The open folder changed on disk; the explorer lists again.
      'explorer:changed',
      // TYTO-207. keybindings.json changed on disk; the push carries its text.
      'keybindings:changed',
      // TYTO-45. The queue changed; the panel asks `queue:list` when it hears it.
      'queue:changed',
      // TYTO-206. settings.json changed, or a screen's change to it was refused.
      'settings:changed',
      // TYTO-277. snippets.json changed on disk; the push carries its text.
      'snippets:changed',
      // TYTO-433. A plugin files' sync changed the templates; the window lists them again.
      'templates:changed',
      // TYTO-497, ADR 0164. What a terminal printed, and its shell ending.
      'terminal:exit',
      'terminal:output',
      // TYTO-131. The update status changed; the window asks `update:status`.
      'update:changed',
    ]);
    expect(new Set(IPC_EVENT_NAMES).size).toBe(IPC_EVENT_NAMES.length);
  });

  it('keeps the two directions apart', () => {
    // An event the renderer could `invoke` would be a push with a reply, which is the shape
    // this app decided not to have.
    for (const name of IPC_EVENT_NAMES) {
      expect(isIpcChannelName(name), name).toBe(false);
      expect(IPC_EVENTS[name], name).toBeDefined();
    }
    expect(isIpcEventName('app:exit-answer')).toBe(false);
  });

  it('recognises its own event names and refuses a made-up one', () => {
    expect(isIpcEventName('app:exit-requested')).toBe(true);
    expect(isIpcEventName('app:something-else')).toBe(false);
    expect(isIpcEventName('toString')).toBe(false);
  });

  it('refuses a payload that does not match, and says which direction it was going', () => {
    let thrown: unknown;
    try {
      parseIpcEvent('app:exit-requested', {});
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IpcContractError);
    // `'event'` and not `'request'`: the direction names whose bug it is, and a bad push is
    // main's. Reusing `'request'` would make the message blame the renderer.
    expect((thrown as IpcContractError).direction).toBe('event');
    expect((thrown as IpcContractError).channel).toBe('app:exit-requested');
  });

  it('passes a payload that matches', () => {
    expect(parseIpcEvent('app:exit-requested', { askId: 3 })).toEqual({ askId: 3 });
  });
});

/**
 * The acceptance criterion: *a round-trip IPC call with an invalid payload is rejected by
 * the Zod contract.* Driven here rather than through a window, because the contract is what
 * rejects and it needs neither process to do it.
 */
describe('a request that does not match', () => {
  it('is refused, with the channel and the field named', () => {
    expect(() =>
      parseIpc('credentials:set', 'request', { plugin: 42, key: 'k', secret: 'x' }),
    ).toThrow(IpcContractError);

    try {
      parseIpc('credentials:set', 'request', { plugin: 42, key: 'k', secret: 'x' });
      expect.unreachable('the contract accepted a number where a name goes');
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect((error as IpcContractError).channel).toBe('credentials:set');
      expect((error as IpcContractError).direction).toBe('request');
      // A reader has to be able to find the field without opening the schema.
      expect((error as Error).message).toContain('plugin');
    }
  });

  it('refuses a blank key, which would be a credential no manifest can declare', () => {
    expect(() => parseIpc('credentials:delete', 'request', { plugin: 'pdf', key: '' })).toThrow(
      IpcContractError,
    );
  });

  it('refuses a missing field as readily as a wrong one', () => {
    expect(() => parseIpc('credentials:set', 'request', { plugin: 'pdf', key: 'k' })).toThrow(
      IpcContractError,
    );
  });

  it('accepts the shape the channel declares, and hands back the parsed value', () => {
    expect(
      parseIpc('credentials:set', 'request', { plugin: 'pdf', key: 'k', secret: 'token' }),
    ).toEqual({ plugin: 'pdf', key: 'k', secret: 'token' });
  });

  it("keeps the plugin's own 16 KiB ceiling, in UTF-8 bytes (ADR 0134)", () => {
    const request = (secret: string) => ({ plugin: 'pdf', key: 'k', secret });
    expect(() => parseIpc('credentials:set', 'request', request('a'.repeat(16_384)))).not.toThrow();
    expect(() => parseIpc('credentials:set', 'request', request('a'.repeat(16_385)))).toThrow(
      IpcContractError,
    );
    expect(() => parseIpc('credentials:set', 'request', request('é'.repeat(8_193)))).toThrow(
      IpcContractError,
    );
  });
});

describe('a response that does not match', () => {
  it('is refused too, and says it was the response', () => {
    // Main's bug, not the renderer's. Without this check the renderer would receive
    // `undefined` where its types promised a string, at some later line, with nothing
    // naming the channel.
    try {
      parseIpc('app:info', 'response', { version: '1.0.0', platform: 'win32', templates: [] });
      expect.unreachable('the contract accepted a response with no locale');
    } catch (error) {
      expect((error as IpcContractError).direction).toBe('response');
      expect((error as Error).message).toContain('locale');
    }
  });
});

describe('the theme the window applies (TYTO-208)', () => {
  const theme = (colors: Record<string, string>) => ({
    mode: 'system',
    light: { id: 'tyto-light', colors },
    dark: { id: 'tyto-dark', colors: {} },
    diagnostics: [],
    iconStrokeWidth: 1.25,
    statusBarItems: ['problems', 'settings'],
    statusBarColors: {},
    vimMode: false,
    vimPlugins: {},
    vimModeStyle: 'badge',
    indentGuides: true,
    stickyScroll: true,
    tabSize: 2,
    formatBriefOnSave: false,
    briefColumns: 'separator',
    lineNumbers: 'on',
    commandsOrder: 'newestLast',
    commandsFoldOlderRuns: false,
    typography: {
      uiFontFamily: 'Source Sans 3',
      uiFontSize: 14,
      codeFontFamily: 'IBM Plex Mono',
      codeFontSize: 14,
      fontSizes: {},
      fontFamilies: {},
    },
  });

  it('refuses a mode that is not one of the three', () => {
    expect(() => parseIpc('theme:current', 'response', { ...theme({}), mode: 'auto' })).toThrow(
      IpcContractError,
    );
  });

  it('carries a theme problem without a range, which would count lines of the brief', () => {
    const problem = { severity: 'error', code: 'E_THEME_INVALID', message: 'no' };
    const parsed = parseIpc('theme:current', 'response', {
      ...theme({}),
      diagnostics: [{ ...problem, range: { start: 1, end: 2 } }],
    }) as { diagnostics: unknown[] };
    expect(parsed.diagnostics).toEqual([problem]);
  });

  it('carries colours by role', () => {
    expect(() =>
      parseIpc('theme:current', 'response', theme({ surface: '#fafafa' })),
    ).not.toThrow();
  });

  // TYTO-288: the stroke is written into the theme sheet, so the bounds are checked here too.
  it.each([0.5, 2.5])('refuses an icon stroke of %s', (iconStrokeWidth) => {
    expect(() => parseIpc('theme:current', 'response', { ...theme({}), iconStrokeWidth })).toThrow(
      IpcContractError,
    );
  });

  // TYTO-301: the bar draws only ids it knows, so main's answer is checked against them.
  it('carries the status bar items, and refuses an id the bar does not know', () => {
    expect(() => parseIpc('theme:current', 'response', theme({}))).not.toThrow();
    expect(() =>
      parseIpc('theme:current', 'response', { ...theme({}), statusBarItems: ['clock'] }),
    ).toThrow(IpcContractError);
  });

  // TYTO-301: the override is written into the theme sheet, so only hex and known keys pass.
  it('carries the status bar colours, and refuses what could close a rule', () => {
    const colours = (statusBarColors: Record<string, string>) => ({
      ...theme({}),
      statusBarColors,
    });
    expect(() =>
      parseIpc(
        'theme:current',
        'response',
        colours({ 'item.problems': '#fd6', background: '#000000' }),
      ),
    ).not.toThrow();
    for (const bad of [
      { background: 'red; } body { display: none' },
      { background: 'rgb(0 0 0)' },
      { "item.problems'] { x: y } [a": '#000000' },
    ]) {
      expect(() => parseIpc('theme:current', 'response', colours(bad))).toThrow(IpcContractError);
    }
  });

  it.each([
    ['a value that closes the declaration', { surface: '#fff; } body { display: none' }],
    ['a name that is not a role', { 'surface: red; --x': '#fff' }],
  ])('refuses %s before the renderer writes it', (_, colors) => {
    expect(() => parseIpc('theme:current', 'response', theme(colors))).toThrow(IpcContractError);
  });
});

describe('what the contract does not promise', () => {
  it('lets an unknown key through rather than refusing the message', () => {
    // Zod objects strip by default, and that is the right default across a version skew: a
    // renderer built against a newer contract sending one extra field should still work,
    // and the field it sent is simply not read.
    const parsed = parseIpc('credentials:delete', 'request', {
      plugin: 'pdf',
      key: 'k',
      unexpected: true,
    }) as Record<string, unknown>;

    expect(parsed).toEqual({ plugin: 'pdf', key: 'k' });
  });

  it('checks every declared channel, not only the ones a test remembers', () => {
    // `{}` is a valid request for the two channels that ask the app about itself and an
    // invalid one for both credential channels. Asserting it per channel from the
    // table means a channel added later is covered by this test the day it is added.
    const optional: readonly IpcChannelName[] = [
      'app:info',
      'templates:list',
      // E9.8. Asks what you have opened lately, with no arguments. The paths are main's
      // answer, never the renderer's question. `file:open` used to be here and is not any
      // more: with tabs, "which file do you want" has a second half — which tab is it for
      // (E9.11).
      'files:recent',
      // E9.10. Asking where the panels were takes no arguments; telling it takes a layout.
      'layout:get',
      // E9.4. "Where should this go" takes nothing: the answer is a folder the person picks
      // in a native dialog, and the question has no subject. Every other export channel
      // names either a document or a run, so this is the only one of the five here.
      'export:choose-directory',
      // TYTO-48, ADR 0044. "Which kinds can a run produce" has no subject either: the answer
      // is the built-ins' and the installed plugins', which are main's to know.
      'export:kinds',
      // TYTO-132. "Open the log folder" has no subject either: there is one log, and where it
      // is, is main's — a renderer that named the folder would be naming a path it has no
      // business holding.
      'log:reveal',
      // TYTO-318. "Open the manual" has no subject either: which page opens is main's choice
      // between two literals, and a renderer that named a URL would be choosing for it.
      'help:open-documentation',
      // TYTO-122. "Which folder is searched" has no subject either: there is one setting, and
      // where it points is main's.
      'templates:folder',
      // TYTO-278. "Which workspace is open" too: one window, one folder, main's.
      'workspace:folder',
      // TYTO-487. "Which folders were open before" too: the list is main's, and so are its ids.
      'workspace:recent',
      // TYTO-44, ADR 0039. "This page can hear the question" names nothing: there is one
      // window, and the page saying it is the page it is about.
      'app:exit-listening',
      // TYTO-47. "Which plugins are there" has no subject: there is one plugins folder.
      'plugins:list',
      // TYTO-49. "Which panels do the plugins offer" has none either, for the same reason.
      'plugins:panels',
      // TYTO-207. Nor "which keys do the plugins bind".
      'plugins:keymaps',
      // TYTO-418. Nor "which vim keys do the plugins map": every plugin's, which main holds.
      'plugins:vim',
      // TYTO-377. Nor "which verbs may a recipe name": the generic ones and every plugin's.
      'recipe:verbs',
      // TYTO-207. Nor "what does keybindings.json say": there is one file, and main knows it.
      'keybindings:read',
      // TYTO-277. Nor "what does snippets.json say", for the same reason.
      'snippets:read',
      // TYTO-304. Nor "what can settings.json say": the declared settings are the plugins',
      // which main holds.
      'settings:outline',
      // TYTO-113. Nor "which tabs did the last session leave": there is one session file,
      // and only main knows where it is and which paths it names.
      'session:read',
      // TYTO-208. Nor "which colours apply": the theme is main's to read and check.
      'theme:current',
      // TYTO-208. Nor "which themes are there": every plugin's, which main holds.
      'theme:list',
      // TYTO-45. "What is in the queue" has no subject: there is one queue folder, and where
      // it is, is main's.
      'queue:list',
      // TYTO-131. "Is there a newer version" and "do what the notice offers" name nothing:
      // there is one app, and main holds the version and the release page.
      'update:status',
      'update:act',
      // TYTO-244. "What is in the menu" names nothing: there is one installed menu.
      'menu:model',
      // TYTO-495. Nor "which commands does tyto have": there is one command tree.
      'cli:commands',
      // TYTO-497. Nor "which terminals are open": they are main's.
      'terminal:list',
    ];

    for (const name of IPC_CHANNEL_NAMES) {
      const accepts = IPC_CHANNELS[name].request.safeParse({}).success;
      expect(accepts, name).toBe(optional.includes(name));
    }
  });
});

/**
 * The caps on `log:write`, asserted as a mechanism rather than trusted as a convention.
 *
 * TYTO-132's criterion is that no brief text and no file contents reach the log. A rule kept
 * by four call sites lasts until the fifth; a rule kept by the schema cannot be broken by a
 * call site at all, because the preload refuses it before the message is sent.
 */
describe('what may be written to the log', () => {
  it('refuses a message long enough to be a brief', () => {
    expect(() =>
      parseIpc('log:write', 'request', { level: 'error', message: 'x'.repeat(201) }),
    ).toThrow(IpcContractError);
  });

  it('refuses a detail long enough to be a file', () => {
    expect(() =>
      parseIpc('log:write', 'request', {
        level: 'error',
        message: 'save failed',
        detail: 'y'.repeat(4001),
      }),
    ).toThrow(IpcContractError);
  });

  it('refuses a level the renderer has no business filing', () => {
    // `debug` and `info` exist on the log itself — main uses them — and are deliberately not
    // reachable from the window: every level it can reach is one more that can spend the
    // file's ceiling.
    expect(() => parseIpc('log:write', 'request', { level: 'debug', message: 'chatter' })).toThrow(
      IpcContractError,
    );
  });

  it('takes an honest report', () => {
    expect(
      parseIpc('log:write', 'request', {
        level: 'error',
        message: 'renderer error: Error: the preview blew up',
        detail: 'Error: the preview blew up ⏎ at paint (preview.ts:1:1)',
      }),
    ).toMatchObject({ level: 'error' });
  });
});
