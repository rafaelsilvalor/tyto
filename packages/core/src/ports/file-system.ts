/**
 * The filesystem, as the pure side of the codebase is allowed to see it.
 *
 * `TemplateRegistry` has to walk a folder of templates, and `core` may not import
 * `node:fs` (ADR 0010). So it takes this instead, and the adapter that implements it lives
 * in a Node package — or, later, over HTTP against a bucket, which is the whole point of
 * the boundary.
 *
 * `join` is part of the port rather than something a caller writes, because a separator
 * is the adapter's business: a pure package that concatenated with `/` would be guessing
 * about a platform it is not allowed to know it is running on.
 */

export interface DirectoryEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

/**
 * Reads only. Nothing in the pure side writes, and a port that cannot write is a port a
 * reviewer does not have to check for writes.
 *
 * Both reads reject rather than returning a `Result`. An unreadable path is the operating
 * system's answer, not a diagnostic the pure side could have predicted, and every runtime
 * this port will ever have an adapter for reports it by throwing. The callers in `core`
 * catch and turn it into a diagnostic at their own edge, which keeps the rule that a user
 * never sees an exception without making every adapter re-implement `Result`.
 */
export interface FileSystem {
  readDirectory(path: string): Promise<readonly DirectoryEntry[]>;
  readFile(path: string): Promise<string>;
  join(...segments: readonly string[]): string;
}
