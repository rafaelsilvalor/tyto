/**
 * What the window answers when main asks whether it may go (TYTO-153).
 *
 * **The decision and nothing else.** It counts nothing, draws nothing and writes nothing: the
 * workspace, the dialog and the bridge are all ports here, for `src/main/quit.ts`'s reason —
 * that file holds the latch and knows nothing about Electron, and this one holds the three-way
 * answer and knows nothing about CodeMirror, the catalogue or the preload. What is left to
 * `main.ts` is wiring, and what is left to a test is the whole of the behaviour.
 *
 * The shape it encodes is the one every editor has: a box with three answers, where two of
 * them end the app and the third one is the reason the box is worth drawing at all.
 */

/** What a single save came back as. Only one of the three lets the app out. */
export type SaveOutcome =
  /** The bytes are on the disk. */
  | 'saved'
  /**
   * The person dismissed the Save-As picker, which is not a failure and is not a save.
   *
   * It is the ordinary way to change your mind halfway through an answer, so it cancels the
   * quit in silence — nothing is wrong and there is nothing to report.
   */
  | 'dismissed'
  /**
   * The write was refused: a full disk, a folder gone read-only, a path that vanished.
   *
   * The diagnostic is the caller's to mint (`save-failure.ts`, TYTO-124); what this type does
   * is stop the exit, because quitting after a failed save would be the app discarding a
   * document on the person's behalf — the class of bug TYTO-147 closed.
   */
  | 'failed';

/** The three buttons, as meanings. Main builds the order; nothing here knows an index. */
export type ExitAnswer = 'save' | 'discard' | 'cancel';

export interface ExitQuestion {
  /**
   * Writes the session for the next launch, drafts included (TYTO-113, ADR 0080), and says
   * whether it reached the disk. When it did, the tabs' unsaved text is kept and nothing about
   * them needs asking.
   */
  readonly keep: () => Promise<boolean>;
  /**
   * What would be lost by going, in tab order (ADR 0026): the tabs holding text that is in no
   * file, and the template mode's buffers, when `kept` is false — and nothing when it is true,
   * because since TYTO-266 the session holds the template mode too.
   *
   * Ids and not documents: what the answer does with them is ask the *caller* to save each
   * one, and a snapshot of a document would be a second copy of the text — stale by the time
   * a Save-As three pickers later reads it.
   */
  readonly unsaved: (kept: boolean) => readonly string[];
  /** Puts the box in front of the person. The count is the box's, not the caller's. */
  readonly ask: (count: number) => Promise<ExitAnswer>;
  /** Writes one tab, asking for a name when it has none. */
  readonly save: (documentId: string) => Promise<SaveOutcome>;
}

/**
 * Whether the app may go, with the person's answer in the middle of it.
 *
 * **One box for the whole quit, and `save` then walks the tabs.** Photoshop and Word ask per
 * document, which would mean three questions before anything happens for somebody with three
 * untitled tabs; this asks once and then shows one Save-As per tab that has no path, which is
 * the same number of pickers and two fewer questions. The decision is the card's, and it is a
 * decision rather than an implementation detail because it is what the person sees.
 *
 * **Anything short of every tab written cancels the quit.** A save that failed and a picker
 * that was dismissed both leave the app standing with its text in it. The alternative — going
 * anyway, having been told to save — is the app deciding to discard on somebody's behalf,
 * which is the bug ADR 0031 exists to have closed, wearing the label of a feature.
 */
export async function resolveExit(question: ExitQuestion): Promise<boolean> {
  // **Hot exit** (TYTO-113, ADR 0080): the drafts go into the session and come back on the
  // next launch, so there is no question about them. The box is left for a session the disk
  // refused — asking then is the only way not to lose.
  const dirty = question.unsaved(await question.keep());
  // Nothing to lose, so nothing to ask. A box on every quit is what trains a person to
  // dismiss the one that matters.
  if (dirty.length === 0) return true;

  const answer = await question.ask(dirty.length);
  if (answer === 'cancel') return false;
  if (answer === 'discard') return true;

  for (const documentId of dirty) {
    // Sequential and deliberately not `Promise.all`: each of these can open a file picker,
    // and three pickers at once is not a thing a person can answer.
    const outcome = await question.save(documentId);
    if (outcome !== 'saved') return false;
  }

  return true;
}

/** The three messages of the quit question that the window sends or receives, as ports. */
export interface ExitChannel {
  /** Subscribes to `app:exit-requested`. */
  readonly onRequest: (handler: (askId: number) => void) => void;
  /** `app:exit-ack`: this page has the question (ADR 0031). */
  readonly acknowledge: (askId: number) => void;
  /** `app:exit-listening`: this page can hear the question (ADR 0039). */
  readonly listening: () => void;
}

/**
 * Registers the quit listener and then tells main it exists (TYTO-44, ADR 0039).
 *
 * **In that order, and first in `load()`, before anything is awaited.** Main does not ask a page
 * that has not said it is listening; it lets the quit through instead, which is only safe while
 * nothing in the page can hold unsaved text. The listener is therefore the first thing the page
 * registers, and `listening` is sent after `onRequest`, so main can never be told it may ask
 * before a push would actually be heard.
 *
 * **The acknowledgement goes before the answer is even started** (TYTO-147, ADR 0031). Main's
 * deadline covers the ack and nothing after it, and `answer` opens by counting the workspace
 * and may end in a box a person has to read.
 */
export function listenForExit(
  channel: ExitChannel,
  answer: (askId: number) => Promise<void>,
): void {
  channel.onRequest((askId) => {
    channel.acknowledge(askId);
    void answer(askId);
  });
  channel.listening();
}

/** The two page events `holdPageClose` listens to, as ports so a test can fire them. */
export interface PageLifecycle {
  /**
   * The Navigation API's `navigate`, which fires before `beforeunload` when **this page**
   * starts a navigation: `location.reload()`, a link, a form.
   */
  readonly onNavigate: (
    handler: (navigation: { sameDocument: boolean; download: boolean }) => void,
  ) => void;
  /** `beforeunload`. The handler answers whether to veto the unload. */
  readonly onBeforeUnload: (handler: () => boolean) => void;
}

/**
 * Turns this page's own `window.close()` into a question for main (TYTO-250).
 *
 * **A third door, and the one Electron never shows main.** `window.close()` called in the page
 * skips `BrowserWindow`'s `close` event — measured: `closed → before-quit → will-quit` — so the
 * latch was never consulted and the session's final write never ran. What the page's close
 * *does* run is `beforeunload`. Vetoing it makes Electron emit `will-prevent-unload` in main,
 * which takes it to the same latch as the X button; once the latch is granted, main overrules
 * this veto and the window goes.
 *
 * **A navigation this page starts is let through**, because a veto cannot say why the page is
 * unloading and main cannot tell a page-started reload from a close — `Mod-r` is
 * `location.reload()`. The Navigation API's `navigate` fires before `beforeunload` for exactly
 * those (measured), so it marks the page as leaving. A reload main starts — DevTools,
 * `page.reload()` — fires no `navigate`; main recognises that one by itself.
 *
 * **And once this page has said the app may go, it stops vetoing.** `BrowserWindow.close()`
 * runs `beforeunload` again on the way out, after the question was answered. Main would
 * overrule that veto from its latch anyway, but each veto is a `beforeunload` dialog to
 * whatever is attached over the DevTools protocol — Playwright answers it after Electron
 * already has, and every end-to-end suite's teardown failed on the rejection. `release` is
 * called with the yes, before it is sent.
 */
export function holdPageClose(page: PageLifecycle): { readonly release: () => void } {
  let leaving = false;
  page.onNavigate(({ sameDocument, download }) => {
    // A fragment change keeps the page, and so does a download: neither one unloads it.
    if (!sameDocument && !download) leaving = true;
  });
  page.onBeforeUnload(() => !leaving);
  return {
    release: () => {
      leaving = true;
    },
  };
}
