import { spawn } from 'node:child_process';

/**
 * Opens the system browser on a URL, for `tyto signin` (ADR 0194). No shell: the authorize URL
 * carries `&` between its parameters, which `cmd /c start` would read as a second command.
 *
 * Exported per platform so a test reads the command line without starting a browser.
 */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform,
): { readonly command: string; readonly args: readonly string[] } {
  if (platform === 'win32') {
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  }
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/**
 * Starts the browser and does not wait for it. A browser that cannot start — no `xdg-open` on
 * a server — is not an error here: the command already printed the URL to open by hand, and
 * the loopback listener waits for whatever browser the person uses.
 */
export function openSystemBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const { command, args } = browserCommand(url, platform);
  const child = spawn(command, [...args], { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
  return Promise.resolve();
}
