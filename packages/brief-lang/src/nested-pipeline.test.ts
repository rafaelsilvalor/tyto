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

import nested from './__fixtures__/nested-three-levels.brief?raw';
import { formatBrief } from './format-brief.js';
import { parseBrief } from './parse-brief.js';

/**
 * TYTO-709's acceptance (ADR 0207): a brief nested three levels deep by its template's manifest
 * compiles to the Scene the template draws from that tree, and the same brief with every indent
 * removed compiles to the same Scene — the indent shows the nesting and decides none of it.
 *
 * The template is a test template written here (ADR 0151): it draws one rectangle per slot,
 * named by its path in the tree and its text, so the Scene spells the tree out.
 */

const MANIFEST = parseManifest(
  `name: aninhado
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
  lamina: { type: rich-text, repeat: true, min: 1 }
  bloco: { type: rich-text, per: lamina }
  paragrafo: { type: rich-text, per: bloco, required: true }
  rodape: { type: rich-text, per: paragrafo }
`,
  'manifest.yaml',
);
if (!MANIFEST.ok) throw new Error(MANIFEST.error.map((item) => item.message).join('; '));
const ANINHADO = MANIFEST.value;

const registry: TemplateRegistry = {
  list: () => [ANINHADO],
  get: (name) => (name === ANINHADO.name ? ANINHADO : undefined),
  formatsOf: (name) => (name === ANINHADO.name ? ANINHADO.formats : undefined),
  directoryOf: () => 'templates/aninhado',
  failures: [],
};

const assets: AssetResolver = { base: 'briefs/', resolve: () => Promise.resolve(undefined) };

function plain(slot: ResolvedSlot): string {
  if (slot.value.kind !== 'rich-text') return '';
  return slot.value.text
    .map((inline) => (inline.kind === 'text' ? inline.value : inline.kind === 'break' ? ' | ' : ''))
    .join('');
}

/** One rectangle per slot, depth first, named `path: text`. */
function rectangles(slots: Readonly<Record<string, ResolvedSlot>>, path: string): string[] {
  return Object.values(slots).flatMap((slot) => [
    `${path}${slot.name}: ${plain(slot)}`,
    ...rectangles(slot.slots ?? {}, `${path}${slot.name}/`),
  ]);
}

const template = defineTemplate(ANINHADO, (context) =>
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

describe('a brief nested three levels deep by its manifest', () => {
  it('compiles to the Scene the template draws from the tree', async () => {
    expect(drawn(await sceneOf(nested))).toEqual([
      [
        // `compile` merges the slide's own slots under the brief's and the slide last.
        'titulo: Estrutura',
        'bloco: Conceito',
        'bloco/paragrafo: Definição em duas linhas, | a segunda aqui.',
        'bloco/paragrafo/rodape: Fonte: apostila',
        'lamina: Primeira lâmina',
      ],
      [
        'titulo: Estrutura',
        'bloco: Resumo',
        'bloco/paragrafo: Um parágrafo só.',
        'lamina: Segunda lâmina',
      ],
    ]);
  });

  it('compiles to the same Scene with every indent removed', async () => {
    const flat = unindented(nested);
    expect(flat).not.toBe(nested);
    expect(await sceneOf(flat)).toEqual(await sceneOf(nested));
  });

  it('is put back in its nested shape by Format Brief, from the manifest', () => {
    const formatted = formatBrief(unindented(nested), {
      depthOf: (name) => slotDepth(ANINHADO, name),
    });
    expect(formatted.ok && formatted.value).toBe(nested);
  });
});
