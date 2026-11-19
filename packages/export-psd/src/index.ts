/**
 * @tyto/export-psd — a guide frame of the `Scene` to one layered PSD (ADR 0220, ADR 0221).
 *
 * Receives only the IR: the frame's `guide` says which layers there are, in which order,
 * locked, hidden or faded, and each painted layer's `raster` names pixels the host decodes
 * and hands over through `PsdResources`, bound at registration. The file is written by
 * `ag-psd`, with no canvas.
 *
 * Pure: no Node, no DOM (ADR 0010). It builds bytes.
 */

export { type CompositeLayer, type RgbaPixels, compositeOver } from './composite.js';

export { type PsdExportOptions, type PsdResources, exportFramePsd } from './export-psd.js';

export { type PsdExporterPluginOptions, psdExporterManifest, psdExporterPlugin } from './plugin.js';
