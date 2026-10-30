// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type CommandBar, COMMAND_BAR_TAG } from './command-bar.js';
import {
  type DeliveryAnswer,
  type DeliveryNewHost,
  NO_TEMPLATE,
  deliveryOffered,
  startDeliveryNew,
} from './delivery-new.js';

/**
 * "Delivery: New…" (TYTO-489, ADR 0157 §5), driven through the real command bar: the name asked
 * and checked as it is typed, the template picked or none, main's answer opened or said in the
 * status bar. Main's side is `src/main/delivery.test.ts`; how the bar looks is the window's.
 */

const MADE: DeliveryAnswer = {
  ok: true,
  document: null,
  documentId: null,
  reveal: ['e-mca', 'e-edit', 'e-brief'],
};

function mount(answer: DeliveryAnswer = MADE) {
  const bar = globalThis.document.createElement(COMMAND_BAR_TAG);
  bar.locale = 'en';
  globalThis.document.body.append(bar);
  const create = vi.fn<DeliveryNewHost['create']>(() => Promise.resolve(answer));
  const opened = vi.fn<DeliveryNewHost['opened']>();
  const notice = vi.fn<DeliveryNewHost['notice']>();
  startDeliveryNew({
    locale: () => 'en',
    ask: (request) => {
      bar.ask(request);
    },
    pick: (request) => {
      bar.pick(request);
    },
    templates: () => [{ id: 'aprovados', label: 'aprovados' }],
    skeletonOf: (name) => (name === 'aprovados' ? '---\ntemplate: aprovados\n---\n' : undefined),
    create,
    opened,
    notice,
  });
  return { bar, create, opened, notice };
}

const type = async (bar: CommandBar, value: string): Promise<void> => {
  await bar.updateComplete;
  const input = bar.querySelector<HTMLInputElement>('.command-bar__input');
  if (input === null) throw new Error('no input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await bar.updateComplete;
};

const press = async (bar: CommandBar, key: string): Promise<void> => {
  bar
    .querySelector('.command-bar__panel')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  await bar.updateComplete;
};

const problem = (bar: CommandBar): string =>
  bar.querySelector('.command-bar__problem')?.textContent?.trim() ?? '';

const labels = (bar: CommandBar): string[] =>
  [...bar.querySelectorAll('.command-bar__label')].map((node) => node.textContent ?? '');

afterEach(() => {
  globalThis.document.body.replaceChildren();
});

describe('Delivery: New…', () => {
  it('says why a name cannot be a folder as it is typed, and Enter does nothing then', async () => {
    const { bar, create } = mount();
    await type(bar, 'mca:1');
    expect(problem(bar)).toContain('holds a character a folder name may not');
    expect(bar.querySelector('.command-bar__input')?.getAttribute('aria-invalid')).toBe('true');
    await press(bar, 'Enter');
    expect(bar.open).toBe(true);
    expect(labels(bar)).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('shows nothing for an empty name, and nothing once the name is fixed', async () => {
    const { bar } = mount();
    await bar.updateComplete;
    expect(problem(bar)).toBe('');
    await type(bar, 'mca:1');
    await type(bar, 'mca-1');
    expect(problem(bar)).toBe('');
  });

  it('asks for a template, No template first, and sends the skeleton of the one chosen', async () => {
    const { bar, create, opened } = mount();
    await type(bar, 'mca-66911_aprovados');
    await press(bar, 'Enter');
    expect(labels(bar)).toEqual(['No template', 'aprovados']);
    await press(bar, 'ArrowDown');
    await press(bar, 'Enter');
    await vi.waitFor(() => {
      expect(opened).toHaveBeenCalledOnce();
    });
    expect(create).toHaveBeenCalledWith('mca-66911_aprovados', '---\ntemplate: aprovados\n---\n');
    expect(opened).toHaveBeenCalledWith(MADE, true);
  });

  it('sends an empty brief with No template, which opens with the "/" menu', async () => {
    const { bar, create, opened } = mount();
    await type(bar, 'mca-1');
    await press(bar, 'Enter');
    await press(bar, 'Enter');
    await vi.waitFor(() => {
      expect(opened).toHaveBeenCalledWith(MADE, false);
    });
    expect(create).toHaveBeenCalledWith('mca-1', '');
    expect(NO_TEMPLATE).toBe('');
  });

  it("says main's refusal in the status bar, quoting its diagnostic", async () => {
    const { bar, opened, notice } = mount({
      ok: false,
      code: 'E_DELIVERY_BRIEF_EXISTS',
      message: "'mca-1/editaveis/mca-1.brief' already exists.",
    });
    await type(bar, 'mca-1');
    await press(bar, 'Enter');
    await press(bar, 'Enter');
    await vi.waitFor(() => {
      expect(notice).toHaveBeenCalledOnce();
    });
    expect(notice).toHaveBeenCalledWith(
      "No delivery was made. 'mca-1/editaveis/mca-1.brief' already exists.",
    );
    expect(opened).not.toHaveBeenCalled();
  });

  it('asks for a folder when none is open', async () => {
    const { bar, notice } = mount({ ok: false, code: 'no-folder', message: '' });
    await type(bar, 'mca-1');
    await press(bar, 'Enter');
    await press(bar, 'Enter');
    await vi.waitFor(() => {
      expect(notice).toHaveBeenCalledWith(
        'Open a folder first: a delivery is made inside the open folder.',
      );
    });
  });

  it('makes nothing when the question is dismissed', async () => {
    const { bar, create } = mount();
    await type(bar, 'mca-1');
    await press(bar, 'Escape');
    expect(bar.open).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('whether Delivery: New… is offered', () => {
  it('is offered with a folder open and not without one', () => {
    expect(deliveryOffered({ folder: 'promo' })).toBe(true);
    expect(deliveryOffered({ folder: null })).toBe(false);
    expect(deliveryOffered(undefined)).toBe(false);
  });
});
