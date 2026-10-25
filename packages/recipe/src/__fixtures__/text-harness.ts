import type { CellValue, Table } from '../table.js';

/**
 * A neutral print shop's tasks shaped like the rows the private plugin cleans, parses and links
 * (TYTO-391): a title with a clone prefix, a team label and a due suffix around
 * `[(Phase)] <Format> - <Theme>`, a description in text and comments as a list of texts.
 */
const ROWS: readonly Record<string, CellValue>[] = [
  {
    key: 'PS-1',
    title: 'CLONE - Design - (Launch) Poster - Spring Fair (20% OFF) - Due: 12/10',
    description:
      'See [the folder](https://files.example.com/d/abc/view) and https://other.example.org/x.',
    comments: [
      'first https://files.example.com/d/zzz',
      'again https://files.example.com/d/abc/view',
    ],
  },
  {
    key: 'PS-2',
    title: 'Copy - Banner - Single batch',
    description: null,
    comments: ['<https://docs.example.com/d/def>', "'https://FILES.example.com/d/ghi'."],
  },
  {
    key: 'PS-3',
    title: 'Something new',
    description: 'no links here',
    comments: [],
  },
  {
    key: 'PS-4',
    title: '(Early) (Launch) Banner Poster - Two formats',
    description:
      'https://files.example.com/d/a), https://files.example.com/d/a, "https://files.example.com/d/b"',
    comments: null,
  },
];

export const TASKS: Table = {
  columns: Object.keys(ROWS[0] ?? {}).map((name) => ({
    name,
    type: name === 'comments' ? 'list' : 'text',
    origin: 'test',
  })),
  rows: ROWS.map((values) => ({
    key: String(values['key']),
    values,
    provenance: { source: 'test', id: String(values['key']), fetchedAt: '2026-10-25' },
  })),
};

/** The configuration file beside the recipe, in neutral words. */
export const SHOP_TEXT = {
  noise: [
    { pattern: '^\\s*clone\\s*-\\s*', replace: '' },
    { pattern: '^(?:design|copy|web)\\s*-\\s*', replace: '' },
    { pattern: '\\s*-\\s*due:.*$', replace: '' },
  ],
  ad: '^(?:.*\\((?<phase>[^()]+)\\))?[^()]*?\\b(?<format>poster|banner)\\b\\s*-?\\s*(?<theme>.+)$',
  hosts: ['files.example.com', 'docs.example.com'],
};
