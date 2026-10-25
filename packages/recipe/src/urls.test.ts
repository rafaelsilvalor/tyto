import { describe, expect, it } from 'vitest';

import { columnOf, runOverShop } from './__fixtures__/rules-harness.js';
import { SHOP_TEXT, TASKS } from './__fixtures__/text-harness.js';
import { addressesIn, hostOf } from './urls.js';

const FILES = { './shop.json': SHOP_TEXT };
const HOSTS = 'host=@./shop.json#/hosts';

function run(lines: readonly string[], files: Record<string, unknown> = FILES) {
  return runOverShop(lines, files, TASKS);
}

/**
 * The private plugin's document link (TYTO-391) re-expressed as configuration: the first link
 * on the company's file hosts in the description, and only when it has none, in the comments.
 */
describe('urls', () => {
  it('lists the links on the hosts named, the first column before the second, each once', async () => {
    const { table, problem } = await run([`urls into=links from=description,comments ${HOSTS}`]);
    expect(problem).toBeUndefined();
    expect(columnOf(table, 'links')).toEqual({
      'PS-1': ['https://files.example.com/d/abc/view', 'https://files.example.com/d/zzz'],
      'PS-2': ['https://docs.example.com/d/def', 'https://FILES.example.com/d/ghi'],
      'PS-3': null,
      'PS-4': ['https://files.example.com/d/a', 'https://files.example.com/d/b'],
    });
    expect(table?.columns.at(-1)).toEqual({ name: 'links', type: 'list', origin: 'urls' });
  });

  it('with first, writes a link column with the first by precedence, not position', async () => {
    const { table } = await run([`urls into=folder from=description,comments ${HOSTS} first`]);
    expect(columnOf(table, 'folder')).toEqual({
      'PS-1': 'https://files.example.com/d/abc/view',
      'PS-2': 'https://docs.example.com/d/def',
      'PS-3': null,
      'PS-4': 'https://files.example.com/d/a',
    });
    expect(table?.columns.at(-1)).toEqual({ name: 'folder', type: 'link', origin: 'urls' });
  });

  it('follows the order from= names the columns in', async () => {
    const { table } = await run([`urls into=folder from=comments,description ${HOSTS} first`]);
    expect(columnOf(table, 'folder')['PS-1']).toBe('https://files.example.com/d/zzz');
  });

  it('takes the hosts inline, and keeps no other host', async () => {
    const { table } = await run(['urls into=other from=description host=other.example.org']);
    expect(columnOf(table, 'other')).toEqual({
      'PS-1': ['https://other.example.org/x'],
      'PS-2': null,
      'PS-3': null,
      'PS-4': null,
    });
  });

  it('cuts a link at a Markdown or HTML wrapper and drops a trailing full stop or comma', () => {
    expect(
      addressesIn(
        'a [x](https://h.example/1) <https://h.example/2> "https://h.example/3" ' +
          "'https://h.example/4' [https://h.example/5] https://h.example/6., https://h.example/7,",
      ),
    ).toEqual([
      'https://h.example/1',
      'https://h.example/2',
      'https://h.example/3',
      'https://h.example/4',
      'https://h.example/5',
      'https://h.example/6',
      'https://h.example/7',
    ]);
  });

  it('reads the host without user, port, case or trailing dot', () => {
    expect(hostOf('https://me@Files.Example.com.:8443/d?x#y')).toBe('files.example.com');
  });

  describe('refuses', () => {
    it('a host written with a scheme', async () => {
      const { problem, at } = await run([
        'urls into=a from=description host=https://files.example.com',
      ]);
      expect(problem?.code).toBe('E_RECIPE_ARGUMENTS');
      expect(at).toBe('host=https://files.example.com');
    });

    it('a host list of the wrong shape in a file', async () => {
      const { problem } = await run(['urls into=a from=description host=@./shop.json#/noise']);
      expect(problem?.code).toBe('E_RECIPE_DATA_SHAPE');
    });

    it('a word other than first', async () => {
      const { problem, at } = await run([`urls into=a from=description ${HOSTS} last`]);
      expect([problem?.code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'last']);
    });

    it('a column the table lacks', async () => {
      const { problem } = await run([`urls into=a from=description,notes ${HOSTS}`]);
      expect(problem?.code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    });
  });
});
