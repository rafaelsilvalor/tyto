import { describe, expect, it } from 'vitest';

import type { BriefAst } from '../brief/ast.js';
import { compile, compileDeferred } from '../brief/compile.js';
import { type ResolvedBrief, resolve } from '../brief/resolve.js';
import { formatCatalogue } from '../config/formats.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { sliceRange, sourceRange } from '../source/range.js';
import { type SuppliedValues, resolveValues } from './declared-values.js';
import {
  type TemplateValues,
  colorValue,
  faceValue,
  imageValue,
  numberValue,
} from './value-readers.js';
import {
  type DeferredTemplate,
  type TemplateContext,
  type TemplateFiles,
  defineTemplate,
} from './define.js';
import { type TemplateManifest, parseManifest } from './manifest.js';
import { frame } from './nodes.js';
import type { TemplateRegistry } from './registry.js';

/**
 * A template declares what a configuration may change (TYTO-438, ADR 0153): the manifest's
 * `values` say each one's kind, default and limits, `compile` resolves the supplied over the
 * defaults, and a supplied value the template cannot take is a warning at its range.
 */

const VALUES = `name: cartao
version: 1.0.0
formats: [feed]
slots: {}
values:
  gap: { type: length, default: 20, min: 0, max: 120 }
  drop: { type: number, default: 0.15, min: 0, max: 0.4 }
  paper: { type: color, default: '#fbfbfb' }
  title-face: { type: face, default: { family: Inter, weight: 700 } }
  logo: { type: image, default: assets/logo.png }
  badge: { type: image }
`;

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

function problemsOf(source: string): readonly Diagnostic[] {
  const parsed = parseManifest(source, 'manifest.yaml');
  return parsed.ok ? [] : parsed.error;
}

const LOGO = { id: 'logo', source: 'file', path: 'assets/logo.png', hash: 'h-logo' } as const;
const FILES: TemplateFiles = {
  svg: () => undefined,
  image: (path) => (path === 'assets/logo.png' ? LOGO : undefined),
};

const MANIFEST = manifestOf(VALUES);

describe('the manifest declares configurable values', () => {
  it('loads a manifest with none, as every manifest before it was written', () => {
    expect(manifestOf('name: a\nversion: 1.0.0\nformats: [feed]\nslots: {}\n').values).toBe(
      undefined,
    );
  });

  it('reads each kind with its default and limits', () => {
    expect(MANIFEST.values).toEqual({
      gap: { type: 'length', default: 20, min: 0, max: 120 },
      drop: { type: 'number', default: 0.15, min: 0, max: 0.4 },
      paper: { type: 'color', default: '#fbfbfb' },
      'title-face': { type: 'face', default: { family: 'Inter', weight: 700, style: 'normal' } },
      logo: { type: 'image', default: 'assets/logo.png' },
      badge: { type: 'image' },
    });
  });

  it.each([
    [
      'a default outside its own limits',
      'gap: { type: length, default: 200, max: 120 }',
      'default',
    ],
    ['a minimum above its maximum', 'gap: { type: length, default: 5, min: 9, max: 1 }', 'min'],
    ['a colour that is not hex', "paper: { type: color, default: 'purple' }", 'default'],
    ['a kind that is not one of the five', 'gap: { type: spacing, default: 2 }', 'type'],
    ['limits on a colour', "paper: { type: color, default: '#fff', max: 3 }", 'max'],
  ])('refuses %s, at the key', (_, line, key) => {
    const source = `name: a\nversion: 1.0.0\nformats: [feed]\nslots: {}\nvalues:\n  ${line}\n`;
    const [problem] = problemsOf(source);
    expect(problem?.code).toBe('E_MANIFEST_SHAPE');
    expect(problem?.message).toContain(`values.${line.split(':')[0]}.${key}`);
    expect(problem?.range && sliceRange(source, problem.range)).toBeTruthy();
  });

  it('refuses a name a configuration could not write', () => {
    const source = `name: a\nversion: 1.0.0\nformats: [feed]\nslots: {}\nvalues:\n  '9gap': { type: length, default: 1 }\n`;
    expect(problemsOf(source)[0]?.message).toContain('values.9gap');
  });
});

describe('resolving supplied values over the defaults', () => {
  it('gives every default when nothing is supplied, an image as its file’s ref', () => {
    expect(resolveValues(MANIFEST, undefined, FILES)).toEqual({
      values: {
        gap: 20,
        drop: 0.15,
        paper: '#fbfbfb',
        'title-face': { family: 'Inter', weight: 700, style: 'normal' },
        logo: LOGO,
      },
      diagnostics: [],
    });
  });

  it('takes a supplied value of the declared kind inside its limits', () => {
    const asset = { id: 'other', source: 'file', path: 'x.png', hash: 'h' } as const;
    const { values, diagnostics } = resolveValues(
      MANIFEST,
      {
        gap: { value: '32px' },
        drop: { value: 0.4 },
        paper: { value: '#123' },
        'title-face': { value: { family: 'Source Sans 3', weight: 400, style: 'italic' } },
        badge: { value: asset },
      },
      FILES,
    );
    expect(diagnostics).toEqual([]);
    expect(values).toMatchObject({
      gap: 32,
      drop: 0.4,
      paper: '#123',
      'title-face': { family: 'Source Sans 3', weight: 400, style: 'italic' },
      logo: LOGO,
      badge: asset,
    });
  });

  it.each([
    ['gap', -1, 'is -1px, below its minimum of 0px'],
    ['gap', '121px', 'is 121px, above its maximum of 120px'],
    ['gap', 'wide', "is not a length such as 20 or '20px'"],
    ['drop', 0.5, 'is 0.5, above its maximum of 0.4'],
    ['drop', '0.2', 'is not a number'],
    ['paper', 'purple', "is not a hex colour such as '#5900a7'"],
    ['title-face', { family: 'Inter', weight: 950 }, 'is not a face'],
    ['logo', './logo.png', 'is not an image the host resolved'],
  ])('refuses %s = %j at its range, and keeps the default', (name, value, problem) => {
    const range = sourceRange(10, 20);
    const { values, diagnostics } = resolveValues(MANIFEST, { [name]: { value, range } }, FILES);
    expect(values[name]).toEqual(resolveValues(MANIFEST, undefined, FILES).values[name]);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'W_TEMPLATE_VALUE_INVALID',
        severity: 'warning',
        range,
        message: expect.stringContaining(problem),
      }),
    ]);
  });

  it('warns about a value the template does not declare, and adds nothing', () => {
    const range = sourceRange(3, 8);
    const { values, diagnostics } = resolveValues(
      MANIFEST,
      { 'show-logo': { value: false, range } },
      FILES,
    );
    expect(values).not.toHaveProperty('show-logo');
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'W_TEMPLATE_VALUE_UNKNOWN', severity: 'warning', range }),
    ]);
  });
});

describe('reading the values back', () => {
  const values: TemplateValues = resolveValues(MANIFEST, undefined, FILES).values;

  it('answers the resolved value of the kind asked for', () => {
    expect(numberValue({ values }, 'gap', 0)).toBe(20);
    expect(colorValue({ values }, 'paper', '#000')).toBe('#fbfbfb');
    expect(
      faceValue({ values }, 'title-face', { family: 'X', weight: 400, style: 'normal' }),
    ).toEqual({ family: 'Inter', weight: 700, style: 'normal' });
    expect(imageValue({ values }, 'logo')).toBe(LOGO);
  });

  it('answers the fallback with no values, and for a name of another kind', () => {
    expect(numberValue({}, 'gap', 7)).toBe(7);
    expect(numberValue({ values }, 'paper', 7)).toBe(7);
    expect(colorValue({ values }, 'gap', '#000')).toBe('#000');
    expect(imageValue({ values }, 'title-face')).toBeUndefined();
  });
});

/* ------------------------------------------------------------- through compile -- */

const FORMATS = formatCatalogue({ feed: { w: 100, h: 100 } });

async function resolvedFor(manifest: TemplateManifest): Promise<ResolvedBrief> {
  const registry: TemplateRegistry = {
    list: () => [manifest],
    get: () => manifest,
    formatsOf: () => manifest.formats,
    directoryOf: () => undefined,
    failures: [],
  };
  const ast: BriefAst = {
    frontmatter: { data: { template: 'cartao' }, ranges: {}, range: sourceRange(0, 20) },
    directives: [],
    range: sourceRange(0, 20),
  };
  const result = await resolve(ast, {
    registry,
    assets: { base: '', resolve: () => Promise.resolve(undefined) },
  });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

describe('compile hands a template its values', () => {
  async function handed(values: SuppliedValues | undefined) {
    const contexts: TemplateContext[] = [];
    const template = defineTemplate(
      MANIFEST,
      (context) => {
        contexts.push(context);
        return frame({ format: context.format, size: context.size, idPrefix: context.idPrefix });
      },
      FILES,
    );
    const result = compile(await resolvedFor(MANIFEST), template, {
      formats: FORMATS,
      ...(values === undefined ? {} : { values }),
    });
    if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
    return { contexts, diagnostics: result.diagnostics };
  }

  it('hands the defaults, an image read from the template’s files, with nothing supplied', async () => {
    const { contexts, diagnostics } = await handed(undefined);
    expect(contexts[0]?.values).toEqual(resolveValues(MANIFEST, undefined, FILES).values);
    expect(diagnostics).toEqual([]);
  });

  it('hands a supplied value, and reports a refused one beside the scene', async () => {
    const range = sourceRange(40, 45);
    const { contexts, diagnostics } = await handed({
      gap: { value: 48 },
      drop: { value: 9, range },
    });
    expect(contexts[0]?.values).toMatchObject({ gap: 48, drop: 0.15 });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'W_TEMPLATE_VALUE_INVALID', range }),
    ]);
  });

  it('hands a template no folder an image with no default as absent', async () => {
    const template = defineTemplate(MANIFEST, (context) => {
      expect(context.values?.['logo']).toBeUndefined();
      return frame({ format: context.format, size: context.size, idPrefix: context.idPrefix });
    });
    expect(compile(await resolvedFor(MANIFEST), template, { formats: FORMATS }).ok).toBe(true);
  });

  it('sends a deferred template its values with the call, and reports a refused one once', async () => {
    const contexts: TemplateContext[] = [];
    const deferred: DeferredTemplate = {
      manifest: MANIFEST,
      buildLater: (context) => {
        contexts.push(context);
        const built = frame({
          format: context.format,
          size: context.size,
          idPrefix: context.idPrefix,
        });
        return Promise.resolve({ ok: true, value: built, diagnostics: [] });
      },
    };
    const result = await compileDeferred(await resolvedFor(MANIFEST), deferred, {
      formats: FORMATS,
      values: { gap: { value: 500 }, paper: { value: '#000000' } },
    });
    // The refused 500 leaves the default, and the taken colour crosses. An image default is
    // the template folder's, and this deferred template was loaded with none (ADR 0062).
    expect(contexts[0]?.values).toEqual({
      gap: 20,
      drop: 0.15,
      paper: '#000000',
      'title-face': { family: 'Inter', weight: 700, style: 'normal' },
    });
    expect(result.ok && result.diagnostics.map((item) => item.code)).toEqual([
      'W_TEMPLATE_VALUE_INVALID',
    ]);
  });

  it('resolves a deferred template’s image default against the files it was loaded with', async () => {
    const contexts: TemplateContext[] = [];
    const deferred: DeferredTemplate = {
      manifest: MANIFEST,
      files: FILES,
      buildLater: (context) => {
        contexts.push(context);
        const built = frame({
          format: context.format,
          size: context.size,
          idPrefix: context.idPrefix,
        });
        return Promise.resolve({ ok: true, value: built, diagnostics: [] });
      },
    };
    const result = await compileDeferred(await resolvedFor(MANIFEST), deferred, {
      formats: FORMATS,
    });

    // The host read the plugin's folder (TYTO-478), so the default is its file's ref, and
    // the context's `files` is what `buildLater` sends across as data.
    expect(result.ok).toBe(true);
    expect(contexts[0]?.values?.['logo']).toBe(LOGO);
    expect(contexts[0]?.files.image('assets/logo.png')).toBe(LOGO);
  });
});
