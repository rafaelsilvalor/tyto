import { type Locale, translate } from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';

/**
 * The strip above the editor groups that says an untrusted source left something out
 * (TYTO-278, ADR 0111). Rafael chose its place and its two buttons on 2026-10-21, and a
 * third on the same day, Show project, which opens the Project panel (TYTO-347).
 *
 * **One line per source** (TYTO-347, ADR 0114): the folder, and the work profile it names,
 * because trust never travels along a reference and each is trusted on its own button. A
 * trusted folder naming a restricted profile shows the profile's line alone.
 *
 * **Shown only when something was left out.** A restricted folder whose keys all stay inside it
 * never sees it: ADR 0111's point is that a person who is never asked is never trained to
 * click yes. Painted from main's answer, like the update notice; the buttons' handlers are
 * wired once by whoever owns the bridge.
 */

export const WORKSPACE_BANNER = 'workspace-banner';

type Answer = IpcResponse<'workspace:folder'>;

/** Whether the folder's own line shows. */
export function folderLineShown(answer: Answer): boolean {
  return answer.folder !== null && answer.trust === 'restricted' && answer.leftOut > 0;
}

/** Whether the profile's line shows: a profile that is restricted and left something out. */
export function profileLineShown(answer: Answer): boolean {
  const profile = answer.profile;
  return (
    answer.folder !== null &&
    profile !== null &&
    profile.trust === 'restricted' &&
    profile.leftOut > 0
  );
}

export function bannerShown(answer: Answer): boolean {
  return folderLineShown(answer) || profileLineShown(answer);
}

export function paintWorkspaceBanner(banner: HTMLElement, answer: Answer, locale: Locale): void {
  banner.hidden = !bannerShown(answer);
  const line = (source: string): HTMLElement | null =>
    banner.querySelector<HTMLElement>(`.workspace-banner__line[data-source="${source}"]`);
  const folderLine = line('folder');
  if (folderLine !== null) folderLine.hidden = !folderLineShown(answer);
  const profileLine = line('profile');
  if (profileLine !== null) profileLine.hidden = !profileLineShown(answer);

  setText(
    banner,
    '.workspace-banner__text',
    translate(locale, 'workspace.banner.text').replaceAll('{count}', String(answer.leftOut)),
  );
  setText(banner, '.workspace-banner__trust', translate(locale, 'workspace.banner.trust'));
  setText(
    banner,
    '.workspace-banner__profile-text',
    translate(locale, 'workspace.banner.profile')
      .replaceAll('{name}', answer.profile?.label ?? '')
      .replaceAll('{count}', String(answer.profile?.leftOut ?? 0)),
  );
  setText(
    banner,
    '.workspace-banner__trust-profile',
    translate(locale, 'workspace.banner.trustProfile'),
  );
  setText(banner, '.workspace-banner__problems', translate(locale, 'workspace.banner.problems'));
  setText(banner, '.workspace-banner__project', translate(locale, 'workspace.banner.project'));
}

function setText(banner: HTMLElement, selector: string, text: string): void {
  const element = banner.querySelector(selector);
  if (element !== null) element.textContent = text;
}
