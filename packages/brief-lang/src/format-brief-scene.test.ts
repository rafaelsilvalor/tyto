import {
  type AssetResolver,
  type Scene,
  type TemplateRegistry,
  compile,
  formatCatalogue,
  isOk,
  parseManifest,
} from '@tyto/core';
import { resolve } from '@tyto/core';
import { defineTemplate, font, frame, runsOf, text } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { formatBrief } from './format-brief.js';
import { parseBrief } from './parse-brief.js';

/**
 * TYTO-749: Format Brief keeps a blank line inside a block exactly where it is a paragraph — a
 * line of text of the block on each side, comments skipped (ADR 0204, ADR 0205) — and the
 * formatted brief compiles to the Scene the original does.
 *
 * The test template (ADR 0151) draws its one slot through `runsOf` with a positive
 * `paragraphSpacing`, so a paragraph boundary is a `LineBreak` with `space` in the Scene: a
 * blank line the formatter dropped while it was a paragraph, or one it kept that a later edit
 * could turn into one, would show here as a different Scene.
 */

const MANIFEST = parseManifest(
  `name: paragrafos
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
`,
  'manifest.yaml',
);
if (!MANIFEST.ok) throw new Error(MANIFEST.error.map((item) => item.message).join('; '));
const PARAGRAFOS = MANIFEST.value;

const registry: TemplateRegistry = {
  list: () => [PARAGRAFOS],
  get: (name) => (name === PARAGRAFOS.name ? PARAGRAFOS : undefined),
  formatsOf: (name) => (name === PARAGRAFOS.name ? PARAGRAFOS.formats : undefined),
  directoryOf: () => 'templates/paragrafos',
  failures: [],
};

const assets: AssetResolver = { base: 'briefs/', resolve: () => Promise.resolve(undefined) };

const STYLE = { font: font('Test'), size: 10, color: '#000000' };

const template = defineTemplate(PARAGRAFOS, (context) => {
  const slot = context.slots['titulo'];
  const runs =
    slot?.value.kind === 'rich-text'
      ? runsOf(slot.value.text, STYLE, { paragraphSpacing: 24 })
      : [];
  return frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    children:
      runs.length === 0 ? [] : [text({ name: 'titulo', runs: [runs[0]!, ...runs.slice(1)] })],
  });
});

const FORMATS = formatCatalogue({ feed: { w: 1080, h: 1080 } });

async function sceneOf(brief: string): Promise<Scene> {
  const parsed = parseBrief(brief);
  if (!isOk(parsed)) throw new Error(parsed.error.map((item) => item.message).join('; '));
  const resolved = await resolve(parsed.value, { registry, assets });
  if (!resolved.ok) throw new Error(resolved.error.map((item) => item.message).join('; '));
  const scene = compile(resolved.value, template, { formats: FORMATS });
  if (!scene.ok) throw new Error(scene.error.map((item) => item.message).join('; '));
  return scene.value;
}

function formatted(brief: string): string {
  const result = formatBrief(brief);
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

/** The runs the template drew, as `text` or `break` / `break +24`. */
async function drawnRuns(brief: string): Promise<string[]> {
  const scene = await sceneOf(brief);
  const node = scene.artworks[0]?.frames[0]?.children[0];
  if (node?.kind !== 'text') return [];
  return node.runs.map((run) =>
    run.kind === 'break' ? `break${run.space === undefined ? '' : ` +${run.space}`}` : run.text,
  );
}

const HEAD = '---\ntemplate: paragrafos\nformat: feed\n---\n';

describe('Format Brief and the Scene around a comment (TYTO-749)', () => {
  it.each([
    ['a head with text, a blank line, then a comment', '::titulo Um\n\n  // nota\n  Dois\n'],
    ['a head with text, a comment, then a blank line', '::titulo Um\n  // nota\n\n  Dois\n'],
    ['a head with no text, a comment, then a blank line', '::titulo\n  // nota\n\n  Dois\n'],
    ['a blank line before a comment that ends the block', '::titulo\n  Um\n\n  // nota\n'],
    ['blank, comment, blank between two lines', '::titulo\n  Um\n\n  // nota\n\n  Dois\n'],
    ['a column-0 comment after a blank line', '::titulo\n  Um\n\n// nota\n  Dois\n'],
  ])('compiles %s to the same Scene once formatted', async (_name, body) => {
    const brief = HEAD + body;
    const once = formatted(brief);
    expect(await sceneOf(once)).toEqual(await sceneOf(brief));
    expect(formatted(once)).toBe(once);
  });

  it('draws the paragraph the card measured, so the Scene test can see one', async () => {
    expect(await drawnRuns(HEAD + '::titulo Um\n\n  // nota\n  Dois\n')).toEqual([
      'Um',
      'break +24',
      'Dois',
    ]);
    expect(await drawnRuns(HEAD + '::titulo\n  // nota\n\n  Dois\n')).toEqual(['Dois']);
  });
});
