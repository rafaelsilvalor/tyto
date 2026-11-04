import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The Jira key is required so that every commit on `main` traces back to the card that
 * justified it, and `lint` is a required status check so that the rule cannot be skipped.
 * TYTO-76 opened one hole in it — `chore(deps)` — because Dependabot writes its own commits
 * and has no card to name, and a required check it can never pass makes the robot useless.
 *
 * A hole is worth exactly as much as its edges, so the edges are pinned here: the exemption
 * is one type and two scopes, and everything on the other side of it still fails. Run
 * against the real binary rather than against the rule function, because what CI enforces
 * is `commitlint` reading `commitlint.config.js`, not a function called in isolation.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const COMMITLINT = join(repoRoot, 'node_modules/@commitlint/cli/cli.js');

/** The exit code `commitlint` gives a message, the way the `lint` job reads it. */
function lintMessage(message: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [COMMITLINT], { cwd: repoRoot });
    let output = '';

    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, output }));

    child.stdin.end(`${message}\n`);
  });
}

const accepted = [
  ['the house style', 'feat(core): TYTO-123 add Frame schema'],
  ['a Dependabot action bump', 'chore(deps): Bump actions/setup-node from 4 to 7'],
  ['a Dependabot npm dev bump', 'chore(deps-dev): Bump vitest from 3 to 4'],
  [
    'a grouped bump, which is how Dependabot titles more than one',
    'chore(deps): Bump the github-actions group with 5 updates',
  ],
  [
    'a dependency bump a person wrote, with a card',
    'chore(deps): TYTO-76 pin the action to a digest',
  ],
] as const;

const refused = [
  ['a keyless commit in a real package', 'chore(core): tidy the manifest'],
  ['a keyless feature', 'feat(core): add a Frame schema'],
  ['a bump with no scope at all', 'chore: Bump actions/setup-node from 4 to 7'],
  [
    'a scope that only looks like the exempt one',
    'chore(dependencies): Bump actions/setup-node from 4 to 7',
  ],
  ['the exempt scope on another type', 'fix(deps): Bump actions/setup-node from 4 to 7'],
] as const;

describe('the commit message rule', () => {
  it.each(accepted)('accepts %s', async (_name, message) => {
    const { code, output } = await lintMessage(message);
    expect(code, output).toBe(0);
  });

  it.each(refused)('refuses %s', async (_name, message) => {
    const { code, output } = await lintMessage(message);
    expect(code, `"${message}" was accepted`).not.toBe(0);
    expect(output).toContain('subject-jira-key');
  });
});

/**
 * AGENTS.md › Commits, enforced since TYTO-603: a header of at most 72 characters, and no
 * body paragraph that opens with `Word: `, which the conventional-commits parser files as a
 * footer. Each rule is pinned at its edge, and the real commits robots write are linted as
 * they are, because `lint` is a required check on their pull requests too.
 */
const KEYED = 'feat(core): TYTO-123 ';

/** A header of exactly `length` characters in the house style. */
function headerOf(length: number): string {
  return KEYED + 'a'.repeat(length - KEYED.length);
}

const SUBJECT = 'chore(repo): TYTO-603 check the commit body';

/**
 * Real commit messages, copied verbatim from `gh api repos/rafaelsilvalor/tyto/pulls/<n>/
 * commits` on 2026-11-03: the two Dependabot pull requests open that day. The body tables
 * carry lines over 100 characters, the `---` block opens with `updated-dependencies:`, and
 * the message ends in `Signed-off-by:`. The Changesets version PR's own commit (#300) is
 * the bare `chore(release): TYTO-0 version packages`, accepted below; the body its squash
 * commit carries on `main` is the PR description, which this config never reads.
 */
const fixtures = join(repoRoot, 'tools/repo-checks/src/__fixtures__/commit-messages');
const robotCommits = [
  ['Dependabot, PR #165', readFileSync(join(fixtures, 'dependabot-pr-165.txt'), 'utf8')],
  ['Dependabot, PR #166', readFileSync(join(fixtures, 'dependabot-pr-166.txt'), 'utf8')],
  ['the Changesets version PR, #300', 'chore(release): TYTO-0 version packages'],
] as const;

describe('the header length rule', () => {
  it('accepts a header of 72 characters', async () => {
    const { code, output } = await lintMessage(headerOf(72));
    expect(code, output).toBe(0);
  });

  it('refuses a header of 73 characters', async () => {
    const { code, output } = await lintMessage(headerOf(73));
    expect(code).not.toBe(0);
    expect(output).toContain('header-max-length');
  });
});

const paragraphsAccepted = [
  ['a plain body', `${SUBJECT}\n\nThe body explains why.`],
  ['a breaking change footer', `${SUBJECT}\n\nWhy.\n\nBREAKING CHANGE: the flag is gone`],
  ['the hyphenated breaking change footer', `${SUBJECT}\n\nWhy.\n\nBREAKING-CHANGE: gone`],
  ['a reference footer', `${SUBJECT}\n\nWhy.\n\nRefs: TYTO-570`],
  ['a sign-off', `${SUBJECT}\n\nWhy.\n\nSigned-off-by: Someone <a@b.c>`],
  [
    'a `Word: ` line inside a paragraph rather than opening it',
    `${SUBJECT}\n\nThe paragraph opens with prose\nContext: and continues here.`,
  ],
  ['a colon with no space after it', `${SUBJECT}\n\nNote:the colon is glued.`],
  ['a paragraph opening with a list item', `${SUBJECT}\n\n- Context: in a list`],
] as const;

const paragraphsRefused = [
  ['a paragraph opening with `Context: `', `${SUBJECT}\n\nWhy.\n\nContext: the gap`],
  ['the first body paragraph opening with one', `${SUBJECT}\n\nPerturbation: put back`],
  ['a lower-case token', `${SUBJECT}\n\nWhy.\n\nlocal: typecheck and lint`],
  ['a token that only resembles an allowed one', `${SUBJECT}\n\nWhy.\n\nRef: TYTO-570`],
  ['a hyphenated token', `${SUBJECT}\n\nWhy.\n\nFollow-up: TYTO-604`],
  ['one written with Windows line endings', `${SUBJECT}\r\n\r\nWhy.\r\n\r\nLocal: lint`],
] as const;

describe('the footer-shaped paragraph rule', () => {
  it.each(paragraphsAccepted)('accepts %s', async (_name, message) => {
    const { code, output } = await lintMessage(message);
    expect(code, output).toBe(0);
  });

  it.each(paragraphsRefused)('refuses %s', async (_name, message) => {
    const { code, output } = await lintMessage(message);
    expect(code, `"${message}" was accepted`).not.toBe(0);
    expect(output).toContain('body-no-footer-paragraph');
  });
});

describe('the commits robots write', () => {
  it.each(robotCommits)('accepts %s as written', async (_name, message) => {
    const { code, output } = await lintMessage(message);
    expect(code, output).toBe(0);
  });
});
