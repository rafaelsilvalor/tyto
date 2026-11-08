# Plugins

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `b039537`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

Um **plugin** acrescenta coisas ao Tyto: templates, temas de cores, tipos de arquivo para exportar e mais. Alguns vêm com o Tyto e estão sempre lá; outros você instala.

## Ver o que está instalado

Execute **Mostrar plugins** pela barra de comandos ou pelo menu **Arquivo**, ou clique no botão de plugins na barra de status. A caixa lista cada plugin — os que vêm com o Tyto como _embutido_, os seus como _instalado_ — com a versão, a situação (_ativo_ ou _desativado_), o que ele acrescenta e as permissões que recebeu. Ela também diz em que pasta ficam os plugins instalados.

## Instalar, desligar e remover

::: info Conferida de outro jeito
Esta seção entrou em 2026-11-08. Instalar a partir de uma pasta, remover e Configurações foram conferidos pelos testes de ponta a ponta do app, com o seletor de arquivos e as caixas do sistema respondidos pelo teste; instalar a partir de um arquivo foi conferido por testes de unidade. Ninguém a seguiu à mão ainda.
:::

Pela caixa de plugins, sem terminal:

1. Clique em **Instalar de uma pasta…** e escolha a pasta do plugin, ou em **Instalar de um arquivo…** e escolha o arquivo `.tgz` ou `.tar.gz` dele.
2. Uma caixa mostra o nome do plugin, o que ele acrescenta e cada permissão que ele pede — o mesmo texto que o `tyto plugin install` mostra. Clique em **Instalar** para aprovar. **Cancelar**, Esc ou fechar a caixa não instala nada.
3. O plugin aparece na lista com _reinicie para aplicar_.

Na linha de um plugin instalado:

| Botão             | O que faz                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------- |
| **Desativar**     | desliga o plugin sem removê-lo                                                               |
| **Ativar**        | religa o plugin                                                                              |
| **Remover**       | apaga a pasta dele e as permissões que você aprovou, depois de uma caixa que vem em Cancelar |
| **Configurações** | abre o `settings.json` na primeira configuração do plugin, para um plugin que tem as suas    |

Um plugin que vem com o Tyto não tem botões. Os plugins instalados pela galeria se gerenciam na galeria.

A janela inicia os plugins quando abre, então toda mudança vale na próxima vez que você abrir o Tyto: até lá a linha diz _reinicie para aplicar_. Um plugin desligado aparece como _desativado_, e o que ele acrescentou — os templates, os temas — some da janela quando o Tyto abrir de novo.

As mesmas mudanças se fazem pelo terminal, com os comandos de [Plugins](../command-line/plugins.md):

| Para                                                                   | Execute                        |
| ---------------------------------------------------------------------- | ------------------------------ |
| instalar um a partir de uma pasta, de um arquivo `.tgz`, de git ou npm | `tyto plugin install <origem>` |
| desligar um sem removê-lo                                              | `tyto plugin disable <nome>`   |
| religá-lo                                                              | `tyto plugin enable <nome>`    |
| remover um                                                             | `tyto plugin remove <nome>`    |

## Entrar numa conta para um plugin

::: info Conferida de outro jeito
Esta seção entrou em 2026-11-08 e foi conferida pelo teste de ponta a ponta do app, com um serviço de login de teste neste computador e a parte do navegador respondida pelo teste. Ninguém a seguiu à mão com um provedor de verdade ainda.
:::

Alguns plugins trabalham com a sua própria conta em outro lugar — um conector que cria arquivos no seu armazenamento, por exemplo. Um plugin assim pede uma permissão `signin:`, e a linha dele na caixa de plugins mostra uma linha por login que ele declara:

1. A linha diz **Não conectado**. Clique em **Entrar**.
2. O navegador abre na página do provedor. Entre lá e aprove. Depois o navegador mostra uma página do Tyto dizendo que o login foi feito; pode fechar essa aba.
3. De volta à caixa, a linha diz **Conectado como** e a conta, ou só **Conectado** quando o provedor não diz quem é.

Clique em **Sair** para encerrar. Nada mais começa um login: um plugin que precisa de um quando você está desconectado para e pede que você entre por esta caixa, e ele nunca abre o navegador sozinho.

O Tyto guarda o login no chaveiro do sistema, e o plugin recebe do Tyto só um token de acesso de curta duração, nunca o que mantém você conectado. Num computador sem chaveiro para criptografar, o login não termina e a linha diz por quê. A linha de comando não faz login pelo navegador: uma receita que precisa de login só funciona na janela.

## Um plugin é seguro?

Cada plugin instalado roda separado da janela, então um plugin que trava para a si mesmo e não o Tyto, e ele só alcança o que as permissões deixam. A caixa mostra essas permissões, e tanto a caixa de instalação quanto o `tyto plugin install` as mostram antes de você aprovar. Escrever um plugin está no [guia de autoria de plugins](../extend/), em inglês.
