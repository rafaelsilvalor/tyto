import type { JsonValue } from '@tyto/recipe';
import { z } from 'zod';

/**
 * The runtime's own, read off `globalThis`: this package compiles against no platform's
 * types (ADR 0010), and every runtime it targets has it.
 */
const { TextEncoder } = globalThis as unknown as {
  TextEncoder: new () => { encode(text: string): Uint8Array };
};

/**
 * Any JSON value: a planned operation's `payload` (ADR 0170), whose size is `checkPlan`'s to
 * bound, and a panel call's `params` and answer (ADR 0173), bounded by `PANEL_CALL_MAX_BYTES`.
 */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/** A JSON value's size as its text: UTF-8 bytes of `JSON.stringify`, not UTF-16 code units. */
export function jsonByteLength(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
