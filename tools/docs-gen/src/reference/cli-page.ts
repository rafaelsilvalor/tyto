import { type CliEnvironment, createProgram } from '@tyto/command-line';
import { type Locale, code, generatedHeader, page, prose, table } from './markdown.js';

type Command = ReturnType<typeof createProgram>;

/**
 * The program `tyto` runs, built and never parsed. Building it only declares commands and
 * options; the environment is reached from an action, and no action runs here, so an empty one
 * stands in without a console, a disk or a browser behind it.
 */
function program(): Command {
  return createProgram({ version: '0.0.0' } as CliEnvironment, { code: 0 });
}

/** A command with no subcommands, with the words that reach it: `template check`. */
export interface LeafCommand {
  readonly path: string;
  readonly command: Command;
}

export function leafCommands(): readonly LeafCommand[] {
  const leaves: LeafCommand[] = [];
  const walk = (command: Command, path: readonly string[]): void => {
    for (const child of command.commands) {
      const childPath = [...path, child.name()];
      if (child.commands.length === 0) leaves.push({ path: childPath.join(' '), command: child });
      else walk(child, childPath);
    }
  };
  walk(program(), []);
  return leaves;
}

const WORDS = {
  en: {
    title: 'Command line',
    intro: (count: number) =>
      `Every command \`tyto\` takes: ${String(count)}. \`tyto --help\` and \`tyto <command> ` +
      '--help` print the same text in the terminal.',
    note: '',
    arguments: 'Arguments',
    options: 'Options',
    argument: 'Argument',
    option: 'Option',
    meaning: 'What it does',
    default: 'Default',
    required: 'required',
  },
  'pt-BR': {
    title: 'Linha de comando',
    intro: (count: number) =>
      `Todos os comandos que o \`tyto\` aceita: ${String(count)}. \`tyto --help\` e ` +
      '`tyto <comando> --help` imprimem o mesmo texto no terminal.',
    note:
      '::: info Ajuda em inglês\nA ajuda da linha de comando existe só em inglês, e esta ' +
      'página a mostra como o terminal a imprime.\n:::',
    arguments: 'Argumentos',
    options: 'Opções',
    argument: 'Argumento',
    option: 'Opção',
    meaning: 'O que faz',
    default: 'Padrão',
    required: 'obrigatória',
  },
} as const;

const shownDefault = (value: unknown): string =>
  value === undefined || value === false ? '' : code(JSON.stringify(value));

function section(leaf: LeafCommand, words: (typeof WORDS)[Locale]): string {
  const { command } = leaf;
  const synopsis = ['tyto', leaf.path, command.usage()].join(' ');
  const argumentsTable =
    command.registeredArguments.length === 0
      ? ''
      : `**${words.arguments}**\n\n${table(
          [words.argument, words.meaning],
          command.registeredArguments.map((argument) => [
            code(argument.required ? `<${argument.name()}>` : `[${argument.name()}]`),
            prose(argument.description),
          ]),
        )}`;
  const optionsTable =
    command.options.length === 0
      ? ''
      : `**${words.options}**\n\n${table(
          [words.option, words.meaning, words.default],
          command.options.map((option) => [
            code(option.flags),
            prose(
              option.mandatory ? `${option.description} (${words.required})` : option.description,
            ),
            shownDefault(option.defaultValue),
          ]),
        )}`;

  return [
    `## tyto ${leaf.path}`,
    prose(command.description()),
    `\`\`\`sh\n${synopsis}\n\`\`\``,
    argumentsTable,
    optionsTable,
  ]
    .filter((block) => block !== '')
    .join('\n\n');
}

export function renderCliPage(locale: Locale): string {
  const words = WORDS[locale];
  const leaves = leafCommands();
  return page([
    generatedHeader('packages/command-line/src/program.ts'),
    `# ${words.title}`,
    words.intro(leaves.length),
    words.note,
    ...leaves.map((leaf) => section(leaf, words)),
  ]);
}
