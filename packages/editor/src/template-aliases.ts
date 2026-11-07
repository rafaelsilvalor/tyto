/**
 * How a name that is an alias (ADR 0151, TYTO-433) is shown wherever a template is picked.
 *
 * An alias is a plugin file's name for a template under one configuration: `aviso-laranja`
 * renders `aviso` with `laranja`. Everywhere a person picks a name — the frontmatter's
 * `template:` completion here, "New brief from template…" and the "/" menu in the desktop —
 * the alias says what it stands for and sits right after that template (TYTO-467, TYTO-473).
 * Both rules live here, in the package every one of those places already imports, so the
 * three lists cannot drift apart.
 */

/** The template an alias renders and the configuration it selects. */
export interface TemplateAliasTarget {
  readonly template: string;
  readonly configuration: string;
}

/** The one quiet line an alias carries beside its name: `aviso · laranja`. */
export function templateAliasDetail(alias: TemplateAliasTarget): string {
  return `${alias.template} · ${alias.configuration}`;
}

/**
 * `rows` with each alias moved right after the template it stands for.
 *
 * Templates keep the order they came in, and so do the aliases of one template among
 * themselves. An alias whose template is not in the list has nothing to sit beside and keeps
 * its place at the end, in the order it came: dropping it would hide a name a brief can write.
 */
export function besideTheirTemplates<Row>(
  rows: readonly Row[],
  nameOf: (row: Row) => string,
  aliasOf: (row: Row) => string | undefined,
): Row[] {
  const templates = rows.filter((row) => aliasOf(row) === undefined);
  const present = new Set(templates.map(nameOf));
  const aliasesOf = new Map<string, Row[]>();
  const orphans: Row[] = [];
  for (const row of rows) {
    const target = aliasOf(row);
    if (target === undefined) continue;
    if (!present.has(target)) {
      orphans.push(row);
      continue;
    }
    const group = aliasesOf.get(target);
    if (group === undefined) aliasesOf.set(target, [row]);
    else group.push(row);
  }
  return [
    ...templates.flatMap((template) => [template, ...(aliasesOf.get(nameOf(template)) ?? [])]),
    ...orphans,
  ];
}
