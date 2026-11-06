import { describe, expect, it } from 'vitest';

import { describeTriggers, PAGE_SIZE, run, workflowsWithoutRun } from './unexercised-workflows.mjs';

const REPO = 'someone/tyto';
const SHA = 'a'.repeat(40);

/** A runner that answers only the calls it was given, and throws on any other. */
function fakeRunner(answers) {
  return (args) => {
    const key = args.join(' ');
    if (!(key in answers)) throw new Error(`unexpected call: ${key}`);
    return answers[key];
  };
}

/** Workflow files in memory, read by their path relative to the repository root. */
function fakeFiles(byName) {
  return {
    list: (dir) => {
      if (dir !== '.github/workflows') throw new Error(`unexpected folder: ${dir}`);
      return Object.keys(byName);
    },
    read: (file) => {
      const name = file.replace(/^\.github\/workflows\//u, '');
      if (!(name in byName)) throw new Error(`unexpected file: ${file}`);
      return byName[name];
    },
  };
}

const WORKFLOWS = {
  'ci.yml': 'on:\n  pull_request:\n  push: { branches: [main] }\njobs: {}\n',
  'release.yml': 'name: Release\non:\n  push: { branches: [main] }\njobs: {}\n',
  'desktop.yml': [
    'on:',
    "  push: { tags: ['desktop-v*'] }",
    '  pull_request:',
    '    paths:',
    '      - apps/desktop/electron-builder.yml',
    '      - .github/workflows/desktop.yml',
    'jobs: {}',
  ].join('\n'),
  'labeler.yml': 'on: pull_request_target\njobs: {}\n',
  'contract-update.yml':
    'on:\n  workflow_call:\n    inputs:\n      checks: { type: string }\njobs: {}\n',
  'README.md': 'not a workflow',
};

describe('describeTriggers', () => {
  it('reads the flow style the shell awk missed', () => {
    expect(describeTriggers(WORKFLOWS['release.yml'])).toBe('push (branches: main)');
  });

  it('names each event with the filters that narrow it, and inputs are not filters', () => {
    expect(describeTriggers(WORKFLOWS['desktop.yml'])).toBe(
      'push (tags: desktop-v*); pull_request (paths: apps/desktop/electron-builder.yml, .github/workflows/desktop.yml)',
    );
    expect(describeTriggers(WORKFLOWS['contract-update.yml'])).toBe('workflow_call');
  });

  it('reads a one-word and a list trigger', () => {
    expect(describeTriggers(WORKFLOWS['labeler.yml'])).toBe('pull_request_target');
    expect(describeTriggers('on: [push, pull_request]\n')).toBe('push; pull_request');
  });

  it('reads types and branches together', () => {
    const text = 'on:\n  pull_request:\n    types: [opened, edited]\n    branches: [main]\n';
    expect(describeTriggers(text)).toBe('pull_request (branches: main; types: opened, edited)');
  });
});

describe('workflowsWithoutRun', () => {
  it('counts a run only for the workflow file its path names', () => {
    const files = ['.github/workflows/ci.yml', '.github/workflows/release.yml'];
    const runs = [{ id: 1, path: '.github/workflows/ci.yml' }];
    expect(workflowsWithoutRun({ files, runs })).toEqual(['.github/workflows/release.yml']);
  });
});

describe('run', () => {
  const git = fakeRunner({ 'remote get-url origin': `https://github.com/${REPO}\n` });
  const runsCall = `api repos/${REPO}/actions/runs?head_sha=${SHA}&per_page=${PAGE_SIZE}`;
  const jobsCall = (id) => `api repos/${REPO}/actions/runs/${id}/jobs?per_page=${PAGE_SIZE}`;

  function runIn(gh) {
    const printed = [];
    const code = run(
      { sha: SHA, workflows: '.github/workflows' },
      { git, gh, files: fakeFiles(WORKFLOWS), print: (line) => printed.push(line) },
    );
    return { code, printed };
  }

  it('lists the workflows with no run, with triggers, then the skipped jobs', () => {
    const gh = fakeRunner({
      [runsCall]: JSON.stringify({
        total_count: 2,
        workflow_runs: [
          { id: 11, path: '.github/workflows/ci.yml' },
          { id: 12, path: '.github/workflows/labeler.yml' },
        ],
      }),
      [jobsCall(11)]: JSON.stringify({
        jobs: [
          { workflow_name: 'CI', name: 'check', conclusion: 'success' },
          { workflow_name: 'CI', name: 'package', conclusion: 'skipped' },
        ],
      }),
      [jobsCall(12)]: JSON.stringify({
        jobs: [{ workflow_name: 'Labeler', name: 'label', conclusion: null }],
      }),
    });
    const { code, printed } = runIn(gh);
    expect(code).toBe(0);
    expect(printed).toEqual([
      `repository: ${REPO}; head: ${SHA}`,
      'runs on the head: 2',
      'workflows with no run on the head, and their triggers:',
      '  .github/workflows/contract-update.yml: workflow_call',
      '  .github/workflows/desktop.yml: push (tags: desktop-v*); pull_request (paths: apps/desktop/electron-builder.yml, .github/workflows/desktop.yml)',
      '  .github/workflows/release.yml: push (branches: main)',
      'jobs that ran but were skipped (workflow, job):',
      '  CI\tpackage',
    ]);
  });

  it('says none, and warns when the runs pass one page', () => {
    const runs = Object.keys(WORKFLOWS)
      .filter((name) => name.endsWith('.yml'))
      .map((name, index) => ({ id: index, path: `.github/workflows/${name}` }));
    const answers = { [runsCall]: JSON.stringify({ total_count: 150, workflow_runs: runs }) };
    for (const { id } of runs) answers[jobsCall(id)] = JSON.stringify({ jobs: [] });
    const { printed } = runIn(fakeRunner(answers));
    expect(printed).toEqual([
      `repository: ${REPO}; head: ${SHA}`,
      'runs on the head: 5',
      'warning: 150 runs exist and 5 were read (one page)',
      'workflows with no run on the head, and their triggers:',
      '  none',
      'jobs that ran but were skipped (workflow, job):',
      '  none',
    ]);
  });
});
