---
'@tyto/desktop': patch
---

The Export dialog's **Formats** ticks are honoured when the brief lists formats (TYTO-332, ADR 0107). The list offers only the sizes on the brief's `formats:` line, and unticking one leaves it out of the export, where before every listed size was written whatever was ticked.
