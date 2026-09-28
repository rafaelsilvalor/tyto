import { describe, expect, it } from 'vitest';

import { diagnosticCodes } from '../diagnostics/codes.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { sliceRange } from '../source/range.js';
import { parseManifest } from './manifest.js';
import { checkSlotVocabulary } from './slot-vocabulary.js';

/**
 * `docs/slot-vocabulary.md`, "What a check can enforce", one rule at a time — and the
 * boundary under it: a name on neither of the document's lists is never flagged, however
 * close it looks to one that is.
 */

const HEAD = 'name: teste\nversion: 1.0.0\nformats: [feed]\n';

function check(slots: string, adjustments = ''): { source: string; warnings: Diagnostic[] } {
  const source = `${HEAD}slots:\n${slots}${adjustments === '' ? '' : `adjustments:\n${adjustments}`}`;
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('\n'));
  return { source, warnings: checkSlotVocabulary(parsed.value, source) };
}

const TITULO = '  titulo: { type: rich-text, required: true }\n';

describe('checkSlotVocabulary', () => {
  it('is a registered warning that is never fatal (ADR 0025)', () => {
    expect(diagnosticCodes.W_SLOT_VOCABULARY).toMatchObject({ severity: 'warning', fatal: false });
  });

  it('names both the word used and the standard one, at the slot in the manifest', () => {
    const { source, warnings } = check(`${TITULO}  emblema: { type: image }\n`);

    expect(warnings).toHaveLength(1);
    const [warning] = warnings;
    expect(warning).toMatchObject({ code: 'W_SLOT_VOCABULARY', severity: 'warning' });
    expect(warning?.message).toContain("'emblema'");
    expect(warning?.message).toContain("'imagem'");
    expect(warning?.range && sliceRange(source, warning.range)).toBe('{ type: image }');
  });

  it.each([
    ['ilustracao', 'imagem', '{ type: image }'],
    ['foto', 'imagem', '{ type: image }'],
    ['figura', 'imagem', '{ type: image }'],
    ['pagina', 'lamina', '{ type: rich-text, repeat: true }'],
    ['card', 'lamina', '{ type: rich-text, repeat: true }'],
    ['slide', 'lamina', '{ type: rich-text, repeat: true }'],
    ['cor', 'tom', '{ type: enum, values: [a, b] }'],
    ['tema', 'tom', '{ type: enum, values: [a, b] }'],
    ['variante', 'tom', '{ type: enum, values: [a, b] }'],
    ['manchete', 'titulo', '{ type: rich-text }'],
    ['titulo-principal', 'titulo', '{ type: rich-text }'],
  ])('flags the listed synonym %s and suggests %s', (used, standard, shape) => {
    const { warnings } = check(`${TITULO}  ${used}: ${shape}\n`);

    expect(warnings.map((item) => item.message)).toEqual([
      expect.stringContaining(`'${standard}'`),
    ]);
  });

  it('reports a repeating synonym once, as the synonym', () => {
    const { warnings } = check(`${TITULO}  item: { type: rich-text, repeat: true }\n`);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('synonym');
  });

  it('flags a repeatable slot that is not named lamina, whatever else it is called', () => {
    const { warnings } = check(`${TITULO}  aula: { type: rich-text, repeat: true }\n`);

    expect(warnings.map((item) => item.message)).toEqual([
      expect.stringMatching(/'aula'.*'lamina'/u),
    ]);
  });

  it.each([
    ['titulo', '  titulo: { type: rich-text }\n'],
    ['titulo', '  titulo: { type: image, required: true }\n'],
    ['subtitulo', `${TITULO}  subtitulo: { type: image }\n`],
    ['chamada', `${TITULO}  chamada: { type: enum, values: [a] }\n`],
    ['imagem', `${TITULO}  imagem: { type: rich-text }\n`],
    ['lamina', `${TITULO}  lamina: { type: rich-text }\n`],
    ['tom', `${TITULO}  tom: { type: rich-text }\n`],
    // An enum beside a lamina, but the per-lamina override the standard fixes is missing.
    [
      'tom',
      `${TITULO}  lamina: { type: rich-text, repeat: true }\n` +
        '  tom: { type: enum, values: [claro, escuro] }\n',
    ],
  ])('flags the reserved name %s with the wrong shape', (name, slots) => {
    const { warnings } = check(slots);

    expect(warnings.map((item) => item.message)).toEqual([
      expect.stringMatching(new RegExp(`^Slot '${name}' is a reserved name`, 'u')),
    ]);
  });

  it('passes every reserved name in its standard shape', () => {
    const { warnings } = check(
      `${TITULO}` +
        '  subtitulo: { type: rich-text, max: 60 }\n' +
        '  chamada: { type: rich-text }\n' +
        '  imagem: { type: image }\n' +
        '  lamina: { type: rich-text, repeat: true, min: 1 }\n' +
        '  tom: { type: enum, values: [claro, escuro], default: escuro }\n',
      '  tom: { type: enum, values: [claro, escuro], applies: [lamina] }\n',
    );

    expect(warnings).toEqual([]);
  });

  it('owes no tom adjustment when no slot repeats: there is no lamina to override it on', () => {
    const { warnings } = check(`${TITULO}  tom: { type: enum, values: [azul, laranja] }\n`);

    expect(warnings).toEqual([]);
  });

  it('never flags a domain name the document does not list', () => {
    const { warnings } = check(
      `${TITULO}` +
        '  disciplina: { type: rich-text }\n' +
        '  professor: { type: rich-text }\n' +
        '  lista: { type: rich-text, required: true }\n' +
        '  destaque: { type: enum, values: [sim, nao] }\n',
    );

    expect(warnings).toEqual([]);
  });

  it.each(['titulos', 'imagens', 'laminas', 'slides', 'itens', 'cores', 'Titulo', 'foto2'])(
    'does not stretch the closed list to the near-miss %s',
    (name) => {
      const { warnings } = check(`${TITULO}  ${name}: { type: rich-text }\n`);

      expect(warnings).toEqual([]);
    },
  );
});
