import { describe, expect, it } from 'vitest';

import {
  type TerminalKey,
  pasteNeedsConfirming,
  pastedLines,
  terminalKeyAction,
} from './terminal-keys.js';

const key = (init: Partial<TerminalKey> & { key: string }): TerminalKey => ({
  code: '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
});
const nothingClaimed = (): boolean => false;

describe('copy and paste in a terminal (ADR 0164 decision 8)', () => {
  it('copies with Ctrl+C only when text is selected on Windows and Linux; otherwise it interrupts', () => {
    for (const platform of ['win32', 'linux']) {
      expect(
        terminalKeyAction(key({ key: 'c', ctrlKey: true }), platform, true, nothingClaimed),
      ).toBe('copy');
      expect(
        terminalKeyAction(key({ key: 'c', ctrlKey: true }), platform, false, nothingClaimed),
      ).toBe('shell');
    }
  });

  it('copies and pastes with Ctrl+Shift+C and Ctrl+Shift+V on Windows and Linux', () => {
    const shifted = (letter: string) => key({ key: letter, ctrlKey: true, shiftKey: true });
    expect(terminalKeyAction(shifted('C'), 'win32', false, nothingClaimed)).toBe('copy');
    expect(terminalKeyAction(shifted('V'), 'linux', false, nothingClaimed)).toBe('paste');
    // Ctrl+V alone is the shell's: a literal next character in bash, PowerShell's own paste.
    expect(
      terminalKeyAction(key({ key: 'v', ctrlKey: true }), 'win32', false, nothingClaimed),
    ).toBe('shell');
  });

  it('uses Cmd on macOS, and leaves Ctrl+C to the shell there', () => {
    const command = (letter: string) => key({ key: letter, metaKey: true });
    expect(terminalKeyAction(command('c'), 'darwin', true, nothingClaimed)).toBe('copy');
    expect(terminalKeyAction(command('v'), 'darwin', false, nothingClaimed)).toBe('paste');
    expect(
      terminalKeyAction(key({ key: 'c', ctrlKey: true }), 'darwin', true, nothingClaimed),
    ).toBe('shell');
  });

  it("hands the window's own keys back, and every other key to the shell", () => {
    const commandBar = key({ key: 'k', ctrlKey: true });
    const claims = (event: TerminalKey) => event.key === 'k' && event.ctrlKey;

    expect(terminalKeyAction(commandBar, 'win32', false, claims)).toBe('window');
    expect(terminalKeyAction(key({ key: 'l', ctrlKey: true }), 'win32', false, claims)).toBe(
      'shell',
    );
    // The paste wins over a window key on the same keys (Ctrl+Shift+V opens a preview elsewhere).
    expect(
      terminalKeyAction(
        key({ key: 'V', ctrlKey: true, shiftKey: true }),
        'win32',
        false,
        () => true,
      ),
    ).toBe('paste');
  });
});

describe('a paste that asks first', () => {
  it('asks for more than one line, and not for one line with its line break', () => {
    expect(pasteNeedsConfirming('echo hi')).toBe(false);
    expect(pasteNeedsConfirming('echo hi\n')).toBe(false);
    expect(pasteNeedsConfirming('echo one\r\necho two')).toBe(true);
    expect(pastedLines('a\nb\nc\n')).toBe(3);
  });
});
