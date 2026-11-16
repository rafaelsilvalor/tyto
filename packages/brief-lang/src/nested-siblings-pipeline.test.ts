import {
  type AssetResolver,
  type ResolvedSlot,
  type Scene,
  type TemplateRegistry,
  compile,
  formatCatalogue,
  isOk,
  parseManifest,
  resolve,
  slotDepth,
} from '@tyto/core';
import { defineTemplate, frame, rect } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import siblings from './__fixtures__/nested-siblings.brief?raw';
import { formatBrief } from './format-brief.js';
import { parseBrief } from './parse-brief.js';

/**
 * TYTO-746's acceptance (ADR 0207, note of 2026-11-16): two `::bloco` in one slide and two
 * `::paragrafo` in each, by a manifest that declares them `multiple`, compile to the Scene the
 * template draws from `occurrences`; the same brief with every indent removed compiles to the
 * same Scene; Format Brief puts the indents back.
 *
 * The template is a test template written here (ADR 0151): one rectangle per occurrence,
 * named by its path and its text, so the Scene spells out the lists in brief order.
 */

const MANIFEST = parseManifest(
  `name: listas
version: 1.0.0
formats: [feed]
slots:
  lamina: { type: rich-text, repeat: true, min: 1 }
  bloco: { type: rich-text, per: lamina, multiple: true, max: 3 }
  paragrafo: { type: rich-text, per: bloco, multiple: true, required: true }
`,
  'manifest.yaml',
);
if (!MANIFEST.ok) throw new Error(MANIFEST.error.map((item) => item.message).join('; '));
const LISTAS = MANIFEST.value;

const registry: TemplateRegistry = {
  list: () => [LISTAS],
  get: (name) => (name === LISTAS.name ? LISTAS : undefined),
  formatsOf: (name) => (name === LISTAS.name ? LISTAS.formats : undefined),
  directoryOf: () => 'templates/listas',
  failures: [],
};

const assets: AssetResolver = { base: 'briefs/', resolve: () => Promise.resolve(undefined) };

function plain(slot: ResolvedSlot): string {
  if (slot.value.kind !== 'rich-text') return '';
  return slot.value.text
    .map((inline) => (inline.kind === 'text' ? inline.value : inline.kind === 'break' ? ' | ' : ''))
    .join('');
}

/** One rectangle per occurrence, depth first, named `path: text`; a list reads as its entries. */
function rectangles(slots: Readonly<Record<string, ResolvedSlot>>, path: string): string[] {
  return Object.values(slots).flatMap((slot) =>
    (slot.occurrences ?? [slot]).flatMap((each, index) => {
      const here = `${path}${each.name}[${index + 1}]`;
      return [`${here}: ${plain(each)}`, ...rectangles(each.slots ?? {}, `${here}/`)];
    }),
  );
}

const template = defineTemplate(LISTAS, (context) =>
  frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    children: rectangles(context.slots, '').map((name) => rect({ name, size: { w: 10, h: 10 } })),
  }),
);

const FORMATS = formatCatalogue({ feed: { w: 1080, h: 1080 } });

async function sceneOf(text: string): Promise<Scene> {
  const parsed = parseBrief(text);
  if (!isOk(parsed)) throw new Error(parsed.error.map((item) => item.message).join('; '));
  expect(parsed.diagnostics).toEqual([]);
  const resolved = await resolve(parsed.value, { registry, assets });
  if (!resolved.ok) throw new Error(resolved.error.map((item) => item.message).join('; '));
  expect(resolved.diagnostics).toEqual([]);
  const scene = compile(resolved.value, template, { formats: FORMATS });
  if (!scene.ok) throw new Error(scene.error.map((item) => item.message).join('; '));
  return scene.value;
}

const drawn = (scene: Scene): string[][] =>
  scene.artworks.map((artwork) =>
    (artwork.frames[0]?.children ?? []).map((node) => node.name ?? node.id),
  );

/** Every leading space and tab removed, from every line. */
const unindented = (text: string): string => text.replaceAll(/^[ \t]+/gmu, '');

describe('two blocks in a slide, two paragraphs in each', () => {
  it('compiles to the Scene the template draws from every occurrence, in brief order', async () => {
    expect(drawn(await sceneOf(siblings))).toEqual([
      [
        'bloco[1]: Conceito',
        'bloco[1]/paragrafo[1]: Definição.',
        'bloco[1]/paragrafo[2]: Exemplo em duas linhas, | a segunda aqui.',
        'bloco[2]: Resumo',
        'bloco[2]/paragrafo[1]: Um.',
        'bloco[2]/paragrafo[2]: Dois.',
        'lamina[1]: Primeira lâmina',
      ],
      ['bloco[1]: Só', 'bloco[1]/paragrafo[1]: Único.', 'lamina[1]: Segunda lâmina'],
    ]);
  });

  it('compiles to the same Scene with every indent removed', async () => {
    const flat = unindented(siblings);
    expect(flat).not.toBe(siblings);
    expect(await sceneOf(flat)).toEqual(await sceneOf(siblings));
  });

  it('is put back in its nested shape by Format Brief, siblings at one depth', () => {
    const formatted = formatBrief(unindented(siblings), {
      depthOf: (name) => slotDepth(LISTAS, name),
    });
    expect(formatted.ok && formatted.value).toBe(siblings);
  });
});
