# Tyto 0.20.0

**A partir desta versão, o painel de agente conversa com o Claude dentro da janela do Tyto de dois jeitos: com o Claude
Code que você já usa, com login em um clique, ou com a sua própria chave da API do Claude, com agentes que você configura
por modelo e um teto de gasto por mês.** Pela linha de comando, um agente ligado ao `tyto mcp` agora também escreve
briefs, cria entregas, exporta e roda receitas, numa pasta em que você confiou, e lê o guia que cada template traz.

As versões 0.18.0 e 0.19.0 não foram publicadas: tudo o que elas trouxeram chega agora, junto com a 0.20.0.

## O que há de novo

**O painel de agente, com o Claude Code e login em um clique.** O painel é um plugin à parte (veja abaixo como
instalar). Na primeira vez que ele abre, diz o que precisa baixar, de onde e quanto ocupa (o adaptador do Claude Code,
cerca de 54 MB, do registro do npm) e só baixa quando você clica em **Baixar**. Cada arquivo é conferido contra a
assinatura que o plugin traz, e um download que falha não deixa nada para trás. Depois, se o Claude não está com login
feito, o painel mostra **Entrar no Claude**: o Tyto abre uma aba de terminal com o login do próprio Claude, o navegador
abre na página dele, e o Tyto nunca vê nem guarda esse login. Quando você volta ao painel, ele tenta de novo sozinho. Atrás
de um proxy, defina `HTTPS_PROXY` (e `NO_PROXY`, se precisar) antes de abrir o Tyto, e o download passa por ele. No
Windows, um Claude Code instalado pelo npm também serve, desde a versão 2.1.200.

**O painel de agente com a sua chave da API do Claude.** Com `agent.agent` em `"claude-api"` no `settings.json`, o painel
fala direto com a API do Claude, sem nenhum programa no seu computador:

- **A chave fica no chaveiro do sistema.** O painel pede uma vez e guarda direto no chaveiro; o plugin nunca a lê. A cada
  pedido, o Tyto acrescenta a chave e só a manda para `api.anthropic.com`.
- **Agentes por modelo.** Cada linha de `agent.apiAgents` é um agente: nome, modelo, esforço, ferramentas e instruções.
  Vêm dois para começar, o _Modelador_, que escreve briefs, e o _Revisor_, que os confere. Com dois ou mais, uma lista no
  topo do painel troca de agente, e a conversa começa de novo.
- **Um teto por mês.** `agent.apiMonthlyCapUsd` (US$ 10 se você não mudar) para o agente antes da próxima chamada quando
  o mês chega ao teto. Cada chamada mostra os tokens e um custo estimado; a conta de verdade é a da Anthropic.
- **As ferramentas são as da janela**, com as mesmas regras de um agente conectado a ela: o agente lê o que está aberto,
  e uma mudança no texto é sempre uma proposta que você aceita ou recusa.

Por esse caminho, o uso é cobrado por token de quem é dono da chave, separado de qualquer assinatura do Claude.

**`tyto mcp` muda arquivos, numa pasta em que você confiou.** O agente agora pode:

- **Escrever um brief**: criar um `.brief` ou substituir um. Antes de substituir, ele vê as linhas que mudariam e
  precisa dizer qual versão leu; um brief que alguém mudou nesse meio-tempo é recusado. Um brief aberto numa janela do
  Tyto não é substituído: ali o agente propõe a mudança pela janela.
- **Criar uma entrega**, como o `tyto delivery new`.
- **Exportar** a arte de um brief, para a pasta que a sua pasta de projeto diz, nunca para uma que o agente escolhe.
- **Rodar uma receita** e ler as tabelas dela. Rodar não muda nada; para aplicar um passo, o agente nomeia o passo e o
  plano que viu, e um plano que mudou ou já foi aplicado é recusado.

Numa pasta em que você não confiou, nada disso é oferecido.

**O guia de cada template.** Um template pode trazer um `guide.md` e exemplos de brief na própria pasta, dizendo que parte
de um texto vai em que campo. O `tyto mcp` os oferece ao agente, junto com um pedido pronto, **Shape copy into a brief**:
você cola o texto e diz o template, e o agente recebe os campos, o guia e os exemplos de uma vez. Numa pasta em que você
não confiou, os templates dela mesma não oferecem guia nem exemplos. A página **Conectar um agente de IA** do manual diz
mais.

**`tyto mcp --window` acha a janela certa.** Se a janela que ele tenta primeiro não responde, ele tenta a próxima, em
vez de falhar.

**Uma conexão mais fechada no Windows.** A janela agora espera pelos agentes só no próprio computador (`127.0.0.1`), e a
chave da conexão fica numa pasta que só você e o sistema leem. Antes, a conexão aceitava pedidos vindos pela rede de
arquivos do Windows. Nada muda no que você faz: **Terminal: Abrir um agente aqui** e `tyto mcp --window` continuam
chegando à janela como antes.

**A caixa de plugins diz mais.** Um plugin que usa as ferramentas da janela aparece com essa permissão dita em palavras,
antes de você aprovar: ele lê o que está aberto e propõe mudanças que você aceita ou recusa, enquanto `agentsListen`
estiver ligado. Um plugin que traz o seu próprio programa aparece com esse programa numa linha à parte, e com o aviso de
que pode abrir uma aba de terminal.

## Para quem escreve plugins

A `@tyto/plugin-api` chega à 0.19. **Um plugin construído com uma `plugin-api` anterior continua abrindo**, desde que a
faixa `engine` do manifesto dele aceite a 0.19, como `>=0.16` aceita; uma faixa que esta versão não satisfaz é recusada
com `E_PLUGIN_ENGINE`, que diz as duas versões. Para usar o que vem abaixo, construa o plugin com a `plugin-api` 0.19 e
declare a `engine` que ele precisa. O que muda:

- **`programs`**: o manifesto liga um `process:<nome>` a um script dentro da pasta do plugin, que o Tyto roda no Node que
  ele mesmo traz, sem procurar o nome no `PATH`. `host.terminal.open(nome, args)` abre uma aba de terminal rodando esse
  programa, uma por vez.
- **Uma pasta de dados por plugin.** Todo programa que o Tyto abre para um plugin recebe `TYTO_PROGRAM_DATA`, uma pasta
  em `~/.tyto/data/plugins/<nome>` que sobrevive às atualizações do plugin e é apagada quando ele é removido.
- **`host.storage`** guarda pequenos registros em JSON nessa mesma pasta, que sobrevivem às atualizações e a um cache
  apagado.
- **`credentialHeaders`**: `host.fetch(url, { credentialHeaders })` faz o Tyto pôr uma credencial num cabeçalho sem que o
  plugin a veja, só para um endereço que uma permissão `net:` do próprio plugin nomeia.
- **`window:tools`**: `host.window.tools()` e `host.window.callTool(nome, entrada)` usam as ferramentas da janela de dentro
  do plugin, sob as mesmas regras de um agente conectado, com as mudanças chegando como propostas.
- **O painel ouve mais.** O evento `document` traz o nome da aba e o formato que a prévia mostra, e chega também quando
  outra aba ou outro formato vem para a frente; um evento novo, `language`, diz o idioma da janela quando o painel abre e
  sempre que ele muda.

## O que ela ainda não faz

**O painel de agente não vem com o Tyto e ainda não está na galeria.** Ele é instalado à parte, pela linha de comando:
`tyto plugin install git+https://github.com/rafaelsilvalor/tyto-plugin-agent.git`. Até lá, **Terminal: Abrir um agente
aqui** continua funcionando sem ele.

**O caminho pela chave da API não foi testado com uma chave real.** Ele foi conferido contra respostas escritas à mão no
formato que a API documenta. O custo que o painel mostra é uma estimativa por uma tabela de preços datada; a conta é a da
Anthropic.

**Os guias dos templates ainda não chegam a quem instalou por arquivo de plugins.** Os guias foram escritos nos
repositórios dos templates, mas as versões que os trazem ainda não foram marcadas, e um arquivo de plugins fixa a
versão do template. Até as versões novas saírem e os arquivos de plugins apontarem para elas, o agente não recebe o guia
desses templates.

**Num Claude Code de empresa, o agente pode não ver as ferramentas do Tyto.** Uma organização pode limitar, nas
configurações gerenciadas do Claude Code, quais servidores MCP ele aceita. Se `tyto` não está nessa lista, o Claude Code
descarta o servidor sem erro: vale para **Terminal: Abrir um agente aqui** e para o painel com o Claude Code. O painel
avisa quando o Claude está sem as ferramentas do Tyto. A saída é o administrador acrescentar `tyto` à lista; o painel pela
chave da API não passa por essa regra, porque não usa MCP.

**Um Claude Code antigo instalado pelo npm é recusado.** Antes da 2.1.200, o pacote do npm roda um arquivo `.js`, que o
adaptador não consegue iniciar no Windows; o painel diz para atualizar com `npm install -g @anthropic-ai/claude-code` ou
instalar a versão nativa. Um proxy que pede o seu próprio login também não funciona.

**O Tyto não instala o Claude Code.** O `claude` (ou o programa que `agentCommand` nomeia) precisa estar instalado. No Mac,
um plugin aberto pelo Dock pode não achar um `claude` instalado pelo Homebrew ou pelo npm; isso não foi medido num Mac.

**É preciso ter o Git instalado** para a galeria e para buscar templates por arquivo de plugins.

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
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.20.0\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.20.0/logs`; no Linux, `~/.config/Tyto/0.20.0/logs`.

Na primeira vez que a 0.20.0 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos recentes, os seus atalhos de teclado e as abas que estavam abertas.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.20.0.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.20.0.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.20.0-universal.dmg`                                                 |
| Linux                       | `Tyto-0.20.0.AppImage`: dê permissão de execução e rode                     |

O terminal vem dentro de cada um desses arquivos: não há nada a instalar à parte.

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
