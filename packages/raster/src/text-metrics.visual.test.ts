import type { Scene, TextNode, TextSpan } from '@tyto/core';
import { createFaceCache, measureText, parseScene } from '@tyto/core';
import { exportHtml } from '@tyto/export-html';
import { exportSvg } from '@tyto/export-svg';
import { htmlTestFont, svgTestFont, testFontSource } from '@tyto/test-fonts';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DETERMINISM_ARGS } from './playwright.js';

import textFixture from './__fixtures__/text.json';

/**
 * What the leading actually is once a browser has laid the text out.
 *
 * The rest of the visual suite compares pixels, which answers "did the artwork change"
 * and not "is it the number the IR asked for". This file asks the second question, of the
 * one property that was silently wrong until TYTO-65: `lineHeight`.
 *
 * ## The strut, and why a CSS string could not have caught this
 *
 * A block's line box is at least as tall as its **strut** — an invisible box carrying the
 * block's own font and `line-height`. `export-html` wrote `line-height: 1.45` on the node
 * and `font-size: 15px` on the run's span, and the node declared no font at all, so its
 * strut was the document default: **Times New Roman at 16px**. Measured on this fixture's
 * `body` node before the fix, against `lineHeight: 1.45` over a single 15px run:
 *
 * ```
 *            node computed          span computed        line tops     advance
 * before   16px / 23.2px / Times   15px / 21.75px / SS3   202, 225.75    23.75
 * after    15px / 21.75px / SS3    15px / 21.75px / SS3   200, 221.75    21.75
 * ```
 *
 * 21.75 is `1.45 × 15`, which is what `docs/ir-schema.md` means by "a multiplier of the
 * run's font size". The 2px of wrong leading per line came from a font nobody bundled at a
 * size nobody chose, and **the CSS string looked correct the whole time** — `line-height:
 * 1.45` is exactly what the IR said. That is why this test reads geometry out of a live
 * layout rather than asserting on the document, and why the card refused to accept a
 * snapshot as evidence.
 */

const FIXTURE = textFixture;

/**
 * The slice of the DOM the two `page.evaluate` bodies below use.
 *
 * `raster` is a Node package: `tsconfig.node.json` gives it no DOM lib and `eslint.config.js`
 * forbids the `window` and `document` globals outright (ADR 0010). Both are right — this
 * package must not touch a DOM — and neither applies to a function that is serialised and
 * run *inside Chromium*, which is the only place these names exist. Declaring the four
 * members used, and reaching them through `globalThis`, keeps the boundary rule meaning
 * what it says instead of being switched off for the file.
 */
interface BrowserWindow {
  readonly document: {
    getElementById(id: string): BrowserElement | null;
    createRange(): {
      selectNodeContents(node: BrowserElement): void;
      getClientRects(): Iterable<{ top: number }>;
    };
    readonly fonts: { readonly ready: Promise<unknown> };
  };
  getComputedStyle(element: BrowserElement): {
    readonly fontSize: string;
    readonly fontFamily: string;
    readonly lineHeight: string;
  };
}

interface BrowserElement {
  readonly firstElementChild: BrowserElement | null;
  getBoundingClientRect(): { height: number };
}

/** Every text node of the fixture's first frame, which is the only frame it has. */
function textNodes(scene: Scene): readonly TextNode[] {
  const frame = scene.artworks[0]?.frames[0];
  if (frame === undefined) throw new Error('The text fixture has no frames.');
  return frame.children.filter((child): child is TextNode => child.kind === 'text');
}

function sceneOf(): Scene {
  const parsed = parseScene(FIXTURE);
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

/** The run the strut is sized from: the largest, ties to the first. Mirrors `export-html`. */
function largestRun(node: TextNode): TextSpan {
  let largest: TextSpan | undefined;
  for (const run of node.runs) {
    if (run.kind !== 'text') continue;
    if (largest === undefined || run.size > largest.size) largest = run;
  }
  if (largest === undefined) throw new Error(`Text node '${node.id}' has no text run.`);
  return largest;
}

const scene = sceneOf();
const NODES = textNodes(scene);

let browser: Browser | undefined;
let documentHtml: string;

beforeAll(async () => {
  const exported = exportHtml(scene, { resources: { font: htmlTestFont } });
  if (!exported.ok) throw new Error(exported.error.map((item) => item.message).join('; '));
  const frame = exported.value[0];
  if (frame === undefined) throw new Error('The text fixture exported no frames.');
  documentHtml = frame.html;

  browser = await chromium.launch({ args: [...DETERMINISM_ARGS] });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

/**
 * The distance between the first and last line box of a node, and how many there are.
 *
 * `Range.getClientRects()` gives one rect per line box, which is the only way to see a
 * line the IR did not write — a wrap. Tops are de-duplicated because a range over nested
 * elements reports the same line more than once.
 */
async function linesOf(nodeId: string): Promise<{ tops: number[]; height: number }> {
  if (browser === undefined) throw new Error('No browser.');
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  try {
    await page.setContent(documentHtml);
    await page.evaluate(async () => {
      await (globalThis as unknown as BrowserWindow).document.fonts.ready;
    });
    return await page.evaluate((id) => {
      const win = globalThis as unknown as BrowserWindow;
      const element = win.document.getElementById(id);
      if (element === null) throw new Error(`No #${id} in the document.`);
      const inner = element.firstElementChild ?? element;
      const range = win.document.createRange();
      range.selectNodeContents(inner);
      const rounded = [...range.getClientRects()].map((rect) => Math.round(rect.top * 1000) / 1000);
      return {
        tops: [...new Set(rounded)].sort((left, right) => left - right),
        height: inner.getBoundingClientRect().height,
      };
    }, nodeId);
  } finally {
    await page.close();
  }
}

/** The three font properties the node's strut is built from, as the browser resolved them. */
async function computedFontOf(
  nodeId: string,
): Promise<{ fontSize: string; fontFamily: string; lineHeight: string }> {
  if (browser === undefined) throw new Error('No browser.');
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  try {
    await page.setContent(documentHtml);
    await page.evaluate(async () => {
      await (globalThis as unknown as BrowserWindow).document.fonts.ready;
    });
    return await page.evaluate((id) => {
      const win = globalThis as unknown as BrowserWindow;
      const element = win.document.getElementById(id);
      if (element === null) throw new Error(`No #${id} in the document.`);
      const style = win.getComputedStyle(element);
      return {
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        lineHeight: style.lineHeight,
      };
    }, nodeId);
  } finally {
    await page.close();
  }
}

describe('the leading a node declares is the leading it gets', () => {
  it.each(NODES.map((node) => [node.id, node] as const))(
    '%s advances by lineHeight × the largest run',
    async (id, node) => {
      const { tops } = await linesOf(id);
      const expected = node.lineHeight * largestRun(node).size;

      // A node that fits on one line proves nothing about advance; the fixture has two
      // that wrap or break, and this says so rather than passing quietly.
      if (tops.length < 2) {
        expect(tops).toHaveLength(1);
        return;
      }

      const advances = tops.slice(1).map((top, index) => top - tops[index]!);
      for (const advance of advances) {
        // 1/64 px is Chromium's LayoutUnit; anything inside it is the browser's own
        // rounding and anything outside it is a leading nobody asked for.
        expect(
          Math.abs(advance - expected),
          `${id}: advance ${String(advance)}px against ${String(expected)}px ` +
            `(lineHeight ${String(node.lineHeight)} × ${String(largestRun(node).size)}px)`,
        ).toBeLessThanOrEqual(1 / 64);
      }
    },
  );

  it.each(NODES.map((node) => [node.id, node] as const))(
    '%s builds its strut from the face it embeds, not the browser default',
    async (id, node) => {
      const computed = await computedFontOf(id);
      const run = largestRun(node);

      // The advance assertions above would also pass if a future edit replaced the strut
      // with a hard-coded length, and that would be right for this fixture and wrong for
      // the next one. This is the declaration that has to exist, read back from the live
      // layout rather than from the CSS string that looked correct while being wrong.
      expect(computed.fontSize).toBe(`${String(run.size)}px`);
      expect(computed.fontFamily).toContain(run.font.family);
      expect(computed.fontFamily).not.toContain('Times');
      // Parsed rather than compared as text: 1.1 × 56 is 61.60000000000001 in JS and
      // 61.6px in Chromium, and a string comparison would be testing IEEE 754.
      expect(Number.parseFloat(computed.lineHeight)).toBeCloseTo(node.lineHeight * run.size, 6);
    },
  );
});

/**
 * The acceptance criterion of E4.5, and the only place it can be checked.
 *
 * `core` measures text with fontkit and never launches anything; Chromium lays the same
 * text out and never sees `core`. If the two agree on how many lines there are and how tall
 * the block is, then a break decided in the IR is the break the raster will draw — which is
 * the whole premise of ADR 0019 moving wrapping out of the exporters.
 *
 * ±1px because Chromium rounds to a 1/64 LayoutUnit and snaps a glyph box's top to a whole
 * pixel, and the card asked for exactly that tolerance. In practice the fixture lands well
 * inside it; the assertion prints the measured pair either way, so a drift shows as a number
 * rather than as `expected true`.
 */
describe('the measurement in core against the browser', () => {
  const faces = createFaceCache(testFontSource);

  it.each(NODES.map((node) => [node.id, node] as const))(
    '%s: same line count and height as Chromium, within 1px',
    async (id, node) => {
      const measured = measureText(node, faces);
      if (measured === undefined) throw new Error(`Nothing could measure '${id}'.`);

      const { tops, height } = await linesOf(id);

      expect(
        measured.lines,
        `${id}: measured ${String(measured.lines)} lines, browser laid out ${String(tops.length)}`,
      ).toBe(tops.length);
      expect(
        Math.abs(measured.height - height),
        `${id}: measured ${measured.height.toFixed(4)}px tall, browser ${height.toFixed(4)}px`,
      ).toBeLessThanOrEqual(1);
    },
  );

  it('breaks the body paragraph where the browser breaks it', async () => {
    const body = NODES.find((item) => item.id === 'body');
    if (body === undefined) throw new Error('The fixture lost its body node.');

    const measured = measureText(body, faces);
    if (measured === undefined) throw new Error('Nothing could measure the body.');

    // Not just the count: the same *words* on each line. A measurement that wrapped one
    // word early would still report two lines and still be wrong.
    const lines: string[] = [''];
    for (const run of measured.runs) {
      if (run.kind === 'break') lines.push('');
      else lines[lines.length - 1] += run.text;
    }

    expect(lines).toEqual([
      'Inscrições abertas até o dia 30. Aulas ao vivo, material',
      'incluso e certificado ao final do curso.',
    ]);
  });
});

describe('export-svg', () => {
  it('is untouched by the strut, because it places every baseline itself', () => {
    // ADR 0019: an SVG's baselines are numbers that exporter computes, and no strut is
    // involved — so nothing here changed with `export-html`. Checked rather than assumed,
    // as the card asked.
    //
    // The two do disagree on one case, and it is written down rather than left to be
    // found: a node whose runs differ in size gets one leading in HTML (from the largest
    // run, which is what a strut is) and a per-line leading in SVG. `docs/ir-schema.md`
    // records it beside ADR 0019's wrapping limit, and E4.5 closes both at once by
    // deciding the lines in the IR. Every node in this fixture has one size, so both
    // exporters agree on all of them.
    const exported = exportSvg(scene, { resources: { font: svgTestFont } });
    if (!exported.ok) throw new Error(exported.error.map((item) => item.message).join('; '));

    const frame = exported.value[0];
    if (frame === undefined) throw new Error('The text fixture exported no SVG frames.');

    // The y of every tspan is computed from the run's own size and lineHeight, so the
    // first line of `body` sits one ascent below its origin and the second one line below
    // that — 1.45 × 15, the same number export-html now produces.
    expect(frame.svg).toContain('font-size="15"');
    expect(frame.svg).not.toContain('font-size="16"');
  });
});
