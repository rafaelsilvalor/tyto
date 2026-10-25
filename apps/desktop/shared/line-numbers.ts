import type { ConfigurationContribution } from '@tyto/plugin-api';
import { z } from 'zod';

/**
 * The `lineNumbers` setting: how the editor's gutter numbers the lines (TYTO-415), VS Code's
 * `editor.lineNumbers`. Rafael asked for relative numbers on 2026-10-25, to count a vim motion
 * like `5j` without counting lines; they apply with or without vim, as VS Code's do.
 *
 * In `shared/` because both halves read it, and pure. The ids are `@tyto/editor`'s
 * `LINE_NUMBERS_STYLES`, written again here because `shared/` may not import a DOM package; the
 * renderer passes this value to the editor's typed option, so a drift fails the typecheck.
 */

export const LINE_NUMBERS_LOOKS = [
  { id: 'on', description: 'Each line its own number. The default.' },
  {
    id: 'relative',
    description:
      "The cursor's line its own number, every other line its distance to the cursor: what a vim count like 5j moves.",
  },
  { id: 'off', description: 'No line numbers.' },
] as const;

export type LineNumbersLook = (typeof LINE_NUMBERS_LOOKS)[number]['id'];

export const LINE_NUMBERS_LOOK_IDS = LINE_NUMBERS_LOOKS.map((look) => look.id) as [
  LineNumbersLook,
  ...LineNumbersLook[],
];

export const lineNumbersContribution = {
  id: 'lineNumbers',
  schema: z.enum(LINE_NUMBERS_LOOK_IDS, {
    error: () => `the looks are ${LINE_NUMBERS_LOOK_IDS.map((id) => `'${id}'`).join(', ')}`,
  }),
  default: 'on',
  description:
    "How the editor numbers its lines: 'on' (the default), 'relative' to the cursor's line, or 'off'.",
  options: LINE_NUMBERS_LOOKS.map((look) => ({ value: look.id, description: look.description })),
} satisfies ConfigurationContribution<LineNumbersLook>;

/** The key as a newly created `settings.json` shows it, commented out, with its three values. */
export function lineNumbersExample(): string {
  return [
    '// How the editor numbers its lines:',
    ...LINE_NUMBERS_LOOKS.map((look) => `//   "${look.id}": ${look.description}`),
    '// "lineNumbers": "on",',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}
