import type { Diagnostic } from '@tyto/core';
import type { BriefAnalysis, BriefAnalyzer } from '@tyto/editor';

import type { IpcResponse } from '../../shared/ipc.js';

/**
 * The editor's analysis, answered by the preview (TYTO-49).
 *
 * `briefLint` and `briefCompletion` read a `BriefAnalysis`: diagnostics for the gutter, the
 * manifest and the plugin directives for the list after `::`. The window already computes
 * all of it in main on every pause in typing — `brief:preview` runs parse, resolve with the
 * installed plugins' directives, and compile — so this analyzer runs nothing. It hands the
 * linter the answer the preview got for the same text. **One pass in main, not a second
 * analyzer in the renderer**, which is what keeps the underline, the problems panel and the
 * completion list from disagreeing about a template or a plugin.
 *
 * `analyze(source)` waits for the preview answer about exactly that text. That answer also
 * releases the waits queued **before** it — a debounced preview never compiles the text of
 * a keystroke it skipped — and CodeMirror's linter discards a result whose document has
 * moved on, so those are dropped rather than misdrawn. A wait queued after it keeps waiting:
 * handing newer text an older answer is the one way to put a squiggle on the wrong word.
 *
 * **All of that is per document since TYTO-286**, because two editor groups can show two briefs
 * at once and both lint. A wait belongs to the document its pane shows (`documentOf`), and an
 * answer releases only that document's waits: the queue of one brief is not drained by the
 * other's compile. Two panes on one document share its answers.
 */
export interface PreviewAnalysis {
  readonly analyzer: BriefAnalyzer;
  /** Called with every preview answer for a document some pane shows. */
  publish(documentId: string, answer: PublishedAnswer): void;
}

/** A preview answer, and the text it compiled — which is what its ranges index. */
export type PublishedAnswer = Pick<IpcResponse<'brief:preview'>, 'diagnostics' | 'completion'> & {
  readonly brief: string;
};

interface Wait {
  readonly documentId: string;
  readonly source: string;
  resolve(analysis: BriefAnalysis): void;
}

/** `documentOf` names the document a pane shows; a pane it does not know shares one queue. */
export function previewAnalysis(
  templates: () => readonly string[],
  documentOf: (view: object | undefined) => string | undefined = () => undefined,
): PreviewAnalysis {
  const latest = new Map<string, BriefAnalysis>();
  let waiting: Wait[] = [];
  const keyOf = (view: object | undefined): string => documentOf(view) ?? '';

  return {
    analyzer: {
      analyze(source, view) {
        const documentId = keyOf(view);
        const known = latest.get(documentId);
        if (known?.source === source) return Promise.resolve(known);
        return new Promise((resolve) => {
          waiting.push({ documentId, source, resolve });
        });
      },
    },
    publish(documentId, answer) {
      const analysis: BriefAnalysis = {
        source: answer.brief,
        // `info` is a severity the bridge allows and the catalog does not use; the lint
        // markers read `error` and `warning`, and the codes are the catalog's by the time
        // they cross.
        diagnostics: answer.diagnostics as readonly Diagnostic[],
        templates: templates(),
        directives: answer.completion.directives,
        ...(answer.completion.manifest === undefined
          ? {}
          : { manifest: answer.completion.manifest }),
      };
      latest.set(documentId, analysis);
      const mine = waiting.filter((wait) => wait.documentId === documentId);
      const last = mine.map((wait) => wait.source).lastIndexOf(answer.brief);
      if (last === -1) return;
      const released = new Set(mine.slice(0, last + 1));
      for (const wait of released) wait.resolve(analysis);
      waiting = waiting.filter((wait) => !released.has(wait));
    },
  };
}
