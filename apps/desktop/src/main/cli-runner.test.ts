import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type CliEnvironment, type ExitCode, run as runCommand } from '@tyto/command-line';
import { describe, expect, it } from 'vitest';

import {
  type CliDiagnostics,
  type CliOutput,
  type CliRunnerOptions,
  type CliStateChange,
  RESTART_NOTE,
  STILL_FINISHING,
  KEPT_RUNS,
  confirmInABox,
  createCliRunner,
} from './cli-runner.js';
import { WATCH_REFUSED, windowRefusals } from './cli-refusals.js';

/**
 * The runner in main (TYTO-495, ADR 0159), with `run` replaced by a script of what a command
 * does: the CLI's own behaviour is `@tyto/command-line`'s suite. What is under test here is
 * what the window adds — ids, the streams, the states, Stop, the box and the refresh.
 */

type Script = (environment: CliEnvironment, signal: AbortSignal | undefined) => Promise<ExitCode>;

interface Recorded {
  readonly outputs: CliOutput[];
  readonly states: CliStateChange[];
  readonly refreshed: (readonly string[])[];
}

function runner(script: Script, overrides: Partial<CliRunnerOptions> = {}) {
  const recorded: Recorded = { outputs: [], states: [], refreshed: [] };
  let id = 0;
  const cli = createCliRunner({
    environment: () => ({
      version: '0.0.0-test',
      cwd: '/work',
      rasterizer: () => {
        throw new Error('nothing rasters here');
      },
    }),
    refuse: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
    output: (output) => recorded.outputs.push(output),
    state: (change) => recorded.states.push(change),
    afterRun: (path) => {
      recorded.refreshed.push(path);
    },
    newId: () => `run-${String((id += 1))}`,
    // The real `run` asks `refuse` before the action, which is how the path is learnt.
    run: async (argv, environment, signal) => {
      await environment.refuse?.({ path: argv.slice(0, 2), args: [], options: {} });
      return script(environment, signal);
    },
    ...overrides,
  });
  return { cli, recorded };
}

/** Resolves once the queued microtasks and timers of a finished script have run. */
const settled = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

describe('a run', () => {
  it('answers with its id at once, streams what it prints, and ends with its exit code', async () => {
    const { cli, recorded } = runner((environment) => {
      environment.console.out('feed-01.svg\n');
      environment.console.err('warning W_X something\n');
      return Promise.resolve(0);
    });

    const { runId } = cli.start(['render', 'brief.brief']);
    await settled();

    expect(runId).toBe('run-1');
    expect(recorded.outputs).toEqual([
      { runId, stream: 'out', text: 'feed-01.svg\n' },
      { runId, stream: 'err', text: 'warning W_X something\n' },
    ]);
    expect(recorded.states).toEqual([
      { runId, state: 'running' },
      { runId, state: 'finished', code: 0 },
    ]);
  });

  it('keeps two runs apart by id', async () => {
    const { cli, recorded } = runner((environment) => {
      environment.console.out('done\n');
      return Promise.resolve(1);
    });

    const first = cli.start(['template', 'check', 'a']);
    const second = cli.start(['template', 'check', 'b']);
    await settled();

    expect(first.runId).not.toBe(second.runId);
    expect(recorded.states.filter((change) => change.state === 'finished')).toEqual([
      { runId: first.runId, state: 'finished', code: 1 },
      { runId: second.runId, state: 'finished', code: 1 },
    ]);
  });

  it('turns a throw that escaped run into exit 2 and a line on the error stream', async () => {
    const { cli, recorded } = runner(() => Promise.reject(new Error('boom')));

    const { runId } = cli.start(['render', 'x']);
    await settled();

    expect(recorded.outputs.at(-1)).toEqual({
      runId,
      stream: 'err',
      text: 'tyto: internal failure — Error: boom\n',
    });
    expect(recorded.states.at(-1)).toEqual({ runId, state: 'finished', code: 2 });
  });
});

describe('Stop', () => {
  /** A command that runs until its signal fires, as `watch` does. */
  const untilStopped: Script = (_environment, signal) =>
    new Promise((done) => {
      signal?.addEventListener('abort', () => done(0));
    });

  it("fires the run's own signal, says cancelled at once, and never a code after it", async () => {
    let fired: AbortSignal | undefined;
    const { cli, recorded } = runner((environment, signal) => {
      fired = signal;
      return untilStopped(environment, signal);
    });

    const { runId } = cli.start(['watch', 'queue']);
    await settled();
    cli.cancel(runId);
    await settled();

    expect(fired?.aborted).toBe(true);
    expect(recorded.states).toEqual([
      { runId, state: 'running' },
      { runId, state: 'cancelled' },
    ]);
    // A command that stops part of the way through says nothing more about it.
    expect(recorded.outputs).toEqual([]);
  });

  it('stops only the run it names', async () => {
    const signals: AbortSignal[] = [];
    const { cli } = runner((environment, signal) => {
      if (signal !== undefined) signals.push(signal);
      return untilStopped(environment, signal);
    });

    const first = cli.start(['watch', 'a']);
    cli.start(['watch', 'b']);
    await settled();
    cli.cancel(first.runId);

    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    cli.cancelAll();
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
  });

  it('says a command that takes no signal is still finishing, and still refreshes after it', async () => {
    let finish: (code: ExitCode) => void = () => {};
    const { cli, recorded } = runner(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );

    const { runId } = cli.start(['plugin', 'sync']);
    await settled();
    cli.cancel(runId);
    finish(0);
    await settled();

    expect(recorded.outputs).toEqual([{ runId, stream: 'err', text: STILL_FINISHING }]);
    expect(recorded.states.map((change) => change.state)).toEqual(['running', 'cancelled']);
    // What it changed on disk is still the window's to show.
    expect(recorded.refreshed).toEqual([['plugin', 'sync']]);
  });

  it('ignores an id that is unknown or already finished', async () => {
    const { cli, recorded } = runner(() => Promise.resolve(0));

    const { runId } = cli.start(['template', 'check', 'x']);
    await settled();
    cli.cancel(runId);
    cli.cancel('nobody');

    expect(recorded.states.map((change) => change.state)).toEqual(['running', 'finished']);
  });
});

describe('a question a command asks', () => {
  it('is answered by the box, with the run waiting while it is open', async () => {
    const asked: string[] = [];
    let answered: boolean | undefined;
    const { cli, recorded } = runner(
      async (environment) => {
        answered = await environment.confirm?.('Install texto? [y/N] ');
        return 0;
      },
      {
        confirm: (question) => {
          asked.push(question);
          return Promise.resolve(true);
        },
      },
    );

    const { runId } = cli.start(['plugin', 'install', 'texto']);
    await settled();

    expect(asked).toEqual(['Install texto? [y/N] ']);
    expect(answered).toBe(true);
    expect(recorded.states.slice(0, 3)).toEqual([
      { runId, state: 'running' },
      { runId, state: 'waiting', question: 'Install texto? [y/N] ' },
      { runId, state: 'running' },
    ]);
  });

  it('is a native box whose default and Escape answer are no', async () => {
    const boxes: unknown[] = [];
    const ask = confirmInABox(
      (box) => {
        boxes.push(box);
        return Promise.resolve({ response: box.cancelId });
      },
      (key) => (key === 'cli.confirm.yes' ? 'Yes' : 'No'),
    );

    expect(await ask('Install texto? [y/N] ')).toBe(false);
    expect(boxes).toEqual([
      {
        type: 'question',
        message: 'Install texto? [y/N]',
        buttons: ['Yes', 'No'],
        defaultId: 1,
        cancelId: 1,
      },
    ]);
  });

  it('is yes only when the first button is pressed', async () => {
    const ask = confirmInABox(
      () => Promise.resolve({ response: 0 }),
      (key) => key,
    );

    expect(await ask('Go?')).toBe(true);
  });
});

describe('stopping every run', () => {
  // TYTO-726: the trust a refusal's box grants re-reads the folder, which stops every run.
  it('spares the run named, and stops the others', async () => {
    const release: (() => void)[] = [];
    const { cli, recorded } = runner(
      () =>
        new Promise<ExitCode>((done) => {
          release.push(() => done(0));
        }),
    );

    const first = cli.start(['render', 'a']).runId;
    const second = cli.start(['render', 'b', '--trust']).runId;
    await settled();
    cli.cancelAll(second);

    expect(recorded.states.filter((change) => change.state === 'cancelled')).toEqual([
      { runId: first, state: 'cancelled' },
    ]);
    for (const done of release) done();
  });
});

describe('a refusal', () => {
  it("is asked with the run's cwd", async () => {
    const asked: string[] = [];
    const { cli } = runner(() => Promise.resolve(0), {
      refuse: (_invocation, cwd) => {
        asked.push(cwd);
        return Promise.resolve(undefined);
      },
    });

    cli.start(['render', 'x']);
    await settled();

    expect(asked).toEqual(['/work']);
  });

  // TYTO-726: an offer's box is the run waiting on a question, as a confirm's box is.
  it('shows its box as the run waiting, with the run it belongs to', async () => {
    const runs: string[] = [];
    const { cli, recorded } = runner(() => Promise.resolve(0), {
      refuse: async (_invocation, _cwd, run) => {
        runs.push(run.runId);
        await run.waiting('Trust the folder /work and run the command?', () =>
          Promise.resolve(false),
        );
        return undefined;
      },
    });

    const { runId } = cli.start(['render', 'x', '--trust']);
    await settled();

    expect(runs).toEqual([runId]);
    expect(recorded.states).toEqual([
      { runId, state: 'running' },
      { runId, state: 'waiting', question: 'Trust the folder /work and run the command?' },
      { runId, state: 'running' },
      { runId, state: 'finished', code: 0 },
    ]);
  });
});

describe('after a command with a window twin', () => {
  it('passes the command path to the refresh', async () => {
    const { cli, recorded } = runner(() => Promise.resolve(0));

    cli.start(['delivery', 'new', 'MCA-1']);
    await settled();

    expect(recorded.refreshed).toEqual([['delivery', 'new']]);
  });

  it('says that an installed plugin changes with the next launch', async () => {
    const { cli, recorded } = runner(() => Promise.resolve(0));

    const { runId } = cli.start(['plugin', 'disable', 'texto']);
    await settled();

    expect(recorded.outputs).toEqual([{ runId, stream: 'err', text: RESTART_NOTE }]);
  });
});

describe("a run's diagnostics", () => {
  const PRINTED = [
    {
      severity: 'error',
      code: 'E_ASSET_NOT_FOUND',
      message: 'm',
      path: 'task/brief.brief',
      line: 5,
      column: 1,
    },
    {
      severity: 'error',
      code: 'E_UNSUPPORTED_TAG',
      message: 'm',
      path: 'templates/x/template.html',
      line: 2,
      column: 3,
    },
    { severity: 'warning', code: 'W_PLUGIN_FILE_FETCH', message: 'm' },
  ] as const;

  it('become Problems rows under the command, each with an index main can open', async () => {
    const pushed: CliDiagnostics[] = [];
    const { cli } = runner(
      (environment) => {
        environment.diagnostics?.(PRINTED);
        return Promise.resolve(1);
      },
      { diagnostics: (rows) => pushed.push(rows) },
    );

    const { runId } = cli.start(['render', 'task/brief.brief']);
    await settled();

    expect(pushed).toEqual([
      {
        runId,
        label: 'tyto render task/brief.brief',
        diagnostics: [
          {
            index: 0,
            severity: 'error',
            code: 'E_ASSET_NOT_FOUND',
            message: 'm',
            where: 'task/brief.brief',
            line: 5,
            column: 1,
            openable: true,
          },
          {
            index: 1,
            severity: 'error',
            code: 'E_UNSUPPORTED_TAG',
            message: 'm',
            where: 'templates/x/template.html',
            line: 2,
            column: 3,
            openable: false,
          },
          {
            index: 2,
            severity: 'warning',
            code: 'W_PLUGIN_FILE_FETCH',
            message: 'm',
            openable: false,
          },
        ],
      },
    ]);
    // The path is main's, against the run's folder; the window only ever has the index.
    expect(cli.diagnosticPath(runId, 0)).toBe(resolve('/work', 'task/brief.brief'));
    expect(cli.diagnosticPath(runId, 2)).toBeUndefined();
  });

  it('number on across two reports of one run', async () => {
    const pushed: CliDiagnostics[] = [];
    const { cli } = runner(
      (environment) => {
        environment.diagnostics?.([PRINTED[0]]);
        environment.diagnostics?.([PRINTED[1]]);
        return Promise.resolve(1);
      },
      { diagnostics: (rows) => pushed.push(rows) },
    );

    cli.start(['render', 'a']);
    await settled();

    expect(pushed.flatMap((push) => push.diagnostics.map((row) => row.index))).toEqual([0, 1]);
  });

  it(`keeps the paths of the last ${String(KEPT_RUNS)} runs that reported, and lets the oldest go`, async () => {
    const { cli } = runner(
      (environment) => {
        environment.diagnostics?.([PRINTED[0]]);
        return Promise.resolve(1);
      },
      { diagnostics: () => {} },
    );

    const ids = Array.from({ length: KEPT_RUNS + 1 }, () => cli.start(['render', 'a']).runId);
    await settled();

    expect(cli.diagnosticPath(ids[0]!, 0)).toBeUndefined();
    expect(cli.diagnosticPath(ids[1]!, 0)).toBeDefined();
    expect(cli.diagnosticPath(ids[KEPT_RUNS]!, 0)).toBeDefined();
  });
});

/**
 * TYTO-537, ADR 0201 decision 3: the command panel's `cd` runs a command in a subfolder of the
 * workspace, with the real CLI. Trust is the workspace's, found from there upwards, and the
 * window's refusals are asked with that folder.
 */
describe('a run in a folder under the workspace', () => {
  async function workspace() {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-cli-folder-')));
    const root = join(scratch, 'promo');
    const home = join(scratch, 'home');
    await mkdir(join(root, '.tyto'), { recursive: true });
    await mkdir(join(root, 'entregas'), { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(join(root, '.tyto', 'project.json'), '{}');
    await writeFile(join(root, 'entregas', 'semana.recipe'), 'recipe semana\n');
    return { scratch, root, home };
  }

  function realRunner(root: string, home: string) {
    const outputs: string[] = [];
    const refused: { cwd: string; message: string | undefined }[] = [];
    const ended: number[] = [];
    const refuse = windowRefusals({
      platform: process.platform,
      queue: () => Promise.resolve({ folder: root, autoRun: true }),
    });
    const cli = createCliRunner({
      environment: () => ({
        version: '0.0.0-test',
        cwd: root,
        home,
        variables: {},
        rasterizer: () => {
          throw new Error('nothing rasters here');
        },
      }),
      refuse: async (invocation, cwd) => {
        const answer = await refuse(invocation, cwd);
        refused.push({ cwd, message: answer?.message });
        return answer?.message;
      },
      confirm: () => Promise.resolve(false),
      output: (output) => outputs.push(output.text),
      state: (change) => {
        if (change.state === 'finished') ended.push(change.code ?? -1);
      },
      run: runCommand,
    });
    const finish = async (): Promise<void> => {
      for (let round = 0; round < 200 && ended.length === 0; round += 1) {
        await new Promise((done) => setTimeout(done, 10));
      }
    };
    return { cli, outputs, refused, ended, finish };
  }

  it('is restricted in a subfolder of a restricted workspace, and trusted once it is', async () => {
    const { scratch, root, home } = await workspace();
    try {
      const restricted = realRunner(root, home);
      restricted.cli.start(['recipe', 'run', 'semana.recipe', '--json'], join(root, 'entregas'));
      await restricted.finish();
      const before = JSON.parse(restricted.outputs.join('')) as {
        workspace: { folder: string; trust: string };
      };
      // The workspace is the folder above, and its trust is what the run gets.
      expect(before.workspace).toMatchObject({ trust: 'restricted' });
      expect(restricted.refused.map((each) => each.cwd)).toEqual([join(root, 'entregas')]);

      // Control: the same command, the workspace trusted, from the same subfolder.
      expect(
        await runCommand(['trust', 'add', root], {
          console: { out: () => undefined, err: () => undefined },
          version: '0.0.0-test',
          cwd: root,
          home,
          variables: {},
          confirm: () => Promise.resolve(true),
          rasterizer: () => {
            throw new Error('nothing rasters here');
          },
        }),
      ).toBe(0);
      const trusted = realRunner(root, home);
      trusted.cli.start(['recipe', 'run', 'semana.recipe', '--json'], join(root, 'entregas'));
      await trusted.finish();
      const after = JSON.parse(trusted.outputs.join('')) as { workspace: { trust: string } };
      expect(after.workspace).toMatchObject({ trust: 'trusted' });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("asks the window's refusals with the subfolder, so a path relative to it is read there", async () => {
    const { scratch, root, home } = await workspace();
    try {
      // `..` from `entregas` is the queue's folder, with auto-run on: refused.
      const inside = realRunner(root, home);
      inside.cli.start(['watch', '..'], join(root, 'entregas'));
      await inside.finish();
      expect(inside.refused).toEqual([{ cwd: join(root, 'entregas'), message: WATCH_REFUSED }]);
      expect(inside.outputs.join('')).toContain(WATCH_REFUSED);

      // Control: `..` from the root is another folder, which the rule leaves alone.
      const atRoot = realRunner(root, home);
      const { runId } = atRoot.cli.start(['watch', '..']);
      await new Promise((done) => setTimeout(done, 50));
      atRoot.cli.cancel(runId);
      expect(atRoot.refused).toEqual([{ cwd: root, message: undefined }]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
