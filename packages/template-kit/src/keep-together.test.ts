import {
  type FaceCache,
  type TemplateManifest,
  type TextRun,
  defineTemplate,
  formatCatalogue,
  measureText,
  parseManifest,
} from '@tyto/core';
import { font, frame, run, runsOf, solid, text } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import {
  KEEP_TOGETHER_RULES,
  NO_BREAK_SPACE,
  keepTogether,
  keepTogetherText,
} from './keep-together.js';
import { type Setting, settle } from './rhythm.js';
import { bold, rich, span } from './rich-text.fixture.js';
import { compileTemplate } from './testing.js';

/**
 * Against a face whose every character is half an em wide, as `rhythm.test.ts` does, so every
 * line break here is one a reader can check by counting characters: at 10 px, 5 px a character.
 */
const faces: FaceCache = {
  get: (face) =>
    face.family === 'Test'
      ? { advance: (characters: string) => characters.length * 0.5, contentHeight: 1.2 }
      : undefined,
};
const measure = (node: Parameters<typeof measureText>[0]) => measureText(node, faces);
const FONT = { family: 'Test', source: 'bundled' } as const;

/** The glued text with its no-break spaces written as `~`, so a case reads at a glance. */
function shown(value: string): string {
  return value.replaceAll(NO_BREAK_SPACE, '~');
}

/** The lines `measure` broke `words` into at `width`, no-break spaces written as `~`. */
function linesAt(words: string, width: number): string[] {
  const node = text({
    runs: [run(words, { font: FONT, size: 10, color: '#000000' })],
    box: { w: width },
  });
  return linesOf(measure(node)?.runs ?? []);
}

function linesOf(runs: readonly TextRun[]): string[] {
  const lines = [''];
  for (const item of runs) {
    if (item.kind === 'break') lines.push('');
    else lines[lines.length - 1] += shown(item.text);
  }
  return lines;
}

describe('keepTogether, laid out', () => {
  // 70 px holds 14 characters: "Salário de R$" (13) fits, "Salário de R$ 9,8" (17) does not.
  const SALARY = 'Salário de R$ 9,8 mil';

  it('reproduces the preview: unglued, the line ends on "R$" and "9,8 mil" starts the next', () => {
    expect(linesAt(SALARY, 70)).toEqual(['Salário de R$', '9,8 mil']);
  });

  it('keeps the sign, the amount and the scale word on one line once glued', () => {
    expect(linesAt(keepTogetherText(SALARY), 70)).toEqual(['Salário de', 'R$~9,8~mil']);
  });

  it('keeps a number with its percent', () => {
    // 55 px holds 11 characters: "Alta de 12" (10) fits, "Alta de 12 %" (12) does not.
    expect(linesAt('Alta de 12 %', 55)).toEqual(['Alta de 12', '%']);
    expect(linesAt(keepTogetherText('Alta de 12 %'), 55)).toEqual(['Alta de', '12~%']);
  });
});

describe('keepTogetherText', () => {
  it.each([
    ['R$ 9,8 mil', 'R$~9,8~mil'],
    ['US$ 16 mil', 'US$~16~mil'],
    ['€ 1.200,50', '€~1.200,50'],
    ['1 milhão', '1~milhão'],
    ['2,5 milhões', '2,5~milhões'],
    ['3 bi', '3~bi'],
    ['4 bilhão', '4~bilhão'],
    ['5 bilhões', '5~bilhões'],
    ['10 %', '10~%'],
    // TYTO-620: a number and its unit of measure.
    ['3 s', '3~s'],
    ['10 kg', '10~kg'],
    ['25 °C', '25~°C'],
    ['9,8 m/s²', '9,8~m/s²'],
    ['2,5 kPa e 300 K', '2,5~kPa e 300~K'],
    ['5 mL.', '5~mL.'],
    ['10⁵ Pa', '10⁵~Pa'],
    ['60 min', '60~min'],
  ])('glues %s', (written, glued) => {
    expect(shown(keepTogetherText(written))).toBe(glued);
  });

  it.each([
    // The control: a sign with no amount, a word that only starts like a scale word.
    ['R$ por mês', 'R$ por mês'],
    ['9 milhas', '9 milhas'],
    ['3 bicicletas', '3 bicicletas'],
    ['de mil formas', 'de mil formas'],
    // A word that only starts like a unit, and a unit-like letter with no number before it.
    ['3 salas', '3 salas'],
    ['2 metros', '2 metros'],
    ['5 horas', '5 horas'],
    ['em s e m', 'em s e m'],
  ])('leaves %s breakable', (written, glued) => {
    expect(shown(keepTogetherText(written))).toBe(glued);
  });

  it('keeps the length, turning each space of a run of them', () => {
    const written = 'R$  9,8';
    const glued = keepTogetherText(written);

    expect(shown(glued)).toBe('R$~~9,8');
    expect(glued).toHaveLength(written.length);
  });

  it('takes the caller’s rules, as data, in place of or beside the defaults', () => {
    const unit = { name: 'number + unit', before: String.raw`\d`, after: String.raw`km\b` };

    expect(shown(keepTogetherText('R$ 9 e 5 km', [unit]))).toBe('R$ 9 e 5~km');
    expect(shown(keepTogetherText('R$ 9 e 5 km', [...KEEP_TOGETHER_RULES, unit]))).toBe(
      'R$~9 e 5~km',
    );
  });
});

describe('keepTogether, rich text', () => {
  it('glues across a bold span, each span keeping its own characters', () => {
    const value = [span('Salário: '), bold('R$'), span(' 9,8 mil')];
    const glued = keepTogether(value);

    expect(glued.map((inline) => inline.kind)).toEqual(['text', 'bold', 'text']);
    const last = glued[2];
    expect(last?.kind === 'text' ? shown(last.value) : '').toBe('~9,8~mil');
    const first = glued[0];
    expect(first?.kind === 'text' ? first.value : '').toBe('Salário: ');
  });

  it('glues nothing across a line break, not even a space that opens the next line', () => {
    const glued = keepTogether(rich('R$\n 9,8'));

    expect(glued.map((inline) => (inline.kind === 'text' ? inline.value : '|'))).toEqual([
      'R$',
      '|',
      ' 9,8',
    ]);
  });
});

describe('settle, with a glued pair', () => {
  // At 105 px (21 characters) the last line holds "cc" alone, and settle rebreaks.
  const WORDS = 'aaaa bbbb R$ 9,8 mil cc';

  function settledLines(words: string): string[] {
    const written = [run(words, { font: FONT, size: 10, color: '#000000' })] as const;
    const settled = settle({
      size: 10,
      measure,
      layout: (setting: Setting) => {
        const node = text({
          runs:
            setting.runs === undefined ? [...written] : (setting.runs as [TextRun, ...TextRun[]]),
          box: { w: 105 },
        });
        return { text: node, fits: true, laid: node };
      },
    });
    return linesOf(measure(settled.laid)?.runs ?? []);
  }

  it('splits the amount from its scale word when nothing is glued, which is the control', () => {
    expect(settledLines(WORDS)).toEqual(['aaaa bbbb R$ 9,8', 'mil cc']);
  });

  it('moves the glued pair down whole, never splitting it', () => {
    expect(settledLines(keepTogetherText(WORDS))).toEqual(['aaaa bbbb', 'R$~9,8~mil cc']);
  });
});

/* ---------------------------------------------------------- through compile and export -- */

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const MANIFEST = manifestOf(`name: preco
version: 1.0.0
formats: [grid]
slots:
  valor: { type: rich-text, required: true }
`);

/** A one-line poster that glues its value, as a template opts in. */
const preco = defineTemplate(MANIFEST, (context) => {
  const valor = context.slots.valor?.value;
  const runs =
    valor?.kind === 'rich-text'
      ? runsOf(keepTogether(valor.text), {
          font: font('Inter'),
          size: 96,
          weight: 700,
          color: '#ffffff',
        })
      : [];
  return frame({
    format: context.format,
    size: context.size,
    background: solid('#0c2340'),
    idPrefix: context.idPrefix,
    children:
      runs.length === 0
        ? []
        : [
            text({
              id: `${context.idPrefix}.valor`,
              box: { w: context.size.w - 160 },
              transform: { x: 80, y: 80 },
              runs: runs as [(typeof runs)[number], ...typeof runs],
            }),
          ],
  });
});

describe('keepTogether, through compile and the HTML exporter', () => {
  it('reaches the scene’s text and the document as a no-break space', async () => {
    const result = await compileTemplate({
      brief: `---\ntemplate: preco\nformats: [grid]\n---\n\n::valor\n  Salário de R$ 9,8 mil\n`,
      template: preco,
      formats: formatCatalogue({ grid: { w: 1080, h: 1350 } }),
    });
    if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));

    const scene = JSON.stringify(result.value.scene);
    expect(scene).toContain(`R$${NO_BREAK_SPACE}9,8${NO_BREAK_SPACE}mil`);
    const html = result.value.frames[0]?.html ?? '';
    expect(html).toContain(`R$${NO_BREAK_SPACE}9,8${NO_BREAK_SPACE}mil`);
  });
});
