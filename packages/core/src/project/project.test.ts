import { describe, expect, it } from 'vitest';

import { sourceRange } from '../source/range.js';
import { isInsidePath, resolvePath } from './paths.js';
import { type ProjectEntry, type ProjectLayer, projectPaths, resolveProject } from './project.js';

function folder(
  entries: Record<string, unknown>,
  trust: ProjectLayer['trust'] = 'trusted',
  root = '/work/promo',
): ProjectLayer {
  return { kind: 'folder', root, trust, entries: entriesOf(entries) };
}

/** A work profile kept in `TYTO_HOME/profiles/saude/`, trusted by where it lives (ADR 0111). */
function profileSheet(entries: Record<string, unknown>): ProjectLayer {
  return {
    kind: 'profile',
    root: '/home/me/.tyto/profiles/saude',
    trust: 'trusted',
    entries: entriesOf(entries),
  };
}

function entriesOf(record: Record<string, unknown>): ProjectEntry[] {
  return Object.entries(record).map(([key, value], index) => ({
    key,
    value,
    keyRange: sourceRange(index * 10, index * 10 + key.length),
  }));
}

function codes(layer: readonly { readonly code: string }[] | undefined): string[] {
  return (layer ?? []).map((item) => item.code);
}

describe('resolvePath and isInsidePath', () => {
  it('joins a relative value onto the root and applies dot-dot', () => {
    expect(resolvePath('/work/promo', 'assets/../art')).toBe('/work/promo/art');
    expect(resolvePath('D:\\work\\promo', 'out/png')).toBe('D:\\work\\promo\\out\\png');
    expect(resolvePath('/work/promo', '/elsewhere')).toBe('/elsewhere');
  });

  it('compares by segment, so a sibling sharing a prefix is outside', () => {
    expect(isInsidePath('/work', '/work-evil/x')).toBe(false);
    expect(isInsidePath('/work', '/work')).toBe(true);
    expect(isInsidePath('/work', '/work/a/b')).toBe(true);
  });

  it('ignores case on a Windows-shaped root and only there', () => {
    expect(isInsidePath('D:\\Work', 'd:\\work\\assets')).toBe(true);
    expect(isInsidePath('/Work', '/work/assets')).toBe(false);
  });

  it('decodes nothing, so a percent-encoded dot-dot is a folder name', () => {
    expect(isInsidePath('/work', resolvePath('/work', '%2e%2e/secret'))).toBe(true);
  });
});

describe('resolveProject', () => {
  it('resolves every folder key against the sheet root', () => {
    const project = resolveProject([
      folder({
        assets: ['art', 'shared/logos'],
        templates: ['tpl'],
        fonts: ['fonts'],
        output: 'out',
      }),
    ]);
    expect(project).toMatchObject({
      assets: ['/work/promo/art', '/work/promo/shared/logos'],
      templates: ['/work/promo/tpl'],
      fonts: ['/work/promo/fonts'],
      output: '/work/promo/out',
    });
    expect(codes(project.diagnostics[0])).toEqual([]);
  });

  it('lets a trusted folder name a place outside itself', () => {
    const project = resolveProject([folder({ output: '../exports', assets: ['/srv/art'] })]);
    expect(project.output).toBe('/work/exports');
    expect(project.assets).toEqual(['/srv/art']);
  });

  it('confines a restricted folder lexically, and the key takes its default', () => {
    const project = resolveProject([
      folder({ output: '../../home/me/.tyto/plugins', assets: ['/etc', 'art'] }, 'restricted'),
    ]);
    expect(project.output).toBeUndefined();
    expect(project.assets).toEqual(['/work/promo/art']);
    expect(codes(project.diagnostics[0])).toEqual([
      'W_PROJECT_PATH_OUTSIDE',
      'W_PROJECT_PATH_OUTSIDE',
    ]);
    expect(project.diagnostics[0]?.[0]?.message).toContain('../../home/me/.tyto/plugins');
  });

  it('refuses what the link check says leads outside, and only in a restricted sheet', () => {
    const linked = (_layer: number, path: string): boolean => path.endsWith('linked');
    const restricted = resolveProject([folder({ output: 'linked' }, 'restricted')], {
      leadsOutside: linked,
    });
    expect(restricted.output).toBeUndefined();
    expect(codes(restricted.diagnostics[0])).toEqual(['W_PROJECT_PATH_OUTSIDE']);

    const trusted = resolveProject([folder({ output: 'linked' })], { leadsOutside: linked });
    expect(trusted.output).toBe('/work/promo/linked');
  });

  it('lists for the link check exactly the restricted paths the lexical check let through', () => {
    expect(
      projectPaths([
        folder({ output: 'out', assets: ['../x', 'art'] }, 'restricted'),
        folder({ output: 'elsewhere' }, 'trusted'),
      ]),
    ).toEqual([
      { layer: 0, path: '/work/promo/out', root: '/work/promo' },
      { layer: 0, path: '/work/promo/art', root: '/work/promo' },
    ]);
  });

  it('hands plugin sections over from a trusted sheet and withholds them from a restricted one', () => {
    const sections = { plugins: { drive: { folder: 'abc' }, jira: { project: 'TYTO' } } };
    expect(resolveProject([folder(sections)]).sections).toEqual(sections.plugins);

    const withheld = resolveProject([folder(sections, 'restricted')]);
    expect(withheld.sections).toEqual({});
    expect(codes(withheld.diagnostics[0])).toEqual(['W_PROJECT_SECTIONS_WITHHELD']);
    expect(withheld.diagnostics[0]?.[0]?.message).toContain('drive, jira');
  });

  it('merges key by key, the later sheet winning, and a list is replaced whole', () => {
    const profile: ProjectLayer = {
      kind: 'profile',
      root: '/team/profile',
      trust: 'trusted',
      entries: entriesOf({
        fonts: ['fonts'],
        assets: ['brand'],
        output: 'exports',
        plugins: { drive: 1 },
      }),
    };
    const project = resolveProject([
      profile,
      folder({ output: 'out', assets: ['art'], plugins: { jira: 2 } }),
    ]);
    expect(project).toMatchObject({
      // The folder wrote `assets`, so the profile's list is gone, not extended.
      assets: ['/work/promo/art'],
      // It did not write `fonts`, so the profile's list stays — resolved against the profile.
      fonts: ['/team/profile/fonts'],
      output: '/work/promo/out',
      sections: { drive: 1, jira: 2 },
    });
  });

  it('lets a refused key fall through to the sheet before it', () => {
    const profile: ProjectLayer = {
      kind: 'profile',
      root: '/team/profile',
      trust: 'trusted',
      entries: entriesOf({ output: 'exports', fonts: ['fonts'] }),
    };
    const project = resolveProject([
      profile,
      folder({ output: 7, fonts: ['../../x'] }, 'restricted'),
    ]);
    expect(project.output).toBe('/team/profile/exports');
    expect(project.fonts).toEqual(['/team/profile/fonts']);
    expect(codes(project.diagnostics[0])).toEqual([]);
    expect(codes(project.diagnostics[1])).toEqual([
      'W_PROJECT_KEY_INVALID',
      'W_PROJECT_PATH_OUTSIDE',
    ]);
  });

  it('is tolerant per key and per entry', () => {
    const project = resolveProject([
      folder({ assets: ['art', 3, ''], templates: 'tpl', colour: 'red', plugins: [] }),
    ]);
    expect(project.assets).toEqual(['/work/promo/art']);
    expect(project.templates).toEqual([]);
    expect(codes(project.diagnostics[0])).toEqual([
      'W_PROJECT_KEY_INVALID',
      'W_PROJECT_KEY_INVALID',
      'W_PROJECT_KEY_INVALID',
      'W_PROJECT_KEY_UNKNOWN',
      'W_PROJECT_KEY_INVALID',
    ]);
  });

  it("leaves a folder's profile key to profileReferenceOf, and says nothing about it", () => {
    const project = resolveProject([folder({ profile: 'team/brand.json', output: 'out' })]);
    expect(project.output).toBe('/work/promo/out');
    expect(codes(project.diagnostics[0])).toEqual([]);
  });

  it("ignores a profile's own profile key: one level only", () => {
    const project = resolveProject([
      profileSheet({ profile: 'other', output: 'exports' }),
      folder({}),
    ]);
    expect(project.output).toBe('/home/me/.tyto/profiles/saude/exports');
    expect(codes(project.diagnostics[0])).toEqual(['W_PROFILE_NESTED']);
  });

  it('says which kind of sheet each value came from', () => {
    const project = resolveProject([
      profileSheet({
        assets: ['brand'],
        fonts: ['fonts'],
        output: 'exports',
        plugins: { drive: 1, jira: 1 },
      }),
      folder({ output: 'out', plugins: { jira: 2 } }),
    ]);
    expect(project.origins).toEqual({
      assets: 'profile',
      fonts: 'profile',
      output: 'folder',
      sections: { drive: 'profile', jira: 'folder' },
    });
  });

  it('gives a key the folder refused the origin of the sheet that still sets it', () => {
    const project = resolveProject([
      profileSheet({ output: 'exports' }),
      folder({ output: '../../x' }, 'restricted'),
    ]);
    expect(project.origins.output).toBe('profile');
    expect(project.origins.templates).toBeUndefined();
  });

  it('points each diagnostic at where its key was written', () => {
    const project = resolveProject([folder({ output: '../x' }, 'restricted')]);
    expect(project.diagnostics[0]?.[0]?.range).toEqual(sourceRange(0, 6));
  });
});

describe('recipes.call.hosts (TYTO-671, ADR 0193)', () => {
  const hosts = (list: unknown): Record<string, unknown> => ({
    recipes: { call: { hosts: list } },
  });

  it('is a known key, read in lower case without a trailing dot', () => {
    const project = resolveProject([folder(hosts(['Hooks.Example.com.', 'api.example.org']))]);
    expect(project.callHosts).toEqual(['hooks.example.com', 'api.example.org']);
    expect(project.diagnostics[0]).toEqual([]);
  });

  it('is empty when no sheet writes it', () => {
    expect(resolveProject([folder({ output: 'out' })]).callHosts).toEqual([]);
  });

  it("withholds a restricted sheet's list and says so", () => {
    const project = resolveProject([folder(hosts(['hooks.example.com']), 'restricted')]);
    expect(project.callHosts).toEqual([]);
    expect(codes(project.diagnostics[0])).toEqual(['W_PROJECT_KEY_INVALID']);
    expect(project.diagnostics[0]?.[0]?.message).toContain('trusted folder');
  });

  it("keeps the profile's list when the restricted folder writes its own", () => {
    const project = resolveProject([
      profileSheet(hosts(['hooks.example.com'])),
      folder(hosts(['evil.example.net']), 'restricted'),
    ]);
    expect(project.callHosts).toEqual(['hooks.example.com']);
  });

  it("replaces an earlier sheet's list whole", () => {
    const project = resolveProject([
      profileSheet(hosts(['hooks.example.com', 'api.example.org'])),
      folder(hosts(['api.example.org'])),
    ]);
    expect(project.callHosts).toEqual(['api.example.org']);
  });

  it('refuses a port, a scheme, a path or a wildcard, entry by entry', () => {
    const project = resolveProject([
      folder(
        hosts([
          'hooks.example.com:8443',
          'https://hooks.example.com',
          'hooks.example.com/run',
          '*.example.com',
          7,
          'ok.example.com',
        ]),
      ),
    ]);
    expect(project.callHosts).toEqual(['ok.example.com']);
    expect(codes(project.diagnostics[0])).toEqual(Array(5).fill('W_PROJECT_KEY_INVALID'));
  });

  it('lets the sheet before keep its say when every entry is refused', () => {
    const project = resolveProject([
      profileSheet(hosts(['hooks.example.com'])),
      folder(hosts(['*.example.com'])),
    ]);
    expect(project.callHosts).toEqual(['hooks.example.com']);
  });

  it('names an unknown subkey and a value of the wrong shape', () => {
    const project = resolveProject([
      folder({ recipes: { call: { hosts: 'hooks.example.com', method: 'GET' }, other: 1 } }),
    ]);
    expect(project.callHosts).toEqual([]);
    expect(codes(project.diagnostics[0]).sort()).toEqual([
      'W_PROJECT_KEY_INVALID',
      'W_PROJECT_KEY_UNKNOWN',
      'W_PROJECT_KEY_UNKNOWN',
    ]);
    expect(codes(resolveProject([folder({ recipes: [] })]).diagnostics[0])).toEqual([
      'W_PROJECT_KEY_INVALID',
    ]);
  });
});
