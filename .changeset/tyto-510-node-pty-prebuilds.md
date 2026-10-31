---
'@tyto/desktop': patch
---

TYTO-510: the packaged app carries node-pty's own prebuilt binaries on Windows and macOS instead of compiling them, so packaging there needs no C++ toolchain; macOS's spawn-helper is made executable when packing.
