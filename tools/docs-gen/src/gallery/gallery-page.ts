import { type Adjustment, type FormatCatalogue, type Slot, pieceKinds } from '@tyto/core';

import { type Locale, code, generatedHeader, page, prose, table } from '../reference/markdown.js';
import { type GalleryTemplate, type Pack, galleryImagePath } from './pack.js';

const WORDS = {
  en: {
    title: 'Template gallery',
    intro: (templates: number, formats: number) =>
      `The templates that come with Tyto: ${String(templates)}, in ${String(formats)} formats. ` +
      'They are there to try Tyto and to test it with. The templates a team publishes with live ' +
      'in their own repositories, and a plugin file names them so Tyto fetches them: ' +
      '[Fetch templates from their own repositories](../command-line/plugins.md#fetch-templates-from-their-own-repositories) ' +
      'shows how. ' +
      'Each picture is the template drawing the example brief kept beside it, in the first ' +
      "format it lists, drawn without a brand kit: a plain shape stands where a brand's logo " +
      'goes and `@assinatura` where its signature goes. A brief names one of these in its ' +
      '`template:` line and fills the slots listed under it. The descriptions are written in the templates themselves, in English.',
    formats: 'Formats',
    formatsIntro:
      'The sizes a brief can ask for in its `formats:` line. A template draws only the formats ' +
      'it lists. [Formats](../briefs/formats.md) explains the names.',
    id: 'Id',
    size: 'Size',
    kind: 'Kind',
    label: 'Label',
    picture: (name: string, example: string, format: string) =>
      `${name}, drawing ${example} in the ${format} format`,
    brand: 'Brand',
    makes: 'Makes',
    inFormats: 'Formats',
    slots: 'Slots',
    adjustments: 'Adjustments',
    adjustmentsIntro: 'Written in braces after a directive, on the slots named here.',
    slot: 'Slot',
    adjustment: 'Adjustment',
    type: 'Type',
    accepts: 'Accepts',
    appliesTo: 'On',
    required: 'required',
    optional: 'optional',
    repeats: 'repeats: one artwork each',
    atMost: (count: number, unit: string) => `at most ${String(count)}${unit}`,
    atLeast: (count: number, unit: string) => `at least ${String(count)}${unit}`,
    characters: ' characters',
    oneOf: 'one of',
    byDefault: 'default',
    flag: 'on or off',
    text: 'text',
    image: 'a path to an image',
  },
  'pt-BR': {
    title: 'Galeria de templates',
    intro: (templates: number, formats: number) =>
      `Os templates que vêm com o Tyto: ${String(templates)}, em ${String(formats)} formatos. ` +
      'Eles servem para experimentar o Tyto e para testá-lo. Os templates com que uma equipe ' +
      'publica ficam nos seus próprios repositórios, e um arquivo de plugin os nomeia para o ' +
      'Tyto buscá-los: ' +
      '[Buscar templates nos seus próprios repositórios](../command-line/plugins.md#buscar-templates-nos-seus-proprios-repositorios) ' +
      'mostra como. ' +
      'Cada imagem é o template desenhando o brief de exemplo guardado junto dele, no primeiro ' +
      'formato que ele lista, desenhado sem kit de marca: uma forma simples ocupa o lugar do ' +
      'logo da marca e `@assinatura` o da assinatura. Um brief escolhe um deles na linha `template:` e preenche os slots ' +
      'listados abaixo dele. As descrições vêm escritas nos próprios templates, em inglês.',
    formats: 'Formatos',
    formatsIntro:
      'Os tamanhos que um brief pode pedir na linha `formats:`. Um template só desenha os ' +
      'formatos que ele lista. [Formatos](../briefs/formats.md) explica os nomes.',
    id: 'Id',
    size: 'Tamanho',
    kind: 'Tipo',
    label: 'Rótulo',
    picture: (name: string, example: string, format: string) =>
      `${name}, desenhando ${example} no formato ${format}`,
    brand: 'Marca',
    makes: 'Faz',
    inFormats: 'Formatos',
    slots: 'Slots',
    adjustments: 'Ajustes',
    adjustmentsIntro: 'Escritos entre chaves depois de uma diretiva, nos slots indicados aqui.',
    slot: 'Slot',
    adjustment: 'Ajuste',
    type: 'Tipo',
    accepts: 'Aceita',
    appliesTo: 'Em',
    required: 'obrigatório',
    optional: 'opcional',
    repeats: 'repete: uma arte para cada',
    atMost: (count: number, unit: string) => `no máximo ${String(count)}${unit}`,
    atLeast: (count: number, unit: string) => `no mínimo ${String(count)}${unit}`,
    characters: ' caracteres',
    oneOf: 'um de',
    byDefault: 'padrão',
    flag: 'ligado ou desligado',
    text: 'texto',
    image: 'o caminho de uma imagem',
  },
} as const;

type Words = (typeof WORDS)[Locale];

const size = (catalogue: FormatCatalogue, id: string): string => {
  const found = catalogue.sizeOf(id);
  return found === undefined ? '' : `${String(found.w)} × ${String(found.h)}`;
};

const values = (words: Words, list: readonly string[], fallback?: string): string =>
  `${words.oneOf} ${list.map(code).join(', ')}` +
  (fallback === undefined ? '' : ` (${words.byDefault} ${code(fallback)})`);

/** What a slot takes, in words: its kind of value, then every limit the manifest puts on it. */
function slotAccepts(words: Words, slot: Slot): string {
  const parts: string[] = [];
  if (slot.type === 'enum') parts.push(values(words, slot.values ?? [], slot.default));
  else parts.push(slot.type === 'image' ? words.image : words.text);
  if (slot.repeat) parts.push(words.repeats);
  // On a repeating slot the bounds count artworks, which "repeats: one artwork each" has
  // already said; on any other they count characters (docs/template-authoring.md).
  const unit = slot.repeat ? '' : words.characters;
  if (slot.min !== undefined) parts.push(words.atLeast(slot.min, unit));
  if (slot.max !== undefined) parts.push(words.atMost(slot.max, unit));
  return parts.join('; ');
}

function adjustmentAccepts(words: Words, adjustment: Adjustment): string {
  return adjustment.type === 'flag'
    ? words.flag
    : values(words, adjustment.values ?? [], adjustment.default);
}

function templateSection(words: Words, template: GalleryTemplate, formats: FormatCatalogue) {
  const { manifest, example, pictureFormat } = template;
  const pieces = pieceKinds(manifest, formats)
    .map((piece) => piece.kind)
    .filter((kind) => kind !== undefined);

  const facts = [
    manifest.brand === undefined ? '' : `**${words.brand}** ${code(manifest.brand)}`,
    pieces.length === 0 ? '' : `**${words.makes}** ${[...new Set(pieces)].join(', ')}`,
    `**${words.inFormats}** ${manifest.formats
      .map((id) => `${code(id)} (${size(formats, id)})`)
      .join(', ')}`,
  ].filter((fact) => fact !== '');

  const adjustments = Object.entries(manifest.adjustments);

  return [
    `## ${manifest.name}`,
    `![${prose(words.picture(manifest.name, example, pictureFormat))}](${galleryImagePath(manifest.name)})`,
    manifest.description === undefined ? '' : prose(manifest.description),
    facts.join(' · '),
    `**${words.slots}**`,
    table(
      [words.slot, words.type, '', words.accepts],
      Object.entries(manifest.slots).map(([name, slot]) => [
        code(name),
        code(slot.type),
        slot.required ? words.required : words.optional,
        slotAccepts(words, slot),
      ]),
    ),
    adjustments.length === 0 ? '' : `**${words.adjustments}** — ${words.adjustmentsIntro}`,
    adjustments.length === 0
      ? ''
      : table(
          [words.adjustment, words.type, words.appliesTo, words.accepts],
          adjustments.map(([name, adjustment]) => [
            code(name),
            code(adjustment.type),
            adjustment.applies.map(code).join(', '),
            adjustmentAccepts(words, adjustment),
          ]),
        ),
  ];
}

/** The gallery page of the manual's Templates section, for one edition. */
export function renderGalleryPage(pack: Pack, locale: Locale): string {
  const words = WORDS[locale];
  const formats = pack.formats.list();

  return page([
    generatedHeader('packages/templates/templates'),
    `# ${words.title}`,
    words.intro(pack.templates.length, formats.length),
    `## ${words.formats}`,
    words.formatsIntro,
    table(
      [words.id, words.size, words.kind, words.label],
      formats.map((format) => [
        code(format.id),
        size(pack.formats, format.id),
        format.kind === undefined ? '' : code(format.kind),
        prose(format.label ?? ''),
      ]),
    ),
    ...pack.templates.flatMap((template) => templateSection(words, template, pack.formats)),
  ]);
}
