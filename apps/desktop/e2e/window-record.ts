import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The agent-endpoint record of one window, out of a `TYTO_HOME/windows/` folder that may hold
 * others (TYTO-656). Another launch in the same `TYTO_HOME` that was killed before it quit — the
 * TYTO-193 probe boots the packaged app and ends it — leaves its record behind, and a test that
 * took the first `*.json` connected to a pipe nobody listens on. The window's own pid is the key.
 */

export interface SeenRecord {
  readonly name: string;
  readonly pid: number | undefined;
  readonly alive: boolean;
}

export interface FoundRecord<Record> {
  /** The record whose pid is the one asked for; undefined when it is not there yet. */
  readonly record: Record | undefined;
  /** Every record in the folder, for the line a CI log keeps. */
  readonly seen: readonly SeenRecord[];
}

/** Signal 0 tests a process without touching it; EPERM is a process of another user. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function windowRecordFor<Record extends { readonly pid: number }>(
  folder: string,
  pid: number,
): FoundRecord<Record> {
  let names: string[];
  try {
    names = readdirSync(folder).filter((entry) => entry.endsWith('.json'));
  } catch {
    return { record: undefined, seen: [] };
  }
  let record: Record | undefined;
  const seen: SeenRecord[] = [];
  for (const name of names.sort()) {
    let parsed: Record | undefined;
    try {
      parsed = JSON.parse(readFileSync(join(folder, name), 'utf8')) as Record;
    } catch {
      parsed = undefined;
    }
    const recordPid = typeof parsed?.pid === 'number' ? parsed.pid : undefined;
    seen.push({ name, pid: recordPid, alive: recordPid !== undefined && alive(recordPid) });
    if (recordPid === pid) record = parsed;
  }
  return { record, seen };
}

/** `2036.json pid 2036 dead, 4120.json pid 4120 alive`: what the log line says. */
export function seenLine(seen: readonly SeenRecord[]): string {
  return seen.length === 0
    ? 'none'
    : seen
        .map(
          (entry) =>
            `${entry.name} pid ${String(entry.pid ?? '?')} ${entry.alive ? 'alive' : 'dead'}`,
        )
        .join(', ');
}
