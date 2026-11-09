# Tyto 0.17.0

**A partir desta versão, um agente de IA como o Claude Code trabalha com a janela do Tyto que você tem aberta: ele lê o
brief da frente e o que você selecionou, abre arquivos, mostra formatos na prévia e propõe mudanças no texto que você
aceita ou recusa, sem nada ser gravado sem você.** **Terminal: Abrir um agente aqui** abre esse agente já conectado, o
`tyto mcp` liga o Claude Desktop e o Claude Code a uma pasta de projeto, e um plugin pode abrir um programa que ele
nomeia, como o `claude`, para conversar com ele dentro da janela.

A versão 0.16.0 não foi publicada: tudo o que ela trouxe chega agora, junto com a 0.17.0.

## O que há de novo

**Um agente conectado à janela aberta.** Enquanto a janela está aberta, ela espera por um agente, e só um programa que
roda como você consegue chegar até ela. Pela janela, o agente pode:

- **Ler o brief da frente**, inclusive o que você digitou e não salvou, e **ler a seleção**.
- **Abrir um arquivo** da pasta numa aba e **mostrar um formato** do brief na prévia, numa pasta em que você confiou.
  Por padrão, a janela pergunta antes numa caixa, com **Abrir** (ou **Mostrar**) e **Não**.
- **Propor uma mudança** no texto do documento da frente. A mudança aparece no editor, o texto antigo riscado e o novo
  ao lado, sob uma barra que diz **Proposto por um agente**, com **Aceitar** e **Recusar**. Aceitar aplica tudo de uma
  vez, e um Ctrl+Z desfaz tudo; o arquivo não é salvo. Se você digitar dentro do texto proposto antes de decidir, a
  proposta é descartada, nunca aplicada sobre o que você reescreveu.

Enquanto um agente está conectado, a barra de status mostra **Agente conectado**; um clique nele corta todas as conexões.
Duas configurações mudam isso: `agentsWindowActions` em `"allow"` deixa o agente abrir e mostrar sem perguntar (uma
mudança no texto continua sendo sempre uma proposta), e `agentsListen` em `false` fecha a conexão e corta todos os
agentes, na hora, até voltar a `true`.

**Terminal: Abrir um agente aqui.** Na barra de comandos e no menu **Ferramentas**, abre um agente num terminal novo, na
pasta aberta, já conectado a esta janela, sem nada para registrar. O programa é o `claude` (Claude Code), a menos que
`agentCommand` no `settings.json` nomeie outro, como `"codex"`; `agentArgs` acrescenta argumentos. Numa pasta em que você
não confiou, o agente é recusado como o terminal. Todo terminal que o Tyto abre diz aos programas dentro dele qual janela
o abriu, então um `claude` que você registrou uma vez e abre ali à mão chega a esta janela.

**`tyto mcp`: o Claude Desktop e o Claude Code trabalham com uma pasta de projeto.** Avisado uma vez, o agente lista os
templates, lê o que um template espera, confere os erros de um brief com linha e coluna e olha a prévia de um formato
como imagem, sem mudar nenhum arquivo. Um caminho fora da pasta é recusado, nenhuma resposta traz uma senha ou chave, e
uma imagem que um brief cita só é desenhada quando está dentro da pasta. `tyto mcp --window` liga o agente à janela aberta
em vez de ler a pasta sozinho. A página **Conectar um agente de IA** do manual diz o que escrever no Claude Desktop e no
Claude Code.

**Plugins que abrem um programa.** Um plugin pode pedir a permissão `process:` com o nome de um único programa do seu
computador, como `process:claude`, e você a vê antes de aprovar; a linha do plugin na caixa de plugins lista os programas
que ele pode abrir. Quem abre o programa é o Tyto, não o plugin, e só o que tem o nome escrito. Ele roda na pasta aberta,
nunca numa pasta restrita, recebe o ambiente sem nenhum segredo do Tyto e termina quando você abre outra pasta, muda a
confiança nela ou fecha a janela. Enquanto `agentsListen` estiver ligado, o plugin pode ligar esse programa à janela como
agente: as mudanças dele chegam como propostas, como as de um agente aberto no terminal. É o que um painel de agente
precisa para conversar com o `claude` que você já usa.

**Modo de verificação.** Quando o Tyto é aberto com uma porta de depuração, para um agente de código olhar a janela, o
primeiro item da barra diz **Modo de verificação · porta N**, com contorno vermelho, e nenhuma configuração o esconde.
Enquanto ele aparece, qualquer programa deste computador pode ler e comandar a janela. Ele nunca liga sozinho; feche o
Tyto e abra do jeito de sempre para desligar.

**A caixa de plugins instala, desliga e remove.** **Instalar de uma pasta…** e **Instalar de um arquivo…** (um `.tgz` ou
`.tar.gz`) mostram as mesmas permissões que o `tyto plugin install` mostra, antes de você clicar em **Instalar**. Cada
plugin instalado pode ser desligado, ligado de novo e removido, e as mudanças valem na próxima vez que o Tyto abrir. Um
plugin que trabalha com uma conta sua em outro lugar mostra **Não conectado** e **Entrar**: o navegador abre na página do
provedor, e o Tyto guarda o login no chaveiro do sistema.

**Receitas:**

- **Aplicar um plano.** A linha de um plano mostra as primeiras operações e um botão **Aplicar**, que grava exatamente
  o que você está vendo; depois, cada operação diz se foi aplicada, falhou ou ficou de fora. Uma receita cujo cabeçalho
  diz `apply auto` aplica sozinha os planos de uma execução, só numa pasta confiável.
- **Uma tabela inteira, não só a prévia.** `show table` desenha todas as linhas na **visão de Tabela**, com ordenar por
  coluna, um filtro, **Colunas** para esconder colunas e copiar uma seleção; `show summary` acrescenta o **Total geral**.
  `show board by=<coluna>` desenha um **Quadro**, `show calendar date=<coluna>` um **Calendário** e `show cards` uma grade
  de **cartões soltos**, que se abrem com todas as colunas da linha. Todos são só para leitura.
- **Abrir numa aba**, na linha de um passo, desenha o resultado com toda a altura da janela; o comando **Abrir o
  resultado da célula numa aba** faz o mesmo com o passo do cursor.
- **Um brief por linha.** O passo `to-brief` transforma cada linha da tabela num brief, no template que você nomeia;
  **Aplicar** grava os briefs, só numa pasta confiável.
- **Mostrar as células da receita incluída**, na linha de um passo `run`, abre os passos da outra receita, só para
  leitura.
- **Receitas que rodam sozinhas.** Enquanto a janela está aberta, uma receita de uma pasta confiável cujo cabeçalho diz
  `every 30m` (ou `every 2h`) roda a cada intervalo. A primeira execução com problema depois de uma sem problema mostra
  uma notificação do sistema com o nome da receita.
- **Uma tabela recolhida fica recolhida** quando você insere um passo acima dela.

## Para quem escreve plugins

A `@tyto/plugin-api` chega à 0.16. **Um plugin ou um template de repositório próprio construído com uma `plugin-api`
anterior continua abrindo**, desde que a faixa `engine` do manifesto dele aceite a 0.16, como `>=0.11` aceita. Quem
decide é essa faixa: uma que esta versão não satisfaz é recusada na instalação com `E_PLUGIN_ENGINE`, que diz as duas
versões. Para usar o que vem abaixo, construa o plugin com a `plugin-api` 0.16 e declare `"engine": ">=0.16"`. O que
muda:

- **`apply`**: uma ação ou um destino de receita grava o plano que a pessoa viu, em lotes de até 100 operações, e uma
  operação pode levar o seu próprio `payload`.
- **`call`**: a página de um painel chama o processo do próprio plugin, e de nenhum outro.
- **`signin`**: um plugin declara um login pelo navegador e pede ao Tyto o token de acesso com
  `host.signin.accessToken(id)`; o token de renovação fica no chaveiro e nunca chega ao plugin.
- **`process:<nome>`**: `host.process.start(nome, args)` abre aquele único programa e responde com a pasta onde ele
  roda; `host.window.agentServer()` dá o servidor MCP da janela no formato que o `session/new` do ACP recebe.

## O que ela ainda não faz

**O painel de agente é um plugin à parte.** Esta versão traz o que um painel de conversa com o Claude precisa, mas o
painel em si não vem com o Tyto: ele é instalado separadamente, quando estiver publicado. Até lá, use **Terminal: Abrir
um agente aqui**.

**O Tyto não instala nenhum agente.** O `claude` (ou o programa que `agentCommand` nomeia) precisa estar instalado e com
login feito. Quando ele não está, a aba do terminal diz isso, e um plugin fica sabendo que o programa não foi encontrado.

**No Mac, um plugin aberto pelo Dock pode não achar o programa.** Um aplicativo aberto pelo Dock ou pelo Finder recebe uma
lista curta de pastas onde procurar programas, sem as pastas do Homebrew ou do npm, então um `claude` instalado ali pode
não ser encontrado por um plugin. O terminal do Tyto não tem esse problema. Isso não foi medido num Mac.

**É preciso ter o Git instalado** para a galeria e para buscar templates por arquivo de plugins. Sem ele, a busca falha e
o painel de problemas diz qual repositório não veio.

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
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.17.0\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.17.0/logs`; no Linux, `~/.config/Tyto/0.17.0/logs`.

Na primeira vez que a 0.17.0 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos recentes, os seus atalhos de teclado e as abas que estavam abertas.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.17.0.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.17.0.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.17.0-universal.dmg`                                                 |
| Linux                       | `Tyto-0.17.0.AppImage`: dê permissão de execução e rode                     |

O terminal vem dentro de cada um desses arquivos: não há nada a instalar à parte.

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
