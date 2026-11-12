import { type CliEnvironment, type CommandInvocation, run } from '@tyto/command-line';
import { describe, expect, it } from 'vitest';

import {
  APPLY_REFUSED,
  MCP_REFUSED,
  TRUST_REFUSED,
  WATCH_REFUSED,
  type WindowRefusalOptions,
  windowRefusals,
} from './cli-refusals.js';

/**
 * ADR 0159 decision 2, one rule at a time, each with the case it must leave alone. The shell's
 * refusal is `@tyto/command-line`'s `run-signal.test.ts`: it is refused at the step, not here.
 */

const invocation = (
  path: readonly string[],
  args: readonly string[] = [],
  options: Record<string, unknown> = {},
): CommandInvocation => ({ path, args, options });

function refusals(overrides: Partial<WindowRefusalOptions> = {}) {
  return windowRefusals({
    platform: 'win32',
    queue: () => Promise.resolve({ folder: 'C:\\Fila', autoRun: true }),
    ...overrides,
  });
}

describe('--trust', () => {
  it('is refused on any command, and names Workspace: Trust', async () => {
    const refuse = refusals();

    expect(await refuse(invocation(['render'], ['a.brief'], { trust: true }), 'C:\\w')).toBe(
      TRUST_REFUSED,
    );
    expect(await refuse(invocation(['template', 'new'], ['x'], { trust: true }), 'C:\\w')).toBe(
      TRUST_REFUSED,
    );
    expect(TRUST_REFUSED).toContain('Workspace: Trust');
  });

  it('is not refused when it is absent', async () => {
    expect(await refusals()(invocation(['render'], ['a.brief'], {}), 'C:\\w')).toBeUndefined();
  });
});

describe('mcp', () => {
  it('is refused, and says where it runs instead', async () => {
    expect(await refusals()(invocation(['mcp']), 'C:\\w')).toBe(MCP_REFUSED);
    expect(MCP_REFUSED).toContain('terminal');
  });

  it('is refused with --window too: the relay needs stdio the panel does not have (ADR 0180)', async () => {
    expect(await refusals()(invocation(['mcp'], ['.'], { window: true }), 'C:\\w')).toBe(
      MCP_REFUSED,
    );
  });

  it('leaves a command named after it alone', async () => {
    expect(await refusals()(invocation(['render'], ['mcp']), 'C:\\w')).toBeUndefined();
  });
});

describe('watch on the queue folder', () => {
  it('is refused while auto-run is on, the path compared without case on Windows', async () => {
    const refuse = refusals();

    expect(await refuse(invocation(['watch'], ['c:\\fila']), 'C:\\w')).toBe(WATCH_REFUSED);
    // Relative to the run's folder, as the CLI resolves it.
    expect(await refuse(invocation(['watch'], ['..\\Fila']), 'C:\\w')).toBe(WATCH_REFUSED);
  });

  it('is left alone with auto-run off, for another folder, or with no queue folder', async () => {
    const off = refusals({ queue: () => Promise.resolve({ folder: 'C:\\Fila', autoRun: false }) });
    const none = refusals({ queue: () => Promise.resolve({ folder: null, autoRun: true }) });

    expect(await off(invocation(['watch'], ['C:\\Fila']), 'C:\\w')).toBeUndefined();
    expect(await refusals()(invocation(['watch'], ['C:\\Outra']), 'C:\\w')).toBeUndefined();
    expect(await none(invocation(['watch'], ['C:\\Fila']), 'C:\\w')).toBeUndefined();
  });

  it('compares with case on Linux', async () => {
    const linux = refusals({
      platform: 'linux',
      queue: () => Promise.resolve({ folder: '/fila', autoRun: true }),
    });

    expect(await linux(invocation(['watch'], ['/fila']), '/w')).toBe(WATCH_REFUSED);
    expect(await linux(invocation(['watch'], ['/Fila']), '/w')).toBeUndefined();
  });
});

describe('recipe run --apply', () => {
  it('is refused, and says where a plan is applied instead', async () => {
    expect(
      await refusals()(invocation(['recipe', 'run'], ['x.recipe'], { apply: true }), 'C:\\w'),
    ).toBe(APPLY_REFUSED);
    expect(APPLY_REFUSED).toContain('Apply');
    expect(APPLY_REFUSED).toContain('terminal');
    expect(APPLY_REFUSED).toContain('ADR 0159');
  });

  it('leaves the plan-only run alone, an apply auto recipe included', async () => {
    // Without the flag the run is a save's, and the CLI applies nothing, `apply auto` or not:
    // `@tyto/command-line`'s `recipe-run.test.ts` pins that, so no header is read here.
    const refuse = refusals();

    expect(
      await refuse(invocation(['recipe', 'run'], ['x.recipe'], { apply: false }), 'C:\\w'),
    ).toBeUndefined();
    expect(
      await refuse(invocation(['recipe', 'run'], ['x.recipe'], { json: true }), 'C:\\w'),
    ).toBeUndefined();
  });

  it('leaves another command with an apply option alone', async () => {
    expect(
      await refusals()(invocation(['render'], ['a.brief'], { apply: true }), 'C:\\w'),
    ).toBeUndefined();
  });
});

/**
 * The same rule through the CLI's own parser, so every spelling commander turns into `apply`
 * is one the window sees. `recipe run` declares `--apply` as a plain flag: no short alias, no
 * `--no-apply`, no value. Those words never reach the refusal; the parser refuses them first.
 */
describe('recipe run --apply through the command line parser', () => {
  async function typed(argv: readonly string[]) {
    let err = '';
    const asked: (string | undefined)[] = [];
    const refuse = refusals();
    const environment: CliEnvironment = {
      console: {
        out: () => undefined,
        err: (text) => {
          err += text;
        },
      },
      version: '0.0.0-test',
      cwd: 'C:\\w',
      rasterizer: () => {
        throw new Error('a refusal starts no browser');
      },
      refuse: async (each) => {
        const answer = await refuse(each, 'C:\\w');
        asked.push(answer);
        return answer;
      },
    };
    const code = await run(argv, environment);
    return { code, err, asked };
  }

  it.each([
    [['recipe', 'run', 'x.recipe', '--apply']],
    [['recipe', 'run', '--apply', 'x.recipe']],
    [['recipe', 'run', 'x.recipe', '--apply', '--apply']],
    [['recipe', 'run', 'x.recipe', '--json', '--apply']],
  ])('refuses %j before the command starts', async (argv) => {
    const { code, err, asked } = await typed(argv);

    expect(asked).toEqual([APPLY_REFUSED]);
    expect(code).toBe(1);
    expect(err).toContain(APPLY_REFUSED);
  });

  it('lets the plan-only run through to the command', async () => {
    const { err, asked } = await typed(['recipe', 'run', 'x.recipe']);

    expect(asked).toEqual([undefined]);
    expect(err).not.toContain(APPLY_REFUSED);
  });

  it.each([
    [['recipe', 'run', 'x.recipe', '--apply=true']],
    [['recipe', 'run', 'x.recipe', '--no-apply']],
    [['recipe', 'run', 'x.recipe', '-a']],
  ])('leaves %j to the parser, which refuses it as unknown', async (argv) => {
    const { code, err, asked } = await typed(argv);

    expect(asked).toEqual([]);
    expect(code).toBe(1);
    expect(err).toContain('unknown option');
  });
});
