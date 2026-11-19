# Receitas

::: info Como esta página foi conferida
Cada comportamento abaixo foi conferido em 2026-10-28 numa versão de desenvolvimento do Tyto no Windows 11, pela suíte de testes do app de mesa que abre um `.recipe` sobre um plugin de fonte instalado e conta as buscas da fonte: nenhuma ao abrir, uma em **Executar receita**, nenhuma em **Executar daqui**, uma em **Buscar de novo**, nenhuma numa edição abaixo da fonte. **Aplicar** foi conferido em 2026-11-07 pela mesma suíte, aplicando o plano do plugin de receita de exemplo e lendo a marca de cada operação. A visão de Tabela foi conferida em 2026-11-07 por uma suíte que rola uma tabela de 5.000 linhas até a última, ordena e filtra; a cópia foi conferida por testes unitários, não na janela. Abrir um passo numa aba foi conferido em 2026-11-08 pela mesma suíte, desenhando as 5.000 linhas em tamanho cheio e fechando a receita. Abrir um passo `run` foi conferido em 2026-11-08 pela mesma suíte de Aplicar, lendo as tabelas e o plano da receita incluída. Escrever briefs com `to-brief` foi conferido em 2026-11-08 por um teste do processo principal do app de mesa que planeja três linhas numa pasta, aplica o plano e renderiza cada brief com `tyto render`, não na janela. Uma execução por intervalo buscando além do cache da fonte foi conferida em 2026-11-11 por um teste do processo principal do app de mesa com uma fonte que guarda as respostas por dez minutos, não na janela. Enviar com `call` foi conferido em 2026-11-11 por testes do executor de receitas compartilhado contra um endereço simulado, não pela rede e não na janela. O `tyto recipe run` foi conferido em 2026-11-11 pelos testes da linha de comando, pelo executor compartilhado com um plugin simulado que planeja 120 operações e um endereço simulado, não à mão. Criar uma receita e um vocabulário, e as marcas da aba de vocabulário, foram conferidos em 2026-11-11 pela suíte de testes do app de mesa que começa numa pasta confiável vazia, e a sugestão e a ajuda ao apontar, por testes unitários. Adicionar e editar passos por formulário foi conferido em 2026-11-11 pela suíte de testes do app de mesa que monta uma receita numa pasta confiável vazia com um plugin de fonte, `where`, `select` e `rules`, a executa e compara o arquivo salvo com as linhas que os formulários mostraram, e pela mesma suíte reabrindo o último passo com **Editar passo**; um valor recusado e a sugestão de uma referência ao vocabulário, por testes unitários. Planejar um passo de novo depois de Aplicar foi conferido em 2026-11-12 pelos testes do executor de receitas compartilhado, com `to-brief` numa pasta real e um plugin simulado, não na janela. Os blocos, a barra deles e **Executar este bloco** foram conferidos em 2026-11-12 pela suíte de testes do app de mesa que abre uma receita sobre um plugin de fonte, executa um bloco, recolhe um resultado, sobe um passo, apaga uma nota e compara o arquivo salvo; mover e apagar cada bloco de uma receita, por testes de unidade. O **+** entre blocos, as notas, o contador e **Executar daqui para baixo** foram conferidos em 2026-11-12 pela mesma suíte, que insere um passo entre dois blocos com o **+**, executa só esse bloco, lê os contadores, sobe o bloco e compara o arquivo salvo. O modo comando foi conferido em 2026-11-13 pela suíte de testes do app de mesa que entra e sai dele pelo teclado, com e sem o vim, seleciona inteiro um bloco de dois passos, apaga e desfaz um bloco de nota e confere que digitar no texto continua digitando e que o `dd` do vim apaga uma linha, nunca um bloco. Arrastar um bloco foi conferido em 2026-11-13 pela suíte dos blocos, que arrasta o último bloco para cima de outro com o mouse, lê onde a linha de destino aparece, salva e desfaz a troca com um único desfazer; cancelar um arraste, por testes de unidade. Encadear passos numa linha com `|` foi conferido em 2026-11-13 pelos testes do leitor e do executor de receitas compartilhados e pelos testes de unidade da janela para o contador e o resultado do bloco, não na janela. Um plano no meio de um bloco foi conferido em 2026-11-17 pela suíte de Aplicar, que abre uma receita de um bloco só com uma ação entre uma fonte e um `select`, lê o plano embaixo da linha da ação e o aplica. As caixas, os cabeçalhos e o espaço entre blocos foram conferidos em 2026-11-17 pela suíte de Aplicar, que mede uma caixa em volta do plano e do último resultado de um bloco, com a barra de botões no cabeçalho, e pela suíte dos blocos, que acha cada contador e barra de botões na primeira linha do bloco. Manter uma pasta de entrega por linha com `to-delivery` foi conferido em 2026-11-17 pelos testes do executor de receitas compartilhado numa pasta real, que planejam três pastas, aplicam e não planejam nada na execução seguinte, não na janela. Ler as pastas de volta com `deliveries` e deixar um campo declarado entrar com `inbound=` foram conferidos em 2026-11-17 pelos testes de receita com um espaço de trabalho simulado e pelos testes do executor de receitas compartilhado numa pasta real, que leem três fichas de volta e não planejam nada quando elas passam de novo pelo `to-delivery`, não na janela. Manter um campo com `keep=` quando a célula volta vazia foi conferido em 2026-11-17 pelos testes de receita com um espaço de trabalho simulado, não numa pasta real e não na janela. Manter a copy com `copy-text=` foi conferido em 2026-11-19 pelos testes de receita com um espaço de trabalho simulado e pelos testes do executor de receitas compartilhado numa pasta real, que gravam o `copy.md`, não planejam nada na execução seguinte e mantêm uma copy editada no disco, não na janela. Os campos declarados e o `create=no` foram conferidos em 2026-11-18 pelos testes de receita com um espaço de trabalho simulado, que gravam um campo declarado, o leem de volta com `deliveries` e pulam uma linha sem pasta, não numa pasta real e não na janela. Trazer a ficha de cada linha para o lado dela com `with-deliveries` foi conferido em 2026-11-18 pelos testes de receita com um espaço de trabalho simulado, que acham a pasta qualquer que seja a caixa das letras, deixam vazia uma linha sem pasta e contam uma listagem das pastas por execução, não numa pasta real e não na janela. Listar campos declarados com `fields=` nos dois passos foi conferido em 2026-11-18 pelos testes de receita com um espaço de trabalho simulado, que dão um `record_description` vazio a fichas que nunca o tiveram e rodam um `compose` que o lê, não numa pasta real e não na janela. Uma gravação que leva mais de uma chamada, e o **Cancelar**, foram conferidos em 2026-11-19 pelos testes do executor de receitas compartilhado, da linha de comando e do processo principal do app de mesa, com um plugin simulado cuja gravação leva três chamadas, e a linha de progresso e o **Cancelar** foram olhados na janela à mão. Conferir os exports de cada entrega foi conferido em 2026-11-18 pelos testes do executor de receitas compartilhado numa pasta real, que leem dois cabeçalhos PNG contra uma ficha que pede dois formatos, um tamanho vindo do `delivery.sizes` e outro do catálogo de formatos, e por testes unitários para cada problema, não na janela. Os menus e rótulos abaixo são os da janela em português.
:::

Uma receita (`.recipe`) é uma lista de passos, um por linha, que buscam linhas de uma fonte, filtram e reorganizam essas linhas e planejam o que gravar. O Tyto abre uma receita numa aba como um caderno: **embaixo de cada passo, o resultado dele**, uma tabela que você lê enquanto escreve a próxima linha.

## Abrir uma

Abra um `.recipe` por **Arquivo > Abrir…** (escolha **Receita** na lista de tipos da caixa) ou clique nele no Explorador. A barra de status mostra o tipo: **Receita**. Os passos ganham cores, e um verbo é oferecido enquanto você digita no começo de uma linha: os genéricos e todos os que os seus plugins instalados acrescentam.

Os problemas de uma receita vão para onde vão os de um brief: sublinhados no texto e listados no painel **Problemas**.

## Começar uma

Clique com o botão direito no Explorador e escolha **Nova receita…**, ou rode **Nova receita** pela barra de comandos, e digite um nome. O Tyto acrescenta `.recipe` e escreve uma receita que já roda como está: o cabeçalho, uma linha que a descreve e um `param` com valor padrão. A sua primeira edição é um passo.

O nome de uma receita é como uma linha `run` a chama, então ele começa com uma letra ou um dígito e só tem letras, dígitos, `-` e `_`. Qualquer outro nome é recusado embaixo do campo com o código `E_RECIPE_FORM`, e nada é gravado. Um arquivo que já existe nunca é substituído.

## Carregar uma receita compartilhada

A receita de um colega pode estar em qualquer lugar do disco. Clique com o botão direito numa pasta do Explorador e escolha **Carregar receita…**, ou rode **Carregar receita…** pela barra de comandos, e escolha o arquivo `.recipe`. O Tyto **copia** a receita para essa pasta (a pasta selecionada, a pasta do arquivo selecionado, ou a pasta aberta quando nada está selecionado), junto com o que ela precisa para rodar ali:

- as receitas que as linhas `run` dela incluem, `<nome>.recipe` ao lado dela;
- os arquivos de dados e de vocabulário que os passos citam, como `@./company.vocab.json#/rules/kinds`, nas mesmas pastas relativas a ela.

A cópia é sua: roda neste espaço de trabalho, com os arquivos ao lado e o estado aqui. O original nunca é alterado.

**Nada é sobrescrito.** Se algum desses arquivos já estiver na pasta, nada é copiado, e o Explorador lista cada um que já existe, para que uma receita nunca fique carregada pela metade. Renomeie ou mova esses arquivos e carregue de novo.

Algumas referências não são seguidas, e o Explorador diz quais e por quê, acima da árvore:

- um arquivo fora da pasta da receita, como `@../shared.json`, ou um atalho que leva para fora dela, nunca é lido;
- uma referência que não é válida, um arquivo que não existe, um que está nas configurações `.tyto` da pasta, ou um maior do que uma receita pode ler fica de fora;
- uma receita incluída que não se lê como receita é copiada, mas os arquivos que ela cita não são procurados.

Clique nas linhas para fechá-las.

## Adicionar e editar passos

Rode **Adicionar passo** pela barra de comandos com uma receita na frente. Abre uma lista de todos os verbos, agrupados em **Fontes**, **Transformações**, **Ações** e **Destinos**: os genéricos e todos os que os seus plugins instalados acrescentam. Digite para filtrar, ande com as setas e aperte Enter, ou clique num verbo.

Em seguida vem o formulário do verbo, um campo por argumento. Um campo obrigatório diz isso; um campo deixado em branco mostra o valor que o verbo assume; um campo com um conjunto fixo de valores é uma lista. Um campo que nomeia uma coluna, uma lista de colunas ou uma expressão `where` oferece as colunas do passo anterior, da última execução dele: clique numa para colocá-la. Embaixo dos campos, o formulário mostra a linha que vai escrever. **Escrever passo** põe essa única linha no fim do bloco em que está o cursor: o bloco ganha um passo e passa a mostrar o resultado dele. Com o cursor numa linha em branco, a linha começa um bloco novo ali, separado por uma linha em branco; com o cursor no cabeçalho ou acima de todos os blocos, ela começa um bloco novo no fim. Veja [Trabalhar em blocos](#trabalhar-em-blocos).

Para mudar um passo, ponha o cursor na linha dele e rode **Editar passo**: o formulário abre preenchido pela linha, e **Escrever passo** escreve a linha de volta no lugar dela.

O texto continua sendo a receita: o formulário é um jeito de digitar uma linha, e você ainda pode editar a linha à mão. Um valor que uma linha não comporta, como aspas duplas num valor com espaço, é recusado ao lado do campo com o código `E_RECIPE_FORM`, e nada é gravado. Ponha um valor assim num arquivo de vocabulário e faça referência a ele.

## Escrever o vocabulário dela

As regras, as trocas e as tabelas de consulta que uma receita lê ficam num arquivo de vocabulário ao lado dela, `<nome>.vocab.json`. Escolha **Novo vocabulário…** no Explorador, ou rode **Novo vocabulário**, e digite um nome: o Tyto acrescenta `.vocab.json` e escreve uma regra para começar. Uma receita lê uma das tabelas dele pelo nome, como em `@./empresa.vocab.json#/rules/kinds`.

Um `.vocab.json` abre numa aba própria, e a barra de status mostra o tipo **Vocabulário**. Nenhum outro `.json` abre numa aba. A aba é conferida enquanto você digita, do jeito que os passos `rules`, `rewrite` e `map` vão lê-la: o `when` de cada regra, cada padrão e modelo, e o formato de cada seção. Um problema é sublinhado exatamente nos caracteres dele, com os escapes contados como o arquivo os escreve, e listado em **Problemas**.

No nível de cima a aba oferece as três seções, `rules`, `rewrites` e `lookups`; dentro de uma regra ou de um passo de troca ela oferece os campos que faltam na entrada. Aponte para uma seção para ler o que ela guarda, ou para o nome de uma tabela para ver quantas entradas ela tem e como uma receita a lê.

Na receita, digitar `@./` oferece os arquivos de vocabulário ao lado dela, e depois do `#` do arquivo as tabelas que ele guarda, como `/rules/kinds`. Só arquivos da própria pasta da receita, ou abaixo dela, são lidos para isso.

## Dar nome a valores com const e set

Uma receita pode dar nome a um valor uma vez e usá-lo em qualquer passo abaixo como `{nome}`, do jeito que usa um `param`. Há dois jeitos de dar nome a um valor, e `param`, `const` e `set` dividem um único conjunto de nomes: um nome declarado duas vezes é recusado com `E_RECIPE_SYNTAX`.

**`const`** dá nome a um valor escrito na receita. Ele vai no cabeçalho, ao lado das linhas `param`, e todos os passos podem lê-lo:

```
recipe semanal
const time = Plataforma
where time = {time}
```

Ao contrário de um `param`, um `const` não recebe valor de fora: `--param time=…` na linha de comando, ou `run semanal time=…` em outra receita, é recusado com `E_RECIPE_PARAM`.

**`set`** é um passo que calcula um valor a partir da tabela na linha dele. Ele se escreve `set <nome> = <agregado> <coluna>`:

```
set ultimo_prazo = max due
where due = {ultimo_prazo}
```

O agregado é um destes:

- `count`: quantas linhas a tabela tem. Ele não leva coluna: `set total = count`.
- `min` e `max`: o menor e o maior valor da coluna, comparados como números quando todo valor que não está vazio é um número, e como texto, sem ligar para maiúsculas nem acentos, caso contrário.
- `first` e `last`: o valor da coluna na primeira e na última linha.
- `sum`: os valores da coluna somados. Um valor que não é número é recusado com `E_RECIPE_ARGUMENTS`, que diz a linha dele.

A tabela passa pelo `set` sem mudar, então o passo seguinte lê as mesmas linhas. Só os passos abaixo de um `set` podem ler o valor dele; usá-lo acima, ou na própria linha do `set`, é recusado com `E_RECIPE_PARAM`. Numa tabela sem linhas, `count` dá 0 e os outros dão um valor vazio, o que o resultado do passo diz.

O resultado do bloco diz cada valor que os passos dele definiram, como _Definido ultimo_prazo = 2026-12-01_, mesmo quando o `set` não é o último passo do bloco (veja [O que um passo mostra](#o-que-um-passo-mostra)).

No editor, `const` tem a cor de uma linha do cabeçalho, e o nome, o `=` e o agregado de um passo `set` têm cada um a sua cor. Digitar `{` num passo oferece os nomes que valem ali: todo `param` e `const`, e cada `set` acima do passo. Depois de `set <nome> = ` o editor oferece os agregados.

## Quando ela roda

Uma receita roda sozinha, mas nem tudo roda a todo momento:

- **Uma pausa na digitação** roda a partir da primeira linha que você mudou. Ela para antes de um passo que busca numa fonte: esse passo e os seguintes dizem _Busca ao salvar ou em Executar_ e guardam a tabela que tinham.
- **Salvar** roda a receita inteira, fontes incluídas.
- **Executar receita**, pela barra de comandos, roda tudo de uma vez. É a sua aprovação: ela busca, e roda numa pasta em que você ainda não confiou.
- **Numa pasta não confiável**, nada roda até **Executar receita**: cada passo diz _Só roda em Executar: esta pasta não é confiável_. Mesmo assim os arquivos de dados da pasta continuam recusados. Veja [Pasta de trabalho](./workspace-folder.md).

Só os passos que mudaram rodam de novo: um passo cuja linha não mudou guarda a tabela, e uma edição abaixo da fonte não pede nada à fonte.

## O que um passo mostra

<Screenshot
  scene="recipe-notebook"
  alt="Uma receita depois de Executar receita: embaixo do passo da fonte, a linha 30 linhas · 5 colunas com a idade e os botões Executar daqui e Buscar de novo, uma tabela com as 20 primeiras linhas e mais 10 linhas embaixo; o passo where logo abaixo mostra a própria linha e a tabela."
/>

Embaixo do último passo de cada bloco há uma linha e, depois, a tabela dele. Um bloco de vários passos mostra só o resultado do último (veja [Trabalhar em blocos](#trabalhar-em-blocos)):

- **A linha** diz o que o passo respondeu: _12 linhas · 4 colunas_, um plano (_Plano: 3 a gravar em Pauta_), _Falhou: veja Problemas_ ou por que ele não rodou.
- **Os valores definidos**: cada valor que um passo `set` do bloco definiu, como _Definido ultimo_prazo = 2026-12-01_, e uma nota quando um deles está vazio. Eles continuam na linha quando o resultado está recolhido. Veja [Dar nome a valores com const e set](#dar-nome-a-valores-com-const-e-set).
- **A idade**: quando o passo rodou e quão antigos são os dados, como _rodou há 2 min. · dados buscados há 3 h_. A idade dos dados é quando a fonte os buscou, que pode ser bem antes de o passo rodar. As idades vão aumentando enquanto a aba está aberta.
- **A tabela** mostra as 20 primeiras linhas do passo e quantas ficaram de fora (_mais 30 linhas_). Uma tabela larga rola para o lado dentro do passo. Um valor longo é cortado com reticências; pare o mouse sobre ele para ler inteiro, e sobre o nome de uma coluna para ver o tipo dela.

A tabela é uma prévia: o passo continua trabalhando com todas as linhas. Para ver todas, veja [Mostrar uma tabela inteira](#mostrar-uma-tabela-inteira).

## Mostrar uma tabela inteira

Uma linha `show table` desenha cada passo dali para baixo na **visão de Tabela** em vez da prévia: todas as linhas da tabela, quantas forem, numa caixa de doze linhas que rola. Só as linhas à vista são desenhadas, então uma tabela de milhares rola tão rápido quanto uma de dez. `show summary` desenha a mesma visão com uma linha de **Total geral** embaixo, somando cada coluna de números.

- **Ordenar**: clique no nome de uma coluna para ordenar por ela, de novo para inverter, uma terceira vez para voltar à ordem da receita. A ordem é da visão: o passo seguinte continua lendo as linhas na ordem em que a receita as fez.
- **Filtrar**: digite em _Filtrar linhas_ para manter as linhas que têm o texto em alguma coluna mostrada, sem ligar para maiúsculas ou acentos. _Linhas: 111 de 5.000_ diz quantas ficaram. Os totais de um Summary somam as linhas que o filtro mantém. O filtro fica enquanto a aba está aberta, numa nova execução (ele conta as linhas novas) e numa troca de idioma, em toda visão que tem um; o Calendário guarda também a semana ou o mês, e os cartões soltos o cartão que você tinha aberto. Fechar o Tyto apaga tudo isso.
- **Colunas**: o botão **Colunas** lista as colunas com uma caixa cada; desmarque uma para escondê-la. O filtro não procura numa coluna escondida. A última coluna mostrada fica.
- **Selecionar e copiar**: clique numa célula e depois, com Shift, em outra para selecionar o retângulo entre elas; Ctrl+A (⌘A no macOS) na tabela seleciona todas as linhas. **Copiar**, ou Ctrl+C, põe a seleção na área de transferência como texto separado por tabulações, que cola numa planilha como células, com os valores inteiros, até 50.000 linhas.

Números ficam alinhados à direita e agrupados, datas são escritas no idioma da janela, e os endereços web (`http` e `https`) de uma coluna `link` abrem no seu navegador. Um endereço de qualquer outro tipo fica como texto: o Tyto nunca o entrega ao sistema.

## Mostrar as linhas como um quadro

`show board by=status` desenha cada passo dali para baixo como um **Quadro**: uma coluna para cada valor da coluna `status`, com quantas linhas o têm, e um cartão para cada linha. Uma linha inteira fica `show board by=status order="To Do,In Progress,Done" fields=title,assignee`.

- **`by=`** dá a coluna cujos valores formam as colunas. Os valores se agrupam sem ligar para maiúsculas ou acentos, então `Done` e `done` são uma coluna só, com o nome como a primeira linha o escreveu. As linhas sem valor vão para uma coluna **(sem valor)** no fim.
- **`order=`** lista os valores que vêm primeiro, nessa ordem; os outros seguem na ordem em que aparecem. A lista pode ficar num arquivo de dados ao lado da receita, como `order=@./board.json#/order`, uma lista JSON de palavras.
- **`fields=`** dá as colunas que um cartão mostra, a primeira como título. Sem ele, o cartão mostra as três primeiras colunas além de `by=`.

Uma coluna desenha cinquenta cartões; **mais 50** desenha os próximos. _Filtrar linhas_ funciona como na visão de Tabela, e as colunas contam só as linhas que ele mantém. O quadro é para leitura: arrastar um cartão não muda nada. Para mudar um status, escreva o passo que faz isso, que mostra o plano antes de escrever qualquer coisa.

## Mostrar as linhas num calendário

`show calendar date=due` desenha cada passo dali para baixo como um **Calendário**: cada linha no dia da sua coluna `due`. Uma linha inteira fica `show calendar date=due time=hour span=week`.

- **`date=`** dá a coluna que posiciona a linha: uma data, ou data e hora. Uma data e hora com fuso (`2026-11-09T01:30Z`) cai no dia em que ela está no fuso das receitas (a configuração `recipeTimeZone`, o do seu computador quando vazia), então uma entrega às 22:30 em São Paulo fica naquela noite, não no dia seguinte.
- **`time=`** dá uma coluna com a hora, como `14:30` ou uma data e hora. Um dia lista as linhas por ela; sem ela, pela hora de `date=` quando houver.
- **`span=`** é `week` (semana) ou `month` (mês), um mês quando ausente. Os botões **Semana** e **Mês** alternam entre eles.

O calendário abre na semana ou no mês que contém hoje; **Anterior** e **Próximo** andam um período de cada vez, e _3 antes · 12 depois_ diz quantas linhas com data ficaram fora dele. Um dia mostra as três primeiras linhas e **+ mais 2** para o resto. Linhas sem data, ou com uma data que não diz dia nenhum (como `soon`), nunca somem: ficam listadas embaixo do calendário como _Sem data (14)_, com a data errada escrita ao lado da linha. A semana começa no dia em que o seu idioma a começa. _Filtrar linhas_ funciona como na visão de Tabela. O calendário é para leitura: arrastar uma linha não a muda de dia.

## Mostrar as linhas como cartões soltos

`show cards fields=title,owner,due` desenha cada passo dali para baixo como **cartões soltos**: uma grade de cartões do mesmo tamanho, cada um com as colunas de `fields=`, a primeira como título. Sem `fields=`, um cartão mostra as quatro primeiras colunas.

A grade desenha 48 cartões; **mais 252** desenha os próximos. _Filtrar linhas_ funciona como na visão de Tabela. Clique num cartão (ou Enter, com ele em foco) para abri-lo: ele mostra **todas as colunas da linha**, também as que o cartão não mostra, e de onde a linha veio: a origem, o id da linha na origem, quando ela foi buscada e o link dela, a primeira coluna `link` com um endereço web. Um valor longo aparece inteiro até 10.000 caracteres. Uma linha feita por `group` diz `group` como origem e a chave do grupo como id. Esc ou **Fechar** fecha o cartão. Os cartões são para leitura: nada neles escreve.

## Abrir um passo numa aba

**Abrir numa aba**, na linha de um passo cuja tabela a última execução guardou, desenha o resultado desse passo em tamanho cheio numa aba própria, ao lado da receita: a mesma visão que o passo tem, Tabela, Resumo, Quadro, Calendário ou cartões soltos, com toda a altura da janela. Um passo sem `show` acima abre na visão de Tabela, já que a aba tem espaço para todas as linhas. O comando **Abrir o resultado da célula numa aba** faz o mesmo com o passo em que está o cursor, ou o de cima, inclusive um passo no meio de um bloco, cujo resultado o bloco não desenha. A aba leva o nome da receita e o número do passo, contado de cima (_semanal.recipe · célula 2_).

A aba acompanha a receita: uma nova execução a desenha de novo com as linhas novas, e ela fecha quando a aba da receita fecha. A ordenação, o filtro e as colunas dela são só dela, separados dos do passo. Ela fica no passo dela: um passo acrescentado ou apagado acima não lhe dá outro, e o número no nome da aba acompanha. Quando a linha do próprio passo é apagada, a aba diz que não tem resultado. Ela não volta quando o Tyto abre de novo: abra de novo pelo passo. Um passo de uma receita aberta por `run` não tem o botão; abra essa receita para desenhar os passos dela numa aba.

## Trabalhar em blocos

Uma receita se lê em blocos, como um notebook se lê em células. **Uma linha em branco separa um bloco do seguinte**: um bloco são as linhas entre duas linhas em branco, e pode ter vários passos e linhas de comentário `#`. Um bloco só de linhas de comentário é um bloco de **nota**. O cabeçalho (a linha `recipe`, a descrição `|` e as linhas `apply`, `every`, `param` e `const` do topo) é um bloco à parte, mesmo sem linha em branco embaixo. Uma linha em branco não pertence a nenhum bloco.

**Um bloco é desenhado como uma célula.** Uma caixa contorna cada bloco de passos, do cabeçalho até o fim do último resultado embaixo dele, e os blocos ficam um pouco afastados entre si. O cabeçalho é uma faixa no topo da caixa: o contador do bloco à esquerda e os botões à direita, acima do texto. O bloco onde está o cursor tem uma barra colorida à esquerda; no modo comando, a caixa inteira fica nessa cor. Um bloco de nota é texto corrido, sem caixa e sem cabeçalho, como a célula de texto de um notebook; o cabeçalho da receita também não tem.

**Um bloco mostra só o resultado do último passo**, embaixo da linha desse passo. Todos os passos do bloco continuam rodando, e o problema de um passo continua marcado na linha dele e listado em Problemas; quando um passo do meio falha, a linha do bloco diz _Pulada: uma célula acima falhou_. Para ver o resultado de um passo do meio, ponha uma linha em branco embaixo dele, o que divide o bloco em dois, ou ponha o cursor nele e rode **Abrir o resultado da célula numa aba**.

**Um plano nunca fica escondido.** Um passo do meio do bloco que grava, como uma ação, mostra o plano embaixo da própria linha, com as operações e o seu próprio **Aplicar**, e o último passo do bloco continua mostrando o resultado embaixo da última linha. Um bloco que planeja duas vezes mostra dois planos, cada um aplicado com o seu clique: nada aplica os dois de uma vez, para que cada um seja lido antes de ser aplicado.

### Encadear passos numa linha

Um `|` com um espaço de cada lado divide a linha em passos, lidos exatamente como se cada um estivesse na sua própria linha do mesmo bloco:

```
where status != done | sort due | show table
```

são três passos, e o bloco mostra o resultado do último, `show table`. O problema de um deles é marcado no trecho da linha desse passo. Um `|` sem passo depois dele, ou uma linha de cabeçalho como `param` depois de um `|`, é recusado com `E_RECIPE_SYNTAX`.

**Um `|` encostado numa palavra nunca divide**, então `extract title pattern=^(poster|flyer)` continua um passo só: o `|` é do padrão, como o do filtro de um marcador, `{team|upper}`, é do modelo. Também não dividem um `|` entre aspas duplas, `where title matches "copy | web"`, nem entre chaves, nem o `|` que abre uma linha de descrição no cabeçalho.

Na primeira linha de cada bloco, menos o cabeçalho, à direita, uma pequena barra:

- **▶ Executar este bloco**, num bloco com passos: executa todos os passos do bloco e os passos acima dele que mudaram desde a última execução, e para ali. Os passos abaixo mantêm as últimas tabelas e dizem _Abaixo do bloco executado: roda na próxima execução_. É **Executar receita** para esse trecho da receita: busca dados e roda numa pasta não confiável.
- **↑ Mover para cima** e **↓ Mover para baixo**: trocam o bloco inteiro de lugar com o vizinho. As linhas em branco entre eles ficam onde estavam. Nenhum bloco sobe acima do cabeçalho.
- **✕ Apagar bloco**: remove todas as linhas dele e a linha em branco que o separava. Não pergunta nada; **Ctrl+Z** traz o bloco de volta, como desfaz uma troca.
- **▶▶ Executar daqui para baixo**, num bloco com passos: executa do primeiro passo dele até o fim, como **Executar daqui**.
- **▾ Ocultar resultado** (**▸ Mostrar resultado** quando recolhido), num bloco com resultado: o mesmo que a seta na linha do resultado.

A barra do cabeçalho tem **Executar tudo**, que é **Executar receita**.

Para levar um bloco mais longe, arraste-o pela **alça** (⠿), na ponta esquerda da primeira linha dele: uma linha mostra onde ele vai cair, e ele vai para lá com todas as linhas, o resultado e a dobra, e as linhas em branco continuam entre os blocos. **Esc** cancela o arraste. Um **Ctrl+Z** devolve o bloco. Pelo teclado, **↑ Mover para cima** e **↓ Mover para baixo**, na barra dele, o movem uma posição por vez. O cabeçalho não tem alça, e nenhum bloco sobe acima dele.

Um pequeno **+** fica na fronteira acima de cada bloco, menos o cabeçalho, e outro abaixo do último bloco, logo à esquerda das barras. Clique nele e escolha:

- **Passo…**: o seletor e o formulário de **Adicionar passo** (veja [Adicionar e editar passos](#adicionar-e-editar-passos)), com as colunas do passo de cima, e a linha que ele escreve vai para ali como um bloco novo, com uma linha em branco de cada lado.
- **Nota**: uma linha `# ` ali, como um bloco novo, com o cursor depois dela. Escreva a nota; ela é um comentário, então nunca roda. Uma nota aparece na fonte da própria janela.

À esquerda de cada bloco com passos, o **contador** diz quando ele rodou pela última vez: `[3]` é o terceiro bloco que uma execução rodou nesta aba, contando tanto as iniciadas por uma pausa na digitação quanto por um botão, e um bloco conta uma vez só, tenha quantos passos tiver. `[*]` é um bloco que uma execução está alcançando agora, e `[ ]` um que não rodou desde que a aba abriu. Um contador mais apagado, em itálico, está **desatualizado**: um passo do bloco, ou um acima dele, mudou desde que rodou, um passo dele foi pulado, ou a última execução parou acima dele; passe o mouse para ler o motivo. Os contadores são da aba: recomeçam quando ela fecha.

Os blocos são só um jeito de ler o texto: mover ou apagar um edita as linhas da receita, e salvar grava as linhas na ordem que você vê. O arquivo continua sendo o texto que dá para editar à mão.

### Modo comando

Como num notebook do Jupyter, o teclado pode agir sobre blocos inteiros. Aperte **Esc** numa receita (com o vim ligado, **Shift+Esc**; **Ctrl+M** nos dois) e o foco sai do texto: o bloco onde estava o cursor fica marcado, e estas teclas agem sobre ele.

| Tecla                        | O que faz                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| **A** / **B**                | Insere um bloco novo acima ou abaixo dele, pelo seletor de passos                                 |
| **D** **D**                  | Apaga o bloco: aperte D duas vezes em até um segundo                                              |
| **Enter**                    | Volta ao texto, com o cursor no fim da primeira linha do bloco (com o vim ligado, em modo normal) |
| **Shift+Enter**              | Executa todos os passos do bloco e seleciona o próximo                                            |
| **J** / **K**, **↓** / **↑** | Seleciona o bloco seguinte ou o anterior                                                          |
| **O**                        | Oculta ou mostra o resultado                                                                      |
| **Z**, **Ctrl+Z**            | Desfaz                                                                                            |

Esc no modo comando não faz nada; clicar no texto também volta para ele. Cada uma dessas teclas é um comando que a barra de comandos lista com a sua tecla, e rodado de lá ele age no bloco onde está o cursor. No texto, **Shift+Enter** executa o bloco do cursor e leva o cursor para o próximo. Se houver texto selecionado, o primeiro Esc só desfaz a seleção, e logo depois de digitar, o primeiro Esc fecha a lista de sugestões; o seguinte entra no modo comando. As teclas podem ser trocadas no arquivo de atalhos, em `"when": "notebook"`.

## Recolher um resultado

A seta no começo da linha recolhe o resultado do passo e o traz de volta: a tabela ou a visualização, as linhas de um plano e os passos incluídos de um passo `run`. A linha do próprio passo, com os botões, fica. Todo resultado começa aberto. Um resultado recolhido fica recolhido enquanto a aba está aberta, em novas execuções e quando sai da tela pela rolagem; fechar a aba ou sair do Tyto abre todos de novo.

## Abrir um passo run

Um passo `run outra` mostra uma tabela só, aquela com que a receita `outra` termina. **Mostrar as células da receita incluída**, na linha dele, abre o passo nos passos de `outra`, cada um com a sua linha e as suas primeiras linhas de tabela, e uma receita que `outra` roda por sua vez aparece um passo mais para dentro. Eles são só para leitura: nenhum botão neles executa, aplica ou busca, e abrir não pede nada, porque a última execução já os trouxe. Cada um mostra a prévia da sua tabela mesmo sob um `show`, e só um `run` que deu certo os tem; um que falhou diz por quê na própria linha. Um passo aberto fica aberto enquanto a aba está aberta, como uma tabela recolhida fica recolhida.

## Executar daqui

**Executar daqui**, na linha de qualquer passo com tabela ou plano, roda esse passo e todos abaixo dele, mudados ou não. É **Executar receita** a partir desse passo: busca quando um passo abaixo precisa e roda numa pasta não confiável.

O cache da própria fonte continua respondendo, então **Executar daqui** num passo de fonte não busca de novo por si só se a fonte guarda o que buscou. O comando **Executar receita a partir desta célula** faz o mesmo a partir do passo onde está o cursor, ou do mais próximo acima dele.

## Buscar de novo

**Buscar de novo** fica na linha de um passo que busca: uma fonte, ou um `run` de uma receita que tem uma. Ele roda a receita inteira de novo, e cada fonte busca em vez de responder pelo cache. O comando **Executar receita buscando de novo** faz o mesmo de qualquer ponto da aba.

Use quando os dados mudaram onde moram e a tabela embaixo da fonte está mais antiga do que você quer: o _dados buscados …_ da linha diz quão antiga ela é.

## Aplicar um plano

Um passo que grava (uma ação ou um destino) não grava enquanto a receita roda: ele responde um **plano**, o que gravaria. Ele diz quantas gravações e onde (_Plano: 3 a gravar em example items_), na linha dele, ou embaixo da tabela quando o passo também repassa as linhas; embaixo disso vêm as primeiras 20 operações do plano, uma por linha, e quantas ficaram de fora (_mais 40 operações_).

**Aplicar**, na linha do plano, grava esse plano: exatamente as operações que você está lendo, não um plano novo feito no clique. O botão só aparece quando o plano pode ser aplicado agora: o passo rodou desta vez, o plano ainda não foi aplicado e o verbo sabe aplicar. Enquanto as gravações estão a caminho, o botão fica, esmaecido, e um segundo clique não faz nada. O clique é a sua aprovação, numa pasta não confiável também.

Depois, cada operação ganha a sua marca, _aplicada_, _falhou_ ou _pulada_, com o motivo quando há um (uma linha que mudou desde que o plano foi feito falha em vez de ser sobrescrita), e uma linha conta as marcas: _2 aplicadas · 1 falharam_. Um plano se aplica uma vez. A próxima execução planeja aquele passo de novo, então o plano mostra o que a aplicação mudou: um brief que ela escreveu agora aparece como _overwrites_. Uma aplicação que não escreveu nada, recusada ou com todas as operações falhando, deixa o plano como estava.

Uma gravação longa demais para uma chamada só, como enviar um arquivo grande, continua dentro do mesmo Aplicar: embaixo do plano uma linha diz até onde chegou, _Aplicando: 3 de 10 feitas · sent 48 of 100 MB_, nas palavras do plugin, com **Cancelar** ao lado. **Cancelar** para entre duas chamadas, nunca no meio de uma, então pode levar até a chamada em curso terminar, e enquanto isso diz _Parando depois desta chamada_. O que estava em andamento falha com um motivo que começa com _unfinished_, e nada é pedido de novo. O `tyto recipe run --apply` imprime o mesmo progresso na saída de erros e para do mesmo jeito no primeiro Ctrl+C.

Quando Aplicar é recusado, o motivo aparece embaixo do plano, em vermelho, até a próxima execução: o plano foi trocado por uma execução mais nova, ou o passo não rodou desta vez. Rode a receita de novo e olhe o plano novo.

### apply auto

Uma receita cujo cabeçalho tem a linha `apply auto` aplica os seus planos sem clique, mas só em **Executar receita** (ou **Executar daqui**, **Buscar de novo**) numa pasta confiável. Uma pausa na digitação ou um salvamento nunca aplicam. Numa pasta não confiável os planos são feitos e mostrados, e o plano diz _apply auto espera: esta pasta não é confiável, então Aplicar pede um clique_.

## Rodar em intervalo

Uma linha de cabeçalho `every 5m` (ou `every 30m`, `every 2h`) roda a receita sozinha enquanto o Tyto está aberto, quando a receita está em qualquer lugar da pasta aberta como espaço de trabalho e essa pasta é confiável:

```
recipe watch
every 5m
```

- O intervalo mais curto é de 5 minutos; não há um mais longo. Uma receita sem a linha só roda quando você pede.
- Ela roda o arquivo como está salvo, não o que está digitado numa aba sem salvar. A primeira execução vem um intervalo depois de a pasta ser aberta, e cada uma depois disso um intervalo depois do início da anterior. Uma execução que ainda está rodando quando chega a hora da próxima faz a próxima ser pulada, não enfileirada.
- Cada execução sozinha busca de novo, como **Buscar de novo**: cada fonte pede dados atuais em vez de responder do próprio cache, então a receita vê o que mudou já na execução seguinte. Cada execução gasta uma requisição por fonte, então muitas receitas com intervalos curtos gastam mais rápido a cota de um serviço. **Executar receita** numa aba continua respondendo do cache.
- Nada roda com o Tyto fechado: ele não instala nenhum serviço em segundo plano. Depois que o computador dorme, uma receita cuja hora passou roda uma vez.
- Numa pasta confiável, uma execução sozinha conta como **Executar receita**, então uma receita com `apply auto` aplica os seus planos. Numa pasta não confiável ela não roda nada, e o painel diz que ela está retida.
- Uma receita cujo `param` não tem padrão aparece na lista, mas nunca roda sozinha: não há ninguém ali para dar o valor.

Quando uma execução tem um problema (um passo que falha, ou um plano cujas gravações falham), o Tyto mostra uma notificação do sistema operacional, com o nome da receita e o código do problema; clique nela para abrir a receita. As execuções seguintes com problema ficam quietas até uma execução sair limpa de novo. Uma execução limpa não avisa nada, e um plano aguardando **Aplicar** também não.

### O painel Agendamentos

**Mostrar ou esconder: Agendamentos**, na barra de comandos, abre a aba **Agendamentos** do painel inferior. Ela tem uma linha para cada receita da pasta aberta que roda em intervalo: o nome e o intervalo, quando rodou por último, quando roda de novo e como terminou a última execução: _sem problemas_, _problema_ com o código do problema, _retida: pasta restrita_, _plano aguardando Aplicar_, _precisa de_ e os parâmetros que faltam, ou _ainda não rodou_.

**Rodar agora** roda a receita na hora, sem esperar a vez dela; o botão fica esmaecido enquanto a receita roda e para uma receita que precisa de um parâmetro. **Abrir** abre a receita numa aba.

## Escrever um brief por linha

`to-brief` é um passo que transforma cada linha da tabela num brief, no template que você nomeia, numa pasta do espaço de trabalho:

```
to-brief template=promo-curso into=../briefs name=slug slots=titulo:title,subtitulo:summary
```

- `template=` é o template, encontrado do jeito que a linha `template:` de um brief o encontra.
- `into=` é a pasta onde os briefs vão, lida a partir da pasta da receita. Ela fica dentro do espaço de trabalho e nunca nomeia `.tyto`.
- `name=` é a coluna que dá nome a cada arquivo: `lesson-1` vira `lesson-1.brief`. Duas linhas que gravariam o mesmo arquivo param o passo e nomeiam as duas.
- `slots=` liga cada slot do template a uma coluna, como `slot:coluna` separados por vírgulas. `slots=@./slots.json#/lesson` lê os pares de um arquivo de dados.

Como todo passo que grava, ele não grava nada enquanto a receita roda: responde um plano com uma linha por brief, `briefs/lesson-1.brief: new`, ou `briefs/lesson-1.brief: overwrites` quando o arquivo já existe. **Aplicar** grava os briefs. Um brief que alguém editou depois que o plano foi feito falha com _changed since the plan_ e fica como está; os outros são gravados.

Um valor é texto de brief, então `**negrito**` numa célula é negrito no brief. Um valor com `{` ou `}` para o passo e nomeia a linha e a coluna: briefs não têm como escrever uma chave, então corrija os dados antes, com `rewrite`. Um valor vazio deixa o slot com o padrão do template.

`to-brief` só grava numa pasta confiável: numa pasta não confiável, ou numa receita fora de qualquer espaço de trabalho, o passo diz isso e não planeja nada. Rode `tyto render` nos briefs depois, como em briefs escritos à mão; um slot obrigatório que ficou de fora é apontado ali.

## Manter uma pasta de entrega por linha

`to-delivery` é um passo que mantém uma pasta de entrega por linha da tabela, para um trabalho que não tem brief, como uma arte feita em outro programa. Cada pasta ganha `assets/`, `editaveis/` e uma ficha, `editaveis/delivery.json`, que diz para que a entrega serve:

```
to-delivery name=folder fields=key:key,due:due,formats:formats,link:link
```

- `name=` é a coluna que dá nome a cada pasta. As pastas vão na pasta de entregas do projeto, o `delivery.parent` do `.tyto/project.json`, o mesmo lugar que **Entrega: nova…** usa.
- `fields=` liga cada campo da ficha a uma coluna, como `campo:coluna` separados por vírgula, ou lê os pares de um arquivo de dados com `fields=@./fields.json#/task`. Os campos são `key` (obrigatório), `link`, `formats`, `stem`, `copy`, `due` e `ship`. `formats` se escreve como `feed:3,story:1`; `due` é uma data como `2026-11-20`.
- `create=no` grava só em pastas de entrega que já existem; `create=yes`, o padrão, cria as que faltam.

Como todo passo que grava, ele não grava nada enquanto a receita roda. O plano tem uma linha por pasta que muda: `entregas/mca-1_aula: new`, ou `entregas/mca-1_aula: updates due, link` para uma ficha que já existe. Uma linha cuja ficha não mudaria não aparece, então rodar a receita de novo sobre as mesmas linhas não planeja nada. **Aplicar** cria as pastas e grava as fichas.

**Um campo que você edita na ficha é mantido.** A ficha lembra o que a receita gravou por último, então uma data de entrega mudada no rastreador ainda chega a uma ficha que ninguém tocou, e uma que você mudou à mão continua sua; o plano diz `kept: due (edited)`. A ficha também tem um campo `state`, que é seu: o passo nunca grava nele, a não ser que a receita o declare de entrada.

### Deixar um campo voltar de fora

Alguns campos podem mudar fora da pasta, como um status que alguém muda numa planilha. Declare-os com `inbound=`, cada um com o lado que vence quando a ficha e a linha mudaram desde a última execução, `record` ou `row`:

```
to-delivery name=folder fields=key:key,state:status inbound=state:row
```

- O vencedor é obrigatório: `inbound=state` sozinho para o passo e nomeia o campo.
- Todo campo de entrada também precisa estar em `fields=`. `state` só pode ser ligado a uma coluna quando é declarado de entrada.
- `inbound=@./fields.json#/inbound` lê os pares de um arquivo de dados.
- Um campo não pode ser de entrada e estar em `keep=` ao mesmo tempo.

Quando só a linha mudou, o valor dela entra na ficha. Quando só a ficha mudou, a ficha fica com o seu valor. Quando os dois mudaram, o vencedor decide e o plano diz: `entregas/mca-1_aula: updates state (both changed; row wins over 'doing')`, ou `keeps state (both changed; record wins over 'review')`. A ficha passa então a lembrar o valor da linha, e o mesmo conflito não é planejado de novo na execução seguinte.

### Declarar um campo seu

Uma ficha pode guardar mais que os campos fixos. Qualquer outro nome em `fields=` é um campo que você declara, como uma descrição, uma variante ou um responsável, e o valor dele é texto:

```
to-delivery name=folder fields=key:key,due:due,description:summary,assignee:owner
```

- A ficha guarda os campos declarados em `fields` e lembra o que gravou por último neles, então um valor que você edita à mão é mantido como num campo fixo.
- Um nome tem letras minúsculas, dígitos, `_` e `-`. Não pode ser uma coluna que o `deliveries` já dá: `folder`, `path`, `key`, `link`, `formats`, `stem`, `copy`, `due`, `ship`, `state`, `check`, `check_problems` ou `found_formats`. Um nome assim para o passo, e o erro aponta o argumento.
- Um nome a duas letras ou menos de um campo fixo, como `lnik`, é declarado mesmo assim, com um aviso: `'lnik' is declared as a new field; did you mean 'link'?`
- `keep=` e `inbound=` recebem campos declarados como recebem os fixos.

### Atualizar só as pastas que existem

Com `create=no`, uma linha cuja pasta de entrega ainda não existe não planeja nada, e a nota do resultado diz qual, como `Skipped 1 row with no delivery folder: 'T-9'.` Use quando as linhas vêm de um lugar que também lista trabalhos sem pasta, para o passo atualizar as entregas que você tem sem criar novas:

```
to-delivery name=folder fields=key:key,description:summary create=no
```

### Manter um campo quando a célula volta vazia

Uma célula vazia normalmente apaga o campo de uma ficha que ninguém editou. Quando uma fonte pode ficar em branco por um tempo, como um link de copy que o rastreador não acha mais, nomeie o campo em `keep=` e a ficha fica com o que tem:

```
to-delivery name=folder fields=key:key,due:due,copy:copy keep=copy
```

- Uma célula vazia de um campo mantido deixa o valor da ficha como está, e também o valor que a ficha lembra como o último escrito. Um valor que você editou à mão é mantido do mesmo jeito, e avisado do mesmo jeito.
- A nota do resultado avisa em toda execução, como `Kept 1 value whose cell came back empty: row 'T-0' copy.` Uma linha cuja ficha muda por outro campo também diz `kept: copy (source empty)` na linha do plano. Uma linha cuja ficha não muda de outro jeito não tem linha no plano, só a nota.
- Uma célula com valor atualiza o campo como antes.
- `keep=` recebe campos separados por vírgula, cada um também em `fields=`. Nunca recebe `key`, nem um campo declarado em `inbound=`.

### Manter a copy na pasta

`copy-text=` nomeia uma coluna cujo texto vira a copy da entrega, `editaveis/copy.md`, ao lado da ficha, para uma peça cuja copy você colaria à mão:

```
to-delivery name=folder fields=key:key,copy:doc copy-text=doc_text
```

- O arquivo começa com `Source: ` e o `copy` da ficha, depois uma linha em branco, depois o texto da célula como está, Markdown ou texto puro. Sem `copy`, o arquivo é só o texto.
- A linha do plano diz `copy.md new` ou `copy.md replaced`, e o Aplicar grava a copy antes da ficha. Uma execução cuja copy não mudou não planeja nada.
- **Uma copy que você editou nunca é sobrescrita.** A ficha lembra o que gravou ali por último, então um arquivo que você mudou depois é mantido, e a nota do resultado avisa em toda execução, como `Kept 1 copy.md file edited since the last run, never overwritten: 'entregas/mca-1_aula'.` Uma linha cuja ficha muda por outro campo também diz `kept: copy.md (edited since the last run)` na linha do plano. Um `copy.md` que a receita nunca gravou conta como seu. Para receber a copy nova, apague o arquivo, e a próxima execução o grava de novo.
- Uma célula vazia deixa o arquivo como está.
- Editar o arquivo não roda o passo de novo sozinho: **Executar daqui** no passo, ou **Buscar de novo**, mostra a nota.

Um nome que uma pasta não pode ter, como um título com `:`, nunca é trocado por você: essa linha fica de fora, e a nota do resultado diz qual e por quê. Troque o nome com `rewrite` antes do `to-delivery`. Uma data que não é data, formatos que não se leem ou uma ficha no disco que não é ficha deixam a linha de fora do mesmo jeito.

`to-delivery` só grava numa pasta confiável, como o `to-brief`.

## Ler as pastas de entrega de volta como linhas

`deliveries` é um passo que lê cada ficha de entrega na pasta de entregas do projeto e dá uma linha por entrega, então a pasta, neste computador ou numa pasta sincronizada de um drive na nuvem, é de onde vêm as linhas da receita. Uma planilha pode então ser um relatório que a receita escreve a partir dessas linhas.

```
deliveries
```

Nenhum argumento diz onde: quem diz é o `delivery.parent` do projeto. Cada linha tem as colunas `folder`, `path`, `key`, `link`, `formats`, `stem`, `copy`, `due`, `ship` e `state`, depois `check`, `check_problems` e `found_formats` (veja abaixo), depois uma coluna para cada campo declarado que alguma ficha tenha, em ordem alfabética, vazia numa ficha que não o tenha; `formats` vem como `feed:3,story:1`, como o `to-delivery` grava, então `deliveries` seguido de `to-delivery` sobre os mesmos campos não planeja nada.

- Uma pasta sem ficha ainda não é uma entrega: ela é pulada, e a nota do resultado a conta.
- Uma ficha que não se lê, uma pasta que leva para fora do espaço de trabalho ou uma chave que outra pasta já tem viram um aviso com o nome da pasta; as outras entregas continuam sendo lidas.
- Uma ficha cujo `fields` não é uma lista de nomes e textos, como uma editada à mão pode ser, ainda é lida sem os campos declarados, com um aviso com o nome da pasta. O `to-delivery` com campos declarados deixa essa linha de fora até ela ser corrigida.
- `deliveries` só lê numa pasta confiável.

A coluna de um campo declarado só existe quando alguma ficha tem esse campo, então na primeira execução de uma receita um passo que a lê para com "No column named …". O `fields=` lista os campos declarados de que a receita precisa, e as colunas deles sempre estão lá, vazias até uma ficha tê-los, em ordem alfabética com qualquer outro campo declarado que alguma ficha tenha:

```
deliveries fields=description,variant
```

Um nome em `fields=` segue as regras de um campo declarado no `to-delivery`: letras minúsculas, dígitos, `_` e `-`, e nenhuma das colunas acima. Um nome assim para o passo, e o erro aponta para o `fields=`.

### Conferir os exports de cada entrega

Cada linha também diz se as imagens exportadas para a entrega são as que a ficha dela pede. O `deliveries` lê os arquivos PNG e JPEG na raiz da pasta `exports` da entrega, a largura e a altura de cada um em pixels, e compara com os `formats` da ficha, nos tamanhos que o [`delivery.sizes`](workspace-folder.md#entregas-uma-pasta-por-peca-de-trabalho) do projeto dá a cada nome de formato:

- `check` é `ready` quando cada formato pedido está lá no tamanho certo, nada sobra e um arquivo além da ficha fica em `editaveis/`; `incomplete` quando há imagens e algo falta, sobra ou está no tamanho errado; `in-progress` enquanto nenhuma imagem chegou, ou quando a ficha não pede formatos.
- `check_problems` nomeia cada problema, separados por `; `, como `'feed.png' is 1080×1080, and the record owes feed 1080×1350, story 1080×1920`. Um formato sem tamanho conhecido também é nomeado: `no size is known for 'reel'; add it to delivery.sizes`.
- `found_formats` são as proporções encontradas, com quantas de cada: `4:5:1,9:16:1`. Uma proporção a até 2% de `1:1`, `4:5`, `9:16`, `16:9`, `3:2` ou `2:3` conta como ela, uma mais larga que 2:1 vira `wide`, qualquer outra a sua própria proporção, e uma imagem cujo tamanho não dá para ler, `?`. São as palavras que um plugin que conta imagens numa pasta na nuvem escreve, então uma tabela de `map` no seu vocabulário transforma as duas nos nomes da sua equipe.

O Tyto não tem nomes de formato próprios: os nomes são os que as suas fichas e o `delivery.sizes` usam.

## Trazer a ficha de entrega de cada linha para o lado dela

Quando as linhas vêm de outro lugar, um rastreador de tarefas por exemplo, o `with-deliveries` lê a ficha da pasta de entrega que cada linha nomeia e acrescenta os campos dela como colunas depois das da linha:

```
with-deliveries by=folder
```

- `by=` é a coluna que tem o nome da pasta de entrega de cada linha, lido como o `to-delivery name=` lê. O nome acha a pasta qualquer que seja a caixa das letras.
- Cada coluna que o `deliveries` dá volta com `record_` na frente: `record_folder`, `record_path`, `record_key`, `record_link` e assim por diante até `record_found_formats`, depois `record_` e cada campo declarado que alguma ficha tenha, em ordem alfabética. `record_link` é um link, como `link`.
- Uma linha cuja pasta não existe, ou não tem ficha, recebe células vazias, e a nota do resultado a nomeia. `record_folder` só fica vazio nesse caso, então ele separa uma pasta que falta de um campo que a ficha deixa vazio.
- O `fields=` funciona como no `deliveries`: `with-deliveries by=folder fields=description` sempre dá `record_description`, vazio até uma ficha ter `description`, então um passo depois dele pode lê-lo já na primeira execução.
- Se a tabela já tem uma coluna que o passo acrescentaria, como `record_due` ou uma coluna `record_` de um nome em `fields=`, o passo para e diz qual; tire ou renomeie essa coluna antes.
- Ele lê as pastas uma vez por execução e não grava nada. Só lê numa pasta confiável, e avisa de uma ficha que não consegue ler como o `deliveries` avisa.

## Enviar uma requisição por linha

`call` é um passo que envia um `POST` HTTP por linha para um endereço que você nomeia, com uma credencial guardada na sua máquina:

```
call url=https://hooks.example.com/run token=routine body={"key": "{key|}", "title": "{title|}"}
```

- `url=` é um endereço `https://`. Nenhum outro tipo recebe envio, e um endereço com usuário, senha ou `#` é recusado.
- `token=` nomeia a credencial, em letras minúsculas, dígitos e `-`. A receita guarda só o nome; o Tyto envia o valor como `Authorization: Bearer …` e nunca o mostra num plano ou numa mensagem.
- `body=` é JSON até o fim da linha, ou `body=@./call.json#/routine` para lê-lo de um arquivo de dados. Cada texto dentro dele é preenchido a partir da linha, `{title|}` numa linha de receita; números, `true`, `false` e `null` vão como escritos. Um corpo tem no máximo 16 KiB.

**O host do endereço precisa estar na lista do espaço de trabalho**, em `.tyto/project.json`:

```json
{ "recipes": { "call": { "hosts": ["hooks.example.com"] } } }
```

Cada host é nomeado inteiro: sem `https://`, porta, caminho ou `*`. Só a lista de uma pasta confiável vale; uma pasta não confiável, ou uma receita fora de qualquer espaço de trabalho, não planeja nenhuma requisição. Uma lista na pasta substitui a de um perfil de trabalho.

Como todo passo que grava, ele não envia nada enquanto a receita roda: responde um plano com uma linha por linha da tabela, `POST <endereço> <corpo>`. **Aplicar** envia as requisições uma a uma. Uma resposta de 200 a 299 fica _applied_; qualquer outro status faz aquela linha falhar com o status, _hooks.example.com answered HTTP 503_, e as outras seguem. Um redirecionamento não é seguido, então também faz a linha falhar, e uma requisição sem resposta depois de 30 segundos falha. O que o endereço responde nunca é mostrado nem guardado.

Para enviar cada linha uma vez só, lembre o que foi enviado: uma linha cuja requisição falhou não é lembrada, então a próxima execução a planeja de novo.

```
last dispatched
where last_stored_at is empty
call url=https://hooks.example.com/run token=routine body=@./call.json#/routine
remember dispatched columns=title
```

**De onde vem a credencial.** Na linha de comando, ela é uma variável de ambiente, `TYTO_RECIPE_CREDENTIAL_` seguido do nome em maiúsculas, com todo caractere que não é letra nem dígito trocado por `_`: `token=routine-hook` lê `TYTO_RECIPE_CREDENTIAL_ROUTINE_HOOK`. O `run_recipe` do `tyto mcp` confere a lista e a credencial e mostra o plano, e nunca envia: um agente pode ver um envio antes, não realizá-lo. O [`tyto recipe run --apply`](#rodar-pelo-terminal) as envia, numa pasta confiável. **Na janela**, abra **Mostrar plugins** e procure **Credenciais de receitas** abaixo da lista de plugins: digite o nome que o `token=` usa e o valor, e clique em **Salvar** — ou digite o nome e clique em **Importar de arquivo…** para guardar o texto de um arquivo como o valor. O valor vai para o cofre do sistema, e o Tyto não o mostra de novo: a seção lista só os nomes, cada um com **Esquecer**, e salvar o mesmo nome outra vez troca o valor. Uma credencial é deste computador, para todas as pastas dele; para quais endereços uma receita pode enviar é o `recipes.call.hosts` de cada pasta, lido só depois que você confia na pasta. Enquanto a credencial não está guardada, a linha `call` falha com um problema que diz onde guardá-la; guardada, o plano lista as requisições e **Aplicar** as envia.

## Sincronizar um campo nos dois sentidos

`decide` compara um campo dos dois lados de uma sincronização, linha a linha: o lado local (a coluna de uma planilha), o lado remoto (o campo de um rastreador, já mapeado para os valores da planilha) e o que a última execução aplicada deixou, que `last` lê. Vence o lado que mudou desde então: a linha diz `push`, `pull`, `same` ou `hold` em `<coluna>_action`, e o passo que escreve no lado remoto lê `<coluna>_push` e `<coluna>_pushes`.

```
last sync columns=owner
decide owner local=owner remote=tracker_owner last=last_owner clear=push
remember sync columns=owner when="owner_action != hold"
```

Com `clear=push`, uma célula esvaziada desde a última execução esvazia o campo remoto também; sem ele, o valor remoto preenche a célula de novo. Como uma célula vazia também é o que uma leitura da planilha que perdeu células parece, `decide` segura todos os valores apagados de uma execução, não envia nenhum e mostra um aviso na sua linha, em dois casos:

- **A coluna se perdeu.** A coluna de `local=` falta na tabela, ou está vazia em todas as linhas enquanto a última execução deixou valores ali. O aviso diz o nome da coluna. Confira a planilha e rode de novo.
- **Apagados demais de uma vez.** Uma execução enviaria mais valores apagados do que `clear-limit=`, 5 quando não é dado. O aviso diz quantos. Se você quis mesmo esvaziar essas células, rode uma vez com um limite maior (`clear-limit=20`), ou escreva `clear-limit=none` para tirar o limite.

Uma linha segurada diz `hold` e não envia nada, e o estado guarda o último valor, então a próxima execução vê os mesmos valores apagados de novo. Os apagados até o limite são enviados como antes.

## Rodar pelo terminal

`tyto recipe run <receita>` roda uma receita na pasta de trabalho que a contém, com a confiança dessa pasta, pelo mesmo executor da janela. [Obter o comando](../command-line/index.md#obter-o-comando) diz como construí-lo.

```
tyto recipe run recipes/sync.recipe
```

Ele imprime uma linha por passo, com o estado e quantas linhas tem a tabela, embaixo de um passo `set` o valor que ele definiu (`set ultimo_prazo = "2026-12-01"`) e a nota dele, e embaixo de um passo que grava, todas as operações do plano, uma por linha: nenhuma fica de fora. Ele não grava nada e não guarda nada na memória da receita, como um salvamento; uma receita com `apply auto` só mostra os planos.

- `--json` imprime a resposta inteira como um único documento JSON: todas as linhas de todas as tabelas com a origem de cada uma, todas as operações com a descrição e os dados do plugin para aplicá-las, e todos os problemas com a linha a que apontam. Mande para um arquivo para guardar o plano do dia: `tyto recipe run recipes/sync.recipe --json > plan.json`.
- `--param <nome>=<valor>` dá a uma das linhas `param` da receita um valor para esta execução; repita para cada uma. Um nome que a receita não declara é um erro, e o de um `const` também.
- `--section <plugin>.<chave>=<valor>` define uma chave da seção de um plugin para esta execução, como no [`tyto render`](../command-line/render.md#outras-opcoes). Os passos de uma receita só recebem seções numa pasta confiável, digitadas ou não.
- `--apply` aplica cada plano uma vez, como um clique em **Aplicar**, e guarda o que a receita guarda. Só roda numa pasta confiável: em qualquer outro lugar é recusado antes de qualquer passo rodar. Uma receita com `apply auto` também aplica uma vez. É assim que a linha de comando envia as requisições de um passo `call`.

Numa pasta não confiável, `tyto recipe run` sem `--apply` roda todos os passos, como **Executar receita** faz ali: os arquivos de dados da pasta continuam recusados.

Ele sai com 0 quando tudo rodou, 1 quando um passo ou uma operação falhou, um problema é um erro ou a linha de comando estava errada, e 2 numa falha interna. Ele não roda em intervalo: isso continua sendo da janela aberta.

## Trocar o idioma

**Trocar o idioma da janela** redesenha a linha e a tabela de cada passo no novo idioma na hora, idades incluídas.
