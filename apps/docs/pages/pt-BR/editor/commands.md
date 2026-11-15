# Comandos

::: info Como esta página foi conferida
Todos os passos foram seguidos em 30/10/2026 numa build de desenvolvimento do Tyto, a partir da branch que acrescentou esta página, no Windows 11, com a janela em inglês. Os nomes em português foram lidos do catálogo da própria janela, não de uma janela aberta. Os blocos e o lugar da lista de sugestões foram conferidos de novo em 31/10/2026, depois que a página passou a descrevê-los. As recusas de `tyto mcp`, `watch` e `recipe run --apply` entraram nesta lista em 12/11/2026 a partir do código da janela e dos testes unitários dela, a última pelo próprio analisador da linha de comando, não na janela. Os comandos do próprio painel, o `&&`, o `!N` e os padrões entraram em 15/11/2026 a partir do código da janela e dos testes unitários dela, não na janela. Os comandos de arquivo `ls`, `cd`, `pwd` e `cat`, e o completar depois deles, entraram em 15/11/2026 a partir do código da janela e dos testes unitários dela; o prompt mostrando uma pasta depois do `cd` foi olhado na janela, nos temas claro e escuro. `new`, `mkdir`, `mv`, `cp`, `rm`, `open` e `reveal` entraram no mesmo dia a partir do código da janela e dos testes unitários dela, não na janela. Apelidos e variáveis entraram em 15/11/2026, a partir do código da janela e dos testes unitários dela, não da janela. As caixas que uma recusa oferece entraram em 15/11/2026: as de `--trust` e `recipe run --apply` foram seguidas na janela, com as duas respostas; as de `signin`, `signout` e `watch` vêm do código da janela e dos testes unitários dela.
:::

A aba **Comandos** da área inferior roda comandos `tyto`, os mesmos da [linha de comando](../command-line/index.md), dentro da janela, e alguns comandos próprios. Nada mais roda ali: nem um shell, nem outro programa. Para um shell, use a aba [Terminal](terminal.md).

## Abrir

- **Ctrl+`** abre a área inferior em Comandos, com o cursor no prompt. É a tecla à esquerda do **1**, seja lá o que o seu teclado imprima nela: num teclado brasileiro (ABNT2) essa tecla imprime um apóstrofo. Apertada de novo com Comandos na frente, ela esconde a área.
- **Comandos: Executar…** na barra de comandos faz o mesmo.
- Ou clique em **COMANDOS**, ao lado de **PROBLEMAS**, no alto da área inferior.

A área inferior mostra uma aba por vez. O **×** dela esconde a área inteira, e tudo o que estava ali volta quando ela volta.

## Rodar um comando

Digite depois de `tyto ›` e tecle **Enter**. Escrever `tyto` antes é opcional.

- As palavras se separam por espaços. Ponha entre aspas um caminho com espaços: `render "Meus briefs/cartaz.brief"`. Uma aspa deixada aberta é recusada, e nada roda.
- `|`, `>`, `;` e `~` não querem dizer nada aqui. Chegam ao comando como palavras. `&&`, `!N`, `*` e `?` são lidos pelo painel, como diz [Vários comandos numa linha](#varios-comandos-numa-linha), e `$nome` e apelidos como diz [Apelidos e variáveis](#apelidos-e-variaveis).
- O comando roda na pasta do painel: a [pasta de trabalho](workspace-folder.md) aberta, ou a pasta dentro dela para a qual o `cd` foi, que o prompt mostra (`tyto entregas/novembro ›`). Um caminho pode ser escrito a partir dela. Sem pasta aberta, roda na sua pasta do Tyto (`~/.tyto`). A confiança de uma pasta é a da pasta de trabalho: dentro de uma pasta restrita, toda pasta é restrita também.
- Alguns comandos são recusados, com uma linha dizendo por quê:
  - `--trust`, porque a janela confia numa pasta pelo **Workspace: Manage Trust**. Com uma pasta aberta, uma caixa oferece confiar nela ali e então rodar o comando sem `--trust`. Diferente do `--trust`, que vale por uma execução, essa confiança fica gravada: a pasta continua confiável até você retirar a confiança em **Workspace: Manage Trust** ou com `tyto trust remove`;
  - instalar um pacote npm com `plugin install` no Windows, porque isso abriria um shell;
  - `tyto mcp`, porque ele conversa com um agente pela entrada e pela saída, que o painel não tem;
  - `watch` na [pasta de fila](../export/queue-folder.md) enquanto **Renderizar automaticamente** está ligado, porque essa pasta já tem quem a consuma. Uma caixa oferece desligar o **Renderizar automaticamente** e vigiar ali; ele fica desligado até você ligá-lo de novo no painel da fila;
  - `recipe run` com `--apply`, porque o painel só planeja uma receita: aplique o plano com **Aplicar** no caderno da receita, ou rode o comando num terminal. Uma caixa oferece abrir o caderno da receita; abrir não aplica nada. `recipe run` sem `--apply` roda e imprime os planos.
  - `signin` e `signout`, porque a janela faz login pela [tela de plugins](../customize/plugins.md); o terminal guarda logins só dele. Quando o plugin declara um login só, ou você o nomeia, uma caixa oferece entrar ou sair como a tela de plugins faz. O login do terminal não é tocado.
- Uma caixa que oferece o caminho da janela nomeia a pasta, o plugin ou a receita sobre que age. **Cancelar** é o padrão, e o Esc responde com ele: o comando continua recusado e nada muda. `tyto mcp` e uma instalação pelo npm no Windows não oferecem caixa.
- Um comando que precisa de resposta, como aprovar as permissões de um plugin, pergunta numa caixa da própria janela.

Cada comando que você roda é um bloco. O cabeçalho mostra o comando, com os caminhos cortados para o nome do arquivo (a linha inteira aparece na dica), a hora em que começou e como terminou: **✓ 0** quando deu certo, **✗ 1** quando o brief tem erros, **✗ 2** quando o próprio Tyto falhou, **✗** sozinho para uma linha recusada antes de rodar, `–` quando foi parado e `•` enquanto roda. O que o comando imprimiu fica sob o cabeçalho. Se o mais novo vem por último ou primeiro, e se os anteriores se dobram até o cabeçalho, são duas configurações, descritas em [Painéis](panels.md#comandos).

## Os comandos do próprio painel

Estes não são comandos `tyto`: o painel responde a eles sozinho. Os que só leem também rodam numa [pasta restrita](workspace-folder.md); `new`, `mkdir`, `mv`, `cp`, `rm`, `open` e `reveal` não rodam, e dizem por quê. Escrever `tyto` antes manda a linha para a linha de comando: `tyto help` é a ajuda dela.

| Comando          | O que faz                                                                                                                                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `help`           | Lista estes comandos e os comandos `tyto`. `help render` mostra a ajuda do `tyto render`.                                                                                                                                                                                                                  |
| `clear` ou `cls` | Esvazia a saída, como **Limpar** e **Ctrl+L**.                                                                                                                                                                                                                                                             |
| `history`        | Lista as linhas rodadas nesta pasta de trabalho, numeradas a partir de 1.                                                                                                                                                                                                                                  |
| `!N`             | Roda de novo a linha N do `history`: `!5` roda a quinta.                                                                                                                                                                                                                                                   |
| `last`           | Roda de novo o último comando `tyto`: não um destes, nem uma linha com `&&`.                                                                                                                                                                                                                               |
| `exit`           | Fecha esta sessão, parando o que ela roda.                                                                                                                                                                                                                                                                 |
| `ls`             | Lista a pasta do painel, ou a pasta indicada: `ls entregas`.                                                                                                                                                                                                                                               |
| `cd`             | Vai para uma pasta: `cd entregas/novembro`, `cd ..` volta uma. `cd` sozinho volta ao topo.                                                                                                                                                                                                                 |
| `pwd`            | Mostra o caminho completo da pasta do painel.                                                                                                                                                                                                                                                              |
| `cat`            | Mostra um arquivo de texto: `cat notas.txt`. Até 256 KB dele, com uma linha dizendo que cortou.                                                                                                                                                                                                            |
| `new`            | Cria um arquivo vazio: `new notas.txt`. `new cartaz.brief --template story` grava o esqueleto do template, como **Entrega: nova…** faz. Um brief ou arquivo de texto abre numa aba.                                                                                                                        |
| `mkdir`          | Cria uma pasta: `mkdir entrega-123`.                                                                                                                                                                                                                                                                       |
| `mv`             | Move ou renomeia: `mv capa.brief entregas` põe em `entregas`, `mv capa.brief nova.brief` renomeia. As abas abertas acompanham.                                                                                                                                                                             |
| `cp`             | Copia um arquivo ou uma pasta, com o destino lido como no `mv`.                                                                                                                                                                                                                                            |
| `rm`             | Manda arquivos ou pastas para a lixeira: `rm velho.brief rascunhos`.                                                                                                                                                                                                                                       |
| `open`           | Abre um brief, receita ou arquivo de texto numa aba.                                                                                                                                                                                                                                                       |
| `reveal`         | Seleciona um arquivo ou pasta no Explorador.                                                                                                                                                                                                                                                               |
| `alias`          | Lista os apelidos, ou salva um: `alias entrega='render --delivery'`. Veja [Apelidos e variáveis](#apelidos-e-variaveis).                                                                                                                                                                                   |
| `unalias`        | Remove um apelido: `unalias entrega`.                                                                                                                                                                                                                                                                      |
| `set`            | Lista as variáveis desta sessão, ou define uma: `set brief=cartaz.brief`.                                                                                                                                                                                                                                  |
| `templates`      | Lista os templates que um render na pasta do painel pode usar, com a origem de cada um e os tamanhos: é o `tyto template list` rodado ali. `templates entregas` lista os de outra pasta; `--json` e `--trust` vão para ele. Veja [Templates](../command-line/templates.md#listar-os-templates-ao-alcance). |

O `ls` lista as pastas primeiro, cada uma terminando em `/`, e cada nome ao lado do tipo: pasta, brief, receita ou arquivo. Um brief, uma receita ou um arquivo de texto é um link que o abre numa aba, a menos que o nome tenha espaço.

Os comandos de arquivo só alcançam o que está dentro da pasta de trabalho aberta. Um caminho que sai dela é recusado: `..` acima da pasta, um caminho começando com `/`, `C:\`, `\\servidor` ou `~`, e um link ou junção que aponta para fora dela, que o [Explorador](workspace-folder.md#ver-os-arquivos-dela-o-explorador) também não mostra. Cada sessão tem a sua pasta; abrir outra pasta de trabalho manda todas as sessões de volta ao topo. O `cat` recusa um arquivo que não é texto.

Nada é substituído: `mv`, `cp`, `new` e `mkdir` recusam um nome que já existe, e dizem isso. O `rm` nunca apaga de vez: tudo vai para a lixeira do sistema, de onde dá para restaurar. Ele só pergunta antes quando uma aba aberta dentro do que vai sair tem alterações não salvas, e nunca remove a própria pasta de trabalho. O `cp` recusa uma pasta que contém um link ou junção, e uma pasta nunca vai para dentro de si mesma.

## Vários comandos numa linha

- `&&` roda o comando seguinte só se o anterior terminou com **✓ 0**: `check cartaz.brief && render cartaz.brief`. Cada comando é um bloco próprio. Um comando recusado, parado ou que termina com erro para a linha ali. Enquanto uma linha roda, a sessão não aceita outra.
- `*` vale por qualquer parte de um nome, e `?` por um caractere: `render *.brief` renderiza todos os briefs da pasta aberta, e `render entregas/*.brief` os de `entregas`. Um padrão só olha dentro da pasta de trabalho aberta e nunca atravessa uma `/`: `*` não casa um nome que começa com `.`, e não existe `**`. Um padrão que leva para fora da pasta (`..`, `/`, `C:\`, `~`), ou que não casa nenhum arquivo, é recusado, e nada da linha roda. Ponha a palavra entre aspas para manter o `*` como está.

## Apelidos e variáveis

Um apelido é um nome curto para uma linha que você digita muito. `alias entrega='render --delivery'` salva o apelido, e daí em diante `entrega cartaz.brief` roda `render --delivery cartaz.brief`: as palavras depois do nome vão depois da linha do apelido.

- `alias` sozinho lista os apelidos em vigor, cada um com onde está definido; `alias entrega` mostra um. `unalias entrega` o remove.
- `alias` salva nas suas configurações (`commandAliases` no `settings.json`), para toda pasta que você abrir. `alias --workspace entrega='…'` salva no `.tyto/project.json` da pasta aberta, em `aliases`, para todos que abrirem aquela pasta; `unalias --workspace entrega` o remove dali. O painel nunca edita o [perfil de trabalho](workspace-folder.md#perfis-de-trabalho) da pasta: um apelido que só o perfil define se remove no arquivo do próprio perfil. Comentários e formatação do arquivo ficam como estavam, e um arquivo que não é JSON válido não é gravado.
- **O apelido da pasta ganha** do seu de mesmo nome. Os apelidos de uma pasta também podem vir do [perfil de trabalho](workspace-folder.md#perfis-de-trabalho) dela, e os da própria pasta ganham nome a nome.
- Numa [pasta restrita](workspace-folder.md#uma-pasta-em-que-voce-ainda-nao-confiou) os apelidos da pasta ficam retidos e nunca rodam: a faixa acima do editor os conta, e o painel Problemas os nomeia (`W_PROJECT_ALIASES_WITHHELD`). Os seus continuam valendo, e `--workspace` é recusado ali.
- Um apelido se expande uma vez. A linha dele vale como está escrita: um apelido dentro dela não se expande de novo, e um `$` nela é só um caractere. Ponha aspas numa linha com espaços ao salvar.
- Um apelido não pode ter o nome de um comando do próprio painel (`ls`, `cd`, `help`, `alias`…) nem `tyto`. Um escrito à mão num arquivo com esse nome é ignorado, e o painel avisa uma vez.
- A linha que um apelido gerou passa pelas mesmas recusas que uma digitada. Quando é recusada, a linha e a caixa dizem de qual apelido ela veio e onde ele está definido.

`set brief=cartaz.brief` define uma variável nesta sessão, e `$brief` numa linha seguinte a lê: `render $brief`. `set` sozinho lista as variáveis. Uma variável dura até a aba da sessão fechar, e cada aba tem as suas.

- Só vale o que `set` deu a esta sessão: `$HOME` e as outras variáveis do sistema não são lidas, e um nome nunca definido recusa a linha, sem rodar nada.
- `$brief` é lido em qualquer parte de uma palavra, e entre aspas duplas: `"entregas/$brief"`. Entre aspas simples fica como foi digitado: `'$brief'`.
- Um valor é sempre uma palavra só: espaços, aspas ou `&&` dentro dele fazem parte da palavra, nunca viram outro comando.

## Completar enquanto digita

Uma lista logo abaixo do prompt mostra o que pode vir em seguida, em qualquer ordem dos blocos:

- os comandos, os do próprio painel entre eles, e depois as opções de cada um; depois de `&&`, os comandos de novo;
- para `--template`, os templates e aliases que a janela conhece;
- para `--formats`, os formatos do template já escolhido;
- para `--types`, `png`, `jpeg`, `webp` e `svg`;
- para `plugin enable`, `disable` e `remove`, os plugins instalados;
- para um brief, uma pasta ou um arquivo, e depois de `ls` e `cat`, o que há na pasta do painel; depois de `cd`, as pastas dela. Uma pasta termina em `/`, e a lista continua dentro dela.

**Tab** pega a primeira sugestão, ou a única. **↑** e **↓** escolhem uma, e **Enter** a pega. **Esc** fecha a lista. Sem nada escolhido, **Enter** roda a linha como está.

## Histórico

**↑** e **↓** no prompt voltam pelas linhas rodadas nesta pasta de trabalho. **Ctrl+R** busca nelas: digite parte de uma linha, aperte **Ctrl+R** de novo para uma ocorrência mais antiga, **Enter** para rodá-la, uma seta para deixá-la no prompt e editar, ou **Esc** para voltar. Cada pasta guarda as últimas 500 linhas, só neste computador.

## A saída

- O cabeçalho de cada execução diz como ela terminou: **✓ 0** em verde quando deu certo, **✗** e o código de saída em vermelho quando não deu.
- Uma linha ganha a cor do que ela diz, não de onde o comando a escreveu: um problema que o comando relata sai em vermelho quando é um erro e em âmbar quando é um aviso, com o código em negrito, e a dica embaixo dele sai em cinza. O resto, como uma pergunta que o comando faz ou o que `history` imprime, é texto comum. As mensagens do próprio painel, como o motivo de ter recusado uma linha, saem em cinza.
- Um comando que imprime as próprias cores fica com elas.
- Um lugar que um problema nomeia, como `cartaz.brief:5:1`, é um link, e também qualquer brief ou arquivo de texto da pasta aberta: **clique** nele para abrir o arquivo numa aba, nessa linha.
- Os mesmos problemas aparecem em [Problemas](panels.md#problemas), sob o comando que os relatou. A barra de status os conta, e a aba **PROBLEMAS** também.
- **Ctrl+F** busca na saída: **Enter** vai para a próxima ocorrência, **Shift+Enter** para a anterior, **Esc** fecha.
- Selecione um texto para copiá-lo com **Ctrl+C**. **Limpar** (ou **Ctrl+L**) esvazia a saída. As últimas 3.000 linhas ficam guardadas.

## Parar, e mais de um ao mesmo tempo

Enquanto um comando roda, aparece o botão quadrado **Parar**; **Ctrl+C** no prompt, sem nada selecionado, faz o mesmo. `render` e `watch` param no meio do caminho. Um comando que não consegue fica marcado como _parado_ na hora e termina sozinho, e não ganha código de saída. Um `watch` continua rodando com a área escondida.

O botão **+** abre outra sessão, para um `watch` seguir rodando enquanto você digita outros comandos. Com duas ou mais sessões, cada uma aparece como uma abinha à direita da faixa, com o código de saída do último comando. Fechar uma sessão para o que ela roda. Uma sessão roda um comando por vez.

## Renderizar o brief da frente

Com um brief salvo na frente, **Comandos: Renderizar este brief** na barra de comandos escreve `render "<o caminho dele>"` no prompt, sem rodar. Acrescente opções, com a ajuda do completar, e tecle **Enter**. Ele é oferecido quando o brief está na pasta aberta, ou fora da sua pasta de usuário.
