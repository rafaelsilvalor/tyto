import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  ALIASES_KEY,
  ALIAS_NAME,
  PROJECT_DIRECTORY,
  PROJECT_FILE_NAME,
  aliasBodyProblem,
} from '@tyto/core';
import { readProjectText } from '@tyto/io';

import type { IpcResponse } from '../../shared/ipc.js';
import { type CommandAliases, aliasesInForce } from '../../shared/command-aliases.js';
import { editJsoncText } from './settings-file.js';

/**
 * The command panel's aliases as main keeps them (TYTO-536, ADR 0200 note of 2026-11-15): read
 * from the `commandAliases` setting and the open folder's resolved project, and written by
 * `alias` back to one of the two. Main checks every write itself: the window is not the
 * boundary, and a restricted folder's project file is never written from the panel.
 */

export type AliasWritten = IpcResponse<'commands:set-alias'>;

/** What the window's `alias` reads: the aliases in force, and what the open folder allows. */
export function aliasesAnswer(
  user: CommandAliases,
  workspace:
    | {
        readonly trust: 'trusted' | 'restricted' | 'revoked';
        readonly aliases: readonly { readonly name: string; readonly body: string }[];
      }
    | undefined,
): IpcResponse<'commands:aliases'> {
  return {
    aliases: aliasesInForce(user, workspace?.aliases ?? []).slice(0, 500),
    workspace:
      workspace === undefined ? 'none' : workspace.trust === 'trusted' ? 'trusted' : 'restricted',
  };
}

/** Why a name or body cannot be written, by the rules the readers apply. */
export function aliasWriteProblem(name: string, body: string | null): 'invalid' | undefined {
  if (!ALIAS_NAME.test(name)) return 'invalid';
  if (body !== null && aliasBodyProblem(body) !== undefined) return 'invalid';
  return undefined;
}

/**
 * The project text with `aliases.<name>` set, or removed for `null`, comments and layout kept;
 * `undefined` when the text does not parse, which must not be written over.
 */
export function projectTextWithAlias(
  text: string,
  name: string,
  body: string | null,
): string | undefined {
  if (readProjectText(text).syntax.length > 0) return undefined;
  return editJsoncText(text, [{ path: [ALIASES_KEY, name], value: body ?? undefined }]);
}

/**
 * Writes one alias into `folder`'s own `.tyto/project.json`, never a work profile's (the folder
 * is the workspace the person typed in). A file that does not exist yet is made; one that does
 * not parse is left as it was.
 */
export async function writeWorkspaceAlias(
  folder: string,
  name: string,
  body: string | null,
): Promise<AliasWritten> {
  const file = join(folder, PROJECT_DIRECTORY, PROJECT_FILE_NAME);
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      return { ok: false, reason: 'unwritable' };
    if (body === null) return { ok: true };
  }
  const next = projectTextWithAlias(text, name, body);
  if (next === undefined) return { ok: false, reason: 'syntax' };
  if (next === text) return { ok: true };
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, next, 'utf8');
  } catch {
    return { ok: false, reason: 'unwritable' };
  }
  return { ok: true };
}
