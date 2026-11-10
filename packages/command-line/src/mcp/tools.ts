import type { Trust } from '@tyto/core';

/**
 * The closed list of tools `tyto mcp` offers an agent (ADR 0179).
 *
 * Closed: a tool is a name here before it is anything the server registers, and the server
 * registers exactly what {@link toolsFor} answers. A tool that reads changes nothing on disk and
 * starts no shell; a tool that writes changes a file. The split is the trust rule's whole input:
 * **a restricted workspace is offered no tool that writes** (ADR 0179 decision 3), so an agent
 * pointed at a folder nobody trusted can look and never change anything.
 *
 * A window serving the tools (ADR 0180) adds a third access in two kinds. `window-read` reads
 * what is on screen — the brief in front, the selection — and writes nothing, so it is offered
 * wherever a window serves, restricted folder included. `window-action` moves the window — opens
 * a tab, shows a format — and is offered only in a trusted workspace (ADR 0180 decision 7). The
 * stdio server has no window, so it offers neither.
 */

export type ToolAccess = 'read' | 'write' | 'window-read' | 'window-action';

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
  { name: 'write_brief', access: 'write' },
  { name: 'new_delivery', access: 'write' },
  { name: 'export', access: 'write' },
  { name: 'run_recipe', access: 'write' },
  { name: 'brief_in_front', access: 'window-read' },
  { name: 'selection', access: 'window-read' },
  { name: 'open_file', access: 'window-action' },
  { name: 'show_format', access: 'window-action' },
  { name: 'propose_edit', access: 'window-action' },
  { name: 'proposal_status', access: 'window-action' },
] as const satisfies readonly ToolEntry[];

export type McpToolName = (typeof MCP_TOOLS)[number]['name'];

export interface ToolsForOptions {
  /** Whether a window serves the tools; the stdio server has none. */
  readonly window?: boolean;
}

/** Whether a tool of this access is offered to a workspace of this trust, by this server. */
function offered(access: ToolAccess, trust: Trust, window: boolean): boolean {
  switch (access) {
    case 'read':
      return true;
    case 'write':
      return trust === 'trusted';
    case 'window-read':
      return window;
    case 'window-action':
      return window && trust === 'trusted';
  }
}

/** What the server registers for a workspace of this trust; outside any workspace, `restricted`. */
export function toolsFor(
  trust: Trust,
  options: ToolsForOptions = {},
  tools: readonly ToolEntry[] = MCP_TOOLS,
): readonly string[] {
  return tools
    .filter((tool) => offered(tool.access, trust, options.window === true))
    .map((tool) => tool.name);
}

/** The brief in front of the person, as the window answers `brief_in_front`. */
export interface BriefInFront {
  /** Its file, real and inside the served folders; null for a tab in no file. */
  readonly path: string | null;
  /** The tab's name, or null for a brief never saved. */
  readonly name: string | null;
  /** The text in the editor, typed and unsaved included. */
  readonly text: string;
  /** Whether that text differs from the file's. */
  readonly unsaved: boolean;
  /** `brief` for a brief; the tab's kind otherwise (`markdown`, `text`, `recipe`…). */
  readonly kind: string;
  /** The format the preview shows, when it shows one. */
  readonly format: string | null;
}

/** One selected range, lines and columns from 1, with the text it covers. */
export interface SelectedRange {
  readonly from: { readonly line: number; readonly column: number };
  readonly to: { readonly line: number; readonly column: number };
  readonly text: string;
}

/** What a window action came to: done, or not, and why in a sentence. */
export type WindowActionAnswer =
  { readonly done: true } | { readonly done: false; readonly reason: string };

/** The longest list of edits one proposal carries. */
export const PROPOSAL_MAX_EDITS = 50;

/** One edit an agent proposes, positions as `selection` answers them. */
export interface EditToPropose {
  readonly from: { readonly line: number; readonly column: number };
  readonly to: { readonly line: number; readonly column: number };
  /** The text that replaces the range; empty deletes it. */
  readonly insert: string;
  /** The text the agent believes the range holds; a mismatch refuses the proposal. */
  readonly expect: string;
}

/** Where a proposal stands (ADR 0180 decision 5). */
export type ProposalStatus = 'proposed' | 'accepted' | 'rejected' | 'stale' | 'gone';

/** A proposal shown, by its id, or why not. */
export type ProposalAnswer =
  | { readonly proposed: true; readonly id: string }
  | { readonly proposed: false; readonly reason: string };

/**
 * What a window lends the tools (ADR 0180): the state the person sees, and the two actions. The
 * window owns how an action is asked for (`agents.windowActions`); paths reach it already
 * confined to the served folders.
 */
export interface WindowPort {
  /** Undefined when no document is in front. */
  briefInFront(): Promise<BriefInFront | undefined>;
  /** The ranges selected in the editor in front; undefined when no editor is. */
  selection(): Promise<{ readonly ranges: readonly SelectedRange[] } | undefined>;
  openFile(path: string): Promise<WindowActionAnswer>;
  showFormat(format: string): Promise<WindowActionAnswer>;
  /** Shows an edit of the document in front for the person to accept or reject; never waits. */
  proposeEdit(edits: readonly EditToPropose[]): Promise<ProposalAnswer>;
  /** Where a proposal stands; undefined for an id this window never gave. */
  proposalStatus(id: string): Promise<ProposalStatus | undefined>;
}
