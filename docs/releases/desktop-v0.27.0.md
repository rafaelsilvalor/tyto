# Tyto 0.27.0

**A partir desta versão, uma imagem que um template deixa para ser pintada em outro programa ganha um gabarito em
PSD, com as camadas de texto e as áreas já no lugar, e a prévia se atualiza sozinha quando a pintura chega à pasta.**
Esta versão também traz o que estava na 0.26.1, que não chegou a ser publicada.

## O que há de novo

**Arte pintada fora do Tyto.** Um template pode deixar uma imagem para ser pintada em outro programa, como um fundo ou
uma ilustração, num tamanho para cada formato. Enquanto o arquivo não existe, o brief continua renderizando: a peça sai
com uma caixa magenta contornada no lugar da arte e um aviso dizendo quais formatos ainda estão sem ela.

**Um arquivo de arte para cada formato.** Ao lado do arquivo que o brief cita, uma cópia com o nome do formato é a que
aquele formato desenha: para `fundo.png`, o story usa `fundo.story.png` se ele existir, e os outros formatos usam o
`fundo.png`.

**O gabarito em PSD para quem vai pintar.** Na aba **Comandos** ou no **Terminal**, `tyto guide <brief>` grava ao lado
de cada arte citada um PSD com as camadas `texto`, `areas`, `arte` e `decoracao`: o texto e o fundo do template
travados, cada área contornada com o nome do campo, e a camada da arte vazia para a pintura. Com dois formatos, sai um
gabarito por formato (`fundo.grid-1x1.guide.psd`, `fundo.story.guide.psd`). `--list` mostra o que seria gravado sem
gravar nada, e um gabarito mais novo que o brief só é regravado com `--force`. O `tyto render --guide` grava os mesmos
gabaritos numa pasta de saída.

**A prévia acompanha a arte.** Quando um arquivo que o brief pede aparece ou muda na pasta aberta, a cópia de um
formato inclusive, a prévia do brief se refaz sozinha.

**Texto escondido fica escondido.** Um texto que o template esconde não aparece mais na imagem exportada.

## Para quem escreve templates

A `@tyto/template-kit` chega à 0.13.1 com `levelsOf` e `levelStack`: um bloco do brief escrito com `|` entre as partes,
`#` a `###` para o nível de cada parte e uma linha `---` para o divisor é lido e empilhado do mesmo jeito em todo
template. A convenção dos nomes está em `docs/slot-vocabulary.md`, que agora inclui `apelo` (o quadro que chama a
atenção) e `convite` (o convite para agir).

## Para quem escreve plugins

A `@tyto/plugin-api` chega à 0.27.0, e o protocolo de plugin passa a ser o 29: um exportador pode devolver os bytes de
um arquivo, além de texto. Um plugin feito antes disso continua funcionando sem mudança.

## O que ela ainda não faz

**Gravar o gabarito por um botão da janela.** O app já sabe gravar e abrir os gabaritos, mas o comando na paleta e o
diálogo de escolha chegam numa versão seguinte. Até lá, use `tyto guide` na aba **Comandos** ou no **Terminal**.

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
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.27.0\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.27.0/logs`; no Linux, `~/.config/Tyto/0.27.0/logs`.

Na primeira vez que a 0.27.0 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos e as pastas recentes, os seus atalhos de teclado e as abas que estavam abertas.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.27.0.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.27.0.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.27.0-universal.dmg`                                                 |
| Linux                       | `Tyto-0.27.0.AppImage`: dê permissão de execução e rode                     |

O terminal vem dentro de cada um desses arquivos: não há nada a instalar à parte.

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
