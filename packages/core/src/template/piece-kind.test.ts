import { describe, expect, it } from 'vitest';

import { type FormatKind } from '../config/formats.js';
import { pieceKinds } from './piece-kind.js';

import type { TemplateManifest } from './manifest.js';

/**
 * A piece kind is derived from two facts that already have a home — the format's canvas kind
 * and whether the manifest repeats — so these cases are the table `docs/format-kinds.md`
 * prints, one row each.
 */

const catalogue = (kinds: Record<string, FormatKind | undefined>) => ({
  kindOf: (id: string) => kinds[id],
});

const KINDS = catalogue({ grid: 'grid', 'grid-1x1': 'grid', story: 'story', banner: 'banner' });

const slot = (repeat: boolean) =>
  ({ type: 'rich-text', repeat, required: false }) as TemplateManifest['slots'][string];

const manifest = (formats: string[], repeats: boolean) => ({
  formats,
  slots: { titulo: slot(false), ...(repeats ? { lamina: slot(true) } : {}) },
});

describe('pieceKinds', () => {
  it('reads a grid that does not repeat as a grid, and one that does as a carrossel', () => {
    expect(pieceKinds(manifest(['grid'], false), KINDS)).toEqual([
      { format: 'grid', kind: 'grid', sequence: false },
    ]);
    expect(pieceKinds(manifest(['grid'], true), KINDS)).toEqual([
      { format: 'grid', kind: 'carrossel', sequence: true },
    ]);
  });

  it('reads a story as a story, and a repeating one as stories', () => {
    expect(pieceKinds(manifest(['story'], false), KINDS)[0]?.kind).toBe('story');
    expect(pieceKinds(manifest(['story'], true), KINDS)[0]?.kind).toBe('stories');
  });

  it('answers one entry per declared format, in the manifest’s order', () => {
    expect(
      pieceKinds(manifest(['grid-1x1', 'story'], true), KINDS).map((each) => each.kind),
    ).toEqual(['carrossel', 'stories']);
  });

  it('keeps the canvas kind for a sequence nobody has named, and says it repeats', () => {
    expect(pieceKinds(manifest(['banner'], true), KINDS)).toEqual([
      { format: 'banner', kind: 'banner', sequence: true },
    ]);
  });

  it('answers no kind for a format whose project did not declare one', () => {
    expect(pieceKinds(manifest(['legacy'], false), KINDS)).toEqual([
      { format: 'legacy', sequence: false },
    ]);
  });
});
