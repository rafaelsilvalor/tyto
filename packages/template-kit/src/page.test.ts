import { rect } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { sized } from './blocks.js';
import { bandedPage } from './page.js';

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
