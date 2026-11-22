/**
 * What a layout piece declares about the numbers it uses (ADR 0224, decision 2).
 *
 * A piece never hides a spacing, a size, a floor or a weight in its body: each is a named,
 * typed parameter with a default, listed in a schema the piece exports beside its function. A
 * schema is a plain object, so a tool — a test today, a node editor's control panel later — can
 * read what a piece accepts without running it. The defaults are what the reference art
 * measured; a template overrides them by passing values, never by editing the piece.
 */

/** The room a piece is offered (ADR 0224, decision 1). */
export interface Area {
  readonly width: number;
  /** `Infinity` when the piece is only asked to measure, with no limit below it. */
  readonly height: number;
}

/** A length in the frame's pixels. */
export interface LengthParameter {
  readonly kind: 'length';
  readonly default: number;
  readonly min?: number;
  readonly max?: number;
  readonly description: string;
}

/** A multiplier: 1 leaves a size as it is. */
export interface RatioParameter {
  readonly kind: 'ratio';
  readonly default: number;
  readonly min?: number;
  readonly max?: number;
  readonly description: string;
}

/** One of a closed list of words. */
export interface ChoiceParameter<Choice extends string = string> {
  readonly kind: 'choice';
  readonly default: Choice;
  readonly choices: readonly Choice[];
  readonly description: string;
}

export type Parameter = LengthParameter | RatioParameter | ChoiceParameter;

/** A piece's parameters by name. */
export type ParameterSchema = Readonly<Record<string, Parameter>>;

/** The value a parameter takes: a number for a length or a ratio, the word for a choice. */
export type ValueOf<Declared extends Parameter> =
  Declared extends ChoiceParameter<infer Choice> ? Choice : number;

/** Every parameter of a schema with its value. */
export type ValuesOf<Schema extends ParameterSchema> = {
  readonly [Name in keyof Schema]: ValueOf<Schema[Name]>;
};

/**
 * The schema's defaults with the caller's values over them. A number outside a parameter's
 * declared limits is brought back inside them, and a word outside a choice's list falls back to
 * its default: a piece only ever runs with values its schema allows.
 */
export function parameterValues<Schema extends ParameterSchema>(
  schema: Schema,
  given: Partial<ValuesOf<Schema>> = {},
): ValuesOf<Schema> {
  const values: Record<string, number | string> = {};
  for (const [name, declared] of Object.entries(schema)) {
    const value = (given as Readonly<Record<string, number | string | undefined>>)[name];
    values[name] = valueWithin(declared, value);
  }
  return values as ValuesOf<Schema>;
}

function valueWithin(declared: Parameter, value: number | string | undefined): number | string {
  if (declared.kind === 'choice') {
    return typeof value === 'string' && declared.choices.includes(value) ? value : declared.default;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) return declared.default;
  return Math.min(declared.max ?? Infinity, Math.max(declared.min ?? -Infinity, value));
}
