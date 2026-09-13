---
'@tyto/core': minor
'@tyto/templates': minor
---

TYTO-66 find the built-in templates without being pointed at them

`loadTemplateRegistry` takes a search path instead of one root: `roots: string | readonly
string[]`, in precedence order, **earlier wins** (ADR 0020). The string form is unchanged
and behaves exactly as it did.

Two collisions, two answers. Two folders inside one root stays `E_TEMPLATE_DUPLICATE`,
because directory order is nobody's decision. The same name in a later root is the new
`W_TEMPLATE_SHADOWED`, on the `ok` branch, naming both folders — that order is one somebody
chose. A root listed twice is de-duplicated, so a folder cannot shadow itself. `Err` is now
reserved for _every_ root being unreadable; one bad root beside a good one is a failure on
that root.

`@tyto/templates` exports `BUILT_IN_TEMPLATES_DIRECTORY` and `BUILT_IN_TEMPLATE_NAMES`, and
adds `./package.json` to its `exports` so a composition root can locate the folder. The
package stays pure: it names its subfolder and reads nothing.

`tyto render` now finds `promo-curso` and `carrossel-lista` with no `--templates` flag, and
a project's own template of that name wins over the built-in.
