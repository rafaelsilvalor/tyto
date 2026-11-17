---
'@tyto/core': minor
'@tyto/recipe': minor
'@tyto/plugin-api': minor
'@tyto/io': minor
'@tyto/desktop': minor
---

`deliveries` reads every delivery record under the project's `delivery.parent` back as one row
per delivery, keyed by the record's key, with `formats` as the text `to-delivery` reads, so a
recipe that writes the rows back plans nothing (ADR 0211). A record that does not read is a
`W_RECIPE_DELIVERY_RECORD` warning naming its folder. `to-delivery` takes
`inbound=<field>:<winner>,…`, the fields an outside value may change, each with a required
winner, `record` or `row`; `state` may be mapped only when it is declared inbound. In
`@tyto/core`, `mergeDeliveryRecord` takes the winners and names each both-changed field it
settles; `@tyto/io`'s `workspaceDeliveryPorts` gains `list`; `@tyto/plugin-api` re-exports
`DeliveryListing`; the window gains the step forms' Portuguese.
