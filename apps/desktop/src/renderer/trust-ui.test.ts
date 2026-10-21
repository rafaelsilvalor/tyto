// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { type TrustDialog, type WorkspaceView, TRUST_DIALOG_TAG } from './trust-dialog.js';
import { bannerShown, paintWorkspaceBanner } from './workspace-banner.js';

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
  problems: [],
  ...overrides,
});

function banner(): HTMLElement {
  document.body.innerHTML = `<div id="workspace-banner" hidden>
    <span class="workspace-banner__text"></span>
    <button class="workspace-banner__trust"></button>
    <button class="workspace-banner__problems"></button>
  </div>`;
  return document.getElementById('workspace-banner')!;
}

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
  readonly asked: boolean[];
}> {
  document.body.innerHTML = `<${TRUST_DIALOG_TAG}></${TRUST_DIALOG_TAG}>`;
  const element = document.querySelector<TrustDialog>(TRUST_DIALOG_TAG)!;
  const asked: boolean[] = [];
  element.locale = 'en';
  element.view = shown;
  element.onTrust = (trusted) => asked.push(trusted);
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

  it('says no folder is open and offers neither button', async () => {
    const { element } = await dialog(view({ folder: null, name: null }));
    expect(element.querySelector('.trust__state')?.textContent).toContain('No workspace folder');
    expect(element.querySelector('.trust__grant')).toBeNull();
  });
});
