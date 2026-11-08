# 0172 — `to-brief` writes one brief per row through ports the host lends

Status: accepted · 2026-11-08 · TYTO-380 · builds on ADR 0128, ADR 0129, ADR 0130, ADR 0111 and
ADR 0170

## Context

A recipe's table reaches the rest of Tyto only through `keep` (ADR 0130), which writes the table
itself. The card asks for the step Tyto exists for: each row becomes a brief in a chosen
template, so a campaign's issues become the briefs of its artwork. Four questions were open:

- The verb is Tyto's, so it lives in `@tyto/recipe`, which may not import Node (ADR 0010). Where
  do the templates and the files come from?
- A brief is a language with one escape (`\::`, ADR 0004). What happens to a value the language
  cannot hold?
- A brief overwrites a file a person may have edited by hand. What does Apply do when that file
  changed between the plan and the click?
- Where may it write?

TYTO-380 lands in two pull requests: this record, the pure pieces and the verb over fake ports;
then the file-system adapter, the desktop's wiring, the manual and the acceptance run.

## Decision

1. **`to-brief` is a generic sink, bare-named, over ports the host lends.**
   `to-brief template=<name> into=<folder> name=<column> slots=<slot>:<column>,…` (or
   `slots=@./file.json#/pointer`, a map of slot to column). `ToBriefPorts` names four things:
   `template(name)` answers core's `TemplateManifest`, `folder()` where the recipe sits in its
   workspace and whether that folder is restricted, `stat(path)` a digest of the host's choice or
   nothing, and `write(path, text)`. The host binds them to one run's workspace and recipe and
   passes them as `createVerbRegistry({ briefs })`, which `recipeRegistriesOf` forwards from its
   own `briefs` option. A host that lends none still has the verb in its vocabulary, and the
   verb says "this host writes no briefs" at its name.
2. **Running writes nothing; the plan is one `write` per row.** Its description is
   `<path>: new` or `<path>: overwrites`, its payload `{ path, text, before }`, where `before` is
   the digest the file had when the plan was made, or `null`. Paths are relative to the
   workspace with `/` separators; the adapter maps them onto the disk.
3. **Apply writes what the plan showed and checks each file first.** The verb keeps every plan
   it answered in a `WeakMap` by the plan object, as `shownPlans` does for a plugin's verb
   (ADR 0170), and writes from what it kept, never from the object's contents by then; a copy or
   another verb's plan is refused with `E_RECIPE_APPLY`. Before each write it asks `stat` again:
   a digest that is not `before` fails that operation with "changed since the plan", and the
   others still run. The person approved overwriting what they saw, not what is there now.
4. **It writes only inside a workspace, never into `.tyto`, never in a restricted folder.**
   `into` is read from the recipe's folder; an absolute path, a `..` that climbs above the
   workspace, and any segment named `.tyto` without regard to case are refused at `into=`. A
   recipe in no workspace, or in a restricted one (ADR 0111), plans nothing, and an Apply whose
   folder became restricted since the plan is refused whole before any write. These checks are
   lexical; the adapter confines the real path again after following links, as ADR 0111 and
   ADR 0112 already do for data files.
5. **A brief is written by `writeBrief` in `@tyto/brief-lang`, and parsed back before it is
   returned.** A value is brief text, so the Markdown a person put in a cell means what it
   means in a brief. A line starting with `::` is written `\::`, the only escape. **A value
   holding `{` or `}` is an error naming the row and the column**, never escaped or dropped: the
   language has no literal brace, and silently changing a person's data would hand them a brief
   that differs from their sheet. `rewrite` fixes the data first. Any other value the grammar
   cannot hold, such as an unpaired `*`, is found by the parse-back and named the same way.
   Spaces around a line and blank lines inside a value are not kept, since the language ignores
   them, and an empty value writes no directive, so the slot keeps the template's default.
6. **Names come from a column through core's `fileSafeName`**, the rule `artifactName` used
   privately until now and now calls, cut to 100 characters and given `.brief`. Two rows whose
   names fold to one file, without regard to case, are refused, naming both rows.
7. **Its own plan ceilings: 1,000 operations and 16 KB per payload** (`TO_BRIEF_PLAN_LIMITS`),
   passed to `checkPlan`. The payload carries the whole brief, which the 2,048 bytes of
   `PLAN_LIMITS` would not hold; a thousand briefs of 16 KB keep about 16 MB of plan, inside the
   20 MB ADR 0170 budgets for one.
8. **Unknown template, slot and column are refused at their argument**: `E_RECIPE_BRIEF` at
   `template=` and `slots=`, `E_RECIPE_UNKNOWN_COLUMN` for a column. `E_RECIPE_BRIEF` is the
   verb's one new code; up to eight problems are named per run.

## Consequences

- A table of a thousand rows can become a thousand briefs with one click, and a brief somebody
  edited after the plan is never overwritten without a new plan saying so.
- `@tyto/recipe` depends on `@tyto/brief-lang`, so the recipe package carries the brief parser.
  Both are pure, and the runner already ships beside the compiler. Both are published with the
  plugin contract (ADR 0149), so `CONTRACT_PACKAGES` now publishes `@tyto/brief-lang` before
  `@tyto/recipe`; the order ADR 0152 wrote down changes, not the list.
- A brace in data stops the plan until the recipe rewrites it. That is deliberate: a person
  reads the error once, where a silent change would be found in a published artwork.
- Required slots the mapping leaves out are not checked here: `tyto render` reports them on the
  brief, as for a brief written by hand.
- `fileSafeName` keeps `artifactName`'s rule exactly, accents collapsed to `-` included; Windows
  reserved names (`CON`, `NUL`) and a trailing dot are not handled by it yet.

## Note, 2026-11-08 (TYTO-380, second pull request)

The desktop lends the ports through `@tyto/io`'s `workspaceBriefPorts`, bound per run and per
Apply to the workspace and trust main's workspace answers then. Its digest is SHA-256 of the
file's bytes. `stat` and `write` both confine the real path with `confineToWorkspace`, following
the nearest existing ancestor, so a link to outside the workspace or into `.tyto` is refused
when the plan is made, before an Apply could reach it, and both refuse a folder that is not
trusted. Templates are looked up as the preview looks up a brief's `template:`, aliases
included. A recipe in no workspace still gets ports whose folder is nowhere, so the verb says
where it may write instead of "this host writes no briefs".
