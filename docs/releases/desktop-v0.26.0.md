# Tyto 0.26.0

**A partir desta versão, uma receita leva uma entrega do começo ao fim: guarda os campos que você quiser, escreve a
copy, renomeia as imagens para os nomes de entrega e aplica todos os planos de uma vez.** O Explorador mostra em cada
pasta de entrega se as imagens estão completas, e um asterisco sozinho no brief deixou de ser erro de sintaxe. Esta
versão também traz o que estava nas versões 0.24.2 a 0.25.0, que não chegaram a ser publicadas.

## O que há de novo

**Um asterisco que nada fecha é um asterisco.** Até aqui, todo `*` abria um itálico, e um `*` sem par na mesma linha
travava o brief com "an italic run is missing its closing \*". Agora, um `*` que nenhum outro `*` fecha na mesma linha
sai como o caractere: `R$ 4.143,06*` e uma nota que começa com `*Valores do último edital` aparecem como você escreveu.
Dois `*` soltos na mesma linha continuam fazendo itálico, e um itálico nunca passa de uma linha para outra.

**Uma quebra de linha dentro de uma célula de tabela.** Num template que lê cada linha do bloco como uma linha da
tabela, um `\` no meio da linha agora quebra a linha dentro daquela célula, e a linha da tabela continua. No editor, as
cores das colunas seguem depois do `\`: a palavra depois dele fica com a cor da própria coluna. O template precisa
estar numa versão que use isso: a `tabela` 1.3.0 já usa.

**O Explorador confere cada entrega.** Numa pasta confiável, cada pasta de entrega com uma ficha ganha um ícone de
entrega e, no fim da linha, a conferência das imagens com o que a ficha pede: **✓** quando está tudo lá, **!** quando
falta algo, **…** quando ainda está em andamento. O estado da ficha aparece antes da marca, e passar o mouse sobre ela
mostra a chave da entrega e cada problema. A conferência roda de novo um instante depois que arquivos chegam.

**Aplicar todos os planos de uma vez.** Uma receita com a linha `apply together` no cabeçalho aplica todos os planos da
execução, na ordem dos passos, com uma confirmação só. Na janela, **Aplicar todos os planos** fica embaixo dessa linha,
e nenhum plano tem um **Aplicar** próprio ali, para que um plano de baixo nunca seja aplicado antes dos de cima. A
aplicação para no primeiro passo recusado ou com falha, e os planos de baixo ficam para a próxima execução.

**Renomear as imagens para os nomes de entrega.** O passo `rename-exports stem=<coluna>` renomeia as imagens exportadas
em cada entrega para `<radical>-01.png`, `<radical>-02.png` e assim por diante, na ordem dos formatos da ficha. O plano
mostra uma linha por arquivo que muda de nome, e **Aplicar** renomeia cada entrega inteira ou não renomeia nada:
nunca grava um arquivo por cima de outro.

**A copy da entrega num arquivo.** Com `to-delivery copy-text=<coluna>`, o texto da coluna vira `editaveis/copy.md`,
ao lado da ficha. Uma copy que alguém editou depois é mantida, nunca sobrescrita, e o plano avisa disso a cada
execução.

**Uma escrita longa mostra o andamento.** Um plugin que grava muita coisa num **Aplicar** agora mostra o andamento
embaixo do plano, com **Cancelar** ao lado. Cancelar no meio deixa o que estava em andamento marcado como não
terminado.

**Campos que você declara numa ficha de entrega.** No passo `to-delivery`, qualquer nome em `fields=` que não seja um
campo fixo vira um campo seu, de texto, como uma descrição ou um responsável. Ele é guardado na ficha, protegido de
mudanças de fora como um campo fixo, e aceita `keep=` e `inbound=`. O `deliveries` e o `with-deliveries` mostram esses
campos como colunas e aceitam `fields=` para listar os que devem aparecer mesmo quando nenhuma ficha os tem ainda.

**A ficha de cada linha ao lado dela.** O passo `with-deliveries by=<coluna>` lê a ficha da pasta de entrega que cada
linha nomeia e acrescenta os campos dela como colunas `record_`, depois das da linha. Uma linha sem pasta recebe
células vazias e é nomeada na nota do resultado. O passo só lê: não grava nada.

**Só as pastas que já existem, e células vazias que não apagam.** Com `create=no`, o `to-delivery` grava só nas pastas
de entrega que já existem e diz quais linhas pulou. Com `keep=<campo>,…`, quando a célula de um desses campos volta
vazia, a ficha guarda o valor que tinha.

## Para quem escreve plugins

A `@tyto/plugin-api` chega à 0.26.0, e o protocolo de plugin passa a ser o 28. A resposta de um `apply` pode pedir que
uma operação continue (`continue`), com uma linha de andamento (`progress`) de até 80 caracteres, e o Tyto pergunta de
novo dentro do mesmo **Aplicar**. Um plugin feito antes disso continua funcionando sem mudança.

## O que ela ainda não faz

**O asterisco literal não se desfaz dentro de uma fórmula.** Se uma linha tiver uma fórmula `$…$` com um `*` sozinho
dentro e outro `*` solto fora dela, os dois podem ser lidos como um par.

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
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.26.0\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.26.0/logs`; no Linux, `~/.config/Tyto/0.26.0/logs`.

Na primeira vez que a 0.26.0 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos e as pastas recentes, os seus atalhos de teclado e as abas que estavam abertas.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.26.0.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.26.0.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.26.0-universal.dmg`                                                 |
| Linux                       | `Tyto-0.26.0.AppImage`: dê permissão de execução e rode                     |

O terminal vem dentro de cada um desses arquivos: não há nada a instalar à parte.

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
