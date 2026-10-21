---
'@tyto/core': minor
'@tyto/io': minor
---

TYTO-278: a workspace folder's `.tyto/project.json` names its asset, template and font folders, its output folder and one section per plugin (ADR 0112). `core` resolves the file key by key from a list of sheets, so a work profile slots in later without a new signature, confines a restricted sheet's folders lexically and withholds its plugin sections (ADR 0111), and declares the `TrustStore` port. `@tyto/io` reads the file with ranges, follows every folder a restricted workspace names through `realpath` so a link inside that leads out is refused too, finds the workspace above a brief, never reads the folder whose `.tyto` is `TYTO_HOME`, and keeps approvals in `TYTO_HOME/trust.json` with `fsTrustStore`. `briefAssetResolver` takes the workspace's asset folders after the brief's own.
