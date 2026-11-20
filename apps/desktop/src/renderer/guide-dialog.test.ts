// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import { type GuideDialog, type GuideDialogHost, GUIDE_DIALOG_TAG } from './guide-dialog.js';
import {
  type GuideList,
  type GuideRow,
  type GuideWriteResult,
  defaultChecked,
  guideLineInsertion,
  writeOutcomeKey,
} from './guide-view.js';

/**
 * The external-art guide dialog (TYTO-741, ADR 0222) as jsdom sees it: which rows start checked,
 * the line offered for a slot the brief names no file for, and what a write says. Whether it is
 * legible is the real window's question (`e2e/art-guide.desktop.test.ts` and a look at it).
 */

function row(overrides: Partial<GuideRow>): GuideRow {
  return {
    slot: 'fundo',
    kind: 'full',
    cited: 'grafico.png',
    format: 'grid-1x1',
    name: 'grafico.grid-1x1.guide.psd',
    guide: 'assets/grafico.grid-1x1.guide.psd',
    art: 'assets/grafico.grid-1x1.png',
    exists: false,
    newer: false,
    artExists: false,
    ...overrides,
  };
}

const LIST: GuideList = {
  ok: true,
  template: 'arte-teste',
  formats: ['grid-1x1', 'story'],
  guides: [
    row({}),
    row({
      format: 'story',
      name: 'grafico.story.guide.psd',
      guide: 'assets/grafico.story.guide.psd',
      art: 'assets/grafico.story.png',
      exists: true,
    }),
  ],
  uncited: [{ slot: 'selo', kind: 'inline', line: 'selo: selo.png' }],
  unguided: [],
};

function host(overrides: Partial<GuideDialogHost> = {}): GuideDialogHost {
  return {
    list: vi.fn(() => Promise.resolve(LIST)),
    insert: vi.fn(() => true),
    write: vi.fn(() =>
      Promise.resolve<GuideWriteResult>({
        outcome: 'written',
        written: ['assets/grafico.grid-1x1.guide.psd'],
        report: '',
        open: 'opened',
      }),
    ),
    ...overrides,
  };
}

async function opened(with_: GuideDialogHost): Promise<GuideDialog> {
  const element = document.createElement(GUIDE_DIALOG_TAG) as GuideDialog;
  element.locale = 'en';
  document.body.append(element);
  await element.show(with_);
  await element.updateComplete;
  return element;
}

const checks = (element: GuideDialog): Record<string, boolean> =>
  Object.fromEntries(
    [...element.querySelectorAll<HTMLTableRowElement>('tr[data-guide]')].map((tr) => [
      tr.dataset['guide'] ?? '',
      tr.querySelector<HTMLInputElement>('.guide__check')?.checked ?? false,
    ]),
  );

describe('which guides start checked', () => {
  it('checks the missing guides and leaves an existing one unchecked', async () => {
    const element = await opened(host());
    expect(checks(element)).toEqual({
      'grafico.grid-1x1.guide.psd': true,
      'grafico.story.guide.psd': false,
    });
    expect(defaultChecked(LIST.ok ? LIST.guides : [])).toEqual(
      new Set(['grafico.grid-1x1.guide.psd']),
    );
  });

  it('writes only the checked ones, an existing one once a person checks it', async () => {
    const spy = host();
    const element = await opened(spy);
    const story = element.querySelector<HTMLInputElement>(
      'tr[data-guide="grafico.story.guide.psd"] .guide__check',
    );
    story!.checked = true;
    story!.dispatchEvent(new Event('change'));
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('.guide__write')!.click();
    await vi.waitFor(() => {
      expect(spy.write).toHaveBeenCalledWith([
        'grafico.grid-1x1.guide.psd',
        'grafico.story.guide.psd',
      ]);
    });
  });

  it('offers no write with nothing checked', async () => {
    const element = await opened(
      host({
        list: () =>
          Promise.resolve({
            ...LIST,
            guides: LIST.ok ? LIST.guides.map((r) => ({ ...r, exists: true })) : [],
          }),
      }),
    );
    expect(element.querySelector<HTMLButtonElement>('.guide__write')?.disabled).toBe(true);
  });
});

describe('a slot the brief names no file for', () => {
  it('offers its line, and lists again after inserting it, checking the new guide', async () => {
    const after: GuideList = {
      ...LIST,
      guides: [
        ...(LIST.ok ? LIST.guides : []),
        row({
          slot: 'selo',
          kind: 'inline',
          name: 'selo.guide.psd',
          guide: 'assets/selo.guide.psd',
        }),
      ],
      uncited: [],
    };
    const list = vi
      .fn<() => Promise<GuideList>>()
      .mockResolvedValueOnce(LIST)
      .mockResolvedValue(after);
    const spy = host({ list });
    const element = await opened(spy);
    const offer = element.querySelector('.guide__uncited li[data-slot="selo"]');
    expect(offer?.querySelector('code')?.textContent).toBe('selo: selo.png');

    offer!.querySelector<HTMLButtonElement>('.guide__insert')!.click();
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2);
    });
    await element.updateComplete;
    expect(spy.insert).toHaveBeenCalledWith('selo: selo.png');
    expect(element.querySelector('.guide__uncited')).toBeNull();
    expect(checks(element)['selo.guide.psd']).toBe(true);
  });

  it('puts a key line before the closing fence, and a directive at the end', () => {
    const brief = '---\ntemplate: arte-teste\n---\n::titulo\n  Capa\n';
    const key = guideLineInsertion(brief, 'selo: selo.png');
    expect(brief.slice(0, key.from) + key.insert + brief.slice(key.from)).toBe(
      '---\ntemplate: arte-teste\nselo: selo.png\n---\n::titulo\n  Capa\n',
    );
    const directive = guideLineInsertion(brief, '::selo\n  selo.png');
    expect(brief.slice(0, directive.from) + directive.insert).toBe(
      '---\ntemplate: arte-teste\n---\n::titulo\n  Capa\n\n::selo\n  selo.png\n',
    );
    const crlf = '---\r\ntemplate: x\r\n---\r\n';
    const inCrlf = guideLineInsertion(crlf, 'selo: selo.png');
    expect(crlf.slice(0, inCrlf.from) + inCrlf.insert + crlf.slice(inCrlf.from)).toBe(
      '---\r\ntemplate: x\r\nselo: selo.png\r\n---\r\n',
    );
    expect(guideLineInsertion('::titulo\n  Capa', 'selo: selo.png')).toEqual({
      from: 0,
      insert: '---\nselo: selo.png\n---\n',
    });
  });
});

describe('what the dialog says', () => {
  it('names the template when it declares no external art', async () => {
    const element = await opened(
      host({
        list: () =>
          Promise.resolve({
            ok: false,
            reason: 'no-external-art',
            diagnostics: [
              {
                severity: 'error',
                code: 'E_GUIDE_NO_EXTERNAL_ART',
                message: "Template 'promo-curso' declares no slot with external art.",
              },
            ],
          }),
      }),
    );
    const refusal = element.querySelector('.guide__refusal');
    expect(refusal?.textContent).toContain(translate('en', 'guide.noExternalArt'));
    expect(refusal?.textContent).toContain('promo-curso');
    expect(element.querySelector('.guide__write')?.hasAttribute('disabled')).toBe(true);
  });

  it('shows the written paths and how each reached the person', async () => {
    const element = await opened(host());
    element.querySelector<HTMLButtonElement>('.guide__write')!.click();
    await vi.waitFor(() => {
      expect(element.querySelector('.guide__result')).not.toBeNull();
    });
    await element.updateComplete;
    expect(element.querySelector('.guide__written')?.textContent).toContain(
      'assets/grafico.grid-1x1.guide.psd',
    );
    expect(element.querySelector('.guide__opened')?.getAttribute('data-open')).toBe('opened');
  });

  it('has a sentence for every answer, never the folder opened in a restricted one', () => {
    const written = { outcome: 'written' as const, written: [] as string[], report: '' };
    expect(writeOutcomeKey({ ...written, open: 'opened' })).toBe('guide.result.opened');
    expect(writeOutcomeKey({ ...written, open: 'no-program' })).toBe('guide.result.noProgram');
    expect(writeOutcomeKey({ ...written, open: 'restricted' })).toBe('guide.result.restricted');
    expect(writeOutcomeKey({ outcome: 'not-saved' })).toBe('guide.result.notSaved');
    expect(writeOutcomeKey({ outcome: 'refused', reason: 'unsaved' })).toBe(
      'guide.result.notSaved',
    );
    expect(writeOutcomeKey({ outcome: 'declined' })).toBe('guide.result.declined');
    expect(writeOutcomeKey({ outcome: 'failed', report: '' })).toBe('guide.result.failed');
  });
});
