import { describe, expect, it } from 'vitest';

import {
  type DiagnosticCode,
  diagnosticCodeDefinition,
  diagnosticCodeList,
  diagnosticCodes,
  formatDiagnosticMessage,
  placeholderNames,
} from './codes.js';

describe('the catalog', () => {
  it('is not empty and exposes every key', () => {
    expect(diagnosticCodeList.length).toBe(Object.keys(diagnosticCodes).length);
    expect(diagnosticCodeList.length).toBeGreaterThan(0);
  });

  it.each(diagnosticCodeList)('%s is well formed', (code) => {
    const definition = diagnosticCodeDefinition(code);
    expect(definition.summary).not.toBe('');
    expect(definition.template).not.toBe('');
    expect(definition.spec).toMatch(/^docs\/.+\.md$/);
  });

  it.each(diagnosticCodeList)('%s carries the severity its prefix promises', (code) => {
    const expected = code.startsWith('E_') ? 'error' : 'warning';
    expect(diagnosticCodeDefinition(code).severity).toBe(expected);
  });

  it.each(diagnosticCodeList)('%s uses only E_ or W_ as its prefix', (code) => {
    expect(code).toMatch(/^[EW]_[A-Z0-9_]+$/);
  });

  it('never gives two codes the same message, because the code is what a handler reads', () => {
    // A person reads the message, and a path is enough for them. A handler reads the code,
    // so two codes sharing one sentence means the sentence was carrying the distinction all
    // along. E_TEMPLATE_READ said "Could not read '{path}'" for a missing formats.yaml —
    // accurate to a reader, and a lie to anything trying to tell a broken project apart
    // from a broken template (TYTO-73).
    const byTemplate = new Map<string, DiagnosticCode[]>();
    for (const code of diagnosticCodeList) {
      const { template } = diagnosticCodeDefinition(code);
      byTemplate.set(template, [...(byTemplate.get(template) ?? []), code]);
    }

    const shared = [...byTemplate.entries()]
      .filter(([, codes]) => codes.length > 1)
      .map(([template, codes]) => `${codes.join(' and ')} both say "${template}"`);

    expect(shared).toEqual([]);
  });
});

describe('placeholderNames', () => {
  it('reads them in source order without duplicates', () => {
    expect(placeholderNames("'{slot}' in '{template}', again {slot}")).toEqual([
      'slot',
      'template',
    ]);
  });

  it('returns nothing for a template without parameters', () => {
    expect(placeholderNames('nothing to fill')).toEqual([]);
  });
});

describe('formatDiagnosticMessage', () => {
  it('substitutes every placeholder', () => {
    const message = formatDiagnosticMessage('E_UNKNOWN_SLOT', {
      slot: 'titluo',
      template: 'promo-curso',
      declared: 'titulo, subtitulo',
    });

    expect(message).toBe(
      "Unknown slot 'titluo'. Template 'promo-curso' declares: titulo, subtitulo.",
    );
  });

  it('accepts numbers, which is what an overflow measurement is', () => {
    expect(
      formatDiagnosticMessage('W_TEXT_OVERFLOW', { slot: 'titulo', overflow: 14, format: 'story' }),
    ).toContain('by 14px');
  });

  it.each(diagnosticCodeList)('%s leaves no placeholder unfilled', (code) => {
    const params = Object.fromEntries(
      placeholderNames(diagnosticCodeDefinition(code).template).map((name) => [name, 'x']),
    );

    const message = formatDiagnosticMessage(
      code,
      params as Parameters<typeof formatDiagnosticMessage>[1],
    );

    expect(message).not.toMatch(/\{[a-zA-Z]/);
  });

  it('reports a missing parameter loudly instead of emitting a raw placeholder', () => {
    const call = () =>
      formatDiagnosticMessage(
        'E_UNKNOWN_SLOT' as DiagnosticCode,
        { slot: 'titulo' } as Parameters<typeof formatDiagnosticMessage>[1],
      );

    expect(call).toThrow(/missing the parameter 'template'/);
  });
});
