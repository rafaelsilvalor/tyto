# Comandos

::: info Como esta página foi conferida
Todos os passos foram seguidos em 30/10/2026 numa build de desenvolvimento do Tyto, a partir da branch que acrescentou esta página, no Windows 11, com a janela em inglês. Os nomes em português foram lidos do catálogo da própria janela, não de uma janela aberta. Os blocos e o lugar da lista de sugestões foram conferidos de novo em 31/10/2026, depois que a página passou a descrevê-los.
:::

A aba **Comandos** da área inferior roda comandos `tyto`, os mesmos da [linha de comando](../command-line/index.md), dentro da janela. Nada mais roda ali: nem um shell, nem outro programa. Para um shell, use a aba [Terminal](terminal.md).

## Abrir

- **Ctrl+`** abre a área inferior em Comandos, com o cursor no prompt. É a tecla à esquerda do **1**, seja lá o que o seu teclado imprima nela: num teclado brasileiro (ABNT2) essa tecla imprime um apóstrofo. Apertada de novo com Comandos na frente, ela esconde a área.
- **Comandos: Executar…** na barra de comandos faz o mesmo.
- Ou clique em **COMANDOS**, ao lado de **PROBLEMAS**, no alto da área inferior.

A área inferior mostra uma aba por vez. O **×** dela esconde a área inteira, e tudo o que estava ali volta quando ela volta.

## Rodar um comando

Digite depois de `tyto ›` e tecle **Enter**. Escrever `tyto` antes é opcional.

- As palavras se separam por espaços. Ponha entre aspas um caminho com espaços: `render "Meus briefs/cartaz.brief"`. Uma aspa deixada aberta é recusada, e nada roda.
- `|`, `>`, `&&`, `$HOME` e `*` não querem dizer nada aqui. Chegam ao comando como palavras.
- O comando roda na [pasta de trabalho](workspace-folder.md) aberta, então um caminho pode ser escrito a partir dela. Sem pasta aberta, roda na sua pasta do Tyto (`~/.tyto`).
- Duas coisas são recusadas, com uma linha dizendo por quê: `--trust`, porque a janela confia numa pasta pelo **Workspace: Manage Trust**, e instalar um pacote npm com `plugin install` no Windows, porque isso abriria um shell.
- Um comando que precisa de resposta, como aprovar as permissões de um plugin, pergunta numa caixa da própria janela.

Cada comando que você roda é um bloco. O cabeçalho mostra o comando, com os caminhos cortados para o nome do arquivo (a linha inteira aparece na dica), a hora em que começou e como terminou: **✓ 0** quando deu certo, **✗ 1** quando o brief tem erros, **✗ 2** quando o próprio Tyto falhou, **✗** sozinho para uma linha recusada antes de rodar, `–` quando foi parado e `•` enquanto roda. O que o comando imprimiu fica sob o cabeçalho. Se o mais novo vem por último ou primeiro, e se os anteriores se dobram até o cabeçalho, são duas configurações, descritas em [Painéis](panels.md#comandos).

## Completar enquanto digita

Uma lista logo abaixo do prompt mostra o que pode vir em seguida, em qualquer ordem dos blocos:

- os comandos, e depois as opções de cada um;
- para `--template`, os templates e aliases que a janela conhece;
- para `--formats`, os formatos do template já escolhido;
- para `--types`, `png`, `jpeg`, `webp` e `svg`;
- para `plugin enable`, `disable` e `remove`, os plugins instalados;
- para um brief, uma pasta ou um arquivo, o que há na pasta aberta. Uma pasta termina em `/`, e a lista continua dentro dela.

**Tab** pega a primeira sugestão, ou a única. **↑** e **↓** escolhem uma, e **Enter** a pega. **Esc** fecha a lista. Sem nada escolhido, **Enter** roda a linha como está.

## Histórico

**↑** e **↓** no prompt voltam pelas linhas rodadas nesta pasta de trabalho. **Ctrl+R** busca nelas: digite parte de uma linha, aperte **Ctrl+R** de novo para uma ocorrência mais antiga, **Enter** para rodá-la, uma seta para deixá-la no prompt e editar, ou **Esc** para voltar. Cada pasta guarda as últimas 500 linhas, só neste computador.

## A saída

- Ela mantém as cores que um comando imprime, e os erros saem em vermelho.
- Um lugar que um problema nomeia, como `cartaz.brief:5:1`, é um link, e também qualquer brief ou arquivo de texto da pasta aberta: **clique** nele para abrir o arquivo numa aba, nessa linha.
- Os mesmos problemas aparecem em [Problemas](panels.md#problemas), sob o comando que os relatou. A barra de status os conta, e a aba **PROBLEMAS** também.
- **Ctrl+F** busca na saída: **Enter** vai para a próxima ocorrência, **Shift+Enter** para a anterior, **Esc** fecha.
- Selecione um texto para copiá-lo com **Ctrl+C**. **Limpar** (ou **Ctrl+L**) esvazia a saída. As últimas 3.000 linhas ficam guardadas.

## Parar, e mais de um ao mesmo tempo

Enquanto um comando roda, aparece o botão quadrado **Parar**; **Ctrl+C** no prompt, sem nada selecionado, faz o mesmo. `render` e `watch` param no meio do caminho. Um comando que não consegue fica marcado como _parado_ na hora e termina sozinho, e não ganha código de saída. Um `watch` continua rodando com a área escondida.

O botão **+** abre outra sessão, para um `watch` seguir rodando enquanto você digita outros comandos. Com duas ou mais sessões, cada uma aparece como uma abinha à direita da faixa, com o código de saída do último comando. Fechar uma sessão para o que ela roda. Uma sessão roda um comando por vez.

## Renderizar o brief da frente

Com um brief salvo na frente, **Comandos: Renderizar este brief** na barra de comandos escreve `render "<o caminho dele>"` no prompt, sem rodar. Acrescente opções, com a ajuda do completar, e tecle **Enter**. Ele é oferecido quando o brief está na pasta aberta, ou fora da sua pasta de usuário.
