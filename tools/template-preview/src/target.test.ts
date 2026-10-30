import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BUILT_IN_FORMATS, BUILT_IN_PACK, REPOSITORY_ROOT } from './paths.ts';
import { UsageError, parseArguments, resolveTarget } from './target.ts';

describe('parseArguments', () => {
  it('reads a template and the options, and skips the `--` pnpm passes along', () => {
    expect(parseArguments(['--', 'banner-roxo', '--types', 'png,svg', '--port', '0'])).toEqual({
      template: 'banner-roxo',
      types: ['png', 'svg'],
      port: 0,
    });
  });

  it('refuses no template, two templates and an unknown option', () => {
    expect(() => parseArguments([])).toThrow(UsageError);
    expect(() => parseArguments(['a', 'b'])).toThrow(UsageError);
    expect(() => parseArguments(['a', '--host', '0.0.0.0'])).toThrow(/unknown option --host/);
  });
});

describe('resolveTarget', () => {
  it('finds a pack template by name, its first example and the pack formats', () => {
    const target = resolveTarget({ template: 'banner-roxo' }, REPOSITORY_ROOT);
    expect(target).toMatchObject({
      template: 'banner-roxo',
      brief: join(BUILT_IN_PACK, 'banner-roxo', 'examples', 'agencia.brief'),
      templates: BUILT_IN_PACK,
      formatsFile: BUILT_IN_FORMATS,
      types: ['png'],
      compiled: true,
    });
  });

  it('marks a markup template as needing no rebuild', () => {
    expect(resolveTarget({ template: 'promo-curso' }, REPOSITORY_ROOT).compiled).toBe(false);
  });

  it('refuses a name that is neither a folder nor in the pack', () => {
    expect(() => resolveTarget({ template: 'nope' }, REPOSITORY_ROOT)).toThrow(UsageError);
  });
});

describe('resolveTarget, for a template in its own repository (TYTO-485)', () => {
  let repository: string;

  beforeEach(async () => {
    repository = await mkdtemp(join(tmpdir(), 'tyto-preview-target-'));
    await mkdir(join(repository, 'templates', 'questao', 'examples'), { recursive: true });
    await writeFile(join(repository, 'tyto-plugin.json'), JSON.stringify({ name: 'questao' }));
    await writeFile(join(repository, 'templates', 'formats.yaml'), '');
    await writeFile(join(repository, 'templates', 'questao', 'manifest.yaml'), '');
    await writeFile(join(repository, 'templates', 'questao', 'examples', 'b.brief'), '');
    await writeFile(join(repository, 'templates', 'questao', 'examples', 'a.brief'), '');
  });

  afterEach(async () => {
    await rm(repository, { recursive: true, force: true });
  });

  it("takes the repository's only template, its first example and its formats", () => {
    expect(resolveTarget({ template: repository }, REPOSITORY_ROOT)).toEqual({
      template: 'questao',
      brief: join(repository, 'templates', 'questao', 'examples', 'a.brief'),
      templates: join(repository, 'templates'),
      formatsFile: join(repository, 'templates', 'formats.yaml'),
      types: ['png'],
      compiled: true,
      repository: { folder: repository, plugin: 'questao' },
    });
  });

  it('reads templates/<name> inside a repository as that repository', () => {
    const named = resolveTarget(
      { template: join(repository, 'templates', 'questao') },
      REPOSITORY_ROOT,
    );
    expect(named.repository).toEqual({ folder: repository, plugin: 'questao' });
    expect(named.compiled).toBe(true);
  });

  it('asks which template when the repository holds several', async () => {
    await mkdir(join(repository, 'templates', 'outra'), { recursive: true });
    await writeFile(join(repository, 'templates', 'outra', 'manifest.yaml'), '');
    expect(() => resolveTarget({ template: repository }, REPOSITORY_ROOT)).toThrow(
      /2 templates \(outra, questao\)/u,
    );
  });

  it('leaves a template folder outside any repository as it was', () => {
    expect(
      resolveTarget({ template: join(BUILT_IN_PACK, 'promo-curso') }, REPOSITORY_ROOT).repository,
    ).toBeUndefined();
  });
});
