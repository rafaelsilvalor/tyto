import { describe, expect, it } from 'vitest';

import { type EventWindow, windowEvents } from './window-events.js';

/** A window that behaves as Electron's does once destroyed: reading `webContents` throws. */
class FakeWindow implements EventWindow {
  readonly sent: [string, unknown][] = [];
  destroyed = false;
  contentsDestroyed = false;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  get webContents(): EventWindow['webContents'] {
    if (this.destroyed) throw new TypeError('Object has been destroyed');
    return {
      isDestroyed: () => this.contentsDestroyed,
      send: (channel, payload) => {
        this.sent.push([channel, payload]);
      },
    };
  }
}

describe('the one door from main to the window', () => {
  it('pushes a checked payload to a live window', () => {
    const window = new FakeWindow();
    const send = windowEvents(() => window);

    expect(send('terminal:exit', { terminalId: 'terminal-1', code: 0 })).toBe(true);
    expect(window.sent).toEqual([['terminal:exit', { terminalId: 'terminal-1', code: 0 }]]);
  });

  it('does not throw after the window is destroyed, and sends nothing', () => {
    const window = new FakeWindow();
    const send = windowEvents(() => window);
    window.destroyed = true;

    expect(() => send('terminal:exit', { terminalId: 'terminal-1', code: 0 })).not.toThrow();
    expect(send('queue:changed', {})).toBe(false);
    expect(window.sent).toEqual([]);
  });

  it('sends nothing to a page whose contents are gone, or with no window at all', () => {
    const window = new FakeWindow();
    window.contentsDestroyed = true;

    expect(windowEvents(() => window)('queue:changed', {})).toBe(false);
    expect(windowEvents(() => undefined)('queue:changed', {})).toBe(false);
    expect(window.sent).toEqual([]);
  });
});
