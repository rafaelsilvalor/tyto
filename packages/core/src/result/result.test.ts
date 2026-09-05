import { describe, expect, it } from 'vitest';

import {
  all,
  andThen,
  err,
  fromDiagnostics,
  isErr,
  isOk,
  map,
  mapError,
  match,
  ok,
  unwrapOr,
  unwrapOrElse,
  withWarnings,
} from './result.js';
import { diagnostic } from '../diagnostics/diagnostic.js';

const overflow = (slot: string) =>
  diagnostic('W_TEXT_OVERFLOW', { slot, overflow: 12, format: 'story' });
const unknownSlot = (slot: string) =>
  diagnostic('E_UNKNOWN_SLOT', { slot, template: 'promo-curso', declared: 'titulo' });

describe('constructors', () => {
  it('starts a success with no warnings', () => {
    const result = ok(42);

    expect(result).toEqual({ ok: true, value: 42, warnings: [] });
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
  });

  it('carries warnings on success, which is the point of ADR 0013', () => {
    expect(ok('scene', [overflow('titulo')]).warnings).toHaveLength(1);
  });

  it('carries the diagnostics on failure', () => {
    const result = err([unknownSlot('titluo')]);

    expect(isErr(result)).toBe(true);
    expect(result.error).toHaveLength(1);
  });
});

describe('map', () => {
  it('transforms the value and keeps the warnings', () => {
    const result = map(ok(2, [overflow('titulo')]), (n) => n * 3);

    expect(result).toEqual({ ok: true, value: 6, warnings: [overflow('titulo')] });
  });

  it('leaves a failure untouched', () => {
    const failure = err([unknownSlot('a')]);

    expect(map(failure, () => 'never')).toBe(failure);
  });
});

describe('mapError', () => {
  it('rewrites the error', () => {
    expect(mapError(err('boom'), (e) => `${e}!`)).toEqual({ ok: false, error: 'boom!' });
  });

  it('leaves a success untouched', () => {
    const success = ok(1);

    expect(mapError(success, () => 'never')).toBe(success);
  });
});

describe('andThen', () => {
  it('accumulates warnings from both steps, so nothing noticed earlier is lost', () => {
    const result = andThen(ok(1, [overflow('titulo')]), (n) => ok(n + 1, [overflow('subtitulo')]));

    expect(result.ok && result.value).toBe(2);
    expect(result.ok && result.warnings.map((w) => w.message)).toEqual([
      overflow('titulo').message,
      overflow('subtitulo').message,
    ]);
  });

  it('does not run the next step after a failure', () => {
    let ran = false;

    andThen(err([unknownSlot('a')]), () => {
      ran = true;
      return ok(1);
    });

    expect(ran).toBe(false);
  });

  it('propagates a failure from the second step', () => {
    const result = andThen(ok(1, [overflow('titulo')]), () => err([unknownSlot('a')]));

    expect(isErr(result)).toBe(true);
  });
});

describe('unwrapping', () => {
  it('returns the value or the fallback', () => {
    expect(unwrapOr(ok(1), 9)).toBe(1);
    expect(unwrapOr(err<string>('x'), 9)).toBe(9);
  });

  it('computes the fallback from the error', () => {
    expect(unwrapOrElse(err('boom'), (e) => e.length)).toBe(4);
  });

  it('matches on both branches, handing warnings to the success one', () => {
    const rendered = match(ok('scene', [overflow('titulo')]), {
      ok: (value, warnings) => `${value}+${warnings.length}`,
      err: () => 'failed',
    });

    expect(rendered).toBe('scene+1');
  });
});

describe('all', () => {
  it('collects values and merges warnings when everything succeeds', () => {
    const result = all([ok(1, [overflow('a')]), ok(2), ok(3, [overflow('b')])]);

    expect(result.ok && result.value).toEqual([1, 2, 3]);
    expect(result.ok && result.warnings).toHaveLength(2);
  });

  it('accumulates every failure instead of stopping at the first', () => {
    const result = all([err([unknownSlot('a')]), ok(2), err([unknownSlot('b'), unknownSlot('c')])]);

    expect(isErr(result)).toBe(true);
    expect(!result.ok && result.error).toHaveLength(3);
  });

  it('drops warnings that accompanied successes in a failed batch', () => {
    // A failed batch produces no value, so its warnings have nothing to describe.
    const result = all([ok(1, [overflow('a')]), err([unknownSlot('b')])]);

    expect(!result.ok && result.error.map((d) => d.code)).toEqual(['E_UNKNOWN_SLOT']);
  });

  it('succeeds on an empty batch', () => {
    expect(all([])).toEqual({ ok: true, value: [], warnings: [] });
  });
});

describe('fromDiagnostics', () => {
  it('succeeds with warnings when no diagnostic is an error', () => {
    const result = fromDiagnostics('scene', [overflow('titulo')]);

    expect(result.ok && result.value).toBe('scene');
    expect(result.ok && result.warnings).toHaveLength(1);
  });

  it('fails as soon as one diagnostic is an error, keeping the warnings alongside it', () => {
    const result = fromDiagnostics('scene', [overflow('titulo'), unknownSlot('a')]);

    expect(isErr(result)).toBe(true);
    expect(!result.ok && result.error).toHaveLength(2);
  });
});

describe('withWarnings', () => {
  it('appends to a success', () => {
    expect(withWarnings(ok(1, [overflow('a')]), [overflow('b')]).ok).toBe(true);
    const result = withWarnings(ok(1, [overflow('a')]), [overflow('b')]);
    expect(result.ok && result.warnings).toHaveLength(2);
  });

  it('leaves a failure untouched', () => {
    const failure = err([unknownSlot('a')]);

    expect(withWarnings(failure, [overflow('b')])).toBe(failure);
  });
});
