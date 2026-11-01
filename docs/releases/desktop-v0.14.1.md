# Tyto 0.14.1

**A partir desta versão, você instala um template com um clique, roda comandos `tyto` e abre o seu próprio terminal sem
sair da janela.** **Ferramentas ▸ Galeria: ver templates e plugins** mostra os templates e plugins disponíveis, cada um
com uma prévia, e a área de baixo ganhou as abas **Comandos** e **Terminal**, ao lado de **Problemas**.

As versões 0.13 e 0.14 não foram publicadas: tudo o que elas trouxeram chega agora, junto com a 0.14.1.

## O que há de novo

**A galeria: instalar um template com um clique.** Rode **Galeria: ver templates e plugins**, pela barra de comandos ou
pelo menu **Ferramentas**. Cada cartão mostra uma prévia, o nome, a versão e o estado: **Instalar**, **Instalado em**
uma versão, **Atualizar para** uma versão mais nova, ou **Precisa de um Tyto mais novo**. Instalar escreve o item nos
arquivos de plugins da sua máquina e o busca; o template entra na lista de templates assim que a busca termina, sem
reiniciar. **A galeria nunca atualiza nada sozinha**: quando sai uma versão nova, o cartão avisa e espera o seu clique.
A configuração `galleryIndex` diz qual lista a galeria lê; por padrão, a que o projeto Tyto mantém. Sem conexão, ela
mostra a cópia buscada por último e diz de quando é. Na linha de comando, `tyto gallery list`, `install` e `update` fazem
o mesmo.

**O painel de comandos.** A aba **Comandos** roda comandos `tyto`, os mesmos da linha de comando, dentro da janela, na
pasta de trabalho aberta. **Ctrl+`** abre e esconde (num teclado brasileiro, é a tecla à esquerda do **1**, que imprime
um apóstrofo). Enquanto você digita, uma lista sugere os comandos, as opções, os templates, os formatos do template
escolhido e os arquivos da pasta: **Tab** pega a primeira sugestão. Cada comando vira um bloco com o comando, a hora e
como terminou (**✓ 0**, **✗ 1**), sobre o que ele imprimiu. **↑** e **↓** percorrem o histórico, guardado por pasta, e
**Ctrl+R** procura nele. Um lugar que o comando imprimiu vira um link para o arquivo naquela linha. **Comandos: Renderizar
este brief** escreve `render`com o brief da frente no prompt, sem rodar. Duas coisas são recusadas, com uma linha dizendo por quê:`--trust`e, no Windows, instalar um pacote npm com`plugin install`.

**O que um comando reporta aparece em Problemas.** Cada execução ganha uma seção sob o comando que rodou, abaixo das
linhas do brief, para as últimas cinco execuções, e o número de problemas da barra de status conta essas linhas também.

**Um terminal dentro da janela.** **Ctrl+Shift+`** ou **Terminal: Novo terminal** abre o seu próprio shell na aba
**Terminal**, na pasta de trabalho aberta: o PowerShell no Windows, o seu shell de login no Mac e no Linux, ou o programa
que `terminalShell`e`terminalArgs`dizem no`settings.json`. Ele roda qualquer programa, como `git`ou`npm`, segue as
cores da janela no tema claro e no escuro, e sobrevive a uma troca de pasta e a um recarregamento da janela. O **+** abre
outro. Colar mais de uma linha pergunta antes. **O shell roda como você**: a confiança na pasta e as permissões de um
plugin não valem dentro dele. Numa pasta em que você ainda não confiou, um terminal novo é recusado, com **Confiar na
pasta** ao lado.

**A área de baixo é uma faixa de abas.** **Problemas**, com a contagem, **Comandos** e **Terminal** aparecem uma por vez,
na mesma altura. A aba da frente é lembrada, e o **×** esconde a área inteira.

**Menus novos.** A barra de menus agora é **Arquivo**, **Editar**, **Brief**, **Prévia**, **Exibir**, **Ferramentas**,
**Janela** e **Ajuda**. **Brief** reúne arrumar o brief, o menu "/", ir para bloco, exportar e os comandos de template;
**Prévia**, os slides, os formatos, o zoom e a trava; **Ferramentas**, a galeria, os plugins, a fila local, um terminal
novo, os seus arquivos `settings.json`, `keybindings.json` e `snippets.json` e a confiança da pasta aberta. **Exibir**
ganha **Mostrar Problemas**, **Comandos: Executar…**, **Mostrar o Terminal** e o modo vim. Cada item executa um comando
da barra de comandos, então pode ganhar um atalho.

**Cada pasta de trabalho guarda as suas abas.** Quando você abre outra pasta, pelo **Arquivo ▸ Abrir pasta…**, pela lista
de recentes ou pelo **Arquivo ▸ Fechar pasta**, o Tyto guarda as abas da pasta que você deixa e mostra as que a pasta nova
tinha da última vez, texto não salvo incluído, sem perguntar nada. Se um arquivo mudou no disco enquanto a pasta estava
fora, ele abre como está agora e o seu texto não salvo volta numa aba nova ao lado. O Tyto lembra as abas das últimas
dez pastas. O tamanho dos painéis e os terminais são da janela, não da pasta.

**A entrega leva as imagens junto.** Exportar uma entrega agora também copia para a `assets/` dela cada imagem que o
brief usa de fora dessa pasta: uma foto ao lado do brief, uma das pastas de imagens do projeto, uma que um plugin buscou.
Nada do que já está em `assets/` é removido ou substituído: quando lá existe um arquivo diferente com o mesmo nome, o seu
fica, e a exportação avisa com `W_DELIVERY_ASSET_KEPT`.

**Várias imagens no mesmo slide.** Quando a lista de templates mostra o slot de imagem como "per lamina · multiple", um
slide pode ter quantas imagens você escrever, cada uma onde você a escreve no meio do texto: o caminho vai na linha do
`::imagem`, e as linhas recuadas abaixo dele continuam o texto do slide.

```
::lamina
  Primeiro parágrafo
::imagem ./grafico.png
  Segundo parágrafo
::imagem ./foto.png
```

Esse slide fica assim: o primeiro parágrafo, o gráfico, o segundo parágrafo, a foto. Um brief e um template feitos para
uma imagem por slide desenham como antes.

**Desenho mais fiel:**

- **O desfoque de uma sombra, e o de uma camada,** agora tem o mesmo tamanho no SVG e no PNG. Antes, o SVG e a sombra
  com espalhamento (`spread`) desenhavam o desfoque pela metade. Um PNG de sombra sem espalhamento não muda.
- **Um desfoque largo num elemento pequeno** não sai mais cortado no SVG.
- **A cor de uma forma com sombra** agora é exatamente a que o template pediu, no PNG e no SVG. Antes, uma sombra com
  espalhamento, e no SVG qualquer sombra, tingia a forma de leve: um azul `#081c3d` saía `#0d1c3d`.

**`banner-teste` no lugar de `banner-roxo`.** Os templates de teste que vêm com o Tyto agora são `banner-teste`,
`carrossel-lista` e `promo-curso`. O banner de produto mora no próprio repositório, `tyto-template-banner`, e chega por um
arquivo de plugin, como os outros templates de produção.

## Para quem escreve plugins

O protocolo entre o Tyto e o processo de um plugin passou da versão 13 para a **versão 14** (`@tyto/plugin-api` 0.13).
Um plugin que roda o próprio processo e foi construído para uma versão anterior é recusado ao conectar, com uma mensagem
que diz os dois números: atualize-o para a `plugin-api` nova. O que muda para um template de código:

- **`spaceByWeight`**, no `@tyto/template-kit`, divide o espaço entre duas bordas por peso: os espaços crescem juntos, e
  pesos iguais nas pontas centralizam os blocos.
- **`settle`** tira a última palavra sozinha de um parágrafo, primeiro com espaçamento entre letras e depois com um
  tamanho menor, dentro dos limites do template. O que ela não consegue resolver, `reportOrphan` reporta com o aviso novo
  `W_TEMPLATE_ORPHAN`, que leva a palavra. É esse aviso que pede o protocolo 14.
- **Use o `@tyto/template-kit` 0.7.1, não o 0.7.0.** Um template que empacotava o 0.7.0 levava junto o leitor de fontes
  e o leitor de YAML do `@tyto/core`, e ficava cerca de três vezes maior.
- **`DEFAULT_GALLERY_INDEX`**, exportado pela `plugin-api`, é a lista que a galeria mantida pelo projeto publica: o
  valor padrão de `galleryIndex`, e o que `tyto gallery` lê quando nem `--index` nem `TYTO_GALLERY_INDEX` dizem outra.

## O que ela ainda não faz

**É preciso ter o Git instalado** para a galeria e para buscar templates por arquivo de plugin. Sem ele, a busca falha e o
painel de problemas diz qual repositório não veio.

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
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.14.1\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.14.1/logs`; no Linux, `~/.config/Tyto/0.14.1/logs`.

Na primeira vez que a 0.14.1 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos recentes, os seus atalhos de teclado e as abas que estavam abertas.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.14.1.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.14.1.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.14.1-universal.dmg`                                                 |
| Linux                       | `Tyto-0.14.1.AppImage`: dê permissão de execução e rode                     |

O terminal vem dentro de cada um desses arquivos: não há nada a instalar à parte.

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
