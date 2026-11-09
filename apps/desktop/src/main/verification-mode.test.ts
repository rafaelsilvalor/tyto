import { describe, expect, it } from 'vitest';

import { type SwitchReader, verificationMode } from './verification-mode.js';

/** A command line holding exactly `switches`, as `app.commandLine` answers. */
function commandLine(switches: Record<string, string>): SwitchReader {
  return {
    hasSwitch: (name) => Object.hasOwn(switches, name),
    getSwitchValue: (name) => switches[name] ?? '',
  };
}

const noFile = (): string | undefined => undefined;

describe('verificationMode (TYTO-651, ADR 0178)', () => {
  it('is off when the app was started without the debugging switch', () => {
    expect(verificationMode(commandLine({}), () => '9333\n/devtools/browser/x')).toEqual({
      on: false,
    });
  });

  it('is on with the port the switch names', () => {
    expect(verificationMode(commandLine({ 'remote-debugging-port': '9333' }), noFile)).toEqual({
      on: true,
      port: 9333,
    });
  });

  it("reads port 0's number out of DevToolsActivePort", () => {
    const mode = verificationMode(
      commandLine({ 'remote-debugging-port': '0' }),
      () => '51234\n/devtools/browser/abc',
    );
    expect(mode).toEqual({ on: true, port: 51234 });
  });

  it('is on without a number while the port file is missing or unreadable', () => {
    expect(verificationMode(commandLine({ 'remote-debugging-port': '0' }), noFile)).toEqual({
      on: true,
      port: undefined,
    });
    expect(verificationMode(commandLine({ 'remote-debugging-port': '' }), () => 'garbage')).toEqual(
      { on: true, port: undefined },
    );
  });

  it("is off in a headless window, which every suite's Playwright launch opens a port in", () => {
    expect(
      verificationMode(commandLine({ 'remote-debugging-port': '0' }), () => '51234\n', true),
    ).toEqual({ on: false });
  });

  it('never shows a number outside the TCP range', () => {
    expect(
      verificationMode(commandLine({ 'remote-debugging-port': '70000' }), () => '0\n'),
    ).toEqual({ on: true, port: undefined });
  });
});
