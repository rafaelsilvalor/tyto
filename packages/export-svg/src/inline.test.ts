import { describe, expect, it } from 'vitest';

import { fitTransform, readInlineSvg } from './inline.js';

/**
 * The arithmetic the nested viewport used to do, now that this package does it.
 *
 * Tested here rather than only through the fixtures because the one inline SVG in them is
 * a 24×24 file on a 48×48 node — square on square, where fitting by the wider axis and
 * fitting by the narrower one give the same answer, and where the centring offset is zero.
 * Every case that could tell a right implementation from a plausible one is a shape no
 * fixture has, so the shapes are here instead.
 */

const box = (
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } => ({ x, y, w, h });

describe('an inline SVG is placed the way its viewport would have placed it', () => {
  it('scales a square file onto a square node', () => {
    expect(fitTransform(box(0, 0, 24, 24), { w: 48, h: 48 })).toBe('scale(2)');
  });

  it('fits by the narrower axis and centres the remainder, as xMidYMid meet does', () => {
    // 100×50 onto 200×200: fitting by width gives 2 and by height gives 4. A viewport
    // takes the smaller, draws 200×100, and puts the leftover 100 evenly above and below.
    expect(fitTransform(box(0, 0, 100, 50), { w: 200, h: 200 })).toBe('translate(0 50) scale(2)');
  });

  it('honours a viewBox that does not start at the origin', () => {
    // `-10 -5 20 10` onto 40×20: scale 2, and the origin moves so that (-10, -5) lands at
    // the node's top-left rather than 10 units outside it.
    expect(fitTransform(box(-10, -5, 20, 10), { w: 40, h: 20 })).toBe('translate(20 10) scale(2)');
  });

  it('emits nothing when the file is already the node’s size', () => {
    // An attribute that says `scale(1)` is markup a reader has to check and discard.
    expect(fitTransform(box(0, 0, 48, 48), { w: 48, h: 48 })).toBeUndefined();
  });
});

describe('a file is read far enough to place it, and no further', () => {
  it('hands back the root’s children exactly as they were written', () => {
    const file = readInlineSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
        '<circle cx="12" cy="12" r="10"/></svg>',
    );

    expect(file?.content).toBe('<circle cx="12" cy="12" r="10"/>');
    expect(file?.box).toEqual({ x: 0, y: 0, w: 24, h: 24 });
  });

  it('carries prefixed namespaces onto the group, because the element that bound them goes', () => {
    const file = readInlineSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
        'viewBox=\'0 0 10 10\'><use xlink:href="#a"/></svg>',
    );

    expect(file?.namespaces).toBe(' xmlns:xlink="http://www.w3.org/1999/xlink"');
    // The default one is not carried: the document this lands in is already SVG.
    expect(file?.namespaces).not.toContain('xmlns="http');
  });

  it('falls back to width and height when the file states no viewBox', () => {
    const file = readInlineSvg(
      '<svg width="30px" height="15"><rect width="30" height="15"/></svg>',
    );

    expect(file?.box).toEqual({ x: 0, y: 0, w: 30, h: 15 });
  });

  it('states no box rather than inventing one', () => {
    // Reported by the caller as `W_EXPORT_APPROXIMATED`: the node declared a size and the
    // file gave nothing to scale from, so the coordinates are drawn as they stand.
    expect(readInlineSvg('<svg><path d="M0 0"/></svg>')?.box).toBeUndefined();
    expect(
      readInlineSvg('<svg viewBox="0 0 nonsense 4"><path d="M0 0"/></svg>')?.box,
    ).toBeUndefined();
    expect(readInlineSvg('<svg viewBox="0 0 0 10"><path d="M0 0"/></svg>')?.box).toBeUndefined();
  });

  it('answers nothing for markup whose root is not an svg', () => {
    expect(readInlineSvg('<path d="M0 0"/>')).toBeUndefined();
  });
});
