import {
  type AssetResolver,
  type Diagnostic,
  type TemplateConfigurations,
  type TemplateContext,
  type TemplateManifest,
  type TemplateRegistry,
  compile,
  formatCatalogue,
  parseManifest,
  resolve,
} from '@tyto/core';
import { defineTemplate, frame } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { parseBrief } from './parse-brief.js';

/**
 * TYTO-833 (ADR 0226): a brief's frontmatter sets the values its template declares, by name,
 * over a plugin file's configuration and the manifest's defaults. Real briefs, parsed, resolved
 * and compiled against a test template written here (ADR 0151) that hands back what it was given.
 */

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const VALORES = manifestOf(`name: valores
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
  fundo: { type: rich-text }
values:
  destaque: { type: color, default: '#1363d0' }
  margem: { type: length, default: 60, min: 0, max: 200 }
  fundo: { type: color, default: '#f7f4f4' }
  logo: { type: image }
`);

const registry: TemplateRegistry = {
  list: () => [VALORES],
  get: (name) => (name === VALORES.name ? VALORES : undefined),
  formatsOf: (name) => (name === VALORES.name ? VALORES.formats : undefined),
  directoryOf: (name) => `templates/${name}`,
  failures: [],
};

/** One plugin-file configuration, `valores-vermelho`, that paints the accent red. */
const configurations: TemplateConfigurations = {
  select: (name) =>
    name === 'valores-vermelho'
      ? {
          template: 'valores',
          configuration: 'vermelho',
          values: { destaque: { value: '#e30613' }, margem: { value: 80 } },
        }
      : undefined,
  aliases: () => [],
};

const assets: AssetResolver = { base: 'briefs/', resolve: () => Promise.resolve(undefined) };
const FORMATS = formatCatalogue({ feed: { w: 1080, h: 1350 } });

async function compiled(
  brief: string,
): Promise<{ values: TemplateContext['values']; diagnostics: readonly Diagnostic[] }> {
  const parsed = parseBrief(brief);
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  const resolved = await resolve(parsed.value, { registry, assets, configurations });
  if (!resolved.ok) throw new Error(resolved.error.map((item) => item.message).join('; '));
  let values: TemplateContext['values'];
  const template = defineTemplate(VALORES, (context) => {
    values = context.values;
    return frame({ format: context.format, size: context.size, idPrefix: context.idPrefix });
  });
  const result = compile(resolved.value, template, { formats: FORMATS });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return { values, diagnostics: [...resolved.diagnostics, ...result.diagnostics] };
}

const codes = (diagnostics: readonly Diagnostic[]): string[] =>
  diagnostics.map((item) => item.code);

describe('a value set in the frontmatter (ADR 0226)', () => {
  it('reaches the template, over the default', async () => {
    const { values, diagnostics } = await compiled(`---
template: valores
destaque: '#00a859'
margem: 24
---
::titulo Concurso
`);
    expect(values).toMatchObject({ destaque: '#00a859', margem: 24, fundo: '#f7f4f4' });
    expect(codes(diagnostics)).toEqual([]);
  });

  it('wins over the configuration, value by value', async () => {
    const { values } = await compiled(`---
template: valores-vermelho
destaque: '#00a859'
---
::titulo Concurso
`);
    // The brief's accent over the configuration's red; the configuration's margin stands.
    expect(values).toMatchObject({ destaque: '#00a859', margem: 80 });
  });

  it('leaves the configuration’s values when the brief sets none', async () => {
    const { values } = await compiled(`---
template: valores-vermelho
---
::titulo Concurso
`);
    expect(values).toMatchObject({ destaque: '#e30613', margem: 80 });
  });

  it('warns at the key and keeps the default for a value of the wrong kind or out of its limits', async () => {
    const brief = `---
template: valores
destaque: 'vermelho'
margem: 900
---
::titulo Concurso
`;
    const { values, diagnostics } = await compiled(brief);
    expect(values).toMatchObject({ destaque: '#1363d0', margem: 60 });
    const warnings = diagnostics.filter((item) => item.code === 'W_TEMPLATE_VALUE_INVALID');
    expect(warnings).toHaveLength(2);
    expect(warnings.map((item) => brief.slice(item.range!.start, item.range!.end))).toEqual([
      'destaque',
      'margem',
    ]);
  });

  it('says to write the quotes when an unquoted hex arrives empty', async () => {
    const { values, diagnostics } = await compiled(`---
template: valores
destaque: #e30613
---
::titulo Concurso
`);
    expect(values).toMatchObject({ destaque: '#1363d0' });
    const warning = diagnostics.find((item) => item.code === 'W_TEMPLATE_VALUE_INVALID');
    expect(warning?.message).toContain('in quotes');
  });

  it('refuses an image value in the frontmatter, the configuration’s path for it', async () => {
    const { diagnostics } = await compiled(`---
template: valores
logo: ./logo.png
---
::titulo Concurso
`);
    const warning = diagnostics.find((item) => item.code === 'W_TEMPLATE_VALUE_INVALID');
    expect(warning?.message).toContain('does not set yet');
  });

  it('sets the slot, not the value, when a slot and a value share the name', async () => {
    const { values, diagnostics } = await compiled(`---
template: valores
fundo: Texto do slot
---
::titulo Concurso
`);
    expect(values).toMatchObject({ fundo: '#f7f4f4' });
    expect(codes(diagnostics)).toEqual([]);
  });

  it('keeps a key that is neither a slot nor a value the error it was', async () => {
    const parsed = parseBrief(`---
template: valores
cor: '#00a859'
---
::titulo Concurso
`);
    if (!parsed.ok) throw new Error('parse');
    const resolved = await resolve(parsed.value, { registry, assets, configurations });
    const all = resolved.ok ? resolved.diagnostics : resolved.error;
    expect(codes(all)).toContain('E_UNKNOWN_SLOT');
  });
});
