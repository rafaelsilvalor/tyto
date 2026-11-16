import {
  type Face,
  type FaceCache,
  type Scene,
  type Template,
  defineTemplate,
  formatCatalogue,
  parseManifest,
} from '@tyto/core';
import { font, frame } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { at } from './blocks.js';
import { compileTemplate } from './testing.js';
import { grownTextBlock } from './text.js';

/**
 * Indentation never changes what a brief compiles to (TYTO-708, ADR 0202), through the real
 * `parseBrief` → `resolve` → `compile` → `exportHtml`.
 *
 * The card's contract: `::lamina` / `Linha um` / `Linha dois` draws exactly what its indented
 * twin draws — the Scene and the HTML. Before TYTO-708 the unindented brief gave an empty lamina,
 * an invented directive `::Linha` and three `E_SYNTAX`. The template declares 24 px between
 * paragraphs, so a blank line between two column-0 lines that failed to be the paragraph it is
 * between two indented ones (ADR 0205) would move the second line and show here.
 */

const EVEN: Face = { advance: (text) => text.length * 0.5, contentHeight: 1.2 };
const faces: FaceCache = { get: (face) => (face.family === 'Test' ? EVEN : undefined) };

const parsed = parseManifest(
  `name: lamina-teste
version: 1.0.0
formats: [grid]
slots:
  lamina: { type: rich-text, repeat: true, min: 1, max: 10 }
`,
  'manifest.yaml',
);
if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
const MANIFEST = parsed.value;

const FORMATS = formatCatalogue({ grid: { w: 600, h: 400 } });

const TEMPLATE: Template = defineTemplate(MANIFEST, (context) => {
  const lamina = context.slots.lamina?.value;
  const style = {
    font: font('Test'),
    size: 16,
    weight: 400,
    color: '#202020',
    paragraphSpacing: 24,
  };
  const body =
    lamina?.kind === 'rich-text'
      ? [
          at(
            20,
            20,
            grownTextBlock(lamina.text, 560, 0, style, context.measure, { lineHeight: 1.5 }),
          ),
        ]
      : [];
  return frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    children: body,
  });
});

interface Output {
  readonly scene: Scene;
  readonly html: readonly string[];
  readonly codes: readonly string[];
}

async function outputOf(body: string): Promise<Output> {
  const brief = `---\ntemplate: lamina-teste\n---\n${body}`;
  const compiled = await compileTemplate({ brief, template: TEMPLATE, formats: FORMATS, faces });
  if (!compiled.ok) throw new Error(compiled.error.map((item) => item.message).join('; '));
  return {
    scene: compiled.value.scene,
    html: compiled.value.frames.map((item) => item.html),
    codes: compiled.diagnostics.map((item) => item.code),
  };
}

describe('a lamina written without indentation', () => {
  it.each([
    [
      'the card’s three lines',
      '::lamina\nLinha um\nLinha dois\n',
      '::lamina\n  Linha um\n  Linha dois\n',
    ],
    [
      'a blank line between its two lines',
      '::lamina\nLinha um\n\nLinha dois\n',
      '::lamina\n  Linha um\n\n  Linha dois\n',
    ],
    [
      'a head with text of its own',
      '::lamina Direito\nConstitucional\n',
      '::lamina Direito\n  Constitucional\n',
    ],
  ])('compiles to the Scene of its indented twin: %s', async (_, unindented, twin) => {
    const control = await outputOf(twin);
    const written = await outputOf(unindented);
    expect(written.codes).toEqual(control.codes);
    expect(written.scene).toEqual(control.scene);
    expect(written.html).toEqual(control.html);
  });

  it('is one lamina whose lines are all drawn', async () => {
    const { scene } = await outputOf('::lamina\nLinha um\nLinha dois\n');
    expect(scene.artworks).toHaveLength(1);
    const node = scene.artworks[0]?.frames[0]?.children[0];
    const words =
      node?.kind === 'text'
        ? node.runs.flatMap((run) => (run.kind === 'text' ? [run.text] : []))
        : [];
    expect(words.join(' ')).toBe('Linha um Linha dois');
  });
});
