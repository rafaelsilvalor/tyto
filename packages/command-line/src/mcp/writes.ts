import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import { confinedWriteTarget, inside } from './confine.js';
import { lineDiff } from './line-diff.js';
import { ToolRefusal } from './tools.js';
import { listWindows, processAlive } from './window-endpoint.js';

/**
 * `write_brief`'s disk half (ADR 0185): what a write would change, and the write.
 *
 * Three rules make a write something the agent and the person can see coming. **Only a
 * `.brief` is written**: a project sheet, a plugin file or a template would let an agent widen
 * what it may do, and none of them is a brief. **A file that is there is replaced only by the
 * agent that read it**: `replace` names the SHA-256 of the text it saw, from a dry run, and a
 * file someone changed since is refused as stale rather than overwritten. **The replacement is
 * whole or nothing**: written beside the file and renamed over it, so a reader never sees half.
 */

export const BRIEF_EXTENSION = '.brief';

export interface BriefWrite {
  readonly path: string;
  readonly text: string;
  /** True: say what would change and write nothing. */
  readonly dryRun?: boolean;
  /** The SHA-256 of the file as the agent read it; required to replace one. */
  readonly replace?: string;
}

export interface BriefWriteAnswer {
  readonly written: boolean;
  /** As the person would type it, relative to the folder served. */
  readonly path: string;
  /** What the write does, or did: a new file, a replaced one, or nothing to change. */
  readonly change: 'create' | 'replace' | 'unchanged';
  /**
   * The SHA-256 of the file on disk after this call: the current one for a dry run, which is
   * what `replace` takes; the new one after a write. Null when no file is there.
   */
  readonly sha256: string | null;
  /** The lines that change, `-` removed and `+` added; empty when nothing does. */
  readonly diff: string;
}

export interface BriefWriteContext {
  readonly cwd: string;
  readonly roots: readonly string[];
  readonly shown: (path: string) => string;
  /**
   * Why a file that is there may not be replaced now, or undefined when it may: a Tyto window
   * holds it, and its next save would erase the write (ADR 0185 decision 4).
   */
  readonly heldOpen?: (path: string) => Promise<string | undefined>;
}

export const sha256Of = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

export async function writeBrief(
  request: BriefWrite,
  context: BriefWriteContext,
): Promise<BriefWriteAnswer> {
  if (extname(request.path).toLowerCase() !== BRIEF_EXTENSION) {
    throw new ToolRefusal(
      `${request.path}: write_brief writes only ${BRIEF_EXTENSION} files (ADR 0185)`,
    );
  }
  const target = await confinedWriteTarget(request.path, context.cwd, context.roots);
  if (!target.ok) throw new ToolRefusal(target.reason);
  const shown = context.shown(target.path);
  const before = target.exists ? await readFile(target.path, 'utf8') : undefined;
  const current = before === undefined ? null : sha256Of(before);
  const change =
    before === undefined ? 'create' : before === request.text ? 'unchanged' : 'replace';
  const diff = lineDiff(before ?? '', request.text);
  const answer = (written: boolean, sha256: string | null): BriefWriteAnswer => ({
    written,
    path: shown,
    change,
    sha256,
    diff,
  });

  if (request.dryRun === true) return answer(false, current);
  if (before === undefined) {
    if (request.replace !== undefined) {
      throw new ToolRefusal(
        `${shown} is not there; nothing to replace (leave replace out to create it)`,
      );
    }
    await mkdir(dirname(target.path), { recursive: true });
    try {
      // `wx`: a file another program created since the check wins, and this one is refused.
      await writeFile(target.path, request.text, { encoding: 'utf8', flag: 'wx' });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ToolRefusal(
          `${shown} appeared while it was being written; read it and try again`,
        );
      }
      throw cause;
    }
    return answer(true, sha256Of(request.text));
  }

  if (request.replace === undefined) {
    throw new ToolRefusal(
      `${shown} is already there; call write_brief with dry_run to see the change, then again with replace set to the sha256 it answers`,
    );
  }
  if (request.replace !== current) {
    throw new ToolRefusal(
      `stale: ${shown} changed since it was read (sha256 ${current ?? ''}); call write_brief with dry_run again`,
    );
  }
  const held = await context.heldOpen?.(target.path);
  if (held !== undefined) throw new ToolRefusal(held);
  if (change === 'unchanged') return answer(false, current);

  const temporary = join(
    dirname(target.path),
    `.${basename(target.path)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    await writeFile(temporary, request.text, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, target.path);
  } catch (cause) {
    await rm(temporary, { force: true });
    throw cause;
  }
  return answer(true, sha256Of(request.text));
}

/**
 * Why a brief may not be replaced while a Tyto window has its folder open (ADR 0185 decision 4):
 * the window keeps the text it loaded, and its next save would erase the write without a word.
 * Asked of every live window's record, the serving window's own included; a window with no
 * folder holds nothing. Coarse on purpose: a brief no tab shows is refused too, because the
 * records say which folder a window has open, not which files.
 */
export function windowsHolding(
  home: string | undefined,
  platform: NodeJS.Platform,
  alive: (pid: number) => boolean = processAlive,
): ((path: string) => Promise<string | undefined>) | undefined {
  if (home === undefined) return undefined;
  return async (path) => {
    for (const record of await listWindows(home, platform, alive)) {
      if (record.folder === null) continue;
      const folder = await realpath(record.folder).catch(() => record.folder ?? '');
      if (folder !== '' && inside(folder, path)) {
        return `a Tyto window (pid ${String(record.pid)}) has ${record.folder} open, and its next save of this brief would erase the write; propose the change in the window instead (tyto mcp --window, then propose_edit), or close the folder there first (ADR 0185)`;
      }
    }
    return undefined;
  };
}
