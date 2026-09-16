import { builtinModules } from 'node:module';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Runtime boundary (ADR 0010).
 *
 * The same core has to run on the desktop app, the CLI and, later, a cloud worker.
 * That only holds if the pure packages never reach for a runtime-specific API, so the
 * boundary is enforced by tooling rather than by discipline: here for imports and
 * globals, and in `tsconfig.{pure,node,dom}.json` through `lib` and `types`.
 */
const PURE_PACKAGES = [
  'packages/core',
  'packages/brief-lang',
  'packages/template-lang',
  'packages/export-html',
  'packages/export-svg',
  'packages/templates',
  'packages/plugin-api',
];

const NODE_PACKAGES = [
  'packages/raster',
  'packages/pipeline',
  'packages/io',
  // Adapter, not data (ADR 0021): it answers `FontSource` and the exporters' `font` port,
  // and reading bytes off a disk is what answering those means.
  'packages/fonts',
  'apps/cli',
  // Main and preload only. The renderer is a browser and is listed under DOM_PACKAGES
  // below — `apps/desktop` is the one workspace that is two runtimes, and writing it out
  // twice is what makes ADR 0001's `nodeIntegration: false` a rule rather than a habit.
  'apps/desktop/src/main',
  'apps/desktop/src/preload',
  'tools',
];

const DOM_PACKAGES = ['packages/editor', 'apps/desktop/src/renderer'];

/**
 * Code both halves of the desktop app import, and therefore neither may make Node- or
 * DOM-shaped. `shared/ipc.ts` and `shared/i18n/` are the whole of it: a contract and a
 * string table, which is what two runtimes can agree about without either one winning.
 *
 * Checked as `pure` for that reason — the same category `packages/core` is in, and for the
 * same argument. A `process.platform` that crept in here would typecheck under main's
 * config and fail in the renderer, which is the one failure mode a shared folder invites.
 */
const SHARED_PACKAGES = ['apps/desktop/shared'];

/**
 * ADR 0010 also says no package may import another package's adapter — composition belongs
 * to apps/*. E7.1 made the first half of that enforceable: the two exporters reach a job
 * through the `exporter` extension point now, so `pipeline` naming either of them is a
 * regression a rule can catch.
 *
 * It is deliberately one rule about one pair rather than a blanket ban on the four package
 * names. A *port's* types are exactly what a package is supposed to import — `io` names
 * `HtmlResources` to describe the bytes it reads off a disk, and `pipeline` names
 * `type Rasterizer` because that is the port it takes injected. A `grep` for package names
 * would flag all of those; what is actually forbidden is depending on the implementation,
 * and for the exporters the implementation is the only thing those modules export.
 */
const NO_EXPORTERS_IN_PIPELINE =
  'A job reaches an exporter through the `exporter` extension point (ADR 0007): ' +
  'ports.exporters.forKind(kind). Importing @tyto/export-html or @tyto/export-svg here ' +
  'makes two of the nine extension points built in rather than contributed, and leaves a ' +
  'third-party exporter with nothing to plug into.';

const sourcesIn = (packages) => packages.map((directory) => `${directory}/**/*.ts`);

/** Bare specifiers (`fs`) and prefixed ones (`node:fs`) both have to be caught. */
const nodeBuiltinPatterns = [
  'node:*',
  ...builtinModules.filter((name) => !name.startsWith('_')),
  ...builtinModules.filter((name) => !name.startsWith('_')).map((name) => `${name}/*`),
];

/**
 * `syntaxTree` is not the tree; it is whatever the last parse happened to finish.
 *
 * CodeMirror parses `Math.min(3000, doc.length)` characters up front with a 20 ms budget and
 * truncates on expiry, so a reader that asks for the tree and resolves a position past that
 * point gets the top node and answers nothing. It is silent, it is deterministic on any long
 * document, and the 20 ms being wall clock makes it intermittent on short ones — which is how
 * it was found, as a test that failed 2 runs in 9 (TYTO-114).
 *
 * `treeAt(state, upto)` is the same call with the position it needs to reach.
 */
const ONE_READER_OF_THE_SYNTAX_TREE =
  'Use `treeAt(state, upto)` from ./syntax.js rather than `syntaxTree`. `syntaxTree` returns ' +
  'the tree the last parse left behind, which stops at 3000 characters on a fresh state, so ' +
  'resolving a position past that answers with the top node and the reader silently returns ' +
  'nothing (TYTO-114). `syntax.ts` is the one module allowed to call it.';

const NO_NODE_IN_PURE =
  'Pure packages (ADR 0010) must not import Node built-ins — they have to run unchanged in the ' +
  'browser and in a cloud worker. Declare a port in @tyto/core and put the Node code in an ' +
  'adapter package (raster, io, pipeline); apps/* wire the two together.';

const NO_NODE_IN_DOM =
  'DOM packages must not import Node built-ins — the Electron renderer runs with ' +
  'nodeIntegration: false. Go through the typed preload bridge instead.';

const NO_DOM_IN_PURE =
  'Pure packages (ADR 0010) must not touch DOM globals — they have to run unchanged in Node and ' +
  'in a cloud worker. Exporters produce strings; they never render.';

const NO_DOM_IN_NODE = 'Node packages must not touch DOM globals; use a Rasterizer adapter.';

const NO_NODE_GLOBALS_IN_PURE =
  'Pure packages (ADR 0010) must not touch Node globals. Take the value as an argument or through ' +
  'a port from @tyto/core.';

/**
 * `paths` is for a named export a package may not import, beside the built-ins it may not.
 *
 * **Both halves have to be passed together**, which is the trap this signature exists to
 * make hard to fall into: flat config *replaces* a rule's options rather than merging them,
 * so a later block that sets `no-restricted-imports` for a narrower `files` glob silently
 * turns off whatever an earlier block configured for the same rule. Adding the syntax-tree
 * rule below without re-stating the Node message took the runtime boundary off
 * `packages/editor/src` — caught by `runtime-boundary.test.ts`, which lints a throwaway
 * `node:fs` import against the real config and expects it to be refused.
 */
const restrictedImports = (message, paths = []) => ({
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      patterns: [{ group: nodeBuiltinPatterns, message, allowTypeImports: false }],
      ...(paths.length === 0 ? {} : { paths }),
    },
  ],
});

/** `no-restricted-globals` takes one flat list, so groups with different messages are merged. */
const restrictedGlobals = (...groups) => ({
  'no-restricted-globals': [
    'error',
    ...groups.flatMap(([names, message]) => names.map((name) => ({ name, message }))),
  ],
});

const DOM_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'fetch'];
const NODE_GLOBALS = ['process', 'require', 'global', '__dirname', '__filename', 'Buffer'];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      // electron-vite's build output. `dist/` is tsup's name for the same thing; the
      // desktop app uses the name electron-vite and electron-builder expect.
      '**/out/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      // tsup writes a bundled copy of its config into the package while it builds and
      // deletes it on the way out. Turbo runs lint and build in parallel, so ESLint can
      // list the file and then fail to open it — a race that only shows up in CI, where
      // build is part of the same run.
      '**/tsup.config.bundled_*.mjs',
      // Generated by lezer-generator from src/*.grammar. Build output that happens to
      // land in src/, because that is where the grammar's importers expect it.
      '**/*.parser.js',
      '**/*.parser.terms.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  {
    name: 'boundary/pure',
    files: sourcesIn([...PURE_PACKAGES, ...SHARED_PACKAGES]),
    languageOptions: { globals: {} },
    rules: {
      ...restrictedImports(NO_NODE_IN_PURE),
      ...restrictedGlobals([DOM_GLOBALS, NO_DOM_IN_PURE], [NODE_GLOBALS, NO_NODE_GLOBALS_IN_PURE]),
    },
  },

  {
    name: 'boundary/node',
    files: sourcesIn(NODE_PACKAGES),
    languageOptions: { globals: globals.node },
    rules: restrictedGlobals([DOM_GLOBALS, NO_DOM_IN_NODE]),
  },

  {
    name: 'boundary/dom',
    files: sourcesIn(DOM_PACKAGES),
    languageOptions: { globals: globals.browser },
    rules: {
      ...restrictedImports(NO_NODE_IN_DOM),
      ...restrictedGlobals([NODE_GLOBALS, NO_NODE_IN_DOM]),
    },
  },

  {
    /**
     * The desktop app's end-to-end suite, which is the one place both runtimes are
     * legitimate at once.
     *
     * It is Node code — it spawns a process and reads `process.platform` — that also
     * *contains* browser code, because every `page.evaluate` callback is serialised, sent
     * across, and run inside the window. Linting it as Node would forbid the `document` it
     * is there to inspect, and linting it as DOM would forbid the launch. So it is linted
     * as both, scoped to `e2e/` and to nothing else, and `tsconfig.e2e.json` makes the same
     * call about libraries for the same reason.
     */
    name: 'boundary/desktop-e2e',
    files: ['apps/desktop/e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-restricted-globals': 'off' },
  },

  {
    name: 'boundary/pipeline-has-no-exporters',
    // Tests are exempt: `job.test.ts` activates the real built-ins through the real host,
    // which is the only way to assert that a job renders through whatever was registered.
    files: ['packages/pipeline/src/**/*.ts'],
    ignores: ['packages/pipeline/src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tyto/export-html', '@tyto/export-svg'],
              message: NO_EXPORTERS_IN_PIPELINE,
              allowTypeImports: false,
            },
          ],
        },
      ],
    },
  },

  {
    name: 'editor/one-reader-of-the-syntax-tree',
    // Tests are exempt so a case can still reach for the truncated tree deliberately — that
    // is how the defect was measured, and a test that cannot reproduce it cannot pin it.
    files: ['packages/editor/src/**/*.ts'],
    ignores: ['packages/editor/src/syntax.ts', 'packages/editor/src/**/*.test.ts'],
    // `NO_NODE_IN_DOM` is repeated rather than inherited: this block sets the same rule as
    // `boundary/dom` for a subset of its files, and flat config replaces rather than merges.
    rules: restrictedImports(NO_NODE_IN_DOM, [
      {
        name: '@codemirror/language',
        importNames: ['syntaxTree'],
        message: ONE_READER_OF_THE_SYNTAX_TREE,
        allowTypeImports: false,
      },
    ]),
  },

  {
    name: 'repo/config-files',
    // `tools/**/*.mjs` is here for the git hooks, which have to run with no build step
    // and therefore stay JavaScript.
    files: ['*.js', 'tools/**/*.ts', 'tools/**/*.mjs', '**/*.config.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  prettier,
);
