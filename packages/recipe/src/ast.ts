import type { SourceRange } from '@tyto/core';

/** A word or a quoted string after a verb, without its quotes. */
export interface Argument {
  readonly value: string;
  readonly range: SourceRange;
  /**
   * The value was written as one quoted string, so it may be a column name with accents or
   * blanks (`into="Última Sync"`); a verb that writes a column reads a quoted name by the
   * looser rule of `isWritableColumnName` in `columns.ts`. Absent for a bare word.
   */
  readonly quoted?: true;
}

/**
 * `name=value`, where the value may be quoted: `left="issuetype = DESIGN"`. The name may be
 * quoted too, `"Última Sync"="{now}"`, which is how `compose` names a column with blanks.
 */
export interface NamedArgument extends Argument {
  readonly name: string;
  readonly nameQuoted?: true;
}

/**
 * One step of the chain, and so one cell of the notebook: a line, or one of the steps a line
 * chains with `|` (TYTO-706).
 */
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
  /** The whole step: its line, or its segment of a chained line. */
  readonly range: SourceRange;
}

export interface RecipeParam {
  readonly name: string;
  /** Absent when the person running the recipe must supply it. */
  readonly defaultValue?: string;
  readonly range: SourceRange;
}

/** How often a scheduled recipe runs, always in whole minutes (`every 2h` is 120). */
export interface RecipeInterval {
  readonly minutes: number;
}

export interface RecipeAst {
  readonly name: string;
  readonly description: string;
  readonly params: readonly RecipeParam[];
  /**
   * `auto` when the header says `apply auto`: an explicit Run in a trusted folder applies the
   * plans without a click (ADR 0129 decision 4, ADR 0170). Absent otherwise.
   */
  readonly apply?: 'auto';
  /**
   * The interval from an `every 30m` or `every 2h` header line: the host runs the recipe that
   * often while the app is open (ADR 0175). Absent when the recipe runs only when asked.
   */
  readonly every?: RecipeInterval;
  readonly steps: readonly Step[];
}
