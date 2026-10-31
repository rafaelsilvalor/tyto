// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import { type TerminalPanel, TERMINAL_PANEL_TAG } from './terminal-panel.js';
import { type TerminalPorts, type TerminalView, TerminalSessions } from './terminal-sessions.js';

beforeAll(() => {
  // jsdom has no layout, so no ResizeObserver; the panel only asks it to call `fit`.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    disconnect(): void {}
  } as never;
});

afterEach(() => {
  document.body.innerHTML = '';
});

const view = (): TerminalView => ({
  element: document.createElement('div'),
  write: () => undefined,
  focus: () => undefined,
  fit: () => undefined,
  restyle: () => undefined,
  dispose: () => undefined,
});

const sessionsWith = (open: TerminalPorts['open']): TerminalSessions =>
  new TerminalSessions({
    open,
    input: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
    list: () => Promise.resolve([]),
    view: () => Promise.resolve(view()),
    exited: () => '',
  });

let next = 1;
const opens: TerminalPorts['open'] = () =>
  Promise.resolve({ terminalId: `terminal-${String(next++)}`, title: 'bash' });

async function mount(sessions: TerminalSessions, locale: 'en' | 'pt-BR' = 'en') {
  const panel = document.createElement(TERMINAL_PANEL_TAG) as TerminalPanel;
  panel.sessions = sessions;
  panel.locale = locale;
  const ports = { create: vi.fn<() => void>(), trust: vi.fn<() => void>() };
  panel.ports = ports;
  document.body.append(panel);
  await panel.updateComplete;
  return { panel, ports };
}

describe('the Terminal tab (ADR 0164 decision 7)', () => {
  it('names itself in the window’s language and offers a new terminal', async () => {
    const { panel, ports } = await mount(sessionsWith(opens), 'pt-BR');

    expect(panel.querySelector('.tool__title')?.textContent).toBe(
      translate('pt-BR', 'panel.terminal'),
    );
    panel.querySelector<HTMLButtonElement>('[data-action="terminal.new"]')?.click();
    expect(ports.create).toHaveBeenCalledOnce();
  });

  it('opens a first terminal when focused with none, and none after a refusal', async () => {
    const refusing = sessionsWith(() =>
      Promise.resolve({ refused: 'restricted' as const, message: 'restricted' }),
    );
    const { panel, ports } = await mount(sessionsWith(opens));
    panel.focusTerminal();
    expect(ports.create).toHaveBeenCalledOnce();

    await refusing.create();
    const refused = await mount(refusing);
    refused.panel.focusTerminal();
    expect(refused.ports.create).not.toHaveBeenCalled();
  });

  it('puts every screen in its body and shows only the one in front', async () => {
    const sessions = sessionsWith(opens);
    await sessions.create();
    await sessions.create();
    const { panel } = await mount(sessions);

    const screens = [...panel.querySelectorAll('.terminal-panel__screens > div')];
    expect(screens).toHaveLength(2);
    expect(screens.map((screen) => (screen as HTMLElement).hidden)).toEqual([true, false]);
  });

  it('shows the terminals as tabs once there are two, numbered when they share a name', async () => {
    const sessions = sessionsWith(opens);
    await sessions.create();
    const { panel } = await mount(sessions);
    expect(panel.querySelector('[role="tab"][data-terminal]')).toBeNull();

    await sessions.create();
    await panel.updateComplete;

    const tabs = [...panel.querySelectorAll<HTMLElement>('[data-terminal]')];
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['bash 1', 'bash 2']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  });

  it('says a restricted folder in the banner’s words, with the trust action beside it', async () => {
    const sessions = sessionsWith(() =>
      Promise.resolve({ refused: 'restricted' as const, message: 'from main' }),
    );
    await sessions.create();
    const { panel, ports } = await mount(sessions);

    expect(panel.querySelector('.terminal-panel__refusal span')?.textContent).toBe(
      translate('en', 'terminal.restricted'),
    );
    panel.querySelector<HTMLButtonElement>('.terminal-panel__trust')?.click();
    expect(ports.trust).toHaveBeenCalledOnce();
  });
});
