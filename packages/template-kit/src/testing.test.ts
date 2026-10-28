import { type TemplateManifest, defineTemplate, formatCatalogue, parseManifest } from '@tyto/core';
import { font, frame, runsOf, solid, text } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { compileTemplate, placeholderFont } from './testing.js';

/**
 * The helper a template's repository tests with, run here as that repository would run it: a
 * manifest's text, a `build`, a brief and the formats it renders, and nothing read from disk.
 */

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const MANIFEST = manifestOf(`name: cartaz
version: 1.0.0
formats: [grid, story]
slots:
  titulo: { type: rich-text, required: true }
`);

const inter = font('Inter');

/** A one-line poster: the title in white on navy, at the top of whichever format is asked. */
const cartaz = defineTemplate(MANIFEST, (context) => {
  const titulo = context.slots.titulo?.value;
  const runs =
    titulo?.kind === 'rich-text'
      ? runsOf(titulo.text, { font: inter, size: 96, weight: 700, color: '#ffffff' })
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
              id: `${context.idPrefix}.titulo`,
              box: { w: context.size.w - 160 },
              transform: { x: 80, y: 80 },
              runs: runs as [(typeof runs)[number], ...typeof runs],
            }),
          ],
  });
});

const FORMATS = formatCatalogue({
  grid: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
});

const BRIEF = `---
template: cartaz
formats: [grid, story]
---

::titulo
  Turma nova de Direito
`;

describe('compileTemplate', () => {
  it('compiles a brief to a scene and one HTML document per frame', async () => {
    const result = await compileTemplate({ brief: BRIEF, template: cartaz, formats: FORMATS });

    if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
    expect(result.value.scene.artworks).toHaveLength(1);
    expect(
      result.value.frames.map(({ artwork, format, width, height }) => ({
        artwork,
        format,
        width,
        height,
      })),
    ).toEqual([
      { artwork: 'artwork-1', format: 'grid', width: 1080, height: 1350 },
      { artwork: 'artwork-1', format: 'story', width: 1080, height: 1920 },
    ]);
    // The document a template's repository snapshots: stable because nothing was measured
    // and the face is a placeholder, not a font file's bytes.
    expect(result.value.frames[0]?.html).toMatchSnapshot();
    expect(result.value.frames[0]?.html).toContain('Turma nova de Direito');
    expect(result.value.frames[0]?.html).toContain('tyto-test-font:Inter-700-normal');
  });

  it('compiles a brief that names no template against the one under test', async () => {
    const brief = BRIEF.replace('template: cartaz\n', '');
    const result = await compileTemplate({ brief, template: cartaz, formats: FORMATS });

    expect(result.ok).toBe(true);
  });

  it('refuses a brief that names another template, as the app does', async () => {
    const brief = BRIEF.replace('template: cartaz', 'template: outro');
    const result = await compileTemplate({ brief, template: cartaz, formats: FORMATS });

    expect(result.ok ? [] : result.error.map((item) => item.code)).toEqual(['E_UNKNOWN_TEMPLATE']);
  });

  it('answers the brief error with its source range', async () => {
    const brief = BRIEF.replace('::titulo\n  Turma nova de Direito\n', '');
    const result = await compileTemplate({ brief, template: cartaz, formats: FORMATS });

    // A missing required slot is an error the scene survives (ADR 0035), so it may come back
    // on either branch; what matters is that the author is told, at the line.
    const said = result.ok ? result.diagnostics : result.error;
    const missing = said.find((item) => item.code === 'E_MISSING_REQUIRED_SLOT');
    expect(missing?.range).toBeDefined();
  });

  it('refuses a format the caller declared no size for', async () => {
    const formats = formatCatalogue({ grid: { w: 1080, h: 1350 } });
    const result = await compileTemplate({ brief: BRIEF, template: cartaz, formats });

    expect(result.ok).toBe(false);
  });

  it('embeds the face through the font resolver the caller passes', async () => {
    const result = await compileTemplate({
      brief: BRIEF,
      template: cartaz,
      formats: FORMATS,
      font: (face) => `data:font/woff2;base64,${face.font.family}`,
    });

    expect(result.ok && result.value.frames[0]?.html).toContain('data:font/woff2;base64,Inter');
  });

  it('names the face in its placeholder, weight and style included', () => {
    expect(placeholderFont({ font: inter, weight: 400, style: 'italic' })).toBe(
      'tyto-test-font:Inter-400-italic',
    );
  });
});
