---
'@tyto/command-line': minor
'@tyto/desktop': minor
'@tyto/editor': minor
---

TYTO-566: an agent's edit arrives as a proposal (ADR 0180 decision 5). `propose_edit` shows an
edit of the document in front, struck-through and inserted text under an Accept / Reject bar;
accepted, it is one undo step and saves nothing, and typing in it makes it stale.
`proposal_status` tells the agent how it ended. `@tyto/editor` gains the `proposals` extension.
