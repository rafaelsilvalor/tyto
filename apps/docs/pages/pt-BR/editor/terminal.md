# Terminal

::: info Como esta página foi conferida
Abrir um terminal, digitar nele, as teclas da janela de dentro dele, dois terminais, as duas larguras e os dois esquemas de cor foram seguidos em 31/10/2026 numa build de desenvolvimento do Tyto, a partir da branch que acrescentou esta página, no Windows 11, com a janela em inglês. Os shells, a saída e a pasta restrita também rodaram no Linux e no macOS pelos testes automáticos do projeto, sem uma janela olhada lá. Os nomes em português foram lidos do catálogo da própria janela.
:::

A aba **Terminal** da área inferior roda o seu próprio shell, o mesmo que o seu sistema abre numa janela de terminal, dentro do Tyto. Diferente de [Comandos](commands.md), que roda só comandos `tyto`, um terminal roda qualquer programa: `git`, `npm`, um editor, um prompt de Python.

**O shell roda como você, com as suas permissões, e as regras do Tyto não valem dentro dele.** A confiança numa pasta e as permissões de um plugin param no terminal: o que você digita ali roda como rodaria em qualquer terminal da sua máquina.

## Abrir

- **Ctrl+Shift+`** abre um terminal novo na frente, abrindo a área inferior se ela estava escondida. É a tecla à esquerda do **1**, com Shift, seja lá o que o seu teclado imprima nela: num teclado brasileiro (ABNT2) essa tecla imprime um apóstrofo.
- **Terminal: Novo terminal** na barra de comandos faz o mesmo.
- Ou clique em **TERMINAL** no alto da área inferior. Sem nenhum terminal aberto ainda, o primeiro começa.

**Ctrl+`** continua em [Comandos](commands.md).

## Qual shell

- **Windows**: o PowerShell 7 (`pwsh`) quando está instalado; senão, o Windows PowerShell.
- **macOS**: o seu shell de login, aberto como shell de login para ler o mesmo `PATH` de uma janela de terminal.
- **Linux**: o seu shell de login (`$SHELL`).

Para rodar outro programa, defina `terminalShell` e `terminalArgs` no `settings.json` (veja [Configurações](../reference/settings.md#terminalshell)). Elas são lidas só desse arquivo: uma pasta de trabalho não escolhe o programa que um terminal roda.

## Onde começa

Um terminal novo começa na [pasta de trabalho](workspace-folder.md) aberta, ou na sua pasta pessoal quando nenhuma está aberta. Um terminal já aberto fica na pasta onde começou quando você abre outra pasta.

## Numa pasta restrita

Enquanto a pasta aberta não é confiável, um terminal novo é recusado, e a aba diz isso com **Confiar na pasta** ao lado. Um shell aberto numa pasta pode rodar os arquivos dela antes de você digitar qualquer coisa: ferramentas de prompt rodam `git` ali, e as configurações de uma pasta copiada podem indicar um programa para o `git` iniciar. Confiar na pasta abre o terminal. Um terminal já aberto continua rodando.

## Mais de um

O **+** abre outro terminal. Com dois ou mais, eles aparecem como abas pequenas à direita da faixa, com o nome do shell, numeradas quando dois têm o mesmo nome. O **×** de uma aba encerra aquele shell e todo programa que ele iniciou.

## Copiar e colar

- **Windows e Linux**: **Ctrl+C** copia quando há texto selecionado; sem seleção, vai para o shell, que para o programa que está rodando. **Ctrl+Shift+C** e **Ctrl+Shift+V** copiam e colam.
- **macOS**: **Cmd+C** e **Cmd+V**.

Colar mais de uma linha pergunta antes, porque o shell roda cada linha assim que ela chega.

## Teclas

Com um terminal em foco, as teclas vão para o shell, menos as teclas do Tyto que valem em qualquer lugar: **Ctrl+K** abre a barra de comandos, **Ctrl+`** mostra Comandos, **Ctrl+Shift+`** abre outro terminal e as teclas de zoom dão zoom. No `keybindings.json`, uma entrada com `"when": "terminal"` só vale com um terminal em foco.

## Cores e fonte

Um terminal usa as cores da janela, no claro e no escuro, e a fonte e o tamanho de código do editor (`codeFontFamily` e `codeFontSize`). Um prompt que desenha símbolos de uma Nerd Font mostra quadradinhos até o `codeFontFamily` indicar uma fonte que os tenha.

## Quando termina

- Quando o shell sai, o terminal diz **Processo encerrado com código** e o número, e a aba fica até você fechá-la.
- Recarregar a janela mantém todos os terminais, com o que mostravam por último, até os últimos 256 KiB de cada um.
- Sair do Tyto encerra todos os shells. No macOS e no Linux, se um programa além do shell ainda está rodando, o Tyto pergunta antes. No Windows não pergunta, porque não consegue distinguir um shell parado de um ocupado.

## Ainda não

Clicar num link dentro de um terminal e dividir um terminal em dois ainda não existem.
