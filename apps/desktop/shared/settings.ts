import { z } from 'zod';

/**
 * What the app remembers about how this person works, as opposed to where they put a
 * splitter (TYTO-122).
 *
 * `shared/` and not `src/main/`, for `shared/layout.ts`'s reason: main validates what it
 * reads off a disk and the window is told what the answer was, so the shape has to be one
 * declaration both halves import. Linted pure — no Node, no DOM.
 *
 * One field today, and the file exists rather than the field being a loose string in
 * `settings.json` because the next preference has somewhere to go that is already
 * validated, already defaulted and already tested.
 */

export const settingsSchema = z.object({
  /**
   * A folder of templates searched **before** the built-in pack.
   *
   * The same door the CLI already has — `templates/<name>/` beside the brief, ADR 0020 —
   * given to the window. `null` is "only the built-in pack", which is where every install
   * starts and where clearing the setting goes back to.
   *
   * An absolute path, and main never hands it to anything but `loadTemplateRegistry`. It is
   * not a second way for the renderer to reach a disk: the window is *told* the path so it
   * can show it in the footer, and the only thing it can do with it is display it.
   */
  templatesFolder: z.string().min(1).nullable(),
  /**
   * The local queue's folder (TYTO-45): the parent of `inbox/`, `outbox/` and `done/`, the
   * same folder `tyto watch <folder>` is given. `null` until a person picks one.
   *
   * Defaulted in the schema, as is the one below, so a `settings.json` written before the
   * queue existed still parses — without it, the missing key would fail the whole object and
   * `settingsFrom` would throw the templates folder away with it.
   */
  queueFolder: z.string().min(1).nullable().default(null),
  /**
   * Whether a task dropped into the inbox is rendered without being asked. Off until a person
   * turns it on, so opening the app never renders a folder by surprise.
   */
  queueAutoRun: z.boolean().default(false),
  /**
   * The file types each queue folder produces (TYTO-188, ADR 0061), keyed by the folder's
   * absolute path. A folder with no entry produces PNG alone, which is what the queue did
   * before a person could choose (ADR 0044).
   *
   * Per folder, because a folder is a contract with whoever drops tasks into it: pointing the
   * window at another queue must not change what the first one hands back.
   *
   * `.catch` as well as `.default`: a hand-broken value here costs this field, not the whole
   * record. Without it the object fails, and `settingsFrom` throws the templates folder and the
   * queue folder away with it.
   */
  queueKinds: z
    .record(z.string().min(1), z.array(z.string().min(1)).min(1).readonly())
    .default({})
    .catch({}),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  templatesFolder: null,
  queueFolder: null,
  queueAutoRun: false,
  queueKinds: {},
};

/** What a queue folder produces until a person chooses otherwise (ADR 0044). */
export const DEFAULT_QUEUE_KINDS: readonly string[] = ['png'];

/**
 * Whatever was on disk, as settings this build understands.
 *
 * **Reading never fails**, which is `layoutFrom`'s rule and is here for its reason: a file
 * somebody hand-edited into nonsense must not be the thing that stops a window opening. A
 * field this build does not have is dropped by the schema; a field it has and the file does
 * not falls back to the default.
 */
export function settingsFrom(value: unknown): Settings {
  const parsed = settingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}
