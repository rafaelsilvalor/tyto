import type { IpcResponse } from '../../shared/ipc.js';
import type { CapturedRun } from './cli-runner.js';

/**
 * The templates the command panel completes `--template` with (TYTO-729): what `tyto template
 * list --json` prints in the session's working folder, run through the command runner `cli:run`
 * uses. **Not the window's catalogue**: since TYTO-728 that command lists through the resolver
 * `render`, `recipe run` and `delivery new` use, so a name offered here is one a render in that
 * folder accepts, and the folder's trust decides as it does for a typed line.
 *
 * Never throws: a run that fails or prints something that is not the listing answers no rows and
 * a note, so completion goes quiet instead of breaking the prompt.
 */

export type CommandTemplates = IpcResponse<'commands:templates'>;

/** The words main runs; never the window's, so no refusal or question applies to them. */
export const TEMPLATE_LIST_WORDS: readonly string[] = ['template', 'list', '--json'];

const MAX_ROWS = 2000;

export async function commandTemplates(
  capture: (argv: readonly string[], cwd?: string) => Promise<CapturedRun>,
  cwd: string | undefined,
): Promise<CommandTemplates> {
  const done = await capture(TEMPLATE_LIST_WORDS, cwd);
  if (done.code !== 0) {
    return { templates: [], note: firstLine(done.err) || `tyto template list exited ${done.code}` };
  }
  const rows = rowsOf(done.out);
  if (rows === undefined) {
    return { templates: [], note: 'tyto template list --json printed no listing' };
  }
  return { templates: rows };
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/u).find((line) => line.trim() !== '') ?? '').slice(0, 500);
}

/** The rows of `{ templates: [...] }`, or `undefined` for anything else. */
function rowsOf(text: string): CommandTemplates['templates'] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const templates = (parsed as { templates?: unknown }).templates;
  if (!Array.isArray(templates)) return undefined;
  const rows: CommandTemplates['templates'][number][] = [];
  for (const row of templates.slice(0, MAX_ROWS)) {
    if (typeof row !== 'object' || row === null) continue;
    const { name, formats, aliasOf } = row as Record<string, unknown>;
    if (typeof name !== 'string' || name === '') continue;
    rows.push({
      name,
      formats: Array.isArray(formats)
        ? formats.filter((format): format is string => typeof format === 'string')
        : [],
      ...(typeof aliasOf === 'string' ? { aliasOf } : {}),
    });
  }
  return rows;
}
