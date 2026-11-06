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

/**
 * `CLAUDE.md` names every repository command in one sentence, the first thing an agent reads
 * about them. Nothing checked that the list kept up with `.claude/commands/` (TYTO-631).
 *
 * The parse anchors on that sentence and reads only its parenthesis, which may wrap across
 * lines; a `/word` elsewhere in the file is not a list item. When the sentence is reworded
 * and no longer found, the check fails instead of passing on an empty list. `docs/agents.md`
 * carries no list of its own (it says the two folders are the list), so it is not parsed.
 */
const COMMAND_LIST_SENTENCE =
  /Repository\s+commands\s+are\s+in\s+`\.claude\/commands\/`\s+\(([^)]*)\)/;
const COMMAND_LIST_ITEM = /`\/([a-z0-9-]+)`/g;

interface CommandList {
  readonly names: string[];
  /** Whatever the parenthesis holds besides backticked `/name` items, commas and spaces. */
  readonly leftover: string;
}

function commandListIn(text: string): CommandList | undefined {
  const sentence = COMMAND_LIST_SENTENCE.exec(text);
  if (sentence === null) return undefined;
  const inside = sentence[1]!;
  return {
    names: [...inside.matchAll(COMMAND_LIST_ITEM)].map((item) => item[1]!).sort(),
    leftover: inside.replace(COMMAND_LIST_ITEM, '').replace(/[\s,]/g, ''),
  };
}

describe('The command list in CLAUDE.md', () => {
  const commands = commandNames();
  const list = commandListIn(readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8'));
  const listed = list?.names ?? [];

  it('is found, and holds only backticked /name items', () => {
    expect(
      list,
      'CLAUDE.md no longer says "Repository commands are in `.claude/commands/` (...)"; ' +
        'update COMMAND_LIST_SENTENCE in this file to the new wording',
    ).toBeDefined();
    expect(list?.leftover, 'write each item as `/name`, separated by commas').toBe('');
  });

  it('lists no command that has no file', () => {
    const missing = listed.filter((name) => !commands.includes(name));
    expect(
      missing,
      'CLAUDE.md lists these, but .claude/commands/<name>.md does not exist; ' +
        'remove them from the list or add the command',
    ).toEqual([]);
  });

  it('lists every command that has a file', () => {
    const unlisted = commands.filter((name) => !listed.includes(name));
    expect(
      unlisted,
      'add these to the list in CLAUDE.md ("Repository commands are in `.claude/commands/` ' +
        '(...)"), in the same PR',
    ).toEqual([]);
  });
});
