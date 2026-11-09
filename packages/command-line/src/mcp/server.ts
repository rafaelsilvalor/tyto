import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

import type { CliConsole, CliStdio } from '../environment.js';
import type { BriefInput, McpSession } from './session.js';
import { confinedPath } from './confine.js';
import {
  type McpToolName,
  PREVIEW_MAX_SIDE,
  ToolRefusal,
  type WindowActionAnswer,
  type WindowPort,
  toolsFor,
} from './tools.js';

/**
 * The protocol half of `tyto mcp` (ADR 0179): the SDK, the tools' schemas and descriptions, and
 * the stdio transport. Imported lazily by the command, so neither the window's bundle nor any
 * other command pays for the SDK at start.
 *
 * Every answer is text an agent reads, or a PNG it looks at. A failure is the tool's answer
 * (`isError`), never a thrown protocol error: an agent can read a sentence and try again, and a
 * stack trace goes to stderr, where the person who started the server reads it.
 */

type Content =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string };

interface ToolAnswer {
  [key: string]: unknown;
  content: Content[];
  isError?: boolean;
}

const text = (value: unknown): Content => ({
  type: 'text',
  text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
});

const briefShape = {
  path: z
    .string()
    .optional()
    .describe('a .brief file, relative to the folder tyto mcp was started in; or give text'),
  text: z.string().optional().describe("the brief's text itself; or give path"),
  template: z
    .string()
    .optional()
    .describe("the template to use when the brief's frontmatter names none"),
};

function briefOf(input: {
  readonly path?: string | undefined;
  readonly text?: string | undefined;
}): BriefInput {
  if ((input.path === undefined) === (input.text === undefined)) {
    throw new ToolRefusal('give exactly one of path and text');
  }
  return input.path === undefined ? { text: input.text ?? '' } : { path: input.path };
}

/** Runs a tool's body, turning every failure into an answer and mirroring the unexpected ones. */
async function answering(
  err: CliConsole['err'],
  body: () => Promise<ToolAnswer>,
): Promise<ToolAnswer> {
  try {
    return await body();
  } catch (cause) {
    if (cause instanceof ToolRefusal) return { content: [text(cause.message)], isError: true };
    const message = cause instanceof Error ? cause.message : String(cause);
    err(
      `tyto mcp: internal failure — ${cause instanceof Error ? (cause.stack ?? message) : message}\n`,
    );
    return { content: [text(`internal failure: ${message}`)], isError: true };
  }
}

/** Whether a path is inside the served folders, real path included (ADR 0179 decision 5). */
async function servedPath(session: McpSession, path: string): Promise<string | undefined> {
  const [cwd] = session.roots;
  if (cwd === undefined) return undefined;
  const confined = await confinedPath(path, cwd, session.roots);
  return confined.ok ? confined.path : undefined;
}

const acted = (answer: WindowActionAnswer): ToolAnswer =>
  answer.done ? { content: [text('done')] } : { content: [text(answer.reason)], isError: true };

/**
 * Builds the server with the tools this workspace's trust allows (ADR 0179 decision 3), and the
 * window's when a window serves them (ADR 0180).
 */
export function createMcpServer(
  session: McpSession,
  version: string,
  err: CliConsole['err'],
  window?: WindowPort,
): McpServer {
  const server = new McpServer({ name: 'tyto', version }, { capabilities: { tools: {} } });
  const offered = new Set(toolsFor(session.trust, { window: window !== undefined }));
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const offers = (name: McpToolName): boolean => offered.has(name);

  if (offers('list_templates')) {
    server.registerTool(
      'list_templates',
      {
        title: 'List templates',
        description:
          "Every template a brief in this folder can name: the project's, the built-in pack and installed plugins'. Name, version, description and format ids.",
        annotations: readOnly,
      },
      () => answering(err, async () => ({ content: [text(await session.listTemplates())] })),
    );
  }

  if (offers('describe_template')) {
    server.registerTool(
      'describe_template',
      {
        title: 'Describe a template',
        description:
          "One template's manifest: its formats with their sizes, its slots and adjustments, and the skeleton a new brief for it starts from.",
        inputSchema: z.object({
          name: z.string().describe('the template name or alias, as list_templates prints it'),
        }),
        annotations: readOnly,
      },
      ({ name }) =>
        answering(err, async () => ({ content: [text(await session.describeTemplate(name))] })),
    );
  }

  if (offers('check_brief')) {
    server.registerTool(
      'check_brief',
      {
        title: 'Check a brief',
        description:
          'Compiles a brief and returns its diagnostics with line and column. Checks structure, not fonts or remote images: nothing is fetched and no browser runs, so render_preview can still add font and image warnings. Writes nothing.',
        inputSchema: z.object(briefShape),
        annotations: readOnly,
      },
      (input, context) =>
        answering(err, async () => {
          const answer = await session.checkBrief(
            briefOf(input),
            input.template === undefined ? {} : { template: input.template },
            context.mcpReq.signal,
          );
          return {
            content: [text(answer)],
            ...(answer.status === 'error' ? { isError: true } : {}),
          };
        }),
    );
  }

  if (offers('render_preview')) {
    server.registerTool(
      'render_preview',
      {
        title: 'Preview a brief',
        description: `Renders one format of a brief to PNG and returns the images, at most ${String(PREVIEW_MAX_SIDE)} px on the longest side and at most four artworks, with the diagnostics. Writes nothing.`,
        inputSchema: z.object({
          ...briefShape,
          format: z.string().describe('the format id, as describe_template lists them'),
        }),
        annotations: readOnly,
      },
      (input, context) =>
        answering(err, async () => {
          const answer = await session.renderPreview(
            briefOf(input),
            {
              format: input.format,
              ...(input.template === undefined ? {} : { template: input.template }),
            },
            context.mcpReq.signal,
          );
          const { images, ...rest } = answer;
          return {
            content: [
              text({
                ...rest,
                images: images.map(({ png: _bytes, ...image }) => image),
              }),
              ...images.map((image): Content => ({
                type: 'image',
                data: Buffer.from(image.png).toString('base64'),
                mimeType: 'image/png',
              })),
            ],
            ...(images.length === 0 ? { isError: true } : {}),
          };
        }),
    );
  }

  if (window !== undefined) registerWindowTools(server, session, window, offers, err);

  return server;
}

/** The window's tools (ADR 0180): two reads of what is on screen, and two actions. */
function registerWindowTools(
  server: McpServer,
  session: McpSession,
  window: WindowPort,
  offers: (name: McpToolName) => boolean,
  err: CliConsole['err'],
): void {
  const onScreen = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const moves = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  if (offers('brief_in_front')) {
    server.registerTool(
      'brief_in_front',
      {
        title: 'The brief in front',
        description:
          'The document in front of the person in the Tyto window: its path, name, kind, the format its preview shows, and its text as it is in the editor, unsaved typing included. A document outside the served folders answers with its name only.',
        annotations: onScreen,
      },
      () =>
        answering(err, async () => {
          const front = await window.briefInFront();
          if (front === undefined) throw new ToolRefusal('no document is in front');
          if (front.path !== null && (await servedPath(session, front.path)) === undefined) {
            // Its name is on screen anyway; where it lives and what it says stay out (ADR 0179
            // decision 5).
            return {
              content: [
                text({ name: front.name, kind: front.kind, outside: true, path: null, text: null }),
              ],
            };
          }
          return { content: [text(front)] };
        }),
    );
  }

  if (offers('selection')) {
    server.registerTool(
      'selection',
      {
        title: 'The selection',
        description:
          'The ranges selected in the editor in front, lines and columns from 1, with the text each covers. A cursor with nothing selected is a range whose start and end are equal.',
        annotations: onScreen,
      },
      () =>
        answering(err, async () => {
          const front = await window.briefInFront();
          if (
            front !== undefined &&
            front.path !== null &&
            (await servedPath(session, front.path)) === undefined
          ) {
            throw new ToolRefusal('the document in front is outside the served folders');
          }
          const selected = await window.selection();
          if (selected === undefined) throw new ToolRefusal('no editor is in front');
          return { content: [text(selected)] };
        }),
    );
  }

  if (offers('open_file')) {
    server.registerTool(
      'open_file',
      {
        title: 'Open a file in a tab',
        description:
          'Opens a file of the served folder in a tab of the Tyto window. The person may be asked first, and may decline (setting agents.windowActions). Writes nothing.',
        inputSchema: z.object({
          path: z
            .string()
            .describe('the file, relative to the folder served, or absolute inside it'),
        }),
        annotations: moves,
      },
      ({ path }) =>
        answering(err, async () => {
          const served = await servedPath(session, path);
          if (served === undefined) {
            throw new ToolRefusal(
              `${path} is outside the folder served and its workspace, or does not exist (ADR 0179)`,
            );
          }
          return acted(await window.openFile(served));
        }),
    );
  }

  if (offers('show_format')) {
    server.registerTool(
      'show_format',
      {
        title: 'Show a format in the preview',
        description:
          "Shows one format of the brief in front in the window's preview. The person may be asked first, and may decline (setting agents.windowActions). Writes nothing.",
        inputSchema: z.object({
          format: z.string().describe('the format id, as describe_template lists them'),
        }),
        annotations: moves,
      },
      ({ format }) => answering(err, async () => acted(await window.showFormat(format))),
    );
  }
}

/** Serves until the client closes its end, or `signal` fires. */
export async function serveMcp(
  session: McpSession,
  stdio: CliStdio,
  options: {
    readonly version: string;
    readonly err: CliConsole['err'];
    readonly signal?: AbortSignal;
    /** The window serving these tools, when one does (ADR 0180). */
    readonly window?: WindowPort;
  },
): Promise<void> {
  const server = createMcpServer(session, options.version, options.err, options.window);
  const transport = new StdioServerTransport(stdio.input, stdio.output);
  const closed = new Promise<void>((resolve) => {
    transport.onclose = resolve;
  });
  transport.onerror = (cause) => {
    options.err(`tyto mcp: ${cause.message}\n`);
  };
  const stop = (): void => {
    void server.close();
  };
  options.signal?.addEventListener('abort', stop, { once: true });
  try {
    await server.connect(transport);
    // The transport only adds a `data` listener, which does not start a stream paused on
    // purpose: the window's connection is, after its handshake was read (`readFirstLine`, ADR
    // 0180). On stdin it changes nothing.
    stdio.input.resume();
    await closed;
  } finally {
    options.signal?.removeEventListener('abort', stop);
  }
}
