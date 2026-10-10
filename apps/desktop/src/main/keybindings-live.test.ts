import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IpcEventPayload } from '../../shared/ipc.js';
import { type LiveKeybindings, createLiveKeybindings } from './keybindings-live.js';

/**
 * The watcher's half of `keybindings.json` (TYTO-207), against a real file. The watcher is the
 * test calling `changed()`, which is what the composition root's does.
 */

let scratch: string;
let file: string;
let sent: IpcEventPayload<'keybindings:changed'>[];

const live = (): LiveKeybindings =>
  createLiveKeybindings({
    readText: () => readFile(file, 'utf8').catch(() => ''),
    send: (payload) => sent.push(payload),
    log: { info: () => undefined },
  });

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-live-keybindings-'));
  file = join(scratch, 'keybindings.json');
  sent = [];
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('live keybindings', () => {
  it('sends the new text when the file moves', async () => {
    const keybindings = live();
    const text = '[{ "key": "ctrl+shift+e", "command": "file.export" }]\n';
    writeFileSync(file, text, 'utf8');

    await keybindings.changed();

    expect(sent).toEqual([{ text }]);
  });

  it('sends a burst of events with the same text once', async () => {
    const keybindings = live();
    writeFileSync(file, '[]\n', 'utf8');

    await Promise.all([keybindings.changed(), keybindings.changed(), keybindings.changed()]);

    expect(sent).toHaveLength(1);
  });

  it('does not send the text the window already read, or the file the app created', async () => {
    const keybindings = live();
    writeFileSync(file, '[]\n', 'utf8');
    expect(await keybindings.read()).toBe('[]\n');
    await keybindings.changed();

    keybindings.wrote('// new\n[]\n');
    writeFileSync(file, '// new\n[]\n', 'utf8');
    await keybindings.changed();

    expect(sent).toEqual([]);
  });

  it('sends an emptied or deleted file as empty text, so the user layer goes away', async () => {
    const keybindings = live();
    writeFileSync(file, '[{ "key": "ctrl+shift+e", "command": "file.export" }]', 'utf8');
    await keybindings.read();
    rmSync(file);

    await keybindings.changed();

    expect(sent).toEqual([{ text: '' }]);
  });
});
