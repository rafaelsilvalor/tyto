# Plugins

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `b039537`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

Um **plugin** acrescenta coisas ao Tyto: templates, temas de cores, tipos de arquivo para exportar e mais. Alguns vêm com o Tyto e estão sempre lá; outros você instala.

## Ver o que está instalado

Execute **Mostrar plugins** pela barra de comandos ou pelo menu **Arquivo**, ou clique no botão de plugins na barra de status. A caixa lista cada plugin — os que vêm com o Tyto como _embutido_, os seus como _instalado_ — com a versão, a situação (_ativo_ ou _desativado_), o que ele acrescenta e as permissões que recebeu. Ela também diz em que pasta ficam os plugins instalados.

## Instalar, desligar e remover

A janela mostra os plugins; ela não os instala. Isso se faz pelo terminal, com os comandos de [Plugins](../command-line/plugins.md):

| Para                                                        | Execute                        |
| ----------------------------------------------------------- | ------------------------------ |
| instalar um a partir de uma pasta, de uma URL git ou do npm | `tyto plugin install <origem>` |
| desligar um sem removê-lo                                   | `tyto plugin disable <nome>`   |
| religá-lo                                                   | `tyto plugin enable <nome>`    |
| remover um                                                  | `tyto plugin remove <nome>`    |

A janela inicia os plugins quando abre, então uma mudança feita com ela aberta vale na próxima vez que você abrir. Um plugin desligado aparece como _desativado_ na caixa, e o que ele acrescentou — os templates, os temas — some da janela até você religá-lo.

## Um plugin é seguro?

Cada plugin instalado roda separado da janela, então um plugin que trava para a si mesmo e não o Tyto, e ele só alcança o que as permissões deixam. A caixa mostra essas permissões, e o `tyto plugin install` as mostra antes de você aprovar. Escrever um plugin está no [guia de autoria de plugins](../extend/), em inglês.
