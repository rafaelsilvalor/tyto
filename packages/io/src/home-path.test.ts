import { describe, expect, it } from 'vitest';

import { checkHomePath, homePathProblem, longestPathUnder, pathLimitOf } from './home-path.js';

/**
 * TYTO-470: a deep TYTO_HOME is reported, not crashed on. The homes here are strings only, in
 * Windows' shape on every platform, so Linux CI checks the Windows arithmetic without a real
 * 260-character folder.
 */

const SHORT_HOME = 'C:\\Users\\someone\\.tyto';
/** 33 characters, the throwaway home the lengths were measured with. */
const MEASURED_HOME = 'C:\\projects\\tyto\\testes\\h470\\home';
/** 207 characters: deeper than any copy's folder fits under on Windows. */
const DEEP_HOME = `C:\\${'deep\\'.repeat(40)}home`;

describe('longestPathUnder', () => {
  it('is the measured copy of a template repository: the home plus 172 on Windows', () => {
    expect(MEASURED_HOME).toHaveLength(33);
    // A sync under MEASURED_HOME wrote 205 characters at most (2026-11-07).
    expect(longestPathUnder(MEASURED_HOME, 'win32')).toBe(205);
  });
});

describe('checkHomePath', () => {
  it('says nothing about a home of the usual depth', () => {
    expect(checkHomePath(SHORT_HOME, { platform: 'win32' })).toBeUndefined();
  });

  it('names the home and the length when the copies would not fit on Windows', () => {
    const problem = checkHomePath(DEEP_HOME, { platform: 'win32' });

    expect(problem?.code).toBe('E_TYTO_HOME_PATH_TOO_LONG');
    expect(problem?.severity).toBe('error');
    expect(problem?.message).toContain(DEEP_HOME);
    expect(problem?.message).toContain(`${longestPathUnder(DEEP_HOME, 'win32')} characters`);
    expect(problem?.message).toContain(`over the ${pathLimitOf('win32')} this system allows`);
  });

  it('reads the limit it is given, so a test needs no deep folder', () => {
    const length = longestPathUnder(SHORT_HOME, 'win32');

    expect(checkHomePath(SHORT_HOME, { platform: 'win32', limit: length })).toBeUndefined();
    expect(checkHomePath(SHORT_HOME, { platform: 'win32', limit: length - 1 })?.code).toBe(
      'E_TYTO_HOME_PATH_TOO_LONG',
    );
  });

  it('leaves a deep home alone on a system with long paths', () => {
    expect(checkHomePath(`/${'deep/'.repeat(30)}home`, { platform: 'linux' })).toBeUndefined();
  });
});

describe('homePathProblem', () => {
  const refused = (code: string, path: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`${code}: refused, mkdtemp '${path}'`), { code, path });

  it('turns a name too long under the home into the diagnostic', () => {
    const path = `${SHORT_HOME}\\cache\\plugin-files\\${'f'.repeat(64)}\\.fetching-XXXXXX`;
    const problem = homePathProblem(refused('ENAMETOOLONG', path), SHORT_HOME, 'win32');

    expect(problem?.code).toBe('E_TYTO_HOME_PATH_TOO_LONG');
    expect(problem?.message).toContain(`${path.length} characters`);
    expect(problem?.message).toContain('ENAMETOOLONG');
  });

  it("counts Windows' ENOENT only for a path over the limit", () => {
    const long = `${DEEP_HOME}\\cache\\plugin-files\\${'f'.repeat(64)}\\.fetching-XXXXXX`;
    const short = `${SHORT_HOME}\\cache\\plugin-files`;

    expect(homePathProblem(refused('ENOENT', long), DEEP_HOME, 'win32')?.code).toBe(
      'E_TYTO_HOME_PATH_TOO_LONG',
    );
    expect(homePathProblem(refused('ENOENT', short), SHORT_HOME, 'win32')).toBeUndefined();
  });

  it('leaves a path outside the home, and an error with no path, as they are', () => {
    expect(
      homePathProblem(refused('ENAMETOOLONG', 'D:\\elsewhere\\file'), SHORT_HOME, 'win32'),
    ).toBeUndefined();
    expect(homePathProblem(new Error('boom'), SHORT_HOME, 'win32')).toBeUndefined();
  });
});
