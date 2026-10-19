# A barra de comandos e a busca

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `e3d32e9`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

## Executar um comando

<Screenshot
  scene="command-bar-open"
  alt="A barra de comandos aberta sobre o editor, listando comandos com as teclas deles."
/>

1. Aperte **Ctrl+K** (**Cmd+K** no macOS) ou clique no botão na ponta esquerda da barra de status.
2. Digite algumas letras do que você quer — `vim`, `dividir`, `tema`. A lista diminui enquanto você digita e mostra a tecla de cada comando ao lado.
3. Aperte **Enter** para executar o comando destacado, ou **Esc** para fechar a barra.

Além dos comandos, a barra lista os arquivos que você abriu recentemente, cada um começando com **Recente:** — digite parte do nome de um arquivo para reabri-lo. Todos os comandos estão em [Comandos](../reference/commands.md), com o id que o `keybindings.json` usa para pôr o comando em outra tecla.

## Procurar e substituir num brief

**Procurar** (**Ctrl+F**) abre uma barra de busca embaixo do editor:

- digite o texto e aperte **Enter**, ou use **próxima** e **anterior**; **todas** seleciona todas as ocorrências;
- **maiúsculas**, **expressão** e **palavra inteira** restringem o que conta como ocorrência;
- o segundo campo, **Substituir**, com **substituir** / **substituir tudo**, troca o que foi encontrado.

**Procurar: próxima** (**Ctrl+G**) e **Procurar: anterior** (**Ctrl+Shift+G**) continuam sem a barra. **Esc** a fecha.

A busca procura no arquivo da frente, não em todos os arquivos abertos.

## Ir para uma linha ou um bloco

- **Ir para a linha** (**Ctrl+Alt+G**) pede um número de linha e vai até ela.
- **Ir para bloco…** (**Ctrl+Shift+O**) lista as partes do brief — `cabeçalho` para o frontmatter, depois cada bloco `::` com as primeiras palavras. Digite para filtrar a lista e aperte **Enter** para ir até um deles.

A trilha embaixo da fileira de abas sempre diz em que bloco o cursor está.
