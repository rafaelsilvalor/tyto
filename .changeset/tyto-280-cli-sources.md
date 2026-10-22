---
'@tyto/cli': minor
'@tyto/io': minor
---

TYTO-280: `tyto render` and `tyto watch` draw images and fonts an installed plugin supplies (ADR 0117, ADR 0118). A `test:logo` image or a face no folder has is fetched once into `TYTO_HOME/cache/sources/`, and the next render asks nothing; a face that arrives makes the job compile once more, so its lines break against it. `tyto render` fetches for a trusted folder and for a brief in no folder; a restricted folder and `tyto watch` read the cache only, each miss saying why. A `--folder` delivery copies a fetched image under a name from its reference (`assets/logo.png`) and points the copied brief at it, so the delivery renders without the plugin. `@tyto/io`'s `sourceCache` takes the miss's reason as `notFetchedBecause`, and its delivery names fetched images that way.
