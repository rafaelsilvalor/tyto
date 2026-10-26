/**
 * Makes this process's writes to one file take turns (TYTO-371).
 *
 * One host serves many callers at once — every frame of an export, every plugin process, every
 * recipe a window applies — and two writes to one file interleaved can leave a mix of both or
 * lose one of them. Each call to the returned function runs `work` after every earlier call
 * with the same `file` has settled, whether it succeeded or not. Another process can still
 * interleave with this one; each adapter says what that leaves.
 */
export function writeTurns(): <T>(file: string, work: () => Promise<T>) => Promise<T> {
  /** The last write queued per file. */
  const writing = new Map<string, Promise<unknown>>();
  return <T>(file: string, work: () => Promise<T>): Promise<T> => {
    const before = writing.get(file) ?? Promise.resolve();
    const done = before.then(work, work);
    const settled = done.then(
      () => undefined,
      () => undefined,
    );
    writing.set(file, settled);
    void settled.then(() => {
      if (writing.get(file) === settled) writing.delete(file);
    });
    return done;
  };
}
