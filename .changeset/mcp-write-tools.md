---
'@tyto/command-line': minor
---

`tyto mcp` offers three tools that write, to a trusted workspace only (ADR 0185): `write_brief`
creates or replaces a `.brief` (a dry run shows the diff and the hash a replacement must name;
a brief in a folder a live window has open is not replaced), `new_delivery` makes a delivery as
`tyto delivery new` does, and `export` renders into a preset's folder, the delivery's or the
workspace's `output`, never a folder the agent names.
