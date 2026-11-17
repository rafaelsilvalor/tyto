---
'@tyto/core': minor
---

A delivery may exist without a brief (ADR 0210): core gains the delivery record kept at
`editaveis/delivery.json`, its schema (`deliveryRecordSchema`), `parseDeliveryFormats` for
`feed:3,story:1`, and `mergeDeliveryRecord`, the field-by-field merge against what a recipe last
wrote, so a person's edit is kept and unchanged values plan nothing. The code
`E_RECIPE_DELIVERY` is added for the `to-delivery` sink that follows.
