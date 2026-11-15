import type { IpcResponse } from '../../shared/ipc.js';
import type { CompletableTemplate } from './command-completion.js';

/**
 * The templates the command panel completes `--template` and `--formats` with (TYTO-729): what
 * `commands:templates` answers for the session's working folder, which is `tyto template list`
 * run there, so a name offered is one a render there accepts.
 *
 * **Kept, and never asked per keystroke**: one answer per working folder and trust, asked on the
 * first completion that needs it. `cd` names another folder and so another entry; a change of
 * trust is another entry too, so a folder trusted while its answer was kept never offers the
 * restricted list again. {@link PanelTemplates.forget} drops them all, for whatever else changes
 * what a folder reaches: templates or plugins changed, files written, a panel run finished.
 */

export type PanelTemplatesAnswer = IpcResponse<'commands:templates'>;

export interface PanelTemplatesPorts {
  /** `commands:templates`, with the working folder's id; absent for the open folder itself. */
  readonly ask: (folder: string | undefined) => Promise<PanelTemplatesAnswer>;
  /**
   * The id main minted for the folder the steps reach (`folderId`): `null` for the open folder,
   * `undefined` when the steps reach no folder any more.
   */
  readonly folderOf: (steps: readonly string[]) => Promise<string | null | undefined>;
  /** The open folder's trust as the window last read it, part of what an answer is kept by. */
  readonly trust: () => string;
  readonly caseless: boolean;
}

export interface PanelTemplates {
  /** The templates a render in the working folder `steps` can use; `[]` when none can be told. */
  of(steps: readonly string[]): Promise<readonly CompletableTemplate[]>;
  /** Every kept answer dropped: the next completion asks again. */
  forget(): void;
}

export function createPanelTemplates(ports: PanelTemplatesPorts): PanelTemplates {
  const kept = new Map<string, Promise<readonly CompletableTemplate[]>>();

  const keyOf = (steps: readonly string[]): string => {
    const path = steps.join('/');
    return `${ports.trust()}\u0000${ports.caseless ? path.toLowerCase() : path}`;
  };

  const fetch = async (steps: readonly string[]): Promise<readonly CompletableTemplate[]> => {
    const folder = steps.length === 0 ? null : await ports.folderOf(steps);
    if (folder === undefined) return [];
    const answer = await ports.ask(folder ?? undefined);
    return answer.templates.map((row) => ({
      name: row.name,
      formats: row.formats,
      ...(row.aliasOf === undefined ? {} : { aliasOf: row.aliasOf }),
    }));
  };

  return {
    of(steps) {
      const key = keyOf(steps);
      const found = kept.get(key);
      if (found !== undefined) return found;
      const answer = fetch(steps).catch(() => {
        // A failed ask is not an answer: the next completion asks again.
        if (kept.get(key) === answer) kept.delete(key);
        return [] as readonly CompletableTemplate[];
      });
      kept.set(key, answer);
      return answer;
    },
    forget() {
      kept.clear();
    },
  };
}
