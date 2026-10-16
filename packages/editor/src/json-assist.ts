import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  autocompletion,
  pickedCompletion,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { type EditorView, hoverTooltip } from '@codemirror/view';

import { jsonLanguage } from './json-language.js';

/**
 * Suggestions and hover help for a JSON-with-comments tab, from a source the host hands in
 * (TYTO-304, ADR 0092).
 *
 * **The editor knows JSON's syntax and nothing of what a file means.** Which keys a
 * `settings.json` takes and what `vimModeStyle` accepts are the host's to know — the declared
 * settings live in another process — so the host answers two questions about a text and a
 * position, with plain data, and this module turns the answers into CodeMirror's completion list
 * and hover tooltip. The same door serves `keybindings.json` later with another source.
 */

/** One suggestion, as the host words it. */
export interface JsonSuggestion {
  /** What the list shows and filters on: the key or the value, without quotes. */
  readonly label: string;
  /** A short note after the label, such as a default. */
  readonly detail?: string;
  /** The longer description shown beside the list for the selected suggestion. */
  readonly info?: string;
  /** The JSON text a pick writes, quotes included where it is a string. */
  readonly insert: string;
  /**
   * What the pick leaves selected, as offsets into {@link insert}: a key completed with its
   * default selects the default, so typing replaces it. Left out, the cursor goes to the end.
   */
  readonly select?: readonly [number, number];
  readonly kind?: 'property' | 'value';
}

/** The host's answer to "what can go here". */
export interface JsonCompletionAnswer {
  /** Where the word being typed starts, which is what the list filters by. */
  readonly from: number;
  /**
   * Whether the word is inside a JSON string whose opening quote sits right before `from`: a
   * pick then replaces the whole string, both quotes included, with {@link JsonSuggestion.insert}.
   */
  readonly quoted: boolean;
  readonly options: readonly JsonSuggestion[];
}

/** The host's answer to "what is this", for the span under the pointer. */
export interface JsonHoverAnswer {
  readonly from: number;
  readonly to: number;
  readonly title: string;
  readonly text?: string;
  /** Labelled lines under the text: a type, a default, the accepted values. */
  readonly facts: readonly { readonly label: string; readonly value: string }[];
}

export interface JsonAssistSource {
  /** `explicit` is a completion asked for by key rather than opened by typing. */
  complete(text: string, position: number, explicit: boolean): JsonCompletionAnswer | null;
  hover(text: string, position: number): JsonHoverAnswer | null;
}

/** A pick: the string or word replaced, and the selection the suggestion asks for. */
function applyOf(suggestion: JsonSuggestion, quoted: boolean) {
  return (view: EditorView, completion: Completion, from: number, to: number): void => {
    const doc = view.state.doc;
    const start = quoted && from > 0 && doc.sliceString(from - 1, from) === '"' ? from - 1 : from;
    const end = quoted && doc.sliceString(to, to + 1) === '"' ? to + 1 : to;
    const [selectFrom, selectTo] = suggestion.select ?? [
      suggestion.insert.length,
      suggestion.insert.length,
    ];
    view.dispatch({
      changes: { from: start, to: end, insert: suggestion.insert },
      selection: { anchor: start + selectFrom, head: start + selectTo },
      annotations: pickedCompletion.of(completion),
      userEvent: 'input.complete',
      scrollIntoView: true,
    });
  };
}

function completionsFrom(source: JsonAssistSource) {
  return (context: CompletionContext): CompletionResult | null => {
    const answer = source.complete(context.state.doc.toString(), context.pos, context.explicit);
    if (answer === null || answer.options.length === 0) return null;
    return {
      from: answer.from,
      // Typing on inside the word filters the same list; a quote, a colon or a comma asks again.
      validFor: /^[\w.-]*$/u,
      // In the host's order, which is the order a setting declares its values in — the default
      // first — rather than CodeMirror's alphabetical one when nothing is typed yet.
      options: answer.options.map((suggestion, index) => ({
        label: suggestion.label,
        boost: Math.max(-99, -index),
        ...(suggestion.detail === undefined ? {} : { detail: suggestion.detail }),
        ...(suggestion.info === undefined ? {} : { info: suggestion.info }),
        type: suggestion.kind === 'property' ? 'property' : 'enum',
        apply: applyOf(suggestion, answer.quoted),
      })),
    };
  };
}

/**
 * The tooltip's content, written as text nodes so nothing the host says is read as markup.
 * Exported for `json-assist.test.ts`; not part of the package's surface.
 */
export function hoverDom(answer: JsonHoverAnswer): HTMLElement {
  const root = document.createElement('div');
  root.className = 'cm-json-hover';
  const title = root.appendChild(document.createElement('div'));
  title.className = 'cm-json-hover-title';
  title.textContent = answer.title;
  if (answer.text !== undefined && answer.text !== '') {
    const text = root.appendChild(document.createElement('div'));
    text.className = 'cm-json-hover-text';
    text.textContent = answer.text;
  }
  for (const fact of answer.facts) {
    const line = root.appendChild(document.createElement('div'));
    line.className = 'cm-json-hover-fact';
    const label = line.appendChild(document.createElement('span'));
    label.className = 'cm-json-hover-label';
    label.textContent = `${fact.label}: `;
    line.appendChild(document.createTextNode(fact.value));
  }
  return root;
}

/**
 * Completion and hover for the JSON language from `source`. Mounted on a JSON tab's own
 * extensions (`EditorHandle.blank`'s third argument), so a brief never asks it anything.
 */
export function jsonAssist(source: JsonAssistSource): Extension {
  return [
    autocompletion(),
    jsonLanguage.data.of({ autocomplete: completionsFrom(source) }),
    hoverTooltip((view, position) => {
      const answer = source.hover(view.state.doc.toString(), position);
      if (answer === null) return null;
      return {
        pos: answer.from,
        end: answer.to,
        above: true,
        create: () => ({ dom: hoverDom(answer) }),
      };
    }),
  ];
}
