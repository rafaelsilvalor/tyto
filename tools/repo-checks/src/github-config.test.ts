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

  it('give the version PR a title its own commitlint rule accepts', () => {
    // `lint` is a required check on main and reads the PR title, so a version PR
    // without a Jira key would open and then be unmergeable for good.
    const release = readRepoFile(`${WORKFLOWS_DIR}/release.yml`);
    for (const field of ['commit', 'title']) {
      const value = new RegExp(`${field}: '([^']+)'`).exec(release)?.[1];
      expect(value, `release.yml has no ${field}`).toBeDefined();
      expect(value).toMatch(/^\w+(\([\w-]+\))?: TYTO-\d+ [a-z0-9]/);
    }
  });

  it('pass changesets/action only input names the pinned major actually reads', () => {
    // An action ignores an input it does not know rather than failing on it. v2 of this
    // action renamed all four, so the bump left `commit:` and `title:` sitting in the file
    // meaning nothing, and fell back to its own defaults — a version PR titled "Version
    // Packages", with no Jira key and therefore unmergeable for good (TYTO-78). The test
    // above kept passing the whole time, because it reads those strings out of the file
    // and the file still had them. So the input *names* are pinned to the major.
    //
    // There is no entry for v2 on purpose: this repository is on Changesets CLI v2, which
    // the action's v2 refuses to run against. Moving to it is a CLI migration, and adding
    // a list here is the deliberate step that migration has to take.
    const INPUTS_BY_MAJOR: Record<string, readonly string[]> = {
      v1: [
        'version',
        'publish',
        'commit',
        'title',
        'branch',
        'cwd',
        'setupGitUser',
        'createGithubReleases',
      ],
    };

    const steps = Object.values(readYaml<Workflow>(`${WORKFLOWS_DIR}/release.yml`).jobs ?? {})
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses?.startsWith('changesets/action@') === true);

    expect(steps, 'release.yml no longer uses changesets/action').toHaveLength(1);

    const major = steps[0]!.uses!.split('@')[1]!;
    const allowed = INPUTS_BY_MAJOR[major];
    expect(
      allowed,
      `no input list is pinned for changesets/action@${major}; it renamed every input between majors, and an unknown one is ignored rather than refused`,
    ).toBeDefined();

    for (const name of Object.keys(steps[0]!.with ?? {})) {
      expect(allowed, `changesets/action@${major} does not read the input '${name}'`).toContain(
        name,
      );
    }
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
    for (const file of ['ci.yml', 'visual.yml']) {
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
    // action` 2.x is ignored because the action's v2 will not run against Changesets CLI
    // v2, which is a migration and not a bump (TYTO-80, TYTO-83) — and the day that
    // migration lands, the entry stops protecting anything and starts hiding the next
    // version instead, silently, because Dependabot does not report what it skipped.
    //
    // So the refusal is tied to the thing it refuses: the moment a workflow uses the major
    // being ignored, this fails and the entry has to go. The npm half is the test below —
    // the same rule, read against the manifests instead of against `uses:`.
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
