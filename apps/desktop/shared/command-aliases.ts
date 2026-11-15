import { ALIAS_NAME, aliasBodyProblem } from '@tyto/core';
import type { ConfigurationContribution } from '@tyto/plugin-api';
import { z } from 'zod';

/**
 * The command panel's aliases (TYTO-536, ADR 0200 note of 2026-11-15): `alias entrega='render
 * --delivery'` in the panel, kept in two places. The person's own in `settings.json`
 * (`commandAliases`, this setting), and a workspace's in `.tyto/project.json` (`aliases`, read
 * by `@tyto/core`, withheld from a restricted folder). **The workspace's win**, name by name.
 *
 * In `shared/` because main reads the setting and the window expands what it holds.
 */

export type CommandAliases = Readonly<Record<string, string>>;

const aliasName = z.string().regex(ALIAS_NAME, {
  error: 'an alias name is letters, digits, _ and -, not starting with a digit or -',
});

const aliasBody = z.string().superRefine((body, context) => {
  const problem = aliasBodyProblem(body);
  if (problem !== undefined) context.addIssue({ code: 'custom', message: `an alias ${problem}` });
});

export const commandAliasesContribution = {
  id: 'commandAliases',
  schema: z.record(aliasName, aliasBody).readonly(),
  default: {},
  description:
    "The command panel's aliases, by name: the line each one stands for, as `alias name='line'` " +
    "writes it. A workspace's `aliases` in .tyto/project.json win over these, name by name.",
  // One member checked at a time: a bad alias costs itself, never the others.
  members: { key: aliasName, schema: aliasBody },
} satisfies ConfigurationContribution<CommandAliases>;

/** Where an alias the panel expands is defined: the person's settings or the workspace. */
export type AliasOrigin = 'user' | 'workspace';

/** One alias in force, as the panel lists and expands it. */
export interface PanelAlias {
  readonly name: string;
  readonly body: string;
  readonly definedIn: AliasOrigin;
}

/**
 * The aliases in force: the person's, then the workspace's over them name by name, in name
 * order. A workspace withheld because its folder is restricted hands nothing here, so its
 * aliases never run (ADR 0111), and the person's own keep theirs.
 */
export function aliasesInForce(
  user: CommandAliases,
  workspace: readonly { readonly name: string; readonly body: string }[],
): readonly PanelAlias[] {
  const byName = new Map<string, PanelAlias>();
  for (const [name, body] of Object.entries(user))
    byName.set(name, { name, body, definedIn: 'user' });
  for (const { name, body } of workspace) byName.set(name, { name, body, definedIn: 'workspace' });
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
