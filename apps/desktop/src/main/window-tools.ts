import { PassThrough, type Readable, type Writable } from 'node:stream';

import type { WindowTool, WindowToolContent, WindowToolResult } from '@tyto/plugin-api';

import { windowRefusal } from './terminal-agent.js';
import type { WorkspaceState } from './workspace.js';

/**
 * The window's tools, called by a plugin in process (ADR 0190): `host.window.tools()` and
 * `host.window.callTool()`.
 *
 * **The same server an agent reaches, with nothing between them.** Each call opens a session on
 * {@link WindowToolsPortOptions.serve} — the `serveAgent` the window's endpoint runs for every
 * connection (ADR 0180) — over two in-memory streams instead of a socket, speaks MCP's stdio
 * framing (one JSON-RPC message per line) through `initialize`, asks its one question and closes.
 * So the tools, the folder's trust and the proposals are the ones an agent connected to the window
 * gets, and there is no second list of tools to drift. No socket, no token and no record: the
 * plugin is already the host's, and its permission (`window:tools`) is checked in front of this.
 *
 * A session per call, not one kept per plugin, because the folder and its trust can change
 * between two calls and a session reads them once, when it opens.
 */

/** MCP's revision the client asks for; the server answers with the one it speaks. */
export const WINDOW_TOOLS_PROTOCOL = '2025-06-18';

/** A listing answers in well under a second; this only stops a session that never answers. */
export const LIST_TIMEOUT_MS = 30_000;

/** A call may render a preview or an export, which can take a while on a large brief. */
export const CALL_TIMEOUT_MS = 180_000;

export interface WindowToolsPortOptions {
  /** Whether the window's endpoint listens now (`agentsListen`). */
  readonly listening: () => boolean;
  readonly workspace: () => Pick<WorkspaceState, 'folder' | 'trust'>;
  /** Serves MCP on two streams until the input ends or `signal` fires: the window's `serveAgent`. */
  readonly serve: (
    stdio: { readonly input: Readable; readonly output: Writable },
    signal: AbortSignal,
    plugin: string,
  ) => Promise<void>;
  readonly listTimeoutMs?: number;
  readonly callTimeoutMs?: number;
}

interface JsonRpcAnswer {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly message?: unknown };
}

/** A JSON-RPC error from the server, for the caller to turn into what it answers. */
class ServerError extends Error {}

/**
 * Opens a session, runs `ask` on it, and closes it whatever happens. `request` resolves with a
 * result or rejects with a {@link ServerError}; the deadline rejects with a plain `Error`.
 */
async function inSession<T>(
  options: WindowToolsPortOptions,
  plugin: string,
  timeoutMs: number,
  ask: (request: (method: string, params: unknown) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const controller = new AbortController();
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (cause: Error) => void }
  >();
  let nextId = 1;
  let buffered = '';

  fromServer.setEncoding('utf8');
  fromServer.on('data', (chunk: string) => {
    buffered += chunk;
    for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
      const line = buffered.slice(0, end).trim();
      buffered = buffered.slice(end + 1);
      if (line === '') continue;
      let answer: JsonRpcAnswer;
      try {
        answer = JSON.parse(line) as JsonRpcAnswer;
      } catch {
        continue;
      }
      if (typeof answer.id !== 'number') continue;
      const waiting = pending.get(answer.id);
      if (waiting === undefined) continue;
      pending.delete(answer.id);
      if (answer.error !== undefined) {
        const message = typeof answer.error.message === 'string' ? answer.error.message : 'refused';
        waiting.reject(new ServerError(message));
      } else waiting.resolve(answer.result);
    }
  });

  const send = (message: Record<string, unknown>): void => {
    toServer.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };
  const request = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });

  const served = options.serve({ input: toServer, output: fromServer }, controller.signal, plugin);
  // A server that stops early fails every question still waiting, rather than leaving it hanging.
  const stopped = served.then(
    () => new Error('The window closed the session before it answered.'),
    (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
  );
  void stopped.then((cause) => {
    for (const waiting of pending.values()) waiting.reject(cause);
    pending.clear();
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`The window did not answer within ${String(timeoutMs / 1000)} s.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        await request('initialize', {
          protocolVersion: WINDOW_TOOLS_PROTOCOL,
          capabilities: {},
          clientInfo: { name: `tyto-plugin:${plugin}`, version: '1' },
        });
        send({ method: 'notifications/initialized' });
        return ask(request);
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    toServer.end();
    controller.abort();
    await served.catch(() => undefined);
  }
}

function toolOf(raw: unknown): WindowTool | undefined {
  const tool = raw as { name?: unknown; description?: unknown; inputSchema?: unknown } | null;
  if (typeof tool?.name !== 'string') return undefined;
  return {
    name: tool.name,
    description: typeof tool.description === 'string' ? tool.description : '',
    inputSchema:
      typeof tool.inputSchema === 'object' && tool.inputSchema !== null
        ? (tool.inputSchema as Record<string, unknown>)
        : { type: 'object' },
  };
}

/**
 * One block of MCP content as a plugin receives it: text and images as they are, anything else
 * said in a line of text, so a model is told something was there rather than shown nothing.
 */
function contentOf(raw: unknown): WindowToolContent {
  const block = raw as {
    type?: unknown;
    text?: unknown;
    data?: unknown;
    mimeType?: unknown;
    uri?: unknown;
  } | null;
  if (block?.type === 'text' && typeof block.text === 'string') {
    return { type: 'text', text: block.text };
  }
  if (
    block?.type === 'image' &&
    typeof block.data === 'string' &&
    typeof block.mimeType === 'string'
  ) {
    return { type: 'image', data: block.data, mimeType: block.mimeType };
  }
  const kind = typeof block?.type === 'string' ? block.type : 'unknown';
  const where = typeof block?.uri === 'string' ? ` (${block.uri})` : '';
  return { type: 'text', text: `[a ${kind} block${where} that a plugin does not receive]` };
}

/**
 * The desktop's `windowTools` and `callWindowTool` ports. The folder's trust and `agentsListen`
 * are read on every call and refused as `windowAgentServer` refuses them (ADR 0183 decision 4);
 * the permission is plugin-api's to check, in front of this.
 */
export function windowToolsPorts(options: WindowToolsPortOptions): {
  windowTools: (plugin: string) => Promise<readonly WindowTool[]>;
  callWindowTool: (
    plugin: string,
    name: string,
    input: Readonly<Record<string, unknown>>,
  ) => Promise<WindowToolResult>;
} {
  return {
    async windowTools(plugin) {
      const refused = windowRefusal(plugin, options);
      if (refused !== undefined) throw refused;
      return inSession(
        options,
        plugin,
        options.listTimeoutMs ?? LIST_TIMEOUT_MS,
        async (request) => {
          const result = (await request('tools/list', {})) as { tools?: unknown } | undefined;
          const tools = Array.isArray(result?.tools) ? result.tools : [];
          return tools.map(toolOf).filter((tool): tool is WindowTool => tool !== undefined);
        },
      );
    },
    async callWindowTool(plugin, name, input) {
      const refused = windowRefusal(plugin, options);
      if (refused !== undefined) throw refused;
      return inSession(
        options,
        plugin,
        options.callTimeoutMs ?? CALL_TIMEOUT_MS,
        async (request) => {
          try {
            const result = (await request('tools/call', { name, arguments: input })) as
              { content?: unknown; isError?: unknown } | undefined;
            const content = Array.isArray(result?.content) ? result.content.map(contentOf) : [];
            return { content, isError: result?.isError === true };
          } catch (cause) {
            // An unknown tool or arguments the server refused: the model's mistake, said to the
            // model as a tool's refusal, as an agent connected to the window would read it.
            if (cause instanceof ServerError) {
              return { content: [{ type: 'text', text: cause.message }], isError: true };
            }
            throw cause;
          }
        },
      );
    },
  };
}
