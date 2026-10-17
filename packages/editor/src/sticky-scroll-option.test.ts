// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { type EditorHandle, createEditor } from './editor.js';

/**
 * The `stickyScroll` option and `setStickyScroll` (TYTO-295): the layer is mounted or not, in
 * every pane and in a tab shown after the switch. Where the rows go is the desktop suite's —
 * jsdom lays nothing out.
 */

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const mount = (stickyScroll?: boolean): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, {
    doc: '::lamina\n  um\n  dois\n',
    ...(stickyScroll === undefined ? {} : { stickyScroll }),
  });
  return handle;
};

const layerIn = (root: ParentNode): Element | null => root.querySelector('.cm-sticky-scroll');

describe('the stickyScroll option', () => {
  it('mounts the layer by default, and none when it is off', () => {
    expect(layerIn(mount().view.dom)).not.toBeNull();
    handle?.destroy();
    expect(layerIn(mount(false).view.dom)).toBeNull();
  });

  it('turns it off and on in every pane, keeping the text', () => {
    const editor = mount();
    const second = document.createElement('div');
    document.body.append(second);
    const pane = editor.createPane(second);
    editor.setStickyScroll(false);
    expect(layerIn(editor.view.dom)).toBeNull();
    expect(layerIn(pane.view.dom)).toBeNull();
    editor.setStickyScroll(true);
    expect(layerIn(editor.view.dom)).not.toBeNull();
    expect(layerIn(pane.view.dom)).not.toBeNull();
    expect(editor.getValue()).toBe('::lamina\n  um\n  dois\n');
  });

  it('brings a tab built before the switch up to it when the tab is shown', () => {
    const editor = mount();
    const tab = editor.blank('::a\n  b\n');
    editor.setStickyScroll(false);
    editor.restore(tab);
    expect(layerIn(editor.view.dom)).toBeNull();
  });
});
