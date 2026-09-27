import {
  type BriefAst,
  type Directive,
  type ExpandedInline,
  type Inline,
  type TemplateRegistry,
  diagnostic,
  err,
  ok,
  parseManifest,
  resolve,
  sourceRange,
} from '@tyto/core';
import { describe, expect, it } from 'vitest';

import type { DirectiveContribution } from './contributions.js';
import { directiveNamesOf, directiveResolverOf } from './directives.js';
import { createPluginHost } from './host.js';

/**
 * The `directive` point, in process, as far as `resolve` (ADR 0043).
 *
 * `::demo/shout {slot: titulo} Direito` is the card's test plugin: the slot is named by a
 * parsed adjustment — the grammar has no argument node, and reading the first word of the
 * body would be a convention the parser knows nothing about — and the body is uppercased.
 * The same plugin through a worker boundary is `isolation/isolated-plugin.test.ts`.
 */

function shouted(inline: Inline): ExpandedInline {
  switch (inline.kind) {
    case 'text':
      return { kind: 'text', value: inline.value.toUpperCase() };
    case 'break':
      return { kind: 'break' };
    case 'bold':
    case 'italic':
      return { kind: inline.kind, children: inline.children.map(shouted) };
    case 'mark':
      return { ...inline, children: inline.children.map(shouted) };
  }
}

const SHOUT: DirectiveContribution = {
  id: 'demo',
  names: ['shout'],
  transform: (directive) => {
    const slot = directive.adjustments.find((adjustment) => adjustment.name === 'slot')?.value;
    if (slot === undefined) {
      return err([
        diagnostic('E_DIRECTIVE_ARGUMENT', {
          directive: 'demo/shout',
          problem: 'needs {slot: name}',
        }),
      ]);
    }
    return ok([{ name: slot, body: directive.body.map(shouted) }]);
  },
};

const MANIFEST = parseManifest(
  `name: promo-curso
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text, required: true }
  slide: { type: rich-text, repeat: true, min: 1 }
`,
  'manifest.yaml',
);

function registry(): TemplateRegistry {
  if (!MANIFEST.ok) throw new Error('manifest');
  const manifest = MANIFEST.value;
  return {
    list: () => [manifest],
    get: (name) => (name === manifest.name ? manifest : undefined),
    formatsOf: () => manifest.formats,
    directoryOf: () => 'templates/promo-curso',
    failures: [],
  };
}

const AT = sourceRange(20, 50);
const NAME = sourceRange(22, 32);

function briefWith(shout: Directive): BriefAst {
  const slide: Directive = {
    name: 'slide',
    adjustments: [],
    body: [{ kind: 'text', value: 'Um', range: sourceRange(51, 53) }],
    range: sourceRange(51, 60),
    nameRange: sourceRange(51, 56),
  };
  return {
    frontmatter: { data: { template: 'promo-curso' }, ranges: {} },
    directives: [shout, slide],
    range: sourceRange(0, 60),
  };
}

const SHOUT_TITULO: Directive = {
  name: 'shout',
  namespace: 'demo',
  adjustments: [{ name: 'slot', value: 'titulo', range: sourceRange(33, 47) }],
  body: [{ kind: 'text', value: 'Direito', range: sourceRange(48, 55) }],
  range: AT,
  nameRange: NAME,
};

const noAssets = { base: '', resolve: () => Promise.resolve(undefined) };

describe('a directive registered in the host', () => {
  it('uppercases the slot text through resolve', async () => {
    const host = createPluginHost();
    host.activate({
      id: 'demo',
      manifest: {
        name: 'demo',
        version: '1.0.0',
        engine: '>=0.1',
        contributes: ['directive'],
        permissions: [],
      },
      activate: (plugin) => plugin.registerDirective(SHOUT),
    });

    const resolved = await resolve(briefWith(SHOUT_TITULO), {
      registry: registry(),
      assets: noAssets,
      directives: directiveResolverOf(() => host.registry.directives()),
    });
    expect(resolved.ok && resolved.diagnostics).toEqual([]);
    expect(resolved.ok ? resolved.value.slots.titulo?.value : undefined).toEqual({
      kind: 'rich-text',
      text: [{ kind: 'text', value: 'DIREITO', range: AT }],
    });
  });

  it('is E_UNKNOWN_DIRECTIVE without the plugin, ranged on the name', async () => {
    const resolved = await resolve(briefWith(SHOUT_TITULO), {
      registry: registry(),
      assets: noAssets,
      directives: directiveResolverOf(() => []),
    });
    const problems = resolved.ok ? resolved.diagnostics : resolved.error;
    const unknown = problems.find((item) => item.code === 'E_UNKNOWN_DIRECTIVE');
    expect(unknown?.message).toBe(
      "Unknown directive '::demo/shout'. No template slot or installed plugin provides it.",
    );
    expect(unknown?.range).toEqual(NAME);
  });

  it('resolves only the names the contribution declares', () => {
    const resolver = directiveResolverOf(() => [SHOUT]);
    expect(resolver.find('demo', 'shout')).toBeTypeOf('function');
    expect(resolver.find('demo', 'whisper')).toBeUndefined();
    expect(resolver.find('ai', 'shout')).toBeUndefined();
  });

  it('lists ns/name for autocomplete', () => {
    expect(directiveNamesOf([SHOUT, { ...SHOUT, id: 'ai', names: ['caption', 'alt'] }])).toEqual([
      'demo/shout',
      'ai/caption',
      'ai/alt',
    ]);
  });

  it('refuses a second plugin claiming the same namespace', () => {
    const manifest = (name: string) => ({
      name,
      version: '1.0.0',
      engine: '>=0.1',
      contributes: ['directive'],
      permissions: [],
    });
    const host = createPluginHost();
    host.activate({
      id: 'one',
      manifest: manifest('one'),
      activate: (p) => p.registerDirective(SHOUT),
    });
    const refused = host.tryActivate({
      id: 'two',
      manifest: manifest('two'),
      activate: (p) => p.registerDirective(SHOUT),
    });
    expect(refused.ok ? [] : refused.error.map((item) => item.code)).toEqual([
      'E_PLUGIN_DUPLICATE',
    ]);
  });
});
