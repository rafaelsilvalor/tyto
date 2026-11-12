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

A caixa de remover tem uma caixinha, **Também esquecer as credenciais e os logins salvos deste plugin**, que vem desmarcada. Desmarcada, o que você salvou para o plugin no chaveiro do sistema fica — as credenciais, os logins e o cliente de login que você tiver informado — e instalar o plugin de novo encontra tudo. Marcada, tudo isso é apagado junto com a pasta, e não tem volta: uma reinstalação não encontra nada, e você faz login de novo. Nada de outro plugin é tocado. `tyto plugin remove` nunca esquece essas informações; ele avisa isso quando termina.

A janela inicia os plugins quando abre, então toda mudança vale na próxima vez que você abrir o Tyto: até lá a linha diz _reinicie para aplicar_. Um plugin desligado aparece como _desativado_, e o que ele acrescentou — os templates, os temas — some da janela quando o Tyto abrir de novo.

As mesmas mudanças se fazem pelo terminal, com os comandos de [Plugins](../command-line/plugins.md):

| Para                                                                   | Execute                        |
| ---------------------------------------------------------------------- | ------------------------------ |
| instalar um a partir de uma pasta, de um arquivo `.tgz`, de git ou npm | `tyto plugin install <origem>` |
| desligar um sem removê-lo                                              | `tyto plugin disable <nome>`   |
| religá-lo                                                              | `tyto plugin enable <nome>`    |
| remover um                                                             | `tyto plugin remove <nome>`    |

## Dar a um plugin a sua chave

::: info Conferida de outro jeito
Esta seção entrou em 2026-11-12 e foi conferida pelo teste de ponta a ponta do app, com um arquivo de chave inventado, no formato do de uma conta de serviço. Ninguém a seguiu à mão com uma chave de verdade ainda.
:::

Um plugin que trabalha com um serviço seu pode pedir uma chave — um token de API, ou o arquivo de chave de uma conta de serviço — com uma permissão `credentials:`. A linha dele mostra uma linha por chave: o nome da chave, se está **preenchida** ou **não preenchida**, um campo, **Salvar**, **Importar de arquivo…** e, quando há algo guardado, **Apagar**.

- **Um arquivo de chave**, como a chave JSON que um console de nuvem baixa: clique em **Importar de arquivo…** e escolha o arquivo. O Tyto o lê e guarda o texto exatamente como está, com as quebras de linha. Um arquivo acima de 16 KiB, vazio ou que não é texto é recusado, e a linha diz por quê.
- **Uma chave que você copiou**: cole no campo e clique em **Salvar**, ou aperte Ctrl+Enter. O campo mantém as quebras de linha, então uma chave de várias linhas chega inteira; Enter começa uma linha nova.

Nos dois casos a chave vai para o cofre do sistema. O Tyto não a mostra de novo — o campo fica mascarado enquanto você digita e vazio depois de salvar, e a linha só diz **preenchida**. Para trocar, guarde outra; **Apagar** a esquece.

## Entrar numa conta para um plugin

::: info Conferida de outro jeito
Esta seção entrou em 2026-11-08 e foi conferida pelo teste de ponta a ponta do app, com um serviço de login de teste neste computador e a parte do navegador respondida pelo teste. Ninguém a seguiu à mão com um provedor de verdade ainda.
:::

Alguns plugins trabalham com a sua própria conta em outro lugar — um conector que cria arquivos no seu armazenamento, por exemplo. Um plugin assim pede uma permissão `signin:`, e a linha dele na caixa de plugins mostra uma linha por login que ele declara:

1. A linha diz **Não conectado**. Clique em **Entrar**.
2. O navegador abre na página do provedor. Entre lá e aprove. Depois o navegador mostra uma página do Tyto dizendo que o login foi feito; pode fechar essa aba.
3. De volta à caixa, a linha diz **Conectado como** e a conta, ou só **Conectado** quando o provedor não diz quem é.

Enquanto o navegador está aberto, a linha pede que você termine o login lá e tem **Cancelar**. Se você fechou a aba do navegador ou escolheu a conta errada, clique em **Cancelar**: a tentativa termina na hora, nada é guardado, e você pode clicar em **Entrar** de novo.

Clique em **Sair** para encerrar. Nada mais começa um login: um plugin que precisa de um quando você está desconectado para e pede que você entre por esta caixa, e ele nunca abre o navegador sozinho.

O Tyto guarda o login no chaveiro do sistema, e o plugin recebe do Tyto só um token de acesso de curta duração, nunca o que mantém você conectado. Num computador sem chaveiro para criptografar, o login não termina e a linha diz por quê. A linha de comando não faz login pelo navegador: uma receita que precisa de login só funciona na janela.

### Um login que pede o seu próprio cliente

::: info Conferida de outro jeito
Esta seção entrou em 2026-11-11 e foi conferida pelo teste de ponta a ponta do app, que digita um cliente na tela e entra num serviço de login de teste que só aceita esse cliente. Ninguém criou um cliente num provedor de verdade e a seguiu à mão ainda.
:::

Um provedor reconhece o app que pede o seu login pelo **cliente OAuth**: um ID do cliente e, às vezes, um segredo do cliente. Alguns plugins trazem o próprio cliente. Outros deixam o cliente com você, para que uma equipe use o seu sem escrevê-lo num plugin que qualquer pessoa lê. Num login assim, a linha mostra também **Cliente OAuth: não preenchido**, dois campos e **Salvar**, e **Entrar** fica desligado até o cliente ser preenchido:

1. Digite o **ID do cliente** e, quando o provedor tiver dado um, o **Segredo do cliente (opcional)**. Clique em **Salvar**.
2. A linha diz **Cliente OAuth: preenchido**, e os campos ficam vazios de novo: o Tyto nunca mostra o cliente de volta. Clique em **Entrar** e siga como acima.

O Tyto guarda o cliente no chaveiro do sistema, junto do login, nunca no `settings.json`. **Salvar outro cliente, ou clicar em Apagar, desconecta** esse login, porque o que mantinha você conectado foi emitido para o cliente antigo. Um plugin que traz o próprio cliente não mostra os campos: o cliente dele não pode ser trocado.

Alguém da sua equipe pode passar o cliente para você. Para criar um, num provedor que emite clientes por projeto — o Google Cloud, por exemplo:

1. Abra o console do provedor e escolha ou crie um projeto.
2. Configure a tela de consentimento que o provedor pede, e adicione você como usuário de teste se o app ficar em teste.
3. Ative as APIs que o plugin diz usar.
4. Crie um cliente OAuth do tipo **App para computador** (Desktop app). O Tyto faz o login pelo seu navegador e por uma porta só deste computador, que é o que esse tipo permite.
5. Copie o ID e o segredo do cliente para os campos acima. O segredo de um cliente para computador não é confidencial: toda cópia instalada de um app o carrega.

## Plugins que abrem um programa

::: info Conferida de outro jeito
Esta seção entrou em 2026-11-09 e foi conferida pelos testes de ponta a ponta do app, com um programa de teste neste computador. Ninguém a seguiu à mão com um agente de verdade ainda.
:::

Alguns plugins funcionam conversando com outro programa do seu computador — um painel de agente que conversa com o comando `claude` que você já usa, por exemplo. Um plugin assim pede uma permissão `process:` com o nome desse único programa, e você a vê antes de aprovar: `process:claude` aparece como **start the program claude on your computer** na caixa de instalação, e a linha do plugin na caixa de plugins lista os programas que ele pode abrir.

- **Quem abre o programa é o Tyto, não o plugin**, e só o que tem o nome escrito: `process:claude` não abre nenhum outro. O programa é o que o seu `PATH` encontra, então é o mesmo `claude` que você roda num terminal, com o mesmo login. O Tyto não instala programa nenhum: quando ele não está lá, o plugin fica sabendo e pode avisar você.
- **Ele roda na pasta aberta no Tyto, e nunca enquanto essa pasta estiver restrita.** Abrir outra pasta, ou confiar ou deixar de confiar nesta, encerra os programas que um plugin abriu; fechar a janela também.
- **Ele roda como você.** O programa lê e altera o que você pode. Ele recebe a pasta onde roda e algumas configurações do sistema, como onde fica a sua pasta pessoal e o seu proxy, e nunca os segredos do Tyto nem uma variável cujo nome parece uma chave ou um token.
- **Ele pode alcançar a janela do Tyto como agente**, enquanto `agentsListen` estiver ligado nas suas configurações: o plugin pode dizer a ele como. Aí ele lê o que está aberto na janela, e uma mudança que ele queira fazer chega como proposta para você aprovar ou recusar, como acontece com um agente aberto num terminal do Tyto. A caixa de instalação avisa isso ao lado do nome do programa. Desligar o `agentsListen`, ou uma pasta restrita, deixa ele de fora.

Um plugin que acrescenta um programa novo numa atualização não é iniciado até você aprovar de novo. A linha de comando não abre programas para plugins.

### Um programa que vem com o plugin

Alguns plugins trazem o próprio programa em vez de pedir que você o instale, como um painel de agente que já vem com o pequeno adaptador por onde conversa. Esse programa é **código do próprio plugin**: o Tyto o roda com o Node que traz consigo, e não o procura no seu `PATH`. A caixa de instalação avisa: `process:claude-agent-acp` aparece como **run this plugin's own program claude-agent-acp (adapter/claude-agent-acp.mjs) on Tyto's Node**, e um parágrafo logo abaixo explica o que isso quer dizer. A caixa de plugins lista esses programas numa linha só deles.

- **Ele não fica confinado como o plugin fica.** O plugin em si não lê os seus arquivos, mas o programa dele pode ler e alterar arquivos e acessar a rede, como qualquer programa que você roda. Aprovar é confiar em quem escreveu o plugin.
- **As regras acima continuam valendo.** Ele só roda a partir da pasta do próprio plugin, na pasta aberta no Tyto, nunca enquanto essa pasta estiver restrita, sem os segredos do Tyto nem variáveis com cara de chave ou token, e no máximo dois programas de um plugin rodam ao mesmo tempo. Quando o arquivo some da pasta do plugin, o plugin fica sabendo que precisa ser reinstalado.
- **Ele tem uma pasta própria para o que guarda**, como algo que baixa na primeira vez que você o usa. A pasta fica dentro da pasta do próprio Tyto (`~/.tyto/data/plugins/<plugin>`), continua lá quando o plugin é atualizado e é apagada quando você remove o plugin. O Tyto dá a mesma pasta a todo programa que um plugin abre, inclusive um do seu `PATH`.

### Um terminal aberto por um plugin

Um plugin pode abrir uma aba no **Terminal** do Tyto rodando um dos programas que declara, para algo que precisa de você no teclado, como entrar na conta de um agente. A aba abre na frente, na pasta aberta no Tyto, e você vê tudo o que o programa mostra. O plugin só fica sabendo que a aba abriu: nunca vê o que o programa mostra nem o que você digita. Fica aberta uma aba dessas por plugin de cada vez; feche-a, ou deixe o programa terminar, antes que o plugin abra outra. A aba é sua: ela não fecha quando o plugin para.

## Um plugin é seguro?

Cada plugin instalado roda separado da janela, então um plugin que trava para a si mesmo e não o Tyto, e ele só alcança o que as permissões deixam. A caixa mostra essas permissões, e tanto a caixa de instalação quanto o `tyto plugin install` as mostram antes de você aprovar. Escrever um plugin está no [guia de autoria de plugins](../extend/), em inglês.
