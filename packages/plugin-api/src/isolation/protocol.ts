import { type Diagnostic, diagnosticCodeList } from '@tyto/core';
import { z } from 'zod';

/**
 * The messages between the host and an isolated plugin (E11.2, ADR 0041).
 *
 * **Each side validates what it receives**, with these schemas. The host reads a guest
 * that may be anybody's code, so every message a guest sends is parsed before anything
 * acts on it; the guest parses the host's too, because the two ends are built separately
 * and a message nobody validated is the one a mismatched pair would misread in silence.
 *
 * **`protocol` is its own number, not the engine.** The engine says which host contract a
 * plugin was written against (ADR 0040), and a plugin never sees these messages: both ends
 * of this protocol ship inside the same app. The number exists for the day they do not —
 * a worker bundle left behind by an upgrade — and the `hello` handshake is where it is
 * compared, before any other message is read.
 */

export const RPC_PROTOCOL_VERSION = 1;

const protocol = z.literal(RPC_PROTOCOL_VERSION);

/**
 * A function the guest kept, named by a number.
 *
 * A contribution crosses as data, and every function in it is replaced by one of these: a
 * function cannot be cloned, and the host calls it back by handle (`call`).
 */
export const callHandleSchema = z.strictObject({ $call: z.number().int().nonnegative() });
export type CallHandle = z.infer<typeof callHandleSchema>;

const rangeSchema = z.strictObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

/** A diagnostic, as a guest may return it: a code the catalog knows, and its message. */
export const diagnosticSchema = z.strictObject({
  severity: z.enum(['error', 'warning']),
  code: z.enum(diagnosticCodeList as [string, ...string[]]),
  message: z.string(),
  range: rangeSchema.optional(),
  hint: z.string().optional(),
}) as unknown as z.ZodType<Diagnostic>;

/** `Result<T, Diagnostics>`, as a guest's function answers it. */
export function resultSchema<T>(value: z.ZodType<T>): z.ZodType {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value, diagnostics: z.array(diagnosticSchema) }),
    z.strictObject({ ok: z.literal(false), error: z.array(diagnosticSchema) }),
  ]);
}

/* --------------------------------------------------------------- host → guest -- */

export const activateMessageSchema = z.strictObject({
  protocol,
  type: z.literal('activate'),
  plugin: z.string().min(1),
  /** The plugin's slice of the configuration, raw. `config(schema)` validates it. */
  config: z.unknown(),
});

export const callMessageSchema = z.strictObject({
  protocol,
  type: z.literal('call'),
  id: z.number().int().nonnegative(),
  handle: z.number().int().nonnegative(),
  args: z.array(z.unknown()),
});

/** A host event the plugin may be listening to (`PluginHost.events`). */
export const eventMessageSchema = z.strictObject({
  protocol,
  type: z.literal('event'),
  event: z.enum(['registered', 'disposed']),
  payload: z.strictObject({ point: z.string(), id: z.string() }),
});

export const hostMessageSchema = z.discriminatedUnion('type', [
  activateMessageSchema,
  callMessageSchema,
  eventMessageSchema,
]);
export type HostMessage = z.infer<typeof hostMessageSchema>;

/* --------------------------------------------------------------- guest → host -- */

/** The first message, and the only one read before its `protocol` is compared. */
export const helloMessageSchema = z.object({
  type: z.literal('hello'),
  protocol: z.number(),
});
export type HelloMessage = z.infer<typeof helloMessageSchema>;

export const registrationSchema = z.strictObject({
  point: z.string(),
  contribution: z.record(z.string(), z.unknown()),
});
export type Registration = z.infer<typeof registrationSchema>;

export const guestMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    protocol,
    type: z.literal('activated'),
    registrations: z.array(registrationSchema),
  }),
  z.strictObject({ protocol, type: z.literal('failed'), problem: z.string() }),
  z.strictObject({
    protocol,
    type: z.literal('result'),
    id: z.number().int().nonnegative(),
    value: z.unknown(),
  }),
  z.strictObject({
    protocol,
    type: z.literal('thrown'),
    id: z.number().int().nonnegative(),
    problem: z.string(),
  }),
  z.strictObject({
    protocol,
    type: z.literal('log'),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string(),
    detail: z.unknown().optional(),
  }),
  /** A contribution the plugin disposed of itself, after activation. */
  z.strictObject({
    protocol,
    type: z.literal('withdrawn'),
    point: z.string(),
    id: z.string(),
  }),
]);
export type GuestMessage = z.infer<typeof guestMessageSchema>;

/** `contributes.1 must be…` — the path Zod reports, for a message about a message. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'} ${issue.message}`)
    .join('; ');
}
