import type { UpdateStatus } from '../../shared/ipc.js';
import { type CatalogueKey, type Locale, translate } from '../../shared/i18n/index.js';

/**
 * The footer's word about a newer version (TYTO-131, ADR 0069).
 *
 * Beside the version the footer already shows, so the one question a tester reporting a bug is
 * asked first — which version — sits next to whether a newer one is waiting. Hidden while there
 * is nothing to say, which is the ordinary state and every state a failed check leaves.
 *
 * A button only when clicking it does something: `ready` restarts into the update and
 * `available` opens the release page; `downloading` is a line of text the button refuses.
 */
const KEYS: Readonly<Record<Exclude<UpdateStatus['state'], 'none'>, CatalogueKey>> = {
  available: 'update.available',
  downloading: 'update.downloading',
  ready: 'update.ready',
};

export function paintUpdateNotice(
  button: HTMLButtonElement,
  status: UpdateStatus,
  locale: Locale,
): void {
  button.dataset['updateState'] = status.state;
  if (status.state === 'none') {
    button.hidden = true;
    button.textContent = '';
    return;
  }
  button.hidden = false;
  button.disabled = status.state === 'downloading';
  button.textContent = translate(locale, KEYS[status.state]).replaceAll(
    '{version}',
    status.version,
  );
}
