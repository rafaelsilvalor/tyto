import { describe, expect, it } from 'vitest';

import packageManifest from '../package.json';
import { PLUGIN_API_VERSION, satisfiesEngine } from './engine.js';

/**
 * The engine check (ADR 0039). Every row is a range the manifest schema accepts, because
 * those are the only ones a loader will ever be handed.
 */

describe('PLUGIN_API_VERSION', () => {
  it("is this package's own version, so a Changesets bump moves it too", () => {
    expect(PLUGIN_API_VERSION).toBe(packageManifest.version);
  });
});

describe('satisfiesEngine', () => {
  it.each([
    ['>=0.1', '0.3.9', true],
    ['>=0.4', '0.3.9', false],
    ['>0.3.9', '0.3.9', false],
    ['<1', '0.3.9', true],
    ['<=0.3.9', '0.3.9', true],
    ['<0.3.9', '0.3.9', false],
    ['0.3.9', '0.3.9', true],
    ['=0.3', '0.3.9', true],
    ['=0.4', '0.3.9', false],
    // Caret below 1.0 holds the minor still, as npm reads it.
    ['^0.3.1', '0.3.9', true],
    ['^0.3.1', '0.4.0', false],
    ['^0.0.3', '0.0.4', false],
    ['^1.2', '1.9.0', true],
    ['^1.2', '2.0.0', false],
    ['~0.3.1', '0.3.9', true],
    ['~0.3.1', '0.4.0', false],
    ['~1', '1.9.9', true],
    ['>=99 || ^0.3', '0.3.9', true],
    ['>=99 || ^0.4', '0.3.9', false],
  ])('%s against %s is %s', (range, version, expected) => {
    expect(satisfiesEngine(range, version)).toBe(expected);
  });

  it('counts a prerelease host as its release', () => {
    expect(satisfiesEngine('>=0.4', '0.4.0-beta.1')).toBe(true);
  });

  it('answers false for a range it cannot read rather than throwing', () => {
    expect(satisfiesEngine('lates', '0.3.9')).toBe(false);
    expect(satisfiesEngine('>=0.1', 'banana')).toBe(false);
  });
});
