// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type RecentFolderRow,
  type RecentFolders,
  RECENT_FOLDERS_TAG,
  filterRecentFolders,
} from './recent-folders.js';

/**
 * The recent folders popover (TYTO-487), as jsdom can see it: what the filter keeps, which row
 * the keys reach, what Enter and a click hand over, and what an empty list says. Where it sits
 * under the title bar is the real window's question.
 */

const ROWS: readonly RecentFolderRow[] = [
  { id: 'id-semestre', name: '2- Semestre', pathLabel: '~\\Documents\\2- Semestre', current: true },
  { id: 'id-templates', name: 'templates', pathLabel: 'D:\\trabalho\\templates', current: false },
  { id: 'id-promo', name: 'promoção', pathLabel: '~\\campanhas\\promoção', current: false },
];

afterEach(() => {
  document.body.innerHTML = '';
});

async function popover(rows: readonly RecentFolderRow[] = ROWS) {
  const element = document.createElement(RECENT_FOLDERS_TAG) as RecentFolders;
  document.body.append(element);
  const chosen = vi.fn<(id: string) => void>();
  const openLocal = vi.fn<() => void>();
  const closed = vi.fn<() => void>();
  element.onChoose = chosen;
  element.onOpenLocal = openLocal;
  element.onClose = closed;
  // English, so the words below read as the source catalogue writes them.
  element.locale = 'en';
  element.folders = rows;
  element.show();
  await element.updateComplete;
  return { element, chosen, openLocal, closed };
}

const names = (element: HTMLElement): string[] =>
  [...element.querySelectorAll('.recent-folders__name')].map((name) => name.textContent ?? '');

const highlighted = (element: HTMLElement): string | null =>
  element.querySelector('.recent-folders__row[aria-selected="true"]')?.getAttribute('data-id') ??
  null;

async function press(element: RecentFolders, key: string): Promise<void> {
  element
    .querySelector('.recent-folders__search')!
    .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  await element.updateComplete;
}

async function type(element: RecentFolders, text: string): Promise<void> {
  const input = element.querySelector<HTMLInputElement>('.recent-folders__search')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await element.updateComplete;
}

describe('the filter', () => {
  it('matches the name or the label, accents folded and case ignored', () => {
    expect(filterRecentFolders(ROWS, 'PROMOCAO').map((row) => row.id)).toEqual(['id-promo']);
    expect(filterRecentFolders(ROWS, 'trabalho').map((row) => row.id)).toEqual(['id-templates']);
    expect(filterRecentFolders(ROWS, '  ')).toBe(ROWS);
    expect(filterRecentFolders(ROWS, 'nada')).toEqual([]);
  });

  it('never matches the id, which is main’s and means nothing to a person', () => {
    expect(filterRecentFolders(ROWS, 'id-')).toEqual([]);
  });
});

describe('the popover', () => {
  it('lists every folder, marks the open one, and highlights the newest other one', async () => {
    const { element } = await popover();

    expect(names(element)).toEqual(['2- Semestre', 'templates', 'promoção']);
    expect(element.querySelectorAll('.recent-folders__current')).toHaveLength(1);
    expect(highlighted(element)).toBe('id-templates');
    expect(document.activeElement).toBe(element.querySelector('.recent-folders__search'));
  });

  it('filters as you type and starts the highlight over', async () => {
    const { element } = await popover();
    await press(element, 'ArrowDown');

    await type(element, 'prom');
    expect(names(element)).toEqual(['promoção']);
    expect(highlighted(element)).toBe('id-promo');
  });

  it('moves with the arrows, wrapping at both ends, and opens with Enter', async () => {
    const { element, chosen, closed } = await popover();

    await press(element, 'ArrowDown');
    expect(highlighted(element)).toBe('id-promo');
    await press(element, 'ArrowDown');
    expect(highlighted(element)).toBe('id-semestre');
    await press(element, 'ArrowUp');
    expect(highlighted(element)).toBe('id-promo');
    await press(element, 'Enter');

    expect(chosen).toHaveBeenCalledExactlyOnceWith('id-promo');
    expect(closed).toHaveBeenCalledOnce();
    expect(element.open).toBe(false);
  });

  it('only closes when the open folder is chosen: it is not a reopen', async () => {
    const { element, chosen, closed } = await popover();
    await press(element, 'ArrowUp');
    expect(highlighted(element)).toBe('id-semestre');

    await press(element, 'Enter');
    expect(chosen).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('opens a row on a click, and the picker from its foot', async () => {
    const { element, chosen, openLocal } = await popover();
    element.querySelector<HTMLElement>('[data-id="id-templates"]')!.click();
    expect(chosen).toHaveBeenCalledExactlyOnceWith('id-templates');

    element.show();
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('.recent-folders__open-local')!.click();
    expect(openLocal).toHaveBeenCalledOnce();
    expect(element.open).toBe(false);
  });

  it('closes on Escape and on a press outside it, choosing nothing', async () => {
    const { element, chosen, closed } = await popover();
    await press(element, 'Escape');
    expect(element.open).toBe(false);

    element.show();
    await element.updateComplete;
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(element.open).toBe(false);
    expect(closed).toHaveBeenCalledTimes(2);
    expect(chosen).not.toHaveBeenCalled();
  });

  it('says so when nothing was opened yet, and when nothing matches, and Enter does nothing', async () => {
    const empty = await popover([]);
    expect(empty.element.querySelector('.recent-folders__empty')?.textContent?.trim()).toBe(
      'No folder opened yet',
    );
    await press(empty.element, 'Enter');
    expect(empty.chosen).not.toHaveBeenCalled();
    // The foot is there with no list at all: it is the way to the first folder.
    expect(empty.element.querySelector('.recent-folders__open-local')).not.toBeNull();

    const { element } = await popover();
    await type(element, 'zzz');
    expect(element.querySelector('.recent-folders__empty')?.textContent?.trim()).toBe(
      'No folder matches',
    );
  });

  it('speaks the language it is given', async () => {
    const { element } = await popover([]);
    element.locale = 'pt-BR';
    await element.updateComplete;

    expect(element.querySelector('.recent-folders__heading')?.textContent).toBe(
      'Projetos recentes',
    );
    expect(element.querySelector('.recent-folders__open-local')?.textContent?.trim()).toBe(
      'Abrir pasta local…',
    );
  });
});
