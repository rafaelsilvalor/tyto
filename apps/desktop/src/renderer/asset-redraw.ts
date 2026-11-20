/**
 * Which open briefs compile again when the open folder changes on disk (TYTO-741).
 *
 * A brief's preview is compiled from its text, so a file it cites appearing beside it — a PNG
 * painted from its guide, `grafico.story.png` beside a cited `grafico.png` (ADR 0222) — changed
 * nothing the window would otherwise notice. Each preview answer names every file the compile
 * asked the asset folders for (`references`), and `explorer:changed` names the files of the
 * burst; a brief that asked for a file of a changed name compiles again.
 *
 * **By file name, not by path.** A reference is resolved against several folders in turn (the
 * brief's, its `assets/`, a delivery's, the project's stock), and the watcher names a path
 * relative to the open folder; their file names are what both sides say the same way. A brief
 * that asked for a `logo.png` compiles again for any `logo.png` that changes, which is one
 * compile more than needed, never one fewer. Compared without letter case, as the file systems
 * this window runs on most often do.
 */

/** The file name of a reference or a watched path, `/` and `\` both read as separators. */
export function fileNameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase();
}

/**
 * The documents to compile again for a burst of `names`. A `null` is an event that named
 * nothing, or the rest of a burst past the watcher's cap: every brief that asked for a file.
 */
export function briefsToRecompile(
  asked: ReadonlyMap<string, readonly string[]>,
  names: readonly (string | null)[],
): string[] {
  const unnamed = names.includes(null);
  const changed = new Set(
    names.filter((name): name is string => name !== null).map((name) => fileNameOf(name)),
  );
  const due: string[] = [];
  for (const [documentId, references] of asked) {
    if (references.length === 0) continue;
    if (unnamed || references.some((reference) => changed.has(fileNameOf(reference)))) {
      due.push(documentId);
    }
  }
  return due;
}
