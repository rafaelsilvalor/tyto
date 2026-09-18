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
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = { templatesFolder: null };

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
