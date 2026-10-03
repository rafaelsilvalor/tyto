import { type ElementPart, noChange } from 'lit';
import { Directive, type PartInfo, PartType, directive } from 'lit/directive.js';

/**
 * The window's one writer of `srcdoc`.
 *
 * Every iframe that shows a compiled document goes through `showDocument`: the brief preview
 * (`preview.ts`) directly, and the template-mode grid (`template-mode.ts`) through
 * `frameDocument`, because a lit `.srcdoc=` binding would write the property behind the rule's
 * back. The property reflects the attribute, so the rule writes and reads the attribute only.
 */

/** The document an iframe is loading, and the newest one asked for while it loads. */
interface Navigation {
  loading: string;
  newest: string;
}

/** Keyed by element, so a replaced iframe takes its pending navigation with it. */
const navigations = new WeakMap<HTMLIFrameElement, Navigation>();

/**
 * Puts `html` in `iframe`, **one navigation at a time** (TYTO-219).
 *
 * A fresh iframe keeps the *first* of two `srcdoc` assignments when the second lands before
 * the first one's `load`. Measured on a fresh sandboxed iframe at a fixed 1080×1920, with no
 * resize: a grid-1x1 document then a story document before the first `load` gave one `load`
 * and the grid document, which is 1080 px tall, so the story showed checkerboard below 1080,
 * 23 of 23 runs. With a wait for `load` between them, 0 of 8. It happened with or without the sandbox,
 * hidden or shown, under a transform or CSS `zoom`, at every scale factor tried. A window
 * only hits it when the format tab is clicked before the first preview has loaded, which is
 * slower in a shown window, and nothing heals it until the next change.
 *
 * So while a navigation is pending only the newest document is remembered, and `load` applies
 * it. Writing the attribute again would cost a navigation the user never sees.
 */
export function showDocument(iframe: HTMLIFrameElement, html: string): void {
  const pending = navigations.get(iframe);
  if (pending !== undefined) {
    pending.newest = html;
    return;
  }
  if (iframe.getAttribute('srcdoc') === html) return;

  const navigation: Navigation = { loading: html, newest: html };
  navigations.set(iframe, navigation);
  iframe.addEventListener('load', function settle() {
    iframe.removeEventListener('load', settle);
    navigations.delete(iframe);
    // A frame taken out of the page while it loaded is nobody's preview any more.
    if (!iframe.isConnected) return;
    if (navigation.newest !== navigation.loading) showDocument(iframe, navigation.newest);
  });
  iframe.setAttribute('srcdoc', html);
}

/**
 * `showDocument` as a lit element directive: `<iframe ${frameDocument(html)}>`.
 *
 * The template-mode grid had the same race through `.srcdoc=${html}` (TYTO-220): a fresh cell
 * whose sample changed before its first `load` kept the first sample, in 20 of 20 runs, and 0
 * of 20 with a wait for `load`. Lit calls `update` on every render, and `showDocument` already
 * does nothing when the document is the one showing or the one pending.
 */
class FrameDocument extends Directive {
  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.ELEMENT) throw new Error('frameDocument belongs on an <iframe>');
  }

  render(_html: string): typeof noChange {
    return noChange;
  }

  override update(part: ElementPart, [html]: [string]): typeof noChange {
    showDocument(part.element as HTMLIFrameElement, html);
    return noChange;
  }
}

export const frameDocument = directive(FrameDocument);
