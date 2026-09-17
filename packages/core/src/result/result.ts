import { type Diagnostic, hasErrors, hasFatal } from '../diagnostics/diagnostic.js';

/**
 * The pipeline's return type.
 *
 * Every stage is `(input) => Result<T, Diagnostics>`; nothing throws for an error a brief
 * author can cause. Success carries diagnostics because a stage can produce a value and
 * still have something to say — `W_TEXT_OVERFLOW` produces output *and* a warning (ADR
 * 0013), and since ADR 0025 a stage may also hand back the part of its value that
 * survived beside the **errors** that cost it the rest.
 *
 * That second case is why the field is `diagnostics` and not `warnings`: it no longer
 * holds only warnings, and a name that said otherwise would make every reader of the ok
 * branch decide whether an error in it was a bug.
 */
export type Diagnostics = readonly Diagnostic[];

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
  /** Everything the stage had to say. Errors here are the ones its value survived. */
  readonly diagnostics: Diagnostics;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E = Diagnostics> = Ok<T> | Err<E>;

export function ok<T>(value: T, diagnostics: Diagnostics = []): Ok<T> {
  return { ok: true, value, diagnostics };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Transforms the value and keeps the diagnostics; a failure passes through untouched. */
export function map<T, U, E>(result: Result<T, E>, transform: (value: T) => U): Result<U, E> {
  return result.ok ? ok(transform(result.value), result.diagnostics) : result;
}

export function mapError<T, E, F>(result: Result<T, E>, transform: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(transform(result.error));
}

/**
 * Chains a stage onto another. Diagnostics from both accumulate: dropping the earlier ones
 * would silently lose everything the pipeline noticed before the last step.
 */
export function andThen<T, U>(
  result: Result<T, Diagnostics>,
  next: (value: T) => Result<U, Diagnostics>,
): Result<U, Diagnostics> {
  if (!result.ok) return result;
  const produced = next(result.value);
  return produced.ok
    ? ok(produced.value, [...result.diagnostics, ...produced.diagnostics])
    : produced;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function unwrapOrElse<T, E>(result: Result<T, E>, fallback: (error: E) => T): T {
  return result.ok ? result.value : fallback(result.error);
}

export function match<T, E, R>(
  result: Result<T, E>,
  handlers: {
    readonly ok: (value: T, diagnostics: Diagnostics) => R;
    readonly err: (error: E) => R;
  },
): R {
  return result.ok ? handlers.ok(result.value, result.diagnostics) : handlers.err(result.error);
}

export function withDiagnostics<T>(result: Result<T, Diagnostics>, extra: Diagnostics): Result<T> {
  return result.ok ? ok(result.value, [...result.diagnostics, ...extra]) : result;
}

/**
 * Collects a batch, accumulating rather than short-circuiting.
 *
 * A brief author wants every problem in one pass, not the first one repeatedly, so a
 * failure does not stop the remaining results from being inspected.
 */
export function all<T>(results: readonly Result<T, Diagnostics>[]): Result<T[], Diagnostics> {
  const values: T[] = [];
  const kept: Diagnostic[] = [];
  const errors: Diagnostic[] = [];

  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
      kept.push(...result.diagnostics);
    } else {
      errors.push(...result.error);
    }
  }

  return errors.length > 0 ? err(errors) : ok(values, kept);
}

/**
 * Turns a diagnostic list into a Result: errors fail, warnings ride along with the value.
 *
 * This is how a stage that gathers diagnostics as it goes ends up returning one, and it is
 * still the right answer for a stage with **no partial value to offer** — most of them. A
 * stage whose value survives some of its errors uses {@link fromPartial} instead.
 */
export function fromDiagnostics<T>(value: T, items: Diagnostics): Result<T, Diagnostics> {
  return hasErrors(items) ? err(items) : ok(value, items);
}

/**
 * The same, weighed by fatality rather than by severity (ADR 0025).
 *
 * A stage that can still hand back part of what it built calls this: only a **fatal**
 * diagnostic replaces the value, and everything else — warnings and the errors the value
 * survived — rides along on the ok branch. The caller does not re-decide anything; a
 * partition belongs to the stage, because the stage is the only side that knows what is
 * left when one directive out of twenty is unreadable.
 *
 * `hasErrors(result.diagnostics)` is still what fails a build, so a partly rendered brief
 * exits non-zero while its artifacts are written — which is the honest answer for CI.
 */
export function fromPartial<T>(value: T, items: Diagnostics): Result<T, Diagnostics> {
  return hasFatal(items) ? err(items) : ok(value, items);
}
