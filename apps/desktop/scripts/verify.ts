import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Browser, type Page, chromium } from 'playwright';

/**
 * The verification probe (TYTO-651, ADR 0178): an agent's eyes on a Tyto the person is running.
 *
 * Tyto started with Chromium's `--remote-debugging-port=<port>` shows a "Verification mode" badge
 * and listens on `127.0.0.1:<port>`; this connects there with Playwright's `connectOverCDP`, the
 * way the packaged suite does (`e2e/cdp-app.ts`), and prints plain text and PNG paths for an
 * agent to read. It reaches the window and its bridge, never main (ADR 0067).
 *
 * Run from `apps/desktop`: `node scripts/verify.ts <command> [--port 9333] [--out <folder>]`.
 *
 * **Read-only, except `recipe`.** `screenshot`, `text`, `tabs` and `plugins` change nothing.
 * `recipe` runs the recipe in front, which is the person's Run: a plan cell may write to the
 * services it names. It is never a default, it is only run when named, and it prints the
 * command before running it. Credentials are read as set or not set from `plugins:list`, the
 * plugins screen's own answer; no `credentials:*` channel is ever called, so no value crosses.
 */

export const COMMANDS = ['screenshot', 'text', 'tabs', 'plugins', 'recipe'] as const;
export type ProbeCommand = (typeof COMMANDS)[number];

/** The port the launcher's verification line opens (docs/agents.md). */
export const DEFAULT_PORT = 9333;

export interface ProbeArguments {
  readonly command: ProbeCommand;
  readonly port: number;
  /** Where screenshots go. */
  readonly out: string;
  /** `recipe` only: `recipe.runFresh`, fetching every source anew, instead of `recipe.run`. */
  readonly fresh: boolean;
  /** `recipe` only: how long to wait for the cells to settle. */
  readonly timeoutMs: number;
}

export const USAGE = [
  'usage: node scripts/verify.ts <command> [--port <n>] [--out <folder>]',
  '  screenshot              capture the window to a PNG and print its path',
  "  text                    print the window's visible text",
  '  tabs                    print the open tabs, the one in front marked *',
  '  plugins                 print each plugin and its credentials as set / not set',
  '  recipe [--fresh]        RUN the recipe in front (recipe.run, or recipe.runFresh),',
  "                          then print each cell's status and plan lines",
  `  --port <n>              Tyto's debugging port (default ${String(DEFAULT_PORT)})`,
  '  --timeout <seconds>     recipe only: how long to wait for the cells (default 120)',
].join('\n');

/** The probe's arguments, or the reason they are not usable. Never picks a command for you. */
export function parseArguments(
  argv: readonly string[],
  defaultOut: string,
): ProbeArguments | { readonly error: string } {
  const [command, ...rest] = argv;
  if (command === undefined) return { error: 'no command given' };
  if (!(COMMANDS as readonly string[]).includes(command)) {
    return { error: `unknown command '${command}'` };
  }
  let port = DEFAULT_PORT;
  let out = defaultOut;
  let fresh = false;
  let timeoutMs = 120_000;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag === '--fresh' && command === 'recipe') {
      fresh = true;
    } else if (flag === '--port' && value !== undefined && /^\d+$/u.test(value)) {
      port = Number(value);
      if (port < 1 || port > 65_535) return { error: `port ${value} is out of range` };
      index += 1;
    } else if (flag === '--out' && value !== undefined) {
      out = resolve(value);
      index += 1;
    } else if (
      flag === '--timeout' &&
      command === 'recipe' &&
      value !== undefined &&
      /^\d+$/u.test(value)
    ) {
      timeoutMs = Number(value) * 1_000;
      index += 1;
    } else {
      return { error: `'${String(flag)}' is not an option of '${command}'` };
    }
  }
  return { command: command as ProbeCommand, port, out, fresh, timeoutMs };
}

/** One recipe cell as the window draws it. */
export interface CellReading {
  readonly summary: string;
  readonly failed: boolean;
  /** The plan's heading, held note, summary or refusal, in the order drawn. */
  readonly notes: readonly string[];
  /** Each planned write: its write, its row, its description and its mark, joined by ` · `. */
  readonly planLines: readonly string[];
}

/**
 * The little of the DOM the readers touch. This folder is typed for Node, without the DOM's
 * library, and the readers run in the page, so they reach `document` through `globalThis`.
 */
interface DomElement {
  readonly textContent: string | null;
  readonly children: ArrayLike<DomElement>;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

/**
 * Each recipe cell in the editor, read from the DOM.
 *
 * **Self-contained on purpose**: Playwright sends this function's source to the page, so it
 * may close over nothing, and the jsdom test runs the same source against the real cell views.
 */
export function readRecipeCells(): CellReading[] {
  const document = (globalThis as unknown as { document: DomElement }).document;
  const textOf = (node: DomElement | null): string => (node?.textContent ?? '').trim();
  return Array.from(document.querySelectorAll('#editor .recipe-cell'), (cell) => ({
    summary: textOf(cell.querySelector('.recipe-cell-summary')),
    failed: cell.querySelector('.recipe-cell-status[data-failed]') !== null,
    notes: Array.from(
      cell.querySelectorAll(
        '.recipe-plan__heading, .recipe-plan__held, .recipe-plan__summary, .recipe-plan__refusal',
      ),
      textOf,
    ),
    planLines: Array.from(cell.querySelectorAll('.recipe-plan__operation'), (line) =>
      Array.from(line.children, textOf)
        .filter((part) => part !== '')
        .join(' · '),
    ),
  }));
}

/** The cells as plain text, one block per cell, numbered from 1. */
export function formatCells(cells: readonly CellReading[]): string {
  if (cells.length === 0) return 'no recipe cells in front';
  return cells
    .map((cell, index) => {
      const lines = [`cell ${String(index + 1)}: ${cell.failed ? 'FAILED ' : ''}${cell.summary}`];
      for (const note of cell.notes) lines.push(`  ${note}`);
      for (const line of cell.planLines) lines.push(`  - ${line}`);
      return lines.join('\n');
    })
    .join('\n');
}

/** What `plugins:list` answers that this prints: names and set / not set, nothing else. */
export interface PluginReading {
  readonly name: string;
  readonly enabled?: boolean;
  readonly credentials?: readonly { readonly key: string; readonly set: boolean }[];
}

export function formatPlugins(plugins: readonly PluginReading[]): string {
  if (plugins.length === 0) return 'no plugins installed';
  return plugins
    .map((plugin) => {
      const state = plugin.enabled === false ? ' (disabled)' : '';
      const credentials = (plugin.credentials ?? []).map(
        (credential) => `  credential ${credential.key}: ${credential.set ? 'set' : 'not set'}`,
      );
      return [`${plugin.name}${state}`, ...credentials].join('\n');
    })
    .join('\n');
}

/** The open tabs, the one in front marked `*`. Self-contained, for the reason above. */
export function readTabs(): string[] {
  const document = (globalThis as unknown as { document: DomElement }).document;
  const textOf = (node: DomElement): string =>
    (node.textContent ?? '').trim().replace(/\s+/gu, ' ');
  return Array.from(document.querySelectorAll('.tabs__tab'), (tab) => {
    // `aria-selected` is on the tab's name button, not on the tab around it.
    const name = tab.querySelector('[role="tab"]');
    const front = name?.getAttribute('aria-selected') === 'true';
    return `${front ? '*' : ' '} ${textOf(name ?? tab)}`;
  });
}

async function windowPage(browser: Browser): Promise<Page> {
  const pages = browser.contexts().flatMap((context) => context.pages());
  for (const page of pages) {
    if ((await page.$('#editor')) !== null) return page;
  }
  throw new Error(`no Tyto window among ${String(pages.length)} page(s)`);
}

async function runRecipe(page: Page, args: ProbeArguments): Promise<string> {
  const commandId = args.fresh ? 'recipe.runFresh' : 'recipe.run';
  process.stdout.write(`running ${commandId} on the recipe in front\n`);
  // A mark on the first cell, so the wait below knows the answer has replaced the old cells.
  await page.evaluate(() => {
    const document = (globalThis as unknown as { document: DomElement }).document;
    document.querySelector('#editor .recipe-cell')?.setAttribute('data-probe', '');
  });
  const ran = await page.evaluate((id) => {
    const document = (globalThis as unknown as { document: DomElement }).document;
    const bar = document.querySelector('tyto-command-bar') as unknown as {
      run?: (command: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the window refused '${commandId}': is a recipe in front?`);
  // Settled is: the old cells replaced, and the same summaries on two reads 1 s apart.
  const started = Date.now();
  let last = '';
  while (Date.now() - started < args.timeoutMs) {
    await page.waitForTimeout(1_000);
    const replaced = await page.evaluate(
      () =>
        (globalThis as unknown as { document: DomElement }).document.querySelector(
          '#editor .recipe-cell[data-probe]',
        ) === null,
    );
    const now = formatCells(await page.evaluate(readRecipeCells));
    if (replaced && now === last) return now;
    last = now;
  }
  return `${last}\n(not settled after ${String(args.timeoutMs / 1_000)} s; shown as it was)`;
}

/** Runs one command against the window on `args.port`, and returns what to print. */
export async function probe(args: ProbeArguments): Promise<string> {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(args.port)}`);
  try {
    const page = await windowPage(browser);
    switch (args.command) {
      case 'screenshot': {
        mkdirSync(args.out, { recursive: true });
        const file = join(args.out, `tyto-${new Date().toISOString().replace(/[:.]/gu, '-')}.png`);
        await page.screenshot({ path: file });
        return file;
      }
      case 'text':
        // Awaited here, not returned: `finally` disconnects, and a pending evaluate dies with it.
        return await page.evaluate(
          () =>
            (globalThis as unknown as { document: { body: { innerText: string } } }).document.body
              .innerText,
        );
      case 'tabs':
        return (await page.evaluate(readTabs)).join('\n');
      case 'plugins': {
        const answer = await page.evaluate(async () => {
          const bridge = (globalThis as { tyto?: Record<string, (r: object) => Promise<unknown>> })
            .tyto;
          return (await bridge?.['plugins:list']?.({})) as
            { plugins: readonly PluginReading[] } | undefined;
        });
        if (answer === undefined) throw new Error('the window has no plugins:list bridge');
        return formatPlugins(answer.plugins);
      }
      case 'recipe':
        return await runRecipe(page, args);
    }
  } finally {
    // Disconnects; the person's app keeps running.
    await browser.close();
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2), join(tmpdir(), 'tyto-verify'));
  if ('error' in args) {
    process.stderr.write(`${args.error}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    process.stdout.write(`${await probe(args)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${message}\nIs Tyto running in verification mode on port ${String(args.port)}?\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
