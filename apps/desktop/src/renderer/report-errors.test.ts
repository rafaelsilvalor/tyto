// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { type TytoBridge } from '../../shared/ipc.js';
import { installErrorReporting } from './report-errors.js';

/**
 * Driven against the recorded calls and never against output.
 *
 * Vitest's default reporter hides `console` from a passing test, so a suite that proved
 * anything by printing would prove it to nobody. What is asserted here is what crossed the
 * bridge, which is also the only thing that reaches the log.
 */

interface Sent {
  level: string;
  message: string;
  detail?: string;
}

const fakeBridge = (
  send: (request: Sent) => Promise<unknown> = () => Promise.resolve({}),
): { bridge: TytoBridge; sent: Sent[] } => {
  const sent: Sent[] = [];
  const bridge = {
    'log:write': (request: Sent) => {
      sent.push(request);
      return send(request);
    },
  } as unknown as TytoBridge;
  return { bridge, sent };
};

describe('installErrorReporting', () => {
  it('reports a thrown Error with its stack', () => {
    const { bridge, sent } = fakeBridge();
    installErrorReporting(window, bridge);

    const error = new Error('the preview blew up');
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.level).toBe('error');
    expect(sent[0]?.message).toContain('the preview blew up');
    expect(sent[0]?.detail).toContain('Error: the preview blew up');
  });

  it('reports an unhandled rejection', () => {
    const { bridge, sent } = fakeBridge();
    installErrorReporting(window, bridge);

    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: new Error('file:save was refused'),
      }),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toContain('file:save was refused');
  });

  it('shortens a long stack instead of letting the contract refuse it', () => {
    const { bridge, sent } = fakeBridge();
    installErrorReporting(window, bridge);

    const error = new Error('deep');
    error.stack = `Error: deep\n${'    at somewhere (file.ts:1:1)\n'.repeat(400)}`;
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'deep' }));

    // Without this the one failure with the most to say would be the one thrown away: the
    // contract caps `detail` at 4000 and refuses anything longer, in the preload, before it
    // is sent.
    expect(sent[0]?.detail?.length).toBeLessThanOrEqual(4000);
    expect(sent[0]?.message.length).toBeLessThanOrEqual(200);
  });

  it('says something even when nothing useful was thrown', () => {
    const { bridge, sent } = fakeBridge();
    installErrorReporting(window, bridge);

    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: '',
      }),
    );

    // `message` is `min(1)` on the contract, so an empty reason would be refused — and
    // "nothing was thrown" is itself the interesting half of that report.
    expect(sent[0]?.message).toContain('unknown renderer failure');
  });

  it('never carries a brief across, because the message cannot hold one', () => {
    const { bridge, sent } = fakeBridge();
    installErrorReporting(window, bridge);

    const brief = `---\ntemplate: promo-curso\n---\n${'::titulo Campanha secreta\n'.repeat(200)}`;
    window.dispatchEvent(new ErrorEvent('error', { message: brief }));

    // The caps are the mechanism the card's "no brief text" criterion rests on. This is the
    // renderer half of it; `shared/ipc.test.ts` is the half that proves the contract refuses
    // anything longer.
    expect(sent[0]?.message.length).toBeLessThanOrEqual(200);
  });

  it('does nothing at all with no bridge, which is every unit test in this folder', () => {
    expect(() => {
      installErrorReporting(window, undefined);
    }).not.toThrow();

    expect(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'nowhere to send this' }));
    }).not.toThrow();
  });

  it('swallows a send that itself fails, because that is the loop', () => {
    const failing = vi.fn(() => Promise.reject(new Error('the bridge is gone')));
    const { bridge, sent } = fakeBridge(failing);
    installErrorReporting(window, bridge);

    expect(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'first failure' }));
    }).not.toThrow();
    expect(sent).toHaveLength(1);
  });
});
