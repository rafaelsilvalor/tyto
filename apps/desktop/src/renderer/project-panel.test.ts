// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { type ProjectPanel, type ProjectView, PROJECT_PANEL_TAG } from './project-panel.js';

/**
 * The Project panel (TYTO-347, ADR 0114) as jsdom can see it: one line per place, its folders,
 * and the tag that says which sheet it came from, in both languages. Where it sits beside
 * Problems is the e2e's and the real window's question.
 */

const view = (overrides: Partial<ProjectView> = {}): ProjectView => ({
  folder: '/work/campanha',
  name: 'campanha',
  trust: 'restricted',
  leftOut: 0,
  output: '/work/campanha/out',
  profile: { label: 'Saúde', trust: 'trusted', byLocation: true, leftOut: 0 },
  places: [
    { key: 'assets', folders: ['/home/.tyto/profiles/Saúde/art'], origin: 'profile' },
    { key: 'output', folders: ['/work/campanha/out'], origin: 'folder' },
  ],
  exportPresets: [],
  problems: [],
  ...overrides,
});

async function panel(shown: ProjectView | undefined, locale: 'en' | 'pt-BR' = 'en') {
  document.body.innerHTML = `<${PROJECT_PANEL_TAG}></${PROJECT_PANEL_TAG}>`;
  const element = document.querySelector<ProjectPanel>(PROJECT_PANEL_TAG)!;
  element.locale = locale;
  element.view = shown;
  await element.updateComplete;
  return element;
}

const line = (element: HTMLElement, key: string) => {
  const row = element.querySelector(`.project__place[data-key="${key}"]`);
  return {
    value: row?.querySelector('.project__value')?.textContent?.trim(),
    origin: row?.querySelector('.project__origin')?.textContent?.trim(),
  };
};

describe('the Project panel', () => {
  it('shows every key, each with its folders and where it came from', async () => {
    const element = await panel(view());
    expect([...element.querySelectorAll('.project__key')].map((item) => item.textContent)).toEqual([
      'assets',
      'templates',
      'fonts',
      'output',
    ]);
    expect(line(element, 'assets')).toEqual({
      value: '/home/.tyto/profiles/Saúde/art',
      origin: 'profile Saúde',
    });
    expect(line(element, 'output')).toEqual({ value: '/work/campanha/out', origin: 'this folder' });
    expect(line(element, 'fonts')).toEqual({ value: '', origin: 'not set' });
  });

  it('says it in Portuguese too', async () => {
    const element = await panel(view(), 'pt-BR');
    expect(line(element, 'assets').origin).toBe('perfil Saúde');
    expect(line(element, 'output').origin).toBe('esta pasta');
    expect(line(element, 'templates').origin).toBe('não definido');
    expect(element.querySelector('.tool__title')?.getAttribute('data-i18n')).toBe(
      'project.heading',
    );
  });

  it('says no folder is open, before an answer and with none', async () => {
    for (const shown of [undefined, view({ folder: null, name: null, places: [] })]) {
      const element = await panel(shown, 'pt-BR');
      expect(element.querySelector('.project__none')?.textContent).toBe('Nenhuma pasta aberta');
      expect(element.querySelector('.project__places')).toBeNull();
    }
  });
});
