import type { BriefSource, OutputSink } from '@tyto/io';
import type { Plugin } from '@tyto/plugin-api';

/**
 * The `source` and `sink` extension points' built-ins: the fs inbox and the fs outbox.
 *
 * Both are contributed generically. `BriefSource` and `OutputSink` are declared in
 * `@tyto/io`, a Node package, and `@tyto/plugin-api` is pure — it cannot name those types
 * without dragging Node's into a package that has to run in a browser (ADR 0010). So the
 * host stores the value and only ever reads its id, and the two ends that care about the
 * shape are both here.
 */

export function sourcePlugin(source: BriefSource, id = 'fs-inbox'): Plugin {
  return { id, activate: (host) => host.registerSource<BriefSource>({ id, value: source }) };
}

export function sinkPlugin(sink: OutputSink, id = 'fs-outbox'): Plugin {
  return { id, activate: (host) => host.registerSink<OutputSink>({ id, value: sink }) };
}
