---
'@tyto/core': minor
'@tyto/recipe': minor
'@tyto/desktop': patch
---

`to-delivery` gains `keep=<field>,…`: for the named fields an empty incoming cell leaves the
record's value and its base as they are, the step's note warns on every run, and a plan line
written for another field says `kept: copy (source empty)`. `mergeDeliveryRecord` takes the kept
fields and names them in `held`. The desktop's recipe form shows the option's help in Portuguese.
