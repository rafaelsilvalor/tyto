/**
 * The desktop's encoding of the plugin protocol for its JSON channel (TYTO-186, ADR 0050).
 *
 * The channel between main and a plugin's process is JSON, not `serialization: 'advanced'`,
 * measured. Advanced serialization is V8's structured clone, and main's V8 is Electron's while
 * the plugin's is the bundled Node's: every message failed with "Unable to deserialize cloned
 * data due to invalid or unsupported version", and no plugin activated.
 *
 * JSON is the one format both ends read, and it loses two things structured clone keeps, both
 * of which the protocol carries:
 *
 * - **bytes**: `host.fetch`'s body, and a code template's faces (ADR 0048). A `Uint8Array`
 *   crosses as `{ $tytoBytes: base64 }`.
 * - **`undefined`**: `activate`'s `config` is `undefined` for a plugin with none, and JSON drops
 *   the key, which the guest's strict schema then refuses ("Invalid input", measured, and the
 *   activation never finished). In an array JSON writes `null`, which is another value. An
 *   `undefined` crosses as `{ $tytoUndefined: true }`.
 *
 * Each side rebuilds what the other encoded, so `connectIsolatedPlugin` and `runGuest` see what
 * they see in the CLI. This is the adapter's encoding, not the protocol's. `plugin-process.ts`
 * in main and `plugin-guest.ts` in the plugin's process both import this one file, so the two
 * ends cannot disagree about it.
 */

const BYTES = '$tytoBytes';
const UNDEFINED = '$tytoUndefined';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A message ready for JSON: every `Uint8Array` and every `undefined` in it replaced by a marker. */
export function encodeForWire(value: unknown): unknown {
  if (value === undefined) return { [UNDEFINED]: true };
  if (value instanceof Uint8Array) {
    return {
      [BYTES]: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'),
    };
  }
  if (Array.isArray(value)) return value.map(encodeForWire);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encodeForWire(item)]),
    );
  }
  return value;
}

/** The message {@link encodeForWire} was given, rebuilt from its markers. */
export function decodeFromWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeFromWire);
  if (!isPlainObject(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && value[UNDEFINED] === true) return undefined;
  const bytes = value[BYTES];
  if (keys.length === 1 && typeof bytes === 'string') {
    return new Uint8Array(Buffer.from(bytes, 'base64'));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, decodeFromWire(item)]),
  );
}
