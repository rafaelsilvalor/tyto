---
'@tyto/core': minor
---

`deliveryOfBrief(delivery, briefPath)` answers the delivery a brief is the brief of, or `undefined`: its name, its folder, where its artwork goes and where its report goes (TYTO-490, ADR 0157 §6). It is lexical and reads no disk. The new code `E_BRIEF_NOT_IN_DELIVERY` refuses a delivery's export of a brief in none. `E_DELIVERY_FOLDER_BLOCKED` is now worded for every export that makes a folder, not only a delivery.
