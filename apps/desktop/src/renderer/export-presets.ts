import { type CommandRegistry } from '@tyto/editor';

import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';
import { type Locale, translate } from '../../shared/i18n/index.js';

import { presetCommandId, presetOfCommand } from './commands.js';

/**
 * Export presets in the window (TYTO-270, ADR 0126): one command per preset, and the export
 * request each one makes.
 *
 * Main reads the presets with the project file and sends them in the `workspace:folder` answer,
 * folders already resolved and confined; the window only names them and runs the export it
 * already has. Kept apart from `main.ts` so the id, the title and the request are pinned by a
 * test that needs no window.
 */

export type ExportPresetView = IpcResponse<'workspace:folder'>['exportPresets'][number];

/** "Export: entregas": the catalogue's word, then the name as the project file wrote it. */
export function presetCommandTitle(locale: Locale, id: string): string | undefined {
  const name = presetOfCommand(id);
  return name === undefined ? undefined : `${translate(locale, 'command.export.preset')}: ${name}`;
}

/**
 * One command per preset, registered into `registry`, and the function that takes them all
 * down again. `run` is handed the preset the command names, as it was when it was registered.
 */
export function registerPresetCommands(
  registry: CommandRegistry,
  presets: readonly ExportPresetView[],
  run: (preset: ExportPresetView) => void,
): () => void {
  const disposals = presets.map((preset) =>
    registry.register({
      id: presetCommandId(preset.name),
      // The name, untranslated; the title puts the catalogue's word in front at display time.
      label: preset.name,
      run: () => {
        run(preset);
      },
    }),
  );
  return () => {
    for (const dispose of disposals) dispose();
  };
}

/**
 * The `export:start` request a preset makes for the brief in front: its formats, one output
 * per file type, and its folder. Nothing else is chosen here: quality and scale are each
 * exporter's defaults, as the export box's are before anybody moves them.
 */
export function presetExportRequest(
  preset: ExportPresetView,
  documentId: string,
  brief: string,
): IpcRequest<'export:start'> {
  return {
    documentId,
    brief,
    directory: preset.folder,
    outputs: preset.types.map((kind) => ({ kind })),
    formats: [...preset.formats],
  };
}

/** Whether two answers name the same presets, so an unchanged answer re-registers nothing. */
export function samePresets(
  before: readonly ExportPresetView[],
  after: readonly ExportPresetView[],
): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}
