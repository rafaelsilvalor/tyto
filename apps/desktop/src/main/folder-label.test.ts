import { describe, expect, it } from 'vitest';

import { folderLabelOf } from './folder-label.js';

/**
 * The folder a tab's tooltip shows (TYTO-288, ADR 0086), on both separators whatever machine
 * runs the suite.
 */

describe('the folder a tab shows on hover', () => {
  it('shortens the home directory to ~ on Windows', () => {
    expect(
      folderLabelOf(
        'C:\\Users\\rafael\\Documents\\campanhas\\promo.brief',
        'C:\\Users\\rafael',
        'win32',
      ),
    ).toBe('~\\Documents\\campanhas');
  });

  it('shortens the home directory to ~ on Linux and macOS', () => {
    expect(folderLabelOf('/home/rafael/briefs/promo.brief', '/home/rafael', 'linux')).toBe(
      '~/briefs',
    );
    expect(folderLabelOf('/Users/rafael/briefs/promo.brief', '/Users/rafael/', 'darwin')).toBe(
      '~/briefs',
    );
  });

  it('is ~ alone for a file directly in the home directory', () => {
    expect(folderLabelOf('/home/rafael/promo.brief', '/home/rafael', 'linux')).toBe('~');
    expect(folderLabelOf('C:\\Users\\rafael\\promo.brief', 'C:\\Users\\rafael\\', 'win32')).toBe(
      '~',
    );
  });

  it('ignores case on Windows and keeps the spelling the folder had', () => {
    expect(
      folderLabelOf('c:\\users\\RAFAEL\\Desktop\\promo.brief', 'C:\\Users\\rafael', 'win32'),
    ).toBe('~\\Desktop');
  });

  it('does not ignore case elsewhere', () => {
    expect(folderLabelOf('/home/RAFAEL/briefs/promo.brief', '/home/rafael', 'linux')).toBe(
      '/home/RAFAEL/briefs',
    );
  });

  it('leaves a folder outside the home directory whole', () => {
    expect(folderLabelOf('D:\\Projects\\tyto\\promo.brief', 'C:\\Users\\rafael', 'win32')).toBe(
      'D:\\Projects\\tyto',
    );
    expect(folderLabelOf('/tmp/tyto-e2e/promo.brief', '/home/rafael', 'linux')).toBe(
      '/tmp/tyto-e2e',
    );
  });

  it('does not take a sibling whose name starts with the home name for the home', () => {
    expect(folderLabelOf('/home/rafael2/promo.brief', '/home/rafael', 'linux')).toBe(
      '/home/rafael2',
    );
    expect(folderLabelOf('C:\\Users\\rafaela\\promo.brief', 'C:\\Users\\rafael', 'win32')).toBe(
      'C:\\Users\\rafaela',
    );
  });

  it('does not treat a root as a home, which would turn every folder into ~', () => {
    expect(folderLabelOf('/srv/briefs/promo.brief', '/', 'linux')).toBe('/srv/briefs');
    expect(folderLabelOf('C:\\briefs\\promo.brief', 'C:\\', 'win32')).toBe('C:\\briefs');
    expect(folderLabelOf('/srv/briefs/promo.brief', '', 'linux')).toBe('/srv/briefs');
  });
});
