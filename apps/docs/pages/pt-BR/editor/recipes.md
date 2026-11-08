# Receitas

::: info Como esta página foi conferida
Cada comportamento abaixo foi conferido em 2026-10-28 numa versão de desenvolvimento do Tyto no Windows 11, pela suíte de testes do app de mesa que abre um `.recipe` sobre um plugin de fonte instalado e conta as buscas da fonte: nenhuma ao abrir, uma em **Executar receita**, nenhuma em **Executar daqui**, uma em **Buscar de novo**, nenhuma numa edição abaixo da fonte. **Aplicar** foi conferido em 2026-11-07 pela mesma suíte, aplicando o plano do plugin de receita de exemplo e lendo a marca de cada operação. A visão de Tabela foi conferida em 2026-11-07 por uma suíte que rola uma tabela de 5.000 linhas até a última, ordena e filtra; a cópia foi conferida por testes unitários, não na janela. Abrir um passo `run` foi conferido em 2026-11-08 pela mesma suíte de Aplicar, lendo as tabelas e o plano da receita incluída. Os menus e rótulos abaixo são os da janela em português.
:::

Uma receita (`.recipe`) é uma lista de passos, um por linha, que buscam linhas de uma fonte, filtram e reorganizam essas linhas e planejam o que gravar. O Tyto abre uma receita numa aba como um caderno: **embaixo de cada passo, o resultado dele**, uma tabela que você lê enquanto escreve a próxima linha.

## Abrir uma

Abra um `.recipe` por **Arquivo > Abrir…** (escolha **Receita** na lista de tipos da caixa) ou clique nele no Explorador. A barra de status mostra o tipo: **Receita**. Os passos ganham cores, e um verbo é oferecido enquanto você digita no começo de uma linha: os genéricos e todos os que os seus plugins instalados acrescentam.

Os problemas de uma receita vão para onde vão os de um brief: sublinhados no texto e listados no painel **Problemas**.

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

Embaixo de cada passo há uma linha e, depois, a tabela dele:

- **A linha** diz o que o passo respondeu: _12 linhas · 4 colunas_, um plano (_Plano: 3 a gravar em Pauta_), _Falhou: veja Problemas_ ou por que ele não rodou.
- **A idade**: quando o passo rodou e quão antigos são os dados, como _rodou há 2 min. · dados buscados há 3 h_. A idade dos dados é quando a fonte os buscou, que pode ser bem antes de o passo rodar. As idades vão aumentando enquanto a aba está aberta.
- **A tabela** mostra as 20 primeiras linhas do passo e quantas ficaram de fora (_mais 30 linhas_). Uma tabela larga rola para o lado dentro do passo. Um valor longo é cortado com reticências; pare o mouse sobre ele para ler inteiro, e sobre o nome de uma coluna para ver o tipo dela.

A tabela é uma prévia: o passo continua trabalhando com todas as linhas. Para ver todas, veja [Mostrar uma tabela inteira](#mostrar-uma-tabela-inteira).

## Mostrar uma tabela inteira

Uma linha `show table` desenha cada passo dali para baixo na **visão de Tabela** em vez da prévia: todas as linhas da tabela, quantas forem, numa caixa de doze linhas que rola. Só as linhas à vista são desenhadas, então uma tabela de milhares rola tão rápido quanto uma de dez. `show summary` desenha a mesma visão com uma linha de **Total geral** embaixo, somando cada coluna de números.

- **Ordenar**: clique no nome de uma coluna para ordenar por ela, de novo para inverter, uma terceira vez para voltar à ordem da receita. A ordem é da visão: o passo seguinte continua lendo as linhas na ordem em que a receita as fez.
- **Filtrar**: digite em _Filtrar linhas_ para manter as linhas que têm o texto em alguma coluna mostrada, sem ligar para maiúsculas ou acentos. _Linhas: 111 de 5.000_ diz quantas ficaram. Os totais de um Summary somam as linhas que o filtro mantém.
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

## Recolher uma tabela

A seta no começo da linha recolhe a tabela do passo e a traz de volta. Toda tabela começa aberta. Uma tabela recolhida fica recolhida enquanto a aba está aberta, em novas execuções e quando sai da tela pela rolagem; fechar a aba ou sair do Tyto abre todas de novo.

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

Depois, cada operação ganha a sua marca, _aplicada_, _falhou_ ou _pulada_, com o motivo quando há um (uma linha que mudou desde que o plano foi feito falha em vez de ser sobrescrita), e uma linha conta as marcas: _2 aplicadas · 1 falharam_. Um plano se aplica uma vez; para aplicar de novo, rode o passo de novo para ter um plano novo.

Quando Aplicar é recusado, o motivo aparece embaixo do plano, em vermelho, até a próxima execução: o plano foi trocado por uma execução mais nova, ou o passo não rodou desta vez. Rode a receita de novo e olhe o plano novo.

### apply auto

Uma receita cujo cabeçalho tem a linha `apply auto` aplica os seus planos sem clique, mas só em **Executar receita** (ou **Executar daqui**, **Buscar de novo**) numa pasta confiável. Uma pausa na digitação ou um salvamento nunca aplicam. Numa pasta não confiável os planos são feitos e mostrados, e o plano diz _apply auto espera: esta pasta não é confiável, então Aplicar pede um clique_.

## Trocar o idioma

**Trocar o idioma da janela** redesenha a linha e a tabela de cada passo no novo idioma na hora, idades incluídas.
