# 0065 — Built-in templates draw placeholders without a kit, and a hashed guard keeps brand tokens out

Status: accepted · 2026-10-04 · TYTO-225 · follows ADR 0063 (a plugin contributes a brand kit),
part of epic TYTO-222

## Context

ADR 0063 let a plugin supply a brand's logo and signature, and left open what a template draws
when none is installed. The built-in templates still held both themselves: the logo's
geometry as a `Mark` token shared by the house's brands, the accounts' handles as strings in
the brand tokens, and the logo painted into the product banner's three backgrounds. The
repository is public and the templates stay public (epic TYTO-222); the art does not.

Removing the art once is not enough. A token deleted today comes back the next time somebody
pastes a reference into a test or a comment, and the reviewer who would notice is reading a
diff, not a brand book. A check has to notice, and the check cannot hold a plain list of what
it looks for, because that list is the content the check keeps out.

## Decision

### Placeholders, one place

`_casa/marks.ts` holds `PLACEHOLDER_LOGO` and `PLACEHOLDER_SIGNATURE`, and `_casa/kit.ts`
answers `logoOf(kit)` and `signatureOf(kit)`: the kit's field when it has one, the placeholder
otherwise, **each field on its own** — a kit with a signature only draws its signature and the
placeholder logo. Every built-in template of the house reads `context.brand` through these two,
so "what stands in" is decided once.

- **The logo placeholder is invented**, traced from nothing: a rounded rectangle with a round
  hole. Its `box` is the box the previous logo was drawn in, so every layout that sizes the
  logo by height gives the placeholder exactly the room the logo had. A kit's logo of another
  shape is what moves a neighbour, never the placeholder.
- **The signature placeholder is `@assinatura`**, shaped like a handle so a layout measured on
  one is exercised by a line of about the same length. Provisional; the maintainer chooses the
  words.
- **A line that is copy rather than a signature stays.** roxo's story signs off with a sentence
  pointing at the story's link; it is generic, and a kit's signature does not replace it.
- **Art painted into an image is painted out, and the logo drawn over it.** The banner's
  backgrounds lose the logo (and, in the square format, the lockup's wordmark); each format's
  layout gains the box the logo stood in, measured on the pixels before they were cleared, and
  the banner draws `logoOf(context.brand)` there.
- Drawn nodes are named for what they are — `logo` and `signature` — not for the brand's art.

### A guard that holds digests, not tokens

`tools/repo-checks/src/brand-tokens.test.mjs` reads every tracked text file and fails, naming
`path:line (kind)` and never the token, when a listed token appears. The list,
`brand-token-hashes.json`, holds SHA-256 digests of normalised tokens in two kinds:

- **`word`**: text is decomposed (NFD), stripped of accents, split at camelCase, lower-cased and
  cut into runs of letters and digits. Every run and every pair of adjacent runs is hashed, so
  a handle with its dot, a hyphenated template id, a camelCase identifier and a name wrapped
  across two lines are all read the same way.
- **`path`**: every run of path-data characters at least 40 long is cut into subpaths before
  each `M`/`m`, each normalised to one comma between numbers and none beside a command, and
  hashed. A logo joined into one `d`, split across string literals or pasted from an SVG file
  yields the same subpaths.

What is listed: the handles, the compound brand names as pairs, the vertical abbreviations as
they appeared in template ids, and the previous logo's subpaths. **What is not: any common
word alone.** The company's name is also Portuguese for "strategy", and the verticals are
common nouns; listing them alone would fail on any sentence about a study plan. So the name
is listed only as part of its compound forms and handles, and a test holds that a sentence
using it as "strategy" passes. The cost, stated: the bare name in a comment is not caught.

**A digest hides a token from a search, not from a guess.** A short token's SHA-256 is
brute-forced in seconds. The list buys that no plain copy sits in the tree for a reader or an
indexer to find; it is not a secret, and it is not meant to be one.

The plain list is kept out of the repository. Adding a token is hashing it with the module's
own `digest` after the same normalisation (`wordTokensOf` or `subpathsOf`) and appending the
digest under its kind.

## Consequences

- With no kit installed, every built-in template renders with placeholders in the boxes and
  positions the art had. With the private kit (TYTO-226), the kit's logo and signature.
- The kit's logo is one shape in one colour. Where the art had more — the banner's two-tone
  logo, the square banner's wordmark — a kit render draws less than the art did, until the kit
  schema grows a field for it. Not decided here.
- **Images are not scanned.** A brand mark painted into a PNG passes the guard; review is what
  catches it.
- History still holds everything removed here; rewriting it is TYTO-227.
- A false hit is fixed by rewording, or by removing the digest with a note in the pull request
  saying which kind it was and why it is generic.
