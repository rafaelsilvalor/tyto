import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * The GitHub configuration (docs/git-workflow.md) only protects `main` while the names
 * inside it keep matching the names outside it: branch protection stores plain strings
 * for the required checks, `labeler.yml` repeats the workspace layout by hand, and LFS
 * routing lives in a file no test would otherwise read. Each of those drifts silently —
 * a renamed job stops being required, a new package stops being labelled — so the
 * couplings are asserted here rather than discovered on a PR that should have been
 * blocked and was not.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const readRepoFile = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

const readYaml = <T>(relativePath: string): T => parse(readRepoFile(relativePath)) as T;

const directoriesIn = (relativePath: string) =>
  readdirSync(join(repoRoot, relativePath), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

interface Workflow {
  name?: string;
  on?: string | string[] | Record<string, unknown>;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  jobs?: Record<
    string,
    {
      env?: Record<string, string | number>;
      steps?: {
        uses?: string;
        run?: string;
        if?: string;
        'continue-on-error'?: boolean;
        with?: Record<string, unknown>;
        env?: Record<string, string>;
      }[];
    }
  >;
}

const WORKFLOWS_DIR = '.github/workflows';

/** The events a workflow runs on, however its `on:` is written. */
function triggersOf(workflow: Workflow): string[] {
  const on = workflow.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return on === undefined ? [] : Object.keys(on);
}

const workflowFiles = readdirSync(join(repoRoot, WORKFLOWS_DIR)).filter((file) =>
  file.endsWith('.yml'),
);

/**
 * Required status checks are configured on the branch, not in the repository, and GitHub
 * identifies them by job name. Renaming a job in the workflow therefore silently drops
 * the protection instead of failing, so the names the branch expects are pinned here.
 * Changing one means updating `main`'s protection in the same PR.
 */
const REQUIRED_CHECKS = [
  { context: 'check', workflow: 'ci.yml' },
  { context: 'lint', workflow: 'commitlint.yml' },
];

interface ChangesetsActionMajor {
  /** Every input name that major declares, read off its own `action.yml`. */
  reads: readonly string[];
  /** The input carrying the commit message, which commitlint reads after a squash merge. */
  commitMessage: string;
  /** The input carrying the pull request title, which the required `lint` check reads. */
  prTitle: string;
}

/**
 * What each major of `changesets/action` calls its inputs. The action's major and the
 * Changesets CLI's move together — v1 runs against CLI v2, v2 against CLI v3, and each
 * refuses the other by name — so a CLI upgrade arrives here as a rename of every input
 * this repository passes.
 *
 * The whole list is pinned, not just the four in use, because an action ignores an input
 * it does not know rather than failing on it. The v1 → v2 bump left `commit:` and
 * `title:` in `release.yml` meaning nothing, and the version PR opened under the action's
 * own default title, "Version Packages" — a green run and a pull request with no Jira
 * key, unmergeable for good (TYTO-78).
 *
 * `commitMessage` and `prTitle` name the two that carry the linted strings, so the
 * assertion below reads the input the pinned major actually reads. The check they replace
 * searched the file text for `title: '…'`, which under v2 still matches — `pr-title:`
 * ends in `title:` — and would have gone on passing while reporting on an input v1 never
 * had.
 */
const CHANGESETS_ACTION_BY_MAJOR: Record<string, ChangesetsActionMajor> = {
  v1: {
    reads: [
      'version',
      'publish',
      'commit',
      'title',
      'branch',
      'cwd',
      'setupGitUser',
      'createGithubReleases',
    ],
    commitMessage: 'commit',
    prTitle: 'title',
  },
  v2: {
    reads: [
      'github-token',
      'publish-script',
      'version-script',
      'commit-message',
      'pr-title',
      'pr-draft',
      'pr-base-branch',
      'create-github-releases',
      'push-git-tags',
      'push-with-git-cli',
      'cwd',
    ],
    commitMessage: 'commit-message',
    prTitle: 'pr-title',
  },
};

/**
 * Which kind of tag a release produces, read from the one input that decides it.
 *
 * A YAML `true` and the string `'true'` both reach an action as the string `"true"`, so
 * both are treated as set; anything else, including the input being absent, leaves v2's
 * API path and its lightweight tags.
 */
const tagShape = (inputs: Record<string, unknown>): 'annotated' | 'lightweight' =>
  String(inputs['push-with-git-cli'] ?? 'false') === 'true' ? 'annotated' : 'lightweight';

/** Input names a major does not read. Empty is the passing case. */
const unreadInputs = (major: string, inputs: Record<string, unknown>) =>
  Object.keys(inputs).filter(
    (name) => CHANGESETS_ACTION_BY_MAJOR[major]?.reads.includes(name) !== true,
  );

describe('workflows', () => {
  it('parse as YAML and declare at least one job', () => {
    for (const file of workflowFiles) {
      const workflow = readYaml<Workflow>(`${WORKFLOWS_DIR}/${file}`);
      expect(Object.keys(workflow.jobs ?? {}), `${file} declares no job`).not.toHaveLength(0);
    }
  });

  it.each(REQUIRED_CHECKS)(
    'still define the job "$context", which main requires as a status check',
    ({ context, workflow }) => {
      const jobs = readYaml<Workflow>(`${WORKFLOWS_DIR}/${workflow}`).jobs ?? {};
      expect(Object.keys(jobs)).toContain(context);
    },
  );

  it('pin every action to a version, so a moved tag cannot change what CI runs', () => {
    for (const file of workflowFiles) {
      const workflow = readYaml<Workflow>(`${WORKFLOWS_DIR}/${file}`);
      const uses = Object.values(workflow.jobs ?? {}).flatMap((job) =>
        (job.steps ?? []).map((step) => step.uses).filter((value) => value !== undefined),
      );
      for (const action of uses) {
        expect(action, `${file} uses an unpinned action`).toMatch(/@/);
      }
    }
  });

  it('keep the Husky hooks out of the job that commits on its own', () => {
    // `prepare: husky` installs the hooks on every install, CI included, and the commit
    // Changesets makes has no Jira key — commitlint rejected it and took the release job
    // down before it could open the version PR. The rule is for human commits.
    const jobs = readYaml<Workflow>(`${WORKFLOWS_DIR}/release.yml`).jobs ?? {};
    expect(jobs.release?.env?.HUSKY).toBe(0);
  });

  /** The single `changesets/action` step in `release.yml`, with the major it pins. */
  const changesetsActionStep = () => {
    const steps = Object.values(readYaml<Workflow>(`${WORKFLOWS_DIR}/release.yml`).jobs ?? {})
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses?.startsWith('changesets/action@') === true);

    expect(steps, 'release.yml no longer uses changesets/action').toHaveLength(1);

    const major = steps[0]!.uses!.split('@')[1]!;
    const names = CHANGESETS_ACTION_BY_MAJOR[major];
    expect(
      names,
      `no input list is pinned for changesets/action@${major}; it renamed every input between majors, and an unknown one is ignored rather than refused`,
    ).toBeDefined();

    return { major, inputs: steps[0]!.with ?? {}, names: names! };
  };

  it('pass changesets/action only input names the pinned major actually reads', () => {
    const { major, inputs } = changesetsActionStep();
    expect(
      unreadInputs(major, inputs),
      `release.yml passes changesets/action@${major} inputs that major does not read; an action ignores an unknown input rather than refusing it, so these are silently doing nothing`,
    ).toEqual([]);
  });

  it('catch a wrong input name rather than only reporting on the file of the day', () => {
    // The assertion above is only as good as whatever `release.yml` happens to say, so on
    // a correct file it reads green without having caught anything. This runs the same
    // predicate against the exact mistake TYTO-78 made — v1's four names left under v2 —
    // and against v2's own names, so the guard is measured in both directions.
    expect(
      unreadInputs('v2', { version: 'x', publish: 'x', commit: 'x', title: 'x' }),
    ).toStrictEqual(['version', 'publish', 'commit', 'title']);
    expect(
      unreadInputs('v2', {
        'version-script': 'x',
        'publish-script': 'x',
        'commit-message': 'x',
        'pr-title': 'x',
      }),
    ).toStrictEqual([]);
  });

  it('give the version PR a title its own commitlint rule accepts', () => {
    // `lint` is a required check on main and reads the PR title, so a version PR
    // without a Jira key would open and then be unmergeable for good.
    //
    // Read through the pinned major's input names rather than by searching the file for
    // `title: '…'`, the way this check used to: that search still matches under v2,
    // because `pr-title:` ends in `title:`, so it would report on an input v1 never had
    // and miss a `commit-message:` that had gone missing entirely.
    const { major, inputs, names } = changesetsActionStep();

    for (const field of [names.commitMessage, names.prTitle]) {
      const value = inputs[field];
      expect(
        value,
        `release.yml passes changesets/action@${major} no '${field}', so the version PR would take the action's own default`,
      ).toBeTypeOf('string');
      expect(value as string).toMatch(/^\w+(\([\w-]+\))?: TYTO-\d+ [a-z0-9]/);
    }
  });

  it('leave version tags lightweight, which is the shape this repository decided on', () => {
    // `changesets/action` v2 pushes tags through the GitHub API, and an API ref is a plain
    // ref — a lightweight tag. `push-with-git-cli: true` restores v1's Git-CLI path and
    // its annotated tags, so the shape of every release tag is decided by one input that
    // is easy to add for an unrelated reason.
    //
    // The decision is lightweight (TYTO-86, and `docs/git-workflow.md` says why). What
    // v1's annotated tags carried was a tagger reading `github-actions[bot]`, a date the
    // tagged commit already has, and a message repeating the tag's own name; they were
    // not signed — `git cat-file tag '@tyto/core@0.19.0' | grep -c "BEGIN PGP"` is 0 — so
    // no signature was ever traded away in either direction. Against that, `git describe`
    // has 0 occurrences in this repository.
    const { major, inputs } = changesetsActionStep();
    expect(major, 'the tag shape below is a v2 default; re-read it on another major').toBe('v2');

    expect(
      tagShape(inputs),
      `release.yml sets push-with-git-cli, which makes release tags annotated. That is a ` +
        `defensible answer and it is not the one in docs/git-workflow.md — change the doc ` +
        `in the same commit or drop the input.`,
    ).toBe('lightweight');
  });

  it('read the tag shape from the input rather than from the absence of a line', () => {
    // The assertion above passes on a file that simply never mentions the input, which is
    // also what it would do if the input were renamed out from under it. Measured in both
    // directions against the predicate itself.
    expect(tagShape({})).toBe('lightweight');
    expect(tagShape({ 'push-with-git-cli': false })).toBe('lightweight');
    expect(tagShape({ 'push-with-git-cli': 'false' })).toBe('lightweight');
    expect(tagShape({ 'push-with-git-cli': true })).toBe('annotated');
    expect(tagShape({ 'push-with-git-cli': 'true' })).toBe('annotated');
  });

  it('key a pull_request_target concurrency group on the pull request, not on github.ref', () => {
    // `github.ref` means opposite things on the two triggers. On `pull_request` it is
    // `refs/pull/<n>/merge` and is already unique per PR, which is why the sibling
    // workflows are right to use it. On `pull_request_target` it is the *base* branch, so
    // every open PR against main lands in one group and each new one cancels the last —
    // 4 of 5 labeler runs were cancelled the day Dependabot opened five at once (TYTO-77).
    for (const file of workflowFiles) {
      const workflow = readYaml<Workflow>(`${WORKFLOWS_DIR}/${file}`);
      if (!triggersOf(workflow).includes('pull_request_target')) continue;

      const group = workflow.concurrency?.group;
      expect(group, `${file} runs on pull_request_target with no concurrency group`).toBeDefined();
      expect(
        group,
        `${file} keys its concurrency group on github.ref, which is the base branch`,
      ).not.toMatch(/github\.ref\b/);
      expect(group, `${file} does not key its concurrency group on the pull request`).toMatch(
        /github\.event\.pull_request\.number/,
      );
    }
  });

  it('never interpolate the PR title into a shell script', () => {
    // `${{ … }}` is substituted before the shell parses the line, so a title containing
    // `$(…)` would run as code with the workflow token in scope. The title has to arrive
    // through `env:` instead. See the commitlint workflow.
    for (const file of workflowFiles) {
      const workflow = readYaml<Workflow>(`${WORKFLOWS_DIR}/${file}`);
      const scripts = Object.values(workflow.jobs ?? {}).flatMap((job) =>
        (job.steps ?? []).map((step) => step.run).filter((value) => value !== undefined),
      );
      for (const script of scripts) {
        expect(script, `${file} interpolates the PR title into a run step`).not.toMatch(
          /\$\{\{[^}]*github\.event\.pull_request\.title/,
        );
      }
    }
  });
});

/**
 * The desktop end-to-end suites, and whether anything runs them.
 *
 * They are reachable only through their own scripts: `apps/desktop`'s `test` script — the
 * one `turbo test` calls, and therefore the one `ci.yml` calls — points at
 * `vitest.config.ts`, whose `include` is `shared/**` and `src/**`. The `e2e/` folder is
 * `vitest.desktop.config.ts`'s and `vitest.package.config.ts`'s. So 71 tests sat outside
 * every workflow for as long as the app existed, and nothing said so: `ci.yml` was green,
 * the scripts were in `package.json`, and `--passWithNoTests` meant the gap looked like a
 * pass (TYTO-111).
 *
 * That is a gap no failing test can announce, because the tests that would fail are the
 * ones not being run. It is announced here instead.
 */
/**
 * Workflow files with a `run:` step invoking `script`, read from the parsed YAML.
 *
 * The one question a script in `package.json` cannot answer about itself: **is anything
 * running it?** Two have turned out not to be — the desktop end-to-end suites (TYTO-111) and
 * `format:check` (TYTO-0, below) — and neither failure was visible, because a script nobody
 * calls is indistinguishable from a script that passes.
 */
const workflowsRunning = (script: string) =>
  workflowFiles.filter((file) =>
    Object.values(readYaml<Workflow>(`${WORKFLOWS_DIR}/${file}`).jobs ?? {}).some((job) =>
      (job.steps ?? []).some((step) => step.run?.includes(script) === true),
    ),
  );

describe('desktop end-to-end suites', () => {
  const E2E_SCRIPTS = ['test:desktop', 'test:package'] as const;

  it.each(E2E_SCRIPTS)('are still the scripts apps/desktop calls them, %s', (script) => {
    const manifest = JSON.parse(readRepoFile('apps/desktop/package.json')) as {
      scripts?: Record<string, string>;
    };
    expect(
      Object.keys(manifest.scripts ?? {}),
      'the pins below name a script that no longer exists, so they measure nothing',
    ).toContain(script);
  });

  it.each(E2E_SCRIPTS)('are run by at least one workflow, %s', (script) => {
    expect(
      workflowsRunning(script),
      `no workflow runs \`${script}\`; it runs on a maintainer's machine or nowhere`,
    ).not.toHaveLength(0);
  });

  it.each(E2E_SCRIPTS)('are run before the merge and not only after it, %s', (script) => {
    // The trigger is the decision TYTO-111 took, and it is one line away from being
    // undone: moving this to `schedule` or to `push` alone would keep every assertion
    // above green while putting the discovery back after the merge, which is what
    // `desktop.yml` already costs this repository (TYTO-97).
    const onPullRequest = workflowsRunning(script).filter((file) =>
      triggersOf(readYaml<Workflow>(`${WORKFLOWS_DIR}/${file}`)).includes('pull_request'),
    );
    expect(
      onPullRequest,
      `\`${script}\` runs in a workflow, but none that a pull request fires`,
    ).not.toHaveLength(0);
  });

  it('say no for a script nothing runs', () => {
    // The three assertions above are only as good as their predicate, and a predicate that
    // matched everything would read green on the very file that has the defect.
    expect(workflowsRunning('test:a-script-no-workflow-runs')).toEqual([]);
  });
});

/**
 * Prettier, which was a script nothing called.
 *
 * `pnpm check` was `turbo run typecheck lint test` and `ci.yml` ran the same four tasks, so
 * `format:check` existed in `package.json` and ran in no workflow and no local check. Three
 * files had drifted on `main` by the time anybody looked, and the only reason anybody looked
 * is that a `prettier --write` on a folder reformatted files a card had never touched.
 *
 * Same shape as the desktop suites above, same instrument.
 */
describe('formatting', () => {
  it('is a script the root package still has', () => {
    const manifest = JSON.parse(readRepoFile('package.json')) as {
      scripts?: Record<string, string>;
    };
    expect(Object.keys(manifest.scripts ?? {})).toContain('format:check');
  });

  it('is part of `pnpm check`, so a person finds it before CI does', () => {
    const manifest = JSON.parse(readRepoFile('package.json')) as {
      scripts?: Record<string, string>;
    };
    expect(manifest.scripts?.check).toContain('format:check');
  });

  it('is run by a workflow, on a pull request', () => {
    const running = workflowsRunning('format:check');
    expect(running, 'no workflow runs `format:check`').not.toHaveLength(0);

    const onPullRequest = running.filter((file) =>
      triggersOf(readYaml<Workflow>(`${WORKFLOWS_DIR}/${file}`)).includes('pull_request'),
    );
    expect(onPullRequest, '`format:check` runs, but not before a merge').not.toHaveLength(0);
  });
});

/**
 * `changeset status`, which reads the files `release.yml` would version.
 *
 * `changesets.test.ts` holds the one failure that has actually happened — a file naming a
 * private package beside a published one. This holds the *class*: the tool itself, run on
 * every pull request, where `release.yml` runs only after the merge. Both exist because the
 * two answer different questions, and the expensive one is "what else does Changesets
 * refuse that nobody has hit yet".
 */
describe('changeset status', () => {
  it('is run by a workflow, on a pull request', () => {
    const running = workflowsRunning('changeset status');
    expect(running, 'no workflow runs `changeset status`').not.toHaveLength(0);

    const onPullRequest = running.filter((file) =>
      triggersOf(readYaml<Workflow>(`${WORKFLOWS_DIR}/${file}`)).includes('pull_request'),
    );
    expect(onPullRequest, '`changeset status` runs, but not before a merge').not.toHaveLength(0);
  });

  it('is not `changeset version`, which writes', () => {
    // The one way this step could be wrong rather than missing. `version` rewrites every
    // manifest and consumes the folder; on a pull request it would either fail or commit.
    const ci = readRepoFile(`${WORKFLOWS_DIR}/ci.yml`);
    expect(ci).not.toMatch(/run:.*changeset version/u);
  });

  it('is skipped on the version PR, and on nothing else', () => {
    // **The version PR is the one pull request that must have no changeset**, because it
    // exists to consume them, and `changeset status` errors when packages changed against
    // the base and the folder is empty. It passed by accident until TYTO-94: private
    // packages were not versioned, so eight or nine files were left behind on every run and
    // the folder was never empty. The first version PR after that config change went red
    // (TYTO-134).
    //
    // The condition is asserted as a literal string on purpose. Anything broader —
    // `always()`, `continue-on-error`, a `startsWith` on the ref — would keep this describe
    // green while switching the step off for the pull requests it exists for, and the two
    // assertions above cannot tell those apart. Widening it should cost a reading of this
    // comment.
    const steps = Object.values(readYaml<Workflow>(`${WORKFLOWS_DIR}/ci.yml`).jobs ?? {})
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.run?.includes('changeset status') === true);

    expect(steps, 'ci.yml no longer runs `changeset status` exactly once').toHaveLength(1);
    expect(steps[0]!.if).toBe("github.head_ref != 'changeset-release/main'");
    // On the step, not on the file: `ci.yml` uses `continue-on-error` legitimately on the
    // artifact upload, and a file-wide match reads that one as this one.
    expect(steps[0]!['continue-on-error']).toBeUndefined();
  });
});

describe('labeler', () => {
  type LabelerConfig = Record<string, { 'changed-files': { 'any-glob-to-any-file': unknown }[] }[]>;

  const globsByLabel = () => {
    const config = readYaml<LabelerConfig>('.github/labeler.yml');
    return new Map(
      Object.entries(config).map(([label, matchers]) => [
        label,
        matchers.flatMap((matcher) =>
          matcher['changed-files'].flatMap((rule) => {
            const globs = rule['any-glob-to-any-file'];
            return Array.isArray(globs) ? (globs as string[]) : [globs as string];
          }),
        ),
      ]),
    );
  };

  const workspaceDirectories = [
    ...directoriesIn('packages').map((name) => ({
      label: `pkg:${name}`,
      glob: `packages/${name}/**`,
    })),
    ...directoriesIn('apps').map((name) => ({ label: `app:${name}`, glob: `apps/${name}/**` })),
  ];

  it.each(workspaceDirectories)('labels $glob as $label', ({ label, glob }) => {
    expect([...globsByLabel().get(label)!]).toContain(glob);
  });

  it('has no rule pointing at a directory that no longer exists', () => {
    const known = new Set(workspaceDirectories.map(({ label }) => label));
    const workspaceLabels = [...globsByLabel().keys()].filter((label) => /^(pkg|app):/.test(label));
    expect(workspaceLabels.filter((label) => !known.has(label))).toEqual([]);
  });
});

describe('git attributes', () => {
  it('route fixture PNGs through LFS, and only those', () => {
    const rules = readRepoFile('.gitattributes')
      .split('\n')
      .filter((line) => line.includes('filter=lfs'));

    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatch(/^\*\*\/__fixtures__\/\*\*\/\*\.png\s/);
    expect(rules[0]).toContain('diff=lfs');
    expect(rules[0]).toContain('merge=lfs');
    expect(rules[0]).toContain('-text');
  });

  it('are honoured by the workflows that need the real bytes', () => {
    // A default checkout leaves LFS pointer files on disk, and a pixel diff against a
    // 130-byte text file fails in a way that reads like a rendering bug.
    //
    // `desktop-e2e.yml` joined the list in TYTO-133: `raster.desktop.test.ts` compares the
    // debugger-captured adapter against the same reference corpus, so it needs the real
    // bytes for exactly the same reason the other two do.
    for (const file of ['ci.yml', 'visual.yml', 'desktop-e2e.yml']) {
      expect(readRepoFile(`${WORKFLOWS_DIR}/${file}`), `${file} checks out without LFS`).toMatch(
        /lfs:\s*true/,
      );
    }
  });
});

describe('dependabot', () => {
  interface DependabotConfig {
    updates?: {
      'package-ecosystem'?: string;
      groups?: Record<string, unknown>;
      ignore?: { 'dependency-name'?: string; versions?: string[] }[];
    }[];
  }

  const DEPENDABOT_CONFIG = '.github/dependabot.yml';

  /**
   * One ecosystem's `ignore` rules, flattened to one entry per version spec, with the
   * major each spec names. `undefined` for a spec that names no major is deliberate: the
   * callers assert on it rather than skipping it quietly.
   *
   * Both spellings of a major are read, because the two ecosystems do not agree on what a
   * version is. An npm version is semver and `7.x` is the range that matches it; a GitHub
   * Actions version is the ref a workflow pins — `2`, the way `actions/checkout` is `7` —
   * and a semver range matches none of them. `'2.x'` was accepted by the updater, printed
   * back as an ignored version, and ignored nothing (TYTO-83).
   */
  const ignoredMajorsOf = (ecosystem: string) => {
    const update = (readYaml<DependabotConfig>(DEPENDABOT_CONFIG).updates ?? []).find(
      (entry) => entry['package-ecosystem'] === ecosystem,
    );
    expect(update, `dependabot.yml no longer configures the ${ecosystem} ecosystem`).toBeDefined();

    return (update!.ignore ?? []).flatMap((rule) =>
      (rule.versions ?? []).map((spec) => ({
        name: rule['dependency-name'],
        spec,
        major: /^(\d+)(?:\.|$)/.exec(spec)?.[1],
      })),
    );
  };

  /** Every major a workspace manifest declares for a package, by package name. */
  const declaredMajors = () => {
    const manifests = [
      'package.json',
      ...['packages', 'apps', 'tools'].flatMap((dir) =>
        directoriesIn(dir).map((name) => `${dir}/${name}/package.json`),
      ),
    ].filter((path) => existsSync(join(repoRoot, path)));

    const majors = new Map<string, Set<string>>();
    for (const manifest of manifests) {
      const json = JSON.parse(readRepoFile(manifest)) as Record<
        string,
        Record<string, string> | undefined
      >;
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const [name, range] of Object.entries(json[field] ?? {})) {
          const major = /(\d+)\./.exec(range)?.[1];
          if (major === undefined) continue;
          majors.set(name, (majors.get(name) ?? new Set<string>()).add(major));
        }
      }
    }
    return majors;
  };

  it('still groups the npm ecosystem into dev and prod', () => {
    // One pull request a week is the point: `main` requires branches to be up to date, so
    // five separate bumps are five update-and-rerun cycles (TYTO-76). The updater spent
    // its first three runs failing for a reason the grouping had nothing to do with
    // (below), which is why reviving it was not allowed to trade the grouping away.
    const updates = readYaml<DependabotConfig>(DEPENDABOT_CONFIG).updates ?? [];
    const npm = updates.find((entry) => entry['package-ecosystem'] === 'npm');

    expect(npm, 'dependabot.yml no longer configures the npm ecosystem').toBeDefined();
    expect(Object.keys(npm!.groups ?? {}).sort()).toEqual(['dev', 'prod']);
  });

  it('explains the pnpm major that package.json actually pins', () => {
    // `packageManager` is not only the developer's pnpm: Dependabot installs whatever it
    // names into the updater container, so the pin decides whether the npm half of that
    // file runs at all. pnpm 12 cannot run there — its Corepack path downloads
    // `@pnpm/exe.<target>` through a `fetch` with no dispatcher, which cannot honour the
    // container's proxy — and the run failed 3 of 3 times before the pin moved to 11
    // (TYTO-79, TYTO-82).
    //
    // The coupling is held at the major, because that is the altitude of the mechanism:
    // the launcher is a property of pnpm 12, not of 12.3.4. A patch bump leaves the note
    // true and passes; leaving pnpm 11 fails here, which is the point — whoever bumps the
    // major has to re-read why the pin is where it is and measure the new one, instead of
    // inheriting a paragraph that was true about a different program.
    const packageManager = (JSON.parse(readRepoFile('package.json')) as { packageManager?: string })
      .packageManager;
    const pinned = /^pnpm@(\d+)\./.exec(packageManager ?? '')?.[1];
    expect(pinned, 'package.json no longer pins a pnpm version in packageManager').toBeDefined();

    // Anchored on the phrase rather than on the first `pnpm@…` in the file: the note also
    // names the versions it ruled out, and those must not be mistaken for the pin.
    const recorded = /packageManager pnpm@(\d+)\./.exec(readRepoFile(DEPENDABOT_CONFIG))?.[1];
    expect(
      recorded,
      `${DEPENDABOT_CONFIG} does not name the pin as \`packageManager pnpm@<version>\``,
    ).toBeDefined();
    expect(
      recorded,
      `${DEPENDABOT_CONFIG} explains the npm updater in terms of pnpm ${recorded}, but package.json pins pnpm ${pinned}; re-read the reasoning before inheriting it`,
    ).toBe(pinned);
  });

  it('ignores no action major the workflows have since moved to', () => {
    // An `ignore` entry is a refusal with an expiry date nobody writes down. `changesets/
    // action` 2 was ignored because the action's v2 will not run against Changesets CLI
    // v2, which is a migration and not a bump (TYTO-78, TYTO-83); TYTO-80 did the
    // migration, `release.yml` moved to `changesets/action@v2`, and this is the check that
    // made the entry's removal part of that PR instead of something to remember later —
    // past its reason it would have stopped refusing the version it was written for and
    // started hiding the next one, silently, because Dependabot never reports what it
    // skipped.
    //
    // So the refusal is tied to the thing it refuses: the moment a workflow uses the major
    // being ignored, this fails and the entry has to go. The npm half is the test below —
    // the same rule, read against the manifests instead of against `uses:`.
    //
    // As of TYTO-80 the actions ecosystem ignores nothing, so this iterates over an empty
    // list and asserts nothing today. That is the intended resting state, not a hole: it
    // is here for the next entry somebody adds.
    //
    // What this does not check, and cannot: whether Dependabot honours the entry. It reads
    // the two files and compares them, and the first version of this entry passed here
    // while ignoring nothing, because `2.x` is a semver range and an action's version is a
    // ref. Only a real updater run says — the log line to look for is `Available release
    // version/ref is <v>` under `Checking if <action> … needs updating` (TYTO-83).
    const usedMajors = new Map(
      workflowFiles
        .flatMap((file) => Object.values(readYaml<Workflow>(`${WORKFLOWS_DIR}/${file}`).jobs ?? {}))
        .flatMap((job) => job.steps ?? [])
        .map((step) => step.uses)
        .filter((uses) => uses !== undefined)
        .map((uses) => [uses.split('@')[0]!, uses.split('@')[1]!]),
    );

    for (const { name, spec, major } of ignoredMajorsOf('github-actions')) {
      expect(
        major,
        `${DEPENDABOT_CONFIG} ignores '${name}' at '${spec}', which names no major`,
      ).toBeDefined();

      const inUse = name === undefined ? undefined : usedMajors.get(name);
      expect(
        inUse,
        `${DEPENDABOT_CONFIG} ignores ${name}@${spec}, but the workflows already use ${inUse}; the entry now hides the next version instead of the one it was written for`,
      ).not.toBe(`v${major}`);
    }
  });

  it('ignores no npm major the workspace has since moved to', () => {
    // `typescript` 7.x is ignored because typescript-eslint refuses TS 7 by name and the
    // declaration build calls a TS 6 API it removed — two required checks down on one
    // package, which in a grouped update takes ten unrelated bumps with it (TYTO-84).
    //
    // It goes stale the same way the actions entry does, and worse: an npm ignore that
    // outlives its reason hides security updates, not just features. So it is read against
    // every manifest in the workspace, and the day one of them declares the ignored major
    // — which is what adopting TS 7 would mean — this fails and the entry has to go.
    const majors = declaredMajors();

    for (const { name, spec, major } of ignoredMajorsOf('npm')) {
      expect(
        major,
        `${DEPENDABOT_CONFIG} ignores '${name}' at '${spec}', which names no major`,
      ).toBeDefined();

      const declared = name === undefined ? [] : [...(majors.get(name) ?? [])];
      expect(
        declared,
        `${DEPENDABOT_CONFIG} ignores ${name}@${spec}, but a workspace manifest already declares ${name} ${major}.x; the entry now hides the next version instead of the one it was written for`,
      ).not.toContain(major);
    }
  });
});
