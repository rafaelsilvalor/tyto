import type { BriefSource, BriefTask } from '@tyto/io';

/**
 * The queue's inbox, with its listings and its acknowledgements kept apart (TYTO-239).
 *
 * On Windows `fsInbox`'s `ack` is a rename of `inbox/<id>/`, and the rename fails with `EPERM`
 * while any file inside is open. Every `pull` opens every `brief.brief` in the inbox, so the
 * queue's own readers — the sweep, `view()` on each `queue:changed`, `run()` — were holding the
 * very brief the queue was moving: 25 acknowledges in 300 failed with the sweep running, 0 in
 * 300 alone (TYTO-198). `fsInbox` retries a locked rename for 310 ms, which hid the race; this
 * removes it, so the retry is left for locks held from outside Tyto (an indexer, an antivirus,
 * an Explorer window on the folder).
 *
 * The rule is a readers–writer one, and it is the whole design:
 *
 * - **Listings share.** Any number of `pull`s may run together; they only read.
 * - **An `ack` is alone.** It waits for the listings already running to finish, and every
 *   listing asked for while it waits or runs starts only after it — so no brief is open when
 *   the rename happens, and a stream of `view()`s cannot starve it.
 * - **Acks queue behind each other.** Two never overlap, and a listing waits for all of them.
 *
 * Only what goes through this object is ordered. A `tyto watch` on the same folder is another
 * process with its own `fsInbox`; that race is the one-consumer rule `queue.ts` documents.
 */
export function gateInbox(inbox: BriefSource): BriefSource {
  /** The listings running now, which an `ack` must outlast. */
  const reading = new Set<Promise<unknown>>();
  /** The `ack` running or waiting to run, which every new listing and `ack` waits behind. */
  let writing: Promise<void> | undefined;

  const settled = (work: Promise<unknown>): Promise<void> =>
    work.then(
      () => undefined,
      () => undefined,
    );

  return {
    async pull(): Promise<readonly BriefTask[]> {
      // A loop rather than one wait: another `ack` may have started while this one waited.
      // Nothing yields between the last check and `reading.add`, so no `ack` can slip in.
      while (writing !== undefined) await settled(writing);
      const listing = inbox.pull();
      reading.add(listing);
      try {
        return await listing;
      } finally {
        reading.delete(listing);
      }
    },

    async ack(id: string): Promise<void> {
      while (writing !== undefined) await settled(writing);
      // Taken at once, before any `await`, so a listing asked for from here on waits.
      const own = (async () => {
        await Promise.all([...reading].map(settled));
        await inbox.ack(id);
      })();
      const mine = settled(own);
      writing = mine;
      try {
        await own;
      } finally {
        // Only its own: a later `ack` may already hold the gate by the time this runs.
        if (writing === mine) writing = undefined;
      }
    },
  };
}
