import { describe, expect, it } from 'vitest';

import { loadTemplateRegistry } from './registry.js';
import type { DirectoryEntry, FileSystem } from '../ports/file-system.js';
import type { TemplateRegistry } from './registry.js';

/**
 * A fake filesystem, and a log of everything the registry asked it for.
 *
 * The log is the point of half these tests: the card's second acceptance criterion is that
 * the registry never imports or executes `template.ts` or `template.html`, and the honest
 * way to show that is to prove it never even reads them. A spy over the only door the
 * registry has to the outside world says so directly.
 */
function fakeFileSystem(tree: Readonly<Record<string, string>>): FileSystem & {
  readonly reads: readonly string[];
} {
  const reads: string[] = [];
  const paths = Object.keys(tree);

  return {
    reads,
    join: (...segments) => segments.join('/'),
    readDirectory: (path) => {
      reads.push(`dir ${path}`);
      const prefix = `${path}/`;
      const names = new Set<string>();
      const entries: DirectoryEntry[] = [];
      for (const file of paths) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (names.has(name)) continue;
        names.add(name);
        entries.push({ name, isDirectory: slash !== -1 });
      }
      if (entries.length === 0 && !paths.some((file) => file.startsWith(prefix))) {
        return Promise.reject(new Error(`ENOENT: ${path}`));
      }
      return Promise.resolve(entries);
    },
    readFile: (path) => {
      reads.push(`file ${path}`);
      const contents = tree[path];
      return contents === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(contents);
    },
  };
}

function manifest(name: string, formats = '[feed]'): string {
  return `name: ${name}
version: 1.0.0
formats: ${formats}
slots:
  titulo: { type: rich-text }
`;
}

const TREE: Readonly<Record<string, string>> = {
  'templates/promo-curso/manifest.yaml': manifest('promo-curso', '[feed, story]'),
  'templates/promo-curso/template.html': '<frame format="feed"></frame>',
  'templates/promo-curso/template.ts': 'throw new Error("the registry must never run this");',
  'templates/carrossel-lista/manifest.yaml': manifest('carrossel-lista'),
  'templates/carrossel-lista/template.ts': 'throw new Error("nor this");',
  // A folder with no manifest is not a template; a registry that reported it would report
  // `.git` too.
  'templates/assets-only/logo.svg': '<svg/>',
};

async function loaded(
  tree: Readonly<Record<string, string>> = TREE,
): Promise<{ registry: TemplateRegistry; reads: readonly string[] }> {
  const fileSystem = fakeFileSystem(tree);
  const result = await loadTemplateRegistry(fileSystem, 'templates');
  if (!result.ok) {
    throw new Error(`should load: ${result.error.map((item) => item.message).join('; ')}`);
  }
  return { registry: result.value, reads: fileSystem.reads };
}

describe('what the registry finds', () => {
  it('lists one template per folder that has a manifest, in name order', async () => {
    const { registry } = await loaded();
    expect(registry.list().map((item) => item.name)).toEqual(['carrossel-lista', 'promo-curso']);
  });

  it('answers get, formatsOf and directoryOf by manifest name', async () => {
    const { registry } = await loaded();
    expect(registry.get('promo-curso')?.version).toBe('1.0.0');
    expect(registry.formatsOf('promo-curso')).toEqual(['feed', 'story']);
    expect(registry.directoryOf('promo-curso')).toBe('templates/promo-curso');
  });

  it('answers undefined for a name it does not have, rather than throwing', async () => {
    const { registry } = await loaded();
    expect(registry.get('nao-existe')).toBeUndefined();
    expect(registry.formatsOf('nao-existe')).toBeUndefined();
    expect(registry.directoryOf('nao-existe')).toBeUndefined();
  });

  it('skips a folder with no manifest in silence', async () => {
    const { registry } = await loaded();
    expect(registry.list().map((item) => item.name)).not.toContain('assets-only');
    expect(registry.failures).toEqual([]);
  });
});

describe('the registry reads manifests and nothing else', () => {
  it('never opens a template.ts or a template.html', async () => {
    // Sorted for comparison only — the registry reads in whatever order the filesystem
    // lists, and it is the set of files it opened that the criterion is about.
    const { reads } = await loaded();
    const filesRead = reads.filter((entry) => entry.startsWith('file ')).sort();
    expect(filesRead).toEqual([
      'file templates/carrossel-lista/manifest.yaml',
      'file templates/promo-curso/manifest.yaml',
    ]);
  });

  it('does not even open the folder of something that is not a template', async () => {
    // `assets-only` is listed, because that is how the manifest is looked for, and then
    // nothing in it is read.
    const { reads } = await loaded();
    expect(reads).toContain('dir templates/assets-only');
    expect(reads.some((entry) => entry.startsWith('file templates/assets-only/'))).toBe(false);
  });
});

describe('a broken template is not a broken registry', () => {
  const withBroken = {
    ...TREE,
    'templates/quebrado/manifest.yaml': 'name: quebrado\nversion: nope\nformats: []\nslots: {}\n',
  };

  it('keeps the working templates and records the failure beside them', async () => {
    const { registry } = await loaded(withBroken);
    expect(registry.list().map((item) => item.name)).toEqual(['carrossel-lista', 'promo-curso']);
    expect(registry.failures).toHaveLength(1);
    expect(registry.failures[0]?.directory).toBe('templates/quebrado');
    expect(registry.failures[0]?.diagnostics.length).toBeGreaterThan(1);
  });

  it('reports the second folder when two declare the same name, and keeps the first', async () => {
    const { registry } = await loaded({
      ...TREE,
      'templates/zz-copia/manifest.yaml': manifest('promo-curso'),
    });
    expect(registry.get('promo-curso')?.formats).toEqual(['feed', 'story']);
    expect(registry.failures[0]?.diagnostics[0]?.code).toBe('E_TEMPLATE_DUPLICATE');
    expect(registry.failures[0]?.diagnostics[0]?.message).toContain('templates/promo-curso');
    expect(registry.failures[0]?.diagnostics[0]?.message).toContain('templates/zz-copia');
  });

  it('turns an unreadable manifest into a failure, not an exception', async () => {
    // Listed by the folder, then gone by the time it is read — a race, or a permission.
    const fileSystem = fakeFileSystem(TREE);
    const readFile = fileSystem.readFile.bind(fileSystem);
    const guarded: FileSystem = {
      ...fileSystem,
      readFile: (path) =>
        path.includes('carrossel-lista') ? Promise.reject(new Error('EACCES')) : readFile(path),
    };

    const result = await loadTemplateRegistry(guarded, 'templates');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.list().map((item) => item.name)).toEqual(['promo-curso']);
      expect(result.value.failures[0]?.diagnostics[0]?.code).toBe('E_TEMPLATE_READ');
      expect(result.value.failures[0]?.diagnostics[0]?.message).toContain('EACCES');
    }
  });
});

describe('the one case with no registry to return', () => {
  it('fails when the root itself cannot be read', async () => {
    const result = await loadTemplateRegistry(fakeFileSystem(TREE), 'nao-existe');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.code).toBe('E_TEMPLATE_READ');
      expect(result.error[0]?.message).toContain('nao-existe');
    }
  });

  it('returns an empty registry for a root with no templates in it', async () => {
    const { registry } = await loaded({ 'templates/leia-me.txt': 'nada aqui' });
    expect(registry.list()).toEqual([]);
    expect(registry.failures).toEqual([]);
  });
});

describe('a search path of several roots (ADR 0020)', () => {
  const twoRoots = () =>
    fakeFileSystem({
      'project/promo/manifest.yaml': manifest('promo'),
      'project/so-do-projeto/manifest.yaml': manifest('so-do-projeto'),
      'pack/promo/manifest.yaml': manifest('promo', '[feed, story]'),
      'pack/so-do-pack/manifest.yaml': manifest('so-do-pack'),
    });

  it('takes the earlier root when two of them declare one name', async () => {
    // The whole decision in one assertion: a folder the user pointed at beats a package
    // that came along with the program.
    const result = await loadTemplateRegistry(twoRoots(), ['project', 'pack']);
    if (!result.ok) throw new Error('expected a registry');

    expect(result.value.directoryOf('promo')).toBe('project/promo');
    expect(result.value.formatsOf('promo')).toEqual(['feed']);
  });

  it('takes the other one when the roots are handed over the other way round', async () => {
    // Precedence is the order of the list and nothing else — not a rule about which root
    // is "the project", which this function has no way to know.
    const result = await loadTemplateRegistry(twoRoots(), ['pack', 'project']);
    if (!result.ok) throw new Error('expected a registry');

    expect(result.value.directoryOf('promo')).toBe('pack/promo');
  });

  it('unions what does not collide', async () => {
    const result = await loadTemplateRegistry(twoRoots(), ['project', 'pack']);
    if (!result.ok) throw new Error('expected a registry');

    expect(result.value.list().map((entry) => entry.name)).toEqual([
      'promo',
      'so-do-pack',
      'so-do-projeto',
    ]);
  });

  it('warns about the shadowed one, naming both folders', async () => {
    // A warning and not silence: "my edit to the built-in did nothing" is the question this
    // rule generates, and one line answers it. On the `ok` branch, so the run continues.
    const result = await loadTemplateRegistry(twoRoots(), ['project', 'pack']);
    if (!result.ok) throw new Error('expected a registry');

    expect(result.diagnostics.map((item) => item.code)).toEqual(['W_TEMPLATE_SHADOWED']);
    expect(result.diagnostics[0]?.message).toContain('pack/promo');
    expect(result.diagnostics[0]?.message).toContain('project/promo');
    expect(result.value.failures).toEqual([]);
  });

  it('still refuses two folders inside one root, which is the other collision', async () => {
    // Different problem, different answer. Directory order is not an order anybody chose,
    // so picking between them would be arbitrary — that stays `E_TEMPLATE_DUPLICATE`.
    const fileSystem = fakeFileSystem({
      'project/a/manifest.yaml': manifest('promo'),
      'project/b/manifest.yaml': manifest('promo'),
      'pack/promo/manifest.yaml': manifest('promo'),
    });
    const result = await loadTemplateRegistry(fileSystem, ['project', 'pack']);
    if (!result.ok) throw new Error('expected a registry');

    expect(
      result.value.failures.flatMap((failure) => failure.diagnostics).map((d) => d.code),
    ).toEqual(['E_TEMPLATE_DUPLICATE']);
    expect(result.diagnostics.map((item) => item.code)).toEqual(['W_TEMPLATE_SHADOWED']);
  });

  it('does not let a root shadow itself when it is listed twice', async () => {
    // `--templates <the pack's own folder>` is how the built-in templates were used before
    // ADR 0020 and still has to work. Without de-duplication every template in it would be
    // reported as hidden by the copy of itself.
    const result = await loadTemplateRegistry(twoRoots(), ['pack', 'pack']);
    if (!result.ok) throw new Error('expected a registry');

    expect(result.diagnostics).toEqual([]);
    expect(result.value.list().map((entry) => entry.name)).toEqual(['promo', 'so-do-pack']);
  });

  it('keeps going when one root is unreadable, and says which', async () => {
    // A project with no `templates/` folder renders from the pack. It is a failure on that
    // root rather than an `Err`, because there is a registry to return.
    const result = await loadTemplateRegistry(twoRoots(), ['nao-existe', 'pack']);
    if (!result.ok) throw new Error('expected a registry');

    expect(result.value.get('promo')).toBeDefined();
    expect(result.value.failures.map((failure) => failure.directory)).toEqual(['nao-existe']);
  });

  it('fails only when every root is unreadable', async () => {
    const result = await loadTemplateRegistry(twoRoots(), ['nem-esse', 'nao-existe']);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.map((item) => item.code)).toEqual([
      'E_TEMPLATE_READ',
      'E_TEMPLATE_READ',
    ]);
  });

  it('accepts a single string, and behaves exactly as it always did', async () => {
    // Every existing caller passes one root. The string form is not a shim; it is the
    // common case spelled the short way.
    const result = await loadTemplateRegistry(twoRoots(), 'pack');
    if (!result.ok) throw new Error('expected a registry');

    expect(result.value.list().map((entry) => entry.name)).toEqual(['promo', 'so-do-pack']);
    expect(result.diagnostics).toEqual([]);
  });
});
