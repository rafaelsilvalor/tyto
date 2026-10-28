#!/usr/bin/env node
/**
 * Publishes the plugin contract to GitHub Packages (ADR 0149, TYTO-444).
 *
 * A plugin or a template in its own repository depends on `@tyto/plugin-api` and
 * `@tyto/template-kit`. Those two are the contract; `@tyto/core`, `@tyto/recipe`,
 * `@tyto/brief-lang` and `@tyto/export-html` are what they import (the last two for
 * `@tyto/template-kit/testing`, ADR 0152), so they are published beside them rather than bundled into them — a bundled
 * core would be two copies of `Scene` the day a template installs both packages.
 *
 * **The workspace keeps `@tyto/*`; what is published is renamed.** GitHub Packages scopes a
 * package by the account that owns it, and neither the GitHub organisation `Tyto` nor the npm
 * organisation `tyto` is this repository's. So each package goes out as
 * `PUBLISHED_PREFIX + <name>` and every `@tyto/x` it depends on becomes an npm alias,
 * `"@tyto/x": "npm:<published x>@<version>"`. A consumer writes the same alias for the
 * package it asks for and goes on importing `@tyto/plugin-api`: the folder in
 * `node_modules` is named after the alias, not after the published name.
 *
 * **Changesets versions and tags these packages and never publishes them.** `changeset
 * publish` publishes every package that is not private, which is sixteen here; the list
 * below is the ones that are meant to leave the repository. A version already on the
 * registry is skipped, so a release that bumped none of them publishes nothing.
 *
 * Plain JavaScript and the package managers alone, like `changeset-coverage.mjs`. It packs
 * with pnpm, which turns `workspace:*` into the version it points at, and publishes with npm,
 * which is what GitHub's registry documents. `--dry-run` does everything but the upload and
 * needs no token; `ci.yml` runs it on every pull request.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The scope and name prefix every contract package is published under — the one place it is
 * written. An owner that moves, or a dedicated GitHub organisation, is this line and a line in
 * ADR 0149; the workspace names do not change.
 */
export const PUBLISHED_PREFIX = '@rafaelsilvalor/tyto-';

export const REGISTRY = 'https://npm.pkg.github.com';

/**
 * The packages that are published, dependencies first so a real run never uploads a package
 * whose dependency is not there yet. `publish-contract.test.mjs` fails if one of them depends
 * on a workspace package outside this list, which is what would make it uninstallable.
 *
 * TYTO-431's `_casa` package joins this list when it exists (ADR 0149).
 */
export const CONTRACT_PACKAGES = [
  { name: '@tyto/core', directory: 'packages/core' },
  { name: '@tyto/recipe', directory: 'packages/recipe' },
  { name: '@tyto/plugin-api', directory: 'packages/plugin-api' },
  { name: '@tyto/brief-lang', directory: 'packages/brief-lang' },
  { name: '@tyto/export-html', directory: 'packages/export-html' },
  { name: '@tyto/template-kit', directory: 'packages/template-kit' },
];

const REPOSITORY = 'https://github.com/rafaelsilvalor/tyto';

const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

/** @param {string} name a workspace name, `@tyto/<x>` */
export function publishedName(name) {
  if (!name.startsWith('@tyto/')) throw new Error(`not a workspace package: ${name}`);
  return `${PUBLISHED_PREFIX}${name.slice('@tyto/'.length)}`;
}

/**
 * The manifest that is uploaded, from the one `pnpm pack` wrote. Pure, so the test reads
 * exactly what a release would publish.
 *
 * Scripts are dropped: they are the workspace's build, and npm would run a lifecycle script in
 * the staged folder. `devDependencies` go too — nothing installs them from a registry.
 *
 * @param {Record<string, any>} packed
 * @returns {Record<string, any>}
 */
export function stagedManifest(packed) {
  const contract = new Set(CONTRACT_PACKAGES.map(({ name }) => name));
  /** @type {Record<string, any>} */
  const staged = { ...packed, name: publishedName(packed.name) };
  delete staged.scripts;
  delete staged.devDependencies;

  for (const field of DEPENDENCY_FIELDS) {
    const ranges = packed[field];
    if (ranges === undefined) continue;
    staged[field] = Object.fromEntries(
      Object.entries(ranges).map(([dependency, range]) => {
        if (!dependency.startsWith('@tyto/')) return [dependency, range];
        if (!contract.has(dependency)) {
          throw new Error(
            `${packed.name} depends on ${dependency}, which is not published (CONTRACT_PACKAGES)`,
          );
        }
        if (String(range).startsWith('workspace:')) {
          throw new Error(`${packed.name}: ${dependency} is still ${range}; pack with pnpm`);
        }
        return [dependency, `npm:${publishedName(dependency)}@${range}`];
      }),
    );
  }

  staged.repository = { type: 'git', url: `git+${REPOSITORY}.git` };
  staged.publishConfig = { registry: REGISTRY };
  return staged;
}

/** @param {string} command @param {string[]} args @param {import('node:child_process').ExecFileSyncOptions} options */
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    // `pnpm` and `npm` are `.cmd` shims on Windows, which only a shell resolves.
    shell: process.platform === 'win32',
    ...options,
  });

/**
 * Whether the registry already holds this version. Without a token GitHub answers 401 for
 * every name, so a dry run cannot ask and treats the answer as "no".
 *
 * @param {string} name @param {string} version @param {string} folder @param {boolean} dryRun
 */
function alreadyPublished(name, version, folder, dryRun) {
  try {
    const found = run('npm', ['view', `${name}@${version}`, 'version', '--registry', REGISTRY], {
      cwd: folder,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return found.trim() === version;
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (/E404|404 Not Found/u.test(output)) return false;
    if (dryRun) return false;
    throw new Error(`could not ask the registry about ${name}@${version}:\n${output}`, {
      cause: error,
    });
  }
}

/** @param {string[]} argv */
function main(argv) {
  const dryRun = argv.includes('--dry-run');
  // `--stage-into <folder>` writes the renamed tarballs there and uploads nothing: what a
  // consumer installs, for trying an install outside the workspace with no registry.
  const stageIndex = argv.indexOf('--stage-into');
  const stageInto = stageIndex === -1 ? undefined : argv[stageIndex + 1];
  if (stageInto !== undefined) mkdirSync(stageInto, { recursive: true });
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const scratch = mkdtempSync(join(tmpdir(), 'tyto-contract-'));
  const started = Date.now();
  let uploaded = 0;

  try {
    for (const { name, directory } of CONTRACT_PACKAGES) {
      const tarballs = join(scratch, 'tarballs', name.replace('/', '-'));
      mkdirSync(tarballs, { recursive: true });
      run('pnpm', ['pack', '--pack-destination', tarballs], { cwd: join(repoRoot, directory) });
      const [tarball] = readdirSync(tarballs).filter((file) => file.endsWith('.tgz'));
      if (tarball === undefined) throw new Error(`pnpm pack wrote no tarball for ${name}`);

      const unpacked = join(scratch, 'staged', name.replace('/', '-'));
      mkdirSync(unpacked, { recursive: true });
      // Relative paths from the tarball's own folder: GNU tar reads `C:\...` as a remote
      // host, `host:file`, and refuses it.
      run('tar', ['-xzf', tarball, '-C', relative(tarballs, unpacked)], { cwd: tarballs });
      const folder = join(unpacked, 'package');
      const manifestPath = join(folder, 'package.json');
      const staged = stagedManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
      writeFileSync(manifestPath, `${JSON.stringify(staged, null, 2)}\n`);
      // The token is read from the environment by npm; this file names the variable, never
      // its value, and lives only in the scratch folder.
      writeFileSync(
        join(folder, '.npmrc'),
        `${PUBLISHED_PREFIX.split('/')[0]}:registry=${REGISTRY}\n` +
          `//npm.pkg.github.com/:_authToken=\${NODE_AUTH_TOKEN}\n`,
      );

      const label = `${name} → ${staged.name}@${staged.version}`;
      if (stageInto !== undefined) {
        run('npm', ['pack', '--ignore-scripts', '--pack-destination', stageInto], { cwd: folder });
        uploaded += 1;
        console.log(`  staged    ${label}`);
        continue;
      }
      if (alreadyPublished(staged.name, staged.version, folder, dryRun)) {
        console.log(`  skipped   ${label} — already on the registry`);
        continue;
      }
      run(
        'npm',
        ['publish', '--ignore-scripts', '--registry', REGISTRY, ...(dryRun ? ['--dry-run'] : [])],
        { cwd: folder, env: { NODE_AUTH_TOKEN: '', ...process.env } },
      );
      uploaded += 1;
      console.log(`  ${dryRun ? 'dry run  ' : 'published'} ${label}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const outcome =
    stageInto !== undefined
      ? `staged into ${stageInto}`
      : `${dryRun ? 'would be published' : 'published'} to ${REGISTRY}`;
  console.log(
    `${uploaded} of ${CONTRACT_PACKAGES.length} contract packages ${outcome} in ${seconds}s`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2));
