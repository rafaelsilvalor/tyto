import type { Diagnostic, Scene } from '@tyto/core';
import { GAP_ASSET_URI, parseScene } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import type { SvgFontFace, SvgResources } from './defs.js';
import { exportSvg } from './export-svg.js';
import type { SvgExportOptions } from './svg.js';
import mappingFixture from './__fixtures__/mapping.json';
import promoFixture from './__fixtures__/promo.json';

/**
 * The card asks for three things: a committed snapshot per fixture, output that opens in
 * Figma and Illustrator and matches the raster, and a `--text-as-paths` flag that leaves
 * no `<text>` behind. The first and the third are tests. The second is not testable here —
 * there is no rasterizer until E5.3 and no design tool in this repository — so what stands
 * in for it is XML well-formedness, which is the failure those tools actually report, and
 * the fixtures are shared byte for byte with `export-html` so the two can be compared the
 * day a raster exists.
 */

/**
 * The pictures behind the two fixtures, at sizes chosen to be awkward.
 *
 * `hero` is landscape and `photo` is portrait, so a `cover` on each overflows a different
 * axis and the crop arithmetic cannot come out right by symmetry.
 */
const NATURAL: Readonly<Record<string, { w: number; h: number }>> = {
  hero: { w: 1600, h: 900 },
  photo: { w: 800, h: 1200 },
};

/** What a composition root that wires no sizes gets: bytes, and nothing about them. */
const fontUri = (face: SvgFontFace): string =>
  `data:font/woff2;base64,${face.font.family}-${String(face.weight)}-${face.style}`;

const unmeasured: SvgResources = {
  asset: (ref) => `data:image/jpeg;base64,${ref.hash}`,
  font: fontUri,
};

/** Fonts and nothing else, for the tests about an asset that did not resolve. */
const fontsOnly: SvgResources = { font: fontUri };

const resources: SvgResources = { ...unmeasured, assetSize: (ref) => NATURAL[ref.id] };

/** A stand-in for the font machinery E4.5 brings: a box per character, and its width. */
const outlining: SvgResources = {
  ...resources,
  outline: (request) => ({
    d: `M0 0 h${String(request.text.length * request.size * 0.6)} v${String(-request.size)} h${String(-request.text.length * request.size * 0.6)} Z`,
    advance: request.text.length * request.size * 0.6,
  }),
};

function sceneOf(fixture: unknown): Scene {
  const parsed = parseScene(fixture);
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

function svgOf(scene: Scene, options: SvgExportOptions = { resources }): readonly string[] {
  const result = exportSvg(scene, options);
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value.map((frame) => frame.svg);
}

function problemsOf(scene: Scene, options: SvgExportOptions): readonly Diagnostic[] {
  const result = exportSvg(scene, options);
  return result.ok ? result.diagnostics : result.error;
}

/**
 * Well-formed XML, which is the bar a design tool actually enforces.
 *
 * Every element closed in order, and no bare `&` — the two ways a string builder produces
 * a file Illustrator refuses to open. Attribute values are skipped through rather than
 * parsed, because an embedded font is a very long one.
 */
function malformed(svg: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];

  for (const tag of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|[^>"])*)>/gu)) {
    const [, slash, name = '', rest = ''] = tag;
    if (slash === '/') {
      const open = stack.pop();
      if (open !== name) problems.push(`</${name}> closes <${open ?? 'nothing'}>`);
      continue;
    }
    if (!rest.trimEnd().endsWith('/')) stack.push(name);
  }
  problems.push(...stack.map((name) => `<${name}> is never closed`));

  const text = svg.replaceAll(/<[^>]*>/gu, '');
  for (const ampersand of text.matchAll(/&(?!(?:amp|lt|gt|quot|apos|#\d+);)/gu)) {
    problems.push(`bare & at ${String(ampersand.index)}`);
  }

  return problems;
}

describe('a scene becomes one SVG document per frame', () => {
  it('renders the promo fixture to its committed snapshot', async () => {
    const [feed, story] = svgOf(sceneOf(promoFixture));

    await expect(feed).toMatchFileSnapshot('./__snapshots__/promo.feed.svg');
    await expect(story).toMatchFileSnapshot('./__snapshots__/promo.story.svg');
  });

  it('renders the mapping fixture to its committed snapshot', async () => {
    const [feed] = svgOf(sceneOf(mappingFixture));

    await expect(feed).toMatchFileSnapshot('./__snapshots__/mapping.feed.svg');
  });

  it('gives an image paint the node’s real box, so cover does not distort it', () => {
    // `story-bg` is 1080x1920 filled with a `cover` image. In `objectBoundingBox` units the
    // pattern's viewport is the unit *square*, so preserveAspectRatio fits the picture to a
    // square that is then stretched to the box — a circle comes out an ellipse. Chrome
    // rendered exactly that: 972151 of 2073600 pixels differed from the HTML export, and
    // 0 do now.
    const [, story = ''] = svgOf(sceneOf(promoFixture));

    expect(story).toContain('patternUnits="userSpaceOnUse"');
    expect(story).not.toContain('objectBoundingBox');
    expect(story).toMatch(/<pattern id="paint\d+" width="1080" height="1920"/u);
  });

  it('produces well-formed XML, which is what a design tool refuses on', () => {
    const documents = [...svgOf(sceneOf(promoFixture)), ...svgOf(sceneOf(mappingFixture))];

    expect(documents.flatMap(malformed)).toEqual([]);
    expect(documents).toHaveLength(3);
  });

  it('defines every id it references, so nothing renders as a hole', () => {
    // A dangling `url(#paint16)` is well-formed XML that draws nothing, which is exactly
    // the kind of bug a snapshot review and a tag-balance check both walk straight past.
    // The frame background was one: its gradient was declared after `<defs>` was built.
    for (const svg of [...svgOf(sceneOf(promoFixture)), ...svgOf(sceneOf(mappingFixture))]) {
      const declared = new Set([...svg.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]));
      const referenced = [...svg.matchAll(/url\(#([^)]+)\)/gu)].map((match) => match[1] ?? '');

      expect(referenced.filter((id) => !declared.has(id))).toEqual([]);
      expect(referenced.length).toBeGreaterThan(0);
    }
  });

  it('references nothing outside the document', () => {
    for (const svg of [...svgOf(sceneOf(promoFixture)), ...svgOf(sceneOf(mappingFixture))]) {
      const references = [...svg.matchAll(/(?:href|src)="([^"]*)"/gu)].map(
        (match) => match[1] ?? '',
      );
      expect(references.filter((reference) => !reference.startsWith('data:'))).toEqual([]);
    }
  });
});

/**
 * TYTO-60: the same picture, said in geometry an importer cannot drop.
 *
 * Every assertion here is about *how* the output says something rather than what it says,
 * which is unusual and is the point. Figma's importer ignores `preserveAspectRatio` and
 * a nested viewport, and collapses positioned `<tspan>`s into one layer; all three were
 * spec-correct SVG that Chrome rendered perfectly. So what is pinned is the construct,
 * because the construct is the requirement.
 */
describe('geometry a design tool imports', () => {
  it('crops an image itself instead of asking the renderer to', () => {
    // `portrait` is a 160x120 box over an 800x1200 picture, `cover`, focal point (0.5, 0.25).
    // Cover scales by max(160/800, 120/1200) = 0.2, so the picture is drawn 160x240 and the
    // 120 of overflow is taken a quarter from the top: y = (120 - 240) * 0.25 = -30.
    const [feed = ''] = svgOf(sceneOf(mappingFixture));

    expect(feed).toMatch(
      /<g clip-path="url\(#crop\d+\)">\s*<image href="[^"]*" width="800" height="1200" preserveAspectRatio="none" transform="translate\(0 -30\) scale\(0\.2\)"\/>\s*<\/g>/u,
    );
    expect(feed).not.toContain('slice');
  });

  it('crops an image paint the same way, inside the pattern', () => {
    // `story-bg` fills 1080x1920 with the same 1600x900 hero: cover scales by 1920/900 and
    // the picture comes out 3413.33 wide, so more than half of it is off the frame.
    const [, story = ''] = svgOf(sceneOf(promoFixture));

    expect(story).toMatch(/<pattern id="paint\d+" width="1080" height="1920"/u);
    expect(story).toMatch(
      /<g clip-path="url\(#crop\d+\)">\s*<image [^>]*width="1600" height="900" preserveAspectRatio="none" transform="translate\(-1166\.6667 0\) scale\(2\.1333\)"\/>\s*<\/g>/u,
    );
    expect(story).not.toContain('xMidYMid');
  });

  it('places a focal point exactly, where it used to snap it to a ninth', () => {
    // 0.25 is not one of `preserveAspectRatio`'s nine alignments, so it used to be rounded
    // to `YMin` and reported. An offset is a number, and a number has no ninths.
    const measured = problemsOf(sceneOf(mappingFixture), { resources });
    const snapping = problemsOf(sceneOf(mappingFixture), { resources: unmeasured });

    expect(measured.map((item) => item.message).join(' ')).not.toContain('focal point');
    expect(snapping.map((item) => item.message).join(' ')).toContain(
      'a focal point off the thirds',
    );
  });

  it('falls back to preserveAspectRatio when nobody measured the picture', () => {
    // Not a diagnostic: only a composition root can wire the port, and a brief's author
    // cannot act on a warning about one. It is the output this exporter emitted before.
    const [feed = ''] = svgOf(sceneOf(mappingFixture), { resources: unmeasured });

    expect(feed).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(feed).not.toContain('clip-path="url(#crop');
  });

  it('scales an inline SVG file with a transform, not with a nested viewport', () => {
    // `inline-mark` is a 24x24 file on a 48x48 node. Nested, Figma imported it at 24x24.
    const [feed = ''] = svgOf(sceneOf(mappingFixture));
    const mark = /<g id="inline-mark"[^>]*>([\s\S]*?)<\/g>\s*<g id="copy"/u.exec(feed)?.[1] ?? '';

    expect(mark).toContain('<g transform="scale(2)" fill="#ffbd00">');
    expect(mark).toContain('<circle cx="12" cy="12" r="10"/>');
    // The whole of the fix: there is no second viewport left in the document.
    expect(feed.match(/<svg/gu)).toHaveLength(1);
  });

  it('draws one text element per line, so each line is a layer of its own', () => {
    // `copy` is two lines. As one `<text>` with two positioned `<tspan>`s, Figma imported
    // them as a single 34px-tall layer named `Turma nova<matrículas & vagas>`.
    const [feed = ''] = svgOf(sceneOf(mappingFixture));
    const texts = [...feed.matchAll(/<text [^>]*y="([\d.]+)"/gu)].map((match) => match[1]);

    expect(texts).toEqual(['53.05', '76.5']);
    // The `<tspan>`s that are left are runs inside a line, which is what a tspan is for.
    expect(feed).not.toMatch(/<tspan x=/u);
  });
});

describe('--text-as-paths leaves no text behind', () => {
  it('draws every run as a path when an outline resolver is supplied', () => {
    const [feed = ''] = svgOf(sceneOf(mappingFixture), {
      resources: outlining,
      textAsPaths: true,
    });

    expect(feed).not.toContain('<text');
    expect(feed).not.toContain('<tspan');
    expect(feed).not.toContain('@font-face');
    // The copy node has three runs on two lines, so three paths carry it.
    expect([...feed.matchAll(/<path d="M0 0 h/gu)]).toHaveLength(3);
  });

  it('still draws text as text when the flag is off', () => {
    const [feed = ''] = svgOf(sceneOf(mappingFixture));

    expect(feed).toContain('<text');
    expect(feed).toContain('@font-face');
  });

  it('reports the flag it could not honour, and draws the words as text anyway', () => {
    // `?? ''` was the old answer and it dropped the headline out of the picture, which is
    // the hole that kept `E_EXPORT_UNSUPPORTED` fatal (ADR 0035). The error still rides
    // along — the export asked for a document depending on no font and did not get one —
    // and the reader gets the words, through the faces every other SVG here embeds.
    const result = exportSvg(sceneOf(mappingFixture), { resources, textAsPaths: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const unsupported = result.diagnostics.filter((item) => item.code === 'E_EXPORT_UNSUPPORTED');
    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported[0]?.message).toContain('no outline resolver was supplied');
    expect(result.value[0]?.svg).toContain('<text');
    expect(result.value[0]?.svg).toContain('@font-face');
  });
});

describe('what SVG can say precisely and export-html cannot', () => {
  it('clips an inside stroke instead of letting it straddle the outline', () => {
    const [feed = ''] = svgOf(sceneOf(mappingFixture));

    // `gradient-stroke` is 4px inside, so it is drawn at 8 and clipped to the shape.
    expect(feed).toContain('<clipPath id="stroke');
    expect(feed).toContain('stroke-width="8"');
  });

  it('masks an outside stroke so only its outer half survives', () => {
    const [feed = ''] = svgOf(sceneOf(mappingFixture));

    // `spun` is 2px outside: doubled to 4, with the shape knocked out of the mask.
    expect(feed).toContain('<mask id="stroke');
    expect(feed).toContain('fill="#000000"');
  });

  it('draws a shadow spread, which CSS drop-shadow() has no room for', () => {
    const result = exportSvg(sceneOf(mappingFixture), { resources });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [feed = ''] = result.value.map((frame) => frame.svg);
    expect(feed).toContain('<feMorphology');
    expect(feed).toContain('operator="dilate"');
    expect(feed).toContain('radius="3"');
    // And nothing is reported about it: this exporter drew what the IR asked for.
    expect(result.diagnostics.map((item) => item.message).join(' ')).not.toContain('spread');
  });

  it('uses the short feDropShadow when there is no spread to draw', () => {
    const [feed = ''] = svgOf(sceneOf(promoFixture));

    expect(feed).toContain('<feDropShadow');
    expect(feed).not.toContain('<feMorphology');
  });
});

describe('what SVG cannot say, it reports', () => {
  it('has no backdrop filter, and says the background blur is missing', () => {
    const result = exportSvg(sceneOf(mappingFixture), { resources });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.diagnostics.map((item) => item.message)).toContain(
      "'copy': a background blur is approximated by export-svg — SVG has no backdrop filter, so the blur behind the node is not drawn; the raster and the HTML export do draw it.",
    );
  });

  it('ignores clip on a group, the same way export-html does (ADR 0018)', () => {
    const result = exportSvg(sceneOf(mappingFixture), { resources });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.diagnostics.map((item) => item.message)).toContain(
      "'clipped': clip on a group is approximated by export-svg — there is no box to clip to; put the flag on the node that declares one.",
    );
    // The inside stroke on `gradient-stroke` uses a clip path of its own, so the check is
    // that the group is not the thing carrying one.
    expect(result.value[0]?.svg).not.toMatch(/<g id="clipped"[^>]*clip-path/u);
  });

  it('refuses an asset and a font nobody resolved', () => {
    const codes = problemsOf(sceneOf(promoFixture), {}).map((item) => item.code);

    expect(codes).toContain('E_EXPORT_ASSET_UNRESOLVED');
    expect(codes).toContain('E_EXPORT_FONT_UNRESOLVED');
  });

  it('draws the gap mark where an asset nobody resolved would have gone', () => {
    // The font resolver stays: `E_EXPORT_FONT_UNRESOLVED` is still fatal, and leaving it
    // out would make this pass for the wrong reason.
    const result = exportSvg(sceneOf(promoFixture), { resources: fontsOnly });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_EXPORT_ASSET_UNRESOLVED');
    expect(result.value.map((frame) => frame.svg).join('')).toContain(GAP_ASSET_URI);
  });

  it('puts nothing of the mark in an export where every asset resolved', () => {
    // The control: a healthy scene carrying a failure signal would be worse than one that
    // never drew it.
    expect(svgOf(sceneOf(promoFixture)).join('')).not.toContain('ff00aa');
  });
});

describe('a mask is a def, drawn in the masked node’s coordinates', () => {
  it('answers a mask naming a node outside the frame with one that hides nothing', () => {
    // The invariant only forbids masking by a *descendant*, so a scene may legally name a
    // node drawn in another frame — and an SVG document is built one frame at a time, so
    // this one cannot reach it. The `mask` attribute is already written by the time that
    // is known, so leaving the def out would point it at nothing and let each renderer
    // decide what to do; a pass-through mask says *this mask does nothing* in a vocabulary
    // they all read the same way (ADR 0035).
    const scene = sceneOf({
      version: 1,
      fonts: [],
      assets: [],
      artworks: [
        {
          id: 'here',
          frames: [
            {
              format: 'feed',
              size: { w: 100, h: 100 },
              children: [
                {
                  kind: 'rect',
                  id: 'masked',
                  size: { w: 50, h: 50 },
                  radius: [0, 0, 0, 0],
                  fill: { kind: 'solid', color: { r: 0, g: 0, b: 0 } },
                  mask: { nodeId: 'elsewhere', mode: 'alpha' },
                },
              ],
            },
          ],
        },
        {
          id: 'there',
          frames: [
            {
              format: 'feed',
              size: { w: 100, h: 100 },
              children: [
                { kind: 'rect', id: 'elsewhere', size: { w: 50, h: 50 }, radius: [0, 0, 0, 0] },
              ],
            },
          ],
        },
      ],
    });

    const result = exportSvg(scene, { resources });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_EXPORT_UNSUPPORTED');

    const [feed = ''] = result.value.map((frame) => frame.svg);
    const reference = /mask="url\(#(mask\d+)\)"/u.exec(feed)?.[1];
    expect(reference).toBeDefined();
    // The def exists, so the reference resolves, and its one rect is white — opaque under
    // a luminance mask and fully opaque under an alpha one.
    expect(feed).toContain(`<mask id="${String(reference)}"`);
    expect(feed).toContain('fill="#ffffff"');
  });

  it('places a mask that shares its target’s transform at the origin', () => {
    const [feed = ''] = svgOf(sceneOf(mappingFixture));
    const mask = /<mask id="mask\d+"[^>]*>([\s\S]*?)<\/mask>/u.exec(feed)?.[1] ?? '';

    // `portrait` and `fade` are both at x20 y130, so inside the portrait the fade sits at
    // the origin and no transform survives the subtraction.
    expect(mask).not.toContain('transform=');
    // The gradient itself is a `<defs>` entry the mask names, not a copy inside it.
    expect(mask).toMatch(/fill="url\(#paint\d+\)"/u);
    expect(feed).toContain('mask-type:alpha');
  });

  it('draws a mask whose node is hidden, because being hidden is why it exists', () => {
    const [feed = ''] = svgOf(sceneOf(promoFixture));
    const mask = /<mask id="mask\d+"[^>]*>([\s\S]*?)<\/mask>/u.exec(feed)?.[1] ?? '';

    // `badge-mask` is `visible: false`; the element in the tree is hidden and the mask is
    // not, which is the whole point of the node.
    expect(mask).toContain('<path');
    expect(mask).not.toContain('display="none"');
    expect(feed).toContain('<g id="badge-mask"');
    expect(feed).toContain('display="none"');
  });
});
