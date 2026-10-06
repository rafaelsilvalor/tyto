import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { MINIMUM_LAUNCH_HOOK_TIMEOUT_MS } from './first-window.js';

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

/**
 * The same file holds a second rule about launching: no suite waits for the first window on
 * its own (TYTO-231). Every suite left `firstWindow()` at Playwright's 30 s default, and under
 * load a start took longer while the hook still had 270 s of budget. The deadline now lives in
 * one place, `first-window.ts`, and a suite that calls `.firstWindow(` directly fails here.
 * The helper is not a `*.test.ts`, so its own direct call is never scanned — on purpose.
 *
 * A third rule keeps that deadline inside its hook: a `beforeAll` or `beforeEach` that calls
 * `firstWindow(` may not give itself less than `MINIMUM_LAUNCH_HOOK_TIMEOUT_MS`, or a slow start
 * ends in an anonymous hook timeout instead of a named wait (`first-window.ts` says why 180 s).
 * It sees only a call written in the hook itself: a hook that launches through a local helper
 * (`dock`, `quit`, `directives`) is not checked, and neither is a test that launches.
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

const HOW_TO_WAIT =
  `import { firstWindow } from './first-window.js' and await firstWindow(app), ` +
  `so the wait uses the one deadline every suite shares`;

/** Every `<anything>.firstWindow(…)` call, by line: each one bypasses the shared deadline. */
function scanDirectWindowWaits(fileName: string, source: string): number[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'firstWindow'
    ) {
      lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

const SETUP_HOOKS = new Set(['beforeAll', 'beforeEach']);

function callsFirstWindow(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ((ts.isIdentifier(node.expression) && node.expression.text === 'firstWindow') ||
      (ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'firstWindow'))
  ) {
    return true;
  }
  return ts.forEachChild(node, callsFirstWindow) ?? false;
}

/** Every setup hook that waits for the first window on a budget below the minimum, by line. */
function scanShortLaunchHooks(fileName: string, source: string): LaunchProblem[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const problems: LaunchProblem[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      SETUP_HOOKS.has(node.expression.text)
    ) {
      const [body, timeout] = node.arguments;
      if (body !== undefined && timeout !== undefined && callsFirstWindow(body)) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        if (!ts.isNumericLiteral(timeout)) {
          problems.push({ line, reason: 'its timeout is not a number this check can read' });
        } else if (Number(timeout.text) < MINIMUM_LAUNCH_HOOK_TIMEOUT_MS) {
          problems.push({ line, reason: `it gives itself ${timeout.getText(file)} ms` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
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

describe('every end-to-end suite waits for the first window through first-window.ts', () => {
  it('finds no direct .firstWindow( call in a suite', () => {
    const messages = suiteFiles().flatMap((name) =>
      scanDirectWindowWaits(name, readFileSync(join(here, name), 'utf8')).map(
        (line) => `e2e/${name}:${line}: waits for the first window itself — ${HOW_TO_WAIT}`,
      ),
    );
    expect(messages).toEqual([]);
  });

  // The helper's own direct call is the one that is allowed, and it is allowed by not being a
  // suite. If it ever became one, the rule above would report the helper instead of the suites.
  it('leaves the helper outside the files it scans', () => {
    expect(suiteFiles()).not.toContain('first-window.ts');
  });
});

describe('every hook that waits for the first window has room for it', () => {
  it(`finds no setup hook calling firstWindow( with less than ${MINIMUM_LAUNCH_HOOK_TIMEOUT_MS} ms`, () => {
    const messages = suiteFiles().flatMap((name) =>
      scanShortLaunchHooks(name, readFileSync(join(here, name), 'utf8')).map(
        (problem) =>
          `e2e/${name}:${problem.line}: waits for the first window but ${problem.reason} — ` +
          `drop the timeout to use the config's hookTimeout, or pass at least ` +
          `${MINIMUM_LAUNCH_HOOK_TIMEOUT_MS}, so a slow start fails on a named wait`,
      ),
    );
    expect(messages).toEqual([]);
  });
});

describe('scanShortLaunchHooks', () => {
  it('reports a short hook that waits for the window, and one it cannot read', () => {
    const scan = scanShortLaunchHooks(
      'a.ts',
      [
        'beforeAll(async () => { page = await firstWindow(app); }, 120_000);',
        'beforeEach(async () => { page = await firstWindow(app); }, budget);',
      ].join('\n'),
    );
    expect(scan).toEqual([
      { line: 1, reason: 'it gives itself 120_000 ms' },
      { line: 2, reason: 'its timeout is not a number this check can read' },
    ]);
  });

  it('accepts the default, a long enough budget, and a short hook that does not launch', () => {
    const scan = scanShortLaunchHooks(
      'a.ts',
      [
        'beforeAll(async () => { page = await firstWindow(app); });',
        'beforeAll(async () => { page = await firstWindow(app); }, 180_000);',
        'beforeAll(async () => { await page.click("#x"); }, 60_000);',
        'afterAll(async () => { await firstWindow(app); }, 1);',
      ].join('\n'),
    );
    expect(scan).toEqual([]);
  });
});

describe('scanDirectWindowWaits', () => {
  it('reports a direct call on any receiver, with or without options', () => {
    expect(
      scanDirectWindowWaits(
        'a.ts',
        `const page = await app.firstWindow();\nconst again = await second.firstWindow({ timeout: 1 });`,
      ),
    ).toEqual([1, 2]);
  });

  it('accepts the helper, and a mention in a comment', () => {
    expect(
      scanDirectWindowWaits(
        'a.ts',
        `// not app.firstWindow() here\nconst page = await firstWindow(app);`,
      ),
    ).toEqual([]);
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
