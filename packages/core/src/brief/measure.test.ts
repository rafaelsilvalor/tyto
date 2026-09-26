import { describe, expect, it } from 'vitest';

import type { BriefAst } from './ast.js';
import { compile } from './compile.js';
import { resolve } from './resolve.js';
import { formatCatalogue } from '../config/formats.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import type { RectNode, TextNode, TextSpan } from '../scene/nodes.js';
import type { Scene } from '../scene/scene.js';
import { sourceRange } from '../source/range.js';
import { type Template, defineTemplate } from '../template/define.js';
import { parseManifest } from '../template/manifest.js';
import { frame, rect, text } from '../template/nodes.js';
import type { TemplateRegistry } from '../template/registry.js';
import { runsOf } from '../template/runs.js';
import { font } from '../template/values.js';
import type { Face, FaceCache } from '../text/face.js';
import { type TextMeasurement, measureText } from '../text/layout.js';

/**
 * A template asks how big its text will be before it places it (TYTO-162, ADR 0038).
 *
 * The template below is the smallest one that needs the answer: a pill as tall as the
 * title inside it. Every number is arithmetic on the face below, so the pill's height is a
 * fixture — a `measure` that returned anything else would move it.
 */

const parsed = parseManifest(
  `name: pill
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text, required: true }
`,
  'manifest.yaml',
);
if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
const MANIFEST = parsed.value;

const registry: TemplateRegistry = {
  list: () => [MANIFEST],
  get: (name) => (name === MANIFEST.name ? MANIFEST : undefined),
  formatsOf: (name) => (name === MANIFEST.name ? MANIFEST.formats : undefined),
  directoryOf: () => 'templates/pill',
  failures: [],
};

const assets: AssetResolver = { base: 'briefs/', resolve: () => Promise.resolve(undefined) };
const FORMATS = formatCatalogue({ feed: { w: 400, h: 400 } });

/** Half an em a character: at 20px, ten pixels each, so a 60px box holds six. */
const EVEN: Face = { advance: (value) => value.length * 0.5, contentHeight: 1.2 };
const faces: FaceCache = { get: () => EVEN };

const PADDING = 12;
/** What the pill falls back to when nothing can measure — a guess, and known to be one. */
const GUESS = 80;

/**
 * The pill, and what `measure` told it, so a test can compare the two.
 *
 * The answer is recorded rather than recomputed in the test: the claim is about what the
 * template was handed, not about what `measureText` would say if asked again.
 */
function pillTemplate(seen: (TextMeasurement | undefined)[]): Template {
  return defineTemplate(MANIFEST, (context) => {
    const titulo = context.slots.titulo?.value;
    const title = text({
      id: 'title',
      box: { w: 60 },
      lineHeight: 1.5,
      runs: runsOf(titulo?.kind === 'rich-text' ? titulo.text : [], {
        font: font('Test'),
        size: 20,
        color: '#000000',
      }) as [TextSpan, ...TextSpan[]],
    });

    const measured = context.measure(title);
    seen.push(measured);
    const height = measured === undefined ? GUESS : measured.height + PADDING * 2;

    return frame({
      format: context.format,
      size: context.size,
      idPrefix: context.idPrefix,
      children: [rect({ id: 'pill', size: { w: 84, h: height } }), title],
    });
  });
}

const BRIEF: BriefAst = {
  frontmatter: { data: { template: 'pill' }, ranges: {}, range: sourceRange(0, 20) },
  directives: [
    {
      name: 'titulo',
      adjustments: [],
      body: [
        {
          kind: 'text',
          // Seven lines at six characters a line: uma / manchete / longa / demais / para /
          // esta / caixa. `manchete` is eight and overflows its line, which CSS does too.
          value: 'uma manchete longa demais para esta caixa',
          range: sourceRange(30, 72),
        },
      ],
      range: sourceRange(20, 80),
      nameRange: sourceRange(20, 28),
    },
  ],
  range: sourceRange(0, 80),
};

async function compiled(
  withFaces: boolean,
): Promise<{ scene: Scene; seen: (TextMeasurement | undefined)[] }> {
  const brief = await resolve(BRIEF, { registry, assets });
  if (!brief.ok) throw new Error(brief.error.map((item) => item.message).join('; '));

  const seen: (TextMeasurement | undefined)[] = [];
  const result = compile(brief.value, pillTemplate(seen), {
    formats: FORMATS,
    ...(withFaces ? { faces } : {}),
  });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return { scene: result.value, seen };
}

function node<Kind extends 'rect' | 'text'>(
  scene: Scene,
  id: string,
  kind: Kind,
): Kind extends 'rect' ? RectNode : TextNode {
  const found = scene.artworks[0]?.frames[0]?.children.find((child) => child.id.endsWith(id));
  if (found?.kind !== kind) throw new Error(`No ${kind} '${id}'.`);
  return found as Kind extends 'rect' ? RectNode : TextNode;
}

describe('a template that measures its text before placing it', () => {
  it('sizes the pill from the measured title: seven lines of 30px, and the padding', async () => {
    const { scene } = await compiled(true);

    // 7 lines × 1.5 × 20px = 210, and 12 above and below. The fixture that a `measure`
    // returning anything else turns red.
    expect(node(scene, 'pill', 'rect').size.h).toBe(234);
  });

  it('is told what compile then lays out, so the same text never gets two heights', async () => {
    const { scene, seen } = await compiled(true);

    // The laid-out node, measured again: its breaks are now explicit runs, and it still
    // comes to the height the template was given before it placed the pill.
    const laid = measureText(node(scene, 'title', 'text'), faces);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.height).toBe(laid?.height);
    expect(seen[0]?.lines).toBe(laid?.lines);
  });

  it('is told "unmeasurable" — undefined, not zero — when no faces were wired', async () => {
    const { scene, seen } = await compiled(false);

    expect(seen).toEqual([undefined]);
    // The template guessed, knowingly, and the guess is what was drawn.
    expect(node(scene, 'pill', 'rect').size.h).toBe(GUESS);
  });
});
