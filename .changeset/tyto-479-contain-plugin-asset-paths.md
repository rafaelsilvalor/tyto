---
'@tyto/core': minor
'@tyto/io': patch
'@tyto/cli': patch
'@tyto/desktop': patch
---

An installed plugin's code template can no longer make an export embed a file it was not handed (TYTO-479, ADR 0062). Before, a frame naming an image by an absolute `path`, or by an `id` leading out of the brief's folder, drew any image on the disk with no diagnostic. Every picture in such a frame must now be one the host sent that call — the template's own folder, or a ref in its context such as a slot's picture or a declared value — and any other costs the frame as the new `E_PLUGIN_TEMPLATE_ASSET`, naming the plugin, the template and the asset. The protocol stays 12.
