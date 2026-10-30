---
'@tyto/io': minor
---

A delivery's export copies the brief's images into its assets folder (TYTO-499, ADR 0161). `fsDeliveryExportOutput` gains `deliverAssets(assets)`: every image the brief resolved that is not already inside the assets folder the brief reads (`../assets` from `editaveis/`, otherwise `assets/` beside the brief, `deliveryAssetsFolder`) is copied there, a fetched one under ADR 0118's name. Nothing in that folder is removed or replaced: a same-named file with the same bytes is skipped in silence, one with other bytes is kept with `W_DELIVERY_ASSET_KEPT`. `recordingAssetResolver` and `DeliveredAsset` are back, to record what a run resolved.
