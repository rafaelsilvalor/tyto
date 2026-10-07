---
'@tyto/io': major
'@tyto/core': minor
'@tyto/cli': patch
'@tyto/desktop': patch
---

A file sitting where a delivery needs a folder is now an error diagnostic instead of a crash
(TYTO-129). `fsDeliveryOutput` returns `Result<DeliveryOutput, Diagnostic[]>` instead of
throwing when a file holds the name of the delivery folder or of `editaveis/`, and
`deliverAssets` answers a file holding `assets/` the same way. Both use the new code
`E_DELIVERY_FOLDER_BLOCKED`, which names the path. A folder that really cannot be written to
(no permission, full disk) still throws.

**Breaking for `@tyto/io` callers:** check `.ok` on what `fsDeliveryOutput` returns before you
use the output.

`tyto render --folder` exits 1 with that diagnostic, where it used to exit 2 with a stack
trace, so a caller that follows the render contract no longer retries forever. The desktop
export box shows it under "Finished with problems" instead of the raw `ENOTDIR` text.
