import type { ConfigurationContribution } from '@tyto/plugin-api';
import { z } from 'zod';

/**
 * How the command panel lays out its runs (TYTO-496, ADR 0163): two settings, because Rafael saw
 * the three layouts on 2026-10-30 and asked for all three, chosen in `settings.json`. The order is
 * one; folding the older runs is the other, so newest-first with folding comes free.
 *
 * In `shared/` because both halves read them, and pure, like `line-numbers.ts`.
 */

export const COMMANDS_ORDERS = [
  {
    id: 'newestLast',
    description: 'Each run under the one before, the prompt last, as a terminal does. The default.',
  },
  {
    id: 'newestFirst',
    description: 'The newest run first, under the prompt, which comes first.',
  },
] as const;

export type CommandsOrder = (typeof COMMANDS_ORDERS)[number]['id'];

export const COMMANDS_ORDER_IDS = COMMANDS_ORDERS.map((order) => order.id) as [
  CommandsOrder,
  ...CommandsOrder[],
];

export const commandsOrderContribution = {
  id: 'commandsOrder',
  schema: z.enum(COMMANDS_ORDER_IDS, {
    error: () => `the orders are ${COMMANDS_ORDER_IDS.map((id) => `'${id}'`).join(', ')}`,
  }),
  default: 'newestLast',
  description:
    "The order of the command panel's runs, and of their sections in Problems: 'newestLast' (the default) or 'newestFirst'.",
  options: COMMANDS_ORDERS.map((order) => ({ value: order.id, description: order.description })),
} satisfies ConfigurationContribution<CommandsOrder>;

export const commandsFoldOlderRunsContribution = {
  id: 'commandsFoldOlderRuns',
  schema: z.boolean(),
  default: false,
  description:
    'Fold every run of the command panel but the newest to its header line; a click opens one (default false).',
} satisfies ConfigurationContribution<boolean>;

/** The two keys as a newly created `settings.json` shows them, commented out. */
export function commandRunsExample(): string {
  return [
    "// The order of the command panel's runs:",
    ...COMMANDS_ORDERS.map((order) => `//   "${order.id}": ${order.description}`),
    '// "commandsOrder": "newestLast",',
    '// Fold every run but the newest to its header line:',
    '// "commandsFoldOlderRuns": false,',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}
