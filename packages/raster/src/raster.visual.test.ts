import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Diagnostics, Scene } from '@tyto/core';
import { parseScene } from '@tyto/core';
import { exportHtml } from '@tyto/export-html';
import { exportSvg } from '@tyto/export-svg';
import { htmlTestFont, svgTestFont } from '@tyto/test-fonts';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';

import { createPlaywrightRasterizer } from './playwright.js';
import type { RasterFormat } from './rasterizer.js';

import alphaFixture from './__fixtures__/alpha.json';
import shapesFixture from './__fixtures__/shapes.json';
import textFixture from './__fixtures__/text.json';

/**
 * The pixels. This is the suite the card's acceptance criteria are about, and the reason
 * `visual.yml` exists as a workflow of its own.
 *
 * It runs the whole tail of the compiler — `Scene` → `export-html` → Chromium → bytes —
 * because that is the only place a change in what the output *looks like* shows up. The
 * exporters' own tests snapshot strings, and a string snapshot tells you the markup moved
 * without telling you whether the artwork did.
 *
 * ## One reference per fixture, and why that was not obvious
 *
 * The first version of this suite keyed every reference on `process.platform`, the way
 * Playwright's own screenshot assertions do, on the reasoning that Chromium rasterizes
 * differently per operating system — FreeType on Linux, Skia over DirectWrite on Windows.
 * Then the two were measured against each other, and for this corpus the reasoning does
 * not bite: the Windows render and the Linux render of both fixtures are **identical at
 * `threshold: 0` — 0 differing pixels of 160 000 and of 14 400**. Gradients, a rotated
 * rect, a drop shadow, a blur, an alpha mask and a `cover` crop all land on the same
 * bytes, which is Skia's software rasterizer being deterministic across platforms once
 * `DETERMINISM_ARGS` has taken the host's opinions out of it.
 *
 * So there is one reference per fixture and no seeding round trip. The platform split is
 * real for **glyphs**, and that is the half of it this corpus does not contain — the card
 * that bundles a test font (E5.6) is the one that will have to measure text across
 * platforms and, if it diverges, reintroduce the key. Until something is measured to
 * differ, a per-platform file would be three copies of the same bytes in Git LFS and a
 * red `visual` job on every machine nobody has seeded yet.
 *
 * A missing reference **fails**, writes the render it would have compared into `__diff__/`
 * and names the file to commit; `visual.yml` uploads that folder on failure. Skipping
 * would report green for a corpus nothing is checked against, and a suite that passes
 * because it did not look is worse than one that is red.
 *
 * ## The text fixture, and the platform question it was supposed to settle
 *
 * `text.feed` is the third fixture and the only one with glyphs in it. It exists because
 * the repository now bundles a font (`fonts/`, read by `@tyto/test-fonts`); before that
 * `export-html` refused to embed a face it had no bytes for and **no fixture carrying text
 * could be rasterized at all**.
 *
 * Text is the half of the corpus TYTO-29 left out on the reasoning that glyph
 * rasterization is where platforms diverge — FreeType on Linux, Skia over DirectWrite on
 * Windows. That reasoning is still the live hypothesis, and this file cannot settle it
 * alone: **the number below was measured on win32 only**. What was measured here is the
 * other half of the question, stability on one platform, and it is clean —
 * **12 of 12 re-renders of `text.feed` came back byte-identical**, so the pixel check
 * stays rather than being dropped.
 *
 * If the Linux render turns out to differ, the answer is a per-platform key for this
 * fixture (`docs/git-workflow.md` reserved one), not a wider tolerance. The numbers below
 * are the reason: at a tolerance loose enough to absorb a different glyph rasterizer, the
 * suite stops seeing the things it is here for.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = join(HERE, '__fixtures__', 'reference');
const DIFF_DIR = join(HERE, '__diff__');

/** Named in the failure message, because a divergence would most likely be one. */
const PLATFORM = process.platform;

/**
 * `pnpm test:visual` compares; `UPDATE_VISUAL_REFERENCE=1 pnpm test:visual` records.
 *
 * An environment variable rather than a flag because it has to survive `turbo run` and
 * `vitest` without either of them being taught about it. `docs/git-workflow.md` requires
 * the commit that changes a reference to say why, which is the part no flag can enforce.
 */
const UPDATING = process.env['UPDATE_VISUAL_REFERENCE'] === '1';

/**
 * A channel for a machine that has no `playwright install` behind it.
 *
 * References recorded through a channel are the machine's Chrome, not Playwright's
 * Chromium, so they are not comparable with CI's — which is why this is an escape hatch
 * for looking at output, not a supported way to record.
 */
const CHANNEL = process.env['TYTO_RASTER_CHANNEL'];

/**
 * Of the pixels, how many may differ. The card's acceptance criterion.
 *
 * Worth knowing what it costs: 0.1% of a 400×400 frame is 160 pixels, so a small element
 * moving a pixel or two is under the line — the 48×48 chevron shifted 2px comes to
 * 0.049%. The suite catches a change to something the size of a headline card (a 1px
 * shift of the 160×100 rect is 0.144%) and does not catch a nudge to an icon. That is the
 * trade the number is, and it is written down rather than discovered later.
 *
 * ## What it costs on glyphs
 *
 * Same method on `text.feed`, 400×400, on win32, at `PIXEL_THRESHOLD` below. Percentages
 * are of 160 000 pixels; the tolerance line is 0.100%.
 *
 * ```
 * threshold                                    0     0.005      0.01      0.02      0.05       0.1
 * identical re-render                     0.000%    0.000%    0.000%    0.000%    0.000%    0.000%
 * headline green channel +1               2.551%    0.000%    0.000%    0.000%    0.000%    0.000%
 * headline green channel +2               2.553%    2.550%    0.000%    0.000%    0.000%    0.000%
 * headline green channel +4               2.559%    2.551%    2.550%    0.000%    0.000%    0.000%
 * headline green channel +8               2.566%    2.552%    2.550%    2.550%    0.000%    0.000%
 * body text +1 on every channel           0.774%    0.000%    0.000%    0.000%    0.000%    0.000%
 * headline shifted 1px                    0.419%    0.381%    0.378%    0.372%    0.364%    0.351%
 * body shifted 1px                        1.471%    1.445%    1.421%    1.367%    1.252%    1.066%
 * kicker shifted 1px                      0.253%    0.248%    0.243%    0.232%    0.206%    0.166%
 * body size 15 → 15.25                    1.944%    1.904%    1.884%    1.843%    1.709%    1.527%
 * body line-height 1.45 → 1.5             0.000%    0.000%    0.000%    0.000%    0.000%    0.000%
 * body line-height 1.45 → 1.6             1.479%    1.437%    1.408%    1.351%    1.204%    1.023%
 * kicker letterSpacing 2.5 → 2.6          0.151%    0.146%    0.143%    0.134%    0.108%    0.074%
 * one digit changed in the body           0.024%    0.024%    0.023%    0.020%    0.017%    0.011%
 * headline weight 700 → 400               3.885%    3.841%    3.834%    3.820%    3.775%    3.746%
 * whole-image drift ±1                   94.183%    0.000%    0.000%    0.000%    0.000%    0.000%
 * whole-image drift ±2                   94.183%   94.183%    0.000%    0.000%    0.000%    0.000%
 * whole-image drift ±3                   94.183%   94.183%   91.508%    0.000%    0.000%    0.000%
 * ```
 *
 * **Glyphs turn out to be the easy case, not the fragile one.** Text covers a small
 * fraction of the frame and every letter is an edge, so anything that moves type moves
 * hundreds of antialiased pixels at once: a 1px nudge of the 15px body paragraph is
 * 1.421%, fourteen times the tolerance, where the same nudge to a solid 48×48 icon in
 * `shapes.feed` is 0.049% and invisible to the suite. The rows that read as identical
 * behave the same way the shapes corpus does — a one-step colour change and a ±2
 * whole-image drift are both forgiven, deliberately, by `PIXEL_THRESHOLD`.
 *
 * Two rows are blind spots worth naming rather than leaving to be discovered:
 *
 * **One digit of body copy — 0.023%, a quarter of the tolerance, missed.** Changing "dia
 * 30" to "dia 38" touches 37 pixels of 160 000. A visual suite does not check copy, and
 * nothing here should be read as saying it does; a wrong word is a job for a snapshot of
 * the exporter's string, which is what `export-html`'s own tests are.
 *
 * **A line-height of 1.45 and one of 1.5 are the same image, at `threshold: 0`.** That is
 * not the tolerance being generous — it is Chromium quantizing the used line-height to
 * whole pixels: 15px × 1.45 = 21.75 and 15px × 1.5 = 22.5 both land on 22. The next value
 * that lands anywhere else, 1.6, moves 1.408%. So the suite's floor for leading is the
 * rasterizer's, not this file's, and a tolerance change would not move it. It is listed
 * because a reader who sees 0.000% and concludes the check is weak would draw the wrong
 * conclusion about which instrument produced it.
 */
const TOLERANCE = 0.001;

/**
 * How different one pixel may be before it counts as differing at all.
 *
 * pixelmatch's own units: a fraction of the maximum YIQ colour distance. The value is
 * measured, not picked. Perturbing the `shapes` fixture and diffing against an unmodified
 * render of it, on a 400×400 frame (160 000 pixels), gives:
 *
 * ```
 * threshold                       0     0.005      0.01      0.02      0.05       0.1
 * identical re-render        0.000%    0.000%    0.000%    0.000%    0.000%    0.000%
 * card green channel +1      9.207%    0.000%    0.000%    0.000%    0.000%    0.000%
 * card green channel +2      9.207%    9.207%    0.000%    0.000%    0.000%    0.000%
 * card green channel +4      9.207%    9.207%    9.207%    0.000%    0.000%    0.000%
 * card green channel +8      9.207%    9.207%    9.207%    0.000%    0.000%    0.000%
 * card shifted 1px           0.144%    0.143%    0.142%    0.141%    0.141%    0.136%
 * chevron shifted 2px        0.049%    0.049%    0.049%    0.049%    0.049%    0.049%
 * whole-image drift ±1      99.324%    0.000%    0.000%    0.000%    0.000%    0.000%
 * whole-image drift ±2      99.328%   98.569%    0.000%    0.000%    0.000%    0.000%
 * whole-image drift ±3      99.328%   99.287%   96.140%    0.000%    0.000%    0.000%
 * ```
 *
 * The last three rows are the reason the threshold is not 0: a Chromium that dithers a
 * gradient one step differently would move every pixel by ±1 and redden the suite over
 * nothing. The colour rows are the reason it is not the 0.1 that reads as a natural
 * default — at 0.1, and even at 0.02, a fill eight steps off on a tenth of the frame
 * comes back as zero differing pixels, and a suite that cannot see a wrong colour is not
 * checking the thing it was built to check.
 *
 * 0.01 is the only value that both notices a two-step colour change and forgives a
 * one-step drift. A browser bump that moves pixels by ±2 will fail here, which is
 * correct: that is a re-record, and `docs/git-workflow.md` asks for a commit that says
 * why.
 */
const PIXEL_THRESHOLD = 0.01;

const rasterizer = createPlaywrightRasterizer(CHANNEL === undefined ? {} : { channel: CHANNEL });

afterAll(async () => {
  await rasterizer.close();
});

/**
 * The image asset, built rather than committed.
 *
 * A checkerboard is the honest test for `fit: cover`: a photograph crops to something
 * plausible whatever the exporter got wrong, and a grid does not. It is written here with
 * the same library that decodes the results, so the bytes in the document are a real PNG
 * — an `<image>` pointed at an SVG would hand `preserveAspectRatio` to the referenced
 * document and render `cover` as `contain`, which looks exactly like an exporter bug.
 */
function checkerboardDataUri(): string {
  // Big enough that `fit: cover` on the fixture's 350×55 box crops it rather than
  // smearing eight pixels across a banner, so the crop is something a reviewer can see.
  const size = 64;
  const cell = 8;
  const png = new PNG({ width: size, height: size });

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dark = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const index = (y * size + x) * 4;
      png.data[index] = dark ? 30 : 235;
      png.data[index + 1] = dark ? 40 : 120;
      png.data[index + 2] = dark ? 90 : 30;
      png.data[index + 3] = 255;
    }
  }

  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

const CHECKERBOARD = checkerboardDataUri();

function sceneOf(fixture: unknown): Scene {
  const parsed = parseScene(fixture);
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

interface Document {
  readonly name: string;
  readonly html: string;
  readonly width: number;
  readonly height: number;
}

/** Every frame of a fixture as a document ready to rasterize, named `<artwork>.<format>`. */
function documentsOf(fixture: unknown): readonly Document[] {
  const scene = sceneOf(fixture);
  const exported = exportHtml(scene, {
    resources: { asset: () => CHECKERBOARD, font: htmlTestFont },
  });

  if (!exported.ok) {
    throw new Error(exported.error.map((item) => item.message).join('; '));
  }

  return exported.value.map((frame) => ({
    name: `${frame.artwork.id}.${frame.frame.format}`,
    html: frame.html,
    width: frame.frame.size.w,
    height: frame.frame.size.h,
  }));
}

const SHAPES = documentsOf(shapesFixture);
const ALPHA = documentsOf(alphaFixture);
const TEXT = documentsOf(textFixture);

async function render(
  document: Document,
  options: { format?: RasterFormat; quality?: number; scale?: number } = {},
): Promise<Uint8Array> {
  return rasterizer.raster(document.html, {
    width: document.width,
    height: document.height,
    ...options,
  });
}

function write(directory: string, file: string, bytes: Uint8Array): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, file);
  writeFileSync(path, bytes);
  return path;
}

/**
 * Compares one render against its reference and returns the fraction of pixels that
 * differ, writing the render and the diff into `__diff__/` when they do.
 *
 * A missing reference throws with the command that records one. It is the one case where
 * the suite cannot answer the question it was asked, and saying so is the answer.
 */
function mismatchFraction(name: string, rendered: Uint8Array): number {
  const file = `${name}.png`;

  if (UPDATING) {
    write(REFERENCE_DIR, file, rendered);
    return 0;
  }

  let referenceBytes: Buffer;
  try {
    referenceBytes = readFileSync(join(REFERENCE_DIR, file));
  } catch {
    const candidate = write(DIFF_DIR, file, rendered);
    throw new Error(
      `No reference for '${name}'. The render, made on ${PLATFORM}, is at ${candidate}; commit ` +
        `it as src/__fixtures__/reference/${file} (Git LFS), or record it locally with ` +
        'UPDATE_VISUAL_REFERENCE=1 pnpm --filter @tyto/raster test:visual.',
    );
  }

  const reference = PNG.sync.read(referenceBytes);
  const actual = PNG.sync.read(Buffer.from(rendered));

  if (reference.width !== actual.width || reference.height !== actual.height) {
    write(DIFF_DIR, file, rendered);
    throw new Error(
      `Reference for '${name}' is ${String(reference.width)}×${String(reference.height)} and the ` +
        `render is ${String(actual.width)}×${String(actual.height)}. A size change is not a ` +
        'tolerance question; re-record the reference and say why in the commit.',
    );
  }

  const diff = new PNG({ width: reference.width, height: reference.height });
  const differing = pixelmatch(
    reference.data,
    actual.data,
    diff.data,
    reference.width,
    reference.height,
    { threshold: PIXEL_THRESHOLD },
  );

  const fraction = differing / (reference.width * reference.height);
  if (fraction > TOLERANCE) {
    write(DIFF_DIR, file, rendered);
    write(DIFF_DIR, `${name}.diff.png`, PNG.sync.write(diff));
  }

  return fraction;
}

/** The first four bytes, which is enough to tell one container from another. */
function magic(bytes: Uint8Array): string {
  return [...bytes.slice(0, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The RGBA of one pixel of a decoded PNG. */
function pixelAt(bytes: Uint8Array, x: number, y: number): readonly number[] {
  const png = PNG.sync.read(Buffer.from(bytes));
  const index = (y * png.width + x) * 4;
  return [...png.data.subarray(index, index + 4)];
}

describe('reference renders', () => {
  it.each([...SHAPES, ...ALPHA, ...TEXT].map((document) => [document.name, document] as const))(
    '%s matches its committed reference',
    async (name, document) => {
      const fraction = mismatchFraction(name, await render(document));

      // The number is in the message on purpose: "0.04% of pixels differ" is a report,
      // "expected true" is not.
      expect(fraction, `${(fraction * 100).toFixed(4)}% of pixels differ`).toBeLessThanOrEqual(
        TOLERANCE,
      );
    },
  );
});

/**
 * The codes an export reported, whether it failed or came back with warnings.
 *
 * `E_EXPORT_FONT_UNRESOLVED` is an error, so it lands in `error`; reading both branches
 * means the assertion says "nothing reported it" rather than "the call happened to
 * succeed", and the two are not the same sentence once a warning is added.
 */
function codesOf(result: { ok: boolean; warnings?: Diagnostics; error?: Diagnostics }): string[] {
  return [...(result.ok ? (result.warnings ?? []) : (result.error ?? []))].map(
    (problem) => problem.code,
  );
}

/** The text fixture with every run flipped to a face the repository does not bundle. */
function inItalic(): Scene {
  const scene = sceneOf(textFixture) as unknown as {
    artworks: { frames: { children: { runs?: { kind: string; style?: string }[] }[] }[] }[];
  };
  const clone = structuredClone(scene);
  for (const artwork of clone.artworks) {
    for (const frame of artwork.frames) {
      for (const child of frame.children) {
        for (const run of child.runs ?? []) {
          if (run.kind === 'text') run.style = 'italic';
        }
      }
    }
  }
  return sceneOf(clone);
}

describe('glyph rendering on this platform', () => {
  const document = TEXT[0];
  if (document === undefined) throw new Error('The text fixture rendered no frames.');

  it('is repeatable to the byte, which is what the reference rests on', async () => {
    // The measurement in TOLERANCE's header ran this twelve times; three is what a suite
    // can afford every run. It is here because "the text reference is unstable" is the
    // one finding that would make this card drop the pixel check for text instead of
    // committing a file, and a claim that only a one-off script ever checked is a claim
    // that quietly stops being true.
    const first = await render(document);
    const second = await render(document);
    const third = await render(document);

    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
    expect(Buffer.from(third).equals(Buffer.from(first))).toBe(true);
  });
});

describe('the bundled font', () => {
  const scene = sceneOf(textFixture);

  it('resolves through export-html, and the document carries the real bytes', () => {
    const exported = exportHtml(scene, { resources: { font: htmlTestFont } });

    expect(codesOf(exported)).not.toContain('E_EXPORT_FONT_UNRESOLVED');
    if (!exported.ok) throw new Error('export-html failed on the text fixture.');

    const [frame] = exported.value;
    if (frame === undefined) throw new Error('The text fixture exported no frames.');

    // Both weights, both embedded. A `@font-face` per weight is what the fixture is for:
    // a resolver keyed on family alone would emit one rule and Chromium would synthesise
    // the bold, which looks like a bold and is not the bundled one.
    expect(frame.html).toContain('font-weight: 400');
    expect(frame.html).toContain('font-weight: 700');
    expect([...frame.html.matchAll(/src: url\("data:font\/woff2;base64,/g)]).toHaveLength(2);
  });

  it('resolves through export-svg too', () => {
    const exported = exportSvg(scene, { resources: { font: svgTestFont } });

    expect(codesOf(exported)).not.toContain('E_EXPORT_FONT_UNRESOLVED');
    if (!exported.ok) throw new Error('export-svg failed on the text fixture.');

    const [frame] = exported.value;
    if (frame === undefined) throw new Error('The text fixture exported no frames.');
    expect([...frame.svg.matchAll(/src:url\("data:font\/woff2;base64,/g)]).toHaveLength(2);
  });

  it('is still the only thing standing between a fixture and that diagnostic', () => {
    // Without the resolver the fixture is exactly where the corpus was before this card,
    // and the failure has to stay legible: this is the assertion that stops a future
    // resolver from quietly substituting a face it does have.
    expect(codesOf(exportHtml(scene))).toContain('E_EXPORT_FONT_UNRESOLVED');
    expect(codesOf(exportSvg(scene))).toContain('E_EXPORT_FONT_UNRESOLVED');
  });

  it('reports a face it does not bundle rather than substituting one', () => {
    const italic = inItalic();

    expect(codesOf(exportHtml(italic, { resources: { font: htmlTestFont } }))).toContain(
      'E_EXPORT_FONT_UNRESOLVED',
    );
    expect(codesOf(exportSvg(italic, { resources: { font: svgTestFont } }))).toContain(
      'E_EXPORT_FONT_UNRESOLVED',
    );
  });
});

describe('a frame with no background', () => {
  const document = ALPHA[0];
  if (document === undefined) throw new Error('The alpha fixture rendered no frames.');

  it('comes back with a real alpha channel, not white', async () => {
    const bytes = await render(document);

    // The fixture is 120×120 with an opaque square at 20,20 and a half-transparent one at
    // 60,60. Reading the channel is the check; a screenshot on a white page would put 255
    // in all three.
    expect(pixelAt(bytes, 4, 4)[3]).toBe(0);
    expect(pixelAt(bytes, 40, 40)[3]).toBe(255);
    expect(pixelAt(bytes, 80, 80)[3]).toBeGreaterThan(120);
    expect(pixelAt(bytes, 80, 80)[3]).toBeLessThan(136);
  });

  it('keeps the colour under the partial alpha unpremultiplied', async () => {
    const bytes = await render(document);
    const [r = -1, g = -1, b = -1] = pixelAt(bytes, 80, 80);

    // #00c8b4 at 50% comes back as #00c7b3: Chromium stores the surface premultiplied and
    // PNG is not, and 200 × 128/255 rounded and divided back is 199. One step, and a
    // channel-by-channel tolerance rather than a rounder assertion, because what this
    // test is actually here to catch is off by a hundred: composited on white the pixel
    // would read #80e4da. `omitBackground` has to be omitting a background, not blending
    // onto one.
    expect(r).toBe(0);
    expect(g).toBeGreaterThanOrEqual(198);
    expect(g).toBeLessThanOrEqual(200);
    expect(b).toBeGreaterThanOrEqual(178);
    expect(b).toBeLessThanOrEqual(180);
  });

  it('paints jpeg on white, because jpeg has no alpha to omit', async () => {
    const bytes = await render(document, { format: 'jpeg', quality: 95 });

    expect(magic(bytes).startsWith('ffd8ff')).toBe(true);
  });
});

describe('scale', () => {
  const document = SHAPES[0];
  if (document === undefined) throw new Error('The shapes fixture rendered no frames.');

  it('doubles the pixels without changing the layout', async () => {
    const [single, double] = await Promise.all([
      render(document, { scale: 1 }),
      render(document, { scale: 2 }),
    ]);

    const one = PNG.sync.read(Buffer.from(single));
    const two = PNG.sync.read(Buffer.from(double));

    expect([one.width, one.height]).toEqual([document.width, document.height]);
    expect([two.width, two.height]).toEqual([document.width * 2, document.height * 2]);
  });
});

describe('quality', () => {
  const document = SHAPES[0];
  if (document === undefined) throw new Error('The shapes fixture rendered no frames.');

  it.each([
    ['jpeg' as const, 'ffd8ff'],
    ['webp' as const, '52494646'],
  ])('%s honours it: fewer bytes at 20 than at 90', async (format, prefix) => {
    const [low, high] = await Promise.all([
      render(document, { format, quality: 20 }),
      render(document, { format, quality: 90 }),
    ]);

    expect(magic(low).startsWith(prefix)).toBe(true);
    expect(magic(high).startsWith(prefix)).toBe(true);
    expect(low.byteLength).toBeLessThan(high.byteLength);
  });

  it('writes webp with an alpha channel when the frame has none', async () => {
    const alpha = ALPHA[0];
    if (alpha === undefined) throw new Error('The alpha fixture rendered no frames.');

    const bytes = await render(alpha, { format: 'webp', quality: 90 });

    // RIFF….WEBP: bytes 8–12 are the form type, which is what separates a WebP from any
    // other RIFF container.
    expect(Buffer.from(bytes.slice(8, 12)).toString('ascii')).toBe('WEBP');
  });
});

describe('the browser', () => {
  it('is reused across renders rather than launched per document', async () => {
    const document = ALPHA[0];
    if (document === undefined) throw new Error('The alpha fixture rendered no frames.');

    // Same document, same options, twice: identical bytes are the determinism claim in
    // `docs/architecture.md` measured, and a second render that costs a launch would be
    // the slowest test in the suite.
    const first = await render(document);
    const second = await render(document);

    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });
});
