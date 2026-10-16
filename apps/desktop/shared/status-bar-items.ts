import type { ConfigurationContribution } from '@tyto/plugin-api';
import { z } from 'zod';

/**
 * The status bar's items, by id, and the `statusBarItems` setting that picks which of them
 * show and in what order (TYTO-301, ADR 0091, amending ADR 0076).
 *
 * In `shared/` because both halves read it: main validates the setting, and the window draws
 * the bar from the list main answers. Linted pure — no Node, no DOM.
 *
 * **Each item has a home side**, the one it has always had. The setting orders items within
 * their side; it never moves one across, because a bar whose sides depend on a list would be
 * a layout editor, and the card asks for a filter and an order.
 */

export type StatusBarSide = 'start' | 'end';

export interface StatusBarItem {
  readonly id: string;
  readonly side: StatusBarSide;
  /** One sentence for the person editing `settings.json`, shown beside the id. */
  readonly description: string;
}

/**
 * Today's bar, in today's order — which is the default, so a file that never names the
 * setting draws exactly the bar ADR 0076 describes. Every id is shown only when it has
 * something to show: `vimMode` while vim is on, `template` when a brief names one,
 * `cursorPosition` when the tab has a caret, an area's button when a panel lives there.
 */
export const STATUS_BAR_ITEMS = [
  { id: 'leftArea', side: 'start', description: 'Button that shows or hides the left area.' },
  { id: 'commandBar', side: 'start', description: 'Button that opens the command bar.' },
  {
    id: 'vimMode',
    side: 'start',
    description: "Vim's mode badge and pending keys, while vim is on.",
  },
  {
    id: 'cursorPosition',
    side: 'end',
    description: 'Line and column of the caret, and the selection size.',
  },
  {
    id: 'tabKind',
    side: 'end',
    description: 'What the tab in front holds: brief, settings, preview…',
  },
  { id: 'template', side: 'end', description: "The template the brief's frontmatter names." },
  { id: 'problems', side: 'end', description: 'Problems count; toggles the problems panel.' },
  { id: 'queue', side: 'end', description: 'Toggles the queue panel.' },
  { id: 'plugins', side: 'end', description: 'Opens the plugins dialog.' },
  { id: 'export', side: 'end', description: 'Exports the brief in front.' },
  { id: 'settings', side: 'end', description: 'Opens settings.json.' },
  { id: 'bottomArea', side: 'end', description: 'Button that shows or hides the bottom area.' },
  { id: 'rightArea', side: 'end', description: 'Button that shows or hides the right area.' },
] as const satisfies readonly StatusBarItem[];

export type StatusBarItemId = (typeof STATUS_BAR_ITEMS)[number]['id'];

export const STATUS_BAR_ITEM_IDS: readonly StatusBarItemId[] = STATUS_BAR_ITEMS.map(
  (item) => item.id,
);

const itemIds = STATUS_BAR_ITEM_IDS as readonly [StatusBarItemId, ...StatusBarItemId[]];

/** One entry: an id the bar knows, with the list of ids in the message when it is not one. */
const statusBarItemId = z.enum(itemIds, {
  error: (issue) =>
    typeof issue.input === 'string'
      ? `'${issue.input}' is not a status bar item; the items are ${STATUS_BAR_ITEM_IDS.join(', ')}`
      : 'an item is written as its id, in quotes',
});

/**
 * `statusBarItems`: which items show, in what order inside their side. Each entry is checked
 * on its own (`entries`), so an unknown id or a repeated one is `W_SETTING_ENTRY_INVALID` at
 * that entry and the rest still apply; a value that is not a list is `W_SETTING_INVALID` and
 * the whole bar is today's.
 */
export const statusBarItemsContribution = {
  id: 'statusBarItems',
  schema: z.array(statusBarItemId).readonly(),
  default: STATUS_BAR_ITEM_IDS,
  description: `Which status bar items show, in order inside their side: ${STATUS_BAR_ITEM_IDS.join(', ')}.`,
  entries: {
    schema: statusBarItemId,
    unique: true,
    // What the tab suggests for an entry, from the table the example is written from (TYTO-304).
    options: STATUS_BAR_ITEMS.map((item) => ({ value: item.id, description: item.description })),
  },
} satisfies ConfigurationContribution<readonly StatusBarItemId[]>;

/**
 * The ids to draw on one side, in the setting's order. Items with no place in the list are
 * not drawn: the list says what shows.
 */
export function itemsOnSide(
  items: readonly StatusBarItemId[],
  side: StatusBarSide,
): readonly StatusBarItemId[] {
  return items.filter((id) => STATUS_BAR_ITEMS.find((item) => item.id === id)?.side === side);
}

/**
 * The key as a newly created `settings.json` shows it: commented out, with every id and what
 * it is, so the options are in the file and not only in a document (TYTO-301).
 */
export function statusBarItemsExample(): string {
  const width = Math.max(...STATUS_BAR_ITEM_IDS.map((id) => id.length)) + 4;
  const lines = STATUS_BAR_ITEMS.map((item, index) => {
    const entry = `"${item.id}"${index === STATUS_BAR_ITEMS.length - 1 ? '' : ','}`;
    return `//   ${entry.padEnd(width)}// ${item.side === 'start' ? 'left' : 'right'}: ${item.description}`;
  });
  return [
    '// Which status bar items show, and their order inside their side. Remove one to hide it.',
    '// "statusBarItems": [',
    ...lines,
    '// ],',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}
