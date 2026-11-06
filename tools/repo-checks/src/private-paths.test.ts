import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The repository is public, and the repository commands (`.claude/commands/`) and their Codex
 * ports (`.agents/skills/`) are read by every agent that clones it. Two commands still spelled
 * the maintainer's private folders, user name included (TYTO-628). They now name folders by
 * shape (`<coordination folder>`, `<templates>`), and each command says once how the shape is
 * resolved. This check keeps a real path from coming back.
 *
 * The folders are read from disk, not from `git ls-files`, on purpose, as in
 * `codex-ports.test.ts`: a file written by a tool and not yet tracked must fail here, locally,
 * before a commit carries it into the public history.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scannedFolders = ['.claude/commands', '.agents/skills'];

interface PrivatePathHit {
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

/**
 * A segment the reader resolves, such as `<you>` or `<coordination folder>`. Only angle
 * brackets count: `you`, `USERNAME` or `%USERPROFILE%` look like real names to a reader and to
 * this check alike, and allowing them would let a real name pass by looking like one.
 */
const PLACEHOLDER = /^<[^<>]+>$/;

/**
 * A drive letter not glued to a word, so `https://` (the `s` follows `p`) is not one. The path
 * runs until a space or a quote, and a placeholder may hold spaces.
 */
const DRIVE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?:<[^<>\n]*>|[^\s`'"()<>])*/g;

/** A home folder followed by the user's name: `/Users/<name>`, `/home/<name>`, `\Users\<name>`. */
const HOME_FOLDER = /[\\/](?:Users|home)[\\/](<[^<>\n]*>|[^\s\\/`'"()<>]+)/g;

/**
 * Every private path on each line of a text. A drive-letter path is allowed only when every
 * segment after the drive is a placeholder (`C:/<path>`, a reminder of the form Windows tools
 * want): any literal segment is one machine's layout, and `C:\Users\<you>\...` says no more
 * than a shape such as `<home>` would. A home folder is allowed only when the user segment is a
 * placeholder (`/home/<you>`).
 */
function findPrivatePaths(text: string): PrivatePathHit[] {
  const hits: PrivatePathHit[] = [];
  text.split(/\r?\n/).forEach((content, index) => {
    for (const match of content.matchAll(DRIVE_PATH)) {
      const segments = match[0]
        .slice(3)
        .split(/[\\/]/)
        .filter((segment) => segment !== '');
      if (segments.every((segment) => PLACEHOLDER.test(segment))) continue;
      hits.push({ line: index + 1, text: match[0], reason: 'drive-letter path' });
    }
    for (const match of content.matchAll(HOME_FOLDER)) {
      if (PLACEHOLDER.test(match[1]!)) continue;
      hits.push({ line: index + 1, text: match[0], reason: 'home folder with a user name' });
    }
  });
  return hits;
}

function filesUnder(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('findPrivatePaths', () => {
  it('finds lines shaped like the ones TYTO-628 removed, with a stand-in user name', () => {
    const hits = findPrivatePaths(
      [
        '- **Coordination state is a file:** `C:\\Users\\someone\\notes\\<name>.md`',
        '`git -C C:/Users/someone/notes pull --rebase`, then read `_registro.md`.',
      ].join('\n'),
    );
    expect(hits).toEqual([
      { line: 1, text: 'C:\\Users\\someone\\notes\\<name>.md', reason: 'drive-letter path' },
      { line: 1, text: '\\Users\\someone', reason: 'home folder with a user name' },
      { line: 2, text: 'C:/Users/someone/notes', reason: 'drive-letter path' },
      { line: 2, text: '/Users/someone', reason: 'home folder with a user name' },
    ]);
  });

  it('finds a home folder without a drive, and a drive without a home folder', () => {
    expect(findPrivatePaths('see /home/someone/notes and /Users/someone')).toHaveLength(2);
    expect(findPrivatePaths('the checkout in D:\\work\\tyto')).toEqual([
      { line: 1, text: 'D:\\work\\tyto', reason: 'drive-letter path' },
    ]);
  });

  it('lets placeholders, URLs and Unix paths pass', () => {
    const allowed = [
      '`/home/<you>/notes` and `/Users/<you>`',
      '`\\Users\\<user>\\` on Windows',
      'Python wants Windows paths (`C:/<path>`), not `/c/<path>`.',
      'git clone https://github.com/<owner>/tyto.git <templates>/tyto',
      'curl http://127.0.0.1:4174/api/state',
      '`<coordination folder>/<name>.md` and `<main checkout>/apps/desktop`',
    ];
    expect(findPrivatePaths(allowed.join('\n'))).toEqual([]);
  });

  it('refuses a drive-letter path even when its user segment is a placeholder', () => {
    expect(findPrivatePaths('`C:\\Users\\<you>\\notes`')).toEqual([
      { line: 1, text: 'C:\\Users\\<you>\\notes', reason: 'drive-letter path' },
    ]);
  });
});

describe('repository commands and Codex ports name no private machine path', () => {
  it('hold no drive-letter path and no home folder with a user name', () => {
    const found = scannedFolders.flatMap((folder) =>
      filesUnder(join(repoRoot, folder)).flatMap((file) =>
        findPrivatePaths(readFileSync(file, 'utf8')).map(
          (hit) =>
            `${relative(repoRoot, file).replaceAll('\\', '/')}:${hit.line}: ${hit.reason}: ${hit.text}`,
        ),
      ),
    );
    expect(
      found,
      'name the folder by a shape the reader resolves (`<coordination folder>`, `<templates>`, ' +
        '`/home/<you>`), and say once in the file where the shape is configured (TYTO-628)',
    ).toEqual([]);
  });
});
