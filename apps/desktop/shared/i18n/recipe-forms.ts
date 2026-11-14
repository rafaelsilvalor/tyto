import type { Locale } from './index.js';

/**
 * The recipe step forms' sentences in the window's other languages (TYTO-685).
 *
 * `@tyto/recipe` writes each generic verb's summary and each field's help in English and derives
 * a key from the verb's and the field's names (`formTexts`); it knows no language, as no pure
 * package does. This table is kept apart from the typed `Catalogue` on purpose: the English is
 * already written once, in `GENERIC_VERB_FORMS`, and an `en` copy here would only drift from it.
 * `recipe-forms.test.ts` holds the table to the forms in both directions, so a field added
 * without its Portuguese, or a Portuguese sentence left behind by a renamed field, fails there.
 *
 * A key with no entry shows the English sentence, which is what a plugin's verb gets: its names
 * carry a dot (`<namespace>.<verb>`) and never match a key here.
 */
const PT_BR: Readonly<Record<string, string>> = {
  'recipe.verb.run.summary': 'Inclui nesta linha outra receita desta pasta.',
  'recipe.verb.run.field.recipe.help': 'A receita a incluir, pelo nome.',
  'recipe.verb.run.field.parameters.help': 'Os parâmetros dela, como nome=valor.',

  'recipe.verb.where.summary': 'Mantém as linhas que satisfazem uma expressão.',
  'recipe.verb.where.field.expression.help':
    'Predicados unidos por AND, como em status = done AND team = print.',

  'recipe.verb.select.summary': 'Mantém algumas colunas, ou descarta algumas.',
  'recipe.verb.select.field.columns.help': 'As colunas a manter, na ordem.',
  'recipe.verb.select.field.without.help': 'As colunas a descartar, em vez disso.',

  'recipe.verb.join.summary':
    'Junta as linhas de um lado com as linhas de outro por uma coluna-chave.',
  'recipe.verb.join.field.prefix.help': 'Vai antes de cada coluna trazida da linha da direita.',
  'recipe.verb.join.field.left.help': 'As linhas que procuram um par.',
  'recipe.verb.join.field.right.help': 'As linhas procuradas, que são consumidas.',
  'recipe.verb.join.field.on.help': 'A chave que os dois lados comparam.',
  'recipe.verb.join.field.bring.help': 'As colunas da linha da direita que a da esquerda recebe.',

  'recipe.verb.sort.summary': 'Ordena as linhas por uma coluna.',
  'recipe.verb.sort.field.column.help': 'A coluna pela qual ordenar.',
  'recipe.verb.sort.field.direction.help': 'Crescente ou decrescente.',

  'recipe.verb.derive.summary': 'Roda as derivações de um plugin, em ordem.',
  'recipe.verb.derive.field.derivations.help': 'As derivações a rodar, pelo nome.',

  'recipe.verb.show.summary': 'Escolhe a vista em que o caderno desenha a tabela.',
  'recipe.verb.show.field.view.help': 'A vista.',
  'recipe.verb.show.field.options.help': 'Os argumentos da vista, como nome=valor.',

  'recipe.verb.keep.summary': 'Grava a tabela no workspace com um nome.',
  'recipe.verb.keep.field.name.help': 'Letras, dígitos, - e _.',

  'recipe.verb.rules.summary': 'Classifica cada linha por uma tabela ordenada de regras.',
  'recipe.verb.rules.field.into.help': 'As colunas que as regras preenchem.',
  'recipe.verb.rules.field.using.help':
    'A tabela de regras: uma referência de vocabulário ou JSON escrito na linha.',

  'recipe.verb.compose.summary': 'Escreve uma coluna de texto a partir de um modelo.',
  'recipe.verb.compose.field.column.help': 'A coluna a escrever.',
  'recipe.verb.compose.field.template.help': 'O modelo, ou uma referência de dados a um.',
  'recipe.verb.compose.field.skip-empty.help':
    'Tira um marcador vazio junto com o separador antes dele.',
  'recipe.verb.compose.field.required.help': 'Deixa a célula vazia quando algum marcador está.',

  'recipe.verb.collect.summary': 'Reúne os valores de colunas numa coluna de lista.',
  'recipe.verb.collect.field.column.help': 'A coluna de lista a escrever.',
  'recipe.verb.collect.field.from.help': 'As colunas a ler, na ordem.',
  'recipe.verb.collect.field.skip-empty.help': 'Deixa os valores vazios fora da lista.',

  'recipe.verb.extract.summary':
    'Divide uma célula em uma coluna por grupo nomeado do que um padrão encontrou.',
  'recipe.verb.extract.field.column.help': 'A coluna a ler.',
  'recipe.verb.extract.field.pattern.help': 'Um padrão com grupos nomeados.',
  'recipe.verb.extract.field.into.help': 'As colunas a escrever, ou um prefixo terminado em *.',

  'recipe.verb.rewrite.summary':
    'Reescreve uma coluna por uma lista ordenada de substituições de padrão.',
  'recipe.verb.rewrite.field.column.help': 'A coluna a ler.',
  'recipe.verb.rewrite.field.into.help': 'A coluna a escrever.',
  'recipe.verb.rewrite.field.using.help':
    'As substituições: uma referência de vocabulário ou JSON escrito na linha.',

  'recipe.verb.urls.summary':
    'Reúne de colunas os links dos hosts listados, na ordem de precedência.',
  'recipe.verb.urls.field.into.help': 'A coluna a escrever.',
  'recipe.verb.urls.field.from.help': 'As colunas onde procurar, na ordem de precedência.',
  'recipe.verb.urls.field.host.help':
    'Os hosts, separados por vírgula, ou uma referência de dados.',
  'recipe.verb.urls.field.first.help': 'Escreve só o primeiro link em vez de uma lista.',

  'recipe.verb.nearest.summary':
    'Traz para cada linha colunas da outra linha mais parecida do seu grupo.',
  'recipe.verb.nearest.field.prefix.help': 'Vai antes de cada coluna trazida.',
  'recipe.verb.nearest.field.within.help':
    'Uma linha só se compara com linhas do mesmo valor nesta coluna.',
  'recipe.verb.nearest.field.among.help': 'As linhas que podem ser escolhidas.',
  'recipe.verb.nearest.field.by.help': 'A pontuação, como words(<coluna>).',
  'recipe.verb.nearest.field.stopwords.help':
    'Palavras que não contam, separadas por vírgula, ou uma referência.',
  'recipe.verb.nearest.field.min-length.help': 'A menor palavra que conta.',
  'recipe.verb.nearest.field.bring.help': 'As colunas da linha escolhida a trazer.',

  'recipe.verb.map.summary': 'Traduz uma coluna por uma tabela de consulta.',
  'recipe.verb.map.field.column.help': 'A coluna a traduzir.',
  'recipe.verb.map.field.reverse.help': 'Lê a tabela do valor para a chave.',
  'recipe.verb.map.field.also.help': 'Uma segunda tabela, consultada depois da primeira.',
  'recipe.verb.map.field.into.help': 'A coluna a escrever.',
  'recipe.verb.map.field.using.help':
    'A tabela: uma referência de vocabulário ou JSON escrito na linha.',

  'recipe.verb.path.summary': 'Escreve o caminho mais curto entre duas colunas por um grafo.',
  'recipe.verb.path.field.from.help': 'A coluna onde o caminho começa.',
  'recipe.verb.path.field.to.help': 'A coluna onde o caminho termina.',
  'recipe.verb.path.field.avoid.help':
    'Nós em que o caminho nunca entra, ou uma referência de dados.',
  'recipe.verb.path.field.into.help': 'A coluna de lista a escrever.',
  'recipe.verb.path.field.graph.help': 'O grafo: uma referência de dados ou JSON escrito na linha.',

  'recipe.verb.age.summary': 'Escreve as horas desde um carimbo.',
  'recipe.verb.age.field.column.help': 'A coluna que guarda o carimbo.',
  'recipe.verb.age.field.format.help':
    'Formatos de carimbo tentados em ordem, separados por vírgula.',
  'recipe.verb.age.field.year.help': 'Deduz um ano que falta, no passado.',
  'recipe.verb.age.field.into.help': 'A coluna numérica a escrever.',
  'recipe.verb.age.field.month-into.help': 'Escreve também o mês em que o carimbo se arquiva.',

  'recipe.verb.last.summary': 'Traz o que a última execução aplicada guardou.',
  'recipe.verb.last.field.store.help': 'O depósito que o remember escreveu.',
  'recipe.verb.last.field.by.help': 'A coluna pela qual as linhas são achadas, em vez da chave.',
  'recipe.verb.last.field.columns.help': 'As colunas guardadas a trazer.',
  'recipe.verb.last.field.prefix.help': 'Vai antes de cada coluna trazida.',

  'recipe.verb.remember.summary':
    'Pede que os valores de cada linha sejam guardados quando o plano for aplicado.',
  'recipe.verb.remember.field.store.help': 'O depósito a escrever.',
  'recipe.verb.remember.field.columns.help': 'As colunas a guardar.',
  'recipe.verb.remember.field.by.help':
    'A coluna pela qual as linhas são guardadas, em vez da chave.',
  'recipe.verb.remember.field.when.help': 'As linhas guardadas.',
  'recipe.verb.remember.field.forget-when.help': 'As linhas cujas entradas são apagadas.',

  'recipe.verb.recall.summary':
    'Acrescenta uma linha para cada chave guardada que falta na tabela.',
  'recipe.verb.recall.field.store.help': 'O depósito a ler.',
  'recipe.verb.recall.field.by.help': 'A coluna em que as chaves são comparadas.',
  'recipe.verb.recall.field.mark.help':
    'Uma coluna booleana que diz quais linhas foram recuperadas.',

  'recipe.verb.decide.summary': 'Decide, linha a linha, que lado de uma sincronização vence.',
  'recipe.verb.decide.field.column.help': 'A coluna onde escrever o valor decidido.',
  'recipe.verb.decide.field.local.help': 'O valor do lado local.',
  'recipe.verb.decide.field.remote.help': 'O valor do lado remoto, mapeado para valores locais.',
  'recipe.verb.decide.field.last.help': 'O que a última execução aplicada deixou no lado local.',
  'recipe.verb.decide.field.values.help': 'Os valores locais que a sincronização reconhece.',
  'recipe.verb.decide.field.first-run-wins.help': 'O valor que vence quando nada se sabe.',
  'recipe.verb.decide.field.hold-when-empty.help': 'Segura um envio onde esta coluna está vazia.',
  'recipe.verb.decide.field.tie.help': 'O lado que vence quando os dois mudaram.',
  'recipe.verb.decide.field.clear.help': 'Se um valor apagado desde a última execução é enviado.',
  'recipe.verb.decide.field.clear-limit.help':
    'Com clear=push, o máximo de valores apagados que uma execução envia, ou none para não limitar.',

  'recipe.verb.rollup.summary': 'Conta os filhos de cada linha-mãe que uma expressão mantém.',
  'recipe.verb.rollup.field.column.help': 'A coluna de contagem a escrever.',
  'recipe.verb.rollup.field.parent.help': 'A coluna que guarda a chave da mãe de um filho.',
  'recipe.verb.rollup.field.when.help': 'Os filhos contados.',

  'recipe.verb.stamp.summary':
    'Escreve a hora da execução nas células vazias das linhas que uma expressão mantém.',
  'recipe.verb.stamp.field.column.help': 'A coluna a carimbar.',
  'recipe.verb.stamp.field.when.help': 'As linhas carimbadas.',
  'recipe.verb.stamp.field.format.help': 'O formato do carimbo.',
  'recipe.verb.stamp.field.clear-when.help': 'As linhas cujo carimbo é apagado.',

  'recipe.verb.group.summary': 'Reduz a tabela a uma linha por grupo.',
  'recipe.verb.group.field.by.help': 'As colunas cujos valores formam um grupo.',
  'recipe.verb.group.field.into.help': 'A coluna de lista com as chaves dos membros.',

  'recipe.verb.count.summary': 'Conta os itens de uma coluna de lista.',
  'recipe.verb.count.field.column.help': 'A coluna de lista a contar.',
  'recipe.verb.count.field.into.help': 'A coluna numérica a escrever.',

  'recipe.verb.warn.summary':
    'Informa cada linha que uma expressão mantém como um aviso da execução.',
  'recipe.verb.warn.field.when.help': 'As linhas informadas.',
  'recipe.verb.warn.field.message.help':
    'O que o aviso diz de cada linha, ou uma referência de dados.',

  'recipe.verb.to-brief.summary': 'Planeja um brief por linha num template, escrito ao Aplicar.',
  'recipe.verb.to-brief.field.template.help': 'O template que os briefs usam.',
  'recipe.verb.to-brief.field.into.help': 'A pasta do workspace onde os briefs vão.',
  'recipe.verb.to-brief.field.name.help': 'A coluna que dá nome ao arquivo de cada brief.',
  'recipe.verb.to-brief.field.slots.help':
    'Pares slot:coluna, separados por vírgula, ou uma referência de dados.',

  'recipe.verb.call.summary':
    'Planeja um POST por linha para um host permitido, enviado ao Aplicar.',
  'recipe.verb.call.field.url.help':
    'O endereço https, num host que o projeto do workspace permite.',
  'recipe.verb.call.field.token.help': 'A credencial guardada, enviada como bearer token.',
  'recipe.verb.call.field.body.help': 'O corpo JSON, com textos que são modelos {coluna}.',
};

/** The tables by locale. English has none: `GENERIC_VERB_FORMS` is the English. */
export const RECIPE_FORM_TEXTS: Readonly<
  Partial<Record<Locale, Readonly<Record<string, string>>>>
> = {
  'pt-BR': PT_BR,
};

/** A form's sentence in a locale, or the English it was given when the locale has none. */
export function formText(locale: Locale, key: string, english: string): string {
  return RECIPE_FORM_TEXTS[locale]?.[key] ?? english;
}
