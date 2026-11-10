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
  PROPOSAL_MAX_EDITS,
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

  registerWriteTools(server, session, offers, err);
  if (window !== undefined) registerWindowTools(server, session, window, offers, err);

  return server;
}

const dryRun = z.boolean().optional().describe('true: answer what would change and write nothing');

/**
 * The tools that write (ADR 0185), offered only in a trusted workspace (ADR 0179 decision 3).
 * Each can say what it would change first, with `dry_run`, and its annotations tell the agent's
 * host it changes files, so a host that asks before such a call asks the person.
 */
function registerWriteTools(
  server: McpServer,
  session: McpSession,
  offers: (name: McpToolName) => boolean,
  err: CliConsole['err'],
): void {
  const writes = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  };

  if (offers('write_brief')) {
    server.registerTool(
      'write_brief',
      {
        title: 'Write a brief',
        description:
          'Creates or replaces one .brief file inside the served folder; no other kind of file. Call it with dry_run first: it answers what would change, as lines (- removed, + added), and the sha256 of the file there now. Replacing a file needs replace set to that sha256, so a file someone changed since is refused as stale instead of overwritten. A file open in a Tyto window is not replaced: propose the edit in the window instead (tyto mcp --window, propose_edit).',
        inputSchema: z.object({
          path: z
            .string()
            .describe('the .brief file, relative to the folder tyto mcp was started in'),
          text: z.string().describe('the whole text of the brief'),
          dry_run: dryRun,
          replace: z
            .string()
            .optional()
            .describe('the sha256 a dry run answered for the file there; required to replace it'),
        }),
        annotations: writes,
      },
      (input) =>
        answering(err, async () => ({
          content: [
            text(
              await session.writeBrief({
                path: input.path,
                text: input.text,
                ...(input.dry_run === undefined ? {} : { dryRun: input.dry_run }),
                ...(input.replace === undefined ? {} : { replace: input.replace }),
              }),
            ),
          ],
        })),
    );
  }

  if (offers('new_delivery')) {
    server.registerTool(
      'new_delivery',
      {
        title: 'Make a delivery',
        description:
          "Makes a delivery as tyto delivery new does: a folder named after the piece of work, the folders the workspace's layout lists, and a brief in it, started from a template's skeleton when one is named. An existing folder is reused; an existing brief is never overwritten. dry_run answers the folders and the brief it would make.",
        inputSchema: z.object({
          name: z.string().describe("the delivery's name, usually its ticket"),
          template: z
            .string()
            .optional()
            .describe('start the brief from this template, as list_templates names it'),
          dry_run: dryRun,
        }),
        annotations: { ...writes, destructiveHint: false },
      },
      (input) =>
        answering(err, async () => ({
          content: [
            text(
              await session.newDelivery({
                name: input.name,
                ...(input.template === undefined ? {} : { template: input.template }),
                ...(input.dry_run === undefined ? {} : { dryRun: input.dry_run }),
              }),
            ),
          ],
        })),
    );
  }

  if (offers('export')) {
    server.registerTool(
      'export',
      {
        title: 'Export a brief',
        description:
          "Renders a brief's artwork to files, into a folder this workspace names: an export preset's folder (preset), the brief's delivery's exports folder (delivery), or else the workspace's output folder. The folder is never chosen by the caller. A preset and a delivery decide their own formats and types; otherwise formats narrow the brief's list and types default to png. Files already there with the same names are overwritten. dry_run answers the folder, formats and types and renders nothing.",
        inputSchema: z.object({
          path: z
            .string()
            .describe('the .brief file, relative to the folder tyto mcp was started in'),
          preset: z.string().optional().describe("an export preset's name, from the workspace"),
          delivery: z.boolean().optional().describe("true: export into the brief's delivery"),
          formats: z
            .array(z.string())
            .optional()
            .describe('format ids, as describe_template lists them'),
          types: z
            .array(z.string())
            .optional()
            .describe('png, jpeg, webp, svg, or a kind an installed exporter adds'),
          template: briefShape.template,
          dry_run: dryRun,
        }),
        annotations: writes,
      },
      (input, context) =>
        answering(err, async () => {
          const answer = await session.exportBrief(
            {
              path: input.path,
              ...(input.preset === undefined ? {} : { preset: input.preset }),
              ...(input.delivery === undefined ? {} : { delivery: input.delivery }),
              ...(input.formats === undefined ? {} : { formats: input.formats }),
              ...(input.types === undefined ? {} : { types: input.types }),
              ...(input.template === undefined ? {} : { template: input.template }),
              ...(input.dry_run === undefined ? {} : { dryRun: input.dry_run }),
            },
            context.mcpReq.signal,
          );
          return {
            content: [text(answer)],
            ...(answer.status === 'error' ? { isError: true } : {}),
          };
        }),
    );
  }
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

  const position = z.object({
    line: z.number().int().positive().describe('from 1'),
    column: z.number().int().positive().describe('from 1'),
  });

  if (offers('propose_edit')) {
    server.registerTool(
      'propose_edit',
      {
        title: 'Propose an edit',
        description: `Proposes a change to the text of the document in front of the person. Nothing is written: the change is shown in the editor, and the person accepts or rejects it, which can take minutes. This answers at once with the proposal's id; call proposal_status with that id afterwards to learn whether it was accepted, rejected or became stale. Positions are lines and columns from 1, as the selection tool answers them; each edit names the text it expects in its range, and the proposal is refused if any differs. One proposal per document at a time; at most ${String(PROPOSAL_MAX_EDITS)} edits, apart from one another. An accepted proposal is one undo step and leaves the file unsaved.`,
        inputSchema: z.object({
          edits: z
            .array(
              z.object({
                from: position,
                to: position,
                insert: z.string().describe('the new text; empty deletes the range'),
                expect: z.string().describe('the text the range holds now, as read'),
              }),
            )
            .min(1)
            .max(PROPOSAL_MAX_EDITS),
        }),
        annotations: moves,
      },
      ({ edits }) =>
        answering(err, async () => {
          const front = await window.briefInFront();
          if (front === undefined) throw new ToolRefusal('no document is in front');
          if (front.path !== null && (await servedPath(session, front.path)) === undefined) {
            throw new ToolRefusal('the document in front is outside the served folders');
          }
          const answer = await window.proposeEdit(edits);
          if (!answer.proposed) throw new ToolRefusal(answer.reason);
          return {
            content: [
              text({
                id: answer.id,
                status: 'proposed',
                next: 'call proposal_status with this id; the person may take minutes',
              }),
            ],
          };
        }),
    );
  }

  if (offers('proposal_status')) {
    server.registerTool(
      'proposal_status',
      {
        title: 'Where a proposal stands',
        description:
          'Whether a proposal from propose_edit is still waiting (proposed), was accepted, rejected, became stale because the person edited the same text, or is gone because its tab closed.',
        inputSchema: z.object({ id: z.string().describe('the id propose_edit answered') }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ id }) =>
        answering(err, async () => {
          const status = await window.proposalStatus(id);
          if (status === undefined) throw new ToolRefusal(`no proposal ${id} in this window`);
          return { content: [text({ id, status })] };
        }),
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
