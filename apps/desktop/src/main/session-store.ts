import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

/**
 * The tabs the window had open, in `session.json` beside `layout.json` (TYTO-113, ADR 0080).
 *
 * `fileLayoutStore`'s pattern for the fourth time, and for its reasons: a file a person can
 * read and delete (ADR 0009), in the per-version folder (ADR 0032), read and written by main
 * alone, because main is the only side that knows paths (ADR 0010).
 *
 * **Reading never fails.** A missing file is a first run, and a file that does not parse is a
 * hand edit or a write cut short: both open the window empty, as it opened before this card —
 * though only the missing file is a first launch (TYTO-287, {@link UNREADABLE_SESSION}).
 * A window that would not open because of a remembered tab is worse than forgetting the tab.
 *
 * **Writing swallows the error, and says whether it wrote.** A disk that will not take the
 * record must not cost the keystroke that triggered it; but the quit asks the person instead
 * of keeping drafts it could not keep, so the answer is a boolean and not nothing.
 */

const storedDraft = z.object({ text: z.string(), savedHash: z.string() });

const storedPlace = z.object({
  anchor: z.number().int().min(0),
  head: z.number().int().min(0),
  top: z.number().int().min(0),
});

const storedTab = z.object({
  kind: z.enum(['brief', 'settings', 'keybindings', 'snippets']),
  /** A brief's file. Absent for a brief that is in no file, and for the app's own files. */
  path: z.string().min(1).optional(),
  /**
   * Text the tab held that is in no file: its words, and a hash of the saved text they
   * differ from. The hash, not the text, because all it has to answer is "is the file still
   * what this draft was written against".
   */
  draft: storedDraft.optional(),
  /**
   * Where the tab was looking (TYTO-265): the main selection's two ends and the position of
   * the line at the top of the pane, as document offsets. Offsets and not a line and a pixel,
   * because the window clamps them to whatever text the tab reopens with; a pixel would be an
   * answer about one window size. Optional, as `template` is and for its reason: a file
   * written before it reads as tabs that open at the top, which is what they did. One that
   * does not parse is dropped on its own: a cursor is not worth the tabs and their drafts.
   */
  place: storedPlace.optional().catch(undefined),
});

const storedTabIndex = z.number().int().min(0);

/**
 * One tab of one group: which session tab it shows, by index, and where it was looking — or a
 * preview (TYTO-287, ADR 0084). A **following** preview is `{ view: 'preview' }` and names no
 * tab: it shows whichever brief is in front when the window opens. A **locked** one names its
 * brief's tab by index, as a text tab does. Neither keeps a `place`, and no path is ever here.
 * The locked shape is tried first, since zod keeps the first branch that parses.
 */
const storedGroupTab = z.union([
  z.object({ tab: storedTabIndex, view: z.literal('preview'), locked: z.literal(true) }),
  z.object({ view: z.literal('preview') }),
  z.object({
    tab: storedTabIndex,
    /** Per occurrence: one document in two groups has a cursor in each (TYTO-286). */
    place: storedPlace.optional().catch(undefined),
  }),
]);

export interface StoredGroupLeaf {
  readonly tabs: readonly z.infer<typeof storedGroupTab>[];
  readonly active: number;
}
export interface StoredGroupSplit {
  readonly split: 'row' | 'column';
  readonly sizes: readonly number[];
  readonly children: readonly StoredGroupNode[];
}
export type StoredGroupNode = StoredGroupLeaf | StoredGroupSplit;

const storedGroupNode: z.ZodType<StoredGroupNode> = z.lazy(() =>
  z.union([
    z.object({
      split: z.enum(['row', 'column']),
      sizes: z.array(z.number().min(0)),
      children: z.array(storedGroupNode).min(1),
    }),
    // No `.min(1)`: a window with nothing to keep writes one empty group, `NO_GROUPS` below.
    z.object({ tabs: z.array(storedGroupTab), active: z.number().int().min(0) }),
  ]),
);

/**
 * The editor groups (TYTO-286, ADR 0083): the tree of splits, each leaf a group whose tabs name
 * the session's `tabs` by index, and which leaf was focused, counted in tree order.
 *
 * `tabs` stays the list of documents, one draft each, and `active` the focused group's
 * document, so a build that knows nothing of groups — zod strips the key — still restores
 * every tab with the right one in front, as one group. **A tree that does not parse is dropped
 * alone** (`.catch`): it costs the arrangement, never the drafts, and reads as one empty group.
 */
const storedGroups = z.object({
  root: storedGroupNode,
  focused: z.number().int().min(0),
});

/**
 * The template mode, when it was open on a markup folder (TYTO-266). Its folder, which buffer
 * was in front, and a draft per buffer that held unsaved text. A mode open with nothing unsaved
 * is kept too, so it reopens where it was.
 *
 * **Optional, and the version stays 1.** A file written before this field is a session with
 * no template mode, which is exactly what it was; a version bump would read every v1 file —
 * including the ones an update imports (ADR 0036) — as an empty session instead.
 */
const storedTemplate = z.object({
  directory: z.string().min(1),
  visible: z.enum(['manifest', 'markup']),
  drafts: z.object({ manifest: storedDraft.optional(), markup: storedDraft.optional() }),
});

const storedSession = z.object({
  version: z.literal(1),
  tabs: z.array(storedTab),
  active: z.number().int().min(0),
  template: storedTemplate.optional(),
  // A tree that does not parse costs the arrangement and nothing else: it reads as no group,
  // and not as a session without groups, which would be a first launch (TYTO-287).
  groups: storedGroups.optional().catch(() => ({ root: { tabs: [], active: 0 }, focused: 0 })),
});

export type StoredGroups = z.infer<typeof storedGroups>;
export type StoredTab = z.infer<typeof storedTab>;
export type StoredTemplate = z.infer<typeof storedTemplate>;
export type StoredSession = z.infer<typeof storedSession>;

export const EMPTY_SESSION: StoredSession = { version: 1, tabs: [], active: 0 };

/**
 * The groups of a window that had nothing to keep (TYTO-287): one group with no tab. Written so
 * every session from this build carries `groups`, because a session without them is how the
 * next launch knows it is a first one (ADR 0084 decision 8). A window holding only the untouched
 * tab it opened on, with its preview closed, would otherwise write no `groups` and get the
 * preview back on every launch. It reads back as no groups: the empty group is pruned.
 */
export const NO_GROUPS: StoredGroups = { root: { tabs: [], active: 0 }, focused: 0 };

/**
 * What a `session.json` that is there but cannot be read reads as: empty, as before, but **not
 * a first launch** (TYTO-287). Somebody used the app in this folder — a write cut short, a hand
 * edit, a newer version's file, a folder where the file goes — so the preview does not open as
 * if for a new person. Only a missing file is {@link EMPTY_SESSION}.
 */
export const UNREADABLE_SESSION: StoredSession = { ...EMPTY_SESSION, groups: NO_GROUPS };

const isMissing = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT';

export interface SessionStore {
  read(): Promise<StoredSession>;
  write(session: StoredSession): Promise<boolean>;
}

export function fileSessionStore(file: string): SessionStore {
  return {
    read: async () => {
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch (cause) {
        return isMissing(cause) ? EMPTY_SESSION : UNREADABLE_SESSION;
      }
      try {
        const parsed = storedSession.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : UNREADABLE_SESSION;
      } catch {
        return UNREADABLE_SESSION;
      }
    },

    write: async (session) => {
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(session, null, 2), 'utf8');
        return true;
      } catch {
        return false;
      }
    },
  };
}
