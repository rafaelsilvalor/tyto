import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Every Electron an end-to-end suite launches gets its own data folders (TYTO-139).
 *
 * **Why a test and not a convention.** Until TYTO-139, eight suites passed `--user-data-dir`
 * and four did not. Those four ran in the developer's real `<appData>/Tyto/<version>`: a closed
 * panel in the real `layout.json` turned them red on the machine that develops the app and
 * green on CI, and an older version folder beside the current one opened a native box nobody
 * was there to answer. `TYTO_HOME` is the same leak one folder over — without it a suite loads
 * whatever plugins and packs the machine has installed in `~/.tyto`.
 *
 * **Why it lives here and runs in `pnpm check`.** It reads source, launches nothing, and takes
 * milliseconds, so it belongs where every pull request runs it — not in `test:desktop`, which a
 * suite missing the flags would only fail on a machine that has used the app.
 *
 * **Why the TypeScript parser and not a regular expression.** A regular expression reads
 * comments, and three suites mention `--user-data-dir` in one. The parser sees the call.
 *
 * The rule is deliberately strict about shape: `args` must be an array literal and `env` an
 * object literal, because a value built elsewhere is one this test cannot read, and a check
 * that waves through what it cannot read is the convention again.
 */

const here = dirname(fileURLToPath(import.meta.url));

const USER_DATA_SWITCH = '--user-data-dir=';
const HOME_VARIABLE = 'TYTO_HOME';

/** Why one `_electron.launch` call is not isolated, located so the message can be clicked. */
interface LaunchProblem {
  readonly line: number;
  readonly reason: string;
}

interface LaunchScan {
  /** Whether the file imports `_electron` from Playwright at all. */
  readonly importsElectron: boolean;
  /** How many `_electron.launch(…)` calls the file holds, isolated or not. */
  readonly launches: number;
  readonly problems: readonly LaunchProblem[];
}

const HOW_TO_FIX =
  `give the suite a scratch folder and launch with ` +
  `args: ['.', \`${USER_DATA_SWITCH}\${join(scratch, 'user-data')}\`] and ` +
  `env: { ...process.env, TYTO_HEADLESS: '1', ${HOME_VARIABLE}: join(scratch, 'tyto-home') }`;

function propertyNamed(
  options: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return options.properties.find(
    (property) =>
      property.name !== undefined &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === name,
  );
}

/** The literal text an array element starts with, when the parser can know it. */
function leadingText(element: ts.Expression): string | undefined {
  if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
    return element.text;
  }
  if (ts.isTemplateExpression(element)) return element.head.text;
  return undefined;
}

function argsProblem(options: ts.ObjectLiteralExpression): string | undefined {
  const args = propertyNamed(options, 'args');
  if (args === undefined) {
    return `it passes no \`args\`, so Electron uses the real data folder`;
  }
  if (!ts.isPropertyAssignment(args) || !ts.isArrayLiteralExpression(args.initializer)) {
    return `its \`args\` is not an array literal, so this check cannot see a \`${USER_DATA_SWITCH}\``;
  }
  const isolated = args.initializer.elements.some((element) =>
    leadingText(element)?.startsWith(USER_DATA_SWITCH),
  );
  return isolated ? undefined : `its \`args\` has no \`${USER_DATA_SWITCH}…\` element`;
}

function envProblem(options: ts.ObjectLiteralExpression): string | undefined {
  const env = propertyNamed(options, 'env');
  if (env === undefined) {
    return `it passes no \`env\`, so \`${HOME_VARIABLE}\` falls back to the real ~/.tyto`;
  }
  if (!ts.isPropertyAssignment(env) || !ts.isObjectLiteralExpression(env.initializer)) {
    return `its \`env\` is not an object literal, so this check cannot see a \`${HOME_VARIABLE}\``;
  }
  return propertyNamed(env.initializer, HOME_VARIABLE) === undefined
    ? `its \`env\` sets no \`${HOME_VARIABLE}\``
    : undefined;
}

/** `import { _electron } from 'playwright'`, which is what makes a file able to launch one. */
function isElectronImport(node: ts.Node): boolean {
  if (!ts.isImportDeclaration(node)) return false;
  if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== 'playwright') {
    return false;
  }
  const bindings = node.importClause?.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.some((element) => (element.propertyName ?? element.name).text === '_electron')
  );
}

function isElectronLaunch(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'launch' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === '_electron'
  );
}

/** Every `_electron.launch(…)` in one source file, and what keeps each from being isolated. */
function scanLaunches(fileName: string, source: string): LaunchScan {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const problems: LaunchProblem[] = [];
  let launches = 0;
  let importsElectron = false;

  const visit = (node: ts.Node): void => {
    if (isElectronImport(node)) importsElectron = true;
    if (isElectronLaunch(node)) {
      launches += 1;
      const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      const [options] = node.arguments;
      const reasons =
        options !== undefined && ts.isObjectLiteralExpression(options)
          ? [argsProblem(options), envProblem(options)].filter(
              (reason): reason is string => reason !== undefined,
            )
          : ['its options are not an object literal, so this check cannot read them'];
      for (const reason of reasons) problems.push({ line, reason });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  return { importsElectron, launches, problems };
}

function suiteFiles(): string[] {
  return readdirSync(here)
    .filter((name) => name.endsWith('.test.ts') && name !== 'launch-isolation.test.ts')
    .sort();
}

describe('every end-to-end suite launches Electron in its own data folders', () => {
  it('finds no launch without its own --user-data-dir and TYTO_HOME', () => {
    const messages = suiteFiles().flatMap((name) =>
      scanLaunches(name, readFileSync(join(here, name), 'utf8')).problems.map(
        (problem) => `e2e/${name}:${problem.line}: ${problem.reason} — ${HOW_TO_FIX}`,
      ),
    );
    expect(messages).toEqual([]);
  });

  // A scan that recognises no launch passes everything. Every file that imports `_electron`
  // must have at least one call this test saw, so an alias (`const launch = _electron.launch`)
  // fails here instead of slipping past the check above.
  it('recognises a launch in every suite that imports _electron', () => {
    const unseen = suiteFiles()
      .filter((name) => {
        const scan = scanLaunches(name, readFileSync(join(here, name), 'utf8'));
        return scan.importsElectron && scan.launches === 0;
      })
      .map(
        (name) =>
          `e2e/${name}: imports _electron but no _electron.launch({ … }) call was recognised — ` +
          'call it directly, with an object literal, so this check can read what it is given',
      );
    expect(unseen).toEqual([]);
  });
});

describe('scanLaunches', () => {
  const isolated = `
    await _electron.launch({
      args: ['.', \`--user-data-dir=\${join(scratch, 'user-data')}\`, ...EXTRA],
      env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
    });`;

  it('accepts a launch with both, in a template or a plain string', () => {
    expect(scanLaunches('a.ts', isolated)).toMatchObject({ launches: 1, problems: [] });
    expect(
      scanLaunches(
        'a.ts',
        `_electron.launch({ args: ['--user-data-dir=/tmp/x'], env: { TYTO_HOME: '/tmp/h' } });`,
      ).problems,
    ).toEqual([]);
  });

  it('reports a launch without --user-data-dir', () => {
    const scan = scanLaunches(
      'a.ts',
      `_electron.launch({ args: ['.'], env: { TYTO_HOME: home } });`,
    );
    expect(scan.problems).toEqual([
      { line: 1, reason: 'its `args` has no `--user-data-dir=…` element' },
    ]);
  });

  it('does not count --user-data-dir that only appears in a comment', () => {
    const scan = scanLaunches(
      'a.ts',
      `_electron.launch({\n  // pass --user-data-dir= here\n  args: ['.'],\n  env: { TYTO_HOME: home },\n});`,
    );
    expect(scan.problems).toHaveLength(1);
  });

  it('reports a launch without TYTO_HOME', () => {
    const scan = scanLaunches(
      'a.ts',
      `_electron.launch({ args: ['--user-data-dir=/x'], env: { ...process.env } });`,
    );
    expect(scan.problems).toEqual([{ line: 1, reason: 'its `env` sets no `TYTO_HOME`' }]);
  });

  it('reports what it cannot read rather than passing it', () => {
    const scan = scanLaunches(
      'a.ts',
      `_electron.launch({ args, env: environment() });\n_electron.launch(options);`,
    );
    expect(scan.launches).toBe(2);
    expect(scan.problems.map((problem) => problem.line)).toEqual([1, 1, 2]);
  });
});
