import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { preProcessFile } from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The second half of the runtime boundary (ADR 0010).
 *
 * `runtime-boundary.test.ts` lints source text, so it catches a pure package that writes
 * `import { readFile } from 'node:fs'` by hand. It cannot see the other way in: a pure
 * package's *dependency* that is pure only under one export condition. `yaml` and
 * `fontkit` are both shaped that way — one package, two builds, and the `exports` map
 * picks between them by condition. A bundler that resolves the `node` condition for a
 * browser target pulls the Node build in, and nothing in the repository would say so,
 * because the choice lives in a bundler config rather than in a source file.
 *
 * So this reads the dependency manifests instead, under the conditions each kind of
 * bundler resolves, and walks what it finds. The check exists before the bundler does
 * (E8.1) on purpose: the day somebody writes that config is the day it is cheap to get
 * right and expensive to notice it went wrong.
 *
 * Two limits worth knowing. The walk follows `import`, `export … from`, `require()` and
 * `import()` through the TypeScript scanner rather than a regular expression, because a
 * regular expression reads the inside of comments — `@lezer/lr` documents a grammar
 * directive as `@context exportName from "module"` and `zod` shows `import z from "zod"`
 * in a JSDoc block, and both were false positives on the way here. And it reasons about
 * `exports` maps as published, which is what a bundler reads, not about a bundler's own
 * `alias`/`resolve` overrides, which nothing here can see.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

/**
 * The conditions a browser bundler offers, and the ones a Node build offers. Order inside
 * an `exports` map belongs to the map, not to these — a resolver walks the map's own keys
 * and takes the first one it was offered, so a set is the honest shape for the offer.
 */
const BROWSER_CONDITIONS = new Set(['browser', 'import', 'module', 'require']);
const NODE_CONDITIONS = new Set(['node', 'import', 'require']);

/**
 * A dependency of a pure package whose purity is a property of the condition, not of the
 * package. Each entry names what the `node` condition reaches, so the entry falsifies
 * itself: if a release makes the two builds the same, the built-ins listed here stop
 * being reachable and this file fails asking to be shortened rather than quietly
 * guarding nothing.
 */
const CONDITIONALLY_PURE: Readonly<Record<string, readonly string[]>> = {
  yaml: ['process', 'buffer'],
  fontkit: ['fs'],
};

type ExportsNode = string | null | ExportsNode[] | { [condition: string]: ExportsNode };

interface Manifest {
  readonly name?: string;
  readonly version?: string;
  readonly main?: string;
  readonly module?: string;
  readonly exports?: ExportsNode;
  readonly dependencies?: Readonly<Record<string, string>>;
}

const readManifest = (packageDir: string): Manifest =>
  JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as Manifest;

const isConditionMap = (node: ExportsNode): node is { [condition: string]: ExportsNode } =>
  typeof node === 'object' && node !== null && !Array.isArray(node);

/**
 * The first target a resolver reaches, given the conditions it offers. `types` is skipped
 * because it names a `.d.ts` that no runtime loads, and `default` always matches — those
 * are the two rules in the spec that are not just "is this condition on offer".
 */
function resolveConditions(
  node: ExportsNode | undefined,
  conditions: ReadonlySet<string>,
): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    for (const alternative of node) {
      const target = resolveConditions(alternative, conditions);
      if (target !== null) return target;
    }
    return null;
  }
  for (const [condition, value] of Object.entries(node)) {
    if (condition === 'types') continue;
    if (condition !== 'default' && !conditions.has(condition)) continue;
    const target = resolveConditions(value, conditions);
    if (target !== null) return target;
  }
  return null;
}

/** The `.` entry of an `exports` map, whether the map has subpaths or is conditions alone. */
function rootSubpath(manifest: Manifest): ExportsNode | undefined {
  const field = manifest.exports;
  if (field === undefined || !isConditionMap(field)) return field;
  return Object.keys(field).some((key) => key.startsWith('.')) ? field['.'] : field;
}

/** Whether any branch under `.` is chosen by the `node` condition. */
function hasNodeCondition(node: ExportsNode | undefined): boolean {
  if (node === undefined || node === null || typeof node === 'string') return false;
  if (Array.isArray(node)) return node.some(hasNodeCondition);
  return Object.entries(node).some(
    ([condition, value]) => condition === 'node' || hasNodeCondition(value),
  );
}

const FILE_CANDIDATES = ['', '.js', '.mjs', '.cjs', '/index.js', '/index.mjs', '/index.cjs'];

/**
 * `realpathSync` because pnpm links every dependency into place: without it the walk
 * climbs `packages/core/node_modules` looking for `restructure` and finds nothing, which
 * reads as "no Node built-ins here" when the truth is "nothing was read".
 */
function asFile(candidate: string): string | null {
  try {
    return statSync(candidate).isFile() ? realpathSync(candidate) : null;
  } catch {
    return null;
  }
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  for (const suffix of FILE_CANDIDATES) {
    const hit = asFile(base + suffix);
    if (hit !== null) return hit;
  }
  return null;
}

const packageNameOf = (specifier: string) => {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier);
};

const subpathOf = (specifier: string) => {
  const rest = specifier.slice(packageNameOf(specifier).length);
  return rest === '' ? '.' : `.${rest}`;
};

/** The directory of `packageName` as seen from `fromFile`, the way Node resolution looks. */
function findPackageDir(fromFile: string, packageName: string): string | null {
  let directory = dirname(fromFile);
  for (;;) {
    const manifest = join(directory, 'node_modules', packageName, 'package.json');
    if (existsSync(manifest)) return dirname(manifest);
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function entryFile(
  packageDir: string,
  subpath: string,
  conditions: ReadonlySet<string>,
): string | null {
  const manifest = readManifest(packageDir);
  const field = manifest.exports;

  if (field === undefined) {
    const legacy = subpath === '.' ? (manifest.module ?? manifest.main ?? './index.js') : subpath;
    return resolveRelative(
      join(packageDir, 'anchor'),
      legacy.startsWith('.') ? legacy : `./${legacy}`,
    );
  }

  let node: ExportsNode | undefined;
  if (!isConditionMap(field) || !Object.keys(field).some((key) => key.startsWith('.'))) {
    node = subpath === '.' ? field : undefined;
  } else {
    node = field[subpath];
    if (node === undefined) {
      for (const [pattern, value] of Object.entries(field)) {
        if (!pattern.includes('*')) continue;
        const [before = '', after = ''] = pattern.split('*');
        if (!subpath.startsWith(before) || !subpath.endsWith(after)) continue;
        const filled = subpath.slice(before.length, subpath.length - after.length);
        const target = resolveConditions(value, conditions);
        if (target !== null) node = target.replace('*', filled);
        break;
      }
    }
  }

  const target = resolveConditions(node, conditions);
  return target === null ? null : resolveRelative(join(packageDir, 'anchor'), target);
}

interface Reach {
  /** Each Node built-in reached, mapped to the first file that named it. */
  readonly builtins: ReadonlyMap<string, string>;
  /** Specifiers the walk could not follow — a gap in what the result is allowed to claim. */
  readonly unresolved: readonly string[];
  readonly files: number;
}

/**
 * Everything reachable from one entry, following relative paths and bare specifiers alike
 * under the same conditions. Transitive rather than first-level: `fontkit`'s browser build
 * imports nine packages of its own, and a check that stopped at the boundary of the
 * dependency named in `package.json` would be claiming a purity it never looked at.
 */
function reachFrom(entry: string, conditions: ReadonlySet<string>): Reach {
  const seen = new Set<string>();
  const builtins = new Map<string, string>();
  const unresolved = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);

    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      unresolved.add(`${file} (unreadable)`);
      continue;
    }

    for (const { fileName: specifier } of preProcessFile(source, true, true).importedFiles) {
      if (specifier.startsWith('.')) {
        const next = resolveRelative(file, specifier);
        if (next === null) unresolved.add(`${specifier} from ${relative(file)}`);
        else queue.push(next);
        continue;
      }
      if (NODE_BUILTINS.has(specifier)) {
        if (!builtins.has(specifier)) builtins.set(specifier, relative(file));
        continue;
      }
      const packageDir = findPackageDir(file, packageNameOf(specifier));
      const next =
        packageDir === null ? null : entryFile(packageDir, subpathOf(specifier), conditions);
      if (next === null) unresolved.add(`${specifier} from ${relative(file)}`);
      else queue.push(next);
    }
  }

  return { builtins, unresolved: [...unresolved], files: seen.size };
}

const relative = (file: string) => file.replace(realpathSync(repoRoot), '').replace(/\\/g, '/');

/**
 * Which packages are pure, asked of the lint rather than repeated from `eslint.config.js`.
 * A pure package is the one that refuses both a Node built-in and a DOM global; `editor`
 * refuses the first and allows the second, which is what tells the two apart.
 */
async function purePackages(): Promise<string[]> {
  const eslint = new ESLint({ cwd: repoRoot });
  const directories = readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`);

  const verdicts = await Promise.all(
    directories.map(async (directory) => {
      const at = join(repoRoot, directory, 'src/boundary-probe.ts');
      const [node] = await eslint.lintText(
        `import { readFile } from 'node:fs';\nexport const a = readFile;\n`,
        {
          filePath: at,
          warnIgnored: false,
        },
      );
      const [dom] = await eslint.lintText(`export const title = () => document.title;\n`, {
        filePath: at,
        warnIgnored: false,
      });
      const refuses = (result: typeof node, ruleId: string) =>
        (result?.messages ?? []).some((message) => message.ruleId === ruleId);
      return refuses(node, '@typescript-eslint/no-restricted-imports') &&
        refuses(dom, 'no-restricted-globals')
        ? directory
        : null;
    }),
  );

  return verdicts.filter((directory): directory is string => directory !== null);
}

/** Every external dependency of a pure package, once, with the packages that ask for it. */
function externalDependencies(pure: readonly string[]) {
  const askedBy = new Map<string, string[]>();
  for (const directory of pure) {
    const manifest = readManifest(join(repoRoot, directory));
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (range.startsWith('workspace:')) continue;
      askedBy.set(name, [...(askedBy.get(name) ?? []), directory.replace('packages/', '')]);
    }
  }
  return [...askedBy].map(([name, packages]) => ({
    name,
    packages,
    directory: join(
      repoRoot,
      packages[0] === undefined ? '' : `packages/${packages[0]}`,
      'node_modules',
      name,
    ),
  }));
}

const pure = await purePackages();
const dependencies = externalDependencies(pure);

describe('the pure packages', () => {
  it('are the seven ADR 0010 names, so the sweep below covers what it claims', () => {
    expect(pure.map((directory) => directory.replace('packages/', '')).sort()).toEqual([
      'brief-lang',
      'core',
      'export-html',
      'export-svg',
      'plugin-api',
      'template-lang',
      'templates',
    ]);
  });

  it('depend on something outside the workspace, or this file is asserting nothing', () => {
    expect(dependencies.length).toBeGreaterThan(0);
  });
});

describe.each(dependencies)('$name, a dependency of $packages', ({ name, directory }) => {
  const conditional = hasNodeCondition(rootSubpath(readManifest(directory)));
  const browserEntry = entryFile(directory, '.', BROWSER_CONDITIONS);
  const reached = browserEntry === null ? null : reachFrom(browserEntry, BROWSER_CONDITIONS);

  it('resolves to something under the conditions a browser bundler offers', () => {
    expect(browserEntry).not.toBeNull();
  });

  it('reaches no Node built-in under those conditions', () => {
    expect(
      [...(reached?.builtins ?? [])].map(([builtin, file]) => `${builtin} <- ${file}`),
      `${name} would put a Node built-in inside a pure package (ADR 0010)`,
    ).toEqual([]);
  });

  it('is walked to the end, so the verdict above covers the whole build', () => {
    expect(
      reached?.unresolved,
      `unfollowed specifiers are code the built-in check never read, so "no Node built-in" ` +
        `would be a claim about ${reached?.files ?? 0} files and not about ${name}`,
    ).toEqual([]);
  });

  it(`is ${CONDITIONALLY_PURE[name] === undefined ? 'pure under every condition' : 'declared as pure only under a non-node condition'}`, () => {
    expect(
      conditional,
      conditional
        ? `${name} publishes a 'node' condition, so its purity is the bundler's to pin. Add it ` +
            `to CONDITIONALLY_PURE with the built-ins that condition reaches, and say so in ADR 0010.`
        : `${name} has no 'node' condition, so there is nothing for a bundler to get wrong. ` +
            `Remove it from CONDITIONALLY_PURE.`,
    ).toBe(CONDITIONALLY_PURE[name] !== undefined);
  });
});

/**
 * The declarations, checked against the builds they describe. This is the half that makes
 * the note in ADR 0010 a measurement rather than a memory: `yaml` and `fontkit` are listed
 * there because their `node` condition reaches something, and here is the something.
 */
describe.each(Object.entries(CONDITIONALLY_PURE))(
  '%s under the node condition',
  (name, expected) => {
    const entry = dependencies.find((dependency) => dependency.name === name);

    it('is still a dependency of a pure package', () => {
      expect(entry, `${name} is declared but no pure package depends on it any more`).toBeDefined();
    });

    it('reaches exactly the Node built-ins the declaration names', () => {
      if (entry === undefined) throw new Error(`${name} is not a dependency of a pure package`);
      const nodeEntry = entryFile(entry.directory, '.', NODE_CONDITIONS);
      if (nodeEntry === null) throw new Error(`${name} has no node entry`);

      expect(
        [...reachFrom(nodeEntry, NODE_CONDITIONS).builtins.keys()].sort(),
        `the 'node' condition is what makes ${name} conditional. If this list is empty the ` +
          `two builds have converged and the entry should go; if it grew, the note in ` +
          `ADR 0010 understates what pinning the wrong condition costs.`,
      ).toEqual([...expected].sort());
    });
  },
);
