# 0176 — A recipe and its vocabulary are authored in the window, and the text stays the source

Status: accepted · 2026-11-11 · TYTO-402 · builds on ADR 0111, ADR 0112, ADR 0128, ADR 0132,
ADR 0135, ADR 0136 and ADR 0137

## Context

TYTO-402 asks that a person build a recipe from an empty folder inside the window: create it,
add and edit steps from a picker and a form, load one a colleague shared, and write the
vocabulary file its `rules`, `rewrite` and `map` steps read (ADR 0136). Until now a recipe opens
and runs as text cells (TYTO-377); nothing creates one, offers the verbs as choices or helps with
the vocabulary.

The card was written on premises the code no longer holds, read in the code on 2026-11-07 and
again on 2026-11-11:

- **There is no JSON-Schema engine to publish a schema to.** A `.json` file never opens in a tab:
  `TAB_EXTENSIONS` leaves it out, and ADR 0132 keeps it out by Rafael's decision of 2026-10-24,
  because `.json` is the app files' format. The JSON assistance the editor has
  (`packages/editor/src/json-assist.ts`) is answered by the host for the app's own files, not
  driven by a published schema.
- **The generic verbs declare no argument schema.** Each reads its arguments by hand. Only a
  contributed verb declares a closed `ArgumentSpec` list (ADR 0135), so a form cannot be
  generated from what the generic verbs declare today.
- **`recipe:verbs` answers names only**, and **`explorer:create` makes empty files**.
- A `run` line reads `<name>.recipe` in the recipe's own folder, so a data file of an included
  recipe can never be read from outside the workspace: the confinement of ADR 0137 holds as is.

The card lands in five pull requests: this record with the skeleton, the forms and
`referencesOf` in `@tyto/recipe`; `lintVocabulary` and its codes in `@tyto/recipe`; the New
recipe and New vocabulary entries and the vocabulary tab; the step picker and the forms; Load
recipe. Decision 5 is implemented by the second.

## Decision

1. **The text stays the source of truth.** A form writes one recipe line, and editing the line
   as text stays possible. `formatStep(verb, values)` writes the line a form describes and
   `valuesOfStep(verb, step)` reads a line back into the form's values. Every line `formatStep`
   answers parses and reads back as the values given; a value one line cannot carry, a line
   break or a double quote in a value that needs quoting (a recipe line has no quote escape),
   is refused with `E_RECIPE_FORM` and nothing is written. Such a value belongs in a vocabulary
   file, referred to by `@./file.vocab.json#/pointer`.
2. **Every generic verb has a form, held beside the verbs.** `GENERIC_VERB_FORMS` gives each
   verb's fields: name, kind (column, columns, expression, pattern, template, data reference,
   list, choice, flag…), where it sits on the line (a bare value, `name=value`, a flag word, the
   rest of the line, `compose`'s `<column>=<template>`, free `name=value` pairs), whether it is
   required and the value the verb assumes when it is blank. A field that may hold JSON written
   inline is written last, since that JSON runs to the end of the line. A test enumerates the
   registry, so a generic verb added without its form fails in CI. A contributed verb keeps its
   declared `ArgumentSpec` list (ADR 0135); `formOfArguments` reduces it to the same form.
3. **A new recipe is made to run.** `recipeSkeleton(name)` writes the header, one description
   line and one `param` with a default; it parses and runs as made, with no step yet.
4. **A vocabulary file is `<name>.vocab.json`, with three known sections.**

   ```jsonc
   {
     "rules": { "kinds": [{ "when": "title matches ^poster", "set": { "kind": "poster" } }] },
     "rewrites": { "noise": [{ "pattern": "^copy - ", "replace": "" }] },
     "lookups": { "status": { "todo": "TO DO" } },
   }
   ```

   Each known section maps a name to what one verb reads, checked by that verb's own Zod
   schema: `rules` a `rules` table, `rewrites` a `rewrite` list, `lookups` a `map` table. A
   recipe reads `@./company.vocab.json#/rules/kinds`. Any other top-level key is the team's own
   (stopwords, hosts, a graph) and gets only the generic lint: the pattern guard over every
   string under a key named `pattern`. The file is JSON with comments, read with the same
   options as a data file, so what lints is what a recipe reads.

5. **The vocabulary is linted where it is written.** `lintVocabulary(text)` reports every
   problem, not the first: syntax as `E_VOCABULARY_SYNTAX`, a section's shape as
   `E_VOCABULARY_SHAPE` at the entry, each rule's `when` through the filter grammar
   (`parseWhere`), each pattern through the guard (`compilePattern`), each template and each
   replacement through its reader, with the codes those readers already use. A problem inside a
   string points at the characters of the file: its range is mapped back through the JSON
   string's escapes, where `\\b` is two characters of the file and one of the pattern.
6. **Only `*.vocab.json` opens, as its own vocabulary tab.** Every other `.json` stays out of
   the tabs, which keeps ADR 0132's line for the app's files. The vocabulary tab's completion,
   hover and lint are answered by main from these functions, not by a schema engine.
7. **Load recipe copies into the workspace and never overwrites.** It copies the recipe, the
   recipes its `run` lines include and the data files its arguments name (`referencesOf`) into
   the folder the person chooses; a file already there is left alone and reported. Opening in
   place would give a recipe no data files beside it and no state. **A reference that leaves
   the source folder is reported, not followed** (ADR 0112): `../shared.json` is named in the
   report and never read.

## Consequences

- A form and the text cannot disagree: the form is filled from the line, and the line it writes
  is checked by the same parser that runs it.
- A value with both a blank and a double quote cannot be typed into a form; it goes into a
  vocabulary file, which is where ADR 0136 already sent rules and patterns.
- Adding a generic verb now means adding its form in the same pull request.
- With the lint, `@tyto/recipe` gains `jsonc-parser`, the reader `@tyto/io` already uses for
  data files, so the lint and the data resolver accept the same text.
- A team's own vocabulary keys are not shape-checked: only the verb that reads them knows their
  shape, and it reports a misshapen slice when the recipe runs.

## Alternatives considered

- **Publishing a JSON schema for `*.vocab.json`.** There is no engine to read one, and opening
  every `.json` as text to give it one would undo ADR 0132.
- **Opening a shared recipe in place.** It would read its data files from wherever it came from,
  outside the workspace's confinement, and keep its state nowhere.
- **Declaring an `ArgumentSpec` list on every generic verb.** The generic verbs take inline JSON,
  `compose`'s `<column>=<template>`, flag words and free pairs, which the closed schema of ADR
  0135 does not describe; widening it would change the plugin contract for a form's sake.
