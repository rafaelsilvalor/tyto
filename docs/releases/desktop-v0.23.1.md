# Tyto 0.23.1

**A partir desta versão, o painel Comandos tem comandos próprios para mexer nas pastas e nos arquivos da pasta de
trabalho (`ls`, `cd`, `new`, `mv`, `rm` e outros), apelidos e variáveis, e um comando recusado oferece o caminho da
janela numa caixa.** No brief, um comentário `//` no meio de uma lâmina não encerra mais o bloco, e uma linha longa que
o editor quebra na tela continua alinhada ao próprio recuo.

A versão 0.23.0 não foi publicada: tudo o que ela trouxe chega agora, junto com a 0.23.1.

## O que há de novo

**Os comandos do próprio painel.** A aba **Comandos** responde sozinha a alguns comandos, sem passar pela linha de
comando:

- `help`, `clear` (ou `cls`), `history`, `!N` (roda de novo a linha N do `history`), `last` e `exit`.
- Para ler: `ls` lista uma pasta, `cd` muda a pasta do painel, e o prompt mostra onde você está
  (`tyto entregas/novembro ›`), `pwd` mostra o caminho completo e `cat` mostra um arquivo de texto.
- Para mexer: `new` cria um arquivo (`new cartaz.brief --template story` já grava o esqueleto do template), `mkdir`
  cria uma pasta, `mv` move ou renomeia, `cp` copia, `rm` manda para a lixeira do sistema, `open` abre numa aba e
  `reveal` seleciona no Explorador.
- `templates` lista os templates que um render naquela pasta pode usar, com a origem de cada um.

Os comandos de arquivo só alcançam o que está dentro da pasta de trabalho aberta, nunca substituem um arquivo que já
existe, e numa pasta em que você ainda não confiou só os que leem rodam. O `rm` nunca apaga de vez.

**Vários comandos numa linha.** `&&` roda o comando seguinte só se o anterior deu certo:
`check cartaz.brief && render cartaz.brief`. `*` e `?` valem por partes de um nome: `render *.brief` renderiza todos
os briefs da pasta.

**Apelidos e variáveis.** `alias entrega='render --delivery'` salva um nome curto para uma linha que você digita muito,
e `entrega cartaz.brief` passa a rodar `render --delivery cartaz.brief`. Com `--workspace`, o apelido fica na pasta,
para todos que a abrirem. `set brief=cartaz.brief` define uma variável, lida depois como `$brief`.

**Um comando recusado oferece o caminho da janela.** Em vez de só dizer não, o painel pergunta numa caixa:

- `--trust` oferece confiar na pasta aberta e rodar o comando sem ele.
- `signin` e `signout` oferecem entrar ou sair como a tela de plugins faz.
- `recipe run --apply` oferece abrir o caderno da receita, onde **Aplicar** aplica o plano.
- `watch` na pasta de fila oferece desligar o **Renderizar automaticamente** e vigiar ali.

**Cancelar** é sempre o padrão, e cancelar não muda nada.

**A saída do painel com as cores certas.** Uma linha é colorida pelo que ela diz, não pelo canal por onde veio: um
problema leva a cor da gravidade dele, com o código em negrito, e um comando que terminou com **✓ 0** não mostra mais
linhas vermelhas. No tema claro, o amarelo de aviso e o verde de sucesso ficaram mais escuros, para ler melhor.

**O completar de `--template`** oferece os templates que um render na pasta do painel aceita, inclusive os da pasta
`templates/` dela.

**No brief.**

- **Um comentário no meio de uma lâmina não a quebra mais.** Pôr `//` na frente de uma linha de dentro de um bloco
  (por exemplo, de um `::imagem`) desliga só aquela linha: o bloco continua depois dela, e o editor não acusa erro. Uma
  linha de texto que começa com `//` de verdade se escreve `\//`.
- **Uma linha em branco entre duas linhas de texto separa parágrafos.** O espaço entre eles é o template que decide;
  nenhum template da casa define esse espaço ainda, então as suas artes saem iguais.
- **A linha longa quebra alinhada ao recuo.** Quando o editor quebra uma linha recuada na tela, a continuação começa
  embaixo do primeiro caractere do texto, em vez de voltar à margem esquerda. Vale para briefs, JSON e templates; a arte
  não muda.

**Na questão de fixação.** Com o plugin dos templates `questao-estrategica` e `questao-engenharia` na versão 0.9.0, um
`::lamina {continua}` logo depois de uma `{resposta}` continua a explicação, como `{resposta, continua}` já fazia. Com
uma versão anterior do plugin, a forma curta sai como enunciado: escreva a forma longa.

**Nas receitas.**

- Numa linha com vários passos separados por `|`, **Editar passo** e **Abrir resultado numa aba** agem sobre o passo
  onde está o cursor, não sobre o primeiro da linha.
- `decide` com `clear=push` segura as limpezas de uma execução que parece ter perdido a leitura: quando a coluna
  inteira veio vazia, ou quando seriam limpos mais valores que o novo `clear-limit` (5, se você não disser outro),
  nada é limpo, e um aviso diz por quê.
- O resultado de um bloco diz o valor que cada passo `set` gravou.

## Para quem escreve templates e plugins

A `@tyto/plugin-api` chega à 0.22, e o `@tyto/core` à 0.47. O que muda:

- **Um template vê os ajustes de todas as lâminas.** `TemplateContext.artworks` traz os ajustes de cada lâmina do
  brief, na ordem em que foram escritos (`artworks[artwork.index]` é a lâmina atual): é o que deixa a lâmina
  `{continua}` herdar o papel da anterior. Só ajustes; o conteúdo de outra lâmina não chega por aí.
- **Parágrafos.** Uma quebra de linha da cena pode trazer `space`, o espaço do parágrafo, e o kit de templates lê
  `paragraphSpacing` no estilo do texto; sem ele, nada muda.
- **Fórmula com fração empilhada na cena.** A cena aceita uma fórmula com fração, sobrescrito e subscrito, desenhada na
  fonte do template, em HTML e em SVG. Escrevê-la num brief (`$…$`) ainda não existe.

## O que ela ainda não faz

**Escrever uma fração no brief ainda não dá.** O Tyto já sabe desenhá-la, mas a sintaxe `$…$` vem numa próxima versão.

**Os comandos de arquivo do painel não rodam fora da pasta de trabalho aberta**, e o painel continua sem shell: para
isso, use a aba **Terminal**.

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
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.23.1\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.23.1/logs`; no Linux, `~/.config/Tyto/0.23.1/logs`.

Na primeira vez que a 0.23.1 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos recentes, os seus atalhos de teclado e as abas que estavam abertas.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.23.1.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.23.1.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.23.1-universal.dmg`                                                 |
| Linux                       | `Tyto-0.23.1.AppImage`: dê permissão de execução e rode                     |

O terminal vem dentro de cada um desses arquivos: não há nada a instalar à parte.

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
