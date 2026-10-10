import type { ConfigurationContribution } from '@tyto/plugin-api';
import { z } from 'zod';

/**
 * What the app remembers about how this person works, as opposed to where they put a
 * splitter (TYTO-122).
 *
 * `shared/` and not `src/main/`, for `shared/layout.ts`'s reason: main validates what it
 * reads off a disk and the window is told what the answer was, so the shape has to be one
 * declaration both halves import. Linted pure — no Node, no DOM.
 *
 * **Four settings the built-in `desktop` plugin declares** through the `configuration`
 * extension point (TYTO-206, ADR 0073), like any plugin's: built-in is a plugin. Their keys
 * stay unprefixed, exactly as every `settings.json` written before that card spells them.
 * Each one is validated alone, so a hand-broken value costs that key and nothing else.
 */

const templatesFolder = {
  id: 'templatesFolder',
  /**
   * A folder of templates searched **before** the built-in pack.
   *
   * The same door the CLI already has — `templates/<name>/` beside the brief, ADR 0020 —
   * given to the window. `null` is "only the built-in pack", which is where every install
   * starts and where clearing the setting goes back to. `min(1)`: an empty path would reach
   * `loadTemplateRegistry` as a root and be reported as unreadable on every launch.
   *
   * An absolute path, and main never hands it to anything but `loadTemplateRegistry`. It is
   * not a second way for the renderer to reach a disk: the window is *told* the path so it
   * can show it in the footer, and the only thing it can do with it is display it.
   */
  schema: z.string().min(1).nullable(),
  default: null,
  description: 'A folder of templates searched before the built-in pack, or null for none.',
} satisfies ConfigurationContribution<string | null>;

const queueFolder = {
  id: 'queueFolder',
  /**
   * The local queue's folder (TYTO-45): the parent of `inbox/`, `outbox/` and `done/`, the
   * same folder `tyto watch <folder>` is given. `null` until a person picks one.
   */
  schema: z.string().min(1).nullable(),
  default: null,
  description: 'The local queue folder (the parent of inbox, outbox and done), or null.',
} satisfies ConfigurationContribution<string | null>;

const queueAutoRun = {
  id: 'queueAutoRun',
  /**
   * Whether a task dropped into the inbox is rendered without being asked. Off until a person
   * turns it on, so opening the app never renders a folder by surprise.
   */
  schema: z.boolean(),
  default: false,
  description: 'Render a task dropped into the queue inbox without being asked.',
} satisfies ConfigurationContribution<boolean>;

const queueKinds = {
  id: 'queueKinds',
  /**
   * The file types each queue folder produces (TYTO-188, ADR 0061), keyed by the folder's
   * absolute path. A folder with no entry produces PNG alone, which is what the queue did
   * before a person could choose (ADR 0044).
   *
   * Per folder, because a folder is a contract with whoever drops tasks into it: pointing the
   * window at another queue must not change what the first one hands back.
   */
  schema: z.record(z.string().min(1), z.array(z.string().min(1)).min(1).readonly()),
  default: {},
  description: 'The file types each queue folder produces, by folder path.',
} satisfies ConfigurationContribution<Readonly<Record<string, readonly string[]>>>;

/** The four, in the order the settings file is documented in. */
export const SETTING_CONTRIBUTIONS = [
  templatesFolder,
  queueFolder,
  queueAutoRun,
  queueKinds,
] as const;

export interface Settings {
  readonly templatesFolder: string | null;
  readonly queueFolder: string | null;
  readonly queueAutoRun: boolean;
  readonly queueKinds: Readonly<Record<string, readonly string[]>>;
}

export const DEFAULT_SETTINGS: Settings = {
  templatesFolder: templatesFolder.default,
  queueFolder: queueFolder.default,
  queueAutoRun: queueAutoRun.default,
  queueKinds: queueKinds.default,
};

/** What a queue folder produces until a person chooses otherwise (ADR 0044). */
export const DEFAULT_QUEUE_KINDS: readonly string[] = ['png'];

/**
 * The four out of the resolved values, which already hold every declared key with a value
 * its schema accepted or its default (`resolveSettings`).
 */
export function settingsFrom(values: Readonly<Record<string, unknown>>): Settings {
  const pick = <Key extends keyof Settings>(key: Key): Settings[Key] =>
    (key in values ? values[key] : DEFAULT_SETTINGS[key]) as Settings[Key];
  return {
    templatesFolder: pick('templatesFolder'),
    queueFolder: pick('queueFolder'),
    queueAutoRun: pick('queueAutoRun'),
    queueKinds: pick('queueKinds'),
  };
}
