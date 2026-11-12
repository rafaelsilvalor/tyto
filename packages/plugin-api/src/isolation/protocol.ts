import { type Diagnostic, diagnostic, diagnosticCodeList } from '@tyto/core';
import { z } from 'zod';

import {
  agentServerSchema,
  windowToolInputSchema,
  windowToolResultSchema,
  windowToolSchema,
} from '../window.js';

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
 * the strict `page` schema of a guest on 8 would refuse (ADR 0148); 10 since a template call
 * carries the template's declared values, a field the strict schema of a guest on 9 would
 * refuse (ADR 0153, TYTO-439); 11 since a brand kit may carry the brand's colours, which the
 * strict kit schema of a guest on 10 would refuse in a template call and a host on 10 in a
 * `brand-kit` registration (ADR 0155); 12 since a template's `build` carries the files the
 * host read from the template's own folder, a fourth argument the strict tuple of a guest on
 * 11 would refuse (ADR 0062, TYTO-478); 13 since an image's ref may carry its pixel size, a
 * field the strict ref schema of a guest on 12 would refuse in a declared value or a shipped
 * image (ADR 0158, TYTO-481); 14 since a template may report `W_TEMPLATE_ORPHAN`, a code the
 * strict report schema of a host on 13 would refuse with the whole answer (ADR 0167, TYTO-516);
 * 15 since a template may report `W_TEMPLATE_FILE_MISSING`, which a host on 14 would refuse the
 * same way (ADR 0058, TYTO-502); 16 since a planned operation may carry its `payload` and an
 * action or a sink may register `apply`, a field and a callable the strict plan and verb
 * schemas of a side on 15 would refuse (ADR 0170, TYTO-378); 17 since a panel may register
 * `call`, a callable the strict panel schema of a side on 16 would refuse (ADR 0173, TYTO-372);
 * 18 since a plugin may ask for a sign-in's access token, a request a host on 17 would refuse
 * as an unknown capability (ADR 0174, TYTO-374); 19 since a plugin may start a program it names
 * and the host sends that program's output back on its own, four requests a host on 18 would
 * refuse and a `process` message a guest on 18 would not read (ADR 0182, TYTO-568); 20 since a
 * plugin may ask for the window's agent server, a request a host on 19 would refuse as an
 * unknown capability (ADR 0183, TYTO-569); 21 since the answer to `processStart` carries the
 * folder the program runs in, a field the strict schema of a guest on 20 would refuse (ADR 0182,
 * note of 2026-11-09, TYTO-569); 22 since a plugin may ask for a terminal tab running a program
 * it declares, a request a host on 21 would refuse as an unknown capability (ADR 0184,
 * TYTO-657); 23 since a plugin may list and call the window's tools in process, two requests a
 * host on 22 would refuse as unknown capabilities (ADR 0190, TYTO-661); 24 since `fetch` may
 * carry `credentialHeaders`, which the strict schema of a host on 23 would refuse, and a plugin
 * may keep durable records, three requests a host on 23 would refuse (ADR 0191, TYTO-661); 25
 * since a recipe `transform` call carries `refresh` on a run without cache, a field the strict
 * `transform` schema of a guest on 24 would refuse (ADR 0148, TYTO-681).
 */
export const RPC_PROTOCOL_VERSION = 25;

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
 * A program the plugin started, speaking (ADR 0182): a chunk of its stdout or stderr, or its
 * end. Sent by the host on its own, after the answer to `processStart` that named `id`; `exit`
 * is the last message about that id.
 */
export const processMessageSchema = z.discriminatedUnion('event', [
  z.strictObject({
    protocol,
    type: z.literal('process'),
    id: z.number().int().nonnegative(),
    event: z.enum(['stdout', 'stderr']),
    bytes: z.instanceof(Uint8Array),
  }),
  z.strictObject({
    protocol,
    type: z.literal('process'),
    id: z.number().int().nonnegative(),
    event: z.literal('exit'),
    code: z.number().int().nullable(),
    signal: z.string().nullable(),
  }),
]);

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
  processMessageSchema,
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
  'storageGet',
  'storageSet',
  'storageDelete',
  'cachePut',
  'cacheDelete',
  'cacheList',
  'workspaceRead',
  'workspaceWrite',
  'signinAccessToken',
  'processStart',
  'processWrite',
  'processEnd',
  'processKill',
  'windowAgentServer',
  'windowTools',
  'windowCallTool',
  'terminalOpen',
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
   * and its `.set` and `.delete`, `host.cache`, `host.workspace`, `host.signin`,
   * `host.process` with what a started program's handle does, and `host.window`.
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
      /** Header to credential key: names only; the host reads the secret (ADR 0191). */
      credentialHeaders: z.record(z.string(), z.string().min(1)).optional(),
    })
    .optional(),
]);

/**
 * `host.storage` (ADR 0191): a key out, and for `get` a found flag with the value, because a
 * stored `null` is a record and not a miss. The value's checks are `checkedCapabilities`'s.
 */
export const storageKeyArgsSchema = z.tuple([z.string()]);
export const storageSetArgsSchema = z.tuple([z.string(), z.unknown()]);
export const storageGetSchema = z.union([
  z.strictObject({ found: z.literal(false) }),
  z.strictObject({ found: z.literal(true), value: z.unknown() }),
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

/**
 * `host.signin.accessToken` (ADR 0174): the id goes out, the access token comes back, and that
 * is the whole exchange. No message carries a refresh token, in either direction.
 */
export const signinArgsSchema = z.tuple([z.string().min(1)]);
export const signinTokenSchema = z.string().min(1);

/**
 * `host.process` (ADR 0182). The name and the arguments go out and a number naming the program
 * comes back; every later request names it by that number. Shape only: the permission, the
 * limit and the size of a write are `checkedProcesses`' to refuse, with a diagnostic.
 */
export const processStartArgsSchema = z.tuple([z.string(), z.array(z.string())]);
export const processStartedSchema = z.strictObject({
  id: z.number().int().nonnegative(),
  cwd: z.string().min(1),
});
export const processWriteArgsSchema = z.tuple([z.number().int().nonnegative(), bytesSchema]);
export const processIdArgsSchema = z.tuple([z.number().int().nonnegative()]);

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

/**
 * What a callable's answer that its result schema refuses becomes: `E_PLUGIN_PROTOCOL`, naming
 * the plugin and what did not match. An isolated plugin's answer meets it on the wire; an
 * in-process panel `call` meets the same one in `callPanel` (TYTO-644), so a plugin answers
 * alike on both paths.
 */
export function unmatchedAnswer(plugin: string, error: z.ZodError): Diagnostic {
  return diagnostic('E_PLUGIN_PROTOCOL', {
    plugin,
    problem: `its answer does not match: ${describeIssues(error)}`,
  });
}

/**
 * `host.window.agentServer` (ADR 0183): nothing goes out, the server comes back, checked by the
 * same schema the host's check used, so a guest never hands its plugin an extra field.
 */
export const windowAgentServerArgsSchema = z.tuple([]);
export const windowAgentServerSchema = agentServerSchema;

/**
 * `host.window.tools` and `host.window.callTool` (ADR 0190): the tools come back through the same
 * strict schema the host's check used; a call sends a name and a JSON object, and its answer
 * comes back the same way. Shape only: the permission is `checkedWindowTools`'s.
 */
export const windowToolsArgsSchema = z.tuple([]);
export const windowToolsSchema = z.array(windowToolSchema);
export const windowCallToolArgsSchema = z.tuple([z.string(), windowToolInputSchema]);
export { windowToolResultSchema };

/**
 * `host.terminal.open` (ADR 0184): the name and the arguments go out, nothing comes back but
 * that the tab opened. Shape only: the permission and the limit are `checkedTerminal`'s.
 */
export const terminalOpenArgsSchema = z.tuple([z.string(), z.array(z.string())]);
