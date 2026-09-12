import { describe, expect, it } from 'vitest';

import type { BriefAst, Directive, RichText } from './ast.js';
import { compile } from './compile.js';
import { resolve } from './resolve.js';
import { formatCatalogue } from '../config/formats.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import type { TextNode, TextSpan } from '../scene/nodes.js';
import type { Scene } from '../scene/scene.js';
import { sourceRange } from '../source/range.js';
import { type Template, defineTemplate } from '../template/define.js';
import { type TemplateManifest, parseManifest } from '../template/manifest.js';
import { frame, text } from '../template/nodes.js';
import type { TemplateRegistry } from '../template/registry.js';
import { runsOf } from '../template/runs.js';
import { font } from '../template/values.js';
import type { Face, FaceCache } from '../text/face.js';

/**
 * Text laid out inside `compile`, and the warning that points back at the brief.
 *
 * The measuring itself is `text/layout.test.ts`; what is under test here is the wiring —
 * that a scene comes out of `compile` with its breaks already decided, that a shrink has
 * actually been applied to the runs, and that `W_TEXT_OVERFLOW` names the **directive** the
 * author wrote rather than a node id nobody can search for.
 *
 * The ranges in this brief are deliberately distinct. The older `compile.test.ts` gives
 * every node the same one-character range, which is fine for what it asserts and useless
 * here: finding the slot behind a run is a containment test, and it proves nothing if every
 * range contains every other.
 */

const MANIFEST_SOURCE = `name: fit
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text, required: true }
  legenda: { type: rich-text }
`;

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const MANIFEST = manifestOf(MANIFEST_SOURCE);

const registry: TemplateRegistry = {
  list: () => [MANIFEST],
  get: (name) => (name === MANIFEST.name ? MANIFEST : undefined),
  formatsOf: (name) => (name === MANIFEST.name ? MANIFEST.formats : undefined),
  directoryOf: () => 'templates/fit',
  failures: [],
};

const assets: AssetResolver = { base: 'briefs/', resolve: () => Promise.resolve(undefined) };

const FORMATS = formatCatalogue({ feed: { w: 400, h: 400 } });

/** Half an em a character, so every width in the assertions is arithmetic. */
const EVEN: Face = { advance: (value) => value.length * 0.5, contentHeight: 1.2 };
const faces: FaceCache = { get: () => EVEN };

const testFont = font('Test');

/**
 * `titulo` in a box that cannot hold it, `legenda` in one that can.
 *
 * `overflow` is a parameter so one template covers the clip case and the shrink case; the
 * boxes are sized from the arithmetic above rather than guessed at.
 */
function templateWith(overflow: 'clip' | 'shrink'): Template {
  return defineTemplate(MANIFEST, (context) => {
    const titulo = context.slots.titulo?.value;
    const legenda = context.slots.legenda?.value;

    return frame({
      format: context.format,
      size: context.size,
      idPrefix: context.idPrefix,
      children: [
        text({
          id: 'headline',
          // 20px type at half an em is 10px a character, so 60px holds six of them and the
          // headline needs seven lines. 30px of box can never hold that; 90px can once the
          // type has shrunk, which is the difference the two cases are about.
          box: { w: 60, h: overflow === 'shrink' ? 90 : 30 },
          lineHeight: 1.5,
          overflow,
          runs: runsOf(titulo?.kind === 'rich-text' ? titulo.text : [], {
            font: testFont,
            size: 20,
            color: '#ffffff',
          }) as [TextSpan, ...TextSpan[]],
        }),
        ...(legenda?.kind === 'rich-text'
          ? [
              text({
                id: 'caption',
                box: { w: 400, h: 200 },
                runs: runsOf(legenda.text, {
                  font: testFont,
                  size: 10,
                  color: '#ffffff',
                }) as [TextSpan, ...TextSpan[]],
              }),
            ]
          : []),
      ],
    });
  });
}

/** Distinct, non-overlapping ranges: the whole point of this fixture. */
const TITULO_RANGE = sourceRange(50, 120);
const LEGENDA_RANGE = sourceRange(200, 260);

function richText(value: string, at: { start: number; end: number }): RichText {
  return [{ kind: 'text', value, range: sourceRange(at.start, at.end) }];
}

function directive(name: string, body: RichText, range: { start: number; end: number }): Directive {
  return { name, adjustments: [], body, range: sourceRange(range.start, range.end) };
}

const BRIEF: BriefAst = {
  frontmatter: { data: { template: 'fit' }, ranges: {}, range: sourceRange(0, 40) },
  directives: [
    directive(
      'titulo',
      richText('uma manchete longa demais para esta caixa', { start: 60, end: 110 }),
      TITULO_RANGE,
    ),
    directive('legenda', richText('cabe', { start: 210, end: 250 }), LEGENDA_RANGE),
  ],
  range: sourceRange(0, 300),
};

async function compiledWith(
  overflow: 'clip' | 'shrink',
  withFaces = true,
): Promise<{
  scene: Scene;
  warnings: readonly { code: string; range?: unknown; message: string }[];
}> {
  const brief = await resolve(BRIEF, { registry, assets });
  if (!brief.ok) throw new Error(brief.error.map((item) => item.message).join('; '));

  const result = compile(brief.value, templateWith(overflow), {
    formats: FORMATS,
    ...(withFaces ? { faces } : {}),
  });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));

  return { scene: result.value, warnings: result.warnings };
}

function nodeById(scene: Scene, id: string): TextNode {
  const found = scene.artworks[0]?.frames[0]?.children.find((child) => child.id === id);
  if (found === undefined || found.kind !== 'text') throw new Error(`No text node '${id}'.`);
  return found;
}

function linesOf(node: TextNode): string[] {
  const lines: string[] = [''];
  for (const run of node.runs) {
    if (run.kind === 'break') lines.push('');
    else lines[lines.length - 1] += run.text;
  }
  return lines;
}

describe('a scene leaves compile with its lines decided', () => {
  it('wraps the text the template did not wrap', async () => {
    const { scene } = await compiledWith('clip');

    // The template handed `compile` one run and no breaks; six characters fit a line.
    expect(linesOf(nodeById(scene, 'headline')).length).toBeGreaterThan(1);
  });

  it('leaves it alone when nothing can measure', async () => {
    const { scene } = await compiledWith('clip', false);

    expect(linesOf(nodeById(scene, 'headline'))).toEqual([
      'uma manchete longa demais para esta caixa',
    ]);
  });

  it('does not touch a text that already fits', async () => {
    const { scene } = await compiledWith('clip');

    expect(linesOf(nodeById(scene, 'caption'))).toEqual(['cabe']);
  });
});

describe('W_TEXT_OVERFLOW', () => {
  it('names the slot the author wrote, not the node id', async () => {
    const { warnings } = await compiledWith('clip');
    const overflow = warnings.find((item) => item.code === 'W_TEXT_OVERFLOW');

    expect(overflow).toBeDefined();
    expect(overflow?.message).toContain("slot 'titulo'");
    expect(overflow?.message).toContain("format 'feed'");
    // `headline` is the node; naming it would send the author looking through a template
    // they may not have written.
    expect(overflow?.message).not.toContain('headline');
  });

  it('points at the directive, so an editor can put the squiggle somewhere', async () => {
    const { warnings } = await compiledWith('clip');
    const overflow = warnings.find((item) => item.code === 'W_TEXT_OVERFLOW');

    expect(overflow?.range).toEqual(TITULO_RANGE);
  });

  it('says nothing about the text that fits', async () => {
    const { warnings } = await compiledWith('clip');

    expect(warnings.filter((item) => item.code === 'W_TEXT_OVERFLOW')).toHaveLength(1);
  });

  it('is silent once a shrink has made the text fit', async () => {
    const { scene, warnings } = await compiledWith('shrink');

    expect(warnings.filter((item) => item.code === 'W_TEXT_OVERFLOW')).toHaveLength(0);

    // And the shrink is in the IR, not left as an intent for an exporter to honour.
    const headline = nodeById(scene, 'headline');
    const sizes = headline.runs
      .filter((run): run is TextSpan => run.kind === 'text')
      .map((run) => run.size);
    expect(Math.max(...sizes)).toBeLessThan(20);
    // `shrink` has happened, so the node clips from here on; leaving it would make every
    // exporter warn that nobody measured it.
    expect(headline.overflow).toBe('clip');
  });
});
