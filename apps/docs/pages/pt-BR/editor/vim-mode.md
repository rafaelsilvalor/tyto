# Modo vim

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `e3d32e9`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

O editor do Tyto aceita as teclas do vim: os modos normal, de inserção, visual e de substituição, os movimentos e os comandos com `:`.

## Ligar e desligar

1. Aperte **Ctrl+K** para abrir a barra de comandos.
2. Digite `vim` e execute **Editor: ligar ou desligar o modo vim**.

O mesmo comando desliga. Ele não tem tecla própria; [Atalhos de teclado](../customize/keybindings-json.md) explica como dar uma a ele.

Com o vim ligado, a barra de status mostra o modo em que você está — **NORMAL**, **INSERT**, **VISUAL** ou **REPLACE**, em inglês como no vim — e as teclas de um comando que você começou a digitar. A aparência desse selo é a configuração [`vimModeStyle`](../reference/settings.md#vimmodestyle), e as cores dele estão em [`statusBarColors`](../reference/settings.md#statusbarcolors).

A escolha fica guardada: o comando grava a configuração [`vimMode`](../reference/settings.md#vimmode), então depois de um reinício a janela abre com o vim do jeito que você deixou. Você também pode escrever `"vimMode": true` ou `false` no `settings.json`; salvar o arquivo já liga ou desliga o vim.

## O que muda com ele ligado

- As teclas do próprio vim valem dentro do editor: **u** desfaz, **Ctrl+R** refaz, **:w** salva e **:vsplit** divide o grupo de editores, como **Dividir editor à direita**.
- Algumas teclas da janela passam a ser do vim. **Ctrl+O**, por exemplo, é do vim e não abre mais um arquivo: use **Abrir…** pela barra de comandos ou pelo menu **Arquivo**. A barra de comandos mostra as teclas que cada comando tem naquele momento, então um comando que perdeu a tecla com o vim ligado aparece sem nenhuma.
- **Ctrl+K** continua abrindo a barra de comandos, então todo comando continua a uma busca de distância.

## Plugins

O Tyto traz alguns plugins conhecidos do vim dentro do modo vim. Cada um fica ligado enquanto o vim estiver ligado, a menos que você o desligue; a única exceção é o sneak, que fica desligado até você ligá-lo.

| Plugin              | Id                    | Começa    |
| ------------------- | --------------------- | --------- |
| Commentary          | `commentary`          | ligado    |
| Surround            | `surround`            | ligado    |
| ReplaceWithRegister | `replaceWithRegister` | ligado    |
| Exchange            | `exchange`            | ligado    |
| Unimpaired          | `unimpaired`          | ligado    |
| Indent object       | `indentObject`        | ligado    |
| Entire buffer       | `entireBuffer`        | ligado    |
| Sneak               | `sneak`               | desligado |
| Highlighted yank    | `highlightedYank`     | ligado    |
| System clipboard    | `systemClipboard`     | ligado    |

**Commentary** comenta e descomenta linhas com o comentário que a linguagem do arquivo tem: `//` num brief, `<!-- -->` num arquivo Markdown.

| Teclas              | O que fazem                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `gcc`               | Comenta a linha, ou descomenta quando ela já é um comentário. Um número antes, como em `3gcc`, pega essa quantidade de linhas. |
| `gc` e um movimento | As linhas que o movimento cobre: `gcj` pega esta linha e a seguinte, `gcip` o parágrafo.                                       |
| `gc` no modo visual | As linhas selecionadas.                                                                                                        |

**.** repete o último `gc` na linha onde está o cursor.

**Surround** acrescenta, troca e apaga o par em volta de um trecho de texto: parênteses, colchetes, chaves ou aspas.

| Teclas                       | O que fazem                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ys`, um movimento e um par  | Envolve o que o movimento cobre: `ysiw)` transforma `palavra` em `(palavra)`, `ys$"` põe aspas até o fim da linha. |
| `yss` e um par               | Envolve a linha, a partir do primeiro caractere que não é espaço.                                                  |
| `ds` e um par                | Apaga o par em volta do cursor: `ds"` transforma `"palavra"` em `palavra`.                                         |
| `cs`, o par antigo e o novo  | Troca o par em volta do cursor: `cs"'` transforma `"palavra"` em `'palavra'`.                                      |
| `S` e um par, no modo visual | Envolve a seleção.                                                                                                 |

Um par é `(` `)` ou `b`, `[` `]`, `{` `}` ou `B`, `<` `>`, e as aspas `'`, `"` e `` ` ``. Um parêntese, colchete ou chave de abertura põe um espaço dentro do par, como em `( palavra )`, e um de fechamento não põe, como em `(palavra)`. Com `ds` e `cs`, o de abertura também tira os espaços logo dentro do par antigo. As aspas são procuradas na linha do cursor; os outros pares, em qualquer lugar em volta dele. **Esc**, antes do par, cancela.

**.** repete o último `ys`, `cs` ou `ds` com o mesmo par.

**ReplaceWithRegister** troca um trecho pelo que você copiou com `y`, e o que foi copiado continua lá.

| Teclas              | O que fazem                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `gr` e um movimento | Troca o que o movimento cobre: depois de `yiw` numa palavra, `griw` em outra põe a primeira no lugar. |
| `grr`               | Troca a linha. Um número antes, como em `3grr`, pega essa quantidade de linhas.                       |
| `gr` no modo visual | Troca a seleção.                                                                                      |
| `"a` antes do `gr`  | Usa o registrador `a` em vez da última cópia.                                                         |

O registrador fica como estava, então `p` depois ainda cola o que você copiou, e **.** repete o último `gr`.

**Exchange** troca dois trechos de lugar: marque um, depois marque o outro.

| Teclas              | O que fazem                                                                            |
| ------------------- | -------------------------------------------------------------------------------------- |
| `cx` e um movimento | Marca o que o movimento cobre; o segundo `cx` troca com o primeiro: `cxiw` duas vezes. |
| `cxx`               | Marca a linha.                                                                         |
| `X` no modo visual  | Marca a seleção.                                                                       |
| `cxc`               | Esquece a marca.                                                                       |

O primeiro trecho fica marcado com a cor da seleção até o segundo. Um **u** desfaz a troca. Com o exchange desligado, `X` no modo visual volta a apagar as linhas selecionadas, como no vim.

**Unimpaired** acrescenta linhas em branco e move linhas, no modo normal.

| Teclas                  | O que fazem                                                             |
| ----------------------- | ----------------------------------------------------------------------- |
| `[` e depois **Espaço** | Acrescenta uma linha em branco acima da linha do cursor; o cursor fica. |
| `]` e depois **Espaço** | Acrescenta uma linha em branco abaixo.                                  |
| `[e`                    | Sobe a linha.                                                           |
| `]e`                    | Desce a linha.                                                          |

Um número antes acrescenta essa quantidade de linhas, ou move essa quantidade de posições. O resto do vim-unimpaired (buffers, arquivos, opções) não faz parte do Tyto.

**Indent object** e **Entire buffer** são objetos de texto: teclas que você digita depois de um operador como `d`, `c`, `y` ou `gc`, ou no modo visual para selecionar.

| Teclas | O que cobrem                                                                                 |
| ------ | -------------------------------------------------------------------------------------------- |
| `ii`   | O bloco de linhas com o recuo do cursor ou mais fundo: `dii` apaga o bloco, `vii` seleciona. |
| `ai`   | O mesmo bloco e a linha acima que o abre.                                                    |
| `ae`   | Todas as linhas do arquivo: `yae` copia tudo.                                                |
| `ie`   | Todas as linhas menos as em branco no começo e no fim.                                       |

**Sneak** pula para dois caracteres, no modo normal. Fica desligado até você ligá-lo, porque toma o `s` e o `S` do próprio vim.

| Teclas                | O que fazem                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| `s` e dois caracteres | Pula para o próximo lugar onde eles aparecem: `sab` para o próximo `ab`.    |
| `S` e dois caracteres | Pula para o lugar anterior.                                                 |
| `;` e `,`             | Repetem o último sneak, ou o último `f` ou `t`, para a frente ou para trás. |

**Highlighted yank** marca por um instante o texto que você copia, para você ver o que o `y` pegou.

### A área de transferência do sistema

Com o **System clipboard** ligado, `y` também copia para a área de transferência do sistema, então o que você copia no Tyto cola em qualquer outro programa. Só o `y` simples copia: `"ay`, para um registrador com nome, não copia, e `d`, `c` e `x` também não.

O texto que você copia em outro programa chega quando o editor ganha o foco: clique no editor, ou volte para a janela do Tyto, e `p` cola esse texto.

### Desligar um plugin

A configuração [`vimPlugins`](../reference/settings.md#vimplugins) dá o id de cada plugin e diz `true` ou `false`. Um plugin que a configuração não cita fica como na tabela acima, e um plugin que um plugin instalado do Tyto acrescenta fica ligado, pelo id que esse plugin dá a ele.

```json
"vimPlugins": {
  "commentary": false,
  "sneak": true
}
```

Salvar o `settings.json` já troca. O arquivo substitui o objeto inteiro, então escreva só os plugins que você muda. Com o commentary desligado, `gc` volta a ser o do próprio vim: comenta as linhas de um brief com `//` e não faz nada num arquivo Markdown, que não tem comentário de linha. Com o sneak ligado, `s` e `S` no modo normal são do sneak; `cl` e `cc` continuam fazendo o que o `s` e o `S` do próprio vim faziam.
