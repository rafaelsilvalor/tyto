/**
 * @tyto/cli — the `tyto` command (commander).
 *
 * One of the two composition roots: this is where ports get their adapters (ADR 0010).
 * `apps/desktop` is the other, and neither the pure packages nor the adapters know which
 * of them they are running under.
 *
 * This file does two things and nothing else: build the real environment, and turn the
 * exit code the program returned into the process's. It exports nothing, so it can run its
 * command at import time without a "was I started directly?" guard that has to be right on
 * three platforms — everything worth testing lives in the modules beside it, reachable
 * with a string buffer for a terminal.
 */

import { defaultEnvironment } from './environment.js';
import { run } from './program.js';

process.exitCode = await run(process.argv.slice(2), defaultEnvironment());
