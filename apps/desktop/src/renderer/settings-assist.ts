import type {
  JsonAssistSource,
  JsonCompletionAnswer,
  JsonHoverAnswer,
  JsonSuggestion,
} from '@tyto/editor';
import {
  type Node,
  findNodeAtLocation,
  findNodeAtOffset,
  getLocation,
  parseTree,
} from 'jsonc-parser';

import type { SettingOption, SettingOutline } from '@tyto/plugin-api';

import { nextNonBlank, stringAt, wordBefore, writtenKeys } from './json-location.js';

/**
 * What the `settings.json` tab suggests and explains (TYTO-304, ADR 0092): the path at the
 * cursor read with `jsonc-parser`, answered from the outline main sends on `settings:outline`.
 *
 * Pure: a text and a position in, plain data out, so every case is a unit test and `@tyto/editor`
 * stays ignorant of what a setting is. Five places get suggestions — a key not yet written, a
 * setting's value, a list entry not yet in the list, an object member not yet in the object, and
 * none elsewhere — and a key or a member name gets hover help.
 */

/** One setting as `settings:outline` describes it; the plugin API's `SettingOutline`. */
export type { SettingOutline };

/** The hover's labels, in the window's language; the descriptions stay English (one source). */
export interface SettingsAssistLabels {
  readonly type: string;
  readonly default: string;
  readonly accepted: string;
}

/**
 * The description up to its first full stop followed by a space, or all of it when it has none
 * — a sentence that only ends at the end of the text is the whole text.
 */
export function firstSentence(description: string): string {
  const stop = /[.!?](?=\s)/u.exec(description);
  return stop === null ? description : description.slice(0, stop.index + 1);
}

/** A JSON value's text as the file writes it. */
const jsonText = (value: SettingOption['value']): string => JSON.stringify(value);

/** The values already in the list at `path`. */
function writtenEntries(tree: Node | undefined, key: string): Set<unknown> {
  const node = tree === undefined ? undefined : findNodeAtLocation(tree, [key]);
  return new Set(node?.type === 'array' ? (node.children ?? []).map((entry) => entry.value) : []);
}

/** A key's or a member's suggestion: the name, and its value unless a colon already follows. */
function keySuggestion(
  name: string,
  value: string,
  text: string,
  position: number,
  info: string,
  detail?: string,
): JsonSuggestion {
  const after = nextNonBlank(text, position);
  if (after === ':') {
    return { label: name, info, insert: JSON.stringify(name), kind: 'property' };
  }
  const head = `${JSON.stringify(name)}: `;
  // The next key on a later line needs a comma between them; the closing brace does not.
  const comma = after === '"' ? ',' : '';
  return {
    label: name,
    info,
    ...(detail === undefined ? {} : { detail }),
    insert: `${head}${value}${comma}`,
    select: [head.length, head.length + value.length],
    kind: 'property',
  };
}

/** Beside a key in the list: its default when that is short, else its type in words. */
const DETAIL_LENGTH = 24;
const shortDetail = (setting: SettingOutline): string =>
  setting.default.length <= DETAIL_LENGTH ? setting.default : setting.type;

const valueSuggestion = (option: SettingOption): JsonSuggestion => ({
  label: String(option.value),
  ...(option.description === '' ? {} : { info: option.description }),
  insert: jsonText(option.value),
  kind: 'value',
});

export function settingsAssist(
  outline: () => readonly SettingOutline[],
  labels: () => SettingsAssistLabels,
): JsonAssistSource {
  const settingOf = (key: string | number | undefined): SettingOutline | undefined =>
    outline().find((setting) => setting.key === key);

  return {
    complete(text, position, explicit): JsonCompletionAnswer | null {
      const location = getLocation(text, position);
      const inString = stringAt(location.previousNode, position);
      const from = inString?.from ?? wordBefore(text, position);
      // Opened by typing, a list appears inside a string or after a letter, never on a comma.
      if (inString === undefined && from === position && !explicit) return null;
      const answer = (options: readonly JsonSuggestion[]): JsonCompletionAnswer => ({
        from,
        quoted: inString !== undefined,
        options,
      });
      const path = location.path;
      const tree = parseTree(text);

      if (path.length === 1 && location.isAtPropertyKey) {
        const written = writtenKeys(tree, []);
        const typed = typeof path[0] === 'string' ? path[0] : '';
        return answer(
          outline()
            .filter((setting) => setting.key === typed || !written.has(setting.key))
            .map((setting) =>
              keySuggestion(
                setting.key,
                setting.default,
                text,
                position,
                setting.description,
                shortDetail(setting),
              ),
            ),
        );
      }

      const setting = settingOf(path[0]);
      if (setting === undefined) return null;

      if (path.length === 1) {
        const options = setting.options.filter(
          (option) => inString === undefined || typeof option.value === 'string',
        );
        return answer(options.map(valueSuggestion));
      }

      if (path.length === 2 && typeof path[1] === 'number' && setting.entries !== undefined) {
        const written = writtenEntries(tree, setting.key);
        const current = location.previousNode?.value as unknown;
        return answer(
          setting.entries.options
            .filter((option) => option.value === current || !written.has(option.value))
            .filter((option) => inString === undefined || typeof option.value === 'string')
            .map(valueSuggestion),
        );
      }

      if (
        path.length === 2 &&
        typeof path[1] === 'string' &&
        location.isAtPropertyKey &&
        setting.members !== undefined
      ) {
        const written = writtenKeys(tree, [setting.key]);
        return answer(
          setting.members.options
            .filter((option) => option.value === path[1] || !written.has(String(option.value)))
            .map((option) => {
              const suggestion = keySuggestion(
                String(option.value),
                '""',
                text,
                position,
                option.description,
              );
              // The caret between the empty colour's quotes, ready for the colour itself.
              const inside = (suggestion.select?.[0] ?? -1) + 1;
              return inside === 0 ? suggestion : { ...suggestion, select: [inside, inside] };
            }),
        );
      }
      return null;
    },

    hover(text, position): JsonHoverAnswer | null {
      const tree = parseTree(text);
      if (tree === undefined) return null;
      const node = findNodeAtOffset(tree, position);
      const property = node?.parent;
      if (node?.type !== 'string' || property?.type !== 'property') return null;
      if (property.children?.[0] !== node) return null;
      const span = { from: node.offset, to: node.offset + node.length };
      const owner = property.parent?.parent;

      // A top-level key: the setting it names.
      if (owner === undefined) {
        const setting = settingOf(node.value as string);
        if (setting === undefined) return null;
        const words = labels();
        const parts = [...(setting.entries?.options ?? []), ...(setting.members?.options ?? [])];
        // A list or an object whose entries are each described: those sentences once, one per
        // line, under the description's first sentence. The setting's description lists them in
        // prose too — it also writes the messages — and the two together ran to thirty lines.
        if (parts.length > 0) {
          return {
            ...span,
            title: setting.key,
            text: firstSentence(setting.description),
            facts: [
              { label: words.type, value: setting.type },
              { label: words.default, value: setting.default },
            ],
            items: parts.map((option) => ({
              name: String(option.value),
              description: option.description,
            })),
          };
        }
        const accepted = [
          ...setting.options,
          ...(setting.entries?.options ?? []),
          ...(setting.members?.options ?? []),
        ].map((option) => jsonText(option.value));
        return {
          ...span,
          title: setting.key,
          text: setting.description,
          facts: [
            { label: words.type, value: setting.type },
            { label: words.default, value: setting.default },
            ...(accepted.length === 0
              ? []
              : [{ label: words.accepted, value: accepted.join(', ') }]),
          ],
        };
      }

      // A member of a top-level object: what that member name paints.
      const parentKey = owner.type === 'property' ? owner.children?.[0]?.value : undefined;
      if (owner.parent?.parent !== undefined) return null;
      const option = settingOf(parentKey as string)?.members?.options.find(
        (each) => each.value === node.value,
      );
      if (option === undefined) return null;
      return {
        ...span,
        title: `${String(parentKey)}.${String(option.value)}`,
        text: option.description,
        facts: [],
      };
    },
  };
}
