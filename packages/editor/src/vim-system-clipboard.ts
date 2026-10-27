import type { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { Vim } from '@replit/codemirror-vim';

import { onVimYank } from './vim-yank.js';

/**
 * Vim's yank and the system clipboard (TYTO-442, ADR 0143 amendment), as vim's
 * `clipboard=unnamed` shares them.
 *
 * Outward, an unnamed yank (`yiw`, `yy`) is written to the clipboard; a named one (`"ayiw`) is
 * not, and `"+y` is the engine's own write. Inward, when the editor takes focus the clipboard
 * is read and, if it changed since Tyto last wrote or mirrored it, put in the unnamed register
 * and `+`, so `p`, a count, `.`, visual `p` and `gr` all paste it as vim's own register would.
 * Reading on `p` instead was measured and dropped: the read is asynchronous, so the paste lost
 * its count and `gr`, an operator that runs at once, could not wait for it.
 *
 * "Changed" compares with line breaks normalised, because Windows hands `\r\n` back for text
 * written with `\n`; without that, Tyto's own `yy` would come back and overwrite a later `dd`.
 */

/** The host's clipboard, text only. The desktop passes the renderer's `navigator.clipboard`. */
export interface SystemClipboard {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

let port: SystemClipboard | undefined;
/** The clipboard text Tyto last wrote or mirrored, line breaks normalised. */
let lastKnown: string | undefined;
/** Counts yanks, so a read that a yank overtook does not overwrite what was yanked. */
let yanks = 0;

/**
 * Shares vim's yank with `clipboard` for every editor of the window, as `setVimYankFlash`
 * switches the flash. Undefined, the default, switches the sharing off.
 */
export function setVimSystemClipboard(clipboard: SystemClipboard | undefined): void {
  port = clipboard;
  if (clipboard === undefined) lastKnown = undefined;
}

const normalise = (text: string): string => text.replace(/\r\n/gu, '\n');

/** A port that throws or rejects (a window without focus rejects a read) changes nothing. */
const attempt = async <T>(call: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await call();
  } catch {
    return undefined;
  }
};

const unnamedNow = (): { text: string; linewise: boolean; yanks: number } => {
  const unnamed = Vim.getRegisterController().getRegister('"');
  return { text: unnamed.toString(), linewise: unnamed.linewise === true, yanks };
};

const mirror = async (): Promise<void> => {
  const clipboard = port;
  if (clipboard === undefined) return;
  const before = unnamedNow();
  const read = await attempt(() => clipboard.readText());
  if (read === undefined || port !== clipboard) return;
  const text = normalise(read);
  if (text === '' || text === lastKnown) return;
  lastKnown = text;
  const now = unnamedNow();
  if (now.text !== before.text || now.linewise !== before.linewise || now.yanks !== before.yanks) {
    return;
  }
  // A clipboard that ends in a line break pastes as lines, as vim reads its `+` register.
  const linewise = text.endsWith('\n');
  const controller = Vim.getRegisterController();
  controller.getRegister('"').setText(text, linewise);
  controller.getRegister('+').setText(text, linewise);
};

const systemClipboardSync = ViewPlugin.define((view) => {
  const stop = onVimYank(view, ({ text, register }) => {
    yanks += 1;
    const clipboard = port;
    if (clipboard === undefined || register !== 'unnamed') return;
    lastKnown = normalise(text);
    void attempt(() => clipboard.writeText(text));
  });
  const onFocus = (): void => {
    void mirror();
  };
  view.contentDOM.addEventListener('focus', onFocus);
  return {
    destroy: () => {
      stop();
      view.contentDOM.removeEventListener('focus', onFocus);
    },
  };
});

/** The sharing, which `vimMode()` includes; it does nothing until a host passes a clipboard. */
export const vimSystemClipboard: Extension = systemClipboardSync;

/** Test seam: the port and what it last saw are module state. */
export const resetVimSystemClipboardForTest = (): void => {
  port = undefined;
  lastKnown = undefined;
  yanks = 0;
};
