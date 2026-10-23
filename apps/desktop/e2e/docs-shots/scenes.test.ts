import { describe, expect, it } from 'vitest';

import {
  LARGEST_WINDOW,
  SCENES,
  type Scene,
  parseOnly,
  sceneProblems,
  shotPath,
  shotsOf,
} from './scenes.js';

/**
 * The manual's scene list, held to its rules where nothing launches (TYTO-315).
 *
 * The runner is not in `pnpm check` and no workflow runs it, so a scene that would be cut to
 * the display, or that proves its language with a word both languages share, would only be
 * found by somebody looking at a picture. These rules are what can be checked without one.
 */

const scene = (overrides: Partial<Scene>): Scene => ({ ...SCENES[0]!, ...overrides });

describe('the scene list', () => {
  it('breaks none of its rules', () => {
    expect(sceneProblems(SCENES)).toEqual([]);
  });

  it('has the five scenes the card names, and the preview’s two modes (TYTO-323)', () => {
    expect(SCENES.map((each) => each.name)).toEqual([
      'window-tour',
      'command-bar-open',
      'problems-panel',
      'export-dialog',
      'settings-tab',
      'preview-strip',
      'preview-all-slides',
    ]);
  });

  it('refuses a window larger than the CI display, which would come back cut', () => {
    const tall = scene({ name: 'tall', size: { width: 1080, height: LARGEST_WINDOW.height + 1 } });
    expect(sceneProblems([tall])).toEqual([
      "'tall' asks for 1080x1025, larger than 1280x1024: it would be cut to the display",
    ]);
  });

  it('refuses a proof that reads the same in both languages', () => {
    const same = scene({ name: 'same', proof: { selector: '.x', key: 'template.label' } });
    expect(sceneProblems([same])).toHaveLength(1);
    expect(sceneProblems([same])[0]).toContain('proves nothing');
  });

  it('refuses a name twice and a name that is not a file name', () => {
    expect(sceneProblems([scene({ name: 'a' }), scene({ name: 'a' })])).toEqual([
      "'a' is declared twice",
    ]);
    expect(sceneProblems([scene({ name: 'Window Tour' })])).toEqual([
      "'Window Tour' is not a kebab-case file name",
    ]);
  });
});

describe('the pictures', () => {
  it('are every scene in both languages and both themes: four each', () => {
    const paths = shotsOf(SCENES).map(shotPath);
    expect(paths).toHaveLength(SCENES.length * 4);
    expect(new Set(paths).size).toBe(paths.length);
    expect(shotsOf(SCENES, ['settings-tab']).map(shotPath)).toEqual([
      'en/settings-tab-tyto-light.png',
      'en/settings-tab-tyto-dark.png',
      'pt-BR/settings-tab-tyto-light.png',
      'pt-BR/settings-tab-tyto-dark.png',
    ]);
  });

  it('fails on a scene name nobody declared, rather than taking none', () => {
    expect(() => shotsOf(SCENES, ['window-tuor'])).toThrow("no scene is named 'window-tuor'");
  });

  it('reads TYTO_SHOTS_ONLY as names separated by commas', () => {
    expect(parseOnly(undefined)).toEqual([]);
    expect(parseOnly('')).toEqual([]);
    expect(parseOnly(' window-tour, settings-tab ,')).toEqual(['window-tour', 'settings-tab']);
  });
});
