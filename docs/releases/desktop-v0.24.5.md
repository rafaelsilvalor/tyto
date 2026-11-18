# Tyto 0.24.5

**A partir desta versão, um asterisco sozinho no brief é só um asterisco, e uma receita de entregas guarda os campos
que você quiser e traz a ficha de cada linha para o lado dela.** Uma observação com `*` no fim de uma tabela e um valor
como `R$ 4.143,06*` não dão mais erro de sintaxe. Esta versão também traz o que estava na 0.24.2, na 0.24.3 e na
0.24.4, que não chegaram a ser publicadas.

## O que há de novo

**Um asterisco que nada fecha é um asterisco.** Até aqui, todo `*` abria um itálico, e um `*` sem par na mesma linha
travava o brief com "an italic run is missing its closing \*". Agora, um `*` que nenhum outro `*` fecha na mesma linha
sai como o caractere: `R$ 4.143,06*` e uma nota que começa com `*Valores do último edital` aparecem como você escreveu.
Dois `*` soltos na mesma linha continuam fazendo itálico, e um itálico nunca passa de uma linha para outra.

**Uma quebra de linha dentro de uma célula de tabela.** Num template que lê cada linha do bloco como uma linha da
tabela, um `\` no meio da linha agora quebra a linha dentro daquela célula, e a linha da tabela continua. Antes, ele
partia a linha da tabela em duas. O template precisa estar numa versão que use isso: a `tabela` 1.3.0 já usa.

**As cores das colunas seguem depois de um `\`.** No editor, as cores que separam as colunas de uma linha com `|`
recomeçavam a contagem num `\`, e a palavra depois dele ganhava a cor da coluna seguinte. Agora ela fica com a cor da
própria coluna, como o template desenha.

**Campos que você declara numa ficha de entrega.** No passo `to-delivery`, qualquer nome em `fields=` que não seja um
campo fixo vira um campo seu, de texto, como uma descrição ou um responsável. Ele é guardado na ficha, protegido de
mudanças de fora como um campo fixo, e aceita `keep=` e `inbound=`. O passo `deliveries` mostra esses campos como
colunas, em ordem alfabética, depois das fixas. Um nome que já é uma coluna do `deliveries` é recusado, e um nome a duas
letras de um campo fixo ganha um aviso.

**A ficha de cada linha ao lado dela.** Quando as linhas vêm de outro lugar, como um rastreador de tarefas, o passo
`with-deliveries by=<coluna>` lê a ficha da pasta de entrega que cada linha nomeia e acrescenta os campos dela como
colunas `record_`, depois das da linha. O nome acha a pasta qualquer que seja a caixa das letras, e uma linha sem pasta
recebe células vazias e é nomeada na nota do resultado. O passo só lê: não grava nada.

**Só as pastas que já existem.** Com `create=no`, o `to-delivery` grava só nas pastas de entrega que já existem e diz
quais linhas pulou. O padrão continua `create=yes`, que cria as que faltam.

**Uma célula vazia não apaga mais um campo.** Com `keep=<campo>,…`, quando a célula de um desses campos volta vazia, a
ficha guarda o valor que tinha. O passo avisa disso a cada execução, para que a célula vazia não passe despercebida.

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
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.24.5\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.24.5/logs`; no Linux, `~/.config/Tyto/0.24.5/logs`.

Na primeira vez que a 0.24.5 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos e as pastas recentes, os seus atalhos de teclado e as abas que estavam abertas.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.24.5.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.24.5.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.24.5-universal.dmg`                                                 |
| Linux                       | `Tyto-0.24.5.AppImage`: dê permissão de execução e rode                     |

O terminal vem dentro de cada um desses arquivos: não há nada a instalar à parte.

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
