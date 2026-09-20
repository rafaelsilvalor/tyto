import { z } from 'zod';

import { layoutSchema } from './layout.js';

/**
 * The contract between the three processes, written once.
 *
 * `apps/desktop` is the only place in the repo where two runtimes have to agree about the
 * shape of a message, and the agreement is the thing that rots: main adds a field, the
 * renderer keeps sending the old shape, and nothing says so until a user sees a blank
 * panel. So neither side declares a channel. Both import this table — main to register a
 * handler and validate what arrives, the preload to validate what leaves and to build the
 * typed API the renderer sees — and the types the renderer programs against are derived
 * from the same schemas that do the validating (ADR 0001, `docs/architecture.md`).
 *
 * Zod and not hand-written types, because `contextIsolation: true` means every message is
 * structured-cloned across a process boundary: a type alone is erased at runtime and would
 * check the one side that was already correct. The schema is what survives the crossing.
 */

/** One channel: what may be asked, and what comes back. */
export interface IpcChannel<
  Request extends z.ZodType = z.ZodType,
  Response extends z.ZodType = z.ZodType,
> {
  readonly request: Request;
  readonly response: Response;
}

const channel = <Request extends z.ZodType, Response extends z.ZodType>(
  request: Request,
  response: Response,
): IpcChannel<Request, Response> => ({ request, response });

/**
 * An account name a credential is filed under.
 *
 * Constrained rather than left as a string: it becomes a key in a store the user cannot
 * see, and a blank or whitespace-only one would be a credential nobody can ever ask for
 * again.
 */
const accountName = z.string().trim().min(1).max(200);

/**
 * A diagnostic, flattened to what survives a structured clone.
 *
 * Declared here rather than imported from `@tyto/core`, and the difference matters: the
 * renderer may not depend on a Node package, and a `Diagnostic` is a type — erased at
 * runtime, so importing it would check the one side that was already right. What crosses
 * the bridge is data, and this is its shape.
 *
 * `code` is a plain string and not the union `@tyto/core` narrows it to. The union is the
 * catalogue's business; a renderer that pinned it would stop compiling every time a
 * diagnostic was added, which is the opposite of what a contract is for.
 */
const diagnostic = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  code: z.string(),
  message: z.string(),
  /** Absent for a diagnostic about the project rather than about a span of the brief. */
  range: z.object({ start: z.number().int(), end: z.number().int() }).optional(),
  hint: z.string().optional(),
});

/**
 * A brief the window has open, as both sides agree to describe one.
 *
 * `text` is what goes in the editor; `name` is what the title bar shows; `path` is the key
 * the recent list reopens by. No folder, no extension games, nothing the renderer could
 * turn into a second way to reach a disk.
 */
const openDocument = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  text: z.string(),
});

/**
 * Which tab a message is about (E9.11).
 *
 * **The renderer invents these and main files paths under them.** With one document open,
 * "the open file" was a single `let` in `src/main/documents.ts`; with tabs there are several
 * and something has to say which. The id is opaque to main — it is a key, never a path and
 * never an index — and it is the renderer's because the renderer is the side that knows
 * when a tab is born and when it is closed.
 *
 * It travels on `brief:preview` rather than being set by a channel of its own, and that is
 * the decision the card left open. A pointer moved by one message and read by another would
 * race: previews are debounced and deliberately resolve out of order (`requestId` exists for
 * exactly that), so an activate arriving between a request and its compile would resolve one
 * document's `assets/logo.png` against another document's folder. A request that carries its
 * own subject cannot be wrong about it.
 */
const documentId = z.string().min(1).max(100);

/**
 * Every channel the app has, and the only place a channel name is written.
 *
 * Deliberately small. E9.1 opens a window and proves the wiring; the channels a brief, a
 * preview and a job need arrive with the cards that need them, and they arrive *here*
 * rather than beside the code that sends them.
 */
export const IPC_CHANNELS = {
  /**
   * What the renderer needs to render its shell, asked once on load.
   *
   * `locale` is the system's, which is what makes `pt-BR` a default rather than a hardcoded
   * choice: a machine set to English gets English without anybody changing a file.
   */
  'app:info': channel(
    z.object({}),
    z.object({
      version: z.string(),
      platform: z.string(),
      locale: z.string(),
      /**
       * The templates the plugin host actually holds, by name.
       *
       * Here rather than in a channel of its own because it is the answer to "did the
       * composition root wire anything": a built-in pack registered and never read would be
       * an extension point nobody could tell was broken. E9.2 needs the manifests
       * themselves and will ask for those; a name is what an empty window can say.
       */
      templates: z.array(z.string()),
    }),
  ),

  /**
   * A brief, compiled to one HTML document per frame (E9.2).
   *
   * **HTML and not image bytes.** The renderer is Chromium; asking main to rasterize so that
   * Chromium can decode the raster is a round trip whose only products are latency and a
   * lossy copy. `src/main/preview.ts` has the reasoning, and E9.4's export is where bytes
   * are still the answer.
   *
   * `requestId` is echoed back untouched, and it is the whole of how a stale answer is
   * discarded. Previews are fired per keystroke and resolve out of order — a slow compile of
   * three slides can land after a fast one of the text that replaced it — so the renderer
   * keeps the id it last asked for and drops anything else. Main does not cancel; a compile
   * is milliseconds and cancellation would be more machinery than the thing it saves.
   *
   * It never fails: a half-typed brief is the *normal* state of this channel, not an
   * exceptional one, so what a rejection would carry travels in `diagnostics` instead and
   * `frames` is empty. A frame list and a diagnostic list are both always present, because a
   * warning is a document that still renders (ADR 0013).
   */
  'brief:preview': channel(
    z.object({
      requestId: z.number().int().nonnegative(),
      /** Which tab this brief is in, which is how main knows what folder to resolve against. */
      documentId,
      brief: z.string(),
    }),
    z.object({
      requestId: z.number().int().nonnegative(),
      frames: z.array(
        z.object({
          /** The artwork this frame belongs to — a slide, for a repeating brief. */
          artwork: z.string(),
          /** The format's name, which is what a tab is labelled with. */
          format: z.string(),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          /** Self-contained: fonts and assets embedded, no request it could make. */
          html: z.string(),
        }),
      ),
      /**
       * The artworks the brief produced, in the order it wrote them (E9.3).
       *
       * Derivable from `frames` by deduplicating on `artwork`, and sent anyway, for the one
       * field that is not in a frame: `range`. Selecting a slide scrolls the editor to the
       * directive that created it, and only `resolve` knows where that directive was — a
       * frame is downstream of a `Scene`, which carries no source position at all.
       *
       * Absent `range` is a brief with no repeating slot: one artwork stands for the whole
       * document, and there is no single line to scroll to.
       */
      artworks: z.array(
        z.object({
          id: z.string(),
          /** Its place in the brief, so a list can be numbered without parsing the id. */
          index: z.number().int().nonnegative(),
          range: z.object({ start: z.number().int(), end: z.number().int() }).optional(),
        }),
      ),
      diagnostics: z.array(diagnostic),
    }),
  ),

  /**
   * Every template the registry holds, with what a picker needs to show one (E9.3).
   *
   * Separate from `app:info`'s list of names, which stays: that one answers "did the
   * composition root wire anything" on a window that has not compiled a brief yet, and it
   * is one round trip lighter than this. Asked once on load, because a registry is read
   * once at startup and held (`src/main/preview.ts`) — a picker that re-asked per click
   * would be re-reading nothing.
   *
   * `preview` is a `data:` URI and not a path, and the reason outlived the premise it used
   * to be given with. It was "the renderer runs in a browser tab later, where the folder is
   * not on the same disk"; ADR 0024 says it does not. What still holds is the renderer's own
   * Content-Security-Policy: `img-src 'self' data:` refuses a `file://` URL before it is
   * fetched, in this window, today. Absent for a template with no `preview.png`, which today
   * is all of them.
   */
  'templates:list': channel(
    z.object({}),
    z.object({
      templates: z.array(
        z.object({
          name: z.string(),
          version: z.string(),
          description: z.string().optional(),
          /** Format ids the template renders, which is what the preview tabs will become. */
          formats: z.array(z.string()),
          preview: z.string().optional(),
        }),
      ),
      /**
       * Folders that meant to be a template and could not be read as one.
       *
       * The registry keeps working templates and failures apart on purpose, so that one
       * broken manifest does not empty a picker. Carried here so the panel can say a
       * template is missing *because* it is broken, rather than leaving it silently absent —
       * `createPreviewService` replays the registry's *warnings* on every preview and these
       * are not among them, so without this channel nothing would ever say so.
       *
       * The registry's own diagnostics, not a string built from them: they already carry a
       * code from `docs/diagnostic-codes.md` and a message in the user's language, and the
       * panel draws them the same way it draws a diagnostic about the brief. A `range` would
       * index a file the editor is not holding, so it is left off and the row is not a
       * button.
       */
      failures: z.array(
        z.object({
          directory: z.string(),
          diagnostics: z.array(diagnostic.omit({ range: true })),
        }),
      ),
    }),
  ),

  /**
   * Which folder is searched before the built-in pack, right now (TYTO-122).
   *
   * Asked once on load, beside `templates:list`. `folder` is `null` on an install that has
   * never chosen one, which is where everybody starts and where clearing goes back to.
   *
   * `found` is how many templates that folder contributed, and it is a **count rather than a
   * boolean** for two reasons. The window says how many, so a person can tell a folder that
   * worked from one that was accepted and did nothing; and `found: 0` on a set folder is
   * exactly the card's "a folder that is not a template pack", which is a different report
   * from a folder that could not be read at all — that one arrives as a diagnostic.
   *
   * The renderer is told the path so it can show it. That is the only thing it can do with
   * it: every read still happens in main (ADR 0010), and no channel here takes a folder.
   */
  'templates:folder': channel(
    z.object({}),
    z.object({
      folder: z.string().nullable(),
      found: z.number().int().nonnegative(),
    }),
  ),

  /**
   * Chooses that folder, or clears it, and answers with what is in force afterwards.
   *
   * One channel and not two, because it is one setting written two ways and both writes have
   * the same answer. `choose: true` opens the native picker in main — `dialog` is a
   * main-process API, the same arrangement `file:open` and `export:choose-directory` already
   * have — and `choose: false` goes back to the built-in pack.
   *
   * **No template list comes back.** The renderer re-asks `templates:list`, which is already
   * the single source of the picker's rows and of the problems panel's installation
   * diagnostics; answering with a second copy here would be two paths to one screen.
   *
   * A dismissed picker is not a failure and not a clear: the answer is whatever was already
   * in force.
   */
  'templates:set-folder': channel(
    z.object({ choose: z.boolean() }),
    z.object({
      folder: z.string().nullable(),
      found: z.number().int().nonnegative(),
    }),
  ),

  /**
   * A brief on disk, as the renderer is allowed to know it (E9.8).
   *
   * `name` and never the folder. The renderer paints a window title and a recent list, and
   * neither needs to know where the file is — main holds the path, resolves the brief's
   * assets against it, and is the only side that touches a disk (ADR 0010). `path` is here
   * for one purpose and it is not navigation: it is the key a recent entry is reopened by,
   * and main refuses any path that is not already in its own list.
   */
  'file:open': channel(
    z.object({
      /** The tab the renderer made to receive the file, if the dialog produces one. */
      documentId,
    }),
    z.object({
      /** Absent when the dialog was dismissed, which is not a failure. */
      document: openDocument.nullable(),
      /**
       * Which tab ended up holding it, which is **not always the one that was asked for**.
       *
       * A file already open in another tab is that tab, and main is the side that can say
       * so: it holds the id-to-path map, and the renderer holds names. Without this the
       * window would open a second buffer over one file and the two would race to save.
       * Absent for a dismissed dialog.
       */
      documentId: documentId.nullable(),
    }),
  ),

  /**
   * Reopens something from the recent list, by the path that list handed out.
   *
   * Main checks the path against the list it wrote before reading anything. That is the
   * whole of the containment: a renderer that asked for `~/.ssh/id_rsa` gets the same
   * answer as one that asked for a file the user deleted, because neither is a path this
   * app ever offered.
   */
  'file:reopen': channel(
    z.object({ documentId, path: z.string().min(1) }),
    z.object({
      document: openDocument.nullable(),
      /** The tab holding it — see `file:open`. Absent when nothing was opened. */
      documentId: documentId.nullable(),
      /** Set when the entry is in the list and the file is gone, so the panel can say so. */
      missing: z.boolean(),
    }),
  ),

  /**
   * Writes the brief, asking for a name when there is not one yet.
   *
   * `saveAs` forces the dialog for a document that already has a path. The renderer sends
   * the text and never a destination; what comes back is the document as it now stands, or
   * nothing if the dialog was dismissed.
   */
  'file:save': channel(
    z.object({ documentId, text: z.string(), saveAs: z.boolean() }),
    z.object({
      document: openDocument.nullable(),
      /**
       * The tab that was holding this path and is not any more (TYTO-104).
       *
       * A save-as onto a file another tab has open is the one call that can leave two tabs
       * claiming one path, and `save` deliberately gives it to the tab that asked — moving
       * the person away from the text they just wrote would be worse. So the *other* tab
       * lets go, and this field is how it finds out: main cannot tell it, because every
       * channel here is a question the renderer asks, so the answer to the save carries it.
       *
       * `null` on every ordinary save, which is almost all of them. The renderer's part is
       * to take the name off that tab and mark it unsaved — its text is now in no file, and
       * a strip showing the same name twice would say otherwise.
       */
      released: documentId.nullable(),
    }),
  ),

  /**
   * Tells main a tab is gone, so it stops holding that document's path (E9.11).
   *
   * Nothing comes back and nothing on screen depends on it. It is here because the
   * alternative is a map that only grows: every file opened in a session would keep its
   * entry for the life of the window, and reopening a closed file would find the *old* tab's
   * id still claiming it.
   */
  'file:close': channel(z.object({ documentId }), z.object({})),

  /**
   * A yes-or-no the renderer cannot ask for itself (E9.11).
   *
   * Closing a tab with unsaved text has to ask, and the renderer's own `confirm()` would put
   * the browser's buttons — in the OS's language, not the window's — in front of somebody
   * who chose Portuguese in the footer. Main owns the OS dialog; the renderer owns every
   * string, so the labels travel with the request rather than being written twice.
   */
  'dialog:confirm': channel(
    z.object({
      message: z.string().min(1).max(500),
      detail: z.string().max(500).optional(),
      /** The button that means yes, and the one that means no. Both already translated. */
      confirm: z.string().min(1).max(100),
      cancel: z.string().min(1).max(100),
    }),
    z.object({ confirmed: z.boolean() }),
  ),

  /**
   * The three-way question on the way out: save, do not save, or stay (TYTO-153).
   *
   * **A channel of its own rather than a third label on `dialog:confirm`**, and the choice is
   * the card's one genuinely new decision. Widening `confirm` would mean a request whose
   * third button is optional and a response that is no longer a boolean, so every one of its
   * five existing callers would carry a shape they never use; and the two dialogs disagree
   * about which button is safe — `confirm` points `defaultId` and `cancelId` at the same
   * index deliberately, and here they are two different buttons. The alternative that was
   * *not* taken is a generic `dialog:message` carrying `buttons: string[]`: it would fit any
   * future box, and that is the objection. A renderer would then choose how many buttons main
   * draws and what each index means, which puts the mapping from an answer to an act on the
   * wire instead of in the two files that hold it.
   *
   * Every string is the renderer's and already translated, the way `dialog:confirm`'s are.
   * What comes back is the **meaning** and never an index: main builds the button order, so
   * main is where the order is read back.
   */
  'dialog:save-changes': channel(
    z.object({
      message: z.string().min(1).max(500),
      detail: z.string().max(500).optional(),
      /** Write the work and then go. The default button, because it cannot lose anything. */
      save: z.string().min(1).max(100),
      /** Go without writing it — what `exit.discard.confirm` used to be on its own. */
      discard: z.string().min(1).max(100),
      /** Stay. The Escape key, and the button `dialog:confirm` would have made the default. */
      cancel: z.string().min(1).max(100),
    }),
    z.object({ answer: z.enum(['save', 'discard', 'cancel']) }),
  ),

  /**
   * Stage one of the quit question: "this window has the message" (TYTO-147, ADR 0031).
   *
   * It carries no verdict and it is not an answer. It exists because the two legs of the quit
   * question have wildly different costs and only one of them can be given a deadline. Getting
   * the push into a running renderer is machine work and is over in microseconds; deciding
   * whether to discard the text is a **person** reading a box, and no number can bound that
   * without eventually taking somebody's work away mid-read (ADR 0031).
   *
   * So the deadline in `src/main/quit.ts` bounds this message and nothing else. It is sent from
   * the `app:exit-requested` listener **before** the renderer counts anything or draws anything,
   * because what main needs to know at that point is only that JS in this window is running and
   * has the question.
   */
  'app:exit-ack': channel(z.object({ askId: z.number().int().nonnegative() }), z.object({})),

  /**
   * Stage two: the renderer's half of the one question main asks (TYTO-123, ADR 0029).
   *
   * Main pushes `app:exit-requested` and the answer comes back **here**, on an ordinary
   * request channel, which is the whole of why this app gains one new transport shape rather
   * than two: a push carries no reply, and the renderer keeps answering through the
   * direction it already had.
   *
   * `askId` is `brief:preview`'s `requestId` idea, and it is load-bearing for the same
   * reason. A prevented quit that is answered late must not release a *later* one: somebody
   * who cancels, keeps typing and then quits again is asked a second question, and the first
   * answer arriving after it would otherwise let the app out with the text still unsaved.
   * Main ignores any id that is not the one outstanding.
   */
  'app:exit-answer': channel(
    z.object({ askId: z.number().int().nonnegative(), allow: z.boolean() }),
    z.object({}),
  ),

  /** What the command bar offers under "recent". Newest first; `missing` is shown, not hidden. */
  'files:recent': channel(
    z.object({}),
    z.object({
      files: z.array(z.object({ path: z.string(), name: z.string(), missing: z.boolean() })),
    }),
  ),

  /**
   * Where the panels were last time (E9.10).
   *
   * Asked once, before the first arrange. The whole layout crosses rather than a delta,
   * because it is four small records and a diff would be a second representation of
   * something `shared/layout.ts` already defines once.
   */
  'layout:get': channel(z.object({}), z.object({ layout: layoutSchema })),

  /**
   * Remembers it. Answers nothing, because there is nothing a renderer could do about a
   * layout that failed to persist except show a person an error about a splitter.
   */
  'layout:set': channel(z.object({ layout: layoutSchema }), z.object({})),

  /**
   * Stores a secret through `safeStorage`, which is the OS keychain (ADR 0001).
   *
   * The renderer hands over the plaintext and never sees the ciphertext: encryption is
   * main's, because `safeStorage` is an Electron main-process API and a renderer with no
   * Node cannot reach it even if it wanted to.
   */
  'credentials:set': channel(
    z.object({ account: accountName, secret: z.string().min(1) }),
    z.object({ stored: z.boolean() }),
  ),

  /** Reads one back. `null` for an account nothing was ever stored under. */
  'credentials:get': channel(
    z.object({ account: accountName }),
    z.object({ secret: z.string().nullable() }),
  ),

  /** Forgets one. `false` when there was nothing to forget, which is not an error. */
  'credentials:delete': channel(
    z.object({ account: accountName }),
    z.object({ deleted: z.boolean() }),
  ),

  /**
   * Starts an export and answers with its id — not with its result (E9.4, TYTO-43).
   *
   * A render is seconds, not milliseconds, and a channel that answered with the finished
   * folder would be a dialog frozen until it was done. So this returns as soon as the run
   * has a name, and `export:export-progress` is how the dialog follows it.
   */
  'export:start': channel(
    z.object({
      documentId,
      /**
       * The brief's text, carried by the request the way `brief:preview` carries it.
       *
       * Main holds paths, not text — `DocumentService` is a map of tab to file — and the
       * editor's buffer is the only place the *unsaved* brief exists. Exporting what is on
       * disk instead would quietly export the last save.
       */
      brief: z.string(),
      /** Where the files go. Chosen through the native picker in main, not typed here. */
      directory: z.string().min(1),
      /** At least one, because an export of nothing is a dialog that should not have opened. */
      outputs: z
        .array(
          z.object({
            kind: z.enum(['png', 'jpeg', 'webp', 'svg']),
            /** 1–100, and only for `jpeg` and `webp`; the raster port refuses it on `png`. */
            quality: z.number().int().min(1).max(100).optional(),
            scale: z.number().positive().max(8).optional(),
          }),
        )
        .min(1),
      /** Absent renders every format the template declares, which is `tyto render`'s default. */
      formats: z.array(z.string().min(1)).optional(),
    }),
    z.object({ exportId: z.string().min(1) }),
  ),

  /**
   * How far along, asked rather than pushed.
   *
   * **Polled, and it stays polled now that the alternative exists.** When this was written a
   * one-way main→renderer message was a shape the app did not have, and the decision belonged
   * to TYTO-123; `IPC_EVENTS` below is what TYTO-123 built (ADR 0029). This channel is not
   * rewritten on top of it, because progress is *state a dialog reads* rather than a question
   * that needs answering: a push would have to carry the whole record anyway, and a dialog
   * that opened after a run started would still have to ask once to catch up. The answer is
   * four numbers and a verdict, which is cheap enough to ask for a few times a second.
   */
  'export:progress': channel(
    z.object({ exportId: z.string().min(1) }),
    z.object({
      /** Absent for an id nothing was ever started under — a typo, or a stale dialog. */
      progress: z
        .object({
          status: z.enum(['running', 'finished', 'cancelled']),
          total: z.number().int().nonnegative(),
          done: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
          /** The folder the files went to, so "open folder" has somewhere to open. */
          directory: z.string(),
          diagnostics: z.array(diagnostic),
          /**
           * Set when the run died of something that is not a diagnostic — a disk that would
           * not take the file. `docs/diagnostic-codes.md` is a closed catalogue and this is
           * not in it, which is exactly why it travels as its own field.
           */
          failure: z.string().optional(),
        })
        .optional(),
    }),
  ),

  /** Fires the run's `AbortSignal`. Answers nothing: the verdict arrives through progress. */
  'export:cancel': channel(z.object({ exportId: z.string().min(1) }), z.object({})),

  /** Shows a folder in the OS file manager, which is what "open folder" means. */
  'export:reveal': channel(z.object({ directory: z.string().min(1) }), z.object({})),

  /**
   * The native folder picker, and the last folder it was pointed at.
   *
   * In main because `dialog` is an Electron main-process API — the same arrangement
   * `file:open` already has, and for the same reason `index.ts` gives as its rule.
   */
  'export:choose-directory': channel(z.object({}), z.object({ directory: z.string().optional() })),

  /**
   * Something went wrong in the window, written down where a report can reach it (TYTO-132).
   *
   * An ordinary question and deliberately not a push: the renderer is the side that *has* the
   * failure, so this travels the direction the bridge already had. `IPC_EVENTS` exists (ADR
   * 0029) and this channel has no business using it.
   *
   * **The two length caps are the mechanism, not a courtesy.** The card's rule is that no
   * brief text and no file contents reach the log, and a rule enforced by call sites is a rule
   * that survives until somebody adds a fifth call site. At 200 and 4000 the renderer *cannot*
   * push a brief across: `parseIpc` refuses it in the preload, before the message is sent.
   *
   * `warn` and `error` only. The renderer has no reason to file debug chatter, and every level
   * it can reach is one more thing that can spend the file's ceiling.
   */
  'log:write': channel(
    z.object({
      level: z.enum(['warn', 'error']),
      message: z.string().min(1).max(200),
      detail: z.string().max(4000).optional(),
    }),
    z.object({}),
  ),

  /** Opens the folder the log lives in, which is how a tester reaches it without a path. */
  'log:reveal': channel(z.object({}), z.object({})),

  /**
   * The window telling main which language it is now in, so the menu can be rebuilt (TYTO-124).
   *
   * Main learns the locale once, at startup, off `app.getLocale()` — and until this card the
   * menu carried exactly one string of this app's own, so a footer picker that disagreed with
   * it cost a single line reading the wrong language. A File menu of five verbs makes that
   * divergence the first thing a person sees, which is what turns a known wart into a channel.
   *
   * A request and not an event, because the direction is the renderer's: main is being told,
   * not asked. The empty response is an acknowledgement and nothing more — the menu is a side
   * effect in the browser process and there is nothing for the window to do with the outcome.
   */
  'app:locale': channel(z.object({ locale: z.string().min(1) }), z.object({})),
} as const;

export type IpcChannels = typeof IPC_CHANNELS;
export type IpcChannelName = keyof IpcChannels;

export type IpcRequest<Name extends IpcChannelName> = z.infer<IpcChannels[Name]['request']>;
export type IpcResponse<Name extends IpcChannelName> = z.infer<IpcChannels[Name]['response']>;

/**
 * The other direction: what main may tell the window, unasked (ADR 0029).
 *
 * A second table and not a third kind of entry in the first one, because the two are not the
 * same thing and a reader should not have to check a flag to know which way a name travels.
 * Every channel above is a question the renderer asks and a response it gets back; every
 * name here is a message main pushes, and **a push carries no reply** — the answer, when
 * there is one, travels back on an ordinary channel above.
 *
 * That rule is the whole economy of the decision. Making pushes answerable would have meant
 * a second transport shape with its own correlation, its own timeouts and its own failure
 * modes; this way the app gained one.
 *
 * Deliberately small, for the reason `IPC_CHANNELS` is: the messages arrive with the cards
 * that need them.
 */
export const IPC_EVENTS = {
  /**
   * The app is trying to exit and wants to know whether the window minds (TYTO-123).
   *
   * Main cannot answer this itself: the workspace is the renderer's, `isUnsaved` is a
   * comparison computed from it (ADR 0026), and the language the question has to be asked in
   * is the one the footer picker last chose — which main was told exactly once, at startup.
   *
   * **Two return legs, not one** (TYTO-147, ADR 0031). The renderer acknowledges receipt on
   * `app:exit-ack` immediately, and answers on `app:exit-answer` whenever the person has
   * decided. Both carry this `askId` back. Only the first leg has a deadline.
   */
  'app:exit-requested': z.object({ askId: z.number().int().nonnegative() }),

  /**
   * Somebody picked a File menu item; run the command it names (TYTO-124).
   *
   * The id and not the action, which is the whole of how the menu avoids being a second
   * implementation: main knows the table in `shared/commands.ts` and nothing about what any
   * of it does, and the renderer answers by calling the same `registry.run` the command bar
   * calls. A menu item that grew a behaviour of its own would be a behaviour the bar did not
   * have, and the two would drift on the first card that changed either.
   *
   * No reply, per the rule above: a menu item is not a question. A command that fails does
   * what it does when the bar runs it — which for a save is now a row in the problems panel.
   */
  'command:run': z.object({ id: z.string().min(1) }),
} as const;

export type IpcEvents = typeof IPC_EVENTS;
export type IpcEventName = keyof IpcEvents;
export type IpcEventPayload<Name extends IpcEventName> = z.infer<IpcEvents[Name]>;

export const IPC_EVENT_NAMES = Object.keys(IPC_EVENTS) as readonly IpcEventName[];

export function isIpcEventName(name: string): name is IpcEventName {
  return Object.prototype.hasOwnProperty.call(IPC_EVENTS, name);
}

/**
 * The API the preload puts on `window.tyto`.
 *
 * Derived from the table rather than written beside it, so a channel added above is a
 * method the renderer can call with no second declaration — and a channel removed is a
 * compile error at every call site rather than a rejected promise at runtime.
 *
 * `on` is the one member that is not a channel, and it is an intersection rather than
 * another key in the mapped type because the two halves are derived from two different
 * tables. It returns the function that unsubscribes, which is the only shape that does not
 * ask a caller to keep the listener around to take it off again.
 */
export type TytoBridge = {
  readonly [Name in IpcChannelName]: (request: IpcRequest<Name>) => Promise<IpcResponse<Name>>;
} & {
  readonly on: <Name extends IpcEventName>(
    event: Name,
    listen: (payload: IpcEventPayload<Name>) => void,
  ) => () => void;
};

export const IPC_CHANNEL_NAMES = Object.keys(IPC_CHANNELS) as readonly IpcChannelName[];

export function isIpcChannelName(name: string): name is IpcChannelName {
  return Object.prototype.hasOwnProperty.call(IPC_CHANNELS, name);
}

/**
 * The error a refused message raises, on whichever side refused it.
 *
 * A `TypeError` and not a `Diagnostic`: `docs/conventions.md` keeps `Result` for what a
 * *brief* can be wrong about, and reserves a throw for what a caller could have predicted
 * from its own arguments. A renderer sending the wrong shape down a channel it imported the
 * schema for is the second kind — nothing a user typed produced it.
 *
 * `direction` carries `'event'` as well as the two halves of a request, and it is not a
 * synonym for `'request'`: the whole point of naming a direction is that it says **whose bug
 * it is**. A bad request is the renderer's, a bad response is main's, and a bad push is
 * main's too but reaches the renderer from the other side — a reader chasing an
 * `IpcContractError` should not have to know the channel table to work out which way the
 * message was going.
 */
export class IpcContractError extends TypeError {
  constructor(
    readonly channel: string,
    readonly direction: 'request' | 'response' | 'event',
    readonly issues: string,
  ) {
    super(`ipc ${channel}: ${direction} does not match the contract — ${issues}`);
    this.name = 'IpcContractError';
  }
}

const describe = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path === '' ? issue.message : `${path}: ${issue.message}`;
    })
    .join('; ');

/**
 * Checks one side of one message, and throws with the channel named when it does not fit.
 *
 * Both directions go through this, because the two sides fail for different reasons and a
 * reader needs to know which: a bad *request* is the renderer's bug, a bad *response* is
 * main's. The message says which without the reader opening a file.
 */
export function parseIpc<Name extends IpcChannelName, Direction extends 'request' | 'response'>(
  name: Name,
  direction: Direction,
  value: unknown,
): Direction extends 'request' ? IpcRequest<Name> : IpcResponse<Name> {
  const schema = IPC_CHANNELS[name][direction];
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new IpcContractError(name, direction, describe(parsed.error));
  return parsed.data as Direction extends 'request' ? IpcRequest<Name> : IpcResponse<Name>;
}

/**
 * The same check for a push, and it runs on both sides for the same reason `parseIpc` does.
 *
 * Main validates before sending, so it cannot put a shape on the wire that the preload is
 * going to refuse; the preload validates on arrival, because a renderer may not trust
 * another process however typed it looked at compile time. The roles are the mirror of the
 * request direction, which is why they are one function and not two.
 */
export function parseIpcEvent<Name extends IpcEventName>(
  name: Name,
  value: unknown,
): IpcEventPayload<Name> {
  const parsed = IPC_EVENTS[name].safeParse(value);
  if (!parsed.success) throw new IpcContractError(name, 'event', describe(parsed.error));
  return parsed.data as IpcEventPayload<Name>;
}
