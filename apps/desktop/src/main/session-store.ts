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
 * hand edit or a write cut short: both open the window empty, as it opened before this card.
 * A window that would not open because of a remembered tab is worse than forgetting the tab.
 *
 * **Writing swallows the error, and says whether it wrote.** A disk that will not take the
 * record must not cost the keystroke that triggered it; but the quit asks the person instead
 * of keeping drafts it could not keep, so the answer is a boolean and not nothing.
 */

const storedDraft = z.object({ text: z.string(), savedHash: z.string() });

const storedTab = z.object({
  kind: z.enum(['brief', 'settings', 'keybindings']),
  /** A brief's file. Absent for a brief that is in no file, and for the app's own two. */
  path: z.string().min(1).optional(),
  /**
   * Text the tab held that is in no file: its words, and a hash of the saved text they
   * differ from. The hash, not the text, because all it has to answer is "is the file still
   * what this draft was written against".
   */
  draft: storedDraft.optional(),
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
});

export type StoredTab = z.infer<typeof storedTab>;
export type StoredTemplate = z.infer<typeof storedTemplate>;
export type StoredSession = z.infer<typeof storedSession>;

export const EMPTY_SESSION: StoredSession = { version: 1, tabs: [], active: 0 };

export interface SessionStore {
  read(): Promise<StoredSession>;
  write(session: StoredSession): Promise<boolean>;
}

export function fileSessionStore(file: string): SessionStore {
  return {
    read: async () => {
      try {
        const parsed = storedSession.safeParse(JSON.parse(await readFile(file, 'utf8')));
        return parsed.success ? parsed.data : EMPTY_SESSION;
      } catch {
        return EMPTY_SESSION;
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
