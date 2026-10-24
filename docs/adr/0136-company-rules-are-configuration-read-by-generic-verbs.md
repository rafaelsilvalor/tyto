# 0136 — Company rules are configuration read by generic verbs

Status: accepted · 2026-10-24 · TYTO-394 · amends ADR 0128; builds on ADR 0111, ADR 0112,
ADR 0127, ADR 0129, ADR 0133 and ADR 0135.

## Context

TYTO-391 moved Buraqueira's company rules (which kind a task title is, how a deliverable is
named, which Drive links are the company's documents) into a private plugin, and reached
parity with the Python reference. On 2026-10-24 the maintainer decided there will be no private
plugin: Tyto has to work with any company's sensitive data, so the **tools stay generic and the
rules become configuration** that sits next to the recipe. The private plugin stays as the
reference the generic verbs are measured against, until they replace it.

Nearly every rule it holds is "this text matches that pattern". A pattern read from a file a
colleague shared is input, not code, and a regular expression is the one piece of input that
can make matching take exponential time. So the decision needs a dialect with a guard before it
needs any verb.

## Decision

1. **New generic verbs join the closed vocabulary of ADR 0128**: `rules`, `extract`,
   `rewrite`, `compose`, `collect`, `urls`, `nearest`, `map`, `path` and `age`. They are
   Tyto's, so their names are bare (ADR 0135 decision 3); each arrives with its own card.
2. **Configuration is JSON in the workspace, read through a host port.** A verb names it as
   `@./file.json#/pointer` (a JSON Pointer into the file) and the host answers through
   `resolveData`. It is data and is never executed. In a restricted workspace it is withheld
   (ADR 0111), and its path is confined to the workspace as ADR 0112 confines a place.
3. **The pattern dialect is `tyto-pattern/1`**, compiled by `compilePattern` in `@tyto/recipe`:
   JavaScript syntax, always the flags `iu`. `\b`, `\w` and `\d` are rewritten to their
   Unicode meaning, as Python 3 reads them and as the private plugin's `pythonRegex` did;
   `\B`, `\W` and `\D` are rewritten to match. `\b` inside a class stays a backspace, and `\W`
   inside a class is refused, because a class cannot hold its Unicode form without the `v`
   flag.
4. **A guard refuses at compile time what can make matching time unbounded**:
   backreferences (`\1`, `\k<name>`), lookaround the author wrote (`(?=`, `(?!`, `(?<=`,
   `(?<!`; the Unicode `\b` is the only lookaround, and Tyto writes it), and nested
   quantifiers, meaning star height above one. A quantifier counts as repeating when it can
   match its atom in more than one length (`*`, `+`, `{n,}`, `{n,m}` with m above n and 1);
   `?` and `{n}` do not. A quantified anchor or boundary is refused too, since the rewrite would
   otherwise make it repeatable. **A pattern holds at most 512 characters, and a cell is cut at
   4,096 characters before it is tested.** Each refusal is a diagnostic at the construct's
   range: `E_RECIPE_PATTERN_UNSAFE` for the guard, `E_RECIPE_PATTERN` for an empty, too long or
   invalid pattern. Every verb that matches text compiles through this one function.
5. **`where` gains `matches "<pattern>"` and `not matches "<pattern>"`**, the one departure
   from JQL's vocabulary in its grammar. The pattern is compiled while the expression is read,
   so a refusal lands before any row is read. It tests the cell's text as written: case is
   ignored by the flag, accents are not, so a pattern names them (`p[áa]gina`).
6. **No plugin carries company rules**, and Tyto gains no code cell and no expression verb for
   them. ADR 0128's door for a sandboxed expression verb stays where it was.
7. **Stateful status sync** (writing what a rule decided back to the source) is a separate
   card, behind ADR 0129's plan.

## Consequences

- A shared recipe and its rules file remain safe to receive: the worst a pattern can do is be
  refused, and an accepted one meets at most 4,096 characters per cell.
- The guard is a scan, not a full parser. It is conservative where star height is concerned:
  `(\d{1,2}/)+` is refused although it is unambiguous, and the way out is to write the
  repetition once. Alternation that overlaps, as in `(a|a)*`, is not caught; with nested
  quantifiers gone it costs polynomial time, not exponential.
- A recipe's `{name}` placeholder no longer matches the braces of `\p{…}`, `\P{…}` and `\u{…}`,
  so a pattern's Unicode property is never read as an undeclared parameter.
- The private plugin's vocabulary patterns all compile under the guard (measured in TYTO-394);
  porting them is a matter of moving them into a rules file.
