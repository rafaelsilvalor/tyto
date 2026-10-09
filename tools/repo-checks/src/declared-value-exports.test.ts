import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A package's `.d.ts` must not promise a value its bundle does not export (TYTO-118).
 *
 * TYTO-115 wrote `export type { EditorState };` in `@tyto/editor`. tsup's declaration rollup
 * dropped the `type` modifier and emitted `export { EditorState } from '@codemirror/state'`,
 * while the runtime bundle exported nothing of the name. `EditorState` is a class in its
 * source module, so a consumer's `EditorState.create(...)` typechecked clean and failed at
 * link time with `does not provide an export named 'EditorState'`. No lint rule, typecheck or
 * test noticed; this file is the thing that does.
 *
 * ## What counts as a promised value
 *
 * Not every name a `.d.ts` re-exports without `type` is a promise. TypeScript follows a
 * re-export through to the declaration it names, so when that declaration is an interface or
 * a type alias a value import is refused anyway (TS1484) — a first count that ignored this
 * found 65 such names across `core` and `brief-lang`, none of them a defect. So a name is a
 * promised value only when the alias chain reaches a declaration with a value meaning (a
 * class, a function, a variable, an enum, an instantiated namespace) and no link of that
 * chain is written type-only. The checker answers that, over one `Program` holding every
 * declaration entry point, rather than a regular expression over the text.
 *
 * ## It cannot pass by measuring nothing
 *
 * The comparison needs a fresh `dist` for every package, and `turbo test` only builds what
 * `^build` reaches. So every package with a `types` entry is a `workspace:*` devDependency
 * of `@tyto/repo-checks`, which orders this suite after their builds and puts their sources
 * in its cache hash (ADR 0071) — the first test below fails if one is left out. And every
 * entry asserts its `.d.ts` and its `.js` exist before comparing them, so a missing `dist`
 * is a red test naming the file rather than a package skipped in silence.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixturesRoot = fileURLToPath(
  new URL('./__fixtures__/declared-value-exports/', import.meta.url),
);

const WORKSPACE_GROUPS = ['packages', 'apps', 'tools'] as const;

type ExportsNode = string | null | ExportsNode[] | { [condition: string]: ExportsNode };

interface Manifest {
  readonly name?: string;
  readonly exports?: Readonly<Record<string, ExportsNode>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/** One `exports` subpath that declares types: the declaration and the bundle it describes. */
interface DeclaredEntry {
  readonly packageName: string;
  readonly subpath: string;
  readonly declarationFile: string;
  readonly runtimeFile: string;
}

const readManifest = (packageDir: string): Manifest =>
  JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as Manifest;

const isConditionMap = (
  node: ExportsNode | undefined,
): node is { [condition: string]: ExportsNode } =>
  typeof node === 'object' && node !== null && !Array.isArray(node);

function workspacePackageDirs(): string[] {
  return WORKSPACE_GROUPS.flatMap((group) =>
    readdirSync(join(repoRoot, group), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && existsSync(join(repoRoot, group, entry.name, 'package.json')),
      )
      .map((entry) => join(repoRoot, group, entry.name)),
  );
}

/** Every `exports[subpath]` with both a `types` and an `import` target, across the workspace. */
function declaredEntries(): DeclaredEntry[] {
  const entries: DeclaredEntry[] = [];
  for (const packageDir of workspacePackageDirs()) {
    const manifest = readManifest(packageDir);
    for (const [subpath, node] of Object.entries(manifest.exports ?? {})) {
      if (!isConditionMap(node)) continue;
      const types = node['types'];
      const runtime = node['import'];
      if (typeof types !== 'string') continue;
      if (typeof runtime !== 'string') {
        throw new Error(
          `${manifest.name ?? packageDir} "${subpath}" declares types without an import target`,
        );
      }
      entries.push({
        packageName: manifest.name ?? packageDir,
        subpath,
        declarationFile: join(packageDir, types),
        runtimeFile: join(packageDir, runtime),
      });
    }
  }
  return entries;
}

const MODULE_SYNTAX_CONTAINERS = new Set([ts.SyntaxKind.NamedExports, ts.SyntaxKind.NamedImports]);

/**
 * Whether this one link of an alias chain is written type-only: `export type { X }`,
 * `export { type X }`, `import type { X }`, `import { type X }`, `import type X = …`.
 */
function isTypeOnlyLink(declaration: ts.Declaration): boolean {
  if (ts.isExportSpecifier(declaration) || ts.isImportSpecifier(declaration)) {
    if (declaration.isTypeOnly) return true;
    const container = declaration.parent;
    if (!MODULE_SYNTAX_CONTAINERS.has(container.kind)) return false;
    const owner = container.parent;
    if (ts.isExportDeclaration(owner)) return owner.isTypeOnly;
    if (ts.isImportClause(owner)) return owner.isTypeOnly;
    return false;
  }
  if (ts.isImportClause(declaration) || ts.isImportEqualsDeclaration(declaration))
    return declaration.isTypeOnly;
  if (ts.isNamespaceImport(declaration)) return declaration.parent.isTypeOnly;
  return false;
}

/**
 * Whether `symbol`, exported by a declaration file, promises a runtime binding: its alias
 * chain has no type-only link and ends in a declaration with a value meaning.
 */
function promisesValue(checker: ts.TypeChecker, exported: ts.Symbol): boolean {
  let symbol = exported;
  const seen = new Set<ts.Symbol>();
  while (symbol.flags & ts.SymbolFlags.Alias) {
    if (seen.has(symbol)) return false;
    seen.add(symbol);
    if ((symbol.declarations ?? []).some(isTypeOnlyLink)) return false;
    symbol = checker.getImmediateAliasedSymbol(symbol) ?? checker.getAliasedSymbol(symbol);
  }
  return (symbol.flags & ts.SymbolFlags.Value) !== 0;
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  noEmit: true,
  types: [],
};

/** The value names each declaration file promises, read from one `Program` over all of them. */
function promisedValues(declarationFiles: readonly string[]): Map<string, string[]> {
  const program = ts.createProgram([...declarationFiles], COMPILER_OPTIONS);
  const checker = program.getTypeChecker();
  const promised = new Map<string, string[]>();
  for (const file of declarationFiles) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) throw new Error(`TypeScript did not load ${file}`);
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    const exports = moduleSymbol === undefined ? [] : checker.getExportsOfModule(moduleSymbol);
    promised.set(
      file,
      exports.filter((symbol) => promisesValue(checker, symbol)).map((symbol) => symbol.name),
    );
  }
  return promised;
}

/** The names a `.d.ts` promises as values that the bundle beside it does not export. */
async function missingValueExports(
  declaredValues: readonly string[],
  runtimeFile: string,
): Promise<string[]> {
  const runtime = (await import(pathToFileURL(runtimeFile).href)) as Record<string, unknown>;
  const actual = new Set(Object.keys(runtime));
  return declaredValues.filter((name) => !actual.has(name)).sort();
}

const entries = declaredEntries();
const repoChecksManifest = readManifest(join(repoRoot, 'tools/repo-checks'));

let workspacePromises: Map<string, string[]> | undefined;
/** One `Program` over every built declaration entry, made on first use and shared. */
function promisedValuesOfWorkspace(): Map<string, string[]> {
  workspacePromises ??= promisedValues(
    entries.map((entry) => entry.declarationFile).filter((file) => existsSync(file)),
  );
  return workspacePromises;
}

describe('declared value exports', () => {
  it('orders this suite after every package it reads, as a workspace devDependency (ADR 0071)', () => {
    const packagesWithTypes = [...new Set(entries.map((entry) => entry.packageName))].sort();
    const declaredAsWorkspace = Object.entries(repoChecksManifest.devDependencies ?? {})
      .filter(([, range]) => range.startsWith('workspace:'))
      .map(([name]) => name)
      .sort();
    expect(packagesWithTypes.length).toBeGreaterThan(0);
    expect(declaredAsWorkspace).toEqual(packagesWithTypes);
  });

  describe.each(
    entries.map((entry) => [`${entry.packageName} "${entry.subpath}"`, entry] as const),
  )('%s', (_label, entry) => {
    it('has a built .d.ts and .js to compare, and the .d.ts promises no value the .js lacks', async () => {
      // The assertion that keeps this suite from passing on an empty `dist`: a missing file
      // is a failure naming it, never a package skipped.
      const absent = [entry.declarationFile, entry.runtimeFile].filter((file) => !existsSync(file));
      expect(
        absent,
        `${entry.packageName} "${entry.subpath}" has nothing built to compare`,
      ).toEqual([]);

      const declared = promisedValuesOfWorkspace().get(entry.declarationFile) ?? [];
      const missing = await missingValueExports(declared, entry.runtimeFile);
      expect(
        missing,
        `${entry.packageName} "${entry.subpath}" declares values its bundle lacks`,
      ).toEqual([]);
    });
  });
});

describe('what counts as a promised value', () => {
  it('ignores an interface re-exported without `type`: the compiler already refuses it as a value', async () => {
    const dir = join(fixturesRoot, 'interface-reexport');
    const declared = promisedValues([join(dir, 'index.d.ts')]).get(join(dir, 'index.d.ts')) ?? [];
    expect(declared).toEqual(['shapeName']);
    expect(await missingValueExports(declared, join(dir, 'index.js'))).toEqual([]);
  });

  it('flags a class re-exported without `type` that the bundle does not carry', async () => {
    const dir = join(fixturesRoot, 'class-reexport');
    const declared = promisedValues([join(dir, 'index.d.ts')]).get(join(dir, 'index.d.ts')) ?? [];
    expect(await missingValueExports(declared, join(dir, 'index.js'))).toEqual(['Shape']);
  });

  it('ignores a class re-exported with `type`', () => {
    const dir = join(fixturesRoot, 'class-reexport-type-only');
    expect(promisedValues([join(dir, 'index.d.ts')]).get(join(dir, 'index.d.ts'))).toEqual([
      'shapeName',
    ]);
  });
});
