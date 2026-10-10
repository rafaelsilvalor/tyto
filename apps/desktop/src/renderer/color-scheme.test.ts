import { type ThemeName } from '@tyto/editor';
import { describe, expect, it } from 'vitest';

import { followScheme } from './color-scheme.js';

/** A media query list whose answer the test moves, the way the system does. */
const fakeSystem = (dark: boolean) => {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const queries: string[] = [];
  const list = {
    get matches() {
      return dark;
    },
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  } as unknown as MediaQueryList;
  return {
    source: {
      matchMedia: (query: string) => {
        queries.push(query);
        return list;
      },
    },
    queries,
    listeners,
    switchTo(next: boolean) {
      dark = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  };
};

describe('following the system scheme (TYTO-96)', () => {
  it('applies the scheme the window opens in, from the colour-scheme query', () => {
    const system = fakeSystem(true);
    const seen: ThemeName[] = [];

    followScheme((scheme) => seen.push(scheme), system.source);

    expect(system.queries).toEqual(['(prefers-color-scheme: dark)']);
    expect(seen).toEqual(['dark']);
  });

  it('applies every change the system makes, with no restart', () => {
    const system = fakeSystem(false);
    const seen: ThemeName[] = [];
    followScheme((scheme) => seen.push(scheme), system.source);

    system.switchTo(true);
    system.switchTo(false);

    expect(seen).toEqual(['light', 'dark', 'light']);
  });

  it('stops when asked', () => {
    const system = fakeSystem(false);
    const seen: ThemeName[] = [];
    const stop = followScheme((scheme) => seen.push(scheme), system.source);

    stop();
    system.switchTo(true);

    expect(seen).toEqual(['light']);
    expect(system.listeners.size).toBe(0);
  });

  it('is light where there is no media query to ask, which is jsdom', () => {
    const seen: ThemeName[] = [];
    followScheme((scheme) => seen.push(scheme), {});
    expect(seen).toEqual(['light']);
  });
});
