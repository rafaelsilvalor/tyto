import { measureNothing, noBrandKit } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { productBanner } from './banner.js';
import { oneInk } from './kit.js';

import type { AssetRef, SceneNode, TemplateFiles, TemplateReport } from '@tyto/core';

/**
 * A banner whose background is missing says so (TYTO-502): a template repository that loses
 * or misnames `assets/bg-<format>.png` used to ship a banner on plain paper with no word.
 */

const SIZES: Record<string, { w: number; h: number }> = {
  banner: { w: 1200, h: 628 },
  'banner-1x1': { w: 600, h: 600 },
};

/** A folder holding the background of `banner` only: `banner-1x1`'s is the one removed. */
const folder: TemplateFiles = {
  svg: () => undefined,
  image: (path): AssetRef | undefined =>
    path === 'assets/bg-banner.png'
      ? { id: 'bg-banner', source: 'file', path, hash: 'sha256-banner' }
      : undefined,
};

const build = productBanner({ ink: '#000000', markInks: oneInk('#000000'), layouts: {} });

function render(format: string): { names: string[]; reports: TemplateReport[] } {
  const reports: TemplateReport[] = [];
  const frame = build({
    format,
    size: SIZES[format]!,
    idPrefix: `artwork-0-${format}`,
    artwork: { id: 'artwork-0', index: 0, count: 1 },
    slots: {
      titulo: {
        name: 'titulo',
        value: {
          kind: 'rich-text',
          text: [{ kind: 'text', value: 'Vale Alto', range: { start: 0, end: 9 } }],
        },
        adjustments: [],
      },
    },
    adjustments: {},
    measure: measureNothing,
    report: (report) => reports.push(report),
    files: folder,
    brand: noBrandKit,
  });
  const names = frame.children.map((child: SceneNode) => child.name ?? child.kind);
  return { names, reports };
}

describe('productBanner without a background', () => {
  it('reports the missing file for its format and still draws the text', () => {
    const { names, reports } = render('banner-1x1');

    expect(reports).toEqual([
      { code: 'W_TEMPLATE_FILE_MISSING', path: 'assets/bg-banner-1x1.png' },
    ]);
    expect(names).not.toContain('background');
    expect(names).toContain('titulo');
  });

  it('says nothing for a format whose background is there, which is the control', () => {
    const { names, reports } = render('banner');

    expect(reports).toEqual([]);
    expect(names).toContain('background');
  });
});
