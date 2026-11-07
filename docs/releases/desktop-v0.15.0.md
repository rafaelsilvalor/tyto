# Tyto 0.15.0

**A partir desta versão, um plugin que os seus arquivos de plugins buscam traz para a janela tudo o que um plugin
instalado traz, e não só os templates, e os templates nos próprios repositórios feitos para a plugin API 0.14 abrem
nela.** Os apelidos aparecem ao lado dos templates a que levam, e o Tyto diz com clareza o que antes ficava em silêncio:
um template que o pacote tem e o arquivo de plugins não nomeia, uma pasta `TYTO_HOME` funda demais, um fundo que falta
num template.

As versões 0.14.2 a 0.14.6 não foram publicadas: tudo o que elas trouxeram chega agora, junto com a 0.15.0.

## O que há de novo

**Templates de repositório próprio feitos para a plugin API 0.14.** O protocolo entre o Tyto e o processo de um plugin
passou da versão 14 para a **versão 15**. Um template ou plugin construído com a `plugin-api` 0.14 fala o protocolo 15,
e a 0.14.1 o recusa ao conectar, com uma mensagem que diz os dois números: é esta versão que o abre. Um template que
usa isso pode, por exemplo, avisar quando falta um arquivo dele (veja abaixo).

**Um plugin buscado traz tudo, não só os templates.** Um plugin que os arquivos de plugins buscam agora acrescenta à
janela o que um plugin instalado acrescenta: os painéis, as diretivas, os temas de cores, os atalhos, os mapeamentos do
vim, os kits de marca, as fontes de imagens e de tipos, as configurações e os verbos de receita, na prévia e na
exportação. Quando um plugin buscado e um instalado oferecem algo com o mesmo nome, vale o do buscado, como diz a ordem
de busca dos arquivos de plugins. Quando uma sincronização busca outra versão, o que a antiga acrescentou sai da janela
e o que a nova acrescenta chega, sem reiniciar o app.

**Os apelidos ficam ao lado dos seus templates.** No completar de `template:`, no cabeçalho do brief, cada apelido
aparece logo depois do template a que leva, com uma linha dizendo o template e a configuração (`aviso · laranja`), como a
barra de comandos também passa a mostrar. Quando um brief pede um formato que não existe (`E_UNKNOWN_FORMAT`), a correção
rápida sugere só um formato que a configuração daquele nome aceita.

**O arquivo de plugins avisa de um template que ele não nomeia.** Quando um pacote buscado tem templates que nenhuma
entrada do arquivo de plugins nomeia, o aviso `W_PLUGIN_FILE_TEMPLATE_UNNAMED` diz quais são, uma vez por pacote, na
primeira entrada que o buscou, e diz para acrescentar uma entrada para cada um com o mesmo git e a mesma ref. Um brief que
pede um deles continua recebendo `E_UNKNOWN_TEMPLATE`, agora com uma dica de que o pacote o tem. Os dois aparecem no
painel de problemas e em `tyto render`.

**Uma pasta `TYTO_HOME` funda demais vira uma mensagem, não uma falha.** Quando a pasta que `TYTO_HOME` aponta é funda
demais para as cópias buscadas dentro dela, a sincronização dos arquivos de plugins para antes da primeira busca com
`E_TYTO_HOME_PATH_TOO_LONG`, que nomeia a pasta e o tamanho do caminho mais longo que uma busca escreve ali. No Windows,
um caminho para em 259 caracteres, e uma cópia precisa de uns 172 abaixo da pasta. `tyto render`, `tyto plugin sync` e
os comandos da galeria mostram o erro. Aponte `TYTO_HOME` para uma pasta mais curta, como uma logo abaixo da sua pasta de
usuário.

**Um template diz qual arquivo dele falta.** O aviso `W_TEMPLATE_FILE_MISSING` nomeia a arte, o formato, o template e o
caminho do arquivo que ele não encontrou. O banner de produto o usa: um formato cujo fundo, `assets/bg-<formato>.png`,
falta é reportado, em vez de sair desenhado em papel liso sem nenhum aviso.

**Negrito e marcas de cor no cabeçalho, para os templates que os desenham.** Um valor do cabeçalho continua sendo texto
simples, e formatação ali gera `W_MARKUP_IN_FRONTMATTER`. A exceção é um template que desenha `**…**` e `{cor:…}…{/}`
num campo do cabeçalho e o declara no manifesto: nesse campo as duas marcas são desenhadas sem aviso, e o limite de
palavras do campo conta só as palavras que elas desenham, como numa diretiva. Antes, duas marcas de cor num título
estouravam o limite, e o template desenhava o título padrão no lugar, sem nenhuma das cores.

**Desenho mais fiel:**

- **Símbolos que a fonte não tem.** Um caractere que a fonte do texto não desenha, como uma seta ou um `Δ`, agora sai
  na fonte de símbolos que vem com o Tyto, a Noto Sans Math, e depois na Source Sans 3. O que é medido é o que é
  desenhado. Um caractere que nenhuma das fontes desenha gera o aviso `W_GLYPH_MISSING`, que o nomeia.
- **Uma linha nunca começa com um operador matemático solto.** O espaço antes de `·`, `=`, `×`, `→` e afins deixou de
  ser um ponto de quebra: `Q = U · A · ΔT` pode terminar uma linha num operador, mas nunca começar uma com ele.

## Para quem escreve plugins

O protocolo entre o Tyto e o processo de um plugin passou da versão 14 para a **versão 15** (`@tyto/plugin-api` 0.14),
porque um template agora reporta o caminho do arquivo que falta. Um plugin que roda o próprio processo e foi construído
para uma versão anterior é recusado ao conectar, com uma mensagem que diz os dois números: atualize-o para a `plugin-api`
nova. O que muda para um template de código, do `@tyto/template-kit` 0.8 ao 0.11:

- **`W_TEMPLATE_FILE_MISSING`** entra na lista fechada de avisos que um template pode reportar, e o `@tyto/house-style`
  ganha **`requiredImage`**, que o reporta quando uma imagem que o template exige não está entre os arquivos dele.
- **`frontmatterMarks: true`**, no manifesto, num slot de texto rico, diz que o template desenha `**…**` e
  `{chave:valor}…{/}` num valor do cabeçalho (com `richTextOfPlain`): o aviso some para esse subconjunto, e `min` e `max`
  contam as palavras desenhadas, sem a sintaxe.
- **`highlights(spec)`** descreve negrito, itálico e marcas com nome como dados, variados por lugar com `.with()`;
  **`highlightsFromValues`** os lê dos nomes de valores compartilhados e ajusta `highlight-weight` ao peso declarado mais
  próximo entre as faces do template. **`runsOf`** aceita negrito e itálico como um estilo parcial, então o negrito pode
  mudar a cor (um número ainda quer dizer um peso).
- **A fonte de símbolos.** Um template de código lista a cadeia de fontes em `faces:`, e **`fallbackChain`**, exportado
  por `@tyto/core/template`, dá essa cadeia para o teste de faces do template, em vez de copiar a regra.
- **`settle`** primeiro quebra a linha de cima uma palavra antes, no mesmo tamanho e espaçamento, antes de tentar o
  espaçamento entre letras e um tamanho menor; **`rebreak`** é exportado sozinho, e `OrphanLimits.rebreak: false` o
  desliga. Como último recurso, `settle` desce uma palavra mesmo quando a linha de cima fica com uma só. `rebreak` nunca
  quebra antes de um operador matemático solto (**`isStandaloneOperator`**, exportado pelo `@tyto/core`).
- **`keepTogether`** e **`keepTogetherText`** juntam um símbolo de moeda e o valor, um valor e a palavra de escala e
  um número e o seu `%`, para uma linha nunca terminar em `R$`. As regras padrão, `KEEP_TOGETHER_RULES`, também mantêm um
  número com a sua unidade de uma lista fechada (`3 s`, `10 kg`, `25 °C`) e deixam quebrável uma palavra que só começa
  como uma unidade (`3 salas`). Um template só usa isso se chamar a função.
- **`labelOf`** e **`labelOfText`** separam uma linha no rótulo, o que vem antes do primeiro `:`, e no texto.

## O que ela ainda não faz

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
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.15.0\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.15.0/logs`; no Linux, `~/.config/Tyto/0.15.0/logs`.

Na primeira vez que a 0.15.0 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos recentes, os seus atalhos de teclado e as abas que estavam abertas.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.15.0.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.15.0.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.15.0-universal.dmg`                                                 |
| Linux                       | `Tyto-0.15.0.AppImage`: dê permissão de execução e rode                     |

O terminal vem dentro de cada um desses arquivos: não há nada a instalar à parte.

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
