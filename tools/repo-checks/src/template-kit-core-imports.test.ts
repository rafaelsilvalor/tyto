import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * `@tyto/template-kit` takes no value from the `@tyto/core` root (TYTO-517).
 *
 * A code template bundles the kit. The kit's values come from `@tyto/core/template`, the entry
 * TYTO-457 keeps free of parsers; the root carries the font reader and the YAML parser. When
 * TYTO-516 imported one constant from the root, every template that adopted the kit inlined
 * both: `tyto-template-questao-estrategica`'s bundle went from 889,278 to 2,906,966 bytes,
 * measured in that repository. Typecheck, lint and every test passed.
 *
 * Two halves. The sources say which file did it: every runtime file the kit's main entry
 * reaches, walked from `src/index.ts`, read as TypeScript, an `import type` allowed. The build
 * says whether it reached the bundle, which is what a template ships: tsup erases type imports
 * and decides the chunks. `src/testing.ts` is the other entry, `@tyto/template-kit/testing`,
 * which compiles briefs and needs the root; only tests import it, never a template's bundle.
 *
 * `@tyto/template-kit` is a devDependency of this package, so `turbo test` builds it first.
 */
const kit = fileURLToPath(new URL('../../../packages/template-kit/', import.meta.url));
const ROOT = '@tyto/core';

/** A value the file takes from the core root, as `name from '@tyto/core'`, for the report. */
function rootValueImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
  const found: string[] = [];
  for (const statement of source.statements) {
    const declaration =
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ? statement
        : undefined;
    const specifier = declaration?.moduleSpecifier;
    if (declaration === undefined || specifier === undefined || !ts.isStringLiteral(specifier)) {
      continue;
    }
    if (specifier.text !== ROOT) continue;
    for (const name of valueNames(declaration)) found.push(`${name} from '${ROOT}'`);
  }
  return found;
}

/** The names an import or export declaration brings in as values; a bare import counts too. */
function valueNames(declaration: ts.ImportDeclaration | ts.ExportDeclaration): string[] {
  if (ts.isExportDeclaration(declaration)) {
    if (declaration.isTypeOnly) return [];
    const clause = declaration.exportClause;
    if (clause === undefined) return ['*'];
    if (ts.isNamespaceExport(clause)) return [`* as ${clause.name.text}`];
    return clause.elements.filter((element) => !element.isTypeOnly).map((e) => e.name.text);
  }
  const clause = declaration.importClause;
  // `import '@tyto/core'` runs the root for its side effects: a value import in all but name.
  if (clause === undefined) return ['(side effect)'];
  if (clause.isTypeOnly) return [];
  const names: string[] = clause.name === undefined ? [] : [clause.name.text];
  const bindings = clause.namedBindings;
  if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
    names.push(`* as ${bindings.name.text}`);
  } else if (bindings !== undefined) {
    const values = bindings.elements.filter((e) => !e.isTypeOnly).map((e) => e.name.text);
    // `import { type A, type B }` keeps `import '@tyto/core'` in the bundle (measured with
    // tsup on TYTO-517): only `import type { A, B }` is erased whole.
    names.push(
      ...(values.length === 0 && names.length === 0
        ? ['(side effect: write `import type`)']
        : values),
    );
  }
  return names;
}

/** A path inside the kit, with forward slashes on every platform. */
function relative(file: string): string {
  return file.slice(kit.length).replaceAll('\\', '/');
}

/** Every source file the entry reaches through relative imports, the entry first. */
function reachedFrom(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
  const files = [file];
  for (const { fileName } of importedFiles) {
    if (!fileName.startsWith('.')) continue;
    files.push(...reachedFrom(resolve(dirname(file), fileName.replace(/\.js$/u, '.ts')), seen));
  }
  return files;
}

describe('the @tyto/template-kit main entry', () => {
  const entry = resolve(kit, 'src/index.ts');
  const built = resolve(kit, 'dist/index.js');

  it('reaches its sources, so the scan below reads something', () => {
    const files = reachedFrom(entry).map(relative);

    expect(files).toContain('src/rhythm.ts');
    expect(files).not.toContain('src/testing.ts');
  });

  it('takes no value from the core root in any runtime source; types are fine', () => {
    const offending = reachedFrom(entry).flatMap((file) =>
      rootValueImports(file).map((what) => `${relative(file)}: ${what}`),
    );

    expect(offending).toEqual([]);
  });

  it('is built, so the bundle check below measures something', () => {
    expect(existsSync(built), built).toBe(true);
  });

  it('ships a bundle that imports nothing from the core root', () => {
    const { importedFiles } = ts.preProcessFile(readFileSync(built, 'utf8'), true, true);

    expect(importedFiles.map((item) => item.fileName).filter((name) => name === ROOT)).toEqual([]);
  });
});
