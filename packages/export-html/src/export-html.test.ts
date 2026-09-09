import type { Diagnostic, Scene } from '@tyto/core';
import { parseScene } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { exportHtml } from './export-html.js';
import type { HtmlResources } from './html.js';
import mappingFixture from './__fixtures__/mapping.json';
import promoFixture from './__fixtures__/promo.json';

/**
 * The acceptance criteria are two: a committed snapshot per fixture, and markup that is
 * well formed and loads offline. The first is one test per fixture; the second is a real
 * check rather than a promise, because "no unclosed tags" is the kind of claim a string
 * builder breaks silently and a snapshot review would not catch.
 *
 * The fixtures are `Scene` JSON rather than the `.brief` files `docs/conventions.md`
 * names for an exporter. A brief becomes a scene through `resolve`, `compile` and a
 * template, and the first template lands in E4.4 — so a `.brief` fixture here would be
 * testing three stages that do not exist yet. The scenes are parsed by `parseScene` in
 * the first test, which is what keeps them honest IR and not hand-waved shapes.
 */

/**
 * Bytes, stubbed so the snapshots stay readable and the test stays deterministic.
 *
 * The hash is what a real resolver keys on — `docs/ir-schema.md` says an asset carries a
 * content hash so the same brief produces the same bytes — so echoing it is a stand-in
 * that would change if the fixture's asset changed.
 */
const resources: HtmlResources = {
  asset: (ref) => `data:image/jpeg;base64,${ref.hash}`,
  font: (face) => `data:font/woff2;base64,${face.font.family}-${String(face.weight)}-${face.style}`,
};

function sceneOf(fixture: unknown): Scene {
  const parsed = parseScene(fixture);
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

function problemsOf(scene: Scene, options = { resources }): readonly Diagnostic[] {
  const result = exportHtml(scene, options);
  return result.ok ? result.warnings : result.error;
}

function htmlOf(scene: Scene): readonly string[] {
  const result = exportHtml(scene, { resources });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value.map((frame) => frame.html);
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/**
 * Every element opened is closed, in order.
 *
 * Deliberately not a regex over the whole document: the point is the nesting, and the
 * stack is the only thing that sees a `</div>` that closed a `<span>`. Attribute values
 * are skipped through rather than parsed, because a mask carries a whole SVG document
 * inside one of them.
 */
function unclosedTags(html: string): string[] {
  const stack: string[] = [];
  const problems: string[] = [];
  const tags = html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|[^>"])*)>/gu);

  for (const tag of tags) {
    const [, slash, name = '', rest = ''] = tag;
    if (name.toLowerCase() === '!doctype') continue;
    if (slash === '/') {
      const open = stack.pop();
      if (open !== name) problems.push(`</${name}> closes <${open ?? 'nothing'}>`);
      continue;
    }
    if (rest.trimEnd().endsWith('/') || VOID_ELEMENTS.has(name.toLowerCase())) continue;
    stack.push(name);
  }

  return [...problems, ...stack.map((name) => `<${name}> is never closed`)];
}

describe('a scene becomes one self-contained document per frame', () => {
  it('renders the promo fixture to its committed snapshot', async () => {
    const [feed, story] = htmlOf(sceneOf(promoFixture));

    await expect(feed).toMatchFileSnapshot('./__snapshots__/promo.feed.html');
    await expect(story).toMatchFileSnapshot('./__snapshots__/promo.story.html');
  });

  it('renders the mapping fixture to its committed snapshot', async () => {
    const [feed] = htmlOf(sceneOf(mappingFixture));

    await expect(feed).toMatchFileSnapshot('./__snapshots__/mapping.feed.html');
  });

  it('closes every tag it opens, in both fixtures', () => {
    const documents = [...htmlOf(sceneOf(promoFixture)), ...htmlOf(sceneOf(mappingFixture))];

    expect(documents.flatMap(unclosedTags)).toEqual([]);
    expect(documents).toHaveLength(3);
  });

  it('makes no request to anything outside the document', () => {
    const documents = [...htmlOf(sceneOf(promoFixture)), ...htmlOf(sceneOf(mappingFixture))];

    for (const html of documents) {
      // Every `url(` and every `src=` in the output has to be self-contained. `data:` is
      // the only scheme that is, and a bare path would be a file the rasterizer cannot
      // reach from a `data:`-less temporary directory.
      const references = [...html.matchAll(/(?:url\("|src=")([^"]*)"/gu)].map(
        (match) => match[1] ?? '',
      );
      expect(references.filter((reference) => !reference.startsWith('data:'))).toEqual([]);
    }
  });

  it('gives one frame per artwork per format, tagged with both', () => {
    const result = exportHtml(sceneOf(promoFixture), { resources });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map((item) => `${item.artwork.id}:${item.frame.format}`)).toEqual([
      'slide-1:feed',
      'slide-1:story',
    ]);
  });
});

describe('a node carries its own transform, and the browser composes the rest', () => {
  it('writes the node matrix, not the accumulated one', () => {
    // `copy` sits at y 660 and `badge` at the origin; if the exporter had used
    // `VisitContext.transform`, the group's 660 would appear twice — once on the group
    // and once inside it.
    const [feed = ''] = htmlOf(sceneOf(promoFixture));

    expect(feed).toContain('transform: matrix(1, 0, 0, 1, 0, 660)');
    expect(feed.match(/matrix\(1, 0, 0, 1, 0, 660\)/gu)).toHaveLength(1);
  });

  it('escapes the dots in an id so the selector still matches', () => {
    const scene = sceneOf({
      ...(promoFixture as object),
      artworks: [
        {
          id: 'slide-1',
          frames: [
            {
              format: 'feed',
              size: { w: 10, h: 10 },
              children: [
                {
                  kind: 'rect',
                  id: 'slide-1.feed.badge',
                  size: { w: 4, h: 4 },
                  radius: [0, 0, 0, 0],
                  transform: { x: 1, y: 2 },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(htmlOf(scene)[0]).toContain('#slide-1\\.feed\\.badge {');
  });
});

describe('what the exporter cannot do, it says', () => {
  it('refuses an asset nobody resolved rather than leaving a hole', () => {
    const problems = problemsOf(sceneOf(promoFixture), { resources: {} });

    expect(problems.map((item) => item.code)).toContain('E_EXPORT_ASSET_UNRESOLVED');
    expect(problems[0]?.severity).toBe('error');
  });

  it('refuses a font nobody resolved, because the output has to be the same every time', () => {
    const problems = problemsOf(sceneOf(promoFixture), {
      resources: { asset: (ref) => `data:image/jpeg;base64,${ref.hash}` },
    });

    expect(problems.map((item) => item.message)).toContain(
      "Font 'Inter 700 normal' was not resolved to embeddable bytes; text would render in whatever the viewer has, and the output must be deterministic.",
    );
  });

  it('warns that a shadow spread is not drawn, and still draws the shadow', () => {
    const scene = sceneOf(mappingFixture);
    const result = exportHtml(scene, { resources });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((item) => item.message)).toContain(
      "'spun': a shadow with a spread is approximated by export-html — CSS drop-shadow() has no spread, so 3px of it is not drawn.",
    );
    expect(result.value[0]?.html).toContain('drop-shadow(0px 4px 12px rgba(0, 0, 0, 0.5))');
  });

  it('refuses a text used as a mask instead of dropping it silently', () => {
    const scene = sceneOf({
      version: 1,
      fonts: [{ family: 'Inter', source: 'bundled' }],
      artworks: [
        {
          id: 'a',
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
                  mask: { nodeId: 'letters', mode: 'alpha' },
                },
                {
                  kind: 'text',
                  id: 'letters',
                  visible: false,
                  box: { w: 50, h: 50 },
                  align: 'left',
                  valign: 'top',
                  lineHeight: 1.2,
                  overflow: 'clip',
                  runs: [
                    {
                      kind: 'text',
                      text: 'A',
                      font: { family: 'Inter', source: 'bundled' },
                      size: 40,
                      weight: 400,
                      style: 'normal',
                      color: { kind: 'solid', color: { r: 255, g: 255, b: 255 } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const problems = problemsOf(scene);

    expect(problems.map((item) => item.code)).toEqual(['E_EXPORT_UNSUPPORTED']);
    expect(problems[0]?.message).toContain('a text node inside a mask');
  });
});

describe('the mask is a document of its own', () => {
  it('draws the mask node in the masked node’s coordinates', () => {
    const [feed = ''] = htmlOf(sceneOf(mappingFixture));
    const uri = /mask-image: url\("data:image\/svg\+xml,([^"]*)"\)/u.exec(feed)?.[1] ?? '';
    const markup = uri.replaceAll('%23', '#').replaceAll('%22', '"').replaceAll('%25', '%');

    // `portrait` and `fade` share the transform x20 y130, so inside the portrait's own
    // box the fade sits at the origin: no transform survives the subtraction.
    expect(markup).toContain('viewBox="0 0 160 120"');
    expect(markup).not.toContain('transform=');
    expect(markup).toContain('<linearGradient');
    expect(feed).toContain('mask-mode: alpha');
  });

  it('keeps a mask that is hidden, because being hidden is why it exists', () => {
    const [feed = ''] = htmlOf(sceneOf(mappingFixture));

    // `fade` is `visible: false` and still produces a mask; the element itself is the
    // thing that must not paint.
    expect(feed).toContain('#fade { transform: matrix(1, 0, 0, 1, 20, 130); display: none;');
    expect(feed).toContain('mask-image:');
  });
});

describe('the SVG renderer inside this exporter', () => {
  /**
   * A rect whose stroke is not a colour drops to inline SVG to keep the paint, and a mask
   * is inline SVG by definition. Both can carry an image, and both used to write the
   * pattern in bounding-box units — where the image's viewport is the unit *square*, so
   * `preserveAspectRatio` fits the picture to a square that is then stretched to the box.
   * Chrome rendered the same defect in `export-svg` as 972151 of 2073600 differing pixels.
   */
  it('gives an image paint the node’s real box, so cover does not distort it', () => {
    const scene = sceneOf({
      version: 1,
      assets: [{ id: 'p', source: 'file', path: 'p.png', hash: 'h1' }],
      artworks: [
        {
          id: 'a',
          frames: [
            {
              format: 'feed',
              size: { w: 400, h: 200 },
              children: [
                {
                  kind: 'rect',
                  id: 'wide',
                  size: { w: 400, h: 200 },
                  radius: [0, 0, 0, 0],
                  fill: {
                    kind: 'image',
                    asset: { id: 'p', source: 'file', path: 'p.png', hash: 'h1' },
                    fit: 'cover',
                  },
                  stroke: {
                    paint: {
                      kind: 'linear-gradient',
                      angle: 90,
                      stops: [
                        { offset: 0, color: { r: 255, g: 255, b: 255 } },
                        { offset: 1, color: { r: 0, g: 0, b: 0 } },
                      ],
                    },
                    width: 4,
                    align: 'center',
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const html = htmlOf(scene)[0] ?? '';

    // The inline SVG is body markup, not an attribute, so its quotes are literal here;
    // only a mask travels through HTML escaping.
    expect(html).toContain('patternUnits="userSpaceOnUse"');
    expect(html).not.toContain('objectBoundingBox');
    expect(html).toContain('<pattern id="p0" width="400" height="200"');
  });
});
