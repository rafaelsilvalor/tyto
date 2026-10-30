import { describe, expect, it } from 'vitest';

import { sourceRange } from '../source/range.js';
import { builtInDelivery, deliveryNameOf, deliveryOfBrief, planDelivery } from './delivery.js';
import { type ProjectEntry, type ProjectLayer, projectPaths, resolveProject } from './project.js';

/**
 * `delivery` (TYTO-489, ADR 0157): the built-in layout, the merge one subkey at a time, the
 * fall-through of a refused subkey, `parent` confined to the workspace for every sheet, and the
 * name rule a delivery shares with a profile.
 */

const WORKSPACE = '/work/campanha';
const PROFILE = '/home/me/.tyto/profiles/saude';

function sheet(
  kind: ProjectLayer['kind'],
  delivery: unknown,
  trust: ProjectLayer['trust'] = 'trusted',
): ProjectLayer {
  const entry: ProjectEntry = { key: 'delivery', value: delivery, keyRange: sourceRange(0, 10) };
  return { kind, root: kind === 'folder' ? WORKSPACE : PROFILE, trust, entries: [entry] };
}

const codes = (found: readonly { readonly code: string }[] | undefined): string[] =>
  (found ?? []).map((item) => item.code);

describe('the delivery key', () => {
  it('is the built-in layout when no sheet writes it', () => {
    const resolved = resolveProject([
      { kind: 'folder', root: WORKSPACE, trust: 'trusted', entries: [] },
    ]);
    expect(resolved.delivery).toEqual({
      parent: WORKSPACE,
      folders: ['assets', 'editaveis'],
      brief: 'editaveis',
      exports: '.',
      origins: {},
    });
  });

  it('takes a project override, one subkey at a time', () => {
    const resolved = resolveProject([
      sheet('folder', { parent: 'entregas', exports: 'final', formats: ['story'] }),
    ]);
    expect(resolved.delivery).toMatchObject({
      parent: `${WORKSPACE}/entregas`,
      folders: ['assets', 'editaveis'],
      exports: 'final',
      formats: ['story'],
      origins: { parent: 'folder', exports: 'folder', formats: 'folder' },
    });
    expect(resolved.delivery.types).toBeUndefined();
  });

  it("keeps a profile's subkeys the folder does not write, and resolves parent in the workspace", () => {
    const resolved = resolveProject([
      sheet('profile', {
        parent: 'entregas',
        folders: ['fotos', 'arquivos/psd'],
        brief: 'arquivos',
      }),
      sheet('folder', { brief: 'briefs' }),
    ]);
    expect(resolved.delivery).toMatchObject({
      // Never `~/.tyto/profiles/saude/entregas`: a campaign's own folder (ADR 0157 §3).
      parent: `${WORKSPACE}/entregas`,
      folders: ['fotos', 'arquivos/psd'],
      brief: 'briefs',
      origins: { parent: 'profile', folders: 'profile', brief: 'folder' },
    });
  });

  it('replaces a list whole, never concatenating', () => {
    const resolved = resolveProject([
      sheet('profile', { folders: ['assets', 'editaveis', 'psd'] }),
      sheet('folder', { folders: ['fotos'] }),
    ]);
    expect(resolved.delivery.folders).toEqual(['fotos']);
  });

  it('lets a refused subkey fall through to the sheet before, or the built-in', () => {
    const resolved = resolveProject([
      sheet('profile', { exports: 'final' }),
      sheet('folder', { exports: '../fora', brief: 42, folders: ['.', '/abs'], surprise: true }),
    ]);
    expect(resolved.delivery).toMatchObject({
      exports: 'final',
      brief: 'editaveis',
      folders: ['assets', 'editaveis'],
      origins: { exports: 'profile' },
    });
    expect(codes(resolved.diagnostics[1])).toEqual([
      'W_PROJECT_KEY_UNKNOWN',
      'W_PROJECT_KEY_INVALID',
      'W_PROJECT_KEY_INVALID',
      'W_PROJECT_KEY_INVALID',
      'W_PROJECT_KEY_INVALID',
    ]);
  });

  it('refuses a value that is not an object, and an empty formats list', () => {
    const notObject = resolveProject([sheet('folder', ['assets'])]);
    expect(codes(notObject.diagnostics[0])).toEqual(['W_PROJECT_KEY_INVALID']);
    const empty = resolveProject([sheet('folder', { formats: [] })]);
    expect(empty.delivery.formats).toBeUndefined();
    expect(codes(empty.diagnostics[0])).toEqual(['W_PROJECT_KEY_INVALID']);
  });

  it('confines parent to the workspace for a trusted sheet too', () => {
    const resolved = resolveProject([sheet('folder', { parent: '../elsewhere' }, 'trusted')]);
    expect(resolved.delivery.parent).toBe(WORKSPACE);
    expect(resolved.diagnostics[0]?.[0]).toMatchObject({
      code: 'W_PROJECT_PATH_OUTSIDE',
      message: expect.stringContaining('delivery.parent') as unknown,
    });
  });

  it('asks the link check about parent for every sheet, against the workspace folder', () => {
    const layers = [sheet('profile', { parent: 'entregas' }, 'trusted'), sheet('folder', {})];
    expect(projectPaths(layers)).toEqual([
      { layer: 0, path: `${WORKSPACE}/entregas`, root: WORKSPACE },
    ]);
    const resolved = resolveProject(layers, {
      leadsOutside: (_layer, path) => path.endsWith('entregas'),
    });
    expect(resolved.delivery.parent).toBe(WORKSPACE);
    expect(codes(resolved.diagnostics[0])).toEqual(['W_PROJECT_PATH_OUTSIDE']);
  });
});

describe('a delivery name', () => {
  it('accepts a ticket key and a title, ª and accents included', () => {
    const name = 'mca-66910_simule-sua-nota-da-2ª-fase';
    expect(deliveryNameOf(name)).toMatchObject({ ok: true, value: name });
  });

  it('is normalised to NFC', () => {
    const decomposed = 'coração';
    const named = deliveryNameOf(decomposed);
    expect(named.ok && named.value).toBe('coração');
  });

  it.each([
    ['', 'is empty'],
    ['.oculta', 'starts with a dot'],
    ['a..b', "holds '..'"],
    ['mca/66910', 'holds a path separator'],
    ['mca\\66910', 'holds a path separator'],
    ['mca:66910', 'holds a character'],
    ['fim.', 'ends in a space or a dot'],
    ['CON.txt', 'reserves for a device'],
  ])('refuses %j', (name, problem) => {
    const named = deliveryNameOf(name);
    expect(named.ok).toBe(false);
    if (named.ok) return;
    expect(named.error[0]).toMatchObject({
      code: 'W_DELIVERY_NAME_INVALID',
      message: expect.stringContaining(problem) as unknown,
    });
  });

  it('allows 100 characters, not the 64 of a profile', () => {
    expect(deliveryNameOf('a'.repeat(100)).ok).toBe(true);
    const long = deliveryNameOf('a'.repeat(101));
    expect(!long.ok && long.error[0]?.message).toContain('100');
  });
});

describe('planDelivery', () => {
  it('makes the folders and names the brief after the delivery', () => {
    const planned = planDelivery(builtInDelivery('/work'), 'mca-1_promo');
    expect(planned).toMatchObject({
      ok: true,
      value: {
        name: 'mca-1_promo',
        folder: '/work/mca-1_promo',
        folders: ['/work/mca-1_promo/assets', '/work/mca-1_promo/editaveis'],
        brief: '/work/mca-1_promo/editaveis/mca-1_promo.brief',
      },
    });
  });

  it("adds the brief's folder when the layout does not list it, and none for the root", () => {
    const layout = { ...builtInDelivery('/work'), folders: ['fotos'], brief: 'briefs/v1' };
    expect(planDelivery(layout, 'x')).toMatchObject({
      value: {
        folders: ['/work/x/fotos', '/work/x/briefs/v1'],
        brief: '/work/x/briefs/v1/x.brief',
      },
    });
    const atRoot = planDelivery({ ...layout, brief: '.' }, 'x');
    expect(atRoot).toMatchObject({
      value: { folders: ['/work/x/fotos'], brief: '/work/x/x.brief' },
    });
  });

  it('stops at a refused name', () => {
    expect(planDelivery(builtInDelivery('/work'), '..')).toMatchObject({ ok: false });
  });
});

describe('deliveryOfBrief', () => {
  const layout = builtInDelivery('/work');

  it('finds the delivery of a brief in its editaveis/, with exports at its root', () => {
    expect(deliveryOfBrief(layout, '/work/mca-1_promo/editaveis/mca-1_promo.brief')).toEqual({
      name: 'mca-1_promo',
      folder: '/work/mca-1_promo',
      exports: '/work/mca-1_promo',
      report: '/work/mca-1_promo/editaveis',
    });
  });

  it('follows the layout in force: another parent, brief folder and exports', () => {
    const custom = { ...layout, parent: '/work/entregas', brief: 'src', exports: 'final' };
    expect(deliveryOfBrief(custom, '/work/entregas/mca-2/src/qualquer.brief')).toEqual({
      name: 'mca-2',
      folder: '/work/entregas/mca-2',
      exports: '/work/entregas/mca-2/final',
      report: '/work/entregas/mca-2/src',
    });
  });

  it('answers a brief kept at the delivery root when brief is "."', () => {
    expect(deliveryOfBrief({ ...layout, brief: '.' }, '/work/mca-3/mca-3.brief')).toMatchObject({
      folder: '/work/mca-3',
      report: '/work/mca-3',
    });
  });

  it.each([
    ['a brief at the parent itself', '/work/solto.brief'],
    ['a brief in the delivery root, not in editaveis/', '/work/mca-1/mca-1.brief'],
    ['a brief one folder too deep', '/work/mca-1/editaveis/rascunhos/mca-1.brief'],
    ['a brief outside the parent', '/elsewhere/mca-1/editaveis/mca-1.brief'],
    ['a folder name no delivery could have', '/work/.oculta/editaveis/x.brief'],
    ['a relative path', 'mca-1/editaveis/mca-1.brief'],
  ])('answers nothing for %s', (_, path) => {
    expect(deliveryOfBrief(layout, path)).toBeUndefined();
  });

  it('compares without case on a Windows-shaped parent, as that file system does', () => {
    const windows = builtInDelivery('D:\\Work');
    expect(deliveryOfBrief(windows, 'd:\\work\\MCA-1\\Editaveis\\a.brief')).toMatchObject({
      name: 'MCA-1',
    });
  });
});
