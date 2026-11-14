import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import {
  type RecipeReferenceSource,
  completeRecipeReference,
  completeRecipeVerb,
} from './recipe-completion.js';
import { recipeLanguage } from './recipe-language.js';

/** The verbs a host would hand over: built-in ones and a plugin's namespaced ones. */
const VERBS = ['where', 'select', 'show', 'jira.pull', 'jira.push'];

/** The cursor is written into the document as its last `|`; any `|` before it is text. */
const complete = (marked: string, explicit = false): CompletionResult | null => {
  const pos = marked.lastIndexOf('|');
  if (pos === -1) throw new Error('the fixture has no | marking the cursor');
  const doc = marked.slice(0, pos) + marked.slice(pos + 1);
  const state = EditorState.create({ doc, extensions: [recipeLanguage] });
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

  it('offers them right after a | that chains steps, typed or not (TYTO-712)', () => {
    const empty = complete('recipe open-ads\nwhere status = done | |');
    expect(labels(empty)).toEqual(VERBS);
    expect(empty?.from).toBe('recipe open-ads\nwhere status = done | '.length);

    const typed = complete('recipe open-ads\nwhere status = done | select key | jira.p|');
    expect(labels(typed)).toEqual(VERBS);
    expect(typed?.from).toBe('recipe open-ads\nwhere status = done | select key | '.length);
  });

  it('offers nothing after a | that chains nothing', () => {
    expect(complete('recipe open-ads\nwhere title matches "copy | |', true)).toBeNull();
    expect(complete('recipe open-ads\ncompose tag={team | |', true)).toBeNull();
    expect(complete('recipe open-ads\nwhere a = 1 |so|', true)).toBeNull();
    expect(complete('recipe open-ads\n  | Pull | wh|', true)).toBeNull();
    expect(complete('recipe open-ads\nwhere a = 1 | sort du|', true)).toBeNull();
  });
});

describe('vocabulary reference completion (TYTO-402)', () => {
  /** Every file the host was asked about. */
  const asked: (string | undefined)[] = [];
  const names: RecipeReferenceSource = (file) => {
    asked.push(file);
    return Promise.resolve(
      file === undefined
        ? { files: ['company.vocab.json'], pointers: [] }
        : { files: [], pointers: ['/rules/kinds', '/lookups/status'] },
    );
  };

  const reference = (marked: string): Promise<CompletionResult | null> => {
    const pos = marked.indexOf('|');
    const state = EditorState.create({
      doc: marked.replace('|', ''),
      extensions: [recipeLanguage],
    });
    return completeRecipeReference(new CompletionContext(state, pos, false), names);
  };

  it('offers the vocabulary files after @./, each leaving the caret after #/', async () => {
    const result = await reference('recipe r\nrules into=kind using=@./co|');

    expect(labels(result)).toEqual(['company.vocab.json']);
    expect(result?.options[0]?.apply).toBe('company.vocab.json#/');
    expect(result?.from).toBe('recipe r\nrules into=kind using=@./'.length);
    expect(asked.at(-1)).toBeUndefined();
  });

  it("offers the named file's pointers after #", async () => {
    const result = await reference('recipe r\nrules into=kind using=@./company.vocab.json#/ru|');

    expect(labels(result)).toEqual(['/rules/kinds', '/lookups/status']);
    expect(result?.from).toBe('recipe r\nrules into=kind using=@./company.vocab.json#'.length);
    expect(asked.at(-1)).toBe('company.vocab.json');
  });

  it('offers nothing outside a reference, and asks nothing', async () => {
    const before = asked.length;

    expect(await reference('recipe r\nwhere title = @|')).toBeNull();
    expect(await reference('recipe r\nwhere title = x|')).toBeNull();
    expect(asked).toHaveLength(before);
  });
});
