import { readFileSync } from 'node:fs';

/**
 * The lines of Chromium's `DevToolsActivePort` once both are written, or `undefined` while it
 * is not ready yet: absent, half-written, or still held open by the writer. That last one is
 * Windows, where a read landing while Chromium has the file open throws `EBUSY: resource busy
 * or locked` — a moment, not a failure. It failed 1 of 3 Windows legs of the release gate's
 * first runs (TYTO-95).
 *
 * The reader is a parameter so the `EBUSY` path can be tested without holding a real lock.
 */
export function readPortFile(
  portFile: string,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string[] | undefined {
  let text: string;
  try {
    text = read(portFile);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EBUSY') return undefined;
    throw error;
  }
  const lines = text.split('\n');
  return lines.length < 2 ? undefined : lines;
}
