import type { JsonAssistSourceLater, JsonCompletionAnswer, JsonHoverAnswer } from '@tyto/editor';

import type { CatalogueKey } from '../../shared/i18n/index.js';
import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';

/**
 * What a vocabulary tab suggests and explains (TYTO-402, ADR 0176 decision 6): main reads the
 * text with `@tyto/recipe`'s own sections and answers on `vocabulary:complete` and
 * `vocabulary:hover`; this words the answers in the window's language. Pure but for the two
 * questions it is handed, so every case is a unit test.
 */

export interface VocabularyQuestions {
  readonly complete: (
    request: IpcRequest<'vocabulary:complete'>,
  ) => Promise<IpcResponse<'vocabulary:complete'>>;
  readonly hover: (
    request: IpcRequest<'vocabulary:hover'>,
  ) => Promise<IpcResponse<'vocabulary:hover'>>;
}

type Section = 'rules' | 'rewrites' | 'lookups';

/** What each section holds, in the window's language, as the list and the hover say it. */
const SECTION_TEXT: Readonly<Record<Section, CatalogueKey>> = {
  rules: 'vocabulary.section.rules',
  rewrites: 'vocabulary.section.rewrites',
  lookups: 'vocabulary.section.lookups',
};

const isSection = (label: string): label is Section => Object.hasOwn(SECTION_TEXT, label);

/**
 * The vocabulary tab's source for `jsonAssist`. `say` translates at each answer, so a language
 * switch shows in the next list; `fileName` is the tab's, for the pointer a recipe reads a table
 * by (`@./company.vocab.json#/rules/kinds`).
 */
export function vocabularyAssist(
  ask: VocabularyQuestions,
  say: (key: CatalogueKey) => string,
  fileName: () => string | undefined,
): JsonAssistSourceLater {
  return {
    async complete(text, position, explicit): Promise<JsonCompletionAnswer | null> {
      const { answer } = await ask.complete({ text, position, explicit });
      if (answer === null) return null;
      return {
        from: answer.from,
        quoted: answer.quoted,
        options: answer.options.map((option) => ({
          label: option.label,
          insert: option.insert,
          ...(option.select === undefined ? {} : { select: option.select }),
          ...(option.kind === undefined ? {} : { kind: option.kind }),
          // A top-level section says what it holds; an entry's field is its own word.
          ...(isSection(option.label) ? { info: say(SECTION_TEXT[option.label]) } : {}),
        })),
      };
    },

    async hover(text, position): Promise<JsonHoverAnswer | null> {
      const { answer } = await ask.hover({ text, position });
      if (answer === null) return null;
      const about = say(SECTION_TEXT[answer.section]);
      if (answer.name === undefined) {
        return { from: answer.from, to: answer.to, title: answer.section, text: about, facts: [] };
      }
      const file = fileName();
      const pointer = `#/${answer.section}/${encodePointer(answer.name)}`;
      return {
        from: answer.from,
        to: answer.to,
        title: answer.name,
        text: about,
        facts: [
          ...(answer.entries === undefined
            ? []
            : [{ label: say('vocabulary.hover.entries'), value: String(answer.entries) }]),
          {
            label: say('vocabulary.hover.pointer'),
            value: file === undefined ? pointer : `@./${file}${pointer}`,
          },
        ],
      };
    },
  };
}

/** A JSON Pointer token: `~` and `/` escaped, as RFC 6901 writes them. */
const encodePointer = (name: string): string => name.replaceAll('~', '~0').replaceAll('/', '~1');
