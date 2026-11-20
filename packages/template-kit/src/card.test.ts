import {
  type Face,
  type FaceCache,
  type RectNode,
  type Scene,
  type SceneNode,
  type Template,
  type TemplateReport,
  defineTemplate,
  formatCatalogue,
  parseManifest,
} from '@tyto/core';
import { type NodeDraft, font, frame, rect, solid } from '@tyto/core/template';
import { exportSvg } from '@tyto/export-svg';
import { describe, expect, it } from 'vitest';

import { type Block, at, inset, sized, stack } from './blocks.js';
import {
  type CardSegment,
  type CardStyle,
  bandBottom,
  card,
  cardRow,
  cardSegments,
} from './card.js';
import { levelsOf } from './levels.js';
import { lines } from './rows.js';
import { compileTemplate, placeholderFont } from './testing.js';
import { type Measure, grownTextBlock } from './text.js';
import apeloBrief from './__fixtures__/card/apelo.brief?raw';

import type { LevelPart } from './levels.js';
import type { RichText } from '@tyto/core';

/**
 * The card (TYTO-800), through the real `parseBrief` → `resolve` → `compile` → exporters for
 * its snapshots, and on its own blocks for its rules. `apelo.brief` holds the three shapes the
 * maintainer showed on 2026-11-19 (band on top, at the bottom, in the middle) and two cards
 * side by side whose titles differ in length. Text is measured against an arithmetic face, so
 * the snapshots stay the same on every machine.
 */

const EVEN: Face = { advance: (text) => text.length * 0.5, contentHeight: 1.2 };
const faces: FaceCache = { get: (face) => (face.family === 'Test' ? EVEN : undefined) };

const parsed = parseManifest(
  `name: cartao-teste
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

const INNER = 240;
const STYLE: CardStyle = {
  name: 'cartao',
  width: 280,
  radius: 16,
  fill: solid('#ffffff'),
  stroke: { paint: solid('#1360d0'), width: 2, align: 'inside' },
  band: { fill: solid('#1360d0'), name: 'faixa' },
};

/** A role's parts, each on its own row, centred in the card's inner width. */
function drawer(measure: Measure) {
  return (role: 'title' | 'band' | 'foot', parts: readonly LevelPart[]): Block =>
    inset({ item: words(role, parts, measure), padding: [10, 0, 10, 0] });
}

function words(
  role: 'title' | 'band' | 'foot',
  parts: readonly LevelPart[],
  measure: Measure,
): Block {
  return stack({
    align: 'center',
    items: parts.map((part) =>
      grownTextBlock(
        part.words,
        INNER,
        0,
        {
          font: font('Test'),
          size: role === 'band' ? 24 : 16,
          weight: role === 'band' ? 900 : 400,
          color: role === 'band' ? '#ffffff' : '#202020',
        },
        measure,
        { align: 'center', lineHeight: 1.25 },
      ),
    ),
  });
}

const template: Template = defineTemplate(MANIFEST, (context) => {
  const value = context.slots.lamina?.value;
  const text: RichText = value?.kind === 'rich-text' ? value.text : [];
  const draw = drawer(context.measure);
  const minHeight = { band: 56, title: 40, foot: 40 };
  const items = lines(text).map((line) => ({
    segments: cardSegments(levelsOf(line), draw, minHeight),
    style: STYLE,
  }));
  const drawn =
    items.length > 1
      ? cardRow(items, 20, context.report)
      : card(items[0]?.segments ?? [], STYLE, context.report);
  return frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    children: [at((context.size.w - drawn.width) / 2, 40, drawn)],
  });
});

async function outputOf(brief: string): Promise<{ scene: Scene; svg: readonly string[] }> {
  const compiled = await compileTemplate({ brief, template, formats: FORMATS, faces });
  if (!compiled.ok) throw new Error(compiled.error.map((item) => item.message).join('; '));
  const svg = exportSvg(compiled.value.scene, { resources: { font: placeholderFont } });
  if (!svg.ok) throw new Error(svg.error.map((item) => item.message).join('; '));
  return { scene: compiled.value.scene, svg: svg.value.map((item) => item.svg) };
}

/** Every rectangle of one artwork, by name, with its top in the frame. */
function rectsOf(scene: Scene, artwork: number, name: string): (RectNode & { top: number })[] {
  const found: (RectNode & { top: number })[] = [];
  const walk = (nodes: readonly SceneNode[], y: number): void => {
    for (const node of nodes) {
      const top = y + node.transform.y;
      if (node.kind === 'rect' && node.name === name) found.push({ ...node, top });
      if (node.kind === 'group') walk(node.children, top);
    }
  };
  walk(scene.artworks[artwork]?.frames[0]?.children ?? [], 0);
  return found;
}

describe('the card, through the real compile', async () => {
  const { scene, svg } = await outputOf(apeloBrief);
  const R = STYLE.radius;

  it('draws the three shapes and the row as committed', async () => {
    const names = ['band-top', 'band-bottom', 'band-middle', 'two-cards'];
    for (const [index, name] of names.entries()) {
      await expect(svg[index]).toMatchFileSnapshot(`./__snapshots__/card/${name}.grid.svg`);
    }
  });

  it('gives a band on top the top corners, with no title', () => {
    expect(rectsOf(scene, 0, 'faixa').map((band) => band.radius)).toEqual([[R, R, 0, 0]]);
  });

  it('gives a band at the bottom the bottom corners, with no foot', () => {
    expect(rectsOf(scene, 1, 'faixa').map((band) => band.radius)).toEqual([[0, 0, R, R]]);
  });

  it('squares a band between a title and a foot', () => {
    expect(rectsOf(scene, 2, 'faixa').map((band) => band.radius)).toEqual([[0, 0, 0, 0]]);
  });

  it('draws two cards of different titles at one height, their bands lined up', () => {
    const cards = rectsOf(scene, 3, 'cartao');
    const bands = rectsOf(scene, 3, 'faixa');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.size.h).toBe(cards[1]!.size.h);
    expect(bands[0]!.top).toBe(bands[1]!.top);
  });
});

/* -------------------------------------------------------------------------- the rules -- */

/** A segment of a given height, as a plain rectangle stands in for words. */
function segment(kind: 'band' | 'plain', height: number, minHeight?: number): CardSegment {
  const content = sized(rect({ name: 'words', size: { w: 100, h: height } }));
  return { kind, content, ...(minHeight === undefined ? {} : { minHeight }) };
}

describe('card', () => {
  it('is as tall as its segments, each at least its least height', () => {
    const drawn = card(
      [segment('plain', 30), segment('band', 20, 50), segment('plain', 25)],
      STYLE,
    );
    expect(drawn.height).toBe(105);
    expect(drawn.segments.map((each) => [each.top, each.height])).toEqual([
      [0, 30],
      [30, 50],
      [80, 25],
    ]);
    expect(bandBottom(drawn)).toBe(80);
  });

  it('grows a band whose words outgrow its least height', () => {
    const drawn = card([segment('plain', 30), segment('band', 90, 50)], STYLE);
    expect(drawn.segments[1]).toEqual({ kind: 'band', top: 30, height: 90 });
  });

  it('puts the room of a fixed height before the last segment, so the foot sits at the bottom', () => {
    const drawn = card([segment('band', 40), segment('plain', 30), segment('plain', 20)], {
      ...STYLE,
      height: 150,
    });
    expect(drawn.height).toBe(150);
    expect(drawn.segments.map((each) => each.top)).toEqual([0, 40, 130]);
  });

  it('reports the overflow of a fixed height its segments outgrow', () => {
    const reports: TemplateReport[] = [];
    card([segment('band', 40), segment('plain', 90)], { ...STYLE, height: 100 }, (report) =>
      reports.push(report),
    );
    expect(reports).toEqual([{ code: 'W_TEMPLATE_OVERFLOW', overflow: 30 }]);
  });

  it('reports nothing when the segments fit the fixed height', () => {
    const reports: TemplateReport[] = [];
    card([segment('band', 40)], { ...STYLE, height: 100 }, (report) => reports.push(report));
    expect(reports).toEqual([]);
  });

  it('keeps a lone band’s bottom corners square when a fixed height leaves room under it', () => {
    const drawn = card([segment('band', 40)], { ...STYLE, height: 100 });
    expect(JSON.stringify(drawn.draft)).toContain('"radius":[16,16,0,0]');
  });

  it('draws nothing for no segments', () => {
    const drawn = card([], STYLE);
    expect([drawn.width, drawn.height, drawn.segments]).toEqual([0, 0, []]);
  });
});

describe('cardRow', () => {
  it('draws every card as tall as the tallest, the room before each one’s foot', () => {
    const short = [segment('band', 40), segment('plain', 20)];
    const tall = [segment('plain', 60), segment('band', 40), segment('plain', 20)];
    const row = cardRow(
      [
        { segments: short, style: STYLE },
        { segments: tall, style: STYLE },
      ],
      20,
    );
    expect([row.width, row.height]).toEqual([580, 120]);
    const outlines: number[] = [];
    const walk = (node: NodeDraft): void => {
      if (node.kind === 'rect' && node.name === 'cartao') outlines.push(node.size.h);
      if (node.kind === 'group') node.children.forEach(walk);
    };
    walk(row.draft);
    expect(outlines).toEqual([120, 120]);
  });

  it('starts every card’s first band at the same height, the title above it grown', () => {
    const short = [segment('plain', 20), segment('band', 40), segment('plain', 20)];
    const tall = [segment('plain', 60), segment('band', 40), segment('plain', 30)];
    const row = cardRow(
      [
        { segments: short, style: STYLE },
        { segments: tall, style: STYLE },
      ],
      20,
    );
    const bands: number[] = [];
    const walk = (node: NodeDraft, y: number): void => {
      const top = y + node.transform.y;
      if (node.kind === 'rect' && node.name === 'faixa') bands.push(top);
      if (node.kind === 'group') node.children.forEach((child) => walk(child, top));
    };
    walk(row.draft, 0);
    expect(bands).toEqual([60, 60]);
    expect(row.height).toBe(130);
  });
});

describe('cardSegments', () => {
  const roles = (source: string): string[] =>
    cardSegments(
      levelsOf([{ kind: 'text', value: source, range: { start: 0, end: source.length } }]),
      (role, parts) => sized(rect({ name: `${role}:${parts.length}`, size: { w: 10, h: 10 } })),
    ).map((each) => `${each.kind}:${(each.content.draft as { name?: string }).name ?? ''}`);

  it('reads the main part as the band, the parts before as the title, after as the foot', () => {
    expect(roles('Lote | # 40% OFF | Prazo | Garantia')).toEqual([
      'plain:title:1',
      'band:band:1',
      'plain:foot:2',
    ]);
  });

  it('leaves out a role with no part, so the band reaches that edge', () => {
    expect(roles('# 40% OFF | Prazo')).toEqual(['band:band:1', 'plain:foot:1']);
    expect(roles('Lote | # 40% OFF')).toEqual(['plain:title:1', 'band:band:1']);
  });
});
