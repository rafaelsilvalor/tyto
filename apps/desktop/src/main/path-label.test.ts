import { describe, expect, it } from 'vitest';

import { pathLabelOf } from './path-label.js';

/**
 * Where a file is, as a tab's tooltip shows it (TYTO-288, ADR 0086), on both separators
 * whatever machine runs the suite.
 */

describe('the path a tab shows on hover', () => {
  it('shortens the home directory to ~ on Windows', () => {
    expect(
      pathLabelOf(
        'C:\\Users\\rafael\\Documents\\campanhas\\promo.brief',
        'C:\\Users\\rafael',
        undefined,
        'win32',
      ),
    ).toBe('~\\Documents\\campanhas\\promo.brief');
  });

  it('shortens the home directory to ~ on Linux and macOS', () => {
    expect(pathLabelOf('/home/rafael/briefs/promo.brief', '/home/rafael', undefined, 'linux')).toBe(
      '~/briefs/promo.brief',
    );
    expect(
      pathLabelOf('/Users/rafael/briefs/promo.brief', '/Users/rafael/', undefined, 'darwin'),
    ).toBe('~/briefs/promo.brief');
  });

  it('writes a file directly in the home directory as ~ and its name', () => {
    expect(pathLabelOf('/home/rafael/promo.brief', '/home/rafael', undefined, 'linux')).toBe(
      '~/promo.brief',
    );
    expect(
      pathLabelOf('C:\\Users\\rafael\\promo.brief', 'C:\\Users\\rafael\\', undefined, 'win32'),
    ).toBe('~\\promo.brief');
  });

  it('ignores case on Windows and keeps the spelling the path had', () => {
    expect(
      pathLabelOf(
        'c:\\users\\RAFAEL\\Desktop\\promo.brief',
        'C:\\Users\\rafael',
        undefined,
        'win32',
      ),
    ).toBe('~\\Desktop\\promo.brief');
  });

  it('does not ignore case elsewhere', () => {
    expect(pathLabelOf('/home/RAFAEL/briefs/promo.brief', '/home/rafael', undefined, 'linux')).toBe(
      '/home/RAFAEL/briefs/promo.brief',
    );
  });

  it('leaves a path outside the home directory whole', () => {
    expect(
      pathLabelOf('D:\\Projects\\tyto\\promo.brief', 'C:\\Users\\rafael', undefined, 'win32'),
    ).toBe('D:\\Projects\\tyto\\promo.brief');
    expect(pathLabelOf('/tmp/tyto-e2e/promo.brief', '/home/rafael', undefined, 'linux')).toBe(
      '/tmp/tyto-e2e/promo.brief',
    );
  });

  it('does not take a sibling whose name starts with the home name for the home', () => {
    expect(pathLabelOf('/home/rafael2/promo.brief', '/home/rafael', undefined, 'linux')).toBe(
      '/home/rafael2/promo.brief',
    );
    expect(
      pathLabelOf('C:\\Users\\rafaela\\promo.brief', 'C:\\Users\\rafael', undefined, 'win32'),
    ).toBe('C:\\Users\\rafaela\\promo.brief');
  });

  it('does not treat a root as a home, which would put ~ in front of every path', () => {
    expect(pathLabelOf('/srv/briefs/promo.brief', '/', undefined, 'linux')).toBe(
      '/srv/briefs/promo.brief',
    );
    expect(pathLabelOf('C:\\briefs\\promo.brief', 'C:\\', undefined, 'win32')).toBe(
      'C:\\briefs\\promo.brief',
    );
    expect(pathLabelOf('/srv/briefs/promo.brief', '', undefined, 'linux')).toBe(
      '/srv/briefs/promo.brief',
    );
  });
});

/** Inside the open workspace folder the label is relative to it (TYTO-274, ADR 0125). */
describe('the path a tab shows on hover inside the open folder', () => {
  const HOME_WINDOWS = 'C:\\Users\\rafael';
  const ROOT_WINDOWS = 'D:\\trabalho\\promo';
  const HOME_POSIX = '/home/rafael';
  const ROOT_POSIX = '/home/rafael/trabalho/promo';

  it("starts with the folder's own name on Windows", () => {
    expect(
      pathLabelOf('D:\\trabalho\\promo\\briefs\\capa.brief', HOME_WINDOWS, ROOT_WINDOWS, 'win32'),
    ).toBe('promo\\briefs\\capa.brief');
    // A forward slash is a separator on Windows too, and the path keeps the one it had.
    expect(
      pathLabelOf('D:/trabalho/promo/briefs/capa.brief', HOME_WINDOWS, ROOT_WINDOWS, 'win32'),
    ).toBe('promo/briefs/capa.brief');
  });

  it("starts with the folder's own name on Linux and macOS, before home's ~", () => {
    expect(pathLabelOf(`${ROOT_POSIX}/briefs/capa.brief`, HOME_POSIX, ROOT_POSIX, 'linux')).toBe(
      'promo/briefs/capa.brief',
    );
    expect(pathLabelOf(`${ROOT_POSIX}/capa.brief`, HOME_POSIX, `${ROOT_POSIX}/`, 'darwin')).toBe(
      'promo/capa.brief',
    );
  });

  it('ignores case on Windows and keeps the spelling the path had', () => {
    expect(
      pathLabelOf('d:\\TRABALHO\\Promo\\Briefs\\capa.brief', HOME_WINDOWS, ROOT_WINDOWS, 'win32'),
    ).toBe('promo\\Briefs\\capa.brief');
    expect(
      pathLabelOf(
        'D:\\trabalho\\promo\\capa.brief',
        HOME_WINDOWS,
        'd:\\Trabalho\\PROMO\\',
        'win32',
      ),
    ).toBe('PROMO\\capa.brief');
  });

  it('does not ignore case elsewhere', () => {
    expect(
      pathLabelOf('/home/rafael/trabalho/Promo/capa.brief', HOME_POSIX, ROOT_POSIX, 'linux'),
    ).toBe('~/trabalho/Promo/capa.brief');
  });

  it('does not take a sibling folder whose name starts with the open one for it', () => {
    expect(
      pathLabelOf('D:\\trabalho\\promo2\\capa.brief', HOME_WINDOWS, ROOT_WINDOWS, 'win32'),
    ).toBe('D:\\trabalho\\promo2\\capa.brief');
    expect(
      pathLabelOf('/home/rafael/trabalho/promo2/capa.brief', HOME_POSIX, ROOT_POSIX, 'linux'),
    ).toBe('~/trabalho/promo2/capa.brief');
  });

  it('writes the open folder itself as its name', () => {
    expect(pathLabelOf(ROOT_WINDOWS, HOME_WINDOWS, ROOT_WINDOWS, 'win32')).toBe('promo');
    expect(pathLabelOf(ROOT_POSIX, HOME_POSIX, ROOT_POSIX, 'linux')).toBe('promo');
  });

  it('keeps home as ~, or the whole path, for a file outside the open folder', () => {
    expect(
      pathLabelOf('C:\\Users\\rafael\\Desktop\\capa.brief', HOME_WINDOWS, ROOT_WINDOWS, 'win32'),
    ).toBe('~\\Desktop\\capa.brief');
    expect(pathLabelOf('E:\\outros\\capa.brief', HOME_WINDOWS, ROOT_WINDOWS, 'win32')).toBe(
      'E:\\outros\\capa.brief',
    );
    expect(pathLabelOf('/tmp/capa.brief', HOME_POSIX, ROOT_POSIX, 'linux')).toBe('/tmp/capa.brief');
  });

  it('gives a drive or / as the open folder no name, so home decides', () => {
    expect(pathLabelOf('D:\\capa.brief', HOME_WINDOWS, 'D:\\', 'win32')).toBe('D:\\capa.brief');
    expect(pathLabelOf('/home/rafael/capa.brief', HOME_POSIX, '/', 'linux')).toBe('~/capa.brief');
  });
});
