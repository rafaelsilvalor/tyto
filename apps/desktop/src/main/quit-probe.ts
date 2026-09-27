// TEMPORARY (TYTO-44): instrumentation of the quit path, removed before the PR leaves draft.
// Every line goes to stdout and to the app log, prefixed so one grep extracts them.

interface ProbeLog {
  info: (message: string, detail?: unknown) => void;
}

let target: ProbeLog | undefined;
const started = Date.now();

export function attachProbeLog(log: ProbeLog): void {
  target = log;
}

export function probe(message: string): void {
  const line = `[quit-probe] +${Date.now() - started}ms ${message}`;
  console.warn(line);
  try {
    target?.info(line);
  } catch {
    // A probe must never change what it measures.
  }
}

/** What is still keeping the event loop alive, by constructor name. */
export function describeHandles(): string {
  const internals = process as unknown as {
    _getActiveHandles?: () => unknown[];
    _getActiveRequests?: () => unknown[];
  };
  const name = (value: unknown): string =>
    (value as { constructor?: { name?: string } } | null)?.constructor?.name ?? typeof value;
  const count = (values: unknown[] | undefined): string => {
    const tally = new Map<string, number>();
    for (const value of values ?? []) tally.set(name(value), (tally.get(name(value)) ?? 0) + 1);
    return [...tally].map(([key, n]) => `${key}x${n}`).join(',');
  };
  return `handles=[${count(internals._getActiveHandles?.())}] requests=[${count(internals._getActiveRequests?.())}]`;
}

let ticker: ReturnType<typeof setInterval> | undefined;

/** Once quit is asked for, say every 5 s what is still alive. `unref` so it keeps nothing alive. */
export function startTicker(describeProcesses: () => string): void {
  if (ticker !== undefined) return;
  ticker = setInterval(() => {
    probe(`tick ${describeHandles()} ${describeProcesses()}`);
  }, 5_000);
  ticker.unref();
}
