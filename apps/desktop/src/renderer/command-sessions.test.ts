import { describe, expect, it } from 'vitest';

import { lineText } from './command-output.js';
import { CommandSessions, refreshesWorkspace } from './command-sessions.js';

/**
 * The command panel's sessions (TYTO-496): tabs, the run each is bound to, and every `cli:*`
 * event landing in the right tab, including the ones that beat `cli:run`'s answer.
 */

const outputOf = (sessions: CommandSessions, index = 0) =>
  sessions.sessions[index]!.scrollback.lines.map(lineText);

describe('the tabs', () => {
  it('starts with one, puts a new one in front, and never reuses a number', () => {
    const sessions = new CommandSessions();
    const first = sessions.active;
    const second = sessions.create();
    expect(sessions.active.id).toBe(second.id);
    sessions.close(second.id);
    expect(sessions.active.id).toBe(first.id);
    expect(sessions.create().number).toBe(3);
  });

  it('leaves a fresh tab when the last one closes', () => {
    const sessions = new CommandSessions();
    sessions.close(sessions.active.id);
    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.active.state).toBe('idle');
  });

  it('answers the run a closed tab was running, for the caller to stop', () => {
    const sessions = new CommandSessions();
    const id = sessions.active.id;
    sessions.started(id, 'watch .', ['watch', '.'], 'run-1');
    expect(sessions.close(id)).toBe('run-1');
    const other = sessions.active.id;
    sessions.started(other, 'check a', ['check', 'a'], 'run-2');
    sessions.state({ runId: 'run-2', state: 'finished', code: 0 });
    expect(sessions.close(other)).toBeUndefined();
  });
});

describe('a run’s events', () => {
  it('reach the tab bound to the run, and no other', () => {
    const sessions = new CommandSessions();
    const first = sessions.active.id;
    sessions.started(first, 'render a', ['render', 'a'], 'run-1');
    sessions.create();
    sessions.output({ runId: 'run-1', stream: 'out', text: 'wrote a.svg\n' });
    sessions.output({ runId: 'someone-else', stream: 'out', text: 'not ours\n' });
    expect(outputOf(sessions, 0)).toEqual(['wrote a.svg']);
    expect(outputOf(sessions, 1)).toEqual([]);
  });

  it('keeps what arrived before cli:run answered, and applies it in order', () => {
    const sessions = new CommandSessions();
    const id = sessions.active.id;
    sessions.output({ runId: 'run-9', stream: 'out', text: 'early\n' });
    sessions.state({ runId: 'run-9', state: 'finished', code: 0 });
    sessions.started(id, '--version', ['--version'], 'run-9');
    expect(outputOf(sessions)).toEqual(['early']);
    expect(sessions.active.state).toBe('finished');
    expect(sessions.active.code).toBe(0);
  });

  it('shows waiting with its question, then the exit code, and tells who listens', () => {
    const sessions = new CommandSessions();
    const ended: string[] = [];
    sessions.onEnded = (session) => ended.push(`${session.state}:${String(session.code)}`);
    const id = sessions.active.id;
    sessions.started(id, 'plugin sync', ['plugin', 'sync'], 'run-1');
    sessions.state({ runId: 'run-1', state: 'waiting', question: 'Load x?' });
    expect(sessions.active.question).toBe('Load x?');
    sessions.state({ runId: 'run-1', state: 'finished', code: 1 });
    expect(sessions.active.question).toBeUndefined();
    expect(ended).toEqual(['finished:1']);
  });

  it('stays cancelled when a command that could not stop finishes later', () => {
    const sessions = new CommandSessions();
    const id = sessions.active.id;
    sessions.started(id, 'render a', ['render', 'a'], 'run-1');
    sessions.state({ runId: 'run-1', state: 'cancelled' });
    sessions.state({ runId: 'run-1', state: 'finished', code: 0 });
    expect(sessions.active.state).toBe('cancelled');
    expect(sessions.active.code).toBeUndefined();
  });

  it('collects the run’s diagnostics, and starts over with the next run', () => {
    const sessions = new CommandSessions();
    const id = sessions.active.id;
    sessions.started(id, 'check a', ['check', 'a'], 'run-1');
    const diagnostic = {
      index: 0,
      severity: 'error' as const,
      code: 'E',
      message: 'm',
      openable: true,
    };
    sessions.diagnostics({ runId: 'run-1', label: 'check a', diagnostics: [diagnostic] });
    expect(sessions.active.diagnostics).toEqual([diagnostic]);
    sessions.started(id, 'check b', ['check', 'b'], 'run-2');
    expect(sessions.active.diagnostics).toEqual([]);
  });
});

describe('after a trust command', () => {
  it('asks for the folder again only when a trust command finished', () => {
    const sessions = new CommandSessions();
    const id = sessions.active.id;
    sessions.started(id, 'trust add .', ['trust', 'add', '.'], 'run-1');
    expect(refreshesWorkspace(sessions.active)).toBe(false);
    sessions.state({ runId: 'run-1', state: 'finished', code: 0 });
    expect(refreshesWorkspace(sessions.active)).toBe(true);
    sessions.started(id, 'trust list', ['template', 'list'], 'run-2');
    sessions.state({ runId: 'run-2', state: 'finished', code: 0 });
    expect(refreshesWorkspace(sessions.active)).toBe(false);
  });
});
