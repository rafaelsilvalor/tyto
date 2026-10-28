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

/**
 * 2 since `hello` carried the sandbox report (ADR 0049); 3 since a template call carries
 * the brand kit, which a strict schema on an older guest would refuse (ADR 0063); 4 since
 * the kit's marks may be toned and it may carry a wordmark, which a guest on 3 would
 * refuse the same way (ADR 0066); 5 since a plugin may store and forget a credential, two
 * requests a host on 4 would refuse as an unknown capability (ADR 0134); 6 since a plugin
 * has a private cache and the workspace's files, six requests a host on 5 would refuse the
 * same way (ADR 0138); 7 since the host sends a plugin its settings again whenever they change,
 * a `configure` message a guest on 6 would not read (ADR 0145); 8 since every recipe verb call
 * carries the plugin's project section, a field the strict schemas of a guest on 7 would refuse
 * (ADR 0147); 9 since a source's `page` call carries `refresh` on a run without cache, a field
 * the strict `page` schema of a guest on 8 would refuse (ADR 0148).
 */
export const RPC_PROTOCOL_VERSION = 9;

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

/**
 * The plugin's slice of the configuration, replaced (ADR 0145): sent when the plugin is
 * activated into a host and again on every `InProcessHost.configure`. One process activated
 * into several hosts keeps the last one it was sent.
 */
export const configureMessageSchema = z.strictObject({
  protocol,
  type: z.literal('configure'),
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

/**
 * The host's answer to a guest's `request`. A refusal carries the diagnostic, so the guest
 * can reject with the same code the host decided on.
 */
export const responseMessageSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    protocol,
    type: z.literal('response'),
    id: z.number().int().nonnegative(),
    ok: z.literal(true),
    value: z.unknown(),
  }),
  z.strictObject({
    protocol,
    type: z.literal('response'),
    id: z.number().int().nonnegative(),
    ok: z.literal(false),
    message: z.string(),
    diagnostic: diagnosticSchema.optional(),
  }),
]);

export const hostMessageSchema = z.union([
  activateMessageSchema,
  configureMessageSchema,
  callMessageSchema,
  eventMessageSchema,
  responseMessageSchema,
]);
export type HostMessage = z.infer<typeof hostMessageSchema>;

/* --------------------------------------------------------------- guest → host -- */

/**
 * What the plugin's process found when it tried to read a file outside its grant, before the
 * plugin's module was imported (ADR 0049).
 *
 * `denied` is the only answer that proves the permission model is enforcing: the file is
 * known to exist, so a refusal cannot be a missing file. `readable` is a process that is not
 * confined, and `failed` is any other outcome, `ENOENT` included, named in `detail`.
 */
export const sandboxReportSchema = z.strictObject({
  /** The runtime the process runs on, as the diagnostic names it: `Node v24.21.0`. */
  runtime: z.string().min(1),
  canary: z.enum(['denied', 'readable', 'failed']),
  detail: z.string(),
});
export type SandboxReport = z.infer<typeof sandboxReportSchema>;

/**
 * The first message, and the only one read before its `protocol` is compared.
 *
 * `sandbox` is optional in the schema so that a guest that sends none is told so by name
 * rather than as a malformed message; a host that requires the sandbox refuses it all the
 * same (ADR 0049).
 */
export const helloMessageSchema = z.object({
  type: z.literal('hello'),
  protocol: z.number(),
  sandbox: sandboxReportSchema.optional(),
});
export type HelloMessage = z.infer<typeof helloMessageSchema>;

export const registrationSchema = z.strictObject({
  point: z.string(),
  contribution: z.record(z.string(), z.unknown()),
});
export type Registration = z.infer<typeof registrationSchema>;

const requestedCapabilitySchema = z.enum([
  'fetch',
  'credentials',
  'storeCredential',
  'deleteCredential',
  'cacheGet',
  'cachePut',
  'cacheDelete',
  'cacheList',
  'workspaceRead',
  'workspaceWrite',
]);
export type RequestedCapability = z.infer<typeof requestedCapabilitySchema>;

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
  /**
   * The plugin asking the host for one of its capabilities: `host.fetch`, `host.credentials`
   * and its `.set` and `.delete`, `host.cache` and `host.workspace`.
   */
  z.strictObject({
    protocol,
    type: z.literal('request'),
    id: z.number().int().nonnegative(),
    capability: requestedCapabilitySchema,
    args: z.array(z.unknown()),
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

/** What `host.fetch` sends, checked by the host before the permission check reads it. */
export const fetchArgsSchema = z.tuple([
  z.string(),
  z
    .strictObject({
      method: z.string().min(1).optional(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.union([z.string(), z.instanceof(Uint8Array)]).optional(),
    })
    .optional(),
]);

export const credentialsArgsSchema = z.tuple([z.string().min(1)]);
/** The size ceiling is not here: it is checked once, in `checkedCapabilities`. */
export const storeCredentialArgsSchema = z.tuple([z.string().min(1), z.string().min(1)]);
export const deleteCredentialArgsSchema = credentialsArgsSchema;

/*
 * The cache and the workspace (ADR 0138). Shape only: an empty key, a path that leaves the
 * folder and an entry over the ceiling are `checkedCapabilities`' to refuse, with the
 * diagnostic a plugin can read, rather than a schema complaint here.
 */
const bytesSchema = z.instanceof(Uint8Array);
export const cacheKeyArgsSchema = z.tuple([z.string()]);
export const cachePutArgsSchema = z.tuple([z.string(), bytesSchema]);
export const workspaceReadArgsSchema = z.tuple([z.string()]);
export const workspaceWriteArgsSchema = z.tuple([z.string(), bytesSchema]);

/** `host.cache.get`'s answer; `null` is a miss, because a JSON channel drops `undefined`. */
export const cacheEntrySchema = z.union([
  z.null(),
  z.strictObject({ bytes: bytesSchema, storedAt: z.string().min(1) }),
]);
export const cacheStoredSchema = z.strictObject({ storedAt: z.string().min(1) });
export const cacheListingSchema = z.array(
  z.strictObject({
    key: z.string().min(1),
    storedAt: z.string().min(1),
    size: z.number().int().nonnegative(),
  }),
);
export const workspaceBytesSchema = bytesSchema;

/** What `host.fetch` answers, checked by the guest before the plugin sees it. */
export const fetchedResponseSchema = z.strictObject({
  url: z.string(),
  status: z.number().int(),
  statusText: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.instanceof(Uint8Array),
});

/** `contributes.1 must be…` — the path Zod reports, for a message about a message. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'} ${issue.message}`)
    .join('; ');
}
