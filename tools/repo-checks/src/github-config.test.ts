import { readdirSync, readFileSync } from 'node:fs';
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
  jobs?: Record<
    string,
    {
      env?: Record<string, string | number>;
      steps?: { uses?: string; run?: string; env?: Record<string, string> }[];
    }
  >;
}

const WORKFLOWS_DIR = '.github/workflows';

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
