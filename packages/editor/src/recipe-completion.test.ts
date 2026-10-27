import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { completeRecipeVerb } from './recipe-completion.js';
import { recipeLanguage } from './recipe-language.js';

/** The verbs a host would hand over: built-in ones and a plugin's namespaced ones. */
const VERBS = ['where', 'select', 'show', 'jira.pull', 'jira.push'];

/** The cursor is written into the document as `|`. */
const complete = (marked: string, explicit = false): CompletionResult | null => {
  const pos = marked.indexOf('|');
  if (pos === -1) throw new Error('the fixture has no | marking the cursor');
  const state = EditorState.create({ doc: marked.replace('|', ''), extensions: [recipeLanguage] });
  return completeRecipeVerb(new CompletionContext(state, pos, explicit), () => VERBS);
};

const labels = (result: CompletionResult | null): string[] | null =>
  result === null ? null : result.options.map((option) => option.label);

describe('recipe verb completion', () => {
  it('offers the host verbs, namespaced ones included, at the start of a line', () => {
    const result = complete('recipe open-ads\nwh|');

    expect(labels(result)).toEqual(VERBS);
    expect(result?.from).toBe('recipe open-ads\n'.length);
  });

  it('replaces a namespaced verb as one word', () => {
    const result = complete('recipe open-ads\n  jira.p|');

    expect(labels(result)).toEqual(VERBS);
    expect(result?.from).toBe('recipe open-ads\n  '.length);
  });

  it('offers them on an empty line only when asked', () => {
    expect(complete('recipe open-ads\n|')).toBeNull();
    expect(labels(complete('recipe open-ads\n|', true))).toEqual(VERBS);
  });

  it('offers nothing inside the arguments', () => {
    expect(complete('recipe open-ads\nwhere sta|')).toBeNull();
    expect(complete('recipe open-ads\njoin copy left=te|', true)).toBeNull();
  });

  it('offers nothing on a comment or a description line', () => {
    expect(complete('# wh|')).toBeNull();
    expect(complete('recipe open-ads\n  | wh|')).toBeNull();
  });
});
