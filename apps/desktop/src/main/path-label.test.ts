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
        'win32',
      ),
    ).toBe('~\\Documents\\campanhas\\promo.brief');
  });

  it('shortens the home directory to ~ on Linux and macOS', () => {
    expect(pathLabelOf('/home/rafael/briefs/promo.brief', '/home/rafael', 'linux')).toBe(
      '~/briefs/promo.brief',
    );
    expect(pathLabelOf('/Users/rafael/briefs/promo.brief', '/Users/rafael/', 'darwin')).toBe(
      '~/briefs/promo.brief',
    );
  });

  it('writes a file directly in the home directory as ~ and its name', () => {
    expect(pathLabelOf('/home/rafael/promo.brief', '/home/rafael', 'linux')).toBe('~/promo.brief');
    expect(pathLabelOf('C:\\Users\\rafael\\promo.brief', 'C:\\Users\\rafael\\', 'win32')).toBe(
      '~\\promo.brief',
    );
  });

  it('ignores case on Windows and keeps the spelling the path had', () => {
    expect(
      pathLabelOf('c:\\users\\RAFAEL\\Desktop\\promo.brief', 'C:\\Users\\rafael', 'win32'),
    ).toBe('~\\Desktop\\promo.brief');
  });

  it('does not ignore case elsewhere', () => {
    expect(pathLabelOf('/home/RAFAEL/briefs/promo.brief', '/home/rafael', 'linux')).toBe(
      '/home/RAFAEL/briefs/promo.brief',
    );
  });

  it('leaves a path outside the home directory whole', () => {
    expect(pathLabelOf('D:\\Projects\\tyto\\promo.brief', 'C:\\Users\\rafael', 'win32')).toBe(
      'D:\\Projects\\tyto\\promo.brief',
    );
    expect(pathLabelOf('/tmp/tyto-e2e/promo.brief', '/home/rafael', 'linux')).toBe(
      '/tmp/tyto-e2e/promo.brief',
    );
  });

  it('does not take a sibling whose name starts with the home name for the home', () => {
    expect(pathLabelOf('/home/rafael2/promo.brief', '/home/rafael', 'linux')).toBe(
      '/home/rafael2/promo.brief',
    );
    expect(pathLabelOf('C:\\Users\\rafaela\\promo.brief', 'C:\\Users\\rafael', 'win32')).toBe(
      'C:\\Users\\rafaela\\promo.brief',
    );
  });

  it('does not treat a root as a home, which would put ~ in front of every path', () => {
    expect(pathLabelOf('/srv/briefs/promo.brief', '/', 'linux')).toBe('/srv/briefs/promo.brief');
    expect(pathLabelOf('C:\\briefs\\promo.brief', 'C:\\', 'win32')).toBe('C:\\briefs\\promo.brief');
    expect(pathLabelOf('/srv/briefs/promo.brief', '', 'linux')).toBe('/srv/briefs/promo.brief');
  });
});
