import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Commits and PR descriptions carry no attribution: no co-author trailer, no link to the
 * session that wrote them, no tool footer (TYTO-234). The repository is public, and on
 * 2026-10-05 a cloud session that had never seen the maintainer's local instructions
 * committed with the first two.
 *
 * Two layers, pinned separately. `.claude/settings.json` asks every session that reads it
 * not to write them; the `no-attribution-trailers` commitlint rule refuses them whether or
 * not a session listened, on the branch's commits and on the PR description that squash
 * merge turns into the commit body on `main`. Run against the real binary, like
 * `commit-message.test.ts`, because what CI enforces is `commitlint` reading the config.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const COMMITLINT = join(repoRoot, 'node_modules/@commitlint/cli/cli.js');

/** The exit code `commitlint` gives a message, the way the `lint` job reads it. */
function lintMessage(message: string, config?: string): Promise<{ code: number; output: string }> {
  const args = config === undefined ? [COMMITLINT] : [COMMITLINT, '--config', config];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: repoRoot });
    let output = '';

    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, output }));

    child.stdin.end(`${message}\n`);
  });
}

const SUBJECT = 'chore(repo): TYTO-234 add an empty commit to check the toolchain';
const BODY = 'No-op commit that changes no file.';

const refused = [
  [
    'the trailer the cloud session wrote',
    `${SUBJECT}\n\n${BODY}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`,
  ],
  [
    'the session link it wrote under it',
    `${SUBJECT}\n\n${BODY}\n\nClaude-Session: https://claude.ai/code/session_0000`,
  ],
  ['a co-author in lower case', `${SUBJECT}\n\n${BODY}\n\nco-authored-by: Someone <a@b.c>`],
  ['a co-author in upper case', `${SUBJECT}\n\n${BODY}\n\nCO-AUTHORED-BY: Someone <a@b.c>`],
  ['a session link in lower case', `${SUBJECT}\n\n${BODY}\n\nclaude-session: https://x`],
  [
    'the footer a PR description carries into the squash commit',
    `${SUBJECT}\n\n## Summary\n\n${BODY}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`,
  ],
  [
    'a trailer in a description saved with Windows line endings',
    `${SUBJECT}\r\n\r\n${BODY}\r\n\r\nCo-Authored-By: Claude <noreply@anthropic.com>\r\n`,
  ],
] as const;

const accepted = [
  ['a plain commit', `${SUBJECT}\n\n${BODY}`],
  [
    'prose that names a trailer mid-line',
    `${SUBJECT}\n\nThe rule refuses a \`Co-Authored-By:\` line and a \`Claude-Session:\` line.`,
  ],
  [
    'the trailer Dependabot signs its own commits with',
    'chore(deps): Bump vitest from 3 to 4\n\nBumps vitest.\n\n' +
      'Signed-off-by: dependabot[bot] <support@github.com>',
  ],
] as const;

describe('the attribution rule', () => {
  it.each(refused)('refuses %s', async (_name, message) => {
    const { code, output } = await lintMessage(message);
    expect(code, `${JSON.stringify(message)} was accepted`).not.toBe(0);
    expect(output).toContain('[no-attribution-trailers]');
  });

  it.each(accepted)('accepts %s', async (_name, message) => {
    const { code, output } = await lintMessage(message);
    expect(code, output).toBe(0);
  });
});

/**
 * The PR description, as `commitlint.yml` hands it over: title, blank line, markdown. The
 * commit parser starts the footer at the first `word: ` line — `title: '…'` in a quoted
 * Dependabot release note, `Load: …` in one of ours — and every line after it longer than
 * 100 characters and without a URL fails `footer-max-line-length`. That refused 3 of 5
 * real descriptions under the full ruleset, which is why the description has a config of
 * its own.
 */
const DESCRIPTION_CONFIG = 'commitlint.description.config.js';
const LONG_MARKDOWN =
  '## Measured\n\nLoad: a CPU burner, one busy worker thread per core, 12 on 12.\n\n' +
  '| Run | Result | Note |\n| --- | --- | --- |\n' +
  '| 4 of 10 | red | the panel command arrived after the fixed wait, so the assertion read the old layout |';

describe('the PR description rule', () => {
  it('accepts a long markdown description the full commit ruleset refuses', async () => {
    const description = `${SUBJECT}\n\n${LONG_MARKDOWN}`;
    expect((await lintMessage(description)).code, 'the full ruleset now accepts it').not.toBe(0);
    const { code, output } = await lintMessage(description, DESCRIPTION_CONFIG);
    expect(code, output).toBe(0);
  });

  it.each([
    ['a co-author trailer', 'Co-Authored-By: Claude <noreply@anthropic.com>'],
    ['a session link', 'Claude-Session: https://claude.ai/code/session_0000'],
    ['the tool footer', '🤖 Generated with [Claude Code](https://claude.com/claude-code)'],
  ])('refuses %s in the description', async (_name, line) => {
    const { code, output } = await lintMessage(
      `${SUBJECT}\n\n${LONG_MARKDOWN}\n\n${line}`,
      DESCRIPTION_CONFIG,
    );
    expect(code, 'the description was accepted').not.toBe(0);
    expect(output).toContain('[no-attribution-trailers]');
  });

  it('take the same rule object as the commit config, and nothing else', async () => {
    type Config = {
      plugins: { rules: Record<string, unknown> }[];
      rules: Record<string, unknown>;
    };
    const load = async (file: string) =>
      ((await import(pathToFileURL(join(repoRoot, file)).href)) as { default: Config }).default;
    const commit = await load('commitlint.config.js');
    const description = await load(DESCRIPTION_CONFIG);

    const ruleIn = (config: Config) =>
      config.plugins.find((plugin) => 'no-attribution-trailers' in plugin.rules)?.rules[
        'no-attribution-trailers'
      ];
    expect(ruleIn(description)).toBeDefined();
    expect(ruleIn(description)).toBe(ruleIn(commit));
    expect(description.rules).toEqual({ 'no-attribution-trailers': [2, 'always'] });
    expect(commit.rules['no-attribution-trailers']).toEqual([2, 'always']);
  });
});

describe('the committed session settings', () => {
  const settings = JSON.parse(readFileSync(join(repoRoot, '.claude/settings.json'), 'utf8')) as {
    attribution?: unknown;
  };

  it('turn off the commit trailer, the PR footer and the session link', () => {
    expect(settings.attribution).toEqual({ commit: '', pr: '', sessionUrl: false });
  });

  it('set nothing else, so a local session keeps its own permissions and hooks', () => {
    // A project file merges over the maintainer's user settings and wins on any key it
    // names. Attribution is the one key this file exists for.
    expect(Object.keys(settings)).toEqual(['attribution']);
  });
});
