import { describe, expect, it } from 'vitest';

import { defaultEnvironment, tytoHome } from './environment.js';

/** Where `tyto plugin install` writes. The desktop reads the same variable, and must agree. */
describe('tytoHome', () => {
  it('is TYTO_HOME when it is set', () => {
    expect(tytoHome({ TYTO_HOME: '/tmp/elsewhere' })).toBe('/tmp/elsewhere');
  });

  it('is ~/.tyto otherwise, and an empty variable counts as unset', () => {
    expect(tytoHome({})).toMatch(/[\\/]\.tyto$/u);
    expect(tytoHome({ TYTO_HOME: '' })).toMatch(/[\\/]\.tyto$/u);
  });

  it('is what the real environment hands every command', () => {
    const previous = process.env['TYTO_HOME'];
    process.env['TYTO_HOME'] = '/tmp/from-the-shell';
    try {
      expect(defaultEnvironment().home).toBe('/tmp/from-the-shell');
    } finally {
      if (previous === undefined) delete process.env['TYTO_HOME'];
      else process.env['TYTO_HOME'] = previous;
    }
  });
});
