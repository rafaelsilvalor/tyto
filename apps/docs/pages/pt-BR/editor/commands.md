# Comandos

::: info Como esta página foi conferida
Todos os passos foram seguidos em 30/10/2026 numa build de desenvolvimento do Tyto, a partir da branch que acrescentou esta página, no Windows 11, com a janela em inglês. Os nomes em português foram lidos do catálogo da própria janela, não de uma janela aberta. Os blocos e o lugar da lista de sugestões foram conferidos de novo em 31/10/2026, depois que a página passou a descrevê-los. As recusas de `tyto mcp`, `watch` e `recipe run --apply` entraram nesta lista em 12/11/2026 a partir do código da janela e dos testes unitários dela, a última pelo próprio analisador da linha de comando, não na janela. Os comandos do próprio painel, o `&&`, o `!N` e os padrões entraram em 15/11/2026 a partir do código da janela e dos testes unitários dela, não na janela.
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
- `|`, `>`, `;`, `$HOME` e `~` não querem dizer nada aqui. Chegam ao comando como palavras. `&&`, `!N`, `*` e `?` são lidos pelo painel, como diz [Vários comandos numa linha](#varios-comandos-numa-linha).
- O comando roda na [pasta de trabalho](workspace-folder.md) aberta, então um caminho pode ser escrito a partir dela. Sem pasta aberta, roda na sua pasta do Tyto (`~/.tyto`).
- Alguns comandos são recusados, com uma linha dizendo por quê:
  - `--trust`, porque a janela confia numa pasta pelo **Workspace: Manage Trust**;
  - instalar um pacote npm com `plugin install` no Windows, porque isso abriria um shell;
  - `tyto mcp`, porque ele conversa com um agente pela entrada e pela saída, que o painel não tem;
  - `watch` na [pasta de fila](../export/queue-folder.md) enquanto **Renderizar automaticamente** está ligado, porque essa pasta já tem quem a consuma;
  - `recipe run` com `--apply`, porque o painel só planeja uma receita: aplique o plano com **Aplicar** no caderno da receita, ou rode o comando num terminal. `recipe run` sem `--apply` roda e imprime os planos.
  - `signin` e `signout`, porque a janela faz login pela [tela de plugins](../customize/plugins.md); o terminal guarda logins só dele.
- Um comando que precisa de resposta, como aprovar as permissões de um plugin, pergunta numa caixa da própria janela.

Cada comando que você roda é um bloco. O cabeçalho mostra o comando, com os caminhos cortados para o nome do arquivo (a linha inteira aparece na dica), a hora em que começou e como terminou: **✓ 0** quando deu certo, **✗ 1** quando o brief tem erros, **✗ 2** quando o próprio Tyto falhou, **✗** sozinho para uma linha recusada antes de rodar, `–` quando foi parado e `•` enquanto roda. O que o comando imprimiu fica sob o cabeçalho. Se o mais novo vem por último ou primeiro, e se os anteriores se dobram até o cabeçalho, são duas configurações, descritas em [Painéis](panels.md#comandos).

## Os comandos do próprio painel

Estes não são comandos `tyto`: o painel responde a eles sozinho, e nenhum grava arquivo, então também rodam numa [pasta restrita](workspace-folder.md). Escrever `tyto` antes manda a linha para a linha de comando: `tyto help` é a ajuda dela.

| Comando          | O que faz                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `help`           | Lista estes comandos e os comandos `tyto`. `help render` mostra a ajuda do `tyto render`. |
| `clear` ou `cls` | Esvazia a saída, como **Limpar** e **Ctrl+L**.                                            |
| `history`        | Lista as linhas rodadas nesta pasta de trabalho, numeradas a partir de 1.                 |
| `!N`             | Roda de novo a linha N do `history`: `!5` roda a quinta.                                  |
| `last`           | Roda de novo o último comando `tyto`: não um destes, nem uma linha com `&&`.              |
| `exit`           | Fecha esta sessão, parando o que ela roda.                                                |

## Vários comandos numa linha

- `&&` roda o comando seguinte só se o anterior terminou com **✓ 0**: `check cartaz.brief && render cartaz.brief`. Cada comando é um bloco próprio. Um comando recusado, parado ou que termina com erro para a linha ali. Enquanto uma linha roda, a sessão não aceita outra.
- `*` vale por qualquer parte de um nome, e `?` por um caractere: `render *.brief` renderiza todos os briefs da pasta aberta, e `render entregas/*.brief` os de `entregas`. Um padrão só olha dentro da pasta de trabalho aberta e nunca atravessa uma `/`: `*` não casa um nome que começa com `.`, e não existe `**`. Um padrão que leva para fora da pasta (`..`, `/`, `C:\`, `~`), ou que não casa nenhum arquivo, é recusado, e nada da linha roda. Ponha a palavra entre aspas para manter o `*` como está.

## Completar enquanto digita

Uma lista logo abaixo do prompt mostra o que pode vir em seguida, em qualquer ordem dos blocos:

- os comandos, os do próprio painel entre eles, e depois as opções de cada um; depois de `&&`, os comandos de novo;
- para `--template`, os templates e aliases que a janela conhece;
- para `--formats`, os formatos do template já escolhido;
- para `--types`, `png`, `jpeg`, `webp` e `svg`;
- para `plugin enable`, `disable` e `remove`, os plugins instalados;
- para um brief, uma pasta ou um arquivo, o que há na pasta aberta. Uma pasta termina em `/`, e a lista continua dentro dela.

**Tab** pega a primeira sugestão, ou a única. **↑** e **↓** escolhem uma, e **Enter** a pega. **Esc** fecha a lista. Sem nada escolhido, **Enter** roda a linha como está.

## Histórico

**↑** e **↓** no prompt voltam pelas linhas rodadas nesta pasta de trabalho. **Ctrl+R** busca nelas: digite parte de uma linha, aperte **Ctrl+R** de novo para uma ocorrência mais antiga, **Enter** para rodá-la, uma seta para deixá-la no prompt e editar, ou **Esc** para voltar. Cada pasta guarda as últimas 500 linhas, só neste computador.

## A saída

- O cabeçalho de cada execução diz como ela terminou: **✓ 0** em verde quando deu certo, **✗** e o código de saída em vermelho quando não deu.
- Uma linha ganha a cor do que ela diz, não de onde o comando a escreveu: um problema que o comando relata sai em vermelho quando é um erro e em âmbar quando é um aviso, com o código em negrito, e a dica embaixo dele sai em cinza. O resto, como uma pergunta que o comando faz, é texto comum. As linhas do próprio painel saem em cinza.
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
