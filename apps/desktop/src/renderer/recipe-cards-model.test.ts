import { describe, expect, it } from 'vitest';

import { CARDS_PAGE, cardFields, nextCards, rowLink } from './recipe-cards-model.js';

describe('the Cards view model (TYTO-384)', () => {
  it('shows fields= on a card, the first four columns when absent', () => {
    const columns = ['key', 'title', 'status', 'owner', 'due', 'site'];
    expect(cardFields({}, columns)).toEqual(['key', 'title', 'status', 'owner']);
    expect(cardFields({ fields: ['title', 'due'] }, columns)).toEqual(['title', 'due']);
    expect(cardFields({ fields: 'title' }, columns)).toEqual(['title']);
  });

  it('asks the next page until every matched row is drawn', () => {
    expect(nextCards(0, 300)).toEqual({ offset: 0, limit: CARDS_PAGE });
    expect(nextCards(288, 300)).toEqual({ offset: 288, limit: 12 });
    expect(nextCards(300, 300)).toBeUndefined();
  });

  it('offers the first link column the system browser may open, and no other address', () => {
    const columns = [
      { name: 'title', type: 'text' },
      { name: 'local', type: 'link' },
      { name: 'script', type: 'link' },
      { name: 'site', type: 'link' },
      { name: 'other', type: 'link' },
    ];
    expect(
      rowLink(columns, [
        'https://example.com/as-text',
        'file:///C:/Windows/notepad.exe',
        'javascript:alert(1)',
        'https://example.com/C-1',
        'https://example.com/second',
      ]),
    ).toBe('https://example.com/C-1');
    expect(rowLink(columns, ['x', 'file:///etc/passwd', null, null, 7])).toBeUndefined();
  });
});
