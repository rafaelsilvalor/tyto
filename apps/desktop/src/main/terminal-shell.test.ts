import { describe, expect, it } from 'vitest';

import { chooseShell, shellTitle, terminalEnvironment } from './terminal-shell.js';

const platformDefault = { shell: null, args: null };

describe('the shell a terminal runs (ADR 0164 decision 4)', () => {
  it('is PowerShell 7 on Windows when PATH has it, by Windows path rules', () => {
    const choice = chooseShell({
      platform: 'win32',
      environment: { Path: 'C:\\Windows\\System32;C:\\Program Files\\PowerShell\\7' },
      setting: platformDefault,
      exists: (path) => path === 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    });

    expect(choice).toEqual({
      file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: [],
      title: 'PowerShell',
    });
  });

  it('falls back to Windows PowerShell when no PATH entry has pwsh', () => {
    const choice = chooseShell({
      platform: 'win32',
      environment: { PATH: 'C:\\Windows\\System32' },
      setting: platformDefault,
      exists: () => false,
    });

    expect(choice).toEqual({ file: 'powershell.exe', args: [], title: 'PowerShell' });
  });

  it('is $SHELL on Linux, and a login shell on macOS', () => {
    const linux = chooseShell({
      platform: 'linux',
      environment: { SHELL: '/usr/bin/fish' },
      setting: platformDefault,
      exists: () => false,
    });
    const mac = chooseShell({
      platform: 'darwin',
      environment: { SHELL: '/bin/zsh' },
      setting: platformDefault,
      exists: () => false,
    });

    expect(linux).toEqual({ file: '/usr/bin/fish', args: [], title: 'fish' });
    expect(mac).toEqual({ file: '/bin/zsh', args: ['-l'], title: 'zsh' });
  });

  it('falls back to zsh on macOS and bash on Linux with no $SHELL', () => {
    const options = { environment: {}, setting: platformDefault, exists: () => false };

    expect(chooseShell({ ...options, platform: 'darwin' }).file).toBe('/bin/zsh');
    expect(chooseShell({ ...options, platform: 'linux' }).file).toBe('/bin/bash');
  });

  it('runs what the settings name, with their arguments and no login flag of its own', () => {
    const choice = chooseShell({
      platform: 'darwin',
      environment: { SHELL: '/bin/zsh' },
      setting: { shell: '/opt/homebrew/bin/nu', args: null },
      exists: () => false,
    });
    const withArgs = chooseShell({
      platform: 'win32',
      environment: {},
      setting: { shell: 'cmd.exe', args: ['/K', 'echo hi'] },
      exists: () => true,
    });

    expect(choice).toEqual({ file: '/opt/homebrew/bin/nu', args: [], title: 'nu' });
    expect(withArgs).toEqual({ file: 'cmd.exe', args: ['/K', 'echo hi'], title: 'cmd' });
  });

  it('names the tab after the program, never a folder', () => {
    expect(
      shellTitle('win32', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'),
    ).toBe('PowerShell');
    expect(shellTitle('linux', '/usr/local/bin/bash')).toBe('bash');
  });
});

describe('the environment a terminal gets', () => {
  it("drops Tyto's plugin variables, Electron's and NODE_OPTIONS, and says it is a colour terminal", () => {
    const environment = terminalEnvironment({
      PATH: '/usr/bin',
      HOME: '/home/person',
      TYTO_PLUGIN_TOKEN: 'never',
      ELECTRON_RUN_AS_NODE: '1',
      electron_enable_logging: '1',
      NODE_OPTIONS: '--require evil.js',
      TERM: 'dumb',
      UNSET: undefined,
    });

    expect(environment).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/person',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Tyto',
    });
  });
});
