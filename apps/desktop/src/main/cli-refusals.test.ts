import type { CommandInvocation } from '@tyto/command-line';
import { describe, expect, it } from 'vitest';

import {
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
