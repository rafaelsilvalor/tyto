// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { type Diagnostic } from './panel.js';
import { type ProblemsPanel, type ProblemsState, PROBLEMS_TAG } from './problems-panel.js';

/**
 * The problems panel, now that it is an element rather than a painter (ADR 0024).
 *
 * The assertions are the ones `panel.test.ts` used to make, moved and not weakened: what a
 * row shows, that a code is never translated, that severity is a word as well as a colour,
 * and that a diagnostic with nowhere to go is not a button. What is new is the last
 * describe, which checks the property the hand-written panel did not have — that an update
 * keeps the rows it did not change, because that is the reason for the move and an
 * assertion is cheaper than trusting the measurement.
 *
 * `await panel.updateComplete` before every read: a Lit element schedules its update on a
 * microtask, so the DOM one statement after an assignment is the DOM from before it. This is
 * the one habit the painter did not need and every test here does.
 */

const problem = (over: Partial<Diagnostic> = {}): Diagnostic => ({
  severity: 'error',
  code: 'E_UNKNOWN_SLOT',
  message: "'titulo' is not a slot this template declares.",
  range: { start: 24, end: 30 },
  ...over,
});

const BRIEF = ['---', 'template: promo', '---', '::titulo Olá', '::slide', '  Um'].join('\n');

/** A panel in the document, because a custom element only upgrades once it is connected. */
function mount(state: Partial<ProblemsState> = {}): ProblemsPanel {
  const panel = globalThis.document.createElement(PROBLEMS_TAG);
  globalThis.document.body.append(panel);
  panel.state = { diagnostics: [], brief: BRIEF, locale: 'pt-BR', ...state };
  return panel;
}

describe('the problems panel', () => {
  it('shows the code, the message and where to look', async () => {
    const panel = mount({ diagnostics: [problem()] });
    await panel.updateComplete;

    const row = panel.querySelector('.problems__row');
    expect(row?.querySelector('.problems__code')?.textContent).toBe('E_UNKNOWN_SLOT');
    expect(row?.querySelector('.problems__message')?.textContent).toContain('titulo');
    // Offset 24 is the `::titulo` line, character 1.
    expect(row?.querySelector('.problems__where')?.textContent).toBe('4:1');
  });

  it('keeps the diagnostic code untranslated, because the docs are indexed by it', async () => {
    const panel = mount({ diagnostics: [problem()], locale: 'en' });
    await panel.updateComplete;

    expect(panel.querySelector('.problems__code')?.textContent).toBe('E_UNKNOWN_SLOT');
  });

  it('says the severity in words as well as in colour', async () => {
    // A colour alone is not a severity to somebody who cannot see it.
    const panel = mount({ diagnostics: [problem({ severity: 'warning' })] });
    await panel.updateComplete;

    const dot = panel.querySelector('.problems__dot');
    expect(dot?.className).toContain('problems__dot--warning');
    expect(dot?.getAttribute('aria-label')).toBe('Aviso');
  });

  it('makes a row with a range a button, and one without a range not', async () => {
    // A diagnostic about the project — an unreadable template folder — is still the reason
    // nothing rendered, so it is listed. There is nowhere for it to take you, so it is not
    // a button: a control that does nothing is worse than no control.
    const panel = mount({
      diagnostics: [problem(), problem({ code: 'E_TEMPLATE_READ', range: undefined })],
    });
    await panel.updateComplete;

    const rows = [...panel.querySelectorAll('.problems__row')];
    expect(rows[0]?.tagName).toBe('BUTTON');
    expect(rows[1]?.tagName).toBe('DIV');
    expect(rows[1]?.querySelector('.problems__where')?.textContent).toBe('—');
  });

  it('says so when there is nothing to say', async () => {
    const panel = mount();
    await panel.updateComplete;

    expect(panel.querySelector('.problems__empty')?.textContent).toBe(
      'Nada a relatar sobre este brief',
    );
    expect(panel.querySelector('.problems__row')).toBeNull();
  });

  it('repaints every string when the locale changes, without a second pass over the document', async () => {
    // What the `[data-i18n]` walk did for this panel, the panel now does for itself: the
    // locale is a property, and changing it is an update rather than a sweep of the window.
    const panel = mount({ diagnostics: [problem({ range: undefined })] });
    await panel.updateComplete;
    expect(panel.querySelector('.problems__dot')?.getAttribute('aria-label')).toBe('Erro');

    panel.state = { ...panel.state, locale: 'en' };
    await panel.updateComplete;
    expect(panel.querySelector('.problems__dot')?.getAttribute('aria-label')).toBe('Error');
  });
});

describe('clicking a row hands back the range the diagnostic reported', () => {
  it('reports the range whatever inside the row was clicked', async () => {
    // The click lands on the code or the message nine times out of ten. The hand-written
    // panel needed `closest()` and two `data-` attributes for that; a listener on the row
    // gets it from the event bubbling, and the range travels as the object itself.
    const seen: { start: number; end: number }[] = [];
    const panel = mount({ diagnostics: [problem()] });
    panel.reveal = (range) => seen.push({ start: range.start, end: range.end });
    await panel.updateComplete;

    panel.querySelector<HTMLElement>('.problems__message')?.click();
    expect(seen).toEqual([{ start: 24, end: 30 }]);
  });

  it('does nothing for a row that has nowhere to go', async () => {
    const seen: unknown[] = [];
    const panel = mount({ diagnostics: [problem({ range: undefined })] });
    panel.reveal = (range) => seen.push(range);
    await panel.updateComplete;

    panel.querySelector<HTMLElement>('.problems__row')?.click();
    expect(seen).toEqual([]);
  });
});

describe('an update keeps the rows it did not change', () => {
  it('holds the same DOM node for a row whose diagnostic is unchanged', async () => {
    // The reason for the move, asserted rather than trusted to the measurement in ADR 0024.
    // `replaceChildren` could not do this, and it is what loses a scroll position and what
    // would throw away a CodeMirror or a preview iframe if one ever lived inside a panel.
    const first = problem({ code: 'E_ONE', range: { start: 0, end: 4 } });
    const second = problem({ code: 'E_TWO', range: { start: 10, end: 14 } });
    const panel = mount({ diagnostics: [first, second] });
    await panel.updateComplete;

    const before = panel.querySelectorAll('.problems__row')[0];
    panel.state = { ...panel.state, diagnostics: [first, { ...second, message: 'changed' }] };
    await panel.updateComplete;
    const after = panel.querySelectorAll('.problems__row')[0];

    expect(after).toBe(before);
    expect(panel.querySelectorAll('.problems__row')[1]?.textContent).toContain('changed');
  });

  it('drops the row of a diagnostic that was fixed, and keeps the ones after it', async () => {
    // Keyed by code and position rather than by index, so removing the first row does not
    // renumber — and therefore repaint — every row below it.
    const first = problem({ code: 'E_ONE', range: { start: 0, end: 4 } });
    const second = problem({ code: 'E_TWO', range: { start: 10, end: 14 } });
    const panel = mount({ diagnostics: [first, second] });
    await panel.updateComplete;
    const secondBefore = panel.querySelectorAll('.problems__row')[1];

    panel.state = { ...panel.state, diagnostics: [second] };
    await panel.updateComplete;

    const rows = panel.querySelectorAll('.problems__row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(secondBefore);
  });
});
