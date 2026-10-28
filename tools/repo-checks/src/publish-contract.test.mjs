import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CONTRACT_PACKAGES,
  PUBLISHED_PREFIX,
  publishedName,
  REGISTRY,
  stagedManifest,
} from './publish-contract.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** @param {string} directory */
const manifestOf = (directory) =>
  JSON.parse(readFileSync(join(repoRoot, directory, 'package.json'), 'utf8'));

describe('the contract list', () => {
  it('names each package by the manifest in its folder', () => {
    for (const { name, directory } of CONTRACT_PACKAGES) {
      expect(manifestOf(directory).name, directory).toBe(name);
    }
  });

  it('publishes every workspace package a listed one depends on, before it', () => {
    const order = CONTRACT_PACKAGES.map(({ name }) => name);
    for (const [index, { name, directory }] of CONTRACT_PACKAGES.entries()) {
      const manifest = manifestOf(directory);
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const dependency of Object.keys(manifest[field] ?? {})) {
          if (!dependency.startsWith('@tyto/')) continue;
          expect(order, `${name} → ${dependency}`).toContain(dependency);
          expect(order.indexOf(dependency), `${name} → ${dependency}`).toBeLessThan(index);
        }
      }
    }
  });

  it('keeps every listed package versioned and not private, or Changesets would not move it', () => {
    for (const { directory } of CONTRACT_PACKAGES) {
      const manifest = manifestOf(directory);
      expect(manifest.private, directory).not.toBe(true);
      expect(manifest.version, directory).toMatch(/^\d+\.\d+\.\d+/u);
    }
  });
});

describe('the published name', () => {
  it('is written once, in the script, and no workflow repeats it', () => {
    for (const workflow of ['ci.yml', 'release.yml']) {
      const text = readFileSync(join(repoRoot, '.github', 'workflows', workflow), 'utf8');
      expect(text, workflow).not.toContain(PUBLISHED_PREFIX);
    }
  });

  it('swaps the workspace scope for the prefix', () => {
    expect(publishedName('@tyto/plugin-api')).toBe(`${PUBLISHED_PREFIX}plugin-api`);
    expect(() => publishedName('zod')).toThrow(/not a workspace package/u);
  });
});

describe('stagedManifest', () => {
  const packed = {
    name: '@tyto/plugin-api',
    version: '0.4.1',
    license: 'UNLICENSED',
    scripts: { build: 'tsup' },
    dependencies: { '@tyto/core': '0.28.0', '@tyto/recipe': '0.0.0', zod: '^4.6.5' },
    devDependencies: { vitest: '^5.0.1' },
  };

  it('renames the package and turns each workspace dependency into an alias', () => {
    const staged = stagedManifest(packed);
    expect(staged.name).toBe(`${PUBLISHED_PREFIX}plugin-api`);
    expect(staged.dependencies).toEqual({
      '@tyto/core': `npm:${PUBLISHED_PREFIX}core@0.28.0`,
      '@tyto/recipe': `npm:${PUBLISHED_PREFIX}recipe@0.0.0`,
      zod: '^4.6.5',
    });
  });

  it('points at the registry, keeps the licence, and drops what nothing installs', () => {
    const staged = stagedManifest(packed);
    expect(staged.publishConfig).toEqual({ registry: REGISTRY });
    expect(staged.license).toBe('UNLICENSED');
    expect(staged.repository.url).toContain('github.com/rafaelsilvalor/tyto');
    expect(staged).not.toHaveProperty('scripts');
    expect(staged).not.toHaveProperty('devDependencies');
  });

  it('refuses a dependency on a workspace package that is not published', () => {
    expect(() => stagedManifest({ ...packed, dependencies: { '@tyto/editor': '0.9.0' } })).toThrow(
      /not published/u,
    );
  });

  it('refuses a manifest pnpm did not pack', () => {
    expect(() =>
      stagedManifest({ ...packed, dependencies: { '@tyto/core': 'workspace:*' } }),
    ).toThrow(/pack with pnpm/u);
  });
});
