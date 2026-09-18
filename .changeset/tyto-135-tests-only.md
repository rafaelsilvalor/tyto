---
---

TYTO-135 changed only `apps/desktop/e2e/`, which the bundle does not carry, so there is
nothing to release. Empty rather than a patch: the fix is a test reading a number instead
of repeating it, and a CHANGELOG entry about it would be noise in a file people read to
find out what the app does differently.

This is the first empty changeset here, and it exists because `apps/desktop` became a
versioned package in TYTO-94. Before that it was ignored, so a desktop-only pull request
needed no changeset at all and `changeset status` said nothing.
