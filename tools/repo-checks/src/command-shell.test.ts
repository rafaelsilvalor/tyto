import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A repository command (`.claude/commands/<name>.md`) and its Codex port
 * (`.agents/skills/<name>/SKILL.md`) call a script in one line; they never carry a shell loop
 * or a multi-line pipeline (TYTO-629). A loop pasted into a Markdown file is run by an agent
 * that cannot test it, edited by hand in two copies, and broken by every shell that quotes it
 * differently; the same logic in `tools/` has tests and one copy.
 *
 * Only fenced code blocks count, so "done" or a table row in prose does not. A line fails when
 * it holds a `for`/`while`/`until` loop (`… ; do`, a line that is `do`, or `done` where the shell
 * reads a keyword), when it starts or ends with `|` (a pipeline split across lines), or when it
 * ends with `\` (a continued command).
 */

export interface AllowedOffender {
  /** The file, relative to the repository root, with forward slashes. */
  readonly file: string;
  /** The bold label of the numbered step that holds the block, as written. */
  readonly step: string;
  /** The pull request of TYTO-629 that moves the block into a script. */
  readonly removedBy: string;
}

/**
 * The blocks still waiting for their script. This list only shrinks: an entry that no longer
 * matches an offending block fails too, so the PR that moves a block deletes its entries.
 */
export const ALLOWED_OFFENDERS: readonly AllowedOffender[] = [
  ...['.claude/commands/flake-hunt.md', '.agents/skills/flake-hunt/SKILL.md'].flatMap((file) =>
    ['Write the arm script.', 'Compare the failures.'].map((step) => ({
      file,
      step,
      removedBy: 'TYTO-629 PR 3',
    })),
  ),
];

export interface Offender {
  readonly file: string;
  readonly line: number;
  readonly step: string;
  readonly reason: string;
  readonly text: string;
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const STEP = /^\d+\.\s+\*\*(.+?)\*\*/;
const NO_STEP = '(before the first numbered step)';

const RULES: readonly { readonly reason: string; readonly pattern: RegExp }[] = [
  { reason: 'a for/while/until loop', pattern: /\b(?:for|while|until)\b.*;\s*do\b/ },
  { reason: 'a for/while/until loop', pattern: /^\s*do\s*$/ },
  { reason: 'a for/while/until loop', pattern: /(?:^|;)\s*done\b/ },
  { reason: 'a pipeline split across lines', pattern: /^\s*\|/ },
  { reason: 'a pipeline split across lines', pattern: /\|\s*$/ },
  { reason: 'a command continued with \\', pattern: /\\\s*$/ },
];

/** Every line of a fenced block that holds a loop, a split pipeline or a continuation. */
export function findOffenders(file: string, text: string): Offender[] {
  const offenders: Offender[] = [];
  let step = NO_STEP;
  let fence: string | undefined;
  text.split(/\r?\n/).forEach((content, index) => {
    const opener = FENCE.exec(content);
    if (fence === undefined) {
      if (opener !== null) fence = opener[1]!;
      else step = STEP.exec(content)?.[1] ?? step;
      return;
    }
    if (opener !== null && opener[1]![0] === fence[0] && opener[1]!.length >= fence.length) {
      if (content.trim() === opener[1]) {
        fence = undefined;
        return;
      }
    }
    const rule = RULES.find(({ pattern }) => pattern.test(content));
    if (rule !== undefined) {
      offenders.push({ file, line: index + 1, step, reason: rule.reason, text: content.trim() });
    }
  });
  return offenders;
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function commandFiles(): string[] {
  const commands = readdirSync(join(repoRoot, '.claude/commands'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `.claude/commands/${name}`);
  const ports = readdirSync(join(repoRoot, '.agents/skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `.agents/skills/${entry.name}/SKILL.md`);
  return [...commands, ...ports].sort();
}

const isAllowed = (offender: Offender, allowed: readonly AllowedOffender[]) =>
  allowed.some(({ file, step }) => file === offender.file && step === offender.step);

describe('findOffenders', () => {
  const lines = (...content: string[]) => content.join('\n');

  it('names a one-line loop by file, line and step', () => {
    const text = lines(
      '1. **Count.** Run:',
      '',
      '   ```bash',
      '   for f in a b; do echo "$f"; done',
      '   ```',
    );
    expect(findOffenders('x.md', text)).toEqual([
      {
        file: 'x.md',
        line: 4,
        step: 'Count.',
        reason: 'a for/while/until loop',
        text: 'for f in a b; do echo "$f"; done',
      },
    ]);
  });

  it('finds a loop written across lines, a split pipeline and a continuation', () => {
    const text = lines(
      '```sh',
      'while read -r line',
      'do',
      '  echo "$line"',
      'done',
      'git log |',
      '  | head -1',
      'pnpm exec vitest run \\',
      '```',
    );
    expect(findOffenders('x.md', text).map(({ line }) => line)).toEqual([3, 5, 6, 7, 8]);
  });

  it('counts nothing outside a fence: prose, tables and the word done', () => {
    const text = lines(
      'When the loop is done, for each row do this:',
      '',
      '| Arm | Runs |',
      '| --- | ---- |',
      '',
      '```bash',
      'git ls-tree --name-only origin/main docs/adr/ | cut -c10-13 | sort | tail -1',
      'node tools/repo-checks/src/adr-numbers.mjs --next',
      '```',
      'done',
    );
    expect(findOffenders('x.md', text)).toEqual([]);
  });

  it('reads a longer fence to its own closer, past a shorter one inside', () => {
    const text = lines('````markdown', '```bash', '```', 'for x in y; do :; done', '````');
    expect(findOffenders('x.md', text).map(({ line }) => line)).toEqual([4]);
  });
});

describe('Repository commands and their Codex ports (TYTO-629)', () => {
  const offenders = commandFiles().flatMap((file) =>
    findOffenders(file, readFileSync(join(repoRoot, file), 'utf8')),
  );

  it('carry no shell loop or multi-line pipeline, beyond the allowlist', () => {
    const found = offenders
      .filter((offender) => !isAllowed(offender, ALLOWED_OFFENDERS))
      .map(({ file, line, step, reason }) => `${file}:${line} (step "${step}"): ${reason}`);
    expect(
      found,
      'move the block into a script under tools/repo-checks/src and call it in one line',
    ).toEqual([]);
  });

  it('keep no allowlist entry that no longer matches an offending block', () => {
    const stale = ALLOWED_OFFENDERS.filter(
      ({ file, step }) =>
        !offenders.some((offender) => offender.file === file && offender.step === step),
    ).map(({ file, step }) => `${file} (step "${step}")`);
    expect(stale, 'the block moved out: delete its entry from ALLOWED_OFFENDERS').toEqual([]);
  });
});
