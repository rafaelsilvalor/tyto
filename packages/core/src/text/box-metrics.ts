import type { FaceCache } from './face.js';
import { originOf, rememberOrigin } from './origin.js';
import type { TextNode } from '../scene/nodes.js';

/**
 * Each boxed run's face metrics, written into its box (ADR 0231).
 *
 * Here because this is where the faces are: the exporter is handed a URI per face and cannot
 * read one, so a box placed by the capitals needs their height in the Scene. A face that
 * cannot be read, or that declares no cap height, leaves the box without metrics, and the
 * exporter draws it over the glyph box and says so.
 */
export function withBoxMetrics(node: TextNode, faces: FaceCache): TextNode {
  if (!node.runs.some((run) => run.kind === 'text' && run.box !== undefined)) return node;
  return {
    ...node,
    runs: node.runs.map((run) => {
      if (run.kind !== 'text' || run.box === undefined || run.box.metrics !== undefined) {
        return run;
      }
      const face = faces.get({ family: run.font.family, weight: run.weight, style: run.style });
      const { ascent, descent, capHeight } = face ?? {};
      if (ascent === undefined || descent === undefined || capHeight === undefined) return run;
      const measured = { ...run, box: { ...run.box, metrics: { ascent, descent, capHeight } } };
      // A copy loses where it came from, and a W_TEXT_OVERFLOW on it should still point there.
      const origin = originOf(run);
      if (origin !== undefined) rememberOrigin(measured, origin);
      return measured;
    }),
  };
}
