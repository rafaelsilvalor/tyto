import { PLUGIN_FILE_PART_BYTES, RPC_PROTOCOL_VERSION } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import { decodeFromWire, encodeForWire } from './plugin-wire.js';

/** The desktop's JSON channel to a plugin's process (ADR 0050), carrying a file part (ADR 0212). */
describe('the plugin wire', () => {
  it('carries an 8 MiB workspace part across JSON byte for byte', () => {
    const part = new Uint8Array(PLUGIN_FILE_PART_BYTES);
    for (let index = 0; index < part.length; index += 1) part[index] = (index * 31) % 256;
    // An answer as the host sends it back for `workspaceReadPart`.
    const message = { protocol: RPC_PROTOCOL_VERSION, type: 'answer', id: 7, value: part };

    const crossed = decodeFromWire(JSON.parse(JSON.stringify(encodeForWire(message)))) as {
      value: unknown;
    };

    expect(crossed.value).toBeInstanceOf(Uint8Array);
    expect((crossed.value as Uint8Array).length).toBe(PLUGIN_FILE_PART_BYTES);
    expect(Buffer.compare(Buffer.from(crossed.value as Uint8Array), Buffer.from(part))).toBe(0);
  });

  it('carries a subarray as its own bytes, not the buffer behind it', () => {
    const whole = new Uint8Array([1, 2, 3, 4, 5]);
    const crossed = decodeFromWire(
      JSON.parse(JSON.stringify(encodeForWire({ value: whole.subarray(1, 3) }))),
    ) as { value: Uint8Array };

    expect(Array.from(crossed.value)).toEqual([2, 3]);
  });
});
