import { rect } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { sized } from './blocks.js';
import { bandedPage, reportOverflow, sealed } from './page.js';

import type { TemplateReport } from '@tyto/core';

/** Where the three bands land: arithmetic, as everything else in this package is tested. */

const box = (w: number, h: number, name: string) => sized(rect({ name, size: { w, h } }));

const page = (middleHeight: number) =>
  bandedPage({
    size: { w: 1000, h: 1000 },
    edges: { top: 50, bottom: 30, side: 70 },
    header: { item: box(40, 60, 'header'), band: 80 },
    footer: box(860, 90, 'footer'),
    middle: box(860, middleHeight, 'middle'),
  }).map((node) => ({ name: node.name, x: node.transform.x, y: node.transform.y }));

describe('bandedPage', () => {
  it('centres the header in its band and stands the footer on the bottom edge', () => {
    const [header, , footer] = page(100);

    expect(header).toEqual({ name: 'header', x: 70, y: 50 + 10 });
    expect(footer).toEqual({ name: 'footer', x: 70, y: 1000 - 30 - 90 });
  });

  it('centres the middle in the room between the bands', () => {
    // Room: 130 to 880, 750 tall; a middle of 350 leaves 200 above and below.
    expect(page(350)[1]).toEqual({ name: 'middle', x: 70, y: 130 + 200 });
  });

  it('pins a middle taller than the room under the header rather than over it', () => {
    expect(page(900)[1]?.y).toBe(130);
  });
});

describe('sealed', () => {
  const SIZE = { w: 1080, h: 1350 };
  const asset = { id: 'selo', source: 'file' as const, path: 'selo.png', hash: 'abc' };

  it('hands the layout the whole frame and draws nothing when there is no seal', () => {
    expect(sealed(SIZE, undefined)).toEqual({ size: SIZE, seal: [] });
  });

  it('shrinks the page by the seal’s height, so nothing is laid out under it', () => {
    expect(sealed(SIZE, { asset, height: 140 }).size).toEqual({ w: 1080, h: 1210 });
  });

  it('glues the seal to the foot of the frame, the frame’s width, covering its band', () => {
    const [placed] = sealed(SIZE, { asset, height: 140 }).seal;

    expect(placed?.transform).toMatchObject({ x: 0, y: 1210 });
    expect(placed).toMatchObject({
      kind: 'image',
      name: 'seal',
      size: { w: 1080, h: 140 },
      fit: 'cover',
      asset,
    });
  });
});

describe('reportOverflow (TYTO-202)', () => {
  const reportsFor = (bottom: number, limit: number): TemplateReport[] => {
    const reports: TemplateReport[] = [];
    reportOverflow(
      (report) => {
        reports.push(report);
      },
      bottom,
      limit,
    );
    return reports;
  };

  it('reports how far the foot lands below the limit', () => {
    expect(reportsFor(1390, 1350)).toEqual([{ code: 'W_TEMPLATE_OVERFLOW', overflow: 40 }]);
  });

  it('says nothing for a foot on the limit or above it', () => {
    expect(reportsFor(1350, 1350)).toEqual([]);
    expect(reportsFor(900, 1350)).toEqual([]);
  });
});
