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
  'apps/cli',
  'apps/desktop',
  'tools/repo-checks',
];

const DOM_PACKAGES = ['packages/editor'];

/**
 * Not yet enforced: ADR 0010 also says no package may import another package's adapter —
 * composition belongs to apps/*. That rule cannot be written against empty packages,
 * because nothing yet distinguishes a port from the adapter that implements it. It lands
 * with E7.1, when PluginHost makes the adapter graph real.
 */

const sourcesIn = (packages) => packages.map((directory) => `${directory}/**/*.ts`);

/** Bare specifiers (`fs`) and prefixed ones (`node:fs`) both have to be caught. */
const nodeBuiltinPatterns = [
  'node:*',
  ...builtinModules.filter((name) => !name.startsWith('_')),
  ...builtinModules.filter((name) => !name.startsWith('_')).map((name) => `${name}/*`),
];

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

const restrictedImports = (message) => ({
  '@typescript-eslint/no-restricted-imports': [
    'error',
    { patterns: [{ group: nodeBuiltinPatterns, message, allowTypeImports: false }] },
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
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
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
    files: sourcesIn(PURE_PACKAGES),
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
    name: 'repo/config-files',
    files: ['*.js', 'tools/**/*.ts', '**/*.config.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  prettier,
);
