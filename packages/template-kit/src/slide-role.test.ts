import { describe, expect, it } from 'vitest';

import { type AdjustedContext, flag, oneOf, roleOf } from './slide-role.js';

/*
 * The oracles: each template's `roleOf` on its origin/main, code copied verbatim; `context` is
 * typed as what they read of it (`AdjustedContext`) and nothing else changes.
 * - concursos-abertos :190 (b56819c);
 * - informativo :315 (193cee7);
 * - questao-estrategica :274 with `markedRole` (38ae3a5);
 * - voce-conhece :216 (1e1fabb).
 */

type TemplateContext = AdjustedContext;
type Adjustments = TemplateContext['adjustments'];

function abertosRoleOf(context: TemplateContext): 'capa' | 'contracapa' | 'lamina' {
  if (context.adjustments['capa'] === true) return 'capa';
  if (context.adjustments['contracapa'] === true) return 'contracapa';
  return 'lamina';
}

function informativoRoleOf(context: TemplateContext): 'ruling' | 'contracapa' {
  return context.adjustments['contracapa'] === true ? 'contracapa' : 'ruling';
}

type QuestaoRole = 'capa' | 'enunciado' | 'resposta' | 'fecho';

function markedRole(adjustments: Adjustments): QuestaoRole | undefined {
  if (adjustments['capa'] === true) return 'capa';
  if (adjustments['resposta'] === true) return 'resposta';
  if (adjustments['fecho'] === true) return 'fecho';
  return undefined;
}

function questaoRoleOf(context: TemplateContext): QuestaoRole {
  const own = markedRole(context.adjustments);
  if (own !== undefined) return own;
  if (context.adjustments['continua'] !== true) return 'enunciado';
  const before = context.artworks?.slice(0, context.artwork.index).reverse() ?? [];
  for (const { adjustments } of before) {
    const role = markedRole(adjustments);
    if (role !== undefined) return role === 'resposta' ? 'resposta' : 'enunciado';
    if (adjustments['continua'] !== true) return 'enunciado';
  }
  return 'enunciado';
}

function voceRoleOf(context: TemplateContext): 'capa' | 'explicacao' | 'fecho' {
  if (context.adjustments['capa'] === true) return 'capa';
  if (context.adjustments['fecho'] === true) return 'fecho';
  return 'explicacao';
}

/* ------------------------------------------------------------------------- shapes -- */

/** Every set of these flags, each with and without an unrelated flag and an enum beside it. */
function shapes(flags: readonly string[]): Adjustments[] {
  const all: Adjustments[] = [];
  for (let mask = 0; mask < 1 << flags.length; mask += 1) {
    const set: Record<string, string | true> = {};
    flags.forEach((name, index) => {
      if ((mask & (1 << index)) !== 0) set[name] = true;
    });
    all.push(set, { ...set, destaque: true }, { ...set, proporcao: '2x1' });
  }
  return all;
}

/** A slide alone: no slides before it, with `artworks` and without. */
function alone(adjustments: Adjustments): TemplateContext[] {
  return [
    { adjustments, artwork: { id: 'slide', index: 0, count: 1 } },
    { adjustments, artwork: { id: 'slide', index: 0, count: 1 }, artworks: [{ adjustments }] },
  ];
}

/** The slide last in a carousel whose slides before it are `before`. */
function after(before: readonly Adjustments[], adjustments: Adjustments): TemplateContext {
  const artworks = [...before, adjustments].map((each) => ({ adjustments: each }));
  return {
    adjustments,
    artwork: { id: 'slide', index: before.length, count: artworks.length },
    artworks,
  };
}

/** The role flags written on a slide, in the precedence the spec lists. */
const written = (adjustments: Adjustments, roles: readonly string[]) =>
  roles.filter((role) => adjustments[role] === true);

/* -------------------------------------------------------------------------- tests -- */

describe('a slide’s role, against the four templates', () => {
  it('reads concursos-abertos’ roles on every shape', () => {
    const roles = ['capa', 'contracapa'] as const;
    for (const adjustments of shapes(roles)) {
      for (const context of alone(adjustments)) {
        const kit = roleOf(context, { roles, default: 'lamina' });
        expect(kit.role).toBe(abertosRoleOf(context));
        expect(kit.conflict).toEqual(
          written(adjustments, roles).length > 1 ? written(adjustments, roles) : undefined,
        );
      }
    }
  });

  it('reads informativo’s roles on every shape', () => {
    for (const adjustments of shapes(['contracapa'])) {
      for (const context of alone(adjustments)) {
        const kit = roleOf(context, { roles: ['contracapa'], default: 'ruling' });
        expect(kit.role).toBe(informativoRoleOf(context));
        expect(kit.conflict).toBeUndefined();
      }
    }
  });

  it('reads voce-conhece’s roles on every shape', () => {
    const roles = ['capa', 'fecho'] as const;
    for (const adjustments of shapes(roles)) {
      for (const context of alone(adjustments)) {
        expect(roleOf(context, { roles, default: 'explicacao' }).role).toBe(voceRoleOf(context));
      }
    }
  });

  it('reads questao-estrategica’s roles on every shape, continuations walked back', () => {
    const roles = ['capa', 'resposta', 'fecho'] as const;
    const spec = {
      roles,
      default: 'enunciado',
      continuation: { flag: 'continua', carries: ['resposta'] as const },
    } as const;
    const flags = [...roles, 'continua'];
    const slides = shapes(flags);
    const plain = slides.filter((each) => Object.keys(each).every((key) => flags.includes(key)));
    let compared = 0;
    for (const adjustments of slides) {
      for (const context of alone(adjustments)) {
        expect(roleOf(context, spec).role).toBe(questaoRoleOf(context));
        compared += 1;
      }
      // Every slide before it, one or two of them, of every shape.
      for (const first of plain) {
        const one = after([first], adjustments);
        expect(roleOf(one, spec).role).toBe(questaoRoleOf(one));
        compared += 1;
        for (const second of plain) {
          const two = after([first, second], adjustments);
          expect(roleOf(two, spec).role).toBe(questaoRoleOf(two));
          compared += 1;
        }
      }
    }
    // Chains of bare continuations three and four deep, behind every role.
    for (const marked of plain) {
      for (const depth of [3, 4]) {
        const chain = after([marked, ...Array(depth - 1).fill({ continua: true })], {
          continua: true,
        });
        expect(roleOf(chain, spec).role).toBe(questaoRoleOf(chain));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(10_000);
  });

  it('carries an answer on past bare continuations, and nothing else', () => {
    const spec = {
      roles: ['capa', 'resposta', 'fecho'],
      default: 'enunciado',
      continuation: { flag: 'continua', carries: ['resposta'] },
    } as const;
    const continued = (before: Adjustments[]) =>
      roleOf(after(before, { continua: true }), spec).role;
    expect(continued([{ resposta: true }, { continua: true }])).toBe('resposta');
    expect(continued([{ capa: true }, { continua: true }])).toBe('enunciado');
    expect(continued([{ resposta: true }, {}])).toBe('enunciado');
    expect(continued([])).toBe('enunciado');
  });

  it('says which role flags were written together, the first listed winning', () => {
    const context = alone({ fecho: true, capa: true })[0]!;
    expect(roleOf(context, { roles: ['capa', 'resposta', 'fecho'], default: 'enunciado' })).toEqual(
      { role: 'capa', conflict: ['capa', 'fecho'] },
    );
  });
});

describe('a flag and an enum', () => {
  it('reads a flag as written, and false when it is not', () => {
    expect(flag({ adjustments: { continua: true } }, 'continua')).toBe(true);
    expect(flag({ adjustments: {} }, 'continua')).toBe(false);
    expect(flag({ adjustments: { continua: 'sim' } }, 'continua')).toBe(false);
  });

  it('reads an enum’s value, and the fallback when it is absent or not one of the values', () => {
    const values = ['4x5', '1x1'] as const;
    expect(oneOf({ adjustments: { proporcao: '1x1' } }, 'proporcao', values, '4x5')).toBe('1x1');
    expect(oneOf({ adjustments: {} }, 'proporcao', values, '4x5')).toBe('4x5');
    expect(oneOf({ adjustments: { proporcao: '3x2' } }, 'proporcao', values, '4x5')).toBe('4x5');
    expect(oneOf({ adjustments: { proporcao: true } }, 'proporcao', values, '4x5')).toBe('4x5');
  });
});
