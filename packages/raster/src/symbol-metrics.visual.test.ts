import type { FaceCache, FontFace, Scene, TextNode, TextRun } from '@tyto/core';
import { createFaceCache, measureText, parseScene } from '@tyto/core';
import { exportHtml } from '@tyto/export-html';
import { bundledFont, bundledFontSource } from '@tyto/fonts';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DETERMINISM_ARGS } from './playwright.js';

/**
 * The acceptance criterion of TYTO-484 (ADR 0168): a symbol the run's face lacks is
 * measured in the face that draws it, so the width `core` measured is the width Chromium
 * draws, line by line.
 *
 * The run face is Source Sans 3, the one text face every machine (and CI) has: it lacks
 * `∇ ℏ ∮ ∈ ∪ ⊥ ∠ ∝` and the like, as a brand face such as CircularXX lacks most of the
 * symbols an exam question writes. Each sample is measured twice:
 *
 * - **with the chain** (`bundledFontSource`, as the host measures), and the split runs
 *   exported as `compile` would put them in the IR: every line's width matches Chromium's
 *   within a pixel;
 * - **without it** (a cache that answers only Source Sans 3), the measurement before this
 *   card: the missing glyphs are measured as `.notdef`, and the lines disagree with the
 *   drawing. That arm is the perturbation the card asks for, kept in the suite so it keeps
 *   proving the first one measures something. It compares against the split drawing, all
 *   bundled faces, rather than against whatever face the machine would have fallen back to,
 *   which differs between Windows and the Linux CI.
 *
 * `TYTO_RASTER_CHANNEL=chrome` renders in the machine's Chrome instead of Playwright's
 * Chromium, as `raster.visual.test.ts` allows.
 */

const CHANNEL = process.env['TYTO_RASTER_CHANNEL'];

const SAMPLES: readonly string[] = [
  '∇·E = ρ/ε₀ e ∮ B·dl = μ₀I',
  'ℏ ≈ 1,05 × 10⁻³⁴ J·s, x ∈ A ∪ B',
  'F ∝ 1/r², ∠ABC ⊥ r e Δv = a·Δt',
  '∑ a₁ ≤ √2 ∫ f(x) dx → ∞',
  // Every symbol Source Sans 3 lacks of the 137 measured for TYTO-484, but ℃, which no face has.
  '∬ ∮ ∛ ∇ ∝ ∓ ∈ ∉ ⊂ ⊃ ⊆ ⊇ ∪ ∅ ∧ ∨ ⇔ ℏ ⊥ ∥ ∠ ∘',
];

const SIZE = 20;

function nodeOf(id: string, runs: readonly TextRun[]): TextNode {
  return {
    kind: 'text',
    id,
    transform: { x: 20, y: 20, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
    opacity: 1,
    blend: 'normal',
    visible: true,
    clip: false,
    effects: [],
    box: {},
    runs: [...runs],
    align: 'left',
    valign: 'top',
    lineHeight: 1.4,
    letterSpacing: 0,
    overflow: 'grow',
  };
}

function plainRun(text: string): TextRun {
  return {
    kind: 'text',
    text,
    font: { family: 'Source Sans 3', source: 'bundled' },
    size: SIZE,
    weight: 400,
    style: 'normal',
    color: { kind: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } },
  };
}

const HOST: FaceCache = createFaceCache(bundledFontSource);

/** The measurement before ADR 0168: only the run's own face is there to ask. */
const RUN_FACE_ONLY: FaceCache = createFaceCache({
  outlines: (face: FontFace) =>
    face.family === 'Source Sans 3' ? bundledFontSource.outlines(face) : undefined,
});

interface Measured {
  readonly node: TextNode;
  readonly width: number;
}

/** One sample, measured on one line, with the runs the measurement decided. */
function measured(id: string, text: string, faces: FaceCache): Measured {
  const result = measureText(nodeOf(id, [plainRun(text)]), faces);
  if (result === undefined) throw new Error(`Nothing could measure '${text}'.`);
  return { node: nodeOf(id, result.runs), width: result.width };
}

function documentOf(nodes: readonly TextNode[]): string {
  const parsed = parseScene({
    version: 1,
    // What `compile` collects from the split runs; the core test checks it does.
    fonts: [
      { family: 'Source Sans 3', source: 'bundled' },
      { family: 'Noto Sans Math', source: 'bundled' },
    ],
    artworks: [
      {
        id: 'symbols',
        frames: [
          {
            format: 'feed',
            size: { w: 900, h: 80 * nodes.length },
            background: { kind: 'solid', color: { r: 255, g: 255, b: 255 } },
            children: nodes.map((node, index) => ({
              ...node,
              transform: { ...node.transform, y: 20 + index * 80 },
            })),
          },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  const scene: Scene = parsed.value;
  const exported = exportHtml(scene, { resources: { font: bundledFont } });
  if (!exported.ok) throw new Error(exported.error.map((item) => item.message).join('; '));
  const frame = exported.value[0];
  if (frame === undefined) throw new Error('The symbol scene exported no frames.');
  return frame.html;
}

/** The slice of the DOM read inside Chromium, reached through `globalThis` (ADR 0010). */
interface BrowserWindow {
  readonly document: {
    getElementById(id: string): BrowserElement | null;
    createRange(): {
      selectNodeContents(node: BrowserElement): void;
      getBoundingClientRect(): { width: number };
    };
    readonly fonts: {
      readonly ready: Promise<unknown>;
      check(font: string, text: string): boolean;
    };
  };
}

interface BrowserElement {
  readonly firstElementChild: BrowserElement | null;
}

let browser: Browser | undefined;

beforeAll(async () => {
  browser = await chromium.launch({
    args: [...DETERMINISM_ARGS],
    ...(CHANNEL === undefined ? {} : { channel: CHANNEL }),
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

/** How wide Chromium laid out each node's text, by id. */
async function drawnWidths(
  html: string,
  ids: readonly string[],
): Promise<{ widths: number[]; symbolFaceLoaded: boolean }> {
  if (browser === undefined) throw new Error('No browser.');
  const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
  try {
    await page.setContent(html);
    await page.evaluate(async () => {
      await (globalThis as unknown as BrowserWindow).document.fonts.ready;
    });
    return await page.evaluate((nodeIds) => {
      const win = globalThis as unknown as BrowserWindow;
      const widths = nodeIds.map((id) => {
        const element = win.document.getElementById(id);
        if (element === null) throw new Error(`No #${id} in the document.`);
        const range = win.document.createRange();
        range.selectNodeContents(element.firstElementChild ?? element);
        return range.getBoundingClientRect().width;
      });
      return {
        widths,
        symbolFaceLoaded: win.document.fonts.check('20px "Noto Sans Math"', '∇'),
      };
    }, ids);
  } finally {
    await page.close();
  }
}

describe('a symbol the run face lacks (ADR 0168)', () => {
  it('measures, per line, the width Chromium draws', async () => {
    const lines = SAMPLES.map((text, index) => measured(`with-${String(index)}`, text, HOST));
    const { widths, symbolFaceLoaded } = await drawnWidths(
      documentOf(lines.map((line) => line.node)),
      lines.map((line) => line.node.id),
    );

    // The symbol face really was embedded and used, not a machine face that happened to fit.
    expect(symbolFaceLoaded).toBe(true);
    for (const [index, line] of lines.entries()) {
      const drawn = widths[index] ?? Number.NaN;
      process.stdout.write(
        `with the chain    ${SAMPLES[index] ?? ''}: measured ${line.width.toFixed(3)} drawn ${drawn.toFixed(3)}\n`,
      );
      expect(Math.abs(line.width - drawn), `'${SAMPLES[index] ?? ''}'`).toBeLessThanOrEqual(1);
    }
  });

  it('disagrees with what is drawn when the chain is taken away, which is what it fixed', async () => {
    // The drawing is the split one, every face bundled, so this arm does not depend on which
    // faces the machine happens to fall back to; the measurement is the one before ADR 0168.
    const drawnLines = SAMPLES.map((text, index) => measured(`drawn-${String(index)}`, text, HOST));
    const { widths } = await drawnWidths(
      documentOf(drawnLines.map((line) => line.node)),
      drawnLines.map((line) => line.node.id),
    );

    let worst = 0;
    for (const [index, text] of SAMPLES.entries()) {
      const before = measured(`before-${String(index)}`, text, RUN_FACE_ONLY);
      const drawn = widths[index] ?? Number.NaN;
      process.stdout.write(
        `without the chain ${text}: measured ${before.width.toFixed(3)} drawn ${drawn.toFixed(3)}
`,
      );
      worst = Math.max(worst, Math.abs(before.width - drawn));
    }
    // The samples carry glyphs Source Sans 3 lacks, measured as its `.notdef`, which is not
    // the width of the symbol face's glyph drawn in their place.
    expect(worst).toBeGreaterThan(1);
  });
});
