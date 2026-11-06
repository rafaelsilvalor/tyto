/**
 * How the scripts behind the repository commands reach git and GitHub (TYTO-629). Each
 * command in `.claude/commands/` and its Codex port used to carry its own shell loop over `git`
 * and `gh`; the scripts that replace those loops share this file, so every one of them reads
 * the same repository the same way and takes the same fakes in its tests.
 *
 * Plain JavaScript and Node only, like `ci-scope.mjs`: nothing to build before a command runs.
 * Every function takes its runner as an argument, so a test passes a fake and no test reaches
 * the network or the real repository.
 */
import { execFileSync } from 'node:child_process';

/**
 * A `gh api --paginate` answer or a long `git ls-tree` can pass the 1 MiB default of
 * `execFileSync`, which then throws `ENOBUFS` as if the command had failed.
 */
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * @typedef {(args: string[], options?: { cwd?: string }) => string} Runner
 */

/** @type {Runner} */
export function git(args, { cwd } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER });
}

/** @type {Runner} */
export function gh(args, { cwd } = {}) {
  return execFileSync('gh', args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER });
}

/**
 * Runs `gh` and parses its standard output as JSON.
 *
 * @param {string[]} args
 * @param {{ gh?: Runner, cwd?: string }} [options]
 * @returns {unknown}
 */
export function ghJson(args, { gh: run = gh, cwd } = {}) {
  const output = run(args, { cwd });
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`gh ${args.join(' ')} did not print JSON: ${output.slice(0, 200)}`);
  }
}

/**
 * The `owner/name` a GitHub remote URL points at, in any of the shapes git writes it:
 * `https://github.com/o/n(.git)`, `git@github.com:o/n(.git)`, `ssh://git@github.com/o/n(.git)`.
 * `undefined` for anything that is not a GitHub URL.
 *
 * @param {string} url
 * @returns {string | undefined}
 */
export function repoFromRemoteUrl(url) {
  const match = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?\s*$/u.exec(url.trim());
  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

/**
 * The repository the commands talk to: `--repo` when given, otherwise the one `origin`
 * points at. A command never guesses the repository from a hard-coded name, so a fork runs
 * against itself.
 *
 * @param {{ repo?: string, git?: Runner, cwd?: string }} [options]
 * @returns {string}
 */
export function resolveRepo({ repo, git: run = git, cwd } = {}) {
  if (repo !== undefined && repo !== '') {
    if (!/^[^/\s]+\/[^/\s]+$/u.test(repo)) throw new Error(`--repo must be owner/name: ${repo}`);
    return repo;
  }
  const url = run(['remote', 'get-url', 'origin'], { cwd });
  const found = repoFromRemoteUrl(url);
  if (found === undefined) {
    throw new Error(`origin is not a GitHub remote (${url.trim()}); pass --repo owner/name`);
  }
  return found;
}

/**
 * Reads `--flag value` pairs and bare `--flag` switches. A value never starts with `--`, so a
 * switch followed by another flag stays a switch.
 *
 * @param {string[]} argv
 * @returns {Record<string, string | true>}
 */
export function parseFlags(argv) {
  /** @type {Record<string, string | true>} */
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (!argument.startsWith('--')) throw new Error(`unexpected argument: ${argument}`);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) flags[argument.slice(2)] = true;
    else {
      flags[argument.slice(2)] = next;
      index += 1;
    }
  }
  return flags;
}
