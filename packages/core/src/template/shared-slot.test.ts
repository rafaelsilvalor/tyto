import { describe, expect, it } from 'vitest';

import { type TemplateManifest, parseManifest } from './manifest.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';

/**
 * Shared or a slide's own (ADR 0225): a slot whose `per` names the repeatable slot may also
 * declare `shared: true`. Only there — a nested `per` belongs to a block no artwork shares, and
 * a slot without `per` is shared already — and `comum` is no slot's name, because `::comum`
 * closes a brief's slides.
 */

const PATH = 'templates/compartilhado/manifest.yaml';

const BASE = `name: compartilhado
version: 1.0.0
formats: [feed]
slots:
  lamina: { type: rich-text, repeat: true, min: 1 }
  bloco: { type: rich-text, per: lamina }
`;

function withSlot(line: string): string {
  return `${BASE}  ${line}\n`;
}

function accepted(source: string): TemplateManifest {
  const result = parseManifest(source, PATH);
  if (!result.ok) {
    throw new Error(`should parse: ${result.error.map((item) => item.message).join('; ')}`);
  }
  return result.value;
}

function rejected(source: string): readonly Diagnostic[] {
  const result = parseManifest(source, PATH);
  if (result.ok) throw new Error('should not parse');
  return result.error;
}

/** `Manifest is invalid at 'slots.nota.shared': …` → `slots.nota.shared`. */
function pathsOf(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((item) => /at '([^']*)'/u.exec(item.message)?.[1] ?? '(none)');
}

describe('a slot that is shared or a slide’s own', () => {
  it('is accepted on a slot whose per names the repeatable slot', () => {
    const manifest = accepted(withSlot('nota: { type: rich-text, per: lamina, shared: true }'));

    expect(manifest.slots.nota?.shared).toBe(true);
    expect(manifest.slots.nota?.per).toBe('lamina');
  });

  it('is absent by default, so a manifest that never says it parses to the same object', () => {
    const manifest = accepted(withSlot('nota: { type: rich-text, per: lamina }'));

    expect(manifest.slots.nota).toEqual({
      type: 'rich-text',
      required: false,
      repeat: false,
      per: 'lamina',
    });
    expect('shared' in (manifest.slots.nota ?? {})).toBe(false);
  });

  it('is refused on a slot without per, which is shared already', () => {
    const problems = rejected(withSlot('nota: { type: rich-text, shared: true }'));

    expect(pathsOf(problems)).toEqual(['slots.nota.shared']);
    expect(problems[0]?.message).toContain('declares per');
  });

  it('is refused on a nested per, whose parent does not repeat', () => {
    const problems = rejected(withSlot('nota: { type: rich-text, per: bloco, shared: true }'));

    expect(pathsOf(problems)).toEqual(['slots.nota.shared']);
    expect(problems[0]?.message).toContain("'bloco' does not repeat");
  });

  it('is refused beside multiple, since a shared value has no slide to count it in', () => {
    const problems = rejected(
      withSlot('nota: { type: rich-text, per: lamina, shared: true, multiple: true }'),
    );

    expect(pathsOf(problems)).toEqual(['slots.nota.shared']);
  });

  it('keeps refusing a default, as every per slot does', () => {
    const problems = rejected(
      withSlot('nota: { type: rich-text, per: lamina, shared: true, default: x }'),
    );

    expect(pathsOf(problems)).toEqual(['slots.nota.default']);
  });
});

describe('the name comum', () => {
  it('is refused as a slot, because ::comum closes the slides', () => {
    const problems = rejected(withSlot('comum: { type: rich-text }'));

    expect(pathsOf(problems)).toEqual(['slots.comum']);
    expect(problems[0]?.message).toContain('reserved');
  });

  it('stays free as an adjustment, which a brief never writes as a directive', () => {
    const manifest = accepted(`${BASE}adjustments:\n  comum: { type: flag, applies: [lamina] }\n`);

    expect(Object.keys(manifest.adjustments)).toEqual(['comum']);
  });
});
