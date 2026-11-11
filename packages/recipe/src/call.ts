import { type Diagnostic, type Result, type SourceRange, diagnostic, err, ok } from '@tyto/core';
import { z } from 'zod';

import type { NamedArgument } from './ast.js';
import { isDataReference, readDataArgument, readInlineJson } from './data.js';
import {
  PLAN_LIMITS,
  type Plan,
  type PlanLimits,
  type PlannedOperation,
  checkPlan,
} from './plan.js';
import type { Verb, VerbContext, VerbResult } from './registry.js';
import type { AppliedOperation, ApplyOutcome } from './state.js';
import { type Problems, argumentsProblem, argumentsUpTo, locate, requireTable } from './support.js';
import type { Row, Table } from './table.js';
import { type BoundTemplate, bindTemplate, parseTemplate, templateProblem } from './template.js';

/**
 * `call url=<https url> token=<credential> body=<json>` (ADR 0193): an action that sends one
 * HTTP POST per row to a host the workspace allows, with a credential stored on the machine.
 *
 * Running it sends nothing: it answers a plan of one `request` per row, and Apply sends exactly
 * the requests that plan showed (ADR 0129, ADR 0170). The verb is pure and never holds the
 * credential: it names it, and the host reads it and sets the header on its side, as it does
 * for a plugin (ADR 0191). The host lends {@link CallPorts}, bound to the workspace and the
 * recipe it runs, through `createVerbRegistry({ calls })`.
 */
export interface CallPorts {
  /**
   * The hosts the recipe's workspace allows `call` to reach, from the trusted sheets of its
   * project (`recipes.call.hosts`, ADR 0193), lower case. `undefined` when the recipe is in no
   * workspace or its folder is restricted. Asked on every run and every Apply, so a host taken
   * off the list, or a folder restricted, since the plan stops the Apply.
   */
  hosts(): readonly string[] | undefined;
  /** Whether a credential of that name is stored for recipes on this machine. Never its value. */
  hasCredential(name: string): Promise<boolean>;
  /**
   * Sends one request. The host reads the credential named and sets it as
   * `Authorization: Bearer <value>`, checks the URL's host against {@link hosts} again, follows
   * no redirect (a 3xx is answered as its status), gives up at `deadlineMs`, and answers the
   * status alone: the response's body is never read into the answer. An error names no
   * credential's value. A host that sends nothing (`tyto mcp`) leaves it out, and Apply says
   * so.
   */
  readonly send?:
    ((request: CallRequest) => Promise<Result<CallResponse, readonly Diagnostic[]>>) | undefined;
  /** The host's clock as ISO 8601 in UTC, which stamps an applied request; the system's if absent. */
  now?(): string;
}

export interface CallRequest {
  readonly method: 'POST';
  /** Absolute, `https:`, its host one {@link CallPorts.hosts} allowed when the plan was made. */
  readonly url: string;
  /** The stored credential to send, by name. */
  readonly credential: string;
  /** JSON text, sent as `application/json`. */
  readonly body: string;
  readonly deadlineMs: number;
}

export interface CallResponse {
  readonly status: number;
}

/** The kind of write `call` declares, and the only one its plans hold. */
export const CALL_WRITE = 'request';

/** A request that takes longer is given up as failed (ADR 0042's deadline, per request). */
export const CALL_DEADLINE_MS = 30_000;

/** A body past this many UTF-8 bytes is refused at plan time, naming the row. */
export const CALL_BODY_LIMIT_BYTES = 16 * 1024;

/**
 * Its own ceilings: a thousand requests a plan, since each one leaves the machine. The payload
 * names the URL and the body's size; the body itself is kept beside the plan, never in it.
 */
export const CALL_PLAN_LIMITS: PlanLimits = { ...PLAN_LIMITS, maxOperations: 1000 };

/**
 * A credential's name: lower-case words, as a store's or a plugin's is. Exported so the desktop's
 * screen that stores one refuses the names `token=` would refuse (ADR 0193 decision 5).
 */
export const CALL_CREDENTIAL_NAME = /^[a-z][a-z0-9-]{0,63}$/u;

/**
 * `https://host[:port][/path][?query]`, without a user, a password or a fragment. Read by hand
 * because `@tyto/recipe` has no `URL` (ADR 0010); the host parses it again before it sends.
 */
const HTTPS_URL = /^https:\/\/([a-z0-9.-]+)(?::(\d{1,5}))?(?:[/?][^\s#]*)?$/iu;

/** How much of a body a plan's line shows. */
const PREVIEW_LENGTH = 300;

const REPORTED = 8;
const NAMES = ['url', 'token', 'body'] as const;

/** One request of a shown plan, as Apply sends it. */
interface ShownRequest {
  readonly rowKey: string;
  readonly url: string;
  readonly host: string;
  readonly credential: string;
  readonly body: string;
}

/**
 * Every plan a `call` answered, by the plan object the runner keeps (ADR 0170, ADR 0172
 * decision 3). Apply sends from here, never from what the plan object holds by then, so a body
 * is not bound by a payload's 2,048 bytes and a copied or edited plan sends nothing.
 */
const shownRequests = new WeakMap<Plan, readonly ShownRequest[]>();

export function callVerb(ports: CallPorts | undefined): Verb {
  return {
    kind: 'action',
    run: (context) => planCalls(context, ports),
    apply: (plan) => applyCalls(plan, ports),
  };
}

function refuse(problem: string, range: SourceRange): VerbResult {
  return err([diagnostic('E_RECIPE_CALL', { problem }, { range })]);
}

/** The host of an `https:` URL, lower case, or why the URL is not one `call` sends to. */
export function httpsHost(url: string): Result<string, string> {
  if (!/^https:\/\//iu.test(url)) return err('is not an https:// address, and call sends no other');
  const match = HTTPS_URL.exec(url);
  const host = match?.[1];
  if (host === undefined) {
    return err('is not an address call can send to: no user, password, fragment or blank in it');
  }
  const port = match?.[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65_535)) {
    return err(`names the port ${port}, which does not exist`);
  }
  return ok(host.toLowerCase().replace(/\.$/u, ''));
}

async function planCalls(context: VerbContext, ports: CallPorts | undefined): Promise<VerbResult> {
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  // Inline JSON runs to the end of the line: the words after `body=` are its own.
  const bodyWritten = context.step.named.find((written) => written.name === 'body');
  const inline =
    bodyWritten !== undefined && !isDataReference(bodyWritten.value) ? bodyWritten : undefined;
  const { named, positional } = argumentsUpTo(context, inline);
  const [extra] = positional;
  if (extra !== undefined) {
    return argumentsProblem(
      context,
      `takes no bare word, and '${extra.value}' is one`,
      extra.range,
    );
  }
  const argument: Partial<Record<(typeof NAMES)[number], NamedArgument>> = {};
  for (const written of named) {
    if (!(NAMES as readonly string[]).includes(written.name)) {
      return argumentsProblem(
        context,
        `does not take '${written.name}='; it accepts ${NAMES.join(', ')}`,
        at(written.range),
      );
    }
    const name = written.name as (typeof NAMES)[number];
    if (argument[name] !== undefined) {
      return argumentsProblem(context, `was given '${name}=' twice`, at(written.range));
    }
    argument[name] = written;
  }
  const { url, token, body } = argument;
  if (url === undefined || token === undefined || body === undefined) {
    return argumentsProblem(context, 'needs url=<https address> token=<credential> body=<json>');
  }

  const host = httpsHost(url.value);
  if (!host.ok) return refuse(`url=${url.value} ${host.error}`, at(url.range));
  if (!CALL_CREDENTIAL_NAME.test(token.value)) {
    return refuse(
      `names a credential in lower-case letters, digits and -, and '${token.value}' is not one`,
      at(token.range),
    );
  }
  if (ports !== undefined) {
    const allowed = ports.hosts();
    if (allowed === undefined) {
      return refuse(
        'sends only from a trusted workspace, and this recipe is in none or in a restricted folder',
        at(url.range),
      );
    }
    if (!allowed.includes(host.value)) {
      return refuse(
        `may not send to ${host.value}: add it to recipes.call.hosts in the workspace's ` +
          '.tyto/project.json first',
        at(url.range),
      );
    }
    if (!(await ports.hasCredential(token.value))) {
      return refuse(
        `has no credential named '${token.value}' stored on this machine; store it first, in ` +
          'the window under Recipe credentials in the plugins screen (Show plugins), or in the ' +
          'command line as TYTO_RECIPE_CREDENTIAL_<NAME>, which tyto recipe run --apply reads',
        at(token.range),
      );
    }
  }

  const template = await readBody(context, body);
  if (!template.ok) return template;
  const bound = bindBody(template.value, table.value, context.aliases, at(body.range));
  if (!bound.ok) return bound;

  const problems: Diagnostic[] = [];
  const requests: ShownRequest[] = [];
  for (const row of table.value.rows) {
    const text = JSON.stringify(bound.value(row));
    const bytes = utf8Length(text);
    if (bytes > CALL_BODY_LIMIT_BYTES) {
      if (problems.length < REPORTED) {
        problems.push(
          diagnostic(
            'E_RECIPE_CALL',
            {
              problem: `would send ${String(bytes)} bytes for row '${row.key}', past ${String(CALL_BODY_LIMIT_BYTES)}`,
            },
            { range: at(body.range) },
          ),
        );
      }
      continue;
    }
    requests.push({
      rowKey: row.key,
      url: url.value,
      host: host.value,
      credential: token.value,
      body: text,
    });
  }
  if (problems.length > 0) return err(problems);

  const operations: PlannedOperation[] = requests.map((request) => ({
    write: CALL_WRITE,
    rowKey: request.rowKey,
    description: `POST ${request.url} ${preview(request.body)}`,
    payload: { url: request.url, bytes: utf8Length(request.body) },
  }));
  const sends = ports?.send !== undefined;
  const plan: Plan = {
    target: `requests to ${host.value}${sends ? '' : ' (this host sends none)'}`,
    operations,
    count: operations.length,
  };
  const checked = checkPlan(
    plan,
    { verb: 'call', writes: [CALL_WRITE], table: table.value },
    CALL_PLAN_LIMITS,
  );
  if (!checked.ok) return checked;
  shownRequests.set(checked.value, requests);
  return ok({ table: table.value, plan: checked.value });
}

/** `body=@./call.json#/routine` or `body={"key":"{key|}"}`, any JSON value. */
function readBody(
  context: VerbContext,
  argument: NamedArgument,
): Result<unknown, Problems> | Promise<Result<unknown, Problems>> {
  if (isDataReference(argument.value)) return readDataArgument(context, argument, z.unknown());
  return readInlineJson(context, argument, z.unknown());
}

type JsonBody =
  string | number | boolean | null | readonly JsonBody[] | { [key: string]: JsonBody };

/**
 * The body with each string value a template filled from the row (ADR 0136), keys and other
 * values as written. An empty value is an empty string. The JSON is built as a value and written
 * once, so no cell can break out of its string.
 */
function bindBody(
  value: unknown,
  table: Table,
  aliases: ReadonlyMap<string, string>,
  range: SourceRange,
): Result<(row: Row) => JsonBody, Problems> {
  if (typeof value === 'string') {
    const template = parseTemplate(value);
    if (!template.ok) return err(templateProblem(value, template.error, range));
    const bound: Result<BoundTemplate, Problems> = bindTemplate(
      template.value,
      table,
      aliases,
      range,
    );
    if (!bound.ok) return bound;
    return ok((row) => bound.value.fill(row) ?? '');
  }
  if (Array.isArray(value)) {
    const items: ((row: Row) => JsonBody)[] = [];
    for (const item of value as unknown[]) {
      const bound = bindBody(item, table, aliases, range);
      if (!bound.ok) return bound;
      items.push(bound.value);
    }
    return ok((row) => items.map((item) => item(row)));
  }
  if (value !== null && typeof value === 'object') {
    const members: [string, (row: Row) => JsonBody][] = [];
    for (const [key, member] of Object.entries(value)) {
      const bound = bindBody(member, table, aliases, range);
      if (!bound.ok) return bound;
      members.push([key, bound.value]);
    }
    return ok((row) => Object.fromEntries(members.map(([key, member]) => [key, member(row)])));
  }
  const constant = value as JsonBody;
  return ok(() => constant);
}

function preview(body: string): string {
  return body.length <= PREVIEW_LENGTH ? body : `${body.slice(0, PREVIEW_LENGTH - 1)}…`;
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Apply (ADR 0170): the requests of a plan a `call` answered, sent one by one. A host that
 * sends nothing, a folder no longer trusted, a host taken off the list or a credential gone
 * since the plan refuses the whole Apply before any request. A 2xx is applied; any other status,
 * or no answer, fails that row with the status or the host's reason, never the response's body,
 * and the others still go.
 */
async function applyCalls(
  plan: Plan,
  ports: CallPorts | undefined,
): Promise<Result<ApplyOutcome, readonly Diagnostic[]>> {
  const refuseApply = (problem: string) =>
    err([diagnostic('E_RECIPE_APPLY', { verb: 'call', problem })]);
  const shown = shownRequests.get(plan);
  if (shown === undefined) {
    return refuseApply('no call answered that plan in this session; run its cell again');
  }
  const send = ports?.send?.bind(ports);
  if (ports === undefined || send === undefined) return refuseApply('this host sends no requests');
  const allowed = ports.hosts();
  if (allowed === undefined) {
    return refuseApply('the recipe is no longer in a trusted workspace');
  }
  for (const host of new Set(shown.map((request) => request.host))) {
    if (!allowed.includes(host)) {
      return refuseApply(`${host} is no longer in the workspace's recipes.call.hosts`);
    }
  }
  for (const credential of new Set(shown.map((request) => request.credential))) {
    if (!(await ports.hasCredential(credential))) {
      return refuseApply(`no credential named '${credential}' is stored on this machine any more`);
    }
  }

  const now = ports.now ?? (() => new Date().toISOString());
  const operations: AppliedOperation[] = [];
  for (const request of shown) {
    const answer = await send({
      method: 'POST',
      url: request.url,
      credential: request.credential,
      body: request.body,
      deadlineMs: CALL_DEADLINE_MS,
    });
    if (!answer.ok) {
      operations.push({
        rowKey: request.rowKey,
        status: 'failed',
        reason: `could not reach ${request.host}: ${messages(answer.error)}`,
      });
    } else if (answer.value.status >= 200 && answer.value.status < 300) {
      operations.push({ rowKey: request.rowKey, status: 'applied', appliedAt: now() });
    } else {
      operations.push({
        rowKey: request.rowKey,
        status: 'failed',
        reason: `${request.host} answered HTTP ${String(answer.value.status)}`,
      });
    }
  }
  return ok({ operations });
}

function messages(found: readonly Diagnostic[]): string {
  return found.map((item) => item.message.replace(/\.$/u, '')).join('; ') || 'no reason given';
}
