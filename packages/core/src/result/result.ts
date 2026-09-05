import { type Diagnostic, hasErrors } from '../diagnostics/diagnostic.js';

/**
 * The pipeline's return type.
 *
 * Every stage is `(input) => Result<T, Diagnostics>`; nothing throws for an error a brief
 * author can cause. Success carries `warnings` because a compile can succeed and still
 * have something to say — `W_TEXT_OVERFLOW` produces output *and* a warning — and a
 * warning has to survive to `result.json` (ADR 0013).
 */
export type Diagnostics = readonly Diagnostic[];

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
  readonly warnings: Diagnostics;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E = Diagnostics> = Ok<T> | Err<E>;

export function ok<T>(value: T, warnings: Diagnostics = []): Ok<T> {
  return { ok: true, value, warnings };
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

/** Transforms the value and keeps the warnings; a failure passes through untouched. */
export function map<T, U, E>(result: Result<T, E>, transform: (value: T) => U): Result<U, E> {
  return result.ok ? ok(transform(result.value), result.warnings) : result;
}

export function mapError<T, E, F>(result: Result<T, E>, transform: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(transform(result.error));
}

/**
 * Chains a stage onto another. Warnings from both accumulate: dropping the earlier ones
 * would silently lose everything the pipeline noticed before the last step.
 */
export function andThen<T, U>(
  result: Result<T, Diagnostics>,
  next: (value: T) => Result<U, Diagnostics>,
): Result<U, Diagnostics> {
  if (!result.ok) return result;
  const produced = next(result.value);
  return produced.ok ? ok(produced.value, [...result.warnings, ...produced.warnings]) : produced;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function unwrapOrElse<T, E>(result: Result<T, E>, fallback: (error: E) => T): T {
  return result.ok ? result.value : fallback(result.error);
}

export function match<T, E, R>(
  result: Result<T, E>,
  handlers: { readonly ok: (value: T, warnings: Diagnostics) => R; readonly err: (error: E) => R },
): R {
  return result.ok ? handlers.ok(result.value, result.warnings) : handlers.err(result.error);
}

export function withWarnings<T>(result: Result<T, Diagnostics>, extra: Diagnostics): Result<T> {
  return result.ok ? ok(result.value, [...result.warnings, ...extra]) : result;
}

/**
 * Collects a batch, accumulating rather than short-circuiting.
 *
 * A brief author wants every problem in one pass, not the first one repeatedly, so a
 * failure does not stop the remaining results from being inspected.
 */
export function all<T>(results: readonly Result<T, Diagnostics>[]): Result<T[], Diagnostics> {
  const values: T[] = [];
  const warnings: Diagnostic[] = [];
  const errors: Diagnostic[] = [];

  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
      warnings.push(...result.warnings);
    } else {
      errors.push(...result.error);
    }
  }

  return errors.length > 0 ? err(errors) : ok(values, warnings);
}

/**
 * Turns a diagnostic list into a Result: errors fail, warnings ride along with the value.
 * This is how a stage that gathers diagnostics as it goes ends up returning one.
 */
export function fromDiagnostics<T>(value: T, items: Diagnostics): Result<T, Diagnostics> {
  return hasErrors(items) ? err(items) : ok(value, items);
}
