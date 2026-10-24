import type { SourceRange } from '@tyto/core';

/** A word or a quoted string after a verb, without its quotes. */
export interface Argument {
  readonly value: string;
  readonly range: SourceRange;
}

/** `name=value`, where the value may be quoted: `left="issuetype = DESIGN"`. */
export interface NamedArgument extends Argument {
  readonly name: string;
}

/** One line of the chain, and so one cell of the notebook. */
export interface Step {
  readonly verb: string;
  readonly verbRange: SourceRange;
  readonly positional: readonly Argument[];
  /** In the order written; a verb decides what a repeated name means. */
  readonly named: readonly NamedArgument[];
  /**
   * Everything after the verb, as written. `where` reads its expression from here, because
   * a filter is one expression and not a list of words.
   */
  readonly text: string;
  readonly textRange: SourceRange;
  /** The whole line. */
  readonly range: SourceRange;
}

export interface RecipeParam {
  readonly name: string;
  /** Absent when the person running the recipe must supply it. */
  readonly defaultValue?: string;
  readonly range: SourceRange;
}

export interface RecipeAst {
  readonly name: string;
  readonly description: string;
  readonly params: readonly RecipeParam[];
  readonly steps: readonly Step[];
}
