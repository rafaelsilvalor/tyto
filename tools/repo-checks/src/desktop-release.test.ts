import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * `desktop.yml` and `apps/desktop/electron-builder.yml` are one release between them, and
 * nothing runs either of them until a `desktop-v*` tag is pushed — the workflow does not
 * fire on a pull request, so a mistake here lands green and is found by whoever cuts the
 * release (`docs/git-workflow.md`). These are the couplings that would be silent.
 *
 * What is *not* here: whether an installer actually works. That is
 * `apps/desktop/e2e/packaged.package.test.ts`, which packages the app and launches it, and
 * it is outside `pnpm check` because it costs ~23 s and a ~100 MB download.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const readRepoFile = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

const readYaml = <T>(relativePath: string): T => parse(readRepoFile(relativePath)) as T;

const WORKFLOW = '.github/workflows/desktop.yml';
const BUILDER_CONFIG = 'apps/desktop/electron-builder.yml';

interface Workflow {
  on?: { push?: { tags?: string[] } };
  jobs?: Record<
    string,
    {
      'runs-on'?: string;
      strategy?: { 'fail-fast'?: boolean; matrix?: { os?: string[] } };
      steps?: { name?: string; uses?: string; run?: string; shell?: string }[];
    }
  >;
}

interface BuilderConfig {
  files?: string[];
  directories?: { output?: string };
  publish?: { provider?: string; owner?: string; repo?: string };
  mac?: { target?: string };
  win?: { target?: string };
  linux?: { target?: string; executableName?: string };
}

const workflow = () => readYaml<Workflow>(WORKFLOW);
const builder = () => readYaml<BuilderConfig>(BUILDER_CONFIG);

const steps = () => Object.values(workflow().jobs ?? {}).flatMap((job) => job.steps ?? []);

describe('the desktop release workflow', () => {
  it('builds on all three platforms, and lets each finish on its own', () => {
    // Three installers is the acceptance criterion, so three runners. `fail-fast` matters
    // as much as the list: all three publish into the same GitHub Release, so cancelling
    // the survivors of a failure leaves a release holding whatever got there first and no
    // record of what was cut short.
    const job = Object.values(workflow().jobs ?? {})[0];

    expect(job?.strategy?.matrix?.os).toEqual(['macos-latest', 'windows-latest', 'ubuntu-latest']);
    expect(job?.strategy?.['fail-fast']).toBe(false);
  });

  it('builds through Turborepo rather than through the package script alone', () => {
    // `pnpm --filter @tyto/desktop build` runs `electron-vite build` and nothing before it,
    // so on the fresh checkout every tag build is, the workspace packages have no `dist/`
    // and the bundle dies at `Rolldown failed to resolve import "@tyto/core" from
    // "apps/desktop/src/main/plugins.ts"` — measured by deleting `packages/core/dist` and
    // running it. Turborepo's `^build` is what orders them and `pnpm build` is what reaches
    // it. The file said the filtered form until TYTO-15; it had never been run.
    const scripts = steps()
      .map((step) => step.run)
      .filter((run) => run !== undefined);

    expect(
      scripts.filter((run) => /pnpm (?:--filter \S+ )?(?:run )?build\b/.test(run)),
      `${WORKFLOW} no longer has a build step`,
    ).not.toHaveLength(0);
    expect(
      scripts.filter((run) => /pnpm --filter \S*desktop\S* (?:run )?build\b/.test(run)),
      `${WORKFLOW} builds the desktop package on its own, which skips the workspace packages it imports`,
    ).toEqual([]);
  });

  it('refuses a tag that does not name the version being packaged', () => {
    // electron-builder takes the version from `apps/desktop/package.json` and the release
    // name from the tag, and never compares them: `desktop-v0.2.0` over a package reading
    // `0.1.0` publishes `Tyto Setup 0.1.0.exe` into a release called `desktop-v0.2.0`,
    // green. One step in the workflow is the only thing that notices.
    const guard = steps().find(
      (step) => step.run?.includes('GITHUB_REF_NAME') === true && step.run.includes('exit 1'),
    );

    expect(
      guard,
      `${WORKFLOW} has no step comparing GITHUB_REF_NAME with apps/desktop/package.json`,
    ).toBeDefined();
    expect(guard?.run).toContain('apps/desktop/package.json');

    // `shell: bash` because one leg of the matrix is `windows-latest`, where a `run:` block
    // is PowerShell by default and this script is not PowerShell.
    expect(
      guard?.shell,
      `${WORKFLOW}'s tag guard would be read as PowerShell on the Windows runner`,
    ).toBe('bash');
  });

  it('reads the tag out of the environment rather than interpolating it', () => {
    // A tag is text somebody chose, and `${{ }}` is substituted before the shell parses the
    // line — `desktop-v$(…)` would run as code with the workflow token in scope. The
    // sibling check in `github-config.test.ts` covers PR titles; this is the same class.
    for (const step of steps()) {
      expect(step.run ?? '', `${WORKFLOW} interpolates the tag into a run step`).not.toMatch(
        /\$\{\{[^}]*github\.ref/,
      );
    }
  });

  it('publishes, which is the only reason the job has write permission', () => {
    const publishing = steps().filter((step) => step.run?.includes('electron-builder') === true);

    expect(publishing, `${WORKFLOW} no longer runs electron-builder`).toHaveLength(1);
    expect(publishing[0]?.run).toContain('--publish always');
  });
});

describe('the electron-builder configuration', () => {
  it('names one installer target per platform in the matrix', () => {
    // Read as three keys rather than as three strings: a platform with no block builds
    // nothing on its runner, and the job would still go green.
    const config = builder();

    expect({
      mac: config.mac?.target,
      win: config.win?.target,
      linux: config.linux?.target,
    }).toEqual({ mac: 'dmg', win: 'nsis', linux: 'AppImage' });
  });

  it('keeps the built-in template pack inside the package', () => {
    // The `files` list excludes `node_modules` wholesale — everything the app imports is
    // already inside `out/main/index.js` — and then re-includes exactly one package. That
    // package is not code: `builtInTemplatesDirectory()` finds the pack with
    // `createRequire(...).resolve('@tyto/templates/package.json')`, a resolver call a
    // bundle cannot answer, and the registry then reads `templates/` off the same folder.
    //
    // Both lines, because they fail for different reasons and with the same symptom —
    // nothing. Built without them the app opens no window at all; the resolve throws inside
    // the promise `app.whenReady().then(start)` returns and nobody is listening.
    // `packaged.package.test.ts` is what measures that; this is what keeps the two lines
    // from being tidied away by somebody reading the list as dead weight.
    const files = builder().files ?? [];

    expect(files, `${BUILDER_CONFIG} no longer excludes node_modules`).toContain(
      '!node_modules/**',
    );
    expect(files).toContain('node_modules/@tyto/templates/package.json');
    expect(files).toContain('node_modules/@tyto/templates/templates/**');

    // And the resolve the two lines exist for, still spelled that way in the app.
    expect(
      readRepoFile('apps/desktop/src/main/plugins.ts'),
      'plugins.ts no longer resolves @tyto/templates/package.json; the files list above is now guarding nothing',
    ).toContain("resolve('@tyto/templates/package.json')");
  });

  it('gives Linux an executable name, which is the one platform that would invent one', () => {
    // Linux ignores `productName` for the binary and falls back to
    // `appInfo.sanitizedName.toLowerCase()` — the npm package name, `@tyto/desktop`. The
    // other two use `productName`, which is why this is declared under `linux:` and not at
    // the top level, where it would also rename `Tyto.exe` and `Tyto.app`.
    expect(builder().linux?.executableName).toBe('tyto');
  });

  it('writes installers somewhere Git ignores', () => {
    const output = builder().directories?.output;

    expect(output, `${BUILDER_CONFIG} declares no output directory`).toBeDefined();
    expect(
      readRepoFile('.gitignore')
        .split('\n')
        .map((line) => line.trim()),
      `.gitignore does not ignore ${output}/, so a local package would offer itself for commit`,
    ).toContain(`${output!}/`);
  });

  it('publishes to the repository this one actually is', () => {
    // Named rather than inferred: electron-builder would fall back to the workspace root's
    // `repository` field, which works and says nothing. Pinned against that field so the
    // two cannot drift.
    const { provider, owner, repo } = builder().publish ?? {};
    const url = (JSON.parse(readRepoFile('package.json')) as { repository?: { url?: string } })
      .repository?.url;

    expect(provider).toBe('github');
    expect(url, 'the root package.json no longer declares a repository URL').toBeDefined();
    expect(url).toContain(`${owner!}/${repo!}`);
  });
});

describe('the desktop build output', () => {
  it('is a Turborepo output, so a cache hit restores it', () => {
    // `apps/desktop` is the one package that does not build to `dist`: electron-vite writes
    // `out/main`, `out/preload` and `out/renderer`. With only `dist/**` declared, the task
    // was not uncacheable — it was cacheable with nothing in the cache, so a second run
    // printed `@tyto/desktop:build: cache hit, replaying logs` and left `apps/desktop/out`
    // absent. `desktop.yml` builds and then packages, so that hit is an installer wrapped
    // around an empty app (TYTO-15).
    const turbo = JSON.parse(readRepoFile('turbo.json').replace(/^\s*\/\/.*$/gm, '')) as {
      tasks?: Record<string, { outputs?: string[] }>;
    };

    expect(turbo.tasks?.['build']?.outputs).toContain('out/**');

    // The coupling, rather than the string: `out` is electron-vite's default and the test
    // should fail if the app ever moves, not go on passing about a folder nobody writes.
    expect(
      readRepoFile('apps/desktop/package.json'),
      'apps/desktop no longer has a main under out/; re-read what turbo.json declares as a build output',
    ).toContain('"main": "./out/main/index.js"');
  });
});
