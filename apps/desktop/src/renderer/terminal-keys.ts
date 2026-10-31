/**
 * What a key pressed in a terminal does (TYTO-497, ADR 0164 decision 8). Pure, so each platform's
 * rule is tested without xterm or a real clipboard.
 *
 * - On Windows and Linux, `Ctrl+C` copies when text is selected and otherwise goes to the shell,
 *   which reads it as an interrupt, as VS Code does; `Ctrl+Shift+C` and `Ctrl+Shift+V` copy and
 *   paste. On macOS, `Cmd+C` and `Cmd+V`.
 * - Then the window's own keys: an entry of the key table bound globally or in the `terminal`
 *   context. xterm would otherwise take them, so `Ctrl+K` would never reach the command bar.
 * - Everything else is the shell's.
 */

export interface TerminalKey {
  readonly key: string;
  /** The physical key, which the window's table reads for the key left of 1 (`windowStrokeOf`). */
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export type TerminalKeyAction = 'copy' | 'paste' | 'window' | 'shell';

export function terminalKeyAction(
  event: TerminalKey,
  platform: string,
  hasSelection: boolean,
  windowClaims: (event: TerminalKey) => boolean,
): TerminalKeyAction {
  const letter = event.key.toLowerCase();
  if (platform === 'darwin') {
    const command = event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (command && letter === 'c' && hasSelection) return 'copy';
    if (command && letter === 'v') return 'paste';
  } else if (event.ctrlKey && !event.metaKey && !event.altKey) {
    if (event.shiftKey && letter === 'c') return 'copy';
    if (event.shiftKey && letter === 'v') return 'paste';
    if (!event.shiftKey && letter === 'c' && hasSelection) return 'copy';
  }
  return windowClaims(event) ? 'window' : 'shell';
}

/**
 * Whether a paste asks first: more than one line, so a pasted script does not run line by line
 * by surprise. One trailing line break is not a second line.
 */
export function pasteNeedsConfirming(text: string): boolean {
  return pastedLines(text) > 1;
}

export function pastedLines(text: string): number {
  return text.replace(/\r?\n$/u, '').split(/\r\n|\r|\n/u).length;
}
