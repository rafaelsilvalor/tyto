import { ok } from '@tyto/core';
import type { LoadedPlugins } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import { windowDirectives } from './directives.js';

const loaded = (): LoadedPlugins => ({
  plugins: [
    {
      id: 'demo',
      manifest: {
        name: 'demo',
        version: '1.0.0',
        engine: '>=0.1',
        contributes: ['directive'],
        permissions: [],
      },
      activate: (host) =>
        host.registerDirective({
          id: 'demo',
          names: ['shout'],
          transform: () => ok([{ name: 'titulo', body: [{ kind: 'text', value: 'OI' }] }]),
        }),
    },
  ],
  warnings: [],
  close: () => Promise.resolve(),
});

describe('windowDirectives', () => {
  it('offers nothing until the plugins have started, and theirs after', async () => {
    let start: (value: LoadedPlugins) => void = () => undefined;
    const directives = windowDirectives(new Promise((resolve) => (start = resolve)));

    expect(directives.names()).toEqual([]);
    expect(directives.resolver.find('demo', 'shout')).toBeUndefined();

    start(loaded());
    await Promise.resolve();
    await Promise.resolve();
    expect(directives.names()).toEqual(['demo/shout']);
    expect(directives.resolver.find('demo', 'shout')).toBeTypeOf('function');
  });
});
