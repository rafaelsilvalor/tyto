import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  addCommands,
  contractDependencies,
  moveEngine,
  movesBetween,
  pullRequestBody,
  pullRequestTitle,
} from './contract-update.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** The tabela's devDependencies as TYTO-458 left them, plus one that is not the contract. */
const TABELA = {
  devDependencies: {
    '@tyto/core': 'npm:@rafaelsilvalor/tyto-core@^0.30.0',
    '@tyto/house-style': 'npm:@rafaelsilvalor/tyto-house-style@^0.2.0',
    '@tyto/plugin-api': 'npm:@rafaelsilvalor/tyto-plugin-api@^0.7.0',
    '@tyto/template-kit': 'npm:@rafaelsilvalor/tyto-template-kit@^0.4.0',
    vitest: '^5.0.1',
  },
};

describe('the contract a repository asks for', () => {
  it('is every alias onto the published prefix, and nothing else', () => {
    expect(contractDependencies(TABELA).map(({ alias, range }) => `${alias} ${range}`)).toEqual([
      '@tyto/core ^0.30.0',
      '@tyto/house-style ^0.2.0',
      '@tyto/plugin-api ^0.7.0',
      '@tyto/template-kit ^0.4.0',
    ]);
  });

  it('keeps each package in the section it was written in', () => {
    const manifest = {
      dependencies: { '@tyto/recipe': 'npm:@rafaelsilvalor/tyto-recipe@^0.1.0' },
      devDependencies: { '@tyto/core': 'npm:@rafaelsilvalor/tyto-core@^0.29.0' },
    };
    expect(addCommands(contractDependencies(manifest))).toEqual([
      ['add', '--save-prod', '@tyto/recipe@npm:@rafaelsilvalor/tyto-recipe@latest'],
      ['add', '--save-dev', '@tyto/core@npm:@rafaelsilvalor/tyto-core@latest'],
    ]);
  });

  it('ignores a plain @tyto/* range, which asks npmjs.com and is not the published contract', () => {
    expect(contractDependencies({ devDependencies: { '@tyto/core': '^0.30.0' } })).toEqual([]);
  });
});

describe('what moved', () => {
  it('is each alias whose range changed, from and to', () => {
    const before = contractDependencies(TABELA);
    const after = contractDependencies({
      devDependencies: {
        ...TABELA.devDependencies,
        '@tyto/plugin-api': 'npm:@rafaelsilvalor/tyto-plugin-api@^0.8.0',
      },
    });
    expect(movesBetween(before, after)).toEqual([
      { alias: '@tyto/plugin-api', from: '^0.7.0', to: '^0.8.0' },
    ]);
  });
});

describe("the manifest's engine", () => {
  const manifest = (engine) =>
    `{\n  "name": "tabela",\n  "engine": "${engine}",\n  "contributes": ["template-pack"]\n}\n`;

  it.each([
    ['>=0.7', '0.8.0', '>=0.8'],
    ['^0.7.0', '0.8.0', '^0.8.0'],
    ['>=0.4', '0.7.0', '>=0.7'],
    ['0.7', '0.8.1', '0.8'],
  ])('moves %s to %s at the precision and operator it was written with', (from, version, to) => {
    const moved = moveEngine(manifest(from), version);
    expect(moved).toMatchObject({ from, to });
    // Only the value changes, so the line `"contributes": [...]` stays as the formatter left it.
    expect(moved.text).toBe(manifest(to));
  });

  it('is left alone when it already names the version', () => {
    expect(moveEngine(manifest('>=0.7'), '0.7.3')).toEqual({ text: manifest('>=0.7') });
  });

  it('is left alone, and says so, when it is more than one comparator', () => {
    const moved = moveEngine(manifest('>=0.5 <0.8'), '0.8.0');
    expect(moved.text).toBe(manifest('>=0.5 <0.8'));
    expect(moved.skipped).toMatch(/more than one comparator/);
  });

  it('says so when there is none', () => {
    expect(moveEngine('{ "name": "x" }', '0.8.0').skipped).toMatch(/no engine/);
  });
});

describe('the pull request', () => {
  it('names every contract version, so two runs on one contract write one title', () => {
    const title = pullRequestTitle(contractDependencies(TABELA));
    expect(title).toBe(
      'chore(deps): TYTO-0 move onto the Tyto contract (core 0.30.0, house-style 0.2.0, plugin-api 0.7.0, template-kit 0.4.0)',
    );
    const shuffled = {
      devDependencies: Object.fromEntries(Object.entries(TABELA.devDependencies).reverse()),
    };
    expect(pullRequestTitle(contractDependencies(shuffled))).toBe(title);
  });

  it('carries the moves, the engine and the run that tested them', () => {
    const body = pullRequestBody(
      [{ alias: '@tyto/plugin-api', from: '^0.7.0', to: '^0.8.0' }],
      { from: '>=0.7', to: '>=0.8' },
      'https://github.com/o/r/actions/runs/1',
    );
    expect(body).toContain('| `@tyto/plugin-api` | `^0.7.0` | `^0.8.0` |');
    expect(body).toContain('from `>=0.7` to `>=0.8`');
    expect(body).toContain('https://github.com/o/r/actions/runs/1');
  });
});

/**
 * The workflow fetches two files of Tyto and nothing else, and a caller depends on its
 * inputs by name. Both drift silently: a new import in the script fails only in the caller's
 * run, and a renamed input is ignored there rather than refused.
 */
describe('contract-update.yml', () => {
  const WORKFLOW = '.github/workflows/contract-update.yml';
  const workflow = parse(readFileSync(join(repoRoot, WORKFLOW), 'utf8'));
  const steps = workflow.jobs['newest-contract'].steps;

  it('is only ever called, never run in this repository', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_call']);
  });

  it('keeps the inputs the callers pass', () => {
    expect(Object.keys(workflow.on.workflow_call.inputs).sort()).toEqual(
      ['checks', 'ci-workflow', 'node-version', 'tyto-ref'].sort(),
    );
  });

  it('fetches every file the script imports from Tyto', () => {
    const sparse = steps
      .find((step) => step.with?.repository === 'rafaelsilvalor/tyto')
      .with['sparse-checkout'].trim()
      .split('\n');
    const script = readFileSync(
      join(repoRoot, 'tools/repo-checks/src/contract-update.mjs'),
      'utf8',
    );
    const relativeImports = [...script.matchAll(/^import .* from '\.\/(.+)';$/gmu)].map(
      ([, file]) => `tools/repo-checks/src/${file}`,
    );
    expect(sparse.sort()).toEqual(
      ['tools/repo-checks/src/contract-update.mjs', ...relativeImports].sort(),
    );
    // And those import only Node: the checkout has no workspace package to resolve.
    for (const file of sparse) {
      const imports = [
        ...readFileSync(join(repoRoot, file), 'utf8').matchAll(
          /^import .* from '([^.][^']*)';$/gmu,
        ),
      ];
      for (const [, specifier] of imports) expect(specifier, file).toMatch(/^node:/u);
    }
  });

  it('starts the pull request checks itself, because its own push starts none', () => {
    const push = steps.find((step) => step.run?.includes('git push') === true);
    expect(push.run).toMatch(/gh workflow run "\$CI_WORKFLOW" --ref "\$BRANCH"/u);
  });

  it('opens nothing when an open pull request has the same title', () => {
    const push = steps.find((step) => step.run?.includes('git push') === true);
    expect(push.if).toContain("steps.open.outputs.same == 'false'");
  });
});
