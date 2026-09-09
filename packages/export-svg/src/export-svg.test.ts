import type { Diagnostic, Scene } from '@tyto/core';
import { parseScene } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import type { SvgResources } from './defs.js';
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

const resources: SvgResources = {
  asset: (ref) => `data:image/jpeg;base64,${ref.hash}`,
  font: (face) => `data:font/woff2;base64,${face.family}-${String(face.weight)}-${face.style}`,
};

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
  return result.ok ? result.warnings : result.error;
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
    expect(story).toMatch(
      /<image [^>]*width="1080" height="1920" preserveAspectRatio="xMidYMid slice"/u,
    );
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

  it('refuses the flag rather than silently leaving text, when nobody can outline it', () => {
    const problems = problemsOf(sceneOf(mappingFixture), { resources, textAsPaths: true });

    expect(problems.map((item) => item.code)).toContain('E_EXPORT_UNSUPPORTED');
    expect(problems.find((item) => item.code === 'E_EXPORT_UNSUPPORTED')?.message).toContain(
      'no outline resolver was supplied',
    );
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
    expect(result.warnings.map((item) => item.message).join(' ')).not.toContain('spread');
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

    expect(result.warnings.map((item) => item.message)).toContain(
      "'copy': a background blur is approximated by export-svg — SVG has no backdrop filter, so the blur behind the node is not drawn; the raster and the HTML export do draw it.",
    );
  });

  it('ignores clip on a group, the same way export-html does (ADR 0018)', () => {
    const result = exportSvg(sceneOf(mappingFixture), { resources });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings.map((item) => item.message)).toContain(
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
});

describe('a mask is a def, drawn in the masked node’s coordinates', () => {
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
