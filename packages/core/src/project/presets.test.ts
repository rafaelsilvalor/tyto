import { describe, expect, it } from 'vitest';

import { type SourceRange, sourceRange } from '../source/range.js';
import {
  type ProjectEntry,
  type ProjectLayer,
  type ProjectNode,
  projectPaths,
  resolveProject,
} from './project.js';

/**
 * `exportPresets` (TYTO-270, ADR 0126): the shape, the merge by name, the folder resolved
 * against the workspace whichever sheet wrote it, and the confinement of a restricted one.
 */

const WORKSPACE = '/work/promo';
const PROFILE = '/home/me/.tyto/profiles/saude';

function sheet(
  kind: ProjectLayer['kind'],
  entries: Record<string, unknown>,
  trust: ProjectLayer['trust'] = 'trusted',
): ProjectLayer {
  return {
    kind,
    root: kind === 'folder' ? WORKSPACE : PROFILE,
    trust,
    entries: Object.entries(entries).map(([key, value], index): ProjectEntry => ({
      key,
      value,
      keyRange: sourceRange(index * 1000, index * 1000 + key.length),
      node: nodeOf(value, index * 1000 + 100),
    })),
  };
}

/**
 * A made-up syntax tree with a distinct range per member and item, so a test can say which one a
 * diagnostic points at: each member's key sits at `start + 10 × position`, its value 5 after.
 */
function nodeOf(value: unknown, start: number): ProjectNode {
  const range: SourceRange = sourceRange(start, start + 1);
  if (Array.isArray(value)) {
    return { range, items: value.map((item, position) => nodeOf(item, start + position + 1)) };
  }
  if (typeof value !== 'object' || value === null) return { range };
  return {
    range,
    members: Object.entries(value).map(([key, item], position) => ({
      key,
      keyRange: sourceRange(start + 10 * (position + 1), start + 10 * (position + 1) + 1),
      value: nodeOf(item, start + 10 * (position + 1) * 10 + 5),
    })),
  };
}

const codes = (found: readonly { readonly code: string }[] | undefined): string[] =>
  (found ?? []).map((item) => item.code);

describe('the shape of an export preset', () => {
  it('reads formats, types and folder, with png when no type is named', () => {
    const project = resolveProject([
      sheet('folder', {
        exportPresets: {
          entregas: { formats: ['grid-1x1', 'story'], folder: 'entregas' },
          web: { formats: ['story'], types: ['webp', 'png'], folder: 'web' },
        },
      }),
    ]);
    expect(project.exportPresets).toEqual([
      {
        name: 'entregas',
        formats: ['grid-1x1', 'story'],
        types: ['png'],
        folder: '/work/promo/entregas',
        origin: 'folder',
      },
      {
        name: 'web',
        formats: ['story'],
        types: ['webp', 'png'],
        folder: '/work/promo/web',
        origin: 'folder',
      },
    ]);
    expect(project.diagnostics).toEqual([[]]);
  });

  it("delivers to the project's output when the preset names no folder", () => {
    const project = resolveProject([
      sheet('folder', { output: 'out', exportPresets: { tudo: { formats: ['grid-1x1'] } } }),
    ]);
    expect(project.exportPresets.map((preset) => preset.folder)).toEqual(['/work/promo/out']);
  });

  it('leaves out a preset with neither a folder nor an output, at its name', () => {
    const project = resolveProject([
      sheet('folder', { exportPresets: { tudo: { formats: ['grid-1x1'] } } }),
    ]);
    expect(project.exportPresets).toEqual([]);
    expect(codes(project.diagnostics[0])).toEqual(['W_PROJECT_PRESET_NO_FOLDER']);
    // `tudo` is the first member of the value written at 100.
    expect(project.diagnostics[0]?.[0]?.range).toEqual(sourceRange(110, 111));
  });
});

describe('presets merge by name, profile then folder (ADR 0126, ADR 0112)', () => {
  it('replaces the preset the folder redefines and inherits the others', () => {
    const project = resolveProject([
      sheet('profile', {
        exportPresets: {
          entregas: { formats: ['grid-1x1'], types: ['jpeg'], folder: 'entregas' },
          rascunho: { formats: ['story'], folder: 'rascunho' },
        },
      }),
      sheet('folder', {
        exportPresets: { entregas: { formats: ['grid-1x1', 'story'], folder: 'cliente' } },
      }),
    ]);
    expect(project.exportPresets).toEqual([
      {
        name: 'entregas',
        formats: ['grid-1x1', 'story'],
        // Replaced whole: the profile's `jpeg` does not survive a redefinition without types.
        types: ['png'],
        folder: '/work/promo/cliente',
        origin: 'folder',
      },
      {
        name: 'rascunho',
        formats: ['story'],
        types: ['png'],
        folder: '/work/promo/rascunho',
        origin: 'profile',
      },
    ]);
  });

  it("resolves a profile preset's folder against the workspace, not the profile", () => {
    const project = resolveProject([
      sheet('profile', { exportPresets: { entregas: { formats: ['story'], folder: 'entregas' } } }),
      sheet('folder', {}),
    ]);
    expect(project.exportPresets[0]?.folder).toBe('/work/promo/entregas');
  });

  it("gives a profile preset with no folder the folder's output, which wins", () => {
    const project = resolveProject([
      sheet('profile', { output: 'perfil-out', exportPresets: { tudo: { formats: ['story'] } } }),
      sheet('folder', { output: 'out' }),
    ]);
    expect(project.exportPresets[0]?.folder).toBe('/work/promo/out');
  });
});

describe('a restricted folder confines a preset folder to itself (ADR 0111)', () => {
  it('drops a preset whose folder climbs out, with no fallback to the profile', () => {
    const project = resolveProject([
      sheet('profile', { exportPresets: { entregas: { formats: ['story'], folder: 'entregas' } } }),
      sheet(
        'folder',
        { output: 'out', exportPresets: { entregas: { formats: ['story'], folder: '../fora' } } },
        'restricted',
      ),
    ]);
    expect(project.exportPresets).toEqual([]);
    expect(codes(project.diagnostics[1])).toEqual(['W_PROJECT_PATH_OUTSIDE']);
    expect(project.diagnostics[1]?.[0]?.message).toContain('exportPresets.entregas.folder');
  });

  it("confines a trusted profile's preset when the folder is restricted", () => {
    const project = resolveProject([
      sheet('profile', { exportPresets: { entregas: { formats: ['story'], folder: '/tmp/x' } } }),
      sheet('folder', {}, 'restricted'),
    ]);
    expect(project.exportPresets).toEqual([]);
    expect(codes(project.diagnostics[0])).toEqual(['W_PROJECT_PATH_OUTSIDE']);
  });

  it('asks the link check about what passed the lexical one, against the workspace', () => {
    const layers = [
      sheet(
        'folder',
        { exportPresets: { entregas: { formats: ['story'], folder: 'link' } } },
        'restricted',
      ),
    ];
    expect(projectPaths(layers)).toEqual([{ layer: 0, path: '/work/promo/link', root: WORKSPACE }]);
    const asked: string[] = [];
    const project = resolveProject(layers, {
      leadsOutside: (_layer, path, root) => {
        asked.push(`${root}|${path}`);
        return true;
      },
    });
    expect(asked).toEqual(['/work/promo|/work/promo/link']);
    expect(project.exportPresets).toEqual([]);
    expect(codes(project.diagnostics[0])).toEqual(['W_PROJECT_PATH_OUTSIDE']);
  });

  it('lets a trusted folder deliver anywhere', () => {
    const project = resolveProject([
      sheet('folder', { exportPresets: { entregas: { formats: ['story'], folder: '/tmp/x' } } }),
    ]);
    expect(project.exportPresets[0]?.folder).toBe('/tmp/x');
  });
});

describe('a wrong shape costs one entry, at its range', () => {
  it('refuses each bad preset at the place it was written and keeps the good one', () => {
    const project = resolveProject([
      sheet('folder', {
        output: 'out',
        exportPresets: {
          '': { formats: ['story'] },
          vazio: { formats: [] },
          misto: { formats: ['story', 3, ''], delivery: true },
          texto: 'story',
        },
      }),
    ]);
    const found = project.diagnostics[0] ?? [];
    // Where `nodeOf` puts things: the presets object is the second entry's value, at 1100.
    const keyAt = (start: number, position: number): number => start + 10 * (position + 1);
    const valueAt = (start: number, position: number): number => start + 100 * (position + 1) + 5;
    const presets = 1100;
    const misto = valueAt(presets, 2);
    expect(found.map((item) => [item.code, item.range?.start])).toEqual([
      // The empty name, at its key.
      ['W_PROJECT_KEY_INVALID', keyAt(presets, 0)],
      // `vazio`'s empty list, at the list.
      ['W_PROJECT_KEY_INVALID', valueAt(valueAt(presets, 1), 0)],
      // `misto`: the unknown key, then each entry that is not a name, at the entry.
      ['W_PROJECT_KEY_UNKNOWN', keyAt(misto, 1)],
      ['W_PROJECT_KEY_INVALID', valueAt(misto, 0) + 2],
      ['W_PROJECT_KEY_INVALID', valueAt(misto, 0) + 3],
      // `texto` is not an object, at its value.
      ['W_PROJECT_KEY_INVALID', valueAt(presets, 3)],
    ]);
    expect(project.exportPresets.map((preset) => [preset.name, preset.formats])).toEqual([
      ['misto', ['story']],
    ]);
  });

  it('refuses a value that is not an object of presets', () => {
    const project = resolveProject([sheet('folder', { exportPresets: ['story'] })]);
    expect(codes(project.diagnostics[0])).toEqual(['W_PROJECT_KEY_INVALID']);
    expect(project.exportPresets).toEqual([]);
  });
});
