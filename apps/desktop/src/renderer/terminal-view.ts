import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { type TerminalKey, terminalKeyAction } from './terminal-keys.js';
import type { TerminalView } from './terminal-sessions.js';
import { type TokenReader, terminalFont, terminalTheme } from './terminal-theme.js';

/**
 * A terminal's screen, drawn by xterm (TYTO-497, ADR 0164 decision 7).
 *
 * **Loaded by `import()` from `main.ts`, never imported**, for the reason the template mode is:
 * xterm is 412 kB of script, and a window that never shows a terminal should not evaluate it
 * before it can answer the quit question (ADR 0031).
 */

export interface TerminalViewPorts {
  readonly platform: string;
  readonly read: TokenReader;
  /** Whether the window's key table runs this key, globally or in the `terminal` context. */
  readonly windowClaims: (event: TerminalKey) => boolean;
  /** Resolves with what the clipboard holds, or writes to it. */
  readonly readClipboard: () => Promise<string>;
  readonly writeClipboard: (text: string) => Promise<void>;
  /** Asks before a paste of more than one line is sent; resolves with the answer. */
  readonly confirmPaste: (text: string) => Promise<boolean>;
}

export function createTerminalView(
  ports: TerminalViewPorts,
  send: (data: string) => void,
): TerminalView {
  const font = terminalFont(ports.read);
  const terminal = new Terminal({
    theme: terminalTheme(ports.read),
    fontFamily: font.family,
    fontSize: font.size,
    cursorBlink: true,
    scrollback: 5000,
    // The window's links, copy and paste are its own; xterm's right-click selection would be a
    // second rule for the same gesture.
    rightClickSelectsWord: false,
    allowProposedApi: false,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  const element = document.createElement('div');
  element.className = 'terminal-screen';
  let opened = false;

  const paste = async (): Promise<void> => {
    const text = await ports.readClipboard();
    if (text === '') return;
    if (!(await ports.confirmPaste(text))) return;
    // `paste` and not `input`: xterm brackets it when the shell asked, and turns line breaks
    // into the carriage returns a terminal sends.
    terminal.paste(text);
  };

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    const action = terminalKeyAction(
      event,
      ports.platform,
      terminal.hasSelection(),
      ports.windowClaims,
    );
    if (action === 'shell') return true;
    if (action === 'copy') {
      void ports.writeClipboard(terminal.getSelection());
      terminal.clearSelection();
      event.preventDefault();
      // Not to the window either: on Windows Ctrl+Shift+C would be the devtools' key.
      event.stopPropagation();
    } else if (action === 'paste') {
      void paste();
      event.preventDefault();
      // The window binds Ctrl+Shift+V to the preview; in a terminal the paste wins.
      event.stopPropagation();
    }
    // 'window': xterm leaves it alone and the window's dispatcher hears it bubble.
    return false;
  });
  terminal.onData(send);

  return {
    element,
    write: (data) => {
      terminal.write(data);
    },
    focus: () => {
      terminal.focus();
    },
    fit: () => {
      // xterm opens into a node that is in the document; the panel puts it there first.
      if (!element.isConnected) return undefined;
      if (!opened) {
        terminal.open(element);
        opened = true;
      }
      if (element.clientWidth === 0 || element.clientHeight === 0) return undefined;
      fit.fit();
      return { cols: terminal.cols, rows: terminal.rows };
    },
    restyle: () => {
      const next = terminalFont(ports.read);
      terminal.options.theme = terminalTheme(ports.read);
      terminal.options.fontFamily = next.family;
      terminal.options.fontSize = next.size;
    },
    dispose: () => {
      terminal.dispose();
      element.remove();
    },
  };
}
