import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Every repository command in `.claude/commands/<name>.md` has a Codex port in
 * `.agents/skills/<name>/SKILL.md`, and a rule changed in one is changed in the other
 * (`CLAUDE.md`, `docs/agents.md`). Nothing checked the pair, and each new command was a
 * chance to forget its port (TYTO-604).
 *
 * The folders are read from disk, not from `git ls-files`, on purpose. The Codex app has
 * been seen writing `.agents/skills/source-command-<name>/SKILL.md` into a worktree on its
 * own, and a `git add -A` swept one into a branch (TYTO-573). An untracked stray folder must
 * fail here, locally, before a commit carries it.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const commandFolder = join(repoRoot, '.claude/commands');
const skillFolder = join(repoRoot, '.agents/skills');

/** The prefix the Codex app gives the skills it migrates from `.claude/commands/`. */
const MIGRATED_PREFIX = 'source-command-';

function commandNames(): string[] {
  return readdirSync(commandFolder)
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.slice(0, -'.md'.length))
    .sort();
}

function skillNames(): string[] {
  return readdirSync(skillFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readSkill(name: string): string {
  return readFileSync(join(skillFolder, name, 'SKILL.md'), 'utf8');
}

/** The YAML between the opening `---` and the next one, or `undefined` when there is none. */
function frontmatter(skill: string): Record<string, unknown> | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(skill);
  if (block === null) return undefined;
  const parsed: unknown = parse(block[1]!);
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, unknown>)
    : undefined;
}

function isFilledString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

describe('Codex ports of the repository commands (.agents/skills)', () => {
  const commands = commandNames();
  const skills = skillNames();

  it('give every command a port', () => {
    const missing = commands.filter((name) => !existsSync(join(skillFolder, name, 'SKILL.md')));
    expect(
      missing,
      'write .agents/skills/<name>/SKILL.md for each of these commands, in the same PR',
    ).toEqual([]);
  });

  it('give every port a command', () => {
    const orphans = skills.filter((name) => !commands.includes(name));
    const migrated = orphans.filter((name) => name.startsWith(MIGRATED_PREFIX));
    const message =
      'each folder needs a .claude/commands/<name>.md, or is deleted' +
      (migrated.length === 0
        ? ''
        : `. Folders named ${MIGRATED_PREFIX}<name> are not ports: the Codex app most likely ` +
          'wrote them on its own, migrating .claude/commands into skills. Delete them; never ' +
          `commit them (${migrated.join(', ')})`);
    expect(orphans, message).toEqual([]);
  });

  it('give every port a frontmatter with its folder name and a description', () => {
    const problems = skills.flatMap((name) => {
      if (!existsSync(join(skillFolder, name, 'SKILL.md'))) return [`${name}: no SKILL.md`];
      const fields = frontmatter(readSkill(name));
      if (fields === undefined) return [`${name}: no --- frontmatter --- block`];
      const found: string[] = [];
      if (fields.name !== name) found.push(`${name}: name is ${JSON.stringify(fields.name)}`);
      if (!isFilledString(fields.description)) found.push(`${name}: no description`);
      return found;
    });
    expect(problems, 'Codex finds a skill by name and picks it by description').toEqual([]);
  });

  it('make every port name its source command file', () => {
    const silent = skills
      .filter((name) => commands.includes(name))
      .filter((name) => !readSkill(name).includes(`.claude/commands/${name}.md`));
    expect(
      silent,
      'say "Codex port of `.claude/commands/<name>.md`" near the top of each of these',
    ).toEqual([]);
  });
});
