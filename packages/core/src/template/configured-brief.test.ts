import { describe, expect, it } from 'vitest';

import type { BriefAst, Directive } from '../brief/ast.js';
import { type ResolvedBrief, resolve } from '../brief/resolve.js';
import type { Diagnostics, Result } from '../result/result.js';
import { sourceRange } from '../source/range.js';
import {
  type ConfigurationEntry,
  type ConfigurationImageResolver,
  resolveTemplateConfigurations,
} from './configurations.js';
import { type TemplateManifest, parseManifest } from './manifest.js';
import type { TemplateRegistry } from './registry.js';

/**
 * The brief side of a configuration (TYTO-440, ADR 0151): slot defaults, default formats, the
 * new brief's skeleton and editor rules, each checked against the manifest in the file that
 * wrote it, and each losing to what the brief itself says.
 */

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const SEMANA = manifestOf(`name: semana
version: 1.0.0
formats: [feed, story, banner]
slots:
  titulo: { type: rich-text, required: true, max: 60 }
  rodape: { type: rich-text }
  cor: { type: enum, values: [roxo, ocre], default: roxo }
  selo: { type: image }
  linha: { type: rich-text, repeat: true, min: 1, max: 10 }
`);

const registry: TemplateRegistry = {
  list: () => [SEMANA],
  get: (name) => (name === 'semana' ? SEMANA : undefined),
  formatsOf: (name) => (name === 'semana' ? SEMANA.formats : undefined),
  directoryOf: () => undefined,
  failures: [],
};

const SELO = { id: 'images/selo.png', source: 'file', path: '/w/selo.png', hash: 'h' } as const;

const images: ConfigurationImageResolver = (path) =>
  Promise.resolve(
    path === './selo.png' ? { ref: SELO } : { problem: `names '${path}', which is not there` },
  );

const at = (start: number) => sourceRange(start, start + 1);

async function configured(...configurations: ConfigurationEntry[]) {
  return resolveTemplateConfigurations({
    project: [
      {
        template: 'semana',
        file: 'semana.yaml',
        directory: '/w/.tyto/plugin-files',
        default: 'roxo',
        configurations,
      },
    ],
    machine: [],
    registry,
    images,
  });
}

const ROXO: ConfigurationEntry = {
  name: 'roxo',
  values: {},
  brief: {
    slots: {
      rodape: { value: 'Inscrições abertas', range: at(10) },
      cor: { value: 'ocre', range: at(12) },
      selo: { value: './selo.png', range: at(14) },
    },
    formats: { value: ['story', 'feed'], range: at(20) },
    skeleton: { value: '---\ntemplate: semana-roxo\n---\n', range: at(30) },
    editor: { titulo: { max: { value: 40, range: at(40) } }, linha: { max: { value: 3 } } },
  },
};

const text = (value: string, start: number): Directive['body'] => [
  { kind: 'text', value, range: sourceRange(start, start + value.length) },
];

function directive(name: string, value: string, start: number): Directive {
  return {
    name,
    body: text(value, start),
    adjustments: [],
    range: sourceRange(start, start + value.length),
    nameRange: sourceRange(start, start + name.length),
  } as Directive;
}

function briefOf(
  data: Record<string, unknown>,
  directives: Directive[] = [directive('linha', 'uma', 100)],
): BriefAst {
  return {
    frontmatter: { data, ranges: {}, range: sourceRange(0, 20) },
    directives,
    range: sourceRange(0, 200),
  };
}

async function resolveWith(ast: BriefAst, ...entries: ConfigurationEntry[]) {
  const { configurations } = await configured(...entries);
  return resolve(ast, {
    registry,
    assets: { base: '', resolve: () => Promise.resolve(undefined) },
    configurations,
  });
}

const problemsOf = (result: Result<ResolvedBrief, Diagnostics>) =>
  result.ok ? result.diagnostics : result.error;

const codes = (result: Awaited<ReturnType<typeof configured>>) =>
  result.diagnostics.map(({ diagnostic }) => diagnostic.code);

describe('the brief block, checked once against the manifest', () => {
  it('keeps all four parts when the template can take them', async () => {
    const result = await configured(ROXO);

    expect(result.diagnostics).toEqual([]);
    const brief = result.configurations.select('semana')?.brief;
    expect(brief?.slots.rodape).toEqual({
      kind: 'rich-text',
      text: [{ kind: 'text', value: 'Inscrições abertas', range: sourceRange(0, 0) }],
    });
    expect(brief?.slots.cor).toEqual({ kind: 'enum', value: 'ocre' });
    expect(brief?.slots.selo).toEqual({ kind: 'image', asset: SELO });
    expect(brief?.formats).toEqual(['story', 'feed']);
    expect(brief?.skeleton).toBe('---\ntemplate: semana-roxo\n---\n');
    expect(brief?.editor).toEqual({ titulo: { max: 40 }, linha: { max: 3 } });
  });

  it('warns at each key the template cannot take, in the file that wrote it, and keeps the rest', async () => {
    const result = await configured({
      name: 'roxo',
      values: {},
      brief: {
        slots: {
          nada: { value: 'x', range: at(1) },
          linha: { value: 'x', range: at(2) },
          cor: { value: 'azul', range: at(3) },
          titulo: { value: 'x'.repeat(61), range: at(4) },
          selo: { value: './falta.png', range: at(5) },
          rodape: { value: 'fica', range: at(6) },
        },
        formats: { value: ['feed', 'square'], range: at(7) },
        skeleton: { value: '  ', range: at(8) },
        editor: {
          cor: { max: { value: 3, range: at(9) } },
          titulo: { max: { value: 2.5, range: at(10) } },
        },
      },
    });

    expect(codes(result)).toEqual(Array(9).fill('W_CONFIGURATION_BRIEF_INVALID'));
    expect(result.diagnostics.map(({ diagnostic }) => diagnostic.range)).toEqual(
      [1, 2, 3, 4, 5, 7, 8, 9, 10].map(at),
    );
    expect(result.diagnostics.every(({ file }) => file === 'semana.yaml')).toBe(true);
    expect(result.diagnostics[2]?.diagnostic.message).toBe(
      "brief.slots.cor in configuration 'roxo' of template 'semana' 'azul' is not one of roxo, ocre; it is ignored.",
    );
    expect(result.configurations.select('semana')?.brief).toEqual({
      slots: {
        rodape: {
          kind: 'rich-text',
          text: [{ kind: 'text', value: 'fica', range: sourceRange(0, 0) }],
        },
      },
      editor: {},
    });
  });

  it('refuses an editor rule looser than the manifest at its range, and the manifest stands', async () => {
    const result = await configured({
      name: 'roxo',
      values: {},
      brief: { editor: { titulo: { max: { value: 80, range: at(40) } } } },
    });

    expect(codes(result)).toEqual(['W_EDITOR_RULE_LOOSER']);
    expect(result.diagnostics[0]?.diagnostic.range).toEqual(at(40));
    expect(result.diagnostics[0]?.diagnostic.message).toBe(
      "The editor rule on slot 'titulo' in configuration 'roxo' allows 80, more than template 'semana' allows (60); the template's limit stands.",
    );
    expect(result.configurations.select('semana')?.brief?.editor).toEqual({});
  });

  it('starts a named configuration’s brief side from the default’s, by slot and by rule', async () => {
    const result = await configured(ROXO, {
      name: 'compacta',
      values: {},
      brief: {
        slots: { rodape: { value: 'Últimas vagas' } },
        formats: { value: 'banner' },
        editor: { titulo: { max: { value: 30 } } },
      },
    });

    const brief = result.configurations.select('semana-compacta')?.brief;
    expect(brief?.slots.cor).toEqual({ kind: 'enum', value: 'ocre' });
    expect(brief?.slots.rodape).toMatchObject({ text: [{ value: 'Últimas vagas' }] });
    expect(brief?.formats).toEqual(['banner']);
    expect(brief?.skeleton).toBe('---\ntemplate: semana-roxo\n---\n');
    expect(brief?.editor).toEqual({ titulo: { max: 30 }, linha: { max: 3 } });
  });
});

describe('a brief that reaches the configuration', () => {
  it('takes the configured slot defaults for what it left unset, and its own for the rest', async () => {
    const result = await resolveWith(briefOf({ template: 'semana', titulo: 'Agenda' }), ROXO);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slots.rodape?.value).toMatchObject({
      text: [{ value: 'Inscrições abertas' }],
    });
    // The configured enum default wins the manifest's, and the brief would win both.
    expect(result.value.slots.cor?.value).toEqual({ kind: 'enum', value: 'ocre' });
    expect(result.value.slots.selo?.value).toEqual({ kind: 'image', asset: SELO });
    expect(result.value.assets).toContainEqual(SELO);

    const own = await resolveWith(
      briefOf({ template: 'semana', titulo: 'Agenda', rodape: 'Meu', cor: 'roxo' }),
      ROXO,
    );
    expect(own.ok && own.value.slots.rodape?.range).toBeDefined();
    expect(own.ok && own.value.slots.cor?.value).toEqual({ kind: 'enum', value: 'roxo' });
  });

  it('fills a required slot from the configuration, so nothing is missing', async () => {
    const result = await resolveWith(briefOf({ template: 'semana' }), {
      ...ROXO,
      brief: { slots: { titulo: { value: 'Agenda da semana' } } },
    });

    expect(result.ok && result.value.missingRequiredSlots).toEqual([]);
    expect(problemsOf(result)).toEqual([]);
  });

  it('renders the configured formats when the brief names none, and the brief’s when it does', async () => {
    const bare = await resolveWith(briefOf({ template: 'semana', titulo: 'A' }), ROXO);
    const own = await resolveWith(
      briefOf({ template: 'semana', titulo: 'A', formats: ['banner'] }),
      ROXO,
    );
    const unconfigured = await resolveWith(briefOf({ template: 'semana', titulo: 'A' }), {
      name: 'roxo',
      values: {},
    });

    expect(bare.ok && bare.value.formats).toEqual(['story', 'feed']);
    expect(own.ok && own.value.formats).toEqual(['banner']);
    expect(unconfigured.ok && unconfigured.value.formats).toEqual(['feed', 'story', 'banner']);
  });

  it('warns past a configured limit at the brief’s range, and keeps the value', async () => {
    const titulo = 'x'.repeat(45);
    const result = await resolveWith(
      briefOf({ template: 'semana' }, [
        directive('titulo', titulo, 50),
        directive('linha', 'um', 100),
        directive('linha', 'dois', 110),
        directive('linha', 'três', 120),
        directive('linha', 'quatro', 130),
      ]),
      ROXO,
    );

    expect(result.ok).toBe(true);
    expect(problemsOf(result).map((item) => [item.code, item.range])).toEqual([
      ['W_SLOT_OVER_CONFIGURED_LIMIT', sourceRange(50, 95)],
      ['W_SLOT_OVER_CONFIGURED_LIMIT', sourceRange(130, 136)],
    ]);
    expect(problemsOf(result)[0]?.message).toBe(
      "Slot 'titulo' is 45 characters, and configuration 'roxo' of template 'semana' allows 40.",
    );
    expect(problemsOf(result)[1]?.message).toContain("Slot 'linha' appears 4 times");
    expect(result.ok && result.value.slots.titulo).toBeDefined();
  });

  it('applies nothing of the brief side to a name no configuration reaches', async () => {
    const { configurations } = await resolveTemplateConfigurations({
      project: [
        {
          template: 'semana',
          file: 'semana.yaml',
          directory: '/w',
          configurations: [ROXO],
        },
      ],
      machine: [],
      registry,
      images,
    });
    const result = await resolve(briefOf({ template: 'semana', titulo: 'x'.repeat(50) }), {
      registry,
      assets: { base: '', resolve: () => Promise.resolve(undefined) },
      configurations,
    });

    expect(problemsOf(result)).toEqual([]);
    expect(result.ok && result.value.slots.rodape).toBeUndefined();
    expect(result.ok && result.value.formats).toEqual(['feed', 'story', 'banner']);
  });
});
