import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

/**
 * Which files outside a package its `test` task reads, and whether Turborepo hashes them
 * (TYTO-253, ADR 0072).
 *
 * `ci.yml` restores `.turbo/cache`, so a test task whose hash did not move replays its last
 * green without running. A test that reads a file outside its package is only sound while
 * that file is in the hash: through the package's own `turbo.json` inputs (`$TURBO_ROOT$`),
 * through a dependency's `build` (`dependsOn: ["^build"]` hashes the dependency's sources),
 * or through the root `globalDependencies`.
 *
 * Two halves. **What is hashed** is not re-derived: `turbo run test --dry=json` lists every
 * file in every task's hash, and the closure of a task's `dependsOn` is followed through the
 * same plan. **What is read** is found statically, with the TypeScript parser, never a regex
 * over source text (a regex reads comments): the files each package's Vitest run selects,
 * every module they reach by a relative import, and in them every path built from an anchor
 * (`import.meta.url`, `import.meta.dirname`, `__dirname`, `process.cwd()`, `require.resolve`)
 * through `new URL`, `fileURLToPath`, `path.join/resolve/dirname`, template literals and the
 * helpers that return them. A part known only at runtime becomes a wildcard and is matched
 * against `git ls-files`.
 *
 * What it cannot see: files read by a process the test spawns (the CLI, git, a plugin), paths
 * resolved inside a dependency's own code, and a read whose path comes from a parameter, an
 * environment variable or a loop it cannot follow. Those last are counted as opaque and
 * reported, never failed on.
 */

const PATH_FUNCTIONS = new Set(['join', 'resolve', 'dirname', 'normalize']);
const PATH_BUILDERS = new Set([...PATH_FUNCTIONS, 'basename', 'relative', 'extname']);
const NODE_MODULES = /^(node:)?(path|url|fs|fs\/promises|child_process)$/u;
const PATH_MODULE = /^(node:)?path$/u;
const SOURCE_FILE = /\.([cm]?[jt]s|tsx)$/u;
/** Calls whose first argument is a path read from disk, or a program run against one. */
const READS = new Set([
  'readFileSync',
  'readFile',
  'existsSync',
  'readdirSync',
  'readdir',
  'statSync',
  'stat',
  'lstat',
  'lstatSync',
  'access',
  'accessSync',
  'opendir',
  'createReadStream',
  'glob',
  'globSync',
  'cp',
  'cpSync',
  'copyFile',
  'copyFileSync',
  'realpath',
  'realpathSync',
  'watch',
  'spawn',
  'spawnSync',
  'execFile',
  'execFileSync',
  'fork',
  'execSync',
]);
/** A read whose path came from one of these is a scratch folder, not the repository. */
const SCRATCH_CALLS = new Set(['mkdtemp', 'mkdtempSync', 'tmpdir', 'homedir']);
/** Stands for a part of a path known only at runtime; it survives `path.join` and `new URL`. */
const RUNTIME = 'zzRUNTIMEzz';
/** Vitest's default `include`, with its `?(…)` extglobs spelled as alternatives. */
const VITEST_DEFAULT_INCLUDE = ['**/*.{test,spec}.{js,ts,mjs,mts,cjs,cts,jsx,tsx}'];
const VITEST_DEFAULT_EXCLUDE = ['**/node_modules/**', '**/dist/**'];
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', 'out', '.turbo', '.git']);

export const REPOSITORY_ROOT_LABEL = '<repository root>';

type Value =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'url'; readonly href: string }
  | { readonly kind: 'object'; readonly properties: ReadonlyMap<string, Value | null> }
  | { readonly kind: 'function'; readonly node: ts.SignatureDeclaration; readonly entry: Entry };

interface Entry {
  readonly file: string;
  readonly source: ts.SourceFile;
  /** Local name → the module and the name it was imported as (`*`, `default` or a name). */
  readonly imports: ReadonlyMap<string, { readonly module: string; readonly imported: string }>;
  /** Every initializer, function and `name = value` assignment of a name, anywhere in the file. */
  readonly bindings: ReadonlyMap<string, readonly ts.Node[]>;
}

interface Context {
  readonly packageDirectory: string;
  readonly environment?: ReadonlyMap<string, Value | null>;
  readonly guard: Set<ts.Node>;
}

/** The part of `turbo run test --dry=json` this check reads. */
export interface TurboPlan {
  readonly globalCacheInputs: { readonly files: Readonly<Record<string, string>> };
  readonly tasks: readonly {
    readonly taskId: string;
    readonly directory: string;
    readonly inputs: Readonly<Record<string, string>>;
    readonly dependencies: readonly string[];
    readonly resolvedTaskDefinition: { readonly cache?: boolean };
  }[];
}

interface Reference {
  readonly path: string;
  readonly via: string;
  readonly location: string;
}

/** A read outside the package the hash does not cover, or a path it could not pin down. */
export interface Finding {
  readonly packageName: string;
  readonly file: string;
  readonly location: string;
  readonly via: string;
  readonly why: string;
}

export interface PackageReport {
  readonly packageName: string;
  /** The task's resolved definition says `cache: false`: it never replays, so it is exempt. */
  readonly cacheDisabled: boolean;
  readonly testFiles: number;
  readonly covered: readonly {
    readonly file: string;
    readonly reason: string;
    readonly location: string;
  }[];
  readonly gaps: readonly Finding[];
  readonly unresolved: readonly Finding[];
  /** Reads whose path the scanner could not evaluate at all, by where the path came from. */
  readonly opaque: { readonly scratch: number; readonly other: number };
}

interface WorkspacePackage {
  readonly directory: string;
  readonly name: string;
  readonly hasTest: boolean;
}

/** Runs the workspace's own Turborepo for the plan of every `test` task, executing nothing. */
export function readTurboPlan(root: string): TurboPlan {
  const binary = createRequire(path.join(root, 'package.json')).resolve('turbo/bin/turbo');
  const output = execFileSync(process.execPath, [binary, 'run', 'test', '--dry=json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output) as TurboPlan;
}

export function scanTestReads(root: string, plan: TurboPlan): PackageReport[] {
  return new Scanner(root, plan).run();
}

class Scanner {
  private readonly entries = new Map<string, Entry>();
  private readonly memos = new Map<string, Map<ts.Node, Value | null>>();
  private readonly exports = new Map<string, Value | null>();
  private readonly tasks: ReadonlyMap<string, TurboPlan['tasks'][number]>;
  private readonly packages: readonly WorkspacePackage[];
  private readonly packagesByName: ReadonlyMap<string, WorkspacePackage>;
  private readonly tracked: ReadonlySet<string>;
  private readonly trackedList: readonly string[];

  constructor(
    private readonly root: string,
    private readonly plan: TurboPlan,
  ) {
    this.tasks = new Map(plan.tasks.map((task) => [task.taskId, task]));
    this.packages = workspacePackages(root);
    this.packagesByName = new Map(this.packages.map((each) => [each.name, each]));
    this.trackedList = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      maxBuffer: 1 << 28,
    })
      .toString('utf8')
      .split('\0')
      .filter((file) => file !== '');
    this.tracked = new Set(this.trackedList);
  }

  run(): PackageReport[] {
    const reports: PackageReport[] = [];
    for (const workspace of this.packages) {
      if (!workspace.hasTest) continue;
      const task = this.tasks.get(`${workspace.name}#test`);
      if (task === undefined) continue;
      const { files, extra } = vitestSelection(workspace.directory, (file) => this.entry(file));
      const references: Reference[] = [];
      const workspaceImports: { name: string; location: string }[] = [];
      const opaque = { scratch: 0, other: 0 };
      const seen = new Set<string>();
      const pending: string[] = [];
      const enqueue = (file: string): void => {
        if (seen.has(file) || !existsSync(file)) return;
        seen.add(file);
        pending.push(file);
      };
      [...files, ...extra].forEach(enqueue);
      for (let file = pending.shift(); file !== undefined; file = pending.shift()) {
        if (!SOURCE_FILE.test(file)) continue;
        this.collect(this.entry(file), workspace, {
          enqueue,
          reference: (reference) => references.push(reference),
          workspaceImport: (name, location) => workspaceImports.push({ name, location }),
          opaque: (kind) => (opaque[kind] += 1),
        });
      }
      reports.push(
        this.classify(workspace, task, files.length, references, workspaceImports, opaque),
      );
    }
    return reports;
  }

  private entry(file: string): Entry {
    const known = this.entries.get(file);
    if (known !== undefined) return known;
    const kind = file.endsWith('x')
      ? ts.ScriptKind.TSX
      : /\.[cm]?js$/u.test(file)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      kind,
    );
    const imports = new Map<string, { module: string; imported: string }>();
    const bindings = new Map<string, ts.Node[]>();
    const bind = (name: string, node: ts.Node): void => {
      bindings.set(name, [...(bindings.get(name) ?? []), node]);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        bind(node.name.text, node.initializer);
      } else if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
        bind(node.name.text, node);
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        bind(node.left.text, node.right);
      } else if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.importClause !== undefined
      ) {
        const module = node.moduleSpecifier.text;
        const clause = node.importClause;
        if (clause.name !== undefined)
          imports.set(clause.name.text, { module, imported: 'default' });
        const named = clause.namedBindings;
        if (named !== undefined && ts.isNamespaceImport(named)) {
          imports.set(named.name.text, { module, imported: '*' });
        } else if (named !== undefined) {
          for (const element of named.elements) {
            imports.set(element.name.text, {
              module,
              imported: (element.propertyName ?? element.name).text,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    const entry: Entry = { file, source, imports, bindings };
    this.entries.set(file, entry);
    return entry;
  }

  // ---- evaluating a path expression ----

  private evaluate(
    entry: Entry,
    node: ts.Node | undefined,
    context: Context,
    depth = 0,
  ): Value | null {
    const MAX_DEPTH = 25;
    if (node === undefined || depth > MAX_DEPTH) return null;
    const next = depth + 1;
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isAwaitExpression(node)
    ) {
      return this.evaluate(entry, node.expression, context, next);
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return { kind: 'text', text: node.text };
    }
    if (ts.isTemplateExpression(node)) {
      const parts: (Value | null)[] = [{ kind: 'text', text: node.head.text }];
      for (const span of node.templateSpans) {
        parts.push(this.evaluate(entry, span.expression, context, next));
        parts.push({ kind: 'text', text: span.literal.text });
      }
      return concatenate(parts);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return concatenate([
        this.evaluate(entry, node.left, context, next),
        this.evaluate(entry, node.right, context, next),
      ]);
    }
    if (ts.isPropertyAccessExpression(node)) return this.property(entry, node, context, next);
    if (ts.isObjectLiteralExpression(node)) {
      const properties = new Map<string, Value | null>();
      for (const property of node.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ) {
          properties.set(
            property.name.text,
            this.evaluate(entry, property.initializer, context, next),
          );
        } else if (ts.isShorthandPropertyAssignment(property)) {
          properties.set(property.name.text, this.evaluate(entry, property.name, context, next));
        }
      }
      return { kind: 'object', properties };
    }
    if (ts.isIdentifier(node)) return this.identifier(entry, node, context, next);
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      return { kind: 'function', node, entry };
    }
    if (ts.isNewExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'URL') {
        return this.url(entry, node.arguments ?? ts.factory.createNodeArray(), context, next);
      }
      return null;
    }
    if (ts.isCallExpression(node)) return this.call(entry, node, context, next);
    if (ts.isConditionalExpression(node)) {
      const whenTrue = this.evaluate(entry, node.whenTrue, context, next);
      const whenFalse = this.evaluate(entry, node.whenFalse, context, next);
      const key = valueKey(whenTrue);
      return key !== null && key === valueKey(whenFalse) ? whenTrue : null;
    }
    return null;
  }

  private property(
    entry: Entry,
    node: ts.PropertyAccessExpression,
    context: Context,
    depth: number,
  ): Value | null {
    const name = node.name.text;
    if (ts.isMetaProperty(node.expression)) {
      if (node.expression.keywordToken !== ts.SyntaxKind.ImportKeyword) return null;
      if (name === 'url') return { kind: 'url', href: pathToFileURL(entry.file).href };
      if (name === 'dirname') return { kind: 'path', path: path.dirname(entry.file) };
      if (name === 'filename') return { kind: 'path', path: entry.file };
      return null;
    }
    const target = this.evaluate(entry, node.expression, context, depth);
    if (target?.kind === 'url' && name === 'pathname') return asPath(target);
    if (target?.kind === 'url' && name === 'href') return target;
    if (target?.kind === 'object') return target.properties.get(name) ?? null;
    if (ts.isIdentifier(node.expression)) {
      const imported = entry.imports.get(node.expression.text);
      if (imported?.imported === '*' && imported.module.startsWith('.')) {
        return this.exported(resolveModule(entry.file, imported.module), name, depth);
      }
    }
    return null;
  }

  private identifier(
    entry: Entry,
    node: ts.Identifier,
    context: Context,
    depth: number,
  ): Value | null {
    const name = node.text;
    if (context.environment?.has(name) === true) return context.environment.get(name) ?? null;
    if (name === '__dirname') return { kind: 'path', path: path.dirname(entry.file) };
    if (name === '__filename') return { kind: 'path', path: entry.file };
    const declaration = findDeclaration(node);
    if (declaration === 'binding') return null;
    if (declaration !== null) return this.declared(entry, declaration, context, depth);
    const imported = entry.imports.get(name);
    if (imported !== undefined && imported.module.startsWith('.') && imported.imported !== '*') {
      return this.exported(resolveModule(entry.file, imported.module), imported.imported, depth);
    }
    return null;
  }

  private memoFor(packageDirectory: string): Map<ts.Node, Value | null> {
    const known = this.memos.get(packageDirectory);
    if (known !== undefined) return known;
    const created = new Map<ts.Node, Value | null>();
    this.memos.set(packageDirectory, created);
    return created;
  }

  private declared(
    entry: Entry,
    declaration: ts.Node,
    context: Context,
    depth: number,
  ): Value | null {
    if (isFunction(declaration)) return { kind: 'function', node: declaration, entry };
    if (context.guard.has(declaration)) return null;
    // A declaration evaluated without bound parameters has one value per working directory;
    // a test file names the same constants at hundreds of call sites.
    // A module-level constant cannot see a helper's parameters, so it drops them.
    const scope: Context = isModuleLevel(declaration)
      ? { packageDirectory: context.packageDirectory, guard: context.guard }
      : context;
    const memo = scope.environment === undefined ? this.memoFor(context.packageDirectory) : null;
    if (memo?.has(declaration) === true) return memo.get(declaration) ?? null;
    context.guard.add(declaration);
    const value = this.evaluate(entry, declaration, scope, depth);
    context.guard.delete(declaration);
    memo?.set(declaration, value);
    return value;
  }

  /** A top-level constant or function another module exports. */
  private exported(file: string, name: string, depth: number): Value | null {
    const key = `${file}\0${name}`;
    if (this.exports.has(key)) return this.exports.get(key) ?? null;
    let value: Value | null = null;
    if (SOURCE_FILE.test(file) && existsSync(file)) {
      const entry = this.entry(file);
      const declaration = topLevelDeclaration(entry.source, name);
      if (declaration !== null && declaration !== 'binding') {
        const owner = this.ownerOf(file);
        const context: Context = {
          packageDirectory: owner?.directory ?? this.root,
          guard: new Set(),
        };
        value = this.declared(entry, declaration, context, depth);
      }
    }
    this.exports.set(key, value);
    return value;
  }

  private call(
    entry: Entry,
    node: ts.CallExpression,
    context: Context,
    depth: number,
  ): Value | null {
    const name = builtinName(entry, node.expression);
    if (name === 'cwd') return { kind: 'path', path: context.packageDirectory };
    const pathCall = isPathModuleCall(entry, node.expression);
    const known =
      name === 'fileURLToPath' ||
      name === 'pathToFileURL' ||
      name === 'resolve' ||
      (name !== null && PATH_FUNCTIONS.has(name) && pathCall);
    // Any other callee is worth its arguments only when it is a helper this file can read:
    // evaluating the arguments of every `expect(...)` first made the scan quadratic.
    const callee = known ? null : this.evaluate(entry, node.expression, context, depth);
    if (!known && callee?.kind !== 'function') return null;
    const values = node.arguments.map((argument) => this.evaluate(entry, argument, context, depth));
    const first = values[0] ?? null;
    if (name === 'fileURLToPath') return asPath(first);
    if (name === 'pathToFileURL') {
      const local = asPath(first);
      return local?.kind === 'path' ? { kind: 'url', href: pathToFileURL(local.path).href } : null;
    }
    if (name !== null && PATH_FUNCTIONS.has(name) && pathCall) {
      return pathFunction(name, values, context.packageDirectory);
    }
    // `require.resolve('@tyto/templates/package.json')` and `import.meta.resolve` alike.
    if (name === 'resolve') {
      return first?.kind === 'text' && !first.text.startsWith('.')
        ? this.packagePath(first.text)
        : null;
    }
    if (callee?.kind !== 'function') return null;
    return this.callFunction(callee, values, context, depth);
  }

  /** A helper with one returned expression, evaluated with its parameters bound. */
  private callFunction(
    callee: Extract<Value, { kind: 'function' }>,
    values: readonly (Value | null)[],
    context: Context,
    depth: number,
  ): Value | null {
    const body = 'body' in callee.node ? callee.node.body : undefined;
    if (body === undefined) return null;
    let returned: ts.Node | undefined = body;
    if (ts.isBlock(body)) {
      const returns = body.statements.filter(ts.isReturnStatement);
      if (returns.length !== 1) return null;
      returned = returns[0]?.expression;
    }
    const environment = new Map<string, Value | null>(context.environment ?? []);
    callee.node.parameters.forEach((parameter, index) => {
      if (!ts.isIdentifier(parameter.name)) return;
      const given = values[index];
      environment.set(
        parameter.name.text,
        given !== undefined
          ? given
          : this.evaluate(callee.entry, parameter.initializer, context, depth),
      );
    });
    return this.evaluate(callee.entry, returned, { ...context, environment }, depth);
  }

  private url(
    entry: Entry,
    nodes: ts.NodeArray<ts.Expression>,
    context: Context,
    depth: number,
  ): Value | null {
    const specifier = this.evaluate(entry, nodes[0], context, depth);
    const base = nodes[1] === undefined ? null : this.evaluate(entry, nodes[1], context, depth);
    if (specifier?.kind !== 'text') return null;
    let baseHref: string | undefined;
    if (base?.kind === 'url') baseHref = base.href;
    else if (base?.kind === 'text') baseHref = base.text;
    else if (base !== null || !specifier.text.startsWith('file:')) return null;
    try {
      return { kind: 'url', href: new URL(specifier.text, baseHref).href };
    } catch {
      return null;
    }
  }

  private packagePath(specifier: string): Value {
    const parts = specifier.split('/');
    const scoped = specifier.startsWith('@');
    const name = parts.slice(0, scoped ? 2 : 1).join('/');
    const rest = parts.slice(scoped ? 2 : 1).join('/');
    const workspace = this.packagesByName.get(name);
    if (workspace !== undefined)
      return { kind: 'path', path: path.join(workspace.directory, rest) };
    return { kind: 'path', path: path.join(this.root, 'node_modules', specifier) };
  }

  // ---- finding the references in one file ----

  private collect(
    entry: Entry,
    workspace: WorkspacePackage,
    sink: {
      enqueue: (file: string) => void;
      reference: (reference: Reference) => void;
      workspaceImport: (name: string, location: string) => void;
      opaque: (kind: 'scratch' | 'other') => void;
    },
  ): void {
    const context = (): Context => ({ packageDirectory: workspace.directory, guard: new Set() });
    const location = (node: ts.Node): string => {
      const { line } = entry.source.getLineAndCharacterOfPosition(node.getStart());
      return `${this.relative(entry.file)}:${String(line + 1)}`;
    };
    const record = (value: Value | null, node: ts.Node, via: string): boolean => {
      if (value?.kind === 'object') {
        let any = false;
        for (const inner of value.properties.values()) any = record(inner, node, via) || any;
        return any;
      }
      const local = asPath(value);
      if (local?.kind !== 'path') return false;
      sink.reference({ path: local.path, via, location: location(node) });
      return true;
    };
    const visit = (node: ts.Node): void => {
      let specifier: string | null = null;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        !(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly === true)
      ) {
        specifier = node.moduleSpecifier.text;
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const value = this.evaluate(entry, node.arguments[0], context());
        if (value?.kind === 'text' && !value.text.includes(RUNTIME)) specifier = value.text;
        else if (!record(value, node, 'import()'))
          sink.opaque(scratchOrOther(entry, node.arguments[0]));
      }
      if (specifier !== null) this.importOf(entry, workspace, specifier, location(node), sink);
      if (ts.isCallExpression(node) || ts.isNewExpression(node))
        this.callSite(entry, node, context(), record, sink);
      ts.forEachChild(node, visit);
    };
    visit(entry.source);
  }

  private importOf(
    entry: Entry,
    workspace: WorkspacePackage,
    specifier: string,
    location: string,
    sink: {
      enqueue: (file: string) => void;
      reference: (reference: Reference) => void;
      workspaceImport: (name: string, location: string) => void;
    },
  ): void {
    if (specifier.startsWith('.')) {
      const target = resolveModule(entry.file, specifier);
      const query = specifier.indexOf('?');
      const source = SOURCE_FILE.test(target) && query === -1;
      if (
        source &&
        isInside(target, this.root) &&
        !target.split(path.sep).includes('node_modules')
      ) {
        sink.enqueue(target);
      }
      if (!(source && isInside(target, workspace.directory))) {
        sink.reference({
          path: target,
          via: query === -1 ? 'import' : `import ${specifier.slice(query)}`,
          location,
        });
      }
    } else if (specifier.startsWith('@tyto/')) {
      sink.workspaceImport(specifier.split('/').slice(0, 2).join('/'), location);
    }
  }

  private callSite(
    entry: Entry,
    node: ts.CallExpression | ts.NewExpression,
    context: Context,
    record: (value: Value | null, node: ts.Node, via: string) => boolean,
    sink: { opaque: (kind: 'scratch' | 'other') => void },
  ): void {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return;
    const name = builtinName(entry, node.expression) ?? node.expression.getText().slice(0, 40);
    const newUrl =
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL';
    const builder =
      newUrl ||
      name === 'fileURLToPath' ||
      name === 'pathToFileURL' ||
      (PATH_BUILDERS.has(name) && isPathModuleCall(entry, node.expression));
    if (builder) return;
    const argumentsGiven = node.arguments ?? ts.factory.createNodeArray();
    let resolved = false;
    for (const argument of argumentsGiven) {
      const values = ts.isArrayLiteralExpression(argument)
        ? argument.elements.map((element) => this.evaluate(entry, element, context))
        : [this.evaluate(entry, argument, context)];
      for (const value of values) if (record(value, node, name)) resolved = true;
    }
    const first = argumentsGiven[0];
    if (
      !resolved &&
      READS.has(name) &&
      first !== undefined &&
      isOpaque(this.evaluate(entry, first, context))
    ) {
      sink.opaque(scratchOrOther(entry, first));
    }
  }

  // ---- classifying against the plan ----

  private classify(
    workspace: WorkspacePackage,
    task: TurboPlan['tasks'][number],
    testFiles: number,
    references: readonly Reference[],
    workspaceImports: readonly { name: string; location: string }[],
    opaque: { scratch: number; other: number },
  ): PackageReport {
    const closure = this.closureOf(task.taskId);
    const hashed = this.hashedFiles(closure, task.taskId);
    const builtPackages = new Set(
      [...closure]
        .filter((id) => id.endsWith('#build'))
        .map((id) => id.slice(0, id.lastIndexOf('#'))),
    );
    const covered: { file: string; reason: string; location: string }[] = [];
    const gaps: Finding[] = [];
    const unresolved: Finding[] = [];
    const finding = (file: string, reference: Reference, why: string): Finding => ({
      packageName: workspace.name,
      file,
      location: reference.location,
      via: reference.via,
      why,
    });
    for (const { name, location } of workspaceImports) {
      if (name === workspace.name) continue;
      if (builtPackages.has(name)) covered.push({ file: name, reason: `${name}#build`, location });
      else {
        gaps.push({
          packageName: workspace.name,
          file: name,
          location,
          via: 'import',
          why: 'imports a workspace package whose build is not in this task’s dependsOn',
        });
      }
    }
    for (const reference of references) {
      const absolute = this.throughNodeModules(reference.path);
      if (absolute === null) continue; // an installed dependency: the lockfile is hashed
      if (absolute.includes(RUNTIME)) {
        const prefix = absolute.slice(0, absolute.indexOf(RUNTIME));
        if (isInside(prefix, workspace.directory) && prefix.length > workspace.directory.length)
          continue;
        // A known part above the repository root anchors nothing in it (a `file:${…}` spec).
        if (!isInside(prefix, this.root)) continue;
        const pattern = this.relative(absolute);
        const shown = pattern.split(RUNTIME).join('<runtime>');
        const matcher = new RegExp(
          `^${pattern.split(RUNTIME).map(escapeRegExp).join('.*')}(/.*)?$`,
          'u',
        );
        const files = this.trackedList.filter((file) => matcher.test(file));
        const missing = files.filter((file) => !hashed.has(file));
        if (files.length === 0)
          unresolved.push(finding(shown, reference, 'built at runtime; no tracked file matches'));
        else if (missing.length > 0) {
          unresolved.push(
            finding(
              shown,
              reference,
              `built at runtime; ${String(missing.length)} of ${String(files.length)} tracked files it can name are not hashed, e.g. ${missing.slice(0, 2).join(', ')}`,
            ),
          );
        } else
          covered.push({
            file: shown,
            reason: reasonOf(files.map((file) => hashed.get(file))),
            location: reference.location,
          });
        continue;
      }
      if (isInside(absolute, workspace.directory) || !isInside(absolute, this.root)) continue;
      const relativePath = this.relative(absolute);
      if (!existsSync(absolute)) continue; // a path the test writes or expects to be absent
      if (relativePath === '') {
        unresolved.push(
          finding(
            REPOSITORY_ROOT_LABEL,
            reference,
            'the repository root itself, as a cwd or a base',
          ),
        );
        continue;
      }
      const owner = this.ownerOf(absolute);
      const builtOutput = owner !== undefined && builtPackages.has(owner.name);
      if (statSync(absolute).isDirectory()) {
        const files = this.trackedList.filter((file) => file.startsWith(`${relativePath}/`));
        const missing = files.filter((file) => !hashed.has(file));
        if (files.length === 0 && builtOutput)
          covered.push({
            file: `${relativePath}/`,
            reason: `${owner.name}#build output`,
            location: reference.location,
          });
        else if (files.length > 0 && missing.length === 0)
          covered.push({
            file: `${relativePath}/`,
            reason: reasonOf(files.map((file) => hashed.get(file))),
            location: reference.location,
          });
        else {
          gaps.push(
            finding(
              `${relativePath}/`,
              reference,
              `${String(missing.length)} of ${String(files.length)} tracked files under it are not hashed, e.g. ${missing.slice(0, 2).join(', ')}`,
            ),
          );
        }
        continue;
      }
      const reason = hashed.get(relativePath);
      if (reason !== undefined)
        covered.push({ file: relativePath, reason, location: reference.location });
      else if (!this.tracked.has(relativePath) && builtOutput)
        covered.push({
          file: relativePath,
          reason: `${owner.name}#build output`,
          location: reference.location,
        });
      else
        gaps.push(
          finding(
            relativePath,
            reference,
            this.tracked.has(relativePath)
              ? 'tracked, not in the task’s hash'
              : 'untracked, and no build in the task’s dependsOn writes it',
          ),
        );
    }
    return {
      packageName: workspace.name,
      cacheDisabled: task.resolvedTaskDefinition.cache === false,
      testFiles,
      covered,
      gaps,
      unresolved,
      opaque,
    };
  }

  private closureOf(taskId: string): Set<string> {
    const seen = new Set<string>();
    const stack = [taskId];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(this.tasks.get(id)?.dependencies ?? []));
    }
    return seen;
  }

  /** Repository-relative file → why it is in the hash (`own inputs`, a dependency task, `global`). */
  private hashedFiles(closure: ReadonlySet<string>, taskId: string): Map<string, string> {
    const hashed = new Map<string, string>();
    for (const id of closure) {
      const task = this.tasks.get(id);
      if (task === undefined) continue;
      for (const file of Object.keys(task.inputs)) {
        const relativePath = this.relative(path.resolve(this.root, task.directory, file));
        if (id === taskId || !hashed.has(relativePath))
          hashed.set(relativePath, id === taskId ? 'own inputs' : id);
      }
    }
    for (const file of Object.keys(this.plan.globalCacheInputs.files)) {
      if (!hashed.has(file)) hashed.set(file, 'global');
    }
    return hashed;
  }

  /** A workspace package seen through `node_modules` is that package; anything else is installed. */
  private throughNodeModules(file: string): string | null {
    if (!file.split(path.sep).includes('node_modules')) return file;
    for (let probe = file; probe.length > this.root.length; probe = path.dirname(probe)) {
      if (!existsSync(probe)) continue;
      const real = path.join(realpathSync(probe), path.relative(probe, file));
      return isInside(real, this.root) && !real.split(path.sep).includes('node_modules')
        ? real
        : null;
    }
    return null;
  }

  private ownerOf(file: string): WorkspacePackage | undefined {
    return this.packages
      .filter((each) => isInside(file, each.directory))
      .sort((a, b) => b.directory.length - a.directory.length)[0];
  }

  private relative(file: string): string {
    return path.relative(this.root, file).split(path.sep).join('/');
  }
}

// ---- helpers without state ----

function workspacePackages(root: string): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const group of ['apps', 'packages', 'tools']) {
    for (const name of readdirSync(path.join(root, group))) {
      const directory = path.join(root, group, name);
      const manifest = path.join(directory, 'package.json');
      if (!existsSync(manifest)) continue;
      const json = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name: string;
        scripts?: Record<string, string>;
      };
      found.push({ directory, name: json.name, hasTest: json.scripts?.test !== undefined });
    }
  }
  return found;
}

/** The test files `vitest run` selects, and the setup files its config names. */
function vitestSelection(
  directory: string,
  parse: (file: string) => Entry,
): { files: string[]; extra: string[] } {
  let include = VITEST_DEFAULT_INCLUDE;
  let exclude = VITEST_DEFAULT_EXCLUDE;
  const extra: string[] = [];
  const config = ['vitest.config.ts', 'vitest.config.mts', 'vite.config.ts']
    .map((name) => path.join(directory, name))
    .find((file) => existsSync(file));
  if (config !== undefined) {
    extra.push(config);
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        const literals = node.initializer.elements
          .filter(ts.isStringLiteral)
          .map((each) => each.text);
        if (node.name.text === 'include') include = literals;
        if (node.name.text === 'exclude') exclude = literals;
        if (node.name.text === 'setupFiles' || node.name.text === 'globalSetup') {
          for (const each of literals) {
            const file = path.resolve(directory, each);
            extra.push(existsSync(file) ? file : `${file}.ts`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(config).source);
  }
  const includes = include.map(globToRegExp);
  const excludes = exclude.map(globToRegExp);
  const files: string[] = [];
  const walk = (folder: string): void => {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      if (SKIPPED_FOLDERS.has(item.name)) continue;
      const file = path.join(folder, item.name);
      if (item.isDirectory()) walk(file);
      else {
        const relativePath = path.relative(directory, file).split(path.sep).join('/');
        if (
          includes.some((glob) => glob.test(relativePath)) &&
          !excludes.some((glob) => glob.test(relativePath))
        ) {
          files.push(file);
        }
      }
    }
  };
  walk(directory);
  return { files, extra };
}

/** `*` within a segment, `**` across segments, `{a,b}` either alternative. */
function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index] ?? '';
    if (character === '*' && glob[index + 1] === '*') {
      const slash = glob[index + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      index += slash ? 2 : 1;
    } else if (character === '*') source += '[^/]*';
    else if (character === '{') source += '(?:';
    else if (character === '}') source += ')';
    else if (character === ',') source += '|';
    else if (character === '?') source += '[^/]';
    else source += escapeRegExp(character);
  }
  return new RegExp(`^${source}$`, 'u');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function isInside(child: string, parent: string): boolean {
  const relativePath = path.relative(parent, child);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

/** Memoized: an imported name is resolved at every call site that uses it. */
function resolveModule(from: string, specifier: string): string {
  const key = `${path.dirname(from)}\0${specifier}`;
  const known = resolvedModules.get(key);
  if (known !== undefined) return known;
  const resolved = searchModule(from, specifier);
  resolvedModules.set(key, resolved);
  return resolved;
}
const resolvedModules = new Map<string, string>();

function searchModule(from: string, specifier: string): string {
  const base = path.resolve(path.dirname(from), specifier.split('?')[0] ?? specifier);
  const candidates = [
    base,
    base.replace(/\.js$/u, '.ts'),
    base.replace(/\.js$/u, '.tsx'),
    base.replace(/\.mjs$/u, '.mts'),
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
  ];
  return candidates.find((file) => existsSync(file) && statSync(file).isFile()) ?? base;
}

function isModuleLevel(node: ts.Node): boolean {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) return false;
  }
  return true;
}

function isFunction(node: ts.Node): node is ts.SignatureDeclaration {
  return (
    ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)
  );
}

/**
 * The nearest declaration of the name a reference uses, walking out from it. The initializer
 * or function, `'binding'` for a parameter, loop or catch variable, null when none is found
 * (an import, or a global).
 */
function findDeclaration(reference: ts.Identifier): ts.Node | 'binding' | null {
  const known = declarations.get(reference);
  if (known !== undefined) return known;
  const found = searchDeclaration(reference);
  declarations.set(reference, found);
  return found;
}
const declarations = new WeakMap<ts.Identifier, ts.Node | 'binding' | null>();

function searchDeclaration(reference: ts.Identifier): ts.Node | 'binding' | null {
  const name = reference.text;
  for (
    let scope: ts.Node | undefined = reference.parent;
    scope !== undefined;
    scope = scope.parent
  ) {
    if (
      ts.isFunctionLike(scope) &&
      scope.parameters.some((parameter) => binds(parameter.name, name))
    ) {
      return 'binding';
    }
    if (
      (ts.isForOfStatement(scope) || ts.isForInStatement(scope) || ts.isForStatement(scope)) &&
      scope.initializer !== undefined &&
      ts.isVariableDeclarationList(scope.initializer) &&
      scope.initializer.declarations.some((declaration) => binds(declaration.name, name))
    ) {
      return 'binding';
    }
    if (
      ts.isCatchClause(scope) &&
      scope.variableDeclaration !== undefined &&
      binds(scope.variableDeclaration.name, name)
    ) {
      return 'binding';
    }
    const statements =
      ts.isBlock(scope) ||
      ts.isSourceFile(scope) ||
      ts.isModuleBlock(scope) ||
      ts.isCaseClause(scope) ||
      ts.isDefaultClause(scope)
        ? scope.statements
        : undefined;
    if (statements === undefined) continue;
    const found = declarationIn(statements, name);
    if (found !== null) return found;
  }
  return null;
}

function topLevelDeclaration(source: ts.SourceFile, name: string): ts.Node | 'binding' | null {
  return declarationIn(source.statements, name);
}

function declarationIn(
  statements: ts.NodeArray<ts.Statement>,
  name: string,
): ts.Node | 'binding' | null {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
          return declaration.initializer ?? 'binding';
        }
        if (!ts.isIdentifier(declaration.name) && binds(declaration.name, name)) return 'binding';
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
  }
  return null;
}

function binds(name: ts.BindingName, wanted: string): boolean {
  if (ts.isIdentifier(name)) return name.text === wanted;
  return name.elements.some(
    (element) => !ts.isOmittedExpression(element) && binds(element.name, wanted),
  );
}

/** The Node function a callee names (`join`, `fileURLToPath`, `cwd`), or its plain name. */
function builtinName(entry: Entry, callee: ts.Expression): string | null {
  if (ts.isIdentifier(callee)) {
    const imported = entry.imports.get(callee.text);
    if (imported !== undefined)
      return NODE_MODULES.test(imported.module) ? imported.imported : null;
    return findDeclaration(callee) === null ? callee.text : null;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const object = callee.expression;
    const name = callee.name.text;
    if (name !== 'cwd') return name;
    return ts.isIdentifier(object) && object.text === 'process' ? 'cwd' : 'cwd()';
  }
  return null;
}

function isPathModuleCall(entry: Entry, callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee))
    return PATH_MODULE.test(entry.imports.get(callee.text)?.module ?? '');
  if (!ts.isPropertyAccessExpression(callee)) return false;
  let object = callee.expression;
  if (ts.isPropertyAccessExpression(object) && ['posix', 'win32'].includes(object.name.text)) {
    object = object.expression;
  }
  if (!ts.isIdentifier(object)) return false;
  const imported = entry.imports.get(object.text);
  return imported === undefined ? object.text === 'path' : PATH_MODULE.test(imported.module);
}

function asPath(value: Value | null): Value | null {
  try {
    if (value?.kind === 'path') return value;
    if (value?.kind === 'url' && value.href.startsWith('file:')) {
      return { kind: 'path', path: fileURLToPath(value.href) };
    }
    // Only a whole `file:` literal: `file:${path}` with a runtime path is no anchor, and
    // `fileURLToPath` reads it as `/…` on Linux and refuses it on Windows (CI found this).
    if (value?.kind === 'text' && value.text.startsWith('file:') && !value.text.includes(RUNTIME)) {
      return { kind: 'path', path: fileURLToPath(value.text) };
    }
  } catch {
    // A literal such as `file:///close` in a fixture is not a path on this disk.
  }
  return null;
}

/** Joins the parts of a template literal or a `+`; a part it cannot evaluate becomes RUNTIME. */
function concatenate(given: readonly (Value | null)[]): Value | null {
  let parts = given;
  // `${ROOT}/docs` opens with an empty literal; the path after it is the real start.
  while (parts.length > 1 && parts[0]?.kind === 'text' && parts[0].text === '')
    parts = parts.slice(1);
  const [first, ...rest] = parts;
  const tail = rest.map((part) => (part?.kind === 'text' ? part.text : RUNTIME)).join('');
  if (first?.kind === 'text') return { kind: 'text', text: first.text + tail };
  if (first?.kind === 'path') return { kind: 'path', path: first.path + tail };
  if (first?.kind === 'url') return { kind: 'url', href: first.href + tail };
  // `${name}.md` keeps its known suffix, so `join(ROOT, 'docs', \`${name}.md\`)` names `docs/*.md`.
  if (first === null && rest.length > 0) return { kind: 'text', text: RUNTIME + tail };
  return null;
}

function pathFunction(name: string, values: readonly (Value | null)[], cwd: string): Value | null {
  if (name === 'dirname') {
    const local = asPath(values[0] ?? null);
    return local?.kind === 'path' ? { kind: 'path', path: path.dirname(local.path) } : null;
  }
  if (name === 'normalize') return asPath(values[0] ?? null) ?? values[0] ?? null;
  const segments = values.map((value) => {
    const local = asPath(value);
    if (local?.kind === 'path') return local.path;
    return value?.kind === 'text' ? value.text : RUNTIME;
  });
  if (segments.length === 0) return null;
  if (name === 'resolve') {
    const start = segments.reduce(
      (last, segment, index) => (path.isAbsolute(segment) ? index : last),
      0,
    );
    return { kind: 'path', path: path.resolve(cwd, ...segments.slice(start)) };
  }
  const joined = path.join(...segments);
  if (path.isAbsolute(segments[0] ?? '')) return { kind: 'path', path: joined };
  return joined.includes(RUNTIME) ? null : { kind: 'text', text: joined };
}

/** No anchor in it: nothing the scan can place in the repository. */
function isOpaque(value: Value | null): boolean {
  return value === null || (value.kind === 'text' && value.text.includes(RUNTIME));
}

function valueKey(value: Value | null): string | null {
  if (value?.kind === 'text') return `text:${value.text}`;
  if (value?.kind === 'path') return `path:${value.path}`;
  if (value?.kind === 'url') return `url:${value.href}`;
  return null;
}

function reasonOf(reasons: readonly (string | undefined)[]): string {
  const distinct = [...new Set(reasons)];
  return distinct.length === 1 ? String(distinct[0]) : `${String(distinct.length)} tasks`;
}

/**
 * Whether an argument the scanner could not evaluate comes from a scratch folder: any name in
 * it bound, directly or through a helper, to `mkdtemp`, `tmpdir` or `homedir`.
 */
function scratchOrOther(entry: Entry, node: ts.Node | undefined): 'scratch' | 'other' {
  if (node === undefined) return 'other';
  const seen = new Set<string>();
  const callsScratch = (start: ts.Node): boolean => {
    let found = false;
    const visit = (current: ts.Node): void => {
      if (found) return;
      if (ts.isCallExpression(current)) {
        const callee = current.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : '';
        if (SCRATCH_CALLS.has(name)) found = true;
      }
      if (ts.isIdentifier(current) && !seen.has(current.text)) {
        seen.add(current.text);
        for (const bound of entry.bindings.get(current.text) ?? []) {
          const body = isFunction(bound) ? ('body' in bound ? bound.body : undefined) : bound;
          if (body !== undefined && callsScratch(body)) found = true;
        }
      }
      ts.forEachChild(current, visit);
    };
    visit(start);
    return found;
  };
  return callsScratch(node) ? 'scratch' : 'other';
}
