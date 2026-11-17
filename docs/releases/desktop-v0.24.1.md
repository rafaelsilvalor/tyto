# Tyto 0.24.1

**A partir desta versão, a lista de pastas recentes atravessa as atualizações, e uma receita mantém uma pasta de
entrega por linha da planilha e lê essas pastas de volta.** Cada bloco de uma receita agora é desenhado como uma célula
de caderno, e um plano no meio de um bloco aparece embaixo da própria linha.

## O que há de novo

**As pastas recentes não somem mais numa atualização.** Até aqui, cada versão nova começava a lista de **Abrir pasta
recente…** vazia, e parecia que ela guardava só a última pasta aberta. Agora, quando você escolhe **Trazer** na
primeira vez que uma versão nova abre, a lista vem junto, como já vinham os arquivos recentes. Esta atualização ainda
começa com a lista da 0.23.2, se você trouxer; as que se perderam em atualizações anteriores não voltam.

**Uma pasta de entrega por linha.** O passo `to-delivery name=<coluna> fields=<campo>:<coluna>,…` mantém, embaixo da
pasta de entregas do projeto, uma pasta para cada linha, com `assets/`, `editaveis/` e a ficha da entrega em
`editaveis/delivery.json`. Ele mostra um plano com uma operação por pasta que muda, guarda um campo que alguém editou à
mão, não planeja nada quando roda de novo sobre as mesmas linhas, e diz na própria célula por que recusou uma linha.

**Ler as entregas de volta.** O passo `deliveries` lê todas as fichas das pastas de entrega como uma linha por entrega,
pronta para ir à planilha. Quando essas linhas passam de novo pelo `to-delivery`, nada é planejado. Com
`inbound=<campo>:<quem vence>,…`, você diz quais campos um valor de fora pode mudar e quem vence quando os dois lados
mudaram: `record` (a ficha) ou `row` (a linha). Uma ficha que não dá para ler vira um aviso com o nome da pasta.

**Um bloco é desenhado como uma célula.** Uma caixa contorna cada bloco de passos e o resultado embaixo dele, o
contador e os botões ficam numa faixa no topo da caixa, e os blocos ficam um pouco afastados entre si. Um bloco de nota
continua texto corrido, sem caixa.

**Um plano nunca fica escondido.** Um passo no meio de um bloco que grava, como uma ação entre uma fonte e a planilha,
mostra o plano embaixo da própria linha, com o seu próprio **Aplicar**. Um bloco que planeja duas vezes mostra dois
planos, cada um aplicado com o seu clique.

## Para quem escreve plugins

A `@tyto/plugin-api` chega à 0.24.0 e o protocolo de plugin passa a ser o 27. Um plugin com `workspace:read` lê um
arquivo da pasta aberta de qualquer tamanho em partes, com `host.workspace.read(path, { offset, length })`, e consulta
e lista a pasta com `host.workspace.stat(path)` e `host.workspace.list(path)`.

## O que ela ainda não faz

**Fixar uma pasta na lista de recentes** ainda não existe: a lista guarda as dez últimas.

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
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.24.1\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.24.1/logs`; no Linux, `~/.config/Tyto/0.24.1/logs`.

Na primeira vez que a 0.24.1 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos e as pastas recentes, os seus atalhos de teclado e as abas que estavam abertas.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.24.1.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.24.1.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.24.1-universal.dmg`                                                 |
| Linux                       | `Tyto-0.24.1.AppImage`: dê permissão de execução e rode                     |

O terminal vem dentro de cada um desses arquivos: não há nada a instalar à parte.

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
