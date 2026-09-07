import { describe, expect, it } from 'vitest';

import assetNotDeclared from './__fixtures__/invalid-asset-not-declared.json';
import duplicateId from './__fixtures__/invalid-duplicate-id.json';
import emptyText from './__fixtures__/invalid-empty-text.json';
import fontNotDeclared from './__fixtures__/invalid-font-not-declared.json';
import maskDescendant from './__fixtures__/invalid-mask-descendant.json';
import maskNotFound from './__fixtures__/invalid-mask-not-found.json';
import onlyBreaks from './__fixtures__/invalid-only-breaks.json';
import invalidShape from './__fixtures__/invalid-shape.json';
import validLineBreaks from './__fixtures__/valid-line-breaks.json';
import validPromo from './__fixtures__/valid-promo.json';
import { identityTransform } from './primitives.js';
import { isScene, parseScene, sceneSchema } from './scene.js';
import type { DiagnosticCode } from '../diagnostics/codes.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';

/**
 * One fixture per invariant, because the invariants are the part of the IR a type cannot
 * hold up: a scene where every field has the right shape can still mask itself with its
 * own child. Each case asserts the code *and* that the message names the node, since an
 * id the author can search for is the whole reason these checks exist.
 */
const codes = (items: readonly Diagnostic[]): DiagnosticCode[] => items.map((item) => item.code);

function errorsOf(input: unknown): readonly Diagnostic[] {
  const result = parseScene(input);
  if (result.ok) throw new Error('expected the scene to be rejected, it parsed');
  return result.error;
}

describe('a valid scene', () => {
  it('parses', () => {
    const result = parseScene(validPromo);
    if (!result.ok) throw new Error(`expected ok, got: ${codes(result.error).join(', ')}`);

    expect(result.value.artworks).toHaveLength(1);
    expect(result.value.artworks[0]?.frames.map((frame) => frame.format)).toEqual([
      'feed',
      'story',
    ]);
  });

  it('reports no warnings, because nothing in the IR is merely suspicious yet', () => {
    const result = parseScene(validPromo);
    expect(result.ok && result.warnings).toEqual([]);
  });

  it('fills the defaults so an exporter never has to', () => {
    const result = parseScene(validPromo);
    if (!result.ok) throw new Error('fixture should parse');

    const image = result.value.artworks[0]?.frames[0]?.children.find(
      (node) => node.id === 'hero-image',
    );

    expect(image?.transform).toEqual(identityTransform);
    expect(image?.opacity).toBe(1);
    expect(image?.blend).toBe('normal');
    expect(image?.visible).toBe(true);
    expect(image?.clip).toBe(false);
    expect(image?.effects).toEqual([]);
  });

  it('keeps a transform the scene did state, filling only what it left out', () => {
    const result = parseScene(validPromo);
    if (!result.ok) throw new Error('fixture should parse');

    const group = result.value.artworks[0]?.frames[0]?.children.find((node) => node.id === 'copy');
    expect(group?.transform).toEqual({ ...identityTransform, y: 660 });
  });

  it('is recognised by isScene', () => {
    expect(isScene(validPromo)).toBe(true);
    expect(isScene({ version: 2, artworks: [] })).toBe(false);
  });
});

describe('shape', () => {
  it('rejects a wrong type and an unknown key, naming both paths', () => {
    const errors = errorsOf(invalidShape);

    expect(codes(errors).every((code) => code === 'E_SCENE_SHAPE')).toBe(true);
    const messages = errors.map((item) => item.message).join('\n');
    expect(messages).toContain('artworks.0.frames.0.size.h');
    expect(messages).toContain('opacty');
  });

  it('strips nothing: an unknown key is an error, not something to drop silently', () => {
    const result = sceneSchema.safeParse({ version: 1, artworks: [], surprise: true });
    expect(result.success).toBe(false);
  });
});

describe('invariants', () => {
  it('rejects a repeated id and says how many times it appears', () => {
    const errors = errorsOf(duplicateId);

    expect(codes(errors)).toEqual(['E_SCENE_DUPLICATE_ID']);
    expect(errors[0]?.message).toContain("'twice'");
    expect(errors[0]?.message).toContain('2 times');
  });

  it('rejects a mask pointing at a node that does not exist', () => {
    const errors = errorsOf(maskNotFound);

    expect(codes(errors)).toEqual(['E_SCENE_MASK_NOT_FOUND']);
    expect(errors[0]?.message).toContain("'masked'");
    expect(errors[0]?.message).toContain("'ghost'");
  });

  it('rejects a mask pointing at a descendant of the node it masks', () => {
    const errors = errorsOf(maskDescendant);

    expect(codes(errors)).toEqual(['E_SCENE_MASK_DESCENDANT']);
    expect(errors[0]?.message).toContain("'wrapper'");
    expect(errors[0]?.message).toContain("'inner'");
  });

  it('rejects a font family the scene never declared', () => {
    const errors = errorsOf(fontNotDeclared);

    expect(codes(errors)).toEqual(['E_SCENE_FONT_NOT_DECLARED']);
    expect(errors[0]?.message).toContain("'headline'");
    expect(errors[0]?.message).toContain('Neverbundled');
  });

  it('rejects an asset the scene never declared', () => {
    const errors = errorsOf(assetNotDeclared);

    expect(codes(errors)).toEqual(['E_SCENE_ASSET_NOT_DECLARED']);
    expect(errors[0]?.message).toContain("'photo'");
    expect(errors[0]?.message).toContain("'absent'");
  });

  it('rejects a text node with no runs', () => {
    const errors = errorsOf(emptyText);

    expect(codes(errors)).toEqual(['E_SCENE_EMPTY_TEXT']);
    expect(errors[0]?.message).toContain("'silent'");
  });

  it('rejects a text node whose runs are all line breaks', () => {
    // Breaks draw exactly as much as no runs at all, so the rule that caught the second
    // catches the first: it asks for a span, not for a length (ADR 0016).
    const errors = errorsOf(onlyBreaks);

    expect(codes(errors)).toEqual(['E_SCENE_EMPTY_TEXT']);
    expect(errors[0]?.message).toContain("'so-quebras'");
  });

  it('reports every problem in one pass rather than the first one repeatedly', () => {
    const scene = {
      version: 1,
      artworks: [
        {
          id: 'slide-1',
          frames: [
            {
              format: 'feed',
              size: { w: 100, h: 100 },
              children: [
                {
                  kind: 'text',
                  id: 'same',
                  box: {},
                  align: 'left',
                  valign: 'top',
                  lineHeight: 1.2,
                  overflow: 'clip',
                  runs: [],
                },
                {
                  kind: 'rect',
                  id: 'same',
                  size: { w: 1, h: 1 },
                  radius: [0, 0, 0, 0],
                  mask: { nodeId: 'nowhere', mode: 'alpha' },
                },
              ],
            },
          ],
        },
      ],
    };

    expect([...codes(errorsOf(scene))].sort()).toEqual([
      'E_SCENE_DUPLICATE_ID',
      'E_SCENE_EMPTY_TEXT',
      'E_SCENE_MASK_NOT_FOUND',
    ]);
  });

  it('catches an undeclared asset behind an image paint, not only an image node', () => {
    // A solid or a gradient needs nothing declared; an image paint is an asset reference
    // wearing a different name, and the exporters have to resolve it just the same.
    const scene = {
      version: 1,
      artworks: [
        {
          id: 'slide-1',
          frames: [
            {
              format: 'feed',
              size: { w: 100, h: 100 },
              children: [
                {
                  kind: 'rect',
                  id: 'painted',
                  size: { w: 1, h: 1 },
                  radius: [0, 0, 0, 0],
                  fill: {
                    kind: 'image',
                    asset: { id: 'unlisted', source: 'file', path: 'x.png', hash: 'sha256-xx' },
                    fit: 'cover',
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const errors = errorsOf(scene);
    expect(codes(errors)).toEqual(['E_SCENE_ASSET_NOT_DECLARED']);
    expect(errors[0]?.message).toContain("'unlisted'");
  });

  it('blames the artwork and the format when the undeclared asset is a frame background', () => {
    const scene = {
      version: 1,
      artworks: [
        {
          id: 'slide-1',
          frames: [
            {
              format: 'story',
              size: { w: 100, h: 100 },
              background: {
                kind: 'image',
                asset: { id: 'unlisted', source: 'file', path: 'x.png', hash: 'sha256-xx' },
                fit: 'cover',
              },
              children: [],
            },
          ],
        },
      ],
    };

    expect(errorsOf(scene)[0]?.message).toContain("'slide-1:story'");
  });

  it('treats artwork ids and node ids as one id space', () => {
    const scene = {
      version: 1,
      artworks: [
        {
          id: 'shared',
          frames: [
            {
              format: 'feed',
              size: { w: 100, h: 100 },
              children: [
                { kind: 'rect', id: 'shared', size: { w: 1, h: 1 }, radius: [0, 0, 0, 0] },
              ],
            },
          ],
        },
      ],
    };

    expect(codes(errorsOf(scene))).toEqual(['E_SCENE_DUPLICATE_ID']);
  });
});

describe('line breaks in a run list (ADR 0016)', () => {
  it('accepts one leading, one trailing and two in a row', () => {
    // An empty line is a thing an author asks for, and the brief language produces all
    // three shapes. The IR records what was asked for; whether it fits is E4.5's question.
    const parsed = parseScene(validLineBreaks);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const node = parsed.value.artworks[0]?.frames[0]?.children[0];
      expect(node?.kind).toBe('text');
      expect(node?.kind === 'text' && node.runs.map((run) => run.kind)).toEqual([
        'break',
        'text',
        'break',
        'break',
        'text',
        'break',
      ]);
    }
  });

  it('gives a break no fields to carry, because it has no glyph', () => {
    const withExtras = {
      version: 1,
      fonts: [{ family: 'Inter', source: 'bundled' }],
      artworks: [
        {
          id: 'a',
          frames: [
            {
              format: 'feed',
              size: { w: 10, h: 10 },
              children: [
                {
                  kind: 'text',
                  id: 't',
                  box: {},
                  align: 'left',
                  valign: 'top',
                  lineHeight: 1.2,
                  overflow: 'clip',
                  runs: [{ kind: 'break', size: 12 }],
                },
              ],
            },
          ],
        },
      ],
    };

    const parsed = parseScene(withExtras);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error[0]?.code).toBe('E_SCENE_SHAPE');
  });

  it('tells a reader which member of the union was wrong, not both', () => {
    // The point of tagging: Zod reports against the `break` branch alone, rather than
    // complaining that a break is missing `font`, `size`, `weight`, `style` and `color`.
    const parsed = parseScene({
      version: 1,
      artworks: [
        {
          id: 'a',
          frames: [
            {
              format: 'feed',
              size: { w: 10, h: 10 },
              children: [
                {
                  kind: 'text',
                  id: 't',
                  box: {},
                  align: 'left',
                  valign: 'top',
                  lineHeight: 1.2,
                  overflow: 'clip',
                  runs: [{ kind: 'quebra' }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toHaveLength(1);
      expect(parsed.error[0]?.message).toContain('runs.0');
    }
  });
});
