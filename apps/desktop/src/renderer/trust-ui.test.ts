// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { type TrustDialog, type WorkspaceView, TRUST_DIALOG_TAG } from './trust-dialog.js';
import {
  bannerShown,
  folderLineShown,
  paintWorkspaceBanner,
  profileLineShown,
} from './workspace-banner.js';

/**
 * The trust banner and the Manage Trust dialog (TYTO-278, ADR 0111), as jsdom can see them:
 * when the banner shows and what it says, which button the dialog offers in which state, and
 * what a click hands to whoever owns the bridge. Where they sit on screen is the e2e's and the
 * real window's question.
 */

const view = (overrides: Partial<WorkspaceView> = {}): WorkspaceView => ({
  folder: '/work/promo',
  name: 'promo',
  trust: 'restricted',
  leftOut: 2,
  output: null,
  profile: null,
  places: [],
  exportPresets: [],
  problems: [],
  ...overrides,
});

/** A restricted shared profile that left one thing out (TYTO-347). */
const shared: NonNullable<WorkspaceView['profile']> = {
  label: 'saude',
  trust: 'restricted',
  byLocation: false,
  leftOut: 1,
};

/** The banner's markup as `index.html` writes it: one line per source, then Show problems. */
function banner(): HTMLElement {
  document.body.innerHTML = `<div id="workspace-banner" hidden>
    <div class="workspace-banner__lines">
      <div class="workspace-banner__line" data-source="folder">
        <span class="workspace-banner__text"></span>
        <button class="workspace-banner__trust"></button>
      </div>
      <div class="workspace-banner__line" data-source="profile" hidden>
        <span class="workspace-banner__profile-text"></span>
        <button class="workspace-banner__trust-profile"></button>
      </div>
    </div>
    <button class="workspace-banner__problems"></button>
  </div>`;
  return document.getElementById('workspace-banner')!;
}

const line = (element: HTMLElement, source: string): HTMLElement =>
  element.querySelector<HTMLElement>(`.workspace-banner__line[data-source="${source}"]`)!;

describe('the trust banner with a work profile (TYTO-347)', () => {
  it('names a restricted profile on its own line, with its own button', () => {
    const element = banner();
    paintWorkspaceBanner(element, view({ profile: shared }), 'en');
    expect(element.hidden).toBe(false);
    expect(line(element, 'folder').hidden).toBe(false);
    expect(line(element, 'profile').hidden).toBe(false);
    expect(element.querySelector('.workspace-banner__profile-text')?.textContent).toBe(
      "The work profile 'saude' is not trusted, so 1 of the folders and sections it names were left out.",
    );
    expect(element.querySelector('.workspace-banner__trust-profile')?.textContent).toBe(
      'Trust this profile',
    );
    paintWorkspaceBanner(element, view({ profile: shared }), 'pt-BR');
    expect(element.querySelector('.workspace-banner__trust-profile')?.textContent).toBe(
      'Confiar neste perfil',
    );
  });

  it('shows the profile line alone for a trusted folder: trust does not travel', () => {
    const trustedFolder = view({ trust: 'trusted', leftOut: 0, profile: shared });
    expect(folderLineShown(trustedFolder)).toBe(false);
    expect(profileLineShown(trustedFolder)).toBe(true);
    const element = banner();
    paintWorkspaceBanner(element, trustedFolder, 'en');
    expect(element.hidden).toBe(false);
    expect(line(element, 'folder').hidden).toBe(true);
    expect(line(element, 'profile').hidden).toBe(false);
  });

  it('never shows the profile line for a trusted, revoked or complete profile', () => {
    for (const profile of [
      { ...shared, trust: 'trusted' as const },
      { ...shared, trust: 'revoked' as const },
      { ...shared, leftOut: 0 },
    ]) {
      expect(profileLineShown(view({ profile }))).toBe(false);
    }
    expect(bannerShown(view({ leftOut: 0, profile: { ...shared, leftOut: 0 } }))).toBe(false);
  });
});

describe('the trust banner', () => {
  it('shows on an untrusted folder that left something out, saying how much', () => {
    const element = banner();
    paintWorkspaceBanner(element, view(), 'en');
    expect(element.hidden).toBe(false);
    expect(element.querySelector('.workspace-banner__text')?.textContent).toContain('so 2 of');
    expect(element.querySelector('.workspace-banner__trust')?.textContent).toBe(
      'Trust this folder',
    );
    paintWorkspaceBanner(element, view(), 'pt-BR');
    expect(element.querySelector('.workspace-banner__problems')?.textContent).toBe(
      'Mostrar problemas',
    );
  });

  it('never shows when nothing was left out, once trusted, or with no folder', () => {
    expect(bannerShown(view({ leftOut: 0 }))).toBe(false);
    expect(bannerShown(view({ trust: 'trusted' }))).toBe(false);
    expect(bannerShown(view({ trust: 'revoked' }))).toBe(false);
    expect(bannerShown(view({ folder: null }))).toBe(false);
    const element = banner();
    element.hidden = false;
    paintWorkspaceBanner(element, view({ leftOut: 0 }), 'en');
    expect(element.hidden).toBe(true);
  });
});

async function dialog(shown: WorkspaceView | undefined): Promise<{
  readonly element: TrustDialog;
  readonly asked: (boolean | string)[];
}> {
  document.body.innerHTML = `<${TRUST_DIALOG_TAG}></${TRUST_DIALOG_TAG}>`;
  const element = document.querySelector<TrustDialog>(TRUST_DIALOG_TAG)!;
  const asked: (boolean | string)[] = [];
  element.locale = 'en';
  element.view = shown;
  element.onTrust = (trusted, source) =>
    asked.push(source === 'folder' ? trusted : `${String(trusted)} ${source}`);
  element.open = true;
  await element.updateComplete;
  return { element, asked };
}

const button = (element: HTMLElement, name: string): HTMLButtonElement =>
  element.querySelector<HTMLButtonElement>(`.trust__${name}`)!;

describe('the Manage Trust dialog', () => {
  it('offers Trust on an untrusted folder and hands the click over', async () => {
    const { element, asked } = await dialog(view());
    expect(element.querySelector('.trust__folder')?.textContent).toContain('/work/promo');
    expect(button(element, 'grant').disabled).toBe(false);
    expect(button(element, 'revoke').disabled).toBe(true);
    button(element, 'grant').click();
    expect(asked).toEqual([true]);
  });

  it('offers Remove trust on a trusted one, and says a removal applies on the next open', async () => {
    const { element, asked } = await dialog(view({ trust: 'trusted', leftOut: 0 }));
    button(element, 'revoke').click();
    expect(asked).toEqual([false]);

    element.view = view({ trust: 'revoked', leftOut: 0 });
    await element.updateComplete;
    expect(element.querySelector('.trust__state')?.textContent).toContain(
      'the next time this folder is opened',
    );
    expect(button(element, 'grant').disabled).toBe(false);
  });

  it('shows a shared profile as its own source, with its own two buttons (TYTO-347)', async () => {
    const { element, asked } = await dialog(view({ profile: shared }));
    expect(element.querySelector('.trust__profile')?.textContent).toContain('Work profile: saude');
    expect(element.querySelector('.trust__profile-state')?.getAttribute('data-trust-profile')).toBe(
      'restricted',
    );
    expect(button(element, 'revoke-profile').disabled).toBe(true);
    button(element, 'grant-profile').click();
    expect(asked).toEqual(['true profile']);
  });

  it('offers no buttons for a profile trusted where it lives, and says why', async () => {
    const { element } = await dialog(
      view({ profile: { label: 'saude', trust: 'trusted', byLocation: true, leftOut: 0 } }),
    );
    expect(element.querySelector('.trust__profile-state')?.textContent).toContain(
      'trusted where it lives',
    );
    expect(element.querySelector('.trust__grant-profile')).toBeNull();
    expect(element.querySelector('.trust__revoke-profile')).toBeNull();
  });

  it('says no folder is open and offers neither button', async () => {
    const { element } = await dialog(view({ folder: null, name: null }));
    expect(element.querySelector('.trust__state')?.textContent).toContain('No workspace folder');
    expect(element.querySelector('.trust__grant')).toBeNull();
  });
});
