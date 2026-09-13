import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import semver from 'semver';
import { describe, expect, it } from 'vitest';

/**
 * `engines.node` as a promise the workspace can keep.
 *
 * The field is documentation of what a contributor needs, and the honest number is the
 * intersection of what every tool in the stack accepts rather than the loosest one. A range
 * wider than that intersection is a range that lies: `pnpm install` refuses with
 * `ERR_PNPM_UNSUPPORTED_ENGINE` if `engine-strict` is ever turned on, and without it the
 * failure arrives later and further from its cause.
 *
 * Checked with `semver.subset` rather than by sampling versions: the question is exactly
 * "does every version this repository claims to support satisfy that dependency too", and
 * subset is that question. Sampling would pass a range whose gap falls between two samples.
 *
 * It reads the installed tree, so it measures what an install actually resolved rather than
 * what a manifest asked for. The cost is that it needs `node_modules`, which is the state
 * every other check here runs in anyway.
 *
 * ## It is asymmetric on purpose, because the tree is not the same everywhere
 *
 * Optional dependencies are resolved per platform, so a Linux install holds packages a
 * Windows install does not — `@napi-rs/lzma-linux-x64-gnu` asks for
 * `^22.20 || ^24.12 || >=25` and simply is not there on Windows. That makes only one
 * direction safe to assert. "Some installed package refuses this Node" is true wherever it
 * is observed; "every installed package accepts this Node" is a claim about one platform
 * wearing the clothes of a claim about the repository.
 *
 * So this checks that the range promises nothing the tree refuses, and does **not** check
 * that the range is as wide as it could be. A developer on Windows can therefore see green
 * on a range that CI will reject, and CI — Linux, and the platform the cloud will run on —
 * is the arbiter. That asymmetry cost a red build on the PR that added this file, which is
 * the only reason it is written down here rather than discovered again.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

interface Manifest {
  readonly name?: string;
  readonly version?: string;
  readonly engines?: { readonly node?: string };
}

const readManifest = (path: string): Manifest => JSON.parse(readFileSync(path, 'utf8')) as Manifest;

/**
 * Every installed package that constrains Node, read out of pnpm's store.
 *
 * The store is flat — one directory per `name@version` — so this walks each one's own
 * `node_modules` rather than recursing through a hoisted tree, and a scope directory is one
 * level deeper.
 */
function installedEngineRanges(): Map<string, string> {
  const found = new Map<string, string>();
  const store = join(repoRoot, 'node_modules/.pnpm');
  if (!existsSync(store)) return found;

  const collect = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('@')) {
        collect(join(directory, entry.name));
        continue;
      }
      const manifestPath = join(directory, entry.name, 'package.json');
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = readManifest(manifestPath);
        const range = manifest.engines?.node;
        if (range !== undefined && manifest.name !== undefined && manifest.version !== undefined) {
          found.set(`${manifest.name}@${manifest.version}`, range);
        }
      } catch {
        // A package.json that does not parse is not this check's business to report.
      }
    }
  };

  for (const directory of readdirSync(store)) {
    const base = join(store, directory, 'node_modules');
    if (existsSync(base)) collect(base);
  }
  return found;
}

const declared = readManifest(join(repoRoot, 'package.json')).engines?.node;
const ranges = installedEngineRanges();

/** The ones that would refuse a Node this repository says it supports. */
function refusers(claim: string): { package: string; range: string }[] {
  const refused: { package: string; range: string }[] = [];
  for (const [name, range] of ranges) {
    try {
      if (!semver.subset(claim, range, { loose: true })) refused.push({ package: name, range });
    } catch {
      // A range semver cannot parse is the dependency's problem, not a verdict here.
    }
  }
  return refused;
}

describe('engines.node', () => {
  it('is declared at all', () => {
    expect(declared, 'the root package.json has no engines.node').toBeDefined();
  });

  it('found the installed tree, or the check below is asserting nothing', () => {
    // 332 when this was written; the bound is loose because the number is not the point.
    expect(ranges.size).toBeGreaterThan(50);
  });

  it('names a range no installed dependency refuses', () => {
    if (declared === undefined) throw new Error('no engines.node');

    expect(
      refusers(declared).map((item) => `${item.package} needs ${item.range}`),
      `engines.node is '${declared}', which admits a Node these packages refuse. Narrow it ` +
        `to the intersection and say in docs/conventions.md which dependency set it.`,
    ).toEqual([]);
  });

  it('admits at least one Node, so the range is not a contradiction', () => {
    if (declared === undefined) throw new Error('no engines.node');

    // A range nothing satisfies would pass the check above vacuously — every dependency
    // accepts every version of nothing.
    const admitted = ['22.22.1', '22.23.2', '24.12.0', '26.0.0', '28.0.0'].filter((version) =>
      semver.satisfies(version, declared, { loose: true }),
    );
    expect(
      admitted.length,
      `engines.node '${declared}' admits none of the current lines`,
    ).toBeGreaterThan(0);
  });
});
