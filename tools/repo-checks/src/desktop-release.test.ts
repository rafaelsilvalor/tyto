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
      steps?: {
        name?: string;
        uses?: string;
        run?: string;
        shell?: string;
        env?: Record<string, string>;
      }[];
    }
  >;
}

interface BuilderConfig {
  files?: string[];
  directories?: { output?: string };
  publish?: {
    provider?: string;
    owner?: string;
    repo?: string;
    tagNamePrefix?: string;
    vPrefixedTagName?: boolean;
  };
  mac?: { target?: string };
  /** An array since TYTO-136 — Windows is the one platform with two. */
  win?: { target?: string | string[] };
  linux?: { target?: string; executableName?: string };
}

const workflow = () => readYaml<Workflow>(WORKFLOW);
const builder = () => readYaml<BuilderConfig>(BUILDER_CONFIG);

const steps = () => Object.values(workflow().jobs ?? {}).flatMap((job) => job.steps ?? []);

/**
 * The literal text a `push.tags` pattern matches before its wildcard, or `undefined` when the
 * pattern is not a plain prefix glob.
 *
 * `undefined` is a real answer rather than a skip: the assertion below refuses a pattern this
 * cannot read, because a trigger nobody can reduce to a prefix cannot be compared against the
 * one electron-builder composes, and a check that quietly passes on what it cannot parse is
 * the shape of the bug it is here to catch.
 */
const tagPrefixOf = (pattern: string): string | undefined => /^([^*?[\]]+)\*$/.exec(pattern)?.[1];

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

  it('hands electron-builder no signing variable it did not mean to set', () => {
    // `${{ secrets.CSC_LINK }}` in a step's `env:` sets the variable either way — to the
    // empty string when no such secret exists — and electron-builder's platforms disagree
    // about what that means. Windows refuses an empty one (`cscLink === ""`,
    // windowsSignToolManager.js:76); macOS checks only for null (macPackager.js:27), reads
    // `""` as a certificate, resolves it as a path, and dies at `⨯ <projectDir> not a file`.
    // The first real tag found it that way: two legs green, macOS red, identical env
    // (TYTO-98).
    //
    // So these names must not appear in the publishing step's own `env:` at all. Absence is
    // the thing being asserted, which is why this reads the step rather than the file — a
    // grep would also match the step that writes them conditionally, which is the fix.
    const publishing = steps().find((step) => step.run?.includes('electron-builder') === true);

    expect(publishing, `${WORKFLOW} no longer runs electron-builder`).toBeDefined();
    expect(
      Object.keys(publishing?.env ?? {}).filter((name) => name.startsWith('CSC_')),
      `${WORKFLOW} sets a CSC_* variable directly on the publishing step; with the secret unset that is an empty string, and the macOS leg reads an empty CSC_LINK as a certificate`,
    ).toEqual([]);

    // And the step that replaces it, which has to decide before writing. Pinned on the
    // mechanism rather than on the step's name: `$GITHUB_ENV` is the only place a workflow
    // can make a variable genuinely absent.
    //
    // `CSC_LINK<<`, the heredoc assignment, and not `CSC_LINK` anywhere in the script. The
    // looser form was written first and measured: renaming the assignment while the step
    // kept an `echo "no CSC_LINK secret…"` left this passing on a step that no longer wrote
    // the variable at all — 0 of 116, the perturbation nobody caught.
    const conditional = steps().find(
      (step) => step.run?.includes('GITHUB_ENV') === true && step.run.includes('CSC_LINK<<'),
    );

    expect(
      conditional,
      `${WORKFLOW} has no step writing CSC_LINK to $GITHUB_ENV, so a configured certificate would never reach electron-builder`,
    ).toBeDefined();
    expect(
      conditional?.shell,
      `${WORKFLOW}'s signing step would be read as PowerShell on the Windows runner`,
    ).toBe('bash');
  });
});

describe('the electron-builder configuration', () => {
  it('names every target the matrix builds, and Windows is the one platform with two', () => {
    // Read as three keys rather than as three strings: a platform with no block builds
    // nothing on its runner, and the job would still go green.
    //
    // **Windows carries `portable` beside `nsis` because it is the only platform whose
    // artifact cannot be run without installing** (TYTO-136). Linux's AppImage is a single
    // runnable file by definition and macOS's `dmg` is mounted and dragged, so neither
    // needs a second one — which is why this asserts an exact array rather than
    // `toContain`: dropping `portable` and adding a fourth target are both meant to fail
    // here, and so is quietly giving macOS or Linux a second artifact.
    //
    // It is deliberately *not* the `zip`-beside-the-`dmg` case the configuration refuses a
    // few lines above. That one would exist for electron-updater, which does not exist yet;
    // this one exists for a person who wants to carry the app.
    const config = builder();

    expect({
      mac: config.mac?.target,
      win: config.win?.target,
      linux: config.linux?.target,
    }).toEqual({ mac: 'dmg', win: ['nsis', 'portable'], linux: 'AppImage' });
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

  it('files the release under the same tag the workflow triggers on', () => {
    // The trigger and the release name are two strings in two files, and electron-builder
    // never compares them: it composes its own out of the version and a prefix it defaults
    // to `"v"` (`gitHubPublisher.js:38` → `githubTagPrefix`). With neither `tagNamePrefix`
    // nor `vPrefixedTagName` set, a push of `desktop-v0.1.0` opened a release named
    // `v0.1.0` — the wrong name, and one this repository should not take beside
    // `@tyto/core@0.19.0` (TYTO-97). This is the check that was missing when TYTO-15
    // shipped, which is why the defect reached `main`.
    const triggers = workflow().on?.push?.tags ?? [];

    expect(triggers, `${WORKFLOW} no longer triggers on exactly one tag pattern`).toHaveLength(1);

    const prefix = tagPrefixOf(triggers[0]!);
    expect(
      prefix,
      `${WORKFLOW} triggers on '${triggers[0]!}', which is not a plain prefix glob; the release name below cannot be compared against it`,
    ).toBeDefined();

    expect(
      builder().publish?.tagNamePrefix,
      `${BUILDER_CONFIG} does not set tagNamePrefix, so electron-builder falls back to 'v' and files the release under a tag ${WORKFLOW} does not trigger on`,
    ).toBe(prefix);
  });

  it('reads the prefix out of the pattern rather than trusting a substring', () => {
    // The assertion above is only as good as its parser, and the failure it guards is
    // precisely a string that looked right. Measured in both directions against the helper
    // itself: a prefix glob yields its prefix, and anything that is not one yields
    // `undefined` rather than a value the comparison would then accept.
    expect(tagPrefixOf('desktop-v*')).toBe('desktop-v');
    expect(tagPrefixOf('v*')).toBe('v');
    expect(tagPrefixOf('desktop-v')).toBeUndefined();
    expect(tagPrefixOf('*')).toBeUndefined();
    expect(tagPrefixOf('desktop-v*.*')).toBeUndefined();
    expect(tagPrefixOf('desktop-v[0-9]*')).toBeUndefined();
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
