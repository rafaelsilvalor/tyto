import { type Locale, translate } from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';

/**
 * The strip above the editor groups that says an untrusted folder left something out
 * (TYTO-278, ADR 0111). Rafael chose its place and its two buttons on 2026-10-21.
 *
 * **Shown only when something was left out.** A restricted folder whose keys all stay inside it
 * never sees it: ADR 0111's point is that a person who is never asked is never trained to
 * click yes. Painted from main's answer, like the update notice; the buttons' handlers are
 * wired once by whoever owns the bridge.
 */

export const WORKSPACE_BANNER = 'workspace-banner';

export function bannerShown(answer: IpcResponse<'workspace:folder'>): boolean {
  return answer.folder !== null && answer.trust === 'restricted' && answer.leftOut > 0;
}

export function paintWorkspaceBanner(
  banner: HTMLElement,
  answer: IpcResponse<'workspace:folder'>,
  locale: Locale,
): void {
  banner.hidden = !bannerShown(answer);
  const text = banner.querySelector('.workspace-banner__text');
  if (text !== null) {
    text.textContent = translate(locale, 'workspace.banner.text').replaceAll(
      '{count}',
      String(answer.leftOut),
    );
  }
  const trust = banner.querySelector('.workspace-banner__trust');
  if (trust !== null) trust.textContent = translate(locale, 'workspace.banner.trust');
  const problems = banner.querySelector('.workspace-banner__problems');
  if (problems !== null) problems.textContent = translate(locale, 'workspace.banner.problems');
}
