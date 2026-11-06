import { describe, expect, it } from 'vitest';

import { leftOpenItems, NO_SECTION, PULL_REQUEST_LIMIT, run, windowStart } from './loose-ends.mjs';

const REPO = 'someone/tyto';

/** A runner that answers only the calls it was given, and throws on any other. */
function fakeRunner(answers) {
  return (args) => {
    const key = args.join(' ');
    if (!(key in answers)) throw new Error(`unexpected call: ${key}`);
    return answers[key];
  };
}

const listCall = (since) =>
  `pr list --repo ${REPO} --state merged --search merged:>=${since} --json number --limit ${PULL_REQUEST_LIMIT}`;
const viewCall = (number) => `pr view ${number} --repo ${REPO} --json body`;

const TABLE_BODY = [
  '## What',
  '',
  '- not an item: outside the section',
  '',
  '## Left open',
  '',
  '| What | Why | State | Owner |',
  '| ---- | --- | ----- | ----- |',
  '| A gap | it matters | Not measured | coordinator |',
  '| :--- | aligned separator is skipped too | x | y |',
  '| Another | reason | Carta a abrir | maintainer |',
  '',
  '## Checks',
  '',
  '| Not | an item |',
  '| --- | ------- |',
  '| x | y |',
].join('\r\n');

const BULLET_BODY = [
  '## Left open (none of them blocking)',
  '- first',
  '* second',
  '  - nested, not an item',
  'prose, not an item',
].join('\n');

describe('windowStart', () => {
  it('defaults to seven days before now, in UTC, and says it is the default', () => {
    expect(windowStart({ now: new Date('2026-11-06T01:30:00Z') })).toEqual({
      since: '2026-10-30',
      isDefault: true,
    });
  });

  it('keeps a given date and refuses anything else', () => {
    expect(windowStart({ since: '2026-11-03' })).toEqual({ since: '2026-11-03', isDefault: false });
    expect(() => windowStart({ since: '03/11/2026' })).toThrow(/YYYY-MM-DD/u);
  });
});

describe('leftOpenItems', () => {
  it('keeps the table rows of the section and skips its header and --- rows', () => {
    expect(leftOpenItems(TABLE_BODY)).toEqual({
      hasSection: true,
      items: [
        '| A gap | it matters | Not measured | coordinator |',
        '| Another | reason | Carta a abrir | maintainer |',
      ],
    });
  });

  it('strips the carriage returns of a body written on Windows', () => {
    expect(leftOpenItems(TABLE_BODY).items.some((item) => item.includes('\r'))).toBe(false);
  });

  it('keeps top-level bullets of either marker, and nothing nested or in prose', () => {
    expect(leftOpenItems(BULLET_BODY)).toEqual({
      hasSection: true,
      items: ['- first', '* second'],
    });
  });

  it('skips the header of every table in the section, not only the first', () => {
    const body = [
      '## Left open',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '| C | D |',
      '|---|---|',
      '| 3 | 4 |',
    ];
    expect(leftOpenItems(body.join('\n')).items).toEqual(['| 1 | 2 |', '| 3 | 4 |']);
  });

  it('says when the body has no section', () => {
    expect(leftOpenItems('## Summary\n- a bullet\n')).toEqual({ hasSection: false, items: [] });
  });
});

describe('run', () => {
  const git = fakeRunner({ 'remote get-url origin': `git@github.com:${REPO}.git\n` });

  function runIn(options, gh) {
    const printed = [];
    const code = run(
      { window: false, ...options },
      { git, gh, print: (line) => printed.push(line) },
    );
    return { code, printed };
  }

  it('--window prints the given date, or the default and why', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    expect(runIn({ window: true, since: '2026-11-03' }).printed).toEqual(['since 2026-11-03']);
    expect(runIn({ window: true, now }).printed[0]).toMatch(
      /^since 2026-10-30 \(the default, 7 days ago/u,
    );
  });

  it('prints every item by pull request, lowest number first, then the counts', () => {
    const gh = fakeRunner({
      [listCall('2026-11-03')]: JSON.stringify([
        { number: 31 },
        { number: 9 },
        { number: 12 },
        { number: 40 },
      ]),
      [viewCall(9)]: JSON.stringify({ body: BULLET_BODY }),
      [viewCall(12)]: JSON.stringify({ body: '## Summary\nRelease PR' }),
      [viewCall(31)]: JSON.stringify({ body: TABLE_BODY }),
      [viewCall(40)]: JSON.stringify({ body: '## Left open\n\nNothing.\n' }),
    });
    const { code, printed } = runIn({ since: '2026-11-03' }, gh);
    expect(code).toBe(0);
    expect(printed).toEqual([
      '#9\t- first',
      '#9\t* second',
      `#12\t${NO_SECTION}`,
      '#31\t| A gap | it matters | Not measured | coordinator |',
      '#31\t| Another | reason | Carta a abrir | maintainer |',
      '',
      `repository: ${REPO}; merged since 2026-11-03`,
      'pull requests read: 4',
      'items: 4 from 2 pull requests',
      'no Left open section: #12',
      'a Left open section with no item: #40',
    ]);
  });

  it('warns when the merged list fills its page', () => {
    const numbers = Array.from({ length: PULL_REQUEST_LIMIT }, (_, index) => ({
      number: index + 1,
    }));
    const answers = { [listCall('2026-01-01')]: JSON.stringify(numbers) };
    for (const { number } of numbers) answers[viewCall(number)] = JSON.stringify({ body: null });
    const { printed } = runIn({ since: '2026-01-01' }, fakeRunner(answers));
    expect(printed).toContain(
      `warning: ${PULL_REQUEST_LIMIT} is the page size, so the list was cut: sweep again from a later date`,
    );
  });
});
