import { type Diagnostics, type Result, diagnostic, err } from '@tyto/core';
import type { JsonValue } from '@tyto/recipe';
import { z } from 'zod';

import type { PanelCallRequest, PanelContribution } from './contributions.js';
import { resultSchema, unmatchedAnswer } from './isolation/protocol.js';
import { jsonByteLength, jsonValueSchema } from './json.js';

/**
 * A panel's page asking its own plugin's process to do work (ADR 0173, TYTO-372).
 *
 * The page is sandboxed (ADR 0045) and anybody's JavaScript, so everything it sends is checked
 * here, on the host, before the plugin sees it — and checked again in an isolated plugin's
 * process by the `call` callable of the `panel` point, which shares these schemas. What the
 * plugin answers is checked here too, with the schema an isolated answer meets on the wire,
 * so an in-process plugin answers exactly as the same plugin would isolated (TYTO-644).
 */

/**
 * A method's name: a lowercase letter, then up to 99 word characters, dots or dashes. A name,
 * not a path or a sentence, so it can be logged and matched without escaping.
 */
export const PANEL_CALL_METHOD = /^[a-z][\w.-]{0,99}$/u;

/**
 * The largest `params`, and the largest answer, as UTF-8 bytes of JSON. A panel asks for a
 * list or a status, not a file: 1 MiB holds a Drive folder of thousands of entries and keeps
 * one call one message.
 */
export const PANEL_CALL_MAX_BYTES = 1024 * 1024;

const withinCeiling = (value: JsonValue): boolean => jsonByteLength(value) <= PANEL_CALL_MAX_BYTES;
const CEILING = `must be at most ${String(PANEL_CALL_MAX_BYTES)} bytes of JSON`;

/**
 * The request, strictly: a key the page adds — a `plugin`, a `panel` — is refused rather than
 * ignored, because which plugin answers is the host's to know and never the page's to say.
 */
export const panelCallRequestSchema = z.strictObject({
  method: z
    .string()
    .regex(PANEL_CALL_METHOD, 'must be a lowercase letter and up to 99 letters, digits, _ . -'),
  params: jsonValueSchema.refine(withinCeiling, CEILING).optional(),
}) as unknown as z.ZodType<PanelCallRequest>;

/** An answer's value: JSON under the same ceiling. */
export const panelCallAnswerSchema: z.ZodType<JsonValue> = jsonValueSchema.refine(
  withinCeiling,
  CEILING,
);

/**
 * The whole answer, `Result<JsonValue, Diagnostics>` as it crosses the wire: `{ ok: true,
 * value, diagnostics }` or `{ ok: false, error }`, strictly. **One schema for both paths**: the
 * `panel` point's `call` checks an isolated plugin's answer with it, and `callPanel` an
 * in-process one, so an answer the wire refuses is refused in process too (TYTO-644).
 */
export const panelCallResultSchema: z.ZodType = resultSchema(panelCallAnswerSchema);

type PanelCallResult = Result<JsonValue, Diagnostics>;

function refused(panel: string, problem: string): PanelCallResult {
  return err([diagnostic('E_PANEL_CALL', { panel, problem })]);
}

function issuesOf(error: z.ZodError, root: string): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || root} ${issue.message}`)
    .join('; ');
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * Calls `panel`'s own plugin, named `plugin`, with what its page sent. `panel` is the
 * contribution the caller found from what it trusts — the frame the message came from — and
 * **never** from anything the page wrote, so a page reaches its own plugin and no other.
 *
 * A refusal of the request, a missing `call` and a throw from an in-process `call` are
 * `E_PANEL_CALL`. The answer is checked with {@link panelCallResultSchema}, the schema the
 * wire holds an isolated answer to, and one it refuses is `E_PLUGIN_PROTOCOL` naming `plugin`,
 * as the isolated path answers it — so `{ ok: true, value }` without `diagnostics` is refused
 * here exactly as it is across a process boundary. The plugin's own refusal, and what isolation
 * answers for a call it could not finish (`E_PLUGIN_TIMEOUT` past the 30 s deadline,
 * `E_PLUGIN_CRASHED`), arrive as they are.
 */
export async function callPanel(
  panel: PanelContribution,
  request: unknown,
  plugin: string,
): Promise<PanelCallResult> {
  if (panel.call === undefined) return refused(panel.id, "its plugin registered no 'call'");
  let checked: z.ZodSafeParseResult<PanelCallRequest>;
  try {
    checked = panelCallRequestSchema.safeParse(request);
  } catch (thrown) {
    // A value nested past the stack's depth is refused, not a crash of the host.
    return refused(panel.id, `the request could not be read: ${messageOf(thrown)}`);
  }
  if (!checked.success) {
    return refused(panel.id, `the request is refused: ${issuesOf(checked.error, 'request')}`);
  }
  let answer: unknown;
  try {
    answer = await panel.call.call(panel, checked.data);
  } catch (thrown) {
    return refused(panel.id, `its plugin threw: ${messageOf(thrown)}`);
  }
  return checkedAnswer(panel.id, plugin, answer);
}

/** Refuse, never normalise: an answer the wire would refuse is not repaired in process. */
function checkedAnswer(panel: string, plugin: string, answer: unknown): PanelCallResult {
  let checked: z.ZodSafeParseResult<unknown>;
  try {
    checked = panelCallResultSchema.safeParse(answer);
  } catch (thrown) {
    return refused(panel, `its plugin's answer could not be read: ${messageOf(thrown)}`);
  }
  if (!checked.success) return err([unmatchedAnswer(plugin, checked.error)]);
  return checked.data as PanelCallResult;
}

/** A panel with the plugin that contributed it, as the registry recorded it. */
export interface OwnedPanel {
  readonly plugin: string;
  readonly panel: PanelContribution;
}

/** What {@link panelCallerOf} reads: the registry's panels with their plugins. */
export interface PanelContributions {
  ownedPanels(): readonly OwnedPanel[];
}

/**
 * Calls by plugin and panel id together: the panel is looked up in the registry, read per
 * call, so a plugin withdrawn from the host stops answering. Both names are the caller's — the
 * frame's — and the request carries no name the lookup reads. Two plugins may each contribute a
 * panel called `settings` (one host refuses the second, but a host composing several registries
 * may hold both), so the id alone could reach another plugin's panel (TYTO-644).
 */
export function panelCallerOf(
  contributions: PanelContributions,
): (plugin: string, panelId: string, request: unknown) => Promise<PanelCallResult> {
  return async (plugin, panelId, request) => {
    const owned = contributions
      .ownedPanels()
      .find((candidate) => candidate.plugin === plugin && candidate.panel.id === panelId);
    if (owned === undefined) {
      return refused(panelId, `no panel with that id is registered by plugin '${plugin}'`);
    }
    return callPanel(owned.panel, request, owned.plugin);
  };
}
