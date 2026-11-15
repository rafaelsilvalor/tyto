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
import { exportSvg } from '@tyto/export-svg';
import { describe, expect, it } from 'vitest';

import { at } from './blocks.js';
import { compileTemplate, placeholderFont } from './testing.js';
import { grownTextBlock } from './text.js';
import agendaBrief from './__fixtures__/paragraphs/agenda.brief?raw';
import agendaWithoutBlankLines from './__fixtures__/paragraphs/agenda-without-blank-lines.brief?raw';
import blankLinesAtTheEnds from './__fixtures__/paragraphs/blank-lines-at-the-ends.brief?raw';

/**
 * A blank line in a brief, through the real `parseBrief` → `resolve` → `compile` → exporters
 * (TYTO-557, ADR 0205).
 *
 * `agenda.brief` is the agenda ADR 0087 was written for: two groups with a blank line between
 * them. Under a template that declares no paragraph spacing it must draw exactly what it drew
 * before paragraphs existed, which is what the same brief with the blank line taken out draws
 * — the Scene, the HTML and the SVG, byte for byte. Under a template that declares 24 px the
 * groups are 24 px apart, and that output is committed as `.html` and `.svg` snapshots.
 * `blank-lines-at-the-ends.brief` has blank lines only where they mean nothing — before the
 * first line and after the last — and a comment between two lines, which is not a blank line
 * (ADR 0204), so even the 24 px template draws it like the control.
 *
 * Text is measured against an arithmetic face (half an em a character, as `core`'s layout tests
 * use), so the snapshots carry real line heights and a real paragraph space and stay the same
 * on every machine.
 */

const EVEN: Face = { advance: (text) => text.length * 0.5, contentHeight: 1.2 };
const faces: FaceCache = { get: (face) => (face.family === 'Test' ? EVEN : undefined) };

const parsed = parseManifest(
  `name: agenda-teste
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

/** The slide's lines, in a 560 px column; `paragraphSpacing` is the only thing that varies. */
function agendaTemplate(paragraphSpacing?: number): Template {
  return defineTemplate(MANIFEST, (context) => {
    const lamina = context.slots.lamina?.value;
    const body =
      lamina?.kind === 'rich-text'
        ? [
            at(
              20,
              20,
              grownTextBlock(
                lamina.text,
                560,
                0,
                {
                  font: font('Test'),
                  size: 16,
                  weight: 400,
                  color: '#202020',
                  ...(paragraphSpacing === undefined ? {} : { paragraphSpacing }),
                },
                context.measure,
                { lineHeight: 1.5 },
              ),
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
}

interface Output {
  readonly scene: Scene;
  readonly html: readonly string[];
  readonly svg: readonly string[];
}

async function outputOf(brief: string, template: Template): Promise<Output> {
  const compiled = await compileTemplate({ brief, template, formats: FORMATS, faces });
  if (!compiled.ok) throw new Error(compiled.error.map((item) => item.message).join('; '));
  const svg = exportSvg(compiled.value.scene, { resources: { font: placeholderFont } });
  if (!svg.ok) throw new Error(svg.error.map((item) => item.message).join('; '));
  return {
    scene: compiled.value.scene,
    html: compiled.value.frames.map((item) => item.html),
    svg: svg.value.map((item) => item.svg),
  };
}

/** The text node's runs, the one place the two briefs could differ. */
function runsIn(scene: Scene): unknown {
  const node = scene.artworks[0]?.frames[0]?.children[0];
  return node?.kind === 'text' ? node.runs : undefined;
}

describe('a template that declares no paragraph spacing', () => {
  it('draws the agenda exactly as it draws it without the blank line', async () => {
    const control = await outputOf(agendaWithoutBlankLines, agendaTemplate());
    const agenda = await outputOf(agendaBrief, agendaTemplate());
    expect(agenda.scene).toEqual(control.scene);
    expect(agenda.html).toEqual(control.html);
    expect(agenda.svg).toEqual(control.svg);
  });

  it('draws the same as one that declares 0', async () => {
    const absent = await outputOf(agendaBrief, agendaTemplate());
    const zero = await outputOf(agendaBrief, agendaTemplate(0));
    expect(zero.html).toEqual(absent.html);
    expect(zero.svg).toEqual(absent.svg);
  });
});

describe('a template that declares 24 px between paragraphs', () => {
  it('puts the 24 px at the blank line and nowhere else', async () => {
    const control = await outputOf(agendaWithoutBlankLines, agendaTemplate(24));
    const agenda = await outputOf(agendaBrief, agendaTemplate(24));
    const breaks = (scene: Scene): unknown =>
      (runsIn(scene) as { kind: string }[]).filter((run) => run.kind === 'break');
    expect(breaks(agenda.scene)).toEqual([
      { kind: 'break' },
      { kind: 'break' },
      { kind: 'break', space: 24 },
      { kind: 'break' },
    ]);
    expect(breaks(control.scene)).toEqual([
      { kind: 'break' },
      { kind: 'break' },
      { kind: 'break' },
      { kind: 'break' },
    ]);
    // Five lines at 1.5 × 16 px, none wrapped, and the paragraph on top.
    const height = (scene: Scene): number | undefined => {
      const node = scene.artworks[0]?.frames[0]?.children[0];
      return node?.kind === 'text' ? node.box.h : undefined;
    };
    expect(height(control.scene)).toBe(120);
    expect(height(agenda.scene)).toBe(144);
  });

  it('writes the bytes it wrote for agenda.brief', async () => {
    const agenda = await outputOf(agendaBrief, agendaTemplate(24));
    await expect(agenda.html[0]).toMatchFileSnapshot('./__snapshots__/paragraphs/agenda.grid.html');
    await expect(agenda.svg[0]).toMatchFileSnapshot('./__snapshots__/paragraphs/agenda.grid.svg');
  });

  it('draws blank lines at the ends of a block, and a comment, as nothing', async () => {
    const control = await outputOf(agendaWithoutBlankLines, agendaTemplate(24));
    const edges = await outputOf(blankLinesAtTheEnds, agendaTemplate(24));
    expect(edges.scene).toEqual(control.scene);
    expect(edges.html).toEqual(control.html);
    expect(edges.svg).toEqual(control.svg);
  });
});
