// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ExplorerListing } from './explorer-tree.js';
import { type ExplorerPanel, type ExplorerSource, EXPLORER_PANEL_TAG } from './explorer-panel.js';

/**
 * The explorer panel (TYTO-279, ADR 0115) as jsdom can see it: what it asks main and when, what
 * a click and a key do, what a change on disk redraws, and that an answer for a folder that has
 * since closed is not drawn. Where it sits and how it looks is the e2e's and the real window's.
 */

type Disk = Record<string, ExplorerListing>;

const entries = (
  ...items: [id: string, name: string, kind: 'folder' | 'brief' | 'file'][]
): ExplorerListing => ({
  entries: items.map(([id, name, kind]) => ({ id, name, kind })),
  more: 0,
  gone: false,
});

const GONE: ExplorerListing = { entries: [], more: 0, gone: true };

/** A source that answers from `disk`, and records what was asked and opened. */
function source(disk: Disk) {
  const asked: (string | null)[] = [];
  const opened: string[] = [];
  const folders: number[] = [];
  const value: ExplorerSource = {
    list: (entryId) => {
      asked.push(entryId);
      return Promise.resolve(disk[entryId ?? 'root'] ?? GONE);
    },
    open: (entryId) => {
      opened.push(entryId);
    },
    openFolder: () => {
      folders.push(1);
    },
  };
  return { value, asked, opened, folders };
}

const settle = async (element: ExplorerPanel): Promise<void> => {
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(element.isUpdatePending).toBe(false);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await element.updateComplete;
};

async function mount(disk: Disk, folderName: string | null = 'promo') {
  document.body.innerHTML = `<${EXPLORER_PANEL_TAG}></${EXPLORER_PANEL_TAG}>`;
  const element = document.querySelector<ExplorerPanel>(EXPLORER_PANEL_TAG)!;
  element.locale = 'en';
  const fake = source(disk);
  element.source = fake.value;
  element.folderName = folderName;
  element.reset();
  await settle(element);
  return { element, ...fake };
}

const rows = (element: ExplorerPanel): string[] =>
  [...element.querySelectorAll<HTMLElement>('.explorer__row, .explorer__more')].map((row) =>
    row.classList.contains('explorer__more')
      ? (row.textContent ?? '').trim()
      : `${'  '.repeat(Number(row.getAttribute('aria-level')) - 1)}${row.dataset.name ?? ''}`,
  );

const row = (element: ExplorerPanel, name: string): HTMLElement =>
  element.querySelector<HTMLElement>(`.explorer__row[data-name="${name}"]`)!;

const disk = (): Disk => ({
  root: entries(
    ['slides', 'slides', 'folder'],
    ['promo', 'promo.brief', 'brief'],
    ['logo', 'logo.png', 'file'],
  ),
  slides: entries(['capa', 'capa.brief', 'brief']),
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('the explorer panel', () => {
  it('lists the open folder, and a folder only when it is opened', async () => {
    const { element, asked } = await mount(disk());

    expect(rows(element)).toEqual(['slides', 'promo.brief', 'logo.png']);
    expect(asked).toEqual([null]);

    row(element, 'slides').click();
    await settle(element);

    expect(asked).toEqual([null, 'slides']);
    expect(rows(element)).toEqual(['slides', '  capa.brief', 'promo.brief', 'logo.png']);
    expect(row(element, 'slides').getAttribute('aria-expanded')).toBe('true');
  });

  it('opens a brief on a click, and does nothing for any other file', async () => {
    const { element, opened } = await mount(disk());

    row(element, 'logo.png').click();
    row(element, 'promo.brief').click();
    await settle(element);

    expect(opened).toEqual(['promo']);
    expect(row(element, 'promo.brief').getAttribute('aria-selected')).toBe('true');
  });

  it('moves with the arrows and opens with Enter', async () => {
    const { element, opened } = await mount(disk());
    const tree = element.querySelector<HTMLElement>('.explorer__tree')!;
    const press = async (key: string): Promise<void> => {
      tree.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await settle(element);
    };

    await press('ArrowDown');
    await press('ArrowRight');
    await press('ArrowRight');
    await press('Enter');

    expect(opened).toEqual(['capa']);
  });

  it('shows what changed on disk in every open folder', async () => {
    const shared = disk();
    const { element } = await mount(shared);
    row(element, 'slides').click();
    await settle(element);

    shared.slides = entries(['capa', 'capa.brief', 'brief'], ['nova', 'nova.brief', 'brief']);
    element.refresh();
    await settle(element);

    expect(rows(element)).toContain('  nova.brief');
  });

  it('drops a folder deleted outside the app, with what was open inside it', async () => {
    const shared = disk();
    const { element } = await mount(shared);
    row(element, 'slides').click();
    await settle(element);

    shared.root = entries(['promo', 'promo.brief', 'brief'], ['logo', 'logo.png', 'file']);
    delete shared.slides;
    element.refresh();
    await settle(element);

    expect(rows(element)).toEqual(['promo.brief', 'logo.png']);
  });

  it('says what a capped folder left out', async () => {
    const { element } = await mount({
      root: { ...entries(['a', 'a.brief', 'brief']), more: 1999 },
    });

    expect(rows(element)).toEqual(['a.brief', '1999 more not shown']);
  });

  it('offers Open Folder while none is open, and asks main nothing', async () => {
    const { element, asked, folders } = await mount(disk(), null);

    expect(element.querySelector('.explorer__note')?.textContent).toBe('No folder open');
    element.querySelector<HTMLButtonElement>('.explorer__open-folder')!.click();

    expect(folders).toEqual([1]);
    expect(asked).toEqual([]);
  });

  it('does not draw an answer for the folder it listed before', async () => {
    const { element } = await mount(disk());
    let answerOld: (value: ExplorerListing) => void = () => undefined;
    element.source = {
      ...element.source,
      list: (entryId) =>
        entryId === 'slides'
          ? new Promise((resolve) => {
              answerOld = resolve;
            })
          : Promise.resolve(entries(['other', 'other.brief', 'brief'])),
    };
    row(element, 'slides').click();

    // Another folder opens while the old one's answer is still on its way.
    element.folderName = 'other';
    element.reset();
    await settle(element);
    answerOld(entries(['late', 'late.brief', 'brief']));
    await settle(element);

    expect(rows(element)).toEqual(['other.brief']);
  });
});
