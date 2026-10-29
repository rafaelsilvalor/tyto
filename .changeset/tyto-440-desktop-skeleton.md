---
'@tyto/editor': minor
'@tyto/desktop': minor
---

TYTO-440: the desktop's New brief from template and "/" menu write what a plugin file's configuration says about a new brief. `templates:list` rows carry `configured` (the configuration's `skeleton`, `formats` and the slots it fills) for the template's own name and each alias. `@tyto/editor`'s `briefSkeleton` takes it as `SkeletonManifest.configured`: a configured skeleton is written whole, its `template:` line naming the row picked; without one, the computed skeleton uses the configured formats and leaves out the filled slots. The window shows `W_SLOT_OVER_CONFIGURED_LIMIT` like any other warning. The manual's Plugins page says so in both editions.
