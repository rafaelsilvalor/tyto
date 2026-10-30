// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { type Diagnostic } from './panel.js';
import {
  type CommandProblemRow,
  type CommandProblems,
  type ProblemsPanel,
  type ProblemsState,
  PROBLEMS_TAG,
  SHOWN_RUNS,
  offsetAt,
  withCommandProblems,
} from './problems-panel.js';

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

  // TYTO-322: "this brief" was wrong with `settings.json` in front, and in the manual.
  it.each([
    ['brief', 'pt-BR', 'Nada a relatar sobre este brief'],
    ['settings', 'pt-BR', 'Nada a relatar sobre o settings.json'],
    ['keybindings', 'pt-BR', 'Nada a relatar sobre o keybindings.json'],
    ['snippets', 'pt-BR', 'Nada a relatar sobre o snippets.json'],
    ['settings', 'en', 'Nothing to report about settings.json'],
    // TYTO-247, ADR 0132: nothing checks a text file, and the panel says so.
    ['text', 'en', 'Text files are not checked.'],
    ['markdown', 'pt-BR', 'Arquivos de texto não são verificados.'],
    // TYTO-377: a recipe is checked by its run.
    ['recipe', 'en', 'Nothing to report about this recipe'],
    ['recipe', 'pt-BR', 'Nada a relatar sobre esta receita'],
  ] as const)(
    'names the %s document when there is nothing to say (%s)',
    async (kind, locale, text) => {
      const panel = mount({ kind, locale });
      await panel.updateComplete;

      expect(panel.querySelector('.problems__empty')?.textContent).toBe(text);
    },
  );

  it('follows the document in front when it changes', async () => {
    const panel = mount({ kind: 'settings' });
    await panel.updateComplete;
    expect(panel.querySelector('.problems__empty')?.textContent).toBe(
      'Nada a relatar sobre o settings.json',
    );

    panel.state = { ...panel.state, kind: 'brief' };
    await panel.updateComplete;
    expect(panel.querySelector('.problems__empty')?.textContent).toBe(
      'Nada a relatar sobre este brief',
    );
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

/** TYTO-495, ADR 0159 decision 7: what a `tyto` command reported, under the brief's rows. */
describe("a command's section", () => {
  const command = (over: Partial<CommandProblemRow> = {}): CommandProblemRow => ({
    index: 0,
    severity: 'error',
    code: 'E_ASSET_NOT_FOUND',
    message: "Asset './logo.png' was not found.",
    where: 'task/brief.brief',
    line: 5,
    column: 1,
    openable: true,
    ...over,
  });

  it('lists its rows under the command, after the brief, with the file and line it printed', async () => {
    const panel = mount({
      diagnostics: [problem()],
      commands: [
        { runId: 'cli-1', label: 'tyto render task/brief.brief', diagnostics: [command()] },
      ],
    });
    await panel.updateComplete;

    const headers = [...panel.querySelectorAll('.problems__command')];
    const rows = [...panel.querySelectorAll('.problems__row')];
    expect(headers.map((header) => header.textContent)).toEqual(['tyto render task/brief.brief']);
    expect(rows).toHaveLength(2);
    // The brief's row first, then the command's, which names its own file.
    expect(rows[0]?.querySelector('.problems__where')?.textContent).toBe('4:1');
    expect(rows[1]?.querySelector('.problems__where')?.textContent).toBe('task/brief.brief:5:1');
    expect(rows[1]?.querySelector('.problems__code')?.textContent).toBe('E_ASSET_NOT_FOUND');
  });

  it('shows with an empty brief too, below what the empty panel says', async () => {
    const panel = mount({
      commands: [{ runId: 'cli-1', label: 'tyto plugin list', diagnostics: [command()] }],
    });
    await panel.updateComplete;

    expect(panel.querySelector('.problems__empty')).not.toBeNull();
    expect(panel.querySelectorAll('.problems__row')).toHaveLength(1);
  });

  it('opens a row by its run and row, never by the path it shows', async () => {
    const opened: [string, number][] = [];
    const panel = mount({
      commands: [
        {
          runId: 'cli-4',
          label: 'tyto render a',
          diagnostics: [command({ index: 3 })],
        },
      ],
    });
    panel.open = (runId, row) => opened.push([runId, row.index]);
    await panel.updateComplete;

    panel.querySelector<HTMLElement>('button.problems__row')?.click();

    expect(opened).toEqual([['cli-4', 3]]);
  });

  it('is not a button for a row main says it cannot open, a template file among them', async () => {
    const panel = mount({
      commands: [
        {
          runId: 'cli-1',
          label: 'tyto render a',
          diagnostics: [
            command({
              index: 0,
              where: 'templates/x/template.html',
              line: 2,
              column: 3,
              openable: false,
            }),
            command({ index: 1, openable: false, code: 'W_PLUGIN_FILE_FETCH' }),
          ],
        },
      ],
    });
    await panel.updateComplete;

    expect(panel.querySelectorAll('button.problems__row')).toHaveLength(0);
    expect(
      [...panel.querySelectorAll('.problems__where')].map((where) => where.textContent),
    ).toEqual(['templates/x/template.html:2:3', 'task/brief.brief:5:1']);
  });
});

describe('the command sections the window keeps', () => {
  const push = (runId: string, ...indexes: number[]): CommandProblems => ({
    runId,
    label: `tyto render ${runId}`,
    diagnostics: indexes.map((index) => ({
      index,
      severity: 'error' as const,
      code: 'E_X',
      message: 'm',
      openable: false,
    })),
  });

  it("add a run's later rows to its own section", () => {
    const sections = withCommandProblems(withCommandProblems([], push('a', 0)), push('a', 1));

    expect(sections.map((section) => section.diagnostics.map((row) => row.index))).toEqual([
      [0, 1],
    ]);
  });

  it(`keep the last ${String(SHOWN_RUNS)} runs, the newest last`, () => {
    let sections: readonly CommandProblems[] = [];
    for (const runId of ['1', '2', '3', '4', '5', '6']) {
      sections = withCommandProblems(sections, push(runId, 0));
    }

    expect(sections.map((section) => section.runId)).toEqual(['2', '3', '4', '5', '6']);
  });
});

describe('a line and column as an offset', () => {
  it('counts lines from 1 and holds the answer inside the text', () => {
    const text = 'abc\ndef\nghi';

    expect(offsetAt(text, 1, 1)).toBe(0);
    expect(offsetAt(text, 2, 2)).toBe(5);
    expect(offsetAt(text, 3, 1)).toBe(8);
    expect(offsetAt(text, 9, 1)).toBe(text.length);
    expect(offsetAt(text, 1, 99)).toBe(text.length);
  });
});
