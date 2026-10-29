import { describe, expect, it } from 'vitest';

import { carriedAcrossTemplateRead } from './problems-mark.js';
import { exportDestination, withWorkspaceRows } from './workspace-folder.js';

const row = (code: string, message = code) => ({ severity: 'warning' as const, code, message });

describe('the workspace rows in the problems panel (TYTO-278)', () => {
  it('replaces the previous answer and keeps every other row', () => {
    const before = [row('E_SAVE_FAILED'), row('W_PROJECT_PATH_OUTSIDE', 'old')];
    const after = withWorkspaceRows(before, [row('W_PROJECT_KEY_UNKNOWN')]);
    expect(after.map((item) => item.code)).toEqual(['E_SAVE_FAILED', 'W_PROJECT_KEY_UNKNOWN']);
    // Closing the folder clears its rows.
    expect(withWorkspaceRows(after, []).map((item) => item.code)).toEqual(['E_SAVE_FAILED']);
  });

  it('survives a template read, which rebuilds the installation list', () => {
    const carried = carriedAcrossTemplateRead([row('E_TRUST_FILE'), row('E_TEMPLATE_READ')]);
    expect(carried.map((item) => item.code)).toEqual(['E_TRUST_FILE']);
  });

  it("keeps a restricted folder's plugin files row across a template read (TYTO-433)", () => {
    // Seen in the real window: the strip counted it and the panel had dropped it, because a
    // sync's `templates:changed` rebuilds the installation list right after the folder opens.
    const carried = carriedAcrossTemplateRead([row('W_PROJECT_PLUGIN_FILES_WITHHELD')]);
    expect(carried.map((item) => item.code)).toEqual(['W_PROJECT_PLUGIN_FILES_WITHHELD']);
  });
});

describe("the export dialog's destination (TYTO-278)", () => {
  it("is the folder picked in this window, else the workspace's output folder", () => {
    expect(exportDestination('/picked', '/work/exports')).toBe('/picked');
    expect(exportDestination(undefined, '/work/exports')).toBe('/work/exports');
    expect(exportDestination(undefined, null)).toBeUndefined();
  });
});
