import type { Trust } from '@tyto/core';

/**
 * The closed list of tools `tyto mcp` offers an agent (ADR 0179).
 *
 * Closed: a tool is a name here before it is anything the server registers, and the server
 * registers exactly what {@link toolsFor} answers. A tool that reads changes nothing on disk and
 * starts no shell; a tool that writes changes a file. The split is the trust rule's whole input:
 * **a restricted workspace is offered no tool that writes** (ADR 0179 decision 3), so an agent
 * pointed at a folder nobody trusted can look and never change anything.
 */

export type ToolAccess = 'read' | 'write';

/** The longest side of a preview, in pixels: a full-size story frame is megabytes of base64. */
export const PREVIEW_MAX_SIDE = 1024;
/** Artworks a preview returns at most: a carousel's every slide would fill an agent's context. */
export const PREVIEW_MAX_IMAGES = 4;

/**
 * A tool's refusal: a sentence for the agent, never a stack. Here rather than beside the session
 * so the protocol half, which is its own lazy chunk, imports nothing heavier than this file.
 */
export class ToolRefusal extends Error {}

export interface ToolEntry {
  readonly name: string;
  readonly access: ToolAccess;
}

export const MCP_TOOLS = [
  { name: 'list_templates', access: 'read' },
  { name: 'describe_template', access: 'read' },
  { name: 'check_brief', access: 'read' },
  { name: 'render_preview', access: 'read' },
] as const satisfies readonly ToolEntry[];

export type McpToolName = (typeof MCP_TOOLS)[number]['name'];

/** What the server registers for a workspace of this trust; outside any workspace, `restricted`. */
export function toolsFor(trust: Trust, tools: readonly ToolEntry[] = MCP_TOOLS): readonly string[] {
  return tools
    .filter((tool) => tool.access === 'read' || trust === 'trusted')
    .map((tool) => tool.name);
}
