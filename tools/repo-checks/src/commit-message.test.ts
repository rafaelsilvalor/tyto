import { spawn } from 'node:child_process';
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
