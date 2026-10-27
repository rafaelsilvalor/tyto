/**
 * A parent's decision, ported from Buraqueira's `decidir_pai` (`lib_status.py`) as an ordered
 * rules table over three counts of its children. The children's kinds are neutral: artwork
 * stands for the design, posting for social media, animation for motion, and ads and video for
 * the kinds that are not a posting.
 */
export const PARENT_RULES = [
  { when: 'open_artwork > 0', set: { decision: 'wait-artwork' } },
  { when: 'posting > 0 AND open_animation > 0', set: { decision: 'wait-animation' } },
  { when: 'posting > 0', set: { decision: 'post' } },
  { when: 'description ~ "card as a whole"', set: { decision: 'conclude' } },
  { when: '', set: { decision: 'none' } },
];

/**
 * Expiry is a recipe, not a mechanism (ADR 0144): `since` is stamped the first time a parent
 * waits and carried over from the store after that, because `storedAt` is re-stamped on every
 * write and cannot say since when. A parent that waited more than 720 hours (Buraqueira's 30
 * days) is forgotten and marked `expired`, which is how the run reports it; one that stops
 * waiting is forgotten at once.
 */
export const EXPIRY = [
  'recall waiting by=parent',
  'last waiting by=parent columns=since',
  'compose since="{last_since|}"',
  'stamp since when="decision ~ wait" format="yyyy-MM-dd HH:mm"',
  'age since format="yyyy-MM-dd HH:mm" into=waited',
  'rules into=still_waiting using=[{"when": "decision ~ wait AND waited <= 720", ' +
    '"set": {"still_waiting": "yes"}}, {"when": "decision ~ wait AND waited > 720", ' +
    '"set": {"still_waiting": "expired"}}]',
  'remember waiting by=parent columns=since,decision when="still_waiting = yes" ' +
    'forget-when="still_waiting != yes"',
];
