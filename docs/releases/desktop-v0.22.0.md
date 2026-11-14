# Tyto 0.22.0

**A partir desta versão, uma receita se lê em blocos, como um notebook do Jupyter: cada bloco tem uma barra para
executar, mover e apagar, um + entre os blocos insere um passo ou uma nota, o teclado age sobre blocos inteiros e um bloco
vai para outro lugar arrastado pela alça.** Pela linha de comando, `tyto signin` faz o login de um plugin pelo navegador,
e uma receita rodada no terminal passa a usar a sua conta.

A versão 0.21.0 não foi publicada: tudo o que ela trouxe chega agora, junto com a 0.22.0.

## O que há de novo

**A receita em blocos.** Uma linha em branco separa um bloco do seguinte, e um bloco pode ter vários passos e linhas de
comentário `#`; ele mostra o resultado do último passo, enquanto todos rodam e cada um marca os próprios problemas. Na
primeira linha de cada bloco, uma pequena barra:

- **▶ Executar este bloco** roda o bloco e o que mudou acima dele, e para ali.
- **↑ Mover para cima**, **↓ Mover para baixo** e **✕ Apagar bloco** mexem no bloco inteiro; **Ctrl+Z** desfaz.
- **▶▶ Executar daqui para baixo** e **▾ Ocultar resultado**. A barra do cabeçalho tem **Executar tudo**.

Um **+** na fronteira entre os blocos oferece **Passo…**, que abre o seletor de passos e escreve a linha ali, e **Nota**,
um comentário que nunca roda. À esquerda de cada bloco, um contador diz quando ele rodou: `[3]`, `[*]` enquanto roda,
`[ ]` se ainda não rodou, e apagado quando algo acima mudou depois.

**Arrastar um bloco pela alça** (⠿), na ponta esquerda da primeira linha dele: uma linha mostra onde ele vai cair, **Esc**
cancela e um **Ctrl+Z** devolve. Perto da borda de cima ou de baixo, a receita rola sozinha, mais rápido quanto mais perto,
então um bloco chega a qualquer lugar de uma receita maior que o painel.

**O modo comando.** Aperte **Esc** numa receita (**Shift+Esc** com o vim ligado; **Ctrl+M** nos dois) e o teclado age
sobre o bloco marcado: **A** e **B** inserem um bloco acima ou abaixo, **D** **D** apaga, **Shift+Enter** executa e passa
para o próximo, **J** e **K** ou as setas escolhem outro, **O** oculta o resultado e **Enter** volta ao texto. No texto,
**Shift+Enter** executa o bloco do cursor.

**Vários passos numa linha só.** Um `|` com um espaço de cada lado divide a linha em passos, como se cada um estivesse na
sua própria linha: `where status != done | sort due | show table`. Um `|` encostado numa palavra, ou entre aspas, não
divide.

**Criar e montar uma receita sem decorar a sintaxe.** No Explorador ou pela barra de comandos:

- **Nova receita…** escreve uma receita que já roda como está, e **Novo vocabulário…** um arquivo de regras ao lado dela,
  que abre numa aba própria e aponta cada problema no lugar.
- **Carregar receita…** traz a receita de um colega de qualquer lugar do disco, com as receitas e os arquivos de dados que
  ela usa, sem sobrescrever nada que já esteja na pasta.
- **Adicionar passo** abre a lista de todos os verbos, agrupados em **Fontes**, **Transformações**, **Ações** e
  **Destinos**, e depois o formulário do verbo escolhido; **Editar passo** abre o formulário do passo onde está o cursor,
  preenchido. A explicação de cada verbo e de cada campo aparece em português, e o verbo de um plugin mostra a ajuda que o
  plugin escreveu para cada campo.

**Uma receita que envia.** O passo `call` planeja um `POST` por linha da tabela para um endereço que a pasta permite, e
só envia quando você clica em **Aplicar**. A credencial fica em **Mostrar plugins** ▸ **Credenciais de receitas**, no
cofre do sistema, e o Tyto não a mostra de novo. No terminal, `tyto recipe run` roda uma receita e mostra os planos, e
`--apply` os aplica numa pasta confiável; o painel de comandos da janela só planeja e diz onde aplicar.

**O painel Agendamentos.** **Mostrar ou esconder: Agendamentos**, na barra de comandos, lista cada receita da pasta aberta
que roda em intervalo, com a última execução, a próxima e como terminou, e os botões **Rodar agora** e **Abrir**. Uma
execução por intervalo agora busca dados atuais em vez de responder do cache, então a receita vê o que mudou já na
execução seguinte.

**Mais coisas que uma receita escreve.**

- `warn` avisa uma pessoa sobre as linhas que uma condição encontra, com uma mensagem montada a partir da linha.
- Um nome de coluna entre aspas pode ter acento e espaço: `into="Última Sync"`.
- `{due|local:dd/MM/yyyy HH:mm}` escreve uma data e hora no fuso das receitas (a configuração `recipeTimeZone`), então uma
  entrega às 22h em São Paulo fica no dia certo.
- `decide` aceita `clear=push`: um valor que você apagou do seu lado passa a apagar o do outro lado também.
- Um nome de arquivo com acento perde só o acento (`Matemática` vira `Matematica.brief`), e um nome que o Windows reserva,
  como `CON`, ganha um `_`.
- Depois de um **Aplicar** que gravou, a próxima execução planeja de novo, e o plano mostra o que mudou.

**Login e credenciais.**

- **`tyto signin`** faz o login de um plugin pelo navegador, no terminal, e guarda o login no chaveiro do sistema;
  `tyto signout` o esquece. Os logins do terminal e os da janela são separados: entre uma vez em cada um.
- Um login esperando no navegador tem **Cancelar** na tela de plugins: a tentativa termina na hora, e **Entrar** funciona
  de novo sem esperar cinco minutos.
- Um plugin pode deixar o **cliente OAuth** com você: a linha do login mostra os campos do cliente, e você o preenche uma
  vez, sem que ele fique escrito no plugin.
- Uma chave de várias linhas, como o arquivo JSON de uma conta de serviço, se guarda com **Importar de arquivo…**.
- A caixa de remover um plugin tem **Também esquecer as credenciais e os logins salvos deste plugin**, desmarcada. Marcada,
  tudo o que você guardou para ele no chaveiro é apagado junto.

**Um arquivo de plugins pode apontar para um `.zip`**, baixado por https ou lido deste computador, sem precisar do Git.

**Correções.**

- A visão de uma receita mantém o filtro rápido, o Calendário o período e os Cartões o cartão aberto quando uma nova
  execução ou outro idioma refaz a célula; a aba de um resultado em tamanho cheio segue o seu passo quando entram passos
  acima dele.
- Depois de recolher um resultado, a janela volta a saber onde estão as linhas de baixo: antes, ela as contava 74 pixels
  abaixo de onde as desenhava.
- O painel de um plugin não lê mais uma credencial em texto, e o painel de um plugin não alcança mais o de outro com o
  mesmo nome.

## Para quem escreve plugins

A `@tyto/plugin-api` chega à 0.21. O que muda:

- **Ajuda nos campos de um verbo.** Um argumento de verbo de receita pode trazer `description`, até 1.000 caracteres, que
  o formulário do passo mostra como ajuda do campo.
- **`refresh`** chega à transformação de uma receita numa execução sem cache, como já chegava ao `page` de uma fonte:
  **Buscar de novo** e toda execução por intervalo.
- **`signin.<id>` sem `clientId`**: a pessoa digita o cliente OAuth na tela de plugins ou com `tyto signin --client`.
- **O painel não lê credencial.** Um pedido `credentials` do painel é recusado com `E_PANEL_CREDENTIAL_READ`; o painel
  chega ao efeito de um segredo pedindo ao próprio plugin com `call`, e ainda guarda e esquece as chaves dele.
- **`recipe:` e `signin-client:` são reservados**: nenhuma permissão `credentials:` de plugin os alcança.

## O que ela ainda não faz

**`tyto signin` precisa de um chaveiro.** Um servidor Linux sem sessão de desktop ou uma máquina de CI não consegue fazer
login assim, e nada é gravado em outro lugar. O painel de comandos da janela recusa `tyto signin` e `tyto signout`: lá, o
login é pela tela de plugins. O login do terminal foi conferido contra um provedor de teste, não contra um provedor real.

**O `call` foi conferido contra um endereço simulado**, não pela rede. E encadear passos com `|` foi conferido pelos
testes, não na janela.

**Os contadores dos blocos são da aba**: recomeçam quando ela fecha.

**É preciso ter o Git instalado** para a galeria e para um arquivo de plugins que aponta para um repositório; um que aponta
para um `.zip` não precisa.

**O instalador não é assinado.** Na primeira vez que você abrir:

- **Windows**: o SmartScreen mostra "O Windows protegeu o computador". Clique em **Mais informações** e depois em
  **Executar assim mesmo**. Isso quer dizer que o arquivo não tem certificado pago, não que ele esteja infectado.
- **macOS**: o Gatekeeper recusa na primeira tentativa. Clique com o botão direito no aplicativo, escolha **Abrir** e
  confirme.

**No Mac e na versão do Windows que roda sem instalar, a atualização não é automática**: o rodapé mostra **"Versão X
disponível — Baixar"**, com um link para esta página. Quem instalou com `Tyto-Setup` no Windows, ou usa o Linux, recebe
esta versão sozinho.

## Se alguma coisa der errado

Me mande a pasta do log:

- Com a janela aberta: menu **Ajuda ▸ Abrir a pasta do log**.
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.22.0\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.22.0/logs`; no Linux, `~/.config/Tyto/0.22.0/logs`.

Na primeira vez que a 0.22.0 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos recentes, os seus atalhos de teclado e as abas que estavam abertas.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.22.0.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.22.0.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.22.0-universal.dmg`                                                 |
| Linux                       | `Tyto-0.22.0.AppImage`: dê permissão de execução e rode                     |

O terminal vem dentro de cada um desses arquivos: não há nada a instalar à parte.

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
