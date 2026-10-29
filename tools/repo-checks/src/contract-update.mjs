#!/usr/bin/env node
/**
 * Moves a plugin's or a template's repository onto the newest published Tyto contract
 * (ADR 0154, TYTO-460). `.github/workflows/contract-update.yml` runs it inside the caller's
 * checkout, then runs the caller's own checks against what it wrote, and only opens a pull
 * request when they pass.
 *
 * **The ranges to move are the caller's, not a list kept here.** Every dependency whose spec
 * is an alias onto `PUBLISHED_PREFIX` is moved, in the section it already sits in: a template
 * asks for four packages, the Jira plugin for one, a workspace for `core` and `recipe`. Each is
 * re-added at `@latest` with pnpm, so the range written and the lockfile are pnpm's own — the
 * same tree the checks then run on is the tree the pull request carries.
 *
 * **The manifest's `engine` follows `@tyto/plugin-api`** (ADR 0149, decision 5), keeping the
 * operator and the precision it was written with: `>=0.7` becomes `>=0.8`, `^0.7.0` becomes
 * `^0.8.0`. An engine written as anything more than one comparator is left alone and named,
 * because guessing which half to move is how a manifest ends up accepting nothing.
 *
 * Plain JavaScript and pnpm alone, like `publish-contract.mjs`: the workflow fetches these two
 * files from Tyto and nothing else, so no workspace package may be imported.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PUBLISHED_PREFIX } from './publish-contract.mjs';

/** The sections pnpm can add to, and the flag that keeps a package in its own. */
const SECTION_FLAGS = /** @type {const} */ ({
  dependencies: '--save-prod',
  devDependencies: '--save-dev',
  optionalDependencies: '--save-optional',
});

export const PLUGIN_API = '@tyto/plugin-api';

export const MANIFEST_FILE = 'tyto-plugin.json';

/**
 * @typedef {{ section: keyof typeof SECTION_FLAGS, alias: string, published: string, range: string }} ContractDependency
 * @typedef {{ alias: string, from: string, to: string }} Move
 */

/**
 * Every dependency in `manifest` that is an alias onto the published contract, in the order
 * the sections and the keys are written.
 *
 * @param {Record<string, unknown>} manifest
 * @param {string} [prefix]
 * @returns {ContractDependency[]}
 */
export function contractDependencies(manifest, prefix = PUBLISHED_PREFIX) {
  const marker = `npm:${prefix}`;
  return Object.keys(SECTION_FLAGS).flatMap((section) =>
    Object.entries(/** @type {Record<string, string>} */ (manifest[section] ?? {}))
      .filter(([, spec]) => spec.startsWith(marker))
      .map(([alias, spec]) => {
        const at = spec.lastIndexOf('@');
        return {
          section: /** @type {keyof typeof SECTION_FLAGS} */ (section),
          alias,
          published: spec.slice('npm:'.length, at),
          range: spec.slice(at + 1),
        };
      }),
  );
}

/**
 * The `pnpm add` argument lists that re-add each dependency at `@latest`, one per section so
 * none of them moves to another.
 *
 * @param {ContractDependency[]} dependencies
 * @returns {string[][]}
 */
export function addCommands(dependencies) {
  return Object.entries(SECTION_FLAGS).flatMap(([section, flag]) => {
    const specs = dependencies
      .filter((dependency) => dependency.section === section)
      .map(({ alias, published }) => `${alias}@npm:${published}@latest`);
    return specs.length === 0 ? [] : [['add', flag, ...specs]];
  });
}

/**
 * What changed between the dependencies before and after the add, by alias.
 *
 * @param {ContractDependency[]} before
 * @param {ContractDependency[]} after
 * @returns {Move[]}
 */
export function movesBetween(before, after) {
  return before.flatMap(({ alias, range }) => {
    const now = after.find((dependency) => dependency.alias === alias);
    return now === undefined || now.range === range ? [] : [{ alias, from: range, to: now.range }];
  });
}

/** The version a caret, tilde or exact range starts at: `^0.8.0` → `0.8.0`. */
const floorOf = (/** @type {string} */ range) => range.replace(/^[\^~=v\s]+/u, '');

/**
 * `manifestText` with its `engine` moved to `version`, at the precision and with the operator
 * it already has, or the reason it was left alone. Text in, text out: the file is rewritten in
 * place rather than re-serialised, so a formatter that agreed with it before still agrees.
 *
 * @param {string} manifestText
 * @param {string} version
 * @returns {{ text: string, from?: string, to?: string, skipped?: string }}
 */
export function moveEngine(manifestText, version) {
  const field = /("engine"\s*:\s*")([^"]*)(")/u.exec(manifestText);
  if (field === null) return { text: manifestText, skipped: 'the manifest declares no engine' };
  const engine = field[2] ?? '';
  const comparator = /^(\s*(?:\^|~|>=|>|=)?\s*)(\d+(?:\.\d+){0,2})(\s*)$/u.exec(engine);
  if (comparator === null)
    return {
      text: manifestText,
      skipped: `engine '${engine}' is more than one comparator; move it by hand`,
    };
  const [, operator = '', written = '', trailing = ''] = comparator;
  const precision = written.split('.').length;
  const moved = `${operator}${version.split('.').slice(0, precision).join('.')}${trailing}`;
  if (moved === engine) return { text: manifestText };
  const start = field.index + (field[1] ?? '').length;
  return {
    text: manifestText.slice(0, start) + moved + manifestText.slice(start + engine.length),
    from: engine,
    to: moved,
  };
}

/**
 * The pull request's title. It names the version of every contract package the branch asks
 * for, moved or not, and nothing that varies between runs, so two runs against the same
 * contract write the same title — which is what the workflow compares to leave an open pull
 * request alone.
 *
 * @param {ContractDependency[]} dependencies
 */
export function pullRequestTitle(dependencies) {
  const versions = [...dependencies]
    .sort((left, right) => left.alias.localeCompare(right.alias))
    .map(({ alias, range }) => `${alias.replace(/^@tyto\//u, '')} ${floorOf(range)}`);
  return `chore(deps): TYTO-0 move onto the Tyto contract (${versions.join(', ')})`;
}

/**
 * @param {Move[]} moves
 * @param {{ from?: string, to?: string, skipped?: string }} engine
 * @param {string} runUrl
 */
export function pullRequestBody(moves, engine, runUrl) {
  const rows = moves.map(({ alias, from, to }) => `| \`${alias}\` | \`${from}\` | \`${to}\` |`);
  const engineLine =
    engine.to !== undefined
      ? `The manifest's \`engine\` moved from \`${engine.from}\` to \`${engine.to}\`.`
      : engine.skipped !== undefined
        ? `**The manifest's \`engine\` was not moved:** ${engine.skipped}.`
        : `The manifest's \`engine\` already names this \`${PLUGIN_API}\`.`;
  return [
    "Opened by `contract-update` (Tyto ADR 0154) after this repository's checks passed against the newest published Tyto contract.",
    '',
    '| Package | Was | Now |',
    '| --- | --- | --- |',
    ...rows,
    '',
    engineLine,
    '',
    `The checks that passed before this pull request opened: ${runUrl}`,
    '',
    "The lockfile is pnpm's own, from re-adding each package at `@latest`. A newer contract replaces this branch and this description; a person merges it.",
    '',
  ].join('\n');
}

/**
 * @param {string} key
 * @param {string} value
 */
function writeOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file === undefined) {
    console.log(`${key}=${value}`);
    return;
  }
  const delimiter = `EOF_${Math.random().toString(36).slice(2)}`;
  appendFileSync(file, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
}

/** @param {string[]} argv */
function main(argv) {
  const directory = argv[0] ?? process.cwd();
  const prefix = argv[1] ?? PUBLISHED_PREFIX;
  const manifestPath = join(directory, 'package.json');
  const readManifest = () => JSON.parse(readFileSync(manifestPath, 'utf8'));

  const before = contractDependencies(readManifest(), prefix);
  if (before.length === 0) {
    console.error(`package.json asks for no package published under ${prefix}`);
    process.exit(1);
  }
  for (const args of addCommands(before)) {
    console.log(`pnpm ${args.join(' ')}`);
    execFileSync('pnpm', args, {
      cwd: directory,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }
  const after = contractDependencies(readManifest(), prefix);
  const moves = movesBetween(before, after);

  /** @type {{ from?: string, to?: string, skipped?: string }} */
  let engine = { skipped: `this repository has no ${MANIFEST_FILE}` };
  const pluginManifest = join(directory, MANIFEST_FILE);
  const pluginApi = after.find((dependency) => dependency.alias === PLUGIN_API);
  if (existsSync(pluginManifest) && pluginApi !== undefined) {
    const result = moveEngine(readFileSync(pluginManifest, 'utf8'), floorOf(pluginApi.range));
    if (result.to !== undefined) writeFileSync(pluginManifest, result.text);
    engine = result;
  } else if (pluginApi === undefined) {
    engine = { skipped: `this repository does not ask for ${PLUGIN_API}` };
  }

  for (const { alias, from, to } of moves) console.log(`${alias}: ${from} → ${to}`);
  console.log(
    engine.to !== undefined
      ? `engine: ${engine.from} → ${engine.to}`
      : `engine: ${engine.skipped ?? 'unchanged'}`,
  );

  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  // The engine alone can be behind too — a range moved by hand without it — and that is a
  // pull request as much as a range is.
  writeOutput('moved', moves.length > 0 || engine.to !== undefined ? 'true' : 'false');
  writeOutput('title', pullRequestTitle(after));
  writeOutput('body', pullRequestBody(moves, engine, runUrl));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2));
