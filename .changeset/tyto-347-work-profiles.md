---
'@tyto/core': minor
'@tyto/io': minor
'@tyto/cli': minor
'@tyto/desktop': patch
---

TYTO-347: a workspace's `.tyto/project.json` can name a work profile, a sheet many folders share (ADR 0114). `"profile": "saude"` reads `TYTO_HOME/profiles/saude/profile.json`, trusted by where it lives; a path names a profile file elsewhere, which is its own source in `trust.json` and is confined to its own folder until it is trusted. The profile's keys come first and the folder's win key by key. `core` reads the key with `profileReferenceOf`, refuses a restricted folder a profile path outside it, ignores a profile's own `profile` key (`W_PROFILE_NESTED`), and says in `ResolvedProject.origins` which sheet each value came from; `W_PROJECT_PROFILE_UNSUPPORTED` is replaced by `W_PROJECT_PROFILE_INVALID` and `W_PROJECT_PROFILE_MISSING`. `@tyto/io`'s `loadWorkspace` reads the profile with its own trust answer and follows its paths through `realpath`. `tyto render` uses it, prints a profile's problems against the profile's file, `--trust` covers the folder and its profile for the run, and `tyto trust remove` takes a profile file's approval back. The window resolves a folder's profile through the same loader; showing it is the next change.
