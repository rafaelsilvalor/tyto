import { type TytoBridge } from '../../shared/ipc.js';
import { type Locale, DEFAULT_LOCALE, isLocale } from '../../shared/i18n/index.js';
import { fillLocalePicker, localeFromPicker, paint } from './shell.js';

/**
 * The renderer's entry point.
 *
 * Small on purpose. What it does is ask main one question, paint, and repaint when the
 * language changes — the three things every later panel will also do, in the order they
 * have to happen. Everything worth testing is in `shell.ts`, which needs no bridge and no
 * Electron.
 */

declare global {
  interface Window {
    /**
     * Optional, and that is not defensive typing.
     *
     * The same renderer is meant to run in a browser tab later (`docs/architecture.md`,
     * path to the cloud), where nothing injects a preload. Typing it as always-present
     * would make the cloud build a type error rather than a code path.
     */
    readonly tyto?: TytoBridge;
  }
}

const state = {
  locale: DEFAULT_LOCALE as Locale,
  version: '—',
  platform: '—',
  templates: [] as readonly string[],
};

const picker = document.getElementById('locale');

function repaint(): void {
  paint(document, state);
}

async function load(): Promise<void> {
  const bridge = window.tyto;
  if (bridge !== undefined) {
    const info = await bridge['app:info']({});
    state.version = info.version;
    state.platform = info.platform;
    state.templates = info.templates;
    if (isLocale(info.locale)) state.locale = info.locale;
  }

  if (picker instanceof HTMLSelectElement) {
    fillLocalePicker(picker, state.locale);
    picker.addEventListener('change', () => {
      state.locale = localeFromPicker(picker, state.locale);
      repaint();
    });
  }

  repaint();
}

// Painted once before the round trip as well, so the window is never blank while main
// answers — the strings are already correct for the default locale, and only the version
// and the platform arrive late.
repaint();
void load();
