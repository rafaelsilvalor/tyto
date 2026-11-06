import { describe, expect, it } from 'vitest';

import {
  adrNumberOf,
  adrsAddedByPullRequest,
  findClashes,
  nextNumber,
  PULL_REQUEST_LIMIT,
  run,
} from './adr-numbers.mjs';

const REPO = 'someone/tyto';

/** A runner that answers only the calls it was given, and throws on any other. */
function fakeRunner(answers) {
  return (args) => {
    const key = args.join(' ');
    if (!(key in answers)) throw new Error(`unexpected call: ${key}`);
    return answers[key];
  };
}

const filesCall = (number) =>
  `api --paginate repos/${REPO}/pulls/${number}/files?per_page=100 --jq .[] | [.status, .filename] | @tsv`;
const listCall = `pr list --repo ${REPO} --state open --limit ${PULL_REQUEST_LIMIT} --json number,headRefName`;

/**
 * Origin/main holds 0001 to 0003. PR #10 is this branch's own and adds 0004; PR #11 adds 0004
 * too, from another branch; PR #12 renames a draft into 0005 and deletes an old ADR.
 */
function world({ mine = ['docs/adr/0004-mine.md'], branch = 'feat/TYTO-1-mine' } = {}) {
  const git = fakeRunner({
    'remote get-url origin': `https://github.com/${REPO}.git\n`,
    'ls-tree --name-only origin/main docs/adr/':
      'docs/adr/0001-a.md\ndocs/adr/0002-b.md\ndocs/adr/0003-c.md\n',
    'diff --name-only --diff-filter=A origin/main...HEAD -- docs/adr/': mine.join('\n'),
    'branch --show-current': `${branch}\n`,
  });
  const gh = fakeRunner({
    [listCall]: JSON.stringify([
      { number: 10, headRefName: 'feat/TYTO-1-mine' },
      { number: 11, headRefName: 'feat/TYTO-2-other' },
      { number: 12, headRefName: 'docs/TYTO-3-rename' },
    ]),
    [filesCall(10)]: 'added\tdocs/adr/0004-mine.md\nmodified\tREADME.md\n',
    [filesCall(11)]: 'added\tdocs/adr/0004-other.md\n',
    [filesCall(12)]:
      'renamed\tdocs/adr/0005-renamed.md\nremoved\tdocs/adr/0002-b.md\nmodified\tdocs/adr/0003-c.md\n',
  });
  return { git, gh };
}

function runIn(options, io) {
  const printed = [];
  const code = run(
    { next: false, check: false, base: 'origin/main', head: 'HEAD', ...options },
    { ...io, print: (line) => printed.push(line) },
  );
  return { code, printed };
}

describe('adrNumberOf', () => {
  it('reads the four digits of an ADR file and nothing else', () => {
    expect(adrNumberOf('docs/adr/0169-a-line-never-starts.md')).toBe('0169');
    expect(adrNumberOf('docs/adr/README.md')).toBeUndefined();
    expect(adrNumberOf('docs/adr/drafts/0170-x.md')).toBeUndefined();
    expect(adrNumberOf('apps/docs/adr/0170-x.md')).toBeUndefined();
  });
});

describe('adrsAddedByPullRequest', () => {
  it('keeps added and renamed ADR files, as the shell loops did, and drops the rest', () => {
    const { gh } = world();
    expect(adrsAddedByPullRequest({ gh, repo: REPO, number: 12 })).toEqual([
      'docs/adr/0005-renamed.md',
    ]);
  });

  it('reads the paginated REST file list, which passes 100 files', () => {
    const many = Array.from({ length: 150 }, (_, index) => `added\tsrc/file-${index}.ts`);
    const gh = fakeRunner({ [filesCall(7)]: [...many, 'added\tdocs/adr/0200-late.md'].join('\n') });
    expect(adrsAddedByPullRequest({ gh, repo: REPO, number: 7 })).toEqual([
      'docs/adr/0200-late.md',
    ]);
  });
});

describe('nextNumber', () => {
  it('takes the highest of origin/main and the open pull requests, plus one', () => {
    const result = nextNumber({
      onMain: ['docs/adr/0001-a.md', 'docs/adr/0169-b.md'],
      pullRequests: [{ number: 5, headRefName: 'x', adrs: ['docs/adr/0171-c.md'] }],
    });
    expect(result).toMatchObject({ highestOnMain: '0169', highestInPullRequests: '0171' });
    expect(result.next).toBe('0172');
  });

  it('names a number two files on origin/main share', () => {
    const result = nextNumber({
      onMain: ['docs/adr/0007-a.md', 'docs/adr/0007-b.md', 'docs/adr/0008-c.md'],
      pullRequests: [],
    });
    expect(result.sharedOnMain).toEqual(['0007']);
    expect(result.next).toBe('0009');
  });

  it('starts at 0001 in a repository with no ADR', () => {
    expect(nextNumber({ onMain: [], pullRequests: [] }).next).toBe('0001');
  });
});

describe('findClashes', () => {
  const pullRequests = [
    { number: 10, headRefName: 'feat/TYTO-1-mine', adrs: ['docs/adr/0004-mine.md'] },
    { number: 11, headRefName: 'feat/TYTO-2-other', adrs: ['docs/adr/0004-other.md'] },
  ];

  it('skips the pull request whose head is this branch', () => {
    const clashes = findClashes({
      mine: ['docs/adr/0004-mine.md'],
      onMain: [],
      pullRequests,
      branch: 'feat/TYTO-1-mine',
    });
    expect(clashes).toEqual([
      { file: 'docs/adr/0004-mine.md', against: 11, other: 'docs/adr/0004-other.md' },
    ]);
  });

  it('finds a number origin/main already uses', () => {
    const clashes = findClashes({
      mine: ['docs/adr/0002-mine.md'],
      onMain: ['docs/adr/0001-a.md', 'docs/adr/0002-b.md'],
      pullRequests: [],
      branch: 'feat/TYTO-1-mine',
    });
    expect(clashes).toEqual([
      { file: 'docs/adr/0002-mine.md', against: 'origin/main', other: 'docs/adr/0002-b.md' },
    ]);
  });

  it('finds nothing for a branch that adds no ADR', () => {
    expect(findClashes({ mine: [], onMain: [], pullRequests, branch: 'x' })).toEqual([]);
  });
});

describe('run', () => {
  it('--next prints every open PR that adds an ADR and the next free number', () => {
    const { code, printed } = runIn({ next: true }, world());
    expect(code).toBe(0);
    expect(printed).toContain('highest on origin/main: 0003');
    expect(printed).toContain('  PR #12: docs/adr/0005-renamed.md');
    expect(printed).toContain('next free: 0006');
  });

  it('--check fails naming the other PR, and not this branch own PR', () => {
    const { code, printed } = runIn({ check: true }, world());
    expect(code).toBe(1);
    expect(printed).toContain('docs/adr/0004-mine.md clashes with PR #11: docs/adr/0004-other.md');
    expect(printed.join('\n')).not.toContain('PR #10');
  });

  it('--check fails naming the file on origin/main', () => {
    const { code, printed } = runIn({ check: true }, world({ mine: ['docs/adr/0003-mine.md'] }));
    expect(code).toBe(1);
    expect(printed).toContain('docs/adr/0003-mine.md clashes with origin/main: docs/adr/0003-c.md');
  });

  it('--check passes a branch with a free number', () => {
    const { code, printed } = runIn({ check: true }, world({ mine: ['docs/adr/0006-mine.md'] }));
    expect(code).toBe(0);
    expect(printed).toContain('no clash');
  });

  it('--check passes a branch that adds no ADR', () => {
    const { code, printed } = runIn({ check: true }, world({ mine: [] }));
    expect(code).toBe(0);
    expect(printed).toContain('ADRs this branch adds: none');
  });

  it('warns when the open pull requests fill a whole page', () => {
    const full = Array.from({ length: PULL_REQUEST_LIMIT }, (_, index) => ({
      number: index + 1,
      headRefName: `b${index}`,
    }));
    const answers = { [listCall]: JSON.stringify(full) };
    for (const { number } of full) answers[filesCall(number)] = '';
    const { git } = world();
    const { printed } = runIn({ next: true, repo: REPO }, { git, gh: fakeRunner(answers) });
    expect(printed.some((line) => line.startsWith('warning:'))).toBe(true);
  });
});
