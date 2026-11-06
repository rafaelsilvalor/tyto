import { describe, expect, it } from 'vitest';

import { ghJson, parseFlags, repoFromRemoteUrl, resolveRepo } from './command-runner.mjs';

/** A runner that answers only the calls it was given, and throws on any other. */
function fakeRunner(answers) {
  return (args) => {
    const key = args.join(' ');
    if (!(key in answers)) throw new Error(`unexpected call: ${key}`);
    return answers[key];
  };
}

describe('repoFromRemoteUrl', () => {
  it('reads owner/name from every shape git writes a GitHub remote in', () => {
    expect(repoFromRemoteUrl('https://github.com/rafaelsilvalor/tyto.git\n')).toBe(
      'rafaelsilvalor/tyto',
    );
    expect(repoFromRemoteUrl('https://github.com/rafaelsilvalor/tyto')).toBe('rafaelsilvalor/tyto');
    expect(repoFromRemoteUrl('git@github.com:someone/fork.git')).toBe('someone/fork');
    expect(repoFromRemoteUrl('ssh://git@github.com/someone/fork.git')).toBe('someone/fork');
  });

  it('answers undefined for a remote that is not on GitHub', () => {
    expect(repoFromRemoteUrl('https://gitlab.com/someone/fork.git')).toBeUndefined();
    expect(repoFromRemoteUrl('C:/projects/elsewhere')).toBeUndefined();
  });
});

describe('resolveRepo', () => {
  it('takes --repo as given, without asking git', () => {
    const git = fakeRunner({});
    expect(resolveRepo({ repo: 'someone/fork', git })).toBe('someone/fork');
  });

  it('refuses a --repo that is not owner/name', () => {
    expect(() => resolveRepo({ repo: 'tyto', git: fakeRunner({}) })).toThrow(/owner\/name/u);
  });

  it('falls back to the repository origin points at', () => {
    const git = fakeRunner({ 'remote get-url origin': 'git@github.com:someone/fork.git\n' });
    expect(resolveRepo({ git })).toBe('someone/fork');
  });

  it('says to pass --repo when origin is not on GitHub', () => {
    const git = fakeRunner({ 'remote get-url origin': '/srv/mirror.git\n' });
    expect(() => resolveRepo({ git })).toThrow(/pass --repo/u);
  });
});

describe('ghJson', () => {
  it('parses what gh prints', () => {
    const gh = fakeRunner({ 'pr list --json number': '[{"number":7}]\n' });
    expect(ghJson(['pr', 'list', '--json', 'number'], { gh })).toEqual([{ number: 7 }]);
  });

  it('names the call when gh prints something that is not JSON', () => {
    const gh = fakeRunner({ 'pr list': 'HTTP 502\n' });
    expect(() => ghJson(['pr', 'list'], { gh })).toThrow(/gh pr list did not print JSON/u);
  });
});

describe('parseFlags', () => {
  it('reads switches and flags with values', () => {
    expect(parseFlags(['--check', '--base', 'origin/main', '--json'])).toEqual({
      check: true,
      base: 'origin/main',
      json: true,
    });
  });

  it('refuses a bare argument, which is most likely a typo', () => {
    expect(() => parseFlags(['next'])).toThrow(/unexpected argument: next/u);
  });
});
