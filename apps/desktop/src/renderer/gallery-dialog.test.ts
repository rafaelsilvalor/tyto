// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import type { GalleryAction, GalleryEntryView, GalleryView } from '../../shared/ipc.js';
import {
  type GalleryActionRequest,
  type GalleryDialog,
  GALLERY_DIALOG_TAG,
  resultLines,
} from './gallery-dialog.js';

/**
 * The gallery screen's states, as jsdom can see them: which cards, which button, what a click
 * said. Whether the cards are legible is the real window's question (`e2e/gallery.desktop.test.ts`
 * and a look at it), because jsdom does no layout.
 */

function entry(overrides: Partial<GalleryEntryView>): GalleryEntryView {
  return {
    id: 'tabela',
    kind: 'template',
    name: 'Tabela',
    description: 'A table in one image.',
    latest: 'v2',
    configurations: ['roxo'],
    state: 'not installed',
    compatible: true,
    engine: '>=0.1.0',
    pinned: [],
    files: [],
    synced: true,
    ...overrides,
  };
}

const VIEW: GalleryView = {
  index: 'https://git.example.invalid/gallery.git',
  problems: [],
  entries: [
    entry({ preview: 'data:image/png;base64,AA==' }),
    entry({
      id: 'agenda',
      name: 'Agenda',
      state: 'update available',
      pinned: ['v1'],
      changes: 'Wider first column.',
    }),
    entry({ id: 'inbox', kind: 'plugin', name: 'Inbox', state: 'installed', pinned: ['v2'] }),
    entry({ id: 'futuro', name: 'Futuro', compatible: false, engine: '>=9.0.0' }),
  ],
};

async function dialog(
  view: GalleryView | 'failed' | undefined = VIEW,
  onAct?: GalleryActionRequest,
): Promise<GalleryDialog> {
  const element = document.createElement(GALLERY_DIALOG_TAG) as GalleryDialog;
  element.locale = 'en';
  element.view = view;
  element.onAct = onAct;
  element.open = true;
  document.body.replaceChildren(element);
  await element.updateComplete;
  return element;
}

const cards = (element: GalleryDialog): string[] =>
  [...element.querySelectorAll<HTMLElement>('.gallery__card')].map(
    (card) => `${card.dataset['entry'] ?? ''}:${card.dataset['state'] ?? ''}`,
  );

const button = (element: GalleryDialog, id: string): HTMLButtonElement | null =>
  element.querySelector<HTMLButtonElement>(`[data-entry='${id}'] .gallery__act`);

describe('the gallery screen', () => {
  it('draws one card per entry, with one action only where a click changes something', async () => {
    const element = await dialog(VIEW, () => Promise.reject(new Error('unused')));
    expect(cards(element)).toEqual([
      'tabela:not installed',
      'agenda:update available',
      'inbox:installed',
      'futuro:incompatible',
    ]);
    expect(button(element, 'tabela')?.dataset['verb']).toBe('install');
    expect(button(element, 'agenda')?.dataset['verb']).toBe('update');
    expect(button(element, 'agenda')?.textContent?.trim()).toBe('Update to v2');
    expect(button(element, 'inbox')).toBeNull();
    expect(button(element, 'futuro')).toBeNull();
    expect(element.querySelector("[data-entry='agenda'] .gallery__changes")?.textContent).toContain(
      'Wider first column.',
    );
    expect(element.querySelector("[data-entry='tabela'] img")?.getAttribute('src')).toBe(
      'data:image/png;base64,AA==',
    );
  });

  it('filters by kind, installed and updates, with each filter counting what it shows', async () => {
    const element = await dialog();
    const filter = (name: string): HTMLButtonElement =>
      element.querySelector<HTMLButtonElement>(`[data-filter='${name}']`)!;
    expect(filter('updates').textContent?.trim()).toBe('Updates (1)');

    filter('updates').click();
    await element.updateComplete;
    expect(cards(element)).toEqual(['agenda:update available']);

    filter('installed').click();
    await element.updateComplete;
    expect(cards(element)).toEqual(['agenda:update available', 'inbox:installed']);
    expect(filter('installed').getAttribute('aria-pressed')).toBe('true');
  });

  it('says it is working, then draws the gallery main answers and what the click did', async () => {
    let finish: (action: GalleryAction) => void = () => undefined;
    const asked: string[] = [];
    const element = await dialog(VIEW, (verb, id) => {
      asked.push(`${verb} ${id}`);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });

    button(element, 'tabela')!.click();
    await element.updateComplete;
    expect(asked).toEqual(['install tabela']);
    expect(button(element, 'tabela')?.textContent?.trim()).toBe('Installing…');
    // One click at a time, as main runs them.
    expect(button(element, 'agenda')?.disabled).toBe(true);

    finish({
      outcome: 'written',
      byHand: [],
      view: { ...VIEW, entries: [entry({ state: 'installed', pinned: ['v2'] })] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;
    expect(cards(element)).toEqual(['tabela:installed']);
    expect(element.querySelector("[data-entry='tabela'] .gallery__result")?.textContent).toContain(
      translate('en', 'gallery.done.written'),
    );
  });

  it('says the list is a cached copy, and when the bridge failed', async () => {
    const cached = await dialog({ ...VIEW, cached: '2026-10-30T12:00:00.000Z' });
    expect(cached.querySelector('.gallery__cached')).not.toBeNull();

    const failed = await dialog('failed');
    expect(failed.querySelector('.gallery__failure')?.textContent?.trim()).toBe(
      translate('en', 'gallery.unavailable'),
    );
  });
});

describe('resultLines', () => {
  const say = (key: Parameters<typeof translate>[1]): string => translate('en', key);

  it('names the terminal flag for a ref changed by hand, which the window does not offer', () => {
    const result = resultLines(say, entry({ id: 'agenda' }), {
      outcome: 'refused',
      problem: 'E_GALLERY_ENTRY_EDITED: changed by hand',
      byHand: [],
      view: VIEW,
    });
    expect(result.failed).toBe(true);
    expect(result.lines).toEqual([
      'E_GALLERY_ENTRY_EDITED: changed by hand',
      'To move it anyway, run tyto gallery update agenda --force in a terminal.',
    ]);
  });

  it('says each place written by hand before the update it moved', () => {
    const result = resultLines(say, entry({}), {
      outcome: 'moved',
      byHand: [{ file: '/home/ana/.tyto/plugin-files/mine.yaml', ref: 'v1' }],
      view: VIEW,
    });
    expect(result.lines).toEqual([
      'Written by hand in /home/ana/.tyto/plugin-files/mine.yaml; moved from v1.',
      'Updated to v2.',
    ]);
  });
});
