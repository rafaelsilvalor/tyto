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

/**
 * A port says what its command says (TYTO-630). The checks above prove that a port exists and
 * names its source; they passed on a PR that edited a command and left its port behind.
 *
 * Both files are reduced to a skeleton and the skeletons are compared. The skeleton is
 * extracted, not declared with markers: markers rot, and nobody adds them to a new command.
 * It is the ordered list of `##` and `###` headings and, under each, the top-level numbered
 * steps (`1. `), each with its number and its bold label when it has one (`1. **Label**`),
 * since that is how a step is named. The frontmatter, the `#` title, prose, nested lists and
 * everything inside a fenced code block are left out: that is where the two tools' names
 * differ (`docs/agents.md`).
 */
export interface AllowedPortDifference {
  readonly command: string;
  /** The skeleton line as the command has it; alone, a line only the command has. */
  readonly inCommand?: string;
  /** The skeleton line as the port has it; alone, a line only the port has. */
  readonly inPort?: string;
  readonly reason: string;
}

/**
 * Every skeleton difference a pair may keep, each because the two tools differ there. With
 * both sides, the port's line counts as the command's; with one side, the line is skipped.
 * The last test below fails on an entry that no longer matches anything.
 */
export const ALLOWED_PORT_DIFFERENCES: readonly AllowedPortDifference[] = [
  {
    command: 'coordinate',
    inCommand: '### Starting an internal executor',
    reason: 'the Agent tool is Claude Code only; Codex starts a thread (docs/agents.md)',
  },
  {
    command: 'coordinate',
    inCommand: '### When a separate session is still right',
    reason: 'start_session exists only in the Claude desktop app (docs/agents.md)',
  },
  {
    command: 'coordinate',
    inCommand: '### A cloud executor',
    reason:
      'start_session in the cloud is Claude desktop only; a Codex cloud executor is not measured',
  },
  {
    command: 'coordinate',
    inCommand: '## Session template',
    reason: 'the prompt for start_session, which Codex lacks (docs/agents.md)',
  },
  {
    command: 'coordinate',
    inPort: '### Starting and reaching an executor',
    reason: 'codex exec and resume replace the Agent tool and SendMessage (docs/agents.md)',
  },
  {
    command: 'handoff',
    inCommand: '5. Propose one name for the next session',
    inPort: '5. Propose one name for the next thread',
    reason: 'a Claude Code session is a Codex thread (docs/agents.md)',
  },
  {
    command: 'loose-ends',
    inCommand: '9. Create on approval, through `/card`.',
    inPort: '9. Create on approval, through the card skill.',
    reason: 'a command is a skill in Codex (docs/agents.md)',
  },
  {
    command: 'new-template',
    inCommand: "## 4. The repository, only after Rafael's OK",
    inPort: "## 4. The repository, only after the maintainer's OK",
    reason: 'the ports name the maintainer by his role throughout',
  },
  {
    command: 'new-template',
    inCommand: '## 5. Build it live with Rafael, measuring on the PNG',
    inPort: '## 5. Build it live with the maintainer, measuring on the PNG',
    reason: 'the ports name the maintainer by his role throughout',
  },
];

const HEADING = /^(#{2,3})\s+(.*?)\s*#*\s*$/;
const STEP = /^(\d+)\.\s+(?:\*\*(.+?)\*\*)?/;
const FENCE = /^\s*(`{3,}|~{3,})/;

function skeletonOf(markdown: string): string[] {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const lines: string[] = [];
  let openFence: string | undefined;
  for (const line of body.split(/\r?\n/)) {
    const fence = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      if (openFence === undefined) openFence = fence;
      else if (fence[0] === openFence[0] && fence.length >= openFence.length) {
        openFence = undefined;
      }
      continue;
    }
    if (openFence !== undefined) continue;
    const heading = HEADING.exec(line);
    if (heading !== null) {
      lines.push(`${heading[1]} ${heading[2]}`);
      continue;
    }
    const step = STEP.exec(line);
    if (step !== null) lines.push(step[2] === undefined ? `${step[1]}.` : `${step[1]}. ${step[2]}`);
  }
  return lines;
}

function isHeading(line: string | undefined): boolean {
  return line?.startsWith('#') ?? false;
}

function shown(line: string | undefined): string {
  return line === undefined ? 'nothing more' : `"${line}"`;
}

/** The first place two skeletons differ, named as a reader finds it, or `undefined`. */
function firstDifference(name: string, command: string[], port: string[]): string | undefined {
  const length = Math.max(command.length, port.length);
  for (let index = 0; index < length; index += 1) {
    const inCommand = command[index];
    const inPort = port[index];
    if (inCommand === inPort) continue;
    const section = command
      .slice(0, index)
      .reverse()
      .find((line) => isHeading(line));
    const where =
      section === undefined
        ? 'before the first heading'
        : `section "${section.replace(/^#+ /, '')}"`;
    const stepLine = [inCommand, inPort].find(
      (line): line is string => line !== undefined && !isHeading(line),
    );
    const what = stepLine === undefined ? 'next heading' : `step ${/^\d+/.exec(stepLine)![0]}`;
    return `${name}: ${where}, ${what}: the command has ${shown(inCommand)}, the port has ${shown(inPort)}`;
  }
  return undefined;
}

function withAllowedDifferences(
  name: string,
  command: string[],
  port: string[],
): { command: string[]; port: string[] } {
  let commandLines = command;
  let portLines = port;
  for (const allowed of ALLOWED_PORT_DIFFERENCES.filter((entry) => entry.command === name)) {
    const { inCommand, inPort } = allowed;
    if (inCommand !== undefined && inPort !== undefined) {
      portLines = portLines.map((line) => (line === inPort ? inCommand : line));
    } else if (inCommand !== undefined) {
      commandLines = commandLines.filter((line) => line !== inCommand);
    } else if (inPort !== undefined) {
      portLines = portLines.filter((line) => line !== inPort);
    }
  }
  return { command: commandLines, port: portLines };
}

/** Whether an allowed difference still matches the pair it names. */
function isStillNeeded(allowed: AllowedPortDifference, command: string[], port: string[]): boolean {
  const { inCommand, inPort } = allowed;
  if (inCommand !== undefined && inPort !== undefined) {
    return command.includes(inCommand) && port.includes(inPort);
  }
  if (inCommand !== undefined) return command.includes(inCommand) && !port.includes(inCommand);
  if (inPort !== undefined) return port.includes(inPort) && !command.includes(inPort);
  return false;
}

describe('The skeleton of a command or a port', () => {
  it('keeps headings and numbered steps with their labels, and drops the rest', () => {
    const markdown = [
      '---',
      'name: x',
      '---',
      '# Title',
      'Prose with 1. a number inside.',
      '1. **First.** Before any heading.',
      '## Section',
      '2. Unlabeled step.',
      '   1. A nested step.',
      '- a bullet',
      '### Sub ##',
    ].join('\n');
    expect(skeletonOf(markdown)).toEqual(['1. First.', '## Section', '2.', '### Sub']);
  });

  it('ignores headings and steps inside fenced code blocks', () => {
    const markdown = [
      '## Real',
      '```sh',
      '## not a heading',
      '1. not a step',
      '~~~',
      '```',
      '   ````md',
      '   ```',
      '   2. still inside',
      '   ````',
      '3. **After.**',
    ].join('\n');
    expect(skeletonOf(markdown)).toEqual(['## Real', '3. After.']);
  });

  it('names a heading that changed', () => {
    const command = skeletonOf('## One\n1. **A**\n## Two\n');
    const port = skeletonOf('## One\n1. **A**\n## Deux\n');
    expect(firstDifference('x', command, port)).toBe(
      'x: section "One", next heading: the command has "## Two", the port has "## Deux"',
    );
  });

  it('names the step a command added and its port lacks', () => {
    const command = skeletonOf('## One\n1. **A**\n2. **B**\n## Two\n');
    const port = skeletonOf('## One\n1. **A**\n## Two\n');
    expect(firstDifference('x', command, port)).toBe(
      'x: section "One", step 2: the command has "2. B", the port has "## Two"',
    );
  });

  it('names a step whose label changed', () => {
    const command = skeletonOf('## One\n1. **A**\n2. **B**\n');
    const port = skeletonOf('## One\n1. **A**\n2. **C**\n');
    expect(firstDifference('x', command, port)).toBe(
      'x: section "One", step 2: the command has "2. B", the port has "2. C"',
    );
  });

  it('finds no difference between equal skeletons', () => {
    expect(firstDifference('x', ['## A', '1. B'], ['## A', '1. B'])).toBeUndefined();
  });
});

describe('Every Codex port follows its command step by step', () => {
  const pairs = commandNames()
    .filter((name) => existsSync(join(skillFolder, name, 'SKILL.md')))
    .map((name) => ({
      name,
      command: skeletonOf(readFileSync(join(commandFolder, `${name}.md`), 'utf8')),
      port: skeletonOf(readSkill(name)),
    }));

  it('has the headings and numbered steps of its command', () => {
    const differences = pairs.flatMap(({ name, command, port }) => {
      const compared = withAllowedDifferences(name, command, port);
      return firstDifference(name, compared.command, compared.port) ?? [];
    });
    expect(
      differences,
      'a heading or step changed in one file and not in the other: change both in the same ' +
        'PR or, where the two tools truly differ, add an entry with its reason to ' +
        'ALLOWED_PORT_DIFFERENCES',
    ).toEqual([]);
  });

  it('needs every allowed difference', () => {
    const stale = ALLOWED_PORT_DIFFERENCES.filter((allowed) => {
      const pair = pairs.find(({ name }) => name === allowed.command);
      return pair === undefined || !isStillNeeded(allowed, pair.command, pair.port);
    });
    expect(
      stale.map((allowed) => `${allowed.command}: ${allowed.inCommand ?? allowed.inPort}`),
      'these entries match nothing any more; delete them from ALLOWED_PORT_DIFFERENCES',
    ).toEqual([]);
  });
});
