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
   * The tabs holding text that is in no file, in tab order (ADR 0026).
   *
   * Ids and not documents: what the answer does with them is ask the *caller* to save each
   * one, and a snapshot of a document would be a second copy of the text — stale by the time
   * a Save-As three pickers later reads it.
   */
  readonly unsaved: () => readonly string[];
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
  const dirty = question.unsaved();
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
