import type { ConfigurationContribution } from '@tyto/plugin-api';
import { z } from 'zod';

/**
 * The `briefColumns` setting: how the editor tells the columns of a `|` line apart (TYTO-298,
 * ADR 0097). Rafael chose all four looks as a setting, from a sheet of one brief in four themes
 * with the contrast each painted measured under it:
 *
 * - `off`: nothing, the editor as it was before the card;
 * - `separator`, the default: the `|` in the function colour. It is the one look that passes its
 *   floor — 3:1, a mark rather than text — in all thirteen built-in and adjusted themes;
 * - `alternate`: `separator`, and every even column in the muted text colour. Legible in every
 *   theme (muted is held to 4.5:1 by ADR 0089), but it barely differs from the text in eight of
 *   thirteen, and not at all in Tokyo Night Light (adjusted);
 * - `perColumn`: the columns cycle through the keyword, constant and warning colours. Some
 *   themes draw a column under reading contrast (4.5:1): seven of thirteen.
 *
 * The descriptions say so plainly, because the person choosing is the one reading the result.
 * No look adds a theme token; each paints with a role the theme already sets.
 *
 * In `shared/` because both halves read it, and pure. The ids are `@tyto/editor`'s
 * `BRIEF_COLUMN_STYLES`, written again here because `shared/` may not import a DOM package; the
 * renderer passes this value to the editor's typed option, so a drift fails the typecheck.
 */

export const BRIEF_COLUMN_LOOKS = [
  { id: 'off', description: 'Nothing: a "|" line is drawn as plain text.' },
  {
    id: 'separator',
    description: 'Each "|" that splits a line in the function colour. The default.',
  },
  {
    id: 'alternate',
    description:
      'The "|" coloured, and every even column in the muted text colour. In some themes the muted colour barely differs from the text.',
  },
  {
    id: 'perColumn',
    description:
      'The "|" coloured, and the columns cycling through three colours. Some themes draw a column below comfortable reading contrast.',
  },
] as const;

export type BriefColumnLook = (typeof BRIEF_COLUMN_LOOKS)[number]['id'];

export const BRIEF_COLUMN_LOOK_IDS = BRIEF_COLUMN_LOOKS.map((look) => look.id) as [
  BriefColumnLook,
  ...BriefColumnLook[],
];

export const briefColumnsContribution = {
  id: 'briefColumns',
  schema: z.enum(BRIEF_COLUMN_LOOK_IDS, {
    error: () => `the looks are ${BRIEF_COLUMN_LOOK_IDS.map((id) => `'${id}'`).join(', ')}`,
  }),
  default: 'separator',
  description:
    "How the editor tells the columns of a brief's \"|\" lines apart: 'off', 'separator' (the default), 'alternate' or 'perColumn'.",
  // The same table the commented example reads, so the settings tab can never offer a look the
  // schema refuses (TYTO-304).
  options: BRIEF_COLUMN_LOOKS.map((look) => ({ value: look.id, description: look.description })),
} satisfies ConfigurationContribution<BriefColumnLook>;

/** The key as a newly created `settings.json` shows it, commented out, with its four values. */
export function briefColumnsExample(): string {
  return [
    '// How the editor tells the columns of a brief\'s "|" lines apart:',
    ...BRIEF_COLUMN_LOOKS.map((look) => `//   "${look.id}": ${look.description}`),
    '// "briefColumns": "separator",',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}
