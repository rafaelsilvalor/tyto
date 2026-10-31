// @vitest-environment jsdom
import { concreteKey } from '@tyto/editor';
import { describe, expect, it } from 'vitest';

import { COMMANDS_PANEL } from '../../shared/layout.js';
import { builtInKeybindings, togglePanelCommandId, windowStrokeOf } from './commands.js';

/**
 * Ctrl+` reaches the command panel by the key's position (TYTO-496): the key left of 1, whatever
 * the layout prints on it. Real `KeyboardEvent`s, as the window's dispatcher receives them, for
 * a US keyboard, a Brazilian ABNT2 one, and ABNT2's dead backquote, which must run nothing.
 */

const toggle = builtInKeybindings.find(
  (binding) => binding.command === togglePanelCommandId(COMMANDS_PANEL),
)!;

const opens = (init: KeyboardEventInit, platform = 'win32'): boolean =>
  windowStrokeOf(new KeyboardEvent('keydown', init)) === concreteKey(toggle, platform);

describe('the command panel’s key', () => {
  it('is Ctrl and the key left of 1 on a US keyboard', () => {
    expect(opens({ key: '`', code: 'Backquote', ctrlKey: true })).toBe(true);
  });

  it('is the same physical key on ABNT2, where it prints an apostrophe', () => {
    expect(opens({ key: "'", code: 'Backquote', ctrlKey: true })).toBe(true);
  });

  it('is not ABNT2’s dead backquote, which sits on another key', () => {
    expect(opens({ key: 'Dead', code: 'BracketLeft', ctrlKey: true })).toBe(false);
  });

  it('is Ctrl on macOS too, and needs Ctrl', () => {
    expect(opens({ key: '`', code: 'Backquote', ctrlKey: true }, 'darwin')).toBe(true);
    expect(opens({ key: '`', code: 'Backquote', metaKey: true }, 'darwin')).toBe(false);
    expect(opens({ key: '`', code: 'Backquote' })).toBe(false);
  });

  it('leaves every other key read by what it prints', () => {
    expect(
      windowStrokeOf(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true })),
    ).toBe('Ctrl-k');
  });
});
