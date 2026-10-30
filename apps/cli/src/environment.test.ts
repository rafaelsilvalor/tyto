import { launchPluginProcess } from '@tyto/command-line';
import { describe, expect, it } from 'vitest';

import { defaultEnvironment, defaultRasterizer, tytoHome } from './environment.js';

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

/**
 * The two ports a window fills differently (ADR 0159). The command tree chooses neither, so a
 * terminal that forgot one would start no plugin or raster nothing, and only here is it said.
 */
describe('defaultEnvironment', () => {
  it("starts a plugin's process with the terminal's fork launcher", () => {
    expect(defaultEnvironment().launch).toBe(launchPluginProcess);
  });

  it("rasters through Playwright's Chromium", () => {
    expect(defaultEnvironment().rasterizer).toBe(defaultRasterizer);
  });
});
