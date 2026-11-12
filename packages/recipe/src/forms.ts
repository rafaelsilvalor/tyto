import type { ArgumentSpec } from './arguments.js';
import { RECIPE_VIEWS } from './notebook-views.js';
import type { VerbKind } from './registry.js';

/**
 * The fields of a step's form (ADR 0176). The generic verbs read their arguments by hand and
 * declare no schema; a contributed verb declares its closed `ArgumentSpec` list (ADR 0135).
 * A form is the one description both reduce to, so a host can draw a form for any verb and
 * `formatStep` can write the line it describes.
 */

/** What a field holds, which decides how a form offers it. */
export type FieldKind =
  /** One column of the table the step reads. */
  | 'column'
  /** Columns separated by commas: `key,status`. */
  | 'columns'
  /** Several words separated by blanks, each a name (`derive kind team`). */
  | 'words'
  /** A name the step introduces: a store, a prefix, a kept table. */
  | 'name'
  /** Another recipe of the same folder, by name. */
  | 'recipe'
  /** One of `values`. */
  | 'choice'
  /** A `where` expression. */
  | 'expression'
  /** A `tyto-pattern/1` pattern (ADR 0136). */
  | 'pattern'
  /** A `{column|filter}` template. */
  | 'template'
  /** Stamp formats separated by commas: `dd-MM HH:mm,dd-MM`. */
  | 'formats'
  | 'number'
  | 'date'
  | 'boolean'
  | 'text'
  /** Values separated by commas, or a data reference to a list of strings. */
  | 'list'
  /** A data reference, `@./file.vocab.json#/pointer`, or JSON when the field is `inline`. */
  | 'data'
  /** `name=value` pairs, as `run` hands parameters and `show` hands a view its arguments. */
  | 'pairs'
  /** A word that is there or not: `skip-empty`, `reverse`, `first`. */
  | 'flag';

/** Where a field's value sits on the line. */
export type FieldPlacement =
  /** A bare value, in the order the form lists its positional fields. */
  | 'positional'
  /** `name=value`. */
  | 'named'
  /** The field's name as a bare word when its value is `true`. */
  | 'flag'
  /** Everything after the verb, as written: `where`'s expression. */
  | 'rest'
  /** `compose`'s column, written before the `=` of its template. */
  | 'assignment-name'
  /** `compose`'s template, written after `<column>=`. */
  | 'assignment-value'
  /** Free `name=value` pairs, after every other named field. */
  | 'pairs';

export interface VerbField {
  readonly name: string;
  readonly kind: FieldKind;
  readonly placement: FieldPlacement;
  readonly required: boolean;
  /** What the form shows before the person types: the value the verb assumes when absent. */
  readonly default?: string;
  /** The only values accepted, for a `choice`. */
  readonly values?: readonly string[];
  /**
   * The field may hold JSON written inline. Inline JSON runs to the end of the line, so
   * `formatStep` writes such a value last and its words are never read as arguments.
   */
  readonly inline?: boolean;
  /** One sentence a form shows beside the field. */
  readonly help: string;
}

export interface VerbForm {
  readonly verb: string;
  readonly kind: VerbKind;
  readonly summary: string;
  /** A line the form writes, which `formatStep` reproduces from its own values. */
  readonly example: string;
  readonly fields: readonly VerbField[];
}

type FieldOptions = Partial<Pick<VerbField, 'default' | 'values' | 'inline'>>;

const positional = (
  name: string,
  kind: FieldKind,
  required: boolean,
  help: string,
  options: FieldOptions = {},
): VerbField => ({ name, kind, placement: 'positional', required, help, ...options });

const named = (
  name: string,
  kind: FieldKind,
  required: boolean,
  help: string,
  options: FieldOptions = {},
): VerbField => ({ name, kind, placement: 'named', required, help, ...options });

const flag = (name: string, help: string): VerbField => ({
  name,
  kind: 'flag',
  placement: 'flag',
  required: false,
  help,
});

const form = (
  verb: string,
  summary: string,
  example: string,
  fields: readonly VerbField[],
  kind: VerbKind = 'transform',
): VerbForm => ({ verb, kind, summary, example, fields });

/**
 * One form per generic verb, keyed by the verb. A test enumerates the registry, so a generic
 * verb added without its form fails there and not in a person's window.
 */
export const GENERIC_VERB_FORMS: Readonly<Record<string, VerbForm>> = Object.fromEntries(
  [
    form('run', 'Includes another recipe of this folder at this line.', 'run campaign-map', [
      positional('recipe', 'recipe', true, 'The recipe to include, by name.'),
      {
        name: 'parameters',
        kind: 'pairs',
        placement: 'pairs',
        required: false,
        help: 'Its parameters, as name=value.',
      },
    ]),
    form('where', 'Keeps the rows that satisfy an expression.', 'where status != done', [
      {
        name: 'expression',
        kind: 'expression',
        placement: 'rest',
        required: true,
        help: 'Predicates joined by AND, as in status = done AND team = print.',
      },
    ]),
    form('select', 'Keeps some columns, or drops some.', 'select key,title,status', [
      positional('columns', 'columns', false, 'The columns to keep, in order.'),
      named('without', 'columns', false, 'The columns to drop instead.'),
    ]),
    form(
      'join',
      'Pairs rows of one side with the rows of another on a key column.',
      'join task left="kind = ad" right="kind = task" on=code bring=key,status',
      [
        positional('prefix', 'name', true, 'Put before each column brought from the right row.'),
        named('left', 'expression', true, 'The rows that look for a partner.'),
        named('right', 'expression', true, 'The rows that are looked for, and consumed.'),
        named('on', 'column', true, 'The key both sides compare.'),
        named('bring', 'columns', false, "The right row's columns the left row receives."),
      ],
    ),
    form('sort', 'Sorts the rows by one column.', 'sort due desc', [
      positional('column', 'column', true, 'The column to sort by.'),
      positional('direction', 'choice', false, 'Ascending or descending.', {
        values: ['asc', 'desc'],
        default: 'asc',
      }),
    ]),
    form('derive', "Runs a plugin's derivations, in order.", 'derive kind', [
      positional('derivations', 'words', true, 'The derivations to run, by name.'),
    ]),
    form('show', 'Picks the view the notebook draws the table in.', 'show table', [
      positional('view', 'choice', true, 'The view.', {
        values: Object.keys(RECIPE_VIEWS),
        default: 'table',
      }),
      {
        name: 'options',
        kind: 'pairs',
        placement: 'pairs',
        required: false,
        help: "The view's arguments, as name=value.",
      },
    ]),
    form('keep', 'Writes the table into the workspace under a name.', 'keep open-tasks', [
      positional('name', 'name', true, 'Letters, digits, - and _.'),
    ]),
    form(
      'rules',
      'Classifies each row by an ordered table of rules.',
      'rules into=kind,label using=@./company.vocab.json#/rules/kinds',
      [
        named('into', 'columns', true, 'The columns the rules set.'),
        named('using', 'data', true, 'The rules table: a vocabulary reference or inline JSON.', {
          inline: true,
        }),
      ],
    ),
    form(
      'compose',
      'Writes one text column from a template.',
      'compose folder={course|slug}_{phase|slug} skip-empty',
      [
        {
          name: 'column',
          kind: 'column',
          placement: 'assignment-name',
          required: true,
          help: 'The column to write.',
        },
        {
          name: 'template',
          kind: 'template',
          placement: 'assignment-value',
          required: true,
          help: 'The template, or a data reference to one.',
        },
        flag('skip-empty', 'Drops an empty placeholder with the separator before it.'),
        flag('required', 'Leaves the cell empty when any placeholder is.'),
      ],
    ),
    form(
      'collect',
      "Gathers columns' values into one list column.",
      'collect keys from=first_key,second_key',
      [
        positional('column', 'column', true, 'The list column to write.'),
        named('from', 'columns', true, 'The columns to read, in order.'),
        flag('skip-empty', 'Leaves empty values out of the list.'),
      ],
    ),
    form(
      'extract',
      "Splits a cell into one column per named group of a pattern's match.",
      'extract title pattern=^(?<format>poster|flyer)-(?<theme>.+)$',
      [
        positional('column', 'column', true, 'The column to read.'),
        named('pattern', 'pattern', true, 'A pattern with named groups.'),
        named('into', 'columns', false, 'The columns to write, or a prefix ending in *.'),
      ],
    ),
    form(
      'rewrite',
      'Rewrites a column by an ordered list of pattern replacements.',
      'rewrite title into=clean using=@./company.vocab.json#/rewrites/noise',
      [
        positional('column', 'column', true, 'The column to read.'),
        named('into', 'column', true, 'The column to write.'),
        named('using', 'data', true, 'The replacements: a vocabulary reference or inline JSON.', {
          inline: true,
        }),
      ],
    ),
    form(
      'urls',
      'Gathers the links on listed hosts from columns, in precedence order.',
      'urls into=folder from=description,comments host=drive.example.com first',
      [
        named('into', 'column', true, 'The column to write.'),
        named('from', 'columns', true, 'The columns to search, in precedence order.'),
        named('host', 'list', true, 'The hosts, comma-separated, or a data reference.'),
        flag('first', 'Writes only the first link instead of a list.'),
      ],
    ),
    form(
      'nearest',
      'Brings each row columns of the most similar other row of its group.',
      'nearest copy within=parent among="team = copy" by=words(title) stopwords=a,the bring=key',
      [
        positional('prefix', 'name', true, 'Put before each column brought.'),
        named('within', 'column', true, 'Rows compare only with rows of the same value here.'),
        named('among', 'expression', true, 'The rows that may be chosen.'),
        named('by', 'text', true, 'The score, as words(<column>).'),
        named('stopwords', 'list', true, 'Words not counted, comma-separated, or a reference.'),
        named('min-length', 'number', false, 'The shortest word counted.', { default: '2' }),
        named('bring', 'columns', true, "The chosen row's columns to bring."),
      ],
    ),
    form(
      'map',
      'Translates a column by a lookup table.',
      'map status into=target using=@./company.vocab.json#/lookups/status',
      [
        positional('column', 'column', true, 'The column to translate.'),
        flag('reverse', 'Reads the table from value to key.'),
        named('also', 'data', false, 'A second table, consulted after the first.'),
        named('into', 'column', true, 'The column to write.'),
        named('using', 'data', true, 'The table: a vocabulary reference or inline JSON.', {
          inline: true,
        }),
      ],
    ),
    form(
      'path',
      'Writes the shortest walk between two columns through a graph.',
      'path from=status to=target avoid=CANCELLED into=steps graph=@./flows.json#/graph',
      [
        named('from', 'column', true, 'The column the walk starts at.'),
        named('to', 'column', true, 'The column the walk ends at.'),
        named('avoid', 'list', true, 'Nodes the walk never enters, or a data reference.'),
        named('into', 'column', true, 'The list column to write.'),
        named('graph', 'data', true, 'The graph: a data reference or inline JSON.', {
          inline: true,
        }),
      ],
    ),
    form(
      'age',
      'Writes the hours since a stamp.',
      'age done_at format="dd-MM HH:mm,dd-MM" year=infer-past into=age',
      [
        positional('column', 'column', true, 'The column holding the stamp.'),
        named('format', 'formats', true, 'Stamp formats tried in order, comma-separated.'),
        named('year', 'choice', false, 'Infers a missing year into the past.', {
          values: ['infer-past'],
        }),
        named('into', 'column', true, 'The number column to write.'),
        named('month-into', 'column', false, 'Also writes the month the stamp files under.'),
      ],
    ),
    form('last', 'Brings what the last applied run remembered.', 'last sync by=key', [
      positional('store', 'name', true, 'The store remember wrote.'),
      named('by', 'column', false, 'The column rows are found by, instead of their key.'),
      named('columns', 'columns', false, 'The stored columns to bring.'),
      named('prefix', 'name', false, 'Put before each column brought.', { default: 'last_' }),
    ]),
    form(
      'remember',
      "Asks for each row's values to be stored once the plan is applied.",
      'remember sync columns=status when="status_action != hold"',
      [
        positional('store', 'name', true, 'The store to write.'),
        named('columns', 'columns', true, 'The columns to store.'),
        named('by', 'column', false, 'The column rows are stored by, instead of their key.'),
        named('when', 'expression', false, 'The rows stored.'),
        named('forget-when', 'expression', false, 'The rows whose entries are deleted.'),
      ],
    ),
    form('recall', 'Appends a row for each stored key the table lacks.', 'recall sync', [
      positional('store', 'name', true, 'The store to read.'),
      named('by', 'column', false, 'The column keys are matched on.'),
      named('mark', 'column', false, 'A boolean column saying which rows were recalled.'),
    ]),
    form(
      'decide',
      'Decides which side of a sync wins, row by row.',
      'decide status local=sheet remote=tracker last=last_status tie=local',
      [
        positional('column', 'column', true, 'The column to write the decided value into.'),
        named('local', 'column', true, "The local side's value."),
        named('remote', 'column', true, "The remote side's value, mapped to local values."),
        named('last', 'column', true, 'What the last applied run left on the local side.'),
        named('values', 'list', false, 'The local values the sync recognises.'),
        named('first-run-wins', 'text', false, 'The value that wins when nothing is known.'),
        named('hold-when-empty', 'column', false, 'Holds a push where this column is empty.'),
        named('tie', 'choice', false, 'The side that wins when both changed.', {
          values: ['local', 'remote'],
          default: 'local',
        }),
        named('clear', 'choice', false, 'Whether a value cleared since the last run pushes.', {
          values: ['push', 'pull'],
          default: 'pull',
        }),
      ],
    ),
    form(
      'rollup',
      "Counts each parent row's children that an expression keeps.",
      'rollup open_children parent=parent when="ready = no"',
      [
        positional('column', 'column', true, 'The count column to write.'),
        named('parent', 'column', true, "The column holding a child's parent key."),
        named('when', 'expression', false, 'The children counted.'),
      ],
    ),
    form(
      'stamp',
      "Writes the run's time into the empty cells of the rows an expression keeps.",
      'stamp done_at when="status = done" format="dd-MM HH:mm"',
      [
        positional('column', 'column', true, 'The column to stamp.'),
        named('when', 'expression', true, 'The rows stamped.'),
        named('format', 'formats', true, 'The stamp format.'),
        named('clear-when', 'expression', false, 'The rows whose stamp is cleared.'),
      ],
    ),
    form('group', 'Collapses the table into one row per group.', 'group by=kind,team', [
      named('by', 'columns', true, 'The columns whose values make a group.'),
      named('into', 'column', false, "The list column of the members' keys.", {
        default: 'rows',
      }),
    ]),
    form('count', 'Counts the items of a list column.', 'count rows into=tasks', [
      positional('column', 'column', true, 'The list column to count.'),
      named('into', 'column', false, 'The number column to write.', { default: 'count' }),
    ]),
    form(
      'warn',
      'Reports each row an expression keeps as a warning of the run.',
      'warn when="status = blocked" message="{key|} is blocked"',
      [
        named('when', 'expression', true, 'The rows reported.'),
        named(
          'message',
          'template',
          true,
          'What the warning says of each row, or a data reference.',
        ),
      ],
    ),
    form(
      'to-brief',
      'Plans one brief per row in a template, written on Apply.',
      'to-brief template=poster into=briefs name=key slots=title:title',
      [
        named('template', 'text', true, 'The template the briefs use.'),
        named('into', 'text', true, 'The workspace folder the briefs go into.'),
        named('name', 'column', true, "The column naming each brief's file."),
        named('slots', 'list', true, 'slot:column pairs, comma-separated, or a data reference.'),
      ],
      'sink',
    ),
    form(
      'call',
      'Plans one POST per row to an allowed host, sent on Apply.',
      'call url=https://hooks.example.com/run token=routine body=@./call.json#/routine',
      [
        named('url', 'text', true, "The https address, on a host the workspace's project allows."),
        named('token', 'name', true, 'The stored credential sent as a bearer token.'),
        named('body', 'data', true, 'The JSON body, its strings {column} templates.', {
          inline: true,
        }),
      ],
      'action',
    ),
  ].map((entry) => [entry.verb, entry]),
);

/**
 * The form of a contributed verb, from the closed argument schema it declared (ADR 0135): a
 * positional argument is a bare value, every other one `name=value`, and its `values` a choice.
 */
export function formOfArguments(
  verb: string,
  kind: VerbKind,
  specs: readonly ArgumentSpec[],
  summary = '',
): VerbForm {
  const fields = specs.map((spec): VerbField => ({
    name: spec.name,
    kind: spec.values === undefined ? spec.type : 'choice',
    placement: spec.positional === true ? 'positional' : 'named',
    required: spec.required === true,
    ...(spec.values === undefined ? {} : { values: spec.values }),
    help: '',
  }));
  return { verb, kind, summary, example: '', fields };
}
