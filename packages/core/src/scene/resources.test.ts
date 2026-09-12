import { describe, expect, it } from 'vitest';

import validPromo from './__fixtures__/valid-promo.json';
import type { Scene } from './scene.js';
import { parseScene } from './scene.js';
import { fontFaceKey, sceneResources } from './resources.js';

/**
 * `sceneResources` is the answer to a question that used to have no place to be asked: a
 * loader needs to know what a scene draws, and only a scene knows. So the tests are about
 * completeness — a reference this misses is a file nobody loads and a glyph nobody draws —
 * and about deduplication, because the same logo on twelve frames is one read.
 */

function sceneOf(input: unknown): Scene {
  const result = parseScene(input);
  if (!result.ok)
    throw new Error(`fixture should parse: ${result.error.map((item) => item.code).join()}`);
  return result.value;
}

const promo = sceneOf(validPromo);

/**
 * A scene built by hand, for references the shipped fixture does not happen to contain.
 *
 * The overrides are loose on purpose: `parseScene` takes `unknown` and is the thing under
 * test at the boundary, so typing the literal as a `Scene` would check it twice at compile
 * time and prove less at run time.
 */
function sceneWith(overrides: Record<string, unknown>): Scene {
  return sceneOf({
    version: 1,
    fonts: [],
    assets: [],
    artworks: [],
    ...overrides,
  });
}

const HERO = { id: 'hero', source: 'file', path: 'hero.jpg', hash: 'sha256-1f0a' } as const;
const LOGO = { id: 'logo', source: 'file', path: 'logo.png', hash: 'sha256-b2' } as const;

describe('what a scene asks the outside world for', () => {
  it('lists the assets the shipped fixture declares and draws', () => {
    expect(sceneResources(promo).assets.map((ref) => ref.id)).toEqual(['hero']);
  });

  it('lists a declared font as a face, at the weight and style a run would default to', () => {
    // `Scene.fonts` names a family and nothing else — there is no run behind a declaration
    // — so `400`/`normal` is what a `TextSpan` silent about both would carry.
    expect(sceneResources(promo).faces).toContainEqual({
      font: { family: 'Inter', source: 'bundled' },
      weight: 400,
      style: 'normal',
    });
  });

  it('finds an asset used only as a frame background, which is not a node', () => {
    const scene = sceneWith({
      assets: [LOGO],
      artworks: [
        {
          id: 'a',
          frames: [
            {
              format: 'feed',
              size: { w: 10, h: 10 },
              background: { kind: 'image', asset: LOGO, fit: 'cover' },
              children: [],
            },
          ],
        },
      ],
    });

    expect(sceneResources(scene).assets.map((ref) => ref.id)).toEqual(['logo']);
  });

  it('counts one asset once however many frames draw it', () => {
    const image = (id: string) => ({
      kind: 'image',
      id,
      asset: HERO,
      size: { w: 10, h: 10 },
      fit: 'cover',
    });
    // Ids are unique across the whole scene, which an invariant enforces, so each of the
    // six references is its own node — and all six point at one file.
    const frame = (artwork: string, format: string) => ({
      format,
      size: { w: 10, h: 10 },
      children: [image(`${artwork}-${format}-1`), image(`${artwork}-${format}-2`)],
    });
    const scene = sceneWith({
      assets: [HERO],
      artworks: [
        { id: 'a', frames: [frame('a', 'feed'), frame('a', 'story')] },
        { id: 'b', frames: [frame('b', 'wide')] },
      ],
    });

    // Six references, one file: a loader that read it six times would be the bug this
    // enumeration exists to make impossible.
    expect(sceneResources(scene).assets).toHaveLength(1);
    expect(sceneResources(scene).assets[0]?.id).toBe('hero');
  });
});

describe('the face key', () => {
  const inter = { family: 'Inter', source: 'bundled' } as const;

  it('separates two weights of one family, which are two files', () => {
    expect(fontFaceKey({ font: inter, weight: 400, style: 'normal' })).not.toBe(
      fontFaceKey({ font: inter, weight: 700, style: 'normal' }),
    );
  });

  it('separates italic from upright, which a synthesised slant is not', () => {
    expect(fontFaceKey({ font: inter, weight: 400, style: 'normal' })).not.toBe(
      fontFaceKey({ font: inter, weight: 400, style: 'italic' }),
    );
  });

  it('separates one family name coming from two places', () => {
    // A bundled Inter and an Inter in the brief's folder are two designs with one name.
    // Collapsing them would load one and draw the other, silently.
    expect(fontFaceKey({ font: inter, weight: 400, style: 'normal' })).not.toBe(
      fontFaceKey({
        font: { family: 'Inter', source: 'file', path: './Inter.ttf' },
        weight: 400,
        style: 'normal',
      }),
    );
  });
});
