---
'@tyto/core': minor
---

A failed read says which kind of file failed (TYTO-73).

`E_TEMPLATE_READ` was the code for reading anything at all. Three call sites emitted it and
only two of them read a template: `loadFormats` used it for a missing `formats.yaml`, which
is the project's file and belongs to nobody's template. The message was accurate — _"Could
not read 'formats.yaml': ENOENT"_ — so nothing on a terminal was ever misleading. The cost
landed on anything that reads the **code** rather than the sentence: a handler, a grep, and
the diagnostics panel E9.3 will need, which has to tell "your project is misconfigured"
apart from "this template is broken" because the two have different people fixing them.

So `formats.yaml` gets `E_FORMATS_READ`, next to the `E_FORMATS_SYNTAX` and
`E_FORMATS_SHAPE` it already had — read, then parse, then validate, three ways one file
fails, in the order it fails them. The card proposed `E_CONFIG_READ`; the catalogue already
names its families after the file, and inventing a second scheme for the same file would
have been the smaller mistake replacing the larger one.

`E_TEMPLATE_READ` keeps the two call sites that do read a template — a folder, a
`manifest.yaml`, a `template.html` — and its message now says so, which also settles a
second duplicate: it and `E_INPUT_READ` had byte-identical templates and no stated
difference. `codes.test.ts` now refuses any two codes that share a message, so the next one
fails in CI instead of being found by reading.

**Breaking for anything matching on the code.** A consumer watching for `E_TEMPLATE_READ` on
a missing `formats.yaml` now sees `E_FORMATS_READ`, and the rendered message for a real
template read gains the word "template".
