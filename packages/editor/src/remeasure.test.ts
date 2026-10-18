// @vitest-environment jsdom
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type EditorHandle, createEditor } from './editor.js';
import { remeasureText, wasRemeasured } from './remeasure.js';
import { codeSize, themeTokens } from './theme.js';

/**
 * Reading the text's size again after the host changed the editor's face or size (TYTO-272, ADR
 * 0099). jsdom lays nothing out, so what a unit can hold is the request: the internal flag that
 * makes CodeMirror re-read the character width, and a measure asked for in every pane. The
 * guides landing on their columns at a new face and size is the desktop suite's.
 */

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const parent = (): HTMLElement => {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
};

type Internal = { viewState: { mustMeasureContent: boolean | 'refresh' } };

describe('remeasureText', () => {
  it("sets CodeMirror's own refresh flag and asks for a measure", () => {
    const view = new EditorView({ parent: parent(), doc: 'a' });
    const internal = view as unknown as Internal;
    // The internal this relies on: if an upgrade renames it, this is the line that says so.
    expect('mustMeasureContent' in internal.viewState).toBe(true);
    internal.viewState.mustMeasureContent = false;
    const asked = vi.spyOn(view, 'requestMeasure');
    remeasureText(view);
    expect(internal.viewState.mustMeasureContent).toBe('refresh');
    expect(asked).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('tells the extensions once the measure has run, so the guides redraw', async () => {
    const seen: boolean[] = [];
    const view = new EditorView({
      parent: parent(),
      doc: 'a',
      extensions: EditorView.updateListener.of((update) => {
        seen.push(wasRemeasured(update));
      }),
    });
    remeasureText(view);
    expect(seen).not.toContain(true);
    await vi.waitFor(() => {
      expect(seen).toContain(true);
    });
    view.destroy();
  });
});

describe('EditorHandle.remeasure', () => {
  it('remeasures every pane, the first and the ones made after it', () => {
    handle = createEditor(parent(), { doc: '::titulo\n  a\n' });
    const second = handle.createPane(parent());
    const views = [handle.view, second.view];
    for (const view of views) (view as unknown as Internal).viewState.mustMeasureContent = false;
    handle.remeasure();
    expect(views.map((view) => (view as unknown as Internal).viewState.mustMeasureContent)).toEqual(
      ['refresh', 'refresh'],
    );
  });
});

describe('the code size', () => {
  it("is a token the host defines, read by the editor's own theme", () => {
    expect(codeSize).toBe('var(--tyto-code-size)');
    expect(themeTokens).toContain('--tyto-code-size');
  });
});
