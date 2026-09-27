import { exec, execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';

/**
 * `tyto plugin install <folder|git-url|npm-name>` — getting the files onto this disk.
 *
 * Three sources and one answer: a folder whose root holds a `tyto-plugin.json`. What
 * happens next — validating, asking, copying into `~/.tyto/plugins/` — is the same for all
 * three, so this module ends where they converge.
 *
 * **The network is `git`'s and `npm`'s, never Tyto's.** Both are run as the programs the
 * person already has, with their configuration, their credentials and their proxy; Tyto
 * opens no connection of its own and learns nothing about who fetched what (ADR 0011).
 * That is also what makes this testable without a network: a `file://` repository and a
 * packed tarball go through exactly the commands a real URL and a real name do.
 */

export type PluginSourceKind = 'folder' | 'git' | 'npm';

export interface FetchedPlugin {
  readonly kind: PluginSourceKind;
  /** The folder holding `tyto-plugin.json`. */
  readonly directory: string;
  /** Deletes whatever this fetch put in the temp space. A folder source has nothing. */
  cleanup(): Promise<void>;
}

const run = promisify(execFile);
const runInShell = promisify(exec);

/** git's own URL shapes: `git+https://…`, `git@host:…`, `git://…`, anything ending `.git`. */
function gitUrlOf(spec: string): string | undefined {
  if (spec.startsWith('git+')) return spec.slice('git+'.length);
  if (/^(git@|git:\/\/)/u.test(spec)) return spec;
  if (/^[a-z]+:\/\/.+\.git\/?$/iu.test(spec)) return spec;
  return undefined;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function problemOf(cause: unknown): string {
  const stderr = (cause as { readonly stderr?: unknown } | undefined)?.stderr;
  if (typeof stderr === 'string' && stderr.trim() !== '') return stderr.trim().split('\n')[0] ?? '';
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * `npm` is `npm.cmd` on Windows, which only a shell can start, so there the command is one
 * line the shell reads. Every argument is quoted, and one that could close its quote or
 * reach `cmd.exe`'s own expansion is refused before the shell sees it rather than escaped.
 */
async function runNpm(args: readonly string[], cwd: string): Promise<string> {
  if (process.platform !== 'win32') {
    return (await run('npm', [...args], { cwd })).stdout;
  }
  if (args.some((arg) => /["%^&|<>]/u.test(arg))) {
    throw new Error('an npm spec on Windows may not contain " % ^ & | < or >');
  }
  // The program name stays bare: `npm.cmd` finds its own folder through `%~dp0`, and a
  // quoted `"npm"` hands it one it cannot resolve — measured, it dies in Node's loader.
  const line = ['npm', ...args.map((arg) => `"${arg}"`)].join(' ');
  return (await runInShell(line, { cwd })).stdout;
}

async function fetchGit(url: string, scratch: string): Promise<string> {
  const checkout = join(scratch, 'checkout');
  // Shallow: the history is not what gets installed, and `fsPluginStore.add` drops `.git`.
  await run('git', ['clone', '--depth', '1', '--quiet', url, checkout]);
  return checkout;
}

async function fetchNpm(spec: string, cwd: string, scratch: string): Promise<string> {
  // `npm pack` is the one npm command that fetches a package and installs nothing: it
  // resolves a name, a version range, a tarball path or a URL exactly as `npm install`
  // would, and leaves one `.tgz` behind.
  const packed = join(scratch, 'packed');
  await mkdir(packed);
  await runNpm(['pack', spec, '--pack-destination', packed, '--silent'], cwd);

  const [tarball] = (await readdir(packed)).filter((name) => name.endsWith('.tgz'));
  if (tarball === undefined) throw new Error('npm pack produced no tarball');

  // `tar` is on every platform Tyto supports, Windows 10 included, and it is the format's
  // own tool. npm tarballs hold one folder, `package/`. The paths are relative on purpose:
  // GNU tar — the one Git for Windows puts first on the PATH — reads `C:\…` as a host
  // named `C` and refuses it, and a relative path means the same thing to both tars.
  const extracted = join(scratch, 'extracted');
  await mkdir(extracted);
  await run('tar', ['-xzf', `packed/${tarball}`, '-C', 'extracted'], { cwd: scratch });
  return join(extracted, 'package');
}

/**
 * Fetches `spec` into a temp folder, or points at it when it is already a folder.
 *
 * A folder wins over the other two: `./pdf.git` that exists on disk is somebody's folder
 * with an unlucky name, not a repository to clone.
 */
export async function fetchPlugin(
  spec: string,
  cwd: string,
): Promise<Result<FetchedPlugin, Diagnostics>> {
  const local = isAbsolute(spec) ? spec : resolve(cwd, spec);
  if (await isDirectory(local)) {
    return ok({ kind: 'folder', directory: local, cleanup: () => Promise.resolve() });
  }

  const scratch = await mkdtemp(join(tmpdir(), 'tyto-plugin-'));
  const cleanup = (): Promise<void> => rm(scratch, { recursive: true, force: true });
  const gitUrl = gitUrlOf(spec);

  try {
    // A file on this disk is handed to npm as `file:<absolute path>`, never as typed: npm reads
    // a bare `packed/x.tgz` as GitHub shorthand for the repository `packed` of user
    // `x.tgz` and tries to clone it — measured, on Linux in CI and on Windows alike.
    const npmSpec = (await isFile(local)) ? `file:${local}` : spec;
    const directory =
      gitUrl === undefined
        ? await fetchNpm(npmSpec, cwd, scratch)
        : await fetchGit(gitUrl, scratch);
    return ok({ kind: gitUrl === undefined ? 'npm' : 'git', directory, cleanup });
  } catch (cause) {
    await cleanup();
    return err([diagnostic('E_PLUGIN_FETCH', { source: spec, problem: problemOf(cause) })]);
  }
}
