import { redo as redoText, redoDepth, undo as undoText, undoDepth } from '@codemirror/commands';
import { Facet, type Text } from '@codemirror/state';
import { type EditorView } from '@codemirror/view';

import { SEARCH_COMMANDS } from './search.js';

/**
 * The Command pattern, as `docs/architecture.md` puts it in the editor: every action has an
 * id, keymaps map bindings to ids, and plugins will register their own through this same
 * registry (`docs/plugin-api.md`, `editor.command`).
 *
 * The id is the point. A binding, a menu item, a vim ex-command and — later — a plugin all
 * name the same string, so `:w` and Ctrl+S cannot drift into being two different saves.
 */

export interface CommandContext {
  readonly view: EditorView;
}

export type CommandStep = (context: CommandContext) => void;

export interface EditorCommand {
  /** Namespaced by convention: `editor.save`, `preview.toggleFormat`, `ai.caption`. */
  readonly id: string;
  /** What a menu or a command palette shows. Defaults to the id. */
  readonly label?: string;
  readonly run: CommandStep;
  /**
   * Restores what `run` changed **outside the document**, for commands that change
   * something the document does not hold — the active format, the open preview, a panel.
   *
   * A command that edits the document must not declare one. CodeMirror's history already
   * owns text, and a second undo for the same change would run both: the history would put
   * the characters back and then this would put them back again. `run` enforces it rather
   * than documenting it, because the symptom — an undo that overshoots by one — is
   * miserable to trace back to its cause.
   */
  readonly undo?: CommandStep;
}

/**
 * One entry of the undo stack, carrying the text history's depth as its clock.
 *
 * There is no second stack for text. `undoDepth` counts the events CodeMirror's own history
 * would undo, so recording it when a command runs is enough to know, later, whether
 * anything has been typed since — and therefore whether the next undo belongs to this
 * command or to the text.
 */
interface StackEntry {
  readonly command: EditorCommand;
  readonly undo: CommandStep;
  /** `undoDepth` immediately after the command ran. */
  readonly depth: number;
  /** `redoDepth` immediately after the command was undone. Set when it moves to the redo stack. */
  redoAt: number;
}

export interface CommandRegistry {
  /** Returns the function that unregisters it. Re-registering an id replaces it. */
  register(command: EditorCommand): () => void;
  get(id: string): EditorCommand | undefined;
  /** In registration order, which is the order a palette should show. */
  list(): readonly EditorCommand[];
  /** `false` when no command has that id — a binding for something not installed. */
  run(id: string, context: CommandContext): boolean;
  /**
   * Undoes the most recent thing, whether that was a command or a keystroke.
   *
   * This is what `Mod-z` is bound to, and it is the only undo a host should offer: calling
   * CodeMirror's directly would step over an app-level command sitting on top of the stack.
   */
  undo(context: CommandContext): boolean;
  redo(context: CommandContext): boolean;
}

export const EDITOR_UNDO = 'editor.undo';
export const EDITOR_REDO = 'editor.redo';

/**
 * Where an extension finds the registry.
 *
 * A facet and not a closure, because the things that need to reach it arrive with only an
 * `EditorView` in hand: a key binding, and a vim ex-command handler that the vim engine
 * calls through its own adapter.
 */
export const commandRegistryFacet = Facet.define<CommandRegistry, CommandRegistry | undefined>({
  combine: (values) => values[0],
});

export const commandRegistryOf = (view: EditorView): CommandRegistry | undefined =>
  view.state.facet(commandRegistryFacet);

const changedDocument = (before: Text, view: EditorView): boolean => !before.eq(view.state.doc);

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, EditorCommand>();
  const done: StackEntry[] = [];
  const undone: StackEntry[] = [];

  const registry: CommandRegistry = {
    register: (command: EditorCommand) => {
      commands.set(command.id, command);
      return () => {
        // Only if it is still the same one: a host that replaced a command should not have
        // the replaced registration's disposer remove the replacement.
        if (commands.get(command.id) === command) commands.delete(command.id);
      };
    },

    get: (id: string) => commands.get(id),

    list: () => [...commands.values()],

    run: (id: string, context: CommandContext) => {
      const command = commands.get(id);
      if (command === undefined) return false;

      const before = context.view.state.doc;
      command.run(context);

      const undoStep = command.undo;
      if (undoStep === undefined) return true;

      if (changedDocument(before, context.view)) {
        // A caller's bug, not a brief author's, so it throws rather than returning a
        // Result — the same line `sourceRange` draws in `core`.
        throw new TypeError(
          `Command '${id}' changed the document and declares an undo. CodeMirror's history ` +
            'already undoes text; declaring both would undo the change twice. Drop the undo, ' +
            'or stop editing the document in run.',
        );
      }

      done.push({ command, undo: undoStep, depth: undoDepth(context.view.state), redoAt: 0 });
      // A new action makes the redo branch unreachable, exactly as it does in a text history.
      undone.length = 0;
      return true;
    },

    undo: (context: CommandContext) => {
      const top = done.at(-1);
      // `<=` and not `===`: CodeMirror caps its history, so the depth recorded here can
      // outlive the events it counted. Preferring the command in that case undoes something
      // rather than nothing.
      if (top !== undefined && undoDepth(context.view.state) <= top.depth) {
        top.undo(context);
        done.pop();
        top.redoAt = redoDepth(context.view.state);
        undone.push(top);
        return true;
      }
      return undoText(context.view);
    },

    redo: (context: CommandContext) => {
      const top = undone.at(-1);
      if (top !== undefined && redoDepth(context.view.state) <= top.redoAt) {
        top.command.run(context);
        undone.pop();
        done.push({ ...top, depth: undoDepth(context.view.state) });
        return true;
      }
      return redoText(context.view);
    },
  };

  // Undo and redo are commands like any other, so a keymap has one kind of entry and a
  // plugin can rebind them. Neither declares an `undo` of its own: they move the stack
  // rather than adding to it.
  registry.register({
    id: EDITOR_UNDO,
    label: 'Undo',
    run: (context) => {
      registry.undo(context);
    },
  });
  registry.register({
    id: EDITOR_REDO,
    label: 'Redo',
    run: (context) => {
      registry.redo(context);
    },
  });

  // Find, replace and go to line, from `search.ts`. They are here rather than left to the
  // host because this package *can* run them — the commands are CodeMirror's — where
  // `editor.save` genuinely cannot be. None declares an `undo`: `replaceAll` edits the
  // document, and CodeMirror's history already owns text (see `EditorCommand.undo`).
  for (const command of SEARCH_COMMANDS) {
    registry.register({
      id: command.id,
      label: command.label,
      // The boolean is dropped. CodeMirror reads `false` as "not my turn, let the keystroke
      // travel", and a registry command is already past that decision — it was asked for by
      // id. `replaceAll` with no query set does nothing, which is the honest answer.
      run: (context) => {
        command.run(context.view);
      },
    });
  }

  return registry;
}
