import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron } from 'playwright';
import { it } from 'vitest';

/**
 * Launch the app, say which one it is, and kill the worker under it (TYTO-292).
 *
 * The worker dies the way `0xC0000409` kills one: with no `afterAll`, no `closeApp`, nothing in
 * this process left to end the app. Only the run's teardown, in the main vitest process, can.
 */

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..');

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`orphan fixture: ${name} is not set`);
  return value;
};

it('leaves an app behind when its worker dies', async () => {
  const scratch = required('TYTO_ORPHAN_SCRATCH');
  const userData = join(scratch, 'userData');
  const app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: desktop,
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  writeFileSync(
    required('TYTO_ORPHAN_MARKER'),
    JSON.stringify({ pid: app.process().pid, userData }),
    'utf8',
  );
  process.kill(process.pid);
});
