import { posix, win32 } from 'node:path';

/**
 * Which shell a terminal tab runs, and with what environment (TYTO-497, ADR 0164 decision 4).
 *
 * Pure, with the platform, the environment and the file check handed in, so the Windows rules are
 * tested on Linux CI and the other way round.
 */

export interface ShellSetting {
  /** `terminalShell`: a program the person chose, or `null` for the platform's own. */
  readonly shell: string | null;
  /** `terminalArgs`: its arguments, or `null` for the platform's (`-l` on macOS, none elsewhere). */
  readonly args: readonly string[] | null;
}

export interface ShellChoice {
  readonly file: string;
  readonly args: readonly string[];
  /** The shell's name for the tab ("PowerShell", "zsh"), never a folder (decision 3). */
  readonly title: string;
}

export interface ShellChoiceOptions {
  readonly platform: NodeJS.Platform;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly setting: ShellSetting;
  /** Whether a file exists: how `pwsh.exe` is looked for on `PATH`. */
  readonly exists: (path: string) => boolean;
}

/** On `PATH`, by the platform's separator and path rules; `undefined` when no entry has it. */
function onPath(options: ShellChoiceOptions, name: string): string | undefined {
  const path = options.platform === 'win32' ? win32 : posix;
  // Windows spells it `Path`, and a process environment there is case-insensitive.
  const variable = Object.entries(options.environment).find(
    ([key]) => key.toUpperCase() === 'PATH',
  )?.[1];
  for (const folder of (variable ?? '').split(path.delimiter)) {
    if (folder === '') continue;
    const candidate = path.join(folder, name);
    if (options.exists(candidate)) return candidate;
  }
  return undefined;
}

/** The tab's name for a program: PowerShell for both of Windows', otherwise the file's name. */
export function shellTitle(platform: NodeJS.Platform, file: string): string {
  const path = platform === 'win32' ? win32 : posix;
  const name = path.basename(file).replace(/\.exe$/iu, '');
  return /^(?:pwsh|powershell)$/iu.test(name) ? 'PowerShell' : name;
}

/**
 * PowerShell 7 when it is on `PATH`, else Windows PowerShell; `$SHELL` elsewhere, falling back to
 * zsh on macOS and bash on Linux. macOS starts it as a login shell, because an app opened from
 * the Dock does not inherit the login `PATH`. The setting wins over all of it.
 */
export function chooseShell(options: ShellChoiceOptions): ShellChoice {
  const { platform, environment, setting } = options;
  const file =
    setting.shell ??
    (platform === 'win32'
      ? (onPath(options, 'pwsh.exe') ?? 'powershell.exe')
      : environment.SHELL !== undefined && environment.SHELL !== ''
        ? environment.SHELL
        : platform === 'darwin'
          ? '/bin/zsh'
          : '/bin/bash');
  const args = setting.args ?? (platform === 'darwin' && setting.shell === null ? ['-l'] : []);
  return { file, args, title: shellTitle(platform, file) };
}

/**
 * Main's environment minus what is Tyto's or Electron's to read, plus what tells programs they
 * are in a colour terminal. Nothing from `safeStorage` is ever in main's environment to begin
 * with, and nothing here adds it.
 */
export function terminalEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (upper.startsWith('TYTO_PLUGIN_') || upper.startsWith('ELECTRON_')) continue;
    if (upper === 'NODE_OPTIONS') continue;
    kept[key] = value;
  }
  return { ...kept, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Tyto' };
}
